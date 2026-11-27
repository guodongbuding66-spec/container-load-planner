import {palletLoadEnvelope} from "./unit-envelope";
import {deliveryIdentityState,deliveryUnitBindings} from "./delivery-identity";
import {parseOrderLine,assertOrderLineIds} from "./order-lines";
import {planCrateStackReview} from "./crate-auto-stack";
import {inspectDeckSupports,palletQuarterTurns,deckSupportHeight,palletDeckSupportGeometry} from "./deck-support";
import {inspectAccessorySupports,ACCESSORY_SUPPORT_STATES} from "./accessory-support";
import {inspectHandlingSequence} from "./handling-sequence";
import {parseLongSupport} from "./long-support";
import {accessoryInstallationPlan,ACCESSORY_TYPE_TEXT} from "./container-accessories";
import {forkEvidenceGroups} from "./fork-interface";
import { planCrateUnits, crateEvidence } from "./crate-bearing";
import { parseDimensionAllowance } from "./dimension-allowance";
import { parseShapeFields, withShapeSupport } from "./cargo-shape";
import { CARGO_TYPES, parseOrientations } from "./loading-rules";
import type { PackingResult, ProductInput, RotationPolicy, PlacedPallet } from "./types";
import { isLengthUnit, isWeightUnit, toKilograms, toMillimeters } from "./units";
import { roundedCartonVolumeCbm } from "./volume";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;
export const PLACEMENT_CSV_HEADER = "序号,SKU,品名,套装编码,套号,套内序号,X(mm),Y(mm),Z(mm),长(mm),宽(mm),高(mm),方向,层级,重量(kg),记录类型,托盘关联,客户,目的地,卸货站次,货物外形,圆筒轴向,顶边或顶径比例,竖壁厚度比例,横壁厚度比例,高台长度比例,低台高度比例,旋转轴符号,实体模型JSON,保护间隙(mm),装载方式,坐标用途";

const REQUIRED_PRODUCT_COLUMNS = ["sku", "name", "length", "width", "height", "weight", "quantity"];
const VALID_COLOR = /^#[0-9a-f]{6}$/i;
const FORMULA_PREFIX = /^[\t\r\n\v\f ]*[=+\-@]/;

function decodeOrderId(value:string){const s=value.trim();if(s.startsWith('"')){try{const v=JSON.parse(s);if(typeof v==="string")return v;}catch{}}return s;}
function sanitizeText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

export function toCsvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  const protectedValue = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

