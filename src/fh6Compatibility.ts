import type { CarClass, VehicleInput } from './types';

export type FH6LimitKey =
  | 'sourcePi'
  | 'buildPi'
  | 'horsepower'
  | 'torqueNm'
  | 'weightKg'
  | 'frontWeightPercent'
  | 'frontTireWidth'
  | 'rearTireWidth'
  | 'gearCount'
  | 'rideHeightMin'
  | 'rideHeightMax'
  | 'rideHeightMinFront'
  | 'rideHeightMaxFront'
  | 'rideHeightMinRear'
  | 'rideHeightMaxRear'
  | 'springRateMinFront'
  | 'springRateMaxFront'
  | 'springRateMinRear'
  | 'springRateMaxRear';

export type FH6Limit = {
  min: number;
  max: number;
  step: number;
};

export const FH6_LIMITS: Record<FH6LimitKey, FH6Limit> = {
  sourcePi: { min: 100, max: 999, step: 1 },
  buildPi: { min: 100, max: 999, step: 1 },
  horsepower: { min: 50, max: 2000, step: 1 },
  torqueNm: { min: 50, max: 2500, step: 1 },
  weightKg: { min: 450, max: 3200, step: 1 },
  frontWeightPercent: { min: 30, max: 75, step: 1 },
  frontTireWidth: { min: 135, max: 395, step: 5 },
  rearTireWidth: { min: 135, max: 395, step: 5 },
  gearCount: { min: 4, max: 10, step: 1 },
  rideHeightMin: { min: 3, max: 40, step: 0.1 },
  rideHeightMax: { min: 3, max: 40, step: 0.1 },
  rideHeightMinFront: { min: 3, max: 40, step: 0.1 },
  rideHeightMaxFront: { min: 3, max: 40, step: 0.1 },
  rideHeightMinRear: { min: 3, max: 40, step: 0.1 },
  rideHeightMaxRear: { min: 3, max: 40, step: 0.1 },
  springRateMinFront: { min: 1, max: 650, step: 1 },
  springRateMaxFront: { min: 1, max: 650, step: 1 },
  springRateMinRear: { min: 1, max: 650, step: 1 },
  springRateMaxRear: { min: 1, max: 650, step: 1 },
};

export const FH6_INGAME_SPEC_KEYS = new Set<keyof VehicleInput>([
  'drivetrain',
  'surface',
  'tireCompound',
  'buildPi',
  'horsepower',
  'torqueNm',
  'weightKg',
  'frontWeightPercent',
  'frontTireWidth',
  'rearTireWidth',
  'gearCount',
  'rideHeightMinFront',
  'rideHeightMaxFront',
  'rideHeightMinRear',
  'rideHeightMaxRear',
  'springRateMinFront',
  'springRateMaxFront',
  'springRateMinRear',
  'springRateMaxRear',
  'frontAero',
  'rearAero',
  'frontAeroMinLb',
  'frontAeroMaxLb',
  'rearAeroMinLb',
  'rearAeroMaxLb',
]);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function snapToStep(value: number, step: number) {
  if (step <= 0) {
    return value;
  }

  const decimals = Math.max(0, Math.ceil(Math.log10(1 / step)));
  const snapped = Math.round(value / step) * step;
  return Number(snapped.toFixed(decimals));
}

export function clampFH6Value(key: FH6LimitKey, value: number) {
  const limit = FH6_LIMITS[key];
  const safe = clamp(finite(value, limit.min), limit.min, limit.max);
  return snapToStep(safe, limit.step);
}

export function classFromPi(pi: number): CarClass {
  const safePi = clampFH6Value('buildPi', pi);
  if (safePi >= 999) return 'X';
  if (safePi >= 901) return 'R';
  if (safePi >= 801) return 'S2';
  if (safePi >= 701) return 'S1';
  if (safePi >= 601) return 'A';
  if (safePi >= 501) return 'B';
  if (safePi >= 401) return 'C';
  return 'D';
}

