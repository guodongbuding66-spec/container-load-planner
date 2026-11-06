"use client";

import { useState, type FormEvent } from "react";
import type { CloudEntitlement, CloudOrder, CloudOrg, Role, SandboxOffer } from "../lib/cloud/protocol";
import type { CloudAction, CloudCommand } from "./cloud-org-workspace";
import { tr } from "./language";

type Share = { id: string; revisionId: string; expiresAt: string; revokedAt: string | null };
type Member = { id: string; email: string; role: Role };
type Common = { command: CloudCommand; run: CloudAction; disabled: boolean };
const roles = { owner: ["所有者", "Owner"], editor: ["编辑", "Editor"], viewer: ["只读", "Viewer"] } as const;
const plans = { free: ["基础", "Basic"], pro: ["专业", "Pro"], team: ["团队", "Team"] } as const;
const states = {
  pending: ["待付款", "Pending"], paid: ["已对账", "Reconciled"], failed: ["支付失败", "Failed"], expired: ["已过期", "Expired"],
  partial_refund: ["部分退款", "Partially refunded"], refunded: ["已退款", "Refunded"], disputed: ["争议处理中或未通过", "Disputed"],
} as const;
const date = (value: string) => new Date(value).toLocaleString();

export function CloudSharing({ command, run, disabled, projectId, revisionId }: Common & { projectId: string; revisionId: string }) {
  const [link, setLink] = useState("");
  const [shares, setShares] = useState<Share[]>([]);
  async function refresh() { setShares(await command("shares", { projectId })); }
  async function make() {
    const value = await command<{ token: string }>("create-share", { projectId, revisionId });
    setLink(new URL(`/#cloudShare=${value.token}`, window.location.origin).href);
    await refresh();
  }
  return <details className="cloud-section">
    <summary>{tr("此版本的只读共享", "Read-only sharing for this revision")}</summary>
    <p>{tr("取得链接的人可以读取此版本的方案 JSON，链接七天后失效。独立现场附件仅对组织成员开放。", "Anyone with the link can read this revision's workspace JSON for seven days. Separate field files are available to organization members.")}</p>
    <div className="feature-toolbar">
      <button className="button" disabled={disabled} onClick={() => void run(make)}>{tr("生成此版本共享链接", "Create a share link for this revision")}</button>
      <button className="button" disabled={disabled} onClick={() => void run(refresh)}>{tr("查询共享记录", "List share links")}</button>
    </div>
    {link && <label>{tr("新共享链接", "New share link")}<input readOnly value={link} onFocus={event => event.currentTarget.select()}/></label>}
    <ul>{shares.filter(share => share.revisionId === revisionId).map(share => <li key={share.id}>
      {date(share.expiresAt)} · {share.revokedAt ? tr("已撤销", "Revoked") :
        <button className="button small" disabled={disabled} onClick={() => void run(async () => {
          await command("revoke-share", { projectId, shareId: share.id }); setLink(""); await refresh();
        })}>{tr("撤销共享链接", "Revoke share link")}</button>}
    </li>)}</ul>
  </details>;
}

