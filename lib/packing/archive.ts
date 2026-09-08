import { parseWorkspaceBackup } from "./workspace-file";
export type ArchiveEntry = { id: string; name: string; version: number; date: string; kind: "project" | "products"; backup: string };
export const ARCHIVE_KEY="cargo-fit-archive-v1";
export function parseArchive(value: string): ArchiveEntry[] {
  const data: unknown=JSON.parse(value);
  if (!Array.isArray(data)||data.length>100) throw new Error("归档目录格式无效。");
  return data.map((item: unknown)=>{
    if(!item||typeof item!=="object") throw new Error("归档条目无效");
    const v=item as Record<string,unknown>;
    if(typeof v.id!=="string"||typeof v.name!=="string"||v.name.length>100||typeof v.date!=="string"||typeof v.version!=="number"||!Number.isInteger(v.version)||v.version<1||(v.kind!=="project"&&v.kind!=="products")||typeof v.backup!=="string") throw new Error("归档条目无效");
    parseWorkspaceBackup(v.backup);
    return {id:v.id,name:v.name,date:v.date,version:v.version,kind:v.kind,backup:v.backup};
  });
}
export function addArchive(entries: ArchiveEntry[], name: string, kind: ArchiveEntry["kind"], backup: string): ArchiveEntry[] {
  if(!name.trim()||name.trim().length>100) throw new Error("请输入 1–100 字的名称。");
  if(entries.length>=100) throw new Error("本机已保存 100 个版本，请先导出备份并整理旧版本。");
  parseWorkspaceBackup(backup);
  const version=Math.max(0,...entries.filter(x=>x.kind===kind&&x.name===name.trim()).map(x=>x.version))+1;
  return [{id:crypto.randomUUID(),name:name.trim(),kind,backup,version,date:new Date().toISOString()},...entries];
}
