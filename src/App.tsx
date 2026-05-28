import {
  ArrowDownToLine,
  BadgeInfo,
  CarFront,
  Check,
  ChevronDown,
  Clipboard,
  Coffee,
  Database,
  ExternalLink,
  Gauge,
  Import,
  ListChecks,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  Wrench,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_CREATOR, APP_NAME, APP_VERSION, HERO_IMAGE_URL } from './appInfo';
import { FH6_CAR_DATA_SOURCE, fh6Cars, findFH6CarById } from './data/fh6Cars';
import { classFromPi, FH6_INGAME_SPEC_KEYS, FH6_LIMITS, isVehicleFH6Compatible, sanitizeVehicleForFH6 } from './fh6Compatibility';
import { getUiText, languageOptions, localizeTuneResult } from './i18n';
import {
  createFH6DataStore,
  defaultSettings,
  hasFH6DataStoreEntries,
  loadProfiles,
  loadSettings,
  loadVerifiedReach,
  loadVerifiedSnapshots,
  normalizeFH6DataStore,
  saveProfiles,
  saveSettings,
  saveVerifiedReach,
  saveVerifiedSnapshots,
} from './storage';
import { calculateTune, defaultIntent, defaultVehicle, formatTuneForClipboard } from './tuning';
import { checkForUpdates, type UpdateCheckResult } from './updateCheck';
import {
  canonicalMeasurementValue,
  displayMeasurementValue,
  formatMeasurement,
  measurementStep,
  measurementUnit,
  powerToWeightLabel as getPowerToWeightLabel,
  powerToWeightValue,
  type MeasurementKind,
} from './units';
import type {
  AppLanguage,
  AppSettings,
  AppView,
  CarClass,
  Drivetrain,
  FH6Car,
  GarageDensity,
  SavedProfile,
  Surface,
  TireCompound,
  UiDensity,
  UpgradeAntiRollBars,
  UpgradeAero,
  UpgradeBrakes,
  UpgradeDifferential,
  UpgradeDrivetrain,
  UpgradePower,
  UpgradeSuspension,
  UpgradeTireWidth,
  UpgradeTransmission,
  UpgradeWeightReduction,
  UpgradeSelections,
  TuneStrictness,
  TuningIntent,
  UnitSystem,
  VehicleInput,
  VerifiedVehicleReach,
  VerifiedVehicleSnapshot,
} from './types';
import { applyUpgradeSelections, defaultUpgradeSelections, normalizeUpgradeSelections, recommendUpgradeBuild, type UpgradeRecommendationChange } from './upgrades';

const carClasses: CarClass[] = ['D', 'C', 'B', 'A', 'S1', 'S2', 'R', 'X'];
const classPiRanges: Record<CarClass, { min: number; max: number }> = {
  D: { min: 100, max: 400 },
  C: { min: 401, max: 500 },
  B: { min: 501, max: 600 },
  A: { min: 601, max: 700 },
  S1: { min: 701, max: 800 },
  S2: { min: 801, max: 900 },
  R: { min: 901, max: 998 },
  X: { min: 999, max: 999 },
};
const localeByLanguage: Record<AppLanguage, string> = {
  de: 'de-DE',
  en: 'en-US',
  fr: 'fr-FR',
  it: 'it-IT',
};
const FEEL_INTENT_LIMIT = 5;
const TARGET_TOP_SPEED_MAX_KMH = 520;
const KMH_PER_MPH = 1.609344;

const drivetrainOptions: Array<{ value: Drivetrain; label: string }> = [
  { value: 'AWD', label: 'AWD' },
  { value: 'RWD', label: 'RWD' },
  { value: 'FWD', label: 'FWD' },
];

const surfaceOptions: Array<{ value: Surface; label: string }> = [
  { value: 'road', label: 'Grip' },
  { value: 'street', label: 'Street' },
  { value: 'wet', label: 'Regen' },
  { value: 'rally', label: 'Rallye' },
  { value: 'drift', label: 'Drift' },
  { value: 'drag', label: 'Drag' },
];

const tireOptions: Array<{ value: TireCompound; label: string }> = [
  { value: 'stock', label: 'Serie' },
  { value: 'street', label: 'Street' },
  { value: 'sport', label: 'Sport' },
  { value: 'semiSlick', label: 'Semi' },
  { value: 'slick', label: 'Slick' },
  { value: 'rally', label: 'Rally' },
  { value: 'offroad', label: 'Offroad' },
  { value: 'snow', label: 'Snow' },
  { value: 'drift', label: 'Drift' },
];

const navItems: Array<{ view: AppView; icon: typeof CarFront }> = [
  { view: 'garage', icon: CarFront },
  { view: 'tune', icon: Wrench },
  { view: 'fh6Data', icon: Database },
  { view: 'settings', icon: Settings },
  { view: 'updates', icon: RefreshCw },
];

const buildAssistantStyles = ['balanced', 'grip', 'speed', 'rally', 'drift', 'drag'] as const;

type BuildAssistantStyle = (typeof buildAssistantStyles)[number];
type TunePanel = 'build' | 'assistant' | 'calibration' | 'feel' | 'summary';
type DataHubPanel = 'capture' | 'library' | 'workflow' | 'reach' | 'current' | 'editor';
type UpdateViewState = 'idle' | 'checking' | 'current' | 'available' | 'failed';
type UpdateInstallState = 'idle' | 'downloading' | 'started' | 'skipped' | 'failed';

const buildAssistantPriority: Record<BuildAssistantStyle, Array<keyof UpgradeSelections>> = {
  balanced: ['tireCompound', 'tireWidth', 'weightReduction', 'aero', 'suspension', 'transmission', 'power', 'differential', 'brakes', 'antiRollBars'],
  grip: ['tireCompound', 'tireWidth', 'aero', 'suspension', 'weightReduction', 'antiRollBars', 'differential', 'brakes', 'power', 'transmission'],
  speed: ['power', 'transmission', 'weightReduction', 'tireCompound', 'drivetrain', 'aero', 'tireWidth', 'differential', 'brakes'],
  rally: ['tireCompound', 'suspension', 'drivetrain', 'tireWidth', 'weightReduction', 'power', 'differential', 'transmission', 'antiRollBars'],
  drift: ['drivetrain', 'differential', 'power', 'tireCompound', 'suspension', 'transmission', 'weightReduction', 'brakes', 'antiRollBars'],
  drag: ['power', 'drivetrain', 'transmission', 'tireCompound', 'tireWidth', 'weightReduction', 'differential', 'suspension'],
};

function className(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ');
}

function normalizeVehicle(vehicle?: Partial<VehicleInput>): VehicleInput {
  const merged = { ...defaultVehicle, ...vehicle };
  merged.upgrades = normalizeUpgradeSelections(merged.upgrades);

  if (typeof vehicle?.buildPi !== 'number' && typeof vehicle?.sourcePi === 'number') {
    merged.buildPi = vehicle.sourcePi;
  }

  return sanitizeVehicleForFH6(merged);
}

function piToneClass(carClass: CarClass) {
  return `pi-${carClass.toLowerCase()}`;
}

function estimateSpringLimits(weightKg: number, isLooseSurface: boolean) {
  const softTrim = isLooseSurface ? 0.72 : 1;
  const min = Math.round(Math.max(22, (weightKg / 26) * softTrim));
  const max = Math.round(Math.max(min + 80, (weightKg / 5.1) * softTrim));

  return { min, max };
}

