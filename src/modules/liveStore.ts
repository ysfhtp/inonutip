import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  isFirebaseQuotaExceeded,
  OperationType,
} from '../firebaseSync.ts';

export type BannerTone = 'urgent' | 'warn' | 'info';

export interface EmergencyBanner {
  active: boolean;
  text: string;
  tone: BannerTone;
  updatedAtMs: number;
}

export interface LivePoll {
  id: string;
  question: string;
  options: string[];
  counts: number[];
  targetProg: '' | 'tr' | 'en';
  active: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface LessonOverride {
  id: string;
  date: string; // DD.MM.YYYY
  slotNo: number;
  targetProg: 'tr' | 'en';
  newTime: string;
  newLocation: string;
  newInstructor: string;
  note: string;
  updatedAtMs: number;
}

export interface ExtraLesson {
  id: string;
  date: string; // DD.MM.YYYY
  targetProg: 'tr' | 'en';
  title: string;
  time: string;
  location: string;
  instructor: string;
  note: string;
  updatedAtMs: number;
}

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  category: string;
  targetProg: '' | 'tr' | 'en';
  order: number;
  updatedAtMs: number;
}

export interface StudentFeedback {
  id: string;
  category: string;
  message: string;
  status: 'pending' | 'resolved';
  adminNote: string;
  senderKey: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface MaintenanceConfig {
  active: boolean;
  title: string;
  message: string;
  allowedHashes: string[];
  allowedLabels: string[];
  updatedAtMs: number;
}

export interface FoodRatingDoc {
  id: string; // YYYY-MM-DD
  ratingCount: number;
  ratingSum: number;
  tagCounts: number[]; // length 6
  updatedAtMs: number;
}

export const FOOD_RATING_TAGS: ReadonlyArray<{ tr: string; en: string }> = [
  { tr: 'Doyurucu', en: 'Filling' },
  { tr: 'Lezzetli', en: 'Tasty' },
  { tr: 'Sıcak', en: 'Warm' },
  { tr: 'Ortalama', en: 'Average' },
  { tr: 'Porsiyon Az', en: 'Small Portion' },
  { tr: 'Tuzlu / Yağlı', en: 'Salty / Oily' },
];

export interface LiveStoreSnapshot {
  banner: EmergencyBanner;
  maintenance: MaintenanceConfig;
  polls: LivePoll[];
  overrides: LessonOverride[];
  extraLessons: ExtraLesson[];
  quickLinks: QuickLink[];
  quickLinksFromCloud: boolean;
  feedbacks: StudentFeedback[];
  foodRatings: Record<string, FoodRatingDoc>;
}

const LS_KEY = 'inonu_live_extras_v1';
const VOTES_LS_KEY = 'inonu_poll_votes_v1';
const FOOD_VOTES_LS_KEY = 'inonu_food_ratings_v1';

export const DEFAULT_QUICK_LINKS: QuickLink[] = [
  {
    id: 'default_obis',
    title: 'OBİS Öğrenci Bilgi',
    url: 'https://obis.inonu.edu.tr',
    category: 'Resmi',
    targetProg: '',
    order: 1,
    updatedAtMs: 0,
  },
  {
    id: 'default_tip',
    title: 'İnönü Tıp Fakültesi',
    url: 'https://www.inonu.edu.tr/tip',
    category: 'Fakülte',
    targetProg: '',
    order: 2,
    updatedAtMs: 0,
  },
  {
    id: 'default_uzem',
    title: 'İNÜZEM / LMS',
    url: 'https://lms.inonu.edu.tr',
    category: 'Ders',
    targetProg: '',
    order: 3,
    updatedAtMs: 0,
  },
  {
    id: 'default_kutuphane',
    title: 'Kütüphane & Veritabanı',
    url: 'https://www.inonu.edu.tr/kutuphane',
    category: 'Kaynak',
    targetProg: '',
    order: 4,
    updatedAtMs: 0,
  },
];

const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  active: false,
  title: 'Sistem Bakımda',
  message: 'Kısa süreli bakım ve güncelleme çalışması yapılıyor. Lütfen daha sonra tekrar deneyin.',
  allowedHashes: [],
  allowedLabels: [],
  updatedAtMs: 0,
};

