import {act} from "react";
import {afterEach,expect,it,vi} from "vitest";
import {createRoot,extend,_roots} from "@react-three/fiber";
import * as THREE from "three";
import {useMeasurementPdf} from "./use-measurement-pdf";
import {renderMeasurementPdf} from "../lib/packing/measurement-pdf";
import {reportPlan,solidRecord,reportOptions} from "../tests/measurement-report-fixture";
vi.mock("../lib/packing/measurement-pdf",()=>({renderMeasurementPdf:vi.fn()}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.mocked(renderMeasurementPdf).mockReset();});
async function mounted(run:(get:()=>ReturnType<typeof useMeasurementPdf>)=>Promise<void>){
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);extend({Group:THREE.Group});
  const canvas={style:{}} as HTMLCanvasElement,gl={domElement:canvas,render(){},setPixelRatio(){},getPixelRatio(){return 1;},setSize(){}} as unknown as THREE.WebGLRenderer,root=createRoot(canvas);await root.configure({gl,frameloop:"never",size:{width:100,height:100,top:0,left:0}});let value!:ReturnType<typeof useMeasurementPdf>;
  function Hook(){value=useMeasurementPdf();return <group/>;}
  try{await act(async()=>root.render(<Hook/>));await run(()=>value);}finally{await act(async()=>root.unmount());_roots.delete(canvas);}
}
function downloadFixture(){const click=vi.fn(),anchor={href:"",download:"",click};vi.stubGlobal("document",{createElement:()=>anchor});const url=vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:measurement-test");vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});return {anchor,click,url};}
it("captures click-time inputs, prevents duplicate generation and requests one localized download",async()=>{const f=downloadFixture();let done!:(b:Uint8Array)=>void;vi.mocked(renderMeasurementPdf).mockImplementation(()=>new Promise(resolve=>{done=resolve;}));const m=solidRecord();await mounted(async get=>{let pending!:Promise<void>;await act(async()=>{pending=get().download(reportPlan,[m],reportOptions);});expect(get().status).toBe("busy");await act(async()=>get().download(reportPlan,[m],reportOptions));expect(renderMeasurementPdf).toHaveBeenCalledTimes(1);m.name="Later edit";expect(vi.mocked(renderMeasurementPdf).mock.calls[0][0].entries[0].title).toBe("U opening");await act(async()=>{done(new Uint8Array([1,2,3]));await pending;});expect(get().status).toBe("done");expect(f.click).toHaveBeenCalledTimes(1);expect(f.anchor.download).toMatch(/^CargoFit_measurements_2026-10-22_[0-9a-f]{16}_en\.pdf$/);});});
it("reports failure without changing records and allows retry",async()=>{const f=downloadFixture(),m=solidRecord(),before=JSON.stringify(m);vi.mocked(renderMeasurementPdf).mockRejectedValueOnce(Error("encoding")).mockResolvedValue(new Uint8Array([1]));await mounted(async get=>{await act(async()=>get().download(reportPlan,[m],reportOptions));expect(get().status).toBe("error");expect(f.click).not.toHaveBeenCalled();expect(JSON.stringify(m)).toBe(before);await act(async()=>get().download(reportPlan,[m],reportOptions));expect(get().status).toBe("done");expect(f.click).toHaveBeenCalledTimes(1);});});
it("does not start a late download after the panel unmounts",async()=>{const f=downloadFixture();let done!:(b:Uint8Array)=>void,pending!:Promise<void>;vi.mocked(renderMeasurementPdf).mockImplementation(()=>new Promise(resolve=>{done=resolve;}));await mounted(async get=>{await act(async()=>{pending=get().download(reportPlan,[solidRecord()],reportOptions);});});await act(async()=>{done(new Uint8Array([1]));await pending;});expect(f.url).not.toHaveBeenCalled();expect(f.click).not.toHaveBeenCalled();});
