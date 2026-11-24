import {expect,it} from "vitest";
import {Vector3} from "three";
import {packagingWireframeGeometry} from "./packaging-wireframe";
import {packagingParts,DEFAULT_PACKAGING} from "./packaging";
it("keeps every structural edge inside its physical part after scene scaling",()=>{
 const parts=packagingParts(1240,740,144,{...DEFAULT_PACKAGING,enclosure:"panel",lid:true},320),scale=3/1240,offset=new Vector3(-1.5,0,-740*scale/2);
 const g=packagingWireframeGeometry(parts,scale,offset),a=g.getAttribute("position");expect(a.count).toBe(parts.length*24);
 for(let p=0;p<parts.length;p++){const part=parts[p];for(let n=p*24;n<(p+1)*24;n++){
  const x=(a.getX(n)-offset.x)/scale,y=(a.getZ(n)-offset.z)/scale,z=(a.getY(n)-offset.y)/scale;
  expect(x).toBeGreaterThanOrEqual(part.x-.001);expect(x).toBeLessThanOrEqual(part.x+part.dx+.001);
  expect(y).toBeGreaterThanOrEqual(part.y-.001);expect(y).toBeLessThanOrEqual(part.y+part.dy+.001);
  expect(z).toBeGreaterThanOrEqual(part.z-.001);expect(z).toBeLessThanOrEqual(part.z+part.dz+.001);
 }}g.dispose();
});
