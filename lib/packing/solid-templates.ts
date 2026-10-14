import { parseSolidModel,buildSolidModel,defaultModelPart,type SolidModel,type ModelKind,type ModelPart } from './solid-model';
import { cargoShapeOf,cylinderAxisOf } from './cargo-shape';
import type { ProductInput } from './types';
export type SolidTemplate={id:string;name:string;updated:string;model:SolidModel};
export const SOLID_TEMPLATE_KEY='cargofit-solid-templates-v1';
export function legacySolidModel(p:ProductInput):SolidModel{
 const kind=cargoShapeOf(p);if(kind==='irregular')throw Error('通用异型包络需先选择基本形体或导入模型。');
 if(p.solidModel)return p.solidModel;
 const part=defaultModelPart(kind as ModelKind,[p.length,p.width,p.height]);part.axis=cylinderAxisOf(p);
 const cross=([0,1,2] as const).filter(i=>i!=='LWH'.indexOf(part.axis)),dims=[p.length,p.width,p.height];
 Object.assign(part.dimensions,{diameter:dims[cross[0]],diameter2:dims[cross[1]],axial:dims['LWH'.indexOf(part.axis)],topDiameter:dims[cross[0]]*(p.shapeTopRatio??.5),topLength:p.length*(p.shapeTopRatio??.5),verticalWall:p.length*(p.shapeWallRatio??.25),horizontalWall:p.height*(p.shapeWallHeightRatio??.25),stepLength:p.length*(p.shapeStepLengthRatio??.5),stepHeight:p.height*(p.shapeStepHeightRatio??.5)});
 if(kind==='frustum'&&part.axis==='L'){part.orientationSigns=[-1,-1,1];part.position=[part.dimensions.axial,part.dimensions.diameter,0];}
 return parseSolidModel({version:1,parts:[part],restFaces:['L-','L+','W-','W+','H-','H+'],loadFaces:['L-','L+','W-','W+','H-','H+'],antiRoll:false})!;
}
export function serializeSolidTemplate(name:string,model:SolidModel):string{
 const title=name.trim();if(!title||title.length>120)throw Error('模板名称须为 1–120 个字符。');const clean=parseSolidModel(model)!;
 return JSON.stringify({format:'cargofit-solid-template',version:1,name:title,model:clean},null,2);
}
export function parseSolidTemplate(source:string):{name:string;model:SolidModel}{
 if(new TextEncoder().encode(source).length>5*1024*1024)throw Error('模型模板不能超过 5 MB。');
 const v=JSON.parse(source);if(v?.format!=='cargofit-solid-template'||v.version!==1||typeof v.name!=='string'||!v.name.trim()||v.name.length>120)throw Error('实体模板格式无效。');return {name:v.name,model:parseSolidModel(v.model)!};
}
export function validateSolidTemplates(value:unknown):SolidTemplate[]{
 if(!Array.isArray(value)||value.length>50)throw Error('最多保存 50 个实体模板。');
 return value.map(v=>{if(!v||typeof v.id!=='string'||v.id.length>120||typeof v.name!=='string'||!v.name.trim()||v.name.length>120||typeof v.updated!=='string'||v.updated.length>40)throw Error('实体模板记录无效。');return {...v,model:parseSolidModel(v.model)!};});
}
export function modelDimensions(model:SolidModel){const [length,width,height]=buildSolidModel(model).size;return {length,width,height};}
export function addModelFixture(model:SolidModel,thickness=40,weight=5):SolidModel{
 const built=buildSolidModel(model),scale=model.calibration??[1,1,1],part:ModelPart={...defaultModelPart('box',[built.size[0]/scale[0],built.size[1]/scale[1],thickness/scale[2]],`fixture-${Date.now()}`),name:'Base / dunnage',position:[built.minimum[0]/scale[0],built.minimum[1]/scale[1],(built.minimum[2]-thickness)/scale[2]],fixture:true,weight};
 return {...model,parts:[...model.parts,part]};
}

export function calibrateSolidModel(model:SolidModel,target:[number,number,number]):SolidModel{const built=buildSolidModel(model),scale=model.calibration??[1,1,1];return {...model,calibration:scale.map((n,i)=>n*target[i]/built.size[i]) as [number,number,number]};}
