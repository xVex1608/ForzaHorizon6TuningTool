import { clampFH6Value, classFromPi, sanitizeVehicleForFH6 } from './fh6Compatibility';
import type {
  UpgradeAero,
  UpgradeAntiRollBars,
  UpgradeBrakes,
  UpgradeDifferential,
  UpgradeDrivetrain,
  UpgradePower,
  UpgradeSelections,
  UpgradeSuspension,
  UpgradeTireWidth,
  UpgradeTransmission,
  UpgradeWeightReduction,
  VehicleInput,
} from './types';

export type UpgradeRecommendationChange = {
  key: keyof UpgradeSelections;
  from: UpgradeSelections[keyof UpgradeSelections];
  to: UpgradeSelections[keyof UpgradeSelections];
};

export type UpgradeRecommendation = {
  targetPi: number;
  buildPi: number;
  gap: number;
  isAboveTarget: boolean;
  upgrades: UpgradeSelections;
  changes: UpgradeRecommendationChange[];
};

export const defaultUpgradeSelections: UpgradeSelections = {
  power: 'stock',
  weightReduction: 'stock',
  tireCompound: 'stock',
  tireWidth: 'stock',
  drivetrain: 'stock',
  aero: 'stock',
  transmission: 'stock',
  suspension: 'stock',
  antiRollBars: 'stock',
  brakes: 'stock',
  differential: 'stock',
};

const powerMultipliers: Record<UpgradePower, number> = {
  stock: 1,
  street: 1.12,
  sport: 1.25,
  race: 1.42,
};

const torqueMultipliers: Record<UpgradePower, number> = {
  stock: 1,
  street: 1.1,
  sport: 1.21,
  race: 1.36,
};

const weightMultipliers: Record<UpgradeWeightReduction, number> = {
  stock: 1,
  street: 0.96,
  sport: 0.92,
  race: 0.86,
};

const widthAdds: Record<UpgradeTireWidth, number> = {
  stock: 0,
  street: 10,
  sport: 20,
  race: 30,
};

const transmissionGearAdds: Record<UpgradeTransmission, number> = {
  stock: 0,
  sport: 0,
  race: 1,
  drift4: 0,
};

const suspensionSpringScale: Record<UpgradeSuspension, number> = {
  stock: 1,
  sport: 1.1,
  race: 1.22,
  rally: 0.82,
  drift: 1.05,
};

// FH6 does not expose exact per-part PI deltas, so these are category-level
// estimates tuned to match the way maxed low/mid-class builds can climb into S2.
const piAdds = {
  power: { stock: 0, street: 42, sport: 92, race: 165 } satisfies Record<UpgradePower, number>,
  weightReduction: { stock: 0, street: 18, sport: 38, race: 62 } satisfies Record<UpgradeWeightReduction, number>,
  tireWidth: { stock: 0, street: 10, sport: 21, race: 32 } satisfies Record<UpgradeTireWidth, number>,
  drivetrain: { stock: 0, FWD: 4, RWD: 8, AWD: 34 } satisfies Record<UpgradeDrivetrain, number>,
  aero: { stock: 0, front: 11, rear: 11, race: 22 } satisfies Record<UpgradeAero, number>,
  transmission: { stock: 0, sport: 10, race: 22, drift4: 18 } satisfies Record<UpgradeTransmission, number>,
  suspension: { stock: 0, sport: 12, race: 24, rally: 20, drift: 22 } satisfies Record<UpgradeSuspension, number>,
  antiRollBars: { stock: 0, race: 12 } satisfies Record<UpgradeAntiRollBars, number>,
  brakes: { stock: 0, race: 14 } satisfies Record<UpgradeBrakes, number>,
  differential: { stock: 0, race: 10, drift: 10 } satisfies Record<UpgradeDifferential, number>,
  tireCompound: {
    stock: 0,
    street: 16,
    sport: 34,
    semiSlick: 60,
    slick: 80,
    rally: 34,
    offroad: 24,
    snow: 10,
    drift: 38,
  },
};

export function normalizeUpgradeSelections(upgrades?: Partial<UpgradeSelections>): UpgradeSelections {
  return {
    ...defaultUpgradeSelections,
    ...upgrades,
  };
}

const advisorChoiceSets: { [Key in keyof UpgradeSelections]: Array<UpgradeSelections[Key]> } = {
  power: ['stock', 'street', 'sport', 'race'],
  weightReduction: ['stock', 'street', 'sport', 'race'],
  tireCompound: ['stock', 'street', 'sport', 'semiSlick', 'slick', 'rally', 'offroad', 'snow', 'drift'],
  tireWidth: ['stock', 'street', 'sport', 'race'],
  drivetrain: ['stock', 'FWD', 'RWD', 'AWD'],
  aero: ['stock', 'front', 'rear', 'race'],
  transmission: ['stock', 'sport', 'race', 'drift4'],
  suspension: ['stock', 'sport', 'race', 'rally', 'drift'],
  antiRollBars: ['stock', 'race'],
  brakes: ['stock', 'race'],
  differential: ['stock', 'race', 'drift'],
};

