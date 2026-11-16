import {declaredUnitStacking,declaredStackLayers,declaredTopLoad,openUnitLayers} from "./unit-stacking";
import {reviewPalletLowerBound,type PalletSearchSummary} from "./pallet-search";
import {looseReservationErrors,looseOutsideUnit} from "./loose-cargo";
import {applyTypeSupport,DEFAULT_LOADING_RULES} from "./loading-rules";
import {retainsLoadedRows} from "./set-utils";
import {crateAutoEnabled,crateTopCapacity,crateCandidateAllowed,isCrate} from "./crate-auto-stack";
import {completePackagingTare,deckSupportHeight} from "./deck-support";
import {assertAccessorySupportWorkflow} from "./accessory-support";
import {inspectLongSupport,longSupportViolation} from "./long-support";
import {containerAccessoryWeight} from "./container-accessories";
import { pack, searchRigidUnits, restorePackingSnapshot, getOrientations, MAX_VISIBLE_PLACEMENTS } from "./engine";
import { quarterTurnOrientation, bodyContactArea } from "./cargo-body";
import { packagingInterior, packagingHeight } from "./packaging";
import { bearingLoads, bearingLimit } from "./bearing";
import { parseFloorPalletConfig, palletCargoCeiling } from "./floor-pallets";
import { DEFAULT_PALLET_BUILD, parsePalletBuild } from "./loading-workflow";
import { palletSpecifications, mixedInspectionContainer, independentPalletVolume } from "./pallet-specifications";
import { cargoShapeOf } from "./cargo-shape";
import { packagingGroupKey, packagingLoads, choosePackaging, type PackagingCandidate, type PackagingChoice } from "./packaging-choice";
import {palletPreparationRequest,parsePreparedPalletLayout} from "./prepared-pallet-layout";
import type { ContainerSpec, PackingRequest, PackingResult, PlacedBox, PlacedPallet, ProductInput, FloorPalletConfig, PalletBuildOptions } from "./types";

export type PreparedUnit = { specificationId: string; id: string; cargo: PlacedBox[]; height: number; weight: number; tail: boolean; topCapacity: number };

export function loadedPalletDirections(config: FloorPalletConfig, cargo: PlacedBox[], products: ReadonlyMap<string, ProductInput>) {
  const canTurn = cargo.every(b => {
    const p = products.get(b.productId)!;
    return getOrientations(p, false).some(o => o.dx === b.dy && o.dy === b.dx && o.dz === b.dz &&
      ((!p.allowedOrientations && cargoShapeOf(p) === "box") || o.label === `${b.orientation[1]}${b.orientation[0]}${b.orientation[2]}`));
  });
  const directions: ("LWH" | "WLH")[] = canTurn ? ["LWH", "WLH"] : ["LWH"];
  return directions.filter(code => config.layout === "auto" || code === (config.layout === "long" ? "LWH" : "WLH"));
}

export function loadedPalletFits(container: ContainerSpec, clearance: number, config: FloorPalletConfig, height: number, directions: ("LWH" | "WLH")[]) {
  return directions.some(code => {
    const [dx, dy] = code === "LWH" ? [config.length, config.width] : [config.width, config.length];
    const width = container.loadingAccess === "open" ? container.width : Math.min(container.width, container.doorWidth);
    return dx <= container.length - 2 * clearance + .0001 && dy <= width - 2 * clearance + .0001 &&
      height <= palletCargoCeiling(container, clearance, {...config, maxCargoHeight: 0}) + .0001;
  });
}

