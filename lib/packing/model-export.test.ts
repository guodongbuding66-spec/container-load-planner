import {afterAll,expect,it,vi} from 'vitest';
import {exportCargoModel} from './model-export';
import {importCargoModel} from './model-import';
import {defaultSolidModel,buildSolidModel} from './solid-model';
import {addModelFixture,duplicateModelPart} from './solid-templates';
import {cargoShapeProjections} from './cargo-shape-geometry';
import {pointInPolygon} from './solid-math';
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
it('duplicates scaled parts without overlap, changing the original, or dropping fixture tare',()=>{
 const model=defaultSolidModel('box',[100,200,300]);model.calibration=[2,1,1];model.parts[0].fixture=true;model.parts[0].weight=5;const original=JSON.stringify(model);
 const copy=duplicateModelPart(model,model.parts[0].id),built=buildSolidModel(copy);
 expect(copy.parts).toHaveLength(2);expect(copy.parts[1].id).not.toBe(copy.parts[0].id);expect(built.size).toEqual([410,200,300]);expect(built.fixtureWeight).toBe(10);expect(JSON.stringify(model)).toBe(original);
 expect(()=>duplicateModelPart(model,'missing')).toThrow('所选部件');
});