function placementWithDeckCsv(result:PackingResult):string{
 const text=placementCsvCore(result),pallets=result.pallets??[];
 if(!pallets.some(p=>p.quarterTurns!==undefined||p.packaging?.deckSupports?.length))return text;
 const byId=new Map(pallets.map(p=>[p.id,p]));
 return parseCsvRecords(text).map((row,i)=>{if(!i)return [...row,"托盘水平转数","托内支承件JSON"].map(toCsvCell).join(",");const p=byId.get(row[15]==="pallet"?row[1]:row[16]);return [...row,p?palletQuarterTurns(p):"",p&&row[15]==="pallet"?JSON.stringify(p.packaging?.deckSupports??[]):""].map(toCsvCell).join(",");}).join("\r\n");
}
function placementWithOrderCsv(result:PackingResult):string{
 if(!Object.values(result.cargoDetails??{}).some(p=>p.orderLine)&&new Set((result.summaries??[]).map(s=>s.sku)).size===(result.summaries??[]).length)return placementWithDeckCsv(result);
 return parseCsvRecords(placementWithDeckCsv(result)).map((row,i)=>{if(!i)return [...row,"订单行ID","订单编号","业务行号","批次"].map(toCsvCell).join(",");const b=row[15]==="cargo"?result.placements[Number(row[0])-1]:undefined,line=b?result.cargoDetails?.[b.productId]?.orderLine:undefined;return [...row,b?.productId??"",line?.orderReference??"",line?.lineReference??"",line?.batch??""].map(toCsvCell).join(",");}).join("\r\n");
}
export function buildPlacementCsv(result:PackingResult):string{
 const text=placementWithOrderCsv(result),identity=result.deliveryIdentity;if(!identity)return text;
 const units=new Map(deliveryUnitBindings(result).map(u=>[`${u.kind}/${u.localId}`,u.unitId??""])),state=deliveryIdentityState(result);
 return parseCsvRecords(text).map((row,i)=>{if(!i)return [...row,"交付计划ID","交付版本","版本状态","实物登记ID","交付版本ID"].map(toCsvCell).join(",");const kind=row[15],local=kind==="cargo"?result.placements[Number(row[0])-1]?.id:kind==="pallet"?row[1]:undefined;return [...row,identity.planId,identity.revision,state,local?units.get(`${kind==="cargo"?"carton":"pallet"}/${local}`)??"":"",identity.revisionId].map(toCsvCell).join(",");}).join("\r\n");
}
export function buildDeckSupportCsv(plan:PackingResult,products?:readonly ProductInput[],en=false){
 const t=(zh:string,eng:string)=>en?eng:zh,geometry=new Map(palletDeckSupportGeometry(plan.pallets??[]).boxes.map(b=>[b.id,b]));
 const header=["Plan ID","Engine","Pallet ID","Support ID",t("名称","Name"),"X(mm)","Y(mm)","Z(mm)","L(mm)","W(mm)","H(mm)",t("新增自重kg","Added tare kg"),t("上方累计kg","Cumulative upper kg"),t("静载上限kg","Static limit kg"),t("状态","State"),t("来源","Source"),t("版本","Revision"),t("范围","Scope")];
 const rows=inspectDeckSupports(plan,products).map(r=>{const b=geometry.get(r.id)!;return [plan.id,plan.engineVersion,r.palletId,r.id,r.name,b.x,b.y,b.z,b.dx,b.dy,b.dz,r.weightKg,r.loadKg??"",r.limitKg??"",r.state,r.source,r.revision,t("自重已包含在整托包装自重内；静载按接触面积传递，强度未核验","Tare included in complete packaging mass; static load shared by contact area, strength unverified")];});
 return [header,...rows].map(row=>row.map(toCsvCell).join(",")).join("\r\n");
}

