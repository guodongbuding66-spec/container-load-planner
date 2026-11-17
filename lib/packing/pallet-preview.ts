import type { PreparedPalletLayout } from "./prepared-pallet-layout";
import { palletPreparationRequest } from "./prepared-pallet-layout";
import { DEFAULT_PACKAGING, type PackagingSpec } from "./packaging";
import { palletSpecifications } from "./pallet-specifications";
import type { FloorPalletConfig, PackingRequest, PackingResult, PalletBuildOptions } from "./types";

const PRIMARY = "primary";

export function palletPreviewInput(request: PackingRequest, build: PalletBuildOptions, layout?: PreparedPalletLayout) {
  const preparation = palletPreparationRequest(request, build);
  const forSolve = (config: FloorPalletConfig): FloorPalletConfig => config.packaging ? {
    ...config,
    packaging: {...config.packaging, color: DEFAULT_PACKAGING.color, opacity: 1},
  } : config;
  const options = preparation.palletBuild!;
  return JSON.stringify({
    ...preparation, preparedPalletLayout: layout,
    palletBuild: {
      ...options,
      config: forSolve(options.config),
      additionalSpecs: options.additionalSpecs?.map(spec => ({...spec, config: forSolve(spec.config)})),
    },
  } satisfies PackingRequest);
}

/** Apply the current display settings to both the rendered parts and their specification metadata. */
export function withPalletPreviewAppearance(plan: PackingResult, build: PalletBuildOptions): PackingResult {
  const specs = new Map(palletSpecifications(build).map(spec => [spec.id, spec.config.packaging]));
  const withFinish = (p: PackagingSpec | undefined, id = PRIMARY): PackagingSpec | undefined => {
    const style = specs.get(id);
    if (!p || !style || p.color === style.color && p.opacity === style.opacity && p.material === style.material) return p;
    return {...p, color: style.color, opacity: style.opacity, material: style.material};
  };
  const withConfig = (config: FloorPalletConfig, id?: string) => ({...config, packaging:withFinish(config.packaging,id)});

  return {
    ...plan,
    pallets: plan.pallets?.map(p => ({...p, packaging:withFinish(p.packaging,p.specificationId)})),
    palletization: plan.palletization && {
      ...plan.palletization,
      config: withConfig(plan.palletization.config),
      specifications: plan.palletization.specifications?.map(s => ({...s, config: withConfig(s.config,s.id)})),
    },
    palletBuild: plan.palletBuild && {
      ...plan.palletBuild,
      config: withConfig(plan.palletBuild.config),
      additionalSpecs: plan.palletBuild.additionalSpecs?.map(s => ({...s, config: withConfig(s.config,s.id)})),
    },
  };
}
