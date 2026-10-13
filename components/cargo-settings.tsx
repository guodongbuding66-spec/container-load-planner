"use client";
import { useMemo, useState } from "react";
import { Box, Check, Package } from "lucide-react";
import { CARGO_SHAPES, SHAPE_LABELS, cargoShapeOf, isRectilinearShape, shapeCanSupport, withShapeSupport } from "../lib/packing/cargo-shape";
import { isRoundShape, resolveShapeSize, sizeDraftOf, sizeOptionsOf, switchRadialMode, formatSize, type ShapeSizeOptions, type SizeKey } from "../lib/packing/shape-dimensions";
import { CARGO_TYPES, CARGO_LABELS, ORIENTATION_CODES, parseOrientations } from "../lib/packing/loading-rules";
import { fromMillimeters, toMillimeters, fromKilograms, toKilograms, type LengthUnit, type WeightUnit } from "../lib/packing/units";
import type { ProductInput, PackingMode, OrientationCode, CargoShape } from "../lib/packing/types";
import { CargoShapePreview } from "./cargo-shape-preview";
import { CargoModelPreview } from "./cargo-model-preview";
import { CargoShapeSizes } from "./cargo-shape-sizes";
import { FeatureDialog } from "./feature-dialog";
import { tr, useLanguage } from "./language";