function placementCsvCore(result: PackingResult): string {
  if(Object.values(result.cargoDetails??{}).some(p=>p.longSupport)){
    const base={...result,cargoDetails:Object.fromEntries(Object.entries(result.cargoDetails??{}).map(([id,p])=>[id,{...p,longSupport:undefined}]))};
    return parseCsvRecords(placementCsvCore(base)).map((row,i)=>[...row,!i?"长条箱承托资料JSON":row[15]==="cargo"?JSON.stringify(result.cargoDetails?.[result.placements[Number(row[0])-1]?.productId]?.longSupport??null):""].map(toCsvCell).join(",")).join("\r\n");
  }
  if(result.dimensionScenario){const base={...result};delete base.dimensionScenario;return parseCsvRecords(placementCsvCore(base)).map((row,i)=>[...row,...(i===0?["尺寸方案ID","尺寸口径"]:[result.dimensionScenario!.id,result.dimensionScenario!.kind])].map(toCsvCell).join(",")).join("\r\n");}
  if(result.handlingTasks?.length){const base={...result,handlingTasks:undefined};return parseCsvRecords(placementCsvCore(base)).map((row,i)=>[...row,...(!i?["设备连贯任务JSON","设备连贯预检JSON"]:[i===1?JSON.stringify(result.handlingTasks):"",i===1?JSON.stringify(result.handlingTasks!.map(task=>({unitId:task.unitId,revision:task.revision,check:inspectHandlingSequence(result,task)}))):""])].map(toCsvCell).join(",")).join("\r\n");}

  const forkGroups=forkEvidenceGroups(result);
  if(forkGroups.some(g=>g.config.forkInterface)){
    const strip=(c:NonNullable<PackingResult["floorPallets"]>)=>{const copy={...c};delete copy.forkInterface;return copy;},value=result.palletization;
    const base={...result,...(result.floorPallets?{floorPallets:strip(result.floorPallets)}:{}),...(value?{palletization:{...value,config:strip(value.config),specifications:value.specifications?.map(s=>({...s,config:strip(s.config)}))}}:{})};
    const byId=new Map(forkGroups.flatMap(g=>g.ids.map(id=>[id,g.config.forkInterface] as const)));
    return parseCsvRecords(placementCsvCore(base)).map((row,i)=>[...row,...(!i?["叉具接口JSON","叉具预检范围"]:[byId.has(row[15]==="pallet"?row[1]:row[16])?JSON.stringify(byId.get(row[15]==="pallet"?row[1]:row[16])):"",row[15]==="site-exclusion"?"":"independent-rectangular-fork-preflight; equipment-unverified"])].map(toCsvCell).join(",")).join("\r\n");
  }
  if(result.container.exclusions?.length){
    const base={...result,container:{...result.container,exclusions:undefined}},rows=parseCsvRecords(placementCsvCore(base)),header=[...rows[0],"柜内区域类型","柜内区域JSON"];
    const records=result.container.exclusions.map(z=>{const row:Array<string|number>=Array(header.length).fill("");row[0]=0;row[1]=`site-exclusion/${z.id}`;row[2]=z.name;[z.x,z.y,z.z,z.dx,z.dy,z.dz].forEach((n,i)=>row[6+i]=n);row[14]=z.accessory&&z.kind==="obstacle"?z.accessory.quantity*(z.accessory.unitWeightKg??NaN):0;row[15]="site-exclusion";row[30]=result.workflow??"direct";row[31]="physical-inner";row[header.length-2]=z.kind;row[header.length-1]=JSON.stringify(z);return row;});
    return [header,...rows.slice(1).map(row=>[...row,"",""]),...records].map(row=>row.map(toCsvCell).join(",")).join("\r\n");
  }
  if(result.palletization?.selection==="compact"){
    const value=result.palletization,base={...result,palletization:{...value,selection:undefined,selectionChoices:undefined}},choices=new Map(value.selectionChoices?.map(c=>[c.palletId,c]));
    return parseCsvRecords(placementCsvCore(base)).map((row,i)=>[...row,...(!i?["包装比选模式","生成时比选记录JSON"]:["compact",choices.has(row[15]==="pallet"?row[1]:row[16])?JSON.stringify(choices.get(row[15]==="pallet"?row[1]:row[16])):""])].map(toCsvCell).join(",")).join("\r\n");
  }
  const crateUnits=planCrateUnits(result);
  if(crateUnits.some(u=>u.config.crateBearing||u.config.unitStacking)){
    const declaredRules=crateUnits.some(u=>u.config.unitStacking),staticCells=new Map(planCrateStackReview(result).cells.map(c=>[c.id,c]));
    const strip=(c:NonNullable<PackingResult["palletization"]>["config"])=>{const copy={...c};delete copy.crateBearing;delete copy.unitStacking;return copy;};
    const value=result.palletization!,base={...result,palletization:{...value,config:strip(value.config),specifications:value.specifications?.map(s=>({...s,config:strip(s.config)}))}},byId=new Map(crateUnits.map(u=>[u.pallet.id,u]));
    return parseCsvRecords(placementCsvCore(base)).map((row,i)=>{
      if(!i)return [...row,"木箱实际叠放状态","木箱累计上压(kg)","木箱每路径总载荷上界(kg)","支承木箱ID","木箱实际层","木箱额定资料JSON","木箱资料状态","木箱核验范围",...(declaredRules?["整托堆叠规则JSON"]:[])].map(toCsvCell).join(",");
      const unit=byId.get(row[15]==="pallet"?row[1]:row[16]);
      const cell=unit?staticCells.get(unit.pallet.id):undefined;
      return [...row,cell?.state??"",cell?.topLoadKg??"",cell?.throughLoadBoundKg??"",cell?.supporterId??"",cell?.level??"",unit?.config.crateBearing?JSON.stringify(unit.config.crateBearing):"",unit?crateEvidence(unit.config).state:"",unit?(cell?.state==="declared"?"declared-stackability; geometry-and-entered-limits-only; structure-unverified":unit.config.crateBearing?.automaticStacking?"four-corner-paths-v1; unified-static-review":"independent-preflight-only; automatic-floor-only"):"",...(declaredRules?[unit?.config.unitStacking?JSON.stringify(unit.config.unitStacking):""]:[])].map(toCsvCell).join(",");
    }).join("\r\n");
  }
  if(result.palletization?.looseQuantities){
    const base={...result,palletization:{...result.palletization,looseQuantities:undefined}},palletIds=new Set(result.pallets?.map(p=>p.id));
    return parseCsvRecords(placementCsvCore(base)).map((row,i)=>[...row,!i?"装载单元类型":row[15]==="pallet"&&palletIds.has(row[1])?"complete-unit":row[16]?"unit-content":"loose-cargo"].map(toCsvCell).join(",")).join("\r\n");
  }
  const workflow = result.workflow ?? (result.palletization ? "palletized" : result.mode === "single" ? "single-capacity" : "direct");
  const frame = workflow === "pallet-only" ? "pallet-inspection" : "vehicle-loading";
  const rows = result.placements.map((box, index) => [
    index + 1,
    box.sku,
    box.name,
    box.setCode ?? "",
    box.setNumber ?? "",
    box.setItemNumber ?? "",
    box.x,
    box.y,
    box.z,
    box.dx,
    box.dy,
    box.dz,
    box.orientation,
    box.layer,
    box.weight,
    "cargo",
    box.palletIds?.join("|") ?? "",
    result.delivery?.[box.productId]?.customer??"",
    result.delivery?.[box.productId]?.destination??"",
    result.delivery?.[box.productId]?.stop??"",
    result.cargoDetails?.[box.productId]?.cargoShape??(["drum","roll"].includes(result.cargoDetails?.[box.productId]?.cargoType??"")?"cylinder":"box"),
    result.cargoDetails?.[box.productId]?.shapeAxis??(result.cargoDetails?.[box.productId]?.cargoType==="roll"?"L":"H"),
    result.cargoDetails?.[box.productId]?.shapeTopRatio??"",
    result.cargoDetails?.[box.productId]?.shapeWallRatio??"",
    result.cargoDetails?.[box.productId]?.shapeWallHeightRatio??"",
    result.cargoDetails?.[box.productId]?.shapeStepLengthRatio??"",
    result.cargoDetails?.[box.productId]?.shapeStepHeightRatio??"",
    box.orientationSigns?JSON.stringify(box.orientationSigns):"",
    result.cargoDetails?.[box.productId]?.solidModel?JSON.stringify(result.cargoDetails[box.productId].solidModel):"",result.cargoDetails?.[box.productId]?.protectionGap??"",workflow,frame,
  ].map(toCsvCell).join(","));

  const palletRows=(result.pallets??[]).map(p=>[0,p.id,p.name,"","","",p.x,p.y,p.z,p.dx,p.dy,p.dz,p.orientation,0,p.weight,"pallet",p.id,"","","","box","","","","","","",""].concat(["","",workflow,frame]).map(toCsvCell).join(","));
  const structure=result.pallets?.some(p=>p.packaging);
  const measured=result.pallets?.some(p=>p.measuredEnvelope);
  const header=PLACEMENT_CSV_HEADER+(structure?",包装结构JSON,包装总高(mm)":"")+(measured?",实测保守装载包络JSON":"");
  const packagingRows=palletRows.map((row,i)=>row+(structure?","+toCsvCell(JSON.stringify(result.pallets![i].packaging??null))+","+toCsvCell(Math.max(result.pallets![i].enclosureHeight??result.pallets![i].dz,result.pallets![i].dz+deckSupportHeight(result.pallets![i]))):"")+(measured?","+(result.pallets![i].measuredEnvelope?toCsvCell(JSON.stringify({...result.pallets![i].measuredEnvelope,...palletLoadEnvelope(result.pallets![i],result.placements.filter(b=>b.palletIds?.includes(result.pallets![i].id)))})):""):""));
  const cargoRows=rows.map(row=>row+(structure?",,":"")+(measured?",":""));
  if(result.palletization?.specifications){
    const byId=new Map((result.pallets??[]).map(p=>[p.id,p]));
    const suffix=(p:PlacedPallet|undefined)=>","+toCsvCell(p?.specificationId??"")+","+toCsvCell(p?.name??"");
    return [header+",包装规格ID,包装规格名称",...packagingRows.map((row,i)=>row+suffix(result.pallets![i])),...cargoRows.map((row,i)=>row+suffix(byId.get(result.placements[i].palletIds?.[0]??"")))].join("\r\n");
  }
  return [header,...packagingRows,...cargoRows].join("\r\n");
}

