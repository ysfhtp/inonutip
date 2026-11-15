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
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
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
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AdminStudentListItem {
  authHash: string;
  cloudKey: string;
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

let activeAdminWriteSecret = '';

export function setAdminWriteSecret(secret: string): void {
  const clean = typeof secret === 'string' ? secret.trim().toLowerCase() : '';
  activeAdminWriteSecret = ADMIN_SECRET_RE.test(clean) ? clean : '';
}

export function clearAdminWriteSecret(): void {
  activeAdminWriteSecret = '';
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

  try {
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, path);
    batch.set(doc(db, 'admin_config', 'security'), {
      passwordHash: digest,
      proofDigestB64,
      proofOpId: opId,
      updatedAt: serverTimestamp(),
    });
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

export async function lookupStudentWithCloud(rawSid: string): Promise<StudentAuthMatch | null> {
  const sid = normalizeStudentId(rawSid);
  if (!/^01\d{9}$/.test(sid)) return null;

  const allowlistMatch = verifyStudentId(sid);
  const authHash = hashStudentId(sid);

  try {
    const snap = await getDoc(doc(db, 'custom_students', authHash));
    if (snap.exists()) {
      const data = snap.data();
      if (data?.deleted === true) {
        return allowlistMatch;
      }
      if (data?.active === false) {
        return null;
      }
      const decryptedCustomName =
        typeof data?.encName === 'string' && data.encName
          ? decryptStudentName(sid, data.encName)
          : '';
      return {
        hash: authHash,
        last4: sid.slice(-4),
        group: normalizeAssignedGroup(data?.group || allowlistMatch?.group || 'I'),
        prog: data?.prog === 'en' ? 'en' : data?.prog === 'tr' ? 'tr' : allowlistMatch?.prog || 'tr',
        labGroup: normalizeLabGroupPref(data?.labGroup),
        name: decryptedCustomName || allowlistMatch?.name || '',
        source: 'custom',
        isAdmin: isAdminStudentId(sid),
      };
    }
  } catch {
    // Offline or non-existent custom record; fall back to built-in allowlist match
  }

  return allowlistMatch;
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
  },
  adminSecret?: string,
): Promise<CloudAnnouncement> {
  const secret = resolveAdminWriteSecret(adminSecret);
  const cleanTitle = String(input.title || '').trim().slice(0, 120);
  const cleanMessage = String(input.message || '').trim().slice(0, 800);
  const cleanTone = normalizeAnnouncementTone(input.tone);
  const isActive = Boolean(input.active);
  if (!cleanTitle || !cleanMessage) {
    throw new Error('Title and message are required.');
  }

  const rawId = typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.id.trim())
    ? input.id.trim()
    : `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const docRef = doc(db, 'announcements', rawId);
  const path = `announcements/${rawId}`;

  try {
    const existingSnap = await getDoc(docRef);
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, path);

    if (existingSnap.exists()) {
      batch.update(docRef, {
        title: cleanTitle,
        message: cleanMessage,
        tone: cleanTone,
        active: isActive,
        deleted: false,
        proofOpId: opId,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(docRef, {
        title: cleanTitle,
        message: cleanMessage,
        tone: cleanTone,
        active: isActive,
        deleted: false,
        proofOpId: opId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    const freshSnap = await getDoc(docRef);
    return mapAnnouncementDoc(rawId, (freshSnap.data() || {}) as Record<string, unknown>);
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
  const labGroup = normalizeLabGroupPref(input.labGroup);
  const prog: 'tr' | 'en' = input.prog === 'en' ? 'en' : 'tr';
  const otherGroupMode = normalizeOtherGroupModePref(input.otherGroupMode);
  const active = input.active !== false;

  const authHash = hashStudentId(sid);
  const cloudKey = await deriveCloudDocId(sid);
  const last4 = sid.slice(-4);
  const encName = encryptStudentName(sid, cleanName);
  const encFullName = encryptDirectoryName(authHash, cleanName);
  const source: 'allowlist' | 'custom' = verifyStudentHash(authHash) ? 'allowlist' : 'custom';

  const customRef = doc(db, 'custom_students', authHash);
  const dirRef = doc(db, 'admin_student_directory', authHash);
  const prefsRef = doc(db, 'student_prefs', cloudKey);

  try {
    const [existingCustom, existingDir] = await Promise.all([getDoc(customRef), getDoc(dirRef)]);
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, `student/${authHash}`);

    if (existingCustom.exists()) {
      batch.update(customRef, {
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
      });
    } else {
      batch.set(customRef, {
        group,
        labGroup,
        prog,
        encName,
        last4,
        cloudKey,
        active,
        deleted: false,
        proofOpId: opId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(dirRef, {
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
    });

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
    handleFirestoreError(error, OperationType.WRITE, `custom_students/${authHash}`);
  }
}

export async function deleteCustomStudent(
  authHash: string,
  cloudKey?: string,
  adminSecret?: string,
): Promise<void> {
  if (!isValidAuthHash(authHash)) return;
  const secret = resolveAdminWriteSecret(adminSecret);
  const customRef = doc(db, 'custom_students', authHash);
  const dirRef = doc(db, 'admin_student_directory', authHash);

  try {
    const [existingCustom, existingDir] = await Promise.all([getDoc(customRef), getDoc(dirRef)]);
    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, `student/${authHash}`);

    if (existingCustom.exists()) {
      batch.update(customRef, {
        active: false,
        deleted: true,
        proofOpId: opId,
        updatedAt: serverTimestamp(),
      });
    }
    if (existingDir.exists()) {
      const dirData = (existingDir.data() || {}) as Record<string, unknown>;
      const fallbackName =
        typeof dirData.fullName === 'string' && dirData.fullName
          ? dirData.fullName
          : `Öğrenci •••${typeof dirData.last4 === 'string' ? dirData.last4 : '0000'}`;
      const encFullName =
        typeof dirData.encFullName === 'string' && dirData.encFullName
          ? dirData.encFullName
          : encryptDirectoryName(authHash, fallbackName);
      batch.set(dirRef, {
        authHash,
        cloudKey: (typeof dirData.cloudKey === 'string' && dirData.cloudKey) || (cloudKey || ''),
        last4: typeof dirData.last4 === 'string' && /^[0-9]{4}$/.test(dirData.last4) ? dirData.last4 : '0000',
        encFullName,
        group: normalizeAssignedGroup(dirData.group),
        labGroup: normalizeLabGroupPref(dirData.labGroup),
        prog: dirData.prog === 'en' ? 'en' : 'tr',
        source: dirData.source === 'custom' ? 'custom' : 'allowlist',
        active: false,
        deleted: true,
        proofOpId: opId,
        createdAt: dirData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
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
      getDoc(doc(db, 'admin_student_directory', authHash)).catch(() => null),
      getDoc(doc(db, 'custom_students', authHash)).catch(() => null),
      getDoc(doc(db, 'student_prefs', cloudKey)).catch(() => null),
    ]);
    if (dirSnap && dirSnap.exists() && dirSnap.data()?.deleted !== true) {
      dirData = dirSnap.data() as Record<string, unknown>;
    }
    if (customSnap && customSnap.exists() && customSnap.data()?.deleted !== true) {
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
    last4,
    fullName,
    group: baseGroup,
    prog: baseProg,
    myMbuGroup: prefsData ? normalizeMbuGroupPref(prefsData.myMbuGroup) : baseGroup,
    myLabGroup: prefsData ? normalizeLabGroupPref(prefsData.myLabGroup) : normalizeLabGroupPref(customData?.labGroup),
    otherGroupMode: prefsData ? normalizeOtherGroupModePref(prefsData.otherGroupMode) : 'dim',
    lang: prefsData ? (normalizeLangPref(prefsData.lang) || baseProg) : baseProg,
    source: allowMatch ? 'allowlist' : 'custom',
    active: customData ? customData.active !== false : true,
    updatedAtMs: Math.max(tsToMillis(prefsData?.updatedAt), tsToMillis(dirData?.updatedAt), tsToMillis(customData?.updatedAt)),
  };
}

export async function loadAllAdminStudents(): Promise<AdminStudentListItem[]> {
  try {
    const [dirSnap, customSnap, prefsSnap] = await Promise.all([
      getDocs(query(collection(db, 'admin_student_directory'), limit(1000))),
      getDocs(query(collection(db, 'custom_students'), limit(1000))),
      getDocs(query(collection(db, 'student_prefs'), limit(1000))),
    ]);

    const dirByHash = new Map<string, Record<string, unknown>>();
    dirSnap.forEach((d) => dirByHash.set(d.id, d.data() as Record<string, unknown>));

    const customByHash = new Map<string, Record<string, unknown>>();
    customSnap.forEach((d) => customByHash.set(d.id, d.data() as Record<string, unknown>));

    const prefsByCloud = new Map<string, Record<string, unknown>>();
    prefsSnap.forEach((d) => prefsByCloud.set(d.id, d.data() as Record<string, unknown>));

    const seenCloudKeys = new Set<string>();
    const results: AdminStudentListItem[] = [];

    const allHashes = new Set<string>([...dirByHash.keys(), ...customByHash.keys()]);
    allHashes.forEach((authHash) => {
      const dir = dirByHash.get(authHash);
      const custom = customByHash.get(authHash);
      const cloudKey =
        (typeof dir?.cloudKey === 'string' && dir.cloudKey) ||
        (typeof custom?.cloudKey === 'string' && custom.cloudKey) ||
        '';
      if (cloudKey) seenCloudKeys.add(cloudKey);

      if (dir?.deleted === true || custom?.deleted === true) {
        return;
      }

      const allowMeta = verifyStudentHash(authHash);
      const prefs = cloudKey ? prefsByCloud.get(cloudKey) : undefined;

      const last4 =
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

      results.push({
        authHash,
        cloudKey,
        last4,
        fullName:
          readAdminDirFullName(authHash, dir) ||
          (allowMeta ? `Dönem I •••••••${last4}` : `Özel Öğrenci ••••${last4}`),
        group: baseGroup,
        prog: baseProg,
        myMbuGroup: prefs ? normalizeMbuGroupPref(prefs.myMbuGroup) : baseGroup,
        myLabGroup: prefs ? normalizeLabGroupPref(prefs.myLabGroup) : normalizeLabGroupPref(custom?.labGroup ?? dir?.labGroup),
        otherGroupMode: prefs ? normalizeOtherGroupModePref(prefs.otherGroupMode) : 'dim',
        lang: prefs ? (normalizeLangPref(prefs.lang) || baseProg) : baseProg,
        source: allowMeta ? 'allowlist' : 'custom',
        active: custom ? custom.active !== false : dir ? dir.active !== false : true,
        updatedAtMs: Math.max(tsToMillis(prefs?.updatedAt), tsToMillis(dir?.updatedAt), tsToMillis(custom?.updatedAt)),
      });
    });

    prefsByCloud.forEach((prefs, cloudKey) => {
      if (seenCloudKeys.has(cloudKey)) return;
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
        myLabGroup: normalizeLabGroupPref(prefs.myLabGroup),
        otherGroupMode: normalizeOtherGroupModePref(prefs.otherGroupMode),
        lang: normalizeLangPref(prefs.lang) || baseProg,
        source: allowMeta ? 'allowlist' : 'custom',
        active: true,
        updatedAtMs: tsToMillis(prefs.updatedAt),
      });
    });

    return results.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admin_student_directory');
  }
}

export async function adminSaveStudentSettings(
  input: {
    cloudKey: string;
    authHash?: string;
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
  const lab = normalizeLabGroupPref(input.myLabGroup);
  const mode = normalizeOtherGroupModePref(input.otherGroupMode);
  const lang: 'tr' | 'en' = input.lang === 'en' ? 'en' : 'tr';
  const authHash = input.authHash && isValidAuthHash(input.authHash) ? input.authHash : '';
  const cleanLast4 =
    typeof input.last4 === 'string' && /^[0-9]{4}$/.test(input.last4.trim())
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
    const customRef = doc(db, 'custom_students', authHash);
    const dirRef = doc(db, 'admin_student_directory', authHash);
    const prefsRef = doc(db, 'student_prefs', input.cloudKey);

    const [customSnap, dirSnap] = await Promise.all([getDoc(customRef), getDoc(dirRef)]);
    const assignedGroup = mbu ? normalizeAssignedGroup(mbu) : normalizeAssignedGroup((customSnap.data()?.group as string) || 'I');
    const isActive = input.active !== false;

    const batch = writeBatch(db);
    const opId = appendAdminProofToBatch(batch, secret, `student/${authHash}`);

    batch.set(prefsRef, prefsPayload);

    if (customSnap.exists()) {
      batch.update(customRef, {
        group: assignedGroup,
        labGroup: lab,
        prog: lang,
        active: isActive,
        deleted: false,
        proofOpId: opId,
        updatedAt: serverTimestamp(),
      });
    }

    if (dirSnap.exists()) {
      const prevDir = dirSnap.data() || {};
      const cleanName = String(
        input.fullName || readAdminDirFullName(authHash, prevDir as Record<string, unknown>) || 'Öğrenci',
      ).trim().slice(0, 120);
      batch.set(dirRef, {
        authHash,
        cloudKey: input.cloudKey,
        last4: cleanLast4 || (typeof prevDir.last4 === 'string' ? prevDir.last4 : '0000'),
        encFullName: encryptDirectoryName(authHash, cleanName || 'Öğrenci'),
        group: assignedGroup,
        labGroup: lab,
        prog: lang,
        source: prevDir.source === 'custom' ? 'custom' : 'allowlist',
        active: isActive,
        deleted: false,
        proofOpId: opId,
        createdAt: prevDir.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (input.fullName && cleanLast4) {
      const cleanName = String(input.fullName).trim().slice(0, 120);
      if (cleanName) {
        batch.set(dirRef, {
          authHash,
          cloudKey: input.cloudKey,
          last4: cleanLast4,
          encFullName: encryptDirectoryName(authHash, cleanName),
          group: assignedGroup,
          labGroup: lab,
          prog: lang,
          source: input.source === 'custom' ? 'custom' : 'allowlist',
          active: isActive,
          deleted: false,
          proofOpId: opId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `student_prefs/${input.cloudKey}`);
  }
}