function normalizeRange(
  minValue: number,
  maxValue: number,
  keyMin: FH6LimitKey,
  keyMax: FH6LimitKey,
  gap: number,
) {
  const minLimit = FH6_LIMITS[keyMin];
  const maxLimit = FH6_LIMITS[keyMax];
  let low = clamp(finite(minValue, minLimit.min), minLimit.min, maxLimit.max - gap);
  let high = clamp(finite(maxValue, maxLimit.max), minLimit.min + gap, maxLimit.max);

  if (high <= low) {
    high = Math.min(maxLimit.max, low + gap);
  }

  if (high <= low) {
    low = Math.max(minLimit.min, high - gap);
  }

  return {
    min: snapToStep(low, minLimit.step),
    max: snapToStep(high, maxLimit.step),
  };
}

export function sanitizeVehicleForFH6(vehicle: VehicleInput): VehicleInput {
  const legacyRideMin = finite(vehicle.rideHeightMin, FH6_LIMITS.rideHeightMin.min);
  const legacyRideMax = finite(vehicle.rideHeightMax, FH6_LIMITS.rideHeightMax.max);
  const partialVehicle = vehicle as Partial<VehicleInput>;
  const rideHeightFront = normalizeRange(
    finite(partialVehicle.rideHeightMinFront ?? legacyRideMin, legacyRideMin),
    finite(partialVehicle.rideHeightMaxFront ?? legacyRideMax, legacyRideMax),
    'rideHeightMinFront',
    'rideHeightMaxFront',
    0,
  );
  const rideHeightRear = normalizeRange(
    finite(partialVehicle.rideHeightMinRear ?? legacyRideMin, legacyRideMin),
    finite(partialVehicle.rideHeightMaxRear ?? legacyRideMax, legacyRideMax),
    'rideHeightMinRear',
    'rideHeightMaxRear',
    0,
  );
  const springFront = normalizeRange(vehicle.springRateMinFront, vehicle.springRateMaxFront, 'springRateMinFront', 'springRateMaxFront', 0);
  const springRear = normalizeRange(vehicle.springRateMinRear, vehicle.springRateMaxRear, 'springRateMinRear', 'springRateMaxRear', 0);
  const frontAeroMinLb = clamp(finite(vehicle.frontAeroMinLb, 0), 0, 10000);
  const frontAeroMaxLb = clamp(finite(vehicle.frontAeroMaxLb, 0), 0, 10000);
  const rearAeroMinLb = clamp(finite(vehicle.rearAeroMinLb, 0), 0, 10000);
  const rearAeroMaxLb = clamp(finite(vehicle.rearAeroMaxLb, 0), 0, 10000);

  return {
    ...vehicle,
    sourcePi: clampFH6Value('sourcePi', vehicle.sourcePi),
    buildPi: clampFH6Value('buildPi', vehicle.buildPi),
    carClass: classFromPi(vehicle.buildPi),
    horsepower: clampFH6Value('horsepower', vehicle.horsepower),
    torqueNm: clampFH6Value('torqueNm', vehicle.torqueNm),
    weightKg: clampFH6Value('weightKg', vehicle.weightKg),
    frontWeightPercent: clampFH6Value('frontWeightPercent', vehicle.frontWeightPercent),
    frontTireWidth: clampFH6Value('frontTireWidth', vehicle.frontTireWidth),
    rearTireWidth: clampFH6Value('rearTireWidth', vehicle.rearTireWidth),
    gearCount: clampFH6Value('gearCount', vehicle.gearCount),
    rideHeightMin: Math.min(rideHeightFront.min, rideHeightRear.min),
    rideHeightMax: Math.max(rideHeightFront.max, rideHeightRear.max),
    rideHeightMinFront: rideHeightFront.min,
    rideHeightMaxFront: rideHeightFront.max,
    rideHeightMinRear: rideHeightRear.min,
    rideHeightMaxRear: rideHeightRear.max,
    springRateMinFront: springFront.min,
    springRateMaxFront: springFront.max,
    springRateMinRear: springRear.min,
    springRateMaxRear: springRear.max,
    frontAeroMinLb,
    frontAeroMaxLb,
    rearAeroMinLb,
    rearAeroMaxLb,
    specSource: vehicle.specSource ?? 'estimated',
  };
}

export function isVehicleFH6Compatible(vehicle: VehicleInput) {
  const safe = sanitizeVehicleForFH6(vehicle);
  return (Object.keys(FH6_LIMITS) as FH6LimitKey[]).every((key) => safe[key] === vehicle[key]);
}
