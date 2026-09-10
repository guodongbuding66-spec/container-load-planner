import {describe,it,expect,vi} from 'vitest';
import {runInNewContext} from 'node:vm';
import {pack,improvePacking,validatePacking,restorePackingSnapshot,revisePackingResult} from './engine';
import {parseProductsCsv,toCsvCell} from './csv';
import {offlineFieldHtml} from './field-report';
import {parseNumericDraft} from './numeric-draft';
import {MAX_WORKSPACE_BYTES,serializeWorkspaceBackup,type WorkspaceInputs} from './workspace-file';
import type {ContainerSpec,ProductInput,PackingRequest,PlacedBox,PackingResult} from './types';

const container:ContainerSpec={id:'audit',name:'Audit',length:2000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:20000};
const product:ProductInput={id:'p',sku:'P',name:'P',length:200,width:200,height:1000,weight:1,quantity:6,priority:50,rotationPolicy:'upright',stackable:true,maxStackLayers:0,color:'#123456'};
const request=(products=[product]):PackingRequest=>({container,products,clearance:0,strategy:'maximum',mode:'mixed'});

describe('audit: lock continuation and support',()=>{
 it('creates a new plan revision on lock/unlock and preserves locked coordinates',()=>{
  const original=pack(request([{...product,quantity:1}]));
  const locked=revisePackingResult(original,original.placements.map(b=>({...b,locked:true})),[product]);
  expect(locked.id).not.toBe(original.id);
  expect(()=>revisePackingResult(locked,locked.placements.map(b=>({...b,x:b.x+200})),[product])).toThrow('锁定');
  const unlocked=revisePackingResult(locked,locked.placements.map(b=>({...b,locked:false})),[product]);
  expect(unlocked.id).not.toBe(locked.id);
 });
 it('rejects huge out-of-bounds imported boxes without expanding the spatial index',()=>{
  const plan=pack(request([{...product,quantity:1}]));
  const bad=plan.placements.map(b=>({...b,dx:1e12,dy:1e12,dz:1e12}));
  expect(validatePacking(bad,container,0,[product]).errors.join(' ')).toContain('边界');
 });
 it('fills unused set numbers when a later complete set is locked',()=>{
  const products=[{...product,setCode:'KIT',unitsPerSet:1},{...product,id:'q',sku:'Q',setCode:'KIT',unitsPerSet:1}];
  const original=pack(request(products.map(p=>({...p,quantity:3}))));
  expect(original.placements).toHaveLength(6);
  const anchor=original.placements.find(b=>b.setNumber===3)!;anchor.locked=true;
  const next=improvePacking(original,products);
  expect(next.metrics.loadedCount).toBe(12);
  expect(next.placements.find(b=>b.id===anchor.id)).toMatchObject(anchor);
  expect(next.validation.valid).toBe(true);
  expect([...new Set(next.placements.map(b=>b.setNumber))].sort()).toEqual([1,2,3,4,5,6]);
 });
 it('rejects positive contact with a non-stackable carton even with sufficient other support',()=>{
  const c={...container,length:1000,height:200,doorHeight:200};
  const products=[{...product,id:'a',length:700,width:1000,height:100},{...product,id:'b',length:300,width:1000,height:100,stackable:false},{...product,id:'top',length:1000,width:1000,height:100}];
  const boxes:PlacedBox[]=products.map((p,i)=>({id:p.id,productId:p.id,sku:p.sku,name:p.name,color:p.color,x:i===1?700:0,y:0,z:i===2?100:0,dx:p.length,dy:p.width,dz:p.height,weight:p.weight,orientation:'LWH',layer:i===2?2:1}));
  expect(validatePacking(boxes,c,0,products,'maximum','mixed').valid).toBe(false);
  expect(validatePacking(boxes.filter(b=>b.id!=='b'),c,0,products,'maximum','mixed').valid).toBe(true);
  expect(validatePacking(boxes,c,0,products.map(p=>({...p,stackable:true})),'maximum','mixed').valid).toBe(true);
 });
 it('restores a valid plan beyond 12000 cartons supported by the engine',()=>{
  const count=12001,p={...product,length:100,width:100,height:100,quantity:count};
  const req={...request([p]),container:{...container,length:11000,width:11000,height:100,doorWidth:11000,doorHeight:100}};
  const placements=Array.from({length:count},(_,i)=>({id:`p-${i}`,productId:p.id,sku:p.sku,orientation:'LWH',x:Math.floor(i/110)*100,y:(i%110)*100,z:0,dx:100,dy:100,dz:100,weight:1,layer:1}));
  const restored=restorePackingSnapshot(req,{strategy:'maximum',placements});
  expect(restored.metrics.loadedCount).toBe(count);
  expect(restored.validation.valid).toBe(true);
  const inputs:WorkspaceInputs={...req,strategy:'maximum',customContainers:[],lengthUnit:'mm',weightUnit:'kg',practicalTargetPercent:88,targetVolumePercent:90,targetWeightPercent:90};
  const backup=serializeWorkspaceBackup(inputs,'test',restored,{maximum:restored,practical:{...restored,strategy:'practical'}});
  expect(new TextEncoder().encode(backup).byteLength).toBeLessThanOrEqual(MAX_WORKSPACE_BYTES);
 },20000);
});

