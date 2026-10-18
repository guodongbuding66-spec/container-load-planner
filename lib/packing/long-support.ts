import type { PackingResult, PlacedBox, ProductInput } from "./types";
import { bodyTopPatches, orientationAxes, validOrientationSigns } from "./cargo-body";
import { placedPackagingParts } from "./packaging";
import { cargoShapeOf } from "./cargo-shape";

const EPS = .0001;
export type LongSupportProfile = {
  version: 1;
  dimensions: { length: number; width: number; height: number };
  axis: "L" | "W";
  bands: { start: number; end: number }[];
  minimumContactRatio: number;
  maxSpanMm?: number;
  maxOverhangMm?: number;
  source: string;
  revision: string;
};
export function parseLongSupport(value: unknown): LongSupportProfile {
  const fail = () => { throw Error("Invalid long-carton support data / 长条箱承托资料无效"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const v = value as LongSupportProfile;
  const number = (n: unknown, min = 0, max = 100000): number => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? n : fail();
  if (v.version !== 1 || !["L", "W"].includes(v.axis) || !v.dimensions || typeof v.dimensions !== "object" || Array.isArray(v.dimensions)) return fail();
  const dimensions = { length: number(v.dimensions.length, Number.MIN_VALUE), width: number(v.dimensions.width, Number.MIN_VALUE), height: number(v.dimensions.height, Number.MIN_VALUE) };
  if (!Array.isArray(v.bands) || !v.bands.length || v.bands.length > 12) return fail();
  const extent = v.axis === "L" ? dimensions.length : dimensions.width;
  const bands = v.bands.map(b => {
    if (!b || typeof b !== "object" || Array.isArray(b)) return fail();
    const start = number(b.start, 0, extent), end = number(b.end, 0, extent);
    if (end - start <= EPS) return fail();
    return { start, end };
  }).sort((a,b) => a.start-b.start);
  if (bands.some((b,i) => i > 0 && b.start < bands[i-1].end - EPS)) return fail();
  if (typeof v.source !== "string" || v.source.length > 500 || typeof v.revision !== "string" || v.revision.length > 120) return fail();
  return { version: 1, dimensions, axis: v.axis, bands, minimumContactRatio: number(v.minimumContactRatio, Number.MIN_VALUE, 1),
    ...(v.maxSpanMm === undefined ? {} : {maxSpanMm: number(v.maxSpanMm)}), ...(v.maxOverhangMm === undefined ? {} : {maxOverhangMm: number(v.maxOverhangMm)}), source: v.source.trim(), revision: v.revision.trim() };
}
export type SupportIssue = "invalid" | "dimensions" | "shape" | "face" | "missing-product" | "no-contact" | "band" | "span" | "overhang" | "limits" | "evidence" | "base-evidence" | "surface" | "tolerance" | "budget";
export const SUPPORT_ISSUES: Record<SupportIssue,[string,string]> = {
  invalid:["承托资料格式无效","Invalid support profile"], dimensions:["箱规已变化，须重新录入并绑定资料","Carton dimensions changed; re-enter and bind support data"],
  shape:["首阶段仅检查长方体箱规","This stage checks rectangular cartons only"], face:["指定原始底面 H− 未朝下","The specified original H− face is not facing down"],
  "missing-product":["缺少当前原始箱规，无法复核","Current original carton data is missing"], "no-contact":["没有达到横向接触比例的有效支承区","No support interval meets the transverse contact ratio"],
  band:["指定支承带接触比例不足","A required support band has insufficient contact"], span:["中部悬跨超过输入上限","Internal unsupported span exceeds the entered limit"], overhang:["端部悬挑超过输入上限","End overhang exceeds the entered limit"],
  limits:["未填写悬跨或悬挑上限","Span or overhang limit is missing"], evidence:["缺少货物资料来源或版本","Cargo evidence source or revision is missing"],
  "base-evidence":["底座未记录完整实测来源与版本","Base measurement source and revision are incomplete"], surface:["存在尚未支持的曲面、孔洞或多边形接触","Curved, holed or polygonal contact is not checked in this stage"],
  tolerance:["公差方案不能沿用标称承托资料","Tolerance scenarios cannot reuse nominal support evidence"], budget:["超过自动接触检查预算，尚未核验","Automatic contact-check budget exceeded; unverified"]
};
type Rect = { start:number; end:number; low:number; high:number };
export type LongSupportRow = { id:string; sku:string; state:"pass"|"fail"|"unverified"; issues:SupportIssue[]; profile?:LongSupportProfile; contacts:Rect[]; supporterIds:string[]; bandRatios:number[]; spanMm?:number; overhangMm?:[number,number]; length?:number; width?:number };
function unionLength(intervals:[number,number][]) {
  let total=0,end=-Infinity;
  for(const [a,b] of intervals.filter(([a,b])=>b>a+EPS).sort((a,b)=>a[0]-b[0])) { total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b); }
  return total;
}
/** Exact rectangular union sweep; overlapping supports never double-count area. */
function contactSlabs(contacts:Rect[],length:number,width:number,ratio:number) {
  const points=[...new Set([0,length,...contacts.flatMap(c=>[c.start,c.end])])].sort((a,b)=>a-b);
  let area=0;const intervals:[number,number][]=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],mid=(a+b)/2;
    const covered=unionLength(contacts.filter(c=>c.start<=mid&&c.end>=mid).map(c=>[c.low,c.high]));
    area+=(b-a)*covered;
    if(covered+EPS>=width*ratio&&covered>EPS){const previous=intervals.at(-1);if(previous&&a<=previous[1]+EPS)previous[1]=b;else intervals.push([a,b]);}
  }
  return {area,intervals};
}
function rectangular(p: ProductInput | undefined) { return !!p && !p.solidModel && cargoShapeOf(p) === "box"; }
/** Independent check only: never changes quantities, places supports, or certifies material strength. */
export function inspectLongSupport(plan:PackingResult, products?:readonly ProductInput[]):LongSupportRow[] {
  const rules=new Map(products?.map(p=>[p.id,p])??[]);
  const byTop=new Map<number,PlacedBox[]>();
  for(const b of plan.placements){const key=Math.round((b.z+b.dz)/EPS),list=byTop.get(key);if(list)list.push(b);else byTop.set(key,[b]);}
  const rows:LongSupportRow[]=[];let remaining=100000;
  for(const b of plan.placements){
    const p=rules.get(b.productId),raw=p?p.longSupport:plan.cargoDetails?.[b.productId]?.longSupport;
    if(raw===undefined)continue;
    const row:LongSupportRow={id:b.id,sku:b.sku,state:"unverified",issues:[],contacts:[],supporterIds:[],bandRatios:[]};rows.push(row);
    let profile:LongSupportProfile;try{profile=parseLongSupport(raw);row.profile=profile;}catch{row.issues.push("invalid");continue;}
    if(!p){row.issues.push("missing-product");continue;}
    if(!rectangular(p)){row.issues.push("shape");continue;}
    if((["length","width","height"] as const).some(k=>Math.abs(p[k]-profile.dimensions[k])>EPS)){row.issues.push("dimensions");continue;}
    if(plan.dimensionScenario&&plan.dimensionScenario.kind!=="nominal"){row.issues.push("tolerance");continue;}
    if(!["LWH","LHW","WLH","WHL","HLW","HWL"].includes(b.orientation)||!validOrientationSigns(b.orientation,b.orientationSigns)||![b.x,b.y,b.z,b.dx,b.dy,b.dz].every(Number.isFinite)||b.z<-EPS){row.issues.push("invalid");continue;}
    const axes=orientationAxes(b.orientation as import("./types").OrientationCode,b.orientationSigns);
    if(axes.some((a,i)=>Math.abs([p.length,p.width,p.height][a.original]-[b.dx,b.dy,b.dz][i])>EPS)){row.issues.push("dimensions");continue;}
    if(axes[2].original!==2||axes[2].negative){row.state="fail";row.issues.push("face");continue;}
    const axis=profile.axis==="L"?0:1,worldAxis=axes.findIndex(a=>a.original===axis);
    const length=profile.axis==="L"?p.length:p.width,width=profile.axis==="L"?p.width:p.length;row.length=length;row.width=width;
    const add=(x:number,y:number,dx:number,dy:number,id:string)=>{
      const pos=[Math.max(0,x-b.x),Math.max(0,y-b.y)],end=[Math.min(b.dx,x+dx-b.x),Math.min(b.dy,y+dy-b.y)];
      if(end[0]-pos[0]<=EPS||end[1]-pos[1]<=EPS)return;
      const ranges=axes.slice(0,2).map((a,i)=>a.negative?[(i===0?b.dx:b.dy)-end[i],(i===0?b.dx:b.dy)-pos[i]]:[pos[i],end[i]]);
      const [start,finish]=ranges[worldAxis],[low,high]=ranges[1-worldAxis];row.contacts.push({start,end:finish,low,high});if(!row.supporterIds.includes(id))row.supporterIds.push(id);
    };
    if(b.z<=EPS)add(b.x,b.y,b.dx,b.dy,"floor");
    else {
      const candidates=byTop.get(Math.round(b.z/EPS))??[];
      if(candidates.length>500||candidates.length+(plan.pallets?.length??0)>remaining){row.issues.push("budget");continue;}
      remaining-=candidates.length+(plan.pallets?.length??0);
      for(const lower of candidates){
        if(lower.id===b.id||lower.x+lower.dx<=b.x||lower.x>=b.x+b.dx||lower.y+lower.dy<=b.y||lower.y>=b.y+b.dy)continue;
        const lp=rules.get(lower.productId);
        if(!rectangular(lp)){row.issues.push("surface");continue;}
        for(const patch of bodyTopPatches(lower,lp,b.z))add(patch.x,patch.y,patch.dx,patch.dy,lower.id);
      }
      for(const pallet of plan.pallets??[]){
        if(Math.abs(pallet.z+pallet.dz-b.z)>EPS||pallet.x+pallet.dx<=b.x||pallet.x>=b.x+b.dx||pallet.y+pallet.dy<=b.y||pallet.y>=b.y+b.dy)continue;
        const m=pallet.packaging?.measurements;
        if(!m?.source.trim()||!m.revision.trim())row.issues.push("base-evidence");
        for(const part of placedPackagingParts(pallet))if(Math.abs(part.z+part.dz-b.z)<=EPS)add(part.x,part.y,part.dx,part.dy,pallet.id);
      }
    }
    const sweep=contactSlabs(row.contacts,length,width,profile.minimumContactRatio);
    row.bandRatios=profile.bands.map(band=>contactSlabs(row.contacts.map(c=>({...c,start:Math.max(band.start,c.start),end:Math.min(band.end,c.end)})).filter(c=>c.end>c.start),length,width,profile.minimumContactRatio).area/((band.end-band.start)*width));
    row.spanMm=sweep.intervals.length?sweep.intervals.reduce((n,v,i,a)=>i?Math.max(n,v[0]-a[i-1][1]):n,0):undefined;
    row.overhangMm=sweep.intervals.length?[sweep.intervals[0][0],length-sweep.intervals.at(-1)![1]]:undefined;
    if(!sweep.intervals.length)row.issues.push("no-contact");
    if(row.bandRatios.some(n=>n+EPS<profile.minimumContactRatio))row.issues.push("band");
    if(profile.maxSpanMm!==undefined&&row.spanMm!==undefined&&row.spanMm>profile.maxSpanMm+EPS)row.issues.push("span");
    if(profile.maxOverhangMm!==undefined&&row.overhangMm?.some(n=>n>profile.maxOverhangMm!+EPS))row.issues.push("overhang");
    if(profile.maxSpanMm===undefined||profile.maxOverhangMm===undefined)row.issues.push("limits");
    if(!profile.source||!profile.revision)row.issues.push("evidence");
    row.issues=[...new Set(row.issues)];
    const uncertain=row.issues.some(i=>["surface","base-evidence"].includes(i));
    row.state=!uncertain&&row.issues.some(i=>["no-contact","band","span","overhang"].includes(i))?"fail":row.issues.length?"unverified":"pass";
  }
  return rows;
}
