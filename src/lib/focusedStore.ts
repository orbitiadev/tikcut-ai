import type { PlannedCut } from './types';

export type FocusedFormat = 'original' | 'vertical';

export type FocusedSettings = {
  mode: 'automatic' | 'manual';
  count: number;
  minSeconds: number;
  maxSeconds: number;
  format: FocusedFormat;
  saveGenerated: boolean;
  prefix: string;
};

export type FocusedProjectSnapshot = {
  id: string;
  sourceName: string;
  sourceSize: number;
  sourceLastModified: number;
  sourceDuration: number;
  cuts: PlannedCut[];
  settings: FocusedSettings;
  createdAt: string;
  updatedAt: string;
};

export type FocusedOutputRecord = {
  id: string;
  filename: string;
  sourceName: string;
  start: number;
  end: number;
  kind: FocusedFormat;
  size: number;
  createdAt: string;
  blob: Blob | null;
};

const SETTINGS_KEY = 'tikcut.focused.settings.v1';
const PROJECT_KEY = 'tikcut.focused.project.v1';
const DB_NAME = 'tikcut-focused-v1';
const STORE_NAME = 'outputs';
const DB_VERSION = 1;
const MAX_SAVED_OUTPUTS = 12;
const MAX_SAVED_BYTES = 300 * 1024 * 1024;
const MAX_SINGLE_BLOB = 90 * 1024 * 1024;

export const DEFAULT_FOCUSED_SETTINGS: FocusedSettings = {
  mode: 'automatic',
  count: 10,
  minSeconds: 30,
  maxSeconds: 90,
  format: 'original',
  saveGenerated: true,
  prefix: 'tikcut',
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function loadFocusedSettings(): FocusedSettings {
  if (typeof window === 'undefined') return DEFAULT_FOCUSED_SETTINGS;
  const saved = safeParse<Partial<FocusedSettings>>(localStorage.getItem(SETTINGS_KEY));
  return {
    ...DEFAULT_FOCUSED_SETTINGS,
    ...saved,
    count: Math.max(1, Math.min(30, Number(saved?.count ?? DEFAULT_FOCUSED_SETTINGS.count))),
    minSeconds: Math.max(15, Math.min(600, Number(saved?.minSeconds ?? DEFAULT_FOCUSED_SETTINGS.minSeconds))),
    maxSeconds: Math.max(15, Math.min(600, Number(saved?.maxSeconds ?? DEFAULT_FOCUSED_SETTINGS.maxSeconds))),
  };
}

export function saveFocusedSettings(settings: FocusedSettings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadFocusedProject(): FocusedProjectSnapshot | null {
  if (typeof window === 'undefined') return null;
  return safeParse<FocusedProjectSnapshot>(localStorage.getItem(PROJECT_KEY));
}

export function saveFocusedProject(project: FocusedProjectSnapshot) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

export function clearFocusedProject() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PROJECT_KEY);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponível.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir armazenamento local.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha no armazenamento local.'));
  });
}

async function readAll(): Promise<FocusedOutputRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const values = await requestToPromise(tx.objectStore(STORE_NAME).getAll()) as FocusedOutputRecord[];
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    db.close();
  }
}

async function removeById(id: string) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).delete(id));
  } finally {
    db.close();
  }
}

async function enforceRetention(incomingBytes: number) {
  const items = await readAll();
  let total = items.reduce((sum, item) => sum + (item.blob?.size ?? 0), 0);
  const orderedOldest = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (orderedOldest.length >= MAX_SAVED_OUTPUTS || (total + incomingBytes > MAX_SAVED_BYTES && orderedOldest.length)) {
    const oldest = orderedOldest.shift();
    if (!oldest) break;
    total -= oldest.blob?.size ?? 0;
    await removeById(oldest.id);
  }
}

async function putRecord(record: FocusedOutputRecord) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).put(record));
  } finally {
    db.close();
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function saveFocusedOutput(
  record: Omit<FocusedOutputRecord, 'blob'>,
  blob: Blob,
  persistBlob: boolean,
): Promise<{ blobSaved: boolean }> {
  const shouldSaveBlob = persistBlob && blob.size <= MAX_SINGLE_BLOB;
  const incomingBytes = shouldSaveBlob ? blob.size : 0;
  try {
    await enforceRetention(incomingBytes);
    if (shouldSaveBlob) await requestPersistentStorage();
    await putRecord({ ...record, blob: shouldSaveBlob ? blob : null });
    return { blobSaved: shouldSaveBlob };
  } catch {
    try {
      await putRecord({ ...record, blob: null });
    } catch { /* history is best effort */ }
    return { blobSaved: false };
  }
}

export async function listFocusedOutputs(): Promise<FocusedOutputRecord[]> {
  try { return await readAll(); } catch { return []; }
}

export async function deleteFocusedOutput(id: string): Promise<void> {
  try { await removeById(id); } catch { /* best effort */ }
}

export async function clearFocusedOutputs(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).clear());
  } finally {
    db.close();
  }
}

export async function getFocusedStorageEstimate(): Promise<{ used: number; quota: number }> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return { used: estimate?.usage ?? 0, quota: estimate?.quota ?? 0 };
  } catch {
    return { used: 0, quota: 0 };
  }
}
