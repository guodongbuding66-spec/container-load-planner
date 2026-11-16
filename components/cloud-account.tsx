"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent, type Ref } from "react";
import { Cloud } from "lucide-react";
import { CLOUD_API_VERSION, type CloudRevision, type CloudSession } from "../lib/cloud/protocol";
import { cargoRequest, CloudClientError, cloudMessage } from "./cloud-client";
import { CloudOrgWorkspace } from "./cloud-org-workspace";
import { FeatureDialog } from "./feature-dialog";
import { tr, useLanguage } from "./language";

type Props = { backup: string; disabled: boolean; onRestore: (backup: string) => void };
type Status = { version: number; enabled: boolean; mode?: "private" | "sandbox"; sandbox?: boolean };
const EMPTY_LINK = "";
const serverLink = () => EMPTY_LINK;
function subscribeLink(update: () => void) {
  window.addEventListener("hashchange", update);
  return () => window.removeEventListener("hashchange", update);
}
function readLink() {
  const hash = window.location.hash;
  return hash === "#cloudPayment=return" || /^#cloudShare=[\w-]{43}$/.test(hash) ? hash : EMPTY_LINK;
}

export function CloudAccount({buttonRef,backup,disabled,onRestore}:Props & {buttonRef?:Ref<HTMLButtonElement>}) {
  useLanguage();
  const link = useSyncExternalStore(subscribeLink, readLink, serverLink);
  const [opened, setOpened] = useState(false);
  const [dismissed, setDismissed] = useState("");
  function close() {
    setOpened(false);
    if (link) {
      setDismissed(link);
      if (window.location.hash === link) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }
  return <>
    <button ref={buttonRef} type="button" className="button ghost" onClick={() => setOpened(true)}><Cloud size={16} aria-hidden="true"/>{tr("账号与云项目", "Account and cloud projects")}</button>
    {(opened || !!link && link !== dismissed) && <FeatureDialog wide title={tr("账号与云项目", "Account and cloud projects")}
      subtitle={tr("用独立账号管理私有项目、版本与组织成员。", "Manage private projects, revisions and organization members with a CargoFit account.")} onClose={close}>
      <CloudDialogBody backup={backup} disabled={disabled} link={link} onRestore={payload => { onRestore(payload); close(); }} />
    </FeatureDialog>}
  </>;
}

function CloudDialogBody({ backup, disabled, onRestore, link }: Props & { link: string }) {
  const [status, setStatus] = useState<Status>();
  const [session, setSession] = useState<CloudSession | null>(null);
  const [activeOrg, setActiveOrg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const org = session?.orgs.find(row => row.id === activeOrg) ?? session?.orgs[0];
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const next = await cargoRequest<Status>("/status", undefined, controller.signal);
        if (controller.signal.aborted) return;
        const enabled = next.version === CLOUD_API_VERSION && next.enabled === true;
        setStatus({ ...next, enabled });
        if (enabled) {
          const identity = await cargoRequest<CloudSession>("/data", { action: "me" }, controller.signal);
          if (!controller.signal.aborted) setSession(identity);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof CloudClientError && error.status === 401) setSession(null);
        else setStatus({ version: CLOUD_API_VERSION, enabled: false });
      }
    }
    void load();
    return () => controller.abort();
  }, [refresh]);

  async function loadIdentity() {
    const identity = await cargoRequest<CloudSession>("/data", { action: "me" });
    setSession(identity);
    setNote("");
    return identity;
  }
  async function leave(all: boolean) {
    setBusy(true);
    try {
      if (all) await cargoRequest("/auth/revoke-sessions", {});
      await cargoRequest("/auth/sign-out", {});
      setSession(null);
      setActiveOrg("");
      setNote(tr("已退出账号。", "Signed out."));
    } catch (error) { setNote(cloudMessage(error)); }
    finally { setBusy(false); }
  }
  async function acceptShared() {
    setBusy(true);
    try {
      const data = await cargoRequest<CloudRevision & { payload: string }>("/share", { token: link.slice("#cloudShare=".length) });
      onRestore(data.payload);
    } catch (error) { setNote(cloudMessage(error)); }
    finally { setBusy(false); }
  }

  if (!status) return <p role="status">{tr("正在检查云端服务…", "Checking cloud availability…")}</p>;
  if (!status.enabled) return <>
    <p className="feature-note" role="status">{tr("云端服务尚未启用。当前可继续本机计算，并从“文件与备份”保存或恢复工作区。", "Cloud services are disabled. Continue calculating locally and use Files & backups to save or restore your workspace.")}</p>
    <button type="button" className="button" onClick={() => { setStatus(undefined); setRefresh(value => value + 1); }}>{tr("重新检查服务", "Check availability again")}</button>
  </>;

  return <>
    {status.mode === "sandbox" && <p className="feature-note">{tr("沙箱环境 · 请使用测试数据。", "Sandbox environment · use test data.")}</p>}
    {link === "#cloudPayment=return" && <p className="feature-note">{tr("已返回装柜智算。会员状态以服务端支付对账结果为准。", "You returned to CargoFit. Membership reflects the server's payment reconciliation.")}</p>}
    {link.startsWith("#cloudShare=") && <div className="feature-toolbar"><button className="button" disabled={busy || disabled} onClick={acceptShared}>{tr("读取共享版本并预览恢复", "Read shared revision and preview restore")}</button></div>}
    {!!note && <p role="status">{note}</p>}
    {session && org ? <>
      <div className="feature-toolbar cloud-session">
        <span><strong>{session.user.name}</strong> · {session.user.email}</span>
        <label>{tr("当前组织", "Current organization")}<select value={org.id} disabled={busy} onChange={event => setActiveOrg(event.target.value)}>
          {session.orgs.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}
        </select></label>
        <button className="button" disabled={busy} onClick={() => void leave(false)}>{tr("退出本设备", "Sign out here")}</button>
        <button className="button" disabled={busy} onClick={() => void leave(true)}>{tr("退出全部设备", "Sign out everywhere")}</button>
      </div>
      <CloudOrgWorkspace key={session.user.email + "/" + org.id} org={org} backup={backup} disabled={disabled || busy}
        sandbox={status.sandbox === true} onRestore={onRestore} onJoin={async id => { await loadIdentity(); setActiveOrg(id); }}
        onExpired={() => { setSession(null); setActiveOrg(""); setNote(tr("会话已结束，请重新登录。", "Your session ended. Sign in again.")); }} />
    </> : <CloudSignIn onSignedIn={loadIdentity} />}
  </>;
}

