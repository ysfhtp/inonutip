import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  ADMIN_ROSTER_CIPHERTEXT_B64,
  ADMIN_ROSTER_IV_B64,
  WRAPPED_DEFAULT_ROSTER_KEY,
} from './adminRosterData.ts';
import {
  DEFAULT_ADMIN_PASSWORD_HASH,
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
  verifyStudentHash,
  verifyStudentId,
  type StudentAuthMatch,
} from './studentAllowlist.ts';

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

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
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

const VALID_MBU_GROUPS = new Set(['', 'I', 'II', 'III', 'IV', 'V']);
const VALID_NONEMPTY_MBU_GROUPS = new Set(['I', 'II', 'III', 'IV', 'V']);
const VALID_LAB_GROUPS = new Set(['', '1', '2']);
const VALID_TONES = new Set<AnnouncementTone>(['info', 'warn', 'urgent']);
const ADMIN_SECRET_RE = /^[a-f0-9]{64}$/;

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

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
let unlockedRosterCache: UnlockedRosterCache | null = null;

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
  throw new Error('ADMIN_SECRET_REQUIRED');
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

async function resolveUnlockedRosterData(explicitSecret?: string): Promise<UnlockedRosterCache | null> {
  const secret =
    typeof explicitSecret === 'string' && ADMIN_SECRET_RE.test(explicitSecret.trim().toLowerCase())
      ? explicitSecret.trim().toLowerCase()
      : activeAdminWriteSecret;
  if (!ADMIN_SECRET_RE.test(secret)) return null;
  if (unlockedRosterCache && unlockedRosterCache.secret === secret) {
    return unlockedRosterCache;
  }

  let wrappedFromCloud = '';
  try {
    const snap = await getDoc(doc(db, 'admin_config', 'security'));
    const raw = snap.exists() ? snap.data()?.wrappedRosterKey : '';
    if (typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw)) {
      wrappedFromCloud = raw;
    }
  } catch {
    // Ignore offline error and try default wrapped key
  }

  const candidates = wrappedFromCloud ? [wrappedFromCloud, WRAPPED_DEFAULT_ROSTER_KEY] : [WRAPPED_DEFAULT_ROSTER_KEY];
  for (const cand of candidates) {
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

function appendAdminProofToBatch(batch: WriteBatch, writeSecret: string, targetPath: string): string {
  const opId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  batch.set(doc(db, 'admin_proofs', opId), {
    proof: writeSecret,
    targetPath,
    createdAt: serverTimestamp(),
  });
  return opId;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
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

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

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

function tsToMillis(raw: unknown): number {
  if (raw instanceof Timestamp) return raw.toMillis();
  if (raw && typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
    return (raw as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const pwd = String(password || '');
  if (!pwd) return false;
  const candidateHash = await hashAdminPassword(pwd);
  try {
    const snap = await getDoc(doc(db, 'admin_config', 'security'));
    if (snap.exists()) {
      const storedHash = snap.data()?.passwordHash;
      if (typeof storedHash === 'string' && /^[a-f0-9]{64}$/.test(storedHash)) {
        return candidateHash === storedHash;
      }
    }
  } catch {
    // Fallback to built-in initial password digest if offline or config doc not yet created
  }
  return candidateHash === DEFAULT_ADMIN_PASSWORD_HASH;
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
  const path = 'admin_config/security';

  let wrappedRosterKey = '';
  try {
    const unlocked = await resolveUnlockedRosterData(secret);
    if (unlocked) {
      wrappedRosterKey = await wrapMasterKey(unlocked.masterKeyBytes, newWriteSecret);
    }
  } catch {
    // Keep going even if roster key wasn't unlocked yet
  }

  try {
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, path);
    const payload: Record<string, unknown> = {
      passwordHash: digest,
      proofDigestB64,
      proofOpId: opId,
      updatedAt: serverTimestamp(),
    };
    if (wrappedRosterKey) {
      payload.wrappedRosterKey = wrappedRosterKey;
    }
    batch.set(doc(db, 'admin_config', 'security'), payload);
    await batch.commit();
    setAdminWriteSecret(newWriteSecret);
    return { ok: true, newWriteSecret };
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
    return { ok: false, error: error instanceof Error ? error.message : 'save_failed' };
  }
}

export type StudentAccountStatus = 'active' | 'inactive' | 'deleted';

export type StudentLoginCheckResult =
  | { ok: true; match: StudentAuthMatch }
  | { ok: false; reason: 'invalid' | 'not_found' | 'inactive' | 'deleted' };

async function getDocPreferServer(ref: ReturnType<typeof doc>) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return getDoc(ref);
  }
  try {
    return await getDocFromServer(ref);
  } catch {
    return getDoc(ref);
  }
}

export async function checkStudentLoginStatus(rawSid: string): Promise<StudentLoginCheckResult> {
  const sid = normalizeStudentId(rawSid);
  if (!/^01\d{9}$/.test(sid)) return { ok: false, reason: 'invalid' };

  const allowlistMatch = verifyStudentId(sid);
  const authHash = hashStudentId(sid);

  try {
    const snap = await getDocPreferServer(doc(db, 'custom_students', authHash));
    if (snap.exists()) {
      const data = snap.data();
      if (data?.deleted === true) {
        return { ok: false, reason: 'deleted' };
      }
      if (data?.active === false) {
        return { ok: false, reason: 'inactive' };
      }
      const decryptedCustomName =
        typeof data?.encName === 'string' && data.encName
          ? decryptStudentName(sid, data.encName)
          : '';
      const prog: 'tr' | 'en' =
        data?.prog === 'en' ? 'en' : data?.prog === 'tr' ? 'tr' : allowlistMatch?.prog || 'tr';
      return {
        ok: true,
        match: {
          hash: authHash,
          last4: sid.slice(-4),
          group: normalizeAssignedGroup(data?.group || allowlistMatch?.group || 'I'),
          prog,
          labGroup: prog === 'en' ? '' : normalizeLabGroupPref(data?.labGroup),
          name: decryptedCustomName || allowlistMatch?.name || '',
          source: allowlistMatch ? 'allowlist' : 'custom',
          isAdmin: isAdminStudentId(sid),
        },
      };
    }

    if (allowlistMatch) {
      const dirSnap = await getDocPreferServer(doc(db, 'admin_student_directory', authHash)).catch(() => null);
      if (dirSnap && dirSnap.exists()) {
        const dirData = dirSnap.data();
        if (dirData?.deleted === true) {
          return { ok: false, reason: 'deleted' };
        }
        if (dirData?.active === false) {
          return { ok: false, reason: 'inactive' };
        }
      }
    }
  } catch {
    // Offline or transient read failure; fall back to built-in allowlist match if available
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
  const path = `custom_students/${authHash}`;
  try {
    const snap = await getDocPreferServer(doc(db, 'custom_students', authHash));
    if (snap.exists()) {
      const data = snap.data();
      if (data?.deleted === true) return 'deleted';
      if (data?.active === false) return 'inactive';
      return 'active';
    }
    const dirSnap = await getDocPreferServer(doc(db, 'admin_student_directory', authHash)).catch(() => null);
    if (dirSnap && dirSnap.exists()) {
      const dirData = dirSnap.data();
      if (dirData?.deleted === true) return 'deleted';
      if (dirData?.active === false) return 'inactive';
    }
    return 'active';
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.GET, path);
    }
    return 'active';
  }
}

