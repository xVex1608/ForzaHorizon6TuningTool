import type { FH6DataStore } from './storage';

export {};

declare global {
  interface Window {
    forzaDesktop?: {
      platform: string;
      loadFH6Data?: () => Promise<{
        ok: boolean;
        path?: string;
        data?: FH6DataStore | null;
        error?: string;
      }>;
      saveFH6Data?: (data: FH6DataStore) => Promise<{
        ok: boolean;
        path?: string;
        error?: string;
      }>;
      installUpdate?: (request: { url: string; fileName: string }) => Promise<{
        ok: boolean;
        skipped?: boolean;
        path?: string;
        error?: string;
      }>;
    };
  }
}
