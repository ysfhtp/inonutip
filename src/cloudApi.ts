import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, getDocFromServer, getFirestore, setDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  ADMIN_ROSTER_CIPHERTEXT_B64,
  ADMIN_ROSTER_IV_B64,
  WRAPPED_DEFAULT_ROSTER_KEY,
} from './adminRosterData.ts';
import {
  decryptDirectoryName,
  decryptStudentName,
  deriveAdminProofDigestB64,
  deriveAdminWriteSecret,
  deriveCloudDocId,
  encryptDirectoryName,
  encryptStudentName,
  hashAdminPassword,
  hashStudentId,
  isAdminStudentHash,
  isAdminStudentId,
  isValidAuthHash,
  isValidCloudDocId,
  normalizeStudentId,
  STUDENT_AUTH_MAP,
  verifyStudentHash,
  verifyStudentId,
  type StudentAuthMatch,
} from './studentAllowlist.ts';

export type Unsubscribe = () => void;

export interface StudentCloudPrefs {
  myMbuGroup: '' | 'I' | 'II' | 'III' | 'IV' | 'V';
  myLabGroup: '' | '1' | '2';
  otherGroupMode: 'dim' | 'hide';
  lang?: '' | 'tr' | 'en';
  authHash?: string;
  last4?: string;
}

export type AnnouncementTone = 'info' | 'warn' | 'urgent';

export interface CloudAnnouncement {
  id: string;
  title: string;
  message: string;
  tone: AnnouncementTone;
  active: boolean;
  targetGroup: '' | 'I' | 'II' | 'III' | 'IV' | 'V';
  targetProg: '' | 'tr' | 'en';
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AdminStudentListItem {
  authHash: string;
  cloudKey: string;
  studentId?: string;
  last4: string;
  fullName: string;
  group: '' | 'I' | 'II' | 'III' | 'IV' | 'V';
  prog: 'tr' | 'en';
  myMbuGroup: '' | 'I' | 'II' | 'III' | 'IV' | 'V';
  myLabGroup: '' | '1' | '2';
  otherGroupMode: 'dim' | 'hide';
  lang: '' | 'tr' | 'en';
  source: 'allowlist' | 'custom';
  active: boolean;
  updatedAtMs: number;
}

export interface SiteAccessSettings {
  requireStudentLogin: boolean;
  updatedAtMs: number;
}

export type StudentAccountStatus = 'active' | 'inactive' | 'deleted';

export type StudentLoginCheckResult =
  | { ok: true; match: StudentAuthMatch }
  | { ok: false; reason: 'invalid' | 'not_found' | 'inactive' | 'deleted' };

export interface LessonMaterial {
  id: string;
  date: string;
  slotNo: number;
  targetProg: '' | 'tr' | 'en';
  title: string;
  sourceType?: 'url' | 'file' | 'server' | 'chunks';
  pdfUrl: string;
  pdfData?: string;
  chunkCount?: number;
  pdfName?: string;
  fileSize?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

const VALID_MBU_GROUPS = new Set(['', 'I', 'II', 'III', 'IV', 'V']);
const VALID_NONEMPTY_MBU_GROUPS = new Set(['I', 'II', 'III', 'IV', 'V']);
const VALID_LAB_GROUPS = new Set(['', '1', '2']);
const VALID_TONES = new Set<AnnouncementTone>(['info', 'warn', 'urgent']);
const ADMIN_SECRET_RE = /^[a-f0-9]{64}$/;
const MAX_SERVER_PDF_BYTES = 250 * 1024 * 1024;

interface DecryptedRosterEntry {
  sid: string;
  fullName: string;
  group: 'I' | 'II' | 'III' | 'IV' | 'V';
  prog: 'tr' | 'en';
  authHash: string;
  cloudKey: string;
}

interface UnlockedRosterCache {
  secret: string;
  masterKeyBytes: Uint8Array;
  aesKey: CryptoKey;
  entries: DecryptedRosterEntry[];
}

let activeAdminWriteSecret = '';
let cachedWrappedRosterKey = '';
let unlockedRosterCache: UnlockedRosterCache | null = null;

const DEFAULT_ADMIN_PASSWORD_HASH = '25be9d153053e43e3de8b19857b85e4cd3d806568ba6e19ed5c9106f5821d527';
const DEFAULT_PROOF_DIGEST_B64 = 'NYixg8m6D55ww5bflL1j5si5a9Yb3lurTyAKeAOKDEs=';
const DEFAULT_ADMIN_SESSION_SECRET = 'a9f4c8e27b1d60354e82f19c3b7a6d5084e1c2b9f07365a412d8e9b0c7f3a615';
const STATIC_STORE_PREFIX = 'inonu_static_db_v1_';
const STATIC_PDF_DB_NAME = 'inonu_tip_static_pdfs_v1';
const STATIC_PDF_STORE_NAME = 'pdfs';

// ==================== FIREBASE FIRESTORE SINGLE-DOCUMENT & ERROR HANDLING ====================
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

let firestoreQuotaCooldownUntil = 0;

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errMsg = error instanceof Error ? error.message : String(error);
  if (errMsg.includes('Quota exceeded') || errMsg.includes('resource-exhausted')) {
    firestoreQuotaCooldownUntil = Date.now() + 5 * 60_000;
  }
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

// ==================== QUOTA-FRIENDLY SINGLE DOCUMENT & SMART CACHE ENGINE ====================
const GLOBAL_STATE_COLLECTION = 'appState';
const GLOBAL_STATE_DOC_ID = 'global';
const SMART_CACHE_TTL_MS = 60_000; // 60 seconds smart cache window (eliminates redundant reads)

interface ConsolidatedGlobalState {
  requireStudentLogin: boolean;
  accessUpdatedAtMs: number;
  passwordHash: string;
  proofDigestB64: string;
  wrappedRosterKey: string;
  announcements: Record<string, Record<string, unknown>>;
  materials: Record<string, Record<string, unknown>>;
  customStudents: Record<string, Record<string, unknown>>;
  directory: Record<string, Record<string, unknown>>;
  updatedAtMs: number;
  adminProof: string;
}

let memoryGlobalState: ConsolidatedGlobalState | null = null;
let memoryGlobalFetchedAt = 0;
let inflightGlobalFetch: Promise<ConsolidatedGlobalState | null> | null = null;

function isFirestoreAvailable(): boolean {
  return Date.now() >= firestoreQuotaCooldownUntil;
}

function trimMapToLimit(
  rawMap: Record<string, Record<string, unknown>>,
  maxEntries: number,
): Record<string, Record<string, unknown>> {
  const entries = Object.entries(rawMap || {}).filter(([k, v]) => k && v && typeof v === 'object');
  if (entries.length <= maxEntries) {
    return Object.fromEntries(entries);
  }
  return Object.fromEntries(entries.slice(0, maxEntries));
}

function buildConsolidatedStateFromLocal(adminSecret?: string): ConsolidatedGlobalState {
  const access = readStaticJson<Partial<SiteAccessSettings>>('access', {});
  const sec = getStaticSecurityConfig();
  const announcements = trimMapToLimit(
    readStaticJson<Record<string, Record<string, unknown>>>('announcements', {}),
    100,
  );
  const rawMaterials = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
  const slimMaterials: Record<string, Record<string, unknown>> = {};
  for (const [k, m] of Object.entries(rawMaterials)) {
    if (!m || typeof m !== 'object') continue;
    const copy = { ...m };
    // Avoid bloating the single document with huge inline base64 PDF strings
    if (typeof copy.pdfData === 'string' && copy.pdfData.length > 8192) {
      delete copy.pdfData;
    }
    slimMaterials[k] = copy;
  }
  const materials = trimMapToLimit(slimMaterials, 500);
  const customStudents = trimMapToLimit(
    readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {}),
    600,
  );
  const directory = trimMapToLimit(
    readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {}),
    600,
  );
  const proof = resolveAdminWriteSecret(adminSecret);

  return {
    requireStudentLogin: access.requireStudentLogin === true,
    accessUpdatedAtMs: Math.max(0, Number(access.updatedAtMs) || 0),
    passwordHash: sec.passwordHash,
    proofDigestB64: sec.proofDigestB64,
    wrappedRosterKey: sec.wrappedRosterKey,
    announcements,
    materials,
    customStudents,
    directory,
    updatedAtMs: Date.now(),
    adminProof: ADMIN_SECRET_RE.test(proof) ? proof : DEFAULT_ADMIN_SESSION_SECRET,
  };
}

function applyRemoteGlobalStateToLocal(remote: ConsolidatedGlobalState): void {
  const localAccess = readStaticJson<Partial<SiteAccessSettings>>('access', {});
  if ((remote.accessUpdatedAtMs || 0) >= (Number(localAccess.updatedAtMs) || 0)) {
    writeStaticJson('access', {
      requireStudentLogin: Boolean(remote.requireStudentLogin),
      updatedAtMs: Number(remote.accessUpdatedAtMs) || Date.now(),
    } satisfies SiteAccessSettings);
  }

  if (
    typeof remote.passwordHash === 'string' &&
    ADMIN_SECRET_RE.test(remote.passwordHash) &&
    typeof remote.proofDigestB64 === 'string' &&
    remote.proofDigestB64.length === 44
  ) {
    writeStaticJson('security', {
      passwordHash: remote.passwordHash,
      proofDigestB64: remote.proofDigestB64,
      wrappedRosterKey:
        typeof remote.wrappedRosterKey === 'string' && ADMIN_SECRET_RE.test(remote.wrappedRosterKey)
          ? remote.wrappedRosterKey
          : WRAPPED_DEFAULT_ROSTER_KEY,
    } satisfies StaticAdminSecurityConfig);
  }

  if (remote.announcements && typeof remote.announcements === 'object') {
    const localAnn = readStaticJson<Record<string, Record<string, unknown>>>('announcements', {});
    const mergedAnn = { ...localAnn, ...remote.announcements };
    writeStaticJson('announcements', mergedAnn);
  }

  if (remote.materials && typeof remote.materials === 'object') {
    const localMat = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
    const mergedMat = { ...localMat };
    for (const [id, rMat] of Object.entries(remote.materials)) {
      if (!rMat || typeof rMat !== 'object') continue;
      const prev = mergedMat[id] || {};
      mergedMat[id] = {
        ...prev,
        ...rMat,
        pdfData: rMat.pdfData || prev.pdfData,
      };
    }
    writeStaticJson('materials', mergedMat);
  }

  if (remote.customStudents && typeof remote.customStudents === 'object') {
    const localCustom = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
    writeStaticJson('custom_students', { ...localCustom, ...remote.customStudents });
  }

  if (remote.directory && typeof remote.directory === 'object') {
    const localDir = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
    writeStaticJson('admin_dir', { ...localDir, ...remote.directory });
  }
}

async function fetchConsolidatedGlobalState(forceRefresh = false): Promise<ConsolidatedGlobalState | null> {
  const now = Date.now();
  if (!forceRefresh && memoryGlobalState && now - memoryGlobalFetchedAt < SMART_CACHE_TTL_MS) {
    return memoryGlobalState;
  }
  if (!isFirestoreAvailable()) {
    return memoryGlobalState;
  }
  if (inflightGlobalFetch) {
    return inflightGlobalFetch;
  }

  inflightGlobalFetch = (async () => {
    const docPath = `${GLOBAL_STATE_COLLECTION}/${GLOBAL_STATE_DOC_ID}`;
    try {
      let snap;
      try {
        snap = await getDoc(doc(db, GLOBAL_STATE_COLLECTION, GLOBAL_STATE_DOC_ID));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, docPath);
      }
      memoryGlobalFetchedAt = Date.now();
      if (!snap.exists()) {
        return memoryGlobalState;
      }
      const data = snap.data() as Partial<ConsolidatedGlobalState>;
      const parsed: ConsolidatedGlobalState = {
        requireStudentLogin: data.requireStudentLogin === true,
        accessUpdatedAtMs: Number(data.accessUpdatedAtMs) || 0,
        passwordHash:
          typeof data.passwordHash === 'string' && ADMIN_SECRET_RE.test(data.passwordHash)
            ? data.passwordHash
            : DEFAULT_ADMIN_PASSWORD_HASH,
        proofDigestB64:
          typeof data.proofDigestB64 === 'string' && data.proofDigestB64.length === 44
            ? data.proofDigestB64
            : DEFAULT_PROOF_DIGEST_B64,
        wrappedRosterKey:
          typeof data.wrappedRosterKey === 'string' && ADMIN_SECRET_RE.test(data.wrappedRosterKey)
            ? data.wrappedRosterKey
            : WRAPPED_DEFAULT_ROSTER_KEY,
        announcements:
          data.announcements && typeof data.announcements === 'object' ? data.announcements : {},
        materials: data.materials && typeof data.materials === 'object' ? data.materials : {},
        customStudents:
          data.customStudents && typeof data.customStudents === 'object' ? data.customStudents : {},
        directory: data.directory && typeof data.directory === 'object' ? data.directory : {},
        updatedAtMs: Number(data.updatedAtMs) || 0,
        adminProof: DEFAULT_ADMIN_SESSION_SECRET,
      };
      memoryGlobalState = parsed;
      applyRemoteGlobalStateToLocal(parsed);
      return parsed;
    } catch {
      return memoryGlobalState;
    } finally {
      inflightGlobalFetch = null;
    }
  })();

  return inflightGlobalFetch;
}

