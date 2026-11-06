import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import Stripe from "stripe";
import { transaction, type Query } from "./db.ts";
import type { CloudOrder, SandboxOffer } from "./protocol.ts";
import { audit, one, orgScope, requireOwner, type Actor } from "./store.ts";
import { badInput, CloudFault, missing, unavailable, uuid, UUID } from "./validation.ts";

const DAY = 86400_000;
const offers: readonly SandboxOffer[] = [
  { code: "pro", amount: 990, currency: "usd", days: 30 },
  { code: "team", amount: 1990, currency: "usd", days: 30 },
];
const publicOrder = 'id,plan,amount,currency,refunded,state,created_at AS "createdAt",valid_until AS "validUntil"';
const orderFields = publicOrder + ',org_id AS "orgId",origin,days,expires_at AS "expiresAt",paid_at AS "paidAt",session_id AS "sessionId",payment_id AS "paymentId",checkout_url AS "checkoutUrl",dispute_state AS "disputeState"';
type Order = CloudOrder & {
  orgId: string; origin: string; days: number; expiresAt: Date; paidAt: Date | null;
  sessionId: string | null; paymentId: string | null; checkoutUrl: string | null;
  disputeState: "none" | "open" | "won" | "lost";
};
const CHECKOUT_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"]);
const CHARGE_EVENTS = new Set(["charge.refunded", "refund.created", "refund.updated", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]);
const mismatch = () => new CloudFault(400, "payment-mismatch");
const stripeId = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;

export function createSandboxStripe(secret: string) {
  if (!secret.startsWith("sk_test_")) throw badInput();
  return new Stripe(secret, { timeout: 7000, maxNetworkRetries: 0 });
}

export function sandboxOrders(pool: Pool, actor: Actor, orgId: string) {
  return transaction(pool, async db => {
    requireOwner(await orgScope(db, actor, orgId));
    return (await db.query<CloudOrder>(
      `SELECT ${publicOrder} FROM cf_order WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`, [orgId])).rows;
  });
}

export async function checkout(pool: Pool, stripe: Stripe, actor: Actor, origin: string, body: Record<string, unknown>) {
  const orgId = uuid(body.orgId), key = uuid(body.key);
  const offer = offers.find(row => row.code === body.plan);
  if (!offer) throw badInput();
  const order = await transaction(pool, async db => {
    requireOwner(await orgScope(db, actor, orgId, true));
    const existing = await one<Order>(db, `SELECT ${orderFields} FROM cf_order WHERE org_id=$1 AND buyer_id=$2 AND request_key=$3`, [orgId, actor.id, key]);
    if (existing) {
      if (existing.plan !== offer.code) throw new CloudFault(409, "request-conflict");
      return existing;
    }
    const pending = await one<Order>(db, `SELECT ${orderFields} FROM cf_order
      WHERE org_id=$1 AND buyer_id=$2 AND plan=$3 AND state='pending' AND expires_at>now()
      ORDER BY created_at DESC LIMIT 1`, [orgId, actor.id, offer.code]);
    if (pending) return pending;
    return (await one<Order>(db, `INSERT INTO cf_order(id,org_id,buyer_id,request_key,origin,plan,currency,amount,days,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,date_trunc('second',now())+interval '1 hour') RETURNING ${orderFields}`,
      [randomUUID(), orgId, actor.id, key, origin, offer.code, offer.currency, offer.amount, offer.days]))!;
  });
  if (order.state !== "pending" || order.expiresAt.getTime() <= Date.now()) return { id: order.id, url: null };
  if (order.checkoutUrl) return { id: order.id, url: order.checkoutUrl };
  if (order.expiresAt.getTime() - Date.now() < 31 * 60_000) throw new CloudFault(409, "checkout-incomplete");
  const metadata = { orderId: order.id, orgId };
  const returnUrl = new URL("/#cloudPayment=return", order.origin).href;
  const session = await stripe.checkout.sessions.create({
    mode: "payment", client_reference_id: order.id, metadata,
    payment_intent_data: { metadata }, expires_at: Math.floor(order.expiresAt.getTime() / 1000),
    success_url: returnUrl, cancel_url: returnUrl,
    line_items: [{ quantity: 1, price_data: { unit_amount: order.amount, currency: order.currency,
      product_data: { name: `CargoFit ${order.plan} · sandbox pass` } } }],
  }, { idempotencyKey: `cargofit-checkout-${order.id}` });
  assertSession(order, session);
  if (!session.url || new URL(session.url).origin !== "https://checkout.stripe.com") throw mismatch();
  const saved = await pool.query(`UPDATE cf_order SET session_id=$2,checkout_url=$3
    WHERE id=$1 AND (session_id IS NULL OR session_id=$2) RETURNING id`, [order.id, session.id, session.url]);
  if (!saved.rows.length) throw mismatch();
  return { id: order.id, url: session.url };
}

