import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  DEFAULT_ADMIN_PASSWORD_HASH,
  decryptStudentName,
  deriveCloudDocId,
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

export const ADMIN_AUTHORIZED_EMAIL = 'ysfhtp6@gmail.com';

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

export interface AdminFirebaseAuthStatus {
  signedIn: boolean;
  email: string;
  emailVerified: boolean;
  isAuthorizedAdmin: boolean;
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

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence).catch(() => {});

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

function buildFirebaseAuthStatus(user: User | null): AdminFirebaseAuthStatus {
  const email = user?.email ? String(user.email).trim() : '';
  const emailVerified = Boolean(user?.emailVerified);
  return {
    signedIn: Boolean(user),
    email,
    emailVerified,
    isAuthorizedAdmin: Boolean(user && emailVerified && email.toLowerCase() === ADMIN_AUTHORIZED_EMAIL),
  };
}

export function getFirebaseAdminStatus(): AdminFirebaseAuthStatus {
  return buildFirebaseAuthStatus(auth.currentUser);
}

export function subscribeAdminAuthState(callback: (status: AdminFirebaseAuthStatus) => void): () => void {
  return onAuthStateChanged(auth, (user) => {
    callback(buildFirebaseAuthStatus(user));
  });
}

export interface AdminGoogleSignInResult {
  ok: boolean;
  email: string;
  isAuthorizedAdmin: boolean;
  redirecting?: boolean;
  errorCode?: string;
  error?: string;
  hostname?: string;
}

const PENDING_ADMIN_REDIRECT_KEY = 'inonu_pending_admin_redirect';

function isRunningInIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

function isRunningStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.matchMedia?.('(display-mode: fullscreen)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
  } catch {
    return false;
  }
}

function extractFirebaseErrorInfo(error: unknown): { code: string; message: string } {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return { code, message };
}

function buildAdminGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    login_hint: ADMIN_AUTHORIZED_EMAIL,
    prompt: 'select_account',
  });
  return provider;
}

let cachedRedirectCheck: {
  hadPendingRedirect: boolean;
  ok: boolean;
  email: string;
  isAuthorizedAdmin: boolean;
  errorCode?: string;
  error?: string;
  hostname?: string;
} | null = null;

const redirectInitPromise = (async () => {
  const hadPending = (() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(PENDING_ADMIN_REDIRECT_KEY) === '1';
    } catch {
      return false;
    }
  })();

  try {
    const res = await getRedirectResult(auth);
    if (res?.user) {
      try {
        window.localStorage.removeItem(PENDING_ADMIN_REDIRECT_KEY);
      } catch {}
      const status = buildFirebaseAuthStatus(res.user);
      cachedRedirectCheck = {
        hadPendingRedirect: true,
        ok: status.isAuthorizedAdmin,
        email: status.email,
        isAuthorizedAdmin: status.isAuthorizedAdmin,
        errorCode: status.isAuthorizedAdmin ? '' : 'unauthorized_email',
      };
      return cachedRedirectCheck;
    }
  } catch (error) {
    try {
      window.localStorage.removeItem(PENDING_ADMIN_REDIRECT_KEY);
    } catch {}
    const { code, message } = extractFirebaseErrorInfo(error);
    cachedRedirectCheck = {
      hadPendingRedirect: true,
      ok: false,
      email: auth.currentUser?.email ?? '',
      isAuthorizedAdmin: false,
      errorCode: code,
      error: message,
      hostname: typeof window !== 'undefined' ? window.location.hostname : '',
    };
    return cachedRedirectCheck;
  }

  if (hadPending) {
    try {
      window.localStorage.removeItem(PENDING_ADMIN_REDIRECT_KEY);
    } catch {}
    const status = buildFirebaseAuthStatus(auth.currentUser);
    cachedRedirectCheck = {
      hadPendingRedirect: true,
      ok: status.isAuthorizedAdmin,
      email: status.email,
      isAuthorizedAdmin: status.isAuthorizedAdmin,
      errorCode: status.signedIn && !status.isAuthorizedAdmin ? 'unauthorized_email' : '',
    };
    return cachedRedirectCheck;
  }

  cachedRedirectCheck = {
    hadPendingRedirect: false,
    ok: false,
    email: '',
    isAuthorizedAdmin: false,
  };
  return cachedRedirectCheck;
})();

export async function consumeAdminRedirectResult() {
  const res = await redirectInitPromise;
  const out = cachedRedirectCheck || res;
  cachedRedirectCheck = {
    hadPendingRedirect: false,
    ok: false,
    email: '',
    isAuthorizedAdmin: false,
  };
  return out;
}