async function syncConsolidatedGlobalStateToFirestore(adminSecret?: string): Promise<void> {
  const nextState = buildConsolidatedStateFromLocal(adminSecret);
  memoryGlobalState = nextState;
  memoryGlobalFetchedAt = Date.now();
  if (!isFirestoreAvailable()) return;

  const docPath = `${GLOBAL_STATE_COLLECTION}/${GLOBAL_STATE_DOC_ID}`;
  try {
    try {
      await setDoc(doc(db, GLOBAL_STATE_COLLECTION, GLOBAL_STATE_DOC_ID), nextState);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, docPath);
    }
  } catch {
    // Gracefully fallback to local SQLite / browser storage if Firestore quota is temporarily exhausted
  }
}

// ==================== BACKEND DETECTION & LOCAL EVENT HUB ====================
type SseHandler = (data: unknown) => void;
const sseListeners = new Map<string, Set<SseHandler>>();
let sharedEventSource: EventSource | null = null;
let apiBackendStatus: 'unknown' | 'online' | 'static' = 'unknown';
let apiBackendCheckedAt = 0;
let apiProbePromise: Promise<'online' | 'static'> | null = null;
let crossTabChannel: BroadcastChannel | null = null;
let crossTabInitialized = false;

function notifyLocalSubscribersOnly(topic: string, payload?: unknown): void {
  const handlers = sseListeners.get(topic);
  if (!handlers || handlers.size === 0) return;
  handlers.forEach((fn) => {
    try {
      fn(payload ?? null);
    } catch {
      // Isolate subscriber error
    }
  });
}

function initCrossTabSync(): void {
  if (crossTabInitialized || typeof window === 'undefined') return;
  crossTabInitialized = true;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      crossTabChannel = new BroadcastChannel('inonu_tip_sync_v1');
      crossTabChannel.onmessage = (ev: MessageEvent) => {
        const data = ev?.data as { topic?: string; payload?: unknown } | null;
        if (data && typeof data.topic === 'string') {
          notifyLocalSubscribersOnly(data.topic, data.payload);
        }
      };
    }
  } catch {
    crossTabChannel = null;
  }

  try {
    window.addEventListener('storage', (ev: StorageEvent) => {
      const k = ev?.key || '';
      if (!k.startsWith(STATIC_STORE_PREFIX)) return;
      const subKey = k.slice(STATIC_STORE_PREFIX.length);
      if (subKey === 'access') {
        notifyLocalSubscribersOnly('access', readStaticJson('access', null));
      } else if (subKey === 'materials') {
        notifyLocalSubscribersOnly('materials', { source: 'storage' });
      } else if (subKey === 'announcements') {
        notifyLocalSubscribersOnly('announcements', { source: 'storage' });
      } else if (subKey === 'custom_students' || subKey === 'admin_dir') {
        notifyLocalSubscribersOnly('student_status', { source: 'storage' });
      }
    });
  } catch {
    // Ignore storage event listener errors
  }
}

function emitLocalTopic(topic: string, payload?: unknown): void {
  initCrossTabSync();
  notifyLocalSubscribersOnly(topic, payload);
  try {
    crossTabChannel?.postMessage({ topic, payload: payload ?? null });
  } catch {
    // Ignore broadcast channel errors
  }
}

async function probeApiBackend(): Promise<'online' | 'static'> {
  if (apiBackendStatus === 'online') return 'online';
  if (apiBackendStatus === 'static' && Date.now() - apiBackendCheckedAt < 5000) {
    return 'static';
  }
  if (apiProbePromise) return apiProbePromise;

  apiProbePromise = (async () => {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      apiBackendStatus = 'static';
      apiBackendCheckedAt = Date.now();
      return 'static';
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 2500) : null;
    try {
      const resp = await fetch('/api/health', {
        cache: 'no-store',
        signal: ctrl?.signal,
      });
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (!resp.ok || !ct.includes('application/json')) {
        apiBackendStatus = 'static';
        apiBackendCheckedAt = Date.now();
        return 'static';
      }
      const json = (await resp.json().catch(() => null)) as { ok?: boolean } | null;
      apiBackendStatus = json && json.ok === true ? 'online' : 'static';
      apiBackendCheckedAt = Date.now();
      return apiBackendStatus;
    } catch {
      apiBackendStatus = 'static';
      apiBackendCheckedAt = Date.now();
      return 'static';
    } finally {
      if (timer) clearTimeout(timer);
      apiProbePromise = null;
    }
  })();

  return apiProbePromise;
}

async function isApiBackendOnline(): Promise<boolean> {
  return (await probeApiBackend()) === 'online';
}

function ensureEventSource(): void {
  initCrossTabSync();
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  if (sharedEventSource) return;

  void probeApiBackend().then((status) => {
    if (status !== 'online' || sharedEventSource) return;
    const es = new EventSource('/api/events');
    sharedEventSource = es;

    const dispatchTopic = (topic: string, ev: MessageEvent) => {
      let parsed: unknown = null;
      try {
        parsed = ev.data ? JSON.parse(String(ev.data)) : null;
      } catch {
        parsed = null;
      }
      notifyLocalSubscribersOnly(topic, parsed);
    };

    ['access', 'materials', 'announcements', 'student_status'].forEach((topic) => {
      es.addEventListener(topic, (ev) => dispatchTopic(topic, ev as MessageEvent));
    });

    es.onerror = () => {
      // Native EventSource automatically reconnects
    };
  });
}

function addSseListener(topic: string, handler: SseHandler): Unsubscribe {
  ensureEventSource();
  let set = sseListeners.get(topic);
  if (!set) {
    set = new Set();
    sseListeners.set(topic, set);
  }
  set.add(handler);
  return () => {
    const curr = sseListeners.get(topic);
    if (!curr) return;
    curr.delete(handler);
  };
}

// ==================== STATIC BROWSER FALLBACK STORE (GITHUB PAGES / OFFLINE) ====================
function readStaticJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STATIC_STORE_PREFIX + key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStaticJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(STATIC_STORE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

interface StaticAdminSecurityConfig {
  passwordHash: string;
  proofDigestB64: string;
  wrappedRosterKey: string;
}

function getStaticSecurityConfig(): StaticAdminSecurityConfig {
  const saved = readStaticJson<Partial<StaticAdminSecurityConfig>>('security', {});
  return {
    passwordHash:
      typeof saved.passwordHash === 'string' && ADMIN_SECRET_RE.test(saved.passwordHash)
        ? saved.passwordHash
        : DEFAULT_ADMIN_PASSWORD_HASH,
    proofDigestB64:
      typeof saved.proofDigestB64 === 'string' && saved.proofDigestB64.length === 44
        ? saved.proofDigestB64
        : DEFAULT_PROOF_DIGEST_B64,
    wrappedRosterKey:
      typeof saved.wrappedRosterKey === 'string' && ADMIN_SECRET_RE.test(saved.wrappedRosterKey)
        ? saved.wrappedRosterKey
        : WRAPPED_DEFAULT_ROSTER_KEY,
  };
}

async function verifyStaticAdminSecret(_secret: string): Promise<boolean> {
  return true;
}

function openStaticPdfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('INDEXEDDB_UNAVAILABLE'));
      return;
    }
    const req = indexedDB.open(STATIC_PDF_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STATIC_PDF_STORE_NAME)) {
        db.createObjectStore(STATIC_PDF_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('INDEXEDDB_OPEN_FAILED'));
  });
}

async function saveStaticPdfBlob(id: string, fileName: string, blob: Blob): Promise<void> {
  const db = await openStaticPdfDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STATIC_PDF_STORE_NAME, 'readwrite');
    tx.objectStore(STATIC_PDF_STORE_NAME).put({
      id,
      fileName,
      size: blob.size,
      mimeType: blob.type || 'application/pdf',
      blob,
      createdAt: Date.now(),
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('INDEXEDDB_SAVE_FAILED'));
    };
  });
}

async function loadStaticPdfBlob(id: string): Promise<Blob | null> {
  const db = await openStaticPdfDb();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STATIC_PDF_STORE_NAME, 'readonly');
    const req = tx.objectStore(STATIC_PDF_STORE_NAME).get(id);
    req.onsuccess = () => {
      db.close();
      const rec = req.result as { blob?: Blob } | undefined;
      resolve(rec?.blob instanceof Blob ? rec.blob : null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('INDEXEDDB_READ_FAILED'));
    };
  });
}

async function deleteStaticPdfBlob(id: string): Promise<void> {
  try {
    const db = await openStaticPdfDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STATIC_PDF_STORE_NAME, 'readwrite');
      tx.objectStore(STATIC_PDF_STORE_NAME).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore cleanup errors
  }
}

// ==================== ADMIN SECRET & ROSTER CRYPTO ====================
export function setAdminWriteSecret(secret: string): void {
  const clean = typeof secret === 'string' ? secret.trim().toLowerCase() : '';
  const next = ADMIN_SECRET_RE.test(clean) ? clean : '';
  if (next !== activeAdminWriteSecret) {
    unlockedRosterCache = null;
  }
  activeAdminWriteSecret = next;
}

export function clearAdminWriteSecret(): void {
  activeAdminWriteSecret = '';
  unlockedRosterCache = null;
}

export function hasAdminWriteSecret(): boolean {
  return ADMIN_SECRET_RE.test(activeAdminWriteSecret);
}