type AuthForm = "request-code" | "code" | "sign-in" | "request-reset" | "reset";
const labels: Record<AuthForm, [string, string]> = {
  "request-code": ["发送登录验证码", "Send sign-in code"], code: ["验证邮箱并登录", "Verify email and sign in"],
  "sign-in": ["密码登录", "Sign in with password"], "request-reset": ["发送密码设置码", "Send password setup code"], reset: ["设置或重置密码", "Set or reset password"],
};
const routes: Record<AuthForm, string> = {
  "request-code": "/email-otp/send-verification-otp", code: "/sign-in/email-otp", "sign-in": "/sign-in/email",
  "request-reset": "/email-otp/request-password-reset", reset: "/email-otp/reset-password",
};

function CloudSignIn({ onSignedIn }: { onSignedIn: () => Promise<CloudSession> }) {
  const [mode, setMode] = useState<AuthForm>("request-code");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setNotice("");
    try {
      await cargoRequest("/auth" + routes[mode], data);
      if (mode === "sign-in" || mode === "code") await onSignedIn();
      if (mode === "request-code") { setMode("code"); setNotice(tr("请查收 8 位邮箱验证码。", "Check your email for the 8-digit code.")); }
      if (mode === "request-reset") { setMode("reset"); setNotice(tr("已受理重置请求。请查收邮箱。", "Reset requested. Check your inbox.")); }
      if (mode === "reset") { setMode("sign-in"); setNotice(tr("操作完成，请登录。", "Done. Sign in to continue.")); }
    } catch (error) { setNotice(cloudMessage(error)); }
    finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true);
    try { await cargoRequest("/auth/email-otp/send-verification-otp", { email }); setNotice(tr("已受理验证码请求。请查收邮箱。", "Code requested. Check your inbox.")); }
    catch (error) { setNotice(cloudMessage(error)); }
    finally { setBusy(false); }
  }
  const password = mode === "sign-in" || mode === "reset";
  return <>
    <p>{tr("首次使用时，邮箱验证码核对成功后创建账号。", "Your first successful email-code sign-in creates the account.")}</p>
    <form key={mode} onSubmit={send}>
      <fieldset className="upgrade-rule-grid" disabled={busy}>
        <legend>{tr(...labels[mode])}</legend>
        {mode === "code" && <label>{tr("显示名称（首次登录可填）", "Display name for your first sign-in")}<input name="name" autoComplete="name" maxLength={80}/></label>}
        <label>{tr("邮箱", "Email")}<input name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} required/></label>
        {password && <label>{tr("密码", "Password")}<input type="password" name="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={mode === "sign-in" ? 1 : 12} maxLength={128} required/></label>}
        {(mode === "code" || mode === "reset") && <label>{tr("8 位邮箱验证码", "8-digit email code")}<input name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required/></label>}
        <button className="button primary" type="submit">{tr(...labels[mode])}</button>
        {mode === "code" && <button className="button" type="button" disabled={!email} onClick={resend}>{tr("重发验证码", "Resend code")}</button>}
      </fieldset>
    </form>
    <div className="feature-toolbar">{(["request-code", "code", "sign-in", "request-reset", "reset"] as const).filter(key => key !== mode).map(key =>
      <button key={key} type="button" className="button ghost" disabled={busy} onClick={() => { setMode(key); setNotice(""); }}>{tr(...labels[key])}</button>)}</div>
    <p role="status">{notice}</p>
  </>;
}
