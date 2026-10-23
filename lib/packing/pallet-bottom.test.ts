import {describe,expect,it} from "vitest";
import {DEFAULT_PACKAGING,baseMeasurements,bottomDeckText,packagingMassCenter,packagingParts,packagingReservedVolume,parsePackaging,placedPackagingParts,withBottomDeck} from "./packaging";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {parseFloorPalletConfig,arrangeFloorPallets} from "./floor-pallets";
import {packLoadingWorkflow} from "./pack-loading";
import {restorePackingSnapshot} from "./engine";
import {parseWorkspaceBackup,restoreWorkspacePlans,serializeWorkspaceBackup} from "./workspace-file";
import {buildPlacementCsv,parseCsvRecords} from "./csv";
import {isolatePalletPlan} from "./pallet-inspection";
import {analyzeEmptySpaces} from "./free-space";
import {crateStructureKey} from "./crate-bearing";
import {forkEvidenceKey} from "./fork-interface";
import {bottomConstructionHtml,customerReport} from "./field-report";
import {issueDeliveryIdentity} from "./delivery-identity";
import {emptyFieldJournal} from "./field-journal";
import {fieldUnitHtml} from "./field-delivery";
import {unitContentsKey} from "./unit-envelope";
import type {PackingRequest,PlacedPallet,ProductInput} from "./types";

const config={...DEFAULT_PALLET_BUILD.config,length:1200,width:800,height:144,weight:25,maxLoad:1000,maxCargoHeight:500,packaging:{...DEFAULT_PACKAGING}};
const product:ProductInput={id:"qa",sku:"QA",name:"QA cartons",length:550,width:350,height:200,weight:10,quantity:8,priority:50,rotationPolicy:"upright",stackable:true,maxStackLayers:2,color:"#338877"};
const request:PackingRequest={mode:"mixed",workflow:"palletized",strategy:"maximum",container:{id:"qa",name:"QA",length:2600,width:900,height:1200,doorWidth:900,doorHeight:1200,maxWeight:1000},clearance:0,products:[product],palletBuild:{...DEFAULT_PALLET_BUILD,config,stackLayers:1}};
const make=(choice:"none"|"runners"="none",strategy:"maximum"|"practical"="maximum")=>packLoadingWorkflow({...request,strategy,palletBuild:{...request.palletBuild!,config:withBottomDeck(config,choice)}});
const physical=(p:PlacedPallet)=>placedPackagingParts(p).filter(b=>b.kind!=="support");

