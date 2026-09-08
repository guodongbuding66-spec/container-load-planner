export type LengthUnit = "mm" | "cm" | "m" | "in";
export type WeightUnit = "kg" | "lb";

export const LENGTH_UNIT_OPTIONS: ReadonlyArray<{ value: LengthUnit; label: string }> = [
  { value: "mm", label: "毫米 (mm)" },
  { value: "cm", label: "厘米 (cm)" },
  { value: "m", label: "米 (m)" },
  { value: "in", label: "英寸 (in)" },
];

export const WEIGHT_UNIT_OPTIONS: ReadonlyArray<{ value: WeightUnit; label: string }> = [
  { value: "kg", label: "千克 (kg)" },
  { value: "lb", label: "磅 (lb)" },
];

const MILLIMETERS_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

const KILOGRAMS_PER_UNIT: Record<WeightUnit, number> = {
  kg: 1,
  lb: 0.45359237,
};

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MILLIMETERS_PER_UNIT, value);
}

export function isWeightUnit(value: unknown): value is WeightUnit {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(KILOGRAMS_PER_UNIT, value);
}

export function toMillimeters(value: number, unit: LengthUnit) {
  return value * MILLIMETERS_PER_UNIT[unit];
}

export function fromMillimeters(value: number, unit: LengthUnit) {
  return value / MILLIMETERS_PER_UNIT[unit];
}

export function toKilograms(value: number, unit: WeightUnit) {
  return value * KILOGRAMS_PER_UNIT[unit];
}

export function fromKilograms(value: number, unit: WeightUnit) {
  return value / KILOGRAMS_PER_UNIT[unit];
}

export function lengthUnitPrecision(unit: LengthUnit) {
  if (unit === "m") return 4;
  if (unit === "in") return 3;
  if (unit === "cm") return 2;
  return 1;
}

export function weightUnitPrecision(unit: WeightUnit) {
  return unit === "lb" ? 3 : 2;
}
