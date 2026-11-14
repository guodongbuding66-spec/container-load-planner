import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z0-9]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
const repo=new URL('../../../',import.meta.url).pathname;
const {parseWorkspaceBackup,restoreWorkspacePlans}=await import(repo+'/lib/packing/workspace-file.ts');
const {planCrateStackReview}=await import(repo+'/lib/packing/crate-auto-stack.ts');
const manifest=JSON.parse(readFileSync(new URL('./v0.81.4-acceptance.json',import.meta.url),'utf8'));
const names=Object.keys(manifest.cases);
let baseline;
for(const name of names){
 const bytes=gunzipSync(readFileSync(new URL('v0.81.4-'+name+'.gz',import.meta.url)));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.cases[name].sha256);
 const text=bytes.toString('utf8'),raw=JSON.parse(text),input=parseWorkspaceBackup(text),plan=restoreWorkspacePlans(text,input);
 const expected=manifest.cases[name],build=input.palletBuild;
 assert.equal(raw.engineVersion,expected.engine);
 assert.equal(build.primaryRule.cartonLimit,expected.perPallet);
 assert.deepEqual([build.config.length,build.config.width,build.config.maxCargoHeight],expected.dimensions);
 assert.deepEqual(build.config.unitStacking,expected.unitStacking);
 assert.deepEqual({total:build.maxPallets,primary:build.primaryRule.maxPallets},expected.supply);
 if(!baseline)baseline=input;
 else {
  assert.deepEqual(input.products,baseline.products);
  assert.deepEqual(input.container,baseline.container);
  assert.deepEqual(build.config.unitStacking,{enabled:true,maxLayers:0});
  assert.deepEqual(expected.supply,{total:200,primary:200});
 }
 if(name==='main-252.json')assert.deepEqual(expected.dimensions,[baseline.palletBuild.config.length,baseline.palletBuild.config.width,baseline.palletBuild.config.maxCargoHeight]);
 const outputs=[];
 for(const [strategy,p] of Object.entries(plan.strategyPlans??{[plan.strategy]:plan})){
  assert.equal(p.validation.valid,true);assert.equal(input.products.reduce((n,v)=>n+v.quantity,0),596);
  const cells=planCrateStackReview(p);assert.deepEqual(cells.errors,[]);
  for(const unit of p.pallets){
   const boxes=p.placements.filter(b=>b.palletIds?.includes(unit.id));
   assert.ok(boxes.length<=input.palletBuild.primaryRule.cartonLimit);
   assert.ok(unit.z+unit.enclosureHeight<=input.container.height-input.clearance+.0001);
   for(const b of boxes){assert.ok(b.z>=unit.z+unit.dz-.0001);assert.ok(b.z+b.dz<=unit.z+unit.enclosureHeight-30+.0001);}
  }
  assert.equal(p.metrics.grossWeight,p.placements.reduce((n,b)=>n+b.weight,0)+p.pallets.reduce((n,b)=>n+b.weight,0));
  outputs.push({strategy,cartons:p.metrics.loadedCount,pallets:p.pallets.length,aboveFloor:p.pallets.filter(v=>v.z>0).length,tiers:Math.max(...cells.cells.map(v=>v.level)),maxBaseZ:Math.max(...p.pallets.map(v=>v.z)),grossWeight:p.metrics.grossWeight});
 }
 assert.deepEqual(outputs,manifest.cases[name].outputs);
 console.log(JSON.stringify({name,engine:raw.engineVersion,perPallet:input.palletBuild.primaryRule.cartonLimit,dimensions:[input.palletBuild.config.length,input.palletBuild.config.width,input.palletBuild.config.maxCargoHeight],unitStacking:input.palletBuild.config.unitStacking,outputs}));
}
