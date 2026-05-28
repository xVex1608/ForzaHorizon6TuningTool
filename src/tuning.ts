import type {
  AppLanguage,
  Surface,
  TireCompound,
  TuneResult,
  TuneSection,
  TuneStrictness,
  TuneValue,
  TuningIntent,
  UnitSystem,
  VehicleInput,
} from './types';
import { sanitizeVehicleForFH6 } from './fh6Compatibility';
import { formatMeasurement } from './units';
import { defaultUpgradeSelections } from './upgrades';

const surfaceNames: Record<Surface, string> = {
  road: 'Grip',
  street: 'Street',
  wet: 'Regen',
  rally: 'Rallye',
  drift: 'Drift',
  drag: 'Drag',
};

const tireGrip: Record<TireCompound, number> = {
  stock: 0.92,
  street: 0.98,
  sport: 1.04,
  semiSlick: 1.12,
  slick: 1.18,
  rally: 1.02,
  offroad: 1,
  snow: 0.88,
  drift: 1.01,
};

const tirePressureBase: Record<TireCompound, number> = {
  stock: 31,
  street: 31,
  sport: 31.5,
  semiSlick: 32,
  slick: 32.5,
  rally: 29.5,
  offroad: 29,
  snow: 28.5,
  drift: 31,
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const signed = (value: number) => `${value > 0 ? '+' : ''}${round(value, 1)}`;
const percent = (value: number) => `${Math.round(value)}%`;
const pressure = (value: number, unitSystem: UnitSystem) => formatMeasurement(value, 'pressure', unitSystem);
const springRate = (value: number, unitSystem: UnitSystem) => formatMeasurement(value, 'springRate', unitSystem);
const sliderDetail = (position: number) => `FH6 slider ${Math.round(position * 100)}%`;
const aeroTarget = (position: number, minLb: number, maxLb: number) => (maxLb > minLb ? Math.round(minLb + (maxLb - minLb) * (position / 100)) : null);
const speedTarget = (value: number, unitSystem: UnitSystem) => (unitSystem === 'imperial' ? `${Math.round(value / 1.609344)} mph` : `${Math.round(value)} km/h`);
const inputHelp = {
  tirePressure: 'In FH6 > Tires als kalten Startdruck eintragen.',
  gearing: 'In FH6 > Gearing exakt als Ratio eintragen.',
  gearingFinalDriveUpgrade: 'In FH6 zuerst Sport, Race oder Drift Getriebe verbauen/auswählen; dann Final Drive setzen.',
  gearingRaceUpgrade: 'In FH6 zuerst Race oder Drift Getriebe verbauen/auswählen; dann diesen Gang setzen.',
  alignment: 'In FH6 > Alignment exakt in Grad eintragen.',
  suspensionUpgrade: 'In FH6 zuerst Race, Rally oder Drift Fahrwerk verbauen/auswählen; dann diesen Wert setzen.',
  antiRoll: 'In FH6 > Antiroll Bars exakt setzen.',
  antiRollUpgrade: 'In FH6 zuerst einstellbare Antiroll Bars verbauen/auswählen; dann diesen Wert setzen.',
  springRate: 'In FH6 > Springs als Federrate setzen; falls nötig die Sliderposition im Detail nutzen.',
  rideHeight: 'In FH6 > Springs als Ride Height exakt setzen.',
  damping: 'In FH6 > Damping exakt setzen.',
  brake: 'In FH6 > Brake als Prozentwert setzen.',
  brakeUpgrade: 'In FH6 zuerst Race Brakes verbauen/auswählen; dann diesen Wert setzen.',
  aero: 'In FH6 > Aero als Sliderposition Richtung Cornering setzen. Wenn Calibration aktiv ist, den Aero-Zielwert als Kontrolle nutzen.',
  diff: 'In FH6 > Differential exakt als Prozentwert setzen.',
  diffUpgrade: 'In FH6 zuerst Race oder Drift Differential verbauen/auswählen; dann diesen Wert setzen.',
  stock: 'Keine Eingabe nötig, wenn dieser Regler im Spiel nicht einstellbar ist.',
};
const formulaHelp = {
  tires: 'Reifenbasis + Gewicht + Reifenbreite + Antriebs-Last + Feel-Korrektur.',
  gearing: 'Power/Weight + PI + Aero + Zielgeschwindigkeit formen Final Drive und Gangspreizung.',
  alignment: 'Disziplin-Basis + Rotation/Stabilität + Tune Strictness ergeben Camber, Toe und Caster.',
  antiRoll: 'Antrieb-Basis + Gewicht + Rotation/Stabilität + Untergrund bestimmen Stabi-Balance.',
  springs: 'FH6 min/max Federrange wird per Gewichtsverteilung, Grip, Power und Surface skaliert.',
  rideHeight: 'FH6 min/max Höhenrange wird nach Surface, Kerbs und Strictness gesetzt.',
  damping: 'Federraten-Position steuert Rebound; Bump folgt als kontrollierter Anteil des Rebounds.',
  brakes: 'Surface-Basis + Rotation/Stabilität + Strictness bestimmen Balance und Bremsdruck.',
  aero: 'Aero-Sliderposition wird aus Surface, Speed-Bias und Stabilität gebildet; Calibration rechnet optional den Aero-Zielwert.',
  diff: 'Antrieb-Basis + Grip-Surface + Rotation/Stabilität bestimmen Sperrwerte.',
} as const;
const strictnessLevels: Record<TuneStrictness, number> = {
  balanced: 0,
  aggressive: 1,
  max: 2,
};

function strictnessBias(strictness: TuneStrictness, vehicle: VehicleInput, scale = 1) {
  const surfaceFactor = {
    road: 1,
    street: 0.92,
    wet: 0.55,
    rally: 0.58,
    drift: 0.8,
    drag: 0.72,
  }[vehicle.surface];

  return strictnessLevels[strictness] * surfaceFactor * scale;
}

function tireGripForVehicle(vehicle: VehicleInput) {
  const baseGrip = tireGrip[vehicle.tireCompound];

  if (vehicle.tireCompound === 'rally') {
    if (vehicle.surface === 'rally') {
      return baseGrip + 0.08;
    }

    if (vehicle.surface === 'wet' || vehicle.surface === 'street') {
      return baseGrip + 0.03;
    }

    if (vehicle.surface === 'road') {
      return baseGrip - 0.02;
    }
  }

  if (vehicle.tireCompound === 'offroad' && vehicle.surface === 'rally') {
    return baseGrip + 0.04;
  }

  if (vehicle.tireCompound === 'snow' && vehicle.surface === 'wet') {
    return baseGrip + 0.04;
  }

  return baseGrip;
}

function powerIndex(vehicle: VehicleInput) {
  const weight = Math.max(vehicle.weightKg, 700);
  return clamp((vehicle.horsepower / weight) * 1000, 90, 900);
}

function tirePressure(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const widthAverage = (vehicle.frontTireWidth + vehicle.rearTireWidth) / 2;
  const tireWidthTrim = clamp((widthAverage - 245) / 80, -0.8, 1.2);
  const weightTrim = clamp((vehicle.weightKg - 1400) / 420, -1.4, 2.2);
  const surfaceTrim = {
    road: 0,
    street: 0.2,
    wet: -1.1,
    rally: vehicle.tireCompound === 'rally' || vehicle.tireCompound === 'offroad' ? 0 : -1.6,
    drift: -7.8,
    drag: -2.6,
  }[vehicle.surface];
  const base = tirePressureBase[vehicle.tireCompound] + surfaceTrim + weightTrim + tireWidthTrim;

  const loadShift = (vehicle.frontWeightPercent - 50) / 18;
  const rearPowerLoad = vehicle.drivetrain === 'RWD' ? -0.7 : vehicle.drivetrain === 'AWD' ? -0.2 : -1.1;
  const frontWork = vehicle.drivetrain === 'FWD' ? 1.2 : vehicle.drivetrain === 'AWD' ? 0.3 : 0.6;
  const compliance = intent.compliance * -0.25;
  const rotationSplit = intent.rotation * 0.22;
  const attack = strictnessBias(strictness, vehicle, -0.32);

  return {
    front: clamp(base + loadShift + frontWork - rotationSplit + compliance + attack, 14, 55),
    rear: clamp(base - loadShift + rearPowerLoad + rotationSplit + compliance + attack, 14, 55),
  };
}

function alignment(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const base = {
    road: { front: -1.35, rear: -0.95, toeF: 0, toeR: 0.05, caster: 6.2 },
    street: { front: -1.2, rear: -0.8, toeF: 0, toeR: 0.05, caster: 6 },
    wet: { front: -0.9, rear: -0.65, toeF: 0, toeR: 0.08, caster: 5.8 },
    rally: { front: -0.8, rear: -0.55, toeF: 0.05, toeR: 0.08, caster: 5.5 },
    drift: { front: -4.2, rear: -1.2, toeF: 0.35, toeR: 0.15, caster: 7 },
    drag: { front: -0.2, rear: -0.1, toeF: 0, toeR: 0, caster: 5 },
  }[vehicle.surface];

  const attack = strictnessBias(strictness, vehicle);

  return {
    camberFront: clamp(base.front - intent.rotation * 0.12 + intent.stability * 0.06 - attack * 0.12, -5, 0),
    camberRear: clamp(base.rear + intent.rotation * 0.08 + intent.stability * -0.04 - attack * 0.08, -3.5, 0),
    toeFront: clamp(base.toeF + intent.rotation * 0.03 + attack * 0.01, -0.2, 0.5),
    toeRear: clamp(base.toeR + intent.stability * 0.03, -0.2, 0.4),
    caster: clamp(base.caster + intent.rotation * 0.12 + attack * 0.18, 4, 7),
  };
}

function antiRoll(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const target = {
    FWD: { front: 11, rear: 32 },
    RWD: { front: 22, rear: 30 },
    AWD: { front: 26, rear: 34 },
  }[vehicle.drivetrain];
  const surfaceFactor = {
    road: 1,
    street: 0.94,
    wet: 0.78,
    rally: 0.62,
    drift: 0.72,
    drag: 0.54,
  }[vehicle.surface];
  const weightTrim = clamp((vehicle.weightKg - 1350) / 220, -2.5, 3.2);
  const speedTrim = intent.speedBias * 0.8;
  const stability = intent.stability * 1.5;
  const rotation = intent.rotation * 2.2;
  const attack = strictnessBias(strictness, vehicle);

  return {
    front: clamp((target.front + weightTrim + stability - rotation * 0.55 + speedTrim + attack * 1.1) * surfaceFactor, 1, 65),
    rear: clamp((target.rear + weightTrim - stability + rotation + speedTrim * 0.45 + attack * 1.6) * surfaceFactor, 1, 65),
  };
}

function springRange(min: number, max: number) {
  const low = clamp(Math.min(min, max), 1, 600);
  const high = clamp(Math.max(min, max), low + 1, 650);
  return { min: low, max: high };
}

function springValue(position: number, min: number, max: number) {
  const range = springRange(min, max);
  return range.min + (range.max - range.min) * clamp(position, 0, 1);
}

function springs(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const basePosition = {
    road: 0.42,
    street: 0.38,
    wet: 0.3,
    rally: 0.2,
    drift: 0.5,
    drag: 0.28,
  }[vehicle.surface];
  const frontWeightBias = (vehicle.frontWeightPercent - 50) / 130;
  const gripTrim = (tireGripForVehicle(vehicle) - 1) * 0.16;
  const powerTrim = clamp((powerIndex(vehicle) - 420) / 2400, -0.08, 0.16);
  const complianceTrim = intent.compliance * -0.045;
  const stabilityTrim = intent.stability * 0.025;
  const rotationTrim = intent.rotation * 0.035;
  const attack = strictnessBias(strictness, vehicle, 0.032);

  let frontPosition = basePosition + frontWeightBias + gripTrim + powerTrim + complianceTrim + stabilityTrim - rotationTrim * 0.35 + attack;
  let rearPosition = basePosition - frontWeightBias * 0.65 + gripTrim + powerTrim + complianceTrim - stabilityTrim + rotationTrim + attack * 1.15;

  if (vehicle.surface === 'drag') {
    frontPosition -= 0.13;
    rearPosition += vehicle.drivetrain === 'FWD' ? -0.04 : 0.1;
  }

  if (vehicle.surface === 'drift') {
    rearPosition += 0.08;
  }

  frontPosition = clamp(frontPosition, 0.06, 0.86);
  rearPosition = clamp(rearPosition, 0.06, 0.88);

  return {
    front: springValue(frontPosition, vehicle.springRateMinFront, vehicle.springRateMaxFront),
    rear: springValue(rearPosition, vehicle.springRateMinRear, vehicle.springRateMaxRear),
    frontPosition,
    rearPosition,
  };
}

function rideHeight(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const frontMin = Math.min(vehicle.rideHeightMinFront ?? vehicle.rideHeightMin, vehicle.rideHeightMaxFront ?? vehicle.rideHeightMax);
  const frontMax = Math.max(vehicle.rideHeightMinFront ?? vehicle.rideHeightMin, vehicle.rideHeightMaxFront ?? vehicle.rideHeightMax);
  const rearMin = Math.min(vehicle.rideHeightMinRear ?? vehicle.rideHeightMin, vehicle.rideHeightMaxRear ?? vehicle.rideHeightMax);
  const rearMax = Math.max(vehicle.rideHeightMinRear ?? vehicle.rideHeightMin, vehicle.rideHeightMaxRear ?? vehicle.rideHeightMax);
  const frontSpan = Math.max(frontMax - frontMin, 1);
  const rearSpan = Math.max(rearMax - rearMin, 1);
  const surfacePosition = {
    road: 0.18,
    street: 0.24,
    wet: 0.38,
    rally: 0.78,
    drift: 0.32,
    drag: 0.28,
  }[vehicle.surface];
  const complianceLift = intent.compliance * 0.055;
  const attack = strictnessBias(strictness, vehicle, 0.035);
  const front = frontMin + frontSpan * clamp(surfacePosition + complianceLift - attack + (vehicle.surface === 'drag' ? 0.1 : 0), 0, 1);
  const rear = rearMin + rearSpan * clamp(surfacePosition + complianceLift - attack + (vehicle.surface === 'drag' ? -0.02 : 0.03), 0, 1);

  return {
    front: clamp(front, frontMin, frontMax),
    rear: clamp(rear, rearMin, rearMax),
  };
}

function damping(vehicle: VehicleInput, springFrontPosition: number, springRearPosition: number, intent: TuningIntent, strictness: TuneStrictness) {
  const surface = {
    road: 1,
    street: 0.96,
    wet: 0.86,
    rally: 0.76,
    drift: 1.05,
    drag: 0.82,
  }[vehicle.surface];
  const compliance = 1 - intent.compliance * 0.06;
  const attack = strictnessBias(strictness, vehicle);
  const reboundFront = clamp((4.2 + springFrontPosition * 14.2 + intent.stability * 0.35 + attack * 0.32) * surface * compliance, 1, 20);
  const reboundRear = clamp((4.2 + springRearPosition * 14.2 - intent.stability * 0.2 + intent.rotation * 0.25 + attack * 0.38) * surface * compliance, 1, 20);

  return {
    reboundFront,
    reboundRear,
    bumpFront: clamp(reboundFront * (vehicle.surface === 'rally' ? 0.5 : 0.58) + attack * 0.08, 1, 12),
    bumpRear: clamp(reboundRear * (vehicle.surface === 'rally' ? 0.5 : 0.58) + attack * 0.08, 1, 12),
  };
}

function aero(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const base = {
    road: { front: 58, rear: 62 },
    street: { front: 52, rear: 58 },
    wet: { front: 64, rear: 68 },
    rally: { front: 45, rear: 52 },
    drift: { front: 40, rear: 48 },
    drag: { front: 12, rear: 18 },
  }[vehicle.surface];
  const speedTrim = intent.speedBias * -7;
  const stability = intent.stability * 4;
  const attack = strictnessBias(strictness, vehicle, 3.2);

  return {
    front: vehicle.frontAero ? clamp(base.front + speedTrim - intent.rotation * 2 + attack, 0, 100) : null,
    rear: vehicle.rearAero ? clamp(base.rear + speedTrim + stability + attack * 1.15, 0, 100) : null,
  };
}

function braking(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const baseBalance = vehicle.surface === 'drift' ? 42 : vehicle.surface === 'rally' ? 47 : 49;
  const basePressure = {
    road: 112,
    street: 108,
    wet: 96,
    rally: 100,
    drift: 124,
    drag: 118,
  }[vehicle.surface];
  const attack = strictnessBias(strictness, vehicle, 3.5);

  return {
    balance: clamp(baseBalance + intent.stability * 1.5 - intent.rotation * 1.2, 38, 55),
    pressure: clamp(basePressure + intent.rotation * 2 + attack, 85, 135),
  };
}

function differential(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const wetGrip = vehicle.surface === 'wet' || vehicle.surface === 'rally' ? -8 : 0;
  const rotation = intent.rotation * 3;
  const stability = intent.stability * -2;
  const attack = strictnessBias(strictness, vehicle, 2.2);

  if (vehicle.surface === 'drift') {
    return {
      frontAccel: vehicle.drivetrain === 'AWD' ? 58 : null,
      frontDecel: vehicle.drivetrain === 'AWD' ? 18 : null,
      rearAccel: 100,
      rearDecel: 78,
      center: vehicle.drivetrain === 'AWD' ? 82 : null,
    };
  }

  if (vehicle.drivetrain === 'FWD') {
    return {
      frontAccel: clamp(34 + wetGrip - intent.stability * 3 + attack, 18, 55),
      frontDecel: clamp(9 + rotation, 0, 28),
      rearAccel: null,
      rearDecel: null,
      center: null,
    };
  }

  if (vehicle.drivetrain === 'AWD') {
    return {
      frontAccel: clamp(24 + wetGrip * 0.5 + attack * 0.45, 12, 45),
      frontDecel: clamp(6 + rotation * 0.5, 0, 20),
      rearAccel: clamp(68 + wetGrip + rotation + attack, 42, 85),
      rearDecel: clamp(18 + rotation + stability + attack * 0.55, 4, 34),
      center: clamp(64 + intent.rotation * 4 - intent.speedBias * 2 + attack * 0.7, 52, 82),
    };
  }

  return {
    frontAccel: null,
    frontDecel: null,
    rearAccel: clamp(62 + wetGrip + rotation + attack, 38, 86),
    rearDecel: clamp(22 + rotation + stability + attack * 0.6, 6, 38),
    center: null,
  };
}

function gearing(vehicle: VehicleInput, intent: TuningIntent, strictness: TuneStrictness) {
  const power = powerIndex(vehicle);
  const dragBias = vehicle.surface === 'drag' ? -0.28 : 0;
  const rallyBias = vehicle.surface === 'rally' ? 0.18 : 0;
  const speedBias = intent.speedBias * -0.14;
  const attack = strictnessBias(strictness, vehicle, 0.035);
  const aeroPenalty = (vehicle.frontAero ? 9 : 0) + (vehicle.rearAero ? 14 : 0);
  const surfaceLimit = {
    road: 1,
    street: 0.96,
    wet: 0.88,
    rally: 0.74,
    drift: 0.82,
    drag: 1.08,
  }[vehicle.surface];
  const estimatedTopSpeedKmh = clamp(
    (132 + Math.sqrt(Math.max(vehicle.horsepower, 50)) * 7.8 + (vehicle.buildPi - 500) * 0.16 - (vehicle.weightKg - 1350) * 0.018 - aeroPenalty) *
      surfaceLimit,
    95,
    520,
  );
  const targetTopSpeedKmh = Number.isFinite(intent.targetTopSpeedKmh) && (intent.targetTopSpeedKmh ?? 0) > 0 ? clamp(intent.targetTopSpeedKmh ?? 0, 80, 520) : null;
  const targetDelta = targetTopSpeedKmh === null ? 0 : clamp((targetTopSpeedKmh - estimatedTopSpeedKmh) / estimatedTopSpeedKmh, -0.32, 0.42);
  const speedTargetTrim = 1 - targetDelta * 0.74;
  const topGearTrim = 1 - targetDelta * 0.5;
  const finalDrive = clamp((3.25 + (420 - power) / 900 + rallyBias + dragBias + speedBias - attack) * speedTargetTrim, 2.2, 6.1);
  const first = clamp(finalDrive * (vehicle.surface === 'drag' ? 0.78 : 0.94), 2.1, 4.8);
  const top = clamp((0.74 + intent.speedBias * 0.045 - (vehicle.gearCount - 6) * 0.025) * topGearTrim, 0.5, 1.25);
  const gears = Array.from({ length: vehicle.gearCount }, (_, index) => {
    const t = vehicle.gearCount === 1 ? 0 : index / (vehicle.gearCount - 1);
    return clamp(first * (top / first) ** t, 0.48, 6);
  });

  return {
    finalDrive,
    gears,
    estimatedTopSpeedKmh,
    targetTopSpeedKmh,
  };
}

function hasAdjustableSuspension(vehicle: VehicleInput) {
  return vehicle.upgrades.suspension === 'race' || vehicle.upgrades.suspension === 'rally' || vehicle.upgrades.suspension === 'drift';
}

function inputKindForSection(sectionId: string, value: TuneValue, vehicle: VehicleInput): TuneValue['inputKind'] {
  if (sectionId === 'aero') {
    return value.value === 'Serie' ? 'reference' : 'slider';
  }

  if (sectionId === 'gearing') {
    if (vehicle.upgrades.transmission === 'race' || vehicle.upgrades.transmission === 'drift4') return 'exact';
    if (vehicle.upgrades.transmission === 'sport' && value.label === 'Final Drive') return 'exact';
    return 'requiresUpgrade';
  }

  if (sectionId === 'alignment' || sectionId === 'damping') {
    return hasAdjustableSuspension(vehicle) ? 'exact' : 'requiresUpgrade';
  }

  if (sectionId === 'chassis') {
    if (value.label.startsWith('ARB')) {
      return vehicle.upgrades.antiRollBars === 'race' ? 'exact' : 'requiresUpgrade';
    }

    return hasAdjustableSuspension(vehicle) ? 'exact' : 'requiresUpgrade';
  }

  if (sectionId === 'brakes') {
    return vehicle.upgrades.brakes === 'race' ? 'exact' : 'requiresUpgrade';
  }

  if (sectionId === 'diff') {
    return vehicle.upgrades.differential === 'race' ? 'exact' : 'requiresUpgrade';
  }

  return 'exact';
}

function instructionForSection(sectionId: string, value: TuneValue, inputKind: TuneValue['inputKind']) {
  if (sectionId === 'tires') return inputHelp.tirePressure;

  if (sectionId === 'gearing') {
    if (inputKind === 'requiresUpgrade') {
      return value.label === 'Final Drive' ? inputHelp.gearingFinalDriveUpgrade : inputHelp.gearingRaceUpgrade;
    }

    return inputHelp.gearing;
  }

  if (sectionId === 'alignment') return inputKind === 'requiresUpgrade' ? inputHelp.suspensionUpgrade : inputHelp.alignment;
  if (sectionId === 'damping') return inputKind === 'requiresUpgrade' ? inputHelp.suspensionUpgrade : inputHelp.damping;
  if (sectionId === 'brakes') return inputKind === 'requiresUpgrade' ? inputHelp.brakeUpgrade : inputHelp.brake;
  if (sectionId === 'diff') return inputKind === 'requiresUpgrade' ? inputHelp.diffUpgrade : inputHelp.diff;

  if (sectionId === 'chassis') {
    if (value.label.startsWith('ARB')) {
      return inputKind === 'requiresUpgrade' ? inputHelp.antiRollUpgrade : inputHelp.antiRoll;
    }

    if (inputKind === 'requiresUpgrade') return inputHelp.suspensionUpgrade;
    if (value.label.startsWith('Feder')) return inputHelp.springRate;
    return inputHelp.rideHeight;
  }

  if (sectionId === 'aero') {
    return value.value === 'Serie' ? inputHelp.stock : inputHelp.aero;
  }

  return undefined;
}

function formulaForSection(sectionId: string, value: TuneValue) {
  if (sectionId === 'tires') return formulaHelp.tires;
  if (sectionId === 'gearing') return formulaHelp.gearing;
  if (sectionId === 'alignment') return formulaHelp.alignment;
  if (sectionId === 'damping') return formulaHelp.damping;
  if (sectionId === 'brakes') return formulaHelp.brakes;
  if (sectionId === 'aero') return value.value === 'Serie' ? undefined : formulaHelp.aero;
  if (sectionId === 'diff') return formulaHelp.diff;

  if (sectionId === 'chassis') {
    if (value.label.startsWith('ARB')) return formulaHelp.antiRoll;
    if (value.label.startsWith('Feder')) return formulaHelp.springs;
    return formulaHelp.rideHeight;
  }

  return undefined;
}

function calibratedAeroTarget(value: TuneValue, vehicle: VehicleInput) {
  if (value.label === 'Front') {
    return aeroTarget(Number.parseFloat(value.value), vehicle.frontAeroMinLb, vehicle.frontAeroMaxLb);
  }

  if (value.label === 'Heck') {
    return aeroTarget(Number.parseFloat(value.value), vehicle.rearAeroMinLb, vehicle.rearAeroMaxLb);
  }

  return null;
}

function applyInputHelp(sections: TuneSection[], vehicle: VehicleInput, unitSystem: UnitSystem) {
  const safeVehicle = { ...vehicle, upgrades: { ...defaultUpgradeSelections, ...vehicle.upgrades } };

  return sections.map((section) => ({
    ...section,
    values: section.values.map((value) => {
      const inputKind = inputKindForSection(section.id, value, safeVehicle);
      const calibratedLb = section.id === 'aero' && value.value !== 'Serie' ? calibratedAeroTarget(value, vehicle) : null;
      const calibratedAero = calibratedLb !== null ? formatMeasurement(calibratedLb, 'aeroDownforce', unitSystem) : null;

      return {
        ...value,
        detail: section.id === 'aero' && value.value !== 'Serie' ? 'Richtung Cornering' : value.detail,
        value: section.id === 'aero' && value.value !== 'Serie' && calibratedAero ? `${value.value} Slider / ${calibratedAero}` : section.id === 'aero' && value.value !== 'Serie' ? `${value.value} Slider` : value.value,
        instruction: instructionForSection(section.id, value, inputKind),
        formula: formulaForSection(section.id, value),
        inputKind,
      };
    }),
  }));
}

function buildSections(vehicle: VehicleInput, intent: TuningIntent, unitSystem: UnitSystem, strictness: TuneStrictness): TuneSection[] {
  const tire = tirePressure(vehicle, intent, strictness);
  const align = alignment(vehicle, intent, strictness);
  const arb = antiRoll(vehicle, intent, strictness);
  const spring = springs(vehicle, intent, strictness);
  const height = rideHeight(vehicle, intent, strictness);
  const damp = damping(vehicle, spring.frontPosition, spring.rearPosition, intent, strictness);
  const aeroTune = aero(vehicle, intent, strictness);
  const brake = braking(vehicle, intent, strictness);
  const diff = differential(vehicle, intent, strictness);
  const gear = gearing(vehicle, intent, strictness);

  const sections: TuneSection[] = [
    {
      id: 'tires',
      title: 'Reifen',
      values: [
        { label: 'Vorne', value: pressure(tire.front, unitSystem), detail: 'Startdruck kalt' },
        { label: 'Hinten', value: pressure(tire.rear, unitSystem), detail: 'Startdruck kalt' },
      ],
    },
    {
      id: 'gearing',
      title: 'Getriebe',
      values: [
        {
          label: 'Final Drive',
          value: round(gear.finalDrive, 2).toString(),
          detail: gear.targetTopSpeedKmh ? `Zielgeschwindigkeit ${speedTarget(gear.targetTopSpeedKmh, unitSystem)}` : `${vehicle.gearCount} Gänge`,
        },
        ...gear.gears.map((ratio, index) => ({
          label: `${index + 1}. Gang`,
          value: round(ratio, 2).toString(),
          detail: index === 0 ? 'Traktion beim Anfahren' : index === gear.gears.length - 1 ? (intent.speedBias > 0 ? 'länger' : 'direkter') : 'Gangspreizung',
        })),
      ],
    },
    {
      id: 'alignment',
      title: 'Ausrichtung',
      values: [
        { label: 'Camber V', value: `${round(align.camberFront, 2)}°`, detail: 'Kurveneingang' },
        { label: 'Camber H', value: `${round(align.camberRear, 2)}°`, detail: 'Kurvenausgang' },
        { label: 'Toe V', value: `${signed(align.toeFront)}°`, detail: 'Lenkantwort' },
        { label: 'Toe H', value: `${signed(align.toeRear)}°`, detail: 'Stabilität' },
        { label: 'Caster', value: `${round(align.caster, 1)}°`, detail: 'Selbstzentrierung' },
      ],
    },
    {
      id: 'chassis',
      title: 'Fahrwerk',
      values: [
        { label: 'ARB V', value: round(arb.front, 1).toString(), detail: 'Stabi vorne' },
        { label: 'ARB H', value: round(arb.rear, 1).toString(), detail: 'Stabi hinten' },
        { label: 'Feder V', value: springRate(spring.front, unitSystem), detail: sliderDetail(spring.frontPosition) },
        { label: 'Feder H', value: springRate(spring.rear, unitSystem), detail: sliderDetail(spring.rearPosition) },
        { label: 'Höhe V', value: formatMeasurement(height.front, 'rideHeight', unitSystem), detail: 'Bodenfreiheit' },
        { label: 'Höhe H', value: formatMeasurement(height.rear, 'rideHeight', unitSystem), detail: 'Bodenfreiheit' },
      ],
    },
    {
      id: 'damping',
      title: 'Dämpfung',
      values: [
        { label: 'Rebound V', value: round(damp.reboundFront, 1).toString(), detail: 'Ausfedern' },
        { label: 'Rebound H', value: round(damp.reboundRear, 1).toString(), detail: 'Ausfedern' },
        { label: 'Bump V', value: round(damp.bumpFront, 1).toString(), detail: 'Einfedern' },
        { label: 'Bump H', value: round(damp.bumpRear, 1).toString(), detail: 'Einfedern' },
      ],
    },
    {
      id: 'brakes',
      title: 'Bremsen',
      values: [
        { label: 'Balance', value: percent(brake.balance), detail: 'Frontanteil' },
        { label: 'Druck', value: percent(brake.pressure), detail: 'Pedalkraft' },
      ],
    },
  ];

  if (vehicle.frontAero || vehicle.rearAero) {
    sections.push({
      id: 'aero',
      title: 'Aero',
      values: [
        {
          label: 'Front',
          value: aeroTune.front === null ? 'Serie' : percent(aeroTune.front),
          detail: vehicle.frontAero ? 'Downforce' : 'nicht einstellbar',
          tone: aeroTune.front !== null && aeroTarget(aeroTune.front, vehicle.frontAeroMinLb, vehicle.frontAeroMaxLb) !== null ? 'success' : undefined,
        },
        {
          label: 'Heck',
          value: aeroTune.rear === null ? 'Serie' : percent(aeroTune.rear),
          detail: vehicle.rearAero ? 'Downforce' : 'nicht einstellbar',
          tone: aeroTune.rear !== null && aeroTarget(aeroTune.rear, vehicle.rearAeroMinLb, vehicle.rearAeroMaxLb) !== null ? 'success' : undefined,
        },
      ],
    });
  }

  sections.push({
    id: 'diff',
    title: 'Differenzial',
    values: [
      ...(diff.frontAccel !== null
        ? [
            { label: 'Front Accel', value: percent(diff.frontAccel), detail: 'Sperre unter Gas' },
            { label: 'Front Decel', value: percent(diff.frontDecel ?? 0), detail: 'Sperre beim Rollen' },
          ]
        : []),
      ...(diff.rearAccel !== null
        ? [
            { label: 'Rear Accel', value: percent(diff.rearAccel), detail: 'Sperre unter Gas' },
            { label: 'Rear Decel', value: percent(diff.rearDecel ?? 0), detail: 'Sperre beim Rollen' },
          ]
        : []),
      ...(diff.center !== null ? [{ label: 'Center', value: percent(diff.center), detail: 'Heckanteil AWD' }] : []),
    ],
  });

  return applyInputHelp(sections, vehicle, unitSystem);
}

export const defaultVehicle: VehicleInput = {
  selectedCarId: '255',
  carName: '2025 GR GT Prototype',
  make: 'GR',
  carType: 'Super GT',
  sourcePi: 771,
  buildPi: 771,
  country: 'Japan',
  collection: 'Autoshow, Wheelspin',
  addOns: '',
  carClass: 'S1',
  drivetrain: 'AWD',
  surface: 'road',
  tireCompound: 'sport',
  weightKg: 1420,
  frontWeightPercent: 52,
  horsepower: 640,
  torqueNm: 720,
  frontTireWidth: 265,
  rearTireWidth: 295,
  gearCount: 6,
  rideHeightMin: 8.2,
  rideHeightMax: 18,
  rideHeightMinFront: 8.2,
  rideHeightMaxFront: 18,
  rideHeightMinRear: 8.2,
  rideHeightMaxRear: 18,
  springRateMinFront: 55,
  springRateMaxFront: 280,
  springRateMinRear: 55,
  springRateMaxRear: 280,
  frontAero: true,
  rearAero: true,
  frontAeroMinLb: 0,
  frontAeroMaxLb: 0,
  rearAeroMinLb: 0,
  rearAeroMaxLb: 0,
  specSource: 'estimated',
  upgrades: defaultUpgradeSelections,
};

export const defaultIntent: TuningIntent = {
  rotation: 0,
  stability: 0,
  speedBias: 0,
  compliance: 0,
  targetTopSpeedKmh: 0,
};

export function calculateTune(vehicle: VehicleInput, intent: TuningIntent, unitSystem: UnitSystem = 'metric', strictness: TuneStrictness = 'balanced'): TuneResult {
  const safeVehicle = sanitizeVehicleForFH6({ ...vehicle, upgrades: { ...defaultUpgradeSelections, ...vehicle.upgrades } });
  const grip = tireGripForVehicle(safeVehicle);
  const power = powerIndex(safeVehicle);
  const buildPiWeight = safeVehicle.buildPi ? safeVehicle.buildPi * 0.22 : 0;
  const strictnessScore = strictnessLevels[strictness] * 12;
  const score = Math.round(
    clamp(
      buildPiWeight +
        power * 0.3 +
        grip * 190 +
        (safeVehicle.drivetrain === 'AWD' ? 45 : 25) +
        (100 - Math.abs(50 - safeVehicle.frontWeightPercent)) * 1.05 +
        strictnessScore,
      0,
      999,
    ),
  );
  const sections = buildSections(safeVehicle, intent, unitSystem, strictness);
  const notes = [
    safeVehicle.buildPi ? `FH6 build PI: ${safeVehicle.buildPi} ${safeVehicle.carClass}. Stock snapshot: ${safeVehicle.sourcePi} PI, ${safeVehicle.carType}, ${safeVehicle.country}.` : '',
    safeVehicle.surface === 'wet' ? 'Reifen und Dämpfer sind weicher, damit Lastwechsel nicht abrupt werden.' : '',
    safeVehicle.surface === 'rally' ? 'Mehr Bodenfreiheit und weichere Stabis geben dem Auto auf Sprüngen Reserven.' : '',
    safeVehicle.tireCompound === 'rally' ? 'Rally-Reifen geben auf losem Untergrund mehr Seitenhalt, ohne das Setup zu hart zu machen.' : '',
    safeVehicle.surface === 'drag' ? 'Die Übersetzung priorisiert Traktion und saubere Schaltpunkte statt Kurvenbalance.' : '',
    safeVehicle.surface === 'drift' ? 'Hohe Sperrwerte und viel Caster machen den Winkel leichter kontrollierbar.' : '',
    (intent.targetTopSpeedKmh ?? 0) > 0 ? `Target-Speed aktiv: Getriebe wurde auf ca. ${speedTarget(intent.targetTopSpeedKmh ?? 0, unitSystem)} Zielgeschwindigkeit skaliert.` : '',
    Math.abs(intent.rotation) > 1 ? 'Rotationskorrektur aktiv: Stabis, Toe und Differential wurden spürbar verschoben.' : '',
    Math.abs(intent.speedBias) > 1 ? 'Speed-Bias aktiv: Final Drive und Aero wurden auf Tempo oder Punch getrimmt.' : '',
  ].filter(Boolean);

  return {
    score,
    summary: `${safeVehicle.carClass} ${safeVehicle.drivetrain} ${surfaceNames[safeVehicle.surface]} Setup`,
    sections,
    notes,
  };
}

export function formatTuneForClipboard(vehicle: VehicleInput, result: TuneResult, language: AppLanguage = 'de', unitSystem: UnitSystem = 'metric') {
  const safeVehicle = sanitizeVehicleForFH6(vehicle);
  const power = formatMeasurement(safeVehicle.horsepower, 'power', unitSystem);
  const weight = formatMeasurement(safeVehicle.weightKg, 'weight', unitSystem);
  const powerLine =
    language === 'en'
      ? `Power ${power} | Weight ${weight} | ${safeVehicle.frontWeightPercent}% Front`
      : `Leistung ${power} | Gewicht ${weight} | ${safeVehicle.frontWeightPercent}% Front`;
  const lines = [
    `${safeVehicle.carName} - ${result.summary}`,
    `FH6 Build ${safeVehicle.buildPi} ${safeVehicle.carClass} | Stock ${safeVehicle.sourcePi} PI | ${safeVehicle.carType} | ${safeVehicle.country}`,
    powerLine,
    '',
    ...result.sections.flatMap((section) => [
      section.title,
      ...section.values.map((item) => `- ${item.label}: ${item.value} (${[item.detail, item.instruction].filter(Boolean).join(' | ')})`),
      '',
    ]),
  ];

  return lines.join('\n').trim();
}