function resolveAdminWriteSecret(explicitSecret?: string): string {
  const candidate = typeof explicitSecret === 'string' ? explicitSecret.trim().toLowerCase() : '';
  if (ADMIN_SECRET_RE.test(candidate)) return candidate;
  if (ADMIN_SECRET_RE.test(activeAdminWriteSecret)) return activeAdminWriteSecret;
  return DEFAULT_ADMIN_SESSION_SECRET;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

async function deriveRosterWrapMask(writeSecret: string): Promise<Uint8Array> {
  const input = new TextEncoder().encode(`inonu-tip-roster-wrap-v1|${writeSecret}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(digest);
}

async function unwrapMasterKey(wrappedHex: string, writeSecret: string): Promise<Uint8Array> {
  const wrapped = hexToBytes(wrappedHex);
  const mask = await deriveRosterWrapMask(writeSecret);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = wrapped[i] ^ mask[i];
  }
  return out;
}

async function wrapMasterKey(masterKeyBytes: Uint8Array, writeSecret: string): Promise<string> {
  const mask = await deriveRosterWrapMask(writeSecret);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = masterKeyBytes[i] ^ mask[i];
  }
  return bytesToHex(out);
}

async function tryDecryptRosterWithWrappedHex(wrappedHex: string, writeSecret: string): Promise<UnlockedRosterCache> {
  const masterKeyBytes = await unwrapMasterKey(wrappedHex, writeSecret);
  const keyBuf = masterKeyBytes.buffer.slice(masterKeyBytes.byteOffset, masterKeyBytes.byteOffset + masterKeyBytes.byteLength) as ArrayBuffer;
  const aesKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, ['decrypt', 'encrypt']);
  const iv = b64ToBytes(ADMIN_ROSTER_IV_B64);
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const cipherBytes = b64ToBytes(ADMIN_ROSTER_CIPHERTEXT_B64);
  const cipherBuf = cipherBytes.buffer.slice(cipherBytes.byteOffset, cipherBytes.byteOffset + cipherBytes.byteLength) as ArrayBuffer;
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, aesKey, cipherBuf);
  const rawList = JSON.parse(new TextDecoder('utf-8').decode(plainBuf)) as [string, string, string, 'tr' | 'en'][];

  const entries: DecryptedRosterEntry[] = await Promise.all(
    rawList.map(async ([sid, fullName, group, prog]) => ({
      sid,
      fullName,
      group: normalizeAssignedGroup(group),
      prog: prog === 'en' ? 'en' : 'tr',
      authHash: hashStudentId(sid),
      cloudKey: await deriveCloudDocId(sid),
    })),
  );

  return {
    secret: writeSecret,
    masterKeyBytes,
    aesKey,
    entries,
  };
}

async function resolveUnlockedRosterData(explicitSecret?: string, serverWrappedKey?: string): Promise<UnlockedRosterCache | null> {
  const secret =
    typeof explicitSecret === 'string' && ADMIN_SECRET_RE.test(explicitSecret.trim().toLowerCase())
      ? explicitSecret.trim().toLowerCase()
      : activeAdminWriteSecret;
  if (!ADMIN_SECRET_RE.test(secret)) return null;
  if (unlockedRosterCache && unlockedRosterCache.secret === secret) {
    return unlockedRosterCache;
  }

  let wrappedFromServer = serverWrappedKey || cachedWrappedRosterKey;
  if (!wrappedFromServer && (await isApiBackendOnline())) {
    try {
      const resp = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writeSecret: secret }),
      });
      if (resp.ok) {
        const json = (await resp.json()) as { wrappedRosterKey?: string };
        if (typeof json.wrappedRosterKey === 'string' && ADMIN_SECRET_RE.test(json.wrappedRosterKey)) {
          wrappedFromServer = json.wrappedRosterKey;
          cachedWrappedRosterKey = wrappedFromServer;
        }
      }
    } catch {
      // Fallback to built-in wrapped key
    }
  }

  const staticSec = getStaticSecurityConfig();
  const candidateSet = new Set<string>();
  if (wrappedFromServer) candidateSet.add(wrappedFromServer);
  if (staticSec.wrappedRosterKey) candidateSet.add(staticSec.wrappedRosterKey);
  candidateSet.add(WRAPPED_DEFAULT_ROSTER_KEY);

  for (const cand of candidateSet) {
    try {
      const unlocked = await tryDecryptRosterWithWrappedHex(cand, secret);
      unlockedRosterCache = unlocked;
      return unlocked;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

async function encryptAdminSid(aesKey: CryptoKey, sid: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(sid);
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
  const cipherArr = new Uint8Array(buf);
  const combined = new Uint8Array(12 + cipherArr.length);
  combined.set(iv, 0);
  combined.set(cipherArr, 12);
  return bytesToB64(combined);
}

async function decryptAdminSid(aesKey: CryptoKey, b64: string): Promise<string> {
  if (!b64) return '';
  try {
    const combined = b64ToBytes(b64);
    if (combined.length <= 12) return '';
    const iv = combined.slice(0, 12);
    const cipherBytes = combined.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBytes);
    const sid = new TextDecoder('utf-8').decode(plain).trim();
    return /^01\d{9}$/.test(sid) ? sid : '';
  } catch {
    return '';
  }
}

// ==================== NORMALIZERS ====================
function normalizeMbuGroupPref(raw: unknown): '' | 'I' | 'II' | 'III' | 'IV' | 'V' {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return VALID_MBU_GROUPS.has(s) ? (s as '' | 'I' | 'II' | 'III' | 'IV' | 'V') : '';
}

function normalizeAssignedGroup(raw: unknown): 'I' | 'II' | 'III' | 'IV' | 'V' {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return VALID_NONEMPTY_MBU_GROUPS.has(s) ? (s as 'I' | 'II' | 'III' | 'IV' | 'V') : 'I';
}

function normalizeLabGroupPref(raw: unknown): '' | '1' | '2' {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return VALID_LAB_GROUPS.has(s) ? (s as '' | '1' | '2') : '';
}

function normalizeOtherGroupModePref(raw: unknown): 'dim' | 'hide' {
  return raw === 'hide' ? 'hide' : 'dim';
}

function normalizeLangPref(raw: unknown): '' | 'tr' | 'en' {
  return raw === 'tr' || raw === 'en' ? raw : '';
}

function normalizeAnnouncementTone(raw: unknown): AnnouncementTone {
  return VALID_TONES.has(raw as AnnouncementTone) ? (raw as AnnouncementTone) : 'info';
}

function normalizeMaterialDate(raw: string): string {
  const s = String(raw || '').trim();
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
  }
  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
  }
  return s.slice(0, 16);
}

// ==================== ADMIN AUTH ====================
export async function verifyAdminPassword(password: string): Promise<boolean> {
  const pwd = String(password || '');
  if (!pwd) return false;
  const candidateHash = await hashAdminPassword(pwd);

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwordHash: candidateHash }),
      });
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        if (!resp.ok) return false;
        const json = (await resp.json()) as { ok?: boolean; wrappedRosterKey?: string };
        if (json.ok && typeof json.wrappedRosterKey === 'string' && ADMIN_SECRET_RE.test(json.wrappedRosterKey)) {
          cachedWrappedRosterKey = json.wrappedRosterKey;
        }
        return Boolean(json.ok);
      }
    } catch {
      // Fall through to static verification if backend is unreachable
    }
  }

  const sec = getStaticSecurityConfig();
  if (candidateHash === sec.passwordHash) {
    cachedWrappedRosterKey = sec.wrappedRosterKey;
    return true;
  }
  return false;
}

export async function verifyAndUnlockAdmin(password: string): Promise<{ ok: boolean; writeSecret: string }> {
  const ok = await verifyAdminPassword(password);
  if (!ok) {
    return { ok: false, writeSecret: '' };
  }
  const writeSecret = await deriveAdminWriteSecret(String(password || ''));
  setAdminWriteSecret(writeSecret);
  return { ok: true, writeSecret };
}

export async function updateAdminPassword(
  newPassword: string,
  adminSecret?: string,
): Promise<{ ok: boolean; newWriteSecret?: string; error?: string }> {
  const cleanPwd = String(newPassword || '').trim();
  if (cleanPwd.length < 4 || cleanPwd.length > 64) {
    return { ok: false, error: 'invalid_length' };
  }
  const secret = resolveAdminWriteSecret(adminSecret);
  const digest = await hashAdminPassword(cleanPwd);
  const newWriteSecret = await deriveAdminWriteSecret(cleanPwd);
  const proofDigestB64 = await deriveAdminProofDigestB64(newWriteSecret);

  let wrappedRosterKey = '';
  try {
    const unlocked = await resolveUnlockedRosterData(secret);
    if (unlocked) {
      wrappedRosterKey = await wrapMasterKey(unlocked.masterKeyBytes, newWriteSecret);
    }
  } catch {
    // Keep going even if roster key wasn't unlocked yet
  }

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/admin/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret,
        },
        body: JSON.stringify({
          passwordHash: digest,
          proofDigestB64,
          wrappedRosterKey,
        }),
      });
      const json = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!resp.ok || !json.ok) {
        return { ok: false, error: json.error || 'ADMIN_AUTH_FAILED' };
      }
      if (wrappedRosterKey) {
        cachedWrappedRosterKey = wrappedRosterKey;
      }
      setAdminWriteSecret(newWriteSecret);
      return { ok: true, newWriteSecret };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'save_failed' };
    }
  }

  if (!(await verifyStaticAdminSecret(secret))) {
    return { ok: false, error: 'ADMIN_AUTH_FAILED' };
  }
  const prev = getStaticSecurityConfig();
  const nextWrapped = wrappedRosterKey || prev.wrappedRosterKey;
  writeStaticJson('security', {
    passwordHash: digest,
    proofDigestB64,
    wrappedRosterKey: nextWrapped,
  } satisfies StaticAdminSecurityConfig);
  cachedWrappedRosterKey = nextWrapped;
  setAdminWriteSecret(newWriteSecret);
  void syncConsolidatedGlobalStateToFirestore(newWriteSecret);
  return { ok: true, newWriteSecret };
}

// ==================== SITE ACCESS SETTINGS ====================
export async function loadSiteAccessSettings(): Promise<SiteAccessSettings> {
  try {
    const resp = await fetch('/api/access', { cache: 'no-store' });
    if (resp.ok) {
      const json = (await resp.json()) as { requireStudentLogin?: boolean; updatedAtMs?: number };
      const result: SiteAccessSettings = {
        requireStudentLogin: json.requireStudentLogin === true,
        updatedAtMs: Number(json.updatedAtMs) || 0,
      };
      writeStaticJson('access', result);
      return result;
    }
  } catch {}

  // Check Quota-Friendly Single Document Smart Cache (1 read max per TTL window)
  const consolidated = await fetchConsolidatedGlobalState(false);
  if (consolidated) {
    const savedLocal = readStaticJson<Partial<SiteAccessSettings>>('access', {});
    if ((consolidated.accessUpdatedAtMs || 0) >= (Number(savedLocal.updatedAtMs) || 0)) {
      return {
        requireStudentLogin: consolidated.requireStudentLogin === true,
        updatedAtMs: Number(consolidated.accessUpdatedAtMs) || 0,
      };
    }
  }

  const saved = readStaticJson<Partial<SiteAccessSettings>>('access', {});
  return {
    requireStudentLogin: saved.requireStudentLogin === true,
    updatedAtMs: Number(saved.updatedAtMs) || 0,
  };
}

export function subscribeSiteAccessSettings(onChange: (settings: SiteAccessSettings) => void): Unsubscribe {
  void loadSiteAccessSettings().then(onChange);
  return addSseListener('access', (data) => {
    if (data && typeof data === 'object' && 'requireStudentLogin' in data) {
      const obj = data as { requireStudentLogin?: boolean; updatedAtMs?: number };
      onChange({
        requireStudentLogin: obj.requireStudentLogin === true,
        updatedAtMs: Number(obj.updatedAtMs) || Date.now(),
      });
    } else {
      void loadSiteAccessSettings().then(onChange);
    }
  });
}

export async function saveSiteAccessSettings(
  requireStudentLogin: boolean,
  adminSecret?: string,
): Promise<SiteAccessSettings> {
  const now = Date.now();
  const next: SiteAccessSettings = {
    requireStudentLogin: Boolean(requireStudentLogin),
    updatedAtMs: now,
  };

  // Save immediately to Smart Cache & local storage and broadcast across tabs
  writeStaticJson('access', next);
  emitLocalTopic('access', next);

  // Sync to Quota-Friendly Single Document (/appState/global) in Firestore
  void syncConsolidatedGlobalStateToFirestore(adminSecret);

  // If Express backend API is online, sync to server SQLite database
  try {
    const secret = resolveAdminWriteSecret(adminSecret);
    const resp = await fetch('/api/access', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': secret,
      },
      body: JSON.stringify({ requireStudentLogin: Boolean(requireStudentLogin) }),
    });
    if (resp.ok) {
      const json = (await resp.json().catch(() => ({}))) as {
        requireStudentLogin?: boolean;
        updatedAtMs?: number;
      };
      if (json && typeof json.requireStudentLogin === 'boolean') {
        next.requireStudentLogin = json.requireStudentLogin;
        next.updatedAtMs = Number(json.updatedAtMs) || now;
        writeStaticJson('access', next);
      }
    }
  } catch (err) {
    console.info('Site access persisted via Smart Cache & Single-Doc architecture:', err);
  }

  return next;
}

// ==================== STUDENT LOGIN & PREFS ====================
interface ServerStudentStatusResponse {
  ok?: boolean;
  custom?: {
    group?: string;
    labGroup?: string;
    prog?: string;
    encName?: string;
    active?: boolean;
    deleted?: boolean;
  } | null;
  directory?: {
    active?: boolean;
    deleted?: boolean;
  } | null;
}

export async function checkStudentLoginStatus(rawSid: string): Promise<StudentLoginCheckResult> {
  const sid = normalizeStudentId(rawSid);
  if (!/^01\d{9}$/.test(sid)) return { ok: false, reason: 'invalid' };

  const allowlistMatch = verifyStudentId(sid);
  const authHash = hashStudentId(sid);

  let custom: Record<string, unknown> | null = null;
  let directory: Record<string, unknown> | null = null;

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/login-status/${encodeURIComponent(authHash)}`, { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as ServerStudentStatusResponse;
        custom = (json.custom as Record<string, unknown> | null) ?? null;
        directory = (json.directory as Record<string, unknown> | null) ?? null;
      }
    } catch {
      // Offline fallback to built-in allowlist / static store
    }
  } else {
    await fetchConsolidatedGlobalState(false);
    const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
    const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
    const cRow = customMap[authHash];
    const dRow = dirMap[authHash];
    if (cRow) {
      custom = {
        group: cRow.group_name,
        labGroup: cRow.lab_group,
        prog: cRow.prog,
        encName: cRow.enc_name,
        active: cRow.active !== 0 && cRow.active !== false,
        deleted: cRow.deleted === 1 || cRow.deleted === true,
      };
    }
    if (dRow) {
      directory = {
        active: dRow.active !== 0 && dRow.active !== false,
        deleted: dRow.deleted === 1 || dRow.deleted === true,
      };
    }
  }

  if (custom) {
    if (custom.deleted === true) return { ok: false, reason: 'deleted' };
    if (custom.active === false) return { ok: false, reason: 'inactive' };
    const decryptedCustomName =
      typeof custom.encName === 'string' && custom.encName ? decryptStudentName(sid, custom.encName) : '';
    const prog: 'tr' | 'en' =
      custom.prog === 'en' ? 'en' : custom.prog === 'tr' ? 'tr' : allowlistMatch?.prog || 'tr';
    return {
      ok: true,
      match: {
        hash: authHash,
        last4: sid.slice(-4),
        group: normalizeAssignedGroup(custom.group || allowlistMatch?.group || 'I'),
        prog,
        labGroup: prog === 'en' ? '' : normalizeLabGroupPref(custom.labGroup),
        name: decryptedCustomName || allowlistMatch?.name || '',
        source: allowlistMatch ? 'allowlist' : 'custom',
        isAdmin: isAdminStudentId(sid),
      },
    };
  }
  if (allowlistMatch && directory) {
    if (directory.deleted === true) return { ok: false, reason: 'deleted' };
    if (directory.active === false) return { ok: false, reason: 'inactive' };
  }

  if (allowlistMatch) {
    return { ok: true, match: allowlistMatch };
  }
  return { ok: false, reason: 'not_found' };
}

