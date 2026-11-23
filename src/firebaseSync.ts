import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  getDocFromServer,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

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

let firebaseQuotaExceeded = false;
const quotaListeners = new Set<(exceeded: boolean) => void>();

export function isFirestoreQuotaError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code = ((error as { code?: string })?.code || '').toLowerCase();
  return (
    code === 'resource-exhausted' ||
    msg.includes('quota') ||
    msg.includes('resource-exhausted') ||
    msg.includes('free daily read units')
  );
}

export function isFirestoreUnavailableError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code = ((error as { code?: string })?.code || '').toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'failed-precondition' ||
    msg.includes('the client is offline') ||
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore') ||
    msg.includes('code=unavailable')
  );
}

export function isFirebaseQuotaExceeded(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('inonu_firebase_quota_exceeded');
      if (cached === 'true') {
        const atStr = localStorage.getItem('inonu_firebase_quota_exceeded_at');
        const atMs = Number(atStr) || 0;
        if (atMs > 0 && Date.now() - atMs > 6 * 60 * 60 * 1000) {
          localStorage.removeItem('inonu_firebase_quota_exceeded');
          localStorage.removeItem('inonu_firebase_quota_exceeded_at');
          firebaseQuotaExceeded = false;
          return false;
        }
        return true;
      }
    }
  } catch {}
  return firebaseQuotaExceeded;
}

export function setFirebaseQuotaExceeded(exceeded: boolean): void {
  firebaseQuotaExceeded = exceeded;
  try {
    if (typeof localStorage !== 'undefined') {
      if (exceeded) {
        localStorage.setItem('inonu_firebase_quota_exceeded', 'true');
        localStorage.setItem('inonu_firebase_quota_exceeded_at', String(Date.now()));
      } else {
        localStorage.removeItem('inonu_firebase_quota_exceeded');
        localStorage.removeItem('inonu_firebase_quota_exceeded_at');
      }
    }
  } catch {}
  quotaListeners.forEach((fn) => {
    try { fn(exceeded); } catch {}
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inonu-firebase-quota-changed', { detail: { exceeded } }));
  }
}

export function onFirebaseQuotaChange(callback: (exceeded: boolean) => void): () => void {
  quotaListeners.add(callback);
  callback(isFirebaseQuotaExceeded());
  return () => quotaListeners.delete(callback);
}

let dbInstance: ReturnType<typeof getFirestore> | null = null;
try {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  const rawDbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
  try {
    dbInstance = rawDbId
      ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, rawDbId)
      : initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    dbInstance = rawDbId ? getFirestore(app, rawDbId) : getFirestore(app);
  }
} catch (err) {
  console.warn('Firebase Firestore initialization failed, falling back to static/server sync:', err);
  setFirebaseQuotaExceeded(true);
}
export const db = dbInstance;

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorInfo {
  const errMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: [],
    },
    operationType,
    path,
  };
  if (isFirestoreUnavailableError(error)) {
    console.warn(`Firestore offline/unavailable (${operationType} ${path || ''}); using cache/server fallback.`);
    return errInfo;
  }
  console.warn('Firestore Operation Error: ', JSON.stringify(errInfo));
  if (isFirestoreQuotaError(error)) {
    setFirebaseQuotaExceeded(true);
  }
  return errInfo;
}

export async function testConnection(): Promise<boolean> {
  if (!db) {
    setFirebaseQuotaExceeded(true);
    return false;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    if (isFirebaseQuotaExceeded()) {
      setFirebaseQuotaExceeded(false);
    }
    return true;
  } catch (error) {
    if (isFirestoreUnavailableError(error)) {
      return false;
    }
    if (isFirestoreQuotaError(error)) {
      setFirebaseQuotaExceeded(true);
      return false;
    }
    if (isFirebaseQuotaExceeded()) {
      setFirebaseQuotaExceeded(false);
    }
    return true;
  }
}

void testConnection();
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void testConnection();
  });
}

// ==================== FIREBASE REALTIME LISTENERS & MUTATIONS ====================

