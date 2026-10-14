import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {OrthographicViews} from './orthographic-views';
import {pack} from '../lib/packing/engine';
import {defaultSolidModel} from '../lib/packing/solid-model';
const p={id:'tube',sku:'TUBE',name:'Tube',cargoShape:'tube' as const,solidModel:defaultSolidModel('tube',[600,600,300]),length:600,width:600,height:300,weight:10,quantity:1,priority:1,rotationPolicy:'fixed' as const,stackable:true,maxStackLayers:0,color:'#338899'};
it('prints the same actual shape outlines for top, side and door views',()=>{
  const result=pack({mode:'mixed',strategy:'maximum',clearance:0,container:{id:'c',name:'C',length:1200,width:1200,height:1200,doorWidth:1200,doorHeight:1200,maxWeight:100},products:[p]});
  const html=renderToStaticMarkup(<OrthographicViews result={result} visibleCount={1} visibleProducts={new Set(['tube'])} primaryCountLabel="1" activeView="top" onViewSelect={()=>{}} renderPrintSvg/>);
  expect(html.match(/data-cargo-projection=/g)).toHaveLength(3);expect(html).toContain('fill-rule="nonzero"');
  const top=html.match(/data-cargo-projection="top"[^>]* d="([^"]*)"/)![1];expect(top.split('M').length).toBeGreaterThan(20);
  const hidden=renderToStaticMarkup(<OrthographicViews result={result} visibleCount={0} visibleProducts={new Set(['tube'])} primaryCountLabel="0" activeView="top" onViewSelect={()=>{}} renderPrintSvg/>);expect(hidden).not.toContain('data-cargo-projection=');
});
