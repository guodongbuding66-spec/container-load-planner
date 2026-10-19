import {looseManifest} from "./loose-cargo";
import {planCrateStackReview,CRATE_STACK_STATE_TEXT} from "./crate-auto-stack";
import {inspectDeckSupports,palletDeckSupportGeometry,deckSupportHeight} from "./deck-support";
import {inspectAccessorySupports,ACCESSORY_SUPPORT_STATES,hasAccessorySupports} from "./accessory-support";
import {inspectLongSupport,SUPPORT_ISSUES} from "./long-support";
import {inspectHandlingSequence,HANDLING_STATE_TEXT,HANDLING_KIND_TEXT} from "./handling-sequence";
import {accessoryInstallationPlan,containerAccessoryWeight,ACCESSORY_TYPE_TEXT} from "./container-accessories";
import {forkEvidenceGroups,forkEvidenceReady,inspectForkInterface,FORK_NUMBERS,FORK_NUMBER_TEXT,FORK_DIRECTION_TEXT} from "./fork-interface";
import {siteExcludedVolume} from "./site-exclusions";
import { packagingSelectionNotes } from "./packaging-choice";
import { crateEvidenceGroups, crateEvidence, CRATE_CORNERS } from "./crate-bearing";
import { planProjection } from "./plan-projection";
import { reviewPlan, REVIEW_STATES, REVIEW_TITLES } from "./plan-review";
import type { PackingResult, ProductInput } from "./types";
type RasterPage = { jpeg: Uint8Array; width: number; height: number };
/** Raster PDF with byte-accurate xref offsets; embeds browser-rendered Unicode text. */
export function buildRasterPdf(pages: RasterPage[]) {
  const encode = (s: string) => new TextEncoder().encode(s); const parts: Uint8Array[] = []; const offsets = [0]; let size = 0;
  const add = (s: string | Uint8Array) => { const bytes = typeof s === "string" ? encode(s) : s; parts.push(bytes); size += bytes.length; };
  const object = (id: number, content: string | Uint8Array[]) => { offsets[id] = size; add(`${id} 0 obj\n`); if (typeof content === "string") add(content); else content.forEach(add); add("\nendobj\n"); };
  add("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n"); object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`);
  pages.forEach((page, i) => { const id = 3 + i * 3; const stream = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, [encode(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`), page.jpeg, encode("\nendstream")]);
    object(id + 2, `<< /Length ${encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });
  const xref = size; add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`); for (let i = 1; i < offsets.length; i++) add(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const output = new Uint8Array(size); let at = 0; parts.forEach(part => { output.set(part, at); at += part.length; }); return output;
}
export async function downloadPdfGuide(result: PackingResult, language: "zh" | "en" = "zh", products?:readonly ProductInput[]) {
  if (!result.validation.valid) throw new Error("方案未通过校验，不能导出指导书。");
  if(result.dimensionScenario?.proxyProductIds.length)throw new Error("Irregular tolerance proxy is not a field instruction / 异型公差包络不能作为现场指导书");
  await document.fonts.ready;
  const en = language === "en", t = (zh: string, english: string) => en ? english : zh; const width = 1800, height = 2546; const pages: RasterPage[] = [];
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器无法生成 PDF。");
  const text = (value: string, x: number, y: number, size = 30, bold = false, color = "#234653") => { ctx.font = `${bold ? 700 : 400} ${size}px 'Noto Sans SC','Microsoft YaHei',Arial,sans-serif`; ctx.fillStyle = color; ctx.fillText(value, x, y); };
  const ellipsis = (value: string, max: number) => { if(ctx.measureText(value).width<=max)return value;let s=value;while(s.length&&ctx.measureText(s+"…").width>max)s=s.slice(0,-1);return s+"…"; };
  const start = (title: string) => { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); text("CARGOFIT · LOADING GUIDE", 100, 95, 26, true, "#2c8390"); text(title, 100, 164, 46, true); text(ellipsis(`${result.dimensionScenario?`${result.dimensionScenario.kind==="nominal"?t("标称方案","Nominal plan"):t("保守方案","Conservative plan")} ${result.dimensionScenario.id} · `:""}${result.container.name} · ${result.engineVersion} · ${new Date(result.createdAt).toLocaleDateString()}`,1600), 100, 216, 25); ctx.strokeStyle = "#d9e7ea"; ctx.beginPath(); ctx.moveTo(100, 247); ctx.lineTo(1700, 247); ctx.stroke(); };
  const finish = async () => { text(`${t("页", "Page")} ${pages.length + 1} · X/Y/Z: mm · kg`, 100, height - 60, 24); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PDF 图像生成失败。")), "image/jpeg", 0.95)); pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width, height }); };
  start(t("装柜方案与执行概览", "Load plan and execution overview"));
  const m = result.metrics; const remaining = Math.max(0, m.effectiveVolume - m.loadedVolume) / 1e9;
  [[t("装入数量", "Loaded items"), String(m.loadedCount)], [t("体积利用率", "Volume utilization"), `${(m.volumeUtilization * 100).toFixed(1)}%`], [t("剩余容积", "Remaining volume"), `${remaining.toFixed(2)} m³`], [t("已装重量", "Loaded weight"), `${m.grossWeight.toLocaleString()} kg`]].forEach(([label, value], i) => { const x = 100 + i * 410; ctx.fillStyle = "#f0f7f8"; ctx.fillRect(x, 295, 380, 165); text(label, x + 24, 343, 26); text(value, x + 24, 410, 40, true); });
  const projections = [ ["top", t("俯视图", "Top view")], ["side", t("侧视图", "Side view")], ["door", t("箱门图", "Door view")] ] as const;
  projections.forEach(([view, label], i) => { const y = 535 + i * 520; text(label, 100, y, 32, true); const l = result.container.length - result.clearance * 2, w = result.container.width - result.clearance * 2, h = result.container.height - result.clearance; const extentX = view === "door" ? w : l, extentY = view === "top" ? w : h; const scale = Math.min(1580 / extentX, 405 / extentY); const x0 = 100, y0 = y + 35; ctx.strokeStyle = "#6a919b"; ctx.strokeRect(x0, y0, extentX * scale, extentY * scale);
    for(const {box,polygons} of planProjection(result,view).shapes){
      ctx.beginPath();
      for(const poly of polygons){poly.forEach(([px,py],index)=>{const x=x0+px*scale,y=y0+(view==="top"?py:extentY-py)*scale;if(index)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();}
      ctx.fillStyle=box.color;ctx.fill("nonzero");
    }
  });
  text(result.workflow==="pallet-only"?t("仅打托，不装柜；XYZ 是三维查看坐标。","Pallets only; XYZ coordinates are for inspection, not vehicle loading."):result.palletization?t("按完整托盘入柜；指定散箱按其独立柜内坐标装入。","Load complete units; reserved loose cargo follows its own vehicle coordinates."):t("先装柜内，再向柜门推进；下层支撑先于上层箱。", "Load the nose first, then advance toward the door. Load supports before upper cargo."), 100, 2210, 26);
  text(t("尺寸、门洞、包装承重与现场操作请按当前输入核对。", "Confirm dimensions, door clearance, packaging strength and handling against entered rules."), 100, 2260, 26);
  packagingSelectionNotes(result,en).forEach((note,i)=>text(note,100,2310+i*40,22));
  await finish();
  start(t("方案复核", "Plan review"));
  const review=reviewPlan(result,products);
  text(`${review.passed} ${t("项通过","passed")} · ${review.failed} ${t("项不通过","failed")} · ${review.unverified} ${t("项未核验","unverified")}`,100,315,32,true);
  review.checks.forEach((c,i)=>{const y=420+i*345;text(`${t(...REVIEW_TITLES[c.id])} · ${t(...REVIEW_STATES[c.state])}`,100,y,32,true);let line="";const lines:string[]=[];ctx.font="25px Arial,sans-serif";for(const char of t(...c.scope)){if(ctx.measureText(line+char).width>1500){lines.push(line);line="";}line+=char;}lines.push(line);lines.slice(0,5).forEach((value,row)=>text(row===4?ellipsis(lines.slice(4).join(""),1500):value,100,y+55+row*40,25));if(c.items.length)text(ellipsis(c.items.slice(0,3).join(" · "),1500),100,y+245,24);});
  text(t("本页长文本可能省略；完整核验范围见客户报告或工作区。","Long scope text may be shortened here; full review scope is in the customer report or workspace."),100,2260,23);
  await finish();
  const longSupport=inspectLongSupport(result,products);
  for(let from=0;from<longSupport.length;from+=5){
    start(t("长条箱承托预检（独立几何）","Long-carton support preflight (independent geometry)"));
    text(t("尺寸 mm；完整适用资料参与求解和箱位校验；材料强度未核验。完整资料见工作区或客户报告。","Sizes in mm; complete applicable data constrains packing and placement acceptance. Material strength is unverified. Full data: workspace or customer report."),100,305,24);
    longSupport.slice(from,from+5).forEach((r,i)=>{const y=410+i*375;
      text(ellipsis(`${r.sku} / ${r.id}`,1500),100,y,28,true);
      text(r.state==="pass"?t("符合输入几何限制","Meets entered geometric limits"):r.state==="fail"?t("不符合输入几何限制","Exceeds entered geometric limits"):t("未核验","Unverified"),100,y+45,26,true);
      text(`${t("每带接触 %","Band contact %")}: ${r.bandRatios.map(n=>(Math.min(1,n)*100).toFixed(1)).join(" / ")||"—"}`,100,y+95,24);
      text(`${t("悬跨 / 上限","Span / limit")}: ${r.spanMm?.toFixed(1)??"—"} / ${r.profile?.maxSpanMm??"—"}; ${t("首尾悬挑 / 每端上限","End overhangs / each-end limit")}: ${r.overhangMm?.map(n=>n.toFixed(1)).join(" / ")??"—"} / ${r.profile?.maxOverhangMm??"—"}`,100,y+140,24);
      text(ellipsis(`${t("来源 / 版本","Source / revision")}: ${r.profile?.source||"—"} / ${r.profile?.revision||"—"}`,1500),100,y+185,24);
      text(ellipsis(r.issues.map(i=>SUPPORT_ISSUES[i][en?1:0]).join("; "),1500),100,y+230,24);
      text(ellipsis(`${t("接触来源","Contact sources")}: ${r.supporterIds.join(" / ")||"—"}`,1500),100,y+275,23);
    });await finish();
  }
  for (let startAt = 0; startAt < result.summaries.length; startAt += 28) { start(t("货物清单", "Cargo manifest")); const columns = [100, 630, 990, 1260]; ["SKU", t("需求 / 已装", "Requested / loaded"), t("重量 kg", "Weight kg"), t("体积 m³", "Volume m³")].forEach((v, i) => text(v, columns[i], 310, 27, true)); result.summaries.slice(startAt, startAt + 28).forEach((s, i) => { const y = 375 + i * 64; text(ellipsis(s.sku, 495), columns[0], y, 26); text(`${s.requested} / ${s.loaded}`, columns[1], y, 26); text(s.loadedWeight.toFixed(1), columns[2], y, 26); text((s.loadedVolume / 1e9).toFixed(3), columns[3], y, 26); }); await finish(); }
  const looseRows=looseManifest(result);
  for(let from=0;from<looseRows.length;from+=25){
    start(t("整托与散箱混装清单","Complete units and loose cargo manifest"));
    text(t("指定预留；不自动拆托，散箱不占用整托内部，不与整托互相承托。","Explicit reservations; no automatic dismantling, use of unit voids or cross-support."),100,305,24);
    ["SKU",t("预留散装","Reserved loose"),t("已散装","Loaded loose"),t("已打托入柜","On units"),t("未装","Unloaded"),t("散箱 kg","Loose kg")].forEach((v,i)=>text(v,[100,540,790,1040,1260,1460][i],380,26,true));
    looseRows.slice(from,from+25).forEach((r,i)=>{const y=460+i*70;text(ellipsis(r.sku,410),100,y,25);[r.reserved,r.loose,r.palletized,r.unloaded,r.weightKg.toFixed(1)].forEach((v,j)=>text(String(v),[540,790,1040,1260,1460][j],y,25));});await finish();
  }
  for(let startAt=0;startAt<(result.pallets?.length??0);startAt+=28){start(result.workflow==="pallet-only"?t("独立托盘清单与自重","Independent pallet manifest and tare"):result.palletization?t("整托入柜与自重","Complete pallet placement and tare"):t("底层托盘铺设与自重","Floor pallet layout and tare"));text(result.workflow==="pallet-only"?t("按关联清单独立打托，货物限高不含底座，总重含托盘自重。","Build each listed pallet independently. Cargo height excludes decks; gross weight includes tare."):result.palletization?t("按托盘关联清单在柜外打托，再整托入柜；货物 Z 已包含底座。","Build associated cargo on each pallet outside, then load complete pallets; Z includes decks."):t("先铺设托盘；货物 Z 已包含底座高度，勿再次加高。","Place pallets first. Cargo Z already includes the base height."),100,310,27,true);result.pallets!.slice(startAt,startAt+28).forEach((p,i)=>{const y=390+i*64;text(`${p.id} · ${p.name}`,100,y,25);text(`${p.x} / ${p.y} / ${p.z}`,700,y,25);text(`${p.dx} × ${p.dy} × ${Math.max(p.enclosureHeight??p.dz,p.dz+deckSupportHeight(p))}`,1100,y,25);text(`${p.weight} kg`,1530,y,25);});await finish();}
  if(result.container.exclusions?.length){
    start(t("柜内障碍与禁占区","Obstacles and keep-clear regions"));
    text(hasAccessorySupports(result.container)?t("绿色实心支承件以实际顶面承托；其他区域不承托；附件重量单列。","Green solid supports contact at the real top; other regions do not support. Accessory mass is separate."):t("坐标 mm 从实际柜内柜头、左壁、地板起算；区域不承托、不计货物；附件计划重量单列。","Physical inner nose/left/floor coordinates in mm; regions provide no support or cargo; accessory planned mass is separate."),100,310,25);
    text(`${t("有效区域占用","Excluded usable volume")}: ${(siteExcludedVolume(result.container,result.clearance)/1e9).toFixed(4)} m³`,100,365,27,true);
    result.container.exclusions.forEach((z,i)=>{const y=450+i*100;text(ellipsis(`${z.id} · ${z.name}`,520),100,y,25,true);text(`${z.x} / ${z.y} / ${z.z}`,660,y,25);text(`${z.dx} × ${z.dy} × ${z.dz}`,1100,y,25);text(z.accessory?.support?t("支承","Support"):z.kind==="obstacle"?t("障碍","Obstacle"):t("预留","Reservation"),1500,y,24);});
    text(t("重叠容积只扣一次。设备、门槛通过与运输固定强度未核验。","Overlap is deducted once. Equipment, threshold traversal and securing strength remain unverified."),100,2260,25);
    await finish();
  }
  const accessoryRows=accessoryInstallationPlan(result);
  for(let from=0;from<accessoryRows.length;from+=6){
    start(t("整柜附件与安装依赖（计划）","Container accessories and installation dependencies (planned)"));
    text(`${t("全部附件计划重量","All accessory planned mass")}: ${containerAccessoryWeight(result.container)} kg`,100,310,28,true);
    text(ellipsis(t("包络涵盖整行数量；预留无重量。固定强度、安装可达、拆除和实称未核验。","Row envelopes; massless reservations. Strength, reach, removal and weighing unverified."),1500),100,365,23);
    accessoryRows.slice(from,from+6).forEach(({region:z,index,afterCargoStep,missingProductIds,weightKg},i)=>{const a=z.accessory,y=460+i*285;
      text(ellipsis(`${index}. ${z.id} · ${z.name}`,1500),100,y,27,true);
      text(ellipsis(`${t(...ACCESSORY_TYPE_TEXT[a.type])} · ${z.kind} · ${a.quantity} × ${a.unitWeightKg} kg = ${weightKg} kg · ${a.phase} / ${afterCargoStep}`,1500),100,y+48,24);
      text(`${z.x} / ${z.y} / ${z.z} mm · ${z.dx} × ${z.dy} × ${z.dz} mm`,100,y+88,24);
      text(ellipsis(`${t("货物 / 前置附件","Cargo / prior accessories")}: ${a.relatedProductIds.join(" / ")||"—"} / ${a.afterAccessoryIds.join(" / ")||"—"}`,1500),100,y+128,23);
      text(ellipsis(`${a.source||"—"} / ${a.revision||"—"} · ${a.note}`,1500),100,y+168,23);
      if(missingProductIds.length)text(ellipsis(`${t("关联货物未全部装入","Associated cargo not fully loaded")}: ${missingProductIds.join(" / ")}`,1500),100,y+208,23);
    });
    text(t("完整长文本与资料见工作区或附件 CSV；安装步骤不证明实际施工可行。","Full text is preserved in workspace / accessory CSV; ordering does not prove field feasibility."),100,2260,24);await finish();
  }
  const supportRows=inspectAccessorySupports(result,products);
  for(let from=0;from<supportRows.length;from+=8){
    start(t("固定支承件静载检查","Fixed support static load check"));
    text(t("上方累计包含全部货物层；按实际接触面积分配。上限不含支承件自重。","All upper cargo tiers included; load shared by contact area. Limit excludes support tare."),100,310,24);
    supportRows.slice(from,from+8).forEach((r,i)=>{const y=440+i*205;
      text(ellipsis(`${r.id} · ${r.name}`,1500),100,y,27,true);
      text(`${t("上方累计 / 输入上限 kg","Cumulative upper / entered limit kg")}: ${(r.loadKg?.toFixed(2)??"—")} / ${r.limitKg??"—"} · ${t(...ACCESSORY_SUPPORT_STATES[r.state])}`,100,y+50,24);
      text(ellipsis(`${t("来源 / 版本","Source / revision")}: ${r.source||"—"} / ${r.revision||"—"}`,1500),100,y+100,24);
    });
    text(t("缺额定值或来源版本保持未核验；不证明抗弯、刚度、地板局压或动态强度。","Missing ratings or evidence remain unverified; bending, stiffness, local floor pressure and dynamics are unverified."),100,2260,23);
    await finish();
  }
  const deckRows=inspectDeckSupports(result,products),deckGeometry=new Map(palletDeckSupportGeometry(result.pallets??[]).boxes.map(b=>[b.id,b]));
  for(let from=0;from<deckRows.length;from+=7){
    start(t("托内支承件与累计静载","Deck supports and cumulative static load"));
    text(t("新增支承自重已计入包装总重及底座载荷，厚度占用托内净高。","Added support tare is included in packaging mass and deck payload; thickness consumes cargo height."),100,310,24);
    deckRows.slice(from,from+7).forEach((r,i)=>{const y=430+i*250,b=deckGeometry.get(r.id)!;ctx.font="700 27px Arial,sans-serif";
      text(ellipsis(`${r.palletId} / ${r.name}`,1500),100,y,27,true);
      text(`${t("新增自重 / 上方累计 / 上限 kg","Added tare / upper load / limit kg")}: ${r.weightKg} / ${r.loadKg?.toFixed(2)??"—"} / ${r.limitKg??"—"} · ${t(...ACCESSORY_SUPPORT_STATES[r.state])}`,100,y+45,24);
      text(`XYZ ${b.x}/${b.y}/${b.z} · ${b.dx} × ${b.dy} × ${b.dz} mm`,100,y+90,24);
      text(ellipsis(`${r.source||"—"} / ${r.revision||"—"}`,1500),100,y+135,24);
    });
    text(t("仅按输入资料检查静载；抗弯、刚度、固定及运输动态强度未核验。","Entered static ratings only; bending, stiffness, securing and transport dynamics remain unverified."),100,2260,24);await finish();
  }
  for(const group of forkEvidenceGroups(result)){
    start(t("底座与叉具资料（独立预检）","Base and fork data (independent preflight)"));
    const c=group.config,p=c.forkInterface,m=c.packaging?.measurements,check=inspectForkInterface(c);
    text(ellipsis(c.name,1300),100,310,30,true);
    text(`${t("资料状态","Evidence state")}: ${forkEvidenceReady(c)?t("当前版本已核对","Current revision reviewed"):t("未核验","Unverified")} · ${t("局部几何","Local geometry")}: ${check.state}`,100,370,25,true);
    text(ellipsis(`${t("托盘","Units")}: ${group.ids.join(" / ")}`,1500),100,430,24);
    text(ellipsis(`${t("底座来源／版本","Base source / revision")}: ${m?.source||"—"} / ${m?.revision||"—"}`,1500),100,490,24);
    text(m?`${t("厚度／单板宽／支承长宽 mm（仅适用项）","Thicknesses / board width / support L/W mm (applicable fields)")}: ${[m.deckThickness,m.bottomThickness,m.bearerThickness,m.deckBoardWidth,m.supportLength,m.supportWidth].join(" / ")}`:t("通用比例结构，未记录底座实测。","Generic proportional structure; base measurements are missing."),100,550,24);
    if(p){
      text(t(...FORK_DIRECTION_TEXT[p.direction]),100,625,26,true);
      FORK_NUMBERS.forEach((k,i)=>{text(t(...FORK_NUMBER_TEXT[k]),100,700+i*65,25);text(`${p[k]} mm`,1200,700+i*65,25);});
      text(ellipsis(`${t("叉具来源／版本","Fork source / revision")}: ${p.source||"—"} / ${p.revision||"—"}`,1500),100,1400,24);
      text(`${t("静载／动载／货架载荷 kg（0 为未知）","Static / dynamic / rack payload kg (0 means unknown)")}: ${p.ratings.staticKg} / ${p.ratings.dynamicKg} / ${p.ratings.rackKg}`,100,1470,24);
      text(ellipsis(p.ratings.source||"—",1500),100,1540,24);
    }
    text(t("本页仅列局部几何与输入资料；逐托周边阻挡详见独立预检 JSON。","Local geometry and input data only; see unit preflight JSON for surrounding blockers."),100,1790,25);
    text(t("不核验设备能力、叉车本体、起升、转弯、作业顺序或动态受力。","Equipment capacity, truck body, lifting, turning, handling order and dynamic forces are unverified."),100,1855,25);
    text(t("三类载荷没有复制为求解上限，几何通过不构成作业放行。","Separate ratings do not replace the packing limit; a geometric pass does not authorize handling."),100,1920,25);
    await finish();
  }
  for(const task of result.handlingTasks??[]){
    const check=inspectHandlingSequence(result,task);
    for(let from=0;from<Math.max(1,check.steps.length);from+=7){start(t("连贯搬运独立预检","Independent connected handling preflight"));
    text(ellipsis(`${task.unitId} / ${task.revision} · ${t(...HANDLING_STATE_TEXT[check.state])}`,1500),100,310,28,true);
    text(ellipsis(`${t("设备来源／版本","Equipment source / revision")}: ${task.equipment.source} / ${task.equipment.revision}`,1500),100,375,24);
    text(ellipsis(`${t("现场来源／版本","Site source / revision")}: ${task.site.source} / ${task.site.revision}`,1500),100,425,24);
    check.steps.slice(from,from+7).forEach((row,i)=>{const step=task.steps[from+i],y=540+i*190;text(ellipsis(`${row.id} · ${t(...HANDLING_KIND_TEXT[row.kind])} · ${t(...HANDLING_STATE_TEXT[row.state])}`,1500),100,y,26,true);text(`X/Y/lift mm: ${step.from.x}/${step.from.y}/${step.from.lift} → ${step.to.x}/${step.to.y}/${step.to.lift}`,100,y+50,24);text(ellipsis([...row.issues,...(row.geometry?.issues.map(v=>`${v.component}: ${v.code} ${v.ids.join(" / ")}`)??[])].join("; ")||"—",1500),100,y+95,23);});
    text(ellipsis(`${t("任务提示","Task issues")}: ${check.issues.join(" / ")||"—"}`,1500),100,1980,24);
    text(t("转弯未执行；设备能力、动态受力、轮压与现场作业仍未核验。","Turning not executed; capacity, dynamics, wheel pressure and field handling remain unverified."),100,2070,24);
    text(t("本页为独立任务摘要，不改变五项复核，也不构成现场放行。","This independent task summary does not change the five reviews or authorize field handling."),100,2135,24);
    text(t("完整来源、动作及连续扫掠见工作区备份与独立任务 JSON。","See workspace backup and independent task JSON for full sources, steps and continuous sweeps."),100,2200,24);await finish();}

  }
  for(const group of crateEvidenceGroups(result)){
    start(t("木箱额定资料与实际静载","Crate rating evidence and actual static review"));
    const p=group.config.crateBearing,e=crateEvidence(group.config);
    text(ellipsis(group.config.name,1500),100,320,32,true);
    text(ellipsis(group.ids.join(" · "),1500),100,375,24);
    text(ellipsis(`${t("资料状态","Evidence state")}: ${e.state} · ${t("版本","Revision")}: ${p?.revision??"—"}`,1500),100,435,27,true);
    const wrap=(value:string,y:number,maxLines:number)=>{let line="",lines=0;for(const ch of value){if(ctx.measureText(line+ch).width>1500){text(line,100,y+lines++*40,25);line="";if(lines>=maxLines-1){line="…";break;}}line+=ch;}text(ellipsis(line,1500),100,y+lines*40,25);};
    wrap(`${t("来源","Source")}: ${p?.source??"—"}`,510,4);
    wrap(`${t("适用条件","Conditions")}: ${p?.conditions??"—"}`,730,7);
    text(`${t("有效期","Expiry")}: ${p?.validUntil||"—"}`,100,1100,26);
    text(`${t("额定顶载 kg／总层数","Rated top kg / total layers")}: ${p?.maxTopLoadKg??"—"} / ${p?.maxLayers??"—"}`,100,1170,28,true);
    text(`${t("允许朝向","Rated orientations")}: ${p?.allowedOrientations.join(" / ")||"—"}`,100,1240,26);
    CRATE_CORNERS.forEach((id,i)=>text(`${id} → ${t("同位置立柱与底脚","coaxial post and foot")}: ${p?.columnCapacityKg[id]??"—"} kg`,100,1350+i*65,27));
    wrap(t("该页为资料摘要，完整来源与条件见工作区／坐标 JSON。仅显式启用且资料有效的四角传力列可叠放，其他木箱仍底置；不核验运输动态、地板、材料与连接件强度。","This is an evidence summary; see workspace / coordinate JSON for full sources and conditions. Only explicitly enabled crates with valid four-path evidence may stack; all others remain floor-only. Transport dynamics, floors, material and joints are unverified."),1740,6);
    await finish();
  }
  const crateStatic=planCrateStackReview(result).cells;
  for(let from=0;from<crateStatic.length;from+=8){
    start(t("木箱实际叠放静载复核","Actual crate stack static review"));
    text(t("累计上压与每条路径上界分开；不把路径上界相加计重。","Cumulative top load and each-path bounds are separate; bounds are not summed as mass."),100,320,25);
    crateStatic.slice(from,from+8).forEach((c,i)=>{const y=430+i*180;text(ellipsis(`${c.id} · ${t(...CRATE_STACK_STATE_TEXT[c.state])}`,1500),100,y,27,true);text(ellipsis(`${t("支承木箱／层","Supporting crate / tier")}: ${c.supporterId??t("柜底","Floor")} / ${c.level}`,1500),100,y+50,25);text(`${t("累计上压／每路径总载荷上界 kg","Top / EACH-path through-load kg")}: ${c.topLoadKg.toFixed(2)} / ${c.throughLoadBoundKg.toFixed(2)}`,100,y+95,25);});
    text(t("材料、连接件、局部地板压力及运输动态强度未核验。","Material, joints, local floor pressure and transport dynamics are unverified."),100,2070,25);await finish();
  }
  for (let startAt = 0; startAt < result.placements.length; startAt += 32) { start(t("逐箱装载顺序与坐标", "Loading sequence and coordinates")); text("#     SKU                         X / Y / Z                        L × W × H                  ↑    Layer", 100, 310, 25, true); result.placements.slice(startAt, startAt + 32).forEach((b, i) => { const y = 375 + i * 58; text(String(startAt + i + 1), 100, y, 24); text(ellipsis(b.sku, 380), 200, y, 24); if(result.palletization)text(ellipsis(b.palletIds?.join(" / ")??t("散箱","Loose cargo"),380),200,y+22,19); text(`${b.x.toFixed(0)} / ${b.y.toFixed(0)} / ${b.z.toFixed(0)}`, 600, y, 24); text(`${b.dx} × ${b.dy} × ${b.dz}`, 1100, y, 24); text(`${b.orientation}  ${b.layer}`, 1520, y, 24); }); await finish(); }
  if(result.delivery){const rows=Object.entries(result.delivery),pathReview=review.checks.find(c=>c.id==="path")!;for(let startAt=0;startAt<rows.length;startAt+=24){start(t("装卸站次与路径复核","Delivery stops and access review"));text(t("路径模型和未核验范围见方案复核页。","See the plan review page for the access model and unverified scope."),100,305,24);text(`${t("路径复核状态","Access review status")}: ${t(...REVIEW_STATES[pathReview.state])} · ${pathReview.items.length} ${t("项提示","issues")}`,100,350,28,true);rows.slice(startAt,startAt+24).forEach(([id,d],i)=>{const y=430+i*70;text(ellipsis(result.summaries.find(s=>s.productId===id)?.sku??id,350),100,y,25);text(String(d.stop),490,y,25);text(ellipsis(d.customer,480),650,y,25);text(ellipsis(d.destination,480),1180,y,25);});await finish();}}
  if (result.warnings.length) { start(t("装载规则与复核提示", "Rules and review notes")); let y = 320; ctx.font = "28px 'Noto Sans SC','Microsoft YaHei',Arial,sans-serif"; for (const warning of result.warnings) { const chars = [...warning]; let line = ""; for (const char of chars) { if (ctx.measureText(line + char).width > 1520) { text(line, 120, y, 28); y += 45; line = ""; } if (y > 2350) { await finish(); start(t("复核提示（续）", "Review notes (continued)")); y = 320; } line += char; } text(`• ${line}`, 100, y, 28); y += 80; } await finish(); }
  const bytes = buildRasterPdf(pages); const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })); const a = document.createElement("a"); a.href = url; a.download = `CargoFit_${result.container.id}_guide.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
