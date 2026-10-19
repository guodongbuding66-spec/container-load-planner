import {assertAccessorySupportWorkflow} from "./accessory-support";
import {inspectLongSupport,longSupportViolation} from "./long-support";
import {containerAccessoryWeight} from "./container-accessories";
import { pack, restorePackingSnapshot, getOrientations, MAX_VISIBLE_PLACEMENTS } from "./engine";
import { quarterTurnOrientation, bodyContactArea } from "./cargo-body";
import { packagingInterior, packagingHeight } from "./packaging";
import { bearingLoads, bearingLimit } from "./bearing";
import { parseFloorPalletConfig, palletCargoCeiling } from "./floor-pallets";
import { DEFAULT_PALLET_BUILD, parsePalletBuild } from "./loading-workflow";
import { palletSpecifications, mixedInspectionContainer, independentPalletVolume } from "./pallet-specifications";
import { cargoShapeOf } from "./cargo-shape";
import { packagingGroupKey, packagingLoads, choosePackaging, type PackagingCandidate, type PackagingChoice } from "./packaging-choice";
import type { PackingRequest, PackingResult, PlacedBox, PlacedPallet, ProductInput, FloorPalletConfig, PalletBuildOptions } from "./types";

export type PreparedUnit = { specificationId: string; id: string; cargo: PlacedBox[]; height: number; weight: number; tail: boolean; topCapacity: number };

/** A flat, complete top and the tightest known residual load limit are required. */
function topCapacity(cargo: PlacedBox[], request: PackingRequest, config: FloorPalletConfig, options: PalletBuildOptions) {
  if (packagingInterior(config).crate || options.stackLayers === 1 || options.maxTopLoadKg <= 0) return 0;
  const top = Math.max(...cargo.map(b => b.z + b.dz));
  const deck: PlacedBox = { id: "__test-top__", productId: "__test-top__", sku: "__loaded-pallet__", name: "Pallet", color: "#997947", x: 0, y: 0, z: top, dx: config.length, dy: config.width, dz: config.height, weight: 1, layer: 1, orientation: "LWH" };
  const rules = new Map(request.products.map(p => [p.id, p]));
  const touching = cargo.filter(b => bodyContactArea(deck, b, undefined, rules.get(b.productId)) > .0001);
  const area = touching.reduce((n, b) => n + bodyContactArea(deck, b, undefined, rules.get(b.productId)), 0);
  if (area < config.length * config.width - .0001 || touching.some(b => rules.get(b.productId)?.stackable === false || rules.get(b.productId)?.allowedAboveSkus !== undefined)) return 0;
  const baseline = bearingLoads(cargo, request.products), unit = bearingLoads([...cargo, deck], request.products);
  let capacity = Math.min(options.maxTopLoadKg, config.maxLoad - cargo.reduce((n, b) => n + b.weight, 0));
  for (const b of cargo) {
    const fraction = (unit.get(b.id) ?? 0) - (baseline.get(b.id) ?? 0), limit = bearingLimit(b, rules.get(b.productId));
    if (fraction > 0 && limit !== undefined) capacity = Math.min(capacity, (limit - (baseline.get(b.id) ?? 0)) / fraction);
  }
  return Math.max(0, capacity);
}