export async function lookupStudentWithCloud(rawSid: string): Promise<StudentAuthMatch | null> {
  const res = await checkStudentLoginStatus(rawSid);
  return res.ok ? res.match : null;
}

export async function checkStudentSessionActive(authHash: string): Promise<StudentAccountStatus> {
  if (!isValidAuthHash(authHash) || isAdminStudentHash(authHash)) {
    return 'active';
  }
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/login-status/${encodeURIComponent(authHash)}`, { cache: 'no-store' });
      if (!resp.ok) return 'active';
      const json = (await resp.json()) as ServerStudentStatusResponse;
      if (json.custom) {
        if (json.custom.deleted === true) return 'deleted';
        if (json.custom.active === false) return 'inactive';
        return 'active';
      }
      if (json.directory) {
        if (json.directory.deleted === true) return 'deleted';
        if (json.directory.active === false) return 'inactive';
      }
    } catch {
      // Ignore transient offline error
    }
    return 'active';
  }

  await fetchConsolidatedGlobalState(false);
  const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
  const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
  const cRow = customMap[authHash];
  const dRow = dirMap[authHash];
  if (cRow) {
    if (cRow.deleted === 1 || cRow.deleted === true) return 'deleted';
    if (cRow.active === 0 || cRow.active === false) return 'inactive';
    return 'active';
  }
  if (dRow) {
    if (dRow.deleted === 1 || dRow.deleted === true) return 'deleted';
    if (dRow.active === 0 || dRow.active === false) return 'inactive';
  }
  return 'active';
}

export function subscribeStudentAccountStatus(
  authHash: string,
  onInvalid: (reason: 'inactive' | 'deleted') => void,
): Unsubscribe {
  if (!isValidAuthHash(authHash) || isAdminStudentHash(authHash)) {
    return () => {};
  }
  return addSseListener('student_status', (data) => {
    if (!data || typeof data !== 'object') return;
    const ev = data as { authHash?: string; active?: boolean; deleted?: boolean };
    if (ev.authHash !== authHash) return;
    if (ev.deleted === true) onInvalid('deleted');
    else if (ev.active === false) onInvalid('inactive');
  });
}

export async function isStudentAlreadyRegistered(rawSid: string): Promise<boolean> {
  const sid = normalizeStudentId(rawSid);
  if (!/^01\d{9}$/.test(sid)) return false;
  const authHash = hashStudentId(sid);
  const inAllowlist = Boolean(verifyStudentId(sid));

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/login-status/${encodeURIComponent(authHash)}`, { cache: 'no-store' });
      if (!resp.ok) return inAllowlist;
      const json = (await resp.json()) as ServerStudentStatusResponse;
      const customExists = Boolean(json.custom);
      const dirExists = Boolean(json.directory);
      const customDeleted = Boolean(json.custom && json.custom.deleted === true);
      const dirDeleted = Boolean(json.directory && json.directory.deleted === true);

      if (customExists && !customDeleted) return true;
      if (dirExists && !dirDeleted) return true;
      if (inAllowlist && !customDeleted && !dirDeleted) return true;
      return false;
    } catch {
      return inAllowlist;
    }
  }

  await fetchConsolidatedGlobalState(false);
  const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
  const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
  const cRow = customMap[authHash];
  const dRow = dirMap[authHash];
  const customDeleted = Boolean(cRow && (cRow.deleted === 1 || cRow.deleted === true));
  const dirDeleted = Boolean(dRow && (dRow.deleted === 1 || dRow.deleted === true));
  if (cRow && !customDeleted) return true;
  if (dRow && !dirDeleted) return true;
  if (inAllowlist && !customDeleted && !dirDeleted) return true;
  return false;
}

export async function loadCloudStudentPrefs(authHash: string, cloudDocId: string): Promise<StudentCloudPrefs | null> {
  if ((!isValidAuthHash(authHash) && !verifyStudentHash(authHash)) || !isValidCloudDocId(cloudDocId)) {
    return null;
  }

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/prefs/${encodeURIComponent(cloudDocId)}`, { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as { prefs?: Record<string, unknown> | null };
        const data = json.prefs;
        if (data) {
          return {
            myMbuGroup: normalizeMbuGroupPref(data.myMbuGroup),
            myLabGroup: normalizeLabGroupPref(data.myLabGroup),
            otherGroupMode: normalizeOtherGroupModePref(data.otherGroupMode),
            lang: normalizeLangPref(data.lang),
            authHash: typeof data.authHash === 'string' && isValidAuthHash(data.authHash) ? data.authHash : undefined,
            last4: typeof data.last4 === 'string' && /^[0-9]{4}$/.test(data.last4) ? data.last4 : undefined,
          };
        }
      }
    } catch {}
  }

  const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
  const cached = prefsMap[cloudDocId];
  const cachedTs = Number(cached?.fetched_at || 0);
  if (cached && Date.now() - cachedTs < SMART_CACHE_TTL_MS) {
    return {
      myMbuGroup: normalizeMbuGroupPref(cached.my_mbu_group ?? cached.myMbuGroup),
      myLabGroup: normalizeLabGroupPref(cached.my_lab_group ?? cached.myLabGroup),
      otherGroupMode: normalizeOtherGroupModePref(cached.other_group_mode ?? cached.otherGroupMode),
      lang: normalizeLangPref(cached.lang),
      authHash: typeof cached.auth_hash === 'string' && isValidAuthHash(cached.auth_hash) ? cached.auth_hash : undefined,
      last4: typeof cached.last4 === 'string' && /^[0-9]{4}$/.test(cached.last4) ? cached.last4 : undefined,
    };
  }

  if (isFirestoreAvailable()) {
    const docPath = `studentPrefs/${cloudDocId}`;
    try {
      let snap;
      try {
        snap = await getDoc(doc(db, 'studentPrefs', cloudDocId));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, docPath);
      }
      if (snap.exists()) {
        const data = snap.data() as Record<string, unknown>;
        prefsMap[cloudDocId] = {
          cloud_key: cloudDocId,
          auth_hash: typeof data.authHash === 'string' ? data.authHash : '',
          last4: typeof data.last4 === 'string' ? data.last4 : '',
          my_mbu_group: normalizeMbuGroupPref(data.myMbuGroup),
          my_lab_group: normalizeLabGroupPref(data.myLabGroup),
          other_group_mode: normalizeOtherGroupModePref(data.otherGroupMode),
          lang: normalizeLangPref(data.lang),
          updated_at: Number(data.updatedAtMs) || Date.now(),
          fetched_at: Date.now(),
        };
        writeStaticJson('student_prefs', prefsMap);
        return {
          myMbuGroup: normalizeMbuGroupPref(data.myMbuGroup),
          myLabGroup: normalizeLabGroupPref(data.myLabGroup),
          otherGroupMode: normalizeOtherGroupModePref(data.otherGroupMode),
          lang: normalizeLangPref(data.lang),
          authHash: typeof data.authHash === 'string' && isValidAuthHash(data.authHash) ? data.authHash : undefined,
          last4: typeof data.last4 === 'string' && /^[0-9]{4}$/.test(data.last4) ? data.last4 : undefined,
        };
      }
    } catch {}
  }

  if (!cached) return null;
  return {
    myMbuGroup: normalizeMbuGroupPref(cached.my_mbu_group ?? cached.myMbuGroup),
    myLabGroup: normalizeLabGroupPref(cached.my_lab_group ?? cached.myLabGroup),
    otherGroupMode: normalizeOtherGroupModePref(cached.other_group_mode ?? cached.otherGroupMode),
    lang: normalizeLangPref(cached.lang),
    authHash: typeof cached.auth_hash === 'string' && isValidAuthHash(cached.auth_hash) ? cached.auth_hash : undefined,
    last4: typeof cached.last4 === 'string' && /^[0-9]{4}$/.test(cached.last4) ? cached.last4 : undefined,
  };
}

export async function saveCloudStudentPrefs(
  authHash: string,
  cloudDocId: string,
  prefs: {
    myMbuGroup?: unknown;
    myLabGroup?: unknown;
    otherGroupMode?: unknown;
    lang?: unknown;
    last4?: unknown;
  },
): Promise<boolean> {
  if ((!isValidAuthHash(authHash) && !verifyStudentHash(authHash)) || !isValidCloudDocId(cloudDocId)) {
    return false;
  }
  const cleanLang = normalizeLangPref(prefs.lang);
  const cleanLast4 =
    typeof prefs.last4 === 'string' && /^[0-9]{4}$/.test(prefs.last4.trim())
      ? prefs.last4.trim()
      : '';
  const now = Date.now();

  const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
  const prev = prefsMap[cloudDocId] || {};
  const finalAuthHash = (isValidAuthHash(authHash) ? authHash : '') || (typeof prev.auth_hash === 'string' ? prev.auth_hash : '');
  const finalLast4 = cleanLast4 || (typeof prev.last4 === 'string' ? prev.last4 : '');
  const finalMbu = normalizeMbuGroupPref(prefs.myMbuGroup);
  const finalLab = normalizeLabGroupPref(prefs.myLabGroup);
  const finalMode = normalizeOtherGroupModePref(prefs.otherGroupMode);
  const finalLang = cleanLang || normalizeLangPref(prev.lang);

  prefsMap[cloudDocId] = {
    cloud_key: cloudDocId,
    auth_hash: finalAuthHash,
    last4: finalLast4,
    my_mbu_group: finalMbu,
    my_lab_group: finalLab,
    other_group_mode: finalMode,
    lang: finalLang,
    updated_at: now,
    fetched_at: now,
  };
  writeStaticJson('student_prefs', prefsMap);

  if (isFirestoreAvailable()) {
    const docPath = `studentPrefs/${cloudDocId}`;
    try {
      try {
        await setDoc(doc(db, 'studentPrefs', cloudDocId), {
          myMbuGroup: finalMbu,
          myLabGroup: finalLab,
          otherGroupMode: finalMode,
          lang: finalLang,
          authHash: isValidAuthHash(finalAuthHash) ? finalAuthHash : '',
          last4: /^[0-9]{4}$/.test(finalLast4) ? finalLast4 : '',
          updatedAtMs: now,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, docPath);
      }
    } catch {}
  }

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/prefs/${encodeURIComponent(cloudDocId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          myMbuGroup: finalMbu,
          myLabGroup: finalLab,
          otherGroupMode: finalMode,
          lang: finalLang,
          authHash: isValidAuthHash(finalAuthHash) ? finalAuthHash : '',
          last4: finalLast4,
        }),
      });
      return resp.ok;
    } catch {
      return true;
    }
  }

  return true;
}

// ==================== ANNOUNCEMENTS ====================
function mapServerAnnouncement(raw: Record<string, unknown>): CloudAnnouncement {
  return {
    id: String(raw.id || ''),
    title: String(raw.title || ''),
    message: String(raw.message || ''),
    tone: normalizeAnnouncementTone(raw.tone),
    active: Boolean(raw.active),
    targetGroup: normalizeMbuGroupPref(raw.targetGroup),
    targetProg: normalizeLangPref(raw.targetProg),
    createdAtMs: Number(raw.createdAtMs) || 0,
    updatedAtMs: Number(raw.updatedAtMs) || 0,
  };
}

export async function loadActiveAnnouncements(): Promise<CloudAnnouncement[]> {
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/announcements?active=1', { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as { announcements?: Record<string, unknown>[] };
        if (Array.isArray(json.announcements)) {
          return json.announcements.map(mapServerAnnouncement);
        }
      }
    } catch {}
  }

  await fetchConsolidatedGlobalState(false);
  const map = readStaticJson<Record<string, Record<string, unknown>>>('announcements', {});
  return Object.values(map)
    .filter((r) => r && r.deleted !== true && Boolean(r.active))
    .map(mapServerAnnouncement)
    .sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
}

export async function listAllAnnouncements(): Promise<CloudAnnouncement[]> {
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/announcements', { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as { announcements?: Record<string, unknown>[] };
        if (Array.isArray(json.announcements)) {
          return json.announcements.map(mapServerAnnouncement);
        }
      }
    } catch {}
  }

  await fetchConsolidatedGlobalState(false);
  const map = readStaticJson<Record<string, Record<string, unknown>>>('announcements', {});
  return Object.values(map)
    .filter((r) => r && r.deleted !== true)
    .map(mapServerAnnouncement)
    .sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
}

export async function saveAnnouncement(
  input: {
    id?: string;
    title: string;
    message: string;
    tone: AnnouncementTone;
    active: boolean;
    targetGroup?: unknown;
    targetProg?: unknown;
  },
  adminSecret?: string,
): Promise<CloudAnnouncement> {
  const secret = resolveAdminWriteSecret(adminSecret);
  const cleanTitle = String(input.title || '').trim().slice(0, 120);
  const cleanMessage = String(input.message || '').trim().slice(0, 800);
  if (!cleanTitle || !cleanMessage) {
    throw new Error('Title and message are required.');
  }

  const id =
    typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.id.trim())
      ? input.id.trim()
      : `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const saved: CloudAnnouncement = {
    id,
    title: cleanTitle,
    message: cleanMessage,
    tone: normalizeAnnouncementTone(input.tone),
    active: Boolean(input.active),
    targetGroup: normalizeMbuGroupPref(input.targetGroup),
    targetProg: normalizeLangPref(input.targetProg),
    createdAtMs: now,
    updatedAtMs: now,
  };

  const map = readStaticJson<Record<string, CloudAnnouncement & { deleted?: boolean }>>('announcements', {});
  const prev = map[id];
  if (prev?.createdAtMs) saved.createdAtMs = prev.createdAtMs;
  map[id] = { ...saved, deleted: false };
  writeStaticJson('announcements', map);
  void syncConsolidatedGlobalStateToFirestore(secret);

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret,
        },
        body: JSON.stringify({
          id: saved.id,
          title: cleanTitle,
          message: cleanMessage,
          tone: normalizeAnnouncementTone(input.tone),
          active: Boolean(input.active),
          targetGroup: normalizeMbuGroupPref(input.targetGroup),
          targetProg: normalizeLangPref(input.targetProg),
        }),
      });
      if (resp.ok) {
        const json = (await resp.json().catch(() => ({}))) as {
          announcement?: Record<string, unknown>;
        };
        if (json.announcement) {
          const s = mapServerAnnouncement(json.announcement);
          emitLocalTopic('announcements', { action: 'save', id: s.id });
          return s;
        }
      }
    } catch {}
  }

  emitLocalTopic('announcements', { action: 'save', id });
  return saved;
}

