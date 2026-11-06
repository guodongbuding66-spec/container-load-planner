import { createCloudAuth, resendMail } from "./auth.ts";
import { createSandboxStripe } from "./billing.ts";
import { createCloudPool } from "./db.ts";
import { CLOUD_ORIGINS } from "./protocol.ts";
import { email } from "./validation.ts";
import type { CloudRuntime } from "./service.ts";

export function cloudConfig(env: NodeJS.ProcessEnv) {
  const mode = env.CARGOFIT_CLOUD_MODE;
  if (mode !== "private" && mode !== "sandbox") return null;
  const database = env.CARGOFIT_DATABASE_URL;
  const secret = env.CARGOFIT_AUTH_SECRET;
  const mailKey = env.CARGOFIT_RESEND_API_KEY;
  const mailFrom = env.CARGOFIT_MAIL_FROM;
  const proxySecret = env.CARGOFIT_PROXY_SECRET;
  if (!database || !secret || secret.length < 32 || !mailKey?.startsWith("re_") || !mailFrom || !proxySecret || proxySecret.length < 32) return null;
  try {
    const url = new URL(database);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.searchParams.get("sslmode") !== "verify-full") return null;
  } catch { return null; }
  const trial = Number(env.CARGOFIT_TRIAL_DAYS ?? 0);
  if (!Number.isInteger(trial) || trial < 0 || trial > 30) return null;
  let sandboxEmails: Set<string> | undefined;
  if (mode === "sandbox") {
    try { sandboxEmails = new Set((env.CARGOFIT_SANDBOX_EMAILS ?? "").split(",").map(email)); }
    catch { return null; }
  }
  return { mode, database, secret, mailKey, mailFrom, trial, proxySecret, sandboxEmails } as const;
}

let runtime: CloudRuntime | null | undefined;
export function deploymentCloud(): CloudRuntime | null {
  if (runtime !== undefined) return runtime;
  const config = cloudConfig(process.env);
  if (!config) return runtime = null;
  const pool = createCloudPool(config.database);
  pool.on("error", () => { console.error("CargoFit cloud database connection error"); });
  const auth = createCloudAuth(pool, { origins: CLOUD_ORIGINS, secret: config.secret, secure: true, sendMail: resendMail(config.mailKey, config.mailFrom) });
  const testKey = process.env.CARGOFIT_STRIPE_TEST_KEY;
  const hook = process.env.CARGOFIT_STRIPE_WEBHOOK_SECRET;
  return runtime = { pool, auth, mode: config.mode, trialDays: config.trial, proxySecret: config.proxySecret, sandboxEmails: config.sandboxEmails,
    ...(config.mode === "sandbox" && testKey?.startsWith("sk_test_") && hook?.startsWith("whsec_")
      ? { stripe: { api: createSandboxStripe(testKey), secret: hook } } : {}) };
}
