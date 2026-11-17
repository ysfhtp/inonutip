/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
const SERVER_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

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

// ==================== APP VERSION & AUTO-INCREMENT ====================
export function getAppVersion(): string {
  if (typeof localStorage === 'undefined') return '3.2.12';
  const v = localStorage.getItem('inonu_tip_d1_ios_v3_version');
  if (v && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v)) return v;
  return '3.2.12';
}

export function bumpAppVersion(): string {
  if (typeof localStorage === 'undefined') return '3.2.12';
  const current = getAppVersion();
  const parts = current.split('.');
  const major = parts[0] || '3';
  const minor = parts[1] || '2';
  const patch = parseInt(parts[2] || '1', 10) + 1;
  const next = `${major}.${minor}.${patch}`;
  localStorage.setItem('inonu_tip_d1_ios_v3_version', next);
  emitLocalTopic('version', { version: next });
  return next;
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

function probeApiBackend(force = false): Promise<'online' | 'static'> {
  const now = Date.now();
  if (!force && apiBackendStatus !== 'unknown' && now - apiBackendCheckedAt < 15_000) {
    return Promise.resolve(apiBackendStatus);
  }
  if (!force && apiProbePromise) return apiProbePromise;

  apiProbePromise = (async () => {
    try {
      const resp = await fetch('/api/health', {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        const json = (await resp.json().catch(() => ({}))) as { ok?: boolean };
        if (json.ok) {
          apiBackendStatus = 'online';
          apiBackendCheckedAt = Date.now();
          return 'online';
        }
      }
      apiBackendStatus = 'static';
      apiBackendCheckedAt = Date.now();
      return 'static';
    } catch {
      apiBackendStatus = 'static';
      apiBackendCheckedAt = Date.now();
      return 'static';
    } finally {
      apiProbePromise = null;
    }
  })();

  return apiProbePromise;
}

async function isApiBackendOnline(): Promise<boolean> {
  return (await probeApiBackend()) === 'online';
}

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
      } else if (subKey === 'version') {
        notifyLocalSubscribersOnly('version', readStaticJson('version', null));
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

let staticLivePollTimer: ReturnType<typeof setInterval> | null = null;
let staticLiveListenersBound = false;

function ensureStaticLivePolling(): void {
  if (typeof window === 'undefined') return;
  if (!staticLiveListenersBound) {
    staticLiveListenersBound = true;
    const triggerImmediateSync = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void probeApiBackend().then((status) => {
        if (status !== 'online') {
          void syncStaticStoreFromDataJson(true);
        } else {
          void loadSiteAccessSettings().then((s) => notifyLocalSubscribersOnly('access', s));
        }
      });
    };
    window.addEventListener('focus', triggerImmediateSync);
    window.addEventListener('online', triggerImmediateSync);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        triggerImmediateSync();
      }
    });
  }

  if (staticLivePollTimer !== null) return;
  staticLivePollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    void probeApiBackend().then((status) => {
      if (status !== 'online') {
        void syncStaticStoreFromDataJson(false);
      }
    });
  }, 1000);
}

function addSseListener(topic: string, handler: SseHandler): Unsubscribe {
  ensureEventSource();
  ensureStaticLivePolling();
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

// ==================== LOCAL CACHE & INDEXEDDB PDF CACHE ====================
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
  updatedAtMs?: number;
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
    updatedAtMs: Number(saved.updatedAtMs) || 0,
  };
}

// ==================== STATIC DATA.JSON SYNC & GITHUB PUBLISH ====================
export interface GithubSourceMeta {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  gistId?: string;
}

export interface SiteDataJson {
  version?: string;
  updatedAtMs?: number;
  githubSource?: GithubSourceMeta;
  access?: {
    requireStudentLogin?: boolean;
    updatedAtMs?: number;
  };
  security?: Partial<StaticAdminSecurityConfig> | null;
  announcements?: Array<Record<string, unknown>>;
  materials?: Array<Record<string, unknown>>;
  customStudents?: Record<string, Record<string, unknown>> | Array<Record<string, unknown>>;
  studentDirectory?: Record<string, Record<string, unknown>> | Array<Record<string, unknown>>;
  studentPrefs?: Record<string, Record<string, unknown>> | Array<Record<string, unknown>>;
}

let remoteDataJsonLastCheckedAt = 0;
let remoteDataJsonInFlight: Promise<boolean> | null = null;
const DATA_JSON_CACHE_TTL_MS = 600;

function normalizeStudentRecordForStatic(raw: Record<string, unknown>): Record<string, unknown> {
  const authHash = String(raw.auth_hash ?? raw.authHash ?? '').trim().toLowerCase();
  const cloudKey = String(raw.cloud_key ?? raw.cloudKey ?? '').trim().toLowerCase();
  const groupName = String(raw.group_name ?? raw.group ?? 'I');
  const labGroup = String(raw.lab_group ?? raw.labGroup ?? '');
  const encName = String(raw.enc_name ?? raw.encName ?? '');
  const encFullName = String(raw.enc_full_name ?? raw.encFullName ?? '');
  const encSid = String(raw.enc_sid ?? raw.encSid ?? '');
  const active = raw.active === 0 || raw.active === false ? 0 : 1;
  const deleted = raw.deleted === 1 || raw.deleted === true ? 1 : 0;
  const createdAt = Number(raw.created_at ?? raw.createdAt ?? raw.createdAtMs) || 0;
  const updatedAt = Number(raw.updated_at ?? raw.updatedAt ?? raw.updatedAtMs) || 0;

  return {
    ...raw,
    auth_hash: authHash,
    cloud_key: cloudKey,
    last4: String(raw.last4 ?? ''),
    group_name: groupName,
    lab_group: labGroup,
    prog: raw.prog === 'en' ? 'en' : 'tr',
    enc_name: encName,
    enc_full_name: encFullName,
    enc_sid: encSid,
    active,
    deleted,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function normalizePrefRecordForStatic(raw: Record<string, unknown>, fallbackKey = ''): Record<string, unknown> {
  const cloudKey = String(raw.cloud_key ?? raw.cloudKey ?? fallbackKey).trim().toLowerCase();
  const authHash = String(raw.auth_hash ?? raw.authHash ?? '').trim().toLowerCase();
  return {
    cloud_key: cloudKey,
    auth_hash: authHash,
    last4: String(raw.last4 ?? ''),
    my_mbu_group: normalizeMbuGroupPref(raw.my_mbu_group ?? raw.myMbuGroup),
    my_lab_group: normalizeLabGroupPref(raw.my_lab_group ?? raw.myLabGroup),
    other_group_mode: normalizeOtherGroupModePref(raw.other_group_mode ?? raw.otherGroupMode),
    lang: normalizeLangPref(raw.lang),
    updated_at: Number(raw.updated_at ?? raw.updatedAt ?? raw.updatedAtMs) || 0,
  };
}

function normalizeRecordMap(
  input: Record<string, Record<string, unknown>> | Array<Record<string, unknown>> | undefined,
  keyField: 'auth_hash' | 'cloud_key',
  altKeyField: 'authHash' | 'cloudKey',
  normalizer: (raw: Record<string, unknown>, key: string) => Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!input) return out;
  if (Array.isArray(input)) {
    input.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const k = String(item[keyField] ?? item[altKeyField] ?? '').trim().toLowerCase();
      if (!k) return;
      out[k] = normalizer(item, k);
    });
    return out;
  }
  if (typeof input === 'object') {
    Object.entries(input).forEach(([mapKey, item]) => {
      if (!item || typeof item !== 'object') return;
      const k = String(item[keyField] ?? item[altKeyField] ?? mapKey).trim().toLowerCase();
      if (!k) return;
      out[k] = normalizer(item, k);
    });
  }
  return out;
}

function getMaxTimestampFromMap(map: Record<string, Record<string, unknown>>): number {
  let maxTs = 0;
  Object.values(map).forEach((item) => {
    const ts = Number(item?.updated_at ?? item?.updatedAtMs ?? item?.created_at ?? item?.createdAtMs) || 0;
    if (ts > maxTs) maxTs = ts;
  });
  return maxTs;
}