export function CloudMembership({ org, access, sandbox, command, run, disabled, refresh, onJoin }:
  Common & { org: CloudOrg; access?: CloudEntitlement; sandbox: boolean; refresh: () => Promise<void>; onJoin: (orgId: string) => Promise<void> }) {
  const [invite, setInvite] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [billing, setBilling] = useState<{ offers: SandboxOffer[]; orders: CloudOrder[] }>();
  const [checkout, setCheckout] = useState<string>();
  const [keys] = useState(() => new Map<string, string>());
  const owner = org.role === "owner";
  async function listMembers() { setMembers(await command("members")); }
  async function listOrders() { setBilling(await command("billing")); }
  function submit(event: FormEvent<HTMLFormElement>, action: "invite" | "join") {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void run(async () => {
      if (action === "invite") setInvite((await command<{ token: string }>(action, data)).token);
      else await onJoin((await command<{ orgId: string }>(action, data)).orgId);
    });
  }
  return <details className="cloud-section">
    <summary>{tr("成员、会员与额度", "Members, membership and quotas")}</summary>
    {access && <>
      <p><strong>{tr(plans[access.plan][0], plans[access.plan][1])}</strong> · {access.state === "trial" ? tr("试用", "Trial") : access.state === "active" ? tr("有效", "Active") : tr("基础权益", "Basic access")}
        {access.until && <> · {tr("到期", "Expires")} {date(access.until)}</>}
        {access.paused && <> · {tr("已暂停写入", "Writes paused")}</>}
      </p>
      <dl className="cloud-quotas">
        <div><dt>{tr("项目", "Projects")}</dt><dd>{access.usage.projects} / {access.limits.projects}</dd></div>
        <div><dt>{tr("本月提交", "Writes this month")}</dt><dd>{access.usage.writes} / {access.limits.writes}</dd></div>
        <div><dt>{tr("存储 MB", "Storage MB")}</dt><dd>{(access.usage.bytes / 1024 ** 2).toFixed(2)} / {access.limits.bytes / 1024 ** 2}</dd></div>
        <div><dt>{tr("成员席位", "Seats")}</dt><dd>{access.usage.seats} / {access.limits.seats}</dd></div>
      </dl>
      {owner && <div className="feature-toolbar">
        {access.trialDays > 0 && !access.trialUsed && <button className="button" disabled={disabled} onClick={() => void run(async () => {
          await command("start-trial"); await refresh();
        })}>{tr(`开始 ${access.trialDays} 天试用`, `Start ${access.trialDays}-day trial`)}</button>}
        <button className="button" disabled={disabled} onClick={() => void run(async () => {
          await command("set-paused", { paused: !access.paused }); await refresh();
        })}>{access.paused ? tr("恢复云端写入", "Resume cloud writes") : tr("暂停新增云端写入", "Pause cloud writes")}</button>
      </div>}
    </>}
    <form className="feature-toolbar" onSubmit={event => submit(event, "join")}>
      <label>{tr("组织邀请码", "Organization invite code")}<input name="token" maxLength={43} pattern="[A-Za-z0-9_-]{43}" required/></label>
      <button className="button" disabled={disabled} type="submit">{tr("接受组织邀请", "Accept invite")}</button>
    </form>
    {owner && <>
      <form className="feature-toolbar" onSubmit={event => submit(event, "invite")}>
        <label>{tr("受邀成员邮箱", "Invitee email")}<input name="email" type="email" maxLength={254} required/></label>
        <label>{tr("成员权限", "Member role")}<select name="role"><option value="viewer">{tr(...roles.viewer)}</option><option value="editor">{tr(...roles.editor)}</option></select></label>
        <button className="button" disabled={disabled} type="submit">{tr("生成邀请码", "Create invite code")}</button>
      </form>
      {invite && <label>{tr("三天内有效的邀请码", "Invite code valid for three days")}<input readOnly value={invite} onFocus={event => event.currentTarget.select()}/></label>}
      <button className="button" disabled={disabled} onClick={() => void run(listMembers)}>{tr("查看成员", "List members")}</button>
      <ul>{members.map(member => <li key={member.id} className="feature-toolbar">
        <span>{member.email} · {tr(roles[member.role][0], roles[member.role][1])}</span>
        {member.role !== "owner" && <>
          <button className="button small" disabled={disabled} onClick={() => void run(async () => {
            await command("set-role", { memberId: member.id, role: member.role === "viewer" ? "editor" : "viewer" }); await listMembers();
          })}>{member.role === "viewer" ? tr("改为编辑", "Make editor") : tr("改为只读", "Make viewer")}</button>
          <button className="button small" disabled={disabled} onClick={() => void run(async () => {
            await command("remove-member", { memberId: member.id }); await listMembers(); await refresh();
          })}>{tr("撤销成员权限", "Remove access")}</button>
        </>}
      </li>)}</ul>
    </>}
    {sandbox && owner && <>
      <h3>{tr("支付沙箱", "Payment sandbox")}</h3>
      <p>{tr("测试权益按单次通行期计算。返回页面后，核对付款与退款状态。", "Test passes have a fixed term. Check payment and refund status after returning.")}</p>
      <button className="button" disabled={disabled} onClick={() => void run(async () => { await listOrders(); await refresh(); })}>{tr("查询测试套餐和订单", "Check test offers and orders")}</button>
      <div className="feature-toolbar">{billing?.offers.map(offer => <button key={offer.code} className="button" disabled={disabled} onClick={() => void run(async () => {
        const key = keys.get(offer.code) ?? crypto.randomUUID();
        keys.set(offer.code, key);
        const result = await command<{ url: string | null }>("checkout", { key, plan: offer.code });
        if (!result.url) { keys.delete(offer.code); setCheckout(undefined); await listOrders(); return; }
        if (new URL(result.url).origin !== "https://checkout.stripe.com") throw Error("Invalid checkout");
        setCheckout(result.url);
      })}>{tr(plans[offer.code][0], plans[offer.code][1])} · ${(offer.amount / 100).toFixed(2)} USD · {offer.days} {tr("天（测试）", "days (test)")}</button>)}</div>
      {checkout && <p><a className="button primary" href={checkout} rel="noreferrer">{tr("打开 Stripe 沙箱支付", "Open Stripe test checkout")}</a></p>}
      <ul>{billing?.orders.map(order => <li key={order.id}>{tr(plans[order.plan][0], plans[order.plan][1])} · {tr(states[order.state][0], states[order.state][1])} · {(order.amount / 100).toFixed(2)} {order.currency.toUpperCase()}
        {!!order.refunded && <> · {tr("已退", "Refunded")} {(order.refunded / 100).toFixed(2)}</>}
        {order.validUntil && <> · {tr("到期", "Expires")} {date(order.validUntil)}</>}
        <button className="button small" disabled={disabled} onClick={() => void run(async () => {
          await command("recheck-order", { orderId: order.id }); await listOrders(); await refresh();
        })}>{tr("从 Stripe 复核", "Recheck with Stripe")}</button></li>)}</ul>
    </>}
  </details>;
}