function assertSession(order: Order, session: Stripe.Checkout.Session) {
  if (session.livemode || session.mode !== "payment" || session.client_reference_id !== order.id ||
    session.metadata?.orderId !== order.id || session.metadata.orgId !== order.orgId ||
    session.amount_total !== order.amount || session.currency !== order.currency ||
    session.expires_at * 1000 !== order.expiresAt.getTime() || order.sessionId && session.id !== order.sessionId) throw mismatch();
}

function verifyNotice(stripe: Stripe, signingSecret: string, raw: string, signature: string | null) {
  if (!signature) throw new CloudFault(400, "bad-signature");
  let notice: Stripe.Event;
  try { notice = stripe.webhooks.constructEvent(raw, signature, signingSecret, 300); }
  catch { throw new CloudFault(400, "bad-signature"); }
  if (notice.livemode) throw mismatch();
  return notice;
}

async function eventTarget(stripe: Stripe, notice: Stripe.Event) {
  if (CHECKOUT_EVENTS.has(notice.type)) {
    const checkout = notice.data.object as Stripe.Checkout.Session;
    return checkout.metadata?.orderId ? { orderId: checkout.metadata.orderId, sessionId: checkout.id, paymentId: undefined } : null;
  }
  if (CHARGE_EVENTS.has(notice.type)) {
    const eventObject = notice.data.object as Stripe.Charge | Stripe.Refund | Stripe.Dispute;
    const paymentId = stripeId(eventObject.payment_intent);
    if (!paymentId) return null;
    const intent = await stripe.paymentIntents.retrieve(paymentId);
    return intent.metadata.orderId ? { orderId: intent.metadata.orderId, sessionId: undefined, paymentId } : null;
  }
  return null;
}

async function reconcileStripeOrder(stripe: Stripe, order: Order, session: Stripe.Checkout.Session, eventType: string) {
  assertSession(order, session);
  const paymentId = stripeId(session.payment_intent);
  if (order.paymentId && order.paymentId !== paymentId) throw mismatch();
  let { paidAt, validUntil, refunded, disputeState, state } = order;
  if (session.payment_status === "paid") {
    const intent = typeof session.payment_intent === "object" && session.payment_intent;
    const charge = intent && typeof intent.latest_charge === "object" && intent.latest_charge;
    if (!intent || !charge || intent.livemode || charge.livemode || intent.metadata.orderId !== order.id ||
      intent.metadata.orgId !== order.orgId || intent.status !== "succeeded" || intent.amount_received !== order.amount ||
      intent.currency !== order.currency || !charge.paid || !charge.captured || charge.amount_captured !== order.amount ||
      charge.currency !== order.currency || stripeId(charge.payment_intent) !== intent.id) throw mismatch();
    if (!Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > order.amount ||
      !Number.isSafeInteger(charge.created) || charge.created * 1000 > order.expiresAt.getTime() ||
      charge.created * 1000 < new Date(order.createdAt).getTime() - 5000) throw mismatch();
    paidAt ??= new Date(charge.created * 1000);
    validUntil ??= new Date(paidAt.getTime() + order.days * DAY).toISOString();
    refunded = Math.max(refunded, charge.amount_refunded);
    if (charge.disputed || disputeState !== "none" || eventType.startsWith("charge.dispute.")) {
      const disputes = await stripe.disputes.list({ payment_intent: intent.id, limit: 10 });
      if (disputes.has_more) throw unavailable();
      const statuses = disputes.data.map(item => item.status);
      if (statuses.includes("lost")) disputeState = "lost";
      else if (statuses.some(status => !["won", "warning_closed", "prevented"].includes(status))) disputeState = "open";
      else if (statuses.length && disputeState !== "lost") disputeState = "won";
      else if (charge.disputed && disputeState === "none") disputeState = "open";
    }
    state = refunded === order.amount ? "refunded"
      : disputeState === "open" || disputeState === "lost" ? "disputed"
      : refunded ? "partial_refund" : "paid";
  } else if (!paidAt) {
    if (session.status === "expired" || Date.now() > order.expiresAt.getTime()) state = "expired";
    else if (eventType === "checkout.session.async_payment_failed") state = "failed";
  }
  return { paymentId, paidAt, validUntil, refunded, disputeState, state };
}

