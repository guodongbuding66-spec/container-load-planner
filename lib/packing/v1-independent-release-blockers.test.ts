// Copy into lib/packing/ of the exact source ZIP; npm run test:unit -- is not
// used here because the project wrapper already fixes the arguments. Run:
// npx vitest run --config vitest.config.ts lib/packing/v1-independent-release-blockers.test.ts
import {describe,it,expect} from 'vitest';
import {pack,restorePackingSnapshot,validatePacking} from './engine';
import {auditPackingResult} from './result-audit';
import type {ContainerSpec,ProductInput,PackingRequest} from './types';
const container:ContainerSpec={id:'qa',name:'QA',length:1000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:100000};
const product:ProductInput={id:'A',sku:'A',name:'A',length:1000,width:1000,height:300,weight:10,quantity:8,priority:50,rotationPolicy:'fixed',stackable:true,maxStackLayers:0,color:'#123456',nestingDeltaHeightMm:100};
describe('Independent release blockers',()=>{
 for(const mode of ['mixed','single'] as const){
  it(`preserves nesting volume across JSON restore (${mode})`,()=>{
   const req:PackingRequest={container,products:[product],mode,strategy:'maximum',clearance:0};
   const initial=pack(req),restored=restorePackingSnapshot(req,JSON.parse(JSON.stringify(initial)));
   expect(initial.placements).toHaveLength(8);expect(initial.metrics.volumeUtilization).toBe(1);
   expect(restored.metrics.loadedCount).toBe(8);expect(restored.metrics.grossWeight).toBe(80);
   expect(restored.metrics.loadedVolume).toBe(initial.metrics.loadedVolume);
   expect(restored.metrics.volumeUtilization).toBe(1);
   expect(restored.placements.map(b=>b.nestedDepth??0)).toEqual(initial.placements.map(b=>b.nestedDepth??0));
  });
  it(`accepts a correctly nested plan in the independent audit (${mode})`,()=>{
   const req:PackingRequest={container,products:[product],mode,strategy:'maximum',clearance:0};
   const plan=pack(req);expect(plan.validation.valid).toBe(true);
   expect(auditPackingResult(plan,[product]).hasErrors).toBe(false);
  });
 }
 it('rejects a placement within reserved rear door buffer in the independent audit',()=>{
  const ct={...container,length:2000,rearDoorClearanceMm:500};
  const p={...product,length:500,height:1000,quantity:1,nestingDeltaHeightMm:undefined};
  const req:PackingRequest={container:ct,products:[p],mode:'mixed',strategy:'maximum',clearance:0};
  const source=pack(req);const modified={...source,placements:source.placements.map(b=>({...b,x:1500}))};
  expect(validatePacking(modified.placements,ct,0,[p],'maximum','mixed').valid).toBe(false);
  expect(auditPackingResult(modified,[p]).hasErrors).toBe(true);
 });
});
