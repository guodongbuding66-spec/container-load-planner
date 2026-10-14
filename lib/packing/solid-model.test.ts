import { describe,it,expect } from 'vitest';
import { defaultSolidModel, defaultModelPart, parseSolidModel, buildSolidModel, MODEL_KINDS } from './solid-model';
import { boxCell, convexOverlap, subtractCell, cellVolumeCentroid, clipPolygon, polygonArea, triangulatePolygon } from './solid-math';
import { bodiesOverlap, bodyContactArea, bodyBottomPatches, surfaceArea, bodyTopPatches, bodyVolumeRatio } from './cargo-body';
import { modelRestError } from './model-body';
const box=(x=0,y=0,z=0,dx=600,dy=600,dz=600)=>({x,y,z,dx,dy,dz,orientation:'LWH'});
describe('convex geometry proofs',()=>{
 it('finds exact separation, contact and penetration independent of face order',()=>{const a=boxCell(0,0,0,1,1,1);expect(convexOverlap(a,boxCell(1,0,0,1,1,1))).toBe(false);expect(convexOverlap(a,boxCell(.999,0,0,1,1,1))).toBe(true);expect(convexOverlap(a,boxCell(1.01,0,0,1,1,1),.02)).toBe(true);});
 it('subtracts intersecting convex bodies without losing or double-counting volume',()=>{const a=boxCell(0,0,0,2,2,2),b=boxCell(1,1,1,2,2,2),pieces=subtractCell(a,b);expect(pieces.reduce((n,c)=>n+cellVolumeCentroid(c).volume,0)).toBeCloseTo(7,7);for(const c of pieces)expect(convexOverlap(c,b)).toBe(false);});
 it('clips convex contact patches and triangulates a concave cross-section',()=>{const a:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[2,0],[2,2],[0,2]];expect(polygonArea(clipPolygon(a,[[1,1],[3,1],[3,3],[1,3]]))).toBe(1);const p:[number,number][]=[[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]];expect(triangulatePolygon(p).reduce((n,t)=>n+polygonArea(t.map(i=>p[i])),0)).toBe(3);});
});
describe('validated physical models',()=>{
 it.each(MODEL_KINDS.filter(k=>k!=='mesh'))('builds finite %s cells, mesh and physical envelope',kind=>{
  const model=parseSolidModel(defaultSolidModel(kind))!,built=buildSolidModel(model);expect(built.size.every(n=>n>0&&Number.isFinite(n))).toBe(true);expect(built.cells.length).toBeGreaterThan(0);expect(built.display.length).toBeGreaterThan(0);expect(built.volumeRatio).toBeGreaterThan(0);expect(built.volumeRatio).toBeLessThanOrEqual(1);expect(built.center.every(Number.isFinite)).toBe(true);expect(built.display.every(c=>c.vertices.every(v=>v.every(n=>n>=-1e-6&&n<=1+1e-6)))).toBe(true);
 });
 it('leaves a tube bore usable but rejects intrusion into its wall',()=>{
  const m=defaultSolidModel('tube',[600,600,600]);m.parts[0].dimensions.innerDiameter=400;const p={solidModel:parseSolidModel(m)!};
  expect(bodiesOverlap(box(),box(240,240,0,100,100,500),p,{})).toBe(false);
  expect(bodiesOverlap(box(),box(450,240,0,100,100,500),p,{})).toBe(true);
  expect(bodyVolumeRatio(p)).toBeCloseTo(Math.PI*(300*300-200*200)*600/(600**3),10);
 });
 it('uses a frustum slope rather than a fictional occupied cuboid',()=>{
  const m=defaultSolidModel('frustum',[600,600,600]);m.parts[0].dimensions.topDiameter=200;const p={solidModel:parseSolidModel(m)!};
  expect(bodiesOverlap(box(),box(0,0,450,80,80,80),p,{})).toBe(false);
  expect(bodiesOverlap(box(),box(250,250,450,100,100,100),p,{})).toBe(true);
 });
 it('preserves concave support and excludes the internal joints of a combination',()=>{
  const m=defaultSolidModel('box',[200,200,100]);m.parts.push({...defaultModelPart('box',[100,200,100],'upper'),position:[0,0,100]});const p={solidModel:parseSolidModel(m)!},b=box(0,0,0,200,200,200);
  expect(bodyBottomPatches(b,p).reduce((n,s)=>n+surfaceArea(s),0)).toBeCloseTo(40000,5);
  expect(bodyTopPatches(b,p,100).reduce((n,s)=>n+surfaceArea(s),0)).toBeCloseTo(20000,5);
  expect(bodyContactArea(box(100,0,100,100,200,100),b,{},p)).toBeCloseTo(20000,5);
 });
 it('never treats a sphere point contact as a full flat supporting face',()=>{
  const p={solidModel:parseSolidModel(defaultSolidModel('ellipsoid',[600,600,600]))!};expect(bodyBottomPatches(box(),p)).toEqual([]);expect(modelRestError(box(),p)).toBeTruthy();
 });
 it('counts support blocks and their tare in the same rigid envelope',()=>{
  const m=defaultSolidModel('ellipsoid',[600,600,600]);m.antiRoll=true;m.parts.push({...defaultModelPart('box',[600,600,50],'base'),position:[0,0,-50],fixture:true,weight:12});const p={solidModel:parseSolidModel(m)!};
  expect(buildSolidModel(p.solidModel).size[2]).toBe(650);expect(buildSolidModel(p.solidModel).fixtureWeight).toBe(12);expect(modelRestError(box(0,0,0,600,600,650),p)).toBeNull();
 });
 it('rejects bad taper, bore, flange, section and coordinates before a solver sees them',()=>{
  for(const mutate of [(m:ReturnType<typeof defaultSolidModel>)=>m.parts[0].dimensions.innerDiameter=600,(m:ReturnType<typeof defaultSolidModel>)=>m.parts[0].position[0]=NaN]){const m=defaultSolidModel('tube',[600,600,600]);mutate(m);expect(()=>parseSolidModel(m)).toThrow();}
  const m=defaultSolidModel('reel');m.parts[0].dimensions.flangeThickness=m.parts[0].dimensions.axial;expect(()=>parseSolidModel(m)).toThrow();
 });
});