function createEmptyState(): LiveStoreSnapshot {
  return {
    banner: { active: false, text: '', tone: 'urgent', updatedAtMs: 0 },
    maintenance: { ...DEFAULT_MAINTENANCE, allowedHashes: [], allowedLabels: [] },
    polls: [],
    overrides: [],
    extraLessons: [],
    quickLinks: [],
    quickLinksFromCloud: false,
    feedbacks: [],
    foodRatings: {},
  };
}

function normalizeMaintenance(raw: unknown): MaintenanceConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_MAINTENANCE, allowedHashes: [], allowedLabels: [] };
  }
  const d = raw as Record<string, unknown>;
  const rawHashes = Array.isArray(d.allowedHashes) ? d.allowedHashes : [];
  const rawLabels = Array.isArray(d.allowedLabels) ? d.allowedLabels : [];
  const allowedHashes: string[] = [];
  const allowedLabels: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawHashes.length && allowedHashes.length < 50; i += 1) {
    const h = String(rawHashes[i] || '').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(h) || seen.has(h)) continue;
    seen.add(h);
    allowedHashes.push(h);
    allowedLabels.push(String(rawLabels[i] || '••••').trim().slice(0, 80) || '••••');
  }
  return {
    active: Boolean(d.active),
    title: String(d.title || DEFAULT_MAINTENANCE.title).trim().slice(0, 120) || DEFAULT_MAINTENANCE.title,
    message: String(d.message || DEFAULT_MAINTENANCE.message).trim().slice(0, 400) || DEFAULT_MAINTENANCE.message,
    allowedHashes,
    allowedLabels,
    updatedAtMs: Number(d.updatedAtMs) || 0,
  };
}

function loadCachedState(): LiveStoreSnapshot {
  const base = createEmptyState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<LiveStoreSnapshot>;
    if (parsed.banner && typeof parsed.banner === 'object') {
      base.banner = {
        active: Boolean(parsed.banner.active),
        text: String(parsed.banner.text || ''),
        tone: normalizeTone(parsed.banner.tone),
        updatedAtMs: Number(parsed.banner.updatedAtMs) || 0,
      };
    }
    if (parsed.maintenance && typeof parsed.maintenance === 'object') {
      base.maintenance = normalizeMaintenance(parsed.maintenance);
    }
    if (Array.isArray(parsed.polls)) base.polls = parsed.polls;
    if (Array.isArray(parsed.overrides)) base.overrides = parsed.overrides;
    if (Array.isArray(parsed.extraLessons)) base.extraLessons = parsed.extraLessons;
    if (Array.isArray(parsed.quickLinks)) base.quickLinks = parsed.quickLinks;
    base.quickLinksFromCloud = Boolean(parsed.quickLinksFromCloud);
    if (Array.isArray(parsed.feedbacks)) base.feedbacks = parsed.feedbacks;
    if (parsed.foodRatings && typeof parsed.foodRatings === 'object') {
      base.foodRatings = parsed.foodRatings;
    }
  } catch {
    // ignore storage errors
  }
  return base;
}

function saveCachedState(snap: LiveStoreSnapshot): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snap));
  } catch {
    // ignore quota errors
  }
}

function normalizeTone(v: unknown): BannerTone {
  return v === 'info' ? 'info' : v === 'warn' ? 'warn' : 'urgent';
}

function normalizeProg(v: unknown): '' | 'tr' | 'en' {
  return v === 'tr' ? 'tr' : v === 'en' ? 'en' : '';
}

function normalizeStrictProg(v: unknown): 'tr' | 'en' {
  return v === 'en' ? 'en' : 'tr';
}

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function makeOverrideId(date: string, slotNo: number, prog: 'tr' | 'en'): string {
  const cleanDate = String(date || '').replace(/[^0-9]/g, '');
  return `ov_${prog}_${cleanDate}_${slotNo}`;
}

let state: LiveStoreSnapshot = loadCachedState();
let started = false;
const listeners = new Set<(snap: LiveStoreSnapshot) => void>();
const unsubs: Unsubscribe[] = [];

