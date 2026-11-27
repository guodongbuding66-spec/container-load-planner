import {describe,it,expect} from 'vitest';
import {pack} from './engine';
import {suggestGapFill} from './trade-optimizers';
import type {ContainerSpec,ProductInput} from './types';
const c:ContainerSpec={id:'r9',name:'R9',length:2000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:1000,rearDoorClearanceMm:500};
const p:ProductInput={id:'a',sku:'A',name:'A',length:250,width:250,height:250,weight:10,quantity:10,priority:50,rotationPolicy:'fixed',stackable:true,maxStackLayers:0,color:'#123456'};
const solve=(ct:ContainerSpec,ps:ProductInput[])=>pack({container:ct,products:ps,mode:'mixed',strategy:'maximum',clearance:0});
describe('revision 9 independent gap-fill regressions',()=>{
 it('uses the validated usable volume including rear buffer and exclusion union',()=>{
  const ct={...c,exclusions:[{id:'ob',name:'ob',kind:'obstacle' as const,x:0,y:0,z:0,dx:250,dy:250,dz:1000}]};const plan=solve(ct,[p]);const r=suggestGapFill(plan,[p],{strategy:'max_volume'});
  expect(r.beforeVolumePct).toBe(Number((plan.metrics.volumeUtilization*100).toFixed(1)));
 });
 it('cannot raise the rated payload using an advisory option',()=>{const ct={...c,maxWeight:120};const r=suggestGapFill(solve(ct,[p]),[p],{strategy:'max_volume',maxPayloadKg:10000});expect(r.suggestions.reduce((s,x)=>s+x.addedWeightKg,100)).toBeLessThanOrEqual(120);});
 it('does not top up a SKU with unfulfilled original demand',()=>{const q={...p,height:1000,length:1000,width:1000,quantity:8};const r=suggestGapFill(solve(c,[q]),[q],{strategy:'max_volume'});expect(r.suggestions).toEqual([]);});
 it('does not recommend a zero-order oversized SKU that cannot pass the door',()=>{const q={...p,id:'b',sku:'B',width:1100,height:100,quantity:0};const r=suggestGapFill(solve(c,[p,q]),[p,q],{strategy:'max_volume',candidateSkuIds:['b']});expect(r.suggestions).toEqual([]);});
 it('preserves complete kits and per-row order increments when adding cartons',()=>{const ps=[{...p,setCode:'KIT',unitsPerSet:2,quantity:4},{...p,id:'b',sku:'B',setCode:'KIT',unitsPerSet:1,quantity:2}];const r=suggestGapFill(solve(c,ps),ps,{strategy:'max_volume',minAddIncrement:{a:3,b:2}});const a=r.suggestions.find(s=>s.productId==='a')!.recommendedAddQty,b=r.suggestions.find(s=>s.productId==='b')!.recommendedAddQty;expect(a).toBe(b*2);expect(a%3).toBe(0);expect(b%2).toBe(0);});
});