function estimateVehicleFromCar(car: FH6Car, current: VehicleInput, surface: Surface): VehicleInput {
  const type = car.type.toLowerCase();
  const name = car.name.toLowerCase();
  const pi = car.pi || current.sourcePi || 500;
  const isRally = type.includes('rally') || type.includes('offroad') || name.includes('baja') || name.includes('dakar');
  const isDrift = type.includes('drift') || name.includes('formula drift');
  const isHyper = type.includes('hyper') || type.includes('extreme track') || car.carClass === 'R';
  const isHatch = type.includes('hatch');
  const drivetrain: Drivetrain = isDrift ? 'RWD' : isRally || isHyper || name.includes('gt-r') || name.includes('evo') ? 'AWD' : isHatch ? 'FWD' : 'RWD';
  const weightKg = isHyper ? 1320 : isRally ? 1480 : isHatch ? 1240 : pi > 700 ? 1420 : 1360;
  const horsepower = Math.round(Math.max(80, Math.min(1600, 90 + pi * (isHyper ? 0.9 : 0.68))));
  const torqueNm = Math.round(horsepower * (isHyper ? 1.05 : isRally ? 1.1 : 0.92));
  const tireCompound: TireCompound = isRally ? 'rally' : isHyper || pi > 760 ? 'semiSlick' : pi > 620 ? 'sport' : 'street';
  const springLimits = estimateSpringLimits(weightKg, isRally || surface === 'rally');

  return sanitizeVehicleForFH6({
    ...current,
    selectedCarId: car.id,
    carName: car.name,
    make: car.make,
    carType: car.type,
    sourcePi: car.pi,
    buildPi: car.pi,
    country: car.country,
    collection: car.collection,
    addOns: car.addOns,
    carClass: car.carClass,
    drivetrain,
    surface,
    tireCompound,
    horsepower,
    torqueNm,
    weightKg,
    frontWeightPercent: drivetrain === 'FWD' ? 60 : drivetrain === 'AWD' ? 52 : 49,
    frontTireWidth: isHyper ? 295 : isRally ? 255 : 245,
    rearTireWidth: drivetrain === 'RWD' || isHyper ? 315 : isRally ? 255 : 265,
    gearCount: isHyper || pi > 700 ? 7 : 6,
    rideHeightMin: isRally ? 13 : 8,
    rideHeightMax: isRally ? 28 : 18,
    rideHeightMinFront: isRally ? 13 : 8,
    rideHeightMaxFront: isRally ? 28 : 18,
    rideHeightMinRear: isRally ? 13 : 8,
    rideHeightMaxRear: isRally ? 28 : 18,
    springRateMinFront: springLimits.min,
    springRateMaxFront: springLimits.max,
    springRateMinRear: springLimits.min,
    springRateMaxRear: springLimits.max,
    frontAero: isHyper || type.includes('track') || pi > 700,
    rearAero: isHyper || type.includes('track') || pi > 650,
    frontAeroMinLb: 0,
    frontAeroMaxLb: 0,
    rearAeroMinLb: 0,
    rearAeroMaxLb: 0,
    specSource: 'estimated',
    upgrades: defaultUpgradeSelections,
  });
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function numberInputValue(value: number) {
  return Number.isFinite(value) ? String(value) : '';
}

function clampInputValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseNumberInput(value: string) {
  return Number(value.trim().replace(',', '.'));
}

function numberInputMode(step: number) {
  return Number.isInteger(step) ? 'numeric' : 'decimal';
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  hint,
  invalid,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  invalid?: boolean;
  onChange: (value: number) => void;
}) {
  const formattedValue = numberInputValue(value);
  const [draftValue, setDraftValue] = useState(formattedValue);
  const [isEditing, setIsEditing] = useState(false);

  const commitValue = (rawValue: string) => {
    const parsedValue = parseNumberInput(rawValue);

    if (rawValue.trim() === '' || !Number.isFinite(parsedValue)) {
      setDraftValue(formattedValue);
      return;
    }

    const nextValue = clampInputValue(parsedValue, min, max);
    setDraftValue(numberInputValue(nextValue));
    onChange(nextValue);
  };

  return (
    <label className={className('field', invalid && 'invalid')}>
      <span>{label}</span>
      <div className="numberInput">
        <input
          aria-invalid={invalid ? 'true' : undefined}
          inputMode={numberInputMode(step)}
          pattern="-?[0-9]*[.,]?[0-9]*"
          type="text"
          value={isEditing ? draftValue : formattedValue}
          onFocus={(event) => {
            const input = event.currentTarget;
            setIsEditing(true);
            setDraftValue(formattedValue);
            window.requestAnimationFrame(() => input.select());
          }}
          onMouseUp={(event) => event.preventDefault()}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={(event) => {
            commitValue(event.target.value);
            setIsEditing(false);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
              event.preventDefault();
              event.currentTarget.select();
              return;
            }

            if (event.key === 'Enter') {
              event.preventDefault();
              commitValue(event.currentTarget.value);
              event.currentTarget.blur();
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              setDraftValue(formattedValue);
              setIsEditing(false);
              event.currentTarget.blur();
            }
          }}
        />
        {unit ? <em>{unit}</em> : null}
      </div>
      {hint ? <small className="fieldHint">{hint}</small> : null}
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggleField">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmentedGroup">
      <span>{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            className={className('segment', option.value === value && 'active')}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsChoiceRow<T extends string | boolean>({
  id,
  label,
  options,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  id: string;
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  open: boolean;
  onOpenChange: (id: string | null) => void;
  onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const menuId = `${id}-settings-options`;

  return (
    <div className={className('settingsChoiceRow', open && 'open')}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        className="settingsChoiceTrigger"
        type="button"
        onClick={() => onOpenChange(open ? null : id)}
      >
        <span>{label}</span>
        <strong>{selected?.label}</strong>
        <ChevronDown size={16} />
      </button>

      {open ? (
        <div className="settingsChoiceMenu" id={menuId}>
          {options.map((option) => (
            <button
              className={className('settingsChoiceOption', option.value === value && 'active')}
              key={String(option.value)}
              type="button"
              onClick={() => {
                onChange(option.value);
                onOpenChange(null);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={15} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SliderControl({
  label,
  value,
  scale,
  onChange,
}: {
  label: string;
  value: number;
  scale: { left: string; right: string };
  onChange: (value: number) => void;
}) {
  return (
    <label className="sliderControl">
      <span className="sliderTop">
        <b>{label}</b>
        <em>{value > 0 ? `+${value}` : value}</em>
      </span>
      <input min={-FEEL_INTENT_LIMIT} max={FEEL_INTENT_LIMIT} step={1} type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="sliderScale">
        <small>{scale.left}</small>
        <small>{scale.right}</small>
      </span>
    </label>
  );
}

function PiBadge({ pi, carClass }: { pi?: number; carClass: CarClass }) {
  const hasPi = typeof pi === 'number';

  return (
    <span className={className('piBadge', piToneClass(carClass), !hasPi && 'classOnly')}>
      <span className="piClass">{carClass}</span>
      {hasPi && <span className="piScore">{pi}</span>}
    </span>
  );
}

function Stat({ label, value, accent, className: statClassName }: { label: string; value: ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={className('stat', accent && 'accent', statClassName)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function displayLimit(value: number, kind: MeasurementKind, unitSystem: UnitSystem) {
  return displayMeasurementValue(value, kind, unitSystem);
}

function displayStep(value: number, kind: MeasurementKind, unitSystem: UnitSystem) {
  return Math.max(measurementStep(kind, unitSystem), displayMeasurementValue(value, kind, unitSystem));
}

function limitHint(min: number, max: number, unit?: string) {
  return unit ? `${min}-${max} ${unit}` : `${min}-${max}`;
}

function targetSpeedUnit(unitSystem: UnitSystem) {
  return unitSystem === 'imperial' ? 'mph' : 'km/h';
}

function displayTargetSpeed(value: number | undefined, unitSystem: UnitSystem) {
  const safeValue = Number.isFinite(value) ? value ?? 0 : 0;
  return unitSystem === 'imperial' ? Math.round(safeValue / KMH_PER_MPH) : Math.round(safeValue);
}

function canonicalTargetSpeed(value: number, unitSystem: UnitSystem) {
  return unitSystem === 'imperial' ? value * KMH_PER_MPH : value;
}

function normalizeIntent(intent?: Partial<TuningIntent>): TuningIntent {
  return {
    ...defaultIntent,
    ...intent,
    rotation: Math.round(Math.min(FEEL_INTENT_LIMIT, Math.max(-FEEL_INTENT_LIMIT, intent?.rotation ?? defaultIntent.rotation))),
    stability: Math.round(Math.min(FEEL_INTENT_LIMIT, Math.max(-FEEL_INTENT_LIMIT, intent?.stability ?? defaultIntent.stability))),
    speedBias: Math.round(Math.min(FEEL_INTENT_LIMIT, Math.max(-FEEL_INTENT_LIMIT, intent?.speedBias ?? defaultIntent.speedBias))),
    compliance: Math.round(Math.min(FEEL_INTENT_LIMIT, Math.max(-FEEL_INTENT_LIMIT, intent?.compliance ?? defaultIntent.compliance))),
    targetTopSpeedKmh: Math.min(TARGET_TOP_SPEED_MAX_KMH, Math.max(0, intent?.targetTopSpeedKmh ?? defaultIntent.targetTopSpeedKmh ?? 0)),
  };
}

function verifiedBaseFromVehicle(vehicle: VehicleInput): VehicleInput {
  return sanitizeVehicleForFH6({
    ...vehicle,
    sourcePi: vehicle.buildPi,
    specSource: 'manual',
    upgrades: defaultUpgradeSelections,
  });
}

function classRank(carClass: CarClass) {
  const rank = carClasses.indexOf(carClass);
  return rank >= 0 ? rank : 0;
}

function reachableTargetClassesForVehicle(vehicle: VehicleInput, reach?: VerifiedVehicleReach) {
  const currentClass = classFromPi(vehicle.buildPi);

  if (!reach) {
    return [currentClass];
  }

  const start = classRank(currentClass);
  const end = Math.max(start, classRank(reach.maxClass));

  return carClasses.slice(start, end + 1);
}

function targetRangeForReach(carClass: CarClass, reach?: VerifiedVehicleReach, currentPi = classPiRanges[carClass].min) {
  if (!reach) {
    return { min: currentPi, max: currentPi };
  }

  const range = classPiRanges[carClass];
  if (carClass !== reach.maxClass) {
    return range;
  }

  const max = Math.min(range.max, Math.max(range.min, reach.maxPi));
  return { min: range.min, max };
}

function closestReachableTargetClass(preferredClass: CarClass, reachableClasses: CarClass[], fallbackClass: CarClass) {
  if (reachableClasses.includes(preferredClass)) {
    return preferredClass;
  }

  const preferredIndex = carClasses.indexOf(preferredClass);

  for (let index = preferredIndex - 1; index >= 0; index -= 1) {
    if (reachableClasses.includes(carClasses[index])) {
      return carClasses[index];
    }
  }

  for (let index = preferredIndex + 1; index < carClasses.length; index += 1) {
    if (reachableClasses.includes(carClasses[index])) {
      return carClasses[index];
    }
  }

  return fallbackClass;
}

function App() {
  const [activeView, setActiveView] = useState<AppView>('garage');
  const [activeTunePanel, setActiveTunePanel] = useState<TunePanel>('build');
  const [activeDataHubPanel, setActiveDataHubPanel] = useState<DataHubPanel>('capture');
  const [buildAssistantStyle, setBuildAssistantStyle] = useState<BuildAssistantStyle>('balanced');
  const [vehicle, setVehicle] = useState<VehicleInput>(() => normalizeVehicle(defaultVehicle));
  const [intent, setIntent] = useState<TuningIntent>(() => normalizeIntent(defaultIntent));
  const [profiles, setProfiles] = useState<SavedProfile[]>(() => loadProfiles());
  const [verifiedSnapshots, setVerifiedSnapshots] = useState<Record<string, VerifiedVehicleSnapshot>>(() => loadVerifiedSnapshots());
  const [verifiedReach, setVerifiedReach] = useState<Record<string, VerifiedVehicleReach>>(() => loadVerifiedReach());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaveState, setSettingsSaveState] = useState<'saved' | 'defaults' | null>(null);
  const [openSettingId, setOpenSettingId] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateViewState>('idle');
  const [updateInstallState, setUpdateInstallState] = useState<UpdateInstallState>('idle');
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState('');
  const [advisorTargetClass, setAdvisorTargetClass] = useState<CarClass>('A');
  const [advisorTargetPi, setAdvisorTargetPi] = useState(700);
  const [reachTargetClass, setReachTargetClass] = useState<CarClass>(() => classFromPi(defaultVehicle.buildPi));
  const [reachTargetPi, setReachTargetPi] = useState(() => defaultVehicle.buildPi);
  const [searchTerm, setSearchTerm] = useState('');
  const [classFilter, setClassFilter] = useState<CarClass | 'ALL'>('ALL');
  const [pendingCarId, setPendingCarId] = useState(() => normalizeVehicle(defaultVehicle).selectedCarId);
  const [copied, setCopied] = useState(false);
  const [dataSaveNotice, setDataSaveNotice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const dataSaveNoticeTimerRef = useRef<number | null>(null);
  const persistFH6DataStore = (
    nextSnapshots: Record<string, VerifiedVehicleSnapshot>,
    nextReach: Record<string, VerifiedVehicleReach>,
  ) => {
    saveVerifiedSnapshots(nextSnapshots);
    saveVerifiedReach(nextReach);

    if (window.forzaDesktop?.saveFH6Data) {
      void window.forzaDesktop.saveFH6Data(createFH6DataStore(nextSnapshots, nextReach)).then((result) => {
        if (!result.ok) {
          console.warn('FH6 data file save failed:', result.error);
        }
      }).catch((error) => {
        console.warn('FH6 data file save failed:', error);
      });
    }
  };

  useEffect(() => {
    const desktop = window.forzaDesktop;

    if (!desktop?.loadFH6Data || !desktop.saveFH6Data) {
      return undefined;
    }

    let cancelled = false;

    const loadDesktopFH6Data = async () => {
      const localStore = createFH6DataStore(loadVerifiedSnapshots(), loadVerifiedReach());

      try {
        const result = await desktop.loadFH6Data?.();

        if (cancelled || !result) {
          return;
        }

        if (!result.ok) {
          console.warn('FH6 data file load failed:', result.error);
          return;
        }

        const desktopStore = normalizeFH6DataStore(result.data ?? null);
        const desktopHasData = hasFH6DataStoreEntries(desktopStore);
        const localHasData = hasFH6DataStoreEntries(localStore);
        const nextStore = desktopHasData ? desktopStore : localStore;

        if (!hasFH6DataStoreEntries(nextStore)) {
          return;
        }

        setVerifiedSnapshots(nextStore.verifiedSnapshots);
        setVerifiedReach(nextStore.verifiedReach);
        saveVerifiedSnapshots(nextStore.verifiedSnapshots);
        saveVerifiedReach(nextStore.verifiedReach);

        if (!desktopHasData && localHasData) {
          const saveResult = await desktop.saveFH6Data?.(nextStore);

          if (saveResult && !saveResult.ok) {
            console.warn('FH6 data migration save failed:', saveResult.error);
          }
        }
      } catch (error) {
        console.warn('FH6 data file load failed:', error);
      }
    };

    void loadDesktopFH6Data();

    return () => {
      cancelled = true;
    };
  }, []);

  const copy = getUiText(settings.language);
  const surfaceChoices = useMemo(
    () => surfaceOptions.map((option) => ({ ...option, label: copy.surfaces[option.value] })),
    [copy],
  );
  const tireChoices = useMemo(
    () => tireOptions.map((option) => ({ ...option, label: copy.tires[option.value] })),
    [copy],
  );
  const unitChoices = useMemo(
    () => [
      { value: 'metric' as const, label: copy.settings.metric },
      { value: 'imperial' as const, label: copy.settings.imperial },
    ],
    [copy],
  );
  const uiDensityChoices = useMemo(
    () => [
      { value: 'comfortable' as const, label: copy.settings.uiDensityOptions.comfortable },
      { value: 'compact' as const, label: copy.settings.uiDensityOptions.compact },
    ],
    [copy],
  );
  const garageDensityChoices = useMemo(
    () => [
      { value: 'comfortable' as const, label: copy.settings.garageDensityOptions.comfortable },
      { value: 'compact' as const, label: copy.settings.garageDensityOptions.compact },
    ],
    [copy],
  );
  const binaryChoices = useMemo(
    () => [
      { value: true, label: copy.settings.enabled },
      { value: false, label: copy.settings.disabled },
    ],
    [copy],
  );
  const tuneStrictnessChoices = useMemo(
    () => [
      { value: 'balanced' as const, label: copy.settings.tuneStrictnessOptions.balanced },
      { value: 'aggressive' as const, label: copy.settings.tuneStrictnessOptions.aggressive },
      { value: 'max' as const, label: copy.settings.tuneStrictnessOptions.max },
    ],
    [copy],
  );
  const buildAssistantStyleChoices = useMemo(
    () => buildAssistantStyles.map((value) => ({ value, label: copy.tune.buildStyleOptions[value] })),
    [copy],
  );
  const upgradePowerChoices = useMemo(
    () => [
      { value: 'stock' as const, label: copy.tune.upgradeOptions.stock },
      { value: 'street' as const, label: copy.tune.upgradeOptions.street },
      { value: 'sport' as const, label: copy.tune.upgradeOptions.sport },
      { value: 'race' as const, label: copy.tune.upgradeOptions.race },
    ],
    [copy],
  );
  const upgradeWeightChoices = upgradePowerChoices;
  const upgradeWidthChoices = useMemo(
    () => [
      { value: 'stock' as const, label: copy.tune.upgradeOptions.stock },
      { value: 'street' as const, label: copy.tune.upgradeOptions.widthStreet },
      { value: 'sport' as const, label: copy.tune.upgradeOptions.widthSport },
      { value: 'race' as const, label: copy.tune.upgradeOptions.widthRace },
    ],
    [copy],
  );
  const drivetrainUpgradeChoices = useMemo(
    () => [
      { value: 'stock' as const, label: copy.tune.upgradeOptions.stock },
      { value: 'FWD' as const, label: 'FWD' },
      { value: 'RWD' as const, label: 'RWD' },
      { value: 'AWD' as const, label: 'AWD' },
    ],
    [copy],
  );
  const aeroUpgradeChoices = useMemo(
    () => [
      { value: 'stock' as const, label: copy.tune.upgradeOptions.stock },
      { value: 'front' as const, label: copy.tune.upgradeOptions.front },
      { value: 'rear' as const, label: copy.tune.upgradeOptions.rear },
      { value: 'race' as const, label: copy.tune.upgradeOptions.race },
    ],
    [copy],
  );
  const transmissionUpgradeChoices = useMemo(
    () => [
      { value: 'stock' as const, label: copy.tune.upgradeOptions.stock },
      { value: 'sport' as const, label: copy.tune.upgradeOptions.sport },
      { value: 'race' as const, label: copy.tune.upgradeOptions.race },
      { value: 'drift4' as const, label: copy.tune.upgradeOptions.drift4 },
    ],
    [copy],
  );
  const suspensionUpgradeChoices = useMemo(
    () => [
      { value: 'stock' as const, label: copy.tune.upgradeOptions.stock },
      { value: 'sport' as const, label: copy.tune.upgradeOptions.sport },
      { value: 'race' as const, label: copy.tune.upgradeOptions.race },
      { value: 'rally' as const, label: copy.tune.upgradeOptions.rally },
      { value: 'drift' as const, label: copy.tune.upgradeOptions.drift },
    ],
    [copy],
  );
  const adjustableUpgradeChoices = useMemo(
    () => [
      { value: 'stock' as const, label: copy.tune.upgradeOptions.stock },
      { value: 'race' as const, label: copy.tune.upgradeOptions.race },
    ],
    [copy],
  );
  const differentialUpgradeChoices = useMemo(
    () => [
      { value: 'stock' as const, label: copy.tune.upgradeOptions.stock },
      { value: 'race' as const, label: copy.tune.upgradeOptions.race },
      { value: 'drift' as const, label: copy.tune.upgradeOptions.drift },
    ],
    [copy],
  );

  const selectedCar = useMemo(() => findFH6CarById(vehicle.selectedCarId), [vehicle.selectedCarId]);
  const pendingCar = useMemo(() => findFH6CarById(pendingCarId) ?? selectedCar, [pendingCarId, selectedCar]);
  const pendingCarIsCurrent = pendingCar?.id === vehicle.selectedCarId;
  const verifiedSnapshot = verifiedSnapshots[vehicle.selectedCarId];
  const verifiedReachRecord = verifiedReach[vehicle.selectedCarId];
  const upgrades = useMemo(() => normalizeUpgradeSelections(vehicle.upgrades), [vehicle.upgrades]);
  const result = useMemo(() => calculateTune(vehicle, intent, settings.unitSystem, settings.tuneStrictness), [vehicle, intent, settings.unitSystem, settings.tuneStrictness]);
  const displayResult = useMemo(() => localizeTuneResult(result, vehicle, intent, settings.language), [intent, result, settings.language, vehicle]);
  const baseVehicleForUpgrades = useCallback(
    (current: VehicleInput) => {
      if (current.specSource === 'manual' || current.specSource === 'imported') {
        return verifiedBaseFromVehicle(current);
      }

      const snapshot = verifiedSnapshots[current.selectedCarId];
      if (snapshot) {
        return verifiedBaseFromVehicle(normalizeVehicle(snapshot.vehicle));
      }

      const baseCar = findFH6CarById(current.selectedCarId);
      return baseCar
        ? estimateVehicleFromCar(baseCar, normalizeVehicle({ ...current, upgrades: defaultUpgradeSelections }), settings.defaultSurface)
        : normalizeVehicle({ ...current, upgrades: defaultUpgradeSelections });
    },
    [settings.defaultSurface, verifiedSnapshots],
  );
  const advisorBaseVehicle = useMemo(() => baseVehicleForUpgrades(vehicle), [baseVehicleForUpgrades, vehicle]);
  const advisorClassChoices = useMemo(() => {
    const reachableClasses = reachableTargetClassesForVehicle(vehicle, verifiedReachRecord);
    return reachableClasses.map((item) => ({ value: item, label: item }));
  }, [vehicle, verifiedReachRecord]);
  const advisorAvailableClasses = advisorClassChoices.map((option) => option.value);
  const activeAdvisorTargetClass = closestReachableTargetClass(advisorTargetClass, advisorAvailableClasses, classFromPi(vehicle.buildPi));
  const activeAdvisorTargetRange = targetRangeForReach(activeAdvisorTargetClass, verifiedReachRecord, vehicle.buildPi);
  const activeAdvisorTargetPi = advisorTargetPi >= activeAdvisorTargetRange.min && advisorTargetPi <= activeAdvisorTargetRange.max ? advisorTargetPi : activeAdvisorTargetRange.max;
  const advisorRecommendation = recommendUpgradeBuild(advisorBaseVehicle, activeAdvisorTargetPi, upgrades);

  const filteredCars = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return fh6Cars
      .filter((car) => classFilter === 'ALL' || car.carClass === classFilter)
      .filter((car) => {
        if (!query) {
          return true;
        }

        return [car.make, car.name, car.type, car.country, car.collection].some((value) => value.toLowerCase().includes(query));
      });
  }, [classFilter, searchTerm]);

  const updateVehicle = <Key extends keyof VehicleInput>(key: Key, value: VehicleInput[Key]) => {
    setVehicle((current) => {
      const next = sanitizeVehicleForFH6({
        ...current,
        [key]: value,
        specSource: FH6_INGAME_SPEC_KEYS.has(key) ? 'manual' : current.specSource,
      });
      return next;
    });
  };

  const applyUpgradesFromBase = (current: VehicleInput, upgrades: UpgradeSelections) => {
    const baseVehicle = baseVehicleForUpgrades(current);

    return applyUpgradeSelections(
      {
        ...baseVehicle,
        carName: current.carName,
        surface: current.surface,
        upgrades,
      },
      upgrades,
    );
  };

  const updateUpgrade = <Key extends keyof UpgradeSelections>(key: Key, value: UpgradeSelections[Key]) => {
    setVehicle((current) => {
      const upgrades = normalizeUpgradeSelections({ ...current.upgrades, [key]: value });
      return applyUpgradesFromBase(current, upgrades);
    });
  };

  const resetUpgrades = () => {
    setVehicle((current) => applyUpgradesFromBase(current, defaultUpgradeSelections));
  };

  const applyAdvisorRecommendation = () => {
    if (!verifiedReachRecord) {
      return;
    }

    setVehicle((current) => applyUpgradesFromBase(current, advisorRecommendation.upgrades));
  };

  const updateAdvisorTargetClass = (carClass: CarClass) => {
    setAdvisorTargetClass(carClass);
    setAdvisorTargetPi(targetRangeForReach(carClass, verifiedReachRecord, vehicle.buildPi).max);
  };

  const updateReachTargetClass = (carClass: CarClass) => {
    setReachTargetClass(carClass);
    setReachTargetPi(classPiRanges[carClass].max);
  };

  const syncReachDraftForVehicle = (nextVehicle: VehicleInput) => {
    const reach = verifiedReach[nextVehicle.selectedCarId];
    const fallbackClass = classFromPi(nextVehicle.buildPi);
    setReachTargetClass(reach?.maxClass ?? fallbackClass);
    setReachTargetPi(reach?.maxPi ?? nextVehicle.buildPi);
    setAdvisorTargetClass(reach?.maxClass ?? fallbackClass);
    setAdvisorTargetPi(reach?.maxPi ?? nextVehicle.buildPi);
  };

  const updateIntent = <Key extends keyof TuningIntent>(key: Key, value: TuningIntent[Key]) => {
    setIntent((current) => normalizeIntent({ ...current, [key]: value }));
  };

  const updateSettings = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      return next;
    });
    setSettingsDirty(true);
    setSettingsSaveState(null);
  };

  const saveAppSettings = () => {
    saveSettings(settings);
    setSettingsDirty(false);
    setSettingsSaveState('saved');
    setOpenSettingId(null);
  };

  const resetAppSettings = () => {
    const nextSettings = { ...defaultSettings };
    setSettings(nextSettings);
    saveSettings(nextSettings);
    setSettingsDirty(false);
    setSettingsSaveState('defaults');
    setOpenSettingId(null);
  };

  const applyCar = (car: FH6Car) => {
    setPendingCarId(car.id);
    const snapshot = verifiedSnapshots[car.id];
    const nextVehicle = snapshot ? normalizeVehicle(snapshot.vehicle) : estimateVehicleFromCar(car, normalizeVehicle(vehicle), settings.defaultSurface);
    syncReachDraftForVehicle(nextVehicle);
    setVehicle(nextVehicle);
    setActiveView('tune');
  };

  const commitProfiles = (nextProfiles: SavedProfile[]) => {
    setProfiles(nextProfiles);
    saveProfiles(nextProfiles);
  };

  const commitVerifiedSnapshots = (nextSnapshots: Record<string, VerifiedVehicleSnapshot>) => {
    setVerifiedSnapshots(nextSnapshots);
    persistFH6DataStore(nextSnapshots, verifiedReach);
  };

  const commitVerifiedReach = (nextReach: Record<string, VerifiedVehicleReach>) => {
    setVerifiedReach(nextReach);
    persistFH6DataStore(verifiedSnapshots, nextReach);
  };

  const showDataSaveNotice = () => {
    setDataSaveNotice(true);

    if (dataSaveNoticeTimerRef.current) {
      window.clearTimeout(dataSaveNoticeTimerRef.current);
    }

    dataSaveNoticeTimerRef.current = window.setTimeout(() => {
      setDataSaveNotice(false);
      dataSaveNoticeTimerRef.current = null;
    }, 2600);
  };

  const loadVerifiedSnapshotRecord = (snapshot: VerifiedVehicleSnapshot, panel: TunePanel = 'build') => {
    const nextVehicle = normalizeVehicle(snapshot.vehicle);
    setVehicle(nextVehicle);
    setPendingCarId(snapshot.carId);
    syncReachDraftForVehicle(nextVehicle);
    setActiveTunePanel(panel);
    setActiveView('tune');
  };

  const editVerifiedSnapshotRecord = (snapshot: VerifiedVehicleSnapshot) => {
    const nextVehicle = normalizeVehicle(snapshot.vehicle);
    setVehicle(nextVehicle);
    setPendingCarId(snapshot.carId);
    syncReachDraftForVehicle(nextVehicle);
    setDataSaveNotice(false);
    setActiveDataHubPanel('editor');
    setActiveView('fh6Data');
  };

  const deleteVerifiedSnapshotByCarId = (carId: string) => {
    const nextSnapshots = { ...verifiedSnapshots };
    delete nextSnapshots[carId];
    commitVerifiedSnapshots(nextSnapshots);
  };

  const saveVerifiedSnapshot = () => {
    const safeVehicle = verifiedBaseFromVehicle(vehicle);
    const snapshot: VerifiedVehicleSnapshot = {
      id: crypto.randomUUID(),
      carId: safeVehicle.selectedCarId,
      carName: safeVehicle.carName,
      savedAt: new Date().toISOString(),
      vehicle: safeVehicle,
    };

    setVehicle(safeVehicle);
    commitVerifiedSnapshots({
      ...verifiedSnapshots,
      [safeVehicle.selectedCarId]: snapshot,
    });
    showDataSaveNotice();
  };

  const loadVerifiedSnapshot = () => {
    if (!verifiedSnapshot) {
      return;
    }

    loadVerifiedSnapshotRecord(verifiedSnapshot, 'build');
  };

  const saveVerifiedReachRecord = () => {
    const range = classPiRanges[reachTargetClass];
    const maxPi = Math.min(range.max, Math.max(range.min, reachTargetPi));
    const reach: VerifiedVehicleReach = {
      id: crypto.randomUUID(),
      carId: vehicle.selectedCarId,
      carName: vehicle.carName,
      savedAt: new Date().toISOString(),
      maxClass: reachTargetClass,
      maxPi,
    };

    commitVerifiedReach({
      ...verifiedReach,
      [vehicle.selectedCarId]: reach,
    });
    setAdvisorTargetClass(reach.maxClass);
    setAdvisorTargetPi(reach.maxPi);
  };

  const deleteVerifiedReachRecord = () => {
    if (!verifiedReachRecord) {
      return;
    }

    const nextReach = { ...verifiedReach };
    delete nextReach[vehicle.selectedCarId];
    commitVerifiedReach(nextReach);
    const currentClass = classFromPi(vehicle.buildPi);
    setReachTargetClass(currentClass);
    setReachTargetPi(vehicle.buildPi);
    setAdvisorTargetClass(currentClass);
    setAdvisorTargetPi(vehicle.buildPi);
  };

  const saveCurrentProfile = () => {
    const safeVehicle = sanitizeVehicleForFH6(vehicle);
    const profile: SavedProfile = {
      id: crypto.randomUUID(),
      name: safeVehicle.carName.trim() || 'Unbenanntes Setup',
      createdAt: new Date().toISOString(),
      vehicle: safeVehicle,
      intent: normalizeIntent(intent),
    };

    commitProfiles([profile, ...profiles].slice(0, 18));
  };

  const deleteProfile = (id: string) => {
    commitProfiles(profiles.filter((profile) => profile.id !== id));
  };

  const loadProfile = (profile: SavedProfile) => {
    const nextVehicle = normalizeVehicle(profile.vehicle);
    setPendingCarId(nextVehicle.selectedCarId);
    setVehicle(nextVehicle);
    syncReachDraftForVehicle(nextVehicle);
    setIntent(normalizeIntent(profile.intent));
    setActiveView('tune');
  };

  const runUpdateCheck = useCallback(async () => {
    setUpdateState('checking');
    setUpdateError('');
    setUpdateInstallState('idle');

    try {
      const result = await checkForUpdates(APP_VERSION);
      setUpdateResult(result);
      setUpdateState(result.status);
    } catch (error) {
      setUpdateState('failed');
      setUpdateError(error instanceof Error ? error.message : 'Unknown update check error');
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!updateResult?.setupDownloadUrl) {
      setUpdateInstallState('failed');
      setUpdateError(copy.updates.noSetupAsset);
      return;
    }

    const fileName = updateResult.setupFileName || `FH6 TuneLab Setup ${updateResult.latestVersion}.exe`;
    setUpdateInstallState('downloading');
    setUpdateError('');

    try {
      if (window.forzaDesktop?.installUpdate) {
        const result = await window.forzaDesktop.installUpdate({
          url: updateResult.setupDownloadUrl,
          fileName,
        });

        if (result.skipped) {
          setUpdateInstallState('skipped');
          return;
        }

        if (!result.ok) {
          throw new Error(result.error || 'Update install failed');
        }

        setUpdateInstallState('started');
        return;
      }

      window.open(updateResult.setupDownloadUrl, '_blank', 'noopener,noreferrer');
      setUpdateInstallState('started');
    } catch (error) {
      setUpdateInstallState('failed');
      setUpdateError(error instanceof Error ? error.message : 'Update install failed');
    }
  }, [copy.updates.noSetupAsset, updateResult]);

  const copyTune = async () => {
    await navigator.clipboard.writeText(formatTuneForClipboard(vehicle, displayResult, settings.language, settings.unitSystem));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const exportTune = () => {
    const safeVehicle = sanitizeVehicleForFH6(vehicle);
    const payload = {
      exportedAt: new Date().toISOString(),
      app: APP_NAME,
      appVersion: APP_VERSION,
      dataSource: FH6_CAR_DATA_SOURCE,
      unitSystem: settings.unitSystem,
      vehicle: safeVehicle,
      intent: normalizeIntent(intent),
      result: displayResult,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeVehicle.carName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'fh6-tune'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importTune = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.vehicle && parsed.intent) {
          const importedVehicle = parsed.vehicle as Partial<VehicleInput>;
          const nextVehicle = normalizeVehicle({ ...importedVehicle, specSource: importedVehicle.specSource ?? 'imported' });
          setPendingCarId(nextVehicle.selectedCarId);
          setVehicle(nextVehicle);
          syncReachDraftForVehicle(nextVehicle);
          setIntent(normalizeIntent(parsed.intent));
          setActiveView('tune');
        }
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const powerToWeight = powerToWeightValue(vehicle, settings.unitSystem);
  const powerToWeightUnit = getPowerToWeightLabel(settings.unitSystem);
  const rearWeight = 100 - vehicle.frontWeightPercent;
  const tireSection = displayResult.sections.find((section) => section.id === 'tires');
  const chassisSection = displayResult.sections.find((section) => section.id === 'chassis');
  const diffSection = displayResult.sections.find((section) => section.id === 'diff');
  const gearingSection = displayResult.sections.find((section) => section.id === 'gearing');
  const frontPressure = tireSection?.values[0]?.value ?? '-';
  const rearPressure = tireSection?.values[1]?.value ?? '-';
  const frontSpring = chassisSection?.values.find((item) => item.label.includes('Feder V') || item.label.includes('Spring F'))?.value ?? '-';
  const rearSpring = chassisSection?.values.find((item) => item.label.includes('Feder H') || item.label.includes('Spring R'))?.value ?? '-';
  const rearAccel = diffSection?.values.find((item) => item.label.includes('Rear Accel'))?.value ?? diffSection?.values[0]?.value ?? '-';
  const fullGearCount = Math.max(0, (gearingSection?.values.length ?? 1) - 1);
  const springFrontSpan = Math.abs(vehicle.springRateMaxFront - vehicle.springRateMinFront);
  const springRearSpan = Math.abs(vehicle.springRateMaxRear - vehicle.springRateMinRear);
  const aeroRangeOk =
    (!vehicle.frontAero || vehicle.frontAeroMinLb < vehicle.frontAeroMaxLb) &&
    (!vehicle.rearAero || vehicle.rearAeroMinLb < vehicle.rearAeroMaxLb);
  const isLooseSurface = vehicle.surface === 'rally' || vehicle.surface === 'wet';
  const tireFitsSurface =
    vehicle.surface === 'rally'
      ? vehicle.tireCompound === 'rally' || vehicle.tireCompound === 'offroad' || vehicle.tireCompound === 'snow'
      : vehicle.surface === 'road' || vehicle.surface === 'street'
        ? vehicle.tireCompound !== 'offroad' && vehicle.tireCompound !== 'snow'
        : true;
  const fh6InputCompatible = isVehicleFH6Compatible(vehicle);
  const rideRangeOk =
    vehicle.rideHeightMinFront < vehicle.rideHeightMaxFront && vehicle.rideHeightMinRear < vehicle.rideHeightMaxRear;
  const springRangeOk = vehicle.springRateMinFront < vehicle.springRateMaxFront && vehicle.springRateMinRear < vehicle.springRateMaxRear;
  const captureWizardSteps = [
    {
      index: 1,
      title: copy.dataHub.captureVehicleCard,
      detail: copy.dataHub.captureVehicleCardNote,
      status: vehicle.buildPi > 0 && vehicle.horsepower > 0 && vehicle.torqueNm > 0 && vehicle.weightKg > 0 ? 'ready' : 'todo',
    },
    {
      index: 2,
      title: copy.dataHub.captureHardware,
      detail: copy.dataHub.captureHardwareNote,
      status: vehicle.frontTireWidth > 0 && vehicle.rearTireWidth > 0 && vehicle.gearCount > 0 ? 'ready' : 'todo',
    },
    {
      index: 3,
      title: copy.dataHub.captureSuspension,
      detail: copy.dataHub.captureSuspensionNote,
      status: rideRangeOk && springRangeOk ? 'ready' : 'optional',
    },
    {
      index: 4,
      title: copy.dataHub.captureAero,
      detail: copy.dataHub.captureAeroNote,
      status: aeroRangeOk ? 'ready' : 'optional',
    },
    {
      index: 5,
      title: copy.dataHub.captureSave,
      detail: copy.dataHub.captureSaveNote,
      status: verifiedSnapshot ? 'ready' : 'todo',
    },
  ] as const;
  const tireStepOk = vehicle.frontTireWidth % FH6_LIMITS.frontTireWidth.step === 0 && vehicle.rearTireWidth % FH6_LIMITS.rearTireWidth.step === 0;
  const specSourceLabel = copy.tune.specSources[vehicle.specSource];
  const strictnessLabel = copy.settings.tuneStrictnessOptions[settings.tuneStrictness];
  const advisorHasVerifiedReach = Boolean(verifiedReachRecord);
  const advisorTargetRange = activeAdvisorTargetRange;
  const advisorSuggestedPi = advisorHasVerifiedReach ? advisorRecommendation.buildPi : vehicle.buildPi;
  const advisorSuggestedClass = classFromPi(advisorSuggestedPi);
  const advisorVisibleChanges = advisorHasVerifiedReach ? advisorRecommendation.changes : [];
  const advisorCanSuggest = advisorHasVerifiedReach && advisorVisibleChanges.length > 0;
  const advisorStatusText = !advisorHasVerifiedReach
    ? copy.tune.reachDataMissing
    : advisorRecommendation.isAboveTarget
    ? copy.tune.advisorAboveTarget
    : advisorRecommendation.gap === 0
      ? copy.tune.advisorOnTarget
      : `${advisorRecommendation.gap} ${copy.tune.advisorPiLeft}`;
  const advisorStatusHint = advisorHasVerifiedReach ? copy.tune.advisorEstimate : copy.tune.reachDataRequired;
  const advisorFieldLabels: Record<keyof UpgradeSelections, string> = {
    power: copy.tune.powerUpgrade,
    weightReduction: copy.tune.weightUpgrade,
    tireCompound: copy.tune.tireUpgrade,
    tireWidth: copy.tune.tireWidthUpgrade,
    drivetrain: copy.tune.drivetrainUpgrade,
    aero: copy.tune.aeroUpgrade,
    transmission: copy.tune.transmissionUpgrade,
    suspension: copy.tune.suspensionUpgrade,
    antiRollBars: copy.tune.antiRollUpgrade,
    brakes: copy.tune.brakeUpgrade,
    differential: copy.tune.differentialUpgrade,
  };
  const advisorTargetLabel = `${activeAdvisorTargetClass} ${activeAdvisorTargetPi}`;
  const advisorUpgradeValueLabel = (key: keyof UpgradeSelections, value: UpgradeSelections[keyof UpgradeSelections]) => {
    if (key === 'tireCompound') return copy.tires[value as TireCompound];
    if (key === 'tireWidth') return upgradeWidthChoices.find((option) => option.value === value)?.label ?? String(value);
    if (key === 'drivetrain') return drivetrainUpgradeChoices.find((option) => option.value === value)?.label ?? String(value);
    if (key === 'aero') return aeroUpgradeChoices.find((option) => option.value === value)?.label ?? String(value);
    if (key === 'transmission') return transmissionUpgradeChoices.find((option) => option.value === value)?.label ?? String(value);
    if (key === 'suspension') return suspensionUpgradeChoices.find((option) => option.value === value)?.label ?? String(value);
    if (key === 'differential') return differentialUpgradeChoices.find((option) => option.value === value)?.label ?? String(value);
    return copy.tune.upgradeOptions[value as keyof typeof copy.tune.upgradeOptions] ?? String(value);
  };
  const advisorInstallOrder = new Map(buildAssistantPriority[buildAssistantStyle].map((key, index) => [key, index]));
  const advisorInstallSteps = [...advisorVisibleChanges].sort((left, right) => {
    const leftOrder = advisorInstallOrder.get(left.key) ?? 99;
    const rightOrder = advisorInstallOrder.get(right.key) ?? 99;
    return leftOrder - rightOrder;
  }).map((change: UpgradeRecommendationChange, index) => {
    const targetLabel = advisorUpgradeValueLabel(change.key, change.to);
    const isPowerStep = change.key === 'power';
    const previewGuard = activeAdvisorTargetClass === 'X' ? '' : ` ${copy.tune.previewPiGuard} ${advisorTargetLabel}.`;

    return {
      key: `${change.key}-${String(change.to)}`,
      index: index + 1,
      title: advisorFieldLabels[change.key],
      shopPath: copy.tune.upgradeShopPaths[change.key],
      target: isPowerStep ? `${copy.tune.installTarget}: ${copy.tune.piLimitedTarget} ${advisorTargetLabel}` : `${copy.tune.installTarget}: ${targetLabel}`,
      transition: isPowerStep ? `${advisorUpgradeValueLabel(change.key, change.from)} -> ${copy.tune.addOnlyUntilTarget}` : `${advisorUpgradeValueLabel(change.key, change.from)} -> ${targetLabel}`,
      note: `${isPowerStep ? copy.tune.powerPiLimitNote : copy.tune.upgradeInstallNotes[change.key]}${previewGuard}`,
    };
  });
  const buildAssistantGap = advisorHasVerifiedReach ? activeAdvisorTargetPi - vehicle.buildPi : 0;
  const buildAssistantPiTolerance = activeAdvisorTargetClass === 'X' ? 0 : 5;
  const buildAssistantInTarget = advisorHasVerifiedReach && vehicle.buildPi <= activeAdvisorTargetPi && vehicle.buildPi >= Math.max(advisorTargetRange.min, activeAdvisorTargetPi - buildAssistantPiTolerance);
  const buildAssistantSteps = buildAssistantPriority[buildAssistantStyle].map((key, index) => {
    const currentValue = upgrades[key];
    const suggestedValue = advisorHasVerifiedReach ? advisorRecommendation.upgrades[key] : currentValue;

    return {
      key,
      index: index + 1,
      label: advisorFieldLabels[key],
      current: advisorUpgradeValueLabel(key, currentValue),
      suggestion: advisorUpgradeValueLabel(key, suggestedValue),
      changed: currentValue !== suggestedValue,
      hint: advisorHasVerifiedReach ? copy.tune.upgradePriorityHints[key] : copy.tune.reachDataRequired,
    };
  });
  const buildAssistantChecks = [
    {
      label: copy.tune.targetPi,
      value: !advisorHasVerifiedReach ? copy.tune.reachDataMissing : buildAssistantInTarget ? copy.tune.readyForTuneLab : buildAssistantGap > 0 ? `${buildAssistantGap} ${copy.tune.advisorPiLeft}` : copy.tune.advisorAboveTarget,
      ok: buildAssistantInTarget,
    },
    {
      label: copy.tune.calibrationSnapshot,
      value: vehicle.specSource === 'manual' || vehicle.specSource === 'imported' ? copy.tune.enteredIngameValues : copy.tune.enterFinalValues,
      ok: vehicle.specSource === 'manual' || vehicle.specSource === 'imported',
    },
    {
      label: copy.tune.transmissionUpgrade,
      value: upgrades.transmission === 'race' || upgrades.transmission === 'drift4' ? advisorUpgradeValueLabel('transmission', upgrades.transmission) : copy.tune.requiresRaceUpgrade,
      ok: upgrades.transmission === 'race' || upgrades.transmission === 'drift4',
    },
    {
      label: copy.tune.suspensionUpgrade,
      value: upgrades.suspension === 'race' || upgrades.suspension === 'rally' || upgrades.suspension === 'drift' ? advisorUpgradeValueLabel('suspension', upgrades.suspension) : copy.tune.requiresAdjustableSetup,
      ok: upgrades.suspension === 'race' || upgrades.suspension === 'rally' || upgrades.suspension === 'drift',
    },
    {
      label: copy.tune.aeroUpgrade,
      value: vehicle.frontAero || vehicle.rearAero ? copy.tune.guardActive : copy.tune.optionalButRecommended,
      ok: vehicle.surface === 'drag' || vehicle.surface === 'drift' || vehicle.frontAero || vehicle.rearAero,
    },
  ];
  const fitItems = [
    { label: copy.tune.inputGuard, value: fh6InputCompatible ? copy.tune.guardActive : copy.tune.guardAdjusted, ok: true },
    ...(settings.showSpecSource ? [{ label: copy.tune.specSource, value: specSourceLabel, ok: vehicle.specSource !== 'estimated' }] : []),
    { label: copy.tune.strictness, value: strictnessLabel, ok: true },
    { label: copy.tune.pressureRange, value: settings.unitSystem === 'metric' ? '1.0-3.8 bar' : '14-55 PSI', ok: true },
    {
      label: copy.tune.rideRange,
      value: `F ${formatMeasurement(vehicle.rideHeightMinFront, 'rideHeight', settings.unitSystem)}-${formatMeasurement(vehicle.rideHeightMaxFront, 'rideHeight', settings.unitSystem)} / R ${formatMeasurement(vehicle.rideHeightMinRear, 'rideHeight', settings.unitSystem)}-${formatMeasurement(vehicle.rideHeightMaxRear, 'rideHeight', settings.unitSystem)}`,
      ok: rideRangeOk,
    },
    {
      label: copy.tune.springRange,
      value: `${displayMeasurementValue(Math.min(springFrontSpan, springRearSpan), 'springRate', settings.unitSystem)}+ ${measurementUnit('springRate', settings.unitSystem)}`,
      ok: springRangeOk && springFrontSpan >= 40 && springRearSpan >= 40,
    },
    { label: copy.tune.tireStep, value: tireStepOk ? `${FH6_LIMITS.frontTireWidth.step} mm` : copy.tune.guardAdjusted, ok: tireStepOk },
    { label: copy.tune.tireMatch, value: tireFitsSurface ? 'OK' : isLooseSurface ? copy.surfaces.rally : copy.surfaces.road, ok: tireFitsSurface },
    { label: copy.tune.gearSet, value: `${fullGearCount}/${vehicle.gearCount}`, ok: fullGearCount === vehicle.gearCount },
  ];
  const fitIssueCount = fitItems.filter((item) => !item.ok).length;
  const fitScore = Math.max(70, 100 - fitIssueCount * 15);
  const settingsStatusText = settingsDirty
    ? copy.settings.unsavedChanges
    : settingsSaveState === 'saved'
      ? copy.settings.settingsSaved
      : settingsSaveState === 'defaults'
        ? copy.settings.defaultsRestored
        : copy.settings.settingsPersisted;
  const updateStatusText =
    updateInstallState === 'downloading'
      ? copy.updates.downloading
      : updateInstallState === 'started'
        ? copy.updates.installStarted
        : updateInstallState === 'skipped'
          ? copy.updates.installSkipped
          : updateState === 'checking'
      ? copy.updates.checking
      : updateState === 'current'
        ? copy.updates.current
        : updateState === 'available'
          ? copy.updates.available
          : updateState === 'failed'
            ? copy.updates.failed
            : copy.updates.notChecked;
  const updateStatusTone =
    updateInstallState === 'started'
      ? 'success'
      : updateInstallState === 'failed'
        ? 'danger'
        : updateState === 'available'
          ? 'warning'
          : updateState === 'failed'
            ? 'danger'
            : updateState === 'current'
              ? 'success'
              : '';
  const updateDetailText =
    updateInstallState === 'downloading'
      ? copy.updates.downloadingHint
      : updateInstallState === 'started'
        ? copy.updates.installStartedHint
        : updateInstallState === 'skipped'
          ? copy.updates.installSkippedHint
          : updateResult?.status === 'available'
            ? copy.updates.installHint
            : copy.updates.githubHint;
  const updateLastChecked = updateResult
    ? new Date(updateResult.checkedAt).toLocaleString(localeByLanguage[settings.language], { dateStyle: 'medium', timeStyle: 'short' })
    : copy.updates.notChecked;
  const updatePublishedAt = updateResult?.publishedAt
    ? new Date(updateResult.publishedAt).toLocaleString(localeByLanguage[settings.language], { dateStyle: 'medium', timeStyle: 'short' })
    : '-';
  const verifiedSavedAt = verifiedSnapshot
    ? new Date(verifiedSnapshot.savedAt).toLocaleString(localeByLanguage[settings.language], { dateStyle: 'medium', timeStyle: 'short' })
    : copy.garage.notAvailable;
  const verifiedReachSavedAt = verifiedReachRecord
    ? new Date(verifiedReachRecord.savedAt).toLocaleString(localeByLanguage[settings.language], { dateStyle: 'medium', timeStyle: 'short' })
    : copy.garage.notAvailable;
  const verifiedReachCount = Object.keys(verifiedReach).length;
  const savedSnapshotEntries = useMemo(
    () => Object.values(verifiedSnapshots).sort((left, right) => new Date(right.savedAt).getTime() - new Date(left.savedAt).getTime()),
    [verifiedSnapshots],
  );
  const verifiedBaseCount = savedSnapshotEntries.length;
  const reachTargetRange = classPiRanges[reachTargetClass];
  const safeReachTargetPi = Math.min(reachTargetRange.max, Math.max(reachTargetRange.min, reachTargetPi));
  const reachClassChoices = carClasses.map((item) => ({ value: item, label: item }));
  const calibrationReady = vehicle.specSource === 'manual' || vehicle.specSource === 'imported';
  const tuneValueCount = displayResult.sections.reduce((sum, section) => sum + section.values.length, 0);
  const exactInputCount = displayResult.sections.reduce(
    (sum, section) => sum + section.values.filter((value) => value.inputKind === 'exact').length,
    0,
  );
  const sliderTargetCount = displayResult.sections.reduce(
    (sum, section) => sum + section.values.filter((value) => value.inputKind === 'slider').length,
    0,
  );
  const upgradeLockCount = displayResult.sections.reduce(
    (sum, section) => sum + section.values.filter((value) => value.inputKind === 'requiresUpgrade').length,
    0,
  );
  const tuneSectionStats = new Map(
    displayResult.sections.map((section) => [
      section.id,
      {
        exact: section.values.filter((value) => value.inputKind === 'exact').length,
        slider: section.values.filter((value) => value.inputKind === 'slider').length,
        locked: section.values.filter((value) => value.inputKind === 'requiresUpgrade').length,
        total: section.values.length,
      },
    ]),
  );
  const tuneSheetColumns = useMemo(() => {
    const columns: Array<typeof displayResult.sections> = [[], []];
    const columnWeights = [0, 0];

    displayResult.sections.forEach((section) => {
      const valueWeight = section.values.reduce(
        (sum, value) => sum + 1 + (value.instruction ? 1.25 : 0) + (value.formula ? 1.1 : 0),
        0,
      );
      const sectionWeight = 2 + valueWeight;
      const targetColumn = columnWeights[0] <= columnWeights[1] ? 0 : 1;

      columns[targetColumn].push(section);
      columnWeights[targetColumn] += sectionWeight;
    });

    return columns.filter((column) => column.length > 0);
  }, [displayResult]);
  const verificationItems = [
    {
      label: copy.tune.baseStatus,
      value: verifiedSnapshot ? copy.tune.verifiedBaseReady : copy.tune.verifiedBaseMissing,
      ok: Boolean(verifiedSnapshot),
    },
    {
      label: copy.tune.reachStatus,
      value: verifiedReachRecord ? `${verifiedReachRecord.maxClass} ${verifiedReachRecord.maxPi}` : copy.tune.verifiedReachMissing,
      ok: Boolean(verifiedReachRecord),
    },
    {
      label: copy.tune.calibrationStatus,
      value: calibrationReady ? copy.tune.calibrationReady : copy.tune.calibrationMissing,
      ok: calibrationReady,
    },
    {
      label: copy.tune.fitStatus,
      value: `${fitScore}%`,
      ok: fitIssueCount === 0,
    },
  ];
  const tuneHighlights = [
    { label: copy.tune.pressure, value: `${frontPressure} / ${rearPressure}`, detail: copy.tune.tires },
    { label: copy.tune.springs, value: `${frontSpring} / ${rearSpring}`, detail: copy.tune.fh6Limits },
    { label: copy.tune.differential, value: rearAccel, detail: vehicle.drivetrain },
  ];
  const feelModeLabel = `${intent.rotation > 0 ? copy.tune.agile : intent.rotation < 0 ? copy.tune.safe : copy.tune.neutral} / ${intent.speedBias > 0 ? 'Vmax' : intent.speedBias < 0 ? copy.tune.punch : copy.tune.balanced}`;
  const renderVerificationStrip = (compact = false) => (
    <div className={className('fh6VerificationStrip', compact && 'compact')}>
      {verificationItems.map((item) => (
        <div className={className('verificationCard', item.ok ? 'success' : 'warning')} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
  const renderAdvisorInstallChecklist = () => (
    <div className="advisorInstallPlan">
      <div className="sectionTitle stackedSectionTitle">
        <strong>{copy.tune.installChecklist}</strong>
        <span>{copy.tune.installChecklistNote}</span>
      </div>
      <div className="advisorInstallList">
        {!advisorHasVerifiedReach ? (
          <div className="advisorInstallEmpty">{copy.tune.reachDataRequired}</div>
        ) : advisorInstallSteps.length === 0 ? (
          <div className="advisorInstallEmpty">{copy.tune.advisorNoChanges}</div>
        ) : (
          advisorInstallSteps.map((step) => (
            <article className="advisorInstallStep" key={step.key}>
              <b>{step.index}</b>
              <div>
                <strong>{step.title}</strong>
                <span>{step.shopPath}</span>
                <em>{step.target}</em>
                <small>
                  {step.transition} - {step.note}
                </small>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
  const renderRideHeightRangeFields = () => (
    <>
      <NumberField
        label={copy.tune.frontMinHeight}
        value={displayMeasurementValue(vehicle.rideHeightMinFront, 'rideHeight', settings.unitSystem)}
        min={displayLimit(FH6_LIMITS.rideHeightMinFront.min, 'rideHeight', settings.unitSystem)}
        max={displayLimit(FH6_LIMITS.rideHeightMinFront.max, 'rideHeight', settings.unitSystem)}
        step={measurementStep('rideHeight', settings.unitSystem)}
        unit={measurementUnit('rideHeight', settings.unitSystem)}
        hint={limitHint(displayLimit(FH6_LIMITS.rideHeightMinFront.min, 'rideHeight', settings.unitSystem), displayLimit(FH6_LIMITS.rideHeightMinFront.max, 'rideHeight', settings.unitSystem), measurementUnit('rideHeight', settings.unitSystem))}
        onChange={(value) => updateVehicle('rideHeightMinFront', canonicalMeasurementValue(value, 'rideHeight', settings.unitSystem))}
      />
      <NumberField
        label={copy.tune.frontMaxHeight}
        value={displayMeasurementValue(vehicle.rideHeightMaxFront, 'rideHeight', settings.unitSystem)}
        min={displayLimit(FH6_LIMITS.rideHeightMaxFront.min, 'rideHeight', settings.unitSystem)}
        max={displayLimit(FH6_LIMITS.rideHeightMaxFront.max, 'rideHeight', settings.unitSystem)}
        step={measurementStep('rideHeight', settings.unitSystem)}
        unit={measurementUnit('rideHeight', settings.unitSystem)}
        hint={limitHint(displayLimit(FH6_LIMITS.rideHeightMaxFront.min, 'rideHeight', settings.unitSystem), displayLimit(FH6_LIMITS.rideHeightMaxFront.max, 'rideHeight', settings.unitSystem), measurementUnit('rideHeight', settings.unitSystem))}
        onChange={(value) => updateVehicle('rideHeightMaxFront', canonicalMeasurementValue(value, 'rideHeight', settings.unitSystem))}
      />
      <NumberField
        label={copy.tune.rearMinHeight}
        value={displayMeasurementValue(vehicle.rideHeightMinRear, 'rideHeight', settings.unitSystem)}
        min={displayLimit(FH6_LIMITS.rideHeightMinRear.min, 'rideHeight', settings.unitSystem)}
        max={displayLimit(FH6_LIMITS.rideHeightMinRear.max, 'rideHeight', settings.unitSystem)}
        step={measurementStep('rideHeight', settings.unitSystem)}
        unit={measurementUnit('rideHeight', settings.unitSystem)}
        hint={limitHint(displayLimit(FH6_LIMITS.rideHeightMinRear.min, 'rideHeight', settings.unitSystem), displayLimit(FH6_LIMITS.rideHeightMinRear.max, 'rideHeight', settings.unitSystem), measurementUnit('rideHeight', settings.unitSystem))}
        onChange={(value) => updateVehicle('rideHeightMinRear', canonicalMeasurementValue(value, 'rideHeight', settings.unitSystem))}
      />
      <NumberField
        label={copy.tune.rearMaxHeight}
        value={displayMeasurementValue(vehicle.rideHeightMaxRear, 'rideHeight', settings.unitSystem)}
        min={displayLimit(FH6_LIMITS.rideHeightMaxRear.min, 'rideHeight', settings.unitSystem)}
        max={displayLimit(FH6_LIMITS.rideHeightMaxRear.max, 'rideHeight', settings.unitSystem)}
        step={measurementStep('rideHeight', settings.unitSystem)}
        unit={measurementUnit('rideHeight', settings.unitSystem)}
        hint={limitHint(displayLimit(FH6_LIMITS.rideHeightMaxRear.min, 'rideHeight', settings.unitSystem), displayLimit(FH6_LIMITS.rideHeightMaxRear.max, 'rideHeight', settings.unitSystem), measurementUnit('rideHeight', settings.unitSystem))}
        onChange={(value) => updateVehicle('rideHeightMaxRear', canonicalMeasurementValue(value, 'rideHeight', settings.unitSystem))}
      />
    </>
  );

  return (
    <div
      className={className(
        'appShell',
        `density-${settings.density}`,
        `garage-density-${settings.garageDensity}`,
        `tune-strictness-${settings.tuneStrictness}`,
        settings.lowVramMode && 'low-vram',
      )}
    >
      <aside className="sidebar">
        <div className="brandBlock">
          <div className="brandMark">
            <Gauge size={24} />
          </div>
          <div>
            <strong>{APP_NAME}</strong>
            <span>{copy.sidebar.version} {APP_VERSION}</span>
          </div>
        </div>

        <nav className="sideNav" aria-label={copy.sidebar.appNavigation}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-label={copy.nav[item.view]}
                className={className('navItem', activeView === item.view && 'active')}
                key={item.view}
                title={copy.nav[item.view]}
                type="button"
                onClick={() => {
                  setActiveView(item.view);
                  if (item.view === 'fh6Data') {
                    setActiveDataHubPanel('capture');
                  }
                }}
              >
                <Icon size={18} />
                <span>{copy.nav[item.view]}</span>
              </button>
            );
          })}
        </nav>

        <div className="sideStack">
          <section className="sidebarPanel currentSetupPanel">
            <span className="sidebarKicker">{copy.sidebar.currentBuild}</span>
            <strong>{vehicle.carName}</strong>
            <div className="sideMetricGrid">
              <div>
                <span>{copy.sidebar.class}</span>
                <b><PiBadge pi={vehicle.buildPi} carClass={vehicle.carClass} /></b>
              </div>
              <div>
                <span>{copy.sidebar.score}</span>
                <b>{displayResult.score}</b>
              </div>
              <div>
                <span>{powerToWeightUnit}</span>
                <b>{powerToWeight}</b>
              </div>
            </div>
          </section>

        </div>

        <div className="sourcePanel">
          <div>
            <ShieldCheck size={18} />
            <span>{copy.sidebar.snapshot}</span>
          </div>
          <strong>{FH6_CAR_DATA_SOURCE.total} {copy.sidebar.cars}</strong>
          <small>{copy.sidebar.updated} {FH6_CAR_DATA_SOURCE.officialUpdatedAt}</small>
        </div>
      </aside>

      <main className="mainStage">
        <header className="commandBar">
          <div className="currentCar">
            <span>{vehicle.make || selectedCar?.make || 'FH6'}</span>
            <h1>{vehicle.carName}</h1>
          </div>
          <div className="quickStats">
            <Stat label={copy.tune.buildPi} value={<PiBadge pi={vehicle.buildPi} carClass={vehicle.carClass} />} />
            <Stat label={copy.tune.tuneScore} value={String(displayResult.score)} />
            <Stat label={powerToWeightUnit} value={String(powerToWeight)} />
          </div>
          <div className="commandActions">
            <button className="iconButton" type="button" title={copy.actions.copy} onClick={copyTune}>
              {copied ? <Check size={18} /> : <Clipboard size={18} />}
              <span>{copied ? copy.actions.copied : copy.actions.copy}</span>
            </button>
            <button className="iconButton primary" type="button" title={copy.actions.export} onClick={exportTune}>
              <ArrowDownToLine size={18} />
              <span>{copy.actions.export}</span>
            </button>
          </div>
        </header>

        {activeView === 'garage' ? (
          <section className="view garageView">
            <div className="heroBand" style={{ backgroundImage: `linear-gradient(90deg, rgba(8, 10, 14, .94), rgba(8, 10, 14, .45)), url(${HERO_IMAGE_URL})` }}>
              <div>
                <span className="eyebrow">{copy.garage.eyebrow}</span>
                <h2>{copy.garage.headline}</h2>
              </div>
              <div className="heroStats">
                <Stat label={copy.garage.cars} value={String(FH6_CAR_DATA_SOURCE.total)} accent />
                <Stat label={copy.garage.countries} value={String(new Set(fh6Cars.map((car) => car.country)).size)} />
              </div>
            </div>

            <div className="garageLayout">
              <section className="panel carBrowser">
                <div className="panelHeader">
                  <div>
                    <span className="eyebrow">Garage</span>
                    <h3>{copy.garage.chooseCar}</h3>
                  </div>
                  <strong>{filteredCars.length}</strong>
                </div>

                <label className="searchBox">
                  <Search size={18} />
                  <input ref={searchInputRef} value={searchTerm} placeholder={copy.garage.searchPlaceholder} onChange={(event) => setSearchTerm(event.target.value)} />
                </label>

                <div className="classFilter">
                  <button className={className('chip', classFilter === 'ALL' && 'active')} type="button" onClick={() => setClassFilter('ALL')}>
                    {copy.garage.all}
                  </button>
                  {carClasses.map((item) => (
                    <button className={className('chip', 'classChip', piToneClass(item), classFilter === item && 'active')} key={item} type="button" onClick={() => setClassFilter(item)}>
                      {item}
                    </button>
                  ))}
                </div>

                <div className="carList" aria-label="Official Forza Horizon 6 car list">
                  {filteredCars.map((car) => {
                    const hasSavedBase = Boolean(verifiedSnapshots[car.id]);
                    const hasSavedReach = Boolean(verifiedReach[car.id]);

                    return (
                    <button
                      className={className('carListItem', car.id === pendingCar?.id && 'selected', car.id === vehicle.selectedCarId && 'current')}
                      key={car.id}
                      type="button"
                      onClick={() => setPendingCarId(car.id)}
                    >
                      <span className="carListMain">
                        <strong>{car.name}</strong>
                        <small>
                          {car.make} · {car.type} · {car.country}
                        </small>
                      </span>
                      <span className={className('garageDataBadges', !hasSavedBase && !hasSavedReach && 'empty')} aria-label={copy.garage.dataStatus}>
                        {hasSavedBase ? (
                          <span className="garageDataBadge base" title={copy.garage.baseSaved}>
                            <Database size={13} />
                            {copy.garage.baseShort}
                          </span>
                        ) : null}
                        {hasSavedReach ? (
                          <span className="garageDataBadge reach" title={copy.garage.reachSaved}>
                            <Trophy size={13} />
                            {copy.garage.reachShort}
                          </span>
                        ) : null}
                      </span>
                      <PiBadge pi={car.pi} carClass={car.carClass} />
                    </button>
                    );
                  })}
                </div>
              </section>

              <section className="panel detailPanel">
                <div className="panelHeader">
                  <div>
                    <span className="eyebrow">{copy.garage.selected}</span>
                    <h3>{pendingCar?.name ?? vehicle.carName}</h3>
                  </div>
                  <Trophy size={22} />
                </div>

                <div className="selectionMeta">
                  <div>
                    <span>{copy.garage.make}</span>
                    <strong>{pendingCar?.make ?? vehicle.make}</strong>
                  </div>
                  <div>
                    <span>{copy.garage.type}</span>
                    <strong>{pendingCar?.type ?? vehicle.carType}</strong>
                  </div>
                  <div>
                    <span>{copy.garage.country}</span>
                    <strong>{pendingCar?.country ?? vehicle.country}</strong>
                  </div>
                  <div>
                    <span>{copy.garage.collection}</span>
                    <strong>{pendingCar?.collection || vehicle.collection || copy.garage.notAvailable}</strong>
                  </div>
                  <div>
                    <span>{copy.garage.addOns}</span>
                    <strong>{pendingCar?.addOns || vehicle.addOns || copy.garage.none}</strong>
                  </div>
                </div>

                <div className="garageSelectedStatus" aria-label={copy.garage.dataStatus}>
                  <span className={className('garageDataBadge large base', pendingCar && verifiedSnapshots[pendingCar.id] ? 'saved' : 'missing')}>
                    <Database size={15} />
                    {pendingCar && verifiedSnapshots[pendingCar.id] ? copy.garage.baseSaved : copy.garage.baseMissing}
                  </span>
                  <span className={className('garageDataBadge large reach', pendingCar && verifiedReach[pendingCar.id] ? 'saved' : 'missing')}>
                    <Trophy size={15} />
                    {pendingCar && verifiedReach[pendingCar.id] ? copy.garage.reachSaved : copy.garage.reachMissing}
                  </span>
                </div>

                <div className="selectionConfirm">
                  <div>
                    <span className={className('selectionState', pendingCarIsCurrent && 'current')}>
                      {pendingCarIsCurrent ? copy.garage.currentBadge : copy.garage.pendingBadge}
                    </span>
                    <PiBadge pi={pendingCar?.pi ?? vehicle.sourcePi} carClass={pendingCar?.carClass ?? vehicle.carClass} />
                  </div>
                  <button className="toolButton primary" type="button" onClick={() => pendingCar && applyCar(pendingCar)}>
                    <Check size={17} />
                    <span>{copy.garage.confirmSelection}</span>
                  </button>
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {activeView === 'fh6Data' ? (
          <section className="view dataHubView">
            <section className="panel dataHubHero">
              <div className="dataHeroCopy">
                <span className="eyebrow">{copy.dataHub.eyebrow}</span>
                <h2>{copy.dataHub.title}</h2>
                <p>{copy.dataHub.intro}</p>
              </div>
              <div className="dataHubStatGrid">
                <Stat label={copy.dataHub.savedBases} value={`${verifiedBaseCount}/${FH6_CAR_DATA_SOURCE.total}`} accent />
                <Stat label={copy.dataHub.reachRecords} value={`${verifiedReachCount}/${FH6_CAR_DATA_SOURCE.total}`} />
                <Stat label={copy.dataHub.officialCars} value={String(FH6_CAR_DATA_SOURCE.total)} />
              </div>
            </section>

            <nav className="dataHubTopBar" aria-label={copy.dataHub.sectionNav}>
              <button className={className(activeDataHubPanel === 'workflow' && 'active')} type="button" onClick={() => setActiveDataHubPanel('workflow')}>
                <ListChecks size={16} />
                <span>{copy.dataHub.workflowNav}</span>
              </button>
              <button className={className(activeDataHubPanel === 'capture' && 'active')} type="button" onClick={() => setActiveDataHubPanel('capture')}>
                <Clipboard size={16} />
                <span>{copy.dataHub.captureNav}</span>
              </button>
              <button className={className(activeDataHubPanel === 'editor' && 'active')} type="button" onClick={() => setActiveDataHubPanel('editor')}>
                <SlidersHorizontal size={16} />
                <span>{copy.dataHub.dataNav}</span>
              </button>
              <button className={className(activeDataHubPanel === 'reach' && 'active')} type="button" onClick={() => setActiveDataHubPanel('reach')}>
                <Trophy size={16} />
                <span>{copy.dataHub.reachNav}</span>
              </button>
              <button className={className(activeDataHubPanel === 'current' && 'active')} type="button" onClick={() => setActiveDataHubPanel('current')}>
                <Database size={16} />
                <span>{copy.dataHub.currentVehicleNav}</span>
              </button>
              <button className={className(activeDataHubPanel === 'library' && 'active')} type="button" onClick={() => setActiveDataHubPanel('library')}>
                <Save size={16} />
                <span>{copy.dataHub.savedVehiclesNav}</span>
              </button>
            </nav>

            {activeDataHubPanel === 'capture' ? (
              <section className="panel dataHubCapture">
                <div className="panelHeader">
                  <div>
                    <span className="eyebrow">{copy.dataHub.captureEyebrow}</span>
                    <h3>{copy.dataHub.captureTitle}</h3>
                  </div>
                  <Clipboard size={21} />
                </div>

                <p className="panelCopy">{copy.dataHub.captureIntro}</p>

                <div className="captureWizardGrid">
                  {captureWizardSteps.map((step) => (
                    <article className={className('captureStep', step.status)} key={step.index}>
                      <b>{step.index}</b>
                      <div>
                        <strong>{step.title}</strong>
                        <span>{step.detail}</span>
                      </div>
                      <em>{step.status === 'ready' ? copy.dataHub.captureReady : step.status === 'optional' ? copy.dataHub.captureOptional : copy.dataHub.captureTodo}</em>
                    </article>
                  ))}
                </div>

                <div className="captureWizardSummary">
                  <Stat label={copy.tune.buildPi} value={<PiBadge pi={vehicle.buildPi} carClass={vehicle.carClass} />} accent />
                  <Stat label={copy.tune.power} value={formatMeasurement(vehicle.horsepower, 'power', settings.unitSystem)} />
                  <Stat label={copy.tune.weight} value={formatMeasurement(vehicle.weightKg, 'weight', settings.unitSystem)} />
                  <Stat label={copy.dataHub.specSource} value={specSourceLabel} />
                </div>

                <div className="noticeLine dataNotice lockedDataNotice">
                  <BadgeInfo size={17} />
                  <span>{copy.dataHub.captureTruthNote}</span>
                </div>

                <div className="dataHubActionGrid">
                  <button className="toolButton primary" type="button" onClick={() => setActiveDataHubPanel('editor')}>
                    <SlidersHorizontal size={17} />
                    <span>{copy.dataHub.editStandardData}</span>
                  </button>
                  <button className="toolButton" type="button" onClick={saveVerifiedSnapshot}>
                    <Save size={17} />
                    <span>{copy.dataHub.saveCurrent}</span>
                  </button>
                  <button
                    className="toolButton"
                    type="button"
                    onClick={() => {
                      setActiveTunePanel('build');
                      setActiveView('tune');
                    }}
                  >
                    <Wrench size={17} />
                    <span>{copy.dataHub.tuneCurrent}</span>
                  </button>
                </div>
              </section>
            ) : null}

            {activeDataHubPanel === 'current' ? (
            <section className="panel dataHubCurrent">
              <div className="panelHeader">
                <div>
                  <span className="eyebrow">{copy.dataHub.currentTitle}</span>
                  <h3>{vehicle.carName}</h3>
                </div>
                <Database size={21} />
              </div>

              <p className="panelCopy">{copy.dataHub.currentNote}</p>

              <div className="dataSnapshotGrid">
                <Stat label={copy.tune.buildPi} value={<PiBadge pi={vehicle.buildPi} carClass={vehicle.carClass} />} accent />
                <Stat label={copy.tune.power} value={formatMeasurement(vehicle.horsepower, 'power', settings.unitSystem)} />
                <Stat label={copy.tune.weight} value={formatMeasurement(vehicle.weightKg, 'weight', settings.unitSystem)} />
                <Stat label={copy.tune.front} value={`${vehicle.frontWeightPercent}%`} />
                <Stat label={copy.dataHub.specSource} value={specSourceLabel} />
                <Stat label={copy.dataHub.savedAt} value={verifiedSavedAt} />
              </div>

              <div className="dataHubStatusGrid">
                <div className={className('dataStatusCard', verifiedSnapshot && 'ready')}>
                  <ShieldCheck size={18} />
                  <strong>{verifiedSnapshot ? copy.dataHub.savedBase : copy.dataHub.noBase}</strong>
                </div>
                <div className={className('dataStatusCard', verifiedReachRecord && 'ready')}>
                  <Trophy size={18} />
                  <strong>{verifiedReachRecord ? copy.dataHub.reachReady : copy.dataHub.reachMissing}</strong>
                </div>
              </div>

              {dataSaveNotice ? (
                <div className="dataSaveNotice" role="status">
                  <Check size={16} />
                  <span>{copy.dataHub.savedNotice}</span>
                </div>
              ) : null}

              <div className="dataHubActionGrid">
                <button
                  className="toolButton"
                  type="button"
                  onClick={() => setActiveDataHubPanel('editor')}
                >
                  <Gauge size={17} />
                  <span>{copy.dataHub.editStandardData}</span>
                </button>
                <button className="toolButton primary" type="button" onClick={saveVerifiedSnapshot}>
                  <Save size={17} />
                  <span>{copy.dataHub.saveCurrent}</span>
                </button>
                <button className="toolButton" type="button" disabled={!verifiedSnapshot} onClick={loadVerifiedSnapshot}>
                  <Database size={17} />
                  <span>{copy.dataHub.loadCurrent}</span>
                </button>
                <button
                  className="toolButton"
                  type="button"
                  onClick={() => {
                    setActiveTunePanel('build');
                    setActiveView('tune');
                  }}
                >
                  <Wrench size={17} />
                  <span>{copy.dataHub.tuneCurrent}</span>
                </button>
              </div>
            </section>
            ) : null}

            {activeDataHubPanel === 'editor' ? (
            <section className="panel dataHubEditor">
              <div className="panelHeader">
                <div>
                  <span className="eyebrow">{copy.dataHub.eyebrow}</span>
                  <h3>{copy.dataHub.standardEditorTitle}</h3>
                </div>
                <SlidersHorizontal size={21} />
              </div>

              <div className="noticeLine dataNotice">
                <BadgeInfo size={17} />
                <span>{copy.dataHub.standardEditorNote}</span>
              </div>

              <div className="noticeLine dataNotice lockedDataNotice">
                <BadgeInfo size={17} />
                <span>{copy.dataHub.stockSuspensionNote}</span>
              </div>

              <div className="controlSection calibrationSection">
                <div className="sectionTitle">
                  <strong>{copy.tune.calibrationSnapshot}</strong>
                  <span>{vehicle.carName}</span>
                </div>
                <div className="twoColumn">
                  <NumberField
                    label={copy.tune.buildPi}
                    value={vehicle.buildPi}
                    min={FH6_LIMITS.buildPi.min}
                    max={FH6_LIMITS.buildPi.max}
                    hint={limitHint(FH6_LIMITS.buildPi.min, FH6_LIMITS.buildPi.max)}
                    onChange={(value) => updateVehicle('buildPi', value)}
                  />
                  <NumberField
                    label={copy.tune.front}
                    value={vehicle.frontWeightPercent}
                    min={FH6_LIMITS.frontWeightPercent.min}
                    max={FH6_LIMITS.frontWeightPercent.max}
                    unit="%"
                    hint={limitHint(FH6_LIMITS.frontWeightPercent.min, FH6_LIMITS.frontWeightPercent.max, '%')}
                    onChange={(value) => updateVehicle('frontWeightPercent', value)}
                  />
                  <NumberField
                    label={copy.tune.power}
                    value={displayMeasurementValue(vehicle.horsepower, 'power', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.horsepower.min, 'power', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.horsepower.max, 'power', settings.unitSystem)}
                    unit={measurementUnit('power', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.horsepower.min, 'power', settings.unitSystem), displayLimit(FH6_LIMITS.horsepower.max, 'power', settings.unitSystem), measurementUnit('power', settings.unitSystem))}
                    onChange={(value) => updateVehicle('horsepower', canonicalMeasurementValue(value, 'power', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.torque}
                    value={displayMeasurementValue(vehicle.torqueNm, 'torque', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.torqueNm.min, 'torque', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.torqueNm.max, 'torque', settings.unitSystem)}
                    unit={measurementUnit('torque', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.torqueNm.min, 'torque', settings.unitSystem), displayLimit(FH6_LIMITS.torqueNm.max, 'torque', settings.unitSystem), measurementUnit('torque', settings.unitSystem))}
                    onChange={(value) => updateVehicle('torqueNm', canonicalMeasurementValue(value, 'torque', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.weight}
                    value={displayMeasurementValue(vehicle.weightKg, 'weight', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.weightKg.min, 'weight', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.weightKg.max, 'weight', settings.unitSystem)}
                    unit={measurementUnit('weight', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.weightKg.min, 'weight', settings.unitSystem), displayLimit(FH6_LIMITS.weightKg.max, 'weight', settings.unitSystem), measurementUnit('weight', settings.unitSystem))}
                    onChange={(value) => updateVehicle('weightKg', canonicalMeasurementValue(value, 'weight', settings.unitSystem))}
                  />
                  <Segmented label={copy.tune.drivetrain} options={drivetrainOptions} value={vehicle.drivetrain} onChange={(value: Drivetrain) => updateVehicle('drivetrain', value)} />
                  <Segmented label={copy.tune.discipline} options={surfaceChoices} value={vehicle.surface} onChange={(value: Surface) => updateVehicle('surface', value)} />
                  <Segmented label={copy.tune.tires} options={tireChoices} value={vehicle.tireCompound} onChange={(value: TireCompound) => updateVehicle('tireCompound', value)} />
                </div>
              </div>

              <div className="controlSection calibrationSection">
                <div className="sectionTitle">
                  <strong>{copy.tune.calibrationRanges}</strong>
                  <span>{copy.tune.fh6Limits}</span>
                </div>
                <div className="twoColumn">
                  <NumberField
                    label={copy.tune.frontTire}
                    value={displayMeasurementValue(vehicle.frontTireWidth, 'tireWidth', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.frontTireWidth.min, 'tireWidth', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.frontTireWidth.max, 'tireWidth', settings.unitSystem)}
                    step={displayStep(FH6_LIMITS.frontTireWidth.step, 'tireWidth', settings.unitSystem)}
                    unit={measurementUnit('tireWidth', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.frontTireWidth.min, 'tireWidth', settings.unitSystem), displayLimit(FH6_LIMITS.frontTireWidth.max, 'tireWidth', settings.unitSystem), measurementUnit('tireWidth', settings.unitSystem))}
                    onChange={(value) => updateVehicle('frontTireWidth', canonicalMeasurementValue(value, 'tireWidth', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.rearTire}
                    value={displayMeasurementValue(vehicle.rearTireWidth, 'tireWidth', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.rearTireWidth.min, 'tireWidth', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.rearTireWidth.max, 'tireWidth', settings.unitSystem)}
                    step={displayStep(FH6_LIMITS.rearTireWidth.step, 'tireWidth', settings.unitSystem)}
                    unit={measurementUnit('tireWidth', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.rearTireWidth.min, 'tireWidth', settings.unitSystem), displayLimit(FH6_LIMITS.rearTireWidth.max, 'tireWidth', settings.unitSystem), measurementUnit('tireWidth', settings.unitSystem))}
                    onChange={(value) => updateVehicle('rearTireWidth', canonicalMeasurementValue(value, 'tireWidth', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.gears}
                    value={vehicle.gearCount}
                    min={FH6_LIMITS.gearCount.min}
                    max={FH6_LIMITS.gearCount.max}
                    hint={limitHint(FH6_LIMITS.gearCount.min, FH6_LIMITS.gearCount.max)}
                    onChange={(value) => updateVehicle('gearCount', Math.round(value))}
                  />
                  {renderRideHeightRangeFields()}
                </div>
              </div>

              <div className="controlSection calibrationSection limitSection">
                <div className="sectionTitle">
                  <strong>{copy.tune.fh6Limits}</strong>
                  <span>{copy.tune.springRange}</span>
                </div>
                <div className="twoColumn">
                  <NumberField
                    label={copy.tune.springFrontMin}
                    value={displayMeasurementValue(vehicle.springRateMinFront, 'springRate', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.springRateMinFront.min, 'springRate', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.springRateMinFront.max, 'springRate', settings.unitSystem)}
                    step={measurementStep('springRate', settings.unitSystem)}
                    unit={measurementUnit('springRate', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.springRateMinFront.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMinFront.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                    onChange={(value) => updateVehicle('springRateMinFront', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.springFrontMax}
                    value={displayMeasurementValue(vehicle.springRateMaxFront, 'springRate', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.springRateMaxFront.min, 'springRate', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.springRateMaxFront.max, 'springRate', settings.unitSystem)}
                    step={measurementStep('springRate', settings.unitSystem)}
                    unit={measurementUnit('springRate', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.springRateMaxFront.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMaxFront.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                    onChange={(value) => updateVehicle('springRateMaxFront', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.springRearMin}
                    value={displayMeasurementValue(vehicle.springRateMinRear, 'springRate', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.springRateMinRear.min, 'springRate', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.springRateMinRear.max, 'springRate', settings.unitSystem)}
                    step={measurementStep('springRate', settings.unitSystem)}
                    unit={measurementUnit('springRate', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.springRateMinRear.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMinRear.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                    onChange={(value) => updateVehicle('springRateMinRear', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.springRearMax}
                    value={displayMeasurementValue(vehicle.springRateMaxRear, 'springRate', settings.unitSystem)}
                    min={displayLimit(FH6_LIMITS.springRateMaxRear.min, 'springRate', settings.unitSystem)}
                    max={displayLimit(FH6_LIMITS.springRateMaxRear.max, 'springRate', settings.unitSystem)}
                    step={measurementStep('springRate', settings.unitSystem)}
                    unit={measurementUnit('springRate', settings.unitSystem)}
                    hint={limitHint(displayLimit(FH6_LIMITS.springRateMaxRear.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMaxRear.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                    onChange={(value) => updateVehicle('springRateMaxRear', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                  />
                </div>
              </div>

              <div className="controlSection calibrationSection aeroCalibrationSection">
                <div className="sectionTitle stackedSectionTitle">
                  <strong>{copy.tune.calibrationAero}</strong>
                  <span>{copy.tune.calibrationAeroNote}</span>
                </div>
                <div className="toggleRow">
                  <ToggleField label={copy.tune.frontAero} checked={vehicle.frontAero} onChange={(value) => updateVehicle('frontAero', value)} />
                  <ToggleField label={copy.tune.rearAero} checked={vehicle.rearAero} onChange={(value) => updateVehicle('rearAero', value)} />
                </div>
                <div className="twoColumn">
                  <NumberField
                    label={copy.tune.frontAeroMin}
                    value={displayMeasurementValue(vehicle.frontAeroMinLb, 'aeroDownforce', settings.unitSystem)}
                    min={displayLimit(0, 'aeroDownforce', settings.unitSystem)}
                    max={displayLimit(10000, 'aeroDownforce', settings.unitSystem)}
                    step={measurementStep('aeroDownforce', settings.unitSystem)}
                    unit={measurementUnit('aeroDownforce', settings.unitSystem)}
                    hint={copy.tune.speedSide}
                    onChange={(value) => updateVehicle('frontAeroMinLb', canonicalMeasurementValue(value, 'aeroDownforce', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.frontAeroMax}
                    value={displayMeasurementValue(vehicle.frontAeroMaxLb, 'aeroDownforce', settings.unitSystem)}
                    min={displayLimit(0, 'aeroDownforce', settings.unitSystem)}
                    max={displayLimit(10000, 'aeroDownforce', settings.unitSystem)}
                    step={measurementStep('aeroDownforce', settings.unitSystem)}
                    unit={measurementUnit('aeroDownforce', settings.unitSystem)}
                    hint={copy.tune.corneringSide}
                    onChange={(value) => updateVehicle('frontAeroMaxLb', canonicalMeasurementValue(value, 'aeroDownforce', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.rearAeroMin}
                    value={displayMeasurementValue(vehicle.rearAeroMinLb, 'aeroDownforce', settings.unitSystem)}
                    min={displayLimit(0, 'aeroDownforce', settings.unitSystem)}
                    max={displayLimit(10000, 'aeroDownforce', settings.unitSystem)}
                    step={measurementStep('aeroDownforce', settings.unitSystem)}
                    unit={measurementUnit('aeroDownforce', settings.unitSystem)}
                    hint={copy.tune.speedSide}
                    onChange={(value) => updateVehicle('rearAeroMinLb', canonicalMeasurementValue(value, 'aeroDownforce', settings.unitSystem))}
                  />
                  <NumberField
                    label={copy.tune.rearAeroMax}
                    value={displayMeasurementValue(vehicle.rearAeroMaxLb, 'aeroDownforce', settings.unitSystem)}
                    min={displayLimit(0, 'aeroDownforce', settings.unitSystem)}
                    max={displayLimit(10000, 'aeroDownforce', settings.unitSystem)}
                    step={measurementStep('aeroDownforce', settings.unitSystem)}
                    unit={measurementUnit('aeroDownforce', settings.unitSystem)}
                    hint={copy.tune.corneringSide}
                    onChange={(value) => updateVehicle('rearAeroMaxLb', canonicalMeasurementValue(value, 'aeroDownforce', settings.unitSystem))}
                  />
                </div>
              </div>

              {dataSaveNotice ? (
                <div className="dataSaveNotice" role="status">
                  <Check size={16} />
                  <span>{copy.dataHub.savedNotice}</span>
                </div>
              ) : null}

              <div className="dataHubActionGrid stickyDataActions">
                <button className="toolButton primary" type="button" onClick={saveVerifiedSnapshot}>
                  <Save size={17} />
                  <span>{copy.dataHub.saveCurrent}</span>
                </button>
                <button
                  className="toolButton"
                  type="button"
                  onClick={() => {
                    setActiveTunePanel('build');
                    setActiveView('tune');
                  }}
                >
                  <Wrench size={17} />
                  <span>{copy.dataHub.tuneCurrent}</span>
                </button>
              </div>
            </section>
            ) : null}

            {activeDataHubPanel === 'reach' ? (
              <section className="panel dataHubReach">
                <div className="panelHeader">
                  <div>
                    <span className="eyebrow">{copy.tune.verifiedReach}</span>
                    <h3>{copy.tune.maxReachClass}</h3>
                  </div>
                  <Trophy size={21} />
                </div>

                <p className="panelCopy">{verifiedReachRecord ? copy.tune.verifiedReachActive : copy.tune.noVerifiedReach}</p>

                <div className="dataSnapshotGrid">
                  <Stat label={copy.tune.maxReachClass} value={verifiedReachRecord ? `${verifiedReachRecord.maxPi} ${verifiedReachRecord.maxClass}` : copy.tune.unverified} accent={Boolean(verifiedReachRecord)} />
                  <Stat label={copy.tune.savedAt} value={verifiedReachSavedAt} />
                  <Stat label={copy.tune.verifiedCars} value={`${verifiedReachCount}/${FH6_CAR_DATA_SOURCE.total}`} />
                  <Stat label={copy.tune.targetPi} value={`${safeReachTargetPi}`} />
                </div>

                <div className="dataWorkflow">
                  <div>
                    <b>1</b>
                    <span>{copy.tune.reachDataStepOne}</span>
                  </div>
                  <div>
                    <b>2</b>
                    <span>{copy.tune.reachDataStepTwo}</span>
                  </div>
                </div>

                <Segmented label={copy.tune.maxReachClass} options={reachClassChoices} value={reachTargetClass} onChange={updateReachTargetClass} />
                <NumberField
                  label={copy.tune.maxReachPi}
                  value={safeReachTargetPi}
                  min={reachTargetRange.min}
                  max={reachTargetRange.max}
                  hint={limitHint(reachTargetRange.min, reachTargetRange.max)}
                  onChange={setReachTargetPi}
                />

                <div className="dataHubActionGrid">
                  <button className="toolButton primary" type="button" onClick={saveVerifiedReachRecord}>
                    <Save size={17} />
                    <span>{copy.tune.saveVerifiedReach}</span>
                  </button>
                  <button className="toolButton" type="button" disabled={!verifiedReachRecord} onClick={deleteVerifiedReachRecord}>
                    <Trash2 size={17} />
                    <span>{copy.tune.deleteVerifiedReach}</span>
                  </button>
                </div>
              </section>
            ) : null}

            {activeDataHubPanel === 'workflow' ? (
              <section className="panel dataHubWorkflowPanel dataHubInfoPanel">
                <div className="panelHeader">
                  <div>
                    <span className="eyebrow">{copy.dataHub.workflowTitle}</span>
                    <h3>{copy.dataHub.workflowInfoTitle}</h3>
                  </div>
                  <ListChecks size={21} />
                </div>

                <p className="panelCopy">{copy.dataHub.workflowIntro}</p>

                <div className="dataWorkflow compactWorkflowSteps">
                  <div>
                    <b>1</b>
                    <span>{copy.dataHub.stepOne}</span>
                  </div>
                  <div>
                    <b>2</b>
                    <span>{copy.dataHub.stepTwo}</span>
                  </div>
                  <div>
                    <b>3</b>
                    <span>{copy.dataHub.stepThree}</span>
                  </div>
                  <div>
                    <b>4</b>
                    <span>{copy.dataHub.stepFour}</span>
                  </div>
                </div>

                <div className="noticeLine dataNotice">
                  <BadgeInfo size={17} />
                  <span>{copy.dataHub.workflowHelpNote}</span>
                </div>

                <div className="dataHubActionGrid singleDataAction">
                  <button className="toolButton primary" type="button" onClick={() => setActiveDataHubPanel('capture')}>
                    <Clipboard size={17} />
                    <span>{copy.dataHub.openCaptureWizard}</span>
                  </button>
                </div>
              </section>
            ) : null}

            {activeDataHubPanel === 'library' ? (
              <section className="panel dataHubLibrary">
                <div className="panelHeader">
                  <div>
                    <span className="eyebrow">{copy.dataHub.libraryTitle}</span>
                    <h3>{copy.dataHub.coverageTitle}</h3>
                  </div>
                  <strong>{verifiedBaseCount}</strong>
                </div>
                <p className="panelCopy">{copy.dataHub.libraryNote}</p>

                <div className="dataHubList">
                  {savedSnapshotEntries.length === 0 ? (
                    <p className="emptyState">{copy.dataHub.noSaved}</p>
                  ) : (
                    savedSnapshotEntries.map((snapshot) => {
                      const snapshotVehicle = normalizeVehicle(snapshot.vehicle);
                      const reach = verifiedReach[snapshot.carId];
                      const savedAt = new Date(snapshot.savedAt).toLocaleString(localeByLanguage[settings.language], { dateStyle: 'medium', timeStyle: 'short' });

                      return (
                        <article className="dataVehicleRow" key={snapshot.id}>
                          <div className="dataVehicleMain">
                            <strong>{snapshot.carName}</strong>
                            <span>
                              {snapshotVehicle.make} - {snapshotVehicle.carType} - {savedAt}
                            </span>
                          </div>
                          <div className="dataVehicleBadges">
                            <PiBadge pi={snapshotVehicle.buildPi} carClass={snapshotVehicle.carClass} />
                            {reach ? <PiBadge pi={reach.maxPi} carClass={reach.maxClass} /> : <span className="miniStatus">{copy.dataHub.reachMissing}</span>}
                          </div>
                          <div className="dataVehicleActions">
                            <button className="toolButton" type="button" onClick={() => editVerifiedSnapshotRecord(snapshot)}>
                              <Pencil size={16} />
                              <span>{copy.dataHub.editSaved}</span>
                            </button>
                            <button className="toolButton primary" type="button" onClick={() => loadVerifiedSnapshotRecord(snapshot, 'build')}>
                              <Wrench size={16} />
                              <span>{copy.dataHub.loadToTune}</span>
                            </button>
                            <button className="deleteButton" title={copy.dataHub.remove} type="button" onClick={() => deleteVerifiedSnapshotByCarId(snapshot.carId)}>
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {activeView === 'tune' ? (
          <section className="view tuneView">
            <div className="tuneLabHeader">
              <div className="labIdentity">
                <span className="eyebrow">Tune Lab</span>
                <h2>{vehicle.carName}</h2>
                <p>
                  {vehicle.make} · {vehicle.carType} · {vehicle.country}
                </p>
                <div className="setupPills">
                  <span>{vehicle.drivetrain}</span>
                  <span>{copy.surfaces[vehicle.surface]}</span>
                  <span>{copy.tires[vehicle.tireCompound]}</span>
                  {settings.showSpecSource ? <span>{specSourceLabel}</span> : null}
                  <span>{strictnessLabel}</span>
                  <span>{settings.unitSystem === 'metric' ? copy.settings.metric : copy.settings.imperial}</span>
                </div>
              </div>

              <div className="labMeters">
                <Stat label={copy.tune.buildPi} value={<PiBadge pi={vehicle.buildPi} carClass={vehicle.carClass} />} />
                <Stat label={copy.tune.power} value={formatMeasurement(vehicle.horsepower, 'power', settings.unitSystem)} />
                <Stat label={copy.tune.weight} value={formatMeasurement(vehicle.weightKg, 'weight', settings.unitSystem)} />
                <Stat label="Score" value={String(displayResult.score)} />
              </div>

              <div className={className('fitBadge', fitIssueCount === 0 ? 'success' : 'warning')}>
                <span>{copy.tune.setupFit}</span>
                <strong>{fitScore}%</strong>
                <small>{fitIssueCount === 0 ? copy.tune.fitReady : copy.tune.fitReview}</small>
              </div>

              <div className="labActions">
                <button className="iconButton" type="button" title={copy.actions.copy} onClick={copyTune}>
                  {copied ? <Check size={18} /> : <Clipboard size={18} />}
                  <span>{copied ? copy.actions.copied : copy.actions.copy}</span>
                </button>
                <button className="iconButton primary" type="button" title={copy.actions.save} onClick={saveCurrentProfile}>
                  <Save size={18} />
                  <span>{copy.actions.save}</span>
                </button>
              </div>
            </div>

            <div className="tuneWorkbench">
              <nav className="tunePanelTopBar" aria-label="Tune Lab sections">
                <button className={className('tuneTabButton', activeTunePanel === 'build' && 'active')} title={`${copy.tune.build} - ${vehicle.buildPi} ${vehicle.carClass}`} type="button" onClick={() => setActiveTunePanel('build')}>
                  <SlidersHorizontal size={18} />
                  <span>{copy.tune.build}</span>
                </button>
                <button className={className('tuneTabButton', activeTunePanel === 'assistant' && 'active')} title={`${copy.tune.fastBuild} - ${activeAdvisorTargetClass} ${activeAdvisorTargetPi}`} type="button" onClick={() => setActiveTunePanel('assistant')}>
                  <ListChecks size={18} />
                  <span>{copy.tune.fastBuild}</span>
                </button>
                <button className={className('tuneTabButton', activeTunePanel === 'calibration' && 'active')} title={`${copy.tune.calibration} - ${copy.tune.calibrationShort}`} type="button" onClick={() => setActiveTunePanel('calibration')}>
                  <Gauge size={18} />
                  <span>{copy.tune.calibration}</span>
                </button>
                <button className={className('tuneTabButton', activeTunePanel === 'feel' && 'active')} title={`${copy.tune.feel} - ${feelModeLabel}`} type="button" onClick={() => setActiveTunePanel('feel')}>
                  <Sparkles size={18} />
                  <span>{copy.tune.feel}</span>
                </button>
                <button className={className('tuneTabButton', activeTunePanel === 'summary' && 'active')} title={`${copy.tune.summary} - ${fitScore}% ${copy.tune.setupFitCompact}`} type="button" onClick={() => setActiveTunePanel('summary')}>
                  <ShieldCheck size={18} />
                  <span>{copy.tune.summary}</span>
                </button>
              </nav>

              {activeTunePanel === 'build' ? (
              <aside className="panel tuneControls">
                <div className="panelHeader">
                  <div>
                  <span className="eyebrow">{copy.tune.build}</span>
                  <h3>{copy.tune.base}</h3>
                  </div>
                  <SlidersHorizontal size={20} />
                </div>

                {renderVerificationStrip(true)}

                <div className="controlSection">
                  <div className="sectionTitle">
                    <strong>{copy.tune.vehicle}</strong>
                    <span>{vehicle.collection || copy.tune.collectionUnavailable}</span>
                  </div>
                  <TextField label={copy.tune.name} value={vehicle.carName} onChange={(value) => updateVehicle('carName', value)} />
                  <NumberField
                    label={copy.tune.buildPi}
                    value={vehicle.buildPi}
                    min={FH6_LIMITS.buildPi.min}
                    max={FH6_LIMITS.buildPi.max}
                    hint={limitHint(FH6_LIMITS.buildPi.min, FH6_LIMITS.buildPi.max)}
                    onChange={(value) => updateVehicle('buildPi', value)}
                  />
                  <Segmented label={copy.tune.drivetrain} options={drivetrainOptions} value={vehicle.drivetrain} onChange={(value) => updateVehicle('drivetrain', value)} />
                </div>

                <div className="controlSection">
                  <div className="sectionTitle">
                    <strong>{copy.tune.target}</strong>
                    <span>{displayResult.summary}</span>
                  </div>
                  <Segmented label={copy.tune.discipline} options={surfaceChoices} value={vehicle.surface} onChange={(value) => updateVehicle('surface', value)} />
                  <Segmented label={copy.tune.tires} options={tireChoices} value={vehicle.tireCompound} onChange={(value) => updateVehicle('tireCompound', value)} />
                </div>

                <div className="controlSection advisorSection">
                  <div className="sectionTitle stackedSectionTitle">
                    <strong>{copy.tune.buildAdvisor}</strong>
                    <span>{copy.tune.buildAdvisorNote}</span>
                  </div>
                  <Segmented label={copy.tune.targetClass} options={advisorClassChoices} value={activeAdvisorTargetClass} onChange={updateAdvisorTargetClass} />
                  <NumberField
                    label={copy.tune.targetPi}
                    value={activeAdvisorTargetPi}
                    min={advisorTargetRange.min}
                    max={advisorTargetRange.max}
                    hint={limitHint(advisorTargetRange.min, advisorTargetRange.max)}
                    onChange={setAdvisorTargetPi}
                  />
                  <div className="advisorPiGrid">
                    <div>
                      <span>{copy.tune.advisorCurrent}</span>
                      <PiBadge carClass={vehicle.carClass} pi={vehicle.buildPi} />
                    </div>
                    <div>
                      <span>{copy.tune.advisorSuggested}</span>
                      <PiBadge carClass={advisorSuggestedClass} pi={advisorSuggestedPi} />
                    </div>
                  </div>
                  <div className={className('advisorStatus', (!advisorHasVerifiedReach || advisorRecommendation.isAboveTarget) && 'warning', advisorHasVerifiedReach && advisorRecommendation.gap === 0 && 'success')}>
                    <strong>{advisorStatusText}</strong>
                    <span>{advisorStatusHint}</span>
                  </div>
                  <div className="advisorChangeList">
                    {!advisorHasVerifiedReach ? (
                      <span>{copy.tune.reachDataRequired}</span>
                    ) : advisorVisibleChanges.length === 0 ? (
                      <span>{copy.tune.advisorNoChanges}</span>
                    ) : (
                      advisorVisibleChanges.map((change) => (
                        <span key={change.key}>
                          <b>{advisorFieldLabels[change.key]}</b>
                          {advisorUpgradeValueLabel(change.key, change.from)} {'->'} {advisorUpgradeValueLabel(change.key, change.to)}
                        </span>
                      ))
                    )}
                  </div>
                  {renderAdvisorInstallChecklist()}
                  <button className="toolButton primary" type="button" disabled={!advisorCanSuggest} onClick={applyAdvisorRecommendation}>
                    <Check size={17} />
                    <span>{copy.tune.advisorApply}</span>
                  </button>
                </div>

                <div className="controlSection upgradeSection">
                  <div className="sectionTitle">
                    <strong>{copy.tune.upgradeBuilder}</strong>
                    <span>{copy.tune.upgradeNote}</span>
                  </div>
                  <Segmented label={copy.tune.powerUpgrade} options={upgradePowerChoices} value={upgrades.power} onChange={(value: UpgradePower) => updateUpgrade('power', value)} />
                  <Segmented label={copy.tune.tireUpgrade} options={tireChoices} value={upgrades.tireCompound} onChange={(value: TireCompound) => updateUpgrade('tireCompound', value)} />
                  <div className="twoColumn">
                    <Segmented label={copy.tune.tireWidthUpgrade} options={upgradeWidthChoices} value={upgrades.tireWidth} onChange={(value: UpgradeTireWidth) => updateUpgrade('tireWidth', value)} />
                    <Segmented label={copy.tune.weightUpgrade} options={upgradeWeightChoices} value={upgrades.weightReduction} onChange={(value: UpgradeWeightReduction) => updateUpgrade('weightReduction', value)} />
                    <Segmented label={copy.tune.drivetrainUpgrade} options={drivetrainUpgradeChoices} value={upgrades.drivetrain} onChange={(value: UpgradeDrivetrain) => updateUpgrade('drivetrain', value)} />
                    <Segmented label={copy.tune.aeroUpgrade} options={aeroUpgradeChoices} value={upgrades.aero} onChange={(value: UpgradeAero) => updateUpgrade('aero', value)} />
                    <Segmented label={copy.tune.transmissionUpgrade} options={transmissionUpgradeChoices} value={upgrades.transmission} onChange={(value: UpgradeTransmission) => updateUpgrade('transmission', value)} />
                    <Segmented label={copy.tune.suspensionUpgrade} options={suspensionUpgradeChoices} value={upgrades.suspension} onChange={(value: UpgradeSuspension) => updateUpgrade('suspension', value)} />
                    <Segmented label={copy.tune.antiRollUpgrade} options={adjustableUpgradeChoices} value={upgrades.antiRollBars} onChange={(value: UpgradeAntiRollBars) => updateUpgrade('antiRollBars', value)} />
                    <Segmented label={copy.tune.brakeUpgrade} options={adjustableUpgradeChoices} value={upgrades.brakes} onChange={(value: UpgradeBrakes) => updateUpgrade('brakes', value)} />
                    <Segmented label={copy.tune.differentialUpgrade} options={differentialUpgradeChoices} value={upgrades.differential} onChange={(value: UpgradeDifferential) => updateUpgrade('differential', value)} />
                  </div>
                  <button className="toolButton" type="button" onClick={resetUpgrades}>
                    <RotateCcw size={17} />
                    <span>{copy.tune.resetUpgrades}</span>
                  </button>
                </div>

                <div className="controlSection">
                  <div className="sectionTitle">
                    <strong>{copy.tune.performance}</strong>
                    <span>{powerToWeight} {powerToWeightUnit}</span>
                  </div>
                  <div className="twoColumn">
                    <NumberField
                      label={copy.tune.power}
                      value={displayMeasurementValue(vehicle.horsepower, 'power', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.horsepower.min, 'power', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.horsepower.max, 'power', settings.unitSystem)}
                      unit={measurementUnit('power', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.horsepower.min, 'power', settings.unitSystem), displayLimit(FH6_LIMITS.horsepower.max, 'power', settings.unitSystem), measurementUnit('power', settings.unitSystem))}
                      onChange={(value) => updateVehicle('horsepower', canonicalMeasurementValue(value, 'power', settings.unitSystem))}
                    />
                    <NumberField
                      label={copy.tune.torque}
                      value={displayMeasurementValue(vehicle.torqueNm, 'torque', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.torqueNm.min, 'torque', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.torqueNm.max, 'torque', settings.unitSystem)}
                      unit={measurementUnit('torque', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.torqueNm.min, 'torque', settings.unitSystem), displayLimit(FH6_LIMITS.torqueNm.max, 'torque', settings.unitSystem), measurementUnit('torque', settings.unitSystem))}
                      onChange={(value) => updateVehicle('torqueNm', canonicalMeasurementValue(value, 'torque', settings.unitSystem))}
                    />
                    <NumberField
                      label={copy.tune.weight}
                      value={displayMeasurementValue(vehicle.weightKg, 'weight', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.weightKg.min, 'weight', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.weightKg.max, 'weight', settings.unitSystem)}
                      unit={measurementUnit('weight', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.weightKg.min, 'weight', settings.unitSystem), displayLimit(FH6_LIMITS.weightKg.max, 'weight', settings.unitSystem), measurementUnit('weight', settings.unitSystem))}
                      onChange={(value) => updateVehicle('weightKg', canonicalMeasurementValue(value, 'weight', settings.unitSystem))}
                    />
                    <NumberField
                      label={copy.tune.front}
                      value={vehicle.frontWeightPercent}
                      min={FH6_LIMITS.frontWeightPercent.min}
                      max={FH6_LIMITS.frontWeightPercent.max}
                      unit="%"
                      hint={limitHint(FH6_LIMITS.frontWeightPercent.min, FH6_LIMITS.frontWeightPercent.max, '%')}
                      onChange={(value) => updateVehicle('frontWeightPercent', value)}
                    />
                    <NumberField
                      label={copy.tune.targetTopSpeed}
                      value={displayTargetSpeed(intent.targetTopSpeedKmh, settings.unitSystem)}
                      min={0}
                      max={displayTargetSpeed(TARGET_TOP_SPEED_MAX_KMH, settings.unitSystem)}
                      unit={targetSpeedUnit(settings.unitSystem)}
                      hint={`${copy.tune.targetTopSpeedAuto} · ${limitHint(0, displayTargetSpeed(TARGET_TOP_SPEED_MAX_KMH, settings.unitSystem), targetSpeedUnit(settings.unitSystem))}`}
                      onChange={(value) => updateIntent('targetTopSpeedKmh', canonicalTargetSpeed(value, settings.unitSystem))}
                    />
                  </div>
                </div>

                <div className="controlSection">
                  <div className="sectionTitle">
                    <strong>{copy.tune.hardware}</strong>
                    <span>{vehicle.frontAero || vehicle.rearAero ? copy.tune.aeroActive : copy.tires.stock}</span>
                  </div>
                  <div className="twoColumn">
                    <NumberField
                      label={copy.tune.frontTire}
                      value={displayMeasurementValue(vehicle.frontTireWidth, 'tireWidth', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.frontTireWidth.min, 'tireWidth', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.frontTireWidth.max, 'tireWidth', settings.unitSystem)}
                      step={displayStep(FH6_LIMITS.frontTireWidth.step, 'tireWidth', settings.unitSystem)}
                      unit={measurementUnit('tireWidth', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.frontTireWidth.min, 'tireWidth', settings.unitSystem), displayLimit(FH6_LIMITS.frontTireWidth.max, 'tireWidth', settings.unitSystem), measurementUnit('tireWidth', settings.unitSystem))}
                      onChange={(value) => updateVehicle('frontTireWidth', canonicalMeasurementValue(value, 'tireWidth', settings.unitSystem))}
                    />
                    <NumberField
                      label={copy.tune.rearTire}
                      value={displayMeasurementValue(vehicle.rearTireWidth, 'tireWidth', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.rearTireWidth.min, 'tireWidth', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.rearTireWidth.max, 'tireWidth', settings.unitSystem)}
                      step={displayStep(FH6_LIMITS.rearTireWidth.step, 'tireWidth', settings.unitSystem)}
                      unit={measurementUnit('tireWidth', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.rearTireWidth.min, 'tireWidth', settings.unitSystem), displayLimit(FH6_LIMITS.rearTireWidth.max, 'tireWidth', settings.unitSystem), measurementUnit('tireWidth', settings.unitSystem))}
                      onChange={(value) => updateVehicle('rearTireWidth', canonicalMeasurementValue(value, 'tireWidth', settings.unitSystem))}
                    />
                    <NumberField
                      label={copy.tune.gears}
                      value={vehicle.gearCount}
                      min={FH6_LIMITS.gearCount.min}
                      max={FH6_LIMITS.gearCount.max}
                      hint={limitHint(FH6_LIMITS.gearCount.min, FH6_LIMITS.gearCount.max)}
                      onChange={(value) => updateVehicle('gearCount', Math.round(value))}
                    />
                    {renderRideHeightRangeFields()}
                  </div>

                  <div className="toggleRow">
                    <ToggleField label={copy.tune.frontAero} checked={vehicle.frontAero} onChange={(value) => updateVehicle('frontAero', value)} />
                    <ToggleField label={copy.tune.rearAero} checked={vehicle.rearAero} onChange={(value) => updateVehicle('rearAero', value)} />
                  </div>
                </div>

                <div className="controlSection limitSection">
                  <div className="sectionTitle">
                    <strong>{copy.tune.fh6Limits}</strong>
                    <span>{copy.tune.springRange}</span>
                  </div>
                  <div className="twoColumn">
                    <NumberField
                      label={copy.tune.springFrontMin}
                      value={displayMeasurementValue(vehicle.springRateMinFront, 'springRate', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.springRateMinFront.min, 'springRate', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.springRateMinFront.max, 'springRate', settings.unitSystem)}
                      step={measurementStep('springRate', settings.unitSystem)}
                      unit={measurementUnit('springRate', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.springRateMinFront.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMinFront.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                      onChange={(value) => updateVehicle('springRateMinFront', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                    />
                    <NumberField
                      label={copy.tune.springFrontMax}
                      value={displayMeasurementValue(vehicle.springRateMaxFront, 'springRate', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.springRateMaxFront.min, 'springRate', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.springRateMaxFront.max, 'springRate', settings.unitSystem)}
                      step={measurementStep('springRate', settings.unitSystem)}
                      unit={measurementUnit('springRate', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.springRateMaxFront.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMaxFront.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                      onChange={(value) => updateVehicle('springRateMaxFront', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                    />
                    <NumberField
                      label={copy.tune.springRearMin}
                      value={displayMeasurementValue(vehicle.springRateMinRear, 'springRate', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.springRateMinRear.min, 'springRate', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.springRateMinRear.max, 'springRate', settings.unitSystem)}
                      step={measurementStep('springRate', settings.unitSystem)}
                      unit={measurementUnit('springRate', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.springRateMinRear.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMinRear.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                      onChange={(value) => updateVehicle('springRateMinRear', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                    />
                    <NumberField
                      label={copy.tune.springRearMax}
                      value={displayMeasurementValue(vehicle.springRateMaxRear, 'springRate', settings.unitSystem)}
                      min={displayLimit(FH6_LIMITS.springRateMaxRear.min, 'springRate', settings.unitSystem)}
                      max={displayLimit(FH6_LIMITS.springRateMaxRear.max, 'springRate', settings.unitSystem)}
                      step={measurementStep('springRate', settings.unitSystem)}
                      unit={measurementUnit('springRate', settings.unitSystem)}
                      hint={limitHint(displayLimit(FH6_LIMITS.springRateMaxRear.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMaxRear.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                      onChange={(value) => updateVehicle('springRateMaxRear', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                    />
                  </div>
                </div>
              </aside>
              ) : null}

              {activeTunePanel === 'assistant' ? (
                <aside className="panel tuneAssistantPanel">
                  <div className="panelHeader">
                    <div>
                      <span className="eyebrow">{copy.tune.fastBuild}</span>
                      <h3>{copy.tune.fastBuildTitle}</h3>
                    </div>
                    <ListChecks size={20} />
                  </div>

                  <div className="noticeLine assistantNotice">
                    <BadgeInfo size={17} />
                    <span>{copy.tune.fastBuildNote}</span>
                  </div>

                  {renderVerificationStrip(true)}

                  <div className="controlSection assistantTargetSection">
                    <div className="sectionTitle stackedSectionTitle">
                      <strong>{copy.tune.buildTarget}</strong>
                      <span>{copy.tune.buildToTarget}</span>
                    </div>
                    <Segmented label={copy.tune.targetClass} options={advisorClassChoices} value={activeAdvisorTargetClass} onChange={updateAdvisorTargetClass} />
                    <NumberField
                      label={copy.tune.targetPi}
                      value={activeAdvisorTargetPi}
                      min={advisorTargetRange.min}
                      max={advisorTargetRange.max}
                      hint={limitHint(advisorTargetRange.min, advisorTargetRange.max)}
                      onChange={setAdvisorTargetPi}
                    />
                    <Segmented label={copy.tune.buildStyle} options={buildAssistantStyleChoices} value={buildAssistantStyle} onChange={setBuildAssistantStyle} />

                    <div className="assistantOverview">
                      <div>
                        <span>{copy.tune.advisorCurrent}</span>
                        <strong><PiBadge carClass={vehicle.carClass} pi={vehicle.buildPi} /></strong>
                      </div>
                      <div>
                        <span>{copy.tune.target}</span>
                        <strong><PiBadge carClass={activeAdvisorTargetClass} pi={activeAdvisorTargetPi} /></strong>
                      </div>
                      <div className={className(buildAssistantInTarget ? 'success' : buildAssistantGap < 0 ? 'warning' : '')}>
                        <span>{copy.tune.piWindow}</span>
                        <strong>{buildAssistantInTarget ? copy.tune.readyForTuneLab : buildAssistantGap > 0 ? `+${buildAssistantGap}` : buildAssistantGap}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="controlSection assistantPrioritySection">
                    <div className="sectionTitle stackedSectionTitle">
                      <strong>{copy.tune.upgradePriority}</strong>
                      <span>{copy.tune.installInFH6}</span>
                    </div>
                    <div className="assistantStepList">
                      {buildAssistantSteps.map((step) => (
                        <div className={className('assistantStep', step.changed && 'active')} key={step.key}>
                          <span>{step.index}</span>
                          <div>
                            <strong>{step.label}</strong>
                            <small>{step.hint}</small>
                          </div>
                          <b>{step.suggestion}</b>
                        </div>
                      ))}
                    </div>
                  </div>

                  {renderAdvisorInstallChecklist()}

                  <div className="controlSection assistantCheckSection">
                    <div className="sectionTitle stackedSectionTitle">
                      <strong>{copy.tune.finalBuildCheck}</strong>
                      <span>{copy.tune.verifyInFH6}</span>
                    </div>
                    <div className="assistantCheckGrid">
                      {buildAssistantChecks.map((item) => (
                        <div className={className('assistantCheck', item.ok ? 'success' : 'warning')} key={item.label}>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="actionGrid">
                    <button className="toolButton" type="button" disabled={!advisorCanSuggest} onClick={applyAdvisorRecommendation}>
                      <Check size={17} />
                      <span>{copy.tune.applyEstimate}</span>
                    </button>
                    <button className="toolButton primary" type="button" onClick={() => setActiveTunePanel('calibration')}>
                      <Gauge size={17} />
                      <span>{copy.tune.openCalibration}</span>
                    </button>
                  </div>
                </aside>
              ) : null}

              {activeTunePanel === 'calibration' ? (
                <aside className="panel tuneCalibrationPanel">
                  <div className="panelHeader">
                    <div>
                      <span className="eyebrow">{copy.tune.calibration}</span>
                      <h3>{copy.tune.calibrationTitle}</h3>
                    </div>
                    <Gauge size={20} />
                  </div>

                  <div className="noticeLine calibrationNotice">
                    <BadgeInfo size={17} />
                    <span>{copy.tune.calibrationNote}</span>
                  </div>

                  {renderVerificationStrip(true)}

                  <div className="controlSection calibrationSection">
                    <div className="sectionTitle">
                      <strong>{copy.tune.calibrationSnapshot}</strong>
                      <span>{vehicle.carName}</span>
                    </div>
                    <div className="twoColumn">
                      <NumberField
                        label={copy.tune.buildPi}
                        value={vehicle.buildPi}
                        min={FH6_LIMITS.buildPi.min}
                        max={FH6_LIMITS.buildPi.max}
                        hint={limitHint(FH6_LIMITS.buildPi.min, FH6_LIMITS.buildPi.max)}
                        onChange={(value) => updateVehicle('buildPi', value)}
                      />
                      <NumberField
                        label={copy.tune.front}
                        value={vehicle.frontWeightPercent}
                        min={FH6_LIMITS.frontWeightPercent.min}
                        max={FH6_LIMITS.frontWeightPercent.max}
                        unit="%"
                        hint={limitHint(FH6_LIMITS.frontWeightPercent.min, FH6_LIMITS.frontWeightPercent.max, '%')}
                        onChange={(value) => updateVehicle('frontWeightPercent', value)}
                      />
                      <NumberField
                        label={copy.tune.power}
                        value={displayMeasurementValue(vehicle.horsepower, 'power', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.horsepower.min, 'power', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.horsepower.max, 'power', settings.unitSystem)}
                        unit={measurementUnit('power', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.horsepower.min, 'power', settings.unitSystem), displayLimit(FH6_LIMITS.horsepower.max, 'power', settings.unitSystem), measurementUnit('power', settings.unitSystem))}
                        onChange={(value) => updateVehicle('horsepower', canonicalMeasurementValue(value, 'power', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.torque}
                        value={displayMeasurementValue(vehicle.torqueNm, 'torque', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.torqueNm.min, 'torque', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.torqueNm.max, 'torque', settings.unitSystem)}
                        unit={measurementUnit('torque', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.torqueNm.min, 'torque', settings.unitSystem), displayLimit(FH6_LIMITS.torqueNm.max, 'torque', settings.unitSystem), measurementUnit('torque', settings.unitSystem))}
                        onChange={(value) => updateVehicle('torqueNm', canonicalMeasurementValue(value, 'torque', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.weight}
                        value={displayMeasurementValue(vehicle.weightKg, 'weight', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.weightKg.min, 'weight', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.weightKg.max, 'weight', settings.unitSystem)}
                        unit={measurementUnit('weight', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.weightKg.min, 'weight', settings.unitSystem), displayLimit(FH6_LIMITS.weightKg.max, 'weight', settings.unitSystem), measurementUnit('weight', settings.unitSystem))}
                        onChange={(value) => updateVehicle('weightKg', canonicalMeasurementValue(value, 'weight', settings.unitSystem))}
                      />
                    </div>
                  </div>

                  <div className="controlSection calibrationSection">
                    <div className="sectionTitle">
                      <strong>{copy.tune.calibrationRanges}</strong>
                      <span>{copy.tune.fh6Limits}</span>
                    </div>
                    <div className="twoColumn">
                      <NumberField
                        label={copy.tune.frontTire}
                        value={displayMeasurementValue(vehicle.frontTireWidth, 'tireWidth', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.frontTireWidth.min, 'tireWidth', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.frontTireWidth.max, 'tireWidth', settings.unitSystem)}
                        step={displayStep(FH6_LIMITS.frontTireWidth.step, 'tireWidth', settings.unitSystem)}
                        unit={measurementUnit('tireWidth', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.frontTireWidth.min, 'tireWidth', settings.unitSystem), displayLimit(FH6_LIMITS.frontTireWidth.max, 'tireWidth', settings.unitSystem), measurementUnit('tireWidth', settings.unitSystem))}
                        onChange={(value) => updateVehicle('frontTireWidth', canonicalMeasurementValue(value, 'tireWidth', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.rearTire}
                        value={displayMeasurementValue(vehicle.rearTireWidth, 'tireWidth', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.rearTireWidth.min, 'tireWidth', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.rearTireWidth.max, 'tireWidth', settings.unitSystem)}
                        step={displayStep(FH6_LIMITS.rearTireWidth.step, 'tireWidth', settings.unitSystem)}
                        unit={measurementUnit('tireWidth', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.rearTireWidth.min, 'tireWidth', settings.unitSystem), displayLimit(FH6_LIMITS.rearTireWidth.max, 'tireWidth', settings.unitSystem), measurementUnit('tireWidth', settings.unitSystem))}
                        onChange={(value) => updateVehicle('rearTireWidth', canonicalMeasurementValue(value, 'tireWidth', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.gears}
                        value={vehicle.gearCount}
                        min={FH6_LIMITS.gearCount.min}
                        max={FH6_LIMITS.gearCount.max}
                        hint={limitHint(FH6_LIMITS.gearCount.min, FH6_LIMITS.gearCount.max)}
                        onChange={(value) => updateVehicle('gearCount', Math.round(value))}
                      />
                      {renderRideHeightRangeFields()}
                      <NumberField
                        label={copy.tune.springFrontMin}
                        value={displayMeasurementValue(vehicle.springRateMinFront, 'springRate', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.springRateMinFront.min, 'springRate', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.springRateMinFront.max, 'springRate', settings.unitSystem)}
                        step={measurementStep('springRate', settings.unitSystem)}
                        unit={measurementUnit('springRate', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.springRateMinFront.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMinFront.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                        onChange={(value) => updateVehicle('springRateMinFront', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.springFrontMax}
                        value={displayMeasurementValue(vehicle.springRateMaxFront, 'springRate', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.springRateMaxFront.min, 'springRate', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.springRateMaxFront.max, 'springRate', settings.unitSystem)}
                        step={measurementStep('springRate', settings.unitSystem)}
                        unit={measurementUnit('springRate', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.springRateMaxFront.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMaxFront.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                        onChange={(value) => updateVehicle('springRateMaxFront', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.springRearMin}
                        value={displayMeasurementValue(vehicle.springRateMinRear, 'springRate', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.springRateMinRear.min, 'springRate', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.springRateMinRear.max, 'springRate', settings.unitSystem)}
                        step={measurementStep('springRate', settings.unitSystem)}
                        unit={measurementUnit('springRate', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.springRateMinRear.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMinRear.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                        onChange={(value) => updateVehicle('springRateMinRear', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.springRearMax}
                        value={displayMeasurementValue(vehicle.springRateMaxRear, 'springRate', settings.unitSystem)}
                        min={displayLimit(FH6_LIMITS.springRateMaxRear.min, 'springRate', settings.unitSystem)}
                        max={displayLimit(FH6_LIMITS.springRateMaxRear.max, 'springRate', settings.unitSystem)}
                        step={measurementStep('springRate', settings.unitSystem)}
                        unit={measurementUnit('springRate', settings.unitSystem)}
                        hint={limitHint(displayLimit(FH6_LIMITS.springRateMaxRear.min, 'springRate', settings.unitSystem), displayLimit(FH6_LIMITS.springRateMaxRear.max, 'springRate', settings.unitSystem), measurementUnit('springRate', settings.unitSystem))}
                        onChange={(value) => updateVehicle('springRateMaxRear', canonicalMeasurementValue(value, 'springRate', settings.unitSystem))}
                      />
                    </div>
                  </div>

                  <div className="controlSection calibrationSection aeroCalibrationSection">
                    <div className="sectionTitle stackedSectionTitle">
                      <strong>{copy.tune.calibrationAero}</strong>
                      <span>{copy.tune.calibrationAeroNote}</span>
                    </div>
                    <div className="toggleRow">
                      <ToggleField label={copy.tune.frontAero} checked={vehicle.frontAero} onChange={(value) => updateVehicle('frontAero', value)} />
                      <ToggleField label={copy.tune.rearAero} checked={vehicle.rearAero} onChange={(value) => updateVehicle('rearAero', value)} />
                    </div>
                    <div className="twoColumn">
                      <NumberField
                        label={copy.tune.frontAeroMin}
                        value={displayMeasurementValue(vehicle.frontAeroMinLb, 'aeroDownforce', settings.unitSystem)}
                        min={displayLimit(0, 'aeroDownforce', settings.unitSystem)}
                        max={displayLimit(10000, 'aeroDownforce', settings.unitSystem)}
                        step={measurementStep('aeroDownforce', settings.unitSystem)}
                        unit={measurementUnit('aeroDownforce', settings.unitSystem)}
                        hint={copy.tune.speedSide}
                        onChange={(value) => updateVehicle('frontAeroMinLb', canonicalMeasurementValue(value, 'aeroDownforce', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.frontAeroMax}
                        value={displayMeasurementValue(vehicle.frontAeroMaxLb, 'aeroDownforce', settings.unitSystem)}
                        min={displayLimit(0, 'aeroDownforce', settings.unitSystem)}
                        max={displayLimit(10000, 'aeroDownforce', settings.unitSystem)}
                        step={measurementStep('aeroDownforce', settings.unitSystem)}
                        unit={measurementUnit('aeroDownforce', settings.unitSystem)}
                        hint={copy.tune.corneringSide}
                        onChange={(value) => updateVehicle('frontAeroMaxLb', canonicalMeasurementValue(value, 'aeroDownforce', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.rearAeroMin}
                        value={displayMeasurementValue(vehicle.rearAeroMinLb, 'aeroDownforce', settings.unitSystem)}
                        min={displayLimit(0, 'aeroDownforce', settings.unitSystem)}
                        max={displayLimit(10000, 'aeroDownforce', settings.unitSystem)}
                        step={measurementStep('aeroDownforce', settings.unitSystem)}
                        unit={measurementUnit('aeroDownforce', settings.unitSystem)}
                        hint={copy.tune.speedSide}
                        onChange={(value) => updateVehicle('rearAeroMinLb', canonicalMeasurementValue(value, 'aeroDownforce', settings.unitSystem))}
                      />
                      <NumberField
                        label={copy.tune.rearAeroMax}
                        value={displayMeasurementValue(vehicle.rearAeroMaxLb, 'aeroDownforce', settings.unitSystem)}
                        min={displayLimit(0, 'aeroDownforce', settings.unitSystem)}
                        max={displayLimit(10000, 'aeroDownforce', settings.unitSystem)}
                        step={measurementStep('aeroDownforce', settings.unitSystem)}
                        unit={measurementUnit('aeroDownforce', settings.unitSystem)}
                        hint={copy.tune.corneringSide}
                        onChange={(value) => updateVehicle('rearAeroMaxLb', canonicalMeasurementValue(value, 'aeroDownforce', settings.unitSystem))}
                      />
                    </div>
                  </div>
                </aside>
              ) : null}

              {activeTunePanel === 'summary' ? (
                <aside className="panel tuneSummaryPanel">
                  <div className="panelHeader">
                    <div>
                      <span className="eyebrow">{copy.tune.summary}</span>
                      <h3>{copy.tune.setupFit}</h3>
                    </div>
                    <ShieldCheck size={20} />
                  </div>

                  <div className={className('summaryScore', fitIssueCount === 0 ? 'success' : 'warning')}>
                    <span>{copy.tune.setupFit}</span>
                    <strong>{fitScore}%</strong>
                    <small>{fitIssueCount === 0 ? copy.tune.fitReady : copy.tune.fitReview}</small>
                  </div>

                  {renderVerificationStrip(true)}

                  <div className="summaryStats">
                    <Stat label={copy.tune.buildPi} value={<PiBadge pi={vehicle.buildPi} carClass={vehicle.carClass} />} />
                    <Stat label={copy.tune.balance} value={`${vehicle.frontWeightPercent}/${rearWeight}`} />
                    <Stat label={copy.tune.strictness} value={strictnessLabel} />
                  </div>

                  <div className="summaryHighlights">
                    {tuneHighlights.map((item) => (
                      <div className="digestCard" key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </div>
                    ))}
                  </div>

                  <div className="fitList summaryFitList">
                    {fitItems.map((item) => (
                      <div className={className('fitItem', item.ok ? 'success' : 'warning')} key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="noticeLine summaryNotice">
                    <Sparkles size={17} />
                    <span>{displayResult.notes.join(' ') || copy.tune.readyNote}</span>
                  </div>

                  <div className="actionGrid">
                    <button className="toolButton" type="button" onClick={() => fileInputRef.current?.click()}>
                      <Import size={17} />
                      <span>{copy.actions.import}</span>
                    </button>
                    <button className="toolButton" type="button" onClick={exportTune}>
                      <Upload size={17} />
                      <span>{copy.actions.json}</span>
                    </button>
                    <button
                      className="toolButton"
                      type="button"
                      onClick={() => {
                        setVehicle(normalizeVehicle(defaultVehicle));
                        setIntent(normalizeIntent(defaultIntent));
                      }}
                    >
                      <RotateCcw size={17} />
                      <span>{copy.actions.reset}</span>
                    </button>
                    <button className="toolButton primary" type="button" onClick={saveCurrentProfile}>
                      <Save size={17} />
                      <span>{copy.actions.save}</span>
                    </button>
                  </div>
                </aside>
              ) : null}

              <section className="tuneOutput">
                <div className="tuneHero">
                  <div>
                    <span className="eyebrow">{copy.tune.formulaStack}</span>
                    <h2>{displayResult.summary}</h2>
                    <p>{copy.tune.tuneSheetGuide} {copy.tune.formulaStackGuide}</p>
                  </div>
                  <div className="sheetMeta">
                    <span>{vehicle.drivetrain}</span>
                    <span>{vehicle.frontWeightPercent}/{rearWeight} {copy.tune.balance}</span>
                  </div>
                </div>

                <div className="formulaStrip">
                  <div>
                    <span>{copy.tune.exactInputs}</span>
                    <strong>{exactInputCount}/{tuneValueCount}</strong>
                  </div>
                  <div>
                    <span>{copy.tune.sliderTargets}</span>
                    <strong>{sliderTargetCount}</strong>
                  </div>
                  <div>
                    <span>{copy.tune.upgradeLocks}</span>
                    <strong>{upgradeLockCount}</strong>
                  </div>
                  <div>
                    <span>{copy.tune.verification}</span>
                    <strong>{verifiedSnapshot && verifiedReachRecord ? copy.tune.verified : copy.tune.unverified}</strong>
                  </div>
                </div>

                <div className="tuneGrid">
                  {tuneSheetColumns.map((column, columnIndex) => (
                    <div className="tuneMasonryColumn" key={`tune-column-${columnIndex}`}>
                      {column.map((section) => {
                        const stats = tuneSectionStats.get(section.id);

                        return (
                          <article className={className('tuneSection', `section-${section.id}`)} key={section.id}>
                            <h3>
                              <span>{section.title}</span>
                              <small>
                                {(stats?.exact ?? 0) + (stats?.slider ?? 0)}/{stats?.total ?? section.values.length} {copy.tune.inputGuard}
                              </small>
                            </h3>
                            <div className="valueList">
                              {section.values.map((item) => (
                                <div className={className('valueRow', item.inputKind && `input-${item.inputKind}`)} key={`${section.id}-${item.label}`}>
                                  <div>
                                    <span>{item.label}</span>
                                    <small>{item.detail}</small>
                                    {item.instruction ? (
                                      <small className="valueInstruction">
                                        <b>{item.inputKind ? copy.tune.inputKinds[item.inputKind] : copy.tune.inputGuard}</b>
                                        <span>{item.instruction}</span>
                                      </small>
                                    ) : null}
                                    {item.formula ? (
                                      <small className="valueFormula">
                                        <b>{copy.tune.formula}</b>
                                        <span>{item.formula}</span>
                                      </small>
                                    ) : null}
                                  </div>
                                  <strong>{item.value}</strong>
                                </div>
                              ))}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </section>

              {activeTunePanel === 'feel' ? (
              <aside className="panel fineTune">
                <div className="panelHeader">
                  <div>
                    <span className="eyebrow">{copy.tune.feel}</span>
                    <h3>{copy.tune.handling}</h3>
                  </div>
                  <Sparkles size={20} />
                </div>

                <div className="feelSummary">
                  <div>
                    <span>{copy.tune.rotation}</span>
                    <strong>{intent.rotation > 0 ? copy.tune.agile : intent.rotation < 0 ? copy.tune.safe : copy.tune.neutral}</strong>
                  </div>
                  <div>
                    <span>{copy.tune.speed}</span>
                    <strong>{intent.speedBias > 0 ? 'Vmax' : intent.speedBias < 0 ? copy.tune.punch : copy.tune.balanced}</strong>
                  </div>
                </div>

                {renderVerificationStrip(true)}

                <SliderControl label={copy.tune.rotation} scale={copy.intentScale.rotation} value={intent.rotation} onChange={(value) => updateIntent('rotation', value)} />
                <SliderControl label={copy.tune.stability} scale={copy.intentScale.stability} value={intent.stability} onChange={(value) => updateIntent('stability', value)} />
                <SliderControl label={copy.tune.speed} scale={copy.intentScale.speedBias} value={intent.speedBias} onChange={(value) => updateIntent('speedBias', value)} />
                <SliderControl label={copy.tune.kerbs} scale={copy.intentScale.compliance} value={intent.compliance} onChange={(value) => updateIntent('compliance', value)} />

                <div className="actionGrid">
                  <button className="toolButton" type="button" onClick={() => fileInputRef.current?.click()}>
                    <Import size={17} />
                    <span>{copy.actions.import}</span>
                  </button>
                    <button className="toolButton" type="button" onClick={exportTune}>
                      <Upload size={17} />
                      <span>{copy.actions.json}</span>
                    </button>
                  <button
                    className="toolButton"
                    type="button"
                    onClick={() => {
                      setVehicle(normalizeVehicle(defaultVehicle));
                      setIntent(normalizeIntent(defaultIntent));
                    }}
                  >
                    <RotateCcw size={17} />
                    <span>{copy.actions.reset}</span>
                  </button>
                  <button className="toolButton primary" type="button" onClick={saveCurrentProfile}>
                    <Save size={17} />
                    <span>{copy.actions.save}</span>
                  </button>
                </div>

                <div className="noticeLine">
                  <Sparkles size={17} />
                  <span>{displayResult.notes.join(' ') || copy.tune.readyNote}</span>
                </div>
              </aside>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeView === 'setups' ? (
          <section className="view setupView">
            <section className="panel">
              <div className="panelHeader">
                <div>
                  <span className="eyebrow">{copy.setups.profiles}</span>
                  <h3>{copy.setups.title}</h3>
                </div>
                <button className="iconButton primary" type="button" onClick={saveCurrentProfile}>
                  <Save size={18} />
                  <span>{copy.actions.currentSave}</span>
                </button>
              </div>

              <div className="profileList">
                {profiles.length === 0 ? (
                  <p className="emptyState">{copy.setups.empty}</p>
                ) : (
                  profiles.map((profile) => (
                    <div className="profileRow" key={profile.id}>
                      <button type="button" onClick={() => loadProfile(profile)}>
                        <strong>{profile.name}</strong>
                        <span>
                          {(profile.vehicle.buildPi ?? profile.vehicle.sourcePi)} {profile.vehicle.carClass} · {profile.vehicle.drivetrain} ·{' '}
                          {new Date(profile.createdAt).toLocaleDateString(localeByLanguage[settings.language])}
                        </span>
                      </button>
                      <button className="deleteButton" title={copy.setups.delete} type="button" onClick={() => deleteProfile(profile.id)}>
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </section>
        ) : null}

        {activeView === 'updates' ? (
          <section className="view updatesView">
            <section className="panel updatesPanel">
              <div className="panelHeader">
                <div>
                  <span className="eyebrow">{copy.updates.eyebrow}</span>
                  <h3>{copy.updates.title}</h3>
                  <p className="panelCopy">{copy.updates.intro}</p>
                </div>
                <RefreshCw size={21} />
              </div>

              <div className="detailGrid updateVersionGrid">
                <Stat label={copy.updates.installed} value={APP_VERSION} accent />
                <Stat label={copy.updates.online} value={updateResult?.latestVersion ?? '-'} />
                <Stat label={copy.updates.lastChecked} value={updateLastChecked} />
                <Stat label={copy.settings.updated} value={updatePublishedAt} />
              </div>

              <button className="toolButton primary updateCheckButton" type="button" disabled={updateState === 'checking'} onClick={runUpdateCheck}>
                <RefreshCw size={17} />
                {updateState === 'checking' ? copy.updates.checking : copy.updates.check}
              </button>

              <div className={className('updateStatusCard', updateStatusTone)}>
                <strong>{updateStatusText}</strong>
                {updateError ? <span>{updateError}</span> : <span>{updateDetailText}</span>}
              </div>

              <div className="releaseNotesBox">
                <div>
                  <strong>{copy.updates.releaseNotes}</strong>
                  <span>{updateResult?.releaseName ?? '-'}</span>
                </div>
                <p>{updateResult?.releaseNotes || copy.updates.noReleaseNotes}</p>
              </div>

              <div className="updateActions">
                <button
                  className={className('toolButton', updateResult?.status === 'available' && updateResult.setupDownloadUrl && 'primary')}
                  type="button"
                  disabled={updateResult?.status !== 'available' || !updateResult?.setupDownloadUrl || updateInstallState === 'downloading'}
                  onClick={installUpdate}
                >
                  <ArrowDownToLine size={16} />
                  {updateInstallState === 'downloading' ? copy.updates.downloading : copy.updates.installSetup}
                </button>
              </div>

              <div className="supportBox">
                <div>
                  <Coffee size={19} />
                  <div>
                    <strong>{copy.updates.supportTitle}</strong>
                    <span>{copy.updates.supportText}</span>
                  </div>
                </div>
                <a className="toolButton supportButton" href="https://buymeacoffee.com/xvex" target="_blank" rel="noreferrer">
                  <ExternalLink size={16} />
                  {copy.updates.supportButton}
                </a>
              </div>
            </section>
          </section>
        ) : null}

        {activeView === 'settings' ? (
          <section className="view settingsView">
            <section className="panel settingsPanel systemSettingsPanel">
              <div className="panelHeader">
                <div>
                  <span className="eyebrow">{copy.settings.system}</span>
                  <h3>{copy.settings.title}</h3>
                </div>
                <Settings size={21} />
              </div>

              <div className="settingsGrid">
                <SettingsChoiceRow
                  id="setting-language"
                  label={copy.settings.language}
                  options={languageOptions}
                  value={settings.language}
                  open={openSettingId === 'setting-language'}
                  onOpenChange={setOpenSettingId}
                  onChange={(value: AppLanguage) => updateSettings('language', value)}
                />
                <SettingsChoiceRow
                  id="setting-units"
                  label={copy.settings.units}
                  options={unitChoices}
                  value={settings.unitSystem}
                  open={openSettingId === 'setting-units'}
                  onOpenChange={setOpenSettingId}
                  onChange={(value: UnitSystem) => updateSettings('unitSystem', value)}
                />
                <SettingsChoiceRow
                  id="setting-ui-density"
                  label={copy.settings.density}
                  options={uiDensityChoices}
                  value={settings.density}
                  open={openSettingId === 'setting-ui-density'}
                  onOpenChange={setOpenSettingId}
                  onChange={(value: UiDensity) => updateSettings('density', value)}
                />
                <SettingsChoiceRow
                  id="setting-garage-density"
                  label={copy.settings.garageDensity}
                  options={garageDensityChoices}
                  value={settings.garageDensity}
                  open={openSettingId === 'setting-garage-density'}
                  onOpenChange={setOpenSettingId}
                  onChange={(value: GarageDensity) => updateSettings('garageDensity', value)}
                />
                <SettingsChoiceRow
                  id="setting-low-vram"
                  label={copy.settings.lowVramMode}
                  options={binaryChoices}
                  value={settings.lowVramMode}
                  open={openSettingId === 'setting-low-vram'}
                  onOpenChange={setOpenSettingId}
                  onChange={(value: boolean) => updateSettings('lowVramMode', value)}
                />
                <SettingsChoiceRow
                  id="setting-tune-strictness"
                  label={copy.settings.tuneStrictness}
                  options={tuneStrictnessChoices}
                  value={settings.tuneStrictness}
                  open={openSettingId === 'setting-tune-strictness'}
                  onOpenChange={setOpenSettingId}
                  onChange={(value: TuneStrictness) => updateSettings('tuneStrictness', value)}
                />
                <SettingsChoiceRow
                  id="setting-spec-source"
                  label={copy.settings.showSpecSource}
                  options={binaryChoices}
                  value={settings.showSpecSource}
                  open={openSettingId === 'setting-spec-source'}
                  onOpenChange={setOpenSettingId}
                  onChange={(value: boolean) => updateSettings('showSpecSource', value)}
                />
                <SettingsChoiceRow
                  id="setting-default-surface"
                  label={copy.settings.defaultSurface}
                  options={surfaceChoices}
                  value={settings.defaultSurface}
                  open={openSettingId === 'setting-default-surface'}
                  onOpenChange={setOpenSettingId}
                  onChange={(value: Surface) => updateSettings('defaultSurface', value)}
                />
              </div>

              <div className="settingsActions">
                <span className={className('settingsStatus', settingsDirty && 'dirty')}>{settingsStatusText}</span>
                <div>
                  <button className="toolButton" type="button" onClick={resetAppSettings}>
                    <RotateCcw size={16} />
                    {copy.settings.resetDefaults}
                  </button>
                  <button className="toolButton primary" type="button" disabled={!settingsDirty} onClick={saveAppSettings}>
                    <Save size={16} />
                    {copy.settings.saveSettings}
                  </button>
                </div>
              </div>
            </section>

            <section className="panel settingsPanel dataSettingsPanel">
              <div className="panelHeader">
                <div>
                  <span className="eyebrow">{copy.settings.data}</span>
                  <h3>{copy.settings.database}</h3>
                </div>
                <Database size={21} />
              </div>

              <div className="detailGrid">
                <Stat label={copy.settings.dataset} value={FH6_CAR_DATA_SOURCE.name} className="datasetStat" />
                <Stat label={copy.settings.cars} value={String(FH6_CAR_DATA_SOURCE.total)} accent />
                <Stat label={copy.settings.updated} value={FH6_CAR_DATA_SOURCE.officialUpdatedAt} />
                <Stat label={copy.settings.extracted} value={FH6_CAR_DATA_SOURCE.extractedAt} />
                <Stat label={copy.settings.appVersion} value={APP_VERSION} />
                <Stat label={copy.settings.game} value="Forza Horizon 6" />
              </div>

              <div className="linkRow">
                <a href={FH6_CAR_DATA_SOURCE.sourceUrl} target="_blank" rel="noreferrer">
                  {copy.settings.officialCarList} <ExternalLink size={15} />
                </a>
                <a href={FH6_CAR_DATA_SOURCE.gamePageUrl} target="_blank" rel="noreferrer">
                  {copy.settings.gamePage} <ExternalLink size={15} />
                </a>
              </div>
            </section>

            <section className="panel settingsPanel creditsPanel">
              <div className="panelHeader">
                <div>
                  <span className="eyebrow">{copy.settings.credits}</span>
                  <h3>{copy.settings.about}</h3>
                </div>
                <BadgeInfo size={21} />
              </div>

              <div className="detailGrid">
                <Stat label={copy.settings.createdBy} value={APP_CREATOR} accent />
                <Stat label={copy.settings.build} value={`${APP_NAME} ${APP_VERSION}`} />
                <Stat label={copy.settings.platform} value="Windows Desktop" />
              </div>

              <div className="creditCopy">
                <p>{copy.settings.creatorNote}</p>
                <p>{copy.settings.disclaimer}</p>
              </div>
            </section>
          </section>
        ) : null}

        <input ref={fileInputRef} className="hiddenInput" type="file" accept="application/json,.json" onChange={importTune} />
      </main>
    </div>
  );
}

export default App;