function notify(scheduleChanged = false): void {
  saveCachedState(state);
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      // isolate subscriber errors
    }
  });
  if (scheduleChanged && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inonu-schedule-extras-changed'));
  }
}

export function getLiveStore(): LiveStoreSnapshot {
  return state;
}

export function subscribeLiveStore(cb: (snap: LiveStoreSnapshot) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

export function getEffectiveQuickLinks(lang: 'tr' | 'en'): QuickLink[] {
  const source = state.quickLinks.length > 0 ? state.quickLinks : DEFAULT_QUICK_LINKS;
  return source
    .filter((l) => !l.targetProg || l.targetProg === lang)
    .slice()
    .sort((a, b) => (a.order - b.order) || (b.updatedAtMs - a.updatedAtMs));
}

export function getLessonOverrideForSlot(
  date: string,
  slotNo: number,
  prog: 'tr' | 'en'
): LessonOverride | null {
  const cleanDate = String(date || '').trim();
  const sNo = Number(slotNo) || 0;
  return (
    state.overrides.find(
      (o) => o.date === cleanDate && o.slotNo === sNo && o.targetProg === prog
    ) || null
  );
}

export function getExtraLessonsForDate(date: string, prog: 'tr' | 'en'): ExtraLesson[] {
  const cleanDate = String(date || '').trim();
  return state.extraLessons
    .filter((e) => e.date === cleanDate && e.targetProg === prog)
    .slice()
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
}

export function getScheduleExtrasSignature(date: string, prog: 'tr' | 'en'): string {
  const ovs = state.overrides
    .filter((o) => o.date === date && o.targetProg === prog)
    .map((o) => `${o.slotNo}:${o.updatedAtMs}`)
    .join(',');
  const exs = state.extraLessons
    .filter((e) => e.date === date && e.targetProg === prog)
    .map((e) => `${e.id}:${e.updatedAtMs}`)
    .join(',');
  return `${ovs}|${exs}`;
}

export function getLocalVotedPollIndex(pollId: string): number | null {
  try {
    const map = JSON.parse(localStorage.getItem(VOTES_LS_KEY) || '{}') as Record<string, number>;
    const v = map[pollId];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
}

function setLocalVotedPollIndex(pollId: string, idx: number): void {
  try {
    const map = JSON.parse(localStorage.getItem(VOTES_LS_KEY) || '{}') as Record<string, number>;
    map[pollId] = idx;
    localStorage.setItem(VOTES_LS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function initLiveStore(): void {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__INONU_LIVE_EXTRAS__ = {
      getLessonOverrideForSlot,
      getExtraLessonsForDate,
      getScheduleExtrasSignature,
      openOverrideEditor: (slot: { date: string; slotNo: number; time?: string; location?: string; instructor?: string; title?: string }) => {
        window.dispatchEvent(new CustomEvent('inonu-open-override-editor', { detail: slot }));
      },
    };
  }
  if (started) return;
  started = true;

  if (!db || isFirebaseQuotaExceeded()) return;

  try {
    unsubs.push(
      onSnapshot(
        doc(db, 'config', 'emergencyBanner'),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data() as Record<string, unknown>;
            state = {
              ...state,
              banner: {
                active: Boolean(d.active),
                text: String(d.text || '').slice(0, 280),
                tone: normalizeTone(d.tone),
                updatedAtMs: Number(d.updatedAtMs) || 0,
              },
            };
          } else {
            state = {
              ...state,
              banner: { active: false, text: '', tone: 'urgent', updatedAtMs: 0 },
            };
          }
          notify(false);
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'config/emergencyBanner')
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'config/emergencyBanner');
  }

  try {
    unsubs.push(
      onSnapshot(
        doc(db, 'config', 'maintenance'),
        (snap) => {
          state = {
            ...state,
            maintenance: snap.exists()
              ? normalizeMaintenance(snap.data())
              : { ...DEFAULT_MAINTENANCE, allowedHashes: [], allowedLabels: [] },
          };
          notify(false);
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'config/maintenance')
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'config/maintenance');
  }

  try {
    unsubs.push(
      onSnapshot(
        collection(db, 'livePolls'),
        (snap) => {
          const list: LivePoll[] = [];
          snap.forEach((d) => {
            const raw = d.data() as Record<string, unknown>;
            const options = Array.isArray(raw.options)
              ? raw.options.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
              : [];
            if (options.length < 2) return;
            const rawCounts = Array.isArray(raw.counts) ? raw.counts : [];
            const counts = options.map((_, i) => Math.max(0, Math.floor(Number(rawCounts[i]) || 0)));
            list.push({
              id: d.id,
              question: String(raw.question || '').trim().slice(0, 200),
              options,
              counts,
              targetProg: normalizeProg(raw.targetProg),
              active: Boolean(raw.active),
              createdAtMs: Number(raw.createdAtMs) || 0,
              updatedAtMs: Number(raw.updatedAtMs) || 0,
            });
          });
          list.sort((a, b) => (b.createdAtMs || b.updatedAtMs) - (a.createdAtMs || a.updatedAtMs));
          state = { ...state, polls: list };
          notify(false);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'livePolls')
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'livePolls');
  }

  try {
    unsubs.push(
      onSnapshot(
        collection(db, 'lessonOverrides'),
        (snap) => {
          const list: LessonOverride[] = [];
          snap.forEach((d) => {
            const raw = d.data() as Record<string, unknown>;
            const slotNo = Math.floor(Number(raw.slotNo) || 0);
            const date = String(raw.date || '').trim();
            if (!date || slotNo < 1 || slotNo > 20) return;
            list.push({
              id: d.id,
              date,
              slotNo,
              targetProg: normalizeStrictProg(raw.targetProg),
              newTime: String(raw.newTime || '').trim().slice(0, 32),
              newLocation: String(raw.newLocation || '').trim().slice(0, 120),
              newInstructor: String(raw.newInstructor || '').trim().slice(0, 140),
              note: String(raw.note || '').trim().slice(0, 200),
              updatedAtMs: Number(raw.updatedAtMs) || 0,
            });
          });
          list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
          state = { ...state, overrides: list };
          notify(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'lessonOverrides')
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'lessonOverrides');
  }

  try {
    unsubs.push(
      onSnapshot(
        collection(db, 'extraLessons'),
        (snap) => {
          const list: ExtraLesson[] = [];
          snap.forEach((d) => {
            const raw = d.data() as Record<string, unknown>;
            const date = String(raw.date || '').trim();
            const title = String(raw.title || '').trim();
            const time = String(raw.time || '').trim();
            if (!date || !title || !time) return;
            list.push({
              id: d.id,
              date,
              targetProg: normalizeStrictProg(raw.targetProg),
              title: title.slice(0, 160),
              time: time.slice(0, 32),
              location: String(raw.location || '').trim().slice(0, 120),
              instructor: String(raw.instructor || '').trim().slice(0, 140),
              note: String(raw.note || '').trim().slice(0, 200),
              updatedAtMs: Number(raw.updatedAtMs) || 0,
            });
          });
          list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
          state = { ...state, extraLessons: list };
          notify(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'extraLessons')
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'extraLessons');
  }

  try {
    unsubs.push(
      onSnapshot(
        collection(db, 'quickLinks'),
        (snap) => {
          const list: QuickLink[] = [];
          snap.forEach((d) => {
            const raw = d.data() as Record<string, unknown>;
            const title = String(raw.title || '').trim();
            const url = String(raw.url || '').trim();
            if (!title || !/^https?:\/\//i.test(url)) return;
            list.push({
              id: d.id,
              title: title.slice(0, 80),
              url: url.slice(0, 500),
              category: String(raw.category || '').trim().slice(0, 32),
              targetProg: normalizeProg(raw.targetProg),
              order: Math.max(0, Math.min(9999, Math.floor(Number(raw.order) || 0))),
              updatedAtMs: Number(raw.updatedAtMs) || 0,
            });
          });
          list.sort((a, b) => (a.order - b.order) || (b.updatedAtMs - a.updatedAtMs));
          state = { ...state, quickLinks: list, quickLinksFromCloud: true };
          notify(false);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'quickLinks')
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'quickLinks');
  }

  try {
    unsubs.push(
      onSnapshot(
        collection(db, 'studentFeedback'),
        (snap) => {
          const list: StudentFeedback[] = [];
          snap.forEach((d) => {
            const raw = d.data() as Record<string, unknown>;
            const msg = String(raw.message || '').trim();
            if (!msg) return;
            list.push({
              id: d.id,
              category: String(raw.category || 'Genel').trim().slice(0, 40),
              message: msg.slice(0, 600),
              status: raw.status === 'resolved' ? 'resolved' : 'pending',
              adminNote: String(raw.adminNote || '').trim().slice(0, 240),
              senderKey: String(raw.senderKey || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
              createdAtMs: Number(raw.createdAtMs) || 0,
              updatedAtMs: Number(raw.updatedAtMs) || 0,
            });
          });
          list.sort((a, b) => (b.createdAtMs || b.updatedAtMs) - (a.createdAtMs || a.updatedAtMs));
          state = { ...state, feedbacks: list };
          notify(false);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'studentFeedback')
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'studentFeedback');
  }

  try {
    unsubs.push(
      onSnapshot(
        collection(db, 'foodRatings'),
        (snap) => {
          const map: Record<string, FoodRatingDoc> = {};
          snap.forEach((d) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d.id)) return;
            const raw = d.data() as Record<string, unknown>;
            const rawTags = Array.isArray(raw.tagCounts) ? raw.tagCounts : [];
            const tagCounts = Array.from({ length: 6 }, (_, i) => Math.max(0, Math.floor(Number(rawTags[i]) || 0)));
            map[d.id] = {
              id: d.id,
              ratingCount: Math.max(0, Math.floor(Number(raw.ratingCount) || 0)),
              ratingSum: Math.max(0, Number(raw.ratingSum) || 0),
              tagCounts,
              updatedAtMs: Number(raw.updatedAtMs) || 0,
            };
          });
          state = { ...state, foodRatings: map };
          notify(false);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'foodRatings')
      )
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'foodRatings');
  }
}

// ==================== MUTATIONS ====================

export async function saveEmergencyBanner(input: {
  active: boolean;
  text: string;
  tone: BannerTone;
}): Promise<EmergencyBanner> {
  const payload: EmergencyBanner = {
    active: Boolean(input.active),
    text: String(input.text || '').trim().slice(0, 280),
    tone: normalizeTone(input.tone),
    updatedAtMs: Date.now(),
  };
  state = { ...state, banner: payload };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await setDoc(doc(db, 'config', 'emergencyBanner'), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'config/emergencyBanner');
    }
  }
  return payload;
}

export async function saveMaintenanceConfig(input: {
  active: boolean;
  title: string;
  message: string;
  allowedHashes: string[];
  allowedLabels: string[];
}): Promise<MaintenanceConfig> {
  const payload = normalizeMaintenance({
    ...input,
    updatedAtMs: Date.now(),
  });
  state = { ...state, maintenance: payload };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await setDoc(doc(db, 'config', 'maintenance'), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'config/maintenance');
    }
  }
  return payload;
}

export async function saveLivePoll(input: {
  id?: string;
  question: string;
  options: string[];
  counts?: number[];
  targetProg: '' | 'tr' | 'en';
  active: boolean;
  createdAtMs?: number;
}): Promise<LivePoll> {
  const cleanOptions = input.options
    .map((o) => String(o || '').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 6);
  if (cleanOptions.length < 2) throw new Error('At least 2 options required');
  const id = input.id && /^[a-zA-Z0-9_-]{1,128}$/.test(input.id) ? input.id : makeSafeId('poll');
  const now = Date.now();
  const counts = cleanOptions.map((_, i) =>
    Math.max(0, Math.floor(Number(input.counts?.[i]) || 0))
  );
  const payload: LivePoll = {
    id,
    question: String(input.question || '').trim().slice(0, 200),
    options: cleanOptions,
    counts,
    targetProg: normalizeProg(input.targetProg),
    active: Boolean(input.active),
    createdAtMs: Number(input.createdAtMs) || now,
    updatedAtMs: now,
  };
  const next = state.polls.filter((p) => p.id !== id);
  next.unshift(payload);
  state = { ...state, polls: next };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await setDoc(doc(db, 'livePolls', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `livePolls/${id}`);
    }
  }
  return payload;
}

export async function deleteLivePoll(id: string): Promise<void> {
  state = { ...state, polls: state.polls.filter((p) => p.id !== id) };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await deleteDoc(doc(db, 'livePolls', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `livePolls/${id}`);
    }
  }
}

export async function voteLivePoll(pollId: string, optionIndex: number): Promise<boolean> {
  const poll = state.polls.find((p) => p.id === pollId);
  if (!poll || !poll.active) return false;
  if (optionIndex < 0 || optionIndex >= poll.options.length) return false;

  const prevChoice = getLocalVotedPollIndex(pollId);
  if (prevChoice === optionIndex) return true;

  setLocalVotedPollIndex(pollId, optionIndex);

  // Optimistic local update
  const updatedCounts = poll.counts.slice();
  if (prevChoice !== null && prevChoice >= 0 && prevChoice < updatedCounts.length) {
    updatedCounts[prevChoice] = Math.max(0, (updatedCounts[prevChoice] || 0) - 1);
  }
  updatedCounts[optionIndex] = (updatedCounts[optionIndex] || 0) + 1;
  const optimisticPoll: LivePoll = { ...poll, counts: updatedCounts, updatedAtMs: Date.now() };
  state = {
    ...state,
    polls: state.polls.map((p) => (p.id === pollId ? optimisticPoll : p)),
  };
  notify(false);

  if (db && !isFirebaseQuotaExceeded()) {
    const ref = doc(db, 'livePolls', pollId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const d = snap.data() as LivePoll;
        const opts = Array.isArray(d.options) ? d.options : poll.options;
        const counts = opts.map((_, i) => Math.max(0, Math.floor(Number(d.counts?.[i]) || 0)));
        if (prevChoice !== null && prevChoice >= 0 && prevChoice < counts.length) {
          counts[prevChoice] = Math.max(0, counts[prevChoice] - 1);
        }
        if (optionIndex >= 0 && optionIndex < counts.length) {
          counts[optionIndex] += 1;
        }
        tx.set(ref, {
          id: pollId,
          question: String(d.question || poll.question),
          options: opts,
          counts,
          targetProg: normalizeProg(d.targetProg),
          active: Boolean(d.active),
          createdAtMs: Number(d.createdAtMs) || poll.createdAtMs,
          updatedAtMs: Date.now(),
        });
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `livePolls/${pollId}`);
    }
  }
  return true;
}

export async function saveLessonOverride(input: {
  date: string;
  slotNo: number;
  targetProg: 'tr' | 'en';
  newTime: string;
  newLocation: string;
  newInstructor: string;
  note: string;
}): Promise<LessonOverride> {
  const prog = normalizeStrictProg(input.targetProg);
  const slotNo = Math.max(1, Math.min(20, Math.floor(Number(input.slotNo) || 1)));
  const date = String(input.date || '').trim().slice(0, 20);
  const id = makeOverrideId(date, slotNo, prog);
  const payload: LessonOverride = {
    id,
    date,
    slotNo,
    targetProg: prog,
    newTime: String(input.newTime || '').trim().slice(0, 32),
    newLocation: String(input.newLocation || '').trim().slice(0, 120),
    newInstructor: String(input.newInstructor || '').trim().slice(0, 140),
    note: String(input.note || '').trim().slice(0, 200),
    updatedAtMs: Date.now(),
  };
  const next = state.overrides.filter((o) => o.id !== id);
  next.unshift(payload);
  state = { ...state, overrides: next };
  notify(true);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await setDoc(doc(db, 'lessonOverrides', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `lessonOverrides/${id}`);
    }
  }
  return payload;
}

export async function deleteLessonOverride(id: string): Promise<void> {
  state = { ...state, overrides: state.overrides.filter((o) => o.id !== id) };
  notify(true);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await deleteDoc(doc(db, 'lessonOverrides', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `lessonOverrides/${id}`);
    }
  }
}

export async function saveExtraLesson(input: {
  id?: string;
  date: string;
  targetProg: 'tr' | 'en';
  title: string;
  time: string;
  location: string;
  instructor: string;
  note: string;
}): Promise<ExtraLesson> {
  const id = input.id && /^[a-zA-Z0-9_-]{1,128}$/.test(input.id) ? input.id : makeSafeId('extra');
  const payload: ExtraLesson = {
    id,
    date: String(input.date || '').trim().slice(0, 20),
    targetProg: normalizeStrictProg(input.targetProg),
    title: String(input.title || '').trim().slice(0, 160),
    time: String(input.time || '').trim().slice(0, 32),
    location: String(input.location || '').trim().slice(0, 120),
    instructor: String(input.instructor || '').trim().slice(0, 140),
    note: String(input.note || '').trim().slice(0, 200),
    updatedAtMs: Date.now(),
  };
  const next = state.extraLessons.filter((e) => e.id !== id);
  next.unshift(payload);
  state = { ...state, extraLessons: next };
  notify(true);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await setDoc(doc(db, 'extraLessons', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `extraLessons/${id}`);
    }
  }
  return payload;
}

