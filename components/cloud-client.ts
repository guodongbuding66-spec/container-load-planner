import { CLOUD_BASE } from "../lib/cloud/protocol";
import { tr } from "./language";

export class CloudClientError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const errors: Record<string, [string, string]> = {
  "invalid-input": ["请检查输入和文件类型。", "Check the form and file type."],
  "invalid-workspace": ["请选择有效的装柜工作区备份。", "Select a valid CargoFit workspace backup."],
  "sign-in-required": ["会话已结束，请重新登录。", "Your session ended. Sign in again."],
  "auth-rejected": ["账号资料、密码或验证码未通过核对。", "The credentials or verification code could not be verified."],
  "rate-limited": ["操作过于频繁，请稍后重试。", "Too many requests. Try again later."],
  "revision-conflict": ["云端已有新版本，请刷新并对照后再保存。", "A new revision exists. Refresh and review it before saving."],
  "request-conflict": ["重复请求的内容发生变化，请重新预览。", "The retried request changed. Preview the data again."],
  "forbidden": ["当前角色无权执行此操作。", "Your current role cannot perform this action."],
  "quota-exceeded": ["组织云端额度已满。", "This organization has reached a cloud limit."],
  "writes-paused": ["此组织已暂停新增云端写入。", "Cloud writes are paused for this organization."],
  "seat-limit": ["组织的可用席位不足。", "This organization has no available seats."],
  "trial-unavailable": ["当前组织无法再开通试用。", "A trial is unavailable for this organization."],
  "already-member": ["该邮箱已经加入组织。", "This email is already a member."],
  "file-too-large": ["文件超过云端上限。请使用本机文件备份。", "The file exceeds the cloud limit. Keep a local backup."],
  "not-found": ["记录不存在、已撤销或无访问权限。", "The item is missing, revoked or inaccessible."],
  "checkout-incomplete": ["测试订单尚未取得支付会话，请稍后再核对。", "The test checkout session is incomplete. Check again later."],
  "integrity-error": ["文件完整性检查失败。", "The file failed its integrity check."],
};

export function cloudMessage(error: unknown) {
  const reason = error instanceof CloudClientError ? errors[error.code] : undefined;
  return tr(...(reason ?? ["云端服务暂不可用，请稍后重试。", "Cloud services are unavailable. Try again later."]));
}

export async function cargoRequest<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(CLOUD_BASE + path, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const value = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok || value === null) throw new CloudClientError(value?.error ?? "unavailable", response.status);
  return value as T;
}

export function downloadCloud(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
