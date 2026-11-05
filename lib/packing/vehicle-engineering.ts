import {accessoryRegions} from "./container-accessories";
import {bodyBottomPatches,bodyContactArea,bodyTopLevels,intersectSurface,surfaceArea,supportedSurfaceArea,type Surface} from "./cargo-body";
import {cargoShapeOf,isRectilinearShape,type ShapeFields} from "./cargo-shape";
import {modelMassCenter} from "./model-body";
import {packagingMassCenter,placedPackagingParts} from "./packaging";
import {palletLoadEnvelope} from "./unit-envelope";
import type {ContainerSpec,PackingResult,PlacedBox,PlacedPallet} from "./types";

const EPS=.0001;
export const MAX_FLOOR_ZONES=16;
type FloorZone={id:string;name:string;x:number;y:number;dx:number;dy:number;maxKg:number};
export type VehicleEngineering={version:1;source:string;revision:string;maxContactKgM2:number|null;zones:FloorZone[];balance?:{minX:number;maxX:number;minY:number;maxY:number}};

/** Limits and zone coordinates are explicitly supplied against one measured vehicle interior. */
export function parseVehicleEngineering(raw:unknown,container:Pick<ContainerSpec,"length"|"width">):VehicleEngineering|undefined{
 if(raw===undefined)return undefined;
 const fail=()=>{throw Error("请核对工程限值、柜内坐标、来源与版本 / Check engineering limits, interior coordinates, source and revision");};
 const record=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
 const text=(v:unknown,max:number)=>typeof v==="string"&&v.trim()&&v.length<=max?v.trim():fail();
 const num=(v:unknown,min:number,max:number)=>typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max?v:fail();
 const v=record(raw);
 if(v.version!==1||!Array.isArray(v.zones)||v.zones.length>MAX_FLOOR_ZONES)return fail();
 const maxContactKgM2=v.maxContactKgM2===null?null:num(v.maxContactKgM2,.001,1e9);
 const ids=new Set<string>();
 const zones=v.zones.map(value=>{
  const z=record(value),id=text(z.id,80),name=text(z.name,100),x=num(z.x,0,container.length),y=num(z.y,0,container.width);
  const dx=num(z.dx,.001,container.length-x),dy=num(z.dy,.001,container.width-y);
  if(!/^[-\w]+$/.test(id)||ids.has(id))return fail();ids.add(id);
  return {id,name,x,y,dx,dy,maxKg:num(z.maxKg,.001,1e6)};
 });
 let balance:VehicleEngineering["balance"];
 if(v.balance!==undefined){
  const b=record(v.balance),minX=num(b.minX,0,container.length),minY=num(b.minY,0,container.width);
  balance={minX,maxX:num(b.maxX,minX,container.length),minY,maxY:num(b.maxY,minY,container.width)};
 }
 if(maxContactKgM2===null&&!zones.length&&!balance)return fail();
 return {version:1,source:text(v.source,500),revision:text(v.revision,120),maxContactKgM2,zones,...(balance?{balance}:{})};
}

type ContactNode={body:PlacedBox;shape?:ShapeFields;pads?:Surface[];canSupport:boolean};
type VehiclePlan=Pick<PackingResult,"container"|"clearance"|"placements"|"pallets"|"palletization"|"cargoDetails">;
const physicalBox=(id:string,name:string,body:Pick<PlacedBox,"x"|"y"|"z"|"dx"|"dy"|"dz">,weight:number):PlacedBox=>
 ({...body,id,productId:id,name,sku:name,weight,layer:1,orientation:"LWH",color:"#826444"});

function packagingNode(p:PlacedPallet,cargo:PlacedBox[],prebuilt:boolean):ContactNode{
 const extent=prebuilt?palletLoadEnvelope(p,cargo):p;
 const known=!!p.packaging&&(!!p.packaging.measurements||p.packaging.base==="solid");
 return {body:physicalBox(p.id,p.name,extent,p.weight+cargo.reduce((n,b)=>n+b.weight,0)),canSupport:true,
  pads:known?placedPackagingParts(p).filter(b=>Math.abs(b.z-p.z)<=EPS):undefined};
}

