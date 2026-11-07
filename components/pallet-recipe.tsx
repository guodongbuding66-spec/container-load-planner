"use client";

import { useEffect, useState } from "react";
import { parseNumericDraft } from "../lib/packing/numeric-draft";
import { packagingInterior } from "../lib/packing/packaging";
import { packagingGroupKey } from "../lib/packing/packaging-choice";
import { canSuggestPalletSize, initialPalletRecipeCartons, redesignPalletRecipeSpec, palletRecipeGroups, type PalletRecipePatch, type PalletRecipeInput, type PalletRecipePreview } from "../lib/packing/pallet-recipe";
import { MAX_CARTONS_PER_PALLET, MAX_PACKAGING_SPECIFICATIONS, palletSpecifications } from "../lib/packing/pallet-specifications";
import type { FloorPalletConfig, PackingRequest, PalletBuildSpecification } from "../lib/packing/types";
import { tr, trText, useLanguage } from "./language";

type Props = {
  request: PackingRequest;
  spec: PalletBuildSpecification;
  disabled: boolean;
  onApply: (patch: PalletRecipePatch) => void;
  onPendingChange?: (pending: boolean) => void;
  initialCartons?: number;
  applyLabel?: string;
  onFineTune?: (patch: PalletRecipePatch) => void;
};

function RecipeViews({preview}: {preview:PalletRecipePreview}) {
  const {config, placements, height} = preview;
  const {inset, lid} = packagingInterior(config);
  const base = "#c8ad82";
  const stroke = {stroke:"var(--panel, #fff)", strokeWidth:1, vectorEffect:"non-scaling-stroke" as const};
  const ground = Math.min(...placements.map(b => b.z));
  return <div className="pallet-recipe-views">
    <figure>
      <svg viewBox={`0 0 ${config.length} ${config.width}`} role="img" aria-label={tr("底层俯视","Bottom-layer plan")}>
        <rect width={config.length} height={config.width} fill={base}/>
        {placements.filter(b => Math.abs(b.z-ground) < .0001).map(b =>
          <rect key={b.id} x={b.x} y={b.y} width={b.dx} height={b.dy} fill={b.color} {...stroke}/>)}
      </svg>
      <figcaption>{tr("底层俯视","Bottom-layer plan")}</figcaption>
    </figure>
    <figure>
      <svg viewBox={`0 0 ${config.length} ${height}`} role="img" aria-label={tr("堆码侧视","Stack elevation")}>
        <rect y={height-config.height} width={config.length} height={config.height} fill={base}/>
        {inset > 0 && <><rect width={inset} height={height-config.height} fill={base}/><rect x={config.length-inset} width={inset} height={height-config.height} fill={base}/></>}
        {lid > 0 && <rect width={config.length} height={lid} fill={base}/>}
        {[...placements].sort((a,b) => b.y-a.y).map(b =>
          <rect key={b.id} x={b.x} y={height-config.height-b.z-b.dz} width={b.dx} height={b.dz} fill={b.color} {...stroke}/>)}
      </svg>
      <figcaption>{tr("堆码侧视","Stack elevation")}</figcaption>
    </figure>
  </div>;
}

type FineField = "length" | "width" | "height" | "maxCargoHeight";
type FineDraft = {config:FloorPalletConfig; values:Record<FineField,string>};
const fineFields:FineField[] = ["length","width","height","maxCargoHeight"];

