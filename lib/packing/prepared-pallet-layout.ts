import {validOrientationSigns} from "./cargo-body";
import {MAX_VISIBLE_PLACEMENTS} from "./engine";
import {palletCargoCeiling} from "./floor-pallets";
import {looseReservationErrors} from "./loose-cargo";
import {packagingInterior} from "./packaging";
import type {PackingRequest, PackingResult, PalletBuildOptions, PlacedBox} from "./types";

type PreparedCarton = Pick<PlacedBox,"productId"|"x"|"y"|"z"|"dx"|"dy"|"dz"|"weight"|"layer"|"orientation"|"orientationSigns"|"setCode"|"setNumber"|"setItemNumber">;
export type PreparedPalletLayout = {version:1; units:{specificationId:string; cartons:PreparedCarton[]}[]};

export function parsePreparedPalletLayout(value:unknown):PreparedPalletLayout|undefined {
  if(value===undefined)return undefined;
  const invalid = () => new Error("人工托内布置格式无效 / Invalid manual pallet layout");
  const layout=value as PreparedPalletLayout|null;
  if(layout?.version!==1||!Array.isArray(layout.units)||layout.units.length<1||layout.units.length>200)throw invalid();
  let total=0;
  const units=layout.units.map(unit=>{
    if(!unit||typeof unit.specificationId!=="string"||!unit.specificationId||unit.specificationId.length>120||
      !Array.isArray(unit.cartons)||!unit.cartons.length||(total+=unit.cartons.length)>MAX_VISIBLE_PLACEMENTS)throw invalid();
    const cartons=unit.cartons.map((box:PreparedCarton)=>{
      if(!box||typeof box.productId!=="string"||box.productId.length>120||
        [box.x,box.y,box.z].some(n=>!Number.isFinite(n)||n<-.0001||n>200000)||
        [box.dx,box.dy,box.dz].some(n=>!Number.isFinite(n)||n<=0||n>100000)||
        !Number.isFinite(box.weight)||box.weight<0||!Number.isSafeInteger(box.layer)||box.layer<1||box.layer>MAX_VISIBLE_PLACEMENTS||
        !["LWH","LHW","WLH","WHL","HLW","HWL"].includes(box.orientation)||!validOrientationSigns(box.orientation,box.orientationSigns))throw invalid();
      const {productId,x,y,z,dx,dy,dz,weight,layer,orientation,orientationSigns,setCode,setNumber,setItemNumber}=box;
      const kit=setCode!==undefined||setNumber!==undefined||setItemNumber!==undefined;
      if(kit&&(typeof setCode!=="string"||!setCode.trim()||setCode.length>80||
        !Number.isSafeInteger(setNumber)||setNumber!<1||!Number.isSafeInteger(setItemNumber)||setItemNumber!<1))throw invalid();
      return {productId,x,y,z,dx,dy,dz,weight,layer,orientation,...(orientationSigns?{orientationSigns}:{}),
        ...(kit?{setCode,setNumber,setItemNumber}:{})};
    });
    return {specificationId:unit.specificationId,cartons};
  });
  return {version:1,units};
}

/** Store local coordinates relative to the outer pallet corner and top of its deck. */
export function capturePreparedPalletLayout(plan:PackingResult):PreparedPalletLayout {
  if(!plan.palletization?.only||!plan.validation.valid)throw Error("请使用已校验的打托预览 / Use a validated pallet preview");
  const cargo=new Map<string,PlacedBox[]>();
  for(const box of plan.placements){
    const id=box.palletIds?.[0];
    if(!id)throw Error("箱体缺少托盘归属 / Carton has no pallet");
    const list=cargo.get(id)??[];
    list.push(box);
    cargo.set(id,list);
  }
  if(!cargo.size)throw Error("请至少保留一个有货物的托盘 / Keep at least one pallet with cargo");
  const units=(plan.pallets??[]).filter(p=>cargo.has(p.id)).map(p=>{
    if(p.orientation!=="LWH"||p.z!==0)throw Error("打托预览的坐标基准无效 / Invalid pallet preview origin");
    return {specificationId:p.specificationId??"primary",cartons:cargo.get(p.id)!.map(b=>({
      productId:b.productId,x:b.x-p.x,y:b.y-p.y,z:b.z-p.dz,
      dx:b.dx,dy:b.dy,dz:b.dz,weight:b.weight,layer:b.layer,orientation:b.orientation,
      orientationSigns:b.orientationSigns,setCode:b.setCode,setNumber:b.setNumber,setItemNumber:b.setItemNumber,
    }))};
  });
  return parsePreparedPalletLayout({version:1,units})!;
}

/** Inspection uses the same available stock and loose allocations as vehicle loading. */
export function palletPreparationRequest(request:PackingRequest,build:PalletBuildOptions):PackingRequest {
  const errors=looseReservationErrors(build.looseQuantities,request.products,request.workflow==="pallet-only");
  if(errors.length)throw Error(errors.join("; "));
  const previewConfig = (config:PalletBuildOptions["config"]) => request.workflow==="palletized"&&!packagingInterior(config).crate
    ? {...config,maxCargoHeight:Math.max(0,palletCargoCeiling(request.container,request.clearance,config)-config.height)}
    : config;
  return {...request,workflow:"pallet-only",strategy:"practical",clearance:0,delivery:undefined,accessConfig:undefined,floorPallets:undefined,
    container:{...request.container,exclusions:undefined,engineering:undefined},
    products:request.products.map(p=>({...p,quantity:p.quantity-(build.looseQuantities?.[p.id]??0)})),
    palletBuild:{...build,looseQuantities:undefined,config:previewConfig(build.config),
      ...(build.additionalSpecs?{additionalSpecs:build.additionalSpecs.map(s=>({...s,config:previewConfig(s.config)}))}:{})}};
}
