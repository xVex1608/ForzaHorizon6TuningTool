export type Drivetrain = 'FWD' | 'RWD' | 'AWD';
export type CarClass = 'D' | 'C' | 'B' | 'A' | 'S1' | 'S2' | 'R' | 'X';
export type Surface = 'road' | 'street' | 'wet' | 'rally' | 'drift' | 'drag';
export type TireCompound = 'stock' | 'street' | 'sport' | 'semiSlick' | 'slick' | 'rally' | 'offroad' | 'snow' | 'drift';
export type AppView = 'garage' | 'tune' | 'fh6Data' | 'setups' | 'settings' | 'updates';
export type UiDensity = 'comfortable' | 'compact';
export type GarageDensity = 'comfortable' | 'compact';
export type TuneStrictness = 'balanced' | 'aggressive' | 'max';
export type AppLanguage = 'de' | 'en' | 'fr' | 'it';
export type UnitSystem = 'metric' | 'imperial';
export type VehicleSpecSource = 'estimated' | 'manual' | 'imported' | 'upgrades';
export type UpgradePower = 'stock' | 'street' | 'sport' | 'race';
export type UpgradeWeightReduction = 'stock' | 'street' | 'sport' | 'race';
export type UpgradeTireWidth = 'stock' | 'street' | 'sport' | 'race';
export type UpgradeDrivetrain = 'stock' | Drivetrain;
export type UpgradeAero = 'stock' | 'front' | 'rear' | 'race';
export type UpgradeTransmission = 'stock' | 'sport' | 'race' | 'drift4';
export type UpgradeSuspension = 'stock' | 'sport' | 'race' | 'rally' | 'drift';
export type UpgradeAntiRollBars = 'stock' | 'race';
export type UpgradeBrakes = 'stock' | 'race';
export type UpgradeDifferential = 'stock' | 'race' | 'drift';

export interface UpgradeSelections {
  power: UpgradePower;
  weightReduction: UpgradeWeightReduction;
  tireCompound: TireCompound;
  tireWidth: UpgradeTireWidth;
  drivetrain: UpgradeDrivetrain;
  aero: UpgradeAero;
  transmission: UpgradeTransmission;
  suspension: UpgradeSuspension;
  antiRollBars: UpgradeAntiRollBars;
  brakes: UpgradeBrakes;
  differential: UpgradeDifferential;
}

export interface FH6Car {
  id: string;
  make: string;
  name: string;
  type: string;
  pi: number;
  carClass: CarClass;
  classLabel: string;
  country: string;
  collection: string;
  addOns: string;
}

export interface VehicleInput {
  selectedCarId: string;
  carName: string;
  make: string;
  carType: string;
  sourcePi: number;
  buildPi: number;
  country: string;
  collection: string;
  addOns: string;
  carClass: CarClass;
  drivetrain: Drivetrain;
  surface: Surface;
  tireCompound: TireCompound;
  weightKg: number;
  frontWeightPercent: number;
  horsepower: number;
  torqueNm: number;
  frontTireWidth: number;
  rearTireWidth: number;
  gearCount: number;
  rideHeightMin: number;
  rideHeightMax: number;
  rideHeightMinFront: number;
  rideHeightMaxFront: number;
  rideHeightMinRear: number;
  rideHeightMaxRear: number;
  springRateMinFront: number;
  springRateMaxFront: number;
  springRateMinRear: number;
  springRateMaxRear: number;
  frontAero: boolean;
  rearAero: boolean;
  frontAeroMinLb: number;
  frontAeroMaxLb: number;
  rearAeroMinLb: number;
  rearAeroMaxLb: number;
  specSource: VehicleSpecSource;
  upgrades: UpgradeSelections;
}

export interface TuningIntent {
  rotation: number;
  stability: number;
  speedBias: number;
  compliance: number;
  targetTopSpeedKmh?: number;
}

export type TuneInputKind = 'exact' | 'slider' | 'reference' | 'requiresUpgrade';

export interface TuneValue {
  label: string;
  value: string;
  detail: string;
  instruction?: string;
  formula?: string;
  inputKind?: TuneInputKind;
  tone?: 'neutral' | 'accent' | 'warning' | 'success';
}

export interface TuneSection {
  id: string;
  title: string;
  values: TuneValue[];
}

export interface TuneResult {
  score: number;
  summary: string;
  sections: TuneSection[];
  notes: string[];
}

export interface SavedProfile {
  id: string;
  name: string;
  createdAt: string;
  vehicle: VehicleInput;
  intent: TuningIntent;
}

export interface VerifiedVehicleSnapshot {
  id: string;
  carId: string;
  carName: string;
  savedAt: string;
  vehicle: VehicleInput;
}

export interface VerifiedVehicleReach {
  id: string;
  carId: string;
  carName: string;
  savedAt: string;
  maxClass: CarClass;
  maxPi: number;
}

export interface AppSettings {
  language: AppLanguage;
  unitSystem: UnitSystem;
  density: UiDensity;
  garageDensity: GarageDensity;
  lowVramMode: boolean;
  tuneStrictness: TuneStrictness;
  showSpecSource: boolean;
  defaultSurface: Surface;
}