function getSavedGithubSource(): GithubSourceMeta | null {
  const fromStatic = readStaticJson<GithubSourceMeta | null>('gh_source', null);
  if (fromStatic && (fromStatic.gistId || (fromStatic.owner && fromStatic.repo))) {
    return {
      owner: String(fromStatic.owner || '').trim(),
      repo: String(fromStatic.repo || '').trim(),
      branch: String(fromStatic.branch || 'main').trim() || 'main',
      path: String(fromStatic.path || 'public/data.json').trim().replace(/^\/+/, '') || 'public/data.json',
      gistId: String(fromStatic.gistId || '').trim(),
    };
  }
  try {
    const raw = localStorage.getItem('inonu_tip_gh_publish_v1');
    if (raw) {
      const parsed = JSON.parse(raw) as { repo?: string; branch?: string; path?: string };
      const repoInput = String(parsed.repo || '').trim();
      const isGist = repoInput.includes('gist.github.com') || /^[a-f0-9]{32}$/i.test(repoInput) || repoInput.startsWith('gist:');
      if (isGist) {
        const cleanRepoClean = repoInput.replace(/\/+$/, '');
        const gistId = cleanRepoClean.replace(/^gist:/i, '').split('/').pop() || '';
        if (gistId) {
          return {
            owner: '',
            repo: repoInput,
            branch: 'main',
            path: 'data.json',
            gistId,
          };
        }
      }
      const parts = repoInput.split('/').map((s) => s.trim()).filter(Boolean);
      if (parts.length === 2) {
        return {
          owner: parts[0],
          repo: parts[1],
          branch: String(parsed.branch || 'main').trim() || 'main',
          path: String(parsed.path || 'public/data.json').trim().replace(/^\/+/, '') || 'public/data.json',
        };
      }
    }
  } catch {
    // Ignore storage error
  }
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io')) {
    const owner = window.location.hostname.replace(/\.github\.io$/i, '').trim();
    const pathSegs = window.location.pathname.split('/').filter(Boolean);
    const repo = pathSegs[0] || `${owner}.github.io`;
    if (owner && repo) {
      return {
        owner,
        repo,
        branch: 'main',
        path: 'public/data.json',
      };
    }
  }
  return null;
}

function getDataJsonFetchCandidates(): string[] {
  if (typeof window === 'undefined') return ['./data.json'];
  const candidates: string[] = [];
  const pushUnique = (u: string) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };
  const gh = getSavedGithubSource();
  if (gh && gh.gistId) {
    pushUnique(`https://gist.githubusercontent.com/${encodeURIComponent(gh.gistId)}/raw/data.json?t=${Date.now()}`);
  }
  if (gh && gh.owner && gh.repo) {
    const cleanBranch = encodeURIComponent(gh.branch || 'main');
    const cleanPath = (gh.path || 'public/data.json')
      .replace(/^\/+/, '')
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    // Raw GitHub URL updates right after commit without waiting for GitHub Pages rebuild
    pushUnique(`https://raw.githubusercontent.com/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/${cleanBranch}/${cleanPath}`);
  }
  try {
    pushUnique(new URL('data.json', window.location.href).toString());
  } catch {
    // Ignore invalid URL
  }
  pushUnique('./data.json');
  pushUnique('/data.json');
  return candidates;
}

function scoreRemoteDataJsonFreshness(obj: SiteDataJson): number {
  const accessTs = Number(obj.access?.updatedAtMs) || 0;
  const rootTs = Number(obj.updatedAtMs) || 0;
  return Math.max(accessTs, rootTs);
}