export function packPalletCargo(request: PackingRequest, config: FloorPalletConfig, cargoHeight: number, products: ProductInput[], cartonLimit?: number) {
  const inside = packagingInterior(config);
  const supports = config.packaging?.deckSupports?.map(s => ({
    id:s.id, name:s.name, kind:"obstacle" as const, x:s.x-inside.inset, y:s.y-inside.inset, z:0, dx:s.dx, dy:s.dy, dz:s.dz,
    accessory:{type:"timber" as const, quantity:1, unitWeightKg:s.weightKg, phase:"before-cargo" as const, relatedProductIds:[], afterAccessoryIds:[], source:s.source, revision:s.revision, note:"", support:{version:1 as const, surface:"solid-rectangle" as const, maxLoadKg:s.maxLoadKg}},
  }));
  const plan = pack({
    ...request, delivery:undefined, palletBuildStage:true, palletCartonLimit:cartonLimit, workflow:undefined, palletBuild:undefined,
    floorPallets:undefined, mode:"mixed", strategy:request.strategy ?? "practical", practicalTargetUtilization:.95, clearance:0, products,
    container:{id:"build-pallet", name:config.name, category:"pallet", loadingAccess:"open", length:inside.length, width:inside.width,
      height:cargoHeight, doorWidth:inside.width, doorHeight:cargoHeight, maxWeight:config.maxLoad, ...(supports?.length ? {exclusions:supports} : {})},
  });
  if (!plan.validation.valid) throw new Error(plan.validation.errors.join("; "));
  // The local floor is a search proxy. Recheck the actual measured deck.
  const supportBase: PlacedPallet = {id:"build-base", presetId:config.presetId, name:config.name, x:0, y:0, z:0, dx:config.length,
    dy:config.width, dz:config.height, weight:completePackagingTare(config), maxLoad:config.maxLoad, orientation:"LWH", packaging:config.packaging};
  const physical = {...plan, container:{...plan.container, length:config.length, width:config.width, height:config.height+cargoHeight, exclusions:undefined},
    pallets:[supportBase], placements:plan.placements.map(b=>({...b, x:b.x+inside.inset, y:b.y+inside.inset, z:b.z+config.height}))};
  const violation = inspectLongSupport(physical, products).map(longSupportViolation).find(Boolean);
  return {plan, violation};
}

/** A flat, complete top and the tightest known residual load limit are required. */
function topCapacity(cargo: PlacedBox[], request: PackingRequest, config: FloorPalletConfig, options: PalletBuildOptions) {
  if (packagingInterior(config).crate) return crateTopCapacity(config, config.weight + cargo.reduce((n,b)=>n+b.weight,0));
  const layers=openUnitLayers(options),topLimit=config.unitStacking?.enabled?Math.min(declaredTopLoad(config),options.maxTopLoadKg>0?options.maxTopLoadKg:100000):options.maxTopLoadKg;
  if (config.packaging?.deckSupports?.length || layers === 1 || topLimit <= 0) return 0;
  const top = Math.max(...cargo.map(b => b.z + b.dz));
  const deck: PlacedBox = { id: "__test-top__", productId: "__test-top__", sku: "__loaded-pallet__", name: "Pallet", color: "#997947", x: 0, y: 0, z: top, dx: config.length, dy: config.width, dz: config.height, weight: 1, layer: 1, orientation: "LWH" };
  const rules = new Map(request.products.map(p => [p.id, p]));
  const touching = cargo.filter(b => bodyContactArea(deck, b, undefined, rules.get(b.productId)) > .0001);
  const area = touching.reduce((n, b) => n + bodyContactArea(deck, b, undefined, rules.get(b.productId)), 0);
  if (area < config.length * config.width - .0001 || touching.some(b => rules.get(b.productId)?.stackable === false || rules.get(b.productId)?.allowedAboveSkus !== undefined)) return 0;
  const baseline = bearingLoads(cargo, request.products), unit = bearingLoads([...cargo, deck], request.products);
  let capacity = Math.min(topLimit, config.maxLoad - cargo.reduce((n, b) => n + b.weight, 0));
  for (const b of cargo) {
    const fraction = (unit.get(b.id) ?? 0) - (baseline.get(b.id) ?? 0), limit = bearingLimit(b, rules.get(b.productId));
    if (fraction > 0 && limit !== undefined) capacity = Math.min(capacity, (limit - (baseline.get(b.id) ?? 0)) / fraction);
  }
  return Math.max(0, capacity);
}

