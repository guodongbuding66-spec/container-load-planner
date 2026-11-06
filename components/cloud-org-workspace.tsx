"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_CLOUD_FILE_BYTES, MAX_CLOUD_PHOTO_BYTES, type ArchiveKind, type CloudAsset, type CloudEntitlement, type CloudOrg, type CloudProject, type CloudRevision } from "../lib/cloud/protocol";
import { parseWorkspaceBackup } from "../lib/packing/workspace-file";
import { cargoRequest, CloudClientError, cloudMessage, downloadCloud } from "./cloud-client";
import { CloudMembership, CloudSharing } from "./cloud-membership";
import { tr, useLanguage } from "./language";

type Props = { org: CloudOrg; backup: string; disabled: boolean; sandbox: boolean; onRestore: (payload: string) => void; onJoin: (orgId: string) => Promise<void>; onExpired: () => void };
export type CloudCommand = <T>(action: string, body?: object) => Promise<T>;
export type CloudAction = (fn: () => Promise<void>, success?: string) => Promise<void>;
const roleLabels = { owner: ["所有者", "Owner"], editor: ["编辑", "Editor"], viewer: ["只读", "Viewer"] } as const;
const kinds: Record<ArchiveKind, [string, string]> = {
  field: ["现场事件 JSON", "Field events JSON"], weighing: ["核重 JSON", "Weighing JSON"],
  operations: ["作业记录 JSON", "Operation records JSON"], "fleet-handoff": ["多柜交接 JSON", "Fleet handoff JSON"], photo: ["照片", "Photo"],
};
const sizeText = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
const stamp = (value: string) => new Date(value).toLocaleString();
type Staged = { payload: string; rows: number; bytes: number; source: string };
type Context = { project: CloudProject; revisions: CloudRevision[]; current: CloudRevision; page: number; assets: CloudAsset[] };

async function photoPayload(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(""));
}