export async function syncStaticStoreFromDataJson(force = false): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return false;
  const now = Date.now();
  if (!force && remoteDataJsonLastCheckedAt > 0 && now - remoteDataJsonLastCheckedAt < DATA_JSON_CACHE_TTL_MS) {
    return true;
  }
  if (!force && remoteDataJsonInFlight) {
    return remoteDataJsonInFlight;
  }

  remoteDataJsonInFlight = (async () => {
    const candidates = getDataJsonFetchCandidates();
    const results = await Promise.allSettled(
      candidates.map(async (baseUrl) => {
        const sep = baseUrl.includes('?') ? '&' : '?';
        const resp = await fetch(`${baseUrl}${sep}t=${Date.now()}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(4500),
        });
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (!resp.ok || ct.includes('text/html')) return null;
        const parsed = (await resp.json().catch(() => null)) as SiteDataJson | null;
        return parsed && typeof parsed === 'object' ? parsed : null;
      }),
    );

    let remote: SiteDataJson | null = null;
    let bestScore = -1;
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const sc = scoreRemoteDataJsonFreshness(r.value);
      if (!remote || sc > bestScore) {
        remote = r.value;
        bestScore = sc;
      }
    }

    remoteDataJsonLastCheckedAt = Date.now();
    if (!remote) return false;

    if (remote.githubSource && remote.githubSource.owner && remote.githubSource.repo) {
      writeStaticJson('gh_source', {
        owner: String(remote.githubSource.owner).trim(),
        repo: String(remote.githubSource.repo).trim(),
        branch: String(remote.githubSource.branch || 'main').trim() || 'main',
        path: String(remote.githubSource.path || 'public/data.json').trim().replace(/^\/+/, '') || 'public/data.json',
      });
    }

    const prevSigs = readStaticJson<Record<string, string>>('remote_sigs', {});
    const nextSigs: Record<string, string> = { ...prevSigs };

    if (force) {
      Object.keys(prevSigs).forEach((k) => delete prevSigs[k]);
    }

    // 1. Access lock setting
    if (remote.access && typeof remote.access === 'object') {
      const remoteReq = remote.access.requireStudentLogin === true;
      const remoteAccessTs = Number(remote.access.updatedAtMs) || 0;
      const remoteAccessSig = `${remoteReq}:${remoteAccessTs}`;
      nextSigs.access = remoteAccessSig;

      const localAccess = readStaticJson<Partial<SiteAccessSettings>>('access', {});
      const localAccessTs = Number(localAccess.updatedAtMs) || 0;
      const localReq = localAccess.requireStudentLogin === true;
      const remoteChangedSinceLastSync = prevSigs.access !== remoteAccessSig;
      const canOverwriteByTs =
        remoteAccessTs > localAccessTs ||
        (remoteAccessTs === localAccessTs && localReq !== remoteReq) ||
        (localAccessTs === 0 && remoteAccessTs === 0);

      if (
        (force && (remoteAccessTs >= localAccessTs || localAccessTs === 0)) ||
        (remoteChangedSinceLastSync && canOverwriteByTs)
      ) {
        const nextAccess: SiteAccessSettings = {
          requireStudentLogin: remoteReq,
          updatedAtMs: remoteAccessTs,
        };
        if (localReq !== remoteReq || localAccessTs !== remoteAccessTs || force) {
          writeStaticJson('access', nextAccess);
          emitLocalTopic('access', nextAccess);
        }
      }
    }

    // 2. Security config (only if present and valid)
    if (remote.security && typeof remote.security === 'object') {
      const remotePwdHash = typeof remote.security.passwordHash === 'string' ? remote.security.passwordHash : '';
      const remoteProof = typeof remote.security.proofDigestB64 === 'string' ? remote.security.proofDigestB64 : '';
      const remoteWrap = typeof remote.security.wrappedRosterKey === 'string' ? remote.security.wrappedRosterKey : '';
      const remoteSecTs = Number(remote.security.updatedAtMs) || 0;
      const remoteSecSig = `${remotePwdHash}:${remoteSecTs}`;
      nextSigs.security = remoteSecSig;

      const localSec = readStaticJson<Partial<StaticAdminSecurityConfig>>('security', {});
      const localSecTs = Number(localSec.updatedAtMs) || 0;
      if (
        ADMIN_SECRET_RE.test(remotePwdHash) &&
        (remoteSecTs >= localSecTs || (prevSigs.security !== remoteSecSig && localSecTs === 0))
      ) {
        writeStaticJson('security', {
          passwordHash: remotePwdHash,
          proofDigestB64: remoteProof.length === 44 ? remoteProof : DEFAULT_PROOF_DIGEST_B64,
          wrappedRosterKey: ADMIN_SECRET_RE.test(remoteWrap) ? remoteWrap : WRAPPED_DEFAULT_ROSTER_KEY,
          updatedAtMs: remoteSecTs,
        });
      }
    }

    // 3. Announcements
    if (Array.isArray(remote.announcements)) {
      const remoteMap: Record<string, Record<string, unknown>> = {};
      remote.announcements.forEach((raw) => {
        if (!raw || typeof raw !== 'object') return;
        const mapped = mapServerAnnouncement(raw);
        if (mapped.id) {
          remoteMap[mapped.id] = { ...mapped, deleted: raw.deleted === true };
        }
      });
      const remoteSig = JSON.stringify(remote.announcements);
      nextSigs.announcements = remoteSig;
      const localMap = readStaticJson<Record<string, Record<string, unknown>>>('announcements', {});
      const remoteMaxTs = getMaxTimestampFromMap(remoteMap);
      const localMaxTs = getMaxTimestampFromMap(localMap);
      if (prevSigs.announcements !== remoteSig && (remoteMaxTs >= localMaxTs || localMaxTs === 0)) {
        writeStaticJson('announcements', remoteMap);
        emitLocalTopic('announcements', { source: 'data.json' });
      }
    }

    // 4. Materials
    if (Array.isArray(remote.materials)) {
      const remoteMap: Record<string, Record<string, unknown>> = {};
      remote.materials.forEach((raw) => {
        if (!raw || typeof raw !== 'object') return;
        const mapped = mapServerMaterial(raw);
        if (mapped.id) {
          remoteMap[mapped.id] = { ...mapped, deleted: raw.deleted === true || raw.deleted === 1 };
        }
      });
      const remoteSig = JSON.stringify(remote.materials);
      nextSigs.materials = remoteSig;
      const localMap = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
      const remoteMaxTs = getMaxTimestampFromMap(remoteMap);
      const localMaxTs = getMaxTimestampFromMap(localMap);
      if (prevSigs.materials !== remoteSig && (remoteMaxTs >= localMaxTs || localMaxTs === 0)) {
        writeStaticJson('materials', remoteMap);
        emitLocalTopic('materials', { source: 'data.json' });
      }
    }

    // 5. Custom Students & Admin Directory & Student Prefs
    let studentChanged = false;
    if (remote.customStudents && typeof remote.customStudents === 'object') {
      const remoteMap = normalizeRecordMap(remote.customStudents, 'auth_hash', 'authHash', (r) => normalizeStudentRecordForStatic(r));
      const remoteSig = JSON.stringify(remoteMap);
      nextSigs.customStudents = remoteSig;
      const localMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
      const remoteMaxTs = getMaxTimestampFromMap(remoteMap);
      const localMaxTs = getMaxTimestampFromMap(localMap);
      if (prevSigs.customStudents !== remoteSig && (remoteMaxTs >= localMaxTs || localMaxTs === 0)) {
        writeStaticJson('custom_students', remoteMap);
        studentChanged = true;
      }
    }

    if (remote.studentDirectory && typeof remote.studentDirectory === 'object') {
      const remoteMap = normalizeRecordMap(remote.studentDirectory, 'auth_hash', 'authHash', (r) => normalizeStudentRecordForStatic(r));
      const remoteSig = JSON.stringify(remoteMap);
      nextSigs.studentDirectory = remoteSig;
      const localMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
      const remoteMaxTs = getMaxTimestampFromMap(remoteMap);
      const localMaxTs = getMaxTimestampFromMap(localMap);
      if (prevSigs.studentDirectory !== remoteSig && (remoteMaxTs >= localMaxTs || localMaxTs === 0)) {
        writeStaticJson('admin_dir', remoteMap);
        studentChanged = true;
      }
    }

    if (remote.studentPrefs && typeof remote.studentPrefs === 'object') {
      const remoteMap = normalizeRecordMap(remote.studentPrefs, 'cloud_key', 'cloudKey', (r, k) => normalizePrefRecordForStatic(r, k));
      const remoteSig = JSON.stringify(remoteMap);
      nextSigs.studentPrefs = remoteSig;
      const localMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
      const remoteMaxTs = getMaxTimestampFromMap(remoteMap);
      const localMaxTs = getMaxTimestampFromMap(localMap);
      if (prevSigs.studentPrefs !== remoteSig && (remoteMaxTs >= localMaxTs || localMaxTs === 0)) {
        writeStaticJson('student_prefs', remoteMap);
      }
    }

    if (studentChanged) {
      emitLocalTopic('student_status', { source: 'data.json' });
    }

    writeStaticJson('remote_sigs', nextSigs);
    return true;
  })().finally(() => {
    remoteDataJsonInFlight = null;
  });

  return remoteDataJsonInFlight;
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

export async function getCachedLessonPdfBlob(materialId: string): Promise<Blob | null> {
  const cleanId = String(materialId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  if (!cleanId) return null;
  try {
    const blob = await loadStaticPdfBlob(cleanId);
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

export async function cacheLessonPdfBlob(materialId: string, fileName: string, blob: Blob): Promise<void> {
  const cleanId = String(materialId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  if (!cleanId || !(blob instanceof Blob) || blob.size < 1) return;
  try {
    await saveStaticPdfBlob(cleanId, fileName || `${cleanId}.pdf`, blob);
  } catch {
    // Ignore quota errors
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

  if (!(await isApiBackendOnline())) {
    await syncStaticStoreFromDataJson();
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

  const prev = getStaticSecurityConfig();
  const nextWrapped = wrappedRosterKey || prev.wrappedRosterKey;
  const nextSecPayload = {
    passwordHash: digest,
    proofDigestB64,
    wrappedRosterKey: nextWrapped,
    updatedAtMs: Date.now(),
  };
  writeStaticJson('security', nextSecPayload);
  cachedWrappedRosterKey = nextWrapped;
  setAdminWriteSecret(newWriteSecret);

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
          wrappedRosterKey: nextWrapped,
        }),
      });
      if (!resp.ok) {
        return { ok: false, error: 'server_rejected' };
      }
    } catch {
      return { ok: false, error: 'network_error' };
    }
  }

  bumpAppVersion();
  return { ok: true, newWriteSecret };
}

// ==================== SITE ACCESS SETTINGS ====================
export async function loadSiteAccessSettings(): Promise<SiteAccessSettings> {
  if (await isApiBackendOnline()) {
    const savedLocal = readStaticJson<Partial<SiteAccessSettings>>('access', {});
    let bestRequire = savedLocal.requireStudentLogin === true;
    let bestTs = Number(savedLocal.updatedAtMs) || 0;
    try {
      const resp = await fetch('/api/access', { cache: 'no-store' });
      if (resp.ok) {
        const apiJson = (await resp.json()) as { requireStudentLogin?: boolean; updatedAtMs?: number };
        const apiTs = Number(apiJson.updatedAtMs) || 0;
        if (apiTs >= bestTs) {
          bestRequire = apiJson.requireStudentLogin === true;
          bestTs = apiTs;
        }
      }
    } catch {
      // Use cached access state
    }
    const result: SiteAccessSettings = {
      requireStudentLogin: bestRequire,
      updatedAtMs: bestTs,
    };
    writeStaticJson('access', result);
    return result;
  }

  await syncStaticStoreFromDataJson();
  const savedLocal = readStaticJson<Partial<SiteAccessSettings>>('access', {});
  return {
    requireStudentLogin: savedLocal.requireStudentLogin === true,
    updatedAtMs: Number(savedLocal.updatedAtMs) || 0,
  };
}

export function subscribeSiteAccessSettings(onChange: (settings: SiteAccessSettings) => void): Unsubscribe {
  void loadSiteAccessSettings().then(onChange);
  return addSseListener('access', (data) => {
    if (data && typeof data === 'object' && 'requireStudentLogin' in data) {
      const obj = data as { requireStudentLogin?: boolean; updatedAtMs?: number };
      const updated = {
        requireStudentLogin: obj.requireStudentLogin === true,
        updatedAtMs: Number(obj.updatedAtMs) || Date.now(),
      };
      writeStaticJson('access', updated);
      onChange(updated);
    } else {
      void loadSiteAccessSettings().then(onChange);
    }
  });
}

export async function saveSiteAccessSettings(
  requireStudentLogin: boolean,
  adminSecret?: string,
): Promise<SiteAccessSettings> {
  const prevLocal = readStaticJson<Partial<SiteAccessSettings>>('access', {});
  const prevKnownTs = Number(prevLocal.updatedAtMs) || 0;
  const now = Math.max(Date.now(), prevKnownTs + 1);
  const targetLocked = Boolean(requireStudentLogin);
  const next: SiteAccessSettings = {
    requireStudentLogin: targetLocked,
    updatedAtMs: now,
  };

  if (await isApiBackendOnline()) {
    const secret = resolveAdminWriteSecret(adminSecret);
    const resp = await fetch('/api/access', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': secret,
      },
      body: JSON.stringify({
        requireStudentLogin: targetLocked,
        updatedAtMs: now,
      }),
    });
    if (!resp.ok) {
      throw new Error('ACCESS_SAVE_FAILED');
    }
    const json = (await resp.json().catch(() => ({}))) as {
      requireStudentLogin?: boolean;
      updatedAtMs?: number;
    };
    next.requireStudentLogin = json?.requireStudentLogin === true;
    next.updatedAtMs = Math.max(Number(json?.updatedAtMs) || now, now);
  }

  writeStaticJson('access', next);
  emitLocalTopic('access', next);
  bumpAppVersion();
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
  let loadedFromServer = false;

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/login-status/${encodeURIComponent(authHash)}`, { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as ServerStudentStatusResponse;
        custom = (json.custom as Record<string, unknown> | null) ?? null;
        directory = (json.directory as Record<string, unknown> | null) ?? null;
        loadedFromServer = true;
      }
    } catch {
      // Fallback
    }
  }

  if (!loadedFromServer) {
    await syncStaticStoreFromDataJson();
    const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
    const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
    custom = customMap[authHash] || null;
    directory = dirMap[authHash] || null;
  }

  const isCustomDeleted = custom && (custom.deleted === 1 || custom.deleted === true);
  const isDirDeleted = directory && (directory.deleted === 1 || directory.deleted === true);
  if (isCustomDeleted || isDirDeleted) {
    return { ok: false, reason: 'deleted' };
  }

  const isCustomActive = custom ? custom.active !== 0 && custom.active !== false : true;
  const isDirActive = directory ? directory.active !== 0 && directory.active !== false : true;
  if (!isCustomActive || !isDirActive) {
    return { ok: false, reason: 'inactive' };
  }

  const customRawGroup = custom ? (custom.group_name ?? custom.group) : undefined;
  const dirRawGroup = directory ? (directory.group_name ?? directory.group) : undefined;

  if (custom && typeof customRawGroup === 'string') {
    const group = normalizeAssignedGroup(customRawGroup);
    const labGroup = normalizeLabGroupPref(custom.lab_group ?? custom.labGroup);
    const prog = custom.prog === 'en' ? 'en' : 'tr';
    const rawEncName = custom.enc_name ?? custom.encName;
    const encName = typeof rawEncName === 'string' ? rawEncName : '';
    const decryptedCustomName = encName ? decryptStudentName(sid, encName) : '';
    const dirDecryptedName = readAdminDirFullName(authHash, directory);
    const name =
      decryptedCustomName ||
      dirDecryptedName ||
      allowlistMatch?.name ||
      `Öğrenci •••${sid.slice(-4)}`;
    return {
      ok: true,
      match: {
        hash: authHash,
        last4: sid.slice(-4),
        name,
        group,
        labGroup,
        prog,
        source: allowlistMatch ? 'allowlist' : 'custom',
      },
    };
  }

  if (allowlistMatch) {
    if (directory && typeof dirRawGroup === 'string') {
      const dirGroup = normalizeAssignedGroup(dirRawGroup);
      const dirLab = normalizeLabGroupPref(directory.lab_group ?? directory.labGroup);
      const dirProg = directory.prog === 'en' ? 'en' : directory.prog === 'tr' ? 'tr' : allowlistMatch.prog;
      const dirName = readAdminDirFullName(authHash, directory) || allowlistMatch.name;
      return {
        ok: true,
        match: {
          ...allowlistMatch,
          name: dirName,
          group: dirGroup,
          labGroup: dirProg === 'en' ? '' : dirLab,
          prog: dirProg,
        },
      };
    }
    return {
      ok: true,
      match: allowlistMatch,
    };
  }

  return { ok: false, reason: 'not_found' };
}

export async function checkStudentSessionActive(authHash: string): Promise<StudentAccountStatus> {
  if (!isValidAuthHash(authHash)) return 'inactive';
  if (isAdminStudentHash(authHash)) return 'active';

  let custom: Record<string, unknown> | null = null;
  let directory: Record<string, unknown> | null = null;
  let loaded = false;

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/login-status/${encodeURIComponent(authHash)}`, { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as ServerStudentStatusResponse;
        custom = (json.custom as Record<string, unknown> | null) ?? null;
        directory = (json.directory as Record<string, unknown> | null) ?? null;
        loaded = true;
      }
    } catch {
      // Fallback
    }
  }

  if (!loaded) {
    await syncStaticStoreFromDataJson();
    const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
    const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
    custom = customMap[authHash] || null;
    directory = dirMap[authHash] || null;
  }

  if ((custom && (custom.deleted === 1 || custom.deleted === true)) || (directory && (directory.deleted === 1 || directory.deleted === true))) {
    return 'deleted';
  }
  const activeCustom = custom ? custom.active !== 0 && custom.active !== false : true;
  const activeDir = directory ? directory.active !== 0 && directory.active !== false : true;
  if (!activeCustom || !activeDir) {
    return 'inactive';
  }
  return 'active';
}

export function subscribeStudentAccountStatus(authHash: string, onChange: (status: StudentAccountStatus) => void): Unsubscribe {
  void checkStudentSessionActive(authHash).then(onChange);
  return addSseListener('student_status', (data) => {
    if (data && typeof data === 'object') {
      const obj = data as { authHash?: string; active?: boolean; deleted?: boolean };
      if (!obj.authHash || obj.authHash === authHash) {
        if (obj.deleted) {
          onChange('deleted');
        } else if (obj.active === false) {
          onChange('inactive');
        } else {
          onChange('active');
        }
      }
    } else {
      void checkStudentSessionActive(authHash).then(onChange);
    }
  });
}

export async function isStudentAlreadyRegistered(rawSid: string): Promise<boolean> {
  const sid = normalizeStudentId(rawSid);
  if (!/^01\d{9}$/.test(sid)) return false;
  const authHash = hashStudentId(sid);
  if (verifyStudentHash(authHash)) return true;

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/login-status/${encodeURIComponent(authHash)}`, { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as ServerStudentStatusResponse;
        if (json.custom || json.directory) return true;
      }
    } catch {
      // Fallback
    }
  } else {
    await syncStaticStoreFromDataJson();
  }

  const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
  const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
  return Boolean((customMap[authHash] && customMap[authHash].deleted !== 1) || (dirMap[authHash] && dirMap[authHash].deleted !== 1));
}

export async function lookupStudentWithCloud(rawSid: string): Promise<StudentAuthMatch | null> {
  const res = await checkStudentLoginStatus(rawSid);
  return res.ok ? res.match : null;
}

export async function loadCloudStudentPrefs(
  authHashOrCloudKey: string,
  maybeCloudKey?: string,
): Promise<StudentCloudPrefs | null> {
  const rawKey = typeof maybeCloudKey === 'string' && maybeCloudKey.trim() ? maybeCloudKey : authHashOrCloudKey;
  const cleanKey = String(rawKey || '').trim().toLowerCase();
  if (!cleanKey) return null;

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/prefs/${encodeURIComponent(cleanKey)}`, { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as { prefs?: Record<string, unknown> | null };
        if (json.prefs && typeof json.prefs === 'object') {
          const p = json.prefs;
          const mapped: StudentCloudPrefs = {
            myMbuGroup: normalizeMbuGroupPref(p.myMbuGroup ?? p.my_mbu_group),
            myLabGroup: normalizeLabGroupPref(p.myLabGroup ?? p.my_lab_group),
            otherGroupMode: normalizeOtherGroupModePref(p.otherGroupMode ?? p.other_group_mode),
            lang: normalizeLangPref(p.lang),
            authHash: typeof p.authHash === 'string' ? p.authHash : typeof p.auth_hash === 'string' ? p.auth_hash : undefined,
            last4: typeof p.last4 === 'string' ? p.last4 : undefined,
          };
          const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
          prefsMap[cleanKey] = { cloud_key: cleanKey, ...p };
          writeStaticJson('student_prefs', prefsMap);
          return mapped;
        }
      }
    } catch {
      // Fallback to local storage
    }
  } else {
    await syncStaticStoreFromDataJson();
  }

  const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
  const row = prefsMap[cleanKey];
  if (!row) return null;
  return {
    myMbuGroup: normalizeMbuGroupPref(row.myMbuGroup ?? row.my_mbu_group),
    myLabGroup: normalizeLabGroupPref(row.myLabGroup ?? row.my_lab_group),
    otherGroupMode: normalizeOtherGroupModePref(row.otherGroupMode ?? row.other_group_mode),
    lang: normalizeLangPref(row.lang),
    authHash: typeof row.authHash === 'string' ? row.authHash : typeof row.auth_hash === 'string' ? row.auth_hash : undefined,
    last4: typeof row.last4 === 'string' ? row.last4 : undefined,
  };
}

export async function saveCloudStudentPrefs(
  authHash: string,
  cloudKey: string,
  prefs: StudentCloudPrefs,
): Promise<boolean> {
  const cleanKey = String(cloudKey || '').trim().toLowerCase();
  if (!cleanKey) return false;

  const finalMbu = normalizeMbuGroupPref(prefs.myMbuGroup);
  const finalLang = normalizeLangPref(prefs.lang);
  const finalLab = finalLang === 'en' ? '' : normalizeLabGroupPref(prefs.myLabGroup);
  const finalMode = normalizeOtherGroupModePref(prefs.otherGroupMode);
  const finalAuthHash = isValidAuthHash(authHash) ? authHash : '';
  const finalLast4 = typeof prefs.last4 === 'string' && /^[0-9]{4}$/.test(prefs.last4.trim()) ? prefs.last4.trim() : '';

  const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
  const rowPayload = {
    cloud_key: cleanKey,
    auth_hash: finalAuthHash,
    last4: finalLast4,
    my_mbu_group: finalMbu,
    my_lab_group: finalLab,
    other_group_mode: finalMode,
    lang: finalLang,
    updated_at: Date.now(),
  };
  prefsMap[cleanKey] = rowPayload;
  writeStaticJson('student_prefs', prefsMap);
  emitLocalTopic('student_prefs', rowPayload);

  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch(`/api/student/prefs/${encodeURIComponent(cleanKey)}`, {
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
    active: Boolean(raw.active === true || raw.active === 1),
    targetGroup: normalizeMbuGroupPref(raw.targetGroup ?? raw.target_group),
    targetProg: normalizeLangPref(raw.targetProg ?? raw.target_prog),
    createdAtMs: Number(raw.createdAtMs ?? raw.created_at) || 0,
    updatedAtMs: Number(raw.updatedAtMs ?? raw.updated_at) || 0,
  };
}

export async function loadActiveAnnouncements(): Promise<CloudAnnouncement[]> {
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/announcements', { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as { announcements?: Record<string, unknown>[] };
        if (Array.isArray(json.announcements)) {
          const apiMap: Record<string, Record<string, unknown>> = {};
          json.announcements.forEach((a) => {
            const mapped = mapServerAnnouncement(a);
            if (mapped.id) apiMap[mapped.id] = { ...mapped, deleted: false };
          });
          writeStaticJson('announcements', apiMap);
        }
      }
    } catch {
      // Fallback to local cache
    }
  } else {
    await syncStaticStoreFromDataJson();
  }

  const map = readStaticJson<Record<string, Record<string, unknown>>>('announcements', {});
  return Object.values(map)
    .filter((r) => r && r.deleted !== true && Boolean(r.active))
    .map(mapServerAnnouncement)
    .sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
}

export function subscribeAnnouncements(onUpdate: (announcements: CloudAnnouncement[]) => void): Unsubscribe {
  void loadActiveAnnouncements().then(onUpdate);
  return addSseListener('announcements', () => {
    void loadActiveAnnouncements().then(onUpdate);
  });
}

export async function listAllAnnouncements(): Promise<CloudAnnouncement[]> {
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/announcements', { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as { announcements?: Record<string, unknown>[] };
        if (Array.isArray(json.announcements)) {
          const apiMap: Record<string, Record<string, unknown>> = {};
          json.announcements.forEach((a) => {
            const mapped = mapServerAnnouncement(a);
            if (mapped.id) apiMap[mapped.id] = { ...mapped, deleted: false };
          });
          writeStaticJson('announcements', apiMap);
        }
      }
    } catch {
      // Fallback to local cache
    }
  } else {
    await syncStaticStoreFromDataJson();
  }

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
  emitLocalTopic('announcements', { action: 'save', id });

  if (await isApiBackendOnline()) {
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
    if (!resp.ok) {
      throw new Error('ANNOUNCEMENT_SAVE_FAILED');
    }
    const json = (await resp.json().catch(() => ({}))) as {
      announcement?: Record<string, unknown>;
    };
    if (json.announcement) {
      const s = mapServerAnnouncement(json.announcement);
      map[s.id] = { ...s, deleted: false };
      writeStaticJson('announcements', map);
      emitLocalTopic('announcements', { action: 'save', id: s.id });
      bumpAppVersion();
      return s;
    }
  }

  bumpAppVersion();
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
  emitLocalTopic('announcements', { action: 'delete', id: cleanId });

  if (await isApiBackendOnline()) {
    try {
      await fetch(`/api/announcements/${encodeURIComponent(cleanId)}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Secret': secret },
      });
    } catch {
      // Best-effort delete
    }
  }

  bumpAppVersion();
}