/** Pack cargo with stock-limited specifications, then load rigid units. */
function buildPalletCandidate(request: PackingRequest, input: FloorPalletConfig, mix: "single" | "mixed", maxPallets = 20, build?: PalletBuildOptions) {
  const started = performance.now();
  assertAccessorySupportWorkflow({...request,workflow:"palletized"});
  const config = parseFloorPalletConfig(input);
  const options = parsePalletBuild(build ?? { ...DEFAULT_PALLET_BUILD, config, mix, maxPallets });
  const specifications = palletSpecifications(options), bySpecification = new Map(specifications.map(s=>[s.id,s]));
  const multiple = !!options.primaryRule || !!options.additionalSpecs?.length;
  const only = request.workflow === "pallet-only", strategy = request.strategy ?? "practical";
  if(only&&request.container.exclusions?.length)throw Error("Pallet-only mode has no vehicle site regions / 只打托请清除柜内区域");
  if (request.mode !== "mixed") throw new Error("打托需要明确订单数量");
  const allocationErrors=looseReservationErrors(options.looseQuantities,request.products,only);
  if(allocationErrors.length)throw Error(allocationErrors.join("; "));
  const looseProducts=applyTypeSupport(request.products.filter(p=>(options.looseQuantities?.[p.id]??0)>0).map(p=>({...p,quantity:options.looseQuantities![p.id]})),request.loadingRules);
  const sourceProducts=new Map(request.products.map(p=>[p.id,p]));
  const productIds = new Set(sourceProducts.keys());
  for(const s of specifications)if(s.productIds?.some(id=>!productIds.has(id)))throw new Error("Packaging rule refers to an unknown SKU");
  const remaining = request.products.map(p=>({...p,quantity:p.quantity-(options.looseQuantities?.[p.id]??0)})).sort((a,b)=>Number(b.mustLoad!==false)-Number(a.mustLoad!==false)||b.priority-a.priority);
  const groupKey = packagingGroupKey;
  const groups = new Map<string,ProductInput[]>();
  for(const p of remaining){const key=groupKey(p);groups.set(key,[...groups.get(key)??[],p]);}
  const eligible = new Map(specifications.map(s=>{const allowed=s.productIds?new Set(s.productIds):undefined;return [s.id,new Set([...groups].filter(([,items])=>!allowed||items.every(p=>allowed.has(p.id))).map(([key])=>key))];}));
  const choiceByUnit=new Map<string,Omit<PackagingChoice,"palletId">>();
  const prepared:PreparedUnit[] = [], failed = new Set<string>(), used = new Map(specifications.map(s=>[s.id,0]));
  let cartonCount=0, coordinateLimit=false, lastReason="";
  const unitDirections = (unit: PreparedUnit) => loadedPalletDirections(bySpecification.get(unit.specificationId)!.config, unit.cargo, sourceProducts);
  const nextUnitId=()=>{let id=`unit-${prepared.length+1}`;while(sourceProducts.has(id))id=`_${id}`;return id;};
  const recordUnit=(unit:PreparedUnit)=>{
    prepared.push(unit);
    used.set(unit.specificationId,used.get(unit.specificationId)!+1);
    cartonCount+=unit.cargo.length;
    const counts=new Map<string,number>();
    for(const b of unit.cargo)counts.set(b.productId,(counts.get(b.productId)??0)+1);
    for(const p of remaining)p.quantity-=counts.get(p.id)??0;
  };
  const manual=request.preparedPalletLayout!==undefined;
  if(manual){
    try {
      if(!only){
        // Validate all prepared units independently, including ones the vehicle solver may leave behind.
        const inspection=palletPreparationRequest(request,options);
        const build=inspection.palletBuild!;
        const baseline=buildPalletCandidate(inspection,build.config,build.mix,build.maxPallets,build);
        for(const unit of baseline.prepared){
          const spec=bySpecification.get(unit.specificationId)!;
          recordUnit({...unit,topCapacity:topCapacity(unit.cargo,request,spec.config,{...options,config:spec.config,stackLayers:spec.stackLayers,maxTopLoadKg:spec.maxTopLoadKg})});
        }
      }else{
        const layout=parsePreparedPalletLayout(request.preparedPalletLayout)!;
        if(layout.units.length>options.maxPallets)throw Error("托数超过生成上限 / Prepared units exceed the configured limit");
        for(const unit of layout.units){
          const spec=bySpecification.get(unit.specificationId);
          if(!spec||used.get(spec.id)!>=spec.maxPallets)throw Error("包装规格不存在或库存不足 / Missing packaging specification or insufficient stock");
          const c=spec.config,inside=packagingInterior(c),id=nextUnitId();
          const cargo=unit.cartons.map((box,i)=>{
            const product=sourceProducts.get(box.productId);
            if(!product)throw Error("订单货物已删除 / A carton is missing from the order");
            if(!c.maxCargoHeight||box.x<inside.inset-.0001||box.y<inside.inset-.0001||
              box.x+box.dx>inside.inset+inside.length+.0001||box.y+box.dy>inside.inset+inside.width+.0001||
              box.z+box.dz>c.maxCargoHeight+.0001)throw Error(`${product.sku} · 箱体超出托内空间 / Carton exceeds the usable pallet space`);
            return {...box,id:`${id}-${i+1}`,sku:product.sku,name:product.name,color:product.color,x:box.x-inside.inset,y:box.y-inside.inset};
          });
          const height=inside.crate?packagingHeight(c):c.height+Math.max(deckSupportHeight(c),...cargo.map(b=>b.z+b.dz));
          const weight=completePackagingTare(c)+cargo.reduce((n,b)=>n+b.weight,0);
          recordUnit({id,specificationId:spec.id,cargo,height,weight,topCapacity:0,tail:false});
        }
        if(remaining.some(p=>p.quantity<0))throw Error("布置箱数超过当前待打托数量 / Prepared cartons exceed current quantities after loose reservations");
      }
    }catch(error){
      throw Error(`人工托内布置校验失败，请检查当前规格与订单，或恢复自动打托 / Manual pallet layout failed validation; review specifications and order, or return to automatic palletizing · ${error instanceof Error?error.message:String(error)}`);
    }
  }
  while(!manual&&prepared.length<options.maxPallets&&cartonCount<MAX_VISIBLE_PLACEMENTS){
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
      if(deckSupportHeight(c)>=cargoHeight){lastReason="托内支承件已占满当前货物净高 / Deck supports occupy the cargo height";continue;}
      const {plan:local, violation} = packPalletCargo(request,c,cargoHeight,products,spec.cartonLimit);
      if(violation){lastReason=violation;continue;}
      if(!local.placements.some(b=>groupKey(sourceProducts.get(b.productId)!)===firstKey)){if(c.packaging?.deckSupports?.length)lastReason="托内支承条件下未找到完整货物；请检查接触、静载、朝向、悬跨、净高及套装规则。有限搜索不证明无解 / No complete cargo found under current deck support constraints; check contact, static limits, orientation, spans, height and kits. Bounded search is not an infeasibility proof";continue;}
      if(cartonCount+local.placements.length>MAX_VISIBLE_PLACEMENTS){coordinateLimit=true;if(options.selection==="compact")continue;break;}
      const height=Math.max(deckSupportHeight(c),...local.placements.map(b=>b.z+b.dz));
      const unitId=nextUnitId();
      const unit:PreparedUnit={id:unitId,specificationId:spec.id,cargo:local.placements,height:interior.crate?packagingHeight(c):height+c.height,weight:local.metrics.grossWeight+c.weight,
        tail:local.summaries.every(s=>s.unloaded===0),topCapacity:only?0:topCapacity(local.placements,request,c,{...options,config:c,stackLayers:spec.stackLayers,maxTopLoadKg:spec.maxTopLoadKg})};
      if (!only && (multiple || options.selection === "compact") && !loadedPalletFits(request.container,request.clearance,c,unit.height,unitDirections(unit))) continue;
      if(!only&&options.selection==="compact"&&unit.weight>request.container.maxWeight-containerAccessoryWeight(request.container)+.0001)continue;
      if(options.selection!=="compact"){chosen=unit;break;}
      candidates.push({unit,summary:{specificationId:spec.id,cartons:unit.cargo.length,loads:packagingLoads(unit.cargo,[...groups.values()]),exterior:[c.length,c.width,unit.height],tareKg:completePackagingTare(c)}});
    }
    if(candidates.length){const choice=choosePackaging(candidates.map(c=>c.summary),[...groups.keys()]);chosen=candidates.find(c=>c.summary===choice.candidate)!.unit;choiceByUnit.set(chosen.id,{chosenSpecificationId:chosen.specificationId,reason:choice.reason,candidates:candidates.map(c=>c.summary)});}
    if(coordinateLimit&&!chosen)break;
    if(!chosen){failed.add(firstKey);continue;}
    recordUnit(chosen);
  }
  if(!prepared.length&&!looseProducts.length)throw new Error(lastReason||"没有货物能按当前尺寸、限高、载重、朝向或完整套装规则放上托盘");
  const units:ProductInput[]=prepared.map(p=>{
    const spec=bySpecification.get(p.specificationId)!,c=spec.config;
    return {id:p.id,sku:p.id,name:c.name,length:c.length,width:c.width,height:p.height,weight:p.weight,quantity:1,priority:Math.max(...p.cargo.map(b=>sourceProducts.get(b.productId)!.priority)),mustLoad:p.cargo.some(b=>sourceProducts.get(b.productId)!.mustLoad!==false),rotationPolicy:"upright",allowedOrientations:unitDirections(p),stackable:p.topCapacity>0,maxTopLoadKg:p.topCapacity,maxStackLayers:isCrate(c)?declaredUnitStacking(c)?declaredStackLayers(c):Math.min(20,c.unitStacking?.maxLayers||20):openUnitLayers(spec),bottomOnly:isCrate(c)?!crateAutoEnabled(c):openUnitLayers(spec)===1,minimumSupportRatio:1,protectionGap:c.gap,cargoType:"pallet",palletBaseHeight:c.height,color:"#997947"};
  });
  const columns=Math.min(5,Math.ceil(Math.sqrt(prepared.length))),cellLength=Math.max(...prepared.map(u=>bySpecification.get(u.specificationId)!.config.length)),cellWidth=Math.max(...prepared.map(u=>bySpecification.get(u.specificationId)!.config.width));
  const container=only?mixedInspectionContainer(prepared.map(p=>bySpecification.get(p.specificationId)!.config)):request.container;
  const loadable=[...units.filter(p=>p.allowedOrientations!.length),...looseProducts];
  const outerRequest:PackingRequest={...request,delivery:undefined,container:{...request.container,engineering:undefined,exclusions:request.container.exclusions?.map(z=>z.accessory?{...z,accessory:{...z.accessory,relatedProductIds:[]}}:z)},workflow:undefined,palletBuild:undefined,floorPallets:undefined,products:loadable.length?loadable:units.map(p=>({...p,quantity:0,allowedOrientations:["LWH"]})),loadingRules:request.loadingRules?{...request.loadingRules,supportByType:undefined}:undefined,mode:"mixed",strategy};
  const resolveCrate=(b:PlacedBox)=>{const unit=prepared.find(p=>p.id===b.productId);if(!unit)return undefined;const c=bySpecification.get(unit.specificationId)!.config;return isCrate(c)?{config:c,cargoKg:unit.weight-c.weight,pallet:{...b,id:b.productId,presetId:c.presetId,name:c.name,dz:c.height,enclosureHeight:unit.height,weight:c.weight,maxLoad:c.maxLoad,orientation:b.orientation as "LWH"|"WLH",packaging:c.packaging}}:undefined;};
  const unitById=new Map(prepared.map(u=>[u.id,u]));
  const candidateAllowed=(candidate:PlacedBox,placed:readonly PlacedBox[])=>{
    const own=unitById.get(candidate.productId);
    for(const other of placed){const otherUnit=unitById.get(other.productId);if(!!own===!!otherUnit)continue;
      const unit=own??otherUnit!,loose=own?other:candidate,envelope=own?candidate:other,c=bySpecification.get(unit.specificationId)!.config;
      if(!looseOutsideUnit(loose,envelope,Math.max(c.gap,sourceProducts.get(loose.productId)?.protectionGap??0)))return false;
    }
    return crateCandidateAllowed(candidate,placed,resolveCrate);
  };
  const packOuter=(r:PackingRequest)=>looseProducts.length||prepared.some(u=>isCrate(bySpecification.get(u.specificationId)!.config))?searchRigidUnits(r,candidateAllowed):pack(r);
  let outer=only?null:packOuter(outerRequest),compactOrderImproved=false;
  // Once small-spec stock is exhausted, larger fallback units still exist in the
  // prepared list. Volume-first sorting can let them displace all small units.
  // Compare an alternate order under automatic search, using original carton
  // rows rather than proxy-unit counts. Explicit cargo-order preferences stay intact.
  if(outer&&options.selection==="compact"&&specifications.length>1&&(!request.loadingRules||request.loadingRules.cargoOrder==="auto")){
    const candidate=packOuter({...outerRequest,loadingRules:{...DEFAULT_LOADING_RULES,...outerRequest.loadingRules,cargoOrder:"small-first"}});
    const cargoRows=(plan:Pick<PackingResult,"placements">)=>plan.placements.flatMap(b=>unitById.get(b.productId)?.cargo??[b]);
    const baselineRows=cargoRows(outer),candidateRows=cargoRows(candidate);
    if(candidate.validation.valid&&candidateRows.length>baselineRows.length&&retainsLoadedRows(candidateRows,baselineRows)){outer=candidate;compactOrderImproved=true;}
  }
  if(outer&&!outer.validation.valid)throw new Error(outer.validation.errors.join("; "));
  const outerBoxes:PlacedBox[]=outer?.placements??prepared.map((u,i)=>{const c=bySpecification.get(u.specificationId)!.config;return {id:u.id,productId:u.id,sku:u.id,name:c.name,color:"#997947",x:i%columns*(cellLength+200),y:Math.floor(i/columns)*(cellWidth+200),z:0,dx:c.length,dy:c.width,dz:u.height,weight:u.weight,layer:1,orientation:"LWH"};});
  const selectionChoices:PackagingChoice[]=[];
  const placements:PlacedBox[]=[],pallets:PlacedPallet[]=[],setCounters=new Map<string,number>();
  for(const b of outerBoxes.filter(b=>unitById.has(b.productId))){
    const unit=prepared.find(p=>p.id===b.productId)!,c=bySpecification.get(unit.specificationId)!.config,interior=packagingInterior(c),cross=b.orientation==="WLH",palletId=`floor-pallet-${pallets.length+1}`,setMap=new Map<string,number>();
    pallets.push({id:palletId,presetId:c.presetId,name:c.name,x:b.x,y:b.y,z:b.z,dx:b.dx,dy:b.dy,dz:c.height,weight:completePackagingTare(c),maxLoad:c.maxLoad,orientation:cross?"WLH":"LWH",...(multiple?{specificationId:unit.specificationId}:{}),...(c.packaging?{packaging:c.packaging}:{}),...(interior.crate?{enclosureHeight:unit.height}:{})});
    const choice=choiceByUnit.get(unit.id);if(choice)selectionChoices.push({...choice,palletId});
    for(const cargo of unit.cargo){let setNumber=cargo.setNumber;if(cargo.setCode){const key=`${cargo.setCode}/${cargo.setNumber}`;if(!setMap.has(key)){const next=(setCounters.get(cargo.setCode)??0)+1;setCounters.set(cargo.setCode,next);setMap.set(key,next);}setNumber=setMap.get(key);}
      placements.push({...cargo,id:`prebuilt-${placements.length+1}`,x:b.x+(cross?cargo.y+interior.inset:cargo.x+interior.inset),y:b.y+(cross?c.length-interior.inset-cargo.x-cargo.dx:cargo.y+interior.inset),z:b.z+cargo.z+c.height,dx:cross?cargo.dy:cargo.dx,dy:cross?cargo.dx:cargo.dy,...(cross?quarterTurnOrientation(cargo):{}),setNumber,palletIds:[palletId]});
    }
  }
  const looseSetMap=new Map<string,number>();
  for(const cargo of outerBoxes.filter(b=>!unitById.has(b.productId))){let setNumber=cargo.setNumber;if(cargo.setCode){const key=`${cargo.setCode}/${cargo.setNumber}`;if(!looseSetMap.has(key)){const next=(setCounters.get(cargo.setCode)??0)+1;setCounters.set(cargo.setCode,next);looseSetMap.set(key,next);}setNumber=looseSetMap.get(key);}
    placements.push({...cargo,id:`prebuilt-${placements.length+1}`,setNumber,palletIds:undefined});
  }
  if(placements.length>MAX_VISIBLE_PLACEMENTS)throw Error("Mixed load exceeds the coordinate limit / 混装超过箱位上限，请减少生成托盘或散装预留");
  const bounded=(prepared.length===options.maxPallets||coordinateLimit||cartonCount>=MAX_VISIBLE_PLACEMENTS)&&remaining.some(p=>p.quantity>0);
  const palletization={...(manual?{manualPreparation:true}:{}),...(options.looseQuantities?{looseQuantities:options.looseQuantities}:{}),...(options.selection===undefined?{}:{selection:options.selection}),...(!manual&&options.selection==="compact"?{selectionChoices}:{}),config:options.config,mix:options.mix,...(build?{stackLayers:options.stackLayers,maxTopLoadKg:options.maxTopLoadKg,preparedCount:prepared.length,bounded,only}:{}),...(multiple?{specifications,preparedBySpecification:Object.fromEntries(used)}:{})};
  const plan:PackingResult=restorePackingSnapshot({...request,floorPallets:undefined,container,clearance:only?0:request.clearance,strategy},{strategy,placements,pallets,palletization,delivery:request.delivery,accessConfig:request.accessConfig});
  plan.warnings=["货物打托与整托坐标已通过独立校验"];
  if(compactOrderImproved)plan.warnings.push("已比较小包装优先的整托入柜顺序；采用的候选增加箱数且各已装订单行不减量 / Compared compact-first unit loading; the adopted candidate increases cartons without reducing any loaded order row");
  if(bounded)plan.warnings.push("已达到托盘或箱位搜索上限，未完成订单仍保留");
  if(manual)plan.warnings.push("已采用人工托内布置 / Using the approved manual pallet layout");
  else if(options.selection==="compact")plan.warnings.push("多规格逐托比较：优先满足必装与高优先级货量，同货量依次选更小外包络、更小占地和更轻包装；局部启发式不保证全局最少托数或费用。");
  else if(multiple)plan.warnings.push("多种包装按列表顺序和适用 SKU 尝试；每种可用数量独立限制，不推定全局最少包装数。");
  if(prepared.length&&!pallets.length)plan.warnings.push("完整托盘无法在当前柜型、门洞、净空或载重条件下装入；请调整打托规格或柜型");
  if(remaining.some(p=>p.quantity>0)&&multiple)plan.warnings.push("仍有货物待打包，请核对各规格适用 SKU、可用数量、净空与完整套装要求。");
  if(looseProducts.length)plan.warnings.push("按指定箱数预留散装；其余货物保持完整托盘。散箱不占用整托内部，也不与整托互相承托；未装数量仍在订单中 / Loose reservations are explicit; complete units stay intact. Loose cargo cannot use unit voids or cross-support units. Unloaded quantities remain in the order");
  plan.workflow=only?"pallet-only":"palletized";plan.palletBuild=options;
  if(only){plan.metrics.effectiveVolume=independentPalletVolume(palletization,pallets);plan.metrics.volumeUtilization=plan.metrics.loadedVolume/plan.metrics.effectiveVolume;if(plan.metrics.envelopeVolume!==undefined)plan.metrics.envelopeUtilization=plan.metrics.envelopeVolume/plan.metrics.effectiveVolume;plan.warnings.unshift("仅生成独立托盘；三维编组位置用于查看，不代表柜内箱位。利用率按每托限高包络统计");}
  if(prepared.some(p=>declaredUnitStacking(bySpecification.get(p.specificationId)!.config)))plan.warnings.unshift("整托按可堆叠进行空间预排，已检查层数、整托完整承托和已录入上压；未录入的结构额定值仍待核对 / Stackable-unit space estimate; layer limits, complete support and entered top loads checked; missing structural ratings remain unverified");
  else if(prepared.some(p=>packagingInterior(bySpecification.get(p.specificationId)!.config).crate))plan.warnings.unshift("木箱按实际内尺寸装货、完整外形装柜；自重请填写包含底座与围板的实测总重。仅显式启用且资料有效的四角传力列可自动叠放，其他木箱仍底置 / Crates use measured interior, exterior and complete tare; only explicitly enabled crates with valid four-path evidence may stack; all others remain floor-only");
  if(!only&&specifications.some(s=>s.stackLayers>1))plan.warnings.unshift("整托堆叠按声明的整托上压和已提供的箱体承重核验；缺少箱体承重资料时不能视为逐箱承重已核验");
  plan.metrics.solveTimeMs=performance.now()-started;
  return {plan,prepared,loadedPallets:pallets.length,unloadedPallets:prepared.length-pallets.length,remaining:plan.summaries.filter(s=>s.unloaded>0),bounded};
}


