import { buildSolidModel,modelFields,type SolidModel } from './solid-model';
import { orientationAxes } from './cargo-body';
import type { V3 } from './solid-math';
/** Physical parameter endpoints undergo exactly the same part, assembly and placement transforms as the mesh. */
export function modelAnnotations(model:SolidModel,dimensions:number[],selected?:string){
 const built=buildSolidModel(model),part=model.parts.find(p=>p.id===selected)??model.parts[0],d=part.dimensions,L=d.length,W=d.width,H=d.height,r=d.diameter/2,r2=(d.diameter2??d.diameter)/2;
 const ranges:Record<string,[V3,V3]>={length:[[0,0,0],[L,0,0]],width:[[0,0,0],[0,W,0]],height:[[0,0,0],[0,0,H]],topLength:[[(L-d.topLength)/2,0,H],[(L+d.topLength)/2,0,H]],verticalWall:part.kind==='t-profile'?[[(L-d.verticalWall)/2,0,0],[(L+d.verticalWall)/2,0,0]]:[[0,0,H],[d.verticalWall,0,H]],horizontalWall:part.kind==='t-profile'?[[L,0,H-d.horizontalWall],[L,0,H]]:[[L,0,0],[L,0,d.horizontalWall]],stepLength:[[0,0,H],[d.stepLength,0,H]],stepHeight:[[L,0,0],[L,0,d.stepHeight]]};
 const axis=(p:V3):V3=>part.axis==='L'?[p[2],p[0],p[1]]:part.axis==='W'?[p[0],p[2],p[1]]:p;
 if(['cylinder','frustum','tube','reel','polygon','capsule'].includes(part.kind)){
  const h=d.axial??d.straight+d.diameter;
  Object.assign(ranges,{diameter:[[0,r2,0],[d.diameter,r2,0]],diameter2:[[r,0,0],[r,2*r2,0]],innerDiameter:[[r-d.innerDiameter/2,r2,0],[r+d.innerDiameter/2,r2,0]],coreDiameter:[[r-d.coreDiameter/2,r2,d.flangeThickness],[r+d.coreDiameter/2,r2,d.flangeThickness]],topDiameter:[[r-d.topDiameter/2,r2,h],[r+d.topDiameter/2,r2,h]],axial:[[r*2,r2,0],[r*2,r2,h]],flangeThickness:[[r*2,r2,0],[r*2,r2,d.flangeThickness]],straight:[[r*2,r2,r],[r*2,r2,r+d.straight]]});for(const key of Object.keys(ranges))ranges[key]=ranges[key].map(axis) as [V3,V3];
 }
 if(part.kind==='ellipsoid'){ranges.length=[[0,W/2,H/2],[L,W/2,H/2]];ranges.width=[[L/2,0,H/2],[L/2,W,H/2]];ranges.height=[[L/2,W/2,0],[L/2,W/2,H]];}
 if(part.kind==='capsule'){ranges.diameter=[axis([0,r,r]),axis([2*r,r,r])];}
 if(part.kind==='custom-prism'){const s=part.section![0];ranges.axial=[[s[0],0,s[1]],[s[0],d.axial,s[1]]];}
 if(part.kind==='bend'){ranges.radius=[[0,0,0],[d.radius,0,0]];ranges.diameter=[[d.radius-r,0,0],[d.radius+r,0,0]];ranges.innerDiameter=[[d.radius-d.innerDiameter/2,0,0],[d.radius+d.innerDiameter/2,0,0]];}
 const axes=orientationAxes(part.orientation,part.orientationSigns),scale=model.calibration??[1,1,1];
 const point=(v:V3)=>axes.map((a,i)=>((part.position[i]+v[a.original]*(a.negative?-1:1))*scale[i]-built.minimum[i])/built.size[i]) as V3;
 const codes:Record<string,string>={length:'L',width:'W',height:'H',diameter:'D₁',diameter2:'D₂',topDiameter:'Dₜ',axial:'h',verticalWall:'t₁',horizontalWall:'t₂',stepLength:'Lₛ',stepHeight:'Hₛ',topLength:'Lₜ',innerDiameter:'d',coreDiameter:'D꜀',flangeThickness:'t',straight:'s',radius:'R'};
 const params=modelFields(part.kind).filter(f=>ranges[f.key]&&!f.unit).map(f=>{const [a,b]=ranges[f.key].map(point) as [V3,V3];return {key:`${part.id}:${f.key}`,code:codes[f.key]??f.key,zh:f.zh,en:f.en,value:Math.hypot(...a.map((v,i)=>(b[i]-v)*dimensions[i])),a,b};});
 return [...params,...(model.parts.length>1||part.kind==='mesh'?[{key:'envelope-L',code:'Lₑ',value:dimensions[0],a:[0,0,0] as V3,b:[1,0,0] as V3},{key:'envelope-W',code:'Wₑ',value:dimensions[1],a:[0,0,0] as V3,b:[0,1,0] as V3},{key:'envelope-H',code:'Hₑ',value:dimensions[2],a:[0,0,0] as V3,b:[0,0,1] as V3}]:[])];
}