export async function deleteExtraLesson(id: string): Promise<void> {
  state = { ...state, extraLessons: state.extraLessons.filter((e) => e.id !== id) };
  notify(true);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await deleteDoc(doc(db, 'extraLessons', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `extraLessons/${id}`);
    }
  }
}

export async function saveQuickLink(input: {
  id?: string;
  title: string;
  url: string;
  category: string;
  targetProg: '' | 'tr' | 'en';
  order?: number;
}): Promise<QuickLink> {
  let cleanUrl = String(input.url || '').trim().slice(0, 500);
  if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = `https://${cleanUrl}`;
  }
  const id = input.id && /^[a-zA-Z0-9_-]{1,128}$/.test(input.id) ? input.id : makeSafeId('link');
  const payload: QuickLink = {
    id,
    title: String(input.title || '').trim().slice(0, 80),
    url: cleanUrl,
    category: String(input.category || 'Genel').trim().slice(0, 32),
    targetProg: normalizeProg(input.targetProg),
    order: Math.max(0, Math.min(9999, Math.floor(Number(input.order) || state.quickLinks.length + 1))),
    updatedAtMs: Date.now(),
  };
  const next = state.quickLinks.filter((l) => l.id !== id);
  next.push(payload);
  next.sort((a, b) => (a.order - b.order) || (b.updatedAtMs - a.updatedAtMs));
  state = { ...state, quickLinks: next, quickLinksFromCloud: true };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await setDoc(doc(db, 'quickLinks', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `quickLinks/${id}`);
    }
  }
  return payload;
}

