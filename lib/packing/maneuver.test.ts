import {describe,it,expect} from 'vitest';
import {findManeuverRoute,parseAccessConfig,DEFAULT_ACCESS} from './maneuver';
import {auditAccess} from './access';
import {pack} from './engine';
import type {PlacedBox,PackingResult,ProductInput} from './types';
const product:ProductInput={id:'p',sku:'P',name:'P',length:200,width:200,height:200,weight:10,quantity:1,priority:50,rotationPolicy:'fixed',stackable:true,maxStackLayers:0,color:'#338899'};
const base=pack({mode:'mixed',strategy:'maximum',container:{id:'c',name:'C',length:1600,width:1400,height:1400,doorWidth:1400,doorHeight:1400,maxWeight:1000},clearance:0,products:[product]});
const cargo=(patch:Partial<PlacedBox>={}):PlacedBox=>({...base.placements[0],x:100,y:100,z:0,dx:200,dy:200,dz:200,...patch});
const config={...DEFAULT_ACCESS,maneuver:true,maxLift:500};
describe('continuous clearance witnesses',()=>{
 it('passes the centered door only after lateral travel and saves an explicit path',()=>{const b=cargo(),plan={...base,container:{...base.container,doorWidth:600}};const route=findManeuverRoute(b,[],plan,config);expect(route.status).toBe('verified');expect(route.steps.some(s=>s.y>=400)).toBe(true);expect(route.steps.at(-1)!.x).toBeGreaterThanOrEqual(plan.container.length);});
 it('lifts over an obstruction and rejects the same sweep when the allowed lift is insufficient',()=>{const b=cargo(),obstacle=cargo({id:'other',x:600,y:0,dx:200,dy:1400,dz:300});const route=findManeuverRoute(b,[obstacle],base,config);expect(route.status).toBe('verified');expect(route.maxLift).toBeGreaterThanOrEqual(300);expect(findManeuverRoute(b,[obstacle],base,{...config,maxLift:100}).status).toBe('not-found');});
 it('turns a wide load inside clear space to pass a narrower door; preserves quarter-turn states',()=>{const b=cargo({x:100,y:250,dx:300,dy:800}),plan={...base,container:{...base.container,doorWidth:500}};expect(findManeuverRoute(b,[],plan,{...config,turn:false}).status).toBe('not-found');const route=findManeuverRoute(b,[],plan,config);expect(route.status).toBe('verified');expect(route.turns).toBeGreaterThan(0);expect(route.steps.at(-1)!.dy).toBe(300);});
 it('keeps support dependencies and stops distinct from route proofs',()=>{const a=cargo({id:'a'}),b=cargo({id:'b',productId:'upper',z:200});const plan:PackingResult={...base,placements:[a,b],accessConfig:config,delivery:{p:{customer:'C',destination:'D',stop:1},upper:{customer:'C',destination:'D',stop:2}}};const report=auditAccess(plan);expect(report.issues.some(i=>i.id==='a'&&i.reason==='support')).toBe(true);expect(Object.keys(report.routes)).toHaveLength(4);});
 it('validates finite route budgets, lift and handling margins on restoration',()=>{expect(parseAccessConfig(config)).toEqual(config);expect(()=>parseAccessConfig({...config,maxLift:NaN})).toThrow();expect(()=>parseAccessConfig({...config,budget:5001})).toThrow();});
});
it('lowers elevated cargo before exiting a lower door, within the configured vertical adjustment',()=>{const b=cargo({z:800}),plan={...base,container:{...base.container,doorHeight:600}};const route=findManeuverRoute(b,[],plan,config);expect(route.status).toBe('verified');expect(route.maxDrop).toBeGreaterThanOrEqual(400);expect(findManeuverRoute(b,[],plan,{...config,maxLift:100}).status).toBe('not-found');});
