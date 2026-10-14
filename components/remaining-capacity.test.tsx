import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemainingCapacity } from './remaining-capacity';
import type { PackingResult } from '../lib/packing/types';
const result={strategy:'practical',validation:{valid:true,errors:[]},container:{length:1000,width:1000,height:1000,maxWeight:100},clearance:0,placements:[{productId:'a',dx:500,dy:500,dz:500,weight:10},{productId:'a',dx:500,dy:500,dz:500,weight:10}],summaries:[{productId:'a',loaded:2,loadedVolume:250000000,loadedWeight:20}],metrics:{loadedVolume:250000000},pallets:[]} as unknown as PackingResult;
it('updates used space and payload at the first and last loading steps',()=>{
  const first=renderToStaticMarkup(<RemainingCapacity result={result} visibleCount={1}/>);
  expect(first).toContain('0.13 / 1.00');expect(first).toContain('0.88');expect(first).toContain('90 <small>kg');
  const all=renderToStaticMarkup(<RemainingCapacity result={result} visibleCount={2}/>);
  expect(all).toContain('0.25 / 1.00');expect(all).toContain('0.75');expect(all).toContain('80 <small>kg');
});
it('counts placed pallet space and tare before cargo enters',()=>{
  const r={...result,pallets:[{dx:1000,dy:1000,dz:100,weight:5}]} as PackingResult;
  const html=renderToStaticMarkup(<RemainingCapacity result={r} visibleCount={0}/>);
  expect(html).toContain('0.10 / 1.00');expect(html).toContain('0.90');expect(html).toContain('95 <small>kg');
});
it('clamps progress and hides references for an invalid plan',()=>{
  expect(renderToStaticMarkup(<RemainingCapacity result={result} visibleCount={500}/>)).toContain('80 <small>kg');
  const html=renderToStaticMarkup(<RemainingCapacity result={{...result,validation:{valid:false,errors:['collision']}}} visibleCount={1}/>);
  expect(html).toContain('未通过校验');expect(html).not.toContain('90 <small>kg');
});