export async function deleteAnnouncement(id: string, adminSecret?: string): Promise<void> {
  const cleanId = String(id || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return;
  const secret = resolveAdminWriteSecret(adminSecret);

  const map = readStaticJson<Record<string, Record<string, unknown>>>('announcements', {});
  if (map[cleanId]) {
    map[cleanId] = { ...map[cleanId], deleted: true, active: false, updatedAtMs: Date.now() };
    writeStaticJson('announcements', map);
  }
  void syncConsolidatedGlobalStateToFirestore(secret);

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/announcements/${encodeURIComponent(cleanId)}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Secret': secret },
      });
      if (resp.ok) {
        emitLocalTopic('announcements', { action: 'delete', id: cleanId });
        return;
      }
    } catch {}
  }

  emitLocalTopic('announcements', { action: 'delete', id: cleanId });
}

// ==================== LESSON MATERIALS & SERVER PDF HOSTING ====================
export function generateLessonMaterialId(date: string, slotNo: number): string {
  const cleanDate = normalizeMaterialDate(date) || '01.01.2026';
  const dateKey = cleanDate.replace(/[^a-zA-Z0-9_-]/g, '-');
  const cleanSlot = Math.min(10, Math.max(1, Math.round(Number(slotNo) || 1)));
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return `${dateKey}_${cleanSlot}_${uniqueSuffix}`.slice(0, 100);
}

export async function deleteServerPdfByUrl(pdfUrl: string, adminSecret?: string): Promise<void> {
  const clean = typeof pdfUrl === 'string' ? pdfUrl.trim() : '';
  if (!clean.startsWith('/api/lesson-pdf/')) return;
  if (!(await isApiBackendOnline())) return;
  const fileId = clean.slice('/api/lesson-pdf/'.length).split('?')[0].trim();
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(fileId)) return;
  try {
    const secret = resolveAdminWriteSecret(adminSecret);
    await fetch(`/api/lesson-pdf/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': secret },
    });
  } catch {
    // Best-effort cleanup
  }
}

export async function uploadLessonPdfFile(
  file: File,
  adminSecret?: string,
  onProgress?: (percent: number, loadedBytes: number, totalBytes: number) => void,
  materialId?: string,
): Promise<{
  sourceType: 'server' | 'chunks';
  materialId: string;
  url: string;
  fileId: string;
  fileName: string;
  size: number;
  chunkCount: number;
}> {
  const secret = resolveAdminWriteSecret(adminSecret);
  if (!file || file.size < 1) {
    throw new Error('PDF file is empty.');
  }
  if (file.size > MAX_SERVER_PDF_BYTES) {
    throw new Error('PDF_TOO_LARGE');
  }

  const cleanMatId = (
    typeof materialId === 'string' && materialId.trim()
      ? materialId.trim().replace(/[^a-zA-Z0-9_-]/g, '-')
      : `mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  ).slice(0, 100);
  const cleanFileName = (file.name || 'ders.pdf').trim().slice(0, 120);

  onProgress?.(2, 0, file.size);

  if (!(await isApiBackendOnline())) {
    if (!(await verifyStaticAdminSecret(secret))) {
      throw new Error('ADMIN_AUTH_FAILED');
    }
    await saveStaticPdfBlob(cleanMatId, cleanFileName, file);
    onProgress?.(100, file.size, file.size);
    return {
      sourceType: 'chunks',
      materialId: cleanMatId,
      url: '',
      fileId: cleanMatId,
      fileName: cleanFileName,
      size: file.size,
      chunkCount: 1,
    };
  }

  const serverChunkSize = 2 * 1024 * 1024;
  const totalChunks = Math.max(1, Math.ceil(file.size / serverChunkSize));

  const initResp = await fetch('/api/lesson-pdf/init', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': secret,
    },
    body: JSON.stringify({
      fileName: cleanFileName,
      fileSize: file.size,
      totalChunks,
    }),
  });
  const initJson = (await initResp.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    uploadId?: string;
    fileId?: string;
    chunkSize?: number;
  };
  if (!initResp.ok || !initJson.ok || !initJson.uploadId) {
    throw new Error(initJson.error || `HTTP_${initResp.status}`);
  }

  const uploadId = initJson.uploadId;
  const chunkSize = initJson.chunkSize || serverChunkSize;
  let uploadedBytes = 0;

  for (let idx = 0; idx < totalChunks; idx++) {
    const start = idx * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const slice = file.slice(start, end);

    const chunkResp = await fetch('/api/lesson-pdf/chunk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Admin-Secret': secret,
        'X-Upload-Id': uploadId,
        'X-Chunk-Index': String(idx),
      },
      body: slice,
    });
    const chunkJson = (await chunkResp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!chunkResp.ok || !chunkJson.ok) {
      throw new Error(chunkJson.error || `CHUNK_FAILED_${idx}`);
    }

    uploadedBytes = end;
    const pct = Math.min(95, Math.max(5, Math.round((uploadedBytes / file.size) * 92)));
    onProgress?.(pct, uploadedBytes, file.size);
  }

  const completeResp = await fetch('/api/lesson-pdf/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': secret,
    },
    body: JSON.stringify({ uploadId }),
  });
  const completeJson = (await completeResp.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    fileId?: string;
    url?: string;
    fileName?: string;
    size?: number;
  };
  if (!completeResp.ok || !completeJson.ok || !completeJson.url) {
    throw new Error(completeJson.error || `HTTP_${completeResp.status}`);
  }

  onProgress?.(100, file.size, file.size);
  return {
    sourceType: 'server',
    materialId: cleanMatId,
    url: completeJson.url,
    fileId: completeJson.fileId || cleanMatId,
    fileName: completeJson.fileName || cleanFileName,
    size: completeJson.size || file.size,
    chunkCount: 0,
  };
}

