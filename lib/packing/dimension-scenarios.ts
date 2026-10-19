import {palletEnvelopeTop} from "./deck-support";
import { cargoShapeOf } from "./cargo-shape";
import { getOrientations, restorePackingSnapshot } from "./engine";
import { parseDimensionAllowance, DIMENSION_AXES, type DimensionSize } from "./dimension-allowance";
import { auditPackingResult } from "./result-audit";
import type { PackingRequest, PackingResult, ProductInput, ValidationReport } from "./types";

export type DimensionScenarioTag = { id:string; kind:"nominal"|"conservative"; proxyProductIds:string[] };
export type DimensionScenario = { request:PackingRequest; tag:DimensionScenarioTag; fingerprint:string };
export type DimensionComparison = {
  format:"cargo-fit-dimension-comparison"; version:1; createdAt:string;
  sourceRequest:PackingRequest; sourceFingerprint:string;
  nominal:{request:PackingRequest;plan:PackingResult};
  conservative:{request:PackingRequest;plan:PackingResult};
  originalPositions:ValidationReport;
};
/** Exact serialization is used for stale-result checks; the short ID is only a report label. */
export const dimensionRequestFingerprint = (request:PackingRequest) => JSON.stringify(request);
function scenarioId(fingerprint:string){let hash=2166136261;for(const c of fingerprint)hash=Math.imul(hash^c.charCodeAt(0),16777619);return `dims-${(hash>>>0).toString(16)}`;}