export async function signInAdminWithGoogle(
  mode: 'auto' | 'popup' | 'redirect' = 'auto',
): Promise<AdminGoogleSignInResult> {
  const provider = buildAdminGoogleProvider();
  const inIframe = isRunningInIframe();
  const standalonePwa = isRunningStandalonePWA();
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

  const startRedirect = async (): Promise<AdminGoogleSignInResult> => {
    try {
      window.localStorage.setItem(PENDING_ADMIN_REDIRECT_KEY, '1');
    } catch {}
    await signInWithRedirect(auth, provider);
    return {
      ok: false,
      email: '',
      isAuthorizedAdmin: false,
      redirecting: true,
      hostname,
    };
  };

  if (mode === 'redirect' || (mode === 'auto' && standalonePwa && !inIframe)) {
    if (inIframe) {
      return {
        ok: false,
        email: auth.currentUser?.email ?? '',
        isAuthorizedAdmin: false,
        errorCode: 'iframe_redirect_blocked',
        error: 'Redirect sign-in is blocked inside an embedded frame.',
        hostname,
      };
    }
    try {
      return await startRedirect();
    } catch (error) {
      try {
        window.localStorage.removeItem(PENDING_ADMIN_REDIRECT_KEY);
      } catch {}
      const { code, message } = extractFirebaseErrorInfo(error);
      return {
        ok: false,
        email: auth.currentUser?.email ?? '',
        isAuthorizedAdmin: false,
        errorCode: code,
        error: message,
        hostname,
      };
    }
  }

  try {
    const cred = await signInWithPopup(auth, provider);
    try {
      window.localStorage.removeItem(PENDING_ADMIN_REDIRECT_KEY);
    } catch {}
    const status = buildFirebaseAuthStatus(cred.user);
    return {
      ok: status.isAuthorizedAdmin,
      email: status.email,
      isAuthorizedAdmin: status.isAuthorizedAdmin,
      errorCode: status.isAuthorizedAdmin ? '' : 'unauthorized_email',
      hostname,
    };
  } catch (error) {
    const { code, message } = extractFirebaseErrorInfo(error);
    const shouldFallbackRedirect =
      !inIframe &&
      mode === 'auto' &&
      (code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/cancelled-popup-request');

    if (shouldFallbackRedirect) {
      try {
        return await startRedirect();
      } catch (redirError) {
        try {
          window.localStorage.removeItem(PENDING_ADMIN_REDIRECT_KEY);
        } catch {}
        const rInfo = extractFirebaseErrorInfo(redirError);
        return {
          ok: false,
          email: auth.currentUser?.email ?? '',
          isAuthorizedAdmin: false,
          errorCode: rInfo.code || code,
          error: rInfo.message || message,
          hostname,
        };
      }
    }

    return {
      ok: false,
      email: auth.currentUser?.email ?? '',
      isAuthorizedAdmin: false,
      errorCode: code,
      error: message,
      hostname,
    };
  }
}

export async function signOutFirebaseAdmin(): Promise<void> {
  try {
    window.localStorage.removeItem(PENDING_ADMIN_REDIRECT_KEY);
  } catch {}
  await signOut(auth);
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

export async function updateAdminPassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const cleanPwd = String(newPassword || '').trim();
  if (cleanPwd.length < 4 || cleanPwd.length > 64) {
    return { ok: false, error: 'invalid_length' };
  }
  const digest = await hashAdminPassword(cleanPwd);
  const path = 'admin_config/security';
  try {
    await setDoc(doc(db, 'admin_config', 'security'), {
      passwordHash: digest,
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
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
  const path = `custom_students/${authHash}`;

  try {
    const snap = await getDoc(doc(db, 'custom_students', authHash));
    if (snap.exists()) {
      const data = snap.data();
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
    const q = query(collection(db, 'announcements'), where('active', '==', true));
    const snap = await getDocs(q);
    return snap.docs
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
    const snap = await getDocs(collection(db, 'announcements'));
    return snap.docs
      .map((d) => mapAnnouncementDoc(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveAnnouncement(input: {
  id?: string;
  title: string;
  message: string;
  tone: AnnouncementTone;
  active: boolean;
}): Promise<CloudAnnouncement> {
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
    if (existingSnap.exists()) {
      await updateDoc(docRef, {
        title: cleanTitle,
        message: cleanMessage,
        tone: cleanTone,
        active: isActive,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        title: cleanTitle,
        message: cleanMessage,
        tone: cleanTone,
        active: isActive,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    const freshSnap = await getDoc(docRef);
    return mapAnnouncementDoc(rawId, (freshSnap.data() || {}) as Record<string, unknown>);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const cleanId = String(id || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return;
  const path = `announcements/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'announcements', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==================== ADMIN STUDENT MANAGEMENT ====================

export async function addOrUpdateCustomStudent(input: {
  studentId: string;
  fullName: string;
  group: 'I' | 'II' | 'III' | 'IV' | 'V';
  labGroup?: '' | '1' | '2';
  prog: 'tr' | 'en';
  otherGroupMode?: 'dim' | 'hide';
  active?: boolean;
}): Promise<AdminStudentListItem> {
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
  const source: 'allowlist' | 'custom' = verifyStudentHash(authHash) ? 'allowlist' : 'custom';

  const customRef = doc(db, 'custom_students', authHash);
  const dirRef = doc(db, 'admin_student_directory', authHash);
  const prefsRef = doc(db, 'student_prefs', cloudKey);

  try {
    const existingCustom = await getDoc(customRef);
    if (existingCustom.exists()) {
      await updateDoc(customRef, {
        group,
        labGroup,
        prog,
        encName,
        last4,
        cloudKey,
        active,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(customRef, {
        group,
        labGroup,
        prog,
        encName,
        last4,
        cloudKey,
        active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const existingDir = await getDoc(dirRef);
    if (existingDir.exists()) {
      await updateDoc(dirRef, {
        cloudKey,
        last4,
        fullName: cleanName,
        group,
        labGroup,
        prog,
        source,
        active,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(dirRef, {
        authHash,
        cloudKey,
        last4,
        fullName: cleanName,
        group,
        labGroup,
        prog,
        source,
        active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await setDoc(prefsRef, {
      myMbuGroup: group,
      myLabGroup: labGroup,
      otherGroupMode,
      lang: prog,
      authHash,
      last4,
      updatedAt: serverTimestamp(),
    });

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

export async function deleteCustomStudent(authHash: string, cloudKey?: string): Promise<void> {
  if (!isValidAuthHash(authHash)) return;
  try {
    await deleteDoc(doc(db, 'custom_students', authHash));
    await deleteDoc(doc(db, 'admin_student_directory', authHash));
    if (cloudKey && isValidCloudDocId(cloudKey)) {
      await deleteDoc(doc(db, 'student_prefs', cloudKey));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `custom_students/${authHash}`);
  }
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
    if (dirSnap && dirSnap.exists()) dirData = dirSnap.data() as Record<string, unknown>;
    if (customSnap && customSnap.exists()) customData = customSnap.data() as Record<string, unknown>;
    if (prefsSnap && prefsSnap.exists()) prefsData = prefsSnap.data() as Record<string, unknown>;
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
    (dirData && typeof dirData.fullName === 'string' && dirData.fullName) ||
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
      getDocs(collection(db, 'admin_student_directory')),
      getDocs(collection(db, 'custom_students')),
      getDocs(collection(db, 'student_prefs')),
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
      const allowMeta = verifyStudentHash(authHash);
      const cloudKey =
        (typeof dir?.cloudKey === 'string' && dir.cloudKey) ||
        (typeof custom?.cloudKey === 'string' && custom.cloudKey) ||
        '';
      if (cloudKey) seenCloudKeys.add(cloudKey);
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
          (typeof dir?.fullName === 'string' && dir.fullName) ||
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

export async function adminSaveStudentSettings(input: {
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
}): Promise<void> {
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
    await setDoc(doc(db, 'student_prefs', input.cloudKey), prefsPayload);

    if (authHash) {
      const customRef = doc(db, 'custom_students', authHash);
      const dirRef = doc(db, 'admin_student_directory', authHash);
      const [customSnap, dirSnap] = await Promise.all([getDoc(customRef), getDoc(dirRef)]);
      const assignedGroup = mbu ? normalizeAssignedGroup(mbu) : normalizeAssignedGroup((customSnap.data()?.group as string) || 'I');
      const isActive = input.active !== false;

      if (customSnap.exists()) {
        await updateDoc(customRef, {
          group: assignedGroup,
          labGroup: lab,
          prog: lang,
          active: isActive,
          updatedAt: serverTimestamp(),
        });
      }

      if (dirSnap.exists()) {
        const cleanName = String(input.fullName || dirSnap.data()?.fullName || '').trim().slice(0, 120);
        await updateDoc(dirRef, {
          fullName: cleanName || 'Öğrenci',
          group: assignedGroup,
          labGroup: lab,
          prog: lang,
          active: isActive,
          updatedAt: serverTimestamp(),
        });
      } else if (input.fullName && cleanLast4) {
        const cleanName = String(input.fullName).trim().slice(0, 120);
        if (cleanName) {
          await setDoc(dirRef, {
            authHash,
            cloudKey: input.cloudKey,
            last4: cleanLast4,
            fullName: cleanName,
            group: assignedGroup,
            labGroup: lab,
            prog: lang,
            source: input.source === 'custom' ? 'custom' : 'allowlist',
            active: isActive,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `student_prefs/${input.cloudKey}`);
  }
}