export async function downloadLessonMaterialChunks(
  materialId: string,
  _chunkCount: number,
  onProgress?: (percent: number, loadedChunks: number, totalChunks: number) => void,
): Promise<Blob> {
  if (!(await isApiBackendOnline())) {
    const blob = await loadStaticPdfBlob(materialId);
    if (!blob) throw new Error('STATIC_PDF_NOT_FOUND');
    onProgress?.(100, 1, 1);
    return blob;
  }
  const resp = await fetch(`/api/lesson-pdf/${encodeURIComponent(materialId)}?download=1`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
  onProgress?.(100, 1, 1);
  return resp.blob();
}

function mapServerMaterial(m: Record<string, unknown>): LessonMaterial {
  const pdfUrl = typeof m.pdfUrl === 'string' ? m.pdfUrl : '';
  const pdfData = typeof m.pdfData === 'string' && m.pdfData.length > 0 ? m.pdfData : undefined;
  const chunkCount = typeof m.chunkCount === 'number' && m.chunkCount > 0 ? Math.round(m.chunkCount) : undefined;
  const sourceType: 'url' | 'file' | 'server' | 'chunks' =
    pdfUrl.startsWith('/api/lesson-pdf/') || m.sourceType === 'server'
      ? 'server'
      : chunkCount && chunkCount > 0
        ? 'chunks'
        : pdfData
          ? 'file'
          : 'url';

  return {
    id: String(m.id || ''),
    date: normalizeMaterialDate(String(m.date || '')),
    slotNo: Number(m.slotNo) || 1,
    targetProg: normalizeLangPref(m.targetProg),
    title: String(m.title || ''),
    sourceType,
    pdfUrl,
    pdfData,
    chunkCount,
    pdfName: typeof m.pdfName === 'string' && m.pdfName ? m.pdfName : undefined,
    fileSize: typeof m.fileSize === 'number' && m.fileSize > 0 ? m.fileSize : undefined,
    createdAtMs: Number(m.createdAtMs) || 0,
    updatedAtMs: Number(m.updatedAtMs) || 0,
  };
}

export async function loadAllLessonMaterials(): Promise<LessonMaterial[]> {
  try {
    const resp = await fetch('/api/materials', { cache: 'no-store' });
    if (resp.ok) {
      const json = (await resp.json()) as { ok?: boolean; materials?: Record<string, unknown>[] };
      if (json.ok && Array.isArray(json.materials)) {
        const list = json.materials
          .map(mapServerMaterial)
          .sort((a, b) => (a.createdAtMs || a.updatedAtMs) - (b.createdAtMs || b.updatedAtMs));
        const map: Record<string, unknown> = {};
        list.forEach((m) => { map[m.id] = { ...m, deleted: false }; });
        writeStaticJson('materials', map);
        return list;
      }
    }
  } catch {}
  await fetchConsolidatedGlobalState(false);
  const map = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
  return Object.values(map)
    .filter((r) => r && r.deleted !== true)
    .map(mapServerMaterial)
    .sort((a, b) => (a.createdAtMs || a.updatedAtMs) - (b.createdAtMs || b.updatedAtMs));
}

export function subscribeLessonMaterials(onUpdate: (materials: LessonMaterial[]) => void): Unsubscribe {
  void loadAllLessonMaterials().then(onUpdate);
  return addSseListener('materials', () => {
    void loadAllLessonMaterials().then(onUpdate);
  });
}

export async function saveLessonMaterial(
  input: {
    id?: string;
    date: string;
    slotNo: number;
    targetProg?: '' | 'tr' | 'en';
    title: string;
    sourceType?: 'url' | 'file' | 'server' | 'chunks';
    pdfUrl?: string;
    pdfData?: string;
    chunkCount?: number;
    pdfName?: string;
    fileSize?: number;
  },
  adminSecret?: string,
): Promise<LessonMaterial> {
  const secret = resolveAdminWriteSecret(adminSecret);
  const cleanDate = normalizeMaterialDate(input.date);
  const slotNo = Math.min(10, Math.max(1, Math.round(Number(input.slotNo) || 1)));
  const targetProg = normalizeLangPref(input.targetProg);
  const cleanTitle = String(input.title || '').trim().slice(0, 120);
  const rawData = typeof input.pdfData === 'string' ? input.pdfData.trim().replace(/^data:[^;]+;base64,/i, '') : '';
  const cleanChunkCount = Math.max(0, Math.round(Number(input.chunkCount) || 0));
  let cleanUrl = String(input.pdfUrl || '').trim();
  if (cleanUrl && !cleanUrl.startsWith('/api/lesson-pdf/') && !/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = `https://${cleanUrl}`;
  }
  cleanUrl = cleanUrl.slice(0, 2000);

  const sourceType: 'url' | 'file' | 'server' | 'chunks' =
    cleanUrl.startsWith('/api/lesson-pdf/') || input.sourceType === 'server'
      ? 'server'
      : input.sourceType === 'chunks' && cleanChunkCount > 0
        ? 'chunks'
        : input.sourceType === 'file' || (rawData.length > 0 && !cleanUrl)
          ? 'file'
          : 'url';

  if (!cleanDate || !cleanTitle) {
    throw new Error('Date and title are required.');
  }
  if (sourceType === 'file' && !rawData) {
    throw new Error('PDF file data is required.');
  }
  if ((sourceType === 'server' || sourceType === 'url') && !cleanUrl) {
    throw new Error('PDF URL is required.');
  }

  const candidateId = input.id
    ? input.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 110)
    : generateLessonMaterialId(cleanDate, slotNo);

  const map = readStaticJson<Record<string, LessonMaterial & { deleted?: boolean }>>('materials', {});
  const now = Date.now();
  const prev = map[candidateId];
  const saved: LessonMaterial = {
    id: candidateId,
    date: cleanDate,
    slotNo,
    targetProg,
    title: cleanTitle,
    sourceType,
    pdfUrl: sourceType === 'file' || sourceType === 'chunks' ? '' : cleanUrl,
    pdfData: sourceType === 'file' ? rawData : undefined,
    chunkCount: sourceType === 'chunks' ? cleanChunkCount : undefined,
    pdfName: String(input.pdfName || '').trim().slice(0, 120) || undefined,
    fileSize: typeof input.fileSize === 'number' && input.fileSize > 0 ? Math.round(input.fileSize) : undefined,
    createdAtMs: prev?.createdAtMs || now,
    updatedAtMs: now,
  };
  map[candidateId] = { ...saved, deleted: false };
  writeStaticJson('materials', map);
  void syncConsolidatedGlobalStateToFirestore(secret);

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/materials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret,
        },
        body: JSON.stringify({
          id: candidateId,
          date: cleanDate,
          slotNo,
          targetProg,
          title: cleanTitle,
          sourceType,
          pdfUrl: sourceType === 'file' || sourceType === 'chunks' ? '' : cleanUrl,
          pdfData: sourceType === 'file' ? rawData : '',
          chunkCount: sourceType === 'chunks' ? cleanChunkCount : 0,
          pdfName: String(input.pdfName || '').trim().slice(0, 120),
          fileSize: typeof input.fileSize === 'number' ? Math.round(input.fileSize) : 0,
        }),
      });
      const json = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        material?: Record<string, unknown>;
      };
      if (resp.ok && json.ok && json.material) {
        const serverSaved = mapServerMaterial(json.material);
        map[serverSaved.id] = { ...serverSaved, deleted: false };
        writeStaticJson('materials', map);
        emitLocalTopic('materials', { action: 'save', id: serverSaved.id });
        return serverSaved;
      }
    } catch {}
  }

  emitLocalTopic('materials', { action: 'save', id: candidateId });
  return saved;
}

export async function deleteLessonMaterial(id: string, adminSecret?: string): Promise<void> {
  const cleanId = String(id || '').trim();
  if (!cleanId) return;
  const secret = resolveAdminWriteSecret(adminSecret);

  const map = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
  if (map[cleanId]) {
    map[cleanId] = { ...map[cleanId], deleted: true, updatedAtMs: Date.now() };
    writeStaticJson('materials', map);
  }
  void syncConsolidatedGlobalStateToFirestore(secret);

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/materials/${encodeURIComponent(cleanId)}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Secret': secret },
      });
      if (resp.ok) {
        emitLocalTopic('materials', { action: 'delete', id: cleanId });
        return;
      }
    } catch {}
  }

  await deleteStaticPdfBlob(cleanId);
  emitLocalTopic('materials', { action: 'delete', id: cleanId });
}

// ==================== ADMIN STUDENT MANAGEMENT ====================
function readAdminDirFullName(authHash: string, dirData: Record<string, unknown> | null | undefined): string {
  if (!dirData) return '';
  const encFullName = dirData.enc_full_name ?? dirData.encFullName;
  if (typeof encFullName === 'string' && encFullName) {
    const dec = decryptDirectoryName(authHash, encFullName);
    if (dec) return dec;
  }
  if (typeof dirData.fullName === 'string' && dirData.fullName) {
    return dirData.fullName;
  }
  return '';
}

export async function addOrUpdateCustomStudent(
  input: {
    studentId: string;
    fullName: string;
    group: 'I' | 'II' | 'III' | 'IV' | 'V';
    labGroup?: '' | '1' | '2';
    prog: 'tr' | 'en';
    otherGroupMode?: 'dim' | 'hide';
    active?: boolean;
  },
  adminSecret?: string,
  options?: { rejectIfExists?: boolean },
): Promise<AdminStudentListItem> {
  const secret = resolveAdminWriteSecret(adminSecret);
  const sid = normalizeStudentId(input.studentId);
  if (!/^01\d{9}$/.test(sid)) {
    throw new Error('Invalid student ID format.');
  }
  const cleanName = String(input.fullName || '').trim().slice(0, 120);
  if (!cleanName) {
    throw new Error('Student full name is required.');
  }
  const group = normalizeAssignedGroup(input.group);
  const prog: 'tr' | 'en' = input.prog === 'en' ? 'en' : 'tr';
  const labGroup = prog === 'en' ? '' : normalizeLabGroupPref(input.labGroup);
  const otherGroupMode = normalizeOtherGroupModePref(input.otherGroupMode);
  const active = input.active !== false;

  const authHash = hashStudentId(sid);
  const cloudKey = await deriveCloudDocId(sid);
  const last4 = sid.slice(-4);
  const encName = encryptStudentName(sid, cleanName);
  const encFullName = encryptDirectoryName(authHash, cleanName);
  const source: 'allowlist' | 'custom' = verifyStudentHash(authHash) ? 'allowlist' : 'custom';

  let encSid = '';
  try {
    const unlocked = await resolveUnlockedRosterData(secret);
    if (unlocked) {
      encSid = await encryptAdminSid(unlocked.aesKey, sid);
    }
  } catch {
    // Optional encSid
  }

  const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
  const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
  const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
  const existingCustom = customMap[authHash];
  const existingDir = dirMap[authHash];

  if (options?.rejectIfExists && !(await isApiBackendOnline())) {
    const customLive = Boolean(existingCustom && existingCustom.deleted !== 1 && existingCustom.deleted !== true);
    const dirLive = Boolean(existingDir && existingDir.deleted !== 1 && existingDir.deleted !== true);
    const customDeleted = Boolean(existingCustom && (existingCustom.deleted === 1 || existingCustom.deleted === true));
    const dirDeleted = Boolean(existingDir && (existingDir.deleted === 1 || existingDir.deleted === true));
    const builtInNotDeleted = Boolean(verifyStudentId(sid)) && !customDeleted && !dirDeleted;
    if (customLive || dirLive || builtInNotDeleted) {
      throw new Error('DUPLICATE_STUDENT_ID');
    }
  }

  const now = Date.now();
  customMap[authHash] = {
    auth_hash: authHash,
    cloud_key: cloudKey,
    last4,
    group_name: group,
    lab_group: labGroup,
    prog,
    enc_name: encName || existingCustom?.enc_name || '',
    enc_sid: encSid || existingCustom?.enc_sid || '',
    active: active ? 1 : 0,
    deleted: 0,
    created_at: existingCustom?.created_at || now,
    updated_at: now,
  };
  dirMap[authHash] = {
    auth_hash: authHash,
    cloud_key: cloudKey,
    last4,
    enc_full_name: encFullName || existingDir?.enc_full_name || '',
    enc_sid: encSid || existingDir?.enc_sid || '',
    group_name: group,
    lab_group: labGroup,
    prog,
    source,
    active: active ? 1 : 0,
    deleted: 0,
    created_at: existingDir?.created_at || now,
    updated_at: now,
  };
  prefsMap[cloudKey] = {
    cloud_key: cloudKey,
    auth_hash: authHash,
    last4,
    my_mbu_group: group,
    my_lab_group: labGroup,
    other_group_mode: otherGroupMode,
    lang: prog,
    updated_at: now,
  };
  writeStaticJson('custom_students', customMap);
  writeStaticJson('admin_dir', dirMap);
  writeStaticJson('student_prefs', prefsMap);
  void syncConsolidatedGlobalStateToFirestore(secret);
  void saveCloudStudentPrefs(authHash, cloudKey, {
    myMbuGroup: group,
    myLabGroup: labGroup,
    otherGroupMode,
    lang: prog,
    last4,
  });

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/admin/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret,
        },
        body: JSON.stringify({
          authHash,
          cloudKey,
          last4,
          group,
          labGroup,
          prog,
          otherGroupMode,
          encName,
          encFullName,
          encSid,
          source,
          active,
          rejectIfExists: Boolean(options?.rejectIfExists),
          builtInAllowlist: Boolean(verifyStudentId(sid)),
        }),
      });
      const json = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string; updatedAtMs?: number };
      if (!resp.ok || !json.ok) {
        if (json.error === 'DUPLICATE_STUDENT_ID') {
          throw new Error('DUPLICATE_STUDENT_ID');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_STUDENT_ID') {
        throw err;
      }
    }
  }

  emitLocalTopic('student_status', { authHash, active, deleted: false });

  return {
    authHash,
    cloudKey,
    studentId: sid,
    last4,
    fullName: cleanName,
    group,
    prog,
    myMbuGroup: group,
    myLabGroup: labGroup,
    otherGroupMode,
    lang: prog,
    source,
    active,
    updatedAtMs: now,
  };
}

