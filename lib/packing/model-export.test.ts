import {afterAll,expect,it,vi} from 'vitest';
import {exportCargoModel} from './model-export';
import {importCargoModel} from './model-import';
import {defaultSolidModel,buildSolidModel} from './solid-model';
import {addModelFixture,duplicateModelPart} from './solid-templates';
import {cargoShapeProjections} from './cargo-shape-geometry';
import {pointInPolygon} from './solid-math';
import {inspectCargoFit,pack} from './engine';
import {bodyBottomPatches,bodyContactArea,surfaceArea} from './cargo-body';
import {pointInRegion} from './planar-region';
import type {ProductInput} from './types';
class Reader {
 result:string|ArrayBuffer|null=null;onloadend:(()=>void)|null=null;
 readAsArrayBuffer(b:Blob){void b.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}
 readAsDataURL(b:Blob){void b.arrayBuffer().then(value=>{this.result=`data:${b.type||'application/octet-stream'};base64,${Buffer.from(value).toString('base64')}`;this.onloadend?.();});}
}
vi.stubGlobal('FileReader',Reader);vi.stubGlobal('ProgressEvent',class{constructor(public type:string){}});afterAll(()=>vi.unstubAllGlobals());
it.each(['glb','gltf'] as const)('exports a real hollow tube as %s and imports at the same physical size',async format=>{
 const model=defaultSolidModel('tube',[600,600,300]),blob=await exportCargoModel(model,format,'#338899','TUBE');
 expect(blob.size).toBeGreaterThan(100);const bytes=await blob.arrayBuffer();if(format==='glb')expect(new DataView(bytes).getUint32(0,true)).toBe(0x46546c67);else expect(JSON.parse(await blob.text()).asset.version).toBe('2.0');
 const imported=await importCargoModel([new File([bytes],`tube.${format}`)],{unit:'m',up:'Y',separate:false,targetTriangles:4000});
 buildSolidModel(model).size.forEach((n,i)=>expect(imported.size[i]).toBeCloseTo(n,3));
 expect(cargoShapeProjections({solidModel:imported.model},'LWH','top').some(poly=>pointInPolygon([0,0],poly))).toBe(false);
});
it('exports fixtures as geometry with their physical height and tare metadata',async()=>{
 const model=addModelFixture(defaultSolidModel('ellipsoid',[600,400,300]),40,5),blob=await exportCargoModel(model,'gltf'),data=JSON.parse(await blob.text());
 expect(data.nodes[0].extras.cargoFit.envelopeMillimeters).toEqual([600,400,340]);expect(data.nodes[0].extras.cargoFit.fixtureTareKg).toBe(5);
});
it('imports the 850 mm tube, checks fit and stacks without fragment explosion or a fictional filled cap',async()=>{
 const model=defaultSolidModel('tube',[850,850,850]),blob=await exportCargoModel(model,'glb');
 const imported=await importCargoModel([new File([await blob.arrayBuffer()],'tube-850.glb')],{unit:'m',up:'Y',separate:true,targetTriangles:4000});
 const [length,width,height]=imported.size,p:ProductInput={id:'tube',sku:'TUBE',name:'Tube',length,width,height,solidModel:imported.model,cargoShape:'mesh',quantity:2,weight:42.5,priority:1,rotationPolicy:'fixed',allowedOrientations:['LWH'],stackable:true,maxStackLayers:0,minimumSupportRatio:1,maxTopLoadKg:100,color:'#338899'};
 const lower={x:0,y:0,z:0,dx:length,dy:width,dz:height,orientation:'LWH'},upper={...lower,z:height};
 const cap=bodyBottomPatches(lower,p)[0];expect(cap.region).toBeDefined();expect(pointInRegion([length/2,width/2],cap.region!)).toBe(false);
 const reference=Math.PI*(425**2-212.5**2);expect(surfaceArea(cap)).toBeLessThan(reference*1.01);expect(surfaceArea(cap)).toBeGreaterThan(reference*.98);
 expect(bodyContactArea(upper,{x:420,y:420,z:0,dx:10,dy:10,dz:height},p,{})).toBe(0);
 expect(bodyContactArea(upper,lower,p,p)).toBeGreaterThan(reference*.98);
 const container={id:'stack',name:'Stack',length:850,width:850,height:1700,doorWidth:850,doorHeight:1700,maxWeight:1000};
 expect(inspectCargoFit(p,container,0).reasons).toEqual([]);
 for(const strategy of ['practical','maximum'] as const){const r=pack({mode:'mixed',strategy,container,products:[p],clearance:0});expect(r.validation.valid).toBe(true);expect(r.metrics.loadedCount).toBe(2);expect(r.placements.map(b=>b.z).sort((a,b)=>a-b)).toEqual([0,850]);}
},15000);
it('duplicates scaled parts without overlap, changing the original, or dropping fixture tare',()=>{
 const model=defaultSolidModel('box',[100,200,300]);model.calibration=[2,1,1];model.parts[0].fixture=true;model.parts[0].weight=5;const original=JSON.stringify(model);
 const copy=duplicateModelPart(model,model.parts[0].id),built=buildSolidModel(copy);
 expect(copy.parts).toHaveLength(2);expect(copy.parts[1].id).not.toBe(copy.parts[0].id);expect(built.size).toEqual([410,200,300]);expect(built.fixtureWeight).toBe(10);expect(JSON.stringify(model)).toBe(original);
 expect(()=>duplicateModelPart(model,'missing')).toThrow('所选部件');
});
