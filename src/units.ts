import type { UnitSystem, VehicleInput } from './types';

export type MeasurementKind = 'power' | 'torque' | 'weight' | 'tireWidth' | 'rideHeight' | 'pressure' | 'springRate' | 'aeroDownforce';

type MeasurementConfig = {
  unit: string;
  decimals: number;
  step: number;
  toDisplay: (value: number) => number;
  fromDisplay: (value: number) => number;
};

const PS_TO_HP = 0.98632007061967;
const NM_TO_LB_FT = 0.737562149277;
const KG_TO_LB = 2.20462262185;
const MM_TO_IN = 1 / 25.4;
const CM_TO_IN = 1 / 2.54;
const PSI_TO_BAR = 0.0689475729;
// Forza displays metric spring rates at 10x the physical kgf/mm conversion.
const FORZA_KGF_MM_TO_LB_IN = 5.59974129;

const identity = (value: number) => value;

const measurementConfigs: Record<MeasurementKind, Record<UnitSystem, MeasurementConfig>> = {
  power: {
    metric: { unit: 'PS', decimals: 0, step: 1, toDisplay: identity, fromDisplay: identity },
    imperial: { unit: 'hp', decimals: 0, step: 1, toDisplay: (value) => value * PS_TO_HP, fromDisplay: (value) => value / PS_TO_HP },
  },
  torque: {
    metric: { unit: 'Nm', decimals: 0, step: 1, toDisplay: identity, fromDisplay: identity },
    imperial: { unit: 'lb-ft', decimals: 0, step: 1, toDisplay: (value) => value * NM_TO_LB_FT, fromDisplay: (value) => value / NM_TO_LB_FT },
  },
  weight: {
    metric: { unit: 'kg', decimals: 0, step: 1, toDisplay: identity, fromDisplay: identity },
    imperial: { unit: 'lb', decimals: 0, step: 1, toDisplay: (value) => value * KG_TO_LB, fromDisplay: (value) => value / KG_TO_LB },
  },
  tireWidth: {
    metric: { unit: 'mm', decimals: 0, step: 1, toDisplay: identity, fromDisplay: identity },
    imperial: { unit: 'in', decimals: 1, step: 0.1, toDisplay: (value) => value * MM_TO_IN, fromDisplay: (value) => value / MM_TO_IN },
  },
  rideHeight: {
    metric: { unit: 'cm', decimals: 1, step: 0.1, toDisplay: identity, fromDisplay: identity },
    imperial: { unit: 'in', decimals: 1, step: 0.1, toDisplay: (value) => value * CM_TO_IN, fromDisplay: (value) => value / CM_TO_IN },
  },
  pressure: {
    metric: { unit: 'bar', decimals: 1, step: 0.1, toDisplay: (value) => value * PSI_TO_BAR, fromDisplay: (value) => value / PSI_TO_BAR },
    imperial: { unit: 'PSI', decimals: 1, step: 0.1, toDisplay: identity, fromDisplay: identity },
  },
  springRate: {
    metric: { unit: 'kgf/mm', decimals: 0, step: 1, toDisplay: identity, fromDisplay: identity },
    imperial: { unit: 'lb/in', decimals: 0, step: 1, toDisplay: (value) => value * FORZA_KGF_MM_TO_LB_IN, fromDisplay: (value) => value / FORZA_KGF_MM_TO_LB_IN },
  },
  aeroDownforce: {
    metric: { unit: 'kgf', decimals: 0, step: 1, toDisplay: (value) => value / KG_TO_LB, fromDisplay: (value) => value * KG_TO_LB },
    imperial: { unit: 'lb', decimals: 0, step: 1, toDisplay: identity, fromDisplay: identity },
  },
};

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function trimNumber(value: number, decimals: number) {
  return value
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

function getConfig(kind: MeasurementKind, unitSystem: UnitSystem) {
  return measurementConfigs[kind][unitSystem];
}

export function displayMeasurementValue(value: number, kind: MeasurementKind, unitSystem: UnitSystem) {
  const config = getConfig(kind, unitSystem);
  return roundTo(config.toDisplay(value), config.decimals);
}

export function canonicalMeasurementValue(value: number, kind: MeasurementKind, unitSystem: UnitSystem) {
  return getConfig(kind, unitSystem).fromDisplay(value);
}

export function measurementUnit(kind: MeasurementKind, unitSystem: UnitSystem) {
  return getConfig(kind, unitSystem).unit;
}

export function measurementStep(kind: MeasurementKind, unitSystem: UnitSystem) {
  return getConfig(kind, unitSystem).step;
}

export function formatMeasurement(value: number, kind: MeasurementKind, unitSystem: UnitSystem) {
  const config = getConfig(kind, unitSystem);
  const displayValue = config.toDisplay(value);
  const formatted = kind === 'pressure' ? displayValue.toFixed(config.decimals) : trimNumber(displayValue, config.decimals);
  return `${formatted} ${config.unit}`;
}

export function powerToWeightValue(vehicle: VehicleInput, unitSystem: UnitSystem) {
  if (unitSystem === 'imperial') {
    const hp = vehicle.horsepower * PS_TO_HP;
    const pounds = vehicle.weightKg * KG_TO_LB;
    return Math.round(hp / (pounds / 2000));
  }

  return Math.round((vehicle.horsepower / vehicle.weightKg) * 1000);
}

export function powerToWeightLabel(unitSystem: UnitSystem) {
  return unitSystem === 'imperial' ? 'hp/ton' : 'PS/t';
}