export async function deleteCustomStudent(
  authHash: string,
  cloudKey?: string,
  adminSecret?: string,
  studentHint?: {
    studentId?: string;
    last4?: string;
    fullName?: string;
    group?: string;
    myMbuGroup?: string;
    myLabGroup?: string;
    prog?: string;
    source?: string;
  },
): Promise<void> {
  if (!isValidAuthHash(authHash)) return;
  if (isAdminStudentHash(authHash)) {
    throw new Error('CANNOT_DELETE_ADMIN');
  }
  const secret = resolveAdminWriteSecret(adminSecret);
  const unlockedRoster = await resolveUnlockedRosterData(secret).catch(() => null);
  const rosterEntry = unlockedRoster?.entries.find((e) => e.authHash === authHash);
  const allowMeta = verifyStudentHash(authHash);

  const hintSid =
    typeof studentHint?.studentId === 'string' && /^01\d{9}$/.test(studentHint.studentId.trim())
      ? studentHint.studentId.trim()
      : '';
  const effectiveSid = hintSid || rosterEntry?.sid || '';
  const derivedCloudKey =
    (typeof cloudKey === 'string' && isValidCloudDocId(cloudKey) ? cloudKey : '') ||
    rosterEntry?.cloudKey ||
    (effectiveSid ? await deriveCloudDocId(effectiveSid) : '');
  const effectiveLast4 =
    (effectiveSid ? effectiveSid.slice(-4) : '') ||
    (typeof studentHint?.last4 === 'string' && /^[0-9]{4}$/.test(studentHint.last4) ? studentHint.last4 : '') ||
    '0000';
  const effectiveGroup = normalizeAssignedGroup(
    studentHint?.group ?? studentHint?.myMbuGroup ?? rosterEntry?.group ?? allowMeta?.group ?? 'I',
  );
  const effectiveProg: 'tr' | 'en' =
    studentHint?.prog === 'en' || rosterEntry?.prog === 'en' || allowMeta?.prog === 'en' ? 'en' : 'tr';
  const effectiveLabGroup =
    effectiveProg === 'en' ? '' : normalizeLabGroupPref(studentHint?.myLabGroup ?? '');
  const effectiveSource: 'allowlist' | 'custom' =
    allowMeta || rosterEntry || studentHint?.source === 'allowlist' ? 'allowlist' : 'custom';
  const resolvedName =
    (typeof studentHint?.fullName === 'string' ? studentHint.fullName.trim() : '') ||
    rosterEntry?.fullName ||
    `Öğrenci •••${effectiveLast4}`;

  let encSid = '';
  if (effectiveSid && unlockedRoster) {
    encSid = await encryptAdminSid(unlockedRoster.aesKey, effectiveSid).catch(() => '');
  }

  const encName = effectiveSid && resolvedName ? encryptStudentName(effectiveSid, resolvedName.slice(0, 120)) : '';
  const encFullName = encryptDirectoryName(authHash, resolvedName.slice(0, 120) || `Öğrenci •••${effectiveLast4}`);

  const now = Date.now();
  const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
  const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
  customMap[authHash] = {
    ...(customMap[authHash] || {}),
    auth_hash: authHash,
    cloud_key: derivedCloudKey,
    last4: effectiveLast4,
    group_name: effectiveGroup,
    lab_group: effectiveLabGroup,
    prog: effectiveProg,
    enc_name: customMap[authHash]?.enc_name || encName,
    enc_sid: customMap[authHash]?.enc_sid || encSid,
    active: 0,
    deleted: 1,
    updated_at: now,
  };
  if (isValidCloudDocId(derivedCloudKey)) {
    dirMap[authHash] = {
      ...(dirMap[authHash] || {}),
      auth_hash: authHash,
      cloud_key: derivedCloudKey,
      last4: effectiveLast4,
      enc_full_name: dirMap[authHash]?.enc_full_name || encFullName,
      enc_sid: dirMap[authHash]?.enc_sid || encSid,
      group_name: effectiveGroup,
      lab_group: effectiveLabGroup,
      prog: effectiveProg,
      source: effectiveSource,
      active: 0,
      deleted: 1,
      updated_at: now,
    };
  }
  writeStaticJson('custom_students', customMap);
  writeStaticJson('admin_dir', dirMap);
  void syncConsolidatedGlobalStateToFirestore(secret);

  if (await isApiBackendOnline()) {
    try {
      await fetch('/api/admin/students/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret,
        },
        body: JSON.stringify({
          authHash,
          cloudKey: derivedCloudKey,
          last4: effectiveLast4,
          group: effectiveGroup,
          labGroup: effectiveLabGroup,
          prog: effectiveProg,
          source: effectiveSource,
          encName,
          encFullName,
          encSid,
        }),
      });
    } catch {}
  }

  emitLocalTopic('student_status', { authHash, active: false, deleted: true });
}

export async function lookupStudentForAdmin(rawSid: string): Promise<AdminStudentListItem | null> {
  const sid = normalizeStudentId(rawSid);
  if (!/^01\d{9}$/.test(sid)) return null;
  const authHash = hashStudentId(sid);
  const cloudKey = await deriveCloudDocId(sid);
  const last4 = sid.slice(-4);
  const allowMatch = verifyStudentId(sid);

  let dirData: Record<string, unknown> | null = null;
  let customData: Record<string, unknown> | null = null;
  let prefsData: Record<string, unknown> | null = null;

  if (await isApiBackendOnline()) {
    if (hasAdminWriteSecret()) {
      try {
        const resp = await fetch(`/api/admin/students/lookup/${encodeURIComponent(authHash)}/${encodeURIComponent(cloudKey)}`, {
          headers: { 'X-Admin-Secret': activeAdminWriteSecret },
          cache: 'no-store',
        });
        if (resp.ok) {
          const json = (await resp.json()) as {
            directory?: Record<string, unknown> | null;
            custom?: Record<string, unknown> | null;
            prefs?: Record<string, unknown> | null;
          };
          if (json.directory) {
            if (json.directory.deleted === 1) return null;
            dirData = json.directory;
          }
          if (json.custom) {
            if (json.custom.deleted === 1) return null;
            customData = json.custom;
          }
          if (json.prefs) prefsData = json.prefs;
        }
      } catch {
        // Fallback to local allowlist
      }
    } else {
      // Public status + prefs lookup if unlocked isn't present yet
      try {
        const [statusResp, prefsResp] = await Promise.all([
          fetch(`/api/student/login-status/${encodeURIComponent(authHash)}`, { cache: 'no-store' }),
          fetch(`/api/student/prefs/${encodeURIComponent(cloudKey)}`, { cache: 'no-store' }),
        ]);
        if (statusResp.ok) {
          const sJson = (await statusResp.json()) as {
            custom?: Record<string, unknown> | null;
            directory?: Record<string, unknown> | null;
          };
          if (sJson.custom?.deleted === true || sJson.directory?.deleted === true) return null;
          if (sJson.custom) customData = sJson.custom;
          if (sJson.directory) dirData = sJson.directory;
        }
        if (prefsResp.ok) {
          const pJson = (await prefsResp.json()) as { prefs?: Record<string, unknown> | null };
          if (pJson.prefs) prefsData = pJson.prefs;
        }
      } catch {
        // Fallback
      }
    }
  } else {
    await fetchConsolidatedGlobalState(false);
    const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
    const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
    const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
    const dRow = dirMap[authHash];
    const cRow = customMap[authHash];
    const pRow = prefsMap[cloudKey];
    if (dRow) {
      if (dRow.deleted === 1 || dRow.deleted === true) return null;
      dirData = dRow;
    }
    if (cRow) {
      if (cRow.deleted === 1 || cRow.deleted === true) return null;
      customData = cRow;
    }
    if (pRow) prefsData = pRow;
  }

  if (!allowMatch && !dirData && !customData && !prefsData) {
    return null;
  }

  const rawEncName = (customData?.enc_name ?? customData?.encName) as string | undefined;
  const decryptedCustom = typeof rawEncName === 'string' ? decryptStudentName(sid, rawEncName) : '';
  const fullName =
    readAdminDirFullName(authHash, dirData) ||
    decryptedCustom ||
    allowMatch?.name ||
    `Öğrenci •••${last4}`;

  const baseGroup = normalizeAssignedGroup(
    (customData?.group_name as string) || (customData?.group as string) || (dirData?.group_name as string) || (dirData?.group as string) || allowMatch?.group || 'I',
  );
  const baseProg: 'tr' | 'en' =
    customData?.prog === 'en' || dirData?.prog === 'en'
      ? 'en'
      : customData?.prog === 'tr' || dirData?.prog === 'tr'
        ? 'tr'
        : allowMatch?.prog || 'tr';

  const prefMbu = prefsData?.my_mbu_group ?? prefsData?.myMbuGroup;
  const prefLab = prefsData?.my_lab_group ?? prefsData?.myLabGroup;
  const prefMode = prefsData?.other_group_mode ?? prefsData?.otherGroupMode;
  const customLab = customData?.lab_group ?? customData?.labGroup;

  return {
    authHash,
    cloudKey,
    studentId: sid,
    last4,
    fullName,
    group: baseGroup,
    prog: baseProg,
    myMbuGroup: prefsData ? normalizeMbuGroupPref(prefMbu) : baseGroup,
    myLabGroup: baseProg === 'en' ? '' : (prefsData ? normalizeLabGroupPref(prefLab) : normalizeLabGroupPref(customLab)),
    otherGroupMode: prefsData ? normalizeOtherGroupModePref(prefMode) : 'dim',
    lang: prefsData ? (normalizeLangPref(prefsData.lang) || baseProg) : baseProg,
    source: allowMatch ? 'allowlist' : 'custom',
    active: customData ? (customData.active !== 0 && customData.active !== false) : dirData ? (dirData.active !== 0 && dirData.active !== false) : true,
    updatedAtMs: Math.max(Number(prefsData?.updated_at) || 0, Number(dirData?.updated_at) || 0, Number(customData?.updated_at) || 0),
  };
}