export function conservativeProduct(source:ProductInput):{product:ProductInput;proxy:boolean} {
  const product=structuredClone(source);delete product.dimensionAllowance;
  if(!source.dimensionAllowance)return {product,proxy:false};
  const allowance=parseDimensionAllowance(source.dimensionAllowance);
  for(const axis of DIMENSION_AXES){
    product[axis]=Math.max(source[axis],allowance.measured?.[axis]??source[axis])+allowance.increment[axis]*(allowance.incrementMode==="per-face"?2:1)+allowance.attachments.reduce((n,a)=>n+(a.dimensionsIncluded?0:a.increment[axis]),0);
    if(!Number.isFinite(product[axis])||product[axis]<=0||product[axis]>100000)throw new Error("Conservative dimensions exceed 100000 mm / 保守尺寸超出范围");
  }
  product.weight=source.weight+allowance.attachments.reduce((n,a)=>n+(a.weightIncluded?0:a.weightKg),0);
  const enlarged=DIMENSION_AXES.some(axis=>product[axis]!==source[axis]);
  const proxy=enlarged&&(!!source.solidModel||cargoShapeOf(source)!=="box");
  if(proxy){
    // Bounding boxes cover the original geometry plus allowance. They do not certify its contact faces.
    delete product.solidModel;
    for(const key of ["shapeAxis","shapeTopRatio","shapeWallRatio","shapeWallHeightRatio","shapeStepLengthRatio","shapeStepHeightRatio"] as const)delete product[key];
    product.cargoShape="box";product.stackable=false;product.bottomOnly=true;
    product.allowedOrientations=getOrientations(source,false).map(o=>o.label as NonNullable<ProductInput["allowedOrientations"]>[number]);
  }
  delete product.declaredVolumeCbm;
  return {product,proxy};
}
export function deriveDimensionScenario(source:PackingRequest,kind:DimensionScenarioTag["kind"]):DimensionScenario {
  if(source.products.some(p=>!DIMENSION_AXES.every(k=>Number.isFinite(p[k])&&p[k]>0)))throw new Error("Invalid source dimensions / 标称尺寸无效");
  const fingerprint=dimensionRequestFingerprint(source),request=structuredClone(source),proxyProductIds:string[]=[];
  request.products=request.products.map(p=>{if(kind==="conservative"){const derived=conservativeProduct(p);if(derived.proxy)proxyProductIds.push(p.id);return derived.product;}delete p.dimensionAllowance;return p;});
  return {request,tag:{id:`${scenarioId(fingerprint)}-${kind}`,kind,proxyProductIds},fingerprint};
}
function tagPlan(plan:PackingResult,tag:DimensionScenarioTag):PackingResult {
  const copy=structuredClone(plan);delete copy.strategyPlans;delete copy.strategyComparison;
  return {...copy,id:`${tag.id}/${plan.id}`,dimensionScenario:tag};
}
/** Keep each carton minimum corner fixed and expand along its placed axes; never reuse the old dimensions. */
export function reviewOriginalDimensionPositions(plan:PackingResult,scenario:DimensionScenario):ValidationReport {
  try{
    const byId=new Map(scenario.request.products.map(p=>[p.id,p]));
    const placements=plan.placements.map(b=>{
      const p=byId.get(b.productId);if(!p)throw new Error("Unknown product / 箱位引用未知货物");
      const dimensions:Record<string,number>={L:p.length,W:p.width,H:p.height};
      if(!/^(LWH|LHW|WLH|WHL|HLW|HWL)$/.test(b.orientation))throw new Error("Invalid orientation / 箱位朝向无效");
      return {...b,dx:dimensions[b.orientation[0]],dy:dimensions[b.orientation[1]],dz:dimensions[b.orientation[2]],weight:p.weight};
    });
    const restored=restorePackingSnapshot(scenario.request,{...plan,placements});
    return restored.validation;
  }catch(e){return {valid:false,errors:[e instanceof Error?e.message:String(e)]};}
}
export function buildDimensionComparison(source:PackingRequest,nominalPlan:PackingResult,conservativePlan:PackingResult):DimensionComparison {
  const nominal=deriveDimensionScenario(source,"nominal"),conservative=deriveDimensionScenario(source,"conservative");
  for(const [scenario,plan] of [[nominal,nominalPlan],[conservative,conservativePlan]] as const){
    if(!plan.validation.valid||plan.placements.length!==plan.metrics.loadedCount||auditPackingResult(plan,scenario.request.products).hasErrors)throw new Error("Scenario coordinates do not match their inputs / 尺寸方案与输入不一致");
    const verified=restorePackingSnapshot(scenario.request,plan);
    if(plan.mode!==scenario.request.mode||plan.strategy!==(scenario.request.strategy??"practical")||plan.clearance!==verified.clearance||plan.singleCartonLimit!==scenario.request.singleCartonLimit||["length","width","height","doorWidth","doorHeight","maxWeight"].some(key=>plan.container[key as keyof typeof plan.container]!==verified.container[key as keyof typeof plan.container]))throw new Error("Scenario configuration mismatch / 尺寸方案配置不一致");
  }
  return {format:"cargo-fit-dimension-comparison",version:1,createdAt:new Date().toISOString(),sourceRequest:structuredClone(source),sourceFingerprint:nominal.fingerprint,
    nominal:{request:nominal.request,plan:tagPlan(nominalPlan,nominal.tag)},conservative:{request:conservative.request,plan:tagPlan(conservativePlan,conservative.tag)},originalPositions:reviewOriginalDimensionPositions(nominalPlan,conservative)};
}
/** Signed quantity differences are solver results, not a monotonicity or optimality claim. */
export function dimensionComparisonRows(comparison:DimensionComparison){
  const nominal=new Map(comparison.nominal.plan.summaries.map(s=>[s.productId,s.loaded]));
  const conservative=new Map(comparison.conservative.plan.summaries.map(s=>[s.productId,s.loaded]));
  const products=new Map(comparison.conservative.request.products.map(p=>[p.id,p]));
  return comparison.nominal.request.products.map(p=>({productId:p.id,sku:p.sku,nominal:nominal.get(p.id)??0,conservative:conservative.get(p.id)??0,nominalSize:DIMENSION_AXES.map(k=>p[k]),conservativeSize:DIMENSION_AXES.map(k=>products.get(p.id)![k])}));
}
export function scenarioMargins(plan:PackingResult){
  if(!plan.placements.length)return null;
  const units=plan.palletization?plan.pallets?.map(p=>({x:p.x,y:p.y,z:p.z,dx:p.dx,dy:p.dy,dz:palletEnvelopeTop(p,plan.placements.filter(b=>b.palletIds?.includes(p.id)))-p.z}))??[]:plan.placements;
  if(!units.length)return null;
  const max=(axis:"x"|"y"|"z",size:"dx"|"dy"|"dz")=>Math.max(...units.map(b=>b[axis]+b[size]));
  const wall:DimensionSize={length:plan.container.length-2*plan.clearance-max("x","dx"),width:plan.container.width-2*plan.clearance-max("y","dy"),height:plan.container.height-plan.clearance-max("z","dz")};
  return {farWall:wall,door:plan.workflow==="pallet-only"||plan.container.loadingAccess==="open"?null:{width:plan.container.doorWidth-2*plan.clearance-Math.max(...units.map(b=>b.dy)),height:plan.container.doorHeight-plan.clearance-Math.max(...units.map(b=>b.dz))}};
}
