import type { ProductInput } from "./types";

export type SetInputItem = {
  productId: string;
  sku: string;
  unitsPerSet: number;
  quantity: number;
  completeSetCapacity: number;
  remainder: number;
};

export type SetInputSummary = {
  setCode: string;
  componentCount: number;
  cartonsPerSet: number;
  completeSets: number;
  maximumSetDemand: number;
  looseCartons: number;
  quantitiesAligned: boolean;
  items: SetInputItem[];
};

export function normalizedSetCode(product: ProductInput) {
  return product.setCode?.trim() ?? "";
}

export function normalizedUnitsPerSet(product: ProductInput) {
  const value = Math.floor(product.unitsPerSet || 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function collectSetGroups(products: ProductInput[]) {
  const groups = new Map<string, ProductInput[]>();
  for (const product of products) {
    const code = normalizedSetCode(product);
    if (!code) continue;
    groups.set(code, [...(groups.get(code) ?? []), product]);
  }
  return groups;
}

export function summarizeSetInputs(products: ProductInput[]): SetInputSummary[] {
  return [...collectSetGroups(products)].map(([setCode, group]) => {
    const items = group.map((product) => {
      const unitsPerSet = normalizedUnitsPerSet(product);
      const quantity = Math.max(0, Math.floor(product.quantity || 0));
      return {
        productId: product.id,
        sku: product.sku,
        unitsPerSet,
        quantity,
        completeSetCapacity: Math.floor(quantity / unitsPerSet),
        remainder: quantity % unitsPerSet,
      };
    });
    const capacities = items.map((item) => item.completeSetCapacity);
    const completeSets = capacities.length ? Math.min(...capacities) : 0;
    const maximumSetDemand = capacities.length ? Math.max(...capacities) : 0;
    const looseCartons = items.reduce(
      (sum, item) => sum + Math.max(0, item.quantity - completeSets * item.unitsPerSet),
      0,
    );
    const quantitiesAligned = capacities.every((count) => count === capacities[0]) &&
      items.every((item) => item.remainder === 0);
    return {
      setCode,
      componentCount: items.length,
      cartonsPerSet: items.reduce((sum, item) => sum + item.unitsPerSet, 0),
      completeSets,
      maximumSetDemand,
      looseCartons,
      quantitiesAligned,
      items,
    };
  });
}

export function alignSetQuantities(products: ProductInput[], setCode: string) {
  const summary = summarizeSetInputs(products).find((item) => item.setCode === setCode);
  if (!summary) return products;
  const unitsByProduct = new Map(summary.items.map((item) => [item.productId, item.unitsPerSet]));
  return products.map((product) => {
    const units = unitsByProduct.get(product.id);
    return units ? { ...product, quantity: summary.completeSets * units } : product;
  });
}