export function usePalletRecipe({request, spec, disabled, onApply, onPendingChange, initialCartons}: Props) {
  const [draft, setDraft] = useState(String(initialCartons ?? spec.cartonLimit ?? ""));
  const [redesigned, setRedesigned] = useState(initialCartons !== undefined && !canSuggestPalletSize(spec.config));
  const [fine, setFine] = useState<FineDraft>();
  const fineNumbers = fineFields.map(field=>parseNumericDraft(fine?.values[field]??"",{min:1,max:100000}));
  const fineInvalid = !!fine && fineNumbers.some(n=>n.state!=="valid");
  const baseSpec = redesigned ? redesignPalletRecipeSpec(spec) : spec;
  const recipeSpec = fine && !fineInvalid ? {...baseSpec,config:{...fine.config,
    ...Object.fromEntries(fineFields.map((field,i)=>[field,fineNumbers[i].state==="valid"?fineNumbers[i].value:0]))}} : baseSpec;
  const canRedesign = !request.palletBuild || palletSpecifications(request.palletBuild).length < MAX_PACKAGING_SPECIFICATIONS;
  const [selected, setSelected] = useState("");
  const [method, setMethod] = useState<PalletRecipeInput["mode"]>(initialCartons !== undefined ? "suggest" : spec.cartonLimit ? "current" : "suggest");
  const [response, setResponse] = useState<{key:string; preview?:PalletRecipePreview; error?:string}>();
  const groups = palletRecipeGroups(request.products, spec.productIds, request.palletBuild?.looseQuantities);
  const group = groups.find(items => packagingGroupKey(items[0]) === selected) ?? groups[0];
  const groupKey = group ? packagingGroupKey(group[0]) : "";
  const canSuggest = canSuggestPalletSize(recipeSpec.config);
  const mode = fine ? "current" : method;
  const archiveBlocked = redesigned && !canRedesign;
  const parsed = parseNumericDraft(draft, {integer:true, min:1, max:MAX_CARTONS_PER_PALLET});
  const cartons = parsed.state === "valid" ? parsed.value : undefined;
  const pending = redesigned || !!fine || cartons !== spec.cartonLimit || draft.trim() !== "" && mode === "suggest" || parsed.state === "invalid";
  const key = !disabled && !fineInvalid && !archiveBlocked && groupKey && cartons !== undefined
    ? JSON.stringify({request, spec:recipeSpec, groupKey, cartons, mode} satisfies PalletRecipeInput)
    : "";
  const current = response?.key === key ? response : undefined;

  useEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [onPendingChange, pending]);

  useEffect(() => {
    if (!key) return;
    let active = true;
    let worker: Worker | undefined;
    let timeout: number | undefined;
    const finish = (result: {preview?:PalletRecipePreview; error?:string}) => {
      if (!active) return;
      active = false;
      worker?.terminate();
      worker = undefined;
      window.clearTimeout(timeout);
      setResponse({key, ...result});
    };
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL("../lib/packing/palletize.worker.ts", import.meta.url), {type:"module"});
        worker.onmessage = e => e.data.ok ? finish({preview:e.data.result}) : finish({error:e.data.error});
        worker.onerror = () => finish({error:"打托预览未完成 / Pallet preview could not finish"});
        timeout = window.setTimeout(() => finish({error:"打托预览超时，请减少每托箱数 / Preview timed out. Try fewer cartons per pallet"}), 12000);
        worker.postMessage({recipe:JSON.parse(key)});
      } catch {
        finish({error:"无法启动打托预览 / Could not start pallet preview"});
      }
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      worker?.terminate();
    };
  }, [key]);

  const preview = current?.preview;
  const errors = archiveBlocked ? tr("包装规格已达上限，请先腾出一个位置保留旧包装。","Free one specification slot to retain the old packaging.")
    : fineInvalid ? tr("请填写有效的打托尺寸，范围为 1–100000 mm。","Enter valid pallet dimensions from 1 to 100000 mm.")
    : parsed.state === "invalid"
    ? tr("请输入 1–1000 的整数。","Enter a whole number from 1 to 1000.")
    : current?.error ? current.error.includes(" / ") ? tr(...current.error.split(" / ", 2) as [string, string]) : trText(current.error) : "";
  const fitsTarget = !!preview && preview.placements.length === preview.sampleCartons;
  const applyPreview = (apply = onApply) => {
    if (disabled || cartons === undefined || !preview || !fitsTarget || fineInvalid || archiveBlocked) return;
    const config = mode === "suggest" || fine
      ? {...preview.config, presetId:"carton-sized", name:`${group[0].sku.slice(0, 80)} ${packagingInterior(preview.config).crate ? tr("定制木箱","sized crate") : tr("定制托盘","sized pallet")}`}
      : recipeSpec.config;
    apply({config, cartonLimit:cartons, ...(redesigned?{redesigned:true}:{})});
    setRedesigned(false);
    setFine(undefined);
    setMethod("current");
  };
  const cancel = () => {
    setRedesigned(false);
    setFine(undefined);
    setDraft(String(spec.cartonLimit ?? ""));
    setMethod(spec.cartonLimit ? "current" : "suggest");
  };

  const suggest = (value = draft) => {
    setFine(undefined);setDraft(value);setMethod("suggest");setRedesigned(!canSuggestPalletSize(spec.config));
  };
  const restoreCurrent = () => {setFine(undefined);setRedesigned(false);setMethod("current");};
  const fineTune = () => {
    if (!preview) return;
    const documented = !canSuggestPalletSize(preview.config);
    const config = documented ? redesignPalletRecipeSpec({...spec,config:preview.config}).config : preview.config;
    setRedesigned(redesigned || documented);
    setFine({config,values:Object.fromEntries(fineFields.map(field=>[field,String(config[field]??0)])) as Record<FineField,string>});
  };
  return {draft,setDraft,redesigned,canRedesign,selected,setSelected,groups,group,groupKey,canSuggest,mode,parsed,cartons,pending,key,current,preview,errors,applyPreview,cancel,suggest,restoreCurrent,fine,fineTune,fineInvalid,fitsTarget,
    updateFine:(field:FineField,value:string)=>setFine(previous=>previous?{...previous,values:{...previous.values,[field]:value}}:previous),
    removeLimit:()=>{setFine(undefined);setRedesigned(false);setDraft("");setMethod("current");onApply({cartonLimit:undefined});}};
}

