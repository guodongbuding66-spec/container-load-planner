import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {CargoSpaceWarnings,cargoSpaceWarnings} from "./cargo-space-warnings";
import {oneLayerCrateFixture} from "../tests/one-layer-crate-fixture";
it("warns on impossible dimensions and single-carton mass while accepting a rotated fit",()=>{
 const r=oneLayerCrateFixture(),p={...r.products[0],rotationPolicy:"any" as const,allowedOrientations:undefined};
 expect(cargoSpaceWarnings([{...p,length:2000,width:3000,height:100}],r.container,10)).toEqual([]);
 const bad={...p,length:99999,weight:99999};
 expect(cargoSpaceWarnings([bad],r.container,10)[0]).toMatchObject({space:true,weight:true});
 const html=renderToStaticMarkup(<CargoSpaceWarnings products={[bad]} container={r.container} clearance={10}/>);
 expect(html).toContain('role="status"');expect(html).toContain("单箱毛重超过整柜净载重");
 expect(cargoSpaceWarnings([bad],{...r.container,length:100000,width:100000,height:100000,maxWeight:100000,loadingAccess:"open"},0)).toEqual([]);
});
