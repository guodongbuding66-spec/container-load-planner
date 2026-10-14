"use client";
import { useMemo, useState } from "react";
import { Box, Check, Package } from "lucide-react";
import { CARGO_SHAPES, ADVANCED_SHAPES, SHAPE_LABELS, cargoShapeOf, isRectilinearShape, shapeCanSupport, withShapeSupport } from "../lib/packing/cargo-shape";
import { isRoundShape, resolveShapeSize, sizeDraftOf, sizeOptionsOf, switchRadialMode, formatSize, type ShapeSizeOptions } from "../lib/packing/shape-dimensions";
import { CARGO_TYPES, CARGO_LABELS, ORIENTATION_CODES, parseOrientations } from "../lib/packing/loading-rules";
import { fromMillimeters, toMillimeters, fromKilograms, toKilograms, type LengthUnit, type WeightUnit } from "../lib/packing/units";
import type { ProductInput, PackingMode, OrientationCode, CargoShape, ContainerSpec, PackingStrategy } from "../lib/packing/types";
import { roundedCartonVolumeCbm } from "../lib/packing/volume";
import { CargoShapePreview } from "./cargo-shape-preview";
import { CargoModelPreview } from "./cargo-model-preview";
import { SolidModelEditor } from "./solid-model-editor";
import { buildSolidModel, defaultSolidModel, parseSolidModel, type ModelKind } from "../lib/packing/solid-model";
import { legacySolidModel, calibrateSolidModel } from "../lib/packing/solid-templates";
import { CargoShapeSizes } from "./cargo-shape-sizes";
import { FeatureDialog } from "./feature-dialog";
import { CargoFitNotice } from "./cargo-fit-notice";
import { tr, useLanguage } from "./language";

