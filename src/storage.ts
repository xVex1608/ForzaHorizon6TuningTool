import type { AppSettings, SavedProfile, VerifiedVehicleReach, VerifiedVehicleSnapshot } from './types';

const PROFILES_STORAGE_KEY = 'fh6-tuning-tool:profiles';
const SETTINGS_STORAGE_KEY = 'fh6-tuning-tool:settings';
const VERIFIED_SNAPSHOTS_STORAGE_KEY = 'fh6-tuning-tool:verified-snapshots';
const VERIFIED_REACH_STORAGE_KEY = 'fh6-tuning-tool:verified-reach';
const FH6_DATA_STORE_SCHEMA_VERSION = 1;

export interface FH6DataStore {
  schemaVersion: number;
  savedAt: string;
  verifiedSnapshots: Record<string, VerifiedVehicleSnapshot>;
  verifiedReach: Record<string, VerifiedVehicleReach>;
}

export const defaultSettings: AppSettings = {
  language: 'en',
  unitSystem: 'metric',
  density: 'comfortable',
  garageDensity: 'comfortable',
  lowVramMode: false,
  tuneStrictness: 'balanced',
  showSpecSource: true,
  defaultSurface: 'road',
};

export function loadProfiles(): SavedProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: SavedProfile[]) {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export function loadVerifiedSnapshots(): Record<string, VerifiedVehicleSnapshot> {
  try {
    const raw = localStorage.getItem(VERIFIED_SNAPSHOTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveVerifiedSnapshots(snapshots: Record<string, VerifiedVehicleSnapshot>) {
  localStorage.setItem(VERIFIED_SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
}

export function loadVerifiedReach(): Record<string, VerifiedVehicleReach> {
  try {
    const raw = localStorage.getItem(VERIFIED_REACH_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveVerifiedReach(reach: Record<string, VerifiedVehicleReach>) {
  localStorage.setItem(VERIFIED_REACH_STORAGE_KEY, JSON.stringify(reach));
}

function asRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

export function createFH6DataStore(
  verifiedSnapshots: Record<string, VerifiedVehicleSnapshot>,
  verifiedReach: Record<string, VerifiedVehicleReach>,
): FH6DataStore {
  return {
    schemaVersion: FH6_DATA_STORE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    verifiedSnapshots,
    verifiedReach,
  };
}

export function normalizeFH6DataStore(value: unknown): FH6DataStore {
  const record = asRecord<unknown>(value);

  return {
    schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : FH6_DATA_STORE_SCHEMA_VERSION,
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date().toISOString(),
    verifiedSnapshots: asRecord<VerifiedVehicleSnapshot>(record.verifiedSnapshots),
    verifiedReach: asRecord<VerifiedVehicleReach>(record.verifiedReach),
  };
}

export function hasFH6DataStoreEntries(store: FH6DataStore) {
  return Object.keys(store.verifiedSnapshots).length > 0 || Object.keys(store.verifiedReach).length > 0;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaultSettings;
    }

    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