export function PalletRecipe(props:Props) {
  useLanguage();
  const {request,spec,disabled,initialCartons,applyLabel,onFineTune}=props;
  const {draft,redesigned,canRedesign,setSelected,groups,group,groupKey,canSuggest,mode,parsed,cartons,pending,key,current,preview,errors,applyPreview,cancel,suggest,restoreCurrent,fine,fineTune,fitsTarget,updateFine,removeLimit}=usePalletRecipe(props);

  return <section id="pallet-recipe" className="pallet-recipe" aria-label={tr("按箱数自动打托","Pallet sizing by carton count")}>
    <h3>{tr("按箱数自动打托","Pallet sizing by carton count")}</h3>
    <p>{mode === "suggest" || fine
      ? tr("填写几箱一托，自动生成尺寸与堆码预览；可先微调长宽、底座高和托内净高，再采用并计算装柜。","Enter cartons per pallet for automatic dimensions and stacking. Fine-tune length, width, deck and cargo height before applying and calculating loading.")
      : tr("当前显示已保存的包装。修改每托箱数后，会自动生成新的打托尺寸与堆码预览。","Showing the saved packaging. Changing cartons per pallet automatically generates new dimensions and a stacking preview.")}</p>
    {!canSuggest && !redesigned && <div className="packaging-preview-actions"><button type="button" className="button small" disabled={disabled||!canRedesign||!group} onClick={()=>suggest(String(initialPalletRecipeCartons(request,redesignPalletRecipeSpec(spec))??""))}>{tr("自动推荐每托箱数与尺寸","Suggest carton count and dimensions")}</button></div>}
    {redesigned&&<p role="status">{tr("新打托预览尚未采用。采用后才会替换旧限高和箱数，并保留旧包装资料；新尺寸需重新核对自重、承重和结构。","New pallet preview is not applied yet. Applying replaces the old height and carton limit and retains the old packaging records. Verify tare, payload and structure for the new dimensions.")}</p>}
    <div className="pallet-build-grid">
      {groups.length > 1 && <label>{tr("预览货物","Preview cargo")}<select value={groupKey} onChange={e=>{setSelected(e.target.value);suggest();}}>
        {groups.map(items => <option key={packagingGroupKey(items[0])} value={packagingGroupKey(items[0])}>{items[0].setCode || items[0].sku}</option>)}
      </select></label>}
      <label>{tr("每托箱数","Cartons per pallet")}<input id="pallet-recipe-count" inputMode="numeric" value={draft} maxLength={8}
        aria-invalid={parsed.state === "invalid"} placeholder={tr("例如 20","e.g. 20")} disabled={disabled||!group}
        onChange={e=>suggest(e.target.value)}/></label>
    </div>
    {!group && <p>{tr("请先添加符合本规格的货物或完整套装。","Add eligible cargo or a complete kit for this specification.")}</p>}
    {initialCartons!==undefined&&<small>{tr("保留你设置的每托箱数，重新建议尺寸；未设置箱数时按余量与承重建议。采用前，装柜结果仍显示原方案。","Your cartons-per-pallet target is retained while dimensions are redesigned. If no count is set, stock and payload suggest one. Loading results remain unchanged until you apply.")}</small>}
    {group && <small>{group.map(p => `${p.sku} · ${p.length} × ${p.width} × ${p.height} mm`).join(" / ")}</small>}
    <div role={errors ? "alert" : "status"} className="pallet-recipe-status">
      {errors || (key && !current ? tr("正在生成打托预览…","Generating pallet preview…") : "")}
    </div>
    {preview && <div aria-label={tr("打托预览","Pallet preview")}>
      <div className="pallet-recipe-metrics">
        <div><small>{tr("整托外尺寸","Loaded dimensions")}</small><strong>{[preview.config.length,preview.config.width,preview.height].map(n=>Number(n.toFixed(2))).join(" × ")} mm</strong></div>
        <div><small>{tr("箱数与堆码","Cartons and layers")}</small><strong>{preview.placements.length} {tr("箱","cartons")} · {preview.layerCount} {tr("层","layers")}</strong></div>
        <div><small>{tr("整托毛重","Gross pallet weight")}</small><strong>{Number(preview.grossWeight.toFixed(2))} kg</strong></div>
      </div>
      <RecipeViews preview={preview}/>
      <p>{preview.placements.length < preview.sampleCartons
        ? tr(`当前尺寸可打 ${preview.placements.length} 箱，目标 ${cartons} 箱。调整尺寸或限高可刷新预览。`, `Current dimensions fit ${preview.placements.length} of the target ${cartons} cartons. Edit dimensions or height to refresh.`)
        : tr(`本单所选货物有 ${preview.orderCartons} 箱待打托，尾托按实际余量生成。`, `This order has ${preview.orderCartons} cartons of the selected cargo to palletize. Tail units use the remaining quantity.`)}</p>
      {mode === "suggest" && <small>{tr("底座高、自重和承重采用当前填写值，请按实际托盘核对。","Deck height, tare and payload use the current inputs. Verify them against the actual pallet.")}</small>}
    </div>}
    {preview && !fine && <button type="button" className="button small" disabled={disabled} onClick={fineTune}>{tr("微调打托尺寸","Fine-tune pallet dimensions")}</button>}
    {fine && <fieldset className="pallet-build-grid"><legend>{tr("微调打托尺寸（mm）","Fine-tune pallet dimensions (mm)")}</legend>
      {fineFields.map(field=><label key={field}>{field==="length"?tr("预览托盘长","Preview pallet length"):field==="width"?tr("预览托盘宽","Preview pallet width"):field==="height"?tr("预览底座高","Preview deck height"):tr("预览托内净高","Preview cargo height")}
        <input inputMode="decimal" value={fine.values[field]} disabled={disabled} onChange={e=>updateFine(field,e.target.value)}/></label>)}
      <small>{tr("修改后自动刷新预览；尚未改动已保存方案。","Edits refresh the preview; the saved plan is unchanged.")}</small>
    </fieldset>}
    {preview&&!fitsTarget&&<p role="alert">{tr("当前微调尺寸装不下目标箱数，请增大尺寸或减少每托箱数后再采用。","These dimensions do not fit the target count. Enlarge them or reduce cartons per pallet before applying.")}</p>}
    <div className="packaging-preview-actions">
      {pending && <>{parsed.state === "empty" && spec.cartonLimit
        ? <button type="button" className="button small" onClick={removeLimit}>{tr("取消每托箱数限制","Remove the carton limit")}</button>
        : <button type="button" className="button primary small" disabled={disabled||!preview||!fitsTarget} onClick={()=>applyPreview()}>{applyLabel ?? (mode === "suggest" || fine ? tr("采用打托方案","Apply pallet design") : tr("采用每托箱数","Apply cartons per pallet"))}</button>}
        {onFineTune&&<button type="button" className="button small" disabled={disabled||!preview||!fitsTarget} onClick={()=>applyPreview(onFineTune)}>{tr("采用并打开完整配置","Apply and open full configuration")}</button>}
        {cartons !== undefined && <button type="button" className="button small" onClick={()=>mode === "suggest" || fine ? restoreCurrent() : suggest()}>
          {mode === "suggest" || fine ? tr("恢复已保存尺寸","Restore saved dimensions") : tr("自动建议尺寸","Suggest dimensions")}
        </button>}
        <button type="button" className="button small" onClick={cancel}>{tr("取消本次调整","Cancel adjustment")}</button></>}
      {!pending && spec.cartonLimit && <>
        {<button type="button" className="button small" onClick={()=>suggest(String(spec.cartonLimit))}>{tr("重新建议尺寸","Suggest dimensions again")}</button>}
        <button type="button" className="button small" onClick={removeLimit}>{tr("取消每托箱数限制","Remove the carton limit")}</button>
      </>}
    </div>
  </section>;
}