/** Bounded portfolio shared by Workers, fleet allocation and benchmark callers.
 * The native maximum candidate stays intact until a complete practical candidate
 * is revalidated under maximum rules and improves every retained source row.
 */
export function palletizeThenPack(request: PackingRequest, input: FloorPalletConfig, mix: "single" | "mixed", maxPallets = 20, build?: PalletBuildOptions) {
  const started=performance.now(),native=buildPalletCandidate(request,input,mix,maxPallets,build);
  if((request.strategy??"practical")!=="maximum")return native;
  const summary:PalletSearchSummary={maximumCount:native.plan.placements.length,practicalCount:null,selected:"maximum",comparison:"not-needed"};
  let chosen=native;
  if(native.plan.summaries.some(s=>s.unloaded>0)){
    let reference:ReturnType<typeof buildPalletCandidate>|undefined;
    try{reference=buildPalletCandidate({...request,strategy:"practical"},input,mix,maxPallets,build);summary.practicalCount=reference.plan.placements.length;}
    catch{summary.comparison="unavailable";}
    if(reference){
      try{
        const reviewed=reviewPalletLowerBound({...request,floorPallets:undefined,workflow:native.plan.workflow,palletBuild:native.plan.palletBuild,container:native.plan.container,strategy:"maximum"},native.plan,reference.plan);
        summary.comparison=reviewed?"adopted-lower-bound":"kept-maximum";
        if(reviewed){chosen={...reference,plan:reviewed,remaining:reviewed.summaries.filter(s=>s.unloaded>0)};summary.selected="practical-lower-bound";}
      }catch{summary.comparison="rejected";}
    }
  }
  const note=summary.selected==="practical-lower-bound"
    ? `高密度整托搜索原候选 ${summary.maximumCount} 箱；采用重新校验的现场完整候选 ${summary.practicalCount} 箱，每个 SKU 均未减量。有限搜索不代表全局最优`
    : summary.comparison==="rejected"||summary.comparison==="unavailable"
    ? "补充整托候选未完成或未通过独立复核，保留原高密度合法候选"
    : undefined;
  const plan={...chosen.plan,palletSearch:summary,metrics:{...chosen.plan.metrics,solveTimeMs:performance.now()-started},warnings:[...chosen.plan.warnings,...(note?[note]:[])]};
  return {...chosen,plan};
}