export function CargoSettings({ product, mode, lengthUnit: initialLengthUnit, weightUnit, container, clearance = 0, strategy = "maximum", onClose, onSave }: { product: ProductInput; mode: PackingMode; lengthUnit: LengthUnit; weightUnit: WeightUnit; container?: ContainerSpec; clearance?: number; strategy?: PackingStrategy; onClose: () => void; onSave: (product: ProductInput) => void }) {
  useLanguage();
  const [lengthUnit,setLengthUnit]=useState(initialLengthUnit);
  const [draft,setDraft]=useState<ProductInput>({...product,cargoType:product.cargoType??"carton",cargoShape:cargoShapeOf(product),solidModel:product.solidModel?calibrateSolidModel(product.solidModel,[product.length,product.width,product.height]):undefined});
  const [directions,setDirections]=useState<OrientationCode[]>(product.allowedOrientations??(product.rotationPolicy==="fixed"?["LWH"]:product.rotationPolicy==="upright"?["LWH","WLH"]:[...ORIENTATION_CODES]));
  const [sizes,setSizes]=useState(()=>sizeDraftOf(product,lengthUnit));
  const [sizeOptions,setSizeOptions]=useState(()=>sizeOptionsOf(product));
  const [values,setValues]=useState({weight:String(fromKilograms(Math.max(0,product.weight-(product.solidModel?buildSolidModel(product.solidModel).fixtureWeight:0)),weightUnit)),quantity:String(product.quantity),layers:String(product.maxStackLayers),base:String(fromMillimeters(product.palletBaseHeight??144,lengthUnit))});
  const [previewCode,setPreviewCode]=useState<OrientationCode>("LWH"),[activeDimension,setActiveDimension]=useState<string|undefined>(),[selectedPart,setSelectedPart]=useState<string|undefined>();
  const [error,setError]=useState(""),[modelInputValid,setModelInputValid]=useState(true),[modelBusy,setModelBusy]=useState(false),[modelSession,setModelSession]=useState(0),[protection,setProtection]=useState(()=>String(fromMillimeters(product.protectionGap??0,lengthUnit)));
  const shape=cargoShapeOf(draft),profile=isRectilinearShape(draft),canSupport=shapeCanSupport(draft);
  const geometry=useMemo(()=>{
    try{if(draft.solidModel){const model=parseSolidModel(draft.solidModel)!,[length,width,height]=buildSolidModel(model).size;return {size:{...draft,solidModel:model,length,width,height},valid:true};}return {size:resolveShapeSize(shape,sizes,sizeOptions,lengthUnit),valid:true};}
    catch{return {size:product,valid:false};}
  },[draft,shape,sizes,sizeOptions,lengthUnit,product]);
  const changeLengthUnit=(next:LengthUnit)=>{
    if(!geometry.valid||!modelInputValid||modelBusy)return;
    setSizes(sizeDraftOf({...draft,...geometry.size},next,sizeOptions));
    setProtection(formatSize(fromMillimeters(toMillimeters(Number(protection),lengthUnit),next)));
    setValues(v=>({...v,base:formatSize(fromMillimeters(toMillimeters(Number(v.base),lengthUnit),next))}));
    setLengthUnit(next);setSelectedPart(undefined);setActiveDimension(undefined);setError("");
  };
  const selectShape=(item:CargoShape,type=draft.cargoType)=>{
    setModelInputValid(true);setModelSession(v=>v+1);setError("");
    const current={...draft,length:geometry.size.length,width:geometry.size.width,height:geometry.size.height},next={...current,cargoType:type,cargoShape:item,solidModel:undefined as ProductInput["solidModel"]};
    if(ADVANCED_SHAPES.includes(item)){
      next.shapeAxis=undefined;next.shapeTopRatio=undefined;next.shapeWallRatio=undefined;next.shapeWallHeightRatio=undefined;next.shapeStepLengthRatio=undefined;next.shapeStepHeightRatio=undefined;
      next.solidModel=item==="mesh"?undefined:defaultSolidModel(item==="compound"?"box":item as ModelKind,[current.length,current.width,current.height]);
      setDraft(next);setActiveDimension(undefined);return;
    }
    if(item==="trapezoid"&&!(next.shapeTopRatio??.5))next.shapeTopRatio=.5;
    if(item==="u-profile"&&(next.shapeWallRatio??.25)>=.5)next.shapeWallRatio=.25;
    const options=sizeOptionsOf(next);
    if(isRoundShape(item)&&!isRoundShape(shape)){
      options.elliptical=false;
      const axes=["L","W","H"] as const,dimensions=[current.length,current.width,current.height];
      options.axis=axes[dimensions.indexOf(Math.max(...dimensions))];next.shapeAxis=options.axis;
    }
    const nextSizes=sizeDraftOf(next,lengthUnit,options);
    if(!options.elliptical&&isRoundShape(item)){nextSizes.diameter=formatSize(Math.max(Number(nextSizes.diameter),Number(nextSizes.diameter2)));nextSizes.diameter2=nextSizes.diameter;nextSizes.topDiameter=formatSize(Number(nextSizes.diameter)*(next.shapeTopRatio??.5));}
    setDraft(withShapeSupport(next));setSizeOptions(options);setSizes(nextSizes);setError("");setActiveDimension(undefined);
  };
  const optionsChange=(patch:Partial<ShapeSizeOptions>)=>{
    if(patch.radialMode&&patch.radialMode!==sizeOptions.radialMode)setSizes(v=>switchRadialMode(v,patch.radialMode!));
    if(patch.elliptical===false)setSizes(v=>{const diameter=v.diameter.trim()&&v.diameter2.trim()&&Number.isFinite(Number(v.diameter))&&Number.isFinite(Number(v.diameter2))?formatSize(Math.max(Number(v.diameter),Number(v.diameter2))):v.diameter;const ratio=Number(v.diameter)?Number(v.topDiameter)/Number(v.diameter):.5;return {...v,diameter,diameter2:diameter,topDiameter:formatSize(Number(diameter)*ratio)};});
    setSizeOptions(v=>({...v,...patch}));setError("");
  };
  const update=(key:keyof typeof values,value:string)=>{setValues(v=>({...v,[key]:value}));setError("");};
  const save=()=>{try{
    const numeric=(key:keyof typeof values,min:number,integer=false)=>{const n=Number(values[key]);if(!values[key].trim()||!Number.isFinite(n)||n<min||(integer&&!Number.isInteger(n)))throw new Error(tr("请完成所有数字，并使用有效的尺寸、重量和数量。","Complete every numeric field with valid dimensions, weight and quantity."));return n;};
    if(modelBusy||!modelInputValid)throw new Error(tr("请完成模型参数后再保存。","Complete model parameters before saving."));
    if(ADVANCED_SHAPES.includes(shape)&&!draft.solidModel)throw new Error(tr("请完成模型导入或实体参数。","Complete model import or solid parameters."));
    let size:ReturnType<typeof resolveShapeSize>;
    let fixtureWeight=0;
    if(draft.solidModel){const solidModel=parseSolidModel(draft.solidModel)!,built=buildSolidModel(solidModel);const [length,width,height]=built.size;fixtureWeight=built.fixtureWeight;size={cargoShape:shape,solidModel,length,width,height};}
    else size=resolveShapeSize(shape,sizes,sizeOptions,lengthUnit);
    const gap=Number(protection);if(!protection.trim()||!Number.isFinite(gap)||gap<0||toMillimeters(gap,lengthUnit)>100000)throw new Error(tr("货物保护间隙须为 0–100000 mm。"));
    const base=draft.cargoType==="pallet"?toMillimeters(numeric("base",0),lengthUnit):undefined;
    if(base!==undefined&&base>=size.height)throw new Error(tr("托盘底座已包含在总高内，必须小于总高。","Pallet base is included in total height and must be smaller."));
    const layers=numeric("layers",0,true),quantity=numeric("quantity",0,true),weight=toKilograms(numeric("weight",0),weightUnit)+fixtureWeight;
    if(draft.solidModel&&draft.solidModel.parts.reduce((n,p)=>n+(p.weight??0),0)>weight)throw new Error(tr("部件和支架重量之和不能超过货物毛重。","Component and fixture weights cannot exceed gross cargo weight."));
    if(layers>99||quantity>1_000_000||!draft.sku.trim()||!Number.isFinite(weight))throw new Error(tr("请检查 SKU、层数和数量。","Check SKU, layer limit and quantity."));
    onSave(withShapeSupport({...draft,shapeAxis:undefined,shapeTopRatio:undefined,shapeWallRatio:undefined,shapeWallHeightRatio:undefined,shapeStepLengthRatio:undefined,shapeStepHeightRatio:undefined,solidModel:undefined,...size,declaredVolumeCbm:roundedCartonVolumeCbm(size),protectionGap:toMillimeters(gap,lengthUnit),weight,quantity,maxStackLayers:layers,allowedOrientations:parseOrientations(directions),palletBaseHeight:base}));onClose();
  }catch(e){setError(e instanceof Error?e.message:"Invalid input");}};
  const previewSize=[geometry.size.length,geometry.size.width,geometry.size.height];
  const envelope=previewSize.map(n=>Number(fromMillimeters(n,lengthUnit).toPrecision(8)).toLocaleString(undefined,{maximumFractionDigits:5})).join(" × ");
  return <FeatureDialog wide title={tr("货物设置")} subtitle={product.sku} onClose={onClose} footer={<><p role="alert">{error?tr(error):tr("全部录入完成后保存；第二步确认配置后统一计算。","Save all cargo fields, then confirm loading setup.")}</p><button className="button" onClick={onClose}>{tr("取消")}</button><button className="button primary" disabled={modelBusy} onClick={save}>{tr("保存设置")}</button></>}>
    <div className="feature-choice-grid cargo-type-choices cargo-types-compact">{CARGO_TYPES.map(type=><button type="button" className={`feature-choice ${draft.cargoType===type?"selected":""}`} key={type} aria-pressed={draft.cargoType===type} onClick={()=>type==="pallet"?selectShape("box",type):setDraft(v=>({...v,cargoType:type}))}><Package size={16}/><strong>{tr(CARGO_LABELS[type])}</strong></button>)}</div>
    <section className="cargo-shape-section" aria-label={tr("货物外形","Cargo shape")}><h3 className="feature-section-heading">{tr("实际外形","Package shape")}</h3>
      <div className="cargo-dimension-unit"><label>{tr("尺寸录入单位","Dimension input unit")}<select aria-label={tr("货物尺寸单位","Cargo dimension unit")} value={lengthUnit} disabled={!geometry.valid||!modelInputValid||modelBusy||!protection.trim()||!Number.isFinite(Number(protection))} onChange={e=>changeLengthUnit(e.target.value as LengthUnit)}>{["mm","cm","m","in"].map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label><span>{tr("切换会换算数值，保持实际尺寸；请按所选单位输入。","Switching converts values and preserves physical size; enter dimensions in the selected unit.")}</span></div>
      <div className="cargo-shape-picker">{CARGO_SHAPES.map(item=><button type="button" key={item} disabled={draft.cargoType==="pallet"&&item!=="box"} aria-pressed={shape===item} onClick={()=>selectShape(item)}><CargoShapePreview shape={item}/><span>{tr(...SHAPE_LABELS[item])}</span></button>)}</div>
      <div className="cargo-shape-editor"><CargoModelPreview fields={geometry.size} dimensions={previewSize} orientation={previewCode} options={sizeOptions} unit={lengthUnit} active={activeDimension} selectedPart={selectedPart} onOrientationChange={setPreviewCode}/><div>{draft.solidModel||ADVANCED_SHAPES.includes(shape)?<SolidModelEditor key={`${draft.solidModel?"model":"import"}-${modelSession}-${lengthUnit}`} model={draft.solidModel} unit={lengthUnit} weightUnit={weightUnit} onChange={solidModel=>{const main=solidModel.parts.filter(p=>!p.fixture);setDraft(v=>({...v,solidModel,cargoShape:main.length===1?main[0].kind:"compound",shapeAxis:undefined,shapeTopRatio:undefined,shapeWallRatio:undefined,shapeWallHeightRatio:undefined,shapeStepLengthRatio:undefined,shapeStepHeightRatio:undefined}));setError("");}} onValidity={setModelInputValid} onBusy={setModelBusy} onSelection={setSelectedPart} onDimensionFocus={setActiveDimension}/>:<CargoShapeSizes shape={shape} values={sizes} options={sizeOptions} unit={lengthUnit} onChange={(key,value)=>{setSizes(v=>({...v,[key]:value}));setError("");}} onOptions={optionsChange} onFocus={setActiveDimension}/>}</div></div>
      <div className="cargo-envelope-summary"><span>{tr("装载外接尺寸 L × W × H","Loading envelope L × W × H")}</span><strong>{envelope} {lengthUnit}</strong>{!geometry.valid&&<small>{tr("输入未通过校验，预览暂用参考尺寸。保存时会拦截。","Input is invalid; preview uses reference dimensions until corrected. Save is blocked.")}</small>}</div>
      {container&&geometry.valid&&modelInputValid&&!modelBusy&&<CargoFitNotice product={{...draft,...geometry.size,weight:toKilograms(Number(values.weight),weightUnit)+(draft.solidModel?buildSolidModel(draft.solidModel).fixtureWeight:0),allowedOrientations:directions}} container={container} clearance={clearance} strategy={strategy} unit={lengthUnit}/>}
      <div className="solid-mode-controls">{!ADVANCED_SHAPES.includes(shape)&&shape!=="irregular"&&draft.cargoType!=="pallet"&&<label><input type="checkbox" checked={!!draft.solidModel} onChange={e=>{try{setModelInputValid(true);if(e.target.checked){const solidModel=legacySolidModel({...draft,...geometry.size,solidModel:undefined});setDraft(v=>({...v,solidModel}));}else{const next={...draft,...geometry.size,solidModel:undefined};setDraft(next);setSizes(sizeDraftOf(next,lengthUnit));setSizeOptions(sizeOptionsOf(next));}}catch(error){setError(error instanceof Error?error.message:String(error));}}}/>{tr("实体碰撞、平面承托与孔洞利用","Solid collision, flat support and cavity use")}</label>}<label>{tr("非承托面保护间隙","Non-support protection gap")} ({lengthUnit})<input aria-label={tr("货物保护间隙","Cargo protection gap")} inputMode="decimal" value={protection} onChange={e=>{setProtection(e.target.value);setError("");}}/></label></div>
      {shape!=="box"&&<details className="cargo-shape-limitations"><summary>{tr("装载与承托规则说明","Packing and support rules")}</summary><p>{draft.solidModel?tr("实体模型按同一凸体分解检查碰撞和空隙，仅真实平面可承托；曲面采用保守近似，组合重叠部分不会重复占体积。支架计入外接尺寸和毛重，强度仍需填写上压数据。","Solid models share convex decomposition for collision and free spaces. Only actual flat faces support cargo. Curved proxies are conservative and overlapping parts are not counted twice. Fixtures count toward size and gross weight; set material top-load limits separately."):profile?tr("型件按实际组成块检查碰撞、水平承托面与空隙；占用体积按组成块计算，货运 CBM 仍按外接尺寸。可承托开关还需结合上压重量限制。","Profiles use solid blocks for collision, horizontal support and free spaces. Occupied volume uses solid blocks; shipping CBM uses bounding dimensions. Set top-load weight limits separately."):tr("曲面与通用异型件保留完整外包络；曲面空隙不用于嵌套，不能承托上方货物。","Curved and custom irregular cargo reserve full envelopes. Curved gaps are not used for nesting and cannot support top loads.")} {tr("仅保留实际稳定且可装卸的方向。","Allow only stable, accessible loading orientations.")}</p></details>}
    </section>
    <div className="feature-form-grid cargo-meta-fields"><label>SKU<input aria-label="SKU" value={draft.sku} maxLength={80} onChange={e=>setDraft(v=>({...v,sku:e.target.value}))}/></label><label>{tr("品名","Name")}<input value={draft.name} maxLength={200} onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></label><label>{tr("颜色","Color")}<input type="color" value={draft.color} onChange={e=>setDraft(v=>({...v,color:e.target.value}))}/></label>
      <label>{draft.solidModel?tr("货物重量（不含支架）","Cargo weight (excluding fixtures)"):tr("重量")} ({weightUnit})<input inputMode="decimal" value={values.weight} onChange={e=>update("weight",e.target.value)}/></label>{mode==="mixed"&&<label>{tr("数量")}<input inputMode="numeric" value={values.quantity} onChange={e=>update("quantity",e.target.value)}/></label>}<label>{tr("层数上限")}<input inputMode="numeric" value={values.layers} onChange={e=>update("layers",e.target.value)}/><small>{tr("0 = 按空间自动计算","0 = determined by available space")}</small></label>
      {draft.cargoType==="pallet"&&<label>{tr("托盘底座高度","Pallet base height")} ({lengthUnit})<input inputMode="decimal" value={values.base} onChange={e=>update("base",e.target.value)}/><small>{tr("已包含在外箱总高内","Included in outer height")}</small></label>}
    </div>
    <div className="feature-toggle-row"><label><input type="checkbox" checked={canSupport&&draft.stackable} disabled={!canSupport} onChange={e=>setDraft(v=>({...v,stackable:e.target.checked}))}/>{tr("可承托")}</label><label><input type="checkbox" checked={draft.bottomOnly??false} onChange={e=>setDraft(v=>({...v,bottomOnly:e.target.checked}))}/>{tr("必须底置")}</label></div>
    <h3 className="feature-section-heading"><Box size={17}/>{tr("摆放方向")}</h3><p className="feature-muted">{tr("下方为实际外形；L／W／H 对应原始长／宽／高，箭头为朝上轴。","Thumbnails show the actual shape. L/W/H are original axes; the arrow indicates the upward axis.")}</p>
    <div className="orientation-choices cargo-shape-orientations">{ORIENTATION_CODES.map(code=><button type="button" key={code} className={`orientation-choice ${directions.includes(code)?"selected":""}`} aria-pressed={directions.includes(code)} onClick={()=>setDirections(v=>v.includes(code)?v.filter(c=>c!==code):[...v,code])}><CargoShapePreview shape={shape} fields={geometry.size} dimensions={previewSize} orientation={code}/><strong>{code} · {code[2]} ↑</strong>{directions.includes(code)&&<Check size={14}/>}</button>)}</div>
  </FeatureDialog>;
}