import { pack,validatePacking,restorePackingSnapshot } from './engine';
import { analyzeEmptySpaces,probeEmptySpace } from './free-space';
import { cargoShapeGeometry } from './cargo-shape-geometry';
import type {ProductInput} from './types';
const modelProduct=(kind:Parameters<typeof defaultSolidModel>[0],size:[number,number,number]=[600,600,600]):ProductInput=>{const solidModel=parseSolidModel(defaultSolidModel(kind,size))!,[length,width,height]=buildSolidModel(solidModel).size;return {id:kind,sku:kind,name:kind,length,width,height,solidModel,cargoShape:kind,weight:10,quantity:1,priority:100,rotationPolicy:'fixed',allowedOrientations:['LWH'],stackable:true,maxStackLayers:0,color:'#338899'};};
const cabinet={id:'solid',name:'Solid',loadingAccess:'open' as const,length:1200,width:1200,height:1200,doorWidth:200,doorHeight:200,maxWeight:1000};
describe('solid solver and archive integration',()=>{
 it.each(['practical','maximum'] as const)('packs a small carton inside a certified tube bore in %s',strategy=>{
  const tube=modelProduct('tube'),m={...tube.solidModel!,parts:tube.solidModel!.parts.map(p=>({...p,dimensions:{...p.dimensions,innerDiameter:400}}))};tube.solidModel=parseSolidModel(m)!;
  const small={...modelProduct('box',[150,150,300]),id:'small',sku:'small',priority:50,solidModel:undefined,cargoShape:'box' as const};
  const request={mode:'mixed' as const,strategy,container:{...cabinet,length:600,width:600,height:600},clearance:0,products:[tube,small]},result=pack(request);
  expect(result.validation.valid).toBe(true);expect(result.metrics.loadedCount).toBe(2);expect(result.placements.some(b=>b.productId==='small'&&b.x>=100&&b.x+b.dx<=500&&b.y>=100&&b.y+b.dy<=500)).toBe(true);
  expect(restorePackingSnapshot(request,result).validation.valid).toBe(true);expect(result.metrics.envelopeUtilization).toBeCloseTo(1,8);expect(result.metrics.volumeUtilization).toBeLessThan(1);
 });
 it('allows flat-end cylinder stacking, but still rejects a curved point base',()=>{
  const cylinder={...modelProduct('cylinder'),quantity:2,maxTopLoadKg:20};const result=pack({mode:'mixed',strategy:'maximum',container:{...cabinet,length:600,width:600},clearance:0,products:[cylinder]});expect(result.validation.valid).toBe(true);expect(result.metrics.loadedCount).toBe(2);
  const sphere=modelProduct('ellipsoid');expect(pack({mode:'mixed',strategy:'maximum',container:cabinet,clearance:0,products:[sphere]}).metrics.loadedCount).toBe(0);
 });
 it('keeps protected cargo separated even across spatial-index cells',()=>{
  const p={...modelProduct('box',[200,200,200]),quantity:3,protectionGap:30};const result=pack({mode:'mixed',strategy:'maximum',container:{...cabinet,width:200,height:200},clearance:0,products:[p]});expect(result.metrics.loadedCount).toBe(3);expect(result.placements[1].x-result.placements[0].x).toBeGreaterThanOrEqual(230);
  const bad=[{...result.placements[0]},{...result.placements[1],x:220}];expect(validatePacking(bad,cabinet,0,[p]).valid).toBe(false);
 });
 it('reports only collision-free inner gaps, then independently verifies a top-up witness',()=>{
  const p=modelProduct('tube'),request={mode:'mixed' as const,strategy:'maximum' as const,container:{...cabinet,length:600,width:600,height:600},clearance:0,products:[p]},result=pack(request),free=analyzeEmptySpaces(result,1200);
  expect(free.spaces.some(s=>s.x>0&&s.y>0&&s.x+s.dx<600&&s.y+s.dy<600)).toBe(true);
  for(const s of free.spaces)expect(bodiesOverlap(result.placements[0],{...s,orientation:'LWH'},p,{})).toBe(false);
  const small={...modelProduct('box',[40,40,100]),id:'extra',sku:'extra',solidModel:undefined};const trial=probeEmptySpace(result,[p,small],small.id,free.spaces);expect(trial.status).toBe('fits');
 });
 it('gives custom model geometry a renderable material group for the main GPU view',()=>{
  const p=modelProduct('tube'),g=cargoShapeGeometry(p);expect(g.getAttribute('position').count).toBeGreaterThan(0);expect(g.groups.reduce((n,g)=>n+g.count,0)).toBe(g.getAttribute('position').count);g.dispose();
 });
});