export async function paymentWebhook(pool: Pool, stripe: Stripe, signingSecret: string, raw: string, signature: string | null) {
  const event = verifyNotice(stripe, signingSecret, raw, signature);
  if (await one(pool, "SELECT 1 FROM cf_payment_event WHERE event_id=$1", [event.id])) return { received: true, duplicate: true };
  const target = await eventTarget(stripe, event);
  if (!target || !UUID.test(target.orderId)) return { received: true };
  const org = await one<{ id: string }>(pool, "SELECT org_id AS id FROM cf_order WHERE id=$1", [target.orderId]);
  if (!org) return { received: true };
  return transaction(pool, async db => {
    await db.query("SELECT id FROM cf_org WHERE id=$1 FOR UPDATE", [org.id]);
    const order = await one<Order>(db, `SELECT ${orderFields} FROM cf_order WHERE id=$1 AND org_id=$2 FOR UPDATE`, [target.orderId, org.id]);
    if (!order) throw missing();
    if (await one(db, "SELECT 1 FROM cf_payment_event WHERE event_id=$1", [event.id])) return { received: true, duplicate: true };
    if (target.sessionId && order.sessionId && target.sessionId !== order.sessionId) throw mismatch();
    const sessionId = target.sessionId ?? order.sessionId;
    if (!sessionId) throw unavailable();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
    if (target.paymentId && stripeId(session.payment_intent) !== target.paymentId) throw mismatch();
    await recordObservation(db, stripe, order, session, event.type, { eventId: event.id });
    await db.query("INSERT INTO cf_payment_event(event_id,order_id,event_type) VALUES($1,$2,$3)", [event.id, order.id, event.type]);
    return { received: true };
  });
}

async function recordObservation(db: Query, stripe: Stripe, order: Order, session: Stripe.Checkout.Session, source: string, detail: object) {
  const next = await reconcileStripeOrder(stripe, order, session, source);
  await db.query(`UPDATE cf_order SET session_id=$2,payment_id=COALESCE($3,payment_id),paid_at=$4,valid_until=$5,
    refunded=$6,dispute_state=$7,state=$8 WHERE id=$1`,
    [order.id, session.id, next.paymentId ?? null, next.paidAt, next.validUntil, next.refunded, next.disputeState, next.state]);
  if (order.state !== next.state || order.refunded !== next.refunded || order.disputeState !== next.disputeState) {
    await audit(db, order.orgId, next.state, null, order.id, { ...detail, refunded: next.refunded, disputeState: next.disputeState });
  }
}

export function recheckOrder(pool: Pool, stripe: Stripe, actor: Actor, body: Record<string, unknown>) {
  const id = uuid(body.orderId), orgId = uuid(body.orgId);
  return transaction(pool, async db => {
    requireOwner(await orgScope(db, actor, orgId, true));
    const order = await one<Order>(db, `SELECT ${orderFields} FROM cf_order WHERE org_id=$1 AND id=$2 FOR UPDATE`, [orgId, id]);
    if (!order) throw missing();
    if (!order.sessionId) throw new CloudFault(409, "checkout-incomplete");
    const session = await stripe.checkout.sessions.retrieve(order.sessionId, { expand: ["payment_intent.latest_charge"] });
    await recordObservation(db, stripe, order, session, "manual-recheck", { actorId: actor.id });
    return { ok: true };
  });
}

export function sandboxOffers() { return offers; }
