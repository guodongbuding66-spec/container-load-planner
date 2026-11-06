import { palletHeightFixture } from "./pallet-height-fixture";

/** Reconstructed from the screenshot and known carton record. */
export function oneLayerCrateFixture() {
  const request = palletHeightFixture();
  const config = request.palletBuild!.config;
  request.products[0].rotationPolicy = "upright";
  Object.assign(config, {
    name:"ULD 88 × 108", presetId:"pallet-88-108", width:2235, height:25, maxCargoHeight:125,
    packaging:{...config.packaging!, enclosure:"panel"},
  });
  return request;
}