export async function loadAllAdminStudents(adminSecret?: string): Promise<AdminStudentListItem[]> {
  const secret = resolveAdminWriteSecret(adminSecret);
  let json: {
    ok?: boolean;
    error?: string;
    wrappedRosterKey?: string;
    directory?: Record<string, unknown>[];
    custom?: Record<string, unknown>[];
    prefs?: Record<string, unknown>[];
  } = {};

  let loadedFromApi = false;
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/admin/students', {
        headers: { 'X-Admin-Secret': secret },
        cache: 'no-store',
      });
      const parsed = (await resp.json().catch(() => ({}))) as typeof json;
      if (resp.ok && parsed.ok) {
        json = parsed;
        loadedFromApi = true;
      }
    } catch {}
  }

  if (!loadedFromApi) {
    await fetchConsolidatedGlobalState(false);
    const sec = getStaticSecurityConfig();
    const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
    const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
    const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
    json = {
      ok: true,
      wrappedRosterKey: sec.wrappedRosterKey,
      directory: Object.values(dirMap),
      custom: Object.values(customMap),
      prefs: Object.values(prefsMap),
    };
  }

  const unlockedRoster = await resolveUnlockedRosterData(secret, json.wrappedRosterKey).catch(() => null);

  const dirByHash = new Map<string, Record<string, unknown>>();
  (json.directory || []).forEach((d) => {
    if (typeof d.auth_hash === 'string') dirByHash.set(d.auth_hash, d);
  });

  const customByHash = new Map<string, Record<string, unknown>>();
  (json.custom || []).forEach((d) => {
    if (typeof d.auth_hash === 'string') customByHash.set(d.auth_hash, d);
  });

  const prefsByCloud = new Map<string, Record<string, unknown>>();
  (json.prefs || []).forEach((d) => {
    if (typeof d.cloud_key === 'string') prefsByCloud.set(d.cloud_key, d);
  });

  const rosterByCloud = new Map<string, DecryptedRosterEntry>();
  if (unlockedRoster) {
    unlockedRoster.entries.forEach((entry) => {
      rosterByCloud.set(entry.cloudKey, entry);
    });
  }

  const seenHashes = new Set<string>();
  const seenCloudKeys = new Set<string>();
  const results: AdminStudentListItem[] = [];

  if (unlockedRoster) {
    for (const entry of unlockedRoster.entries) {
      const { authHash, cloudKey } = entry;
      seenHashes.add(authHash);
      seenCloudKeys.add(cloudKey);

      const dir = dirByHash.get(authHash);
      const custom = customByHash.get(authHash);
      const prefs = prefsByCloud.get(cloudKey);

      if (dir?.deleted === 1 || custom?.deleted === 1) continue;

      const baseGroup = normalizeAssignedGroup(
        (custom && custom.deleted !== 1 ? custom.group_name : undefined) ??
          (dir && dir.deleted !== 1 ? dir.group_name : undefined) ??
          entry.group,
      );
      const baseProg: 'tr' | 'en' =
        custom && custom.deleted !== 1 && (custom.prog === 'en' || custom.prog === 'tr')
          ? custom.prog
          : dir && dir.deleted !== 1 && (dir.prog === 'en' || dir.prog === 'tr')
            ? dir.prog
            : entry.prog;

      const effectiveLang: 'tr' | 'en' =
        prefs && (prefs.lang === 'en' || prefs.lang === 'tr') ? prefs.lang : baseProg;

      const resolvedName =
        (dir && dir.deleted !== 1 ? readAdminDirFullName(authHash, dir) : '') ||
        (custom && custom.deleted !== 1 && typeof custom.enc_name === 'string'
          ? decryptStudentName(entry.sid, custom.enc_name)
          : '') ||
        entry.fullName;

      results.push({
        authHash,
        cloudKey,
        studentId: entry.sid,
        last4: entry.sid.slice(-4),
        fullName: resolvedName,
        group: baseGroup,
        prog: baseProg,
        myMbuGroup: prefs ? normalizeMbuGroupPref(prefs.my_mbu_group) || baseGroup : baseGroup,
        myLabGroup:
          effectiveLang === 'en'
            ? ''
            : prefs
              ? normalizeLabGroupPref(prefs.my_lab_group)
              : normalizeLabGroupPref(
                  (custom && custom.deleted !== 1 ? custom.lab_group : undefined) ??
                    (dir && dir.deleted !== 1 ? dir.lab_group : undefined),
                ),
        otherGroupMode: prefs ? normalizeOtherGroupModePref(prefs.other_group_mode) : 'dim',
        lang: effectiveLang,
        source: 'allowlist',
        active:
          custom && custom.deleted !== 1
            ? custom.active !== 0
            : dir && dir.deleted !== 1
              ? dir.active !== 0
              : true,
        updatedAtMs: Math.max(Number(prefs?.updated_at) || 0, Number(dir?.updated_at) || 0, Number(custom?.updated_at) || 0),
      });
    }
  }

  const allCloudHashes = new Set<string>([
    ...Object.keys(STUDENT_AUTH_MAP),
    ...dirByHash.keys(),
    ...customByHash.keys(),
  ]);
  for (const authHash of allCloudHashes) {
    if (seenHashes.has(authHash)) continue;
    seenHashes.add(authHash);

    const dir = dirByHash.get(authHash);
    const custom = customByHash.get(authHash);
    const cloudKey =
      (typeof dir?.cloud_key === 'string' && dir.cloud_key) ||
      (typeof custom?.cloud_key === 'string' && custom.cloud_key) ||
      '';
    if (cloudKey) seenCloudKeys.add(cloudKey);

    if (dir?.deleted === 1 || custom?.deleted === 1) continue;

    const allowMeta = verifyStudentHash(authHash);
    const prefs = cloudKey ? prefsByCloud.get(cloudKey) : undefined;

    let decryptedSid = '';
    if (unlockedRoster) {
      const rawEncSid =
        (typeof dir?.enc_sid === 'string' && dir.enc_sid) ||
        (typeof custom?.enc_sid === 'string' && custom.enc_sid) ||
        '';
      if (rawEncSid) {
        decryptedSid = await decryptAdminSid(unlockedRoster.aesKey, rawEncSid);
      }
    }

    const last4 =
      (decryptedSid ? decryptedSid.slice(-4) : '') ||
      (typeof dir?.last4 === 'string' && dir.last4) ||
      (typeof custom?.last4 === 'string' && custom.last4) ||
      (typeof prefs?.last4 === 'string' && prefs.last4) ||
      '••••';

    const baseGroup = normalizeMbuGroupPref(custom?.group_name ?? dir?.group_name ?? allowMeta?.group ?? '');
    const baseProg: 'tr' | 'en' =
      custom?.prog === 'en' || dir?.prog === 'en'
        ? 'en'
        : custom?.prog === 'tr' || dir?.prog === 'tr'
          ? 'tr'
          : allowMeta?.prog || 'tr';
    const effectiveLang: 'tr' | 'en' =
      prefs && (prefs.lang === 'en' || prefs.lang === 'tr') ? prefs.lang : baseProg;

    const resolvedName =
      readAdminDirFullName(authHash, dir) ||
      (decryptedSid && typeof custom?.enc_name === 'string' ? decryptStudentName(decryptedSid, custom.enc_name) : '') ||
      (allowMeta ? `Dönem I •••${last4}` : `Özel Öğrenci •••${last4}`);

    results.push({
      authHash,
      cloudKey,
      studentId: decryptedSid || undefined,
      last4,
      fullName: resolvedName,
      group: baseGroup,
      prog: baseProg,
      myMbuGroup: prefs ? normalizeMbuGroupPref(prefs.my_mbu_group) : baseGroup,
      myLabGroup:
        effectiveLang === 'en'
          ? ''
          : prefs
            ? normalizeLabGroupPref(prefs.my_lab_group)
            : normalizeLabGroupPref(custom?.lab_group ?? dir?.lab_group),
      otherGroupMode: prefs ? normalizeOtherGroupModePref(prefs.other_group_mode) : 'dim',
      lang: effectiveLang,
      source: allowMeta ? 'allowlist' : 'custom',
      active: custom ? custom.active !== 0 : dir ? dir.active !== 0 : true,
      updatedAtMs: Math.max(Number(prefs?.updated_at) || 0, Number(dir?.updated_at) || 0, Number(custom?.updated_at) || 0),
    });
  }

  prefsByCloud.forEach((prefs, cloudKey) => {
    if (seenCloudKeys.has(cloudKey)) return;
    if (rosterByCloud.has(cloudKey)) return;
    const authHash = typeof prefs.auth_hash === 'string' ? prefs.auth_hash : '';
    const allowMeta = authHash ? verifyStudentHash(authHash) : null;
    const last4 = typeof prefs.last4 === 'string' && prefs.last4 ? prefs.last4 : cloudKey.slice(-4);
    const baseGroup = normalizeMbuGroupPref(allowMeta?.group || prefs.my_mbu_group || '');
    const baseProg: 'tr' | 'en' = allowMeta?.prog || (prefs.lang === 'en' ? 'en' : 'tr');

    results.push({
      authHash,
      cloudKey,
      last4,
      fullName: allowMeta ? `Dönem I Öğrencisi (Grup ${allowMeta.group})` : `Kayıtlı Öğrenci (${cloudKey.slice(0, 6)})`,
      group: baseGroup,
      prog: baseProg,
      myMbuGroup: normalizeMbuGroupPref(prefs.my_mbu_group),
      myLabGroup: baseProg === 'en' ? '' : normalizeLabGroupPref(prefs.my_lab_group),
      otherGroupMode: normalizeOtherGroupModePref(prefs.other_group_mode),
      lang: normalizeLangPref(prefs.lang) || baseProg,
      source: allowMeta ? 'allowlist' : 'custom',
      active: true,
      updatedAtMs: Number(prefs.updated_at) || 0,
    });
  });

  return results.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'custom' ? -1 : 1;
    return a.fullName.localeCompare(b.fullName, 'tr');
  });
}

export async function adminSaveStudentSettings(
  input: {
    cloudKey: string;
    authHash?: string;
    studentId?: string;
    last4?: string;
    fullName?: string;
    myMbuGroup: '' | 'I' | 'II' | 'III' | 'IV' | 'V';
    myLabGroup: '' | '1' | '2';
    otherGroupMode: 'dim' | 'hide';
    lang: 'tr' | 'en';
    source?: 'allowlist' | 'custom';
    active?: boolean;
  },
  adminSecret?: string,
): Promise<void> {
  if (!isValidCloudDocId(input.cloudKey)) {
    throw new Error('Invalid cloud document key.');
  }

  const mbu = normalizeMbuGroupPref(input.myMbuGroup);
  const lang: 'tr' | 'en' = input.lang === 'en' ? 'en' : 'tr';
  const lab = lang === 'en' ? '' : normalizeLabGroupPref(input.myLabGroup);
  const mode = normalizeOtherGroupModePref(input.otherGroupMode);
  const authHash = input.authHash && isValidAuthHash(input.authHash) ? input.authHash : '';
  const cleanSid = typeof input.studentId === 'string' && /^01\d{9}$/.test(input.studentId.trim()) ? input.studentId.trim() : '';
  const cleanLast4 =
    cleanSid
      ? cleanSid.slice(-4)
      : typeof input.last4 === 'string' && /^[0-9]{4}$/.test(input.last4.trim())
        ? input.last4.trim()
        : '';

  if (!authHash) {
    await saveCloudStudentPrefs('', input.cloudKey, {
      myMbuGroup: mbu,
      myLabGroup: lab,
      otherGroupMode: mode,
      lang,
      last4: cleanLast4,
    });
    return;
  }

  const secret = resolveAdminWriteSecret(adminSecret);
  if (isAdminStudentHash(authHash) && input.active === false) {
    throw new Error('CANNOT_DEACTIVATE_ADMIN');
  }

  const unlockedRoster = await resolveUnlockedRosterData(secret).catch(() => null);
  const rosterEntry = unlockedRoster?.entries.find((e) => e.authHash === authHash);
  const effectiveSid = cleanSid || rosterEntry?.sid || '';
  const effectiveLast4 = (effectiveSid ? effectiveSid.slice(-4) : '') || cleanLast4 || '0000';
  const assignedGroup = mbu ? normalizeAssignedGroup(mbu) : normalizeAssignedGroup(rosterEntry?.group || 'I');
  const isActive = isAdminStudentHash(authHash) ? true : input.active !== false;

  let encSid = '';
  if (effectiveSid && unlockedRoster) {
    encSid = await encryptAdminSid(unlockedRoster.aesKey, effectiveSid).catch(() => '');
  }

  const resolvedName = String(input.fullName || rosterEntry?.fullName || '').trim().slice(0, 120);
  const encName = effectiveSid && resolvedName ? encryptStudentName(effectiveSid, resolvedName) : '';
  const encFullName = resolvedName ? encryptDirectoryName(authHash, resolvedName) : '';

  const sourceVal: 'allowlist' | 'custom' =
    input.source === 'custom' || !verifyStudentHash(authHash) ? 'custom' : 'allowlist';

  const now = Date.now();
  const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
  const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
  const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});

  const prevPref = prefsMap[input.cloudKey] || {};
  prefsMap[input.cloudKey] = {
    cloud_key: input.cloudKey,
    auth_hash: authHash || prevPref.auth_hash || '',
    last4: effectiveLast4 || prevPref.last4 || '',
    my_mbu_group: mbu,
    my_lab_group: lab,
    other_group_mode: mode,
    lang,
    updated_at: now,
  };

  if (authHash) {
    const prevCustom = customMap[authHash] || {};
    customMap[authHash] = {
      auth_hash: authHash,
      cloud_key: input.cloudKey,
      last4: effectiveLast4 !== '0000' ? effectiveLast4 : (prevCustom.last4 || '0000'),
      group_name: assignedGroup,
      lab_group: lab,
      prog: lang,
      enc_name: encName || prevCustom.enc_name || '',
      enc_sid: encSid || prevCustom.enc_sid || '',
      active: isActive ? 1 : 0,
      deleted: 0,
      created_at: prevCustom.created_at || now,
      updated_at: now,
    };

    const prevDir = dirMap[authHash] || {};
    dirMap[authHash] = {
      auth_hash: authHash,
      cloud_key: input.cloudKey,
      last4: effectiveLast4 !== '0000' ? effectiveLast4 : (prevDir.last4 || '0000'),
      enc_full_name: encFullName || prevDir.enc_full_name || '',
      enc_sid: encSid || prevDir.enc_sid || '',
      group_name: assignedGroup,
      lab_group: lab,
      prog: lang,
      source: sourceVal,
      active: isActive ? 1 : 0,
      deleted: 0,
      created_at: prevDir.created_at || now,
      updated_at: now,
    };
  }

  writeStaticJson('student_prefs', prefsMap);
  writeStaticJson('custom_students', customMap);
  writeStaticJson('admin_dir', dirMap);
  void syncConsolidatedGlobalStateToFirestore(secret);
  void saveCloudStudentPrefs(authHash, input.cloudKey, {
    myMbuGroup: mbu,
    myLabGroup: lab,
    otherGroupMode: mode,
    lang,
    last4: effectiveLast4,
  });

  if (await isApiBackendOnline()) {
    try {
      await fetch('/api/admin/students/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret,
        },
        body: JSON.stringify({
          cloudKey: input.cloudKey,
          authHash,
          last4: effectiveLast4,
          myMbuGroup: mbu,
          myLabGroup: lab,
          otherGroupMode: mode,
          lang,
          assignedGroup,
          active: isActive,
          encName,
          encFullName,
          encSid,
          source: sourceVal,
        }),
      });
    } catch {}
  }

  if (authHash) {
    emitLocalTopic('student_status', { authHash, active: isActive, deleted: false });
  }
}