export function CloudOrgWorkspace({ org, backup, disabled, sandbox, onRestore, onJoin, onExpired }: Props) {
  useLanguage();
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [access, setAccess] = useState<CloudEntitlement>();
  const [context, setContext] = useState<Context>();
  const [stage, setStage] = useState<Staged>();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<ArchiveKind>("field");
  const [assetFile, setAssetFile] = useState<File>();
  const requestKeys = useRef(new Map<string, string>());
  const alive = useRef<AbortController | null>(null);
  const running = useRef(false);
  const expired = useRef(onExpired);
  const archiveInput = useRef<HTMLInputElement>(null);
  const command: CloudCommand = useCallback(<T,>(action: string, body: object = {}) =>
    cargoRequest<T>("/data", { ...body, action, orgId: org.id }, alive.current?.signal), [org.id]);

  const refresh = useCallback(async () => {
    const [list, info] = await Promise.all([command<CloudProject[]>("projects"), command<CloudEntitlement>("entitlements")]);
    if (alive.current?.signal.aborted) return list;
    setProjects(list);
    setAccess(info);
    return list;
  }, [command]);

  useEffect(() => { expired.current = onExpired; }, [onExpired]);
  useEffect(() => {
    const controller = new AbortController();
    alive.current = controller;
    void refresh().catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof CloudClientError && error.status === 401) expired.current();
      else setNotice(cloudMessage(error));
    });
    return () => controller.abort();
  }, [refresh]);

  const run: CloudAction = async (fn, success) => {
    if (running.current || alive.current?.signal.aborted) return;
    running.current = true;
    setBusy(true);
    setNotice("");
    try {
      await fn();
      if (!alive.current?.signal.aborted && success) setNotice(success);
    } catch (error) {
      if (alive.current?.signal.aborted) return;
      if (error instanceof CloudClientError && error.status === 401) expired.current();
      else setNotice(cloudMessage(error));
    } finally {
      running.current = false;
      if (!alive.current?.signal.aborted) setBusy(false);
    }
  };

  const canWrite = org.role !== "viewer" && !access?.paused;
  function keyFor(fingerprint: string) {
    const stored = requestKeys.current.get(fingerprint) ?? crypto.randomUUID();
    requestKeys.current.set(fingerprint, stored);
    return stored;
  }
  function preview(payload: string, source: string) {
    const bytes = new TextEncoder().encode(payload).length;
    if (bytes > MAX_CLOUD_FILE_BYTES) throw new CloudClientError("file-too-large", 413);
    try {
      const inputs = parseWorkspaceBackup(payload);
      setStage({ payload, source, bytes, rows: inputs.products.length });
      requestKeys.current.clear();
    } catch { throw new CloudClientError("invalid-workspace", 400); }
  }
  async function selectProject(item: CloudProject, revisionId?: string, page = 0) {
    const revisions = await command<CloudRevision[]>("history", { projectId: item.id, page });
    const current = revisions.find(row => row.id === (revisionId ?? item.head)) ?? revisions[0];
    if (!current) throw new CloudClientError("not-found", 404);
    const assets = await command<CloudAsset[]>("assets", { projectId: item.id, revisionId: current.id });
    if (alive.current?.signal.aborted) return;
    setContext({ project: item, revisions, current, page, assets });
    setAssetFile(undefined);
    if (archiveInput.current) archiveInput.current.value = "";
  }
  async function refreshSelected() {
    const list = await refresh();
    const selected = list.find(row => row.id === context?.project.id);
    if (selected) await selectProject(selected);
  }
  async function save(asNew: boolean) {
    if (!stage || !canWrite || !asNew && !context) return;
    const selected = context?.project;
    const body = asNew ? { name: name.trim() } : { projectId: selected!.id, expectedHead: selected!.head };
    const action = asNew ? "create-project" : "save-revision";
    const key = keyFor(JSON.stringify([action, body]));
    const stored = await command<{ projectId: string; resourceId: string }>(action, { ...body, key, payload: stage.payload });
    const list = await refresh();
    if (alive.current?.signal.aborted) return;
    const item = list.find(row => row.id === stored.projectId);
    if (item) await selectProject(item);
    setStage(undefined);
    requestKeys.current.clear();
  }
  async function openRevision(download: boolean) {
    if (!context) return;
    const data = await command<CloudRevision & { payload: string }>("revision", { projectId: context.project.id, revisionId: context.current.id });
    if (alive.current?.signal.aborted) return;
    if (download) downloadCloud(`CargoFit-${data.id}.json`, new Blob([data.payload], { type: "application/json" }));
    else onRestore(data.payload);
  }
  async function uploadArchive() {
    if (!context || !assetFile) return;
    if (assetFile.size > (kind === "photo" ? MAX_CLOUD_PHOTO_BYTES : MAX_CLOUD_FILE_BYTES)) throw new CloudClientError("file-too-large", 413);
    const payload = kind === "photo" ? await photoPayload(assetFile) : await assetFile.text();
    if (alive.current?.signal.aborted) return;
    const fingerprint = JSON.stringify([kind, assetFile.name, assetFile.lastModified, assetFile.size, context.current.id]);
    const key = keyFor(fingerprint);
    await command("save-asset", { projectId: context.project.id, revisionId: context.current.id, kind, name: assetFile.name, mime: assetFile.type, key, payload });
    await refresh();
    await selectProject(context.project, context.current.id, context.page);
    requestKeys.current.delete(fingerprint);
  }
  async function getAsset(asset: CloudAsset) {
    if (!context) return;
    const data = await command<CloudAsset & { payload: string }>("asset", {
      projectId: context.project.id, revisionId: context.current.id, assetId: asset.id,
    });
    if (alive.current?.signal.aborted) return;
    downloadCloud(data.name, new Blob([Uint8Array.from(atob(data.payload), c => c.charCodeAt(0))], { type: data.mime }));
  }

  return <>
    <div className="feature-toolbar">
      <strong>{tr(roleLabels[org.role][0], roleLabels[org.role][1])}</strong>
      <button className="button" disabled={busy || disabled} onClick={() => void run(refreshSelected)}>{tr("刷新云端资料", "Refresh cloud data")}</button>
    </div>
    <p role="status">{notice}</p>
    <fieldset className="cloud-section" disabled={busy || disabled}>
      <legend>{tr("私有项目与版本", "Private projects and revisions")}</legend>
      <p>{tr("读取版本会先进入工作区恢复预览。保存前请核对预览和目标组织。", "Reading a version opens the workspace restore preview. Review the snapshot and destination before saving.")}</p>
      <label>{tr("云项目", "Cloud project")}<select value={context?.project.id ?? ""} onChange={event => {
        const item = projects.find(row => row.id === event.target.value);
        if (item) void run(() => selectProject(item)); else setContext(undefined);
      }}>
        <option value="">{tr("选择云项目", "Select a cloud project")}</option>
        {projects.map(row => <option key={row.id} value={row.id}>{row.name} · {row.versions}</option>)}
      </select></label>
      {context && <>
        <label>{tr("查看版本", "View revision")}<select value={context.current.id} onChange={event =>
          void run(() => selectProject(context.project, event.target.value, context.page))}>
          {context.revisions.map(row => <option key={row.id} value={row.id}>{stamp(row.createdAt)} · {row.sha256.slice(0, 10)}</option>)}
        </select></label>
        <div className="feature-toolbar">
          {context.page > 0 && <button className="button" onClick={() => void run(() => selectProject(context.project, undefined, context.page - 1))}>{tr("更新的版本", "Newer revisions")}</button>}
          {(context.page + 1) * 50 < context.project.versions && <button className="button" onClick={() => void run(() => selectProject(context.project, undefined, context.page + 1))}>{tr("更早的版本", "Older revisions")}</button>}
          <button className="button" onClick={() => void run(() => openRevision(false))}>{tr("预览恢复此版本", "Preview restore")}</button>
          <button className="button" onClick={() => void run(() => openRevision(true))}>{tr("下载此版本 JSON", "Download this revision")}</button>
        </div>
      </>}
      {canWrite && <>
        <div className="feature-toolbar">
          <button className="button" onClick={() => void run(async () => preview(backup, tr("当前工作区", "Current workspace")))}>{tr("预览当前工作区", "Preview current workspace")}</button>
          <label>{tr("迁入本机备份", "Stage a local backup")}<input type="file" accept=".json,application/json" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) void run(async () => {
              if (file.size > MAX_CLOUD_FILE_BYTES) throw new CloudClientError("file-too-large", 413);
              preview(await file.text(), file.name);
            });
          }}/></label>
        </div>
        {stage && <>
          <p className="feature-note">{stage.source} · {stage.rows} {tr("货物行", "cargo rows")} · {sizeText(stage.bytes)}</p>
          <label>{tr("新项目名称", "New project name")}<input value={name} maxLength={120} onChange={event => setName(event.target.value)}/></label>
          <div className="feature-toolbar">
            <button className="button primary" disabled={!name.trim()} onClick={() => void run(() => save(true), tr("已保存新项目。", "Project saved."))}>{tr("保存为新项目", "Save as a new project")}</button>
            {context && <button className="button" onClick={() => void run(() => save(false), tr("已追加新版本。", "Revision appended."))}>{tr("追加到所选项目", "Append to the selected project")}</button>}
            <button className="button ghost" onClick={() => setStage(undefined)}>{tr("取消上传预览", "Discard upload preview")}</button>
          </div>
        </>}
      </>}
    </fieldset>
    {context && <fieldset className="cloud-section" disabled={busy || disabled}>
      <legend>{tr("此版本的私有附件", "Private files for this revision")}</legend>
      <ul>{context.assets.map(asset => <li key={asset.id}>
        <button className="button small" onClick={() => void run(() => getAsset(asset))}>{asset.name}</button> · {tr(...kinds[asset.kind])} · {sizeText(asset.bytes)}
      </li>)}</ul>
      {canWrite && <form className="feature-toolbar" onSubmit={(event: FormEvent) => {
        event.preventDefault(); void run(uploadArchive, tr("已归档私有附件。", "Private file archived."));
      }}>
        <label>{tr("附件类型", "Archive type")}<select value={kind} onChange={event => {
          setKind(event.target.value as ArchiveKind); setAssetFile(undefined); if (archiveInput.current) archiveInput.current.value = "";
        }}>{Object.entries(kinds).map(([id, title]) => <option key={id} value={id}>{tr(...title)}</option>)}</select></label>
        <label>{tr("选择私有附件", "Select a private file")}<input ref={archiveInput} type="file" accept={kind === "photo" ? "image/png,image/jpeg,image/webp" : ".json,application/json"}
          onChange={event => { setAssetFile(event.target.files?.[0]); }} required/></label>
        <button className="button" type="submit" disabled={!assetFile}>{tr("确认上传附件", "Upload selected file")}</button>
      </form>}
    </fieldset>}
    {context && org.role === "owner" && <CloudSharing key={context.current.id} projectId={context.project.id} revisionId={context.current.id} command={command} run={run} disabled={busy || disabled}/>}
    <CloudMembership org={org} access={access} sandbox={sandbox} command={command} run={run} disabled={busy || disabled} refresh={async () => { await refresh(); }} onJoin={onJoin}/>
  </>;
}
