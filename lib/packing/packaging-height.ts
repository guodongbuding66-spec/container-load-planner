import { packagingHeight, packagingInterior } from "./packaging";
import type { FloorPalletConfig } from "./types";

/** Exterior height is another input for the existing interior-height model, never a second stored dimension. */
export function withCrateExteriorHeight(config: FloorPalletConfig, exteriorHeight: number): FloorPalletConfig {
  const interior = packagingInterior(config);
  if (!interior.crate) throw new Error("Exterior crate height requires an enclosure");
  const cargoHeight = Math.round((exteriorHeight - config.height - interior.lid) * 1e6) / 1e6;
  if (!Number.isFinite(exteriorHeight) || !Number.isFinite(cargoHeight) || cargoHeight <= 0 || cargoHeight > 100000) {
    throw new Error("Exterior height must leave a positive interior height no greater than 100000 mm");
  }
  return { ...config, maxCargoHeight: cargoHeight };
}

export function crateHeightBreakdown(config: FloorPalletConfig) {
  return { base: config.height, interior: config.maxCargoHeight ?? 0, lid: packagingInterior(config).lid, exterior: packagingHeight(config) };
}