export function subscribeStudentAccountStatus(
  authHash: string,
  onInvalid: (reason: 'inactive' | 'deleted') => void,
): Unsubscribe {
  if (!isValidAuthHash(authHash) || isAdminStudentHash(authHash)) {
    return () => {};
  }
  const path = `custom_students/${authHash}`;
  return onSnapshot(
    doc(db, 'custom_students', authHash),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data?.deleted === true) {
        onInvalid('deleted');
      } else if (data?.active === false) {
        onInvalid('inactive');
      }
    },
    (error) => {
      if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.GET, path);
      }
      console.warn('Student account status listener warning:', error);
    },
  );
}

export async function isStudentAlreadyRegistered(rawSid: string): Promise<boolean> {
  const sid = normalizeStudentId(rawSid);
  if (!/^01\d{9}$/.test(sid)) return false;
  const authHash = hashStudentId(sid);
  const inAllowlist = Boolean(verifyStudentId(sid));

  try {
    const [customSnap, dirSnap] = await Promise.all([
      getDocPreferServer(doc(db, 'custom_students', authHash)).catch(() => null),
      getDocPreferServer(doc(db, 'admin_student_directory', authHash)).catch(() => null),
    ]);
    const customExists = Boolean(customSnap && customSnap.exists());
    const dirExists = Boolean(dirSnap && dirSnap.exists());
    const customDeleted = Boolean(customSnap && customSnap.exists() && customSnap.data()?.deleted === true);
    const dirDeleted = Boolean(dirSnap && dirSnap.exists() && dirSnap.data()?.deleted === true);

    if (customExists && !customDeleted) return true;
    if (dirExists && !dirDeleted) return true;
    if (inAllowlist && !customDeleted && !dirDeleted) return true;
    return false;
  } catch {
    return inAllowlist;
  }
}

export async function loadCloudStudentPrefs(authHash: string, cloudDocId: string): Promise<StudentCloudPrefs | null> {
  if ((!isValidAuthHash(authHash) && !verifyStudentHash(authHash)) || !isValidCloudDocId(cloudDocId)) {
    return null;
  }
  const path = `student_prefs/${cloudDocId}`;
  try {
    const snap = await getDoc(doc(db, 'student_prefs', cloudDocId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      myMbuGroup: normalizeMbuGroupPref(data?.myMbuGroup),
      myLabGroup: normalizeLabGroupPref(data?.myLabGroup),
      otherGroupMode: normalizeOtherGroupModePref(data?.otherGroupMode),
      lang: normalizeLangPref(data?.lang),
      authHash: typeof data?.authHash === 'string' && isValidAuthHash(data.authHash) ? data.authHash : undefined,
      last4: typeof data?.last4 === 'string' && /^[0-9]{4}$/.test(data.last4) ? data.last4 : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.GET, path);
    }
    return null;
  }
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
  const path = `student_prefs/${cloudDocId}`;
  const cleanLang = normalizeLangPref(prefs.lang);
  const cleanLast4 =
    typeof prefs.last4 === 'string' && /^[0-9]{4}$/.test(prefs.last4.trim())
      ? prefs.last4.trim()
      : '';

  const payload: Record<string, unknown> = {
    myMbuGroup: normalizeMbuGroupPref(prefs.myMbuGroup),
    myLabGroup: normalizeLabGroupPref(prefs.myLabGroup),
    otherGroupMode: normalizeOtherGroupModePref(prefs.otherGroupMode),
    updatedAt: serverTimestamp(),
  };
  if (cleanLang) payload.lang = cleanLang;
  if (isValidAuthHash(authHash)) payload.authHash = authHash;
  if (cleanLast4) payload.last4 = cleanLast4;

  try {
    await setDoc(doc(db, 'student_prefs', cloudDocId), payload);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
    return false;
  }
}

// ==================== ANNOUNCEMENTS ====================

function mapAnnouncementDoc(id: string, data: Record<string, unknown>): CloudAnnouncement {
  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    message: typeof data.message === 'string' ? data.message : '',
    tone: normalizeAnnouncementTone(data.tone),
    active: data.active === true,
    targetGroup: normalizeMbuGroupPref(data.targetGroup),
    targetProg: normalizeLangPref(data.targetProg),
    createdAtMs: tsToMillis(data.createdAt),
    updatedAtMs: tsToMillis(data.updatedAt),
  };
}