export function parseCsvRecords(source: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let state: "start" | "unquoted" | "quoted" | "after_quote" = "start";
  let line = 1;

  const finishValue = () => {
    record.push(value);
    value = "";
    state = "start";
  };
  const finishRecord = () => {
    finishValue();
    if (record.some((cell) => cell.trim() !== "")) records.push(record);
    record = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (state === "start") {
      if (character === '"') {
        state = "quoted";
        continue;
      }
      if (character === ",") {
        finishValue();
        continue;
      }
      if (character === "\n" || character === "\r") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        finishRecord();
        line += 1;
        continue;
      }
      value += character;
      state = "unquoted";
      continue;
    }
    if (state === "unquoted") {
      if (character === '"') {
        throw new Error(`CSV 第 ${line} 行存在未转义的畸形引号，请用双引号包裹字段并双写内部引号。`);
      }
      if (character === ",") {
        finishValue();
        continue;
      }
      if (character === "\n" || character === "\r") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        finishRecord();
        line += 1;
        continue;
      }
      value += character;
      continue;
    }
    if (state === "quoted") {
      if (character === '"') {
        if (source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          state = "after_quote";
        }
        continue;
      }
      if (character === "\r" && source[index + 1] === "\n") {
        value += "\r\n";
        index += 1;
        line += 1;
        continue;
      }
      if (character === "\n" || character === "\r") {
        value += character;
        line += 1;
        continue;
      }
      value += character;
      continue;
    }
    // state === "after_quote"
    if (character === ",") {
      finishValue();
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      finishRecord();
      line += 1;
      continue;
    }
    throw new Error(`CSV 第 ${line} 行闭合引号后存在非法字符，请检查引号格式。`);
  }

  if (state === "quoted") throw new Error("CSV 存在未闭合的引号，请检查文件格式。");
  if (state !== "start" || record.length) finishRecord();
  return records;
}