export function CargoSettings({ product, mode, lengthUnit, weightUnit, onClose, onSave }: { product: ProductInput; mode: PackingMode; lengthUnit: LengthUnit; weightUnit: WeightUnit; onClose: () => void; onSave: (product: ProductInput) => void }) {
  useLanguage();
  const [draft,setDraft]=useState<ProductInput>({...product,cargoType:product.cargoType??"carton",cargoShape:cargoShapeOf(product)});
  const [directions,setDirections]=useState<OrientationCode[]>(product.allowedOrientations??(product.rotationPolicy==="fixed"?["LWH"]:product.rotationPolicy==="upright"?["LWH","WLH"]:[...ORIENTATION_CODES]));
  const [sizes,setSizes]=useState(()=>sizeDraftOf(product,lengthUnit));
  const [sizeOptions,setSizeOptions]=useState(()=>sizeOptionsOf(product));
  const [values,setValues]=useState({weight:String(fromKilograms(product.weight,weightUnit)),quantity:String(product.quantity),layers:String(product.maxStackLayers),base:String(fromMillimeters(product.palletBaseHeight??144,lengthUnit))});
  const [previewCode,setPreviewCode]=useState<OrientationCode>("LWH"),[activeDimension,setActiveDimension]=useState<SizeKey|undefined>();
  const [error,setError]=useState("");
  const shape=cargoShapeOf(draft),profile=isRectilinearShape(draft),canSupport=shapeCanSupport(draft);
  const geometry=useMemo(()=>{
    try{return {size:resolveShapeSize(shape,sizes,sizeOptions,lengthUnit),valid:true};}
    catch{return {size:{...draft,cargoShape:shape,shapeAxis:sizeOptions.axis,shapeTopRatio:shape==="frustum"?draft.shapeTopRatio??.5:Math.max(.000001,draft.shapeTopRatio??.5)},valid:false};}
  },[draft,shape,sizes,sizeOptions,lengthUnit]);
  const selectShape=(item:CargoShape,type=draft.cargoType)=>{
    const current={...draft,...geometry.size},next={...current,cargoType:type,cargoShape:item};
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
    const size=resolveShapeSize(shape,sizes,sizeOptions,lengthUnit),base=draft.cargoType==="pallet"?toMillimeters(numeric("base",0),lengthUnit):undefined;
    if(base!==undefined&&base>=size.height)throw new Error(tr("托盘底座已包含在总高内，必须小于总高。","Pallet base is included in total height and must be smaller."));
    const layers=numeric("layers",0,true),quantity=numeric("quantity",0,true),weight=toKilograms(numeric("weight",0),weightUnit);
    if(layers>99||quantity>1_000_000||!draft.sku.trim()||!Number.isFinite(weight))throw new Error(tr("请检查 SKU、层数和数量。","Check SKU, layer limit and quantity."));
    onSave(withShapeSupport({...draft,shapeAxis:undefined,shapeTopRatio:undefined,shapeWallRatio:undefined,shapeWallHeightRatio:undefined,shapeStepLengthRatio:undefined,shapeStepHeightRatio:undefined,...size,weight,quantity,maxStackLayers:layers,allowedOrientations:parseOrientations(directions),palletBaseHeight:base}));onClose();
  }catch(e){setError(e instanceof Error?e.message:"Invalid input");}};
  const previewSize=[geometry.size.length,geometry.size.width,geometry.size.height];
  const envelope=previewSize.map(n=>Number(fromMillimeters(n,lengthUnit).toPrecision(8)).toLocaleString(undefined,{maximumFractionDigits:5})).join(" × ");
  return <FeatureDialog wide title={tr("货物设置")} subtitle={product.sku} onClose={onClose} footer={<><p role="alert">{error?tr(error):tr("全部录入完成后保存；第二步确认配置后统一计算。","Save all cargo fields, then confirm loading setup.")}</p><button className="button" onClick={onClose}>{tr("取消")}</button><button className="button primary" onClick={save}>{tr("保存设置")}</button></>}>
    <div className="feature-choice-grid cargo-type-choices cargo-types-compact">{CARGO_TYPES.map(type=><button type="button" className={`feature-choice ${draft.cargoType===type?"selected":""}`} key={type} aria-pressed={draft.cargoType===type} onClick={()=>type==="pallet"?selectShape("box",type):setDraft(v=>({...v,cargoType:type}))}><Package size={16}/><strong>{tr(CARGO_LABELS[type])}</strong></button>)}</div>
    <section className="cargo-shape-section" aria-label={tr("货物外形","Cargo shape")}><h3 className="feature-section-heading">{tr("实际外形","Package shape")}</h3>
      <div className="cargo-shape-picker">{CARGO_SHAPES.map(item=><button type="button" key={item} disabled={draft.cargoType==="pallet"&&item!=="box"} aria-pressed={shape===item} onClick={()=>selectShape(item)}><CargoShapePreview shape={item}/><span>{tr(...SHAPE_LABELS[item])}</span></button>)}</div>
      <div className="cargo-shape-editor"><CargoModelPreview fields={geometry.size} dimensions={previewSize} orientation={previewCode} options={sizeOptions} unit={lengthUnit} active={activeDimension} onOrientationChange={setPreviewCode}/><CargoShapeSizes shape={shape} values={sizes} options={sizeOptions} unit={lengthUnit} onChange={(key,value)=>{setSizes(v=>({...v,[key]:value}));setError("");}} onOptions={optionsChange} onFocus={setActiveDimension}/></div>
      <div className="cargo-envelope-summary"><span>{tr("装载外接尺寸 L × W × H","Loading envelope L × W × H")}</span><strong>{envelope} {lengthUnit}</strong>{!geometry.valid&&<small>{tr("输入未通过校验，预览暂用参考尺寸。保存时会拦截。","Input is invalid; preview uses reference dimensions until corrected. Save is blocked.")}</small>}</div>
      {shape!=="box"&&<details className="cargo-shape-limitations"><summary>{tr("装载与承托规则说明","Packing and support rules")}</summary><p>{profile?tr("型件按实际组成块检查碰撞、水平承托面与空隙；占用体积按组成块计算，货运 CBM 仍按外接尺寸。可承托开关还需结合上压重量限制。","Profiles use solid blocks for collision, horizontal support and free spaces. Occupied volume uses solid blocks; shipping CBM uses bounding dimensions. Set top-load weight limits separately."):tr("曲面与通用异型件保留完整外包络；曲面空隙不用于嵌套，不能承托上方货物。","Curved and custom irregular cargo reserve full envelopes. Curved gaps are not used for nesting and cannot support top loads.")} {tr("仅保留实际稳定且可装卸的方向。","Allow only stable, accessible loading orientations.")}</p></details>}
    </section>
    <div className="feature-form-grid cargo-meta-fields"><label>SKU<input aria-label="SKU" value={draft.sku} maxLength={80} onChange={e=>setDraft(v=>({...v,sku:e.target.value}))}/></label><label>{tr("品名","Name")}<input value={draft.name} maxLength={200} onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></label><label>{tr("颜色","Color")}<input type="color" value={draft.color} onChange={e=>setDraft(v=>({...v,color:e.target.value}))}/></label>
      <label>{tr("重量")} ({weightUnit})<input inputMode="decimal" value={values.weight} onChange={e=>update("weight",e.target.value)}/></label>{mode==="mixed"&&<label>{tr("数量")}<input inputMode="numeric" value={values.quantity} onChange={e=>update("quantity",e.target.value)}/></label>}<label>{tr("层数上限")}<input inputMode="numeric" value={values.layers} onChange={e=>update("layers",e.target.value)}/><small>{tr("0 = 按空间自动计算","0 = determined by available space")}</small></label>
      {draft.cargoType==="pallet"&&<label>{tr("托盘底座高度","Pallet base height")} ({lengthUnit})<input inputMode="decimal" value={values.base} onChange={e=>update("base",e.target.value)}/><small>{tr("已包含在外箱总高内","Included in outer height")}</small></label>}
    </div>
    <div className="feature-toggle-row"><label><input type="checkbox" checked={canSupport&&draft.stackable} disabled={!canSupport} onChange={e=>setDraft(v=>({...v,stackable:e.target.checked}))}/>{tr("可承托")}</label><label><input type="checkbox" checked={draft.bottomOnly??false} onChange={e=>setDraft(v=>({...v,bottomOnly:e.target.checked}))}/>{tr("必须底置")}</label></div>
    <h3 className="feature-section-heading"><Box size={17}/>{tr("摆放方向")}</h3><p className="feature-muted">{tr("下方为实际外形；L／W／H 对应原始长／宽／高，箭头为朝上轴。","Thumbnails show the actual shape. L/W/H are original axes; the arrow indicates the upward axis.")}</p>
    <div className="orientation-choices cargo-shape-orientations">{ORIENTATION_CODES.map(code=><button type="button" key={code} className={`orientation-choice ${directions.includes(code)?"selected":""}`} aria-pressed={directions.includes(code)} onClick={()=>setDirections(v=>v.includes(code)?v.filter(c=>c!==code):[...v,code])}><CargoShapePreview shape={shape} fields={geometry.size} dimensions={previewSize} orientation={code}/><strong>{code} · {code[2]} ↑</strong>{directions.includes(code)&&<Check size={14}/>}</button>)}</div>
  </FeatureDialog>;
}