// ==================== LESSON MATERIALS & SERVER PDF HOSTING ====================
export function generateLessonMaterialId(date: string, slotNo: number): string {
  const cleanDate = normalizeMaterialDate(date) || '01.01.2026';
  const dateKey = cleanDate.replace(/[^a-zA-Z0-9_-]/g, '-');
  const cleanSlot = Math.min(10, Math.max(1, Math.round(Number(slotNo) || 1)));
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return `${dateKey}_${cleanSlot}_${uniqueSuffix}`.slice(0, 90);
}

export async function deleteServerPdfByUrl(pdfUrl: string, adminSecret?: string): Promise<void> {
  const clean = typeof pdfUrl === 'string' ? pdfUrl.trim() : '';
  if (!clean.startsWith('/api/lesson-pdf/')) return;
  if (!(await isApiBackendOnline())) return;
  const secret = resolveAdminWriteSecret(adminSecret);
  const fileId = clean.slice('/api/lesson-pdf/'.length).split('?')[0].trim();
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(fileId)) return;
  try {
    await fetch(`/api/lesson-pdf/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': secret },
    });
  } catch {
    // Best effort
  }
}

export async function uploadLessonPdfFile(
  file: File,
  materialId?: string,
  adminSecret?: string,
  onProgress?: (percent: number, loadedBytes: number) => void,
): Promise<{
  sourceType: 'server' | 'url' | 'file' | 'chunks';
  materialId: string;
  url: string;
  fileId: string;
  fileName: string;
  size: number;
  chunkCount: number;
  fallbackBase64?: string;
}> {
  if (!(file instanceof File) || file.size < 1) {
    throw new Error('INVALID_PDF_FILE');
  }
  if (file.size > MAX_SERVER_PDF_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }

  const secret = resolveAdminWriteSecret(adminSecret);
  const cleanFileName = String(file.name || 'ders-notu.pdf')
    .replace(/[\r\n"/\\:*?<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
  const cleanMatId = materialId
    ? materialId.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 90)
    : `mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const reportProgress = (pct: number, loaded: number) => {
    try {
      onProgress?.(Math.min(100, Math.max(0, pct)), loaded);
    } catch {
      // Ignore progress reporting errors
    }
  };
  reportProgress(4, 0);

  // Cache full PDF locally in IndexedDB so admin preview needs zero re-fetch
  void saveStaticPdfBlob(cleanMatId, cleanFileName, file).catch(() => {});

  if (await isApiBackendOnline()) {
    const totalChunks = Math.max(1, Math.ceil(file.size / SERVER_UPLOAD_CHUNK_BYTES));

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
      uploadId?: string;
      fileId?: string;
      chunkSize?: number;
    };
    if (!initResp.ok || !initJson.ok || !initJson.uploadId) {
      throw new Error('SERVER_UPLOAD_INIT_FAILED');
    }

    const uploadId = initJson.uploadId;
    const chunkSize = initJson.chunkSize || SERVER_UPLOAD_CHUNK_BYTES;
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
      if (!chunkResp.ok) {
        throw new Error(`SERVER_CHUNK_FAILED_${idx}`);
      }
      uploadedBytes = end;
      const pct = Math.min(95, Math.max(10, Math.round((uploadedBytes / file.size) * 94)));
      reportProgress(pct, uploadedBytes);
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
      fileId?: string;
      url?: string;
    };
    if (!completeResp.ok || !completeJson.ok || !completeJson.url) {
      throw new Error('SERVER_UPLOAD_COMPLETE_FAILED');
    }

    reportProgress(100, file.size);
    return {
      sourceType: 'server',
      materialId: cleanMatId,
      url: completeJson.url,
      fileId: completeJson.fileId || cleanMatId,
      fileName: cleanFileName,
      size: file.size,
      chunkCount: 0,
    };
  }

  // Offline / static preview small-file fallback (<= 1.5 MB)
  if (file.size <= 1_500_000) {
    const arrBuf = await file.arrayBuffer();
    const b64 = bytesToB64(new Uint8Array(arrBuf));
    reportProgress(100, file.size);
    return {
      sourceType: 'server',
      materialId: cleanMatId,
      url: '',
      fileId: cleanMatId,
      fileName: cleanFileName,
      size: file.size,
      chunkCount: 0,
      fallbackBase64: b64,
    };
  }

  throw new Error('BACKEND_OFFLINE');
}