export function parseProductsCsv(text: string, colors: readonly string[], now = Date.now()) {
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ""));
  const headerRecord = records.shift();
  if (!headerRecord) throw new Error("CSV 文件为空，请先下载模板。");

  const headers = headerRecord.map((header) => header.trim());
  const duplicateHeaders = [...new Set(headers.filter((header, index) => header && headers.indexOf(header) !== index))];
  if (duplicateHeaders.length) {
    throw new Error(`CSV 存在重复表头：${duplicateHeaders.join("、")}。请保证每个字段只出现一次。`);
  }
  if (!REQUIRED_PRODUCT_COLUMNS.every((key) => headers.includes(key))) {
    throw new Error("CSV 缺少必要字段，请先下载模板。");
  }
  if (records.length > MAX_CSV_ROWS) {
    throw new Error(`CSV 最多支持 ${MAX_CSV_ROWS.toLocaleString("zh-CN")} 行产品数据。`);
  }

  const products = records.map((values, index) => {
    if (values.length > headers.length) {
      const extraNonEmpty = values.slice(headers.length).filter((cell) => cell.trim() !== "");
      if (extraNonEmpty.length) {
        throw new Error(`CSV 第 ${index + 2} 行包含 ${values.length} 列，超过表头的 ${headers.length} 列（多余字段：“${extraNonEmpty[0].trim().slice(0, 40)}”），请检查列错位或多余逗号；未导入任何行。`);
      }
    }
    const get = (key: string) => values[headers.indexOf(key)] ?? "";
    const invalid = (key: string) => new Error(`CSV 第 ${index + 2} 行的 ${key} 无效，请检查该字段；未导入任何行。`);
    const number = (key: string, min: number, max = Number.MAX_SAFE_INTEGER, fallback?: number, integer = false) => {
      const text = get(key).trim();
      if (!text && fallback !== undefined) return fallback;
      const value = Number(text);
      if (!text || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw invalid(key);
      return value;
    };
    const boolean = (key: string, fallback: boolean) => {
      const value = get(key).trim().toLowerCase();
      if (!value) return fallback;
      if (value !== "true" && value !== "false") throw invalid(key);
      return value === "true";
    };
    const rawLengthUnit = get("lengthUnit").trim().toLowerCase();
    const rawWeightUnit = get("weightUnit").trim().toLowerCase();
    if (rawLengthUnit && !isLengthUnit(rawLengthUnit)) {
      throw new Error(`CSV 第 ${index + 2} 行的长度单位“${rawLengthUnit}”不受支持；请使用 mm、cm、m 或 in。`);
    }
    if (rawWeightUnit && !isWeightUnit(rawWeightUnit)) {
      throw new Error(`CSV 第 ${index + 2} 行的重量单位“${rawWeightUnit}”不受支持；请使用 kg 或 lb。`);
    }
    const lengthUnit = isLengthUnit(rawLengthUnit) ? rawLengthUnit : "mm";
    const weightUnit = isWeightUnit(rawWeightUnit) ? rawWeightUnit : "kg";
    const rawRotation = get("rotationPolicy").trim().toLowerCase();
    if (rawRotation && !["fixed", "upright", "any"].includes(rawRotation)) throw invalid("rotationPolicy");
    const allowRotate = boolean("allowRotate", true);
    const rotationPolicy: RotationPolicy = ["fixed", "upright", "any"].includes(rawRotation)
      ? (rawRotation as RotationPolicy)
      : !allowRotate
        ? "fixed"
        : "any";
    const rawColor = get("color").trim();
    const fallbackColor = colors[index % Math.max(1, colors.length)] ?? "#2f7f89";

    const length = toMillimeters(number("length", Number.MIN_VALUE), lengthUnit);
    const width = toMillimeters(number("width", Number.MIN_VALUE), lengthUnit);
    const height = toMillimeters(number("height", Number.MIN_VALUE), lengthUnit);
    if (![length, width, height, length * width * height].every(v => Number.isFinite(v) && v > 0)) throw invalid("length/width/height");
    // Explicit *Kg columns always use kilograms, matching the bearing editor.
    const maxTopLoadKg = get("maxTopLoadKg").trim() ? number("maxTopLoadKg", 0) : undefined;
    const topLoadByVerticalAxis: ProductInput["topLoadByVerticalAxis"] = {};
    for (const [axis, key] of [["length", "topLoadLengthKg"], ["width", "topLoadWidthKg"], ["height", "topLoadHeightKg"]] as const) {
      if (get(key).trim()) topLoadByVerticalAxis[axis] = number(key, 0);
    }
    let allowedAboveSkus: string[] | undefined;
    if (get("allowedAboveSkus").trim()) {
      try {
        const value: unknown = JSON.parse(get("allowedAboveSkus"));
        if (!Array.isArray(value) || value.length > 1000 || value.some(v => typeof v !== "string" || !v.trim() || v.length > 80)) throw invalid("allowedAboveSkus");
        allowedAboveSkus = value.map(v => v.trim());
      } catch { throw invalid("allowedAboveSkus（JSON 字符串数组）"); }
    }
    const rawCargo = get("cargoType").trim();
    if (rawCargo && !CARGO_TYPES.includes(rawCargo as never)) throw invalid("cargoType");
    const allowedOrientations = get("allowedOrientations").trim() ? (() => { try { return parseOrientations(JSON.parse(get("allowedOrientations"))); } catch { throw invalid("allowedOrientations"); } })() : undefined;
    const minimumSupportRatio = get("minimumSupportRatio").trim() ? number("minimumSupportRatio", Number.MIN_VALUE, 1) : undefined;
    const palletBaseHeight = get("palletBaseHeight").trim() ? toMillimeters(number("palletBaseHeight", 0), lengthUnit) : undefined;
    if (palletBaseHeight !== undefined && palletBaseHeight >= height) throw invalid("palletBaseHeight");
    const shape = parseShapeFields({cargoType: rawCargo || undefined, cargoShape:get("cargoShape").trim() || undefined, shapeAxis:get("shapeAxis").trim() || undefined, shapeTopRatio:get("shapeTopRatio").trim() ? number("shapeTopRatio", 0, 1) : undefined,
      shapeWallRatio:get("shapeWallRatio").trim()?number("shapeWallRatio",.000001,.999999):undefined,
      shapeWallHeightRatio:get("shapeWallHeightRatio").trim()?number("shapeWallHeightRatio",.000001,.999999):undefined,
      shapeStepLengthRatio:get("shapeStepLengthRatio").trim()?number("shapeStepLengthRatio",.000001,.999999):undefined,
      shapeStepHeightRatio:get("shapeStepHeightRatio").trim()?number("shapeStepHeightRatio",.000001,.999999):undefined,solidModel:get("solidModel").trim()?JSON.parse(get("solidModel")):undefined,protectionGap:get("protectionGap").trim()?toMillimeters(number("protectionGap",0),lengthUnit):undefined});
    return withShapeSupport({
      ...shape,
      ...(get("longSupport").trim()?{longSupport:parseLongSupport(JSON.parse(get("longSupport")))}:{}),
      ...(get("dimensionAllowance").trim()?{dimensionAllowance:parseDimensionAllowance(JSON.parse(get("dimensionAllowance")))}:{}),
      ...(rawCargo ? { cargoType: rawCargo as ProductInput["cargoType"] } : {}),
      ...(allowedOrientations ? { allowedOrientations } : {}),
      ...(minimumSupportRatio === undefined ? {} : { minimumSupportRatio }),
      ...(palletBaseHeight === undefined ? {} : { palletBaseHeight }),
      id: decodeOrderId(get("orderLineId")) || `import-${now}-${index}`,
      ...( ["orderReference","orderLineReference","batch","customer","destination","unloadStop"].some(k=>get(k).trim()) ? {orderLine:parseOrderLine({orderReference:get("orderReference"),lineReference:get("orderLineReference"),batch:get("batch"),customer:get("customer"),destination:get("destination"),stop:number("unloadStop",0,999,0,true)})}:{}),
      sku: sanitizeText(get("sku"), 80),
      name: sanitizeText(get("name"), 200),
      length,
      width,
      height,
      declaredVolumeCbm: roundedCartonVolumeCbm({ length, width, height }),
      weight: toKilograms(number("weight", 0), weightUnit),
      quantity: number("quantity", 0, 1_000_000, undefined, true),
      priority: number("priority", 0, 100, 50, true),
      rotationPolicy,
      stackable: boolean("stackable", true),
      maxStackLayers: number("maxStackLayers", 0, 99, 0, true),
      maxTopLoadKg,
      ...(Object.keys(topLoadByVerticalAxis).length ? {topLoadByVerticalAxis} : {}),
      ...(allowedAboveSkus === undefined ? {} : {allowedAboveSkus}),
      mustLoad: boolean("mustLoad", true),
      bottomOnly: boolean("bottomOnly", false),
      setCode: sanitizeText(get("setCode"), 80),
      unitsPerSet: number("unitsPerSet", 1, 99, 1, true),
      color: VALID_COLOR.test(rawColor) ? rawColor : fallbackColor,
    } satisfies ProductInput);
  });

  if (!products.length) throw new Error("CSV 中没有可导入的数据行。");
  assertOrderLineIds(products);
  return products;
}

