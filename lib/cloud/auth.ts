import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import type { Pool } from "pg";
import { CLOUD_BASE } from "./protocol.ts";
import type { Actor } from "./store.ts";
import { badInput, CloudFault, email, text } from "./validation.ts";

type OtpMail = { email: string; otp: string; type: string };
export type AuthSettings = { secret: string; origins: readonly string[]; secure: boolean; sendMail: (mail: OtpMail) => Promise<void> };

export function cloudAuthOptions(pool: Pool, settings: AuthSettings) {
  return {
    appName: "CargoFit",
    database: pool,
    secret: settings.secret,
    baseURL: settings.origins[settings.origins.length - 1],
    basePath: CLOUD_BASE + "/auth",
    trustedOrigins: [...settings.origins],
    advanced: { useSecureCookies: settings.secure, cookiePrefix: "cargofit", ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for"] } },
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: true, revokeSessionsOnPasswordReset: true },
    emailVerification: { autoSignInAfterVerification: false },
    session: { expiresIn: 7 * 86400, updateAge: 86400, cookieCache: { enabled: false }, freshAge: 86400 },
    logger: { disabled: true },
    rateLimit: { enabled: true, storage: "database" as const, window: 60, max: 60 },
    plugins: [emailOTP({
      otpLength: 8, expiresIn: 600, allowedAttempts: 5, storeOTP: "hashed", sendVerificationOTP: settings.sendMail,
    })],
  };
}

export function createCloudAuth(pool: Pool, settings: AuthSettings) {
  return betterAuth(cloudAuthOptions(pool, settings));
}
export type CloudAuth = ReturnType<typeof createCloudAuth>;

export async function actorFrom(auth: CloudAuth, headers: Headers): Promise<Actor> {
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
  if (!session?.user.emailVerified) throw new CloudFault(401, "sign-in-required");
  return { id: session.user.id, name: session.user.name, email: session.user.email.toLowerCase() };
}

const actions = new Set([
  "/sign-in/email-otp", "/sign-in/email", "/email-otp/send-verification-otp",
  "/email-otp/request-password-reset", "/email-otp/reset-password", "/sign-out", "/revoke-sessions",
]);

function password(raw: unknown, newPassword: boolean) {
  if (typeof raw !== "string" || raw.length > 128 || raw.length < (newPassword ? 12 : 1)) throw badInput();
  return raw;
}
function otp(raw: unknown) {
  if (typeof raw !== "string" || !/^\d{8}$/.test(raw)) throw badInput();
  return raw;
}

export async function forwardAuth(auth: CloudAuth, route: string, raw: Record<string, unknown>, request: Request, origin: string, clientIp?: string) {
  if (!actions.has(route)) throw new CloudFault(404, "not-found");
  const data: Record<string, string> = {};
  if (route !== "/sign-out" && route !== "/revoke-sessions") data.email = email(raw.email);
  if (route === "/sign-in/email-otp") data.name = raw.name ? text(raw.name, 80) : "CargoFit";
  if (route === "/sign-in/email" || route === "/email-otp/reset-password")
    data.password = password(raw.password, route !== "/sign-in/email");
  if (route === "/sign-in/email-otp" || route === "/email-otp/reset-password") data.otp = otp(raw.otp);
  if (route === "/email-otp/send-verification-otp") data.type = "sign-in";

  const headers = new Headers({ "content-type": "application/json", origin });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  if (clientIp) headers.set("x-vercel-forwarded-for", clientIp);
  const upstream = await auth.handler(new Request(new URL(CLOUD_BASE + "/auth" + route, origin), {
    method: "POST", headers, body: JSON.stringify(data),
  }));
  if (!upstream.ok) {
    const status = upstream.status;
    await upstream.body?.cancel().catch(() => {});
    throw new CloudFault(status >= 500 ? 503 : status,
      status === 429 ? "rate-limited" : status >= 500 ? "unavailable" : "auth-rejected");
  }
  await upstream.body?.cancel().catch(() => {});
  const response = Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  for (const cookie of upstream.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}

export function resendMail(apiKey: string, from: string, send = fetch): AuthSettings["sendMail"] {
  return async ({ email, otp, type }) => {
    const subject = type === "forget-password" ? "CargoFit 密码重置 / Password reset" : "CargoFit 邮箱验证码 / Verification code";
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject, text: `CargoFit · ${otp}\n\n验证码 10 分钟内有效。\nThis code expires in 10 minutes.` }),
    });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) throw new Error("Account mail delivery unavailable");
  };
}