import {modelAnnotations} from './model-annotations';
import {addModelFixture,serializeSolidTemplate,parseSolidTemplate,calibrateSolidModel} from './solid-templates';
import {parseProductsCsv,toCsvCell,buildPlacementCsv,parseCsvRecords} from './csv';
import {serializeWorkspaceBackup,parseWorkspaceBackup,restoreWorkspacePlans} from './workspace-file';
import {modelMassCenter} from './model-body';
describe('physical geometry edge cases',()=>{
 it('does not invent annular contact inside a thin-walled bore, and retains full real ring contact',()=>{const m=defaultSolidModel('tube',[600,600,100]);m.parts[0].dimensions.innerDiameter=598;const p={solidModel:parseSolidModel(m)!},upper=box(0,0,100,600,600,100),lower=box(0,0,0,600,600,100);expect(bodyContactArea(upper,box(295,295,0,10,10,100),p,{})).toBe(0);expect(bodyContactArea(upper,lower,p,p)).toBeCloseTo(Math.PI*(300**2-299**2),6);expect(buildSolidModel(p.solidModel).display.every(c=>cellVolumeCentroid(c).volume>0)).toBe(true);});
 it('respects face permissions after rotation rather than accepting any bounding face',()=>{const m=defaultSolidModel('box',[100,200,300]);m.restFaces=['H-'];const p={solidModel:parseSolidModel(m)!};expect(modelRestError(box(0,0,0,100,200,300),p)).toBeNull();expect(modelRestError({...box(0,0,0,300,200,100),orientation:'HWL'},p)).toBeTruthy();});
 it('keeps a fully supported multi-circle assembly valid at an explicit 100% support threshold',()=>{const m=defaultSolidModel('cylinder',[100,100,100]);m.parts.push({...defaultModelPart('cylinder',[100,100,100],'second'),position:[150,0,0]});const p={...modelProduct('box',[250,100,100]),id:'two',cargoShape:'compound' as const,solidModel:parseSolidModel(m)!,minimumSupportRatio:1,priority:50};const base={...modelProduct('box',[250,100,100]),id:'base',solidModel:undefined,priority:100};const r=pack({mode:'mixed',strategy:'maximum',container:{...cabinet,length:250,width:200,height:200},clearance:0,products:[base,p]});expect(r.validation.valid).toBe(true);expect(r.metrics.loadedCount).toBe(2);});
 it('counts overlapping rectangular parts once and computes their union centre',()=>{const m=defaultSolidModel('box',[200,100,100]);m.parts.push({...defaultModelPart('box',[200,100,100],'second'),position:[100,0,0]});const b=buildSolidModel(parseSolidModel(m)!);expect(b.volumeRatio).toBeCloseTo(1,8);expect(b.center[0]).toBeCloseTo(.5,8);});
 it('keeps calibration-aware fixtures at their actual physical dimensions',()=>{const m=calibrateSolidModel(defaultSolidModel('ellipsoid',[100,100,100]),[200,300,400]),fixed=addModelFixture(m,40,5);fixed.antiRoll=true;const b=buildSolidModel(parseSolidModel(fixed)!);expect(b.size).toEqual([200,300,440]);expect(b.fixtureWeight).toBe(5);});
 it.each(['LWH','LHW','WLH','WHL','HLW','HWL'] as const)('uses physical wall annotations after part and placement rotations (%s)',orientation=>{const m=defaultSolidModel('l-profile',[600,400,500]);m.parts[0].dimensions.verticalWall=37;m.parts[0].dimensions.horizontalWall=55;m.parts[0].orientation=orientation;const b=buildSolidModel(parseSolidModel(m)!),a=modelAnnotations(m,b.size);expect(a.find(a=>a.key.endsWith('verticalWall'))!.value).toBeCloseTo(37,8);expect(a.find(a=>a.key.endsWith('horizontalWall'))!.value).toBeCloseTo(55,8);});
 it('rejects self-crossing or overlapping sections before saving or packing',()=>{const m=defaultSolidModel('custom-prism');m.parts[0].section=[[0,0],[100,100],[0,100],[100,0],[200,0]];expect(()=>parseSolidModel(m)).toThrow();});
 it('uses entered component masses for gravity rather than the assembly envelope centre',()=>{const m=defaultSolidModel('box',[100,100,100]);m.parts[0].weight=9;m.parts.push({...defaultModelPart('box',[100,100,100],'second'),position:[200,0,0],weight:1});const p={solidModel:parseSolidModel(m)!,weight:10};expect(modelMassCenter(box(0,0,0,300,100,100),p)[0]).toBeCloseTo(70,8);});
 it('round-trips validated model JSON and protective gaps through templates, CSV and workspace plans',()=>{const p={...modelProduct('tube',[200,200,200]),protectionGap:7},template=parseSolidTemplate(serializeSolidTemplate('Tube',p.solidModel!));expect(template.model).toEqual(p.solidModel);const header=['sku','name','length','width','height','weight','quantity','cargoShape','solidModel','protectionGap'],row=['T','Tube',200,200,200,10,1,'tube',JSON.stringify(p.solidModel),7];const imported=parseProductsCsv([header.join(','),row.map(toCsvCell).join(',')].join('\n'),['#338899'])[0];expect(imported.solidModel).toEqual(p.solidModel);expect(imported.protectionGap).toBe(7);const request={mode:'mixed' as const,strategy:'maximum' as const,container:cabinet,products:[p],clearance:0},plan=pack(request);plan.accessConfig={maneuver:true,maxLift:100,clearance:5,turn:true,budget:1500};const inputs={...request,practicalTargetPercent:84,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:'mm' as const,weightUnit:'kg' as const},file=serializeWorkspaceBackup(inputs,'test',plan),restored=restoreWorkspacePlans(file,parseWorkspaceBackup(file))!;expect(restored.validation.valid).toBe(true);expect(restored.accessConfig).toEqual(plan.accessConfig);expect(restored.cargoDetails?.tube.solidModel).toEqual(p.solidModel);const csv=parseCsvRecords(buildPlacementCsv(restored));expect(csv[1]).toHaveLength(csv[0].length);expect(JSON.parse(csv[1][28])).toEqual(p.solidModel);expect(csv[1][29]).toBe('7');});
});
import {cargoShapeFootprints} from './cargo-shape-geometry';
import {pointInPolygon} from './solid-math';
it('retains a real tube bore in the fallback floor projection, and exposes the conservative proxy separately',()=>{const p=modelProduct('tube'),footprints=cargoShapeFootprints(p,'LWH');expect(footprints.some(poly=>pointInPolygon([0,0],poly))).toBe(false);expect(footprints.some(poly=>pointInPolygon([.4,0],poly))).toBe(true);const actual=cargoShapeGeometry(p,'LWH',false),proxy=cargoShapeGeometry(p,'LWH',false,undefined,true);expect(actual.getAttribute('position').count).not.toBe(proxy.getAttribute('position').count);actual.dispose();proxy.dispose();});
it('removes opposite internal render faces while keeping duplicate outer surfaces visible',()=>{const m=defaultSolidModel('box',[100,100,100]);m.parts.push({...defaultModelPart('box',[100,100,100],'right'),position:[100,0,0]});const g=cargoShapeGeometry({solidModel:parseSolidModel(m)!});expect(g.getAttribute('position').count).toBe(60);g.dispose();const same=defaultSolidModel('box',[100,100,100]);same.parts.push(defaultModelPart('box',[100,100,100],'duplicate'));const duplicate=cargoShapeGeometry({solidModel:parseSolidModel(same)!});expect(duplicate.getAttribute('position').count).toBe(36);duplicate.dispose();});