/** Separate material / installation list. Carton counts and packaging tare stay untouched. */
export function buildContainerAccessoryCsv(plan:PackingResult,en=false,products?:readonly ProductInput[]){
 const t=(zh:string,english:string)=>en?english:zh;
 const header=[t("方案ID","Plan ID"),t("算法版本","Engine"),"ID",t("名称","Name"),t("用途","Purpose"),t("材料","Material"),t("数量","Quantity"),t("单件计划kg","Planned unit kg"),t("合计计划kg","Planned row kg"),"X(mm)","Y(mm)","Z(mm)","L(mm)","W(mm)","H(mm)",t("安装阶段","Phase"),t("前置附件","Prior accessories"),t("关联货物ID","Related product IDs"),t("最早装箱步骤后","Earliest after carton step"),t("未全部装入货物","Cargo not fully loaded"),t("来源","Source"),t("版本","Revision"),t("备注","Notes"),t("核验范围","Scope"),t("支承声明JSON","Support declaration JSON"),t("上方累计kg","Cumulative upper kg"),t("支承静载状态","Support static load state")];
 const supports=new Map(inspectAccessorySupports(plan,products).map(r=>[r.id,r]));
 const rows=accessoryInstallationPlan(plan).map(({region:z,afterCargoStep,missingProductIds,weightKg})=>{const a=z.accessory,r=supports.get(z.id);return [plan.id,plan.engineVersion,z.id,z.name,z.kind,t(...ACCESSORY_TYPE_TEXT[a.type]),a.quantity,a.unitWeightKg,weightKg,z.x,z.y,z.z,z.dx,z.dy,z.dz,a.phase,a.afterAccessoryIds.join(" / "),a.relatedProductIds.join(" / "),afterCargoStep,missingProductIds.join(" / "),a.source,a.revision,a.note,t("计划重量；固定强度、安装动作和实称未核验","Planned mass; securing strength, installation actions and weighing unverified"),a.support?JSON.stringify(a.support):"",r?.loadKg??"",r?t(...ACCESSORY_SUPPORT_STATES[r.state]):""];});
 return [header,...rows].map(row=>row.map(toCsvCell).join(",")).join("\r\n");
}