/** Vertical upper bounds attribute each upper load to every possible supporting path. */
export function reviewVehicleEngineering(plan:VehiclePlan){
 const {container,clearance,placements,cargoDetails,palletization}=plan,profile=parseVehicleEngineering(container.engineering,container);
 if(!profile)return undefined;
 const pallets=plan.pallets??[],cargoByUnit=new Map<string,PlacedBox[]>();
 const nodes:ContactNode[]=[];
 const masses:{weight:number;x:number;y:number}[]=[];
 for(const b of placements){
  const shape=cargoDetails?.[b.productId],center=modelMassCenter(b,shape??{});
  masses.push({weight:b.weight,x:center[0],y:center[1]});
  if(palletization&&b.palletIds?.length){
   const id=b.palletIds[0],row=cargoByUnit.get(id)??[];row.push(b);cargoByUnit.set(id,row);
  }else{
   const flat=!shape||cargoShapeOf(shape)==="box"||isRectilinearShape(shape)||!!shape.solidModel;
   nodes.push({body:b,shape,pads:flat?bodyBottomPatches(b,shape):undefined,canSupport:true});
  }
 }
 for(const p of pallets){
  const center=packagingMassCenter(p);masses.push({weight:p.weight,x:center[0],y:center[1]});
  nodes.push(packagingNode(p,cargoByUnit.get(p.id)??[],!!palletization));
 }
 for(const a of accessoryRegions(container))if(a.kind==="obstacle"){
  const body=physicalBox(`accessory/${a.id}`,a.name,{x:a.x-clearance,y:a.y-clearance,z:a.z,dx:a.dx,dy:a.dy,dz:a.dz},a.accessory.quantity*(a.accessory.unitWeightKg??0));
  masses.push({weight:body.weight,x:body.x+body.dx/2,y:body.y+body.dy/2});
  nodes.push({body,pads:a.accessory.support?[body]:undefined,canSupport:!!a.accessory.support});
 }
 const total=masses.reduce((n,b)=>n+b.weight,0);
 const cg=total>0?{x:clearance+masses.reduce((n,b)=>n+b.weight*b.x,0)/total,y:clearance+masses.reduce((n,b)=>n+b.weight*b.y,0)/total}:null;
 const errors:string[]=[],unknown=new Set<string>();
 let maxKnownContactKgM2:number|null=null;
 const balance=profile.balance;
 if(balance&&cg&&(cg.x<balance.minX-EPS||cg.x>balance.maxX+EPS||cg.y<balance.minY-EPS||cg.y>balance.maxY+EPS))
  errors.push("货物、包装和附件的平面重心超出录入窗口 / Loaded mass center is outside the entered balance window");
 if(balance&&!cg)unknown.add("center-of-mass");
 const floor:{id:string;name:string;loadKg:number;contactKgM2:number|null}[]=[],zones=profile.zones.map(z=>({...z,loadKg:0}));
 if(profile.maxContactKgM2!==null||zones.length){
  if(nodes.length>4000){unknown.add("contact-search-budget");}
  else{
   const top=new Map<number,ContactNode[]>(),key=(z:number)=>Math.round(z/EPS);
   for(const n of nodes)if(n.canSupport)for(const level of bodyTopLevels(n.body,n.shape)){
    const z=key(level),list=top.get(z)??[];list.push(n);top.set(z,list);
   }
   const upper=new Map<ContactNode,number>();
   for(const node of [...nodes].sort((a,b)=>b.body.z-a.body.z)){
    const {body,shape,pads}=node,loadKg=Math.min(total,body.weight+(upper.get(node)??0));
    if(loadKg<=EPS)continue;
    if(body.z>EPS){
     const below=(top.get(key(body.z))??[]).filter(n=>n.body.z<body.z-EPS&&bodyContactArea(body,n.body,shape,n.shape)>EPS);
     if(!below.length)unknown.add(body.id);
     for(const support of below)upper.set(support,(upper.get(support)??0)+loadKg);
     continue;
    }
    const areas=(pads??[]).map(supportedSurfaceArea).filter(a=>a>EPS);
    const contactKgM2=areas.length?loadKg*1e6/Math.min(...areas):null;
    floor.push({id:body.id,name:body.name,loadKg,contactKgM2});
    if(contactKgM2!==null)maxKnownContactKgM2=Math.max(maxKnownContactKgM2??0,contactKgM2);
    if(profile.maxContactKgM2!==null){
     if(contactKgM2===null)unknown.add(body.id);
     else if(contactKgM2>profile.maxContactKgM2+EPS&&errors.length<50)
      {
      const detail=`${body.name} (${body.id}) ${contactKgM2.toFixed(1)} > ${profile.maxContactKgM2} kg/m²`;
      errors.push(`接触面载荷上界 · ${detail} / Contact load bound · ${detail}`);
     }
    }
    for(const zone of zones){
     const patch={...zone,x:zone.x-clearance,y:zone.y-clearance};
     if((pads?.length?pads:[body]).some(p=>surfaceArea(intersectSurface(p,patch))>EPS))zone.loadKg=Math.min(total,zone.loadKg+loadKg);
    }
   }
  }
  for(const z of zones)if(z.loadKg>z.maxKg+EPS){
   const detail=`${z.name} ${z.loadKg.toFixed(2)} > ${z.maxKg} kg`;
   errors.push(`地板区段载荷上界 · ${detail} / Floor zone load bound · ${detail}`);
  }
 }
 return {profile,totalKg:total,cg,maxKnownContactKgM2,floor,zones,unknown:[...unknown],errors,state:errors.length?"fail" as const:unknown.size?"unverified" as const:"pass" as const};
}
