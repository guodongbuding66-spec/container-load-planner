import {expect,it} from "vitest";
import {pack,restorePackingSnapshot,validatePacking} from "./engine";
import {DEFAULT_PALLET_BUILD} from "./loading-workflow";
import {parseVehicleEngineering,reviewVehicleEngineering} from "./vehicle-engineering";
import {parseWorkspaceBackup,serializeWorkspaceBackup} from "./workspace-file";
import type {PackingRequest} from "./types";

const container={id:"floor-qa",name:"Floor QA",length:1200,width:1000,height:600,doorWidth:1000,doorHeight:600,maxWeight:1000};
const product={id:"p",sku:"BOX",name:"Box",length:200,width:200,height:200,weight:10,quantity:1,priority:50,rotationPolicy:"fixed" as const,stackable:true,maxStackLayers:0,color:"#258076"};
const request:PackingRequest={container,products:[product],mode:"mixed",strategy:"maximum",clearance:10};
const profile={version:1 as const,source:"Measured QA floor",revision:"T1",maxContactKgM2:400,zones:[{id:"nose",name:"Nose panel",x:0,y:0,dx:300,dy:300,maxKg:12}],balance:{minX:100,maxX:130,minY:100,maxY:130}};

it("checks floor contact mass and balance at physical origin and carries ratings through workspace files",()=>{
 const input={...request,container:{...container,engineering:profile}},plan=pack(input);
 expect(plan.validation.valid).toBe(true);
 const report=reviewVehicleEngineering(plan)!;
 expect(report).toMatchObject({state:"pass",cg:{x:110,y:110},totalKg:10,zones:[{loadKg:10}],floor:[{contactKgM2:250}]});
 const file=serializeWorkspaceBackup({...input,strategy:"maximum",practicalTargetPercent:85,customContainers:[],targetVolumePercent:85,targetWeightPercent:85,lengthUnit:"mm",weightUnit:"kg"},"engineering",plan);
 expect(parseWorkspaceBackup(file).container.engineering).toEqual(profile);
});

it("rejects accumulated overload and changed hard ratings on restore",()=>{
 const base=pack({...request,products:[{...product,quantity:2}]});
 const [a,b]=base.placements;
 const placements=[a,{...b,x:a.x,y:a.y,z:a.z+a.dz,layer:2}];
 const configured={...container,engineering:{...profile,balance:undefined}};
 const report=reviewVehicleEngineering({...base,container:configured,placements})!;
 expect(report).toMatchObject({state:"fail",floor:[{loadKg:20,contactKgM2:500}],zones:[{loadKg:20}]});
 expect(validatePacking(placements,configured,10,[{...product,quantity:2}]).valid).toBe(false);
 expect(()=>restorePackingSnapshot({...request,container:{...container,engineering:{...profile,maxContactKgM2:200}}},pack(request))).toThrow(/Contact load bound/);
});

it("keeps a pallet with undocumented contact faces unverified and rejects out-of-floor coordinates",()=>{
 const floor={...DEFAULT_PALLET_BUILD.config,length:450,width:450,count:1,allowFloorCargo:false};
 const plan=pack({...request,floorPallets:floor,container:{...container,engineering:{...profile,zones:[],balance:undefined}}});
 expect(reviewVehicleEngineering(plan)).toMatchObject({state:"unverified",unknown:["floor-pallet-1"]});
 expect(()=>parseVehicleEngineering({...profile,zones:[{...profile.zones[0],dx:2000}]},container)).toThrow();
});
