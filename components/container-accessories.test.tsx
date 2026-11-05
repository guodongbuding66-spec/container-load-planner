import {PlanReviewPanel} from "./result-audit-panel";
import {reviewPlan} from "../lib/packing/plan-review";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {ContainerAccessorySettings} from "./container-accessory-settings";
import {ContainerAccessoryManifest} from "./container-accessory-manifest";
import {SiteExclusionSettings} from "./site-exclusion-settings";
import {RemainingCapacity} from "./remaining-capacity";
import {setAppLanguage} from "./language";
import {pack} from "../lib/packing/engine";
import type {SiteExclusion} from "../lib/packing/site-exclusions";
import type {ProductInput} from "../lib/packing/types";
const z:SiteExclusion={id:"a",name:"<wood>",kind:"obstacle",x:900,y:900,z:0,dx:100,dy:100,dz:100,accessory:{type:"timber",quantity:2,unitWeightKg:5,phase:"after-cargo",relatedProductIds:["p"],afterAccessoryIds:[],source:"Measured",revision:"r1",note:"Install after cargo"}};
const c={id:"c",name:"C",length:1000,width:1000,height:1000,doorWidth:1000,doorHeight:1000,maxWeight:100,exclusions:[z]};
const p:ProductInput={id:"p",sku:"P",name:"P",length:200,width:200,height:200,weight:10,quantity:1,priority:50,rotationPolicy:"fixed",stackable:true,maxStackLayers:0,maxTopLoadKg:1000,color:"#338877"};
const props={container:c,products:[p],onChange:()=>{},onValidityChange:()=>{}};
beforeEach(()=>vi.stubGlobal("document",{documentElement:{lang:""}}));afterEach(()=>{setAppLanguage("zh");vi.unstubAllGlobals();});
it("renders distinct editable material and reservation entries in English",()=>{
 setAppLanguage("en");const html=renderToStaticMarkup(<ContainerAccessorySettings {...props}/>);expect(html).toContain("Container accessories and securing reservations");expect(html).toContain('aria-label="Accessory 1 planned unit mass"');expect(html).toContain("&lt;wood&gt;");expect(html).toContain("Planned mass is not a scale reading");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
 const basic=renderToStaticMarkup(<SiteExclusionSettings container={c} clearance={0} onChange={()=>{}} onValidityChange={()=>{}}/>);expect(basic).not.toContain('aria-label="Region name 1"');
});
it("does not default missing mass to known zero and keeps a removal action available",()=>{
 const container={...c,exclusions:[{...z,accessory:{...z.accessory!,unitWeightKg:null}}]},html=renderToStaticMarkup(<ContainerAccessorySettings {...props} container={container}/>);expect(html).toContain("尚未填写");expect(html).toContain("确认零重量");expect(html).toContain('role="alert"');expect(html).toContain("删除附件及其依赖引用");expect(html).toContain('disabled=""');
});
it("exposes unsupported workflows, invalid references and bounds without hiding edit controls",()=>{
 for(const extra of [{only:true},{container:{...c,width:500}},{container:{...c,exclusions:[{...z,accessory:{...z.accessory!,relatedProductIds:["missing"]}}]}}]){
 const html=renderToStaticMarkup(<ContainerAccessorySettings {...props} {...extra}/>);expect(html).toContain('role="alert"');expect(html).toContain("删除附件及其依赖引用");expect(html).toContain('disabled=""');
 }
});
it("shows planned mass and installation boundaries without a securing approval action",()=>{
 const plan=pack({workflow:"direct",mode:"mixed",strategy:"maximum",container:c,clearance:0,products:[p]});setAppLanguage("en");const html=renderToStaticMarkup(<ContainerAccessoryManifest result={plan}/>);expect(html).toContain("Container accessories and installation list");expect(html).toContain("10 kg");expect(html).toContain("Earliest after carton step");expect(html).toContain("Export accessory and installation CSV");expect(html).not.toContain("Adopt");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
 const securing=reviewPlan(plan,[p]).checks.find(c=>c.id==="securing")!;const reviewHtml=renderToStaticMarkup(<PlanReviewPanel report={{checks:[securing],state:"unverified",passed:0,failed:0,unverified:1}}/>);expect(reviewHtml).toContain("Transport securing");expect(reviewHtml).not.toMatch(/[\u3400-\u9fff]/u);
 expect(renderToStaticMarkup(<ContainerAccessoryManifest result={plan} disabled/>)).toContain('disabled=""');
});
it("reserves all accessory planned mass from playback step zero",()=>{
 const plan=pack({workflow:"direct",mode:"mixed",strategy:"maximum",container:c,clearance:0,products:[p]});setAppLanguage("en");const html=renderToStaticMarkup(<RemainingCapacity result={plan} visibleCount={0}/>);expect(html).toContain("90");expect(html).toContain("all container accessory planned mass");expect(html).toContain("does not confirm installation or weighing");
});
it("renders an explicit solid support declaration and nullable static load controls in both languages",()=>{
 const container={...c,exclusions:[{...z,z:0,accessory:{...z.accessory!,quantity:1,phase:"before-cargo" as const,support:{version:1 as const,surface:"solid-rectangle" as const,maxLoadKg:null}}}]};
 for(const language of ["zh","en"] as const){setAppLanguage(language);const html=renderToStaticMarkup(<ContainerAccessorySettings {...props} container={container}/>);expect(html).toContain(language==="en"?"solid support declaration":"实心支承声明");expect(html).toContain(language==="en"?"0 prohibits load":"0 表示禁止承载");expect(html).not.toContain('aria-label="Accessory 1 static load limit"');if(language==="en")expect(html).not.toMatch(/[\u3400-\u9fff]/u);}
 const incompatible=renderToStaticMarkup(<ContainerAccessorySettings {...props} container={container} prebuilt/>);expect(incompatible).toContain('role="alert"');expect(incompatible).toContain("Floor supports require direct loading");
});
it("renders current support load and known zero without treating a missing rating as zero",()=>{
 const container={...c,exclusions:[{...z,z:0,accessory:{...z.accessory!,quantity:1,phase:"before-cargo" as const,support:{version:1 as const,surface:"solid-rectangle" as const,maxLoadKg:0}}}]};
 setAppLanguage("en");const settings=renderToStaticMarkup(<ContainerAccessorySettings {...props} container={container}/>);expect(settings).toContain('aria-label="Accessory 1 static load limit"');expect(settings).toContain('value="0"');
 const plan=pack({mode:"mixed",strategy:"maximum",container,clearance:0,products:[p]}),html=renderToStaticMarkup(<ContainerAccessoryManifest result={plan} products={[p]}/>);expect(html).toContain("Fixed support static load check");expect(html).toContain("Entered static load check passed");expect(html).not.toMatch(/[\u3400-\u9fff]/u);
});
