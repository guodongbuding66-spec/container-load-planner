"use client";
import {UnitStackingSettings} from "./unit-stacking-settings";
import { useCallback, useEffect, useMemo, useState } from "react";
import {looseReservationErrors} from "../lib/packing/loose-cargo";
import { DEFAULT_PACKAGING, packagingInterior, packagingRailCount } from "../lib/packing/packaging";
import { BASE_PRESETS, ENCLOSURE_PRESETS, withBasePreset, withEnclosurePreset } from "../lib/packing/packaging-presets";
import { parsePalletBuild } from "../lib/packing/loading-workflow";
import { MAX_PACKAGING_SPECIFICATIONS, palletSpecifications, newPackagingConfig } from "../lib/packing/pallet-specifications";
import { PackagingEditor } from "./packaging-editor";
import { SpaceModelPreview } from "./space-model-preview";
import {withPalletRecipe} from "../lib/packing/pallet-recipe";
import { PalletRecipe } from "./pallet-recipe";
import { PalletBuildPreview } from "./pallet-build-preview";
import type {PreparedPalletLayout} from "../lib/packing/prepared-pallet-layout";
import type {PalletLayerTemplate} from "../lib/packing/pallet-layer";
import type { PackingRequest, PalletBuildOptions, PalletBuildSpecification, ProductInput } from "../lib/packing/types";
import { NumericInput } from "./numeric-input";
import { tr, useLanguage } from "./language";
const NO_PRODUCTS:readonly ProductInput[]=[];

type Props={value:PalletBuildOptions;only:boolean;products?:readonly ProductInput[];request?:PackingRequest;
  preparedLayout?:PreparedPalletLayout;onPreparedLayoutChange?:(layout:PreparedPalletLayout|undefined)=>void;
  layerTemplates?:PalletLayerTemplate[];onLayerTemplatesChange?:(templates:PalletLayerTemplate[])=>void;
  initialSpecId?:string;onSelectSpec?:(id:string)=>void;chooseOnly?:boolean;previewActive?:boolean;onRecipePending?:(pending:boolean)=>void;onPreviewReady?:(ready:boolean)=>void;onChange:(value:PalletBuildOptions)=>void;onValidityChange:(key:string,valid:boolean)=>void;resetToken?:number;onReset?:()=>void;invalid?:boolean};