export function parseOrderQuantityCsv(text:string){
 if(new TextEncoder().encode(text).length>MAX_CSV_BYTES)throw Error("数量文件超过 5 MB / Quantity file exceeds 5 MB");
 const [header,...rows]=parseCsvRecords(text.replace(/^\uFEFF/,"")),h=header?.map(s=>s.trim());
 if(!h||new Set(h).size!==h.length||!h.includes("orderLineId")||!h.includes("quantity")||!rows.length||rows.length>MAX_CSV_ROWS)throw Error("数量更新需要 orderLineId、quantity 表头及数据 / Quantity updates require orderLineId and quantity headers and data");
 const seen=new Set<string>();return rows.map(row=>{const id=decodeOrderId(row[h.indexOf("orderLineId")]??""),raw=row[h.indexOf("quantity")]?.trim(),quantity=Number(raw);if(!id||id.length>120||seen.has(id)||!raw||!Number.isInteger(quantity)||quantity<0||quantity>1000000)throw Error("数量文件的 ID 或箱数无效或重复 / Invalid or duplicate quantity-file ID or quantity");seen.add(id);return {id,quantity};});
}
export function buildOrderRowsCsv(products:readonly ProductInput[]){
 const columns=["orderLineId","sku","name","length","width","height","weight","quantity","priority","setCode","unitsPerSet","rotationPolicy","stackable","maxStackLayers","mustLoad","bottomOnly","color","maxTopLoadKg","topLoadLengthKg","topLoadWidthKg","topLoadHeightKg","allowedAboveSkus","cargoType","allowedOrientations","minimumSupportRatio","palletBaseHeight","cargoShape","shapeAxis","shapeTopRatio","shapeWallRatio","shapeWallHeightRatio","shapeStepLengthRatio","shapeStepHeightRatio","solidModel","protectionGap","longSupport","dimensionAllowance","orderReference","orderLineReference","batch","customer","destination","unloadStop"];
 assertOrderLineIds(products);return [columns,...products.map(p=>{const line=p.orderLine;return columns.map(k=>k==="orderLineId"?(FORMULA_PREFIX.test(p.id)?JSON.stringify(p.id):p.id):k==="orderLineReference"?line?.lineReference:k==="unloadStop"?line?.stop:["orderReference","batch","customer","destination"].includes(k)?line?.[k as keyof typeof line]:k.startsWith("topLoad")?p.topLoadByVerticalAxis?.[k==="topLoadLengthKg"?"length":k==="topLoadWidthKg"?"width":"height"]:["allowedAboveSkus","allowedOrientations","solidModel","longSupport","dimensionAllowance"].includes(k)?(p[k as keyof ProductInput]===undefined?undefined:JSON.stringify(p[k as keyof ProductInput])):p[k as keyof ProductInput] as string|number|boolean|undefined);})].map(row=>row.map(v=>toCsvCell(typeof v==="boolean"?String(v):v as string|number|undefined)).join(",")).join("\r\n");
}
