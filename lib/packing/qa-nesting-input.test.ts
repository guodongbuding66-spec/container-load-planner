import {describe,it,expect} from 'vitest';
import {pack} from './engine';
import {parseProductInput} from './workspace-file';
import {SAMPLE_PRODUCTS} from './presets';
const product={...SAMPLE_PRODUCTS[0],length:500,width:400,height:300,quantity:8,rotationPolicy:'fixed' as const};
const container={id:'qa',name:'QA',length:1000,width:800,height:1200,doorWidth:800,doorHeight:1200,maxWeight:10000};
describe('nesting input contract',()=>{
 for(const delta of [-10,301,Infinity,NaN])it(`rejects ${delta} in the engine and restore parser`,()=>{
  const p={...product,nestingDeltaHeightMm:delta};
  expect(()=>pack({container,products:[p],mode:'mixed',strategy:'maximum',clearance:0})).toThrow(/ΔH/);
  expect(()=>parseProductInput(p)).toThrow(/ΔH/);
 });
 for(const delta of [0,100,300])it(`accepts ${delta} consistently`,()=>{
  const p={...product,nestingDeltaHeightMm:delta};
  expect(parseProductInput(p).nestingDeltaHeightMm).toBe(delta);
  expect(pack({container,products:[p],mode:'mixed',strategy:'maximum',clearance:0}).validation.valid).toBe(true);
 });
});