export function subscribeFirebaseSiteAccess(
  onChange: (settings: { requireStudentLogin: boolean; updatedAtMs: number }) => void,
): Unsubscribe {
  if (!db || isFirebaseQuotaExceeded()) return () => {};
  const path = 'config/access';
  try {
    return onSnapshot(
      doc(db, 'config', 'access'),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as { requireStudentLogin?: boolean; updatedAtMs?: number };
        onChange({
          requireStudentLogin: Boolean(data.requireStudentLogin),
          updatedAtMs: Number(data.updatedAtMs) || 0,
        });
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, path);
      },
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return () => {};
  }
}

export async function saveFirebaseSiteAccess(
  requireStudentLogin: boolean,
  updatedAtMs: number,
): Promise<boolean> {
  if (!db || isFirebaseQuotaExceeded()) return false;
  const path = 'config/access';
  try {
    await setDoc(doc(db, 'config', 'access'), {
      requireStudentLogin: Boolean(requireStudentLogin),
      updatedAtMs: Number(updatedAtMs) || Date.now(),
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

export function subscribeFirebaseAnnouncements(
  onChange: (announcements: Array<Record<string, unknown>>) => void,
): Unsubscribe {
  if (!db || isFirebaseQuotaExceeded()) return () => {};
  const path = 'announcements';
  try {
    return onSnapshot(
      collection(db, 'announcements'),
      (snap) => {
        const list: Array<Record<string, unknown>> = [];
        snap.forEach((d) => {
          const item = d.data() as Record<string, unknown>;
          if (item && !item.deleted && item.deleted !== 1) {
            list.push({ ...item, id: d.id });
          }
        });
        onChange(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      },
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return () => {};
  }
}

export async function saveFirebaseAnnouncement(
  ann: Record<string, unknown>,
): Promise<boolean> {
  if (!db || isFirebaseQuotaExceeded() || !ann.id) return false;
  const id = String(ann.id);
  const path = `announcements/${id}`;
  try {
    await setDoc(doc(db, 'announcements', id), {
      ...ann,
      updatedAtMs: Date.now(),
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

export async function fetchFirebaseAnnouncements(): Promise<Array<Record<string, unknown>> | null> {
  if (!db || isFirebaseQuotaExceeded()) return null;
  const path = 'announcements';
  try {
    const snap = await getDocs(collection(db, 'announcements'));
    const list: Array<Record<string, unknown>> = [];
    snap.forEach((d) => {
      const item = d.data() as Record<string, unknown>;
      if (item && !item.deleted && item.deleted !== 1) {
        list.push({ ...item, id: d.id });
      }
    });
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return null;
  }
}

export async function deleteFirebaseAnnouncement(
  id: string,
): Promise<boolean> {
  if (!db || isFirebaseQuotaExceeded() || !id) return false;
  const cleanId = String(id).trim();
  const path = `announcements/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'announcements', cleanId));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
    return false;
  }
}

export interface FirebaseCancelledLessonDoc {
  id: string;
  date: string;
  slotNo: number;
  targetProg: 'tr' | 'en';
  reason: string;
  updatedAtMs: number;
}

export function subscribeFirebaseCancelledLessons(
  onChange: (items: FirebaseCancelledLessonDoc[]) => void,
): Unsubscribe {
  if (!db || isFirebaseQuotaExceeded()) return () => {};
  const path = 'cancelledLessons';
  try {
    return onSnapshot(
      collection(db, 'cancelledLessons'),
      (snap) => {
        const list: FirebaseCancelledLessonDoc[] = [];
        snap.forEach((d) => {
          const item = d.data() as Record<string, unknown>;
          if (!item) return;
          const prog = item.targetProg === 'en' ? 'en' : item.targetProg === 'tr' ? 'tr' : null;
          const date = typeof item.date === 'string' ? item.date.trim() : '';
          const slotNo = Math.floor(Number(item.slotNo) || 0);
          if (!prog || !date || slotNo < 1 || slotNo > 20) return;
          list.push({
            id: d.id,
            date,
            slotNo,
            targetProg: prog,
            reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 200) : '',
            updatedAtMs: Number(item.updatedAtMs) || 0,
          });
        });
        onChange(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      },
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return () => {};
  }
}

export async function fetchFirebaseCancelledLessons(): Promise<FirebaseCancelledLessonDoc[] | null> {
  if (!db || isFirebaseQuotaExceeded()) return null;
  const path = 'cancelledLessons';
  try {
    const snap = await getDocs(collection(db, 'cancelledLessons'));
    const list: FirebaseCancelledLessonDoc[] = [];
    snap.forEach((d) => {
      const item = d.data() as Record<string, unknown>;
      if (!item) return;
      const prog = item.targetProg === 'en' ? 'en' : item.targetProg === 'tr' ? 'tr' : null;
      const date = typeof item.date === 'string' ? item.date.trim() : '';
      const slotNo = Math.floor(Number(item.slotNo) || 0);
      if (!prog || !date || slotNo < 1 || slotNo > 20) return;
      list.push({
        id: d.id,
        date,
        slotNo,
        targetProg: prog,
        reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 200) : '',
        updatedAtMs: Number(item.updatedAtMs) || 0,
      });
    });
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return null;
  }
}

export async function saveFirebaseCancelledLesson(
  item: FirebaseCancelledLessonDoc,
): Promise<boolean> {
  const cleanId = String(item.id || '').trim();
  if (!db || isFirebaseQuotaExceeded() || !/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return false;
  const path = `cancelledLessons/${cleanId}`;
  const payload: FirebaseCancelledLessonDoc = {
    id: cleanId,
    date: String(item.date || '').trim().slice(0, 20),
    slotNo: Math.max(1, Math.min(20, Math.floor(Number(item.slotNo) || 1))),
    targetProg: item.targetProg === 'en' ? 'en' : 'tr',
    reason: String(item.reason || '').trim().slice(0, 200),
    updatedAtMs: Math.max(1, Math.floor(Number(item.updatedAtMs) || Date.now())),
  };
  try {
    await setDoc(doc(db, 'cancelledLessons', cleanId), payload);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

export async function deleteFirebaseCancelledLesson(id: string): Promise<boolean> {
  const cleanId = String(id || '').trim();
  if (!db || isFirebaseQuotaExceeded() || !/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return false;
  const path = `cancelledLessons/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'cancelledLessons', cleanId));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
    return false;
  }
}

export function subscribeFirebaseStudentDirectory(
  onChange: (data: { customStudents?: Record<string, unknown>; studentDirectory?: Record<string, unknown> }) => void,
): Unsubscribe {
  if (!db || isFirebaseQuotaExceeded()) return () => {};
  const path = 'directory/students';
  try {
    return onSnapshot(
      doc(db, 'directory', 'students'),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as {
          payload?: string;
          customStudents?: Record<string, unknown>;
          studentDirectory?: Record<string, unknown>;
        };
        let customStudents = d.customStudents;
        let studentDirectory = d.studentDirectory;
        if (typeof d.payload === 'string') {
          try {
            const parsed = JSON.parse(d.payload) as {
              customStudents?: Record<string, unknown>;
              studentDirectory?: Record<string, unknown>;
            };
            if (parsed.customStudents) customStudents = parsed.customStudents;
            if (parsed.studentDirectory) studentDirectory = parsed.studentDirectory;
          } catch {}
        }
        if (customStudents || studentDirectory) {
          onChange({ customStudents, studentDirectory });
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, path);
      },
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return () => {};
  }
}

export async function fetchFirebaseStudentDirectory(): Promise<{
  customStudents?: Record<string, unknown>;
  studentDirectory?: Record<string, unknown>;
  updatedAtMs?: number;
} | null> {
  if (!db || isFirebaseQuotaExceeded()) return null;
  const path = 'directory/students';
  try {
    const snap = await getDoc(doc(db, 'directory', 'students'));
    if (!snap.exists()) return null;
    const d = snap.data() as {
      payload?: string;
      customStudents?: Record<string, unknown>;
      studentDirectory?: Record<string, unknown>;
      updatedAtMs?: number;
    };
    let customStudents = d.customStudents;
    let studentDirectory = d.studentDirectory;
    if (typeof d.payload === 'string') {
      try {
        const parsed = JSON.parse(d.payload) as {
          customStudents?: Record<string, unknown>;
          studentDirectory?: Record<string, unknown>;
        };
        if (parsed.customStudents) customStudents = parsed.customStudents;
        if (parsed.studentDirectory) studentDirectory = parsed.studentDirectory;
      } catch {}
    }
    return {
      customStudents,
      studentDirectory,
      updatedAtMs: d.updatedAtMs || 0,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return null;
  }
}

export async function saveFirebaseStudentDirectory(
  customStudents: Record<string, unknown>,
  studentDirectory: Record<string, unknown>,
): Promise<boolean> {
  if (!db || isFirebaseQuotaExceeded()) return false;
  const path = 'directory/students';
  try {
    const payload = JSON.stringify({ customStudents, studentDirectory });
    await setDoc(doc(db, 'directory', 'students'), {
      updatedAtMs: Date.now(),
      payload,
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

export interface FirebaseStudentPrefsRecord {
  cloudKey: string;
  authHash?: string;
  last4?: string;
  myMbuGroup: string;
  myLabGroup: string;
  otherGroupMode: string;
  lang: string;
  updatedAtMs: number;
}

interface CompactStudentPrefsDoc {
  g: '' | 'I' | 'II' | 'III' | 'IV' | 'V';
  l: '' | '1' | '2';
  m: 'd' | 'h';
  p: '' | 'tr' | 'en';
  t: number;
}

const VALID_CLOUD_KEY_RE = /^[a-f0-9]{64}$/;
const VALID_MBU_GROUPS = ['', 'I', 'II', 'III', 'IV', 'V'] as const;
const VALID_LAB_GROUPS = ['', '1', '2'] as const;

type FetchStudentPrefsResult =
  | { ok: true; record: FirebaseStudentPrefsRecord | null; isLegacy: boolean }
  | { ok: false };

const inFlightStudentPrefsReads = new Map<string, Promise<FetchStudentPrefsResult>>();

function decodeFirebaseStudentPrefsDoc(
  cleanKey: string,
  d: Record<string, unknown>,
): { record: FirebaseStudentPrefsRecord; isLegacy: boolean } {
  const isCompact =
    typeof d.g === 'string' ||
    typeof d.l === 'string' ||
    typeof d.m === 'string' ||
    typeof d.p === 'string' ||
    typeof d.t === 'number';
  const hasLegacyKeys =
    'myMbuGroup' in d || 'myLabGroup' in d || 'otherGroupMode' in d || 'updatedAtMs' in d || 'cloudKey' in d;

  if (isCompact && !hasLegacyKeys) {
    const rawG = typeof d.g === 'string' ? d.g : '';
    const rawL = typeof d.l === 'string' ? d.l : '';
    const rawP = typeof d.p === 'string' ? d.p : '';
    return {
      isLegacy: false,
      record: {
        cloudKey: cleanKey,
        myMbuGroup: (VALID_MBU_GROUPS as readonly string[]).includes(rawG) ? rawG : '',
        myLabGroup: (VALID_LAB_GROUPS as readonly string[]).includes(rawL) ? rawL : '',
        otherGroupMode: d.m === 'h' ? 'hide' : 'dim',
        lang: rawP === 'en' ? 'en' : rawP === 'tr' ? 'tr' : '',
        updatedAtMs: Number(d.t) || 0,
      },
    };
  }

  const rawMbu = typeof d.myMbuGroup === 'string' ? d.myMbuGroup : typeof d.g === 'string' ? d.g : '';
  const rawLab = typeof d.myLabGroup === 'string' ? d.myLabGroup : typeof d.l === 'string' ? d.l : '';
  const rawLang = typeof d.lang === 'string' ? d.lang : typeof d.p === 'string' ? d.p : '';
  const rawMode =
    d.otherGroupMode === 'hide' || d.m === 'h' ? 'hide' : 'dim';
  return {
    isLegacy: true,
    record: {
      cloudKey: cleanKey,
      authHash: typeof d.authHash === 'string' ? d.authHash : '',
      last4: typeof d.last4 === 'string' ? d.last4 : '',
      myMbuGroup: (VALID_MBU_GROUPS as readonly string[]).includes(rawMbu) ? rawMbu : '',
      myLabGroup: (VALID_LAB_GROUPS as readonly string[]).includes(rawLab) ? rawLab : '',
      otherGroupMode: rawMode,
      lang: rawLang === 'en' ? 'en' : rawLang === 'tr' ? 'tr' : '',
      updatedAtMs: Number(d.updatedAtMs ?? d.t) || 0,
    },
  };
}

export async function fetchFirebaseStudentPrefs(
  cloudKey: string,
  options?: { bypassQuotaCache?: boolean },
): Promise<FetchStudentPrefsResult> {
  const cleanKey = String(cloudKey || '').trim().toLowerCase();
  if (!db || !VALID_CLOUD_KEY_RE.test(cleanKey)) {
    return { ok: false };
  }
  if (!options?.bypassQuotaCache && isFirebaseQuotaExceeded()) {
    return { ok: false };
  }
  const existing = inFlightStudentPrefsReads.get(cleanKey);
  if (existing) {
    return existing;
  }
  const path = `studentPrefs/${cleanKey}`;
  const req = (async (): Promise<FetchStudentPrefsResult> => {
    try {
      let snap;
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline) {
        snap = await getDoc(doc(db, 'studentPrefs', cleanKey));
      } else {
        try {
          snap = await getDocFromServer(doc(db, 'studentPrefs', cleanKey));
        } catch (serverErr) {
          if (isFirestoreQuotaError(serverErr)) {
            throw serverErr;
          }
          snap = await getDoc(doc(db, 'studentPrefs', cleanKey));
        }
      }
      if (isFirebaseQuotaExceeded()) {
        setFirebaseQuotaExceeded(false);
      }
      if (!snap.exists()) {
        return { ok: true, record: null, isLegacy: false };
      }
      const d = snap.data() as Record<string, unknown>;
      const decoded = decodeFirebaseStudentPrefsDoc(cleanKey, d);
      return {
        ok: true,
        record: decoded.record,
        isLegacy: decoded.isLegacy,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
      return { ok: false };
    } finally {
      inFlightStudentPrefsReads.delete(cleanKey);
    }
  })();
  inFlightStudentPrefsReads.set(cleanKey, req);
  return req;
}

export async function saveFirebaseStudentPrefs(
  cloudKey: string,
  prefs: FirebaseStudentPrefsRecord,
): Promise<boolean> {
  const cleanKey = String(cloudKey || '').trim().toLowerCase();
  if (!db || !VALID_CLOUD_KEY_RE.test(cleanKey)) {
    return false;
  }
  const path = `studentPrefs/${cleanKey}`;
  const gVal = (VALID_MBU_GROUPS as readonly string[]).includes(prefs.myMbuGroup)
    ? (prefs.myMbuGroup as CompactStudentPrefsDoc['g'])
    : '';
  const pVal: CompactStudentPrefsDoc['p'] =
    prefs.lang === 'en' ? 'en' : prefs.lang === 'tr' ? 'tr' : '';
  // Preserve LAB group even while temporarily viewing EN schedule so returning to TR restores it
  const lVal: CompactStudentPrefsDoc['l'] = (VALID_LAB_GROUPS as readonly string[]).includes(prefs.myLabGroup)
    ? (prefs.myLabGroup as CompactStudentPrefsDoc['l'])
    : '';
  const mVal: CompactStudentPrefsDoc['m'] = prefs.otherGroupMode === 'hide' ? 'h' : 'd';
  const tVal = Math.max(1, Math.floor(Number(prefs.updatedAtMs) || Date.now()));

  // Ultra-compact Firestore document (~45 bytes): omits cloudKey (already doc ID), authHash, and last4
  const payload: CompactStudentPrefsDoc = {
    g: gVal,
    l: lVal,
    m: mVal,
    p: pVal,
    t: tVal,
  };
  try {
    await setDoc(doc(db, 'studentPrefs', cleanKey), payload);
    if (isFirebaseQuotaExceeded()) {
      setFirebaseQuotaExceeded(false);
    }
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

export function subscribeFirebaseStudentPrefs(
  cloudKey: string,
  onChange: (record: FirebaseStudentPrefsRecord) => void,
): Unsubscribe {
  const cleanKey = String(cloudKey || '').trim().toLowerCase();
  if (!db || isFirebaseQuotaExceeded() || !VALID_CLOUD_KEY_RE.test(cleanKey)) {
    return () => {};
  }
  const path = `studentPrefs/${cleanKey}`;
  try {
    return onSnapshot(
      doc(db, 'studentPrefs', cleanKey),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as Record<string, unknown>;
        const { record } = decodeFirebaseStudentPrefsDoc(cleanKey, d);
        onChange(record);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, path);
      },
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
    return () => {};
  }
}

// ==================== EXAM COUNTDOWNS (CROSS-DEVICE) ====================

export interface FirebaseExamCountdownRecord {
  id: string;
  title: string;
  date: string;
  time: string;
  note: string;
  targetProg: '' | 'tr' | 'en';
  updatedAtMs: number;
}

function normalizeFirebaseExamCountdown(
  docId: string,
  raw: Record<string, unknown>,
): FirebaseExamCountdownRecord | null {
  const id = String(raw.id || docId || '').trim();
  const title = String(raw.title || '').trim().slice(0, 120);
  const date = String(raw.date || '').trim().slice(0, 20);
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !title || date.length < 8) {
    return null;
  }
  const progRaw = String(raw.targetProg || '').trim().toLowerCase();
  const targetProg: '' | 'tr' | 'en' = progRaw === 'en' ? 'en' : progRaw === 'tr' ? 'tr' : '';
  return {
    id,
    title,
    date,
    time: String(raw.time || '').trim().slice(0, 32),
    note: String(raw.note || '').trim().slice(0, 240),
    targetProg,
    updatedAtMs: Math.max(0, Number(raw.updatedAtMs) || 0),
  };
}

export async function fetchFirebaseExamCountdowns(): Promise<FirebaseExamCountdownRecord[] | null> {
  if (!db || isFirebaseQuotaExceeded()) return null;
  const path = 'examCountdowns';
  try {
    const snap = await getDocs(collection(db, 'examCountdowns'));
    const list: FirebaseExamCountdownRecord[] = [];
    snap.forEach((d) => {
      const rec = normalizeFirebaseExamCountdown(d.id, (d.data() || {}) as Record<string, unknown>);
      if (rec) list.push(rec);
    });
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return null;
  }
}

export function subscribeFirebaseExamCountdowns(
  onChange: (items: FirebaseExamCountdownRecord[]) => void,
): Unsubscribe {
  if (!db || isFirebaseQuotaExceeded()) return () => {};
  const path = 'examCountdowns';
  try {
    return onSnapshot(
      collection(db, 'examCountdowns'),
      (snap) => {
        const list: FirebaseExamCountdownRecord[] = [];
        snap.forEach((d) => {
          const rec = normalizeFirebaseExamCountdown(d.id, (d.data() || {}) as Record<string, unknown>);
          if (rec) list.push(rec);
        });
        onChange(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      },
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return () => {};
  }
}

export async function saveFirebaseExamCountdown(
  item: FirebaseExamCountdownRecord,
): Promise<boolean> {
  if (!db || isFirebaseQuotaExceeded()) return false;
  const rec = normalizeFirebaseExamCountdown(item.id, item as unknown as Record<string, unknown>);
  if (!rec) return false;
  const path = `examCountdowns/${rec.id}`;
  try {
    await setDoc(doc(db, 'examCountdowns', rec.id), {
      id: rec.id,
      title: rec.title,
      date: rec.date,
      time: rec.time,
      note: rec.note,
      targetProg: rec.targetProg,
      updatedAtMs: Math.max(1, Math.floor(rec.updatedAtMs || Date.now())),
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    return false;
  }
}

export async function deleteFirebaseExamCountdown(id: string): Promise<boolean> {
  if (!db || isFirebaseQuotaExceeded() || !id) return false;
  const cleanId = String(id).trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return false;
  const path = `examCountdowns/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'examCountdowns', cleanId));
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
    return false;
  }
}
