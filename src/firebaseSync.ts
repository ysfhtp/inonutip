import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  getDoc,
  getDocFromServer,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let dbInstance: any = null;
try {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  const rawDbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
  dbInstance = rawDbId ? getFirestore(app, rawDbId) : getFirestore(app);
} catch (err) {
  console.warn('Firebase Firestore initialization failed, falling back to static/server sync:', err);
  setFirebaseQuotaExceeded(true);
}
export const db = dbInstance;

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
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    if (isFirebaseQuotaExceeded()) {
      setFirebaseQuotaExceeded(false);
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Please check your Firebase configuration.');
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

const VALID_CLOUD_KEY_RE = /^[a-f0-9]{64}$/;
const inFlightStudentPrefsReads = new Map<
  string,
  Promise<{ ok: true; record: FirebaseStudentPrefsRecord | null } | { ok: false }>
>();

export async function fetchFirebaseStudentPrefs(
  cloudKey: string,
): Promise<{ ok: true; record: FirebaseStudentPrefsRecord | null } | { ok: false }> {
  const cleanKey = String(cloudKey || '').trim().toLowerCase();
  if (!db || isFirebaseQuotaExceeded() || !VALID_CLOUD_KEY_RE.test(cleanKey)) {
    return { ok: false };
  }
  const existing = inFlightStudentPrefsReads.get(cleanKey);
  if (existing) {
    return existing;
  }
  const path = `studentPrefs/${cleanKey}`;
  const req = (async (): Promise<
    { ok: true; record: FirebaseStudentPrefsRecord | null } | { ok: false }
  > => {
    try {
      let snap;
      try {
        snap = await getDocFromServer(doc(db, 'studentPrefs', cleanKey));
      } catch {
        snap = await getDoc(doc(db, 'studentPrefs', cleanKey));
      }
      if (!snap.exists()) {
        return { ok: true, record: null };
      }
      const d = snap.data() as Record<string, unknown>;
      return {
        ok: true,
        record: {
          cloudKey: cleanKey,
          authHash: typeof d.authHash === 'string' ? d.authHash : '',
          last4: typeof d.last4 === 'string' ? d.last4 : '',
          myMbuGroup: typeof d.myMbuGroup === 'string' ? d.myMbuGroup : '',
          myLabGroup: typeof d.myLabGroup === 'string' ? d.myLabGroup : '',
          otherGroupMode: d.otherGroupMode === 'hide' ? 'hide' : 'dim',
          lang: d.lang === 'en' ? 'en' : d.lang === 'tr' ? 'tr' : '',
          updatedAtMs: Number(d.updatedAtMs) || 0,
        },
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
  if (!db || isFirebaseQuotaExceeded() || !VALID_CLOUD_KEY_RE.test(cleanKey)) {
    return false;
  }
  const path = `studentPrefs/${cleanKey}`;
  const cleanAuthHash =
    typeof prefs.authHash === 'string' && /^[a-f0-9]{32,64}$/.test(prefs.authHash.trim().toLowerCase())
      ? prefs.authHash.trim().toLowerCase()
      : '';
  const cleanLast4 =
    typeof prefs.last4 === 'string' && /^[0-9]{4}$/.test(prefs.last4.trim())
      ? prefs.last4.trim()
      : '';
  const payload: FirebaseStudentPrefsRecord = {
    cloudKey: cleanKey,
    authHash: cleanAuthHash,
    last4: cleanLast4,
    myMbuGroup: ['', 'I', 'II', 'III', 'IV', 'V'].includes(prefs.myMbuGroup) ? prefs.myMbuGroup : '',
    myLabGroup: ['', '1', '2'].includes(prefs.myLabGroup) ? prefs.myLabGroup : '',
    otherGroupMode: prefs.otherGroupMode === 'hide' ? 'hide' : 'dim',
    lang: prefs.lang === 'en' ? 'en' : prefs.lang === 'tr' ? 'tr' : '',
    updatedAtMs: Math.max(1, Number(prefs.updatedAtMs) || Date.now()),
  };
  try {
    await setDoc(doc(db, 'studentPrefs', cleanKey), payload);
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
        onChange({
          cloudKey: cleanKey,
          authHash: typeof d.authHash === 'string' ? d.authHash : '',
          last4: typeof d.last4 === 'string' ? d.last4 : '',
          myMbuGroup: typeof d.myMbuGroup === 'string' ? d.myMbuGroup : '',
          myLabGroup: typeof d.myLabGroup === 'string' ? d.myLabGroup : '',
          otherGroupMode: d.otherGroupMode === 'hide' ? 'hide' : 'dim',
          lang: d.lang === 'en' ? 'en' : d.lang === 'tr' ? 'tr' : '',
          updatedAtMs: Number(d.updatedAtMs) || 0,
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
