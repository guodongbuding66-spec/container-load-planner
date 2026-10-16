import { pack } from "./engine";
import { palletizeThenPack } from "./palletize";
import { parseLoadingWorkflow, parsePalletBuild } from "./loading-workflow";
import type { PackingRequest, PackingResult } from "./types";

export function packLoadingWorkflow(request: PackingRequest): PackingResult {
  if(request.workflow==="pallet-only"&&request.container.exclusions?.length)throw Error("只打托模式没有柜内区域；请先清除区域或切换装柜 / Pallet-only mode has no vehicle site regions");
  const workflow = parseLoadingWorkflow(request.workflow, request.mode);
  if (workflow === "pallet-only" || workflow === "palletized") {
    const build = parsePalletBuild(request.palletBuild);
    if (request.mode !== "mixed") throw new Error("打托需要录入订单数量");
    return palletizeThenPack({ ...request, floorPallets: undefined, workflow }, build.config, build.mix, build.maxPallets, build).plan;
  }
  if (workflow === "single-capacity" && request.mode !== "single" || workflow === "direct" && request.mode !== "mixed") throw new Error("装载方式与计算模式不一致");
  return { ...pack(request), workflow };
}
