import {expect,it} from 'vitest';
import {cargoShapeProjections} from './cargo-shape-geometry';
import {defaultSolidModel} from './solid-model';
import {pointInPolygon} from './solid-math';
import {ORIENTATION_CODES} from './loading-rules';
const tube={solidModel:defaultSolidModel('tube',[600,600,300])};
const covered=(p:[number,number],view:'top'|'side'|'door',orientation='LWH')=>cargoShapeProjections(tube,orientation as 'LWH',view).some(poly=>pointInPolygon(p,poly));
it('projects tube bores in the appropriate view after all axis rotations',()=>{
  for(const code of ORIENTATION_CODES){const axial=code.indexOf('H'),view=axial===2?'top':axial===1?'side':'door';expect(covered([0,0],view,code),code).toBe(false);expect(covered([.4,0],view,code),code).toBe(true);}
  expect(covered([0,0],'side')).toBe(true);expect(covered([0,0],'door')).toBe(true);
});
it('preserves a custom concave section instead of filling its notch',()=>{
  const p={solidModel:defaultSolidModel('custom-prism',[600,300,600])},polys=cargoShapeProjections(p,'LWH','side');
  expect(polys.some(poly=>pointInPolygon([.3,.3],poly))).toBe(false);expect(polys.some(poly=>pointInPolygon([-.4,-.4],poly))).toBe(true);
});
it.each(['tube','reel','bend','frustum','ellipsoid','capsule','l-profile','u-profile','step'] as const)('keeps every %s projection finite and within the occupied envelope',shape=>{
  const p={solidModel:defaultSolidModel(shape,[600,400,300])};
  for(const orientation of ORIENTATION_CODES)for(const view of ['top','side','door'] as const){
    const polygons=cargoShapeProjections(p,orientation,view);
    expect(polygons.length).toBeGreaterThan(0);expect(polygons.flat().flat().every(n=>Number.isFinite(n)&&Math.abs(n)<=.500001)).toBe(true);
  }
});