export function PalletBuildSettings({value,only,products=NO_PRODUCTS,request,preparedLayout,onPreparedLayoutChange,layerTemplates,onLayerTemplatesChange,initialSpecId="primary",onSelectSpec,chooseOnly=false,previewActive=true,onRecipePending,onPreviewReady,onChange,onValidityChange,resetToken=0,onReset,invalid=false}:Props){
  useLanguage();
  const [recipePending,setRecipePending]=useState(false);
  const recipeValidity=useCallback((pending:boolean)=>{setRecipePending(pending);onRecipePending?.(pending);},[onRecipePending]);
  const [localSelected,setSelected]=useState(initialSpecId),[draftErrors,setDraftErrors]=useState(()=>({token:resetToken,keys:new Set<string>()}));
  const selected=onSelectSpec?initialSpecId:localSelected;
  const select=(id:string)=>{if(onSelectSpec)onSelectSpec(id);else setSelected(id);};
  const specifications=palletSpecifications(value),current=specifications.find(s=>s.id===selected)??specifications[0],crate=packagingInterior(current.config).crate;
  const fieldValidity=useCallback((key:string,valid:boolean)=>{
    if(key!=="pallet-build:structure")setDraftErrors(previous=>{const keys=previous.token===resetToken?previous.keys:new Set<string>();if(keys.has(key)===!valid)return previous;const next=new Set(keys);if(valid)next.delete(key);else next.add(key);return {token:resetToken,keys:next};});
    onValidityChange(key,valid);
  },[onValidityChange,resetToken]);
  const issue=useMemo(()=>{try{const parsed=parsePalletBuild(value),ids=new Set(products.map(p=>p.id));if(looseReservationErrors(parsed.looseQuantities,products,only).length)return "loose";if(products.length&&palletSpecifications(parsed).some(s=>s.productIds?.some(id=>!ids.has(id))))return "unknown";if(only&&palletSpecifications(parsed).some(s=>s.maxPallets>0&&!s.config.maxCargoHeight))return "height";return "";}catch{return "invalid";}},[value,products,only]);
  const error=issue==="loose"?tr("散装预留不能超过订单数量；套装各 SKU 须预留相同完整套数。只打托请清除散装预留。","Loose reservations cannot exceed ordered cartons. Reserve equal whole-set quantities for every kit component. Clear reservations for pallet-only mode."):issue==="unknown"?tr("某个包装规格引用了已删除的 SKU，请重新选择适用货物。","A packaging specification refers to a deleted SKU. Update its eligible products."):issue==="height"?tr("只打托时，请给每种启用规格填写货物限高。","For pallet-only mode, set a cargo height limit for every available specification."):issue?tr("请检查各包装规格的名称、尺寸、库存、承重和适用 SKU。","Check each packaging name, dimensions, availability, load rating and SKU selection."):"";
  useEffect(()=>{onValidityChange("pallet-build:specifications",chooseOnly||!error);return()=>onValidityChange("pallet-build:specifications",true);},[chooseOnly,error,onValidityChange]);
  useEffect(()=>{if(only||crate){onValidityChange("pallet-build:layers",true);onValidityChange("pallet-build:top",true);}},[only,crate,onValidityChange]);
  const update=(patch:Partial<PalletBuildSpecification>)=>{
    const next={...current,...patch};
    if(patch.config?.packaging?.deckSupports?.length){next.stackLayers=1;next.maxTopLoadKg=0;fieldValidity("pallet-build:layers",true);fieldValidity("pallet-build:top",true);}
    if(patch.config&&packagingInterior(patch.config).crate){fieldValidity("pallet-build:layers",true);fieldValidity("pallet-build:top",true);}
    if(current.id==="primary")onChange({...value,config:next.config,stackLayers:next.stackLayers,maxTopLoadKg:next.maxTopLoadKg,...(value.primaryRule||patch.maxPallets!==undefined||"productIds" in patch||"cartonLimit" in patch?{primaryRule:{maxPallets:next.maxPallets,productIds:next.productIds,cartonLimit:next.cartonLimit}}:{})});
    else onChange({...value,additionalSpecs:value.additionalSpecs?.map(s=>s.id===current.id?next:s)});
  };
  const add=()=>{const s:PalletBuildSpecification={id:crypto.randomUUID(),config:{...newPackagingConfig(current.config),name:`Spec ${specifications.length+1}`},maxPallets:value.maxPallets,stackLayers:1,maxTopLoadKg:0};onChange({...value,primaryRule:value.primaryRule??{maxPallets:value.maxPallets},additionalSpecs:[...value.additionalSpecs??[],s]});select(s.id);};
  const remove=()=>{onChange({...value,additionalSpecs:value.additionalSpecs?.filter(s=>s.id!==current.id)});select("primary");};
  const reorder=(direction:number)=>{const list=[...value.additionalSpecs??[]],i=list.findIndex(s=>s.id===current.id),j=i+direction;if(i<0||j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];onChange({...value,additionalSpecs:list});};
  const reset=()=>{setDraftErrors({token:resetToken,keys:new Set()});onReset?.();};
  const draftInvalid=draftErrors.token===resetToken&&draftErrors.keys.size>0;
  const fields=[
    ["length",tr("托盘长","Pallet length"),"mm",1],["width",tr("托盘宽","Pallet width"),"mm",1],
    ["height",tr("底座高","Deck height"),"mm",1],["weight",current.config.packaging?.deckSupports?.length?tr("原包装自重（不含新增支承）","Base tare (excludes added supports)"):crate?tr("包装总自重","Complete packaging tare"):tr("托盘自重","Pallet tare"),"kg",0],
    ["maxLoad",tr("每托承重","Pallet payload"),"kg",1],["maxCargoHeight",crate?tr("木箱内部净高","Crate interior height"):tr("货物限高","Cargo height limit"),"mm",only||crate?1:0],
    ["gap",tr("整托保护间隙","Pallet protection gap"),"mm",0],
  ] as const;
  const recipe=request&&!preparedLayout&&<PalletRecipe key={`${current.id}/${resetToken}`} request={request} spec={current}
      disabled={(invalid&&issue!=="height")||draftInvalid}
      onApply={patch=>onChange(withPalletRecipe(value,current.id,patch))} onPendingChange={recipeValidity}/>;
  const spec=current.config.packaging??DEFAULT_PACKAGING;
  const basePreset=BASE_PRESETS.find(preset=>spec.base===preset.base&&
    (spec.bottomDeck??"runners")===(preset.bottomDeck??"runners")&&spec.topDeck===preset.topDeck&&
    spec.deckBoards===preset.deckBoards&&spec.runners===preset.runners&&!spec.measurements&&
    (spec.assembledBase||spec.base==="solid"||spec.base==="corner-feet"));
  return <>
    <article id="packaging-settings" className="panel pallet-build-settings" aria-label={tr("打托配置","Pallet-building settings")}>
    <div className="packaging-specifications">
      <div className="package-spec-head">
        <div><h2>{chooseOnly?tr("包装类型","Packaging type"):tr("包装尺寸","Packaging dimensions")}</h2>
        <p>{current.config.name} · {current.config.length} × {current.config.width} mm</p></div>
        {specifications.length>1&&<label>{tr("当前规格","Current specification")}<select aria-label={tr("当前包装规格","Current packaging specification")} value={current.id} disabled={draftInvalid} onChange={e=>select(e.target.value)}>
          {specifications.map(s=><option key={s.id} value={s.id}>{s.config.name} · {s.maxPallets} {tr("个可用","available")}</option>)}
        </select></label>}
      </div>
      <label className="kit-pallet-rule">
        <input type="checkbox" checked={!!value.oneKitPerPallet} disabled={invalid||draftInvalid} onChange={event=>onChange({...value,oneKitPerPallet:event.target.checked})}/>
        <span><strong>{tr("一套一托","One kit per pallet")}</strong><small>{tr("同一套装编码的箱型按套内数量配齐，每托放一整套。","Each pallet holds one complete kit in its specified carton ratio.")}</small></span>
      </label>
      {chooseOnly&&<section className="packaging-picker"><div className="packaging-picker-options">
        <div className="packaging-picker-heading">
          <h3>{tr("围护预设","Enclosure presets")}</h3>
          <label>{tr("底座预设","Base preset")}<select aria-label={tr("底座预设","Base preset")} value={basePreset?.id??""} disabled={draftInvalid} onChange={event=>{const preset=BASE_PRESETS.find(item=>item.id===event.target.value);if(preset)update({config:withBasePreset(current.config,preset)});}}>
            <option value="">{tr("现有底座","Current base")}</option>
            {BASE_PRESETS.map(preset=><option key={preset.id} value={preset.id}>{tr(...preset.label)}</option>)}
          </select></label>
        </div>
        <div className="packaging-preset-grid" role="group" aria-label={tr("打托包装类型","Packaging enclosure type")}>
          {ENCLOSURE_PRESETS.map(preset=><button type="button" key={preset.id} disabled={draftInvalid}
            aria-pressed={spec.enclosure===preset.enclosure&&(spec.panelSegments??1)===(preset.panelSegments??1)&&(preset.railCount===undefined||packagingRailCount(spec)===preset.railCount)}
            onClick={()=>update({config:withEnclosurePreset(current.config,preset)})}>
            <strong>{tr(...preset.label)}</strong><small>{tr(...preset.description)}</small>
          </button>)}
        </div>
        </div><SpaceModelPreview pallet={current.config} appearanceOnly/>
      </section>}
      <details className="package-options">
        <summary>{tr("包装规格与库存","Packaging specifications and stock")}</summary>
      <div className="packaging-specification-tabs" role="group" aria-label={tr("包装规格优先顺序","Packaging specification priority")}>{specifications.map((s,i)=><button type="button" key={s.id} className={current.id===s.id?"selected":""} aria-pressed={current.id===s.id} disabled={draftInvalid} onClick={()=>select(s.id)}><strong>{i+1}. {s.config.name||s.id}</strong><small>{s.config.length} × {s.config.width} · {s.maxPallets} {tr("个可用","available")}</small></button>)}<button type="button" className="button small" disabled={draftInvalid||specifications.length>=MAX_PACKAGING_SPECIFICATIONS} onClick={add}>{tr("新增包装规格","Add packaging specification")}</button></div>
      {draftInvalid&&<p role="status">{tr("请先修正当前无效数字，再切换或增删规格。","Correct the current invalid number before switching, adding or removing specifications.")}</p>}
      <div className="packaging-specification-rule">
        <label className="packaging-specification-name">{tr("包装规格名称","Packaging specification name")}<input aria-label={tr("包装规格名称","Packaging specification name")} value={current.config.name} maxLength={120} onChange={e=>update({config:{...current.config,name:e.target.value}})}/></label>
        <label className="packaging-specification-stock">{tr("此规格可用数量","Available units")}<NumericInput key={`stock-${current.id}`} resetToken={resetToken} ariaLabel={tr("此规格可用数量","Available units of this specification")} value={current.maxPallets} integer min={0} max={200} onValueChange={maxPallets=>update({maxPallets})} onValidityChange={valid=>fieldValidity("pallet-build:stock",valid)}/></label>
        <label className="packaging-selection-mode">{tr("包装选择方式","Packaging selection mode")}<select aria-label={tr("包装选择方式","Packaging selection mode")} disabled={invalid||draftInvalid} value={value.selection??"ordered"} onChange={e=>onChange({...value,selection:e.target.value as "ordered"|"compact"})}><option value="ordered">{tr("按列表顺序","Use list order")}</option><option value="compact">{tr("自动比选：同货量优先小包装","Compare candidates: compact at equal load")}</option></select></label>
        {current.id!=="primary"&&<div className="packaging-specification-actions"><button type="button" className="button small" disabled={draftInvalid||value.additionalSpecs?.[0]?.id===current.id} onClick={()=>reorder(-1)}>{tr("上移优先级","Move earlier")}</button><button type="button" className="button small" disabled={draftInvalid||value.additionalSpecs?.at(-1)?.id===current.id} onClick={()=>reorder(1)}>{tr("下移优先级","Move later")}</button><button type="button" className="button small" disabled={draftInvalid} onClick={remove}>{tr("删除此规格","Remove specification")}</button></div>}
      </div>
      <details className="packaging-selection-help">
        <summary>{tr("比选规则","Selection rules")}</summary>
        <p className="helper-text">{value.selection==="compact"?tr("每托先比较必装与高优先级货量。同货量依次比较外包络、占地、自重，尾托可选更小规格。比选只针对当前这一托。","Compare required and high-priority loads first, then envelope, footprint and tare at equal load. Tail loads may use smaller packaging. The per-unit comparison does not guarantee minimum units or cost."):tr("按列表顺序使用适用规格，库存用尽或不适装时尝试下一种。套装整套打托。","Try eligible specifications in list order. When one is exhausted or does not fit, try the next. Whole kits stay in one packaging unit.")}</p>
      </details>
      </details>
      {!chooseOnly&&error&&<p role="alert">{error}</p>}
      {!chooseOnly&&<>
      <details className="package-options">
      <summary>{tr("适用货物、混装与整托堆叠","Eligible cargo, loose cartons and stacking")}</summary>
      <div className="packaging-policy-grid">
        {products.length>0&&<details className="packaging-policy packaging-product-selection">
          <summary>{tr("适用货物","Eligible products")} <small>{current.productIds?`${current.productIds.length} SKU`:tr("全部 SKU","All SKUs")}</small></summary>
          <div className="packaging-policy-body">
            <label><input type="checkbox" checked={current.productIds===undefined} onChange={e=>update({productIds:e.target.checked?undefined:[products[0].id]})}/>{tr("允许全部货物","Allow all products")}</label>
            <div className="packaging-eligible-list">{products.map(p=><label key={p.id}><input type="checkbox" disabled={current.productIds===undefined} checked={current.productIds===undefined||current.productIds.includes(p.id)} onChange={e=>update({productIds:e.target.checked?[...current.productIds??[],p.id]:current.productIds?.filter(id=>id!==p.id)})}/><span>{p.sku}{p.setCode&&<small> · {p.setCode}</small>}</span></label>)}</div>
            <small>{tr("套装须同时选择全部组成 SKU，至少保留一个适用 SKU。","For kits, select every component SKU together. Select at least one eligible SKU.")}</small>
          </div>
        </details>}
        {products.length>0&&<details className="packaging-policy loose-reservations">
          <summary>{tr("整托与散箱混装","Complete units and loose cartons")} <small>{Object.values(value.looseQuantities??{}).reduce((n,v)=>n+v,0)} {tr("箱预留散装","cartons reserved loose")}</small></summary>
          <div className="packaging-policy-body">
            {only?<p>{tr("只打托模式不生成散装货物。请清除预留，或切换至先打托后装柜。","Pallet-only mode cannot include loose cargo. Clear reservations or switch to palletize, then load.")}</p>:<>
              <div className="loose-reservation-list">{products.map(p=><label key={p.id}>
                <span><strong>{p.sku}</strong>{p.setCode&&` · ${p.setCode} (${p.unitsPerSet??1} ${tr("箱/套","cartons/set")})`}</span>
                <NumericInput resetToken={resetToken} ariaLabel={`${tr("预留散装箱数","Reserved loose cartons")} ${p.sku}`} value={value.looseQuantities?.[p.id]??0} integer min={0} max={p.quantity} onValueChange={n=>onChange({...value,looseQuantities:{...value.looseQuantities,[p.id]:n}})} onValidityChange={valid=>fieldValidity(`pallet-build:loose:${p.id}`,valid)}/>
                <small>{tr("订单箱数","Ordered cartons")} {p.quantity}</small>
              </label>)}</div>
              <small>{tr("套装各 SKU 预留相同完整套数。散箱只与散箱堆叠，不会自动拆托。","Reserve equal whole-set quantities for each kit component. Loose cartons stack with other loose cartons. Packaged units stay intact.")}</small>
            </>}
            <button type="button" className="button small" onClick={()=>{onChange({...value,looseQuantities:undefined});for(const p of products)fieldValidity(`pallet-build:loose:${p.id}`,true);}}>{tr("清除散装预留","Clear loose reservations")}</button>
          </div>
        </details>}
        {!only&&<details className="packaging-policy saved-stacking-rules">
          <summary>{tr("已采用规格的整托堆叠","Stacking for the saved specification")} <small>{current.config.unitStacking?.enabled||(!current.config.unitStacking&&current.stackLayers>1)?tr("已启用","Enabled"):tr("未启用","Off")}</small></summary>
          <div className="packaging-policy-body">
            <UnitStackingSettings key={`${current.id}-${resetToken}`} value={current.config.unitStacking} onChange={unitStacking=>update({config:{...current.config,unitStacking}})} onValidityChange={valid=>fieldValidity("pallet-build:unit-stacking",valid)}/>
          </div>
        </details>}
      </div>
      </details>
      </>}
    </div>
    {!chooseOnly&&<>
    <PackagingEditor key={current.id} value={current.config} onChange={config=>update({config})} onValidityChange={fieldValidity} resetToken={resetToken} onReset={reset} invalid={invalid}
      preview={request?(appearance,empty)=><PalletBuildPreview request={request} value={value} specId={current.id} active={previewActive} appearance={appearance} empty={empty} disabled={invalid||draftInvalid||recipePending}
        preparedLayout={preparedLayout} onPreparedLayoutChange={onPreparedLayoutChange} layerTemplates={layerTemplates} onLayerTemplatesChange={onLayerTemplatesChange} onReadyChange={onPreviewReady}/>:undefined}>
    <div className="pallet-build-grid packaging-dimensions" key={`dimensions-${current.id}`}>{fields.map(([key,label,unit,min])=><label key={key}>{label}<div className="pallet-build-number"><NumericInput showError resetToken={resetToken} ariaLabel={label} value={current.config[key]??0} min={min} max={key==="gap"||key==="weight"?10000:100000} precision={1} onValueChange={v=>update({config:{...current.config,[key]:v}})} onValidityChange={valid=>fieldValidity(`pallet-build:${key}`,valid)}/><span>{unit}</span></div>
      {key==="maxCargoHeight"&&!only&&!crate&&<small>{tr("0 = 按柜内和柜门净高自动","0 = use vehicle and door clearance")}</small>}</label>)}
      {!only&&<label>{tr("托盘方向","Loaded pallet orientation")}<select aria-label={tr("托盘方向","Loaded pallet orientation")} value={current.config.layout} onChange={e=>update({config:{...current.config,layout:e.target.value as PalletBuildOptions["config"]["layout"]}})}><option value="auto">{tr("自动水平旋转","Auto horizontal rotation")}</option><option value="long">{tr("长边沿柜长","Length along vehicle")}</option><option value="cross">{tr("宽边沿柜长","Width along vehicle")}</option></select></label>}
      {!only&&!current.config.unitStacking&&!crate&&!current.config.packaging?.deckSupports?.length&&<><label>{tr("整托堆叠层数","Loaded pallet stack layers")}<NumericInput resetToken={resetToken} ariaLabel={tr("整托堆叠层数","Loaded pallet stack layers")} value={current.stackLayers} integer min={1} max={20} onValueChange={stackLayers=>update({stackLayers})} onValidityChange={valid=>fieldValidity("pallet-build:layers",valid)}/></label><label>{tr("整托可承上压","Loaded pallet top load")}<div className="pallet-build-number"><NumericInput resetToken={resetToken} ariaLabel={tr("整托可承上压","Loaded pallet top load")} value={current.maxTopLoadKg} min={0} max={100000} precision={1} onValueChange={maxTopLoadKg=>update({maxTopLoadKg})} onValidityChange={valid=>fieldValidity("pallet-build:top",valid)}/><span>kg</span></div></label></>}
    </div>
    {!only&&!crate&&!!current.config.maxCargoHeight&&<div className="packaging-preview-actions">
      <button type="button" className="button small" onClick={()=>{fieldValidity("pallet-build:maxCargoHeight",true);update({config:{...current.config,maxCargoHeight:0}});}}>{tr("按柜门净高自动加层","Use door clearance for carton layers")}</button>
      <small>{tr("托内纸箱可以多层堆码，整托堆叠层数单独设置。","Cartons can stack within a pallet. Pallet-on-pallet stacking has its own setting.")}</small>
    </div>}
    {recipe&&<details className="package-options" open={recipePending||undefined}><summary>{value.oneKitPerPallet?tr("推荐一套一托的包装尺寸","Suggest packaging for one kit"):tr("按每托箱数自动配尺寸","Size by cartons per pallet")}</summary>{recipe}</details>}
    <details className="package-options"><summary>{tr("打托数量与混托规则","Pallet limits and mixing")}</summary>
    <div className="pallet-build-grid packaging-order-rules"><label>{tr("单品托 / 混托","Pallet mix")}<select aria-label={tr("单品托 / 混托","Pallet mix")} value={value.mix} onChange={e=>onChange({...value,mix:e.target.value as "single"|"mixed"})}><option value="single">{tr("单 SKU / 完整套装","One SKU / whole kits")}</option><option value="mixed">{tr("允许多 SKU 混托","Allow mixed SKUs")}</option></select></label><label>{tr("生成托盘上限","Prepared pallet limit")}<NumericInput resetToken={resetToken} ariaLabel={tr("生成托盘上限","Prepared pallet limit")} value={value.maxPallets} integer min={1} max={200} onValueChange={maxPallets=>onChange({...value,maxPallets})} onValidityChange={valid=>fieldValidity("pallet-build:limit",valid)}/><small>{tr("所有规格合计上限","Total across all specifications")}</small></label></div>
    </details>
    </PackagingEditor>
    {crate&&!current.config.unitStacking?.enabled&&<p className="helper-text">{tr("木箱限高为内部净高，箱盖另外占用高度。默认底置；在额定资料内明确启用并重新核对后，只允许通过四角路径、累计顶载及每条路径总载荷校验的单列叠放。","Crate height is usable interior height; the lid adds to exterior height. Floor-only by default. Explicit opt-in and current reviewed evidence allow only single columns passing four-path contact, cumulative top-load and each-path through-load checks.")}</p>}
    <p className="helper-text">{only?tr("按订单生成全部可行托盘并保留未打托数量；三维编组区只用于查看，利用率按每托包络计算。","Build feasible pallets for the order and retain unmet quantities. The inspection area is for viewing; utilization uses pallet envelopes."):tr("每种规格独立设置上压和层数；可在上方开启整托叠放。仅完整平顶且通过累计承重和门洞校验的整托可堆叠。","Each specification has its own top-load and layer limits. Enable pallet-on-pallet stacking above. Stacking requires a complete flat top and cumulative-load and door checks.")}</p>
    </>}
    </article>
  </>;
}