export async function loadActiveAnnouncements(): Promise<CloudAnnouncement[]> {
  const path = 'announcements';
  try {
    const q = query(collection(db, 'announcements'), where('active', '==', true), limit(100));
    const snap = await getDocs(q);
    return snap.docs
      .filter((d) => d.data()?.deleted !== true)
      .map((d) => mapAnnouncementDoc(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
    return [];
  }
}

export async function listAllAnnouncements(): Promise<CloudAnnouncement[]> {
  const path = 'announcements';
  try {
    const q = query(collection(db, 'announcements'), limit(200));
    const snap = await getDocs(q);
    return snap.docs
      .filter((d) => d.data()?.deleted !== true)
      .map((d) => mapAnnouncementDoc(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
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
  const cleanTone = normalizeAnnouncementTone(input.tone);
  const isActive = Boolean(input.active);
  const targetGroup = normalizeMbuGroupPref(input.targetGroup);
  const targetProg = normalizeLangPref(input.targetProg);
  if (!cleanTitle || !cleanMessage) {
    throw new Error('Title and message are required.');
  }

  const hasExplicitId = typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.id.trim());
  const rawId = hasExplicitId
    ? input.id!.trim()
    : `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const docRef = doc(db, 'announcements', rawId);
  const path = `announcements/${rawId}`;

  try {
    const existingSnap = hasExplicitId ? await getDoc(docRef) : null;
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, path);

    const payload = {
      title: cleanTitle,
      message: cleanMessage,
      tone: cleanTone,
      active: isActive,
      targetGroup,
      targetProg,
      deleted: false,
      proofOpId: opId,
      updatedAt: serverTimestamp(),
    };

    if (existingSnap && existingSnap.exists() && existingSnap.data()?.createdAt) {
      batch.update(docRef, payload);
    } else {
      batch.set(docRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();

    try {
      const freshSnap = await getDoc(docRef);
      if (freshSnap.exists()) {
        return mapAnnouncementDoc(rawId, (freshSnap.data() || {}) as Record<string, unknown>);
      }
    } catch {
      // Fall back
    }
    return {
      id: rawId,
      title: cleanTitle,
      message: cleanMessage,
      tone: cleanTone,
      active: isActive,
      targetGroup,
      targetProg,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteAnnouncement(id: string, adminSecret?: string): Promise<void> {
  const cleanId = String(id || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return;
  const secret = resolveAdminWriteSecret(adminSecret);
  const path = `announcements/${cleanId}`;
  const docRef = doc(db, 'announcements', cleanId);

  try {
    const existingSnap = await getDoc(docRef);
    if (!existingSnap.exists()) return;
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, path);
    batch.update(docRef, {
      active: false,
      deleted: true,
      proofOpId: opId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==================== LESSON MATERIALS ====================

export interface LessonMaterial {
  id: string; // e.g. "01-12-2026_1_1730000000000_abcd"
  date: string; // DD.MM.YYYY
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

const MAX_SERVER_PDF_BYTES = 250 * 1024 * 1024;
const INLINE_PDF_MAX_BYTES = 650 * 1024;
const CLOUD_PDF_CHUNK_BYTES = 600 * 1024;
const CHUNKS_PER_BATCH = 3;
const CHUNK_UPLOAD_CONCURRENCY = 3;
const CHUNK_DOWNLOAD_CONCURRENCY = 6;

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

export function generateLessonMaterialId(date: string, slotNo: number): string {
  const cleanDate = normalizeMaterialDate(date) || '01.01.2026';
  const dateKey = cleanDate.replace(/[^a-zA-Z0-9_-]/g, '-');
  const cleanSlot = Math.min(10, Math.max(1, Math.round(Number(slotNo) || 1)));
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return `${dateKey}_${cleanSlot}_${uniqueSuffix}`.slice(0, 100);
}

function uint8ToBase64(bytes: Uint8Array): string {
  const sliceLen = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += sliceLen) {
    const sub = bytes.subarray(offset, Math.min(bytes.length, offset + sliceLen));
    parts.push(String.fromCharCode(...sub));
  }
  return btoa(parts.join(''));
}

export async function deleteServerPdfByUrl(pdfUrl: string, adminSecret?: string): Promise<void> {
  const clean = typeof pdfUrl === 'string' ? pdfUrl.trim() : '';
  if (!clean.startsWith('/api/lesson-pdf/')) return;
  const fileId = clean.slice('/api/lesson-pdf/'.length).split('?')[0].trim();
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(fileId)) return;
  try {
    const secret = resolveAdminWriteSecret(adminSecret);
    await fetch(`/api/lesson-pdf/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: {
        'X-Admin-Secret': secret,
      },
    });
  } catch {
    // Best-effort legacy cleanup
  }
}

export async function uploadLessonPdfFile(
  file: File,
  adminSecret?: string,
  onProgress?: (percent: number, loadedBytes: number, totalBytes: number) => void,
  materialId?: string,
): Promise<{
  sourceType: 'file' | 'chunks';
  materialId: string;
  url: string;
  fileId: string;
  fileName: string;
  size: number;
  chunkCount: number;
  fallbackBase64?: string;
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

  // Small PDFs (<= 650 KB) embed directly in the single lesson_materials doc.
  if (file.size <= INLINE_PDF_MAX_BYTES) {
    const buf = await file.arrayBuffer();
    const inlineBase64 = uint8ToBase64(new Uint8Array(buf));
    onProgress?.(100, file.size, file.size);
    return {
      sourceType: 'file',
      materialId: cleanMatId,
      url: '',
      fileId: cleanMatId,
      fileName: cleanFileName,
      size: file.size,
      chunkCount: 0,
      fallbackBase64: inlineBase64,
    };
  }

  // Larger PDFs (up to 250 MB) upload natively into Firestore lesson_material_chunks so every deployment/PWA shares the exact same files.
  const totalChunks = Math.ceil(file.size / CLOUD_PDF_CHUNK_BYTES);
  const batches: number[][] = [];
  for (let i = 0; i < totalChunks; i += CHUNKS_PER_BATCH) {
    const indices: number[] = [];
    for (let j = i; j < Math.min(totalChunks, i + CHUNKS_PER_BATCH); j++) {
      indices.push(j);
    }
    batches.push(indices);
  }

  let nextBatchCursor = 0;
  let uploadedBytes = 0;

  const uploadBatchWorker = async () => {
    while (nextBatchCursor < batches.length) {
      const batchIdx = nextBatchCursor++;
      const chunkIndices = batches[batchIdx];

      const encodedChunks = await Promise.all(
        chunkIndices.map(async (chunkIndex) => {
          const start = chunkIndex * CLOUD_PDF_CHUNK_BYTES;
          const end = Math.min(file.size, start + CLOUD_PDF_CHUNK_BYTES);
          const buf = await file.slice(start, end).arrayBuffer();
          return {
            chunkIndex,
            byteLen: end - start,
            b64: uint8ToBase64(new Uint8Array(buf)),
          };
        }),
      );

      let attempt = 0;
      let committed = false;
      let lastErr: unknown = null;
      while (attempt < 3 && !committed) {
        attempt += 1;
        try {
          const batch = writeBatch(db);
          const opId = appendAdminProofToBatch(batch, secret, `lesson_material_chunks/${cleanMatId}`);
          for (const chunk of encodedChunks) {
            const chunkId = `${cleanMatId}_c${chunk.chunkIndex}`;
            batch.set(doc(db, 'lesson_material_chunks', chunkId), {
              materialId: cleanMatId,
              chunkIndex: chunk.chunkIndex,
              totalChunks,
              data: chunk.b64,
              proofOpId: opId,
              updatedAt: serverTimestamp(),
            });
          }
          await batch.commit();
          committed = true;
        } catch (err) {
          lastErr = err;
          if (attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
      if (!committed && lastErr) throw lastErr;

      const batchBytes = encodedChunks.reduce((sum, c) => sum + c.byteLen, 0);
      uploadedBytes = Math.min(file.size, uploadedBytes + batchBytes);
      const pct = Math.min(95, Math.max(4, Math.round((uploadedBytes / file.size) * 94)));
      onProgress?.(pct, uploadedBytes, file.size);
    }
  };

  const workerCount = Math.min(CHUNK_UPLOAD_CONCURRENCY, batches.length);
  await Promise.all(Array.from({ length: workerCount }, () => uploadBatchWorker()));
  onProgress?.(98, file.size, file.size);

  return {
    sourceType: 'chunks',
    materialId: cleanMatId,
    url: '',
    fileId: cleanMatId,
    fileName: cleanFileName,
    size: file.size,
    chunkCount: totalChunks,
  };
}

export async function downloadLessonMaterialChunks(
  materialId: string,
  chunkCount: number,
  onProgress?: (percent: number, loadedChunks: number, totalChunks: number) => void,
): Promise<Blob> {
  const cleanId = String(materialId || '').trim();
  const total = Math.round(Number(chunkCount) || 0);
  if (!/^[a-zA-Z0-9_-]{1,115}$/.test(cleanId) || total < 1 || total > 600) {
    throw new Error('INVALID_CHUNKED_MATERIAL');
  }

  const byteParts = new Array<Uint8Array>(total);
  let nextIdx = 0;
  let completed = 0;

  const downloadWorker = async () => {
    while (nextIdx < total) {
      const idx = nextIdx++;
      const chunkId = `${cleanId}_c${idx}`;
      const chunkRef = doc(db, 'lesson_material_chunks', chunkId);

      let snapData: Record<string, unknown> | null = null;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 2 && !snapData; attempt++) {
        try {
          const snap = attempt === 1 ? await getDocPreferServer(chunkRef) : await getDoc(chunkRef);
          if (!snap.exists()) {
            throw new Error(`MISSING_CHUNK_${idx}`);
          }
          snapData = snap.data() as Record<string, unknown>;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 250));
          }
        }
      }
      if (!snapData) {
        throw lastErr instanceof Error ? lastErr : new Error(`CHUNK_DOWNLOAD_FAILED_${idx}`);
      }

      const rawB64 = typeof snapData.data === 'string' ? snapData.data : '';
      if (!rawB64) {
        throw new Error(`EMPTY_CHUNK_${idx}`);
      }
      byteParts[idx] = b64ToBytes(rawB64);
      completed += 1;
      onProgress?.(Math.min(99, Math.round((completed / total) * 100)), completed, total);
    }
  };

  const workers = Math.min(CHUNK_DOWNLOAD_CONCURRENCY, total);
  await Promise.all(Array.from({ length: workers }, () => downloadWorker()));
  onProgress?.(100, total, total);
  return new Blob(byteParts as unknown as BlobPart[], { type: 'application/pdf' });
}