describe("Flat-pallet bottom construction",()=>{
 it("keeps legacy recipes and canonical data unchanged when bottom boards are implicit or explicit",()=>{
  expect(parsePackaging({...DEFAULT_PACKAGING,bottomDeck:"runners"})).toEqual(DEFAULT_PACKAGING);
  expect(packagingParts(1200,800,144)).toHaveLength(20);
  expect(withBottomDeck(config,"runners")).toBe(config);
  expect(crateStructureKey({...config,packaging:parsePackaging({...DEFAULT_PACKAGING,bottomDeck:"runners"})})).toBe(crateStructureKey(config));
 });
 it.each([['block',false],['block',true],['stringer',false],['stringer',true]] as const)("builds a grounded non-overlapping %s base, measured=%s, with the identical upper deck",(base,measured)=>{
  const spec={...DEFAULT_PACKAGING,base};const old={...config,packaging:{...spec,...(measured?{measurements:baseMeasurements(1200,800,144,spec)}:{})}};
  const next=withBottomDeck(old,"none");parseFloorPalletConfig(next);
  const before=packagingParts(1200,800,144,old.packaging),parts=packagingParts(1200,800,144,next.packaging);
  expect(parts.filter(b=>b.z+b.dz===144)).toEqual(before.filter(b=>b.z+b.dz===144));
  expect(parts.filter(b=>b.z===0).every(b=>b.kind==="block")).toBe(true);
  expect(parts.every(b=>b.dx>0&&b.dy>0&&b.dz>0&&b.x>=0&&b.y>=0&&b.z>=0&&b.x+b.dx<=1200+.0001&&b.y+b.dy<=800+.0001&&b.z+b.dz<=144+.0001)).toBe(true);
  for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){const a=parts[i],b=parts[j];expect(Math.min(a.x+a.dx,b.x+b.dx)-Math.max(a.x,b.x)>.0001&&Math.min(a.y+a.dy,b.y+b.dy)-Math.max(a.y,b.y)>.0001&&Math.min(a.z+a.dz,b.z+b.dz)-Math.max(a.z,b.z)>.0001).toBe(false);}
  const groundArea=parts.filter(b=>b.z===0).reduce((n,b)=>n+b.dx*b.dy,0);
  expect(groundArea/(1200*800)).toBeCloseTo(base==="block"?.1512:.42);
 });
 it("requires new measurement provenance on either construction change, without estimating tare",()=>{
  const m={...baseMeasurements(1200,800,144,DEFAULT_PACKAGING),source:"Supplier QA",revision:"r1"};
  const a=withBottomDeck({...config,packaging:{...DEFAULT_PACKAGING,measurements:m}},"none");
  expect(a.packaging?.measurements).toMatchObject({bottomThickness:0,source:"",revision:"",deckThickness:22});expect(a.weight).toBe(25);expect(a.maxLoad).toBe(1000);
  const b=withBottomDeck(a,"runners");expect(b.packaging?.bottomDeck).toBeUndefined();expect(b.packaging?.measurements).toMatchObject({bottomThickness:22,source:"",revision:""});
 });
 it("rejects unknown constructions and no-bottom fields on incompatible bases",()=>{
  for(const value of ["reversible",0,null,{},true])expect(()=>parsePackaging({...DEFAULT_PACKAGING,bottomDeck:value})).toThrow(/bottom construction/);
  for(const base of ['solid','corner-feet'] as const)expect(()=>parsePackaging({...DEFAULT_PACKAGING,base,bottomDeck:"none"})).toThrow();
 });
 it("rejects contradictory bottom thickness instead of silently dropping material",()=>{
  const m=baseMeasurements(1200,800,144,DEFAULT_PACKAGING);
  expect(()=>parseFloorPalletConfig({...config,packaging:{...DEFAULT_PACKAGING,bottomDeck:"none",measurements:m}})).toThrow(/disagree/);
  expect(()=>parseFloorPalletConfig({...config,packaging:{...DEFAULT_PACKAGING,measurements:{...m,bottomThickness:0}}})).toThrow(/disagree/);
 });
 it("does not replace a thin no-bottom base with a solid slab",()=>{
  const parts=packagingParts(1200,800,30,{...DEFAULT_PACKAGING,bottomDeck:"none"});expect(parts).toHaveLength(17);expect(parts.filter(b=>b.z===0)).toHaveLength(9);
 });
 it("rotates and translates the same physical parts without producing missing or floating feet",()=>{
  const plan=make(),p=plan.pallets![0],rotated:PlacedPallet={...p,dx:p.dy,dy:p.dx,orientation:"WLH",quarterTurns:1,x:100,y:200};
  const parts=physical(rotated);expect(parts.filter(b=>b.z===rotated.z)).toHaveLength(9);expect(parts.every(b=>b.x>=100&&b.y>=200&&b.x+b.dx<=900+.0001&&b.y+b.dy<=1400+.0001)).toBe(true);
 });
 it.each(["maximum","practical"] as const)("retains all cartons, local cargo and entered gross mass under %s",strategy=>{
  const a=make("runners",strategy),b=make("none",strategy);expect(b.validation.valid).toBe(true);expect(b.placements).toEqual(a.placements);expect(b.metrics.loadedCount).toBe(8);expect(b.metrics.grossWeight).toBe(a.metrics.grossWeight);
  expect(b.metrics.loadedVolume).toBe(a.metrics.loadedVolume);expect(b.pallets!.every(p=>p.packaging?.bottomDeck==="none")).toBe(true);
 });
 it("shares the no-bottom recipe with the floor-pallet workflow",()=>{
  const p=withBottomDeck(config,"none"),pallets=arrangeFloorPallets(request.container,0,p);expect(pallets).toHaveLength(2);expect(pallets.every(q=>q.packaging?.bottomDeck==="none")).toBe(true);expect(physical(pallets[0]).filter(q=>q.z===0)).toHaveLength(9);
 });
 it("keeps the whole base reserved and never exposes spaces between its feet as refill capacity",()=>{
  const plan=make(),spaces=analyzeEmptySpaces(plan).spaces;
  for(const p of plan.pallets!){expect(packagingReservedVolume(p)).toBe(p.dx*p.dy*p.dz);expect(spaces.some(s=>Math.min(s.x+s.dx,p.x+p.dx)-Math.max(s.x,p.x)>.0001&&Math.min(s.y+s.dy,p.y+p.dy)-Math.max(s.y,p.y)>.0001&&Math.min(s.z+s.dz,p.z+p.dz)-Math.max(s.z,p.z)>.0001)).toBe(false);}
 });
 it("round-trips the new structure in workspace, CSV, isolated units and independent revalidation",()=>{
  const plan=make(),inputs={...request,palletBuild:plan.palletBuild,strategy:"maximum" as const,practicalTargetPercent:95,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm" as const,weightUnit:"kg" as const};
  const backup=serializeWorkspaceBackup(inputs,'0.62.0',plan),restored=restoreWorkspacePlans(backup,parseWorkspaceBackup(backup))!;
  expect(restored.pallets).toEqual(plan.pallets);expect(restored.metrics.grossWeight).toBe(plan.metrics.grossWeight);
  const csv=parseCsvRecords(buildPlacementCsv(plan));expect(csv.every(r=>r.length===csv[0].length)).toBe(true);expect(csv.some(r=>r.some(v=>v.includes('"bottomDeck":"none"')))).toBe(true);
  const unit=isolatePalletPlan(plan,plan.pallets![0].id);expect(unit.pallets![0].packaging?.bottomDeck).toBe('none');expect(unit.metrics.grossWeight).toBe(25+unit.placements.length*10);
  const forged={...plan,pallets:plan.pallets!.map((p,i)=>i?p:{...p,packaging:{...p.packaging!,bottomDeck:undefined}})};expect(()=>restorePackingSnapshot({...request,palletBuild:plan.palletBuild},forged)).toThrow();
 });
 it("invalidates both structural review keys when the physical bottom changes",()=>{
  const next=withBottomDeck(config,"none");expect(crateStructureKey(next)).not.toBe(crateStructureKey(config));expect(forkEvidenceKey(next)).not.toBe(forkEvidenceKey(config));
 });
 it("uses actual part geometry for the mass-center estimate while keeping entered total mass",()=>{
  const a=make('runners').pallets![0],b=make().pallets![0];expect(a.weight).toBe(b.weight);expect(packagingMassCenter(b)[2]).toBeGreaterThan(packagingMassCenter(a)[2]);expect(packagingMassCenter(b).slice(0,2)).toEqual(packagingMassCenter(a).slice(0,2));
 });
 it("keeps the conservative measured-envelope binding sensitive to bottom construction",()=>{
  const p=make().pallets![0];expect(unitContentsKey(p,[])).not.toBe(unitContentsKey({...p,packaging:{...p.packaging!,bottomDeck:undefined}},[]));
 });
 it("exports escaped bottom construction and the same counts and mass in both report languages and unit labels",async()=>{
  const plan=issueDeliveryIdentity(make()),journal=emptyFieldJournal(plan),id=journal.context.atoms.find(q=>q.kind==='pallet')!.id;
  expect(customerReport(plan,[product],{language:'en',customer:'QA',order:'QA',currency:'USD',freight:null})).toContain('No-bottom pallet construction');
  expect(bottomConstructionHtml(plan)).toContain('无底板');expect(bottomConstructionHtml(plan,true)).not.toMatch(/[\u3400-\u9fff]/u);
  const label=await fieldUnitHtml(plan,journal,id,'https://example.org',true);expect(label).toContain('No bottom boards (single-deck)');expect(label).not.toMatch(/[\u3400-\u9fff]/u);
  expect(bottomConstructionHtml({...plan,pallets:plan.pallets!.map(p=>({...p,id:'<script>'}))})).toContain('&lt;script&gt;');
  expect(bottomDeckText()).toEqual(['底部纵板','Bottom runner boards']);
 });
});