/** Pack cargo with stock-limited specifications, then load rigid units. */
export function palletizeThenPack(request: PackingRequest, input: FloorPalletConfig, mix: "single" | "mixed", maxPallets = 20, build?: PalletBuildOptions) {
  const started = performance.now();
  assertAccessorySupportWorkflow({...request,workflow:"palletized"});
  const config = parseFloorPalletConfig(input);
  const options = parsePalletBuild(build ?? { ...DEFAULT_PALLET_BUILD, config, mix, maxPallets });
  const specifications = palletSpecifications(options), bySpecification = new Map(specifications.map(s=>[s.id,s]));
  const multiple = !!options.primaryRule || !!options.additionalSpecs?.length;
  const only = request.workflow === "pallet-only", strategy = request.strategy ?? "practical";
  if(only&&request.container.exclusions?.length)throw Error("Pallet-only mode has no vehicle site regions / 只打托请清除柜内区域");
  if (request.mode !== "mixed") throw new Error("打托需要明确订单数量");
  const sourceProducts=new Map(request.products.map(p=>[p.id,p]));
  const productIds = new Set(sourceProducts.keys());
  for(const s of specifications)if(s.productIds?.some(id=>!productIds.has(id)))throw new Error("Packaging rule refers to an unknown SKU");
  const remaining = request.products.map(p=>({...p})).sort((a,b)=>Number(b.mustLoad!==false)-Number(a.mustLoad!==false)||b.priority-a.priority);
  const groupKey = packagingGroupKey;
  const groups = new Map<string,ProductInput[]>();
  for(const p of remaining){const key=groupKey(p);groups.set(key,[...groups.get(key)??[],p]);}
  const eligible = new Map(specifications.map(s=>{const allowed=s.productIds?new Set(s.productIds):undefined;return [s.id,new Set([...groups].filter(([,items])=>!allowed||items.every(p=>allowed.has(p.id))).map(([key])=>key))];}));
  const choiceByUnit=new Map<string,Omit<PackagingChoice,"palletId">>();
  const prepared:PreparedUnit[] = [], failed = new Set<string>(), used = new Map(specifications.map(s=>[s.id,0]));
  let cartonCount=0, coordinateLimit=false, lastReason="";
  const canTurn=(cargo:PlacedBox[])=>cargo.every(b=>{
    const p=sourceProducts.get(b.productId)!;
    return getOrientations(p,false).some(o=>o.dx===b.dy&&o.dy===b.dx&&o.dz===b.dz&&((!p.allowedOrientations&&cargoShapeOf(p)==="box")||o.label===`${b.orientation[1]}${b.orientation[0]}${b.orientation[2]}`));
  });
  const unitDirections=(unit:PreparedUnit)=>{
    const c=bySpecification.get(unit.specificationId)!.config;
    return (["LWH",...(canTurn(unit.cargo)?["WLH"]:[])] as ("LWH"|"WLH")[]).filter(code=>c.layout==="auto"||code===(c.layout==="long"?"LWH":"WLH"));
  };
  while(prepared.length<options.maxPallets&&cartonCount<MAX_VISIBLE_PLACEMENTS){
    const first=remaining.find(p=>p.quantity>0&&!failed.has(groupKey(p)));
    if(!first)break;
    const firstKey=groupKey(first);
    let chosen:PreparedUnit|undefined;
    const candidates:{unit:PreparedUnit;summary:PackagingCandidate}[]=[];
    for(const spec of specifications){
      if(used.get(spec.id)!>=spec.maxPallets||!eligible.get(spec.id)!.has(firstKey))continue;
      const c=spec.config,interior=packagingInterior(c);
      if(only&&!c.maxCargoHeight){lastReason="只打托模式请设置货物限高";continue;}
      if(interior.crate&&!only&&packagingHeight(c)>palletCargoCeiling(request.container,request.clearance,{...c,maxCargoHeight:0})+.0001){lastReason="木箱整体高度超过柜内或门洞净高 / Crate exterior exceeds vehicle or door height";continue;}
      const cargoHeight=only||interior.crate?c.maxCargoHeight!:palletCargoCeiling(request.container,request.clearance,c)-c.height;
      if(cargoHeight<=0){lastReason="托盘上方没有可用净高";continue;}
      const products=remaining.filter(p=>!failed.has(groupKey(p))&&eligible.get(spec.id)!.has(groupKey(p))&&(options.mix==="mixed"||groupKey(p)===firstKey));
      const local=pack({...request,palletBuildStage:true,workflow:undefined,palletBuild:undefined,floorPallets:undefined,mode:"mixed",strategy,practicalTargetUtilization:.95,
        container:{id:"build-pallet",name:c.name,category:"pallet",loadingAccess:"open",length:interior.length,width:interior.width,height:cargoHeight,doorWidth:interior.width,doorHeight:cargoHeight,maxWeight:c.maxLoad},clearance:0,products});
      if(!local.validation.valid)throw new Error(local.validation.errors.join("; "));
      // The local floor is a search proxy. Recheck the actual measured boards before
      // committing a complete unit; never trim failed members out of a kit.
      const supportBase:PlacedPallet={id:"build-base",presetId:c.presetId,name:c.name,x:0,y:0,z:0,dx:c.length,dy:c.width,dz:c.height,weight:c.weight,maxLoad:c.maxLoad,orientation:"LWH",packaging:c.packaging};
      const physical={...local,pallets:[supportBase],placements:local.placements.map(b=>({...b,x:b.x+interior.inset,y:b.y+interior.inset,z:b.z+c.height}))};
      const violation=inspectLongSupport(physical,products).map(longSupportViolation).find(Boolean);
      if(violation){lastReason=violation;continue;}
      if(!local.placements.some(b=>groupKey(sourceProducts.get(b.productId)!)===firstKey))continue;
      if(cartonCount+local.placements.length>MAX_VISIBLE_PLACEMENTS){coordinateLimit=true;if(options.selection==="compact")continue;break;}
      const height=Math.max(...local.placements.map(b=>b.z+b.dz));
      const unit:PreparedUnit={id:`unit-${prepared.length+1}`,specificationId:spec.id,cargo:local.placements,height:interior.crate?packagingHeight(c):height+c.height,weight:local.metrics.grossWeight+c.weight,
        tail:local.summaries.every(s=>s.unloaded===0),topCapacity:only?0:topCapacity(local.placements,request,c,{...options,config:c,stackLayers:spec.stackLayers,maxTopLoadKg:spec.maxTopLoadKg})};
      if(!only&&(multiple||options.selection==="compact")){const directions=unitDirections(unit),v=request.container,g=request.clearance;
        if(!directions.some(code=>{const dx=code==="LWH"?c.length:c.width,dy=code==="LWH"?c.width:c.length;return dx<=v.length-2*g+.0001&&dy<=Math.min(v.width,v.loadingAccess==="open"?v.width:v.doorWidth)-2*g+.0001&&unit.height<=Math.min(v.height,v.loadingAccess==="open"?v.height:v.doorHeight)-g+.0001;}))continue;
      }
      if(!only&&options.selection==="compact"&&unit.weight>request.container.maxWeight-containerAccessoryWeight(request.container)+.0001)continue;
      if(options.selection!=="compact"){chosen=unit;break;}
      candidates.push({unit,summary:{specificationId:spec.id,cartons:unit.cargo.length,loads:packagingLoads(unit.cargo,[...groups.values()]),exterior:[c.length,c.width,unit.height],tareKg:c.weight}});
    }
    if(candidates.length){const choice=choosePackaging(candidates.map(c=>c.summary),[...groups.keys()]);chosen=candidates.find(c=>c.summary===choice.candidate)!.unit;choiceByUnit.set(chosen.id,{chosenSpecificationId:chosen.specificationId,reason:choice.reason,candidates:candidates.map(c=>c.summary)});}
    if(coordinateLimit&&!chosen)break;
    if(!chosen){failed.add(firstKey);continue;}
    prepared.push(chosen);used.set(chosen.specificationId,used.get(chosen.specificationId)!+1);cartonCount+=chosen.cargo.length;
    const counts=new Map<string,number>();for(const b of chosen.cargo)counts.set(b.productId,(counts.get(b.productId)??0)+1);
    for(const p of remaining)p.quantity-=counts.get(p.id)??0;
  }
  if(!prepared.length)throw new Error(lastReason||"没有货物能按当前尺寸、限高、载重、朝向或完整套装规则放上托盘");
  const units:ProductInput[]=prepared.map(p=>{
    const spec=bySpecification.get(p.specificationId)!,c=spec.config;
    return {id:p.id,sku:p.id,name:c.name,length:c.length,width:c.width,height:p.height,weight:p.weight,quantity:1,priority:Math.max(...p.cargo.map(b=>sourceProducts.get(b.productId)!.priority)),mustLoad:p.cargo.some(b=>sourceProducts.get(b.productId)!.mustLoad!==false),rotationPolicy:"upright",allowedOrientations:unitDirections(p),stackable:p.topCapacity>0,maxTopLoadKg:p.topCapacity,maxStackLayers:spec.stackLayers,bottomOnly:packagingInterior(c).crate||spec.stackLayers===1,minimumSupportRatio:1,protectionGap:c.gap,cargoType:"pallet",palletBaseHeight:c.height,color:"#997947"};
  });
  const columns=Math.min(5,Math.ceil(Math.sqrt(prepared.length))),cellLength=Math.max(...prepared.map(u=>bySpecification.get(u.specificationId)!.config.length)),cellWidth=Math.max(...prepared.map(u=>bySpecification.get(u.specificationId)!.config.width));
  const container=only?mixedInspectionContainer(prepared.map(p=>bySpecification.get(p.specificationId)!.config)):request.container;
  const loadable=units.filter(p=>p.allowedOrientations!.length);
  const outer=only?null:pack({...request,container:{...request.container,exclusions:request.container.exclusions?.map(z=>z.accessory?{...z,accessory:{...z.accessory,relatedProductIds:[]}}:z)},workflow:undefined,palletBuild:undefined,floorPallets:undefined,products:loadable.length?loadable:units.map(p=>({...p,quantity:0,allowedOrientations:["LWH"]})),loadingRules:request.loadingRules?{...request.loadingRules,supportByType:undefined}:undefined,mode:"mixed",strategy});
  if(outer&&!outer.validation.valid)throw new Error(outer.validation.errors.join("; "));
  const outerBoxes:PlacedBox[]=outer?.placements??prepared.map((u,i)=>{const c=bySpecification.get(u.specificationId)!.config;return {id:u.id,productId:u.id,sku:u.id,name:c.name,color:"#997947",x:i%columns*(cellLength+200),y:Math.floor(i/columns)*(cellWidth+200),z:0,dx:c.length,dy:c.width,dz:u.height,weight:u.weight,layer:1,orientation:"LWH"};});
  const selectionChoices:PackagingChoice[]=[];
  const placements:PlacedBox[]=[],pallets:PlacedPallet[]=[],setCounters=new Map<string,number>();
  for(const b of outerBoxes){
    const unit=prepared.find(p=>p.id===b.productId)!,c=bySpecification.get(unit.specificationId)!.config,interior=packagingInterior(c),cross=b.orientation==="WLH",palletId=`floor-pallet-${pallets.length+1}`,setMap=new Map<string,number>();
    pallets.push({id:palletId,presetId:c.presetId,name:c.name,x:b.x,y:b.y,z:b.z,dx:b.dx,dy:b.dy,dz:c.height,weight:c.weight,maxLoad:c.maxLoad,orientation:cross?"WLH":"LWH",...(multiple?{specificationId:unit.specificationId}:{}),...(c.packaging?{packaging:c.packaging}:{}),...(interior.crate?{enclosureHeight:unit.height}:{})});
    const choice=choiceByUnit.get(unit.id);if(choice)selectionChoices.push({...choice,palletId});
    for(const cargo of unit.cargo){let setNumber=cargo.setNumber;if(cargo.setCode){const key=`${cargo.setCode}/${cargo.setNumber}`;if(!setMap.has(key)){const next=(setCounters.get(cargo.setCode)??0)+1;setCounters.set(cargo.setCode,next);setMap.set(key,next);}setNumber=setMap.get(key);}
      placements.push({...cargo,id:`prebuilt-${placements.length+1}`,x:b.x+(cross?cargo.y+interior.inset:cargo.x+interior.inset),y:b.y+(cross?c.length-interior.inset-cargo.x-cargo.dx:cargo.y+interior.inset),z:b.z+cargo.z+c.height,dx:cross?cargo.dy:cargo.dx,dy:cross?cargo.dx:cargo.dy,...(cross?quarterTurnOrientation(cargo):{}),setNumber,palletIds:[palletId]});
    }
  }
  const bounded=(prepared.length===options.maxPallets||coordinateLimit||cartonCount>=MAX_VISIBLE_PLACEMENTS)&&remaining.some(p=>p.quantity>0);
  const palletization={...(options.selection===undefined?{}:{selection:options.selection}),...(options.selection==="compact"?{selectionChoices}:{}),config:options.config,mix:options.mix,...(build?{stackLayers:options.stackLayers,maxTopLoadKg:options.maxTopLoadKg,preparedCount:prepared.length,bounded,only}:{}),...(multiple?{specifications,preparedBySpecification:Object.fromEntries(used)}:{})};
  const plan:PackingResult=restorePackingSnapshot({...request,floorPallets:undefined,container,clearance:only?0:request.clearance,strategy},{strategy,placements,pallets,palletization});
  plan.warnings=["货物打托与整托坐标已通过独立校验"];
  if(bounded)plan.warnings.push("已达到托盘或箱位搜索上限，未完成订单仍保留");
  if(options.selection==="compact")plan.warnings.push("多规格逐托比较：优先满足必装与高优先级货量，同货量依次选更小外包络、更小占地和更轻包装；局部启发式不保证全局最少托数或费用。");
  else if(multiple)plan.warnings.push("多种包装按列表顺序和适用 SKU 尝试；每种可用数量独立限制，不推定全局最少包装数。");
  if(!pallets.length)plan.warnings.push("完整托盘无法在当前柜型、门洞、净空或载重条件下装入；请调整打托规格或柜型");
  if(remaining.some(p=>p.quantity>0)&&multiple)plan.warnings.push("仍有货物待打包，请核对各规格适用 SKU、可用数量、净空与完整套装要求。");
  plan.workflow=only?"pallet-only":"palletized";plan.palletBuild=options;
  if(only){plan.metrics.effectiveVolume=independentPalletVolume(palletization,pallets);plan.metrics.volumeUtilization=plan.metrics.loadedVolume/plan.metrics.effectiveVolume;if(plan.metrics.envelopeVolume!==undefined)plan.metrics.envelopeUtilization=plan.metrics.envelopeVolume/plan.metrics.effectiveVolume;plan.warnings.unshift("仅生成独立托盘；三维编组位置用于查看，不代表柜内箱位。利用率按每托限高包络统计");}
  if(prepared.some(p=>packagingInterior(bySpecification.get(p.specificationId)!.config).crate))plan.warnings.unshift("木箱按实际内尺寸装货、完整外形装柜；自重请填写包含底座与围板的实测总重。木箱按单层布置，未推定框架承重 / Crates use measured interior, exterior and complete tare; frame strength is not inferred and crate units remain on the floor");
  if(!only&&specifications.some(s=>s.stackLayers>1))plan.warnings.unshift("整托堆叠按声明的整托上压和已提供的箱体承重核验；缺少箱体承重资料时不能视为逐箱承重已核验");
  plan.metrics.solveTimeMs=performance.now()-started;
  return {plan,prepared,loadedPallets:pallets.length,unloadedPallets:prepared.length-pallets.length,remaining:plan.summaries.filter(s=>s.unloaded>0),bounded};
}
