import { parseFloorPalletConfig, palletCargoCeiling } from "./floor-pallets";
import type { ContainerSpec, FloorPalletConfig, PlacedBox, PlacedPallet } from "./types";
export type Palletization={config:FloorPalletConfig;mix:"single"|"mixed"};
export function parsePalletization(value:unknown):Palletization|undefined{
  if(value===undefined)return undefined;
  if(!value||typeof value!=="object")throw new Error("Invalid prebuilt pallets");
  const p=value as Palletization;if(!["single","mixed"].includes(p.mix))throw new Error("Invalid pallet mix");
  return {config:parseFloorPalletConfig(p.config),mix:p.mix};
}
export function validatePalletizedCargo(boxes:PlacedBox[],pallets:PlacedPallet[],container:ContainerSpec,clearance:number,value:Palletization){
  const config=parseFloorPalletConfig(value.config),errors:string[]=[],EPS=.0001;
  if(!pallets.length&&boxes.length)errors.push("Prebuilt cargo has no pallets");
  for(const p of pallets){const expected=p.orientation==="LWH"?[config.length,config.width]:[config.width,config.length];if(Math.abs(p.dx-expected[0])>EPS||Math.abs(p.dy-expected[1])>EPS||Math.abs(p.dz-config.height)>EPS||p.weight!==config.weight||p.maxLoad!==config.maxLoad)errors.push("Prebuilt pallet specification mismatch");}
  for(const b of boxes){const supports=pallets.filter(p=>b.x>=p.x-EPS&&b.y>=p.y-EPS&&b.x+b.dx<=p.x+p.dx+EPS&&b.y+b.dy<=p.y+p.dy+EPS&&b.z>=p.dz-EPS);if(supports.length!==1)errors.push(`${b.sku}: cargo must remain within one complete pallet`);if(b.z+b.dz>palletCargoCeiling(container,clearance,config)+EPS)errors.push(`${b.sku}: loaded pallet exceeds door or height limit`);}
  if(value.mix==="single")for(const p of pallets){const cargo=boxes.filter(b=>b.x>=p.x-EPS&&b.y>=p.y-EPS&&b.x+b.dx<=p.x+p.dx+EPS&&b.y+b.dy<=p.y+p.dy+EPS),keys=new Set(cargo.map(b=>b.setCode?`set:${b.setCode}`:`sku:${b.productId}`));if(keys.size>1)errors.push("Single-product pallet contains mixed cargo");}
  return errors;
}
