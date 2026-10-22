import {cargoShapeOf,type ShapeFields} from "./cargo-shape";
import type {V2} from "./solid-math";
/** Original L/H outline, extruded along W. Shared by display and exact feature picking. */
export function cargoSectionOutline(p:ShapeFields):V2[]|null {
  const t=p.shapeWallRatio??.25,h=p.shapeWallHeightRatio??.25;
  switch(cargoShapeOf(p)){
    case "box":return [[0,0],[1,0],[1,1],[0,1]];
    case "l-profile":return [[0,0],[1,0],[1,h],[t,h],[t,1],[0,1]];
    case "u-profile":return [[0,0],[1,0],[1,1],[1-t,1],[1-t,h],[t,h],[t,1],[0,1]];
    case "t-profile":return [[(1-t)/2,0],[(1+t)/2,0],[(1+t)/2,1-h],[1,1-h],[1,1],[0,1],[0,1-h],[(1-t)/2,1-h]];
    case "step":{const l=p.shapeStepLengthRatio??.5,z=p.shapeStepHeightRatio??.5;return [[0,0],[1,0],[1,z],[l,z],[l,1],[0,1]];}
    case "wedge":return [[0,0],[1,0],[0,1]];
    case "trapezoid":{const r=p.shapeTopRatio??.5;return [[0,0],[1,0],[(1+r)/2,1],[(1-r)/2,1]];}
    default:return null;
  }
}