it('accepts negative manual offsets while keeping dimensions nonnegative',()=>{
 expect(parseNumericDraft('-100',{min:-20000,max:20000})).toEqual({state:'valid',value:-100});
 expect(parseNumericDraft('-.5',{min:-20000,max:20000})).toEqual({state:'valid',value:-0.5});
 expect(parseNumericDraft('-1',{min:0}).state).toBe('invalid');
 expect(parseNumericDraft('-',{min:-20000}).state).toBe('invalid');
});

function offlineSignature(plan:PackingResult){
 const script=offlineFieldHtml(plan).split('<script>')[1].split('let hash=')[0];
 return runInNewContext(`${script};signature;`) as string;
}
describe('audit: offline progress belongs to the actual cargo',()=>{
 it('does not reuse progress for identical geometry with a different SKU or weight',()=>{
  const plan=pack(request([{...product,quantity:1}]));
  const changed=(field:'sku'|'weight',value:string|number)=>({...plan,placements:plan.placements.map(b=>({...b,[field]:value}))});
  expect(offlineSignature(plan)).not.toBe(offlineSignature(changed('sku','NEW-SKU')));
  expect(offlineSignature(plan)).not.toBe(offlineSignature(changed('weight',50)));
  expect(offlineSignature(plan)).toBe(offlineSignature({...plan,id:'restored'}));
 });
});

describe('audit: CSV never silently changes physical constraints',()=>{
 const csv=(changes:Record<string,string|undefined>)=>{const row={sku:'A',name:'Box',length:'100',width:'100',height:'100',weight:'31',quantity:'1',...changes};return Object.keys(row).join(',')+'\n'+Object.values(row).map(toCsvCell).join(',');};
 it.each([{weight:'31kg'},{weight:''},{weight:'-1'},{quantity:'many'},{length:'0'},{rotationPolicy:'uprigth'},{stackable:'flase'},{quantity:'3.9'},{unitsPerSet:'2.8'},{priority:'999'},{maxStackLayers:'120'}])('rejects invalid supplied fields %j',changes=>{
  expect(()=>parseProductsCsv(csv(changes),[])).toThrow(/第 2 行/);
 });
 it('keeps missing optional defaults and reads zero bearing limits',()=>{
  const p=parseProductsCsv(csv({maxTopLoadKg:'0'}),[])[0];
  expect(p.maxTopLoadKg).toBe(0);expect(p.priority).toBe(50);expect(p.unitsPerSet).toBe(1);
 });
 it('keeps explicit bearing kilograms when gross weight uses pounds',()=>{
  const p=parseProductsCsv(csv({weightUnit:'lb',maxTopLoadKg:'100',topLoadHeightKg:'0',topLoadWidthKg:'20',allowedAboveSkus:'["A","B"]'}),[])[0];
  expect(p.maxTopLoadKg).toBe(100);
  expect(p.topLoadByVerticalAxis).toEqual({height:0,width:20});
  expect(p.weight).toBeCloseTo(14.06136347);
  expect(p.allowedAboveSkus).toEqual(['A','B']);
 });
});

it('fleet worker returns completed comparisons even if optional top-up fails',async()=>{
 const messages:Array<{type:string;proposalError?:string;comparisons?:Array<{result:{complete:boolean}}>}> = [];
 const worker={onmessage:undefined as unknown as (event:unknown)=>void,postMessage:(message:typeof messages[number])=>messages.push(message)};
 vi.stubGlobal('self',worker);
 try{
  await import('./fleet.worker');
  worker.onmessage({data:{request:request([{...product,quantity:1}]),options:[{container,cost:100,available:2}],limit:2,objective:'cost',compare:true,topUp:21}});
  expect(messages.some(m=>m.type==='comparisons')).toBe(true);
  const final=messages.at(-1)!;
  expect(final.type).toBe('comparison-result');
  expect(final.comparisons?.[0].result.complete).toBe(true);
  expect(final.proposalError).toContain('0–20%');
 }finally{vi.unstubAllGlobals();}
});