const advisorKeys = Object.keys(advisorChoiceSets) as Array<keyof UpgradeSelections>;

function advisorChoiceSetsForTarget(targetPi: number): { [Key in keyof UpgradeSelections]: Array<UpgradeSelections[Key]> } {
  const targetClass = classFromPi(targetPi);

  if (targetClass === 'D' || targetClass === 'C') {
    return {
      ...advisorChoiceSets,
      power: ['stock', 'street'],
      tireCompound: ['stock', 'street', 'sport', 'rally', 'offroad', 'snow', 'drift'],
      drivetrain: ['stock'],
    };
  }

  if (targetClass === 'B') {
    return {
      ...advisorChoiceSets,
      power: ['stock', 'street', 'sport'],
      tireCompound: ['stock', 'street', 'sport', 'semiSlick', 'rally', 'offroad', 'snow', 'drift'],
      drivetrain: ['stock'],
    };
  }

  if (targetClass === 'A') {
    return {
      ...advisorChoiceSets,
      power: ['stock', 'street', 'sport', 'race'],
      tireCompound: ['stock', 'street', 'sport', 'semiSlick', 'slick', 'rally', 'offroad', 'snow', 'drift'],
      drivetrain: ['stock'],
    };
  }

  return advisorChoiceSets;
}

function upgradeChanges(from: UpgradeSelections, to: UpgradeSelections): UpgradeRecommendationChange[] {
  return advisorKeys
    .filter((key) => from[key] !== to[key])
    .map((key) => ({
      key,
      from: from[key],
      to: to[key],
    }));
}

function advisorScore(buildPi: number, targetPi: number, changeCount: number) {
  if (buildPi <= targetPi) {
    return (targetPi - buildPi) * 10 + changeCount * 4;
  }

  return 10000 + (buildPi - targetPi) * 24 + changeCount * 5;
}

export function recommendUpgradeBuild(baseVehicle: VehicleInput, targetPi: number, currentInput?: Partial<UpgradeSelections>): UpgradeRecommendation {
  const currentUpgrades = normalizeUpgradeSelections(currentInput);
  const safeTarget = clampFH6Value('buildPi', targetPi);
  const currentBuild = applyUpgradeSelections(baseVehicle, currentUpgrades);
  const targetChoiceSets = advisorChoiceSetsForTarget(safeTarget);

  type Candidate = {
    upgrades: UpgradeSelections;
    buildPi: number;
  };

  let beam: Candidate[] = [{ upgrades: currentUpgrades, buildPi: currentBuild.buildPi }];

  for (const key of advisorKeys) {
    const nextCandidates = new Map<string, Candidate>();

    for (const candidate of beam) {
      for (const value of targetChoiceSets[key]) {
        const upgrades = normalizeUpgradeSelections({ ...candidate.upgrades, [key]: value });
        const build = applyUpgradeSelections(baseVehicle, upgrades);
        const signature = JSON.stringify(upgrades);
        const existing = nextCandidates.get(signature);

        if (!existing || advisorScore(build.buildPi, safeTarget, upgradeChanges(currentUpgrades, upgrades).length) < advisorScore(existing.buildPi, safeTarget, upgradeChanges(currentUpgrades, existing.upgrades).length)) {
          nextCandidates.set(signature, { upgrades, buildPi: build.buildPi });
        }
      }
    }

    beam = [...nextCandidates.values()]
      .sort((left, right) => {
        const leftChanges = upgradeChanges(currentUpgrades, left.upgrades).length;
        const rightChanges = upgradeChanges(currentUpgrades, right.upgrades).length;
        return advisorScore(left.buildPi, safeTarget, leftChanges) - advisorScore(right.buildPi, safeTarget, rightChanges);
      })
      .slice(0, 90);
  }

  const bestUnderTarget = beam.find((candidate) => candidate.buildPi <= safeTarget);
  const best = bestUnderTarget ?? beam[0] ?? { upgrades: currentUpgrades, buildPi: currentBuild.buildPi };

  return {
    targetPi: safeTarget,
    buildPi: best.buildPi,
    gap: safeTarget - best.buildPi,
    isAboveTarget: best.buildPi > safeTarget,
    upgrades: best.upgrades,
    changes: upgradeChanges(currentUpgrades, best.upgrades),
  };
}

