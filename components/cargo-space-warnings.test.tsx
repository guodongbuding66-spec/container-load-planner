import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {CargoSpaceWarnings,cargoSpaceWarnings,cargoPalletWarnings} from "./cargo-space-warnings";
import {DEFAULT_PALLET_BUILD} from "../lib/packing/loading-workflow";
import {oneLayerCrateFixture} from "../tests/one-layer-crate-fixture";
it("warns against active eligible pallet interiors, ceilings and payloads",()=>{
 const p={...oneLayerCrateFixture().products[0],length:700,width:600,height:300,weight:20,quantity:1,rotationPolicy:"fixed" as const,allowedOrientations:undefined};
 const build={...structuredClone(DEFAULT_PALLET_BUILD),config:{...structuredClone(DEFAULT_PALLET_BUILD.config),maxCargoHeight:400}};
 expect(cargoPalletWarnings([p],build)).toEqual([]);
 expect(cargoPalletWarnings([{...p,length:99999}],build)[0].space).toBe(true);
 expect(cargoPalletWarnings([{...p,weight:99999}],build)[0].weight).toBe(true);
 expect(cargoPalletWarnings([{...p,height:500}],build)[0].space).toBe(true);
 expect(cargoPalletWarnings([{...p,quantity:0,length:99999}],build)).toEqual([]);
 build.primaryRule={maxPallets:0};expect(cargoPalletWarnings([p],build)).toHaveLength(1);
});
it("warns on impossible dimensions and single-carton mass while accepting a rotated fit",()=>{
 const r=oneLayerCrateFixture(),p={...r.products[0],rotationPolicy:"any" as const,allowedOrientations:undefined};
 expect(cargoSpaceWarnings([{...p,length:2000,width:3000,height:100}],r.container,10)).toEqual([]);
 const bad={...p,length:99999,weight:99999};
 expect(cargoSpaceWarnings([bad],r.container,10)[0]).toMatchObject({space:true,weight:true});
 const html=renderToStaticMarkup(<CargoSpaceWarnings products={[bad]} container={r.container} clearance={10}/>);
 expect(html).toContain('role="status"');expect(html).toContain("单箱毛重超过整柜净载重");
 expect(cargoSpaceWarnings([bad],{...r.container,length:100000,width:100000,height:100000,maxWeight:100000,loadingAccess:"open"},0)).toEqual([]);
});

it("warns on door opening exceedance in both direct and palletized modes",()=>{
 const r=oneLayerCrateFixture();
 const hq={...r.container,length:12032,width:2350,height:2700,doorWidth:2340,doorHeight:2597,maxWeight:28600};
 const wide={...r.products[0],length:1200,width:2345,height:2345,weight:100,quantity:1,rotationPolicy:"fixed" as const,allowedOrientations:undefined};
 const warnings=cargoSpaceWarnings([wide],hq,0);
 expect(warnings).toHaveLength(1);
 expect(warnings[0]).toMatchObject({space:false,door:true,doorWidth:2340,doorHeight:2597});
 const html=renderToStaticMarkup(<CargoSpaceWarnings products={[wide]} container={hq} clearance={0} palletBuild={DEFAULT_PALLET_BUILD} includeVehicleCheck/>);
 expect(html).toContain("2340");
});
