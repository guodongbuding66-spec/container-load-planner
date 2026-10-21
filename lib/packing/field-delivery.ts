import {toCsvCell} from "./csv";
import {analyzeFieldJournal,assertFieldContext,unitTicket,unitTicketUrl,type FieldJournal} from "./field-journal";
import type {PackingResult} from "./types";
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

/** A flat event CSV complements the lossless JSON; photos remain in JSON. */
export function fieldEventsCsv(plan:PackingResult,journal:FieldJournal,origins?:ReadonlyMap<string,{handoverId:string;revisionId:string;heads:string[]}>){
 assertFieldContext(plan,journal);
 const rows:unknown[][]=[["planId","revision","revisionId","eventId","time","deviceId","scannedUnitId","action","affectedUnitId","loaded","condition","parentEventIds","note","photoNames"]];
 if(origins)rows[0].push("handoverId","sourceRevisionId","sourceEventHeads");
 for(const e of journal.events)for(const c of e.changes){const row:unknown[]=[journal.context.planId,journal.context.revision,journal.context.revisionId,e.id,e.at,e.deviceId,e.unitId,e.action,c.id,c.state.loaded?1:0,c.state.condition,c.parents.join(" | "),e.note,e.photos.map(p=>p.name).join(" | ")];if(origins){const source=origins.get(e.id);row.push(source?.handoverId??"",source?.revisionId??"",source?.heads.join(" | ")??"");}rows.push(row);}
 return rows.map(row=>row.map(v=>toCsvCell(v as string|number)).join(",")).join("\r\n");
}
export function fieldManifest(plan:PackingResult,journal:FieldJournal,unitId:string){
 assertFieldContext(plan,journal);const atom=journal.context.atoms.find(a=>a.id===unitId);if(!atom)throw new Error("Unknown unit");
 const bindings=new Map(plan.deliveryIdentity!.units.map(u=>[u.unitId,u]));
 const ids=atom.kind==="pallet"?[...atom.children]:[atom.id];const boxes=new Map(plan.placements.map(b=>[b.id,b]));
 return {atom,rows:ids.map(id=>({unitId:id,box:boxes.get(bindings.get(id)!.localId)!})).sort((a,b)=>a.box.layer-b.box.layer||a.box.z-b.box.z||a.box.x-b.box.x||a.box.y-b.box.y),status:analyzeFieldJournal(journal).get(unitId)!};
}
export async function fieldUnitHtml(plan:PackingResult,journal:FieldJournal,unitId:string,origin:string,en=false){
 const t=(zh:string,english:string)=>en?english:zh,{atom,rows}=fieldManifest(plan,journal,unitId),identity=plan.deliveryIdentity!;
 const qr=await import("qrcode");const link=unitTicketUrl(unitTicket(plan,unitId),origin),svg=await qr.toString(link,{type:"svg",errorCorrectionLevel:"M",margin:4,width:256});
 const binding=identity.units.find(u=>u.unitId===unitId)!,pallet=plan.pallets?.find(p=>p.id===binding.localId),box=plan.placements.find(b=>b.id===binding.localId);
 const exterior=pallet?`${pallet.dx} × ${pallet.dy} × ${Math.max(pallet.enclosureHeight??0,pallet.dz+Math.max(0,...rows.map(r=>r.box.z+r.box.dz-pallet.z-pallet.dz)))} mm`:box?`${box.dx} × ${box.dy} × ${box.dz} mm`:"";
 return `<!doctype html><html lang="${en?"en":"zh-CN"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${t("箱托交付标签","Unit delivery label")}</title><style>body{font:15px system-ui;color:#163842;max-width:960px;margin:30px auto;padding:16px}p,td{overflow-wrap:anywhere}svg{width:256px;height:256px;max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bdd0d4;text-align:left;padding:8px}thead{display:table-header-group}tr{break-inside:avoid}@media print{body{margin:0;padding:0}button{display:none}}</style><h1>${t("箱托交付标签与分层清单","Unit delivery label and layer manifest")}</h1><p>${esc(identity.planId)} · v${identity.revision}<br>${esc(identity.revisionId)}</p><h2>${esc(unitId)}</h2>${svg}<p>${esc(exterior)} · ${rows.length} ${t("箱","cartons")} · ${atom.weightKg+ (atom.kind==="pallet"?rows.reduce((n,r)=>n+r.box.weight,0):0)} kg</p><p>${t("二维码只包含编号和版本。扫码后请在网站恢复匹配的工作区备份，再打开现场登记面板。文件可离线查看；此标签不代表已制作、装载或安全核验。","The QR contains IDs and revision only. Restore the matching workspace backup in the app, then open Field registration. This file can be viewed offline; the label does not certify manufacture, loading or safety.")}</p><p>${t("底层支承托盘不自动关联上方货箱；预打托标签包含本托内单一归属的货箱。坐标为当前方案绝对坐标。","Floor support pallets do not automatically confirm cartons above them. Prebuilt pallet labels include their uniquely assigned cartons. Coordinates are absolute plan coordinates.")}</p><button onclick="window.print()">${t("打印","Print")}</button><table><thead><tr><th>${t("层","Layer")}</th><th>SKU / ${t("订单行","Order row")}</th><th>${t("箱号","Carton ID")}</th><th>XYZ mm</th><th>${t("尺寸 mm / 重量 kg","Size mm / weight kg")}</th></tr></thead><tbody>${rows.map(({unitId,box:b})=>`<tr><td>${b.layer}</td><td>${esc(b.sku)}<br>${esc(b.productId)}</td><td>${esc(unitId)}</td><td>${b.x} / ${b.y} / ${b.z}</td><td>${b.dx} × ${b.dy} × ${b.dz}<br>${b.weight}</td></tr>`).join("")}</tbody></table></html>`;
}