function applySuspension(vehicle: VehicleInput, suspension: UpgradeSuspension) {
  if (suspension === 'stock') {
    return vehicle;
  }

  const scale = suspensionSpringScale[suspension];
  const isRally = suspension === 'rally';
  const rangeShift = suspension === 'race' || suspension === 'drift' ? 2 : 1;
  const applyRideRange = (min: number, max: number) => {
    const rideMin = isRally ? min + 3 : Math.max(3, min - rangeShift);
    const rideMax = isRally ? max + 6 : Math.max(rideMin + 4, max - rangeShift);

    return { min: rideMin, max: rideMax };
  };
  const frontRange = applyRideRange(vehicle.rideHeightMinFront ?? vehicle.rideHeightMin, vehicle.rideHeightMaxFront ?? vehicle.rideHeightMax);
  const rearRange = applyRideRange(vehicle.rideHeightMinRear ?? vehicle.rideHeightMin, vehicle.rideHeightMaxRear ?? vehicle.rideHeightMax);

  return {
    ...vehicle,
    rideHeightMin: clampFH6Value('rideHeightMin', Math.min(frontRange.min, rearRange.min)),
    rideHeightMax: clampFH6Value('rideHeightMax', Math.max(frontRange.max, rearRange.max)),
    rideHeightMinFront: clampFH6Value('rideHeightMinFront', frontRange.min),
    rideHeightMaxFront: clampFH6Value('rideHeightMaxFront', frontRange.max),
    rideHeightMinRear: clampFH6Value('rideHeightMinRear', rearRange.min),
    rideHeightMaxRear: clampFH6Value('rideHeightMaxRear', rearRange.max),
    springRateMinFront: clampFH6Value('springRateMinFront', vehicle.springRateMinFront * scale),
    springRateMaxFront: clampFH6Value('springRateMaxFront', vehicle.springRateMaxFront * scale),
    springRateMinRear: clampFH6Value('springRateMinRear', vehicle.springRateMinRear * scale),
    springRateMaxRear: clampFH6Value('springRateMaxRear', vehicle.springRateMaxRear * scale),
  };
}

function drivetrainPiAdd(basePi: number, drivetrain: UpgradeDrivetrain) {
  if (drivetrain === 'stock') return 0;
  if (drivetrain === 'AWD') {
    if (basePi < 300) return 516;
    if (basePi < 400) return 260;
    if (basePi < 500) return 140;
    if (basePi < 600) return 75;
    return 34;
  }

  if (basePi < 300) return 90;
  if (basePi < 400) return 50;
  return drivetrain === 'RWD' ? 8 : 4;
}

export function applyUpgradeSelections(baseVehicle: VehicleInput, upgradeInput?: Partial<UpgradeSelections>): VehicleInput {
  const upgrades = normalizeUpgradeSelections(upgradeInput);
  const widthAdd = widthAdds[upgrades.tireWidth];
  const drivetrain = upgrades.drivetrain === 'stock' ? baseVehicle.drivetrain : upgrades.drivetrain;
  const powerPi = piAdds.power[upgrades.power];
  const pi =
    baseVehicle.sourcePi +
    powerPi +
    piAdds.weightReduction[upgrades.weightReduction] +
    piAdds.tireCompound[upgrades.tireCompound] +
    piAdds.tireWidth[upgrades.tireWidth] +
    drivetrainPiAdd(baseVehicle.sourcePi, upgrades.drivetrain) +
    piAdds.aero[upgrades.aero] +
    piAdds.transmission[upgrades.transmission] +
    piAdds.suspension[upgrades.suspension] +
    piAdds.antiRollBars[upgrades.antiRollBars] +
    piAdds.brakes[upgrades.brakes] +
    piAdds.differential[upgrades.differential];

  const withCoreUpgrades: VehicleInput = {
    ...baseVehicle,
    upgrades,
    drivetrain,
    tireCompound: upgrades.tireCompound,
    horsepower: clampFH6Value('horsepower', Math.round(baseVehicle.horsepower * powerMultipliers[upgrades.power])),
    torqueNm: clampFH6Value('torqueNm', Math.round(baseVehicle.torqueNm * torqueMultipliers[upgrades.power])),
    weightKg: clampFH6Value('weightKg', Math.round(baseVehicle.weightKg * weightMultipliers[upgrades.weightReduction])),
    frontWeightPercent: clampFH6Value('frontWeightPercent', baseVehicle.frontWeightPercent + (drivetrain === 'AWD' ? 1 : drivetrain === 'FWD' ? 2 : -1)),
    frontTireWidth: clampFH6Value('frontTireWidth', baseVehicle.frontTireWidth + widthAdd),
    rearTireWidth: clampFH6Value('rearTireWidth', baseVehicle.rearTireWidth + widthAdd + (drivetrain === 'RWD' && upgrades.tireWidth !== 'stock' ? 10 : 0)),
    gearCount: clampFH6Value('gearCount', upgrades.transmission === 'drift4' ? 4 : Math.max(baseVehicle.gearCount, baseVehicle.gearCount + transmissionGearAdds[upgrades.transmission])),
    frontAero: upgrades.aero === 'front' || upgrades.aero === 'race' || baseVehicle.frontAero,
    rearAero: upgrades.aero === 'rear' || upgrades.aero === 'race' || baseVehicle.rearAero,
    buildPi: clampFH6Value('buildPi', pi),
    specSource: 'upgrades',
  };

  return sanitizeVehicleForFH6(applySuspension(withCoreUpgrades, upgrades.suspension));
}