export async function deleteQuickLink(id: string): Promise<void> {
  state = { ...state, quickLinks: state.quickLinks.filter((l) => l.id !== id) };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await deleteDoc(doc(db, 'quickLinks', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `quickLinks/${id}`);
    }
  }
}

// ==================== ANONYMOUS STUDENT FEEDBACK (#1) ====================

export async function submitStudentFeedback(input: {
  category: string;
  message: string;
  senderKey?: string;
}): Promise<StudentFeedback> {
  const id = makeSafeId('fb');
  const now = Date.now();
  const cleanKey = String(input.senderKey || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const payload: StudentFeedback = {
    id,
    category: String(input.category || 'Genel').trim().slice(0, 40) || 'Genel',
    message: String(input.message || '').trim().slice(0, 600),
    status: 'pending',
    adminNote: '',
    senderKey: cleanKey,
    createdAtMs: now,
    updatedAtMs: now,
  };
  if (!payload.message) throw new Error('Message required');
  state = { ...state, feedbacks: [payload, ...state.feedbacks] };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await setDoc(doc(db, 'studentFeedback', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `studentFeedback/${id}`);
    }
  }
  return payload;
}

export async function updateStudentFeedback(
  id: string,
  patch: { status?: 'pending' | 'resolved'; adminNote?: string }
): Promise<void> {
  const existing = state.feedbacks.find((f) => f.id === id);
  if (!existing) return;
  const updated: StudentFeedback = {
    ...existing,
    status: patch.status === 'resolved' ? 'resolved' : patch.status === 'pending' ? 'pending' : existing.status,
    adminNote: typeof patch.adminNote === 'string' ? patch.adminNote.trim().slice(0, 240) : existing.adminNote,
    updatedAtMs: Date.now(),
  };
  state = {
    ...state,
    feedbacks: state.feedbacks.map((f) => (f.id === id ? updated : f)),
  };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await setDoc(doc(db, 'studentFeedback', id), updated);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `studentFeedback/${id}`);
    }
  }
}