export async function downloadLessonMaterialChunks(
  materialId: string,
  _chunkCount: number,
  onProgress?: (percent: number, loadedChunks: number, totalChunks: number) => void,
): Promise<Blob> {
  const cleanId = String(materialId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  const totalChunks = 1;

  // 1. Instant local IndexedDB cache check
  try {
    const cachedBlob = await loadStaticPdfBlob(cleanId);
    if (cachedBlob && cachedBlob.size > 0) {
      onProgress?.(100, 1, 1);
      return cachedBlob;
    }
  } catch {
    // Ignore IndexedDB failure
  }

  // 2. Fetch directly from Express server if online
  const matMap = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
  const savedMat = matMap[cleanId];
  if (await isApiBackendOnline()) {
    try {
      const pdfUrlStr = typeof savedMat?.pdfUrl === 'string' ? savedMat.pdfUrl : typeof savedMat?.pdf_url === 'string' ? String(savedMat.pdf_url) : `/api/lesson-pdf/${cleanId}`;
      if (pdfUrlStr) {
        const dlUrl = pdfUrlStr.includes('?') ? `${pdfUrlStr}&download=1` : `${pdfUrlStr}?download=1`;
        const resp = await fetch(dlUrl, { cache: 'no-store' });
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (resp.ok && !ct.includes('text/html')) {
          const blob = await resp.blob();
          void saveStaticPdfBlob(cleanId, `${cleanId}.pdf`, blob).catch(() => {});
          onProgress?.(100, 1, 1);
          return blob;
        }
      }
    } catch {
      // Fallback
    }
  }

  throw new Error('PDF_NOT_FOUND');
}

function mapServerMaterial(m: Record<string, unknown>): LessonMaterial {
  const pdfUrl = typeof (m.pdfUrl ?? m.pdf_url) === 'string' ? String(m.pdfUrl ?? m.pdf_url) : '';
  const rawPdfData = m.pdfData ?? m.pdf_data;
  const pdfData = typeof rawPdfData === 'string' && rawPdfData.length > 0 ? rawPdfData : undefined;
  const rawChunkCount = Number(m.chunkCount ?? m.chunk_count);
  const chunkCount = Number.isFinite(rawChunkCount) && rawChunkCount > 0 ? Math.round(rawChunkCount) : undefined;
  const rawSourceType = m.sourceType ?? m.source_type;
  const sourceType: 'url' | 'file' | 'server' | 'chunks' =
    pdfUrl.startsWith('/api/lesson-pdf/') || rawSourceType === 'server'
      ? 'server'
      : (chunkCount && chunkCount > 0) || rawSourceType === 'chunks'
        ? 'chunks'
        : pdfData
          ? 'file'
          : 'url';

  const rawPdfName = m.pdfName ?? m.pdf_name;
  const rawFileSize = Number(m.fileSize ?? m.file_size);

  return {
    id: String(m.id || ''),
    date: normalizeMaterialDate(String(m.date || '')),
    slotNo: Number(m.slotNo ?? m.slot_no) || 1,
    targetProg: normalizeLangPref(m.targetProg ?? m.target_prog),
    title: String(m.title || ''),
    sourceType,
    pdfUrl,
    pdfData,
    chunkCount,
    pdfName: typeof rawPdfName === 'string' && rawPdfName ? rawPdfName : undefined,
    fileSize: Number.isFinite(rawFileSize) && rawFileSize > 0 ? rawFileSize : undefined,
    createdAtMs: Number(m.createdAtMs ?? m.created_at) || 0,
    updatedAtMs: Number(m.updatedAtMs ?? m.updated_at) || 0,
  };
}

export async function loadAllLessonMaterials(): Promise<LessonMaterial[]> {
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/materials', { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json()) as { ok?: boolean; materials?: Record<string, unknown>[] };
        if (json.ok && Array.isArray(json.materials)) {
          const apiMap: Record<string, Record<string, unknown>> = {};
          json.materials.forEach((raw) => {
            const mapped = mapServerMaterial(raw);
            if (mapped.id) {
              apiMap[mapped.id] = { ...mapped, deleted: false };
            }
          });
          writeStaticJson('materials', apiMap);
        }
      }
    } catch {
      // Fallback to local cache
    }
  } else {
    await syncStaticStoreFromDataJson();
  }

  const map = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
  return Object.values(map)
    .filter((r) => r && r.deleted !== true && r.deleted !== 1)
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
      : cleanChunkCount > 0 || input.sourceType === 'chunks'
        ? 'chunks'
        : input.sourceType === 'file' || (rawData.length > 0 && !cleanUrl)
          ? 'file'
          : 'url';

  if (!cleanDate || !cleanTitle) {
    throw new Error('Date and title are required.');
  }

  const candidateId = input.id
    ? input.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 90)
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
    pdfUrl: sourceType === 'file' ? '' : cleanUrl,
    pdfData: sourceType === 'file' ? rawData : undefined,
    chunkCount: cleanChunkCount > 0 ? cleanChunkCount : undefined,
    pdfName: String(input.pdfName || '').trim().slice(0, 120) || undefined,
    fileSize: typeof input.fileSize === 'number' && input.fileSize > 0 ? Math.round(input.fileSize) : undefined,
    createdAtMs: prev?.createdAtMs || now,
    updatedAtMs: now,
  };
  map[candidateId] = { ...saved, deleted: false };
  writeStaticJson('materials', map);
  emitLocalTopic('materials', { action: 'save', id: candidateId });

  if (await isApiBackendOnline()) {
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
        pdfUrl: sourceType === 'file' ? '' : cleanUrl,
        pdfData: sourceType === 'file' ? rawData : '',
        chunkCount: cleanChunkCount > 0 ? cleanChunkCount : 0,
        pdfName: String(input.pdfName || '').trim().slice(0, 120),
        fileSize: typeof input.fileSize === 'number' ? Math.round(input.fileSize) : 0,
      }),
    });
    const json = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      material?: Record<string, unknown>;
    };
    if (!resp.ok || !json.ok || !json.material) {
      throw new Error(json.error || 'MATERIAL_SAVE_FAILED');
    }
    const serverSaved = mapServerMaterial(json.material);
    map[serverSaved.id] = {
      ...saved,
      ...serverSaved,
      chunkCount: saved.chunkCount || serverSaved.chunkCount,
      sourceType: serverSaved.pdfUrl.startsWith('/api/lesson-pdf/') ? 'server' : serverSaved.sourceType,
      deleted: false,
    };
    writeStaticJson('materials', map);
    emitLocalTopic('materials', { action: 'save', id: serverSaved.id });
    bumpAppVersion();
    return map[serverSaved.id];
  }

  bumpAppVersion();
  return saved;
}