export async function loadAllLessonMaterials(): Promise<LessonMaterial[]> {
  const path = 'lesson_materials';
  try {
    const q = query(collection(db, 'lesson_materials'), limit(500));
    const snap = await getDocs(q);
    return snap.docs
      .filter((d) => d.data()?.deleted !== true)
      .map((d) => {
        const data = d.data();
        const pdfData = typeof data.pdfData === 'string' && data.pdfData.length > 0 ? data.pdfData : undefined;
        const pdfUrl = typeof data.pdfUrl === 'string' ? data.pdfUrl : '';
        const chunkCount =
          typeof data.chunkCount === 'number' && Number.isFinite(data.chunkCount) && data.chunkCount > 0
            ? Math.round(data.chunkCount)
            : undefined;
        const sourceType: 'url' | 'file' | 'server' | 'chunks' =
          chunkCount && chunkCount > 0
            ? 'chunks'
            : data.sourceType === 'chunks'
              ? 'chunks'
              : data.sourceType === 'server' || pdfUrl.startsWith('/api/lesson-pdf/')
                ? 'server'
                : data.sourceType === 'file' || pdfData
                  ? 'file'
                  : 'url';
        return {
          id: d.id,
          date: normalizeMaterialDate(typeof data.date === 'string' ? data.date : ''),
          slotNo: typeof data.slotNo === 'number' ? data.slotNo : 1,
          targetProg: normalizeLangPref(data.targetProg),
          title: typeof data.title === 'string' ? data.title : '',
          sourceType,
          pdfUrl,
          pdfData,
          chunkCount,
          pdfName: typeof data.pdfName === 'string' ? data.pdfName : undefined,
          fileSize: typeof data.fileSize === 'number' && data.fileSize >= 0 ? data.fileSize : undefined,
          createdAtMs: tsToMillis(data.createdAt),
          updatedAtMs: tsToMillis(data.updatedAt),
        };
      })
      .sort((a, b) => (a.createdAtMs || a.updatedAtMs) - (b.createdAtMs || b.updatedAtMs));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
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
  const rawSlot = Math.round(Number(input.slotNo) || 1);
  const slotNo = Math.min(10, Math.max(1, rawSlot));
  const targetProg = normalizeLangPref(input.targetProg);
  const cleanTitle = String(input.title || '').trim().slice(0, 120);
  const rawData = typeof input.pdfData === 'string'
    ? input.pdfData.trim().replace(/^data:[^;]+;base64,/i, '')
    : '';
  const rawChunkCount =
    typeof input.chunkCount === 'number' && Number.isFinite(input.chunkCount) && input.chunkCount > 0
      ? Math.round(input.chunkCount)
      : 0;
  let cleanUrl = String(input.pdfUrl || '').trim();
  if (cleanUrl && !cleanUrl.startsWith('/api/lesson-pdf/') && !/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = `https://${cleanUrl}`;
  }
  cleanUrl = cleanUrl.slice(0, 2000);

  const sourceType: 'url' | 'file' | 'server' | 'chunks' =
    input.sourceType === 'chunks' || rawChunkCount > 0
      ? 'chunks'
      : input.sourceType === 'server' || cleanUrl.startsWith('/api/lesson-pdf/')
        ? 'server'
        : input.sourceType === 'file' || (rawData.length > 0 && !cleanUrl)
          ? 'file'
          : 'url';
  const cleanData = sourceType === 'file' ? rawData : '';
  const finalChunkCount = sourceType === 'chunks' ? rawChunkCount : 0;
  const finalUrl = sourceType === 'file' || sourceType === 'chunks' ? '' : cleanUrl;
  const cleanName = String(input.pdfName || '').trim().slice(0, 120);
  const cleanFileSize =
    typeof input.fileSize === 'number' && Number.isFinite(input.fileSize) && input.fileSize >= 0
      ? Math.min(MAX_SERVER_PDF_BYTES, Math.round(input.fileSize))
      : undefined;

  if (!cleanDate || !cleanTitle) {
    throw new Error('Date and title are required.');
  }
  if (sourceType === 'file') {
    if (!cleanData) throw new Error('PDF file data is required.');
    if (cleanData.length > 950000) throw new Error('PDF_TOO_LARGE');
  } else if (sourceType === 'chunks') {
    if (finalChunkCount < 1 || finalChunkCount > 600) {
      throw new Error('Invalid PDF chunk count.');
    }
  } else {
    if (!finalUrl) throw new Error('PDF URL is required.');
  }

  const candidateId = input.id
    ? input.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 110)
    : generateLessonMaterialId(cleanDate, slotNo);
  const rawId = (candidateId || `${Date.now()}_${slotNo}`).slice(0, 110);
  const docRef = doc(db, 'lesson_materials', rawId);
  const path = `lesson_materials/${rawId}`;

  try {
    const existingSnap = await getDoc(docRef);
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, path);
    const payload: Record<string, unknown> = {
      date: cleanDate,
      slotNo,
      targetProg,
      title: cleanTitle,
      sourceType,
      pdfUrl: finalUrl,
      pdfData: cleanData,
      chunkCount: finalChunkCount,
      deleted: false,
      proofOpId: opId,
      updatedAt: serverTimestamp(),
    };
    if (cleanName) payload.pdfName = cleanName;
    if (typeof cleanFileSize === 'number') payload.fileSize = cleanFileSize;

    if (existingSnap.exists() && existingSnap.data()?.createdAt) {
      batch.update(docRef, payload);
    } else {
      payload.createdAt = serverTimestamp();
      batch.set(docRef, payload);
    }
    await batch.commit();

    return {
      id: rawId,
      date: cleanDate,
      slotNo,
      targetProg,
      title: cleanTitle,
      sourceType,
      pdfUrl: finalUrl,
      pdfData: cleanData || undefined,
      chunkCount: finalChunkCount > 0 ? finalChunkCount : undefined,
      pdfName: cleanName || undefined,
      fileSize: cleanFileSize,
      createdAtMs: existingSnap.exists() ? tsToMillis(existingSnap.data()?.createdAt) : Date.now(),
      updatedAtMs: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteLessonMaterial(id: string, adminSecret?: string): Promise<void> {
  const cleanId = String(id || '').trim();
  if (!cleanId) return;
  const secret = resolveAdminWriteSecret(adminSecret);
  const path = `lesson_materials/${cleanId}`;
  const docRef = doc(db, 'lesson_materials', cleanId);

  try {
    const existingSnap = await getDoc(docRef);
    if (!existingSnap.exists()) return;
    const prevUrl = typeof existingSnap.data()?.pdfUrl === 'string' ? existingSnap.data()?.pdfUrl : '';
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, path);
    batch.update(docRef, {
      deleted: true,
      proofOpId: opId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    if (prevUrl.startsWith('/api/lesson-pdf/')) {
      void deleteServerPdfByUrl(prevUrl, secret);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==================== ADMIN STUDENT MANAGEMENT ====================

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
    // Optional encSid if roster key unavailable
  }

  const customRef = doc(db, 'custom_students', authHash);
  const dirRef = doc(db, 'admin_student_directory', authHash);
  const prefsRef = doc(db, 'student_prefs', cloudKey);

  try {
    const [existingCustom, existingDir] = await Promise.all([
      getDocPreferServer(customRef),
      getDocPreferServer(dirRef),
    ]);

    if (options?.rejectIfExists) {
      const customExistsLive = existingCustom.exists() && existingCustom.data()?.deleted !== true;
      const dirExistsLive = existingDir.exists() && existingDir.data()?.deleted !== true;
      const customDeleted = existingCustom.exists() && existingCustom.data()?.deleted === true;
      const dirDeleted = existingDir.exists() && existingDir.data()?.deleted === true;
      const builtInNotDeleted = Boolean(verifyStudentId(sid)) && !customDeleted && !dirDeleted;
      if (customExistsLive || dirExistsLive || builtInNotDeleted) {
        throw new Error('DUPLICATE_STUDENT_ID');
      }
    }

    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, `student/${authHash}`);

    const customPayload: Record<string, unknown> = {
      group,
      labGroup,
      prog,
      encName,
      last4,
      cloudKey,
      active,
      deleted: false,
      proofOpId: opId,
      updatedAt: serverTimestamp(),
    };
    if (encSid) customPayload.encSid = encSid;

    if (existingCustom.exists()) {
      batch.update(customRef, customPayload);
    } else {
      batch.set(customRef, {
        ...customPayload,
        createdAt: serverTimestamp(),
      });
    }

    const dirPayload: Record<string, unknown> = {
      authHash,
      cloudKey,
      last4,
      encFullName,
      group,
      labGroup,
      prog,
      source,
      active,
      deleted: false,
      proofOpId: opId,
      createdAt: existingDir.exists() && existingDir.data()?.createdAt ? existingDir.data()?.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (encSid) dirPayload.encSid = encSid;
    batch.set(dirRef, dirPayload);

    batch.set(prefsRef, {
      myMbuGroup: group,
      myLabGroup: labGroup,
      otherGroupMode,
      lang: prog,
      authHash,
      last4,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

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
      updatedAtMs: Date.now(),
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'DUPLICATE_STUDENT_ID') {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `custom_students/${authHash}`);
  }
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
  const customRef = doc(db, 'custom_students', authHash);
  const dirRef = doc(db, 'admin_student_directory', authHash);

  try {
    const [existingCustom, existingDir, unlockedRoster] = await Promise.all([
      getDocPreferServer(customRef),
      getDocPreferServer(dirRef),
      resolveUnlockedRosterData(secret).catch(() => null),
    ]);

    const rosterEntry = unlockedRoster?.entries.find((e) => e.authHash === authHash);
    const allowMeta = verifyStudentHash(authHash);
    const customData = (existingCustom.exists() ? existingCustom.data() : null) as Record<string, unknown> | null;
    const dirData = (existingDir.exists() ? existingDir.data() : null) as Record<string, unknown> | null;

    const hintSid =
      typeof studentHint?.studentId === 'string' && /^01\d{9}$/.test(studentHint.studentId.trim())
        ? studentHint.studentId.trim()
        : '';
    const effectiveSid = hintSid || rosterEntry?.sid || '';

    const derivedCloudKey =
      (typeof customData?.cloudKey === 'string' && isValidCloudDocId(customData.cloudKey) ? customData.cloudKey : '') ||
      (typeof dirData?.cloudKey === 'string' && isValidCloudDocId(dirData.cloudKey) ? dirData.cloudKey : '') ||
      (typeof cloudKey === 'string' && isValidCloudDocId(cloudKey) ? cloudKey : '') ||
      rosterEntry?.cloudKey ||
      (effectiveSid ? await deriveCloudDocId(effectiveSid) : '');

    const effectiveLast4 =
      (effectiveSid ? effectiveSid.slice(-4) : '') ||
      (typeof customData?.last4 === 'string' && /^[0-9]{4}$/.test(customData.last4) ? customData.last4 : '') ||
      (typeof dirData?.last4 === 'string' && /^[0-9]{4}$/.test(dirData.last4) ? dirData.last4 : '') ||
      (typeof studentHint?.last4 === 'string' && /^[0-9]{4}$/.test(studentHint.last4) ? studentHint.last4 : '') ||
      '0000';

    const effectiveGroup = normalizeAssignedGroup(
      customData?.group ?? dirData?.group ?? studentHint?.group ?? studentHint?.myMbuGroup ?? rosterEntry?.group ?? allowMeta?.group ?? 'I',
    );
    const effectiveProg: 'tr' | 'en' =
      customData?.prog === 'en' || dirData?.prog === 'en' || studentHint?.prog === 'en' || rosterEntry?.prog === 'en' || allowMeta?.prog === 'en'
        ? 'en'
        : 'tr';
    const effectiveLabGroup =
      effectiveProg === 'en'
        ? ''
        : normalizeLabGroupPref(customData?.labGroup ?? dirData?.labGroup ?? studentHint?.myLabGroup ?? '');
    const effectiveSource: 'allowlist' | 'custom' =
      allowMeta || rosterEntry || dirData?.source === 'allowlist' || studentHint?.source === 'allowlist'
        ? 'allowlist'
        : 'custom';

    const resolvedName =
      readAdminDirFullName(authHash, dirData) ||
      (typeof studentHint?.fullName === 'string' ? studentHint.fullName.trim() : '') ||
      rosterEntry?.fullName ||
      `Öğrenci •••${effectiveLast4}`;

    let encSid =
      (typeof customData?.encSid === 'string' && customData.encSid) ||
      (typeof dirData?.encSid === 'string' && dirData.encSid) ||
      '';
    if (!encSid && effectiveSid && unlockedRoster) {
      encSid = await encryptAdminSid(unlockedRoster.aesKey, effectiveSid).catch(() => '');
    }

    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, `student/${authHash}`);

    if (existingCustom.exists()) {
      batch.update(customRef, {
        active: false,
        deleted: true,
        proofOpId: opId,
        updatedAt: serverTimestamp(),
      });
    } else if (isValidCloudDocId(derivedCloudKey)) {
      const customPayload: Record<string, unknown> = {
        group: effectiveGroup,
        labGroup: effectiveLabGroup,
        prog: effectiveProg,
        encName: effectiveSid && resolvedName ? encryptStudentName(effectiveSid, resolvedName.slice(0, 120)) : '',
        last4: effectiveLast4,
        cloudKey: derivedCloudKey,
        active: false,
        deleted: true,
        proofOpId: opId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (encSid) customPayload.encSid = encSid;
      batch.set(customRef, customPayload);
    }

    if (isValidCloudDocId(derivedCloudKey)) {
      const encFullName =
        (typeof dirData?.encFullName === 'string' && dirData.encFullName) ||
        encryptDirectoryName(authHash, resolvedName.slice(0, 120) || `Öğrenci •••${effectiveLast4}`);
      const dirPayload: Record<string, unknown> = {
        authHash,
        cloudKey: derivedCloudKey,
        last4: effectiveLast4,
        encFullName,
        group: effectiveGroup,
        labGroup: effectiveLabGroup,
        prog: effectiveProg,
        source: effectiveSource,
        active: false,
        deleted: true,
        proofOpId: opId,
        createdAt: (dirData?.createdAt as Timestamp | undefined) || serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (encSid) dirPayload.encSid = encSid;
      batch.set(dirRef, dirPayload);
    }

    await batch.commit();
  } catch (error) {
    if (error instanceof Error && error.message === 'CANNOT_DELETE_ADMIN') {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, `custom_students/${authHash}`);
  }
}

function readAdminDirFullName(authHash: string, dirData: Record<string, unknown> | null | undefined): string {
  if (!dirData) return '';
  if (typeof dirData.encFullName === 'string' && dirData.encFullName) {
    const dec = decryptDirectoryName(authHash, dirData.encFullName);
    if (dec) return dec;
  }
  if (typeof dirData.fullName === 'string' && dirData.fullName) {
    return dirData.fullName;
  }
  return '';
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

  try {
    const [dirSnap, customSnap, prefsSnap] = await Promise.all([
      getDocPreferServer(doc(db, 'admin_student_directory', authHash)).catch(() => null),
      getDocPreferServer(doc(db, 'custom_students', authHash)).catch(() => null),
      getDocPreferServer(doc(db, 'student_prefs', cloudKey)).catch(() => null),
    ]);
    if (dirSnap && dirSnap.exists()) {
      if (dirSnap.data()?.deleted === true) return null;
      dirData = dirSnap.data() as Record<string, unknown>;
    }
    if (customSnap && customSnap.exists()) {
      if (customSnap.data()?.deleted === true) return null;
      customData = customSnap.data() as Record<string, unknown>;
    }
    if (prefsSnap && prefsSnap.exists()) {
      prefsData = prefsSnap.data() as Record<string, unknown>;
    }
  } catch {
    // Use local allowlist info if cloud fetch fails
  }

  if (!allowMatch && !dirData && !customData && !prefsData) {
    return null;
  }

  const decryptedCustom =
    customData && typeof customData.encName === 'string'
      ? decryptStudentName(sid, customData.encName)
      : '';
  const fullName =
    readAdminDirFullName(authHash, dirData) ||
    decryptedCustom ||
    allowMatch?.name ||
    `Öğrenci •••${last4}`;

  const baseGroup = normalizeAssignedGroup(
    (customData?.group as string) || (dirData?.group as string) || allowMatch?.group || 'I',
  );
  const baseProg: 'tr' | 'en' =
    customData?.prog === 'en' || dirData?.prog === 'en'
      ? 'en'
      : customData?.prog === 'tr' || dirData?.prog === 'tr'
        ? 'tr'
        : allowMatch?.prog || 'tr';

  return {
    authHash,
    cloudKey,
    studentId: sid,
    last4,
    fullName,
    group: baseGroup,
    prog: baseProg,
    myMbuGroup: prefsData ? normalizeMbuGroupPref(prefsData.myMbuGroup) : baseGroup,
    myLabGroup: baseProg === 'en' ? '' : (prefsData ? normalizeLabGroupPref(prefsData.myLabGroup) : normalizeLabGroupPref(customData?.labGroup)),
    otherGroupMode: prefsData ? normalizeOtherGroupModePref(prefsData.otherGroupMode) : 'dim',
    lang: prefsData ? (normalizeLangPref(prefsData.lang) || baseProg) : baseProg,
    source: allowMatch ? 'allowlist' : 'custom',
    active: customData ? customData.active !== false : dirData ? dirData.active !== false : true,
    updatedAtMs: Math.max(tsToMillis(prefsData?.updatedAt), tsToMillis(dirData?.updatedAt), tsToMillis(customData?.updatedAt)),
  };
}

export async function loadAllAdminStudents(adminSecret?: string): Promise<AdminStudentListItem[]> {
  try {
    const [dirSnap, customSnap, prefsSnap, unlockedRoster] = await Promise.all([
      getDocs(query(collection(db, 'admin_student_directory'), limit(1000))),
      getDocs(query(collection(db, 'custom_students'), limit(1000))),
      getDocs(query(collection(db, 'student_prefs'), limit(1000))),
      resolveUnlockedRosterData(adminSecret).catch(() => null),
    ]);

    const dirByHash = new Map<string, Record<string, unknown>>();
    dirSnap.forEach((d) => dirByHash.set(d.id, d.data() as Record<string, unknown>));

    const customByHash = new Map<string, Record<string, unknown>>();
    customSnap.forEach((d) => customByHash.set(d.id, d.data() as Record<string, unknown>));

    const prefsByCloud = new Map<string, Record<string, unknown>>();
    prefsSnap.forEach((d) => prefsByCloud.set(d.id, d.data() as Record<string, unknown>));

    const rosterByHash = new Map<string, DecryptedRosterEntry>();
    const rosterByCloud = new Map<string, DecryptedRosterEntry>();
    if (unlockedRoster) {
      unlockedRoster.entries.forEach((entry) => {
        rosterByHash.set(entry.authHash, entry);
        rosterByCloud.set(entry.cloudKey, entry);
      });
    }

    const seenHashes = new Set<string>();
    const seenCloudKeys = new Set<string>();
    const results: AdminStudentListItem[] = [];

    // 1. All 349 built-in Term I students merged with any cloud overrides/prefs
    if (unlockedRoster) {
      for (const entry of unlockedRoster.entries) {
        const { authHash, cloudKey } = entry;
        seenHashes.add(authHash);
        seenCloudKeys.add(cloudKey);

        const dir = dirByHash.get(authHash);
        const custom = customByHash.get(authHash);
        const prefs = prefsByCloud.get(cloudKey);

        if (dir?.deleted === true || custom?.deleted === true) continue;

        const baseGroup = normalizeAssignedGroup(
          (custom && custom.deleted !== true ? custom.group : undefined) ??
            (dir && dir.deleted !== true ? dir.group : undefined) ??
            entry.group,
        );
        const baseProg: 'tr' | 'en' =
          custom && custom.deleted !== true && (custom.prog === 'en' || custom.prog === 'tr')
            ? custom.prog
            : dir && dir.deleted !== true && (dir.prog === 'en' || dir.prog === 'tr')
              ? dir.prog
              : entry.prog;

        const effectiveLang: 'tr' | 'en' =
          prefs && (prefs.lang === 'en' || prefs.lang === 'tr') ? prefs.lang : baseProg;

        const resolvedName =
          (dir && dir.deleted !== true ? readAdminDirFullName(authHash, dir) : '') ||
          (custom && custom.deleted !== true && typeof custom.encName === 'string'
            ? decryptStudentName(entry.sid, custom.encName)
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
          myMbuGroup: prefs ? normalizeMbuGroupPref(prefs.myMbuGroup) || baseGroup : baseGroup,
          myLabGroup:
            effectiveLang === 'en'
              ? ''
              : prefs
                ? normalizeLabGroupPref(prefs.myLabGroup)
                : normalizeLabGroupPref(
                    (custom && custom.deleted !== true ? custom.labGroup : undefined) ??
                      (dir && dir.deleted !== true ? dir.labGroup : undefined),
                  ),
          otherGroupMode: prefs ? normalizeOtherGroupModePref(prefs.otherGroupMode) : 'dim',
          lang: effectiveLang,
          source: 'allowlist',
          active:
            custom && custom.deleted !== true
              ? custom.active !== false
              : dir && dir.deleted !== true
                ? dir.active !== false
                : true,
          updatedAtMs: Math.max(tsToMillis(prefs?.updatedAt), tsToMillis(dir?.updatedAt), tsToMillis(custom?.updatedAt)),
        });
      }
    }

    // 2. Custom / cloud-only student directory entries
    const allCloudHashes = new Set<string>([...dirByHash.keys(), ...customByHash.keys()]);
    for (const authHash of allCloudHashes) {
      if (seenHashes.has(authHash)) continue;
      seenHashes.add(authHash);

      const dir = dirByHash.get(authHash);
      const custom = customByHash.get(authHash);
      const cloudKey =
        (typeof dir?.cloudKey === 'string' && dir.cloudKey) ||
        (typeof custom?.cloudKey === 'string' && custom.cloudKey) ||
        '';
      if (cloudKey) seenCloudKeys.add(cloudKey);

      if (dir?.deleted === true || custom?.deleted === true) {
        continue;
      }

      const allowMeta = verifyStudentHash(authHash);
      const prefs = cloudKey ? prefsByCloud.get(cloudKey) : undefined;

      let decryptedSid = '';
      if (unlockedRoster) {
        const rawEncSid =
          (typeof dir?.encSid === 'string' && dir.encSid) ||
          (typeof custom?.encSid === 'string' && custom.encSid) ||
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

      const baseGroup = normalizeMbuGroupPref(custom?.group ?? dir?.group ?? allowMeta?.group ?? '');
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
        (decryptedSid && typeof custom?.encName === 'string' ? decryptStudentName(decryptedSid, custom.encName) : '') ||
        (allowMeta ? `Dönem I •••${last4}` : `Özel Öğrenci •••${last4}`);

      results.push({
        authHash,
        cloudKey,
        studentId: decryptedSid || undefined,
        last4,
        fullName: resolvedName,
        group: baseGroup,
        prog: baseProg,
        myMbuGroup: prefs ? normalizeMbuGroupPref(prefs.myMbuGroup) : baseGroup,
        myLabGroup:
          effectiveLang === 'en'
            ? ''
            : prefs
              ? normalizeLabGroupPref(prefs.myLabGroup)
              : normalizeLabGroupPref(custom?.labGroup ?? dir?.labGroup),
        otherGroupMode: prefs ? normalizeOtherGroupModePref(prefs.otherGroupMode) : 'dim',
        lang: effectiveLang,
        source: allowMeta ? 'allowlist' : 'custom',
        active: custom ? custom.active !== false : dir ? dir.active !== false : true,
        updatedAtMs: Math.max(tsToMillis(prefs?.updatedAt), tsToMillis(dir?.updatedAt), tsToMillis(custom?.updatedAt)),
      });
    }

    // 3. Any stray prefs documents not matched above
    prefsByCloud.forEach((prefs, cloudKey) => {
      if (seenCloudKeys.has(cloudKey)) return;
      const rosterMatch = rosterByCloud.get(cloudKey);
      if (rosterMatch) return;
      const authHash = typeof prefs.authHash === 'string' ? prefs.authHash : '';
      const allowMeta = authHash ? verifyStudentHash(authHash) : null;
      const last4 = typeof prefs.last4 === 'string' && prefs.last4 ? prefs.last4 : cloudKey.slice(-4);
      const baseGroup = normalizeMbuGroupPref(allowMeta?.group || prefs.myMbuGroup || '');
      const baseProg: 'tr' | 'en' = allowMeta?.prog || (prefs.lang === 'en' ? 'en' : 'tr');

      results.push({
        authHash,
        cloudKey,
        last4,
        fullName: allowMeta ? `Dönem I Öğrencisi (Grup ${allowMeta.group})` : `Kayıtlı Öğrenci (${cloudKey.slice(0, 6)})`,
        group: baseGroup,
        prog: baseProg,
        myMbuGroup: normalizeMbuGroupPref(prefs.myMbuGroup),
        myLabGroup: baseProg === 'en' ? '' : normalizeLabGroupPref(prefs.myLabGroup),
        otherGroupMode: normalizeOtherGroupModePref(prefs.otherGroupMode),
        lang: normalizeLangPref(prefs.lang) || baseProg,
        source: allowMeta ? 'allowlist' : 'custom',
        active: true,
        updatedAtMs: tsToMillis(prefs.updatedAt),
      });
    });

    return results.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'custom' ? -1 : 1;
      return a.fullName.localeCompare(b.fullName, 'tr');
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admin_student_directory');
  }
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

  const prefsPayload: Record<string, unknown> = {
    myMbuGroup: mbu,
    myLabGroup: lab,
    otherGroupMode: mode,
    lang,
    updatedAt: serverTimestamp(),
  };
  if (authHash) prefsPayload.authHash = authHash;
  if (cleanLast4) prefsPayload.last4 = cleanLast4;

  try {
    if (!authHash) {
      await setDoc(doc(db, 'student_prefs', input.cloudKey), prefsPayload);
      return;
    }

    const secret = resolveAdminWriteSecret(adminSecret);
    if (isAdminStudentHash(authHash) && input.active === false) {
      throw new Error('CANNOT_DEACTIVATE_ADMIN');
    }
    const customRef = doc(db, 'custom_students', authHash);
    const dirRef = doc(db, 'admin_student_directory', authHash);
    const prefsRef = doc(db, 'student_prefs', input.cloudKey);

    const [customSnap, dirSnap, unlockedRoster] = await Promise.all([
      getDocPreferServer(customRef),
      getDocPreferServer(dirRef),
      resolveUnlockedRosterData(secret).catch(() => null),
    ]);
    const rosterEntry = unlockedRoster?.entries.find((e) => e.authHash === authHash);
    const effectiveSid = cleanSid || rosterEntry?.sid || '';
    const effectiveLast4 =
      (effectiveSid ? effectiveSid.slice(-4) : '') ||
      cleanLast4 ||
      (typeof customSnap.data()?.last4 === 'string' && /^[0-9]{4}$/.test(customSnap.data()?.last4)
        ? (customSnap.data()?.last4 as string)
        : '') ||
      (typeof dirSnap.data()?.last4 === 'string' && /^[0-9]{4}$/.test(dirSnap.data()?.last4)
        ? (dirSnap.data()?.last4 as string)
        : '') ||
      '0000';

    const assignedGroup = mbu
      ? normalizeAssignedGroup(mbu)
      : normalizeAssignedGroup((customSnap.data()?.group as string) || rosterEntry?.group || 'I');
    const isActive = isAdminStudentHash(authHash) ? true : input.active !== false;

    let encSid = '';
    if (effectiveSid && unlockedRoster) {
      encSid = await encryptAdminSid(unlockedRoster.aesKey, effectiveSid).catch(() => '');
    }

    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, `student/${authHash}`);

    batch.set(prefsRef, prefsPayload);

    const resolvedName = String(
      input.fullName ||
        (dirSnap.exists() ? readAdminDirFullName(authHash, dirSnap.data() as Record<string, unknown>) : '') ||
        rosterEntry?.fullName ||
        '',
    )
      .trim()
      .slice(0, 120);
    const resolvedEncName =
      effectiveSid && resolvedName ? encryptStudentName(effectiveSid, resolvedName) : '';

    if (customSnap.exists()) {
      const customUpdate: Record<string, unknown> = {
        group: assignedGroup,
        labGroup: lab,
        prog: lang,
        active: isActive,
        deleted: false,
        proofOpId: opId,
        updatedAt: serverTimestamp(),
      };
      if (encSid) customUpdate.encSid = encSid;
      if (resolvedEncName) customUpdate.encName = resolvedEncName;
      batch.update(customRef, customUpdate);
    } else {
      const customCreate: Record<string, unknown> = {
        group: assignedGroup,
        labGroup: lab,
        prog: lang,
        encName: resolvedEncName,
        last4: effectiveLast4,
        cloudKey: input.cloudKey,
        active: isActive,
        deleted: false,
        proofOpId: opId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (encSid) customCreate.encSid = encSid;
      batch.set(customRef, customCreate);
    }

    if (dirSnap.exists()) {
      const prevDir = dirSnap.data() || {};
      const cleanName = resolvedName || 'Öğrenci';
      const dirPayload: Record<string, unknown> = {
        authHash,
        cloudKey: input.cloudKey,
        last4: effectiveLast4,
        encFullName: encryptDirectoryName(authHash, cleanName),
        group: assignedGroup,
        labGroup: lab,
        prog: lang,
        source: prevDir.source === 'custom' ? 'custom' : 'allowlist',
        active: isActive,
        deleted: false,
        proofOpId: opId,
        createdAt: prevDir.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (encSid) dirPayload.encSid = encSid;
      else if (typeof prevDir.encSid === 'string' && prevDir.encSid) dirPayload.encSid = prevDir.encSid;
      batch.set(dirRef, dirPayload);
    } else if (resolvedName && effectiveLast4) {
      const dirPayload: Record<string, unknown> = {
        authHash,
        cloudKey: input.cloudKey,
        last4: effectiveLast4,
        encFullName: encryptDirectoryName(authHash, resolvedName),
        group: assignedGroup,
        labGroup: lab,
        prog: lang,
        source: input.source === 'custom' || !verifyStudentHash(authHash) ? 'custom' : 'allowlist',
        active: isActive,
        deleted: false,
        proofOpId: opId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (encSid) dirPayload.encSid = encSid;
      batch.set(dirRef, dirPayload);
    }

    await batch.commit();
  } catch (error) {
    if (error instanceof Error && error.message === 'CANNOT_DEACTIVATE_ADMIN') {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `student_prefs/${input.cloudKey}`);
  }
}