export async function deleteStudentFeedback(id: string): Promise<void> {
  state = { ...state, feedbacks: state.feedbacks.filter((f) => f.id !== id) };
  notify(false);
  if (db && !isFirebaseQuotaExceeded()) {
    try {
      await deleteDoc(doc(db, 'studentFeedback', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `studentFeedback/${id}`);
    }
  }
}

// ==================== CAFETERIA LIVE RATING (#3) ====================

export interface LocalFoodVote {
  stars: number;
  tags: number[];
}

export function getLocalFoodVote(dateIso: string): LocalFoodVote | null {
  try {
    const map = JSON.parse(localStorage.getItem(FOOD_VOTES_LS_KEY) || '{}') as Record<string, LocalFoodVote>;
    const v = map[dateIso];
    if (!v || typeof v.stars !== 'number' || v.stars < 1 || v.stars > 5) return null;
    return {
      stars: Math.round(v.stars),
      tags: Array.isArray(v.tags) ? v.tags.filter((t) => Number.isInteger(t) && t >= 0 && t < 6) : [],
    };
  } catch {
    return null;
  }
}

function saveLocalFoodVote(dateIso: string, vote: LocalFoodVote): void {
  try {
    const map = JSON.parse(localStorage.getItem(FOOD_VOTES_LS_KEY) || '{}') as Record<string, LocalFoodVote>;
    map[dateIso] = vote;
    localStorage.setItem(FOOD_VOTES_LS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function getFoodRatingForDate(dateIso: string): FoodRatingDoc {
  return (
    state.foodRatings[dateIso] || {
      id: dateIso,
      ratingCount: 0,
      ratingSum: 0,
      tagCounts: [0, 0, 0, 0, 0, 0],
      updatedAtMs: 0,
    }
  );
}

export async function submitFoodRating(
  dateIso: string,
  stars: number,
  tags: number[]
): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const cleanStars = Math.max(1, Math.min(5, Math.round(stars)));
  const cleanTags = Array.from(new Set(tags.filter((t) => Number.isInteger(t) && t >= 0 && t < 6)));
  const prev = getLocalFoodVote(dateIso);

  saveLocalFoodVote(dateIso, { stars: cleanStars, tags: cleanTags });

  const applyDelta = (cur: FoodRatingDoc): FoodRatingDoc => {
    const tagCounts = Array.from({ length: 6 }, (_, i) => Math.max(0, Math.floor(Number(cur.tagCounts?.[i]) || 0)));
    let ratingCount = Math.max(0, Math.floor(Number(cur.ratingCount) || 0));
    let ratingSum = Math.max(0, Number(cur.ratingSum) || 0);
    if (prev) {
      ratingSum = Math.max(0, ratingSum - prev.stars);
      prev.tags.forEach((ti) => {
        tagCounts[ti] = Math.max(0, tagCounts[ti] - 1);
      });
    } else {
      ratingCount += 1;
    }
    ratingSum += cleanStars;
    cleanTags.forEach((ti) => {
      tagCounts[ti] += 1;
    });
    return {
      id: dateIso,
      ratingCount,
      ratingSum,
      tagCounts,
      updatedAtMs: Date.now(),
    };
  };

  // Optimistic local state update
  const optimistic = applyDelta(getFoodRatingForDate(dateIso));
  state = {
    ...state,
    foodRatings: { ...state.foodRatings, [dateIso]: optimistic },
  };
  notify(false);

  if (db && !isFirebaseQuotaExceeded()) {
    const ref = doc(db, 'foodRatings', dateIso);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const base: FoodRatingDoc = snap.exists()
          ? (snap.data() as FoodRatingDoc)
          : { id: dateIso, ratingCount: 0, ratingSum: 0, tagCounts: [0, 0, 0, 0, 0, 0], updatedAtMs: 0 };
        tx.set(ref, applyDelta(base));
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `foodRatings/${dateIso}`);
    }
  }
  return true;
}