export async function deleteLessonMaterial(id: string, adminSecret?: string): Promise<void> {
  const cleanId = String(id || '').trim();
  if (!cleanId) return;
  const secret = resolveAdminWriteSecret(adminSecret);

  const map = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
  if (map[cleanId]) {
    delete map[cleanId];
    writeStaticJson('materials', map);
  }
  emitLocalTopic('materials', { action: 'delete', id: cleanId });

  if (await isApiBackendOnline()) {
    try {
      await fetch(`/api/materials/${encodeURIComponent(cleanId)}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Secret': secret },
      });
    } catch {
      // Best-effort delete
    }
  }

  void deleteStaticPdfBlob(cleanId);
  bumpAppVersion();
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

  if (await isApiBackendOnline()) {
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
    const json = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!resp.ok || !json.ok) {
      if (json.error === 'DUPLICATE_STUDENT_ID') {
        throw new Error('DUPLICATE_STUDENT_ID');
      }
      throw new Error(json.error || 'STUDENT_SAVE_FAILED');
    }
  }

  emitLocalTopic('student_status', { authHash, active, deleted: false });
  bumpAppVersion();

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
    } catch {
      // Best-effort delete
    }
  }

  emitLocalTopic('student_status', { authHash, active: false, deleted: true });
  bumpAppVersion();
}

export async function lookupStudentForAdmin(rawSid: string): Promise<AdminStudentListItem | null> {
  const sid = normalizeStudentId(rawSid);
  if (!/^01\d{9}$/.test(sid)) return null;
  const authHash = hashStudentId(sid);
  const cloudKey = await deriveCloudDocId(sid);
  const last4 = sid.slice(-4);
  const allowMatch = verifyStudentId(sid);

  if (!(await isApiBackendOnline())) {
    await syncStaticStoreFromDataJson();
  }

  const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
  const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
  const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});

  let dirData: Record<string, unknown> | null = dirMap[authHash] || null;
  let customData: Record<string, unknown> | null = customMap[authHash] || null;
  let prefsData: Record<string, unknown> | null = prefsMap[cloudKey] || null;

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
          dirData = json.directory ?? null;
          customData = json.custom ?? null;
          prefsData = json.prefs ?? null;
        }
      } catch {
        // Fallback to local state
      }
    } else {
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
          customData = sJson.custom ?? null;
          dirData = sJson.directory ?? null;
        }
        if (prefsResp.ok) {
          const pJson = (await prefsResp.json()) as { prefs?: Record<string, unknown> | null };
          prefsData = pJson.prefs ?? null;
        }
      } catch {
        // Fallback
      }
    }
  }

  if (dirData && (dirData.deleted === 1 || dirData.deleted === true)) return null;
  if (customData && (customData.deleted === 1 || customData.deleted === true)) return null;

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
  let sec = getStaticSecurityConfig();
  let wrappedRosterKey: string | undefined = sec.wrappedRosterKey;

  const dirByHash = new Map<string, Record<string, unknown>>();
  const customByHash = new Map<string, Record<string, unknown>>();
  const prefsByCloud = new Map<string, Record<string, unknown>>();

  let loadedFromServer = false;
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/admin/students', {
        headers: { 'X-Admin-Secret': secret },
        cache: 'no-store',
      });
      const parsed = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        wrappedRosterKey?: string;
        directory?: Record<string, unknown>[];
        custom?: Record<string, unknown>[];
        prefs?: Record<string, unknown>[];
      };
      if (resp.ok && parsed.ok) {
        loadedFromServer = true;
        if (parsed.wrappedRosterKey) wrappedRosterKey = parsed.wrappedRosterKey;
        const dirStatic: Record<string, Record<string, unknown>> = {};
        const customStatic: Record<string, Record<string, unknown>> = {};
        const prefsStatic: Record<string, Record<string, unknown>> = {};

        (parsed.directory || []).forEach((d) => {
          if (typeof d.auth_hash === 'string') {
            dirByHash.set(d.auth_hash, d);
            dirStatic[d.auth_hash] = d;
          }
        });
        (parsed.custom || []).forEach((d) => {
          if (typeof d.auth_hash === 'string') {
            customByHash.set(d.auth_hash, d);
            customStatic[d.auth_hash] = d;
          }
        });
        (parsed.prefs || []).forEach((d) => {
          if (typeof d.cloud_key === 'string') {
            prefsByCloud.set(d.cloud_key, d);
            prefsStatic[d.cloud_key] = d;
          }
        });

        writeStaticJson('admin_dir', dirStatic);
        writeStaticJson('custom_students', customStatic);
        writeStaticJson('student_prefs', prefsStatic);
      }
    } catch {
      // Fallback to local storage cache
    }
  }

  if (!loadedFromServer) {
    await syncStaticStoreFromDataJson();
    sec = getStaticSecurityConfig();
    wrappedRosterKey = sec.wrappedRosterKey;
    const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
    const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
    const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});
    Object.values(dirMap).forEach((d) => {
      if (d && typeof d.auth_hash === 'string') dirByHash.set(d.auth_hash, d);
    });
    Object.values(customMap).forEach((d) => {
      if (d && typeof d.auth_hash === 'string') customByHash.set(d.auth_hash, d);
    });
    Object.values(prefsMap).forEach((d) => {
      if (d && typeof d.cloud_key === 'string') prefsByCloud.set(d.cloud_key, d);
    });
  }

  const unlockedRoster = await resolveUnlockedRosterData(secret, wrappedRosterKey).catch(() => null);

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
    bumpAppVersion();
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

  if (await isApiBackendOnline()) {
    const resp = await fetch('/api/admin/students/settings', {
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
    if (!resp.ok) {
      throw new Error('STUDENT_SETTINGS_SAVE_FAILED');
    }
  }

  if (authHash) {
    emitLocalTopic('student_status', { authHash, active: isActive, deleted: false });
  }
  bumpAppVersion();
}

// ==================== DATA.JSON EXPORT & GITHUB PAGES SYNC ====================
export async function isStaticDeployment(): Promise<boolean> {
  return !(await isApiBackendOnline());
}

export async function exportSiteDataJsonObject(githubSourceOverride?: GithubSourceMeta): Promise<SiteDataJson> {
  const ghSource = githubSourceOverride || getSavedGithubSource();
  if (await isApiBackendOnline()) {
    try {
      const resp = await fetch('/api/data-json', { cache: 'no-store' });
      if (resp.ok) {
        const json = (await resp.json().catch(() => null)) as SiteDataJson | null;
        if (json && typeof json === 'object') {
          if (ghSource && ghSource.owner && ghSource.repo) {
            json.githubSource = {
              owner: ghSource.owner,
              repo: ghSource.repo,
              branch: ghSource.branch || 'main',
              path: ghSource.path || 'public/data.json',
            };
          }
          return json;
        }
      }
    } catch {
      // Fallback to local store snapshot
    }
  }

  const access = readStaticJson<SiteAccessSettings>('access', {
    requireStudentLogin: false,
    updatedAtMs: 0,
  });
  const savedSecurity = readStaticJson<Partial<StaticAdminSecurityConfig> | null>('security', null);
  const annMap = readStaticJson<Record<string, Record<string, unknown>>>('announcements', {});
  const matMap = readStaticJson<Record<string, Record<string, unknown>>>('materials', {});
  const customMap = readStaticJson<Record<string, Record<string, unknown>>>('custom_students', {});
  const dirMap = readStaticJson<Record<string, Record<string, unknown>>>('admin_dir', {});
  const prefsMap = readStaticJson<Record<string, Record<string, unknown>>>('student_prefs', {});

  const announcements = Object.values(annMap)
    .filter((a) => a && a.deleted !== true)
    .map(mapServerAnnouncement)
    .sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));

  const materials = Object.values(matMap)
    .filter((m) => m && m.deleted !== true && m.deleted !== 1)
    .map((raw) => {
      const mapped = mapServerMaterial(raw);
      if (mapped.pdfData && mapped.pdfData.length > 500_000) {
        const { pdfData: _omit, ...rest } = mapped;
        return rest;
      }
      return mapped;
    })
    .sort((a, b) => (a.createdAtMs || a.updatedAtMs) - (b.createdAtMs || b.updatedAtMs));

  const out: SiteDataJson = {
    version: getAppVersion(),
    updatedAtMs: Date.now(),
    ...(ghSource && ghSource.owner && ghSource.repo
      ? {
          githubSource: {
            owner: ghSource.owner,
            repo: ghSource.repo,
            branch: ghSource.branch || 'main',
            path: ghSource.path || 'public/data.json',
          },
        }
      : {}),
    access: {
      requireStudentLogin: access.requireStudentLogin === true,
      updatedAtMs: Number(access.updatedAtMs) || 0,
    },
    ...(savedSecurity && ADMIN_SECRET_RE.test(String(savedSecurity.passwordHash || ''))
      ? {
          security: {
            passwordHash: savedSecurity.passwordHash,
            proofDigestB64: savedSecurity.proofDigestB64,
            wrappedRosterKey: savedSecurity.wrappedRosterKey,
            updatedAtMs: Number(savedSecurity.updatedAtMs) || 0,
          },
        }
      : {}),
    announcements: announcements as unknown as Array<Record<string, unknown>>,
    materials: materials as unknown as Array<Record<string, unknown>>,
    customStudents: customMap,
    studentDirectory: dirMap,
    studentPrefs: prefsMap,
  };
  return out;
}

export async function buildExportDataJson(githubSourceOverride?: GithubSourceMeta): Promise<string> {
  const obj = await exportSiteDataJsonObject(githubSourceOverride);
  return `${JSON.stringify(obj, null, 2)}\n`;
}

export async function syncStaticCacheWithRemoteDataJson(): Promise<boolean> {
  try {
    localStorage.removeItem(STATIC_STORE_PREFIX + 'remote_sigs');
  } catch {
    // Ignore storage error
  }
  const ok = await syncStaticStoreFromDataJson(true);
  if (ok) {
    emitLocalTopic('access', readStaticJson('access', { requireStudentLogin: false, updatedAtMs: 0 }));
    emitLocalTopic('announcements', { source: 'data.json' });
    emitLocalTopic('materials', { source: 'data.json' });
    emitLocalTopic('student_status', { source: 'data.json' });
  }
  return ok;
}

const githubFileShaCache = new Map<string, string>();

export async function publishDataJsonToGitHub(config: {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  token: string;
}): Promise<{ ok: boolean; commitUrl?: string; htmlUrl?: string }> {
  const cleanRepoInput = String(config.repo || '').trim();
  const isGist = cleanRepoInput.includes('gist.github.com') || /^[a-f0-9]{32}$/i.test(cleanRepoInput) || cleanRepoInput.startsWith('gist:');
  const cleanToken = String(config.token || '').trim();

  if (!cleanToken) {
    throw new Error('GITHUB_CONFIG_INCOMPLETE');
  }

  const jsonContent = await buildExportDataJson();

  if (isGist) {
    const cleanRepoClean = cleanRepoInput.replace(/\/+$/, '');
    const gistId = cleanRepoClean.replace(/^gist:/i, '').split('/').pop() || '';
    if (!gistId) throw new Error('GIST_ID_INVALID');

    const ghMeta: GithubSourceMeta = {
      owner: '',
      repo: cleanRepoInput,
      branch: 'main',
      path: 'data.json',
      gistId,
    };
    writeStaticJson('gh_source', ghMeta);

    const apiUrl = `https://api.github.com/gists/${encodeURIComponent(gistId)}`;
    const putResp = await fetch(apiUrl, {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cleanToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'İnönü Tıp Schedule data.json',
        files: {
          'data.json': {
            content: jsonContent,
          },
        },
      }),
    });

    if (putResp.status === 401 || putResp.status === 403) {
      const errText = await putResp.text().catch(() => '');
      console.warn('Gist auth failed (401/403):', errText);
      throw new Error('GITHUB_AUTH_FAILED');
    }
    if (putResp.status === 404) {
      throw new Error('GIST_NOT_FOUND');
    }
    if (!putResp.ok) {
      const errText = await putResp.text().catch(() => '');
      console.warn('Gist push failed status:', putResp.status, errText);
      throw new Error(`GIST_PUSH_FAILED_${putResp.status}`);
    }

    const result = (await putResp.json().catch(() => ({}))) as { html_url?: string };
    void syncStaticCacheWithRemoteDataJson();
    return {
      ok: true,
      htmlUrl: result.html_url,
    };
  }

  const cleanOwner = String(config.owner || '').trim();
  const cleanRepo = cleanRepoInput;
  const cleanBranch = String(config.branch || 'main').trim() || 'main';
  const cleanPath = String(config.path || 'public/data.json').trim().replace(/^\/+/, '') || 'public/data.json';

  if (!cleanOwner || !cleanRepo) {
    throw new Error('GITHUB_CONFIG_INCOMPLETE');
  }

  const ghMeta: GithubSourceMeta = {
    owner: cleanOwner,
    repo: cleanRepo,
    branch: cleanBranch,
    path: cleanPath,
  };
  writeStaticJson('gh_source', ghMeta);

  const encodedPath = cleanPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(cleanOwner)}/${encodeURIComponent(cleanRepo)}/contents/${encodedPath}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${cleanToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const utf8Bytes = new TextEncoder().encode(jsonContent);
  const contentB64 = bytesToB64(utf8Bytes);
  const shaCacheKey = `${cleanOwner}/${cleanRepo}@${cleanBranch}:${cleanPath}`;

  const fetchLatestSha = async (): Promise<string> => {
    const getResp = await fetch(`${apiUrl}?ref=${encodeURIComponent(cleanBranch)}&t=${Date.now()}`, {
      headers,
      cache: 'no-store',
    });
    if (getResp.status === 401 || getResp.status === 403) {
      throw new Error('GITHUB_AUTH_FAILED');
    }
    if (getResp.ok) {
      const fileInfo = (await getResp.json().catch(() => ({}))) as { sha?: string };
      const sha = typeof fileInfo.sha === 'string' ? fileInfo.sha : '';
      if (sha) githubFileShaCache.set(shaCacheKey, sha);
      return sha;
    }
    if (getResp.status !== 404) {
      throw new Error(`GITHUB_READ_FAILED_${getResp.status}`);
    }
    githubFileShaCache.delete(shaCacheKey);
    return '';
  };

  let attempt = 0;
  let putResp: Response | null = null;
  while (attempt < 2) {
    attempt += 1;
    const cachedSha = attempt === 1 ? githubFileShaCache.get(shaCacheKey) || '' : '';
    const existingSha = cachedSha || (await fetchLatestSha());
    const putBody: Record<string, string> = {
      message: 'chore: update data.json from Admin Panel',
      content: contentB64,
      branch: cleanBranch,
    };
    if (existingSha) putBody.sha = existingSha;

    putResp = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(putBody),
    });

    if (putResp.status !== 409 && putResp.status !== 422) break;
    githubFileShaCache.delete(shaCacheKey);
  }

  if (!putResp) {
    throw new Error('GITHUB_PUSH_FAILED');
  }
  if (putResp.status === 401 || putResp.status === 403) {
    throw new Error('GITHUB_AUTH_FAILED');
  }
  if (putResp.status === 404) {
    throw new Error('GITHUB_REPO_OR_BRANCH_NOT_FOUND');
  }
  if (putResp.status === 409) {
    throw new Error('GITHUB_CONFLICT');
  }
  if (!putResp.ok) {
    throw new Error(`GITHUB_PUSH_FAILED_${putResp.status}`);
  }

  const result = (await putResp.json().catch(() => ({}))) as {
    commit?: { html_url?: string };
    content?: { html_url?: string; sha?: string };
  };
  if (result.content?.sha) {
    githubFileShaCache.set(shaCacheKey, result.content.sha);
  }

  void syncStaticCacheWithRemoteDataJson();
  return {
    ok: true,
    commitUrl: result.commit?.html_url,
    htmlUrl: result.content?.html_url,
  };
}
