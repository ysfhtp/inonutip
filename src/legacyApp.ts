// @ts-nocheck
import { SCHEDULE_DAYS_TR, SCHEDULE_DAYS_EN } from './data/schedules.ts';
import {
  MONTHS_TR,
  MONTHS_SHORT_TR,
  DAYS_TR,
  DAYS_SHORT_TR,
  MONTHS_EN,
  MONTHS_SHORT_EN,
  DAYS_EN,
  DAYS_SHORT_EN,
  getTimeBasedGreeting,
  I18N,
} from './data/i18n.ts';
import {
  getAnnouncementReadCount,
  deleteAnnouncementReadStat,
  LAST_SYNC_LS_KEY,
} from './modules/liveStore.ts';

let inonuAppInitialized = false;

function onDomReady(cb) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cb, { once: true });
  } else {
    cb();
  }
}

export function initInonuApp() {
  if (inonuAppInitialized) return;
  inonuAppInitialized = true;
  const STORE_KEY = 'inonu_tip_d1_ios_v3_';
  function loadStore(k, def) {
    try {
      const val = localStorage.getItem(STORE_KEY + k);
      return val ? JSON.parse(val) : def;
    } catch (e) {
      return def;
    }
  }
  function saveStore(k, v) {
    try {
      localStorage.setItem(STORE_KEY + k, JSON.stringify(v));
    } catch (e) {}
  }
  function loadSessionStore(k, def) {
    try {
      const val = sessionStorage.getItem(STORE_KEY + k);
      return val ? JSON.parse(val) : def;
    } catch (e) {
      return def;
    }
  }
  function saveSessionStore(k, v) {
    try {
      sessionStorage.setItem(STORE_KEY + k, JSON.stringify(v));
    } catch (e) {}
  }

  const state = {
    lang: loadStore('lang', 'tr') === 'en' ? 'en' : 'tr',
    notes: loadStore('notes', {}),
    activeTab: 'daily',
    selectedDate: '07.09.2026',
    foodDateISO: '',
    foodViewMode: 'daily',
    weeklyFilterKurul: 'all',
    weeklySelectedWeekKey: null,
    modalSlotKey: null,
    darkMode: loadStore('darkMode', true),
    palette: loadStore('palette', 'medical-blue'),
    hapticsEnabled: loadStore('hapticsEnabled', true) !== false,
    myMbuGroup: loadStore('myMbuGroup', ''),
    myLabGroup: loadStore('myLabGroup', ''),
    otherGroupMode: loadStore('otherGroupMode', 'dim') === 'hide' ? 'hide' : 'dim',
    calcAra: loadStore('calcAra', 80),
    calcSonu: loadStore('calcSonu', 75),
    calcPratik: loadStore('calcPratik', 85),
    calcPratikWeight: loadStore('calcPratikWeight', 15),
    calcKurulOrt: loadStore('calcKurulOrt', null),
    calcHedefYil: loadStore('calcHedefYil', 60)
  };

  const VALID_NAV_TABS = new Set(['daily', 'weekly', 'food', 'search', 'info']);
  let navStateReady = false;

  function persistNavViewState() {
    if (!navStateReady) return;
    const qInp = document.getElementById('inputSearchQuery');
    saveSessionStore('navViewState', {
      activeTab: VALID_NAV_TABS.has(state.activeTab) ? state.activeTab : 'daily',
      selectedDate: typeof state.selectedDate === 'string' ? state.selectedDate : '',
      weeklyFilterKurul: state.weeklyFilterKurul || 'all',
      weeklySelectedWeekKey: state.weeklySelectedWeekKey || null,
      foodDateISO: typeof state.foodDateISO === 'string' ? state.foodDateISO : '',
      foodViewMode: state.foodViewMode === 'weekly' ? 'weekly' : 'daily',
      searchQuery: qInp ? qInp.value : '',
      scrollY: Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0))
    });
  }

  function getScheduleDays() {
    return state.lang === 'en' ? SCHEDULE_DAYS_EN : SCHEDULE_DAYS_TR;
  }

  function t(key) {
    return I18N[state.lang][key];
  }

  function parseDMY(str) {
    const [d, m, y] = str.split('.').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDMY(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}.${m}.${y}`;
  }

  function formatDateLong(dateStr) {
    const dt = parseDMY(dateStr);
    const loc = I18N[state.lang];
    return `${dt.getDate()} ${loc.months[dt.getMonth()]} ${dt.getFullYear()} ${loc.days[dt.getDay()]}`;
  }

  function formatDateDayMonthYear(dateStr) {
    const dt = parseDMY(dateStr);
    const loc = I18N[state.lang];
    return `${dt.getDate()} ${loc.months[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  function formatDateWeekday(dateStr) {
    const dt = parseDMY(dateStr);
    const loc = I18N[state.lang];
    return loc.days[dt.getDay()];
  }

  function getTodayDateObj() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function getTodayIso() {
    return formatISODate(getTodayDateObj());
  }

  function getBestDefaultDate() {
    const days = getScheduleDays();
    const today = getTodayDateObj();
    const todayStr = formatDMY(today);
    if (days.some((d) => d.date === todayStr)) return todayStr;
    for (const day of days) {
      if (parseDMY(day.date) >= today) return day.date;
    }
    return days[0].date;
  }

  function getTomorrowTargetDate() {
    const days = getScheduleDays();
    const today = getTodayDateObj();
    const tom = new Date(today);
    tom.setDate(tom.getDate() + 1);
    const tomStr = formatDMY(tom);
    if (days.some((d) => d.date === tomStr)) return tomStr;
    for (const day of days) {
      if (parseDMY(day.date) > today) return day.date;
    }
    return days[days.length - 1].date;
  }

  function formatRelativeDay(dateStr) {
    const target = parseDMY(dateStr);
    const today = getTodayDateObj();
    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
    const loc = I18N[state.lang];
    if (diffDays === 0) return loc.today;
    if (diffDays === 1) return loc.tomorrow;
    if (diffDays === -1) return loc.yesterday;
    if (diffDays > 1) return loc.daysLater(diffDays);
    return loc.daysAgo(Math.abs(diffDays));
  }

  function getCurrentActiveTimeString() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${hh}.${mm}`;
  }

  function isSlotCurrentlyLive(slot) {
    if (slot.date !== formatDMY(getTodayDateObj())) return false;
    const nowStr = getCurrentActiveTimeString();
    const [start, end] = slot.time.split('-');
    return nowStr >= start && nowStr <= end;
  }

  function isActualLabSlot(codeUpper, titleUpper) {
    if (codeUpper.startsWith('LAB')) return true;
    return /(?:^|[\s(/])LAB(?=$|[\s():/])/i.test(titleUpper);
  }

  function getSlotCategory(slot) {
    const c = (slot.code || '').toUpperCase().trim();
    const titleUpper = (slot.title || '').toLocaleUpperCase('tr-TR').trim();
    if (
      c === 'SINAV' ||
      c === 'EXAM' ||
      c === 'DEĞERLENDİRME' ||
      titleUpper.includes('EXAM') ||
      titleUpper.includes('QUIZ') ||
      titleUpper.includes('EVALUATION')
    ) {
      return 'exam';
    }
    if (c.startsWith('MBU') || c.startsWith('PSP')) {
      return 'mbu';
    }
    if (isActualLabSlot(c, titleUpper)) {
      return 'lab';
    }
    if (c === 'BÇ' || titleUpper.includes('SELF STUDY') || titleUpper.includes('BAĞIMSIZ ÇALIŞMA')) {
      return 'self';
    }
    if (c === 'UYUM' || c.includes('ORIENTATION')) {
      return 'orientation';
    }
    return 'lecture';
  }

  function getCalmAccent(slot, category = getSlotCategory(slot)) {
    if (category === 'exam') {
      return {
        barBg: 'bg-rose-500',
        slotText: 'text-rose-500 dark:text-rose-400',
        groupBadge: ''
      };
    }
    if (category === 'mbu') {
      return {
        barBg: 'slot-mbu-bar',
        slotText: 'slot-mbu-text',
        groupBadge: 'slot-mbu-badge'
      };
    }
    if (category === 'lab') {
      return {
        barBg: 'bg-emerald-500',
        slotText: 'text-emerald-600 dark:text-emerald-400',
        groupBadge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
      };
    }
    if (category === 'self') {
      return {
        barBg: 'bg-slate-400 dark:bg-slate-600',
        slotText: 'text-slate-500 dark:text-slate-400',
        groupBadge: ''
      };
    }
    if (category === 'orientation') {
      return {
        barBg: 'bg-indigo-500',
        slotText: 'text-indigo-600 dark:text-indigo-400',
        groupBadge: ''
      };
    }
    return {
      barBg: 'bg-blue-500',
      slotText: 'text-blue-600 dark:text-blue-400',
      groupBadge: ''
    };
  }

  function normalizeMbuGroup(raw) {
    const cleaned = String(raw || '').toUpperCase().replace(/GROUP|GRUP|[-_\s]/g, '');
    if (cleaned === 'I' || cleaned === '1') return 'I';
    if (cleaned === 'II' || cleaned === '2') return 'II';
    if (cleaned === 'III' || cleaned === '3') return 'III';
    if (cleaned === 'IV' || cleaned === '4') return 'IV';
    if (cleaned === 'V' || cleaned === '5') return 'V';
    return '';
  }

  function normalizeLabGroup(raw) {
    const cleaned = String(raw || '').toUpperCase().replace(/GROUP|GRUP|[-_\s]/g, '');
    if (cleaned === '1' || cleaned === 'I') return '1';
    if (cleaned === '2' || cleaned === 'II') return '2';
    return '';
  }

  function getSlotGroupStatus(slot, category = getSlotCategory(slot)) {
    if (!slot || !slot.group) return 'neutral';
    if (category === 'mbu' && state.myMbuGroup) {
      const g = normalizeMbuGroup(slot.group);
      if (!g) return 'neutral';
      return g === state.myMbuGroup ? 'match' : 'other';
    }
    if (category === 'lab' && state.lang !== 'en' && state.myLabGroup) {
      const g = normalizeLabGroup(slot.group);
      if (!g) return 'neutral';
      return g === state.myLabGroup ? 'match' : 'other';
    }
    return 'neutral';
  }

  function normLessonMatKey(d, slotNo) {
    if (!d) return '';
    const s = String(d).trim().replace(/-/g, '.');
    const parts = s.split('.');
    let cleanD = s;
    if (parts.length === 3 && parts[0].length === 4) {
      cleanD = `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
    } else if (parts.length === 3) {
      cleanD = `${parts[0].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[2]}`;
    }
    return `${cleanD}_${Number(slotNo) || 1}`;
  }

  function getSlotMaterials(slot) {
    if (!slot || typeof lessonMaterialsMap === 'undefined' || !lessonMaterialsMap) return [];
    const k1 = `${slot.date}_${slot.slotNo}`;
    const k2 = normLessonMatKey(slot.date, slot.slotNo);
    const arr = lessonMaterialsMap[k1] || (k2 ? lessonMaterialsMap[k2] : null);
    if (!Array.isArray(arr) || arr.length === 0) return [];
    const valid = arr.filter((m) => m && (m.pdfData || m.pdfUrl || Number(m.chunkCount) > 0 || m.sourceType === 'chunks' || m.id));
    return valid;
  }

  function slotHasSharedMaterials(slot) {
    return getSlotMaterials(slot).length > 0;
  }

  function filterSlotsForGroupPreference(slots) {
    const activeLabGroup = state.lang === 'en' ? '' : state.myLabGroup;
    if (state.otherGroupMode !== 'hide' || (!state.myMbuGroup && !activeLabGroup)) {
      return { visibleSlots: slots, hiddenCount: 0 };
    }
    const visibleSlots = [];
    let hiddenCount = 0;
    for (const s of slots) {
      if (getSlotGroupStatus(s) === 'other' && !slotHasSharedMaterials(s)) {
        hiddenCount++;
      } else {
        visibleSlots.push(s);
      }
    }
    return { visibleSlots, hiddenCount };
  }

  function updateGroupFilterButtonUI() {
    const lbl = document.getElementById('btnGroupFilterLabel');
    const btn = document.getElementById('btnOpenGroupModal');
    if (!lbl || !btn) return;
    const loc = I18N[state.lang];
    const mbuPrefix = state.lang === 'en' ? 'PSP' : 'MBU';
    const hasMbu = Boolean(state.myMbuGroup);
    const hasLab = state.lang !== 'en' && Boolean(state.myLabGroup);
    let labelText = loc.groupSelectDefault;
    if (hasMbu && hasLab) {
      labelText = `${mbuPrefix} ${state.myMbuGroup} • LAB ${state.myLabGroup}`;
    } else if (hasMbu) {
      labelText = `${mbuPrefix}: ${state.myMbuGroup}`;
    } else if (hasLab) {
      labelText = `LAB: ${state.myLabGroup}`;
    }
    lbl.textContent = labelText;
    btn.title = labelText;
    btn.setAttribute('aria-label', labelText);
    btn.classList.toggle('text-blue-600', hasMbu || hasLab);
    btn.classList.toggle('dark:text-blue-400', hasMbu || hasLab);
  }

  function syncGroupModalUI() {
    const loc = I18N[state.lang];
    const labSection = document.getElementById('labGroupSection');
    if (labSection) labSection.classList.toggle('hidden', state.lang === 'en');
    document.querySelectorAll('[data-mbu-group]').forEach((b) => {
      const val = b.getAttribute('data-mbu-group');
      if (val === '') b.textContent = loc.groupAllLabel;
      b.classList.toggle('group-chip-active', val === state.myMbuGroup);
    });
    document.querySelectorAll('[data-lab-group]').forEach((b) => {
      const val = b.getAttribute('data-lab-group');
      if (val === '') b.textContent = loc.groupAllLabel;
      b.classList.toggle('group-chip-active', val === state.myLabGroup);
    });
    document.querySelectorAll('[data-other-mode]').forEach((b) => {
      const val = b.getAttribute('data-other-mode');
      b.textContent = val === 'hide' ? loc.otherModeHide : loc.otherModeDim;
      b.classList.toggle('group-chip-active', val === state.otherGroupMode);
    });
  }

  const modalCloseTimers = new WeakMap();

  const IS_IOS_HAPTIC_DEVICE = typeof navigator !== 'undefined' && (
    /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
  );

  let iosHapticInputEl = null;
  let iosHapticLabelEl = null;

  function ensureIosHapticSwitch() {
    if (iosHapticLabelEl && document.body && document.body.contains(iosHapticLabelEl)) {
      return iosHapticLabelEl;
    }
    if (!document.body) return null;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'iosHapticSwitchInput';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none;margin:0;padding:0;border:0;z-index:-1;';

    const label = document.createElement('label');
    label.id = 'iosHapticSwitchLabel';
    label.htmlFor = input.id;
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none;margin:0;padding:0;border:0;z-index:-1;';

    document.body.appendChild(input);
    document.body.appendChild(label);
    iosHapticInputEl = input;
    iosHapticLabelEl = label;
    return label;
  }

  function triggerIosHapticPulse() {
    try {
      const label = ensureIosHapticSwitch();
      if (label) label.click();
    } catch (e) {}
  }

  let lastHapticAt = 0;
  const HAPTIC_PATTERNS = {
    tick: 18,
    light: 24,
    medium: 36,
    success: [24, 48, 34],
    error: [36, 48, 36],
  };

  function triggerHaptic(kind = 'light', force = false) {
    if (!force && !state.hapticsEnabled) return;
    const now = Date.now();
    if (!force && now - lastHapticAt < 34) return;
    lastHapticAt = now;

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        const pattern = HAPTIC_PATTERNS[kind] ?? HAPTIC_PATTERNS.light;
        const ok = navigator.vibrate(pattern);
        if (ok) return;
      } catch (e) {}
    }

    if (IS_IOS_HAPTIC_DEVICE) {
      triggerIosHapticPulse();
    }
  }

  function syncModalScrollLock() {
    const hasOpenModal = Boolean(document.querySelector('.ios-safe-modal:not(.hidden), .ios-popover-backdrop:not(.hidden), #adminModal:not(.hidden), #adminSlotQuickModal:not(.hidden), #adminDateTimeModal:not(.hidden), #studentFeedbackModal:not(.hidden), #maintenanceGateOverlay:not(.hidden)'));
    document.documentElement.classList.toggle('modal-open', hasOpenModal);
  }

  function openAnimatedModal(modal, card, onOpenFocus) {
    if (!modal) return;
    const prevTimer = modalCloseTimers.get(modal);
    if (prevTimer) {
      clearTimeout(prevTimer);
      modalCloseTimers.delete(modal);
    }
    modal.classList.remove('hidden', 'modal-backdrop-out', 'modal-backdrop-in');
    if (card) card.classList.remove('modal-card-out', 'modal-card-in');
    syncModalScrollLock();
    void modal.offsetWidth;
    modal.classList.add('modal-backdrop-in');
    if (card) card.classList.add('modal-card-in');
    if (typeof onOpenFocus === 'function') {
      requestAnimationFrame(onOpenFocus);
    }
  }

  function closeAnimatedModal(modal, card, onClosed) {
    if (!modal || modal.classList.contains('hidden')) {
      syncModalScrollLock();
      if (typeof onClosed === 'function') onClosed();
      return;
    }
    const prevTimer = modalCloseTimers.get(modal);
    if (prevTimer) clearTimeout(prevTimer);

    modal.classList.remove('modal-backdrop-in');
    modal.classList.add('modal-backdrop-out');
    if (card) {
      card.classList.remove('modal-card-in');
      card.classList.add('modal-card-out');
    }
    const timer = setTimeout(() => {
      modalCloseTimers.delete(modal);
      modal.classList.add('hidden');
      modal.classList.remove('modal-backdrop-out');
      if (card) card.classList.remove('modal-card-out');
      syncModalScrollLock();
      if (typeof onClosed === 'function') onClosed();
    }, 205);
    modalCloseTimers.set(modal, timer);
  }

  function openGroupModal() {
    syncGroupModalUI();
    openAnimatedModal(document.getElementById('groupModal'), document.getElementById('groupModalCard'));
  }

  function closeGroupModal() {
    closeAnimatedModal(document.getElementById('groupModal'), document.getElementById('groupModalCard'));
  }

  function openInstallModal() {
    openAnimatedModal(document.getElementById('installModal'), document.getElementById('installModalCard'));
  }

  function closeInstallModal() {
    closeAnimatedModal(document.getElementById('installModal'), document.getElementById('installModalCard'));
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg) {
    const toast = document.getElementById('toastBanner');
    if (!toast) return;
    clearTimeout(toast._t);
    clearTimeout(toast._hideT);
    toast.textContent = msg;
    toast.classList.remove('hidden', 'ios-toast-out', 'ios-toast-in');
    void toast.offsetWidth;
    toast.classList.add('ios-toast-in');
    toast._t = setTimeout(() => {
      toast.classList.remove('ios-toast-in');
      toast.classList.add('ios-toast-out');
      toast._hideT = setTimeout(() => {
        toast.classList.add('hidden');
        toast.classList.remove('ios-toast-out');
      }, 200);
    }, 2200);
  }

  const VALID_PALETTES = ['medical-blue', 'surgical-navy', 'biochem-mint', 'anatomy-crimson'];

  function normalizePaletteKey(raw) {
    return VALID_PALETTES.includes(raw) ? raw : 'medical-blue';
  }

  const PALETTE_STATUS_BAR_COLORS = {
    'medical-blue': {
      lightTop: '#eef2f7',
      lightScrolled: '#f4f7fc',
      darkTop: '#071022',
      darkWeekly: '#061326',
      darkSearch: '#0a0d24',
      darkInfo: '#080e22',
      darkFood: '#141008',
      darkScrolled: '#0e1422',
    },
    'surgical-navy': {
      lightTop: '#e4ecfb',
      lightScrolled: '#eef4fd',
      darkTop: '#040b1e',
      darkWeekly: '#05102b',
      darkSearch: '#080e28',
      darkInfo: '#060d24',
      darkFood: '#120e09',
      darkScrolled: '#0a1533',
    },
    'biochem-mint': {
      lightTop: '#e2f5f1',
      lightScrolled: '#ecf9f6',
      darkTop: '#041b18',
      darkWeekly: '#041e1d',
      darkSearch: '#07191a',
      darkInfo: '#051a17',
      darkFood: '#111309',
      darkScrolled: '#092723',
    },
    'anatomy-crimson': {
      lightTop: '#fbe8ec',
      lightScrolled: '#fdf1f4',
      darkTop: '#1f060e',
      darkWeekly: '#210711',
      darkSearch: '#1b0714',
      darkInfo: '#1d070f',
      darkFood: '#180b0b',
      darkScrolled: '#2d0b16',
    },
  };

  const TAB_AMBIENT_STATUS_BAR_COLORS = {
    search: {
      lightTop: '#eeeff8',
      lightScrolled: '#f4f7fc',
      darkTop: '#0a0d24',
      darkScrolled: '#0e1422',
    },
    info: {
      lightTop: '#edeff8',
      lightScrolled: '#f4f7fc',
      darkTop: '#080e22',
      darkScrolled: '#0e1422',
    },
    food: {
      lightTop: '#f6f1e8',
      lightScrolled: '#f4f7fc',
      darkTop: '#141008',
      darkScrolled: '#0e1422',
    },
  };

  function getSystemThemeColor() {
    const y = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    const tab = state.activeTab || 'daily';
    if (tab === 'food' || tab === 'search' || tab === 'info') {
      const tabTheme = TAB_AMBIENT_STATUS_BAR_COLORS[tab];
      if (!state.darkMode) {
        return y > 15 ? tabTheme.lightScrolled : tabTheme.lightTop;
      }
      return y > 20 ? tabTheme.darkScrolled : tabTheme.darkTop;
    }
    const pal = PALETTE_STATUS_BAR_COLORS[normalizePaletteKey(state.palette)] || PALETTE_STATUS_BAR_COLORS['medical-blue'];
    if (!state.darkMode) {
      return y > 15 ? pal.lightScrolled : pal.lightTop;
    }
    if (y > 20) {
      return pal.darkScrolled;
    }
    return tab === 'weekly' ? pal.darkWeekly : pal.darkTop;
  }

  function syncSystemBarsThemeColor() {
    const color = getSystemThemeColor();
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', color);
    });
  }

  let themeTransitionTimer = null;
  function triggerThemeTransitionWindow() {
    const html = document.documentElement;
    clearTimeout(themeTransitionTimer);
    html.classList.add('theme-transitioning');
    themeTransitionTimer = setTimeout(() => {
      html.classList.remove('theme-transitioning');
    }, 480);
  }

  function applyTheme(animate = false) {
    const html = document.documentElement;
    const sun = document.getElementById('iconSun');
    const moon = document.getElementById('iconMoon');
    const appearanceSun = document.getElementById('appearanceSunIcon');
    const appearanceMoon = document.getElementById('appearanceMoonIcon');

    if (animate) triggerThemeTransitionWindow();

    if (state.darkMode) {
      html.classList.add('dark');
      if (sun) sun.classList.remove('hidden');
      if (moon) moon.classList.add('hidden');
      if (animate && sun) {
        sun.classList.remove('theme-icon-morph');
        void sun.offsetWidth;
        sun.classList.add('theme-icon-morph');
      }
      if (animate && appearanceMoon) {
        appearanceMoon.classList.remove('theme-icon-morph');
        void appearanceMoon.offsetWidth;
        appearanceMoon.classList.add('theme-icon-morph');
      }
    } else {
      html.classList.remove('dark');
      if (sun) sun.classList.add('hidden');
      if (moon) moon.classList.remove('hidden');
      if (animate && moon) {
        moon.classList.remove('theme-icon-morph');
        void moon.offsetWidth;
        moon.classList.add('theme-icon-morph');
      }
      if (animate && appearanceSun) {
        appearanceSun.classList.remove('theme-icon-morph');
        void appearanceSun.offsetWidth;
        appearanceSun.classList.add('theme-icon-morph');
      }
    }
    syncSystemBarsThemeColor();
    saveStore('darkMode', state.darkMode);
    syncPaletteModalUI();
    syncSettingsMenuUI(animate);
  }

  function applyPalette(paletteKey, animate = false) {
    const key = normalizePaletteKey(paletteKey);
    state.palette = key;
    if (animate) triggerThemeTransitionWindow();
    document.documentElement.setAttribute('data-palette', key);
    saveStore('palette', key);
    syncSystemBarsThemeColor();
    syncPaletteModalUI();
  }

  function syncPaletteModalUI() {
    const key = normalizePaletteKey(state.palette);

    document.querySelectorAll('[data-palette-choice]').forEach((btn) => {
      const choice = btn.getAttribute('data-palette-choice');
      const active = choice === key;
      btn.classList.toggle('border-blue-500/60', active);
      btn.classList.toggle('bg-blue-500/10', active);
      btn.classList.toggle('border-transparent', !active);
      const chk = btn.querySelector('.palette-check');
      if (chk) chk.style.opacity = active ? '1' : '0';
    });
  }

  function syncSettingsMenuUI(animate = false) {
    const bar = document.getElementById('appearanceSegmentedBar');
    const ind = document.getElementById('appearanceSegmentedIndicator');
    const btnLight = document.getElementById('btnAppearanceLight');
    const btnDark = document.getElementById('btnAppearanceDark');
    const sunIcon = document.getElementById('appearanceSunIcon');
    const moonIcon = document.getElementById('appearanceMoonIcon');
    const activeText = 'py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 font-semibold text-slate-900 dark:text-white transition-colors';
    const inactiveText = 'py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 font-medium text-slate-600 dark:text-slate-300 transition-colors';

    if (btnLight && btnDark) {
      btnLight.className = state.darkMode ? inactiveText : activeText;
      btnDark.className = state.darkMode ? activeText : inactiveText;
      btnLight.setAttribute('aria-pressed', String(!state.darkMode));
      btnDark.setAttribute('aria-pressed', String(Boolean(state.darkMode)));
      if (sunIcon) {
        sunIcon.classList.toggle('text-amber-500', !state.darkMode);
      }
      if (moonIcon) {
        moonIcon.classList.toggle('text-sky-400', Boolean(state.darkMode));
      }
      updateSegmentedIndicator(bar, ind, state.darkMode ? btnDark : btnLight, animate, '!rounded-xl');
    }

    const hapticsBtn = document.getElementById('btnToggleHaptics');
    if (hapticsBtn) {
      hapticsBtn.setAttribute('aria-checked', state.hapticsEnabled ? 'true' : 'false');
    }
    renderPdfCacheSettingsRow();
    syncPaletteModalUI();
  }

  let cachedPdfIds = new Set();
  let cachedPdfStats = { count: 0, totalBytes: 0 };

  function isPdfCachedOnDevice(materialId) {
    const cleanId = String(materialId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
    return Boolean(cleanId && cachedPdfIds.has(cleanId));
  }

  function renderPdfCacheSettingsRow() {
    const loc = I18N[state.lang];
    const lbl = document.getElementById('lblSettingsPdfCache');
    const statsEl = document.getElementById('settingsPdfCacheStats');
    const clearBtn = document.getElementById('btnClearPdfCache');
    if (lbl) lbl.textContent = loc.settingsPdfCacheLabel;
    if (clearBtn) {
      clearBtn.textContent = loc.settingsPdfCacheClearBtn;
      clearBtn.disabled = cachedPdfStats.count === 0;
    }
    if (statsEl) {
      statsEl.textContent =
        cachedPdfStats.count > 0
          ? loc.settingsPdfCacheStats(cachedPdfStats.count, formatPdfBytesLabel(cachedPdfStats.totalBytes))
          : loc.settingsPdfCacheEmpty;
    }
  }

  async function refreshPdfCacheStatsUI(rerenderIfChanged = true) {
    const api = window.__INONU_AUTH__;
    if (!api || typeof api.getLessonPdfCacheStats !== 'function') {
      renderPdfCacheSettingsRow();
      return;
    }
    try {
      const prevSig = Array.from(cachedPdfIds).sort().join(',');
      const res = await api.getLessonPdfCacheStats();
      const nextIds = new Set(Array.isArray(res && res.cachedIds) ? res.cachedIds : []);
      cachedPdfIds = nextIds;
      cachedPdfStats = {
        count: Number(res && res.count) || nextIds.size,
        totalBytes: Number(res && res.totalBytes) || 0,
      };
      renderPdfCacheSettingsRow();
      const nextSig = Array.from(cachedPdfIds).sort().join(',');
      if (rerenderIfChanged && prevSig !== nextSig) {
        invalidateScheduleRenderCache();
        runWithStaggerSuppressed(() => {
          if (state.activeTab === 'daily') renderDailyView();
          if (state.activeTab === 'weekly') renderWeeklyView();
        });
      }
    } catch {
      renderPdfCacheSettingsRow();
    }
  }

  function updateOfflineBannerUI() {
    const banner = document.getElementById('offlineStatusBanner');
    const txt = document.getElementById('offlineStatusBannerText');
    if (!banner) return;
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (txt) {
      let baseText = I18N[state.lang].offlineBannerText;
      try {
        const lastMs = Number(localStorage.getItem(LAST_SYNC_LS_KEY) || 0);
        if (lastMs > 0) {
          const d = new Date(lastMs);
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          baseText += state.lang === 'en' ? ` · Synced ${hh}:${mm}` : ` · Son eşitleme ${hh}:${mm}`;
        }
      } catch (e) {}
      txt.textContent = baseText;
    }
    banner.classList.toggle('hidden', !isOffline);
    banner.classList.toggle('is-visible', isOffline);
  }

  function openSettingsMenu() {
    const modal = document.getElementById('settingsMenuModal');
    const card = document.getElementById('settingsMenuCard');
    const trigger = document.getElementById('btnOpenSettingsMenu');
    if (!modal || !card) return;
    if (trigger) {
      trigger.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    void refreshPdfCacheStatsUI(false);
    openAnimatedModal(modal, card, () => syncSettingsMenuUI(false));
  }

  function closeSettingsMenu() {
    const modal = document.getElementById('settingsMenuModal');
    const card = document.getElementById('settingsMenuCard');
    const trigger = document.getElementById('btnOpenSettingsMenu');
    if (trigger) {
      trigger.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    closeAnimatedModal(modal, card);
  }

  function toggleSettingsMenu() {
    const modal = document.getElementById('settingsMenuModal');
    if (!modal || modal.classList.contains('hidden')) {
      openSettingsMenu();
    } else {
      closeSettingsMenu();
    }
  }

  function openPaletteModal() {
    syncPaletteModalUI();
    openAnimatedModal(document.getElementById('paletteModal'), document.getElementById('paletteModalCard'));
  }

  function closePaletteModal() {
    closeAnimatedModal(document.getElementById('paletteModal'), document.getElementById('paletteModalCard'));
  }

  function updateSegmentedIndicator(barEl, indicatorEl, activeBtn, animate = true, extraClass = '') {
    if (!barEl || !indicatorEl) return;
    if (!activeBtn || activeBtn.offsetWidth === 0 || activeBtn.offsetHeight === 0) {
      indicatorEl.style.opacity = '0';
      return;
    }
    const left = activeBtn.offsetLeft;
    const top = activeBtn.offsetTop;
    const width = activeBtn.offsetWidth;
    const height = activeBtn.offsetHeight;
    const prev = barEl._lastSegPos;
    barEl._lastSegPos = { left, top, width, height };

    indicatorEl.className = `segmented-pill-indicator${extraClass ? ' ' + extraClass : ''}`;
    indicatorEl.style.opacity = '1';

    if (animate && prev && (prev.left !== left || prev.width !== width)) {
      indicatorEl.style.transition = 'none';
      indicatorEl.style.width = `${prev.width}px`;
      indicatorEl.style.height = `${prev.height}px`;
      indicatorEl.style.transform = `translate3d(${prev.left}px, ${prev.top}px, 0)`;
      indicatorEl.getBoundingClientRect();
      indicatorEl.style.transition = '';
      requestAnimationFrame(() => {
        indicatorEl.style.width = `${width}px`;
        indicatorEl.style.height = `${height}px`;
        indicatorEl.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      });
    } else {
      if (!animate) indicatorEl.style.transition = 'none';
      indicatorEl.style.width = `${width}px`;
      indicatorEl.style.height = `${height}px`;
      indicatorEl.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      if (!animate) {
        indicatorEl.getBoundingClientRect();
        indicatorEl.style.transition = '';
      }
    }
  }

  function syncLiveSlotHighlightsInPlace() {
    const cards = document.querySelectorAll('[data-slot-key]');
    cards.forEach((card) => {
      const slotDate = card.getAttribute('data-slot-date') || '';
      const slotTime = card.getAttribute('data-slot-time') || '';
      if (!slotDate || !slotTime) return;
      const nowLive = isSlotCurrentlyLive({ date: slotDate, time: slotTime });
      const wasLive = card.getAttribute('data-slot-live') === '1';
      if (nowLive === wasLive) return;
      card.setAttribute('data-slot-live', nowLive ? '1' : '0');
      card.classList.toggle('ring-2', nowLive);
      card.classList.toggle('ring-blue-500/50', nowLive);
      const existingDot = card.querySelector('.live-slot-dot');
      if (nowLive && !existingDot) {
        const metaRow = card.querySelector('.slot-meta-row');
        if (metaRow) {
          const liveDot = document.createElement('span');
          liveDot.className = 'live-slot-dot w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0';
          metaRow.appendChild(liveDot);
        }
      } else if (!nowLive && existingDot) {
        existingDot.remove();
      }
    });
  }

  function updateHeaderClock() {
    const now = new Date();
    const loc = I18N[state.lang];
    const text = `${loc.todayPrefix}${now.getDate()} ${loc.months[now.getMonth()].toUpperCase()} ${now.getFullYear()} ${loc.days[now.getDay()].toUpperCase()}`;
    document.getElementById('headerLiveClock').textContent = text;
    syncLiveSlotHighlightsInPlace();
  }

  // ==================== LANGUAGE SWITCHER ====================
  function applyLanguageUI(animateLangIndicator = false) {
    const loc = I18N[state.lang];
    document.documentElement.lang = state.lang;
    document.title = loc.pageTitle;

    const btnTr = document.getElementById('btnLangTr');
    const btnEn = document.getElementById('btnLangEn');
    const btnAuthTr = document.getElementById('btnAuthLangTr');
    const btnAuthEn = document.getElementById('btnAuthLangEn');
    const activeLangCls = 'px-2 py-1 rounded-full font-semibold text-slate-900 dark:text-white transition-colors';
    const inactiveLangCls = 'px-2 py-1 rounded-full font-medium text-slate-600 dark:text-slate-300 transition-colors';
    if (btnTr && btnEn) {
      btnTr.className = state.lang === 'tr' ? activeLangCls : inactiveLangCls;
      btnEn.className = state.lang === 'en' ? activeLangCls : inactiveLangCls;
      updateSegmentedIndicator(
        document.getElementById('langSegmentedBar'),
        document.getElementById('langSegmentedIndicator'),
        state.lang === 'tr' ? btnTr : btnEn,
        animateLangIndicator
      );
    }
    if (btnAuthTr && btnAuthEn) {
      btnAuthTr.className = state.lang === 'tr' ? activeLangCls : inactiveLangCls;
      btnAuthEn.className = state.lang === 'en' ? activeLangCls : inactiveLangCls;
      updateSegmentedIndicator(
        document.getElementById('authLangSegmentedBar'),
        document.getElementById('authLangSegmentedIndicator'),
        state.lang === 'tr' ? btnAuthTr : btnAuthEn,
        animateLangIndicator
      );
    }

    const authBadgeEl = document.getElementById('authFacultyBadge');
    if (authBadgeEl) authBadgeEl.textContent = loc.authFacultyBadge;
    const authTitleEl = document.getElementById('authTitle');
    if (authTitleEl) authTitleEl.textContent = loc.authTitle;
    const authLabelEl = document.getElementById('authInputLabel');
    if (authLabelEl) authLabelEl.textContent = loc.authInputLabel;
    const authInputEl = document.getElementById('authStudentIdInput');
    if (authInputEl) authInputEl.placeholder = loc.authInputPlaceholder;
    const authPrivacyEl = document.getElementById('authPrivacyHint');
    if (authPrivacyEl) authPrivacyEl.textContent = loc.authPrivacyHint;
    const authAdminPwdLbl = document.getElementById('authAdminPwdLabel');
    if (authAdminPwdLbl) authAdminPwdLbl.textContent = loc.authAdminPwdLabel;
    const authAdminPwdBdg = document.getElementById('authAdminPwdBadge');
    if (authAdminPwdBdg) authAdminPwdBdg.textContent = loc.authAdminPwdBadge;
    const authBackBtnEl = document.getElementById('btnAuthBackToId');
    if (authBackBtnEl) authBackBtnEl.textContent = loc.authAdminChangeIdBtn;
    if (typeof syncAuthStepUI === 'function') syncAuthStepUI();
    const adminCardTitleEl = document.getElementById('adminCardTitle');
    if (adminCardTitleEl) adminCardTitleEl.textContent = loc.adminCardTitle;
    const adminCardDescEl = document.getElementById('adminCardDesc');
    if (adminCardDescEl) adminCardDescEl.textContent = loc.adminCardDesc;
    const btnOpenAdminEl = document.getElementById('btnOpenAdminModal');
    if (btnOpenAdminEl) btnOpenAdminEl.textContent = loc.adminOpenBtn;
    if (typeof syncAdminModalLanguageUI === 'function') syncAdminModalLanguageUI();
    if (typeof renderDailyAnnouncements === 'function') renderDailyAnnouncements();
    updateAuthSessionSummary();

    document.getElementById('headerAppTitle').textContent = loc.headerTitle;
    document.getElementById('btnJumpTodayTop').textContent = loc.today;
    document.getElementById('btnBannerToday').textContent = loc.today;
    document.getElementById('btnBannerTomorrow').textContent = loc.tomorrow;
    document.getElementById('carouselSwipeHint').textContent = loc.swipeHint;
    document.getElementById('btnExportDayIcsLabel').textContent = loc.exportDayIcs;
    document.getElementById('btnExportWeekIcsLabel').textContent = loc.exportWeekIcs;

    document.getElementById('weeklyViewTitle').textContent = loc.weeklyTitle;
    document.getElementById('weeklyViewSubtitle').textContent = loc.weeklySubtitle;
    document.getElementById('btnFilterKurulAll').textContent = loc.filterAll;
    document.getElementById('btnFilterKurul1').textContent = loc.filterK1;
    document.getElementById('btnFilterKurul2').textContent = loc.filterK2;

    document.getElementById('inputSearchQuery').placeholder = loc.searchPlaceholder;
    document.getElementById('btnClearSearch').textContent = loc.clearSearch;

    document.getElementById('infoCalcTitle').textContent = loc.infoCalcTitle;
    document.getElementById('lblAraSinav').textContent = loc.lblAraSinav;
    document.getElementById('lblKurulSonu').textContent = loc.lblKurulSonu;
    document.getElementById('lblPratikSinav').textContent = loc.lblPratikSinav;
    document.getElementById('lblPratikAgirlik').textContent = loc.lblPratikAgirlik;
    document.getElementById('lblTeorikOrt').textContent = loc.lblTeorikOrt;
    document.getElementById('lblKurulPuan').textContent = loc.lblKurulPuan;
    document.getElementById('lblFinalSectionTitle').textContent = loc.lblFinalSectionTitle;
    document.getElementById('btnSyncKurulOrt').textContent = loc.btnSyncKurulOrt;
    document.getElementById('lblKurullarOrt').textContent = loc.lblKurullarOrt;
    document.getElementById('lblHedefYil').textContent = loc.lblHedefYil;
    document.getElementById('infoExamsTitle').textContent = loc.infoExamsTitle;

    document.getElementById('groupModalTitle').textContent = loc.groupModalTitle;
    document.getElementById('groupModalDesc').textContent = loc.groupModalDesc;
    document.getElementById('lblMyMbuGroup').textContent = loc.lblMyMbuGroup;
    document.getElementById('lblMyLabGroup').textContent = loc.lblMyLabGroup;
    document.getElementById('lblOtherGroupMode').textContent = loc.lblOtherGroupMode;
    document.getElementById('btnResetGroupFilter').textContent = loc.groupReset;
    document.getElementById('btnDoneGroupModal').textContent = loc.groupDone;
    updateGroupFilterButtonUI();
    syncGroupModalUI();

    document.getElementById('installBadge').textContent = loc.installBadge;
    document.getElementById('installTitle').textContent = loc.installTitle;
    document.getElementById('installDesc').textContent = loc.installDesc;
    document.getElementById('btnInstallAppLabel').textContent = loc.installBtn;
    document.getElementById('installStepsList').innerHTML = loc.installStepsHtml;

    document.getElementById('noteModalTitle').textContent = loc.noteModalTitle;
    document.getElementById('noteModalTextarea').placeholder = loc.notePlaceholder;
    document.getElementById('btnDeleteNote').textContent = loc.noteDelete;
    document.getElementById('btnSaveNote').textContent = loc.noteSave;

    const openInstallBtn = document.getElementById('btnOpenInstallModal');
    if (openInstallBtn) {
      openInstallBtn.setAttribute('aria-label', loc.installBtn);
      openInstallBtn.setAttribute('title', loc.installBtn);
    }

    document.getElementById('navLabelDaily').textContent = loc.navDaily;
    document.getElementById('navLabelWeekly').textContent = loc.navWeekly;
    document.getElementById('navLabelFood').textContent = loc.navFood;
    document.getElementById('navLabelSearch').textContent = loc.navSearch;
    document.getElementById('navLabelInfo').textContent = loc.navInfo;

    document.getElementById('btnFoodModeDaily').textContent = loc.foodModeDaily;
    document.getElementById('btnFoodModeWeekly').textContent = loc.foodModeWeekly;
    document.getElementById('foodCarouselSwipeHint').textContent = loc.swipeHint;
    document.getElementById('btnFoodPrevLabel').textContent = loc.prevDay;
    document.getElementById('btnFoodNextLabel').textContent = loc.nextDay;
    document.getElementById('foodReserveLink').textContent = loc.foodReserveLabel;

    const dailyDatePickerBtn = document.getElementById('btnDailyDatePicker');
    if (dailyDatePickerBtn) dailyDatePickerBtn.setAttribute('aria-label', loc.dailyDatePickerTitle);
    const dailyDateTitle = document.getElementById('dailyDateModalTitle');
    if (dailyDateTitle) dailyDateTitle.textContent = loc.dailyDatePickerTitle;
    const btnDailyCalToday = document.getElementById('btnDailyCalJumpToday');
    if (btnDailyCalToday) btnDailyCalToday.textContent = loc.today;
    const btnDailyCalK1 = document.getElementById('btnDailyCalJumpK1');
    if (btnDailyCalK1) btnDailyCalK1.textContent = loc.filterK1;
    const btnDailyCalK2 = document.getElementById('btnDailyCalJumpK2');
    if (btnDailyCalK2) btnDailyCalK2.textContent = loc.filterK2;
    const dailyLegendCls = document.getElementById('dailyCalLegendClass');
    if (dailyLegendCls) dailyLegendCls.textContent = loc.dailyCalLegendClass;
    const dailyLegendEx = document.getElementById('dailyCalLegendExam');
    if (dailyLegendEx) dailyLegendEx.textContent = loc.dailyCalLegendExam;
    const dailyPrevMonthBtn = document.getElementById('btnDailyCalPrevMonth');
    if (dailyPrevMonthBtn) dailyPrevMonthBtn.setAttribute('aria-label', loc.foodPrevMonthAria);
    const dailyNextMonthBtn = document.getElementById('btnDailyCalNextMonth');
    if (dailyNextMonthBtn) dailyNextMonthBtn.setAttribute('aria-label', loc.foodNextMonthAria);
    const dailyDateModalEl = document.getElementById('dailyDateModal');
    if (dailyDateModalEl && !dailyDateModalEl.classList.contains('hidden')) {
      renderDailyDateModalCarousel(true);
    }

    const palModalTitle = document.getElementById('paletteModalTitle');
    if (palModalTitle) palModalTitle.textContent = loc.paletteModalTitle;
    const palModalDesc = document.getElementById('paletteModalDesc');
    if (palModalDesc) palModalDesc.textContent = loc.paletteModalDesc;
    const setPalTxt = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
    setPalTxt('palNameMedicalBlue', loc.paletteNames['medical-blue']);
    setPalTxt('palDescMedicalBlue', loc.paletteDescs['medical-blue']);
    setPalTxt('palNameSurgicalNavy', loc.paletteNames['surgical-navy']);
    setPalTxt('palDescSurgicalNavy', loc.paletteDescs['surgical-navy']);
    setPalTxt('palNameBiochemMint', loc.paletteNames['biochem-mint']);
    setPalTxt('palDescBiochemMint', loc.paletteDescs['biochem-mint']);
    setPalTxt('palNameAnatomyCrimson', loc.paletteNames['anatomy-crimson']);
    setPalTxt('palDescAnatomyCrimson', loc.paletteDescs['anatomy-crimson']);
    setPalTxt('palMenuNameMedicalBlue', loc.paletteNames['medical-blue']);
    setPalTxt('palMenuNameSurgicalNavy', loc.paletteNames['surgical-navy']);
    setPalTxt('palMenuNameBiochemMint', loc.paletteNames['biochem-mint']);
    setPalTxt('palMenuNameAnatomyCrimson', loc.paletteNames['anatomy-crimson']);
    setPalTxt('settingsMenuTitle', loc.settingsTitle);
    setPalTxt('lblSettingsAppearance', loc.settingsAppearanceLabel);
    setPalTxt('lblAppearanceLight', loc.settingsLight);
    setPalTxt('lblAppearanceDark', loc.settingsDark);
    setPalTxt('lblSettingsPalette', loc.settingsPaletteLabel);
    setPalTxt('lblSettingsHaptics', loc.settingsHapticsLabel);
    setPalTxt('descSettingsHaptics', loc.settingsHapticsDesc);
    setPalTxt('lblSettingsPdfCache', loc.settingsPdfCacheLabel);
    setPalTxt('offlineStatusBannerText', loc.offlineBannerText);
    const openSettingsBtn = document.getElementById('btnOpenSettingsMenu');
    if (openSettingsBtn) {
      openSettingsBtn.setAttribute('aria-label', loc.settingsTitle);
      openSettingsBtn.setAttribute('title', loc.settingsTitle);
    }
    syncSettingsMenuUI(false);
    syncPaletteModalUI();
    updateOfflineBannerUI();

    const foodDatePickerBtn = document.getElementById('btnFoodDatePicker');
    if (foodDatePickerBtn) {
      foodDatePickerBtn.setAttribute('aria-label', loc.foodDatePickerTitle);
    }
    const foodDateTitle = document.getElementById('foodDateModalTitle');
    if (foodDateTitle) foodDateTitle.textContent = loc.foodDatePickerTitle;
    const foodPrevMonthBtn = document.getElementById('btnFoodCalPrevMonth');
    if (foodPrevMonthBtn) foodPrevMonthBtn.setAttribute('aria-label', loc.foodPrevMonthAria);
    const foodNextMonthBtn = document.getElementById('btnFoodCalNextMonth');
    if (foodNextMonthBtn) foodNextMonthBtn.setAttribute('aria-label', loc.foodNextMonthAria);
    const foodDateModal = document.getElementById('foodDateModal');
    if (foodDateModal && !foodDateModal.classList.contains('hidden')) {
      renderFoodDateModalCarousel(true);
    }

    updateHeaderClock();
  }

  function animateActiveViewLanguageSwitch() {
    triggerAmbientBloom();
    const activeSection = document.getElementById('view' + state.activeTab.charAt(0).toUpperCase() + state.activeTab.slice(1));
    if (!activeSection) return;
    activeSection.querySelectorAll('.ios-tab-card').forEach((card, idx) => {
      card.classList.remove('ios-stagger-item', 'ios-lang-swap');
      card.style.setProperty('--lang-delay', `${Math.min(idx, 4) * 35}ms`);
      requestAnimationFrame(() => {
        card.classList.add('ios-lang-swap');
        card.addEventListener('animationend', () => {
          card.classList.remove('ios-lang-swap');
          card.style.removeProperty('--lang-delay');
        }, { once: true });
      });
    });
  }

  function setLanguage(lang) {
    if (lang !== 'tr' && lang !== 'en') return;
    if (state.lang === lang) return;
    state.lang = lang;
    saveStore('lang', lang);
    saveCurrentStudentPrefs(true);
    applyLanguageUI(true);
    renderDailyAnnouncements();
    if (!announcementsInitialFetchDone) {
      void refreshDailyAnnouncements(false);
    }
    if (state.activeTab === 'daily') renderDailyView();
    if (state.activeTab === 'weekly') renderWeeklyView();
    if (state.activeTab === 'food') renderFoodView();
    if (state.activeTab === 'search') renderSearchView();
    if (state.activeTab === 'info') renderInfoView();
    animateActiveViewLanguageSwitch();
    requestAnimationFrame(() => updateTabIndicator(state.activeTab, false));
  }

  // ==================== iOS 18 LIQUID GLASS DOCK INDICATOR ====================
  const TAB_ORDER = ['daily', 'weekly', 'search', 'info', 'food'];

  const PILL_SPRING = 'transform 0.36s cubic-bezier(0.22, 1, 0.36, 1), width 0.36s cubic-bezier(0.22, 1, 0.36, 1)';
  let lastVisualActiveTab = null;

  function getDockPillBounds(dock, btn) {
    const left = btn.offsetLeft;
    const width = btn.offsetWidth;
    return { left, width, center: left + width / 2 };
  }

  function updateTabIndicator(tabName, animate = true) {
    const dock = document.getElementById('dockContainer');
    const pill = document.getElementById('tabIndicatorPill');
    const btn = dock && dock.querySelector(`.nav-tab-btn[data-tab="${tabName}"]`);
    if (!btn || !pill) return;

    setDockActiveVisual(tabName, !animate);
    if (btn.offsetWidth === 0) return;
    const bounds = getDockPillBounds(dock, btn);

    pill.setAttribute('data-active-tab', tabName);
    pill.classList.remove('is-dragging');

    if (!animate) {
      pill.style.transition = 'none';
    } else {
      pill.style.transition = PILL_SPRING;
    }

    pill.style.transform = `translate3d(${bounds.left}px, 0, 0)`;
    pill.style.width = `${bounds.width}px`;

    if (!animate) {
      pill.getBoundingClientRect();
      pill.style.transition = PILL_SPRING;
    }
  }

  let forceInstantCarouselSync = false;
  let isTabSwitchRender = false;
  let suppressEntryStagger = false;

  function runWithStaggerSuppressed(fn) {
    const prev = suppressEntryStagger;
    suppressEntryStagger = true;
    try {
      return fn();
    } finally {
      suppressEntryStagger = prev;
    }
  }

  function updateHeaderScrollState() {
    const header = document.getElementById('appHeader');
    if (!header) return;
    const y = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    const ratio = Math.min(1, Math.max(0, y / 50));
    const eased = 1 - Math.pow(1 - ratio, 2.5);
    header.style.setProperty('--header-scroll-ratio', eased.toFixed(3));
    header.classList.toggle('is-scrolled', y > 4);
    syncSystemBarsThemeColor();
  }

  function triggerAmbientBloom() {
    const aura = document.getElementById('ambientAura');
    if (!aura) return;
    const next = aura.getAttribute('data-bloom') === 'b' ? 'a' : 'b';
    aura.setAttribute('data-bloom', next);
  }

  function activateTabView(tabName, preserveScroll = false) {
    const prevTab = state.activeTab;
    const changed = prevTab !== tabName;
    const prevTabIdx = TAB_ORDER.indexOf(prevTab);
    const nextTabIdx = TAB_ORDER.indexOf(tabName);
    const tabDir = (changed && !preserveScroll && prevTabIdx >= 0 && nextTabIdx >= 0)
      ? (nextTabIdx > prevTabIdx ? 1 : -1)
      : 0;

    if (changed && !preserveScroll) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      updateHeaderScrollState();
      if (tabName === 'daily' || tabName === 'food') {
        forceInstantCarouselSync = true;
      }
    } else if (preserveScroll && (tabName === 'daily' || tabName === 'food')) {
      forceInstantCarouselSync = true;
    }

    state.activeTab = tabName;
    document.body.setAttribute('data-active-tab', tabName);
    syncSystemBarsThemeColor();
    if (changed && !preserveScroll) {
      triggerAmbientBloom();
    }
    let wasTargetHidden = false;
    ['daily', 'weekly', 'food', 'search', 'info'].forEach((tKey) => {
      const el = document.getElementById('view' + tKey.charAt(0).toUpperCase() + tKey.slice(1));
      if (!el) return;
      const isTarget = tKey === tabName;
      const wasHidden = el.classList.contains('hidden');
      if (isTarget && wasHidden) wasTargetHidden = true;
      el.classList.remove('tab-enter-right', 'tab-enter-left');
      el.classList.toggle('hidden', !isTarget);
      if (isTarget && tabDir !== 0) {
        void el.offsetWidth;
        el.classList.add(tabDir > 0 ? 'tab-enter-right' : 'tab-enter-left');
        el.addEventListener('animationend', () => {
          el.classList.remove('tab-enter-right', 'tab-enter-left');
        }, { once: true });
      }
      el.querySelectorAll('.ios-tab-card').forEach((card) => {
        if (!isTarget || preserveScroll) {
          card.classList.remove('ios-stagger-item', 'ios-lang-swap');
          card.style.removeProperty('--stagger-delay');
        } else if (changed || wasHidden) {
          const rawStep = card.getAttribute('data-tab-stagger');
          const delayMs = rawStep === 'last' ? 190 : (Number(rawStep) || 0) * 45;
          card.classList.remove('ios-lang-swap');
          card.style.setProperty('--stagger-delay', `${delayMs}ms`);
          card.classList.add('ios-stagger-item');
        }
      });
    });

    const prevSuppress = suppressEntryStagger;
    if (preserveScroll) suppressEntryStagger = true;
    isTabSwitchRender = (changed || wasTargetHidden) && !preserveScroll;
    try {
      if (tabName === 'daily') renderDailyView();
      if (tabName === 'weekly') renderWeeklyView();
      if (tabName === 'food') renderFoodView();
      if (tabName === 'search') renderSearchView();
      if (tabName === 'info') renderInfoView();
    } finally {
      isTabSwitchRender = false;
      forceInstantCarouselSync = false;
      suppressEntryStagger = prevSuppress;
    }

    persistNavViewState();
    requestAnimationFrame(updateHeaderScrollState);
  }

  function setDockActiveVisual(tabName, syncOnly = false) {
    if (!syncOnly && lastVisualActiveTab === tabName) return;
    lastVisualActiveTab = tabName;
    const pill = document.getElementById('tabIndicatorPill');
    if (pill) pill.setAttribute('data-active-tab', tabName);

    document.querySelectorAll('.nav-tab-btn').forEach((b) => {
      const isAct = b.getAttribute('data-tab') === tabName;
      const iconWrap = b.querySelector('.nav-icon-wrap');
      const svg = b.querySelector('svg');
      b.classList.toggle('is-active', isAct);
      if (iconWrap) iconWrap.style.transform = isAct ? 'scale(1.1)' : 'scale(1)';
      if (svg) svg.setAttribute('stroke-width', isAct ? '2.2' : '1.9');
      if (!isAct && typeof b.blur === 'function') {
        b.blur();
      }
    });
  }

  function setupDockInteractiveDrag() {
    const dock = document.getElementById('dockContainer');
    const pill = document.getElementById('tabIndicatorPill');
    if (!dock || !pill) return;

    // Prevent sticky focus or outline on dock buttons
    dock.querySelectorAll('.nav-tab-btn').forEach((btn) => {
      btn.setAttribute('tabindex', '-1');
      btn.addEventListener('focus', () => {
        if (document.activeElement === btn) btn.blur();
      });
    });

    const navEl = document.getElementById('appNav');
    let isDragging = false;
    let didMove = false;
    let isAdminVerticalSwipe = false;
    let startX = 0;
    let startY = 0;
    let currentTargetTab = state.activeTab;
    let metrics = null;
    let currentPillX = 0;
    let targetPillX = 0;
    let pillWidth = 0;
    let rafId = null;

    function resetNavVerticalLift() {
      if (!navEl) return;
      navEl.style.transition = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)';
      navEl.style.transform = '';
      window.setTimeout(() => {
        if (!isAdminVerticalSwipe && navEl) navEl.style.transition = '';
      }, 260);
    }

    function measureDock() {
      const rect = dock.getBoundingClientRect();
      const btns = Array.from(dock.querySelectorAll('.nav-tab-btn')).map((btn) => {
        const b = getDockPillBounds(dock, btn);
        return {
          el: btn,
          tab: btn.getAttribute('data-tab'),
          left: b.left,
          width: b.width,
          center: b.center
        };
      });
      return { rectLeft: rect.left, width: rect.width, btns };
    }

    function getClosestBtn(clientX) {
      if (!metrics || !metrics.btns || metrics.btns.length === 0) return null;
      const relX = Math.max(4, Math.min(metrics.width - 4, clientX - metrics.rectLeft));
      let closest = metrics.btns[0];
      let minDist = Infinity;
      for (let i = 0; i < metrics.btns.length; i++) {
        const d = Math.abs(relX - metrics.btns[i].center);
        if (d < minDist) {
          minDist = d;
          closest = metrics.btns[i];
        }
      }
      return closest;
    }

    function tickDrag() {
      if (!isDragging || !didMove || isAdminVerticalSwipe) {
        rafId = null;
        return;
      }
      const diff = targetPillX - currentPillX;
      currentPillX += Math.abs(diff) < 0.2 ? diff : diff * 0.45;
      pill.style.transform = `translate3d(${currentPillX.toFixed(2)}px, 0, 0)`;
      rafId = requestAnimationFrame(tickDrag);
    }

    dock.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      isDragging = true;
      didMove = false;
      isAdminVerticalSwipe = false;
      startX = e.clientX;
      startY = e.clientY;
      currentTargetTab = state.activeTab;
      metrics = measureDock();

      const activeInfo = metrics.btns.find((b) => b.tab === state.activeTab) || metrics.btns[0];
      currentPillX = activeInfo.left;
      targetPillX = activeInfo.left;
      pillWidth = activeInfo.width;

      try { dock.setPointerCapture(e.pointerId); } catch (err) {}
    }, { passive: true });

    dock.addEventListener('pointermove', (e) => {
      if (!isDragging || !metrics) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      const upwardDy = startY - e.clientY;
      const isAdminNow = Boolean(getActiveAuthSession()?.isAdmin) && !isSiteLoginLocked();

      // Admin-only upward swipe gesture: lift dock smoothly & prevent tab pill switching
      if (isAdminNow && !isAdminVerticalSwipe && upwardDy > 12 && upwardDy > dx * 1.15) {
        isAdminVerticalSwipe = true;
        didMove = false;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        dock.classList.remove('is-dock-dragging');
        pill.classList.remove('is-dragging');
        currentTargetTab = state.activeTab;
        setDockActiveVisual(state.activeTab);
        updateTabIndicator(state.activeTab, false);
      }

      if (isAdminVerticalSwipe) {
        if (navEl) {
          const lift = Math.max(0, Math.min(24, Math.round((upwardDy - 10) * 0.42)));
          navEl.style.transition = 'none';
          navEl.style.transform = `translate3d(0, -${lift}px, 0)`;
        }
        return;
      }

      if (!didMove) {
        if (dx <= 6 && dy <= 6) return;
        didMove = true;
        dock.classList.add('is-dock-dragging');
        pill.style.transition = 'none';
        pill.classList.add('is-dragging');
        if (!rafId) rafId = requestAnimationFrame(tickDrag);
      }

      const hoverBtn = getClosestBtn(e.clientX);
      if (hoverBtn) {
        targetPillX = Math.max(4, Math.min(metrics.width - pillWidth - 4, e.clientX - metrics.rectLeft - pillWidth / 2));
        if (hoverBtn.tab && hoverBtn.tab !== currentTargetTab) {
          currentTargetTab = hoverBtn.tab;
          setDockActiveVisual(currentTargetTab);
          triggerHaptic('tick');
        }
      }
    }, { passive: true });

    function endDrag(e) {
      if (!isDragging) return;
      isDragging = false;
      const wasVerticalSwipe = isAdminVerticalSwipe;
      isAdminVerticalSwipe = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      try { dock.releasePointerCapture(e.pointerId); } catch (err) {}

      if (wasVerticalSwipe) {
        resetNavVerticalLift();
      }

      dock.classList.remove('is-dock-dragging');
      pill.classList.remove('is-dragging');
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      document.querySelectorAll('.nav-tab-btn').forEach((b) => {
        const isTarget = b.getAttribute('data-tab') === currentTargetTab;
        if (!isTarget) {
          b.classList.remove('is-active');
        }
        if (typeof b.blur === 'function') b.blur();
      });

      const upwardDy = startY - e.clientY;
      const horizontalDx = Math.abs(e.clientX - startX);
      const isAdminUpwardSwipe =
        Boolean(getActiveAuthSession()?.isAdmin) &&
        !isSiteLoginLocked() &&
        upwardDy > 34 &&
        upwardDy > horizontalDx * 1.15;

      if (isAdminUpwardSwipe) {
        setDockActiveVisual(state.activeTab);
        updateTabIndicator(state.activeTab, true);
        metrics = null;
        if (window.__INONU_BOTTOM_SHEET__?.open) {
          window.__INONU_BOTTOM_SHEET__.open();
        } else {
          triggerHaptic('selection');
          openAdminModal('hub');
        }
        return;
      }

      if (wasVerticalSwipe) {
        setDockActiveVisual(state.activeTab);
        updateTabIndicator(state.activeTab, true);
        metrics = null;
        return;
      }

      if (didMove) {
        triggerHaptic('tick');
        switchTab(currentTargetTab, true);
      } else if (e.type !== 'pointercancel') {
        const hit = (e.target && e.target.closest && e.target.closest('.nav-tab-btn'));
        const closestBtn = metrics && getClosestBtn(e.clientX);
        const clickedTab = (hit && hit.getAttribute('data-tab')) || (closestBtn && closestBtn.tab);
        if (clickedTab) {
          triggerHaptic('tick');
          switchTab(clickedTab, true);
        }
      }
      metrics = null;
    }

    dock.addEventListener('pointerup', endDrag);
    dock.addEventListener('pointercancel', endDrag);
  }

  function switchTab(tabName, animate = true, preserveScroll = false) {
    updateTabIndicator(tabName, animate);
    activateTabView(tabName, preserveScroll);
  }

  function isSecondaryCourseSlot(slot) {
    if (!slot) return false;
    const code = String(slot.code || '').trim().toLocaleUpperCase('tr-TR');
    const title = String(slot.title || '').trim().toLocaleUpperCase('tr-TR');
    if (
      code === 'BÇ' ||
      code === 'BC' ||
      /^(İNG|ING|ENG|TD|TL|AİİT|AIIT|APHR)\s*10[12]\b/.test(code)
    ) {
      return true;
    }
    if (
      title === 'BAĞIMSIZ ÇALIŞMA' ||
      title === 'SELF STUDY' ||
      title.startsWith('BAĞIMSIZ ÇALIŞMA ') ||
      title.startsWith('SELF STUDY ') ||
      /^TÜRK DİLİ\b/.test(title) ||
      /^TURKISH LANGUAGE\b/.test(title) ||
      /^İNGİLİZCE\b/.test(title) ||
      /^ENGLISH\b/.test(title) ||
      title.includes('ATATÜRK İLKELERİ VE İNKILAP TARİHİ') ||
      title.includes("ATURK'S PRINCIPLES") ||
      title.includes("ATATURK'S PRINCIPLES AND HISTORY OF REVOLUTION") ||
      title.includes('PRINCIPLES AND HISTORY OF REVOLUTION')
    ) {
      return true;
    }
    return false;
  }

  function splitInstructorNameSegments(rawName) {
    const clean = String(rawName || '').trim();
    if (!clean) return [];
    const parts = clean.split(/(\s*[-,/]\s*)/);
    if (parts.length >= 3) {
      const nameParts = parts.filter((_, idx) => idx % 2 === 0).map((p) => p.trim());
      const allLookLikeFullNames = nameParts.length >= 2 && nameParts.every((p) => p.includes(' ') && p.length >= 4);
      if (allLookLikeFullNames) {
        return parts
          .filter((p) => p.length > 0)
          .map((p, idx) => ({
            text: p,
            clickable: idx % 2 === 0 && Boolean(p.trim())
          }));
      }
    }
    return [{ text: clean, clickable: true }];
  }

  let activeInstructorModalName = '';
  let activeDetailModalMode = 'instructor';
  let activeDetailModalValue = '';

  function closeInstructorModal() {
    activeInstructorModalName = '';
    activeDetailModalValue = '';
    closeAnimatedModal(document.getElementById('instructorModal'), document.getElementById('instructorModalCard'));
  }

  function renderSlotDetailModalContent(mode, value) {
    const cleanVal = String(value || '').trim();
    if (!cleanVal) return;
    const modalMode = mode === 'code' ? 'code' : 'instructor';
    activeDetailModalMode = modalMode;
    activeDetailModalValue = cleanVal;
    activeInstructorModalName = cleanVal;

    const isEn = state.lang === 'en';
    const normTarget = cleanVal.toLocaleLowerCase('tr-TR');
    const days = getScheduleDays();
    const matches = [];

    days.forEach((d) => {
      (d.slots || []).forEach((s) => {
        if (!s) return;
        if (modalMode === 'code') {
          const slotCodeNorm = String(s.code || '').trim().toLocaleLowerCase('tr-TR');
          if (slotCodeNorm && slotCodeNorm === normTarget) {
            matches.push({ day: d, slot: s });
          }
          return;
        }
        if (!s.instructor) return;
        const segments = splitInstructorNameSegments(s.instructor);
        const exactSegMatch = segments.some((seg) => seg.clickable && seg.text.trim().toLocaleLowerCase('tr-TR') === normTarget);
        const rawLower = String(s.instructor).toLocaleLowerCase('tr-TR');
        if (exactSegMatch || rawLower === normTarget || rawLower.includes(normTarget)) {
          matches.push({ day: d, slot: s });
        }
      });
    });

    const badgeEl = document.getElementById('instructorModalBadge');
    const titleEl = document.getElementById('instructorModalTitle');
    const metaEl = document.getElementById('instructorModalMeta');
    const nextBannerEl = document.getElementById('instructorNextBanner');
    const searchBtnEl = document.getElementById('btnInstructorShowInSearch');
    const listEl = document.getElementById('instructorLessonsList');

    if (badgeEl) {
      badgeEl.textContent = modalMode === 'code'
        ? (isEn ? 'Course Code' : 'Ders Kodu')
        : (isEn ? 'Instructor' : 'Öğretim Üyesi');
    }
    if (titleEl) titleEl.textContent = cleanVal;
    if (metaEl) {
      metaEl.textContent = isEn
        ? `${matches.length} ${matches.length === 1 ? 'Lesson' : 'Lessons'} • EN`
        : `${matches.length} Ders • TR`;
    }
    if (searchBtnEl) {
      searchBtnEl.textContent = isEn ? 'Show in Search' : 'Aramada Göster';
    }

    const todayObj = getTodayDateObj();
    todayObj.setHours(0, 0, 0, 0);
    const nextUpcoming = matches.find((m) => {
      const dt = parseDMY(m.slot.date);
      if (!dt || dt < todayObj) return false;
      return !getCancelledLessonInfo(m.slot);
    });
    if (nextBannerEl) {
      if (nextUpcoming) {
        nextBannerEl.textContent = isEn
          ? `Next: ${nextUpcoming.slot.date} (${nextUpcoming.slot.time})`
          : `Sonraki: ${nextUpcoming.slot.date} (${nextUpcoming.slot.time})`;
        nextBannerEl.classList.remove('hidden');
      } else {
        nextBannerEl.classList.add('hidden');
      }
    }

    if (!listEl) return;
    listEl.innerHTML = '';
    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-xs text-slate-500 dark:text-slate-400 text-center py-6';
      empty.textContent = isEn ? 'No lessons found in this schedule.' : 'Bu programda ders bulunamadı.';
      listEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    matches.forEach(({ day, slot }) => {
      const cancelInfo = getCancelledLessonInfo(slot);
      const isCancelled = Boolean(cancelInfo);
      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = `ios-press w-full text-left ios-pill-control rounded-2xl px-3 py-2.5 transition hover:bg-slate-500/10 space-y-1 ${isCancelled ? 'slot-card-cancelled' : ''}`;

      const topLine = document.createElement('div');
      topLine.className = 'flex items-center justify-between gap-2 flex-wrap';
      const dateSpan = document.createElement('span');
      dateSpan.className = 'text-[11px] font-bold text-blue-600 dark:text-blue-400 tabular-nums';
      dateSpan.textContent = `${slot.date} • ${day.dayName}`;
      const timeSpan = document.createElement('span');
      timeSpan.className = 'text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums';
      timeSpan.textContent = `${slot.time || ''} • ${I18N[state.lang].slotLabel(slot.slotNo)}`;
      topLine.appendChild(dateSpan);
      topLine.appendChild(timeSpan);

      const lessonTitle = document.createElement('div');
      lessonTitle.className = `text-xs sm:text-[13px] font-bold leading-snug ${isCancelled ? 'line-through opacity-70 text-slate-700 dark:text-slate-300' : 'text-slate-900 dark:text-white'}`;
      lessonTitle.textContent = slot.title;

      itemBtn.appendChild(topLine);
      itemBtn.appendChild(lessonTitle);

      if (isCancelled) {
        const cancelRow = document.createElement('div');
        cancelRow.className = 'flex items-center gap-1.5 flex-wrap pt-0.5';
        const cBadge = document.createElement('span');
        cBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25';
        cBadge.textContent = isEn ? 'CANCELLED' : 'İPTAL EDİLDİ';
        cancelRow.appendChild(cBadge);
        if (cancelInfo.reason) {
          const rSpan = document.createElement('span');
          rSpan.className = 'text-[11px] font-medium text-rose-700 dark:text-rose-300 truncate';
          rSpan.textContent = cancelInfo.reason;
          cancelRow.appendChild(rSpan);
        }
        itemBtn.appendChild(cancelRow);
      }

      const subParts = [];
      if (modalMode === 'code') {
        if (slot.instructor) subParts.push(slot.instructor);
      } else {
        if (slot.code) subParts.push(slot.code);
      }
      if (slot.group) subParts.push(slot.group.toUpperCase());
      if (subParts.length > 0) {
        const subEl = document.createElement('div');
        subEl.className = 'text-[10.5px] font-medium text-slate-500 dark:text-slate-400 truncate';
        subEl.textContent = subParts.join(' • ');
        itemBtn.appendChild(subEl);
      }

      itemBtn.addEventListener('click', () => {
        closeInstructorModal();
        state.selectedDate = slot.date;
        switchTab('daily');
      });
      frag.appendChild(itemBtn);
    });
    listEl.appendChild(frag);
  }

  function renderInstructorModalContent(instructorName) {
    renderSlotDetailModalContent('instructor', instructorName);
  }

  function openInstructorModal(instructorName) {
    const cleanName = String(instructorName || '').trim();
    if (!cleanName) return;
    renderSlotDetailModalContent('instructor', cleanName);
    openAnimatedModal(document.getElementById('instructorModal'), document.getElementById('instructorModalCard'));
  }

  function openCourseCodeModal(courseCode) {
    const cleanCode = String(courseCode || '').trim();
    if (!cleanCode) return;
    renderSlotDetailModalContent('code', cleanCode);
    openAnimatedModal(document.getElementById('instructorModal'), document.getElementById('instructorModalCard'));
  }

  // ==================== CLEAN SLOT CARD ====================
  function createSlotCardElement(slot, options = {}) {
    const key = `${slot.date}_${slot.slotNo}`;
    const noteText = state.notes[key] || '';
    const cancelInfo = getCancelledLessonInfo(slot);
    const isCancelled = Boolean(cancelInfo);
    const isLive = !isCancelled && isSlotCurrentlyLive(slot);
    const category = getSlotCategory(slot);
    const accent = getCalmAccent(slot, category);
    const isMbuOrLab = category === 'mbu' || category === 'lab';
    const groupStatus = getSlotGroupStatus(slot, category);
    const matList = getSlotMaterials(slot);
    const hasMaterials = matList.length > 0;
    const isSecondaryCourse = groupStatus !== 'other' && isSecondaryCourseSlot(slot);
    const [startTime = '', endTime = ''] = (slot.time || '').split('-');

    const card = document.createElement('div');
    card.setAttribute('data-slot-key', key);
    card.setAttribute('data-slot-date', slot.date || '');
    card.setAttribute('data-slot-time', slot.time || '');
    card.setAttribute('data-slot-live', isLive ? '1' : '0');
    card.setAttribute('data-slot-cancelled', isCancelled ? '1' : '0');
    card.className = `ios-glass slot-tilt-card rounded-[18px] px-3 py-2 ${isCancelled ? 'slot-card-cancelled' : (isLive ? 'ring-2 ring-blue-500/50' : '')} ${groupStatus === 'other' ? 'slot-card-dimmed' : (isSecondaryCourse ? 'slot-card-secondary' : '')}`;

    const row = document.createElement('div');
    row.className = 'slot-card-row flex items-stretch gap-2.5';

    const leftCol = document.createElement('div');
    leftCol.className = 'w-[48px] shrink-0 text-right flex flex-col justify-center';

    const startEl = document.createElement('div');
    startEl.className = 'text-[13px] font-bold tabular-nums text-slate-900 dark:text-white leading-tight';
    startEl.textContent = startTime;

    const endEl = document.createElement('div');
    endEl.className = 'text-[11px] font-medium tabular-nums text-slate-500 dark:text-slate-400 leading-tight';
    endEl.textContent = endTime;

    const slotNoEl = document.createElement('div');
    slotNoEl.className = `text-[10px] font-bold leading-tight mt-0.5 ${isCancelled ? 'text-rose-600 dark:text-rose-400' : (slot._isExtraLesson ? 'text-emerald-600 dark:text-emerald-400' : accent.slotText)}`;
    slotNoEl.textContent = slot._isExtraLesson
      ? (state.lang === 'en' ? 'EXTRA' : 'EK DERS')
      : I18N[state.lang].slotLabel(slot.slotNo);

    leftCol.appendChild(startEl);
    leftCol.appendChild(endEl);
    leftCol.appendChild(slotNoEl);

    const dividerBar = document.createElement('div');
    dividerBar.className = `w-1 rounded-full shrink-0 ${isCancelled ? 'bg-rose-500/80 dark:bg-rose-400/80' : accent.barBg} my-0.5`;

    const rightCol = document.createElement('div');
    rightCol.className = 'flex-1 min-w-0 flex flex-col justify-center';

    const titleEl = document.createElement('h3');
    titleEl.className = isCancelled
      ? 'slot-title-wrap text-[13.5px] sm:text-sm font-bold text-slate-600 dark:text-slate-300 line-through opacity-75 leading-snug'
      : 'slot-title-wrap text-[13.5px] sm:text-sm font-bold text-slate-900 dark:text-white leading-snug';
    titleEl.textContent = slot.title;
    rightCol.appendChild(titleEl);

    if (isCancelled) {
      const cancelWrap = document.createElement('div');
      cancelWrap.className = 'mt-1 flex items-center flex-wrap gap-1.5';
      const cancelBadge = document.createElement('span');
      cancelBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30';
      const cancelLabelText = state.lang === 'en' ? 'CANCELLED' : 'İPTAL EDİLDİ';
      cancelBadge.innerHTML = `<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span>${cancelLabelText}</span>`;
      cancelWrap.appendChild(cancelBadge);
      if (cancelInfo && cancelInfo.reason) {
        const reasonSpan = document.createElement('span');
        reasonSpan.className = 'text-[11px] font-semibold text-rose-700 dark:text-rose-300 leading-snug';
        reasonSpan.textContent = cancelInfo.reason;
        cancelWrap.appendChild(reasonSpan);
      }
      rightCol.appendChild(cancelWrap);
    }

    if (!isCancelled && slot._overridden) {
      const ovWrap = document.createElement('div');
      ovWrap.className = 'mt-1 flex items-center flex-wrap gap-1.5';
      const ovBadge = document.createElement('span');
      ovBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
      const ovLbl = slot._overrideLocationChanged
        ? (state.lang === 'en' ? 'ROOM CHANGED' : 'YER DEĞİŞTİ')
        : (state.lang === 'en' ? 'UPDATED' : 'DEĞİŞTİRİLDİ');
      ovBadge.textContent = ovLbl;
      ovWrap.appendChild(ovBadge);
      const ovDetail = [slot.location, slot._overrideNote].filter(Boolean).join(' · ');
      if (ovDetail) {
        const detSpan = document.createElement('span');
        detSpan.className = 'text-[11px] font-semibold text-amber-700 dark:text-amber-300 leading-snug';
        detSpan.textContent = ovDetail;
        ovWrap.appendChild(detSpan);
      }
      rightCol.appendChild(ovWrap);
    }

    if (slot._isExtraLesson) {
      const exWrap = document.createElement('div');
      exWrap.className = 'mt-1 flex items-center flex-wrap gap-1.5';
      const exBadge = document.createElement('span');
      exBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
      exBadge.textContent = state.lang === 'en' ? 'EXTRA LESSON' : 'EK DERS';
      exWrap.appendChild(exBadge);
      const exDetail = [slot.location, slot._extraNote].filter(Boolean).join(' · ');
      if (exDetail) {
        const detSpan = document.createElement('span');
        detSpan.className = 'text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 leading-snug';
        detSpan.textContent = exDetail;
        exWrap.appendChild(detSpan);
      }
      rightCol.appendChild(exWrap);
    }

    if (isMbuOrLab && slot.group) {
      const groupWrap = document.createElement('div');
      groupWrap.className = 'mt-1 flex items-center flex-wrap gap-1';
      const groupSpan = document.createElement('span');
      groupSpan.className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${accent.groupBadge}`;
      groupSpan.innerHTML = `<svg class="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg><span>${escapeHtml(slot.group.toUpperCase())}</span>`;
      groupWrap.appendChild(groupSpan);
      rightCol.appendChild(groupWrap);
    }

    if (matList.length > 0) {
      const pdfWrap = document.createElement('div');
      pdfWrap.className = 'slot-pdf-wrap mt-1.5 flex items-center gap-1.5 min-w-0 flex-wrap';
      const material = matList[0];
      const pdfLabel = material.title || material.pdfName || (state.lang === 'en' ? 'Download PDF' : 'PDF İndir');
      const sizeBadge = typeof material.fileSize === 'number' && material.fileSize > 0
        ? ` (${formatPdfBytesLabel(material.fileSize)})`
        : '';
      const isCachedPdf = isPdfCachedOnDevice(material.id);
      const pdfBtn = document.createElement('button');
      pdfBtn.type = 'button';
      pdfBtn.className = 'ios-press touch-target-44 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/25 text-rose-600 dark:text-rose-300 text-xs font-semibold transition min-w-0 max-w-full shadow-2xs';
      pdfBtn.innerHTML = `<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg><span class="truncate">${escapeHtml(pdfLabel)}</span>${sizeBadge ? `<span class="text-[10px] opacity-75 shrink-0 tabular-nums">${escapeHtml(sizeBadge)}</span>` : ''}`;
      pdfBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openOrDownloadLessonMaterial(material);
      });
      pdfWrap.appendChild(pdfBtn);
      if (isCachedPdf) {
        const cachedBadge = document.createElement('span');
        cachedBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold shrink-0 whitespace-nowrap';
        cachedBadge.innerHTML = `<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg><span>${escapeHtml(I18N[state.lang].pdfCachedBadge)}</span>`;
        pdfWrap.appendChild(cachedBadge);
      }
      if (matList.length > 1) {
        const extraCount = matList.length - 1;
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'ios-press touch-target-44 shrink-0 inline-flex items-center justify-center px-2.5 py-1 rounded-full bg-rose-500/18 hover:bg-rose-500/28 border border-rose-500/25 text-rose-700 dark:text-rose-200 text-xs font-bold tabular-nums transition';
        moreBtn.textContent = `+${extraCount}`;
        moreBtn.setAttribute('aria-label', state.lang === 'en' ? `Show ${matList.length} PDFs` : `${matList.length} PDF'i göster`);
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openLessonPdfsModal(slot, matList);
        });
        pdfWrap.appendChild(moreBtn);
      }
      rightCol.appendChild(pdfWrap);
    }

    const hasCode = Boolean(slot.code);
    const hasInstructor = Boolean(slot.instructor && String(slot.instructor).trim());

    if (hasCode || hasInstructor || isLive) {
      const metaRow = document.createElement('div');
      metaRow.className = 'slot-meta-row flex items-center gap-1.5 mt-0.5 min-w-0';
      if (hasCode || hasInstructor) {
        const metaText = document.createElement('p');
        metaText.className = 'text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate min-w-0';
        if (hasCode) {
          const codeBtn = document.createElement('button');
          codeBtn.type = 'button';
          codeBtn.className = 'instructor-inline-btn font-semibold';
          codeBtn.textContent = slot.code;
          codeBtn.setAttribute('title', state.lang === 'en' ? `View all ${slot.code} lessons` : `${slot.code} derslerini gör`);
          codeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openCourseCodeModal(slot.code);
          });
          metaText.appendChild(codeBtn);
        }
        if (hasCode && hasInstructor) {
          metaText.appendChild(document.createTextNode(' • '));
        }
        if (hasInstructor) {
          const segments = splitInstructorNameSegments(slot.instructor);
          segments.forEach((seg) => {
            if (seg.clickable) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'instructor-inline-btn';
              btn.textContent = seg.text;
              btn.setAttribute('title', state.lang === 'en' ? `View all lessons by ${seg.text}` : `${seg.text} derslerini gör`);
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openInstructorModal(seg.text);
              });
              metaText.appendChild(btn);
            } else {
              metaText.appendChild(document.createTextNode(seg.text));
            }
          });
        }
        metaRow.appendChild(metaText);
      }
      if (isLive) {
        const liveDot = document.createElement('span');
        liveDot.className = 'live-slot-dot w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0';
        metaRow.appendChild(liveDot);
      }
      rightCol.appendChild(metaRow);
    }

    if (noteText && !options.hideNotePreview) {
      const notePreview = document.createElement('p');
      notePreview.className = 'slot-title-wrap mt-1 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-lg px-2 py-0.5';
      notePreview.textContent = noteText;
      rightCol.appendChild(notePreview);
    }

    if (options.showDayFooter) {
      const footerBtn = document.createElement('button');
      footerBtn.type = 'button';
      footerBtn.className = 'touch-target-44 mt-1 self-start text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline';
      footerBtn.textContent = `${formatDateLong(slot.date)} • ${t('openBtn')}`;
      footerBtn.addEventListener('click', () => {
        state.selectedDate = slot.date;
        switchTab('daily');
      });
      rightCol.appendChild(footerBtn);
    }

    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.setAttribute('aria-label', t('noteModalTitle'));
    noteBtn.className = `touch-target-44 self-center shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition ${noteText ? 'text-amber-500 dark:text-amber-400 bg-amber-500/12' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-500/10'}`;
    noteBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>';
    noteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteModal(slot);
    });

    row.appendChild(leftCol);
    row.appendChild(dividerBar);
    row.appendChild(rightCol);

    row.appendChild(noteBtn);

    const activeAdminSession = getActiveAuthSession();
    if (activeAdminSession && activeAdminSession.isAdmin) {
      bindAdminLongPress(card, () => openAdminSlotQuickModal(slot));
    }

    card.appendChild(row);

    return card;
  }

  function bindAdminLongPress(card, onTrigger) {
    if (!card || typeof onTrigger !== 'function') return;
    card.classList.add('admin-lp-target');
    let lpTimer = null;
    let lpStartX = 0;
    let lpStartY = 0;
    let suppressClickUntil = 0;

    const clearTextSelection = () => {
      try {
        const sel = window.getSelection && window.getSelection();
        if (sel && typeof sel.removeAllRanges === 'function') sel.removeAllRanges();
      } catch {}
    };

    const cancelArming = () => {
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = null;
      }
      card.classList.remove('slot-card-arming');
    };

    const startArming = (clientX, clientY, targetEl) => {
      if (targetEl && typeof targetEl.closest === 'function' && targetEl.closest('button, a, input, textarea')) return;
      cancelArming();
      clearTextSelection();
      lpStartX = clientX;
      lpStartY = clientY;
      card.classList.add('slot-card-arming');
      lpTimer = setTimeout(() => {
        lpTimer = null;
        card.classList.remove('slot-card-arming');
        clearTextSelection();
        suppressClickUntil = Date.now() + 450;
        triggerHaptic('selection');
        onTrigger();
      }, 420);
    };

    card.addEventListener('selectstart', (e) => e.preventDefault());
    card.addEventListener('dragstart', (e) => e.preventDefault());
    card.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      startArming(e.touches[0].clientX, e.touches[0].clientY, e.target);
    }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      if (!lpTimer || !e.touches || e.touches.length !== 1) return;
      if (Math.abs(e.touches[0].clientX - lpStartX) > 10 || Math.abs(e.touches[0].clientY - lpStartY) > 10) {
        cancelArming();
      }
    }, { passive: true });
    card.addEventListener('touchend', cancelArming, { passive: true });
    card.addEventListener('touchcancel', cancelArming, { passive: true });

    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      startArming(e.clientX, e.clientY, e.target);
    });
    card.addEventListener('mousemove', (e) => {
      if (!lpTimer) return;
      if (Math.abs(e.clientX - lpStartX) > 10 || Math.abs(e.clientY - lpStartY) > 10) {
        cancelArming();
      }
    });
    card.addEventListener('mouseup', cancelArming);
    card.addEventListener('mouseleave', cancelArming);
    card.addEventListener('contextmenu', (e) => {
      const tgt = e.target;
      if (tgt && typeof tgt.closest === 'function' && tgt.closest('button, a, input, textarea')) return;
      e.preventDefault();
      cancelArming();
      clearTextSelection();
      triggerHaptic('selection');
      onTrigger();
    });
    card.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  // ==================== WEEK CAROUSEL (5-DAY SLIDES, LOCKED PERFECTLY) ====================
  function getUniqueWeeks() {
    const weeks = [];
    const seen = new Set();
    for (const day of getScheduleDays()) {
      const key = `${day.kurulNo}-${day.haftaNo}`;
      if (!seen.has(key)) {
        seen.add(key);
        weeks.push({
          key,
          kurulNo: day.kurulNo,
          haftaNo: day.haftaNo,
          days: getScheduleDays().filter((d) => `${d.kurulNo}-${d.haftaNo}` === key)
        });
      }
    }
    return weeks;
  }

  function renderWeekCarousel(currentDayObj) {
    const carousel = document.getElementById('weekCarousel');
    const weeks = getUniqueWeeks();
    const loc = I18N[state.lang];
    const activeWeekKey = `${currentDayObj.kurulNo}-${currentDayObj.haftaNo}`;

    document.getElementById('carouselWeekIndicator').textContent = `${loc.committeeShort(currentDayObj.kurulNo)} • ${loc.weekLabel(currentDayObj.haftaNo)}`;

    const needsBuild = carousel.children.length === 0 || carousel.getAttribute('data-lang') !== state.lang;
    if (needsBuild) {
      carousel.innerHTML = '';
      carousel.setAttribute('data-lang', state.lang);
      for (const week of weeks) {
        const slide = document.createElement('div');
        slide.className = 'week-slide w-full shrink-0 snap-center grid grid-cols-5 gap-1.5 px-1.5 py-1 box-border';
        slide.setAttribute('data-week-key', week.key);

        for (const d of week.days) {
          const dt = parseDMY(d.date);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('data-date', d.date);
          btn.className = 'week-day-btn rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center select-none';

          const dayShort = document.createElement('span');
          dayShort.className = 'text-[10px] font-semibold uppercase tracking-wide opacity-75 leading-tight';
          dayShort.textContent = loc.daysShort[dt.getDay()];

          const dayNum = document.createElement('span');
          dayNum.className = 'text-sm font-bold leading-tight mt-0.5 tabular-nums';
          dayNum.textContent = dt.getDate();

          const monthShort = document.createElement('span');
          monthShort.className = 'text-[9px] font-medium opacity-75 leading-tight';
          monthShort.textContent = loc.monthsShort[dt.getMonth()];

          btn.appendChild(dayShort);
          btn.appendChild(dayNum);
          btn.appendChild(monthShort);

          btn.addEventListener('click', () => {
            state.selectedDate = d.date;
            renderDailyView();
          });

          slide.appendChild(btn);
        }
        carousel.appendChild(slide);
      }
    }

    const todayStr = formatDMY(getTodayDateObj());
    carousel.querySelectorAll('.week-day-btn').forEach((btn) => {
      const dStr = btn.getAttribute('data-date');
      const isSelected = dStr === state.selectedDate;
      const isToday = dStr === todayStr;

      if (isSelected) {
        btn.className = 'week-day-btn rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center select-none bg-blue-600 text-white shadow-sm';
      } else if (isToday) {
        btn.className = 'week-day-btn rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center select-none bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/35';
      } else {
        btn.className = 'week-day-btn rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center select-none ios-pill-control text-slate-700 dark:text-slate-200 hover:bg-slate-500/15';
      }
    });

    const targetSlideIndex = weeks.findIndex((w) => w.key === activeWeekKey);
    if (targetSlideIndex >= 0 && carousel.clientWidth > 0) {
      const expectedLeft = targetSlideIndex * carousel.clientWidth;
      if (needsBuild || forceInstantCarouselSync) {
        carousel.scrollLeft = expectedLeft;
      } else if (Math.abs(carousel.scrollLeft - expectedLeft) > 8) {
        carousel.scrollTo({ left: expectedLeft, behavior: 'smooth' });
      }
    }
  }

  function setupCarouselScrollIndicator() {
    const carousel = document.getElementById('weekCarousel');
    let scrollTimer = null;
    carousel.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const width = carousel.clientWidth;
        if (!width) return;
        const idx = Math.round(carousel.scrollLeft / width);
        const weeks = getUniqueWeeks();
        const loc = I18N[state.lang];
        if (weeks[idx]) {
          document.getElementById('carouselWeekIndicator').textContent = `${loc.committeeShort(weeks[idx].kurulNo)} • ${loc.weekLabel(weeks[idx].haftaNo)}`;
        }
      }, 80);
    }, { passive: true });
  }

  // ==================== DAILY VIEW & QUICK SCHEDULE CALENDAR ====================
  let lastDailyRenderedDate = '';
  let lastDailyRenderSig = '';
  let lastWeeklyRenderSig = '';
  let lastWeeklyPillsSig = '';

  function invalidateScheduleRenderCache() {
    lastDailyRenderSig = '';
    lastWeeklyRenderSig = '';
  }

  function buildDaySlotsRenderSignature(dayObj) {
    const slotSig = dayObj.slots.map((s) => {
      const k = `${s.date}_${s.slotNo}`;
      const note = state.notes[k] || '';
      const mats = getSlotMaterials(s);
      const matSig = mats.map((m) => `${m.id || ''}:${m.title || ''}:${m.fileSize || 0}:${isPdfCachedOnDevice(m.id) ? 1 : 0}`).join(',');
      const cInfo = getCancelledLessonInfo(s);
      const cancelSig = cInfo ? `1:${cInfo.reason || ''}` : '0';
      return `${s.slotNo}|${note}|${matSig}|${cancelSig}`;
    }).join(';');
    const extrasSig = (window as any).__INONU_LIVE_EXTRAS__?.getScheduleExtrasSignature
      ? (window as any).__INONU_LIVE_EXTRAS__.getScheduleExtrasSignature(dayObj.date, state.lang === 'en' ? 'en' : 'tr')
      : '';
    return `${dayObj.date}::${state.lang}::${state.myMbuGroup}::${state.myLabGroup}::${state.otherGroupMode}::${extrasSig}::${slotSig}`;
  }

  function renderDailyView() {
    const days = getScheduleDays();
    const loc = I18N[state.lang];
    const idx = days.findIndex((d) => d.date === state.selectedDate);
    const dayObj = idx >= 0 ? days[idx] : days[0];
    const prevDate = lastDailyRenderedDate;
    let dailyDir = 0;
    if (prevDate && prevDate !== dayObj.date && !suppressEntryStagger && !isTabSwitchRender) {
      dailyDir = parseDMY(dayObj.date) > parseDMY(prevDate) ? 1 : -1;
    }
    lastDailyRenderedDate = dayObj.date;
    state.selectedDate = dayObj.date;
    persistNavViewState();

    const hdrTitle = document.getElementById('selectedDayHeaderTitle');
    const hdrWeekday = document.getElementById('selectedDayHeaderWeekday');
    hdrTitle.textContent = formatDateDayMonthYear(dayObj.date);
    hdrWeekday.textContent = formatDateWeekday(dayObj.date);
    document.getElementById('selectedDaySubInfo').textContent = `${loc.committeeShort(dayObj.kurulNo)} • ${loc.weekLabel(dayObj.haftaNo)} • ${loc.slotCount(dayObj.slots.length)}`;

    const dailyDateBtnLabel = document.getElementById('dailyDateBtnLabel');
    if (dailyDateBtnLabel) {
      const dt = parseDMY(dayObj.date);
      dailyDateBtnLabel.textContent = `${dt.getDate()} ${loc.monthsShort[dt.getMonth()]} ${dt.getFullYear()}`;
    }

    if (dailyDir !== 0) {
      const hCls = dailyDir > 0 ? 'food-header-next' : 'food-header-prev';
      [hdrTitle, hdrWeekday].forEach((el) => {
        if (!el) return;
        el.classList.remove('food-header-next', 'food-header-prev');
        void el.offsetWidth;
        el.classList.add(hCls);
      });
    }

    const tomTarget = getTomorrowTargetDate();
    const todayTarget = getBestDefaultDate();
    const isToday = state.selectedDate === todayTarget;
    const isTomorrow = state.selectedDate === tomTarget;

    const relBadge = document.getElementById('selectedDayRelativeBadge');
    if (relBadge) {
      relBadge.textContent = formatRelativeDay(dayObj.date);
      relBadge.classList.toggle('hidden', isToday || isTomorrow);
    }

    const btnToday = document.getElementById('btnBannerToday');
    const btnTom = document.getElementById('btnBannerTomorrow');

    const activePill = 'px-2 min-[360px]:px-2.5 sm:px-3.5 py-1 rounded-full text-xs font-semibold text-slate-900 dark:text-white transition-colors whitespace-nowrap';
    const inactivePill = 'px-2 min-[360px]:px-2.5 sm:px-3.5 py-1 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap';
    btnToday.className = isToday ? activePill : inactivePill;
    btnTom.className = isTomorrow ? activePill : inactivePill;
    updateSegmentedIndicator(
      document.getElementById('dailyBannerSegmentedBar'),
      document.getElementById('dailyBannerSegmentedIndicator'),
      isToday ? btnToday : (isTomorrow ? btnTom : null),
      !suppressEntryStagger && !isTabSwitchRender
    );

    renderWeekCarousel(dayObj);

    const container = document.getElementById('dailySlotsContainer');
    const nextDailySig = buildDaySlotsRenderSignature(dayObj);
    if (container.children.length > 0 && lastDailyRenderSig === nextDailySig) {
      syncLiveSlotHighlightsInPlace();
      updateGroupFilterButtonUI();
      return;
    }
    lastDailyRenderSig = nextDailySig;

    container.classList.remove('daily-slots-next', 'daily-slots-prev');
    container.innerHTML = '';

    if (dailyDir !== 0) {
      void container.offsetWidth;
      container.classList.add(dailyDir > 0 ? 'daily-slots-next' : 'daily-slots-prev');
      container.addEventListener('animationend', () => {
        container.classList.remove('daily-slots-next', 'daily-slots-prev');
      }, { once: true });
    }

    const liveExtras = (window as any).__INONU_LIVE_EXTRAS__;
    const activeProg = state.lang === 'en' ? 'en' : 'tr';
    const rawWithOverrides = dayObj.slots.map((s) => {
      const ov = liveExtras?.getLessonOverrideForSlot ? liveExtras.getLessonOverrideForSlot(dayObj.date, s.slotNo, activeProg) : null;
      if (!ov) return s;
      return {
        ...s,
        time: ov.newTime || s.time,
        location: ov.newLocation || s.location || '',
        instructor: ov.newInstructor || s.instructor,
        _overridden: true,
        _overrideLocationChanged: Boolean(ov.newLocation),
        _overrideNote: ov.note || '',
      };
    });
    const extraForDay = liveExtras?.getExtraLessonsForDate ? liveExtras.getExtraLessonsForDate(dayObj.date, activeProg) : [];
    const mappedExtras = extraForDay.map((ex, eIdx) => ({
      date: dayObj.date,
      slotNo: 90 + eIdx,
      time: ex.time || '',
      title: ex.title || '',
      instructor: ex.instructor || '',
      location: ex.location || '',
      code: '',
      group: '',
      _isExtraLesson: true,
      _extraNote: ex.note || '',
    }));

    const { visibleSlots, hiddenCount } = filterSlotsForGroupPreference(rawWithOverrides);
    const combinedSlots = [...visibleSlots, ...mappedExtras];
    const hasMorning = visibleSlots.some((s) => s.slotNo <= 4);
    let lunchInserted = false;

    const baseDelay = isTabSwitchRender ? 45 : 0;
    const frag = document.createDocumentFragment();
    combinedSlots.forEach((slot, idx) => {
      if (!lunchInserted && hasMorning && slot.slotNo >= 5 && !slot._isExtraLesson) {
        lunchInserted = true;
        const prevSlot = dayObj.slots.find((s) => s.slotNo === 4);
        const slot5 = dayObj.slots.find((s) => s.slotNo === 5) || slot;
        const lunchStart = prevSlot && prevSlot.time ? prevSlot.time.split('-')[1] : '12.00';
        const lunchEnd = slot5 && slot5.time ? slot5.time.split('-')[0] : '13.10';
        const lunch = document.createElement('div');
        lunch.className = `${suppressEntryStagger ? '' : 'ios-stagger-item '}flex items-center gap-3 py-1 px-2`;
        if (!suppressEntryStagger) {
          lunch.style.setProperty('--stagger-delay', `${baseDelay + Math.min(idx, 8) * 24}ms`);
        }
        lunch.innerHTML = `<div class="h-px flex-1 bg-slate-300/60 dark:bg-slate-800"></div><span class="text-[11px] font-medium text-slate-400 dark:text-slate-500 tabular-nums">${loc.lunchBreak} (${escapeHtml(lunchStart)} - ${escapeHtml(lunchEnd)})</span><div class="h-px flex-1 bg-slate-300/60 dark:bg-slate-800"></div>`;
        frag.appendChild(lunch);
      }
      const cardEl = createSlotCardElement(slot);
      if (!suppressEntryStagger) {
        cardEl.classList.add('ios-stagger-item');
        cardEl.style.setProperty('--stagger-delay', `${baseDelay + Math.min(idx + (lunchInserted ? 1 : 0), 9) * 24}ms`);
      }
      frag.appendChild(cardEl);
    });

    if (hiddenCount > 0) {
      const hiddenNote = document.createElement('div');
      hiddenNote.className = 'flex items-center justify-center pt-1';
      const hiddenBtn = document.createElement('button');
      hiddenBtn.type = 'button';
      hiddenBtn.className = 'ios-press min-h-[44px] px-3.5 py-2 rounded-full ios-pill-control text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition';
      hiddenBtn.textContent = `${loc.hiddenGroupsBanner(hiddenCount)} • ${loc.hiddenGroupsShowBtn}`;
      hiddenBtn.addEventListener('click', openGroupModal);
      hiddenNote.appendChild(hiddenBtn);
      frag.appendChild(hiddenNote);
    }
    container.appendChild(frag);
    updateGroupFilterButtonUI();
  }

  const DAILY_CAL_RADIUS = 5;
  let dailyPickerYear = 2026;
  let dailyPickerMonth = 8;
  let dailyCalAnchorMonthNum = 2026 * 12 + 8;
  let dailyCalNavTargetMonthNum = null;
  let dailyCalSuppressClick = false;

  function getScheduleDaysLookupMap() {
    const map = Object.create(null);
    for (const day of getScheduleDays()) {
      const hasExam = Array.isArray(day.slots) && day.slots.some((s) => getSlotCategory(s) === 'exam');
      map[day.date] = { day, hasExam };
    }
    return map;
  }

  function updateDailyCalMonthLabel(direction = 0) {
    const monthLabel = document.getElementById('dailyCalMonthLabel');
    if (!monthLabel) return;
    const loc = I18N[state.lang];
    const nextText = `${loc.months[dailyPickerMonth]} ${dailyPickerYear}`;
    if (monthLabel.textContent === nextText) return;
    monthLabel.textContent = nextText;
    monthLabel.classList.remove('food-cal-label-next', 'food-cal-label-prev');
    if (direction !== 0) {
      void monthLabel.offsetWidth;
      monthLabel.classList.add(direction > 0 ? 'food-cal-label-next' : 'food-cal-label-prev');
    }
  }

  function createDailyCalMonthSlide(year, month, selectedDmy, todayDmy, dayMap) {
    const slide = document.createElement('div');
    slide.className = 'w-full shrink-0 snap-center food-cal-grid px-1.5 py-1 box-border';
    slide.setAttribute('data-month-num', String(year * 12 + month));

    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startOffset; i++) {
      const spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      slide.appendChild(spacer);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dt = new Date(year, month, day);
      const dmy = formatDMY(dt);
      const info = dayMap[dmy] || null;
      const isClassDay = Boolean(info);
      const isSelected = dmy === selectedDmy;
      const isToday = dmy === todayDmy;

      const btn = document.createElement('button');
      btn.type = 'button';
      let cls = 'food-cal-day ';
      if (isSelected) {
        cls += 'bg-blue-600 text-white shadow-sm';
      } else if (isToday) {
        cls += 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/35';
      } else if (isClassDay) {
        cls += 'text-slate-800 dark:text-slate-100 hover:bg-slate-500/15';
      } else {
        cls += 'text-slate-400/65 dark:text-slate-600 cursor-default';
        btn.disabled = true;
      }
      btn.className = cls;

      const numSpan = document.createElement('span');
      numSpan.textContent = String(day);
      btn.appendChild(numSpan);

      if (isClassDay) {
        const dot = document.createElement('span');
        if (info.hasExam) {
          dot.className = `food-cal-dot ${isSelected ? 'bg-white/95' : 'bg-rose-500'}`;
        } else {
          dot.className = `food-cal-dot ${isSelected ? 'bg-white/90' : 'bg-blue-500'}`;
        }
        btn.appendChild(dot);

        btn.addEventListener('click', () => {
          if (dailyCalSuppressClick) return;
          state.selectedDate = dmy;
          closeDailyDateModal();
          renderDailyView();
        });
      }

      slide.appendChild(btn);
    }

    const trailingCount = 42 - (startOffset + daysInMonth);
    for (let i = 0; i < trailingCount; i++) {
      const spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      slide.appendChild(spacer);
    }

    return slide;
  }

  function renderDailyDateModalCarousel(instantSync = true) {
    const loc = I18N[state.lang];
    const weekdaysEl = document.getElementById('dailyCalWeekdays');
    const carousel = document.getElementById('dailyCalCarousel');
    if (!weekdaysEl || !carousel) return;

    const mondayFirstOrder = [1, 2, 3, 4, 5, 6, 0];
    weekdaysEl.innerHTML = '';
    mondayFirstOrder.forEach((dow) => {
      const sp = document.createElement('span');
      sp.textContent = loc.daysShort[dow];
      if (dow === 0 || dow === 6) sp.className = 'opacity-65';
      weekdaysEl.appendChild(sp);
    });

    const activeMonthNum = dailyPickerYear * 12 + dailyPickerMonth;
    dailyCalAnchorMonthNum = activeMonthNum;
    updateDailyCalMonthLabel(0);

    const selectedDmy = state.selectedDate || getBestDefaultDate();
    const todayDmy = formatDMY(getTodayDateObj());
    const dayMap = getScheduleDaysLookupMap();

    carousel.innerHTML = '';
    for (let offset = -DAILY_CAL_RADIUS; offset <= DAILY_CAL_RADIUS; offset++) {
      const mNum = dailyCalAnchorMonthNum + offset;
      const yr = Math.floor(mNum / 12);
      const mo = ((mNum % 12) + 12) % 12;
      carousel.appendChild(createDailyCalMonthSlide(yr, mo, selectedDmy, todayDmy, dayMap));
    }

    if (instantSync && carousel.clientWidth > 0) {
      const prevSnap = carousel.style.scrollSnapType;
      const prevBeh = carousel.style.scrollBehavior;
      carousel.style.scrollSnapType = 'none';
      carousel.style.scrollBehavior = 'auto';
      carousel.scrollLeft = DAILY_CAL_RADIUS * carousel.clientWidth;
      void carousel.offsetWidth;
      carousel.style.scrollSnapType = prevSnap || '';
      carousel.style.scrollBehavior = prevBeh || '';
    }
  }

  function setupDailyCalSwipe() {
    const carousel = document.getElementById('dailyCalCarousel');
    if (!carousel) return;
    let settleTimer = null;

    carousel.addEventListener('scroll', () => {
      const width = carousel.clientWidth;
      if (!width) return;
      const idx = Math.max(0, Math.min(DAILY_CAL_RADIUS * 2, Math.round(carousel.scrollLeft / width)));
      const newMonthNum = dailyCalAnchorMonthNum - DAILY_CAL_RADIUS + idx;
      const curMonthNum = dailyPickerYear * 12 + dailyPickerMonth;
      if (newMonthNum !== curMonthNum) {
        const dir = newMonthNum > curMonthNum ? 1 : -1;
        dailyPickerYear = Math.floor(newMonthNum / 12);
        dailyPickerMonth = ((newMonthNum % 12) + 12) % 12;
        updateDailyCalMonthLabel(dir);
      }
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        dailyCalNavTargetMonthNum = null;
        const settledIdx = Math.max(0, Math.min(DAILY_CAL_RADIUS * 2, Math.round(carousel.scrollLeft / width)));
        if (settledIdx <= 1 || settledIdx >= DAILY_CAL_RADIUS * 2 - 1) {
          renderDailyDateModalCarousel(true);
        }
      }, 140);
    }, { passive: true });

    let isMouseDown = false;
    let dragStartX = 0;
    let dragStartScrollLeft = 0;
    let didDrag = false;

    carousel.addEventListener('pointerdown', (e) => {
      dailyCalNavTargetMonthNum = null;
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      isMouseDown = true;
      didDrag = false;
      dragStartX = e.clientX;
      dragStartScrollLeft = carousel.scrollLeft;
    });
    carousel.addEventListener('pointermove', (e) => {
      if (!isMouseDown) return;
      const dx = e.clientX - dragStartX;
      if (!didDrag && Math.abs(dx) > 6) {
        didDrag = true;
        carousel.style.scrollSnapType = 'none';
        try { carousel.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (didDrag) carousel.scrollLeft = dragStartScrollLeft - dx;
    });
    const endMouseDrag = (e) => {
      if (!isMouseDown) return;
      isMouseDown = false;
      if (didDrag) {
        dailyCalSuppressClick = true;
        setTimeout(() => { dailyCalSuppressClick = false; }, 60);
        try { carousel.releasePointerCapture(e.pointerId); } catch (err) {}
        const width = carousel.clientWidth;
        const targetIdx = width > 0 ? Math.max(0, Math.min(DAILY_CAL_RADIUS * 2, Math.round(carousel.scrollLeft / width))) : DAILY_CAL_RADIUS;
        carousel.style.scrollSnapType = '';
        if (width > 0) carousel.scrollTo({ left: targetIdx * width, behavior: 'smooth' });
      }
    };
    carousel.addEventListener('pointerup', endMouseDrag);
    carousel.addEventListener('pointercancel', endMouseDrag);
  }

  function stepDailyCalMonth(delta) {
    const carousel = document.getElementById('dailyCalCarousel');
    const baseMonthNum = dailyCalNavTargetMonthNum !== null ? dailyCalNavTargetMonthNum : (dailyPickerYear * 12 + dailyPickerMonth);
    const targetMonthNum = baseMonthNum + delta;
    const targetIdx = targetMonthNum - (dailyCalAnchorMonthNum - DAILY_CAL_RADIUS);

    if (carousel && carousel.clientWidth > 0 && targetIdx >= 0 && targetIdx <= DAILY_CAL_RADIUS * 2) {
      dailyCalNavTargetMonthNum = targetMonthNum;
      carousel.scrollTo({ left: targetIdx * carousel.clientWidth, behavior: 'smooth' });
    } else {
      dailyCalNavTargetMonthNum = null;
      dailyPickerYear = Math.floor(targetMonthNum / 12);
      dailyPickerMonth = ((targetMonthNum % 12) + 12) % 12;
      renderDailyDateModalCarousel(true);
    }
  }

  function openDailyDateModal() {
    const activeDmy = state.selectedDate || getBestDefaultDate();
    const dt = parseDMY(activeDmy);
    dailyPickerYear = dt.getFullYear();
    dailyPickerMonth = dt.getMonth();
    dailyCalNavTargetMonthNum = null;
    const modal = document.getElementById('dailyDateModal');
    const card = document.getElementById('dailyDateModalCard');
    openAnimatedModal(modal, card);
    renderDailyDateModalCarousel(true);
  }

  function closeDailyDateModal() {
    closeAnimatedModal(document.getElementById('dailyDateModal'), document.getElementById('dailyDateModalCard'));
  }

  // ==================== WEEKLY VIEW ====================
  function renderWeeklyView() {
    const days = getScheduleDays();
    const loc = I18N[state.lang];
    const weeks = [];
    const seen = new Set();
    for (const d of days) {
      if (state.weeklyFilterKurul !== 'all' && String(d.kurulNo) !== state.weeklyFilterKurul) continue;
      const wkKey = `${d.kurulNo}-${d.haftaNo}`;
      if (!seen.has(wkKey)) {
        seen.add(wkKey);
        weeks.push({ key: wkKey, kurulNo: d.kurulNo, haftaNo: d.haftaNo });
      }
    }

    const bestDate = getBestDefaultDate();
    const bestDay = days.find((d) => d.date === bestDate) || days.find((d) => d.date === state.selectedDate);
    const bestWeekKey = bestDay ? `${bestDay.kurulNo}-${bestDay.haftaNo}` : (weeks[0] ? weeks[0].key : '');

    if (!state.weeklySelectedWeekKey || !weeks.some((w) => w.key === state.weeklySelectedWeekKey)) {
      state.weeklySelectedWeekKey = weeks.some((w) => w.key === bestWeekKey) ? bestWeekKey : (weeks[0] ? weeks[0].key : '');
    }
    persistNavViewState();

    const pillsContainer = document.getElementById('weekSelectorPills');
    const hadWeekPillPos = Boolean(pillsContainer._lastSegPos);
    const nextPillsSig = `${state.lang}::${state.weeklyFilterKurul}::${weeks.map((w) => w.key).join(',')}`;
    let weekIndicator = document.getElementById('weekSelectorIndicator');
    let activeWeekBtn = null;

    if (lastWeeklyPillsSig !== nextPillsSig || !weekIndicator) {
      lastWeeklyPillsSig = nextPillsSig;
      pillsContainer.innerHTML = '';
      weekIndicator = document.createElement('div');
      weekIndicator.id = 'weekSelectorIndicator';
      weekIndicator.className = 'segmented-pill-indicator segmented-pill-indicator-blue';
      pillsContainer.appendChild(weekIndicator);

      for (const wk of weeks) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-week-pill', wk.key);
        const isSel = wk.key === state.weeklySelectedWeekKey;
        btn.className = `ios-press shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
          isSel ? 'text-white' : 'ios-pill-control text-slate-700 dark:text-slate-200'
        }`;
        btn.textContent = `K${wk.kurulNo} • ${state.lang === 'en' ? 'W' : 'H'}${wk.haftaNo}`;
        btn.addEventListener('click', () => {
          state.weeklySelectedWeekKey = wk.key;
          renderWeeklyView();
        });
        pillsContainer.appendChild(btn);
        if (isSel) activeWeekBtn = btn;
      }
    } else {
      pillsContainer.querySelectorAll('[data-week-pill]').forEach((btn) => {
        const isSel = btn.getAttribute('data-week-pill') === state.weeklySelectedWeekKey;
        btn.className = `ios-press shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
          isSel ? 'text-white' : 'ios-pill-control text-slate-700 dark:text-slate-200'
        }`;
        if (isSel) activeWeekBtn = btn;
      });
    }

    const activeBtnCls = 'px-2 min-[360px]:px-2.5 py-1 rounded-full font-semibold text-slate-900 dark:text-white transition-colors';
    const inactBtnCls = 'px-2 min-[360px]:px-2.5 py-1 rounded-full font-medium text-slate-600 dark:text-slate-300 transition-colors';
    const btnKAll = document.getElementById('btnFilterKurulAll');
    const btnK1 = document.getElementById('btnFilterKurul1');
    const btnK2 = document.getElementById('btnFilterKurul2');
    btnKAll.className = state.weeklyFilterKurul === 'all' ? activeBtnCls : inactBtnCls;
    btnK1.className = state.weeklyFilterKurul === '1' ? activeBtnCls : inactBtnCls;
    btnK2.className = state.weeklyFilterKurul === '2' ? activeBtnCls : inactBtnCls;

    const animateWeeklyControls = !suppressEntryStagger && !isTabSwitchRender;
    updateSegmentedIndicator(
      document.getElementById('weeklyKurulSegmentedBar'),
      document.getElementById('weeklyKurulSegmentedIndicator'),
      state.weeklyFilterKurul === '1' ? btnK1 : (state.weeklyFilterKurul === '2' ? btnK2 : btnKAll),
      animateWeeklyControls
    );

    requestAnimationFrame(() => {
      updateSegmentedIndicator(
        pillsContainer,
        weekIndicator,
        activeWeekBtn,
        hadWeekPillPos && animateWeeklyControls,
        'segmented-pill-indicator-blue'
      );
      if (activeWeekBtn && pillsContainer.scrollWidth > pillsContainer.clientWidth) {
        const targetScroll = Math.max(0, activeWeekBtn.offsetLeft - (pillsContainer.clientWidth - activeWeekBtn.offsetWidth) / 2);
        pillsContainer.scrollTo({ left: targetScroll, behavior: (hadWeekPillPos && animateWeeklyControls) ? 'smooth' : 'auto' });
      }
    });

    const weekDays = days.filter((d) => `${d.kurulNo}-${d.haftaNo}` === state.weeklySelectedWeekKey);
    const container = document.getElementById('weeklyDaysContainer');
    const nextWeeklySig = `${state.weeklySelectedWeekKey}::${weekDays.map((d) => buildDaySlotsRenderSignature(d)).join('||')}`;
    if (container.children.length > 0 && lastWeeklyRenderSig === nextWeeklySig) {
      syncLiveSlotHighlightsInPlace();
      return;
    }
    lastWeeklyRenderSig = nextWeeklySig;
    container.innerHTML = '';

    const weekSwitchOffset = isTabSwitchRender ? 45 : 0;
    const frag = document.createDocumentFragment();
    weekDays.forEach((day, dayIdx) => {
      const sec = document.createElement('div');
      sec.className = 'space-y-2';
      const animateDay = !suppressEntryStagger && dayIdx < 2;
      const baseDelay = weekSwitchOffset + dayIdx * 55;

      const header = document.createElement('div');
      header.className = `${animateDay ? 'ios-stagger-item ' : ''}flex items-center justify-between px-1.5 pt-0.5`;
      if (animateDay) {
        header.style.setProperty('--stagger-delay', `${baseDelay}ms`);
      }
      header.innerHTML = `<h3 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">${escapeHtml(formatDateLong(day.date))}</h3>`;

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'ios-press touch-target-44 text-xs font-semibold text-blue-600 dark:text-blue-400';
      openBtn.textContent = loc.openDayBtn;
      openBtn.addEventListener('click', () => {
        state.selectedDate = day.date;
        switchTab('daily');
      });
      header.appendChild(openBtn);
      sec.appendChild(header);

      const list = document.createElement('div');
      list.className = 'space-y-2';
      const { visibleSlots, hiddenCount } = filterSlotsForGroupPreference(day.slots);
      visibleSlots.forEach((slot, sIdx) => {
        const cardEl = createSlotCardElement(slot, { hideNotePreview: true });
        if (animateDay && sIdx < 8) {
          cardEl.classList.add('ios-stagger-item');
          cardEl.style.setProperty('--stagger-delay', `${Math.min(baseDelay + sIdx * 24, 260)}ms`);
        }
        list.appendChild(cardEl);
      });
      if (hiddenCount > 0) {
        const hiddenEl = document.createElement('button');
        hiddenEl.type = 'button';
        hiddenEl.className = `${animateDay ? 'ios-stagger-item ' : ''}touch-target-44 text-[11px] font-medium text-slate-400 dark:text-slate-500 px-1.5 hover:text-blue-600 dark:hover:text-blue-400 transition text-left`;
        if (animateDay) {
          hiddenEl.style.setProperty('--stagger-delay', `${Math.min(baseDelay + 70, 260)}ms`);
        }
        hiddenEl.textContent = `${loc.hiddenGroupsBanner(hiddenCount)} • ${loc.hiddenGroupsShowBtn}`;
        hiddenEl.addEventListener('click', openGroupModal);
        list.appendChild(hiddenEl);
      }
      sec.appendChild(list);
      frag.appendChild(sec);
    });
    container.appendChild(frag);
  }

  // ==================== SEARCH VIEW ====================
  const SEARCH_INDEX_CACHE = { tr: null, en: null };
  let searchRenderSeq = 0;

  function getSearchIndex(lang) {
    if (SEARCH_INDEX_CACHE[lang]) return SEARCH_INDEX_CACHE[lang];
    const days = lang === 'en' ? SCHEDULE_DAYS_EN : SCHEDULE_DAYS_TR;
    const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
    const loc = I18N[lang];
    const items = [];
    for (const day of days) {
      const dt = parseDMY(day.date);
      const longStr = `${dt.getDate()} ${loc.months[dt.getMonth()]} ${dt.getFullYear()} ${loc.days[dt.getDay()]}`;
      for (const slot of day.slots) {
        items.push({
          slot,
          hay: `${slot.code} ${slot.title} ${slot.instructor} ${slot.date} ${longStr} ${slot.group}`.toLocaleLowerCase(locale)
        });
      }
    }
    SEARCH_INDEX_CACHE[lang] = items;
    return items;
  }

  function renderSearchView() {
    const lang = state.lang;
    const loc = I18N[lang];
    const q = document.getElementById('inputSearchQuery').value.trim();
    persistNavViewState();
    const clearBtn = document.getElementById('btnClearSearch');
    clearBtn.classList.toggle('hidden', q.length === 0);

    const resultsContainer = document.getElementById('searchResultsContainer');
    const statsBar = document.getElementById('searchStatsBar');
    const seq = ++searchRenderSeq;
    resultsContainer.innerHTML = '';

    const index = getSearchIndex(lang);
    let matches;
    if (!q) {
      matches = index.map((item) => item.slot);
      statsBar.textContent = loc.searchAllStats(matches.length);
    } else {
      const norm = q.toLocaleLowerCase(lang === 'tr' ? 'tr-TR' : 'en-US');
      matches = [];
      for (let i = 0; i < index.length; i++) {
        if (index[i].hay.includes(norm)) matches.push(index[i].slot);
      }
      statsBar.textContent = loc.searchStats(q, matches.length);
    }

    if (matches.length === 0) {
      resultsContainer.innerHTML = `<div class="ios-glass rounded-3xl p-6 text-center text-xs text-slate-500">${loc.searchNoResults}</div>`;
      return;
    }

    const FIRST_BATCH = 35;
    const CHUNK_SIZE = 60;
    const firstFrag = document.createDocumentFragment();
    const firstLimit = Math.min(FIRST_BATCH, matches.length);
    const searchBaseDelay = isTabSwitchRender ? 45 : 0;
    for (let i = 0; i < firstLimit; i++) {
      const cardEl = createSlotCardElement(matches[i], { showDayFooter: true });
      if (!suppressEntryStagger && i < 10) {
        cardEl.classList.add('ios-stagger-item');
        cardEl.style.setProperty('--stagger-delay', `${searchBaseDelay + i * 28}ms`);
      }
      firstFrag.appendChild(cardEl);
    }
    resultsContainer.appendChild(firstFrag);

    if (matches.length > FIRST_BATCH) {
      let cursor = FIRST_BATCH;
      const appendNextChunk = () => {
        if (seq !== searchRenderSeq || state.activeTab !== 'search') return;
        const end = Math.min(cursor + CHUNK_SIZE, matches.length);
        const frag = document.createDocumentFragment();
        for (let i = cursor; i < end; i++) {
          frag.appendChild(createSlotCardElement(matches[i], { showDayFooter: true }));
        }
        resultsContainer.appendChild(frag);
        cursor = end;
        if (cursor < matches.length) {
          requestAnimationFrame(appendNextChunk);
        }
      };
      requestAnimationFrame(appendNextChunk);
    }
  }

  // ==================== INFO VIEW ====================
  function renderInfoView() {
    const days = getScheduleDays();
    const loc = I18N[state.lang];
    const inpAra = document.getElementById('inpAraSinav');
    const inpSonu = document.getElementById('inpKurulSonu');
    const inpPratik = document.getElementById('inpPratikSinav');
    const outTeorik = document.getElementById('outTeorikNotu');
    const out = document.getElementById('outKurulNotu');
    const hintEl = document.getElementById('calcKurulHint');
    const inpKurulOrt = document.getElementById('inpKurulOrt');
    const inpHedefYil = document.getElementById('inpHedefYil');
    const btnSyncKurulOrt = document.getElementById('btnSyncKurulOrt');
    const finalNeedBox = document.getElementById('finalNeedBox');

    inpAra.value = state.calcAra;
    inpSonu.value = state.calcSonu;
    inpPratik.value = state.calcPratik;
    inpHedefYil.value = state.calcHedefYil;

    const syncWeightButtons = () => {
      document.querySelectorAll('.pratik-weight-btn').forEach((btn) => {
        const w = Number(btn.getAttribute('data-pweight'));
        const isAct = w === Number(state.calcPratikWeight);
        btn.className = isAct
          ? 'pratik-weight-btn px-2.5 py-0.5 rounded-full font-semibold bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs transition'
          : 'pratik-weight-btn px-2.5 py-0.5 rounded-full font-medium text-slate-600 dark:text-slate-300 transition';
      });
    };

    const clampScore = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

    const parseOptionalScore = (raw) => {
      const trimmed = String(raw || '').trim();
      if (!trimmed) return null;
      const parsed = parseFloat(trimmed);
      return Number.isFinite(parsed) ? clampScore(parsed) : null;
    };

    const updateCalc = (fromManualKurulOrt = false) => {
      const parsedAra = parseOptionalScore(inpAra.value);
      const parsedSonu = parseOptionalScore(inpSonu.value);
      const parsedPratik = parseOptionalScore(inpPratik.value);
      const a = parsedAra !== null ? parsedAra : state.calcAra;
      const s = parsedSonu !== null ? parsedSonu : state.calcSonu;
      const p = parsedPratik !== null ? parsedPratik : state.calcPratik;
      const wPct = Math.max(0, Math.min(50, Number(state.calcPratikWeight) || 0));
      const w = wPct / 100;

      if (parsedAra !== null) {
        state.calcAra = a;
        saveStore('calcAra', a);
      }
      if (parsedSonu !== null) {
        state.calcSonu = s;
        saveStore('calcSonu', s);
      }
      if (parsedPratik !== null) {
        state.calcPratik = p;
        saveStore('calcPratik', p);
      }
      saveStore('calcPratikWeight', wPct);

      const teorik = a * 0.15 + s * 0.85;
      const kurulScore = teorik * (1 - w) + p * w;
      outTeorik.textContent = teorik.toFixed(2);
      out.textContent = kurulScore.toFixed(2);

      // Required Committee Final score for 60.0 overall committee score
      const teorikNeeded = w < 1 ? (60 - p * w) / (1 - w) : 60;
      const reqKurulSonu = (teorikNeeded - a * 0.15) / 0.85;
      if (reqKurulSonu <= 0) {
        hintEl.textContent = loc.calcKurulHintPassed;
      } else if (reqKurulSonu > 100) {
        hintEl.textContent = loc.calcKurulHintImpossible;
      } else {
        hintEl.textContent = loc.calcKurulHintNeeded(reqKurulSonu.toFixed(1));
      }

      if (!fromManualKurulOrt && state.calcKurulOrt === null) {
        inpKurulOrt.value = kurulScore.toFixed(2);
      } else if (!fromManualKurulOrt && inpKurulOrt.value === '' && state.calcKurulOrt !== null) {
        inpKurulOrt.value = Number(state.calcKurulOrt).toFixed(2);
      }

      const parsedKurulOrt = parseOptionalScore(inpKurulOrt.value);
      const parsedHedef = parseOptionalScore(inpHedefYil.value);
      const kurulOrt = parsedKurulOrt !== null ? parsedKurulOrt : (state.calcKurulOrt !== null ? state.calcKurulOrt : kurulScore);
      const hedef = parsedHedef !== null ? parsedHedef : state.calcHedefYil;
      if (parsedHedef !== null) {
        state.calcHedefYil = hedef;
        saveStore('calcHedefYil', hedef);
      }

      if (state.calcKurulOrt !== null) {
        btnSyncKurulOrt.classList.remove('hidden');
      } else {
        btnSyncKurulOrt.classList.add('hidden');
      }

      const reqFinal = (hedef - kurulOrt * 0.6) / 0.4;
      const projAt50 = (kurulOrt * 0.6 + 50 * 0.4).toFixed(2);

      finalNeedBox.classList.remove('calc-status-pass', 'calc-status-warn', 'calc-status-fail');
      if (reqFinal <= 50) {
        finalNeedBox.classList.add('calc-status-pass');
        finalNeedBox.textContent = loc.finalStatusEasy(Math.max(0, reqFinal).toFixed(1), projAt50);
      } else if (reqFinal <= 100) {
        finalNeedBox.classList.add(reqFinal <= 75 ? 'calc-status-pass' : 'calc-status-warn');
        finalNeedBox.textContent = loc.finalStatusNeed(reqFinal.toFixed(1), hedef.toFixed(0));
      } else {
        finalNeedBox.classList.add('calc-status-fail');
        finalNeedBox.textContent = loc.finalStatusHard(reqFinal.toFixed(1), hedef.toFixed(0));
      }
    };

    if (state.calcKurulOrt !== null) {
      inpKurulOrt.value = Number(state.calcKurulOrt).toFixed(2);
    }
    syncWeightButtons();
    updateCalc(false);

    inpAra.oninput = () => updateCalc(false);
    inpSonu.oninput = () => updateCalc(false);
    inpPratik.oninput = () => updateCalc(false);
    inpHedefYil.oninput = () => updateCalc(true);
    inpKurulOrt.oninput = () => {
      const v = parseOptionalScore(inpKurulOrt.value);
      state.calcKurulOrt = v;
      saveStore('calcKurulOrt', v);
      updateCalc(true);
    };
    btnSyncKurulOrt.onclick = () => {
      state.calcKurulOrt = null;
      saveStore('calcKurulOrt', null);
      updateCalc(false);
    };
    document.querySelectorAll('.pratik-weight-btn').forEach((btn) => {
      btn.onclick = () => {
        state.calcPratikWeight = Number(btn.getAttribute('data-pweight')) || 0;
        syncWeightButtons();
        updateCalc(false);
      };
    });

    const examsContainer = document.getElementById('examsListContainer');
    const countdownBanner = document.getElementById('examCountdownBanner');
    examsContainer.innerHTML = '';

    const toMinutes = (t) => {
      const m = String(t || '').match(/(\d{1,2})[.:](\d{2})/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };

    const activeProg = state.lang === 'en' ? 'en' : 'tr';
    const isEn = state.lang === 'en';
    const mergedExams = [];
    for (const day of days) {
      for (const slot of day.slots) {
        const codeUpper = (slot.code || '').toUpperCase();
        if (
          codeUpper === 'SINAV' ||
          codeUpper === 'DEĞERLENDİRME' ||
          codeUpper === 'EXAM' ||
          /SINAV|EXAM|QUIZ|DEĞERLENDİRME|EVALUATION/i.test(slot.title || '')
        ) {
          const titleText = String(slot.title || '').trim();
          const titleKey = titleText.toLocaleUpperCase(isEn ? 'en-US' : 'tr-TR');
          const parts = String(slot.time || '').split('-').map((p) => p.trim());
          const startTime = parts[0] || '';
          const endTime = parts[1] || '';

          const existing = mergedExams.find(
            (item) => item.date === day.date && item.titleKey === titleKey
          );

          if (existing) {
            const sMin = toMinutes(startTime);
            const eMin = toMinutes(endTime);
            const curSMin = toMinutes(existing.startTime);
            const curEMin = toMinutes(existing.endTime);
            if (sMin !== null && (curSMin === null || sMin < curSMin)) {
              existing.startTime = startTime;
            }
            if (eMin !== null && (curEMin === null || eMin > curEMin)) {
              existing.endTime = endTime;
            }
          } else {
            mergedExams.push({
              date: day.date,
              hasScheduleDay: true,
              title: titleText,
              titleKey,
              startTime,
              endTime,
              rawTime: String(slot.time || '').trim(),
              note: '',
              managed: false,
            });
          }
        }
      }
    }

    // Merge Admin-managed exam countdowns
    const customExams = (Array.isArray(managedExamsList) ? managedExamsList : []).filter(
      (ex) => ex && (!ex.targetProg || ex.targetProg === activeProg)
    );
    customExams.forEach((ex) => {
      const parts = String(ex.time || '').split('-').map((p) => p.trim());
      const tKey = String(ex.title || '').trim().toLocaleUpperCase(isEn ? 'en-US' : 'tr-TR');
      const existing = mergedExams.find((m) => m.date === ex.date && m.titleKey === tKey);
      if (existing) {
        if (ex.time) {
          existing.startTime = parts[0] || '';
          existing.endTime = parts[1] || '';
          existing.rawTime = ex.time;
        }
        if (ex.note) existing.note = ex.note;
        existing.managed = true;
        existing.examId = ex.id || '';
        existing.targetProg = ex.targetProg || '';
      } else {
        mergedExams.push({
          date: ex.date,
          hasScheduleDay: days.some((d) => d.date === ex.date),
          title: ex.title,
          titleKey: tKey,
          startTime: parts[0] || '',
          endTime: parts[1] || '',
          rawTime: ex.time || '',
          note: ex.note || '',
          managed: true,
          examId: ex.id || '',
          targetProg: ex.targetProg || '',
        });
      }
    });

    mergedExams.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));

    const parseExamTargetMs = (item) => {
      const mDate = String(item.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!mDate) return null;
      const tMatch = String(item.startTime || item.rawTime || '09:00').match(/(\d{1,2})[.:](\d{2})/);
      const hh = tMatch ? Number(tMatch[1]) : 9;
      const mm = tMatch ? Number(tMatch[2]) : 0;
      return new Date(Number(mDate[1]), Number(mDate[2]) - 1, Number(mDate[3]), hh, mm, 0, 0).getTime();
    };

    const nowMs = Date.now();
    const nextUpcoming = mergedExams
      .map((item) => ({ item, targetMs: parseExamTargetMs(item) }))
      .filter((x) => x.targetMs !== null && x.targetMs > nowMs - 2 * 60 * 60 * 1000)
      .sort((a, b) => a.targetMs - b.targetMs)[0] || null;

    if (countdownBanner) {
      if (nextUpcoming) {
        const diffMs = Math.max(0, nextUpcoming.targetMs - nowMs);
        const totalMins = Math.floor(diffMs / 60000);
        const dCount = Math.floor(totalMins / (60 * 24));
        const hCount = Math.floor((totalMins % (60 * 24)) / 60);
        const mCount = totalMins % 60;
        const dispTime = nextUpcoming.item.startTime && nextUpcoming.item.endTime
          ? `${nextUpcoming.item.startTime}-${nextUpcoming.item.endTime}`
          : (nextUpcoming.item.rawTime || '');
        countdownBanner.classList.remove('hidden');
        countdownBanner.innerHTML = '';
        const bannerInner = document.createElement('div');
        bannerInner.className = 'space-y-2';
        bannerInner.innerHTML = `
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">${isEn ? 'Next Exam Countdown' : 'Yaklaşan Sınav'}</span>
              <h3 class="text-sm font-bold text-slate-900 dark:text-white mt-1 leading-snug">${escapeHtml(nextUpcoming.item.title)}</h3>
              <p class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">${escapeHtml(formatDateLong(nextUpcoming.item.date))}${dispTime ? ` • ${escapeHtml(dispTime)}` : ''}</p>
            </div>
            <div class="flex items-center gap-1 shrink-0 tabular-nums">
              <div class="ios-pill-control rounded-xl px-2 py-1 text-center min-w-[42px]">
                <div class="text-sm font-extrabold text-indigo-600 dark:text-indigo-300 leading-none">${dCount}</div>
                <div class="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">${isEn ? 'DAY' : 'GÜN'}</div>
              </div>
              <div class="ios-pill-control rounded-xl px-2 py-1 text-center min-w-[42px]">
                <div class="text-sm font-extrabold text-slate-900 dark:text-white leading-none">${String(hCount).padStart(2, '0')}</div>
                <div class="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">${isEn ? 'HR' : 'SA'}</div>
              </div>
              <div class="ios-pill-control rounded-xl px-2 py-1 text-center min-w-[42px]">
                <div class="text-sm font-extrabold text-slate-900 dark:text-white leading-none">${String(mCount).padStart(2, '0')}</div>
                <div class="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">${isEn ? 'MIN' : 'DK'}</div>
              </div>
            </div>
          </div>
          ${nextUpcoming.item.note ? `<p class="text-[11.5px] font-semibold text-rose-600 dark:text-rose-300 bg-rose-500/10 rounded-xl px-2.5 py-1.5 leading-snug">${escapeHtml(nextUpcoming.item.note)}</p>` : ''}
        `;
        if (getActiveAuthSession()?.isAdmin) {
          bindAdminLongPress(bannerInner, () => openAdminExamQuickModal(nextUpcoming.item));
        }
        countdownBanner.appendChild(bannerInner);
      } else {
        countdownBanner.classList.add('hidden');
        countdownBanner.innerHTML = '';
      }
    }

    const examBaseDelay = isTabSwitchRender ? 85 : 0;
    mergedExams.forEach((item, examIdx) => {
      const displayTime =
        item.startTime && item.endTime ? `${item.startTime}-${item.endTime}` : item.rawTime;
      const targetMs = parseExamTargetMs(item);
      let countdownTag = '';
      if (targetMs !== null && targetMs > nowMs) {
        const daysLeft = Math.ceil((targetMs - nowMs) / (24 * 60 * 60 * 1000));
        countdownTag = daysLeft <= 1
          ? (isEn ? 'Soon' : 'Yakın')
          : (isEn ? `${daysLeft}d` : `${daysLeft} gün`);
      }
      const row = document.createElement('div');
      row.className = `${suppressEntryStagger ? '' : 'ios-stagger-item '}ios-pill-control rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2`;
      if (!suppressEntryStagger) {
        row.style.setProperty('--stagger-delay', `${examBaseDelay + Math.min(examIdx, 8) * 28}ms`);
      }
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <p class="text-[11px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums">${escapeHtml(formatDateLong(item.date))}${displayTime ? ` • ${escapeHtml(displayTime)}` : ''}</p>
            ${countdownTag ? `<span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-indigo-500/12 text-indigo-600 dark:text-indigo-300 tabular-nums">${escapeHtml(countdownTag)}</span>` : ''}
          </div>
          <p class="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">${escapeHtml(item.title)}</p>
          ${item.note ? `<p class="text-[11px] font-medium text-amber-700 dark:text-amber-300 mt-0.5 leading-snug">${escapeHtml(item.note)}</p>` : ''}
        </div>
      `;
      if (item.hasScheduleDay) {
        const goBtn = document.createElement('button');
        goBtn.type = 'button';
        goBtn.className = 'ios-press shrink-0 px-2.5 py-1 rounded-full bg-indigo-500/12 text-indigo-600 dark:text-indigo-300 text-xs font-semibold';
        goBtn.textContent = loc.openBtn;
        goBtn.addEventListener('click', () => {
          state.selectedDate = item.date;
          switchTab('daily');
        });
        row.appendChild(goBtn);
      }
      if (getActiveAuthSession()?.isAdmin) {
        bindAdminLongPress(row, () => openAdminExamQuickModal(item));
      }
      examsContainer.appendChild(row);
    });
  }

  // ==================== FOOD / CAFETERIA VIEW (LIVE) ====================
  const INONU_PANEL_BASE = 'https://panel.inonu.edu.tr/';
  let foodFetchSeq = 0;
  let foodAnnouncementsLoaded = false;

  function formatISODate(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseISODate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function isoToDMY(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function shiftISODate(iso, deltaDays) {
    const dt = parseISODate(iso);
    dt.setDate(dt.getDate() + deltaDays);
    return formatISODate(dt);
  }

  function getFoodCacheMap() {
    return loadStore('food_cache_v1', {});
  }

  function setFoodCacheForDate(iso, items) {
    const cache = getFoodCacheMap();
    cache[iso] = { items, ts: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > 35) {
      keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
      for (let i = 0; i < keys.length - 35; i++) {
        delete cache[keys[i]];
      }
    }
    saveStore('food_cache_v1', cache);
  }

  function getWeekdaysForISO(iso) {
    const dt = parseISODate(iso);
    const dayOfWeek = dt.getDay();
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(dt);
    monday.setDate(dt.getDate() + diffToMon);
    const result = [];
    for (let i = 0; i < 5; i++) {
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + i);
      result.push({ dateObj: cur, iso: formatISODate(cur) });
    }
    return result;
  }

  function formatFoodWeekRange(weekdays) {
    const loc = I18N[state.lang];
    const mon = weekdays[0].dateObj;
    const fri = weekdays[4].dateObj;
    if (mon.getMonth() === fri.getMonth()) {
      return `${mon.getDate()} - ${fri.getDate()} ${loc.months[mon.getMonth()]} ${fri.getFullYear()}`;
    }
    return `${mon.getDate()} ${loc.monthsShort[mon.getMonth()]} - ${fri.getDate()} ${loc.monthsShort[fri.getMonth()]} ${fri.getFullYear()}`;
  }

  function getFoodWeekRelativeLabel(mondayDateObj) {
    const loc = I18N[state.lang];
    const todayMon = getWeekdaysForISO(formatISODate(getTodayDateObj()))[0].dateObj;
    const diffWeeks = Math.round((mondayDateObj - todayMon) / (1000 * 60 * 60 * 24 * 7));
    if (diffWeeks === 0) return loc.foodThisWeek;
    if (diffWeeks === 1) return loc.foodNextWeek;
    if (diffWeeks === -1) return loc.foodPrevWeek;
    return loc.foodOtherWeek;
  }

  async function fetchFoodDay(iso) {
    // Tier 1: Same-origin API proxy (bypasses iframe sandboxing, CORS & network adblockers)
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(`/api/food?type=list&date=${encodeURIComponent(iso)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setFoodCacheForDate(iso, data);
          return data;
        }
      }
    } catch (e) {
      // Fall through to Tier 2
    }

    // Tier 2: Direct fetch from Inonu University panel
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(`${INONU_PANEL_BASE}servlet/food?type=list&date=${encodeURIComponent(iso)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : [];
        setFoodCacheForDate(iso, items);
        return items;
      }
    } catch (e) {
      // Fall through to Tier 3
    }

    // Tier 3: CORS proxy mirrors for static hostings (GitHub Pages) or firewalled networks
    const targetUrl = `${INONU_PANEL_BASE}servlet/food?type=list&date=${encodeURIComponent(iso)}`;
    const proxies = [
      `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    ];

    for (const pUrl of proxies) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(pUrl, { signal: controller.signal });
        clearTimeout(tid);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setFoodCacheForDate(iso, data);
            return data;
          }
        }
      } catch (e) {}
    }

    // Tier 4: Local storage cached copy if network is completely offline
    const cached = getFoodCacheMap()[iso];
    if (cached && Array.isArray(cached.items)) {
      return cached.items;
    }

    throw new Error(`FOOD_FETCH_FAILED_${iso}`);
  }

  function getFoodImageUrl(item) {
    if (!item || !item.type || !item.path || !item.name || !item.extension) return '';
    const safePath = String(item.path).replace(/^\/+|\/+$/g, '');
    const safeName = String(item.name).trim();
    const rawExt = String(item.extension).trim();
    const extLower = rawExt.toLowerCase();
    if (!safePath || safePath.includes('..') || !/^[a-zA-Z0-9_/-]+$/.test(safePath)) return '';
    if (!/^[a-zA-Z0-9_.-]+$/.test(safeName) || safeName.includes('..')) return '';
    if (!/^(jpg|jpeg|png|webp|gif)$/.test(extLower)) return '';
    return `${INONU_PANEL_BASE}servlet/image/${safePath}/${safeName}_960x540.${rawExt}`;
  }

  function getFoodTypeLabel(typeCode) {
    const loc = I18N[state.lang];
    if (typeCode === 'C') return loc.foodSpecialC;
    if (typeCode === 'D') return loc.foodSpecialD;
    return loc.foodSpecialOther(typeCode);
  }

  let foodCarouselAnchorMonISO = '';

  function getFoodCarouselWeeks(activeIso) {
    const activeMondayIso = getWeekdaysForISO(activeIso)[0].iso;
    if (!foodCarouselAnchorMonISO) {
      foodCarouselAnchorMonISO = activeMondayIso;
    } else {
      const anchorDt = parseISODate(foodCarouselAnchorMonISO);
      const activeDt = parseISODate(activeMondayIso);
      const diffWeeks = Math.round((activeDt - anchorDt) / (1000 * 60 * 60 * 24 * 7));
      if (Math.abs(diffWeeks) > 6) {
        foodCarouselAnchorMonISO = activeMondayIso;
      }
    }
    const baseMon = parseISODate(foodCarouselAnchorMonISO);
    const weeks = [];
    for (let w = -6; w <= 6; w++) {
      const mon = new Date(baseMon);
      mon.setDate(baseMon.getDate() + w * 7);
      weeks.push(getWeekdaysForISO(formatISODate(mon)));
    }
    return weeks;
  }

  function renderFoodWeekCarousel(activeIso) {
    const carousel = document.getElementById('foodWeekCarousel');
    if (!carousel) return;
    const loc = I18N[state.lang];
    const todayIso = formatISODate(getTodayDateObj());
    const activeWeekdays = getWeekdaysForISO(activeIso);
    const activeWeekKey = activeWeekdays[0].iso;

    document.getElementById('foodCarouselWeekIndicator').textContent = `${getFoodWeekRelativeLabel(activeWeekdays[0].dateObj)} • ${formatFoodWeekRange(activeWeekdays)}`;

    const weeks = getFoodCarouselWeeks(activeIso);
    const needsBuild =
      carousel.children.length === 0 ||
      carousel.getAttribute('data-lang') !== state.lang ||
      carousel.getAttribute('data-anchor') !== foodCarouselAnchorMonISO;

    if (needsBuild) {
      carousel.innerHTML = '';
      carousel.setAttribute('data-lang', state.lang);
      carousel.setAttribute('data-anchor', foodCarouselAnchorMonISO);

      weeks.forEach((week) => {
        const slide = document.createElement('div');
        slide.className = 'week-slide w-full shrink-0 snap-center grid grid-cols-5 gap-1.5 px-1.5 py-1 box-border';
        slide.setAttribute('data-week-key', week[0].iso);

        week.forEach(({ dateObj: cur, iso: curIso }) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('data-iso', curIso);
          btn.className = 'food-day-btn rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center select-none';

          const dShort = document.createElement('span');
          dShort.className = 'text-[10px] font-semibold uppercase tracking-wide opacity-75 leading-tight';
          dShort.textContent = loc.daysShort[cur.getDay()];

          const dNum = document.createElement('span');
          dNum.className = 'text-sm font-bold leading-tight mt-0.5 tabular-nums';
          dNum.textContent = cur.getDate();

          const mShort = document.createElement('span');
          mShort.className = 'text-[9px] font-medium opacity-75 leading-tight';
          mShort.textContent = loc.monthsShort[cur.getMonth()];

          btn.appendChild(dShort);
          btn.appendChild(dNum);
          btn.appendChild(mShort);

          btn.addEventListener('click', () => {
            const prevMon = getWeekdaysForISO(state.foodDateISO || todayIso)[0].iso;
            const clickedMon = getWeekdaysForISO(curIso)[0].iso;
            state.foodDateISO = curIso;
            if (state.foodViewMode === 'weekly' && prevMon === clickedMon) {
              const targetCard = document.getElementById(`foodWeekDay_${curIso}`);
              if (targetCard) {
                targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
              }
            }
            renderFoodView();
          });

          slide.appendChild(btn);
        });

        carousel.appendChild(slide);
      });
    }

    carousel.querySelectorAll('.food-day-btn').forEach((btn) => {
      const curIso = btn.getAttribute('data-iso');
      const isSel = state.foodViewMode === 'daily' && curIso === activeIso;
      const isToday = curIso === todayIso;

      if (isSel) {
        btn.className = 'food-day-btn rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center select-none bg-blue-600 text-white shadow-sm';
      } else if (isToday) {
        btn.className = 'food-day-btn rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center select-none bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/35';
      } else {
        btn.className = 'food-day-btn rounded-2xl py-1.5 px-1 flex flex-col items-center justify-center select-none ios-pill-control text-slate-700 dark:text-slate-200 hover:bg-slate-500/15';
      }
    });

    const targetSlideIndex = weeks.findIndex((w) => w[0].iso === activeWeekKey);
    if (targetSlideIndex >= 0 && carousel.clientWidth > 0) {
      const expectedLeft = targetSlideIndex * carousel.clientWidth;
      if (needsBuild || forceInstantCarouselSync) {
        carousel.scrollLeft = expectedLeft;
      } else if (Math.abs(carousel.scrollLeft - expectedLeft) > 8) {
        carousel.scrollTo({ left: expectedLeft, behavior: 'smooth' });
      }
    }
  }

  function setupFoodCarouselScrollIndicator() {
    const carousel = document.getElementById('foodWeekCarousel');
    if (!carousel) return;
    let scrollTimer = null;
    carousel.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const width = carousel.clientWidth;
        if (!width) return;
        const idx = Math.round(carousel.scrollLeft / width);
        const weeks = getFoodCarouselWeeks(state.foodDateISO || formatISODate(getTodayDateObj()));
        if (weeks[idx]) {
          const mon = weeks[idx][0].dateObj;
          document.getElementById('foodCarouselWeekIndicator').textContent = `${getFoodWeekRelativeLabel(mon)} • ${formatFoodWeekRange(weeks[idx])}`;
          if (state.foodViewMode === 'weekly') {
            const curMon = getWeekdaysForISO(state.foodDateISO || formatISODate(getTodayDateObj()))[0].iso;
            if (weeks[idx][0].iso !== curMon) {
              state.foodDateISO = weeks[idx][0].iso;
              renderFoodView();
            }
          }
        }
      }, 90);
    }, { passive: true });
  }

  function openFoodPhotoModal(imgUrl, title, desc, isoDate) {
    const modal = document.getElementById('foodPhotoModal');
    const card = document.getElementById('foodPhotoModalCard');
    const img = document.getElementById('foodPhotoModalImg');
    const titleEl = document.getElementById('foodPhotoModalTitle');
    const descEl = document.getElementById('foodPhotoModalDesc');
    const dateEl = document.getElementById('foodPhotoModalDate');
    if (!modal || !img) return;
    img.src = imgUrl;
    img.alt = title || '';
    titleEl.textContent = title || '';
    dateEl.textContent = isoDate ? formatDateLong(isoToDMY(isoDate)) : '';
    if (desc) {
      descEl.textContent = desc;
      descEl.classList.remove('hidden');
    } else {
      descEl.textContent = '';
      descEl.classList.add('hidden');
    }
    openAnimatedModal(modal, card);
  }

  function closeFoodPhotoModal() {
    closeAnimatedModal(document.getElementById('foodPhotoModal'), document.getElementById('foodPhotoModalCard'));
  }

  function createFoodDishCard(item, isoDate = '', animIndex = 0, options = {}) {
    const card = document.createElement('div');
    if (options.skipStagger || suppressEntryStagger) {
      card.className = 'ios-glass rounded-2xl overflow-hidden flex flex-col';
    } else {
      card.className = 'ios-glass ios-stagger-item rounded-2xl overflow-hidden flex flex-col';
      const baseDelay = Number(options.baseDelay) || 0;
      card.style.setProperty('--stagger-delay', `${baseDelay + Math.min(animIndex, 10) * 28}ms`);
    }

    const imgWrap = document.createElement('div');
    imgWrap.className = 'relative w-full overflow-hidden bg-slate-200/60 dark:bg-slate-800/60';
    imgWrap.style.aspectRatio = '16 / 10';

    const placeholder = document.createElement('div');
    placeholder.className = 'w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-500';
    placeholder.innerHTML = '<svg class="w-8 h-8 opacity-60" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 14h18M5 14a7 7 0 0114 0M12 4v3m-6 7v2a3 3 0 003 3h6a3 3 0 003-3v-2"></path></svg>';

    const titleStr = (item.food_name || '').trim();
    const descStr = (item.food_desc || '').trim();
    const imgUrl = getFoodImageUrl(item);
    let hasValidPhoto = Boolean(imgUrl);

    if (imgUrl) {
      placeholder.style.display = 'none';
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = titleStr;
      img.loading = 'lazy';
      img.className = 'food-card-img w-full h-full object-cover';
      const markLoaded = () => img.classList.add('is-loaded');
      if (img.complete && img.naturalWidth > 0) {
        markLoaded();
      } else {
        img.addEventListener('load', markLoaded);
      }

      let fallbackAttempt = 0;
      img.addEventListener('error', () => {
        fallbackAttempt++;
        const safePath = String(item.path || '').replace(/^\/+|\/+$/g, '');
        const safeName = String(item.name || '').trim();
        const rawExt = String(item.extension || '').trim();
        const extLower = rawExt.toLowerCase();

        if (fallbackAttempt === 1) {
          // Case fallback: try inverted case (e.g. JPG vs jpg)
          const altExt = rawExt === extLower ? extLower.toUpperCase() : extLower;
          img.src = `${INONU_PANEL_BASE}servlet/image/${safePath}/${safeName}_960x540.${altExt}`;
          return;
        }
        if (fallbackAttempt === 2) {
          // Unresized fallback
          img.src = `${INONU_PANEL_BASE}servlet/image/${safePath}/${safeName}.${rawExt}`;
          return;
        }
        if (fallbackAttempt === 3) {
          // Unresized with inverted case
          const altExt = rawExt === extLower ? extLower.toUpperCase() : extLower;
          img.src = `${INONU_PANEL_BASE}servlet/image/${safePath}/${safeName}.${altExt}`;
          return;
        }
        if (fallbackAttempt === 4) {
          // Local same-origin proxy fallback
          img.src = `/api/food/image/${safePath}/${safeName}_960x540.${rawExt}`;
          return;
        }

        hasValidPhoto = false;
        card.classList.remove('cursor-pointer', 'food-dish-interactive', 'ios-press');
        card.removeAttribute('role');
        card.removeAttribute('tabindex');
        img.style.display = 'none';
        placeholder.style.display = 'flex';
      });
      imgWrap.appendChild(img);

      card.className += ' cursor-pointer food-dish-interactive ios-press';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      const handleOpen = () => {
        if (hasValidPhoto) openFoodPhotoModal(img.currentSrc || img.src || imgUrl, titleStr, descStr, isoDate);
      };
      card.addEventListener('click', handleOpen);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      });
    }
    imgWrap.appendChild(placeholder);

    const body = document.createElement('div');
    body.className = 'p-2.5 flex-1 flex flex-col justify-between gap-1';

    const title = document.createElement('h4');
    title.className = 'text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white leading-snug';
    title.textContent = titleStr;
    body.appendChild(title);

    if (descStr) {
      const badge = document.createElement('span');
      badge.className = 'self-start inline-block px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-300 text-[10px] font-semibold tabular-nums';
      badge.textContent = descStr;
      body.appendChild(badge);
    }

    card.appendChild(imgWrap);
    card.appendChild(body);
    return card;
  }

  function computeFoodDayStats(items) {
    const regular = items.filter((x) => !x.food_type || x.food_type === 'G');
    const grouped = {};
    items.forEach((x) => {
      if (x.food_type && x.food_type !== 'G') {
        if (!grouped[x.food_type]) grouped[x.food_type] = [];
        grouped[x.food_type].push(x);
      }
    });
    const primaryList = regular.length > 0 ? regular : items;
    let totalKcal = 0;
    primaryList.forEach((x) => {
      const m = String(x.food_desc || '').match(/(\d+)/);
      if (m) totalKcal += parseInt(m[1], 10);
    });
    return { regular, grouped, primaryList, totalKcal };
  }

  function formatFoodCacheTimestamp(ts) {
    const dt = new Date(Number(ts) || Date.now());
    const loc = I18N[state.lang];
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${dt.getDate()} ${loc.monthsShort[dt.getMonth()]} ${hh}:${mm}`;
  }

  function createFoodCachedNoticeBanner(cacheMeta) {
    if (!cacheMeta || !cacheMeta.ts) return null;
    const loc = I18N[state.lang];
    const tsStr = formatFoodCacheTimestamp(cacheMeta.ts);
    let label = loc.foodOfflineCachedLabel(tsStr);
    if (cacheMeta.fallbackIso && cacheMeta.requestedIso && cacheMeta.fallbackIso !== cacheMeta.requestedIso) {
      const fDt = parseISODate(cacheMeta.fallbackIso);
      const dateStr = `${fDt.getDate()} ${loc.monthsShort[fDt.getMonth()]}`;
      label = loc.foodOfflineFallbackDayLabel(dateStr, tsStr);
    }
    const bar = document.createElement('div');
    bar.className = 'mb-2 px-3 py-2 rounded-2xl bg-amber-500/12 border border-amber-500/25 flex items-center gap-2 text-[11px] font-semibold text-amber-800 dark:text-amber-200';
    bar.innerHTML = `<svg class="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><span class="truncate">${escapeHtml(label)}</span>`;
    return bar;
  }

  function findBestCachedFoodDayFallback(cache, targetIso) {
    if (!cache || typeof cache !== 'object') return null;
    const exact = cache[targetIso];
    if (exact && Array.isArray(exact.items) && exact.items.length > 0) {
      return { iso: targetIso, items: exact.items, ts: Number(exact.ts) || Date.now(), isFallbackDay: false };
    }
    let best = null;
    for (const [iso, entry] of Object.entries(cache)) {
      if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) continue;
      const ts = Number(entry.ts) || 0;
      if (!best || ts > best.ts) {
        best = { iso, items: entry.items, ts, isFallbackDay: iso !== targetIso };
      }
    }
    return best;
  }

  function findBestCachedFoodWeekFallback(cache, weekdays) {
    if (!cache || typeof cache !== 'object') return null;
    const curWeekItems = weekdays.map((w) => {
      const e = cache[w.iso];
      return e && Array.isArray(e.items) ? e.items : [];
    });
    const curWeekHasAny = curWeekItems.some((arr) => arr.length > 0);
    if (curWeekHasAny) {
      const maxTs = weekdays.reduce((acc, w) => Math.max(acc, Number(cache[w.iso] && cache[w.iso].ts) || 0), 0);
      return { weekdays, weekResults: curWeekItems, ts: maxTs || Date.now(), isFallbackWeek: false };
    }
    const latestDay = findBestCachedFoodDayFallback(cache, weekdays[0].iso);
    if (!latestDay) return null;
    const fbWeekdays = getWeekdaysForISO(latestDay.iso);
    const fbWeekItems = fbWeekdays.map((w) => {
      const e = cache[w.iso];
      return e && Array.isArray(e.items) ? e.items : [];
    });
    const maxTs = fbWeekdays.reduce((acc, w) => Math.max(acc, Number(cache[w.iso] && cache[w.iso].ts) || 0), latestDay.ts);
    return { weekdays: fbWeekdays, weekResults: fbWeekItems, ts: maxTs || latestDay.ts, isFallbackWeek: true };
  }

  function renderFoodItems(items, isoDate, cacheMeta = null) {
    const container = document.getElementById('foodMenuContainer');
    const subInfo = document.getElementById('foodSubInfo');
    const loc = I18N[state.lang];
    container.innerHTML = '';

    const noticeBanner = createFoodCachedNoticeBanner(cacheMeta);
    if (noticeBanner) container.appendChild(noticeBanner);

    if (!Array.isArray(items) || items.length === 0) {
      subInfo.textContent = loc.foodSourceSub;
      const dt = parseISODate(isoDate);
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;

      const emptyBox = document.createElement('div');
      emptyBox.className = `ios-glass ${suppressEntryStagger ? '' : 'ios-stagger-item '}rounded-3xl p-6 text-center space-y-2.5`;
      emptyBox.innerHTML = `
        <div class="w-10 h-10 rounded-2xl ios-pill-control mx-auto flex items-center justify-center text-amber-600 dark:text-amber-300">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 14h18M5 14a7 7 0 0114 0M12 4v3m-6 7v2a3 3 0 003 3h6a3 3 0 003-3v-2"></path></svg>
        </div>
        <h3 class="text-sm font-bold text-slate-900 dark:text-white">${escapeHtml(isWeekend ? loc.foodEmptyWeekendTitle : loc.foodEmptyTitle)}</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(isWeekend ? loc.foodEmptyWeekendDesc : loc.foodEmptyDesc)}</p>
      `;
      if (isWeekend) {
        const mondayBtn = document.createElement('button');
        mondayBtn.type = 'button';
        mondayBtn.className = 'inline-flex items-center px-3.5 py-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold shadow-sm active:scale-95 transition';
        mondayBtn.textContent = loc.foodGoMonday;
        mondayBtn.addEventListener('click', () => {
          const nextMon = new Date(dt);
          nextMon.setDate(dt.getDate() + (dt.getDay() === 6 ? 2 : 1));
          state.foodDateISO = formatISODate(nextMon);
          renderFoodView();
        });
        emptyBox.appendChild(mondayBtn);
      }
      container.appendChild(emptyBox);
      return;
    }

    const { regular, grouped, primaryList, totalKcal } = computeFoodDayStats(items);
    const statsParts = [loc.foodDishCount(primaryList.length)];
    if (totalKcal > 0) statsParts.push(loc.foodCalorieTotal(totalKcal));
    subInfo.textContent = statsParts.join(' • ');

    const foodBaseDelay = isTabSwitchRender ? 45 : 0;
    if (regular.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'space-y-2';
      const hdr = document.createElement('h3');
      hdr.className = `${suppressEntryStagger ? '' : 'ios-stagger-item '}text-xs sm:text-sm font-bold text-slate-900 dark:text-white px-1.5`;
      if (!suppressEntryStagger) {
        hdr.style.setProperty('--stagger-delay', `${foodBaseDelay}ms`);
      }
      hdr.textContent = loc.foodMainMenu;
      sec.appendChild(hdr);

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2.5';
      regular.forEach((item, idx) => grid.appendChild(createFoodDishCard(item, isoDate, idx, { baseDelay: foodBaseDelay })));
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    Object.keys(grouped).forEach((typeKey, gIdx) => {
      const sec = document.createElement('div');
      sec.className = 'space-y-2 pt-1';
      const hdr = document.createElement('h3');
      hdr.className = `${suppressEntryStagger ? '' : 'ios-stagger-item '}text-xs sm:text-sm font-bold text-slate-900 dark:text-white px-1.5`;
      if (!suppressEntryStagger) {
        hdr.style.setProperty('--stagger-delay', `${foodBaseDelay + (gIdx + 1) * 35}ms`);
      }
      hdr.textContent = getFoodTypeLabel(typeKey);
      sec.appendChild(hdr);

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2.5';
      grouped[typeKey].forEach((item, idx) => grid.appendChild(createFoodDishCard(item, isoDate, idx, { baseDelay: foodBaseDelay + (gIdx + 1) * 35 })));
      sec.appendChild(grid);
      container.appendChild(sec);
    });
  }

  function renderFoodWeeklyItems(weekResults, weekdays, cacheMeta = null) {
    const container = document.getElementById('foodMenuContainer');
    const subInfo = document.getElementById('foodSubInfo');
    const loc = I18N[state.lang];
    const todayIso = formatISODate(getTodayDateObj());
    container.innerHTML = '';

    const noticeBanner = createFoodCachedNoticeBanner(cacheMeta);
    if (noticeBanner) container.appendChild(noticeBanner);

    let activeDaysCount = 0;
    let totalPrimaryDishes = 0;

    weekdays.forEach(({ iso }, idx) => {
      const items = Array.isArray(weekResults[idx]) ? weekResults[idx] : [];
      if (items.length > 0) {
        activeDaysCount++;
        const { primaryList } = computeFoodDayStats(items);
        totalPrimaryDishes += primaryList.length;
      }
    });

    if (activeDaysCount === 0) {
      subInfo.textContent = loc.foodSourceSub;
      const emptyBox = document.createElement('div');
      emptyBox.className = `ios-glass ${suppressEntryStagger ? '' : 'ios-stagger-item '}rounded-3xl p-6 text-center space-y-2.5`;
      emptyBox.innerHTML = `
        <div class="w-10 h-10 rounded-2xl ios-pill-control mx-auto flex items-center justify-center text-amber-600 dark:text-amber-300">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 14h18M5 14a7 7 0 0114 0M12 4v3m-6 7v2a3 3 0 003 3h6a3 3 0 003-3v-2"></path></svg>
        </div>
        <h3 class="text-sm font-bold text-slate-900 dark:text-white">${escapeHtml(loc.foodWeekEmptyTitle)}</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(loc.foodWeekEmptyDesc)}</p>
      `;
      container.appendChild(emptyBox);
      return;
    }

    subInfo.textContent = loc.foodWeekSummary(activeDaysCount, totalPrimaryDishes);

    const weekFoodOffset = isTabSwitchRender ? 45 : 0;
    weekdays.forEach(({ iso }, idx) => {
      const items = Array.isArray(weekResults[idx]) ? weekResults[idx] : [];
      const dmy = isoToDMY(iso);
      const isToday = iso === todayIso;

      const daySection = document.createElement('div');
      daySection.id = `foodWeekDay_${iso}`;
      daySection.className = `ios-glass ${suppressEntryStagger ? '' : 'ios-stagger-item '}food-week-card rounded-3xl p-3.5 space-y-2.5${isToday ? ' ring-1 ring-blue-500/40' : ''}`;
      if (!suppressEntryStagger) {
        daySection.style.setProperty('--stagger-delay', `${weekFoodOffset + Math.min(idx, 4) * 45}ms`);
      }

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between gap-2';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'flex items-center gap-2 min-w-0 flex-wrap';

      const h3 = document.createElement('h3');
      h3.className = 'text-xs sm:text-sm font-bold text-slate-900 dark:text-white';
      h3.textContent = formatDateLong(dmy);
      titleWrap.appendChild(h3);

      if (isToday) {
        const todayBadge = document.createElement('span');
        todayBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-300';
        todayBadge.textContent = loc.today;
        titleWrap.appendChild(todayBadge);
      }

      header.appendChild(titleWrap);

      const rightMeta = document.createElement('div');
      rightMeta.className = 'flex items-center gap-2 shrink-0';

      if (items.length > 0) {
        const { primaryList, totalKcal } = computeFoodDayStats(items);
        if (totalKcal > 0) {
          const kcalPill = document.createElement('span');
          kcalPill.className = 'text-[10px] font-semibold text-amber-700 dark:text-amber-300 tabular-nums';
          kcalPill.textContent = `~${totalKcal} kcal`;
          rightMeta.appendChild(kcalPill);
        } else {
          const countPill = document.createElement('span');
          countPill.className = 'text-[10px] font-semibold text-slate-500 dark:text-slate-400';
          countPill.textContent = loc.foodDishCount(primaryList.length);
          rightMeta.appendChild(countPill);
        }

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline';
        openBtn.textContent = loc.openDayBtn;
        openBtn.addEventListener('click', () => {
          state.foodDateISO = iso;
          state.foodViewMode = 'daily';
          renderFoodView();
        });
        rightMeta.appendChild(openBtn);
      }

      header.appendChild(rightMeta);
      daySection.appendChild(header);

      if (items.length === 0) {
        const emptyLine = document.createElement('p');
        emptyLine.className = 'text-xs text-slate-500 dark:text-slate-400 py-1';
        emptyLine.textContent = loc.foodDayUnpublished;
        daySection.appendChild(emptyLine);
      } else {
        const { regular, grouped } = computeFoodDayStats(items);
        const mainItems = regular.length > 0 ? regular : items;
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 sm:grid-cols-4 gap-2';
        mainItems.forEach((item) => grid.appendChild(createFoodDishCard(item, iso, 0, { skipStagger: true })));
        daySection.appendChild(grid);

        Object.keys(grouped).forEach((typeKey) => {
          const spTitle = document.createElement('p');
          spTitle.className = 'text-[11px] font-semibold text-slate-600 dark:text-slate-300 pt-1';
          spTitle.textContent = getFoodTypeLabel(typeKey);
          daySection.appendChild(spTitle);

          const spGrid = document.createElement('div');
          spGrid.className = 'grid grid-cols-2 sm:grid-cols-4 gap-2';
          grouped[typeKey].forEach((item) => spGrid.appendChild(createFoodDishCard(item, iso, 0, { skipStagger: true })));
          daySection.appendChild(spGrid);
        });
      }

      container.appendChild(daySection);
    });
  }

  function renderFoodSkeleton(isWeekly = false) {
    const container = document.getElementById('foodMenuContainer');
    const subInfo = document.getElementById('foodSubInfo');
    const loc = I18N[state.lang];
    subInfo.textContent = isWeekly ? loc.foodWeekLoading : loc.foodLoading;
    container.innerHTML = '';

    if (isWeekly) {
      for (let d = 0; d < 3; d++) {
        const daySk = document.createElement('div');
        daySk.className = 'ios-glass rounded-3xl p-3.5 space-y-2.5 animate-pulse';
        daySk.innerHTML = `
          <div class="h-4 rounded bg-slate-300/50 dark:bg-slate-700/50 w-44"></div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="h-24 rounded-2xl bg-slate-300/40 dark:bg-slate-700/40"></div>
            <div class="h-24 rounded-2xl bg-slate-300/40 dark:bg-slate-700/40"></div>
            <div class="h-24 rounded-2xl bg-slate-300/40 dark:bg-slate-700/40"></div>
            <div class="h-24 rounded-2xl bg-slate-300/40 dark:bg-slate-700/40"></div>
          </div>
        `;
        container.appendChild(daySk);
      }
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2.5';
    for (let i = 0; i < 4; i++) {
      const sk = document.createElement('div');
      sk.className = 'ios-glass rounded-2xl overflow-hidden animate-pulse';
      sk.innerHTML = `<div class="w-full bg-slate-300/40 dark:bg-slate-700/40" style="aspect-ratio: 16 / 10;"></div><div class="p-2.5 space-y-1.5"><div class="h-3.5 rounded bg-slate-300/50 dark:bg-slate-700/50 w-4/5"></div><div class="h-2.5 rounded bg-slate-300/40 dark:bg-slate-700/40 w-1/2"></div></div>`;
      grid.appendChild(sk);
    }
    container.appendChild(grid);
  }

  function renderFoodErrorCard() {
    const loc = I18N[state.lang];
    const container = document.getElementById('foodMenuContainer');
    document.getElementById('foodSubInfo').textContent = loc.foodSourceSub;
    container.innerHTML = '';
    const errBox = document.createElement('div');
    errBox.className = 'ios-glass ios-stagger-item rounded-3xl p-6 text-center space-y-2.5';
    errBox.innerHTML = `
      <h3 class="text-sm font-bold text-slate-900 dark:text-white">${escapeHtml(loc.foodErrorTitle)}</h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(loc.foodErrorDesc)}</p>
    `;
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'inline-flex items-center px-3.5 py-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold shadow-sm active:scale-95 transition';
    retryBtn.textContent = loc.foodRetry;
    retryBtn.addEventListener('click', () => renderFoodView(true));
    errBox.appendChild(retryBtn);
    container.appendChild(errBox);
  }

  function stripHtmlText(raw) {
    return String(raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function renderFoodAnnouncements(list) {
    const box = document.getElementById('foodAnnouncementsContainer');
    if (!box) return;
    if (!Array.isArray(list) || list.length === 0) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const loc = I18N[state.lang];
    box.innerHTML = '';
    list.slice(0, 3).forEach((ann) => {
      if (!ann) return;
      const titleStr = stripHtmlText(ann.title);
      const contentStr = stripHtmlText(ann.content);
      if (!titleStr && !contentStr) return;
      const card = document.createElement('div');
      card.className = 'ios-glass ios-stagger-item rounded-2xl px-3.5 py-2.5 space-y-1 border border-amber-500/25';
      card.innerHTML = `
        <span class="inline-block text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">${escapeHtml(loc.foodAnnouncementBadge)}</span>
        ${titleStr ? `<p class="text-xs font-bold text-slate-900 dark:text-white">${escapeHtml(titleStr)}</p>` : ''}
        ${contentStr ? `<p class="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">${escapeHtml(contentStr)}</p>` : ''}
      `;
      box.appendChild(card);
    });
    box.classList.toggle('hidden', box.children.length === 0);
  }

  async function loadFoodAnnouncementsOnce(force = false) {
    if (foodAnnouncementsLoaded && !force) return;
    foodAnnouncementsLoaded = true;
    try {
      let data = null;
      try {
        const res = await fetch('/api/food?type=announcements', { signal: AbortSignal.timeout(3500) });
        if (res.ok) data = await res.json();
      } catch (e) {}

      if (!data || !Array.isArray(data)) {
        try {
          const res = await fetch(`${INONU_PANEL_BASE}servlet/food?type=announcements`, { signal: AbortSignal.timeout(3500) });
          if (res.ok) data = await res.json();
        } catch (e) {}
      }

      if (Array.isArray(data) && data.length > 0) {
        renderFoodAnnouncements(data);
      }
    } catch (e) {}
  }

  let lastFoodRenderedISO = '';
  let lastFoodRenderedMode = '';

  async function renderFoodView(forceRefresh = false) {
    const todayDate = getTodayDateObj();
    const todayIso = formatISODate(todayDate);

    if (!state.foodDateISO) {
      state.foodDateISO = todayIso;
    }
    const targetIso = state.foodDateISO;
    const dmy = isoToDMY(targetIso);
    const loc = I18N[state.lang];
    const isWeekly = state.foodViewMode === 'weekly';
    const weekdays = getWeekdaysForISO(targetIso);
    const isOfflineNow = typeof navigator !== 'undefined' && navigator.onLine === false;

    let foodAnimClass = '';
    let foodHdrAnimClass = '';
    if (!suppressEntryStagger && !isTabSwitchRender && !forceRefresh) {
      if (lastFoodRenderedMode && lastFoodRenderedMode !== state.foodViewMode) {
        foodAnimClass = 'food-mode-morph';
      } else if (lastFoodRenderedISO && lastFoodRenderedISO !== targetIso) {
        const isNext = targetIso > lastFoodRenderedISO;
        foodAnimClass = isNext ? 'food-slide-next' : 'food-slide-prev';
        foodHdrAnimClass = isNext ? 'food-header-next' : 'food-header-prev';
      }
    }
    lastFoodRenderedISO = targetIso;
    lastFoodRenderedMode = state.foodViewMode;

    persistNavViewState();

    const activePill = 'px-2.5 min-[360px]:px-3 py-1 rounded-full text-xs font-semibold text-slate-900 dark:text-white transition-colors';
    const inactivePill = 'px-2.5 min-[360px]:px-3 py-1 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors';
    const btnFoodDaily = document.getElementById('btnFoodModeDaily');
    const btnFoodWeekly = document.getElementById('btnFoodModeWeekly');
    btnFoodDaily.className = isWeekly ? inactivePill : activePill;
    btnFoodWeekly.className = isWeekly ? activePill : inactivePill;
    updateSegmentedIndicator(
      document.getElementById('foodModeSegmentedBar'),
      document.getElementById('foodModeSegmentedIndicator'),
      isWeekly ? btnFoodWeekly : btnFoodDaily,
      !suppressEntryStagger && !isTabSwitchRender
    );

    const foodDateBtnLabel = document.getElementById('foodDateBtnLabel');
    if (foodDateBtnLabel) {
      const dt = parseISODate(targetIso);
      foodDateBtnLabel.textContent = `${dt.getDate()} ${loc.monthsShort[dt.getMonth()]} ${dt.getFullYear()}`;
    }

    renderFoodWeekCarousel(targetIso);
    if (!isOfflineNow) {
      loadFoodAnnouncementsOnce(forceRefresh);
    }

    const cache = getFoodCacheMap();
    const seq = ++foodFetchSeq;
    const refreshIcon = document.getElementById('iconFoodRefresh');
    if (refreshIcon && forceRefresh) refreshIcon.classList.add('animate-spin-ios');

    const foodHeaderTitleEl = document.getElementById('foodHeaderTitle');
    const foodWeekdayEl = document.getElementById('foodHeaderWeekday');
    const foodRelBadgeEl = document.getElementById('foodRelativeBadge');
    const foodContainerEl = document.getElementById('foodMenuContainer');

    const triggerFoodTransition = () => {
      if (foodHdrAnimClass) {
        [foodHeaderTitleEl, foodWeekdayEl, foodRelBadgeEl].forEach((el) => {
          if (!el) return;
          el.classList.remove('food-header-next', 'food-header-prev');
          void el.offsetWidth;
          el.classList.add(foodHdrAnimClass);
        });
      }
      if (foodContainerEl && foodAnimClass) {
        foodContainerEl.classList.remove('food-slide-next', 'food-slide-prev', 'food-mode-morph');
        void foodContainerEl.offsetWidth;
        foodContainerEl.classList.add(foodAnimClass);
        foodContainerEl.addEventListener('animationend', () => {
          foodContainerEl.classList.remove('food-slide-next', 'food-slide-prev', 'food-mode-morph');
        }, { once: true });
      }
    };

    if (isWeekly) {
      foodHeaderTitleEl.textContent = formatFoodWeekRange(weekdays);
      if (foodWeekdayEl) foodWeekdayEl.classList.add('hidden');
      foodRelBadgeEl.textContent = getFoodWeekRelativeLabel(weekdays[0].dateObj);

      const cachedWeek = weekdays.map((w) => {
        const entry = cache[w.iso];
        return entry && Array.isArray(entry.items) ? entry.items : null;
      });
      const hasFullWeekCached = cachedWeek.every((arr) => arr !== null);
      const bestWeekFallback = findBestCachedFoodWeekFallback(cache, weekdays);

      if (isOfflineNow) {
        if (bestWeekFallback) {
          renderFoodWeeklyItems(bestWeekFallback.weekResults, bestWeekFallback.weekdays, {
            ts: bestWeekFallback.ts,
            isOfflineFallback: true,
          });
        } else {
          renderFoodErrorCard();
        }
        triggerFoodTransition();
        if (refreshIcon) refreshIcon.classList.remove('animate-spin-ios');
        return;
      }

      if (hasFullWeekCached && !forceRefresh) {
        renderFoodWeeklyItems(cachedWeek, weekdays);
      } else {
        renderFoodSkeleton(true);
      }
      triggerFoodTransition();

      try {
        let anyLiveSuccess = false;
        const liveWeek = await Promise.all(
          weekdays.map(async (w) => {
            try {
              const res = await fetchFoodDay(w.iso);
              anyLiveSuccess = true;
              return res;
            } catch (dayErr) {
              const c = cache[w.iso];
              return c && Array.isArray(c.items) ? c.items : null;
            }
          })
        );
        if (seq === foodFetchSeq && state.foodDateISO === targetIso && state.foodViewMode === 'weekly') {
          if (anyLiveSuccess) {
            const normalizedLive = liveWeek.map((arr) => (Array.isArray(arr) ? arr : []));
            if (!hasFullWeekCached || forceRefresh || JSON.stringify(cachedWeek) !== JSON.stringify(normalizedLive)) {
              runWithStaggerSuppressed(() => renderFoodWeeklyItems(normalizedLive, weekdays));
            }
            if (forceRefresh) showToast(loc.foodRefreshedToast);
          } else if (bestWeekFallback) {
            runWithStaggerSuppressed(() =>
              renderFoodWeeklyItems(bestWeekFallback.weekResults, bestWeekFallback.weekdays, {
                ts: bestWeekFallback.ts,
                isOfflineFallback: true,
              })
            );
          } else {
            renderFoodErrorCard();
          }
        }
      } catch (err) {
        if (seq === foodFetchSeq && state.foodDateISO === targetIso && state.foodViewMode === 'weekly') {
          if (bestWeekFallback) {
            runWithStaggerSuppressed(() =>
              renderFoodWeeklyItems(bestWeekFallback.weekResults, bestWeekFallback.weekdays, {
                ts: bestWeekFallback.ts,
                isOfflineFallback: true,
              })
            );
          } else {
            renderFoodErrorCard();
          }
        }
      } finally {
        if (refreshIcon) refreshIcon.classList.remove('animate-spin-ios');
      }
      return;
    }

    foodHeaderTitleEl.textContent = formatDateDayMonthYear(dmy);
    if (foodWeekdayEl) {
      foodWeekdayEl.textContent = formatDateWeekday(dmy);
      foodWeekdayEl.classList.remove('hidden');
    }
    foodRelBadgeEl.textContent = formatRelativeDay(dmy);

    const cachedEntry = cache[targetIso];
    const hasCached = cachedEntry && Array.isArray(cachedEntry.items);
    const bestDayFallback = findBestCachedFoodDayFallback(cache, targetIso);

    if (isOfflineNow) {
      if (hasCached) {
        renderFoodItems(cachedEntry.items, targetIso, {
          ts: Number(cachedEntry.ts) || Date.now(),
          requestedIso: targetIso,
          fallbackIso: targetIso,
          isOfflineFallback: true,
        });
      } else if (bestDayFallback) {
        renderFoodItems(bestDayFallback.items, bestDayFallback.iso, {
          ts: bestDayFallback.ts,
          requestedIso: targetIso,
          fallbackIso: bestDayFallback.iso,
          isOfflineFallback: true,
        });
      } else {
        renderFoodErrorCard();
      }
      triggerFoodTransition();
      if (refreshIcon) refreshIcon.classList.remove('animate-spin-ios');
      return;
    }

    if (hasCached && !forceRefresh) {
      renderFoodItems(cachedEntry.items, targetIso);
    } else {
      renderFoodSkeleton(false);
    }
    triggerFoodTransition();

    try {
      const items = await fetchFoodDay(targetIso);
      if (seq === foodFetchSeq && state.foodDateISO === targetIso && state.foodViewMode === 'daily') {
        const prevStr = hasCached ? JSON.stringify(cachedEntry.items) : '';
        const nextStr = JSON.stringify(items);
        if (!hasCached || forceRefresh || prevStr !== nextStr) {
          runWithStaggerSuppressed(() => renderFoodItems(items, targetIso));
        }
        if (forceRefresh) showToast(loc.foodRefreshedToast);
      }
      // Silently warm remaining weekdays of this week in the background
      const freshCache = getFoodCacheMap();
      weekdays.forEach((w) => {
        if (w.iso !== targetIso && !freshCache[w.iso]) {
          fetchFoodDay(w.iso).catch(() => {});
        }
      });
    } catch (err) {
      if (seq === foodFetchSeq && state.foodDateISO === targetIso && state.foodViewMode === 'daily') {
        if (hasCached) {
          runWithStaggerSuppressed(() =>
            renderFoodItems(cachedEntry.items, targetIso, {
              ts: Number(cachedEntry.ts) || Date.now(),
              requestedIso: targetIso,
              fallbackIso: targetIso,
              isOfflineFallback: true,
            })
          );
        } else if (bestDayFallback) {
          runWithStaggerSuppressed(() =>
            renderFoodItems(bestDayFallback.items, bestDayFallback.iso, {
              ts: bestDayFallback.ts,
              requestedIso: targetIso,
              fallbackIso: bestDayFallback.iso,
              isOfflineFallback: true,
            })
          );
        } else {
          renderFoodErrorCard();
        }
      }
    } finally {
      if (refreshIcon) refreshIcon.classList.remove('animate-spin-ios');
    }
  }

  // ==================== FOOD DATE PICKER MODAL ====================
  const FOOD_CAL_RADIUS = 6;
  let foodPickerYear = 2026;
  let foodPickerMonth = 10;
  let foodCalAnchorMonthNum = 2026 * 12 + 10;
  let foodCalSuppressClick = false;

  function updateFoodCalMonthLabel(direction = 0) {
    const monthLabel = document.getElementById('foodCalMonthLabel');
    if (!monthLabel) return;
    const loc = I18N[state.lang];
    const nextText = `${loc.months[foodPickerMonth]} ${foodPickerYear}`;
    if (monthLabel.textContent === nextText) return;
    monthLabel.textContent = nextText;
    monthLabel.classList.remove('food-cal-label-next', 'food-cal-label-prev');
    if (direction !== 0) {
      void monthLabel.offsetWidth;
      monthLabel.classList.add(direction > 0 ? 'food-cal-label-next' : 'food-cal-label-prev');
    }
  }

  function createFoodCalMonthSlide(year, month, selectedIso, todayIso, cache) {
    const slide = document.createElement('div');
    slide.className = 'w-full shrink-0 snap-center food-cal-grid px-1.5 py-1 box-border';
    slide.setAttribute('data-month-num', String(year * 12 + month));

    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startOffset; i++) {
      const spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      slide.appendChild(spacer);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dt = new Date(year, month, day);
      const iso = formatISODate(dt);
      const dow = dt.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isSelected = iso === selectedIso;
      const isToday = iso === todayIso;
      const hasCachedMenu = Boolean(cache[iso] && Array.isArray(cache[iso].items) && cache[iso].items.length > 0);

      const btn = document.createElement('button');
      btn.type = 'button';
      let cls = 'food-cal-day ';
      if (isSelected) {
        cls += 'bg-blue-600 text-white shadow-sm';
      } else if (isToday) {
        cls += 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/35';
      } else if (isWeekend) {
        cls += 'text-slate-400 dark:text-slate-500 hover:bg-slate-500/10';
      } else {
        cls += 'text-slate-800 dark:text-slate-100 hover:bg-slate-500/15';
      }
      btn.className = cls;

      const numSpan = document.createElement('span');
      numSpan.textContent = String(day);
      btn.appendChild(numSpan);

      if (hasCachedMenu) {
        const dot = document.createElement('span');
        dot.className = `food-cal-dot ${isSelected ? 'bg-white/90' : 'bg-emerald-500'}`;
        btn.appendChild(dot);
      }

      btn.addEventListener('click', () => {
        if (foodCalSuppressClick) return;
        state.foodDateISO = iso;
        closeFoodDateModal();
        renderFoodView();
      });

      slide.appendChild(btn);
    }

    const trailingCount = 42 - (startOffset + daysInMonth);
    for (let i = 0; i < trailingCount; i++) {
      const spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      slide.appendChild(spacer);
    }

    return slide;
  }

  function renderFoodDateModalCarousel(instantSync = true) {
    const loc = I18N[state.lang];
    const weekdaysEl = document.getElementById('foodCalWeekdays');
    const carousel = document.getElementById('foodCalCarousel');
    if (!weekdaysEl || !carousel) return;

    const mondayFirstOrder = [1, 2, 3, 4, 5, 6, 0];
    weekdaysEl.innerHTML = '';
    mondayFirstOrder.forEach((dow) => {
      const sp = document.createElement('span');
      sp.textContent = loc.daysShort[dow];
      if (dow === 0 || dow === 6) sp.className = 'opacity-65';
      weekdaysEl.appendChild(sp);
    });

    const activeMonthNum = foodPickerYear * 12 + foodPickerMonth;
    foodCalAnchorMonthNum = activeMonthNum;
    updateFoodCalMonthLabel(0);

    const selectedIso = state.foodDateISO || formatISODate(getTodayDateObj());
    const todayIso = formatISODate(getTodayDateObj());
    const cache = getFoodCacheMap();

    carousel.innerHTML = '';
    for (let offset = -FOOD_CAL_RADIUS; offset <= FOOD_CAL_RADIUS; offset++) {
      const mNum = foodCalAnchorMonthNum + offset;
      const yr = Math.floor(mNum / 12);
      const mo = ((mNum % 12) + 12) % 12;
      carousel.appendChild(createFoodCalMonthSlide(yr, mo, selectedIso, todayIso, cache));
    }

    if (instantSync && carousel.clientWidth > 0) {
      const prevSnap = carousel.style.scrollSnapType;
      const prevBeh = carousel.style.scrollBehavior;
      carousel.style.scrollSnapType = 'none';
      carousel.style.scrollBehavior = 'auto';
      carousel.scrollLeft = FOOD_CAL_RADIUS * carousel.clientWidth;
      void carousel.offsetWidth;
      carousel.style.scrollSnapType = prevSnap || '';
      carousel.style.scrollBehavior = prevBeh || '';
    }
  }

  let foodCalNavTargetMonthNum = null;

  function setupFoodCalSwipe() {
    const carousel = document.getElementById('foodCalCarousel');
    if (!carousel) return;

    let settleTimer = null;
    const syncFromScroll = () => {
      const width = carousel.clientWidth;
      if (!width) return;
      const idx = Math.max(0, Math.min(FOOD_CAL_RADIUS * 2, Math.round(carousel.scrollLeft / width)));
      const newMonthNum = foodCalAnchorMonthNum - FOOD_CAL_RADIUS + idx;
      const curMonthNum = foodPickerYear * 12 + foodPickerMonth;
      if (newMonthNum !== curMonthNum) {
        const dir = newMonthNum > curMonthNum ? 1 : -1;
        foodPickerYear = Math.floor(newMonthNum / 12);
        foodPickerMonth = ((newMonthNum % 12) + 12) % 12;
        updateFoodCalMonthLabel(dir);
      }

      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        foodCalNavTargetMonthNum = null;
        const settledIdx = Math.max(0, Math.min(FOOD_CAL_RADIUS * 2, Math.round(carousel.scrollLeft / width)));
        if (settledIdx <= 1 || settledIdx >= FOOD_CAL_RADIUS * 2 - 1) {
          renderFoodDateModalCarousel(true);
        }
      }, 140);
    };

    carousel.addEventListener('scroll', syncFromScroll, { passive: true });

    // Smooth mouse-drag support for desktop alongside native touch swipe
    let isMouseDown = false;
    let dragStartX = 0;
    let dragStartScrollLeft = 0;
    let didDrag = false;

    carousel.addEventListener('pointerdown', (e) => {
      foodCalNavTargetMonthNum = null;
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      isMouseDown = true;
      didDrag = false;
      dragStartX = e.clientX;
      dragStartScrollLeft = carousel.scrollLeft;
    });

    carousel.addEventListener('pointermove', (e) => {
      if (!isMouseDown) return;
      const dx = e.clientX - dragStartX;
      if (!didDrag && Math.abs(dx) > 6) {
        didDrag = true;
        carousel.style.scrollSnapType = 'none';
        try { carousel.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (didDrag) {
        carousel.scrollLeft = dragStartScrollLeft - dx;
      }
    });

    const endMouseDrag = (e) => {
      if (!isMouseDown) return;
      isMouseDown = false;
      if (didDrag) {
        foodCalSuppressClick = true;
        setTimeout(() => { foodCalSuppressClick = false; }, 60);
        try { carousel.releasePointerCapture(e.pointerId); } catch (err) {}
        const width = carousel.clientWidth;
        const targetIdx = width > 0 ? Math.max(0, Math.min(FOOD_CAL_RADIUS * 2, Math.round(carousel.scrollLeft / width))) : FOOD_CAL_RADIUS;
        carousel.style.scrollSnapType = '';
        if (width > 0) {
          carousel.scrollTo({ left: targetIdx * width, behavior: 'smooth' });
        }
      }
    };

    carousel.addEventListener('pointerup', endMouseDrag);
    carousel.addEventListener('pointercancel', endMouseDrag);
  }

  function stepFoodCalMonth(delta) {
    const carousel = document.getElementById('foodCalCarousel');
    const baseMonthNum = foodCalNavTargetMonthNum !== null ? foodCalNavTargetMonthNum : (foodPickerYear * 12 + foodPickerMonth);
    const targetMonthNum = baseMonthNum + delta;
    const targetIdx = targetMonthNum - (foodCalAnchorMonthNum - FOOD_CAL_RADIUS);

    if (carousel && carousel.clientWidth > 0 && targetIdx >= 0 && targetIdx <= FOOD_CAL_RADIUS * 2) {
      foodCalNavTargetMonthNum = targetMonthNum;
      carousel.scrollTo({ left: targetIdx * carousel.clientWidth, behavior: 'smooth' });
    } else {
      foodCalNavTargetMonthNum = null;
      foodPickerYear = Math.floor(targetMonthNum / 12);
      foodPickerMonth = ((targetMonthNum % 12) + 12) % 12;
      renderFoodDateModalCarousel(true);
    }
  }

  function openFoodDateModal() {
    const activeIso = state.foodDateISO || formatISODate(getTodayDateObj());
    const dt = parseISODate(activeIso);
    foodPickerYear = dt.getFullYear();
    foodPickerMonth = dt.getMonth();
    foodCalNavTargetMonthNum = null;
    const modal = document.getElementById('foodDateModal');
    const card = document.getElementById('foodDateModalCard');
    openAnimatedModal(modal, card);
    renderFoodDateModalCarousel(true);
  }

  function closeFoodDateModal() {
    closeAnimatedModal(document.getElementById('foodDateModal'), document.getElementById('foodDateModalCard'));
  }

  // ==================== NOTE MODAL ====================
  function openNoteModal(slot) {
    state.modalSlotKey = `${slot.date}_${slot.slotNo}`;
    document.getElementById('noteModalSubtitle').textContent = `${formatDateLong(slot.date)} • ${slot.time} — ${slot.title}`;
    const textarea = document.getElementById('noteModalTextarea');
    textarea.value = state.notes[state.modalSlotKey] || '';
    openAnimatedModal(document.getElementById('noteModal'), document.getElementById('noteModalCard'), () => {
      textarea.focus();
    });
  }

  function closeNoteModal() {
    closeAnimatedModal(document.getElementById('noteModal'), document.getElementById('noteModalCard'), () => {
      state.modalSlotKey = null;
    });
  }

  // ==================== MULTIPLE LESSON PDFs MODAL ====================
  function openLessonPdfsModal(slot, matList) {
    const modal = document.getElementById('lessonPdfsModal');
    const card = document.getElementById('lessonPdfsModalCard');
    const titleEl = document.getElementById('lessonPdfsModalTitle');
    const countEl = document.getElementById('lessonPdfsModalCount');
    const subEl = document.getElementById('lessonPdfsModalSubtitle');
    const listEl = document.getElementById('lessonPdfsModalList');
    if (!modal || !card || !listEl || !Array.isArray(matList) || matList.length === 0) return;

    if (titleEl) {
      titleEl.textContent = state.lang === 'en' ? 'Lesson PDFs' : 'Ders PDF\'leri';
    }
    if (countEl) {
      countEl.textContent = `${matList.length} PDF`;
    }
    if (subEl && slot) {
      subEl.textContent = `${formatDateLong(slot.date)} • ${slot.time} — ${slot.title}`;
    }

    listEl.innerHTML = '';
    matList.forEach((material, idx) => {
      const pdfLabel = material.title || material.pdfName || (state.lang === 'en' ? `PDF ${idx + 1}` : `PDF ${idx + 1}`);
      const sizeLabel = typeof material.fileSize === 'number' && material.fileSize > 0
        ? formatPdfBytesLabel(material.fileSize)
        : '';
      const isDirectDownload = Boolean(material.pdfData) || Number(material.chunkCount) > 0 || material.sourceType === 'chunks' || (typeof material.pdfUrl === 'string' && material.pdfUrl.startsWith('/api/lesson-pdf/'));
      const metaTxt = isDirectDownload
        ? `${material.pdfName || pdfLabel}${sizeLabel ? ` • ${sizeLabel}` : ''}`
        : material.pdfUrl;
      const isCachedPdf = isPdfCachedOnDevice(material.id);

      const row = document.createElement('div');
      row.className = 'ios-pill-control rounded-2xl p-2.5 flex items-center justify-between gap-2.5';
      row.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <span class="w-8 h-8 rounded-xl ${isCachedPdf ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/12 text-rose-600 dark:text-rose-300'} flex items-center justify-center shrink-0">
            ${isCachedPdf
              ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>'
              : '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>'
            }
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <p class="slot-title-wrap text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug">${escapeHtml(pdfLabel)}</p>
              ${isCachedPdf ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9.5px] font-bold shrink-0">${escapeHtml(I18N[state.lang].pdfCachedBadge)}</span>` : ''}
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate tabular-nums">${escapeHtml(metaTxt || '')}</p>
          </div>
        </div>
      `;

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'ios-press min-h-[44px] shrink-0 px-3.5 py-2 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/20 text-rose-600 dark:text-rose-300 text-xs font-bold transition';
      openBtn.textContent = state.lang === 'en' ? 'Open' : 'Aç';
      openBtn.addEventListener('click', () => {
        openOrDownloadLessonMaterial(material);
      });
      row.appendChild(openBtn);
      listEl.appendChild(row);
    });

    openAnimatedModal(modal, card);
  }

  function closeLessonPdfsModal() {
    closeAnimatedModal(document.getElementById('lessonPdfsModal'), document.getElementById('lessonPdfsModalCard'));
  }

  // ==================== CALENDAR (.ics) ====================
  function exportSlotsToIcs(slots, filename) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Inonu Tip Donem I//TR', 'CALSCALE:GREGORIAN'];
    for (const slot of slots) {
      const [d, m, y] = slot.date.split('.');
      const [startT, endT] = slot.time.split('-');
      const [sh, sm] = startT.split('.');
      const [eh, em] = endT.split('.');
      const locStr = state.lang === 'en' ? 'İnönü University Faculty of Medicine' : 'İnönü Üniversitesi Tıp Fakültesi';
      const codePrefix = slot.code ? `${slot.code} - ` : '';
      lines.push(
        'BEGIN:VEVENT',
        `UID:${y}${m}${d}-${slot.slotNo}-${state.lang}@inonu-tip`,
        `DTSTART:${y}${m}${d}T${sh}${sm}00`,
        `DTEND:${y}${m}${d}T${eh}${em}00`,
        `SUMMARY:${codePrefix}${slot.title}`.replace(/[,;]/g, ' '),
        `DESCRIPTION:${slot.instructor ? slot.instructor + ' ' : ''}${slot.group || ''}`.trim().replace(/[,;]/g, ' '),
        `LOCATION:${locStr}`,
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(t('icsSavedToast'));
  }

  // ==================== OPTIONAL STUDENT AUTH MODAL & ADMIN CONTROLLER ====================
  let activeAnnouncementsList = [];
  let announcementsInitialFetchDone = false;
  let cancelledLessonsList = loadStore('cancelledLessonsCache', []);
  let cancelledLessonsMap = {};
  let cancelledLessonsUnsub = null;
  let lessonMaterialsMap = {};
  let lessonMaterialsInitialFetchDone = false;
  let lessonMaterialsInFlightPromise = null;
  let lessonMaterialsUnsub = null;
  let lessonMaterialsRetryTimer = null;

  function buildCancelledMapKey(prog, dateStr, slotNo) {
    const cleanProg = prog === 'en' ? 'en' : 'tr';
    const cleanDate = String(dateStr || '').trim();
    const cleanSlot = Number(slotNo) || 0;
    return `${cleanProg}|${cleanDate}|${cleanSlot}`;
  }

  function rebuildCancelledLessonsMap(list) {
    const nextMap = {};
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (!item || !item.date || !item.slotNo) return;
      const key = buildCancelledMapKey(item.targetProg, item.date, item.slotNo);
      nextMap[key] = item;
    });
    cancelledLessonsMap = nextMap;
  }
  rebuildCancelledLessonsMap(cancelledLessonsList);

  function getCancelledLessonInfo(slot, progOverride) {
    if (!slot || !slot.date || !slot.slotNo) return null;
    const prog = progOverride || (state.lang === 'en' ? 'en' : 'tr');
    return cancelledLessonsMap[buildCancelledMapKey(prog, slot.date, slot.slotNo)] || null;
  }

  function applyLoadedCancelledLessonsList(list) {
    cancelledLessonsList = Array.isArray(list) ? list : [];
    rebuildCancelledLessonsMap(cancelledLessonsList);
    saveStore('cancelledLessonsCache', cancelledLessonsList);
    if (typeof adminState !== 'undefined' && adminState) {
      adminState.cancelledLessons = [...cancelledLessonsList];
    }
    invalidateScheduleRenderCache();
    runWithStaggerSuppressed(() => {
      if (state.activeTab === 'daily') renderDailyView();
      if (state.activeTab === 'weekly') renderWeeklyView();
      if (state.activeTab === 'search') renderSearchView();
    });
    const adminModalEl = document.getElementById('adminModal');
    if (adminModalEl && !adminModalEl.classList.contains('hidden')) {
      renderAdminCancelDaySlots();
      renderAdminCancelledList();
    }
    const instModalEl = document.getElementById('instructorModal');
    if (instModalEl && !instModalEl.classList.contains('hidden') && activeDetailModalValue) {
      renderSlotDetailModalContent(activeDetailModalMode, activeDetailModalValue);
    }
  }

  async function refreshCancelledLessons() {
    const api = window.__INONU_AUTH__;
    if (!api || typeof api.loadCancelledLessons !== 'function') return;
    try {
      const list = await api.loadCancelledLessons();
      applyLoadedCancelledLessonsList(list);
    } catch {}
  }

  function buildLessonMaterialsMap(list) {
    const nextMap = {};
    (Array.isArray(list) ? list : []).forEach((m) => {
      if (!m || !m.date) return;
      const k1 = `${m.date}_${m.slotNo}`;
      const k2 = normLessonMatKey(m.date, m.slotNo);
      if (!Array.isArray(nextMap[k1])) nextMap[k1] = [];
      nextMap[k1].push(m);
      if (k2 && k2 !== k1) {
        if (!Array.isArray(nextMap[k2])) nextMap[k2] = [];
        nextMap[k2].push(m);
      }
    });
    return nextMap;
  }

  function saveCachedLessonMaterialsMeta(list) {
    try {
      const slim = (Array.isArray(list) ? list : []).map((m) => ({
        id: m.id,
        date: m.date,
        slotNo: m.slotNo,
        targetProg: m.targetProg || '',
        title: m.title || '',
        sourceType: m.sourceType || '',
        pdfUrl: m.pdfUrl || '',
        chunkCount: Number(m.chunkCount) || 0,
        pdfName: m.pdfName || '',
        fileSize: Number(m.fileSize) || 0,
        hasInlinePdfData: Boolean(m.pdfData),
        createdAtMs: m.createdAtMs || 0,
        updatedAtMs: m.updatedAtMs || 0
      }));
      saveStore('lessonMaterialsMetaCache', slim);
    } catch {}
  }

  function hydrateCachedLessonMaterials() {
    try {
      const fullCached = loadStore('lessonMaterialsFullCache', null);
      if (Array.isArray(fullCached) && fullCached.length > 0) {
        lessonMaterialsMap = buildLessonMaterialsMap(fullCached);
        return;
      }
    } catch {}
    const cached = loadStore('lessonMaterialsMetaCache', null);
    if (!Array.isArray(cached) || cached.length === 0) return;
    if (Object.keys(lessonMaterialsMap).length > 0) return;
    lessonMaterialsMap = buildLessonMaterialsMap(cached);
  }

  function applyLoadedLessonMaterialsList(list) {
    const safeList = Array.isArray(list) ? list : [];
    lessonMaterialsMap = buildLessonMaterialsMap(safeList);
    lessonMaterialsInitialFetchDone = true;
    if (lessonMaterialsRetryTimer) {
      clearTimeout(lessonMaterialsRetryTimer);
      lessonMaterialsRetryTimer = null;
    }
    saveCachedLessonMaterialsMeta(safeList);
    try {
      saveStore('lessonMaterialsFullCache', safeList);
    } catch {}
    runWithStaggerSuppressed(() => {
      renderDailyView();
      renderWeeklyView();
      if (state.activeTab === 'search') renderSearchView();
    });
  }

  async function refreshLessonMaterials(force = false) {
    const api = window.__INONU_AUTH__;
    if (!api || typeof api.loadAllLessonMaterials !== 'function') {
      try {
        const resp = await fetch('/api/materials', { cache: 'no-store' });
        if (resp.ok) {
          const json = await resp.json();
          if (json && Array.isArray(json.materials)) {
            applyLoadedLessonMaterialsList(json.materials);
          }
        }
      } catch {}
      return;
    }
    if (lessonMaterialsInFlightPromise && !force) {
      return lessonMaterialsInFlightPromise;
    }
    if (lessonMaterialsInitialFetchDone && !force) {
      runWithStaggerSuppressed(() => {
        renderDailyView();
        renderWeeklyView();
        if (state.activeTab === 'search') renderSearchView();
      });
      return;
    }
    const req = (async () => {
      try {
        const list = await api.loadAllLessonMaterials();
        applyLoadedLessonMaterialsList(list);
        return list;
      } catch {
        if (!lessonMaterialsInitialFetchDone && !lessonMaterialsRetryTimer) {
          lessonMaterialsRetryTimer = setTimeout(() => {
            lessonMaterialsRetryTimer = null;
            void refreshLessonMaterials(true);
          }, 1800);
        }
        return [];
      } finally {
        if (lessonMaterialsInFlightPromise === req) {
          lessonMaterialsInFlightPromise = null;
        }
      }
    })();
    lessonMaterialsInFlightPromise = req;
    return req;
  }

  function renderDailyAnnouncements() {
    const container = document.getElementById('dailyAnnouncementsContainer');
    if (!container) return;
    const loc = I18N[state.lang];
    container.innerHTML = '';

    const session = getActiveAuthSession();
    const studentGroup = state.myMbuGroup || (session ? session.group : '');
    const activeProg = state.lang === 'en' ? 'en' : 'tr';
    const isAdminAllPreview = Boolean(session && session.isAdmin && !state.myMbuGroup);
    const nowMs = Date.now();
    const visibleAnns = (activeAnnouncementsList || []).filter((ann) => {
      if (ann.publishAtMs && Number(ann.publishAtMs) > nowMs) return false;
      if (ann.expiresAtMs && Number(ann.expiresAtMs) > 0 && Number(ann.expiresAtMs) <= nowMs) return false;
      if (ann.targetGroup && !isAdminAllPreview && ann.targetGroup !== studentGroup) return false;
      if (ann.targetProg && ann.targetProg !== activeProg) return false;
      return true;
    });

    if (!Array.isArray(visibleAnns) || visibleAnns.length === 0) {
      container.classList.add('hidden');
      return;
    }
    container.classList.remove('hidden');
    visibleAnns.forEach((ann, idx) => {
      const tone = ann.tone === 'urgent' ? 'urgent' : ann.tone === 'warn' ? 'warn' : 'info';
      const badgeCls =
        tone === 'urgent'
          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
          : tone === 'warn'
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            : 'bg-blue-500/15 text-blue-600 dark:text-blue-300';
      const badgeLabel =
        tone === 'urgent' ? loc.adminAnnBadgeUrgent : tone === 'warn' ? loc.adminAnnBadgeWarn : loc.adminAnnBadgeInfo;

      const card = document.createElement('div');
      card.dataset.annId = String(ann.id || '');
      card.className = `ios-glass ${suppressEntryStagger ? '' : 'ios-stagger-item '}rounded-2xl px-3.5 py-3 space-y-1`;
      if (!suppressEntryStagger) {
        card.style.setProperty('--stagger-delay', `${Math.min(idx, 4) * 35}ms`);
      }
      card.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${badgeCls}">${escapeHtml(badgeLabel)}</span>
            <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(ann.title)}</h4>
          </div>
        </div>
        <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">${escapeHtml(ann.message)}</p>
      `;
      if (session && session.isAdmin) {
        bindAdminLongPress(card, () => openAdminAnnQuickModal(ann));
      }
      container.appendChild(card);
    });
  }

  async function refreshDailyAnnouncements(force = false) {
    const api = window.__INONU_AUTH__;
    if (!api || typeof api.loadActiveAnnouncements !== 'function') return;
    void refreshLessonMaterials(force);
    try {
      activeAnnouncementsList = await api.loadActiveAnnouncements();
    } catch (e) {
      activeAnnouncementsList = [];
    }
    announcementsInitialFetchDone = true;
    runWithStaggerSuppressed(() => renderDailyAnnouncements());
  }

  function getActiveAuthSession() {
    const api = window.__INONU_AUTH__;
    if (!api || typeof api.verifyStudentHash !== 'function') return null;
    const saved = loadStore('authSession', null);
    if (!saved || typeof saved.hash !== 'string') return null;
    if (typeof saved.name !== 'string' || !saved.name.trim()) return null;

    const allowMeta = api.verifyStudentHash(saved.hash);
    let resolvedGroup = allowMeta ? allowMeta.group : '';
    let resolvedProg = allowMeta ? allowMeta.prog : '';
    let source = 'allowlist';

    if (!allowMeta) {
      const validHash = typeof api.isValidAuthHash === 'function' ? api.isValidAuthHash(saved.hash) : /^[a-f0-9]{32}$/.test(saved.hash);
      const validCustomGroup = typeof saved.group === 'string' && ['I', 'II', 'III', 'IV', 'V'].includes(saved.group);
      if (saved.source === 'custom' && validHash && validCustomGroup) {
        resolvedGroup = saved.group;
        resolvedProg = saved.prog === 'en' ? 'en' : 'tr';
        source = 'custom';
      } else {
        return null;
      }
    }

    const cloudKey = (typeof saved.cloudKey === 'string' && typeof api.isValidCloudDocId === 'function' && api.isValidCloudDocId(saved.cloudKey))
      ? saved.cloudKey
      : '';
    const isAdmin = Boolean(
      saved.isAdmin === true &&
      typeof api.isAdminStudentHash === 'function' &&
      api.isAdminStudentHash(saved.hash)
    );
    const adminSecret = (isAdmin && typeof saved.adminSecret === 'string' && /^[a-f0-9]{64}$/.test(saved.adminSecret))
      ? saved.adminSecret
      : '';
    if (adminSecret && typeof api.setAdminWriteSecret === 'function') {
      api.setAdminWriteSecret(adminSecret);
    }

    return {
      hash: saved.hash,
      cloudKey,
      last4: typeof saved.last4 === 'string' ? saved.last4 : '••••',
      group: resolvedGroup,
      prog: resolvedProg,
      name: saved.name.trim(),
      source,
      isAdmin,
      adminSecret
    };
  }

  function updateAuthSessionSummary() {
    const titleEl = document.getElementById('authSessionTitle');
    const descEl = document.getElementById('authSessionDesc');
    const infoBtn = document.getElementById('btnAuthActionInfo');
    const dailyBtn = document.getElementById('btnAuthActionDaily');
    const dailyIcon = document.getElementById('authActionDailyIcon');
    const dailyLabel = document.getElementById('btnAuthActionDailyLabel');
    const welcomeBarEl = document.getElementById('dailyWelcomeBar');
    const welcomeTextEl = document.getElementById('dailyWelcomeText');
    const welcomeGroupEl = document.getElementById('dailyWelcomeGroupPill');
    const adminCardEl = document.getElementById('adminSettingsCard');
    const loc = I18N[state.lang];
    const session = getActiveAuthSession();

    if (adminCardEl) {
      adminCardEl.classList.toggle('hidden', !session || !session.isAdmin);
    }

    if (!session) {
      if (titleEl) titleEl.textContent = loc.authGuestTitle;
      if (descEl) descEl.textContent = loc.authGuestDesc;
      if (infoBtn) {
        infoBtn.textContent = loc.authLoginShortBtn;
        infoBtn.className = 'ios-press w-full min-[360px]:w-auto min-h-[44px] justify-center px-3.5 py-2 rounded-full bg-indigo-500/12 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-semibold transition text-center';
      }
      if (dailyBtn) {
        dailyBtn.className = 'daily-action-pill ios-press rounded-full ios-pill-control hover:bg-blue-500/15 font-semibold text-blue-600 dark:text-blue-400 shadow-2xs transition';
      }
      if (dailyIcon) {
        dailyIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path>';
      }
      if (dailyLabel) dailyLabel.textContent = loc.authLoginShortBtn;
      if (welcomeBarEl) welcomeBarEl.classList.add('hidden');
      if (welcomeTextEl) welcomeTextEl.textContent = '';
      if (welcomeGroupEl) welcomeGroupEl.textContent = '';
      return;
    }

    if (titleEl) titleEl.textContent = loc.authSessionTitle;
    if (descEl) {
      const maskedHtml = `<span class="masked-id-dots">•••••••</span><span class="font-mono font-bold">${escapeHtml(session.last4)}</span>`;
      const groupText = loc.authWelcomeGroupBadge ? loc.authWelcomeGroupBadge(session.group) : `Grup ${session.group}`;
      const adminTag = session.isAdmin ? ` • ${loc.authAdminPwdBadge}` : '';
      descEl.innerHTML = session.name
        ? `${escapeHtml(session.name)} • ${maskedHtml} • ${escapeHtml(groupText)}${escapeHtml(adminTag)}`
        : `${maskedHtml} • ${escapeHtml(groupText)}${escapeHtml(adminTag)}`;
    }
    if (infoBtn) {
      infoBtn.textContent = loc.authLogoutBtn;
      infoBtn.className = 'ios-press w-full min-[360px]:w-auto min-h-[44px] justify-center px-3.5 py-2 rounded-full bg-rose-500/12 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold transition text-center';
    }
    if (dailyBtn) {
      dailyBtn.className = 'daily-action-pill ios-press rounded-full ios-pill-control hover:bg-rose-500/15 font-semibold text-rose-600 dark:text-rose-400 shadow-2xs transition';
    }
    if (dailyIcon) {
      dailyIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>';
    }
    if (dailyLabel) dailyLabel.textContent = loc.authLogoutBtn;

    if (welcomeBarEl && welcomeTextEl) {
      welcomeTextEl.textContent = loc.authWelcomeGreeting(session.name);
      if (welcomeGroupEl) {
        welcomeGroupEl.textContent = session.isAdmin
          ? `${loc.authWelcomeGroupBadge(session.group)} • ${loc.authAdminPwdBadge}`
          : loc.authWelcomeGroupBadge(session.group);
      }
      welcomeBarEl.classList.remove('hidden');
    }
  }

  function showAuthError(msg) {
    const errEl = document.getElementById('authErrorMsg');
    const cardEl = document.getElementById('authGateCard');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
    if (cardEl) {
      cardEl.classList.remove('ios-shake');
      void cardEl.offsetWidth;
      cardEl.classList.add('ios-shake');
    }
    triggerHaptic('error');
  }

  function clearAuthError() {
    const errEl = document.getElementById('authErrorMsg');
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
  }

  let authLoginStep = 'id';
  let authPendingAdminId = '';
  let siteRequireStudentLogin = loadStore('siteRequireLoginCache', false) === true;
  let siteAccessUpdatedAtMs = Number(loadStore('siteAccessUpdatedAtMs', 0)) || 0;
  let siteAccessSettingsUnsub = null;
  let authGateOpenedByLock = false;

  function isSiteLoginLocked() {
    if (!siteRequireStudentLogin) return false;
    const session = getActiveAuthSession();
    return !session;
  }

  function syncAuthStepUI() {
    const loc = I18N[state.lang];
    const idWrap = document.getElementById('authStudentIdWrap');
    const pwdWrap = document.getElementById('authAdminPasswordWrap');
    const subtitleEl = document.getElementById('authSubtitle');
    const submitEl = document.getElementById('btnAuthSubmit');
    const backBtnEl = document.getElementById('btnAuthBackToId');
    const chipEl = document.getElementById('authStep2IdChip');
    const isPwdStep = authLoginStep === 'password';
    const isLockedGate = isSiteLoginLocked();

    if (idWrap) idWrap.classList.toggle('hidden', isPwdStep);
    if (pwdWrap) pwdWrap.classList.toggle('hidden', !isPwdStep);
    if (subtitleEl) {
      subtitleEl.textContent = isPwdStep
        ? loc.authAdminStepSubtitle
        : (isLockedGate ? loc.authLockedSubtitle : loc.authSubtitle);
    }
    if (submitEl) submitEl.textContent = isPwdStep ? loc.authAdminVerifyBtn : loc.authSubmitBtn;
    if (backBtnEl) backBtnEl.textContent = loc.authAdminChangeIdBtn;
    if (chipEl && authPendingAdminId) {
      chipEl.textContent = `•••••••${authPendingAdminId.slice(-4)}`;
    }
  }

  function setAuthLoginStep(step, cleanedId = '') {
    const nextStep = step === 'password' ? 'password' : 'id';
    const idWrap = document.getElementById('authStudentIdWrap');
    const pwdWrap = document.getElementById('authAdminPasswordWrap');
    const idInp = document.getElementById('authStudentIdInput');
    const pwdInp = document.getElementById('authAdminPasswordInput');

    authLoginStep = nextStep;
    authPendingAdminId = nextStep === 'password' ? String(cleanedId || '') : '';
    syncAuthStepUI();

    if (nextStep === 'password') {
      if (pwdInp) pwdInp.value = '';
      if (pwdWrap) {
        pwdWrap.classList.remove('ios-stagger-item');
        void pwdWrap.offsetWidth;
        pwdWrap.classList.add('ios-stagger-item');
      }
      requestAnimationFrame(() => {
        if (pwdInp) pwdInp.focus();
      });
    } else {
      if (pwdInp) {
        pwdInp.value = '';
        pwdInp.type = 'password';
      }
      const eyeOpen = document.getElementById('iconPwdEyeOpen');
      const eyeClosed = document.getElementById('iconPwdEyeClosed');
      if (eyeOpen) eyeOpen.classList.remove('hidden');
      if (eyeClosed) eyeClosed.classList.add('hidden');
      if (idWrap) {
        idWrap.classList.remove('ios-stagger-item');
        void idWrap.offsetWidth;
        idWrap.classList.add('ios-stagger-item');
      }
      if (cleanedId && idInp) {
        idInp.value = cleanedId;
      }
    }
  }

  function getStudentPrefs(hash) {
    if (!hash) return {};
    const all = loadStore('studentPrefs', {});
    return (all && typeof all === 'object' && all[hash] && typeof all[hash] === 'object') ? all[hash] : {};
  }

  function saveLocalStudentPrefs(hash, prefs) {
    if (!hash || !prefs || typeof prefs !== 'object') return;
    const all = loadStore('studentPrefs', {});
    const next = (all && typeof all === 'object') ? all : {};
    next[hash] = {
      myMbuGroup: typeof prefs.myMbuGroup === 'string' ? prefs.myMbuGroup : '',
      myLabGroup: typeof prefs.myLabGroup === 'string' ? prefs.myLabGroup : '',
      otherGroupMode: prefs.otherGroupMode === 'hide' ? 'hide' : 'dim',
      lang: prefs.lang === 'en' ? 'en' : prefs.lang === 'tr' ? 'tr' : '',
      updatedAtMs: typeof prefs.updatedAtMs === 'number' && prefs.updatedAtMs > 0 ? prefs.updatedAtMs : Date.now()
    };
    saveStore('studentPrefs', next);
  }

  let lastLocalPrefsWriteAt = 0;
  let studentPrefsCloudUnsub = null;
  let studentPrefsWatchedKey = '';

  function stopStudentPrefsCloudSubscription() {
    if (typeof studentPrefsCloudUnsub === 'function') {
      try { studentPrefsCloudUnsub(); } catch (e) {}
    }
    studentPrefsCloudUnsub = null;
    studentPrefsWatchedKey = '';
  }

  function syncStudentPrefsCloudSubscription() {
    const session = getActiveAuthSession();
    const api = window.__INONU_AUTH__;
    if (!session || !session.hash || !session.cloudKey || !api || typeof api.subscribeCloudStudentPrefs !== 'function') {
      if (!session) stopStudentPrefsCloudSubscription();
      return;
    }
    if (studentPrefsWatchedKey === session.cloudKey && studentPrefsCloudUnsub) return;
    stopStudentPrefsCloudSubscription();
    studentPrefsWatchedKey = session.cloudKey;
    studentPrefsCloudUnsub = api.subscribeCloudStudentPrefs(session.cloudKey, (cloudPrefs) => {
      if (!cloudPrefs || typeof cloudPrefs !== 'object') return;
      const incomingTs = Number(cloudPrefs.updatedAtMs) || 0;
      if (lastLocalPrefsWriteAt > 0 && Date.now() - lastLocalPrefsWriteAt < 1200 && incomingTs < lastLocalPrefsWriteAt) {
        return;
      }
      applySyncedCloudPrefs(session.hash, cloudPrefs);
    });
  }

  async function ensureSessionCloudKey() {
    const session = getActiveAuthSession();
    if (!session || !session.hash) return '';
    if (session.cloudKey && /^[a-f0-9]{64}$/.test(String(session.cloudKey).trim().toLowerCase())) {
      return String(session.cloudKey).trim().toLowerCase();
    }
    const api = window.__INONU_AUTH__;
    if (!api || typeof api.resolveStudentCloudKey !== 'function') return '';
    try {
      const resolved = await api.resolveStudentCloudKey(session.hash);
      if (resolved && /^[a-f0-9]{64}$/.test(resolved)) {
        const updatedSession = { ...session, cloudKey: resolved };
        saveStore('authSession', updatedSession);
        return resolved;
      }
    } catch {}
    return '';
  }

  function hasNonEmptyGroupOrDisplayPrefs() {
    return Boolean(state.myMbuGroup || state.myLabGroup || state.otherGroupMode === 'hide');
  }

  function saveCurrentStudentPrefs(syncToCloud = true) {
    const session = getActiveAuthSession();
    if (!session || !session.hash) return;
    const nowTs = Date.now();
    lastLocalPrefsWriteAt = nowTs;
    const payload = {
      myMbuGroup: state.myMbuGroup || '',
      myLabGroup: state.myLabGroup || '',
      otherGroupMode: state.otherGroupMode === 'hide' ? 'hide' : 'dim',
      lang: state.lang === 'en' ? 'en' : 'tr',
      last4: session.last4 || '',
      updatedAtMs: nowTs
    };
    saveLocalStudentPrefs(session.hash, payload);
    if (syncToCloud) {
      const api = window.__INONU_AUTH__;
      if (!api || typeof api.saveCloudStudentPrefs !== 'function') return;
      if (session.cloudKey) {
        api.saveCloudStudentPrefs(session.hash, session.cloudKey, payload).catch(() => false);
      } else {
        void ensureSessionCloudKey().then((resolvedKey) => {
          if (resolvedKey) {
            api.saveCloudStudentPrefs(session.hash, resolvedKey, payload).catch(() => false);
          }
        });
      }
    }
  }

  function applySyncedCloudPrefs(expectedHash, cloudPrefs) {
    if (!expectedHash || !cloudPrefs || typeof cloudPrefs !== 'object') return false;
    const curSession = getActiveAuthSession();
    if (!curSession || curSession.hash !== expectedHash) return false;
    const nextMbu = typeof cloudPrefs.myMbuGroup === 'string' ? cloudPrefs.myMbuGroup : '';
    const nextLab = typeof cloudPrefs.myLabGroup === 'string' ? cloudPrefs.myLabGroup : '';
    const nextMode = cloudPrefs.otherGroupMode === 'hide' ? 'hide' : 'dim';
    const nextLang = cloudPrefs.lang === 'tr' || cloudPrefs.lang === 'en' ? cloudPrefs.lang : '';
    const incomingTs = Number(cloudPrefs.updatedAtMs) || Date.now();
    const changed =
      state.myMbuGroup !== nextMbu ||
      state.myLabGroup !== nextLab ||
      state.otherGroupMode !== nextMode ||
      (nextLang && state.lang !== nextLang);
    saveLocalStudentPrefs(expectedHash, {
      myMbuGroup: nextMbu,
      myLabGroup: nextLab,
      otherGroupMode: nextMode,
      lang: nextLang || state.lang,
      updatedAtMs: incomingTs
    });
    if (!changed) return false;
    state.myMbuGroup = nextMbu;
    state.myLabGroup = nextLab;
    state.otherGroupMode = nextMode;
    if (nextLang) {
      state.lang = nextLang;
      saveStore('lang', state.lang);
    }
    saveStore('myMbuGroup', state.myMbuGroup);
    saveStore('myLabGroup', state.myLabGroup);
    saveStore('otherGroupMode', state.otherGroupMode);
    invalidateScheduleRenderCache();
    refreshAllVisibleTabsAfterAuthChange();
    return true;
  }

  let cloudStartupSyncDoneForHash = '';
  let cloudStartupSyncInFlight = null;
  async function syncActiveStudentCloudPrefs(force = false) {
    const session = getActiveAuthSession();
    const api = window.__INONU_AUTH__;
    if (!session || !session.hash || !api || typeof api.loadCloudStudentPrefs !== 'function') return;
    if (!force && cloudStartupSyncDoneForHash === session.hash) return;
    if (cloudStartupSyncInFlight) return cloudStartupSyncInFlight;
    cloudStartupSyncInFlight = (async () => {
      try {
        if (typeof api.flushPendingStudentPrefsSync === 'function') {
          await api.flushPendingStudentPrefsSync().catch(() => 0);
        }
        const cloudKey = session.cloudKey || (await ensureSessionCloudKey());
        if (!cloudKey) return;
        const cloudPrefs = await api.loadCloudStudentPrefs(session.hash, cloudKey, { force: Boolean(force) });
        cloudStartupSyncDoneForHash = session.hash;
        if (cloudPrefs && typeof cloudPrefs === 'object') {
          applySyncedCloudPrefs(session.hash, cloudPrefs);
        } else if (cloudPrefs === null && hasNonEmptyGroupOrDisplayPrefs()) {
          // Only seed cloud on authoritative empty doc if student actually has a selected group
          saveCurrentStudentPrefs(true);
        }
      } catch (e) {
        // Leave cloudStartupSyncDoneForHash unset if offline/unreachable so online recovery can run once
      } finally {
        cloudStartupSyncInFlight = null;
      }
    })();
    return cloudStartupSyncInFlight;
  }

  function openAuthModal(byLock = false) {
    authGateOpenedByLock = Boolean(byLock);
    clearAuthError();
    const authGate = document.getElementById('authGate');
    const authGateCard = document.getElementById('authGateCard');
    const inp = document.getElementById('authStudentIdInput');
    const closeBtn = document.getElementById('btnCloseAuthModal');
    if (closeBtn) closeBtn.classList.toggle('hidden', isSiteLoginLocked());
    setAuthLoginStep('id');
    document.documentElement.classList.add('overflow-hidden');
    document.body.classList.add('overflow-hidden');
    openAnimatedModal(authGate, authGateCard, () => {
      if (inp) inp.focus();
    });
  }

  function closeAuthModal(force = false) {
    if (!force && isSiteLoginLocked()) return;
    authGateOpenedByLock = false;
    const authGate = document.getElementById('authGate');
    const authGateCard = document.getElementById('authGateCard');
    closeAnimatedModal(authGate, authGateCard, () => {
      document.documentElement.classList.remove('overflow-hidden');
      document.body.classList.remove('overflow-hidden');
      clearAuthError();
      setAuthLoginStep('id');
    });
  }

  function syncAdminSiteAccessUI() {
    const loc = I18N[state.lang];
    const lockedOnly = Boolean(siteRequireStudentLogin);
    const titleEl = document.getElementById('lblAdminSiteAccessTitle');
    const descEl = document.getElementById('lblAdminSiteAccessDesc');
    const badgeEl = document.getElementById('adminSiteAccessStatusBadge');
    const iconWrap = document.getElementById('adminSiteAccessIconWrap');
    const iconPublic = document.getElementById('iconSiteAccessPublic');
    const iconLocked = document.getElementById('iconSiteAccessLocked');
    const toggleBtn = document.getElementById('btnToggleSiteRequireLogin');
    const knobEl = document.getElementById('siteAccessSwitchKnob');

    if (titleEl) titleEl.textContent = loc.adminSiteAccessTitle;
    if (descEl) descEl.textContent = lockedOnly ? loc.adminSiteAccessDescLocked : loc.adminSiteAccessDescPublic;
    if (badgeEl) {
      badgeEl.textContent = lockedOnly ? loc.adminSiteAccessBadgeLocked : loc.adminSiteAccessBadgePublic;
      badgeEl.className = lockedOnly
        ? 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0'
        : 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shrink-0';
    }
    if (iconWrap) {
      iconWrap.className = lockedOnly
        ? 'w-9 h-9 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0 transition'
        : 'w-9 h-9 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0 transition';
    }
    if (iconPublic) iconPublic.classList.toggle('hidden', lockedOnly);
    if (iconLocked) iconLocked.classList.toggle('hidden', !lockedOnly);
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-checked', lockedOnly ? 'true' : 'false');
      toggleBtn.className = lockedOnly
        ? 'ios-press relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full bg-amber-500 p-0.5 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40'
        : 'ios-press relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full bg-slate-300 dark:bg-slate-700 p-0.5 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40';
    }
    if (knobEl) {
      knobEl.className = lockedOnly
        ? 'pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform duration-200 translate-x-5'
        : 'pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform duration-200 translate-x-0';
    }
    if (typeof syncAdminHubSummary === 'function') syncAdminHubSummary();
  }

  function syncSiteAccessGateUI() {
    const wasLocked = document.documentElement.classList.contains('site-locked-locked');
    const locked = isSiteLoginLocked();
    const headerEl = document.getElementById('appHeader');
    const spacerEl = document.getElementById('headerSpacer');
    const mainEl = document.getElementById('appMain');
    const navEl = document.getElementById('appNav');
    const closeBtn = document.getElementById('btnCloseAuthModal');
    const authGate = document.getElementById('authGate');

    const headerMatches = !headerEl || headerEl.classList.contains('hidden') === locked;
    const gateMatches = locked
      ? Boolean(authGate && !authGate.classList.contains('hidden') && !authGate.classList.contains('modal-backdrop-out'))
      : !authGateOpenedByLock;
    if (wasLocked === locked && headerMatches && gateMatches) {
      return;
    }

    document.documentElement.classList.toggle('site-locked-locked', locked);
    if (headerEl) headerEl.classList.toggle('hidden', locked);
    if (spacerEl) spacerEl.classList.toggle('hidden', locked);
    if (mainEl) mainEl.classList.toggle('hidden', locked);
    if (navEl) navEl.classList.toggle('hidden', locked);
    if (closeBtn) closeBtn.classList.toggle('hidden', locked);

    syncAuthStepUI();

    if (locked) {
      authGateOpenedByLock = true;
      closeAdminModal();
      closeSettingsMenu();
      closeGroupModal();
      closeNoteModal();
      closeLessonPdfsModal();
      closeFoodDateModal();
      closeFoodPhotoModal();
      closeInstallModal();
      if (authGate && (authGate.classList.contains('hidden') || authGate.classList.contains('modal-backdrop-out'))) {
        openAuthModal(true);
      }
    } else {
      if (headerEl && spacerEl && !headerEl.classList.contains('hidden')) {
        spacerEl.style.height = `${headerEl.offsetHeight}px`;
      }
      if (authGate && !authGate.classList.contains('hidden') && authGateOpenedByLock) {
        closeAuthModal(true);
      }
      if (wasLocked) {
        refreshAllVisibleTabsAfterAuthChange();
        void refreshDailyAnnouncements(true);
        void refreshLessonMaterials(true);
      }
      requestAnimationFrame(() => updateTabIndicator(state.activeTab || 'daily', false));
    }
  }

  function applySiteAccessSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    const nextVal = Boolean(settings.requireStudentLogin);
    const nextTs = Number(settings.updatedAtMs) || 0;
    if (nextTs === 0 && siteAccessUpdatedAtMs > 0) return;
    if (siteAccessUpdatedAtMs > 0 && nextTs > 0 && nextTs < siteAccessUpdatedAtMs) return;
    const stateChanged = siteRequireStudentLogin !== nextVal || nextTs > siteAccessUpdatedAtMs;
    siteRequireStudentLogin = nextVal;
    if (nextTs > 0) {
      siteAccessUpdatedAtMs = nextTs;
      if (stateChanged) saveStore('siteAccessUpdatedAtMs', nextTs);
    }
    if (stateChanged) saveStore('siteRequireLoginCache', nextVal);
    syncAdminSiteAccessUI();
    syncSiteAccessGateUI();
  }

  function refreshAllVisibleTabsAfterAuthChange() {
    runWithStaggerSuppressed(() => {
      applyLanguageUI();
      renderDailyAnnouncements();
      if (state.activeTab === 'daily') renderDailyView();
      if (state.activeTab === 'weekly') renderWeeklyView();
      if (state.activeTab === 'food') renderFoodView();
      if (state.activeTab === 'search') renderSearchView();
      if (state.activeTab === 'info') renderInfoView();
    });
    requestAnimationFrame(() => updateTabIndicator(state.activeTab || 'daily', false));
    window.dispatchEvent(new CustomEvent('inonu-ui-sync'));
  }

  let studentAccountStatusUnsub = null;
  let studentAccountWatchedHash = '';
  let studentAccountCheckTimer = null;

  function stopActiveStudentAccountWatch() {
    if (typeof studentAccountStatusUnsub === 'function') {
      try { studentAccountStatusUnsub(); } catch (e) {}
    }
    studentAccountStatusUnsub = null;
    studentAccountWatchedHash = '';
    if (studentAccountCheckTimer) {
      clearInterval(studentAccountCheckTimer);
      studentAccountCheckTimer = null;
    }
  }

  function handleForcedStudentSignOut(reason) {
    if (reason !== 'inactive' && reason !== 'deleted') return;
    const session = getActiveAuthSession();
    if (!session || session.isAdmin) return;
    const loc = I18N[state.lang];
    const msg = reason === 'deleted' ? loc.authForcedLogoutDeleted : loc.authForcedLogoutInactive;
    cloudStartupSyncDoneForHash = '';
    signOutStudent(msg);
  }

  async function verifyActiveStudentSessionNow() {
    const session = getActiveAuthSession();
    const api = window.__INONU_AUTH__;
    if (!session || session.isAdmin || !session.hash || !api || typeof api.checkStudentSessionActive !== 'function') return;
    try {
      const status = await api.checkStudentSessionActive(session.hash);
      const current = getActiveAuthSession();
      if (!current || current.hash !== session.hash) return;
      if (status === 'inactive' || status === 'deleted') {
        handleForcedStudentSignOut(status);
      }
    } catch (e) {}
  }

  function syncActiveStudentAccountWatch() {
    const session = getActiveAuthSession();
    const api = window.__INONU_AUTH__;
    if (!session || session.isAdmin || !session.hash || !api) {
      stopActiveStudentAccountWatch();
      return;
    }
    if (studentAccountWatchedHash !== session.hash) {
      stopActiveStudentAccountWatch();
      studentAccountWatchedHash = session.hash;
      if (typeof api.subscribeStudentAccountStatus === 'function') {
        studentAccountStatusUnsub = api.subscribeStudentAccountStatus(session.hash, (status) => {
          const current = getActiveAuthSession();
          if (current && current.hash === session.hash && !current.isAdmin) {
            if (status === 'inactive' || status === 'deleted') {
              handleForcedStudentSignOut(status);
            }
          }
        });
      }
      studentAccountCheckTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void verifyActiveStudentSessionNow();
      }, 2500);
    }
    void verifyActiveStudentSessionNow();
  }

  function signOutStudent(customToastMsg) {
    const prevSession = getActiveAuthSession();
    stopActiveStudentAccountWatch();
    stopStudentPrefsCloudSubscription();
    cloudStartupSyncDoneForHash = '';
    try {
      localStorage.removeItem(STORE_KEY + 'authSession');
    } catch (e) {}
    const api = window.__INONU_AUTH__;
    if (api && typeof api.clearStudentPrefsSessionSync === 'function') {
      api.clearStudentPrefsSessionSync(prevSession && prevSession.cloudKey ? prevSession.cloudKey : '');
    }
    if (api && typeof api.clearAdminWriteSecret === 'function') {
      api.clearAdminWriteSecret();
    }
    closeAdminModal();
    closeGroupModal();
    closeNoteModal();
    closeLessonPdfsModal();
    state.myMbuGroup = '';
    state.myLabGroup = '';
    state.otherGroupMode = 'dim';
    saveStore('myMbuGroup', '');
    saveStore('myLabGroup', '');
    saveStore('otherGroupMode', 'dim');

    const inp = document.getElementById('authStudentIdInput');
    if (inp) inp.value = '';
    setAuthLoginStep('id');
    refreshAllVisibleTabsAfterAuthChange();
    syncSiteAccessGateUI();
    showToast(customToastMsg || t('authLogoutToast'));
  }

  function formatPdfBytesLabel(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '';
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
  }

  let activePdfDownloadHideTimer = null;
  let activePdfDownloadBlobUrl = '';
  let activePdfDownloadBlob = null;
  let activePdfDownloadExternalUrl = '';
  let activePdfDownloadFileName = 'ders.pdf';
  let activePdfDownloadTitle = 'PDF';
  const activePdfDownloadInFlight = new Set();

  function schedulePdfDownloadBannerAutoHide(delayMs = 4500) {
    if (activePdfDownloadHideTimer) clearTimeout(activePdfDownloadHideTimer);
    activePdfDownloadHideTimer = setTimeout(() => {
      closePdfDownloadBanner(true);
    }, delayMs);
  }

  function closePdfDownloadBanner(revokeUrl = true) {
    if (activePdfDownloadHideTimer) {
      clearTimeout(activePdfDownloadHideTimer);
      activePdfDownloadHideTimer = null;
    }
    const banner = document.getElementById('pdfDownloadBanner');
    if (banner) banner.classList.add('hidden');
    if (revokeUrl && activePdfDownloadBlobUrl) {
      const oldUrl = activePdfDownloadBlobUrl;
      activePdfDownloadBlobUrl = '';
      activePdfDownloadBlob = null;
      activePdfDownloadExternalUrl = '';
      setTimeout(() => {
        try { URL.revokeObjectURL(oldUrl); } catch {}
      }, 5000);
    } else if (revokeUrl) {
      activePdfDownloadBlob = null;
      activePdfDownloadExternalUrl = '';
    }
  }

  function showPdfDownloadProgressBanner(title, statusText, pct) {
    if (activePdfDownloadHideTimer) {
      clearTimeout(activePdfDownloadHideTimer);
      activePdfDownloadHideTimer = null;
    }
    const banner = document.getElementById('pdfDownloadBanner');
    const titleEl = document.getElementById('pdfDownloadBannerTitle');
    const statusEl = document.getElementById('pdfDownloadBannerStatus');
    const progWrap = document.getElementById('pdfDownloadProgressWrap');
    const progBar = document.getElementById('pdfDownloadProgressBar');
    const readyWrap = document.getElementById('pdfDownloadReadyActions');
    if (!banner) return;
    if (titleEl) titleEl.textContent = title || 'PDF';
    if (statusEl) statusEl.textContent = statusText || '';
    if (progWrap) progWrap.classList.remove('hidden');
    if (readyWrap) readyWrap.classList.add('hidden');
    if (progBar) progBar.style.width = `${Math.min(100, Math.max(2, Number(pct) || 0))}%`;
    banner.classList.remove('hidden');
  }

  function openPdfBlobInNewTabFallback(url) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function triggerBlobDownloadWithReadyBanner(blob, fileName, displayTitle, triggerAnchorClick = true, directOpenUrl = '') {
    if (activePdfDownloadBlobUrl) {
      const staleUrl = activePdfDownloadBlobUrl;
      setTimeout(() => {
        try { URL.revokeObjectURL(staleUrl); } catch {}
      }, 10000);
    }
    const blobUrl = URL.createObjectURL(blob);
    activePdfDownloadBlobUrl = blobUrl;
    activePdfDownloadBlob = blob;
    activePdfDownloadExternalUrl = directOpenUrl || '';
    activePdfDownloadFileName = fileName || 'ders.pdf';
    activePdfDownloadTitle = displayTitle || activePdfDownloadFileName;

    const openLink = document.getElementById('pdfDownloadOpenLink');
    const shareBtn = document.getElementById('pdfDownloadShareBtn');
    const banner = document.getElementById('pdfDownloadBanner');
    const titleEl = document.getElementById('pdfDownloadBannerTitle');
    const statusEl = document.getElementById('pdfDownloadBannerStatus');
    const progWrap = document.getElementById('pdfDownloadProgressWrap');
    const readyWrap = document.getElementById('pdfDownloadReadyActions');

    if (openLink) {
      openLink.href = (!triggerAnchorClick && directOpenUrl) ? directOpenUrl : blobUrl;
      openLink.removeAttribute('download');
      openLink.textContent = state.lang === 'en' ? 'Open' : 'Aç';
    }
    if (shareBtn) {
      shareBtn.textContent = state.lang === 'en' ? 'Share' : 'Paylaş';
    }
    if (titleEl) titleEl.textContent = activePdfDownloadTitle;
    if (statusEl) {
      const sizeTxt = blob.size > 0 ? ` (${formatPdfBytesLabel(blob.size)})` : '';
      statusEl.textContent = state.lang === 'en' ? `Ready${sizeTxt}` : `PDF hazır${sizeTxt}`;
    }
    if (progWrap) progWrap.classList.add('hidden');
    if (readyWrap) readyWrap.classList.remove('hidden');
    if (banner) banner.classList.remove('hidden');

    if (triggerAnchorClick) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = activePdfDownloadFileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    schedulePdfDownloadBannerAutoHide(4500);
  }

  function showExternalUrlDownloadReadyBanner(downloadHref, openHref, fileName, displayTitle) {
    if (activePdfDownloadBlobUrl) {
      const staleUrl = activePdfDownloadBlobUrl;
      activePdfDownloadBlobUrl = '';
      setTimeout(() => {
        try { URL.revokeObjectURL(staleUrl); } catch {}
      }, 5000);
    }
    activePdfDownloadBlob = null;
    activePdfDownloadExternalUrl = openHref || downloadHref || '';
    activePdfDownloadFileName = fileName || 'ders.pdf';
    activePdfDownloadTitle = displayTitle || activePdfDownloadFileName;

    const openLink = document.getElementById('pdfDownloadOpenLink');
    const shareBtn = document.getElementById('pdfDownloadShareBtn');
    const banner = document.getElementById('pdfDownloadBanner');
    const titleEl = document.getElementById('pdfDownloadBannerTitle');
    const statusEl = document.getElementById('pdfDownloadBannerStatus');
    const progWrap = document.getElementById('pdfDownloadProgressWrap');
    const readyWrap = document.getElementById('pdfDownloadReadyActions');

    if (openLink) {
      openLink.href = openHref || downloadHref || '#';
      openLink.removeAttribute('download');
      openLink.textContent = state.lang === 'en' ? 'Open' : 'Aç';
    }
    if (shareBtn) {
      shareBtn.textContent = state.lang === 'en' ? 'Share' : 'Paylaş';
    }
    if (titleEl) titleEl.textContent = activePdfDownloadTitle;
    if (statusEl) {
      statusEl.textContent = state.lang === 'en' ? 'Ready to open or share' : 'Açmaya veya paylaşmaya hazır';
    }
    if (progWrap) progWrap.classList.add('hidden');
    if (readyWrap) readyWrap.classList.remove('hidden');
    if (banner) banner.classList.remove('hidden');

    schedulePdfDownloadBannerAutoHide(4500);
  }

  function getGoogleDriveDirectDownloadUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (!/^(drive|docs)\.google\.com$/i.test(u.hostname)) return '';
      const pathMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      const fileId = (pathMatch && pathMatch[1]) || u.searchParams.get('id') || '';
      return fileId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}` : '';
    } catch {
      return '';
    }
  }

  function handlePdfBannerOpenClick() {
    schedulePdfDownloadBannerAutoHide(4500);
  }

  function handlePdfBannerShareClick(e) {
    if (e) e.preventDefault();
    const blob = activePdfDownloadBlob;
    const blobUrl = activePdfDownloadBlobUrl;
    const extUrl = activePdfDownloadExternalUrl;

    if (blob && typeof navigator.share === 'function') {
      try {
        const pdfFile = new File([blob], activePdfDownloadFileName || 'ders.pdf', { type: 'application/pdf' });
        if (!navigator.canShare || navigator.canShare({ files: [pdfFile] })) {
          if (activePdfDownloadHideTimer) {
            clearTimeout(activePdfDownloadHideTimer);
            activePdfDownloadHideTimer = null;
          }
          Promise.resolve(
            navigator.share({
              files: [pdfFile],
              title: activePdfDownloadTitle || activePdfDownloadFileName || 'PDF'
            })
          )
            .catch((err) => {
              if (err && err.name === 'AbortError') return;
              if (blobUrl) openPdfBlobInNewTabFallback(blobUrl);
            })
            .finally(() => {
              schedulePdfDownloadBannerAutoHide(4500);
            });
          return;
        }
      } catch {}
    }

    if (extUrl && typeof navigator.share === 'function') {
      if (activePdfDownloadHideTimer) {
        clearTimeout(activePdfDownloadHideTimer);
        activePdfDownloadHideTimer = null;
      }
      Promise.resolve(
        navigator.share({
          title: activePdfDownloadTitle || activePdfDownloadFileName || 'PDF',
          url: extUrl
        })
      )
        .catch((err) => {
          if (err && err.name === 'AbortError') return;
          openPdfBlobInNewTabFallback(extUrl);
        })
        .finally(() => {
          schedulePdfDownloadBannerAutoHide(4500);
        });
      return;
    }

    if (blobUrl) {
      openPdfBlobInNewTabFallback(blobUrl);
    } else if (extUrl) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(extUrl).then(() => {
          showToast(state.lang === 'en' ? 'Link copied' : 'Bağlantı kopyalandı');
        }).catch(() => openPdfBlobInNewTabFallback(extUrl));
      } else {
        openPdfBlobInNewTabFallback(extUrl);
      }
    }
    schedulePdfDownloadBannerAutoHide(4500);
  }

  async function openOrDownloadLessonMaterial(material) {
    if (!material) return;
    let mat = material;

    if (!mat.pdfData && mat.hasInlinePdfData && mat.id) {
      const api = window.__INONU_AUTH__;
      if (api && typeof api.loadAllLessonMaterials === 'function') {
        showPdfDownloadProgressBanner(mat.title || mat.pdfName || 'PDF', state.lang === 'en' ? 'Preparing...' : 'Hazırlanıyor...', 25);
        try {
          const freshList = await api.loadAllLessonMaterials();
          applyLoadedLessonMaterialsList(freshList);
          const found = freshList.find((x) => x.id === mat.id);
          if (found) mat = found;
        } catch {}
      }
    }

    const rawName = (mat.pdfName || mat.title || `ders_${mat.date}_${mat.slotNo}`).trim();
    const fileName = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
    const displayTitle = mat.title || fileName;
    const shouldAutoSaveDownload = !(/iPad|iPhone|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

    if (mat.pdfData) {
      try {
        const cleanB64 = String(mat.pdfData).replace(/^data:[^;]+;base64,/i, '');
        const bin = atob(cleanB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
          bytes[i] = bin.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        triggerBlobDownloadWithReadyBanner(blob, fileName, displayTitle, shouldAutoSaveDownload);
        return;
      } catch (err) {
        console.warn('PDF blob decode failed:', err);
        closePdfDownloadBanner(true);
        showToast(state.lang === 'en' ? 'Could not download PDF.' : 'PDF indirilemedi.');
        return;
      }
    }

    const chunkTotal = Number(mat.chunkCount) || 0;
    const authApi = window.__INONU_AUTH__;

    // 1. Instant local IndexedDB cache check (0 network overhead)
    if (mat.id && authApi && typeof authApi.getCachedLessonPdfBlob === 'function') {
      try {
        const cachedBlob = await authApi.getCachedLessonPdfBlob(mat.id);
        if (cachedBlob && cachedBlob.size > 0) {
          triggerBlobDownloadWithReadyBanner(cachedBlob, fileName, displayTitle, shouldAutoSaveDownload, mat.pdfUrl);
          return;
        }
      } catch {}
    }

    async function readResponseBlobWithProgress(resp, fallbackMime, onProgress) {
      const totalHeader = Number(resp.headers.get('content-length')) || 0;
      if (!resp.body || typeof resp.body.getReader !== 'function') {
        return await resp.blob();
      }
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          if (typeof onProgress === 'function') {
            const pct = totalHeader > 0
              ? Math.min(99, Math.max(5, Math.round((received / totalHeader) * 100)))
              : Math.min(92, Math.max(15, Math.round(15 + Math.log10(1 + received / 16384) * 38)));
            onProgress(pct, received, totalHeader);
          }
        }
      }
      const ct = resp.headers.get('content-type') || fallbackMime || 'application/pdf';
      return new Blob(chunks, { type: ct });
    }

    // 2. Express server / Supabase Storage URL
    if (mat.pdfUrl && mat.pdfUrl.startsWith('/api/lesson-pdf/')) {
      const dlUrl = mat.pdfUrl.includes('?') ? `${mat.pdfUrl}&download=1` : `${mat.pdfUrl}?download=1`;
      if (activePdfDownloadInFlight.has(dlUrl)) return;
      activePdfDownloadInFlight.add(dlUrl);
      showPdfDownloadProgressBanner(displayTitle, state.lang === 'en' ? 'Fetching PDF...' : 'Sunucudan alınıyor...', 8);
      try {
        const resp = await fetch(dlUrl, { cache: 'no-store' });
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (!resp.ok || ct.includes('text/html')) {
          throw new Error(resp.status === 404 || ct.includes('text/html') ? 'LEGACY_SERVER_FILE_MISSING' : `HTTP_${resp.status}`);
        }
        const blob = await readResponseBlobWithProgress(resp, 'application/pdf', (pct, received, total) => {
          const sizeTxt = total > 0
            ? `${formatPdfBytesLabel(received)} / ${formatPdfBytesLabel(total)}`
            : formatPdfBytesLabel(received);
          showPdfDownloadProgressBanner(
            displayTitle,
            state.lang === 'en'
              ? `Downloading... %${pct} (${sizeTxt})`
              : `İndiriliyor... %${pct} (${sizeTxt})`,
            pct
          );
        });
        if (mat.id && authApi && typeof authApi.cacheLessonPdfBlob === 'function') {
          void authApi.cacheLessonPdfBlob(mat.id, fileName, blob).then(() => refreshPdfCacheStatsUI(true));
        }
        triggerBlobDownloadWithReadyBanner(blob, fileName, displayTitle, shouldAutoSaveDownload, mat.pdfUrl);
        return;
      } catch (err) {
        if (mat.id && authApi && typeof authApi.downloadLessonMaterialChunks === 'function') {
          try {
            const fallbackBlob = await authApi.downloadLessonMaterialChunks(
              mat.id,
              Math.max(1, chunkTotal),
              (pct, done, total) => {
                const safePct = Math.min(99, Math.max(0, Math.round(Number(pct) || 0)));
                showPdfDownloadProgressBanner(
                  displayTitle,
                  state.lang === 'en'
                    ? `Downloading... %${safePct} (${done}/${total})`
                    : `İndiriliyor... %${safePct} (${done}/${total})`,
                  safePct
                );
              }
            );
            void refreshPdfCacheStatsUI(true);
            triggerBlobDownloadWithReadyBanner(fallbackBlob, fileName, displayTitle, shouldAutoSaveDownload);
            return;
          } catch {}
        }
        console.warn('Server PDF download failed:', err);
        closePdfDownloadBanner(true);
        const msg = err instanceof Error && err.message === 'LEGACY_SERVER_FILE_MISSING'
          ? (state.lang === 'en'
              ? 'This older PDF needs to be re-uploaded from the admin panel.'
              : 'Bu eski PDF dosyası bulunamadı. Yönetici panelinden yeniden yükleyin.')
          : (state.lang === 'en' ? 'Could not download PDF.' : 'PDF indirilemedi.');
        showToast(msg);
        return;
      } finally {
        activePdfDownloadInFlight.delete(dlUrl);
      }
    }

    // 3. Fallback: IndexedDB / server lookup when pdfUrl isn't set
    if (chunkTotal > 0 && mat.id) {
      if (!authApi || typeof authApi.downloadLessonMaterialChunks !== 'function') {
        showToast(state.lang === 'en' ? 'Downloader module not ready.' : 'İndirme modülü henüz hazır değil.');
        return;
      }
      if (activePdfDownloadInFlight.has(mat.id)) return;
      activePdfDownloadInFlight.add(mat.id);
      showPdfDownloadProgressBanner(displayTitle, state.lang === 'en' ? 'Preparing PDF...' : 'PDF hazırlanıyor...', 4);
      try {
        const blob = await authApi.downloadLessonMaterialChunks(mat.id, chunkTotal, (pct, done, total) => {
          showPdfDownloadProgressBanner(
            displayTitle,
            state.lang === 'en'
              ? `Downloading... %${pct} (${done}/${total})`
              : `İndiriliyor... %${pct} (${done}/${total})`,
            pct
          );
        });
        void refreshPdfCacheStatsUI(true);
        triggerBlobDownloadWithReadyBanner(blob, fileName, displayTitle, shouldAutoSaveDownload);
      } catch (err) {
        console.warn('Cloud chunk PDF download failed:', err);
        closePdfDownloadBanner(true);
        showToast(state.lang === 'en' ? 'Could not download PDF from cloud.' : 'PDF buluttan indirilemedi. Bağlantınızı kontrol edin.');
      } finally {
        activePdfDownloadInFlight.delete(mat.id);
      }
      return;
    }

    if (mat.pdfUrl) {
      const safeUrl = /^https?:\/\//i.test(mat.pdfUrl) ? mat.pdfUrl : `https://${mat.pdfUrl}`;
      const driveDl = getGoogleDriveDirectDownloadUrl(safeUrl);
      if (!driveDl && /\.pdf(\?|$)/i.test(safeUrl)) {
        try {
          showPdfDownloadProgressBanner(displayTitle, state.lang === 'en' ? 'Downloading PDF...' : 'PDF indiriliyor...', 12);
          const resp = await fetch(safeUrl, { mode: 'cors' });
          if (resp.ok) {
            const ct = (resp.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('pdf') || ct.includes('octet-stream')) {
              const blob = await readResponseBlobWithProgress(resp, 'application/pdf', (pct, received, total) => {
                const sizeTxt = total > 0
                  ? `${formatPdfBytesLabel(received)} / ${formatPdfBytesLabel(total)}`
                  : formatPdfBytesLabel(received);
                showPdfDownloadProgressBanner(
                  displayTitle,
                  state.lang === 'en'
                    ? `Downloading... %${pct} (${sizeTxt})`
                    : `İndiriliyor... %${pct} (${sizeTxt})`,
                  pct
                );
              });
              if (mat.id && authApi && typeof authApi.cacheLessonPdfBlob === 'function') {
                void authApi.cacheLessonPdfBlob(mat.id, fileName, blob).then(() => refreshPdfCacheStatsUI(true));
              }
              triggerBlobDownloadWithReadyBanner(blob, fileName, displayTitle, shouldAutoSaveDownload, safeUrl);
              return;
            }
          }
        } catch {}
        closePdfDownloadBanner(true);
      }
      showExternalUrlDownloadReadyBanner(driveDl || safeUrl, safeUrl, fileName, displayTitle);
    }
  }

  let managedExamsList = [];
  let examCountdownsUnsub = null;
  let adminQuickSlotTarget = null;
  let adminQuickAnnTarget = null;
  let adminQuickExamTarget = null;

  function applyLoadedExamCountdownsList(list) {
    managedExamsList = Array.isArray(list) ? list : [];
    adminState.exams = [...managedExamsList];
    if (typeof renderInfoView === 'function' && state.activeTab === 'info') {
      runWithStaggerSuppressed(() => renderInfoView());
    }
    if (typeof renderAdminExamsList === 'function') renderAdminExamsList();
    if (typeof syncAdminHubSummary === 'function') syncAdminHubSummary();
  }

  // ==================== ADMIN SETTINGS MODAL CONTROLLER ====================
  const adminState = {
    activeTab: 'hub',
    studentsSubTab: 'roster',
    annTargetOpen: false,
    ghConfigOpen: false,
    editingAnnId: '',
    annTone: 'info',
    annActive: true,
    annTargetGroup: '',
    annTargetProg: '',
    annExpiresAtMs: 0,
    annListFilter: '',
    cancelProg: 'tr',
    cancelDate: '',
    cancelListFilterProg: '',
    cancelledLessons: [],
    lastCancelAnimKey: '',
    lastCancelAnimType: '',
    exams: [],
    editingExamId: '',
    examProg: '',
    deleteConfirmExamId: '',
    matProg: 'tr',
    matMode: 'file',
    matFileObj: null,
    matFileData: '',
    matFileName: '',
    matFileSize: 0,
    matExistingUrl: '',
    matExistingChunkCount: 0,
    matListFilterProg: '',
    editingMatId: '',
    addGroup: 'I',
    addLab: '',
    addLang: 'tr',
    announcements: [],
    materials: [],
    students: [],
    studentFilterGroup: '',
    editingStudent: null,
    deleteConfirmAnnId: '',
    deleteConfirmStudentHash: '',
    deleteConfirmMatId: ''
  };

  // Feature 7: Recent Admin Actions + One-Tap Undo History
  const ADMIN_HISTORY_KEY = 'adminRecentHistoryV1';
  function loadAdminHistory() {
    const arr = loadStore(ADMIN_HISTORY_KEY, []);
    return Array.isArray(arr) ? arr.slice(0, 8) : [];
  }
  function saveAdminHistory(items) {
    saveStore(ADMIN_HISTORY_KEY, Array.isArray(items) ? items.slice(0, 8) : []);
  }
  function pushAdminHistory(entry) {
    if (!entry || !entry.label) return;
    const list = loadAdminHistory();
    const item = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      label: String(entry.label),
      sub: String(entry.sub || ''),
      undoType: entry.undoType || '',
      undoData: entry.undoData || null,
    };
    list.unshift(item);
    saveAdminHistory(list);
    renderAdminRecentActivity();
  }
  function formatRelativeShort(ts) {
    const diffSec = Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 1000));
    const isEn = state.lang === 'en';
    if (diffSec < 60) return isEn ? 'just now' : 'az önce';
    const m = Math.floor(diffSec / 60);
    if (m < 60) return isEn ? `${m}m` : `${m} dk`;
    const h = Math.floor(m / 60);
    if (h < 24) return isEn ? `${h}h` : `${h} sa`;
    const d = Math.floor(h / 24);
    return isEn ? `${d}d` : `${d} g`;
  }
  async function executeAdminHistoryUndo(item) {
    const api = window.__INONU_AUTH__;
    const secret = ensureAdminSecretReady();
    if (!api || !secret || !item || !item.undoType) return;
    const isEn = state.lang === 'en';
    const secArg = secret === 'active' ? undefined : secret;
    try {
      if (item.undoType === 'cancel_slot' && item.undoData?.id) {
        await api.deleteCancelledLesson(item.undoData.id, secArg);
        applyLoadedCancelledLessonsList(cancelledLessonsList.filter((x) => x.id !== item.undoData.id));
      } else if (item.undoType === 'restore_slot' && item.undoData) {
        const saved = await api.saveCancelledLesson(item.undoData, secArg);
        applyLoadedCancelledLessonsList([...cancelledLessonsList.filter((x) => x.id !== saved.id), saved]);
      } else if (item.undoType === 'bulk_cancel_day' && Array.isArray(item.undoData?.ids)) {
        await Promise.all(item.undoData.ids.map((id) => api.deleteCancelledLesson(id, secArg)));
        const idSet = new Set(item.undoData.ids);
        applyLoadedCancelledLessonsList(cancelledLessonsList.filter((x) => !idSet.has(x.id)));
      } else if (item.undoType === 'bulk_restore_day' && Array.isArray(item.undoData?.items)) {
        const restored = await Promise.all(item.undoData.items.map((x) => api.saveCancelledLesson(x, secArg)));
        const nextIds = new Set(restored.map((x) => x.id));
        applyLoadedCancelledLessonsList([...cancelledLessonsList.filter((x) => !nextIds.has(x.id)), ...restored]);
      } else if (item.undoType === 'ann_create' && item.undoData?.id) {
        await api.deleteAnnouncement(item.undoData.id, secArg);
        await refreshAdminCloudData('announcements');
        await refreshDailyAnnouncements(true);
      } else if (item.undoType === 'ann_delete' && item.undoData) {
        await api.saveAnnouncement(item.undoData, secArg);
        await refreshAdminCloudData('announcements');
        await refreshDailyAnnouncements(true);
      } else if (item.undoType === 'exam_create' && item.undoData?.id) {
        await api.deleteExamCountdown(item.undoData.id, secArg);
        applyLoadedExamCountdownsList(managedExamsList.filter((x) => x.id !== item.undoData.id));
      } else if (item.undoType === 'exam_delete' && item.undoData) {
        const saved = await api.saveExamCountdown(item.undoData, secArg);
        applyLoadedExamCountdownsList([...managedExamsList.filter((x) => x.id !== saved.id), saved]);
      } else if (item.undoType === 'site_lock' && typeof item.undoData?.prevVal === 'boolean') {
        if (typeof api.saveSiteAccessSettings === 'function') {
          const saved = await api.saveSiteAccessSettings(item.undoData.prevVal, secArg);
          if (saved && typeof saved === 'object') applySiteAccessSettings(saved);
        }
      }
      const remaining = loadAdminHistory().filter((x) => x.id !== item.id);
      saveAdminHistory(remaining);
      renderAdminRecentActivity();
      syncAdminHubSummary();
      showToast(isEn ? 'Action undone.' : 'İşlem geri alındı.');
    } catch (err) {
      console.warn('Undo action failed:', err);
      showToast(I18N[state.lang].adminSaveErrorToast);
    }
  }
  function renderAdminRecentActivity() {
    const wrap = document.getElementById('adminRecentActivityWrap');
    const listEl = document.getElementById('adminRecentActivityList');
    if (!wrap || !listEl) return;
    const items = loadAdminHistory();
    if (items.length === 0) {
      wrap.classList.add('hidden');
      listEl.innerHTML = '';
      return;
    }
    const isEn = state.lang === 'en';
    wrap.classList.remove('hidden');
    listEl.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'admin-hub-row px-3.5 py-2.5 flex items-center justify-between gap-2.5';
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(item.label)}</span>
            <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">${escapeHtml(formatRelativeShort(item.ts))}</span>
          </div>
          ${item.sub ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escapeHtml(item.sub)}</p>` : ''}
        </div>
      `;
      if (item.undoType) {
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'ios-press min-h-[30px] px-2.5 py-1 rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-[11px] font-bold shrink-0 transition';
        undoBtn.textContent = isEn ? 'Undo' : 'Geri Al';
        undoBtn.addEventListener('click', async () => {
          undoBtn.disabled = true;
          await executeAdminHistoryUndo(item);
        });
        row.appendChild(undoBtn);
      }
      listEl.appendChild(row);
    });
  }

  function syncAdminUnlockBarUI() {
    const bar = document.getElementById('adminReunlockBar');
    if (!bar) return;
    bar.classList.add('hidden');
  }

  const GH_PUBLISH_STORE_KEY = 'inonu_tip_gh_publish_v1';
  function loadGhPublishConfig() {
    let cfg = { repo: '', branch: 'main', path: 'public/data.json', token: '' };
    try {
      const raw = localStorage.getItem(GH_PUBLISH_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          cfg = {
            repo: String(parsed.repo || '').trim(),
            branch: String(parsed.branch || 'main').trim() || 'main',
            path: String(parsed.path || 'public/data.json').trim() || 'public/data.json',
            token: String(parsed.token || '').trim(),
          };
        }
      }
    } catch (e) {}
    if (!cfg.repo && typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io')) {
      const owner = window.location.hostname.replace(/\.github\.io$/i, '').trim();
      const seg = window.location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
      if (owner && seg) cfg.repo = `${owner}/${seg}`;
    }
    return cfg;
  }
  function saveGhPublishConfig(cfg) {
    try {
      localStorage.setItem(GH_PUBLISH_STORE_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  function readLiveGhPublishConfig() {
    const stored = loadGhPublishConfig();
    const repoEl = document.getElementById('adminGhRepoInput');
    const branchEl = document.getElementById('adminGhBranchInput');
    const pathEl = document.getElementById('adminGhPathInput');
    const tokenEl = document.getElementById('adminGhTokenInput');
    return {
      repo: ((repoEl && repoEl.value) || stored.repo || '').trim(),
      branch: ((branchEl && branchEl.value) || stored.branch || 'main').trim() || 'main',
      path: ((pathEl && pathEl.value) || stored.path || 'public/data.json').trim() || 'public/data.json',
      token: ((tokenEl && tokenEl.value) || stored.token || '').trim(),
    };
  }

  function isGistInput(repoStr) {
    const clean = String(repoStr || '').trim();
    return clean.includes('gist.github.com') || /^[a-f0-9]{32}$/i.test(clean) || clean.startsWith('gist:');
  }

  function isValidGhOrGistConfig(cfg) {
    if (!cfg || !cfg.repo || !cfg.token) return false;
    const cleanRepo = String(cfg.repo).trim();
    if (isGistInput(cleanRepo)) {
      const id = cleanRepo.replace(/^gist:/i, '').split('/').pop() || '';
      return Boolean(id);
    }
    const parts = cleanRepo.split('/').map((s) => s.trim()).filter(Boolean);
    return parts.length === 2;
  }

  let ghAutoPushInFlight = false;
  let ghAutoPushPending = false;
  let ghAutoPushPendingNotify = false;

  async function queueAutoPushDataJsonToGitHub(showFeedbackToast = false) {
    const api = window.__INONU_AUTH__;
    const loc = I18N[state.lang];
    if (!api || typeof api.publishDataJsonToGitHub !== 'function') return false;

    const cfg = readLiveGhPublishConfig();
    if (!isValidGhOrGistConfig(cfg)) {
      if (showFeedbackToast) {
        setAdminGhConfigOpen(true);
        showToast(loc.adminDataJsonAutoPushNoCfgToast);
      }
      return false;
    }

    saveGhPublishConfig(cfg);

    ghAutoPushPendingNotify = ghAutoPushPendingNotify || showFeedbackToast;
    if (ghAutoPushInFlight) {
      ghAutoPushPending = true;
      return true;
    }

    ghAutoPushInFlight = true;
    let notifyAny = false;
    try {
      do {
        ghAutoPushPending = false;
        notifyAny = notifyAny || ghAutoPushPendingNotify;
        const notifyThisRun = ghAutoPushPendingNotify;
        ghAutoPushPendingNotify = false;

        const latestCfg = readLiveGhPublishConfig();
        if (!isValidGhOrGistConfig(latestCfg)) break;

        const cleanRepo = latestCfg.repo.trim();
        const isGist = isGistInput(cleanRepo);
        const parts = cleanRepo.split('/').map((s) => s.trim()).filter(Boolean);

        await api.publishDataJsonToGitHub({
          owner: isGist ? '' : (parts[0] || ''),
          repo: cleanRepo,
          branch: latestCfg.branch,
          path: latestCfg.path,
          token: latestCfg.token,
        });
        if (notifyThisRun) {
          showToast(loc.adminDataJsonAutoPushedToast);
        }
      } while (ghAutoPushPending);
      return true;
    } catch (err) {
      console.warn('Auto-push data.json to GitHub failed:', err);
      if (notifyAny || ghAutoPushPendingNotify || showFeedbackToast) {
        showToast(loc.adminDataJsonAutoPushFailedToast);
      }
      return false;
    } finally {
      ghAutoPushInFlight = false;
      ghAutoPushPending = false;
      ghAutoPushPendingNotify = false;
    }
  }

  async function syncAdminDataJsonUI() {
    const loc = I18N[state.lang];
    const api = window.__INONU_AUTH__;
    const titleEl = document.getElementById('lblAdminDataJsonTitle');
    const badgeEl = document.getElementById('adminDataJsonModeBadge');
    const textEl = document.getElementById('adminDataJsonModeText');
    const syncBtn = document.getElementById('btnAdminSyncRemoteDataJson');
    const pushBtn = document.getElementById('btnAdminPushGitHubDataJson');
    const hintEl = document.getElementById('adminGhHelpHint');
    const quotaBanner = document.getElementById('adminFirebaseQuotaBanner');

    if (titleEl) titleEl.textContent = loc.adminDataJsonTitle;
    if (syncBtn) syncBtn.textContent = loc.adminDataJsonSyncBtn;
    if (pushBtn) pushBtn.textContent = loc.adminDataJsonGhPushBtn;
    if (hintEl) hintEl.textContent = loc.adminDataJsonGhHint;

    const isQuotaExceeded = api && typeof api.isFirebaseQuotaExceeded === 'function' ? api.isFirebaseQuotaExceeded() : false;
    if (quotaBanner) {
      quotaBanner.classList.toggle('hidden', !isQuotaExceeded);
    }

    const ghCfg = loadGhPublishConfig();
    const repoInp = document.getElementById('adminGhRepoInput');
    const branchInp = document.getElementById('adminGhBranchInput');
    const pathInp = document.getElementById('adminGhPathInput');
    const tokenInp = document.getElementById('adminGhTokenInput');
    if (repoInp && !repoInp.value && ghCfg.repo) repoInp.value = ghCfg.repo;
    if (branchInp && ghCfg.branch) branchInp.value = ghCfg.branch;
    if (pathInp && ghCfg.path) pathInp.value = ghCfg.path;
    if (tokenInp && !tokenInp.value && ghCfg.token) tokenInp.value = ghCfg.token;

    const isStatic = api && typeof api.isStaticDeployment === 'function' ? await api.isStaticDeployment().catch(() => true) : true;
    if (badgeEl) {
      if (isQuotaExceeded) {
        badgeEl.textContent = 'Yedek: data.json';
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0';
      } else {
        badgeEl.textContent = isStatic ? 'Firebase Canlı (WebSocket)' : 'Sunucu + Firebase';
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shrink-0';
      }
    }
    if (textEl) {
      if (isQuotaExceeded) {
        textEl.textContent = 'Firebase kotası dolduğu için sistem kesintisiz olarak GitHub Gist / data.json yedek hattına geçti.';
      } else {
        textEl.textContent = isStatic ? loc.adminDataJsonDescStatic : loc.adminDataJsonDescServer;
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('inonu-firebase-quota-changed', () => {
      void syncAdminDataJsonUI();
    });
  }

  function ensureAdminSecretReady() {
    const api = window.__INONU_AUTH__;
    const session = getActiveAuthSession();
    if (!api || !session || !session.isAdmin) {
      showToast('Yönetici oturumu aktif değil. Lütfen yönetici numarasıyla tekrar giriş yapın.');
      return '';
    }
    if (session.adminSecret && typeof api.setAdminWriteSecret === 'function') {
      api.setAdminWriteSecret(session.adminSecret);
      return session.adminSecret;
    }
    return 'active';
  }

  const ADMIN_TAB_ORDER = ['announcements', 'materials', 'cancellations', 'exams', 'students', 'site-settings'];

  function syncAdminSegmentedControl(barId, indicatorId, attrName, activeValue, animate = true, extraClass = '') {
    const bar = document.getElementById(barId);
    const ind = document.getElementById(indicatorId);
    if (!bar) return;
    let activeBtn = null;
    bar.querySelectorAll(`[${attrName}]`).forEach((btn) => {
      const val = btn.getAttribute(attrName) || '';
      const isAct = val === String(activeValue ?? '');
      if (isAct) activeBtn = btn;
      btn.classList.toggle('font-semibold', isAct);
      btn.classList.toggle('font-medium', !isAct);
      btn.classList.toggle('text-slate-900', isAct);
      btn.classList.toggle('dark:text-white', isAct);
      btn.classList.toggle('text-slate-600', !isAct);
      btn.classList.toggle('dark:text-slate-300', !isAct);
    });
    if (ind) {
      updateSegmentedIndicator(bar, ind, activeBtn, animate, extraClass);
    }
  }

  function setAdminAnnTargetOpen(isOpen) {
    adminState.annTargetOpen = Boolean(isOpen);
    const panel = document.getElementById('adminAnnTargetCollapse');
    const btn = document.getElementById('btnAdminAnnToggleTarget');
    if (panel) {
      panel.classList.toggle('is-collapsed', !adminState.annTargetOpen);
      panel.setAttribute('aria-hidden', adminState.annTargetOpen ? 'false' : 'true');
    }
    if (btn) {
      btn.setAttribute('aria-expanded', adminState.annTargetOpen ? 'true' : 'false');
      const arrow = btn.querySelector('svg');
      if (arrow) arrow.style.transform = adminState.annTargetOpen ? 'rotate(180deg)' : '';
    }
    if (adminState.annTargetOpen) {
      requestAnimationFrame(() => {
        syncAdminSegmentedControl('adminAnnTargetProgChips', 'adminAnnTargetProgIndicator', 'data-ann-target-prog', adminState.annTargetProg || '', false);
      });
    }
  }

  function setAdminGhConfigOpen(isOpen) {
    adminState.ghConfigOpen = Boolean(isOpen);
    const panel = document.getElementById('adminGitHubPushConfigWrap');
    const btn = document.getElementById('btnAdminToggleGhConfig');
    if (panel) {
      panel.classList.toggle('is-collapsed', !adminState.ghConfigOpen);
      panel.setAttribute('aria-hidden', adminState.ghConfigOpen ? 'false' : 'true');
    }
    if (btn) {
      btn.setAttribute('aria-expanded', adminState.ghConfigOpen ? 'true' : 'false');
      const arrow = btn.querySelector('.admin-gh-chevron');
      if (arrow) arrow.style.transform = adminState.ghConfigOpen ? 'rotate(180deg)' : '';
    }
  }

  function switchAdminStudentsSubTab(subKey, animate = true) {
    const nextKey = subKey === 'add' ? 'add' : 'roster';
    const prevKey = adminState.studentsSubTab || 'roster';
    adminState.studentsSubTab = nextKey;

    const pRoster = document.getElementById('adminSubPaneRoster');
    const pAdd = document.getElementById('adminSubPaneAdd');
    const dir = nextKey === prevKey ? 'none' : (nextKey === 'add' ? 'right' : 'left');

    if (pRoster) {
      pRoster.classList.toggle('hidden', nextKey !== 'roster');
      if (nextKey === 'roster' && animate && dir !== 'none') replayAdminPaneEnter(pRoster, dir);
    }
    if (pAdd) {
      pAdd.classList.toggle('hidden', nextKey !== 'add');
      if (nextKey === 'add') {
        syncAdminAddStudentChips(false);
        requestAnimationFrame(() => {
          syncAdminSegmentedControl('adminAddLangChips', 'adminAddLangIndicator', 'data-add-lang', adminState.addLang === 'en' ? 'en' : 'tr', false);
        });
        if (animate && dir !== 'none') replayAdminPaneEnter(pAdd, dir);
      }
    }
    syncAdminSegmentedControl('adminStudentsSubBar', 'adminStudentsSubIndicator', 'data-admin-students-subtab', nextKey, animate, '!rounded-xl');
  }

  function syncAllAdminSegmentedIndicators(animate = false) {
    updateAdminTabIndicator(adminState.activeTab || 'announcements', animate);
    syncAdminSegmentedControl('adminAnnToneChips', 'adminAnnToneIndicator', 'data-ann-tone', adminState.annTone || 'info', animate);
    syncAdminSegmentedControl('adminAnnTargetProgChips', 'adminAnnTargetProgIndicator', 'data-ann-target-prog', adminState.annTargetProg || '', animate);
    syncAdminSegmentedControl('adminAnnListFilterChips', 'adminAnnListFilterIndicator', 'data-ann-list-filter', adminState.annListFilter || '', animate);
    syncAdminSegmentedControl('adminCancelProgChips', 'adminCancelProgIndicator', 'data-cancel-prog', adminState.cancelProg === 'en' ? 'en' : 'tr', animate);
    syncAdminSegmentedControl('adminCancelledListFilterChips', 'adminCancelledListFilterIndicator', 'data-cancel-list-filter', adminState.cancelListFilterProg || '', animate);
    syncAdminSegmentedControl('adminMatProgChips', 'adminMatProgIndicator', 'data-mat-prog', adminState.matProg === 'en' ? 'en' : 'tr', animate);
    syncAdminSegmentedControl('adminMatModeBar', 'adminMatModeIndicator', 'data-mat-mode', adminState.matMode === 'url' ? 'url' : 'file', animate);
    syncAdminSegmentedControl('adminMatListFilterChips', 'adminMatListFilterIndicator', 'data-mat-list-filter', adminState.matListFilterProg || '', animate);
    syncAdminSegmentedControl('adminExamProgChips', 'adminExamProgIndicator', 'data-exam-prog', adminState.examProg || '', animate);
    syncAdminSegmentedControl('adminAddLangChips', 'adminAddLangIndicator', 'data-add-lang', adminState.addLang === 'en' ? 'en' : 'tr', animate);
    syncAdminSegmentedControl('adminStudentsSubBar', 'adminStudentsSubIndicator', 'data-admin-students-subtab', adminState.studentsSubTab || 'roster', animate, '!rounded-xl');
  }

  function syncAdminModalLanguageUI() {
    const loc = I18N[state.lang];
    const isEn = state.lang === 'en';
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setPh = (id, val) => { const el = document.getElementById(id); if (el) el.placeholder = val; };

    setTxt('adminModalBadge', loc.adminModalBadge);
    setTxt('adminModalTitle', loc.adminModalTitle);
    setTxt('adminUnlockBannerText', loc.adminUnlockBanner);
    setPh('adminUnlockPwdInput', loc.adminUnlockPlaceholder);
    setTxt('btnAdminUnlockSubmit', loc.adminUnlockBtn);

    document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
      const key = btn.getAttribute('data-admin-tab');
      const lbl = btn.querySelector('.admin-tab-label') || btn;
      if (key === 'announcements') lbl.textContent = loc.adminTabAnn;
      if (key === 'materials') lbl.textContent = isEn ? 'PDFs' : "PDF'ler";
      if (key === 'cancellations') lbl.textContent = isEn ? 'Cancel' : 'Ders İptali';
      if (key === 'add-student') lbl.textContent = loc.adminTabAdd;
      if (key === 'students') lbl.textContent = isEn ? 'Settings' : 'Ayarlar';
    });

    document.querySelectorAll('[data-admin-students-subtab]').forEach((btn) => {
      const key = btn.getAttribute('data-admin-students-subtab');
      if (key === 'roster') btn.textContent = isEn ? 'Student Settings' : 'Öğrenci Ayarları';
      if (key === 'add') btn.textContent = isEn ? 'Add Student' : 'Öğrenci Ekle';
    });

    setTxt('btnAdminAnnCancelEdit', loc.adminAnnCancelBtn);
    setPh('adminAnnTitleInput', loc.adminAnnTitlePlaceholder);
    setPh('adminAnnMsgInput', loc.adminAnnMsgPlaceholder);
    setTxt('lblAdminAnnTargetGroup', isEn ? 'Target Group' : 'Hedef Grup');
    setTxt('lblAdminAnnTargetProg', isEn ? 'Target Program' : 'Hedef Program');
    setTxt('adminAnnListHeading', loc.adminAnnListHeading);
    document.querySelectorAll('[data-ann-target-group=""], [data-ann-target-prog=""], [data-ann-list-filter=""]').forEach((b) => {
      b.textContent = loc.groupAllLabel;
    });
    document.querySelectorAll('[data-ann-tone]').forEach((b) => {
      const tKey = b.getAttribute('data-ann-tone');
      if (tKey === 'info') b.textContent = loc.adminAnnToneInfo;
      if (tKey === 'warn') b.textContent = loc.adminAnnBadgeWarn;
      if (tKey === 'urgent') b.textContent = loc.adminAnnBadgeUrgent;
    });

    setTxt('adminCancelFormHeading', isEn ? 'Cancel / Restore Lesson' : 'Ders İptal Et / Geri Al');
    setTxt('lblAdminCancelProg', isEn ? 'Program' : 'Program');
    setTxt('lblAdminCancelDate', isEn ? 'Lesson Date' : 'Ders Tarihi');
    setTxt('lblAdminCancelReason', isEn ? 'Reason (Optional)' : 'İptal Notu (Opsiyonel)');
    setPh('adminCancelReasonInput', isEn ? 'Note (optional) — e.g. Instructor excused...' : 'İptal notu (opsiyonel) — Örn: Hoca mazeretli...');
    setPh('adminCancelDateSearch', loc.adminMatSearchDatePlaceholder);
    setTxt('lblAdminCancelDaySlots', isEn ? 'Lessons on Selected Date' : 'Seçili Günün Dersleri');
    setTxt('adminCancelledListHeading', isEn ? 'Cancelled Lessons' : 'İptal Edilen Dersler');
    document.querySelectorAll('[data-cancel-list-filter=""], [data-mat-list-filter=""]').forEach((b) => {
      b.textContent = loc.groupAllLabel;
    });

    setTxt('lblAdminAddSid', loc.adminAddSidLabel);
    setTxt('lblAdminAddName', loc.adminAddNameLabel);
    setPh('adminAddName', loc.adminAddNamePlaceholder);
    setTxt('lblAdminAddGroup', loc.adminAddGroupLabel);
    document.querySelectorAll('[data-add-group]').forEach((b) => {
      const g = b.getAttribute('data-add-group') || '';
      b.textContent = isEn ? `Group ${g}` : `Grup ${g}`;
    });
    setTxt('lblAdminAddLab', loc.adminAddLabLabel);
    const addLabAllBtn = document.querySelector('[data-add-lab=""]');
    if (addLabAllBtn) addLabAllBtn.textContent = loc.groupAllLabel;
    setTxt('lblAdminAddLang', loc.adminAddLangLabel);
    setTxt('btnAdminSaveNewStudent', loc.adminAddSaveBtn);

    setTxt('btnAdminCancelStudentEdit', loc.adminEditCloseBtn);
    setTxt('lblAdminEditName', loc.adminAddNameLabel);
    const editMbuAll = document.querySelector('[data-edit-mbu=""]');
    if (editMbuAll) editMbuAll.textContent = loc.groupAllLabel;
    const editLabAll = document.querySelector('[data-edit-lab=""]');
    if (editLabAll) editLabAll.textContent = loc.groupAllLabel;
    setTxt('lblAdminEditMode', loc.adminEditModeLabel);
    const editDim = document.querySelector('[data-edit-mode="dim"]');
    if (editDim) editDim.textContent = loc.otherModeDim;
    const editHide = document.querySelector('[data-edit-mode="hide"]');
    if (editHide) editHide.textContent = loc.otherModeHide;
    setTxt('lblAdminEditLang', loc.adminEditLangLabel);
    setTxt('btnAdminSaveStudentEdit', loc.adminEditSaveBtn);

    setPh('adminStudentFilterInput', loc.adminStudentFilterPlaceholder);
    setPh('adminMatDateSearch', loc.adminMatSearchDatePlaceholder);
    const clearStudentBtnEl = document.getElementById('btnClearAdminStudentFilter');
    if (clearStudentBtnEl) {
      clearStudentBtnEl.setAttribute('aria-label', loc.clearSearch);
    }
    document.querySelectorAll('[data-filter-sgroup]').forEach((b) => {
      const g = b.getAttribute('data-filter-sgroup') || '';
      b.textContent = g ? (isEn ? `Group ${g}` : `Grup ${g}`) : loc.groupAllLabel;
    });
    setTxt('lblAdminPwdChangeTitle', loc.adminPwdChangeTitle);
    setPh('adminNewPwdInput', loc.adminPwdChangePlaceholder);
    setTxt('btnAdminSaveNewPwd', loc.adminPwdSaveBtn);

    syncAdminUnlockBarUI();
    syncAdminAnnFormUI(false);
    syncAdminExamDateDisplay();
    syncAdminSiteAccessUI();
    syncAdminHubLanguageUI();
    syncAdminHubSummary();
    void syncAdminDataJsonUI();

    const modalEl = document.getElementById('adminModal');
    if (modalEl && !modalEl.classList.contains('hidden')) {
      renderAdminAnnouncementsList(false);
      renderAdminCancelDaySlots('none');
      renderAdminCancelledList(false);
      renderAdminStudentsList();
      syncAdminStudentEditorUI();
      updateAdminHeaderForTab(adminState.activeTab || 'hub');
      requestAnimationFrame(() => syncAllAdminSegmentedIndicators(false));
    }
  }

  function syncAdminHubLanguageUI() {
    const isEn = state.lang === 'en';
    const setTxt = (id, text) => {
      const el = document.getElementById(id);
      if (el && typeof text === 'string') el.textContent = text;
    };
    setTxt('lblAdminBackBtn', 'Admin');
    setTxt('lblAdminQuickActions', isEn ? 'Quick Actions' : 'Hızlı İşlemler');
    setTxt('lblAdminQuickCancelTitle', isEn ? 'Cancel Today' : 'Bugün İptal');
    setTxt('lblAdminQuickCancelSub', isEn ? 'Quick cancel' : 'Hızlı iptal et');
    setTxt('lblAdminQuickAnnTitle', isEn ? 'Urgent Notice' : 'Acil Duyuru');
    setTxt('lblAdminQuickAnnSub', isEn ? 'Post now' : 'Hemen yayınla');
    setTxt('lblAdminQuickLockTitle', isEn ? 'Site Lock' : 'Site Kilidi');
    setTxt('lblAdminHubGroupContent', isEn ? 'Schedule & Content' : 'Dersler & İçerik');
    setTxt('lblAdminHubGroupSystem', isEn ? 'Students & System' : 'Öğrenciler & Sistem');
    setTxt('lblHubAnnouncements', isEn ? 'Announcements' : 'Duyurular');
    setTxt('subHubAnnouncements', isEn ? 'Publish, target & edit' : 'Yayınla, hedefle ve düzenle');
    setTxt('lblHubCancellations', isEn ? 'Cancellations' : 'Ders İptali');
    setTxt('subHubCancellations', isEn ? 'Cancel or restore lessons' : 'İptal et veya geri al');
    setTxt('lblHubMaterials', isEn ? 'Lesson PDFs' : "Ders PDF'leri");
    setTxt('subHubMaterials', isEn ? 'Upload PDF files or links' : 'PDF dosyası veya bağlantı ekle');
    setTxt('lblHubExams', isEn ? 'Exam Countdowns' : 'Sınav Geri Sayımı');
    setTxt('subHubExams', isEn ? 'Exam dates, times & urgent notes' : 'Sınav tarih, saat ve acil notları');
    setTxt('lblHubStudents', isEn ? 'Student Settings & Add' : 'Öğrenci Ayarları & Ekleme');
    setTxt('subHubStudents', isEn ? 'Manage students & add new student' : 'Öğrenci listesi, ayarları ve yeni öğrenci ekle');
    setTxt('lblHubSiteSettings', isEn ? 'Site Settings' : 'Site Ayarları');
    setTxt('subHubSiteSettings', isEn ? 'Maintenance mode, site lock, password & sync' : 'Bakım modu, site kilidi, şifre ve yayın');
    setTxt('lblAdminRecentActivity', isEn ? 'Recent Activity' : 'Son İşlemler');
    setTxt('btnAdminClearHistory', isEn ? 'Clear' : 'Temizle');
    setTxt('lblAdminAnnExpires', isEn ? 'Auto-Expire (Optional)' : 'Otomatik Bitiş (Opsiyonel)');
    setTxt('lblAdminAnnPreview', isEn ? 'Student Preview' : 'Öğrenci Önizlemesi');
    setTxt('lblAdminExamProg', isEn ? 'Target Program' : 'Hedef Program');
    setTxt('adminExamsListHeading', isEn ? 'Managed Exams' : 'Yönetilen Sınavlar');
  }

  function syncAdminHubSummary() {
    const isEn = state.lang === 'en';
    const nowMs = Date.now();
    const activeAnns = (adminState.announcements && adminState.announcements.length > 0
      ? adminState.announcements
      : (Array.isArray(activeAnnouncementsList) ? activeAnnouncementsList : [])
    ).filter((a) => a && a.active !== false && (!a.expiresAtMs || Number(a.expiresAtMs) > nowMs)).length;
    const cancelCount = (adminState.cancelledLessons && adminState.cancelledLessons.length > 0
      ? adminState.cancelledLessons.length
      : (Array.isArray(cancelledLessonsList) ? cancelledLessonsList.length : 0));
    const matCount = (adminState.materials && adminState.materials.length > 0
      ? adminState.materials.length
      : (lessonMaterialsMap ? Object.values(lessonMaterialsMap).flat().length : 0));
    const examCount = (adminState.exams && adminState.exams.length > 0
      ? adminState.exams.length
      : (Array.isArray(managedExamsList) ? managedExamsList.length : 0));
    const stuCount = (adminState.students && adminState.students.length > 0)
      ? adminState.students.length
      : (typeof STUDENT_ROSTER === 'object' && STUDENT_ROSTER ? Object.keys(STUDENT_ROSTER).length : 0);

    const setBadge = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setBadge('countHubAnnouncements', isEn ? `${activeAnns} active` : `${activeAnns} aktif`);
    setBadge('countHubCancellations', isEn ? `${cancelCount}` : `${cancelCount} iptal`);
    setBadge('countHubMaterials', isEn ? `${matCount}` : `${matCount} PDF`);
    setBadge('countHubExams', `${examCount}`);
    setBadge('countHubStudents', `${stuCount}`);

    const lockedOnly = Boolean(siteRequireStudentLogin);
    const lockIconWrap = document.getElementById('adminQuickLockIconWrap');
    const iconUnlock = document.getElementById('iconAdminQuickUnlock');
    const iconLock = document.getElementById('iconAdminQuickLock');
    const stateEl = document.getElementById('lblAdminQuickLockState');
    if (lockIconWrap) {
      lockIconWrap.className = lockedOnly
        ? 'w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0 transition-colors'
        : 'w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 transition-colors';
    }
    if (iconUnlock) iconUnlock.classList.toggle('hidden', lockedOnly);
    if (iconLock) iconLock.classList.toggle('hidden', !lockedOnly);
    if (stateEl) {
      stateEl.textContent = lockedOnly
        ? (isEn ? 'Login Only' : 'Giriş Kilitli')
        : (isEn ? 'Public' : 'Herkese Açık');
      stateEl.className = lockedOnly
        ? 'block text-[10.5px] font-semibold text-amber-600 dark:text-amber-300 truncate mt-0.5'
        : 'block text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400 truncate mt-0.5';
    }
    renderAdminRecentActivity();
  }

  function updateAdminHeaderForTab(tabKey) {
    const isHub = !tabKey || tabKey === 'hub';
    const isEn = state.lang === 'en';
    const loc = I18N[state.lang];
    const backBtn = document.getElementById('btnAdminBackToHub');
    const brandIcon = document.getElementById('adminHeaderBrandIcon');
    const badgeEl = document.getElementById('adminModalBadge');
    const titleEl = document.getElementById('adminModalTitle');

    if (backBtn) {
      const wasHidden = backBtn.classList.contains('hidden');
      backBtn.classList.toggle('hidden', isHub);
      backBtn.classList.toggle('inline-flex', !isHub);
      if (!isHub && wasHidden) {
        backBtn.classList.remove('admin-back-pop');
        void backBtn.offsetWidth;
        backBtn.classList.add('admin-back-pop');
      }
    }
    if (brandIcon) {
      brandIcon.classList.toggle('hidden', !isHub);
      brandIcon.classList.toggle('flex', isHub);
    }
    if (badgeEl) badgeEl.classList.toggle('hidden', !isHub);
    if (titleEl) {
      const titles = {
        hub: loc.adminModalTitle,
        announcements: isEn ? 'Announcements' : 'Duyurular',
        cancellations: isEn ? 'Cancellations' : 'Ders İptali',
        materials: isEn ? 'Lesson PDFs' : "Ders PDF'leri",
        exams: isEn ? 'Exam Countdowns' : 'Sınav Geri Sayımı',
        students: isEn ? 'Student Settings & Add' : 'Öğrenci Ayarları & Ekleme',
        'site-settings': isEn ? 'Site Settings' : 'Site Ayarları',
        'extras-feedback': isEn ? 'Anonymous Feedback' : 'Temsilciye İlet',
        'extras-polls': isEn ? 'Live Polls' : 'Canlı Anketler',
        'extras-overrides': isEn ? 'Lesson Overrides' : 'Saat / Amfi Değişikliği',
        'extras-extra-lessons': isEn ? 'Extra Lessons' : 'Ek / Telafi Ders',
        'extras-banner': isEn ? 'Emergency Banner' : 'Acil / Bakım Bannerı',
      };
      const nextTitle = titles[tabKey] || loc.adminModalTitle;
      if (titleEl.textContent !== nextTitle) {
        titleEl.textContent = nextTitle;
        titleEl.classList.remove('admin-title-swap');
        void titleEl.offsetWidth;
        titleEl.classList.add('admin-title-swap');
      }
    }
  }

  function updateAdminTabIndicator(_tabKey, _animate = true) {
    // Legacy no-op: navigation now uses iOS Settings Hub + Back header.
  }

  function replayAdminPaneEnter(paneEl, direction = 'up') {
    if (!paneEl) return;
    paneEl.classList.remove('admin-pane-enter', 'admin-pane-enter-right', 'admin-pane-enter-left');
    void paneEl.offsetWidth;
    if (direction === 'right') {
      paneEl.classList.add('admin-pane-enter-right');
    } else if (direction === 'left') {
      paneEl.classList.add('admin-pane-enter-left');
    } else {
      paneEl.classList.add('admin-pane-enter');
    }
  }

  function switchAdminTab(tabKey, animate = true) {
    const nextTab = tabKey || 'hub';
    const prevTab = adminState.activeTab || 'hub';
    let dir = 'up';
    if (animate && prevTab !== nextTab) {
      if (nextTab === 'hub') dir = 'left';
      else if (prevTab === 'hub') dir = 'right';
      else {
        const prevIdx = ADMIN_TAB_ORDER.indexOf(prevTab);
        const nextIdx = ADMIN_TAB_ORDER.indexOf(nextTab);
        dir = (prevIdx >= 0 && nextIdx >= 0) ? (nextIdx > prevIdx ? 'right' : 'left') : 'right';
      }
    }
    adminState.activeTab = nextTab;
    updateAdminHeaderForTab(nextTab);

    const pHub = document.getElementById('adminPaneHub');
    const pAnn = document.getElementById('adminPaneAnnouncements');
    const pMat = document.getElementById('adminPaneMaterials');
    const pCan = document.getElementById('adminPaneCancellations');
    const pExm = document.getElementById('adminPaneExams');
    const pStu = document.getElementById('adminPaneStudents');
    const pSet = document.getElementById('adminPaneSiteSettings');

    const allPanes = [pHub, pAnn, pMat, pCan, pExm, pStu, pSet];
    allPanes.forEach((p) => {
      if (!p) return;
      p.style.transition = '';
      p.style.transform = '';
      p.style.opacity = '';
    });

    if (pHub) {
      pHub.classList.toggle('hidden', nextTab !== 'hub');
      if (nextTab === 'hub') {
        syncAdminHubSummary();
        replayAdminPaneEnter(pHub, dir);
        pHub.querySelectorAll('.admin-quick-tile, .admin-hub-row').forEach((el, idx) => {
          const hEl = el as HTMLElement;
          hEl.style.setProperty('--admin-delay', `${Math.min(idx * 24, 240)}ms`);
          hEl.classList.remove('admin-stagger-item');
          void hEl.offsetWidth;
          hEl.classList.add('admin-stagger-item');
        });
      }
    }
    if (pAnn) {
      pAnn.classList.toggle('hidden', nextTab !== 'announcements');
      if (nextTab === 'announcements') {
        syncAdminAnnExpiresDisplay();
        syncAdminAnnPublishAtDisplay();
        renderAdminAnnLivePreview();
        replayAdminPaneEnter(pAnn, dir);
      }
    }
    window.dispatchEvent(new CustomEvent('inonu-admin-tab-changed', { detail: { tabKey: nextTab, dir } }));
    if (pMat) {
      pMat.classList.toggle('hidden', nextTab !== 'materials');
      if (nextTab === 'materials') {
        if (adminState.materials.length === 0 && lessonMaterialsMap && Object.keys(lessonMaterialsMap).length > 0) {
          adminState.materials = Object.values(lessonMaterialsMap).flat();
        }
        syncAdminMaterialFormDefaults();
        renderAdminMaterialsList(false);
        replayAdminPaneEnter(pMat, dir);
        if (adminCloudDirty.materials) {
          void refreshAdminCloudData('materials');
        }
      }
    }
    if (pCan) {
      pCan.classList.toggle('hidden', nextTab !== 'cancellations');
      if (nextTab === 'cancellations') {
        if (adminState.cancelledLessons.length === 0 && Array.isArray(cancelledLessonsList) && cancelledLessonsList.length > 0) {
          adminState.cancelledLessons = [...cancelledLessonsList];
        }
        syncAdminCancelFormDefaults(false);
        renderAdminCancelDaySlots('none');
        renderAdminCancelledList(false);
        renderAdminCancelLivePreview();
        replayAdminPaneEnter(pCan, dir);
        if (adminCloudDirty.cancellations) {
          void refreshAdminCloudData('cancellations');
        }
      }
    }
    if (pExm) {
      pExm.classList.toggle('hidden', nextTab !== 'exams');
      if (nextTab === 'exams') {
        syncAdminExamFormUI(false);
        renderAdminExamsList();
        replayAdminPaneEnter(pExm, dir);
      }
    }
    if (pStu) {
      pStu.classList.toggle('hidden', nextTab !== 'students');
      if (nextTab === 'students') {
        switchAdminStudentsSubTab(adminState.studentsSubTab || 'roster', false);
        replayAdminPaneEnter(pStu, dir);
        if (adminCloudDirty.students) {
          void refreshAdminCloudData('students');
        } else {
          renderAdminStudentsList();
        }
      }
    }
    if (pSet) {
      pSet.classList.toggle('hidden', nextTab !== 'site-settings');
      if (nextTab === 'site-settings') {
        replayAdminPaneEnter(pSet, dir);
      }
    }
    if (nextTab === 'announcements' && adminCloudDirty.announcements) {
      void refreshAdminCloudData('announcements');
    }
    const scrollBody = document.getElementById('adminModalScrollBody');
    if (scrollBody) scrollBody.scrollTop = 0;
    requestAnimationFrame(() => {
      syncAllAdminSegmentedIndicators(false);
    });
    setTimeout(() => {
      const mEl = document.getElementById('adminModal');
      if (mEl && !mEl.classList.contains('hidden')) {
        syncAllAdminSegmentedIndicators(false);
      }
    }, 340);
  }

  // Feature 5: Student Live Previews (Announcements + Cancellations)
  function formatDateTimeLocalInput(ms) {
    if (!ms || ms <= 0) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function formatShortDateTime(ms) {
    if (!ms || ms <= 0) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function syncAdminAnnExpiresDisplay() {
    const expInp = document.getElementById('adminAnnExpiresInput');
    const disp = document.getElementById('adminAnnExpiresDisplay');
    if (!disp) return;
    const isEn = state.lang === 'en';
    const raw = (expInp?.value || '').trim();
    if (!raw) {
      disp.textContent = isEn ? 'Pick date & time (Never expires)' : 'Tarih ve saat seç (Süresiz)';
      disp.className = 'truncate tabular-nums text-slate-500 dark:text-slate-400';
      return;
    }
    const ms = new Date(raw).getTime();
    if (!Number.isNaN(ms) && ms > 0) {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      const months = isEn
        ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        : ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
      disp.textContent = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      disp.className = 'truncate tabular-nums text-slate-900 dark:text-white font-bold';
    }
  }
  function syncAdminAnnPublishAtDisplay() {
    const pubInp = document.getElementById('adminAnnPublishAtInput');
    const disp = document.getElementById('adminAnnPublishAtDisplay');
    if (!disp) return;
    const isEn = state.lang === 'en';
    const raw = (pubInp?.value || '').trim();
    if (!raw) {
      disp.textContent = isEn ? 'Publish immediately' : 'Hemen yayınla';
      disp.className = 'truncate tabular-nums text-slate-500 dark:text-slate-400';
      return;
    }
    const ms = new Date(raw).getTime();
    if (!Number.isNaN(ms) && ms > 0) {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      const months = isEn
        ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        : ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
      disp.textContent = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      disp.className = 'truncate tabular-nums text-indigo-600 dark:text-indigo-300 font-bold';
    }
  }
  function syncAdminExamDateDisplay() {
    const dateInp = document.getElementById('adminExamDateInput');
    const disp = document.getElementById('adminExamDateDisplay');
    if (!disp) return;
    const isEn = state.lang === 'en';
    const raw = (dateInp?.value || '').trim();
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      disp.textContent = isEn ? 'Pick exam date...' : 'Sınav tarihi seç...';
      disp.className = 'truncate tabular-nums text-slate-500 dark:text-slate-400';
      return;
    }
    const [y, m, d] = raw.split('-').map(Number);
    const months = isEn
      ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      : ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    disp.textContent = `${d} ${months[Math.max(0, m - 1)]} ${y}`;
    disp.className = 'truncate tabular-nums text-slate-900 dark:text-white font-bold';
  }

  // Themed In-Site Liquid Glass Date & Time Picker Modal Controller
  const adminDtPickerState = {
    mode: 'date',
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    selectedDate: '',
    hour: 23,
    minute: 59,
    onApply: null
  };

  function renderAdminDateTimeModal() {
    const isEn = state.lang === 'en';
    const monthLabel = document.getElementById('adminDtMonthLabel');
    const weekdaysEl = document.getElementById('adminDtWeekdays');
    const gridEl = document.getElementById('adminDtDaysGrid');
    const timeSec = document.getElementById('adminDtTimeSection');
    const hourEl = document.getElementById('adminDtHourVal');
    const minEl = document.getElementById('adminDtMinVal');
    const btnToday = document.getElementById('btnAdminDtToday');
    const btnClear = document.getElementById('btnAdminDtClear');
    const btnConfirm = document.getElementById('btnAdminDtConfirm');
    const lblTime = document.getElementById('lblAdminDtTime');

    const monthNames = isEn
      ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      : ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    const wkDays = isEn
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

    if (monthLabel) monthLabel.textContent = `${monthNames[adminDtPickerState.viewMonth]} ${adminDtPickerState.viewYear}`;
    if (weekdaysEl) weekdaysEl.innerHTML = wkDays.map((w) => `<div>${w}</div>`).join('');
    if (timeSec) timeSec.classList.toggle('hidden', adminDtPickerState.mode !== 'datetime');
    if (btnConfirm) {
      btnConfirm.classList.toggle('hidden', adminDtPickerState.mode !== 'datetime');
      btnConfirm.textContent = isEn ? 'Apply' : 'Uygula';
    }
    if (btnToday) btnToday.textContent = isEn ? 'Today' : 'Bugün';
    if (btnClear) btnClear.textContent = isEn ? 'Clear' : 'Temizle';
    if (lblTime) lblTime.textContent = isEn ? 'Time' : 'Saat';
    if (hourEl) hourEl.textContent = String(adminDtPickerState.hour).padStart(2, '0');
    if (minEl) minEl.textContent = String(adminDtPickerState.minute).padStart(2, '0');

    if (!gridEl) return;
    gridEl.innerHTML = '';
    const firstDay = new Date(adminDtPickerState.viewYear, adminDtPickerState.viewMonth, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(adminDtPickerState.viewYear, adminDtPickerState.viewMonth + 1, 0).getDate();
    const todayIso = getTodayIso();
    const pad = (n) => String(n).padStart(2, '0');

    for (let i = 0; i < startOffset; i += 1) {
      const empty = document.createElement('div');
      empty.className = 'h-[38px]';
      gridEl.appendChild(empty);
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      const iso = `${adminDtPickerState.viewYear}-${pad(adminDtPickerState.viewMonth + 1)}-${pad(d)}`;
      const isSelected = adminDtPickerState.selectedDate === iso;
      const isToday = iso === todayIso;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `food-cal-day ${
        isSelected
          ? 'admin-dt-day-selected font-bold'
          : isToday
            ? 'admin-dt-day-today bg-blue-500/10'
            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-500/12'
      }`;
      btn.textContent = String(d);
      btn.addEventListener('click', () => {
        adminDtPickerState.selectedDate = iso;
        if (adminDtPickerState.mode === 'date') {
          if (typeof adminDtPickerState.onApply === 'function') {
            adminDtPickerState.onApply(iso);
          }
          closeAdminDateTimeModal();
        } else {
          renderAdminDateTimeModal();
        }
      });
      gridEl.appendChild(btn);
    }
  }

  function openAdminDateTimeModal(opts) {
    const isEn = state.lang === 'en';
    const mode = opts?.mode === 'datetime' ? 'datetime' : 'date';
    adminDtPickerState.mode = mode;
    adminDtPickerState.onApply = typeof opts?.onApply === 'function' ? opts.onApply : null;

    const titleEl = document.getElementById('adminDateTimeModalTitle');
    if (titleEl) {
      titleEl.textContent = opts?.title || (mode === 'datetime'
        ? (isEn ? 'Select Expiry Date & Time' : 'Bitiş Tarihi ve Saati')
        : (isEn ? 'Select Date' : 'Tarih Seç'));
    }

    const now = new Date();
    let parsedDate = '';
    let hr = 23;
    let mn = 59;
    const initVal = String(opts?.initialValue || '').trim();
    if (mode === 'datetime' && initVal) {
      const dt = new Date(initVal);
      if (!Number.isNaN(dt.getTime())) {
        const pad = (n) => String(n).padStart(2, '0');
        parsedDate = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        hr = dt.getHours();
        mn = dt.getMinutes();
      }
    } else if (mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(initVal)) {
      parsedDate = initVal;
    }

    if (parsedDate) {
      const [y, m] = parsedDate.split('-').map(Number);
      adminDtPickerState.viewYear = y;
      adminDtPickerState.viewMonth = Math.max(0, m - 1);
      adminDtPickerState.selectedDate = parsedDate;
    } else {
      adminDtPickerState.viewYear = now.getFullYear();
      adminDtPickerState.viewMonth = now.getMonth();
      adminDtPickerState.selectedDate = getTodayIso();
    }
    adminDtPickerState.hour = hr;
    adminDtPickerState.minute = mn;

    renderAdminDateTimeModal();
    openAnimatedModal(
      document.getElementById('adminDateTimeModal'),
      document.getElementById('adminDateTimeModalCard')
    );
  }

  function closeAdminDateTimeModal() {
    closeAnimatedModal(
      document.getElementById('adminDateTimeModal'),
      document.getElementById('adminDateTimeModalCard')
    );
  }
  function renderAdminAnnLivePreview() {
    const wrap = document.getElementById('adminAnnLivePreviewWrap');
    const card = document.getElementById('adminAnnLivePreview');
    if (!wrap || !card) return;
    const titleVal = (document.getElementById('adminAnnTitleInput')?.value || '').trim();
    const msgVal = (document.getElementById('adminAnnMsgInput')?.value || '').trim();
    if (!titleVal && !msgVal) {
      wrap.classList.add('hidden');
      return;
    }
    const loc = I18N[state.lang];
    const tone = adminState.annTone === 'urgent' ? 'urgent' : adminState.annTone === 'warn' ? 'warn' : 'info';
    const badgeCls =
      tone === 'urgent'
        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
        : tone === 'warn'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
          : 'bg-blue-500/15 text-blue-600 dark:text-blue-300';
    const badgeLabel =
      tone === 'urgent' ? loc.adminAnnBadgeUrgent : tone === 'warn' ? loc.adminAnnBadgeWarn : loc.adminAnnBadgeInfo;
    const expStr = document.getElementById('adminAnnExpiresInput')?.value || '';
    const expMs = expStr ? new Date(expStr).getTime() : 0;
    const expNote = expMs > 0 && !Number.isNaN(expMs)
      ? `<span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tabular-nums ml-auto shrink-0">⏱ ${escapeHtml(formatShortDateTime(expMs))}</span>`
      : '';
    wrap.classList.remove('hidden');
    card.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${badgeCls}">${escapeHtml(badgeLabel)}</span>
        <h5 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(titleVal || (state.lang === 'en' ? 'Untitled announcement' : 'Başlıksız duyuru'))}</h5>
        ${expNote}
      </div>
      ${msgVal ? `<p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">${escapeHtml(msgVal)}</p>` : ''}
    `;
  }
  function renderAdminCancelLivePreview() {
    const wrap = document.getElementById('adminCancelLivePreview');
    const txt = document.getElementById('adminCancelLivePreviewText');
    const inp = document.getElementById('adminCancelReasonInput');
    if (!wrap || !txt || !inp) return;
    const val = inp.value.trim();
    if (!val) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    txt.textContent = val;
  }

  // Feature 2: Admin Exam Countdown Manager UI
  function syncAdminExamFormUI(animateSeg = true) {
    const isEn = state.lang === 'en';
    const titleEl = document.getElementById('adminExamFormTitle');
    const cancelBtn = document.getElementById('btnAdminExamCancelEdit');
    const submitBtn = document.getElementById('btnAdminExamSubmit');
    if (titleEl) {
      titleEl.textContent = adminState.editingExamId
        ? (isEn ? 'Edit Exam Countdown' : 'Sınavı Düzenle')
        : (isEn ? 'Add Exam / Committee Countdown' : 'Sınav / Kurul Geri Sayımı Ekle');
    }
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !adminState.editingExamId);
    if (submitBtn) {
      submitBtn.textContent = adminState.editingExamId
        ? (isEn ? 'Update Exam' : 'Sınavı Güncelle')
        : (isEn ? 'Save Exam' : 'Sınavı Kaydet');
    }
    syncAdminExamDateDisplay();
    syncAdminSegmentedControl('adminExamProgChips', 'adminExamProgIndicator', 'data-exam-prog', adminState.examProg || '', animateSeg);
  }
  function renderAdminExamsList() {
    const listEl = document.getElementById('adminExamsList');
    if (!listEl) return;
    const isEn = state.lang === 'en';
    const items = Array.isArray(adminState.exams) && adminState.exams.length > 0
      ? adminState.exams
      : (managedExamsList || []);
    listEl.innerHTML = '';
    if (items.length === 0) {
      listEl.innerHTML = `<div class="ios-pill-control rounded-2xl p-5 text-center text-xs text-slate-500 dark:text-slate-400 admin-card-reveal">${isEn ? 'No managed exam countdowns yet.' : 'Henüz özel sınav geri sayımı eklenmedi.'}</div>`;
      return;
    }
    items.forEach((ex, idx) => {
      const row = document.createElement('div');
      row.className = 'ios-pill-control rounded-2xl p-3.5 flex items-start justify-between gap-2.5 flex-wrap admin-stagger-item';
      row.style.setProperty('--admin-delay', `${Math.min(idx, 10) * 28}ms`);
      const progLbl = ex.targetProg ? ex.targetProg.toUpperCase() : 'TR+EN';
      row.innerHTML = `
        <div class="min-w-0 flex-1 space-y-0.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">${progLbl}</span>
            <span class="text-[11px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums">${escapeHtml(ex.date)}${ex.time ? ` · ${escapeHtml(ex.time)}` : ''}</span>
          </div>
          <h5 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug">${escapeHtml(ex.title)}</h5>
          ${ex.note ? `<p class="text-[11px] font-medium text-amber-700 dark:text-amber-300 leading-snug">${escapeHtml(ex.note)}</p>` : ''}
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" class="btn-edit-exam ios-press min-h-[32px] px-3 py-1 rounded-full bg-blue-500/15 hover:bg-blue-500/25 text-blue-600 dark:text-blue-300 text-xs font-semibold transition">${isEn ? 'Edit' : 'Düzenle'}</button>
          <button type="button" class="btn-del-exam ios-press min-h-[32px] px-3 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold transition">${adminState.deleteConfirmExamId === ex.id ? (isEn ? 'Sure?' : 'Emin misin?') : (isEn ? 'Delete' : 'Sil')}</button>
        </div>
      `;
      row.querySelector('.btn-edit-exam').addEventListener('click', () => {
        adminState.editingExamId = ex.id;
        adminState.examProg = ex.targetProg || '';
        const t = document.getElementById('adminExamTitleInput');
        const d = document.getElementById('adminExamDateInput');
        const tm = document.getElementById('adminExamTimeInput');
        const n = document.getElementById('adminExamNoteInput');
        if (t) t.value = ex.title || '';
        if (d) d.value = ex.date || '';
        if (tm) tm.value = ex.time || '';
        if (n) n.value = ex.note || '';
        syncAdminExamFormUI();
      });
      row.querySelector('.btn-del-exam').addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        if (adminState.deleteConfirmExamId !== ex.id) {
          adminState.deleteConfirmExamId = ex.id;
          renderAdminExamsList();
          return;
        }
        adminState.deleteConfirmExamId = '';
        row.classList.add('admin-row-exit');
        try {
          await api.deleteExamCountdown(ex.id, secret === 'active' ? undefined : secret);
          applyLoadedExamCountdownsList(managedExamsList.filter((x) => x.id !== ex.id));
          pushAdminHistory({
            label: isEn ? 'Exam deleted' : 'Sınav silindi',
            sub: `${ex.title} (${ex.date})`,
            undoType: 'exam_delete',
            undoData: { ...ex }
          });
          showToast(isEn ? 'Exam removed.' : 'Sınav silindi.');
        } catch (err) {
          row.classList.remove('admin-row-exit');
          console.warn('Delete exam error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        }
      });
      listEl.appendChild(row);
    });
  }

  // Feature 6: iPhone WhatsApp-Style Long-Press Context Menu for Lesson & Announcement Cards
  let adminSlotQuickCloseTimer = null;
  function showAdminQuickContextModal() {
    const modal = document.getElementById('adminSlotQuickModal');
    if (!modal) return;
    if (adminSlotQuickCloseTimer) {
      clearTimeout(adminSlotQuickCloseTimer);
      adminSlotQuickCloseTimer = null;
    }
    modal.classList.remove('hidden', 'is-leaving', 'is-entering');
    syncModalScrollLock();
    void modal.offsetWidth;
    modal.classList.add('is-entering');
  }
  function openAdminSlotQuickModal(slot) {
    const session = getActiveAuthSession();
    if (!session || !session.isAdmin || !slot) return;
    adminQuickSlotTarget = slot;
    adminQuickAnnTarget = null;
    adminQuickExamTarget = null;
    const isEn = state.lang === 'en';
    const prog = state.lang === 'en' ? 'en' : 'tr';
    const cancelInfo = getCancelledLessonInfo(slot, prog);
    const isCancelled = Boolean(cancelInfo);
    const metaEl = document.getElementById('adminSlotQuickMeta');
    const titleEl = document.getElementById('adminSlotQuickTitle');
    const subEl = document.getElementById('adminSlotQuickSub');
    const previewEl = document.getElementById('adminSlotQuickPreview');
    const reasonWrap = document.getElementById('adminSlotQuickReasonWrap');
    const reasonInp = document.getElementById('adminSlotQuickReasonInput');
    const slotActions = document.getElementById('adminSlotQuickActionsSlot');
    const annActions = document.getElementById('adminSlotQuickActionsAnn');
    const examActions = document.getElementById('adminSlotQuickActionsExam');
    const cancelLbl = document.getElementById('lblAdminSlotQuickCancel');
    const cancelIconWrap = document.getElementById('iconWrapSlotQuickCancel');
    const pdfLbl = document.getElementById('lblAdminSlotQuickPdf');
    const annLbl = document.getElementById('lblAdminSlotQuickAnn');
    const closeLbl = document.getElementById('lblAdminSlotQuickClose');

    if (slotActions) {
      slotActions.classList.remove('hidden');
      slotActions.classList.add('flex');
    }
    if (annActions) {
      annActions.classList.add('hidden');
      annActions.classList.remove('flex');
    }
    if (examActions) {
      examActions.classList.add('hidden');
      examActions.classList.remove('flex');
    }

    if (metaEl) {
      metaEl.textContent = `${slot.date} • ${slot.slotNo}. ${isEn ? 'Hour' : 'Ders'}${slot.time ? ` • ${slot.time}` : ''}${isCancelled ? ` • ${isEn ? 'CANCELLED' : 'İPTAL'}` : ''}`;
      metaEl.className = isCancelled
        ? 'block text-[10.5px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 tabular-nums'
        : 'block text-[10.5px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 tabular-nums';
    }
    if (titleEl) titleEl.textContent = slot.title || '';
    if (subEl) {
      const subParts = [slot.instructor, slot.group ? `${isEn ? 'Group' : 'Grup'} ${slot.group}` : ''].filter(Boolean);
      subEl.textContent = subParts.join(' · ');
      subEl.classList.toggle('hidden', subParts.length === 0);
    }
    if (previewEl) {
      previewEl.classList.toggle('slot-card-cancelled', isCancelled);
    }
    if (reasonWrap) {
      reasonWrap.classList.toggle('hidden', isCancelled);
    }
    if (reasonInp) {
      reasonInp.value = cancelInfo?.reason || '';
      reasonInp.placeholder = isEn ? 'Cancellation note (optional)...' : 'İptal notu (opsiyonel)...';
    }
    if (cancelLbl) {
      cancelLbl.textContent = isCancelled
        ? (isEn ? 'Restore This Lesson' : 'Bu Dersin İptalini Geri Al')
        : (isEn ? 'Cancel This Lesson' : 'Bu Dersi İptal Et');
      cancelLbl.className = isCancelled
        ? 'text-[14px] font-semibold text-emerald-600 dark:text-emerald-400'
        : 'text-[14px] font-semibold text-rose-600 dark:text-rose-400';
    }
    if (cancelIconWrap) {
      cancelIconWrap.className = isCancelled
        ? 'text-emerald-600 dark:text-emerald-400 shrink-0'
        : 'text-rose-600 dark:text-rose-400 shrink-0';
    }
    if (pdfLbl) pdfLbl.textContent = isEn ? 'Add PDF to This Lesson' : 'Bu Derse PDF Ekle';
    if (annLbl) annLbl.textContent = isEn ? 'Post Announcement for Lesson' : 'Bu Ders İçin Duyuru Geç';
    if (closeLbl) closeLbl.textContent = isEn ? 'Cancel' : 'Vazgeç';

    showAdminQuickContextModal();
  }
  function openAdminAnnQuickModal(ann) {
    const session = getActiveAuthSession();
    if (!session || !session.isAdmin || !ann) return;
    adminQuickAnnTarget = ann;
    adminQuickSlotTarget = null;
    const isEn = state.lang === 'en';
    const loc = I18N[state.lang];
    const tone = ann.tone === 'urgent' ? 'urgent' : ann.tone === 'warn' ? 'warn' : 'info';
    const badgeLabel = tone === 'urgent' ? loc.adminAnnBadgeUrgent : tone === 'warn' ? loc.adminAnnBadgeWarn : loc.adminAnnBadgeInfo;

    const metaEl = document.getElementById('adminSlotQuickMeta');
    const titleEl = document.getElementById('adminSlotQuickTitle');
    const subEl = document.getElementById('adminSlotQuickSub');
    const previewEl = document.getElementById('adminSlotQuickPreview');
    const reasonWrap = document.getElementById('adminSlotQuickReasonWrap');
    const slotActions = document.getElementById('adminSlotQuickActionsSlot');
    const annActions = document.getElementById('adminSlotQuickActionsAnn');
    const examActions = document.getElementById('adminSlotQuickActionsExam');
    const editLbl = document.getElementById('lblAdminAnnQuickEdit');
    const hideLbl = document.getElementById('lblAdminAnnQuickHide');
    const delLbl = document.getElementById('lblAdminAnnQuickDelete');
    const closeLbl = document.getElementById('lblAdminSlotQuickClose');

    if (slotActions) {
      slotActions.classList.add('hidden');
      slotActions.classList.remove('flex');
    }
    if (examActions) {
      examActions.classList.add('hidden');
      examActions.classList.remove('flex');
    }
    if (annActions) {
      annActions.classList.remove('hidden');
      annActions.classList.add('flex');
    }
    if (reasonWrap) reasonWrap.classList.add('hidden');
    if (previewEl) previewEl.classList.remove('slot-card-cancelled');

    if (metaEl) {
      const targetParts = [badgeLabel];
      if (ann.targetProg) targetParts.push(ann.targetProg.toUpperCase());
      if (ann.targetGroup) targetParts.push(`${isEn ? 'Group' : 'Grup'} ${ann.targetGroup}`);
      metaEl.textContent = targetParts.join(' • ');
      metaEl.className = tone === 'urgent'
        ? 'block text-[10.5px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400'
        : tone === 'warn'
          ? 'block text-[10.5px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400'
          : 'block text-[10.5px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400';
    }
    if (titleEl) titleEl.textContent = ann.title || '';
    if (subEl) {
      subEl.textContent = ann.message || '';
      subEl.classList.toggle('hidden', !ann.message);
    }
    if (editLbl) editLbl.textContent = isEn ? 'Edit Announcement' : 'Duyuruyu Düzenle';
    if (hideLbl) hideLbl.textContent = isEn ? 'Move to Draft (Hide)' : 'Taslağa Al (Gizle)';
    if (delLbl) delLbl.textContent = isEn ? 'Delete Announcement' : 'Duyuruyu Sil';
    if (closeLbl) closeLbl.textContent = isEn ? 'Cancel' : 'Vazgeç';

    showAdminQuickContextModal();
  }
  function openAdminExamQuickModal(exam) {
    const session = getActiveAuthSession();
    if (!session || !session.isAdmin || !exam) return;
    adminQuickExamTarget = exam;
    adminQuickSlotTarget = null;
    adminQuickAnnTarget = null;
    const isEn = state.lang === 'en';
    const dispTime = exam.startTime && exam.endTime ? `${exam.startTime}-${exam.endTime}` : (exam.rawTime || '');

    const metaEl = document.getElementById('adminSlotQuickMeta');
    const titleEl = document.getElementById('adminSlotQuickTitle');
    const subEl = document.getElementById('adminSlotQuickSub');
    const previewEl = document.getElementById('adminSlotQuickPreview');
    const reasonWrap = document.getElementById('adminSlotQuickReasonWrap');
    const slotActions = document.getElementById('adminSlotQuickActionsSlot');
    const annActions = document.getElementById('adminSlotQuickActionsAnn');
    const examActions = document.getElementById('adminSlotQuickActionsExam');
    const editLbl = document.getElementById('lblAdminExamQuickEdit');
    const annLbl = document.getElementById('lblAdminExamQuickAnn');
    const delBtn = document.getElementById('btnAdminExamQuickDelete');
    const delLbl = document.getElementById('lblAdminExamQuickDelete');
    const closeLbl = document.getElementById('lblAdminSlotQuickClose');

    if (slotActions) {
      slotActions.classList.add('hidden');
      slotActions.classList.remove('flex');
    }
    if (annActions) {
      annActions.classList.add('hidden');
      annActions.classList.remove('flex');
    }
    if (examActions) {
      examActions.classList.remove('hidden');
      examActions.classList.add('flex');
    }
    if (reasonWrap) reasonWrap.classList.add('hidden');
    if (previewEl) previewEl.classList.remove('slot-card-cancelled');

    if (metaEl) {
      metaEl.textContent = `${formatDateLong(exam.date)}${dispTime ? ` • ${dispTime}` : ''}`;
      metaEl.className = 'block text-[10.5px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 tabular-nums';
    }
    if (titleEl) titleEl.textContent = exam.title || '';
    if (subEl) {
      subEl.textContent = exam.note || (exam.managed ? (isEn ? 'Managed exam countdown' : 'Özel sınav geri sayımı') : (isEn ? 'From class schedule' : 'Ders programından'));
      subEl.classList.remove('hidden');
    }
    if (editLbl) {
      editLbl.textContent = exam.managed
        ? (isEn ? 'Edit Exam / Note' : 'Sınavı Düzenle / Not Ekle')
        : (isEn ? 'Add Note / Override Exam' : 'Sınava Not Ekle / Özelleştir');
    }
    if (annLbl) annLbl.textContent = isEn ? 'Post Exam Announcement' : 'Sınav İçin Duyuru Geç';
    if (delBtn) delBtn.classList.toggle('hidden', !(exam.managed && exam.examId));
    if (delLbl) delLbl.textContent = isEn ? 'Delete Exam' : 'Sınavı Sil';
    if (closeLbl) closeLbl.textContent = isEn ? 'Cancel' : 'Vazgeç';

    showAdminQuickContextModal();
  }
  function closeAdminSlotQuickModal() {
    const modal = document.getElementById('adminSlotQuickModal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (adminSlotQuickCloseTimer) clearTimeout(adminSlotQuickCloseTimer);
    modal.classList.remove('is-entering');
    modal.classList.add('is-leaving');
    adminSlotQuickCloseTimer = setTimeout(() => {
      adminSlotQuickCloseTimer = null;
      modal.classList.add('hidden');
      modal.classList.remove('is-leaving');
      syncModalScrollLock();
    }, 195);
  }

  function syncAdminAnnFormUI(animateSeg = true) {
    const loc = I18N[state.lang];
    const isEn = state.lang === 'en';
    const heading = document.getElementById('adminAnnFormTitle');
    const cancelBtn = document.getElementById('btnAdminAnnCancelEdit');
    const submitBtn = document.getElementById('btnAdminAnnSubmit');
    const activeToggle = document.getElementById('btnAdminAnnActiveToggle');
    const summaryEl = document.getElementById('lblAdminAnnTargetSummary');

    if (heading) heading.textContent = adminState.editingAnnId ? loc.adminAnnEditTitle : loc.adminAnnNewTitle;
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !adminState.editingAnnId);
    if (submitBtn) submitBtn.textContent = adminState.editingAnnId ? loc.adminAnnUpdateBtn : loc.adminAnnPublishBtn;
    if (activeToggle) {
      activeToggle.textContent = adminState.annActive ? loc.adminAnnLive : loc.adminAnnDraft;
      activeToggle.className = adminState.annActive
        ? 'ios-press min-h-[32px] px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
        : 'ios-press min-h-[32px] px-3 py-1 rounded-full text-[11px] font-semibold ios-pill-control text-slate-500 dark:text-slate-400';
    }
    syncAdminSegmentedControl('adminAnnToneChips', 'adminAnnToneIndicator', 'data-ann-tone', adminState.annTone || 'info', animateSeg);
    document.querySelectorAll('[data-ann-target-group]').forEach((b) => {
      const grp = b.getAttribute('data-ann-target-group') || '';
      b.classList.toggle('group-chip-active', grp === (adminState.annTargetGroup || ''));
    });
    syncAdminSegmentedControl('adminAnnTargetProgChips', 'adminAnnTargetProgIndicator', 'data-ann-target-prog', adminState.annTargetProg || '', animateSeg);
    if (summaryEl) {
      const parts = [];
      if (adminState.annTargetProg) parts.push(adminState.annTargetProg.toUpperCase());
      if (adminState.annTargetGroup) parts.push(`${isEn ? 'Group' : 'Grup'} ${adminState.annTargetGroup}`);
      summaryEl.textContent = parts.length > 0
        ? `${isEn ? 'Target' : 'Hedef'}: ${parts.join(' · ')}`
        : (isEn ? 'Target: All' : 'Hedef: Tümü');
    }
    syncAdminAnnExpiresDisplay();
    renderAdminAnnLivePreview();
  }

  function syncAdminAddStudentChips(animateSeg = true) {
    const isEnglish = adminState.addLang === 'en';
    if (isEnglish) {
      adminState.addLab = '';
    }
    document.querySelectorAll('[data-add-group]').forEach((b) => {
      b.classList.toggle('group-chip-active', b.getAttribute('data-add-group') === adminState.addGroup);
    });
    document.querySelectorAll('[data-add-lab]').forEach((b) => {
      b.classList.toggle('group-chip-active', b.getAttribute('data-add-lab') === adminState.addLab);
      b.disabled = isEnglish;
      b.tabIndex = isEnglish ? -1 : 0;
    });
    syncAdminSegmentedControl('adminAddLangChips', 'adminAddLangIndicator', 'data-add-lang', adminState.addLang === 'en' ? 'en' : 'tr', animateSeg);
    const labSection = document.getElementById('adminAddLabSection');
    if (labSection) {
      labSection.classList.toggle('is-collapsed', isEnglish);
      labSection.setAttribute('aria-hidden', isEnglish ? 'true' : 'false');
    }
  }

  function renderAdminAnnouncementsList(animateSeg = true) {
    const listEl = document.getElementById('adminAnnouncementsList');
    if (!listEl) return;
    const loc = I18N[state.lang];
    listEl.innerHTML = '';

    const activeFilter = adminState.annListFilter || '';
    syncAdminSegmentedControl('adminAnnListFilterChips', 'adminAnnListFilterIndicator', 'data-ann-list-filter', activeFilter, animateSeg);

    const filteredAnns = (adminState.announcements || []).filter((ann) => {
      if (!activeFilter) return true;
      return !ann.targetProg || ann.targetProg === activeFilter;
    });

    if (!filteredAnns || filteredAnns.length === 0) {
      listEl.innerHTML = `<div class="ios-pill-control rounded-2xl p-5 text-center text-xs text-slate-500 dark:text-slate-400 admin-card-reveal">${escapeHtml(loc.adminAnnEmpty)}</div>`;
      return;
    }

    filteredAnns.forEach((ann, idx) => {
      const row = document.createElement('div');
      row.className = 'ios-pill-control rounded-2xl p-3.5 space-y-2 admin-stagger-item';
      row.style.setProperty('--admin-delay', `${Math.min(idx, 10) * 28}ms`);

      const toneBadgeCls =
        ann.tone === 'urgent'
          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
          : ann.tone === 'warn'
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            : 'bg-blue-500/15 text-blue-600 dark:text-blue-300';
      const toneLabel =
        ann.tone === 'urgent'
          ? loc.adminAnnBadgeUrgent
          : ann.tone === 'warn'
            ? loc.adminAnnBadgeWarn
            : loc.adminAnnBadgeInfo;
      const statusLabel = ann.active ? loc.adminAnnLive : loc.adminAnnDraft;
      const targetProgLabel = ann.targetProg ? ann.targetProg.toUpperCase() : 'TR+EN';
      const targetGroupLabel = ann.targetGroup ? `Grup ${ann.targetGroup}` : '';
      const metaParts = [statusLabel, targetProgLabel];
      if (targetGroupLabel) metaParts.push(targetGroupLabel);
      if (ann.publishAtMs && Number(ann.publishAtMs) > Date.now()) {
        metaParts.push(`🗓 ${formatShortDateTime(Number(ann.publishAtMs))}`);
      }
      if (ann.expiresAtMs && Number(ann.expiresAtMs) > 0) {
        const isExpired = Number(ann.expiresAtMs) <= Date.now();
        metaParts.push(
          isExpired
            ? (state.lang === 'en' ? 'Expired' : 'Süresi Doldu')
            : `⏱ ${formatShortDateTime(Number(ann.expiresAtMs))}`
        );
      }

      const readCount = getAnnouncementReadCount(ann.id);
      const readLabel = state.lang === 'en' ? `${readCount} views` : `${readCount} okunma`;

      const header = document.createElement('div');
      header.className = 'flex items-start justify-between gap-2';
      header.innerHTML = `
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${toneBadgeCls}">${escapeHtml(toneLabel)}</span>
            <span data-ann-read-count="${escapeHtml(ann.id)}" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0" title="${state.lang === 'en' ? 'Unique student views' : 'Tekil öğrenci görüntülenmesi'}">
              <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
              <span>${escapeHtml(readLabel)}</span>
            </span>
            <span class="text-[11px] font-medium ${ann.active ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'}">${escapeHtml(metaParts.join(' · '))}</span>
          </div>
          <h5 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug">${escapeHtml(ann.title)}</h5>
        </div>
      `;
      const msg = document.createElement('p');
      msg.className = 'text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line';
      msg.textContent = ann.message;

      const actions = document.createElement('div');
      actions.className = 'flex items-center justify-end gap-1.5 flex-wrap pt-1';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'ios-press min-h-[34px] px-3 py-1 rounded-full ios-pill-control hover:bg-slate-500/15 text-xs font-semibold text-slate-700 dark:text-slate-200 transition';
      toggleBtn.textContent = ann.active ? loc.adminAnnHideAction : loc.adminAnnShowAction;
      toggleBtn.addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        try {
          await api.saveAnnouncement({ ...ann, active: !ann.active }, secret === 'active' ? undefined : secret);
          await refreshAdminCloudData('announcements');
          await refreshDailyAnnouncements(true);
          showToast(loc.adminAnnSavedToast);
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          console.warn('Announcement toggle error:', err);
          showToast(loc.adminSaveErrorToast);
        }
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'ios-press min-h-[34px] px-3 py-1 rounded-full bg-blue-500/15 hover:bg-blue-500/25 text-blue-600 dark:text-blue-300 text-xs font-semibold transition';
      editBtn.textContent = loc.adminAnnEditAction;
      editBtn.addEventListener('click', () => {
        adminState.editingAnnId = ann.id;
        adminState.annTone = ann.tone;
        adminState.annActive = ann.active;
        adminState.annTargetGroup = ann.targetGroup || '';
        adminState.annTargetProg = ann.targetProg || '';
        adminState.annExpiresAtMs = Number(ann.expiresAtMs) || 0;
        adminState.annPublishAtMs = Number(ann.publishAtMs) || 0;
        document.getElementById('adminAnnTitleInput').value = ann.title;
        document.getElementById('adminAnnMsgInput').value = ann.message;
        const expInp = document.getElementById('adminAnnExpiresInput');
        if (expInp) expInp.value = formatDateTimeLocalInput(adminState.annExpiresAtMs);
        const pubInp = document.getElementById('adminAnnPublishAtInput');
        if (pubInp) pubInp.value = formatDateTimeLocalInput(adminState.annPublishAtMs);
        syncAdminAnnPublishAtDisplay();
        if (ann.targetGroup || ann.targetProg || adminState.annExpiresAtMs > 0 || adminState.annPublishAtMs > 0) {
          setAdminAnnTargetOpen(true);
        }
        syncAdminAnnFormUI();
        const formEl = document.getElementById('adminAnnForm');
        if (formEl && typeof formEl.scrollIntoView === 'function') {
          formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      const isConfirming = adminState.deleteConfirmAnnId === ann.id;
      delBtn.className = isConfirming
        ? 'ios-press min-h-[34px] px-3 py-1 rounded-full bg-rose-600 text-white text-xs font-bold'
        : 'ios-press min-h-[34px] px-3 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold transition';
      delBtn.textContent = isConfirming ? loc.adminAnnConfirmDeleteAction : loc.adminAnnDeleteAction;
      delBtn.addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        if (adminState.deleteConfirmAnnId !== ann.id) {
          adminState.deleteConfirmAnnId = ann.id;
          renderAdminAnnouncementsList(false);
          return;
        }
        adminState.deleteConfirmAnnId = '';
        delBtn.disabled = true;
        row.classList.add('admin-row-exit');
        try {
          await api.deleteAnnouncement(ann.id, secret === 'active' ? undefined : secret);
          void deleteAnnouncementReadStat(ann.id);
          adminState.announcements = (adminState.announcements || []).filter((a) => a.id !== ann.id);
          activeAnnouncementsList = (activeAnnouncementsList || []).filter((a) => a.id !== ann.id);
          renderAdminAnnouncementsList(false);
          runWithStaggerSuppressed(() => renderDailyAnnouncements());
          pushAdminHistory({
            label: state.lang === 'en' ? 'Announcement deleted' : 'Duyuru silindi',
            sub: ann.title,
            undoType: 'ann_delete',
            undoData: { ...ann }
          });
          await refreshAdminCloudData('announcements');
          await refreshDailyAnnouncements(true);
          showToast(loc.adminAnnDeletedToast);
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          delBtn.disabled = false;
          row.classList.remove('admin-row-exit');
          console.warn('Announcement delete error:', err);
          showToast(loc.adminSaveErrorToast);
        }
      });

      actions.appendChild(toggleBtn);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      row.appendChild(header);
      row.appendChild(msg);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function openStudentEditorInAdmin(item) {
    if (!item) return;
    const effLang = item.lang === 'en' ? 'en' : item.prog === 'en' ? 'en' : 'tr';
    adminState.editingStudent = {
      ...item,
      myMbuGroup: item.myMbuGroup || '',
      myLabGroup: item.myLabGroup || '',
      otherGroupMode: item.otherGroupMode === 'hide' ? 'hide' : 'dim',
      lang: effLang,
      active: item.active !== false
    };
    adminState.deleteConfirmStudentHash = '';
    syncAdminStudentEditorUI(true);
    const card = document.getElementById('adminStudentEditorCard');
    if (card && typeof card.scrollIntoView === 'function') {
      requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  }

  function syncAdminStudentEditorUI(animateOpen = false) {
    const card = document.getElementById('adminStudentEditorCard');
    if (!card) return;
    const loc = I18N[state.lang];
    const item = adminState.editingStudent;
    if (!item) {
      card.classList.add('hidden');
      card.classList.remove('admin-card-reveal');
      return;
    }
    const isEnglish = item.lang === 'en';

    card.classList.remove('hidden');
    if (animateOpen) {
      card.classList.remove('admin-card-reveal');
      void card.offsetWidth;
      card.classList.add('admin-card-reveal');
    }

    const badgeEl = document.getElementById('adminEditStudentBadge');
    const titleEl = document.getElementById('adminEditStudentTitle');
    const nameInp = document.getElementById('adminEditNameInput');
    const activeToggle = document.getElementById('btnAdminEditActiveToggle');
    const delBtn = document.getElementById('btnAdminDeleteCustomStudent');
    const editLabSec = document.getElementById('adminEditLabSection');

    const srcLabel = item.source === 'custom'
      ? (state.lang === 'en' ? 'Custom' : 'Özel Kayıt')
      : (state.lang === 'en' ? 'Term I' : 'Dönem I');
    const idLabel = item.studentId ? item.studentId : `•••••••${item.last4 || '••••'}`;
    if (badgeEl) badgeEl.textContent = `${srcLabel} • ${idLabel}`;
    if (titleEl) titleEl.textContent = item.fullName || `Öğrenci ${idLabel}`;
    if (nameInp) nameInp.value = item.fullName || '';

    document.querySelectorAll('[data-edit-mbu]').forEach((b) => {
      b.classList.toggle('group-chip-active', (b.getAttribute('data-edit-mbu') || '') === item.myMbuGroup);
    });
    document.querySelectorAll('[data-edit-lab]').forEach((b) => {
      b.classList.toggle('group-chip-active', (b.getAttribute('data-edit-lab') || '') === item.myLabGroup);
      b.disabled = isEnglish;
      b.tabIndex = isEnglish ? -1 : 0;
    });
    if (editLabSec) {
      editLabSec.classList.toggle('is-collapsed', isEnglish);
      editLabSec.setAttribute('aria-hidden', isEnglish ? 'true' : 'false');
    }
    document.querySelectorAll('[data-edit-mode]').forEach((b) => {
      b.classList.toggle('group-chip-active', b.getAttribute('data-edit-mode') === item.otherGroupMode);
    });
    document.querySelectorAll('[data-edit-lang]').forEach((b) => {
      b.classList.toggle('group-chip-active', b.getAttribute('data-edit-lang') === item.lang);
    });

    const api = window.__INONU_AUTH__;
    const isSelfAdmin = Boolean(
      item.authHash &&
      api &&
      typeof api.isAdminStudentHash === 'function' &&
      api.isAdminStudentHash(item.authHash)
    );
    if (isSelfAdmin) {
      item.active = true;
    }

    if (activeToggle) {
      activeToggle.textContent = item.active ? loc.adminEditActiveText : loc.adminEditInactiveText;
      activeToggle.disabled = isSelfAdmin;
      activeToggle.className = item.active
        ? `ios-press min-h-[44px] px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300${isSelfAdmin ? ' opacity-60 cursor-not-allowed' : ''}`
        : 'ios-press min-h-[44px] px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400';
    }
    if (delBtn) {
      const canDelete = Boolean(item.authHash && !isSelfAdmin);
      delBtn.classList.toggle('hidden', !canDelete);
      delBtn.textContent = adminState.deleteConfirmStudentHash === item.authHash ? loc.adminAnnConfirmDeleteAction : loc.adminEditDeleteBtn;
    }
  }

  function renderAdminStudentsList() {
    const listEl = document.getElementById('adminStudentsList');
    const countEl = document.getElementById('adminStudentsCountLabel');
    const filterInp = document.getElementById('adminStudentFilterInput');
    if (!listEl) return;
    const loc = I18N[state.lang];

    document.querySelectorAll('[data-filter-sgroup]').forEach((b) => {
      b.classList.toggle('group-chip-active', (b.getAttribute('data-filter-sgroup') || '') === adminState.studentFilterGroup);
    });

    const allStudents = adminState.students || [];
    const rawQuery = (filterInp ? filterInp.value : '').trim();
    const clearStudentBtn = document.getElementById('btnClearAdminStudentFilter');
    if (clearStudentBtn) {
      clearStudentBtn.classList.toggle('hidden', rawQuery.length === 0);
    }
    const q = rawQuery.toLocaleLowerCase('tr-TR');
    const filtered = allStudents.filter((st) => {
      const effGroup = st.myMbuGroup || st.group || '';
      if (adminState.studentFilterGroup && effGroup !== adminState.studentFilterGroup) return false;
      if (!q) return true;
      const hay = `${st.fullName} ${st.studentId || ''} ${st.last4} ${effGroup} ${st.lang} ${st.source}`.toLocaleLowerCase('tr-TR');
      return hay.includes(q);
    });

    if (countEl) {
      countEl.textContent = loc.adminStudentsCountLabel(filtered.length, allStudents.length);
    }

    listEl.innerHTML = '';
    if (filtered.length === 0) {
      const emptyWrap = document.createElement('div');
      emptyWrap.className = 'ios-pill-control rounded-2xl p-5 text-center space-y-2.5 admin-card-reveal';
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'text-xs text-slate-500 dark:text-slate-400';
      emptyMsg.textContent = loc.adminStudentsEmpty;
      emptyWrap.appendChild(emptyMsg);

      const cleanNumeric = rawQuery.replace(/\D+/g, '');
      if (/^01\d{9}$/.test(cleanNumeric) && typeof loc.adminStudentsLookupFallbackBtn === 'function') {
        const fallbackBtn = document.createElement('button');
        fallbackBtn.type = 'button';
        fallbackBtn.className = 'ios-press min-h-[40px] px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition';
        fallbackBtn.textContent = loc.adminStudentsLookupFallbackBtn(cleanNumeric);
        fallbackBtn.addEventListener('click', async () => {
          const api = window.__INONU_AUTH__;
          if (!api || typeof api.lookupStudentForAdmin !== 'function') return;
          fallbackBtn.disabled = true;
          try {
            const found = await api.lookupStudentForAdmin(cleanNumeric);
            if (!found) {
              showToast(loc.adminStudentNotFound);
              return;
            }
            openStudentEditorInAdmin(found);
          } finally {
            fallbackBtn.disabled = false;
          }
        });
        emptyWrap.appendChild(fallbackBtn);
      }
      listEl.appendChild(emptyWrap);
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach((st, idx) => {
      const card = document.createElement('div');
      card.className = idx < 18
        ? 'ios-pill-control rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2.5 flex-wrap admin-stagger-item'
        : 'ios-pill-control rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2.5 flex-wrap';
      if (idx < 18) {
        card.style.setProperty('--admin-delay', `${Math.min(idx, 10) * 18}ms`);
      }
      const effGroup = st.myMbuGroup || st.group || loc.groupAllLabel;
      const effLang = (st.lang || st.prog || 'tr').toUpperCase();
      const effLab = effLang === 'EN'
        ? ''
        : (st.myLabGroup ? `LAB ${st.myLabGroup}` : `LAB ${loc.groupAllLabel}`);
      const effMode = st.otherGroupMode === 'hide' ? loc.otherModeHide : loc.otherModeDim;
      const groupWord = state.lang === 'en' ? 'Group' : 'Grup';
      const customBadgeText = state.lang === 'en' ? 'Custom' : 'Özel';
      const allowBadgeText = state.lang === 'en' ? 'Term I' : 'Dönem I';
      const inactiveText = state.lang === 'en' ? 'Inactive' : 'Pasif';

      const srcLabel = st.source === 'custom' ? customBadgeText : allowBadgeText;
      const sidDisplay = st.studentId ? st.studentId : `•••••••${st.last4}`;
      const metaParts = [
        `<span class="font-mono font-semibold text-slate-700 dark:text-slate-200">${escapeHtml(sidDisplay)}</span>`,
        `${escapeHtml(groupWord)} ${escapeHtml(effGroup)}`,
      ];
      if (effLab) metaParts.push(escapeHtml(effLab));
      metaParts.push(escapeHtml(effLang), escapeHtml(effMode));
      if (st.active === false) {
        metaParts.push(`<span class="font-semibold text-rose-600 dark:text-rose-400">${escapeHtml(inactiveText)}</span>`);
      }

      const badgeCls = st.source === 'custom'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : 'bg-blue-500/12 text-blue-600 dark:text-blue-300';

      const left = document.createElement('div');
      left.className = 'min-w-0 flex-1 space-y-0.5';
      left.innerHTML = `
        <div class="flex items-center gap-1.5 min-w-0">
          <p class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(st.fullName)}</p>
          <span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold shrink-0 ${badgeCls}">${escapeHtml(srcLabel)}</span>
        </div>
        <p class="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums truncate">${metaParts.join(' · ')}</p>
      `;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'ios-press min-h-[34px] px-3.5 py-1 rounded-full bg-blue-500/15 hover:bg-blue-500/25 text-blue-600 dark:text-blue-300 text-xs font-semibold shrink-0 transition';
      editBtn.textContent = loc.adminAnnEditAction;
      editBtn.addEventListener('click', () => openStudentEditorInAdmin(st));

      card.appendChild(left);
      card.appendChild(editBtn);
      frag.appendChild(card);
    });
    listEl.appendChild(frag);
  }

  const adminCloudDirty = {
    announcements: true,
    materials: true,
    cancellations: true,
    students: true
  };

  function getAdminCancelScheduleDays(progOverride) {
    const p = progOverride || adminState.cancelProg || state.lang || 'tr';
    return p === 'en' ? SCHEDULE_DAYS_EN : SCHEDULE_DAYS_TR;
  }

  function toggleAdminCancelDatePicker(forceOpen) {
    const datePanel = document.getElementById('adminCancelDatePickerPanel');
    const dateBtn = document.getElementById('btnAdminCancelDateTrigger');
    if (!datePanel || !dateBtn) return;
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : datePanel.classList.contains('hidden');
    datePanel.classList.toggle('hidden', !nextOpen);
    dateBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    const arrow = dateBtn.querySelector('.admin-picker-chevron') || dateBtn.querySelector('svg:last-child');
    if (arrow) arrow.style.transform = nextOpen ? 'rotate(180deg)' : '';
    if (nextOpen) {
      datePanel.classList.remove('admin-dropdown-enter');
      void datePanel.offsetWidth;
      datePanel.classList.add('admin-dropdown-enter');
      renderAdminCancelDateOptions(document.getElementById('adminCancelDateSearch')?.value || '', true);
      const listEl = document.getElementById('adminCancelDateOptions');
      if (listEl) listEl.scrollTop = 0;
    }
  }

  function setAdminCancelSelectedDate(dateStr, animDir = 'none') {
    const dateInp = document.getElementById('adminCancelDateSelect');
    const dateLbl = document.getElementById('adminCancelDateLabel');
    const days = getAdminCancelScheduleDays();
    const match = days.find((d) => d.date === dateStr) || days[0];
    const finalDate = match ? match.date : (dateStr || '');
    adminState.cancelDate = finalDate;
    if (dateInp) dateInp.value = finalDate;
    if (dateLbl) {
      dateLbl.textContent = match
        ? `${match.date} • ${match.dayName}`
        : (finalDate || (state.lang === 'en' ? 'Select date...' : 'Tarih seç...'));
      if (animDir === 'next' || animDir === 'prev') {
        dateLbl.classList.remove('food-cal-label-next', 'food-cal-label-prev');
        void dateLbl.offsetWidth;
        dateLbl.classList.add(animDir === 'next' ? 'food-cal-label-next' : 'food-cal-label-prev');
      }
    }
  }

  function stepAdminCancelDate(delta) {
    const days = getAdminCancelScheduleDays();
    if (!days || days.length === 0) return;
    const curIdx = days.findIndex((d) => d.date === adminState.cancelDate);
    const safeIdx = curIdx >= 0 ? curIdx : 0;
    const nextIdx = (safeIdx + delta + days.length) % days.length;
    const nextDay = days[nextIdx];
    if (!nextDay) return;
    const dir = delta >= 0 ? 'next' : 'prev';
    toggleAdminCancelDatePicker(false);
    setAdminCancelSelectedDate(nextDay.date, dir);
    renderAdminCancelDaySlots(dir);
  }

  function renderAdminCancelDateOptions(query = '', forceRender = false) {
    const datePanel = document.getElementById('adminCancelDatePickerPanel');
    if (!forceRender && datePanel && datePanel.classList.contains('hidden')) return;
    const listEl = document.getElementById('adminCancelDateOptions');
    if (!listEl) return;
    const days = getAdminCancelScheduleDays();
    const curVal = adminState.cancelDate || '';
    const norm = String(query || '').trim().toLocaleLowerCase('tr-TR');
    const todayStr = getBestDefaultDate();

    let orderedDays = days;
    if (!norm) {
      const todayIdx = days.findIndex((d) => d.date === todayStr);
      if (todayIdx > 0) {
        orderedDays = [...days.slice(todayIdx), ...days.slice(0, todayIdx)];
      }
    }

    const filtered = norm
      ? orderedDays.filter((d) => {
          const hay = `${d.date} ${d.dayName} K${d.kurulNo} H${d.haftaNo} W${d.haftaNo} ${formatDateLong(d.date)}`.toLocaleLowerCase('tr-TR');
          return hay.includes(norm);
        })
      : orderedDays;

    listEl.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-[11px] text-slate-500 dark:text-slate-400 text-center py-3';
      empty.textContent = I18N[state.lang].searchNoResults;
      listEl.appendChild(empty);
      return;
    }

    const todayTag = state.lang === 'en' ? 'Today' : 'Bugün';
    const frag = document.createDocumentFragment();
    filtered.forEach((d) => {
      const isSel = d.date === curVal;
      const isTodayDate = d.date === todayStr;
      const cancelCount = (d.slots || []).reduce((acc, s) => acc + (getCancelledLessonInfo(s, adminState.cancelProg) ? 1 : 0), 0);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ios-press w-full text-left px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 transition ${
        isSel
          ? 'bg-rose-600 text-white shadow-xs'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-500/12'
      }`;
      btn.innerHTML = `
        <span class="truncate tabular-nums flex items-center gap-1.5 min-w-0">
          <span class="truncate">${escapeHtml(d.date)} • ${escapeHtml(d.dayName)}</span>
          ${isTodayDate ? `<span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold shrink-0 ${isSel ? 'bg-white/20 text-white' : 'bg-blue-500/15 text-blue-600 dark:text-blue-300'}">${todayTag}</span>` : ''}
          ${cancelCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold shrink-0 ${isSel ? 'bg-white/25 text-white' : 'bg-rose-500/15 text-rose-600 dark:text-rose-300'}">${cancelCount} iptal</span>` : ''}
        </span>
        <span class="text-[10px] font-bold shrink-0 ${isSel ? 'text-white/85' : 'text-slate-400 dark:text-slate-500'}">K${d.kurulNo}•${adminState.cancelProg === 'en' ? 'W' : 'H'}${d.haftaNo}</span>
      `;
      btn.addEventListener('click', () => {
        const oldIdx = days.findIndex((x) => x.date === adminState.cancelDate);
        const newIdx = days.findIndex((x) => x.date === d.date);
        const dir = oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx ? (newIdx > oldIdx ? 'next' : 'prev') : 'next';
        setAdminCancelSelectedDate(d.date, dir);
        toggleAdminCancelDatePicker(false);
        renderAdminCancelDaySlots(dir);
      });
      frag.appendChild(btn);
    });
    listEl.appendChild(frag);
    if (!norm) listEl.scrollTop = 0;
  }

  function syncAdminCancelFormDefaults(animateSeg = true) {
    syncAdminSegmentedControl('adminCancelProgChips', 'adminCancelProgIndicator', 'data-cancel-prog', adminState.cancelProg === 'en' ? 'en' : 'tr', animateSeg);
    const days = getAdminCancelScheduleDays();
    const preferred = (adminState.cancelDate && days.some((d) => d.date === adminState.cancelDate))
      ? adminState.cancelDate
      : ((state.selectedDate && days.some((d) => d.date === state.selectedDate))
          ? state.selectedDate
          : (days[0] ? days[0].date : ''));
    setAdminCancelSelectedDate(preferred, 'none');
  }

  function renderAdminCancelDaySlots(slideDir = 'none') {
    const listEl = document.getElementById('adminCancelDaySlotsList');
    const countEl = document.getElementById('adminCancelDaySlotCount');
    if (!listEl) return;
    const isEn = state.lang === 'en';
    const prog = adminState.cancelProg === 'en' ? 'en' : 'tr';
    const days = getAdminCancelScheduleDays(prog);
    const dayObj = days.find((d) => d.date === adminState.cancelDate) || days[0];

    listEl.classList.remove('admin-slide-next', 'admin-slide-prev');
    listEl.innerHTML = '';

    if (slideDir === 'next' || slideDir === 'prev') {
      void listEl.offsetWidth;
      listEl.classList.add(slideDir === 'next' ? 'admin-slide-next' : 'admin-slide-prev');
    }

    if (!dayObj || !Array.isArray(dayObj.slots) || dayObj.slots.length === 0) {
      if (countEl) countEl.textContent = '';
      const allDayBtnEmpty = document.getElementById('btnAdminCancelAllDay');
      if (allDayBtnEmpty) allDayBtnEmpty.classList.add('hidden');
      listEl.innerHTML = `<div class="ios-pill-control rounded-2xl p-4 text-center text-xs text-slate-500 dark:text-slate-400 admin-card-reveal">${isEn ? 'No lessons on this date.' : 'Bu tarihte ders bulunamadı.'}</div>`;
      return;
    }

    const cancelledInDay = dayObj.slots.filter((s) => Boolean(getCancelledLessonInfo(s, prog))).length;
    if (countEl) {
      countEl.textContent = cancelledInDay > 0
        ? (isEn ? `${dayObj.slots.length} lessons · ${cancelledInDay} cancelled` : `${dayObj.slots.length} ders · ${cancelledInDay} iptal`)
        : (isEn ? `${dayObj.slots.length} lessons` : `${dayObj.slots.length} ders`);
    }
    const allDayBtn = document.getElementById('btnAdminCancelAllDay');
    if (allDayBtn) {
      const allCancelled = cancelledInDay >= dayObj.slots.length && dayObj.slots.length > 0;
      allDayBtn.classList.remove('hidden');
      allDayBtn.textContent = allCancelled
        ? (isEn ? 'Restore Full Day' : 'Tümünü Geri Al')
        : (isEn ? 'Cancel Full Day' : 'Tüm Günü İptal Et');
      allDayBtn.className = allCancelled
        ? 'ios-press min-h-[30px] px-3 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold transition'
        : 'ios-press min-h-[30px] px-3 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 text-[11px] font-bold transition';
    }

    const animKey = adminState.lastCancelAnimKey || '';
    const animType = adminState.lastCancelAnimType || '';

    const frag = document.createDocumentFragment();
    dayObj.slots.forEach((slot, idx) => {
      const cancelInfo = getCancelledLessonInfo(slot, prog);
      const isCancelled = Boolean(cancelInfo);
      const slotAnimKey = `${dayObj.date}_${slot.slotNo}_${prog}`;
      const isJustChanged = Boolean(animKey && animKey === slotAnimKey);

      const row = document.createElement('div');
      let animCls = 'admin-stagger-item';
      if (isJustChanged) {
        animCls = animType === 'cancel' ? 'admin-cancel-pop' : 'admin-restore-pop';
      } else if (animKey) {
        animCls = '';
      }
      row.className = `ios-pill-control rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2.5 transition-all duration-200 ${isCancelled ? 'slot-card-cancelled' : ''} ${animCls}`;
      if (animCls === 'admin-stagger-item') {
        row.style.setProperty('--admin-delay', `${Math.min(idx, 10) * 28}ms`);
      }

      const info = document.createElement('div');
      info.className = 'min-w-0 flex-1 space-y-0.5';
      const meta = document.createElement('div');
      meta.className = 'flex items-center gap-1.5 flex-wrap text-[10.5px] font-bold text-slate-500 dark:text-slate-400 tabular-nums';
      meta.innerHTML = `<span>${slot.slotNo}. ${isEn ? 'Hour' : 'Ders'}${slot.time ? ` · ${escapeHtml(slot.time)}` : ''}${slot.group ? ` · ${escapeHtml(slot.group.toUpperCase())}` : ''}</span>${isCancelled ? `<span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-300">${isEn ? 'CANCELLED' : 'İPTAL'}</span>` : ''}`;
      const title = document.createElement('div');
      title.className = `text-xs sm:text-[13px] font-bold leading-snug transition-opacity ${isCancelled ? 'line-through opacity-75 text-slate-600 dark:text-slate-300' : 'text-slate-900 dark:text-white'}`;
      title.textContent = slot.title;
      info.appendChild(meta);
      info.appendChild(title);
      if (slot.instructor) {
        const inst = document.createElement('div');
        inst.className = 'text-[11px] text-slate-500 dark:text-slate-400 truncate';
        inst.textContent = slot.instructor;
        info.appendChild(inst);
      }
      if (isCancelled && cancelInfo.reason) {
        const rEl = document.createElement('div');
        rEl.className = 'text-[11px] font-semibold text-rose-600 dark:text-rose-300';
        rEl.textContent = cancelInfo.reason;
        info.appendChild(rEl);
      }

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = isCancelled
        ? 'ios-press min-h-[36px] px-3.5 py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs font-bold shrink-0 transition'
        : 'ios-press min-h-[36px] px-3.5 py-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 text-xs font-bold shrink-0 transition';
      actionBtn.textContent = isCancelled
        ? (isEn ? 'Restore' : 'Geri Al')
        : (isEn ? 'Cancel' : 'İptal Et');

      actionBtn.addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        actionBtn.disabled = true;
        try {
          if (isCancelled && cancelInfo) {
            adminState.lastCancelAnimKey = slotAnimKey;
            adminState.lastCancelAnimType = 'restore';
            await api.deleteCancelledLesson(cancelInfo.id, secret === 'active' ? undefined : secret);
            const nextList = cancelledLessonsList.filter((x) => x.id !== cancelInfo.id);
            applyLoadedCancelledLessonsList(nextList);
            pushAdminHistory({
              label: isEn ? 'Lesson restored' : 'Ders geri alındı',
              sub: `${slot.title} (${dayObj.date} · ${slot.slotNo}.)`,
              undoType: 'restore_slot',
              undoData: { date: dayObj.date, slotNo: slot.slotNo, targetProg: prog, reason: cancelInfo.reason || '' }
            });
            showToast(isEn ? 'Lesson restored.' : 'Ders iptali kaldırıldı.');
          } else {
            adminState.lastCancelAnimKey = slotAnimKey;
            adminState.lastCancelAnimType = 'cancel';
            const reasonVal = (document.getElementById('adminCancelReasonInput')?.value || '').trim();
            const saved = await api.saveCancelledLesson({
              date: dayObj.date,
              slotNo: slot.slotNo,
              targetProg: prog,
              reason: reasonVal
            }, secret === 'active' ? undefined : secret);
            const nextList = [...cancelledLessonsList.filter((x) => x.id !== saved.id), saved];
            applyLoadedCancelledLessonsList(nextList);
            pushAdminHistory({
              label: isEn ? 'Lesson cancelled' : 'Ders iptal edildi',
              sub: `${slot.title} (${dayObj.date} · ${slot.slotNo}.)`,
              undoType: 'cancel_slot',
              undoData: { id: saved.id }
            });
            showToast(isEn ? 'Lesson marked as cancelled.' : 'Ders iptal edildi.');
          }
          setTimeout(() => {
            if (adminState.lastCancelAnimKey === slotAnimKey) {
              adminState.lastCancelAnimKey = '';
              adminState.lastCancelAnimType = '';
            }
          }, 520);
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          adminState.lastCancelAnimKey = '';
          adminState.lastCancelAnimType = '';
          console.warn('Toggle cancel lesson error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        } finally {
          actionBtn.disabled = false;
        }
      });

      row.appendChild(info);
      row.appendChild(actionBtn);
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
  }

  function renderAdminCancelledList(animateSeg = true) {
    const listEl = document.getElementById('adminCancelledList');
    const badgeEl = document.getElementById('adminCancelledCountBadge');
    if (!listEl) return;
    const isEn = state.lang === 'en';
    const filterProg = adminState.cancelListFilterProg || '';
    syncAdminSegmentedControl('adminCancelledListFilterChips', 'adminCancelledListFilterIndicator', 'data-cancel-list-filter', filterProg, animateSeg);

    const source = Array.isArray(adminState.cancelledLessons) && adminState.cancelledLessons.length > 0
      ? adminState.cancelledLessons
      : (cancelledLessonsList || []);
    const filtered = source.filter((item) => !filterProg || item.targetProg === filterProg);

    if (badgeEl) {
      badgeEl.textContent = String(filtered.length);
      badgeEl.classList.toggle('hidden', filtered.length === 0);
    }

    listEl.innerHTML = '';
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="ios-pill-control rounded-2xl p-5 text-center text-xs text-slate-500 dark:text-slate-400 admin-card-reveal">${isEn ? 'No cancelled lessons.' : 'İptal edilmiş ders bulunmuyor.'}</div>`;
      return;
    }

    const animKey = adminState.lastCancelAnimKey || '';
    const animType = adminState.lastCancelAnimType || '';

    const frag = document.createDocumentFragment();
    filtered.forEach((item, idx) => {
      const days = getAdminCancelScheduleDays(item.targetProg);
      const dayObj = days.find((d) => d.date === item.date);
      const slotObj = dayObj && Array.isArray(dayObj.slots) ? dayObj.slots.find((s) => Number(s.slotNo) === Number(item.slotNo)) : null;
      const itemKey = `${item.date}_${item.slotNo}_${item.targetProg}`;
      const isJustAdded = Boolean(animKey && animType === 'cancel' && animKey === itemKey);

      const row = document.createElement('div');
      row.className = `ios-pill-control slot-card-cancelled rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2.5 ${isJustAdded ? 'admin-cancel-pop' : (animKey ? '' : 'admin-stagger-item')}`;
      if (!isJustAdded && !animKey) {
        row.style.setProperty('--admin-delay', `${Math.min(idx, 10) * 28}ms`);
      }

      const info = document.createElement('div');
      info.className = 'min-w-0 flex-1 space-y-0.5';
      const top = document.createElement('div');
      top.className = 'flex items-center gap-1.5 flex-wrap';
      top.innerHTML = `
        <span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-rose-500/18 text-rose-700 dark:text-rose-300 shrink-0">${escapeHtml(item.targetProg.toUpperCase())}</span>
        <span class="text-[11px] font-bold text-slate-700 dark:text-slate-200 tabular-nums truncate">${escapeHtml(item.date)} · ${item.slotNo}. ${isEn ? 'Hour' : 'Ders'}${slotObj && slotObj.time ? ` (${escapeHtml(slotObj.time)})` : ''}</span>
      `;
      const title = document.createElement('div');
      title.className = 'text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white truncate';
      title.textContent = slotObj ? slotObj.title : `${item.slotNo}. ${isEn ? 'Lesson' : 'Ders'}`;
      info.appendChild(top);
      info.appendChild(title);
      if (item.reason) {
        const reasonEl = document.createElement('div');
        reasonEl.className = 'text-[11px] font-medium text-rose-700 dark:text-rose-300';
        reasonEl.textContent = item.reason;
        info.appendChild(reasonEl);
      }

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'ios-press min-h-[36px] px-3.5 py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs font-bold shrink-0 transition';
      restoreBtn.textContent = isEn ? 'Restore' : 'Geri Al';
      restoreBtn.addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        restoreBtn.disabled = true;
        row.classList.add('admin-row-exit');
        adminState.lastCancelAnimKey = itemKey;
        adminState.lastCancelAnimType = 'restore';
        try {
          await Promise.all([
            api.deleteCancelledLesson(item.id, secret === 'active' ? undefined : secret),
            new Promise((resolve) => setTimeout(resolve, 210))
          ]);
          const nextList = cancelledLessonsList.filter((x) => x.id !== item.id);
          applyLoadedCancelledLessonsList(nextList);
          showToast(isEn ? 'Lesson restored.' : 'Ders iptali kaldırıldı.');
          setTimeout(() => {
            if (adminState.lastCancelAnimKey === itemKey) {
              adminState.lastCancelAnimKey = '';
              adminState.lastCancelAnimType = '';
            }
          }, 520);
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          row.classList.remove('admin-row-exit');
          adminState.lastCancelAnimKey = '';
          adminState.lastCancelAnimType = '';
          console.warn('Restore cancelled lesson error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        } finally {
          restoreBtn.disabled = false;
        }
      });

      row.appendChild(info);
      row.appendChild(restoreBtn);
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
  }

  function getAdminMatScheduleDays(progOverride) {
    const p = progOverride || adminState.matProg || state.lang || 'tr';
    return p === 'en' ? SCHEDULE_DAYS_EN : SCHEDULE_DAYS_TR;
  }

  function toggleAdminMatPicker(which, forceOpen) {
    const datePanel = document.getElementById('adminMatDatePickerPanel');
    const slotPanel = document.getElementById('adminMatSlotPickerPanel');
    const dateBtn = document.getElementById('btnAdminMatDateTrigger');
    const slotBtn = document.getElementById('btnAdminMatSlotTrigger');

    const setState = (panel, btn, open) => {
      if (!panel || !btn) return;
      panel.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      const arrow = btn.querySelector('svg');
      if (arrow) arrow.style.transform = open ? 'rotate(180deg)' : '';
      if (open) {
        panel.classList.remove('admin-dropdown-enter');
        void panel.offsetWidth;
        panel.classList.add('admin-dropdown-enter');
      }
    };

    if (!which) {
      setState(datePanel, dateBtn, false);
      setState(slotPanel, slotBtn, false);
      return;
    }

    if (which === 'date') {
      const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : (datePanel ? datePanel.classList.contains('hidden') : false);
      setState(slotPanel, slotBtn, false);
      setState(datePanel, dateBtn, nextOpen);
      if (nextOpen) {
        renderAdminMatDateOptions(document.getElementById('adminMatDateSearch')?.value || '', true);
        const listEl = document.getElementById('adminMatDateOptions');
        if (listEl) listEl.scrollTop = 0;
      }
      return;
    }

    if (which === 'slot') {
      const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : (slotPanel ? slotPanel.classList.contains('hidden') : false);
      setState(datePanel, dateBtn, false);
      setState(slotPanel, slotBtn, nextOpen);
      if (nextOpen) {
        populateAdminMatSlotSelect(
          document.getElementById('adminMatDateSelect')?.value || '',
          document.getElementById('adminMatSlotSelect')?.value || '1',
          true
        );
      }
    }
  }

  function setAdminMatSelectedDate(dateStr) {
    const dateInp = document.getElementById('adminMatDateSelect');
    const dateLbl = document.getElementById('adminMatDateLabel');
    const days = getAdminMatScheduleDays();
    const match = days.find((d) => d.date === dateStr);
    if (dateInp) dateInp.value = dateStr || '';
    if (dateLbl) {
      dateLbl.textContent = match ? `${match.date} • ${match.dayName}` : (dateStr || (state.lang === 'en' ? 'Select date...' : 'Tarih seç...'));
    }
  }

  function renderAdminMatDateOptions(query = '', forceRender = false) {
    const datePanel = document.getElementById('adminMatDatePickerPanel');
    if (!forceRender && datePanel && datePanel.classList.contains('hidden')) return;
    const listEl = document.getElementById('adminMatDateOptions');
    const dateInp = document.getElementById('adminMatDateSelect');
    if (!listEl) return;
    const days = getAdminMatScheduleDays();
    const curVal = dateInp ? dateInp.value : '';
    const norm = String(query || '').trim().toLocaleLowerCase('tr-TR');
    const todayStr = getBestDefaultDate();

    let orderedDays = days;
    if (!norm) {
      const todayIdx = days.findIndex((d) => d.date === todayStr);
      if (todayIdx > 0) {
        orderedDays = [...days.slice(todayIdx), ...days.slice(0, todayIdx)];
      }
    }

    const filtered = norm
      ? orderedDays.filter((d) => {
          const hay = `${d.date} ${d.dayName} K${d.kurulNo} H${d.haftaNo} W${d.haftaNo} ${formatDateLong(d.date)}`.toLocaleLowerCase('tr-TR');
          return hay.includes(norm);
        })
      : orderedDays;

    listEl.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-[11px] text-slate-500 dark:text-slate-400 text-center py-3';
      empty.textContent = I18N[state.lang].searchNoResults;
      listEl.appendChild(empty);
      return;
    }

    const todayTag = state.lang === 'en' ? 'Today' : 'Bugün';
    const frag = document.createDocumentFragment();
    filtered.forEach((d) => {
      const isSel = d.date === curVal;
      const isTodayDate = d.date === todayStr;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ios-press w-full text-left px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 transition ${
        isSel
          ? 'bg-blue-600 text-white shadow-xs'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-500/12'
      }`;
      btn.innerHTML = `
        <span class="truncate tabular-nums flex items-center gap-1.5 min-w-0">
          <span class="truncate">${escapeHtml(d.date)} • ${escapeHtml(d.dayName)}</span>
          ${isTodayDate ? `<span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold shrink-0 ${isSel ? 'bg-white/20 text-white' : 'bg-blue-500/15 text-blue-600 dark:text-blue-300'}">${todayTag}</span>` : ''}
        </span>
        <span class="text-[10px] font-bold shrink-0 ${isSel ? 'text-white/85' : 'text-slate-400 dark:text-slate-500'}">K${d.kurulNo}•${adminState.matProg === 'en' ? 'W' : 'H'}${d.haftaNo}</span>
      `;
      btn.addEventListener('click', () => {
        setAdminMatSelectedDate(d.date);
        populateAdminMatSlotSelect(d.date, '1');
        toggleAdminMatPicker(null, false);
      });
      frag.appendChild(btn);
    });
    listEl.appendChild(frag);
    if (!norm) listEl.scrollTop = 0;
  }

  function populateAdminMatSlotSelect(dateStr, selectedSlotNo, forceRender = false) {
    const slotInp = document.getElementById('adminMatSlotSelect');
    const slotLbl = document.getElementById('adminMatSlotLabel');
    const slotPanel = document.getElementById('adminMatSlotPickerPanel');
    const slotOptsEl = document.getElementById('adminMatSlotOptions');
    const days = getAdminMatScheduleDays();
    const dayObj = days.find((d) => d.date === dateStr) || days[0];
    const slots = dayObj && Array.isArray(dayObj.slots) ? dayObj.slots : [];

    const items = slots.length > 0
      ? slots.map((s) => ({
          value: String(s.slotNo),
          title: String(s.title || ''),
          time: String(s.time || ''),
          label: `${s.slotNo}. Ders (${s.time}) • ${String(s.title || '').slice(0, 46)}`
        }))
      : Array.from({ length: 10 }, (_, idx) => ({
          value: String(idx + 1),
          title: `${idx + 1}. Ders`,
          time: '',
          label: `${idx + 1}. Ders`
        }));

    const targetVal = selectedSlotNo && items.some((x) => x.value === String(selectedSlotNo))
      ? String(selectedSlotNo)
      : (items[0] ? items[0].value : '1');
    const selectedItem = items.find((x) => x.value === targetVal) || items[0];

    if (slotInp) slotInp.value = targetVal;
    if (slotLbl) slotLbl.textContent = selectedItem ? selectedItem.label : `${targetVal}. Ders`;

    if (!slotOptsEl) return;
    if (!forceRender && slotPanel && slotPanel.classList.contains('hidden')) return;

    slotOptsEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const isSel = item.value === targetVal;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ios-press w-full text-left px-3 py-2 rounded-xl text-xs transition flex items-start justify-between gap-2 ${
        isSel
          ? 'bg-blue-600 text-white shadow-xs'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-500/12'
      }`;
      btn.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="font-bold tabular-nums">${escapeHtml(item.value)}. Ders ${item.time ? `<span class="opacity-80 font-semibold">(${escapeHtml(item.time)})</span>` : ''}</div>
          ${item.title && item.title !== `${item.value}. Ders` ? `<div class="text-[11px] truncate ${isSel ? 'text-white/90' : 'text-slate-500 dark:text-slate-400'}">${escapeHtml(item.title)}</div>` : ''}
        </div>
        ${isSel ? '<span class="text-xs font-bold shrink-0">✓</span>' : ''}
      `;
      btn.addEventListener('click', () => {
        populateAdminMatSlotSelect(dateStr, item.value);
        toggleAdminMatPicker(null, false);
      });
      frag.appendChild(btn);
    });
    slotOptsEl.appendChild(frag);
  }

  function setAdminMatUploadProgress(visible, pct = 0, loadedBytes = 0, totalBytes = 0, statusLabel = '') {
    const wrap = document.getElementById('adminMatUploadProgressWrap');
    const bar = document.getElementById('adminMatUploadProgressBar');
    const pctEl = document.getElementById('adminMatUploadPctText');
    const statusEl = document.getElementById('adminMatUploadStatusText');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !visible);
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
    if (statusEl) {
      if (statusLabel) {
        statusEl.textContent = statusLabel;
      } else if (totalBytes > 0) {
        statusEl.textContent = `Yükleniyor (${formatPdfBytesLabel(loadedBytes)} / ${formatPdfBytesLabel(totalBytes)})`;
      } else {
        statusEl.textContent = 'Yükleniyor...';
      }
    }
  }

  function syncAdminMaterialModeUI(animateSeg = true) {
    const isFile = adminState.matMode !== 'url';
    const fileWrap = document.getElementById('adminMatFileWrap');
    const urlWrap = document.getElementById('adminMatUrlWrap');
    const fileLabel = document.getElementById('adminMatFileLabel');
    const heading = document.getElementById('adminMatFormHeading');
    const cancelBtn = document.getElementById('btnAdminMatCancelEdit');
    const submitBtn = document.getElementById('btnAdminMatSubmit');
    syncAdminSegmentedControl('adminMatProgChips', 'adminMatProgIndicator', 'data-mat-prog', adminState.matProg === 'en' ? 'en' : 'tr', animateSeg);
    syncAdminSegmentedControl('adminMatModeBar', 'adminMatModeIndicator', 'data-mat-mode', isFile ? 'file' : 'url', animateSeg);
    if (fileWrap) {
      const wasHidden = fileWrap.classList.contains('hidden');
      fileWrap.classList.toggle('hidden', !isFile);
      if (isFile && wasHidden && animateSeg) {
        fileWrap.classList.remove('admin-card-reveal');
        void fileWrap.offsetWidth;
        fileWrap.classList.add('admin-card-reveal');
      }
    }
    if (urlWrap) {
      const wasHidden = urlWrap.classList.contains('hidden');
      urlWrap.classList.toggle('hidden', isFile);
      if (!isFile && wasHidden && animateSeg) {
        urlWrap.classList.remove('admin-card-reveal');
        void urlWrap.offsetWidth;
        urlWrap.classList.add('admin-card-reveal');
      }
    }
    if (fileLabel) {
      if (adminState.matFileName) {
        const sizeTxt = adminState.matFileSize > 0 ? ` (${formatPdfBytesLabel(adminState.matFileSize)})` : '';
        fileLabel.textContent = `Seçili PDF: ${adminState.matFileName}${sizeTxt}`;
      } else {
        fileLabel.textContent = 'Cihazdan PDF dosyası seç (maks. 250 MB)...';
      }
    }
    if (heading) {
      heading.textContent = adminState.editingMatId ? 'Ders PDF\'ini Güncelle' : 'Ders Notu / PDF Ekle';
    }
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !adminState.editingMatId);
    if (submitBtn) {
      submitBtn.textContent = adminState.editingMatId ? 'PDF Değişikliklerini Kaydet' : 'PDF Materyalini Kaydet';
    }
  }

  function syncAdminMaterialFormDefaults() {
    const dateSel = document.getElementById('adminMatDateSelect');
    if (!dateSel) return;
    if (adminState.matProg !== 'tr' && adminState.matProg !== 'en') {
      adminState.matProg = state.lang === 'en' ? 'en' : 'tr';
    }
    const days = getAdminMatScheduleDays();
    const prevDate = adminState.editingMatId ? dateSel.value : '';
    const targetDate =
      (prevDate && days.some((d) => d.date === prevDate) ? prevDate : '') ||
      (state.selectedDate && days.some((d) => d.date === state.selectedDate) ? state.selectedDate : '') ||
      (dateSel.value && days.some((d) => d.date === dateSel.value) ? dateSel.value : '') ||
      (days[0] ? days[0].date : '');
    setAdminMatSelectedDate(targetDate);
    renderAdminMatDateOptions(document.getElementById('adminMatDateSearch')?.value || '');
    const slotSel = document.getElementById('adminMatSlotSelect');
    populateAdminMatSlotSelect(targetDate, slotSel ? slotSel.value : '1');
    syncAdminMaterialModeUI(false);
  }

  function renderAdminMaterialsList(animateSeg = true) {
    const listEl = document.getElementById('adminMaterialsList');
    if (!listEl) return;
    listEl.innerHTML = '';
    const filterProg = adminState.matListFilterProg || '';
    syncAdminSegmentedControl('adminMatListFilterChips', 'adminMatListFilterIndicator', 'data-mat-list-filter', filterProg, animateSeg);
    const allMats = adminState.materials || [];
    const mats = filterProg
      ? allMats.filter((m) => (m.targetProg || '') === filterProg)
      : allMats;
    if (mats.length === 0) {
      listEl.innerHTML = `<div class="ios-pill-control rounded-2xl p-5 text-center text-xs text-slate-500 dark:text-slate-400 admin-card-reveal">Bu filtre için eklenmiş ders PDF'i yok.</div>`;
      return;
    }
    mats.forEach((mat, idx) => {
      const progDays = mat.targetProg === 'en' ? SCHEDULE_DAYS_EN : (mat.targetProg === 'tr' ? SCHEDULE_DAYS_TR : getScheduleDays());
      const dayMatch = progDays.find((d) => d.date === mat.date);
      const slotMatch = dayMatch && Array.isArray(dayMatch.slots) ? dayMatch.slots.find((s) => s.slotNo === mat.slotNo) : null;
      const lessonInfo = slotMatch ? slotMatch.title : '';
      const isFile = Boolean(mat.pdfData) || Number(mat.chunkCount) > 0 || mat.sourceType === 'chunks' || mat.sourceType === 'file' || mat.sourceType === 'server' || (typeof mat.pdfUrl === 'string' && mat.pdfUrl.startsWith('/api/lesson-pdf/'));
      const sizeLabel = typeof mat.fileSize === 'number' && mat.fileSize > 0 ? formatPdfBytesLabel(mat.fileSize) : '';
      const progText = mat.targetProg === 'en' ? 'EN' : (mat.targetProg === 'tr' ? 'TR' : 'TR/EN');
      const subInfo = isFile
        ? `${mat.pdfName || mat.title || 'ders.pdf'}${sizeLabel ? ` · ${sizeLabel}` : ''}`
        : mat.pdfUrl;

      const row = document.createElement('div');
      row.className = 'ios-pill-control rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2.5 flex-wrap admin-stagger-item';
      row.style.setProperty('--admin-delay', `${Math.min(idx, 10) * 28}ms`);
      row.innerHTML = `
        <div class="min-w-0 flex-1 space-y-0.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold shrink-0 ${isFile ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300' : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300'}">${isFile ? 'PDF' : 'URL'}</span>
            <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">${progText} · ${escapeHtml(mat.date)} · ${mat.slotNo}. Ders</span>
          </div>
          <h5 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(mat.title)}</h5>
          ${lessonInfo ? `<p class="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">${escapeHtml(lessonInfo)}</p>` : ''}
          <p class="text-[11px] text-slate-400 dark:text-slate-500 truncate">${escapeHtml(subInfo)}</p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" class="btn-view-mat ios-press min-h-[34px] px-3 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition">${isFile ? 'İndir' : 'Aç'}</button>
          <button type="button" class="btn-edit-mat ios-press min-h-[34px] px-3 py-1 rounded-full bg-blue-500/15 hover:bg-blue-500/25 text-blue-600 dark:text-blue-300 text-xs font-semibold transition">Düzenle</button>
          <button type="button" class="btn-del-mat ios-press min-h-[34px] px-3 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold transition" data-mat-id="${escapeHtml(mat.id)}">${adminState.deleteConfirmMatId === mat.id ? 'Emin misin?' : 'Sil'}</button>
        </div>
      `;
      row.querySelector('.btn-view-mat').addEventListener('click', () => {
        openOrDownloadLessonMaterial(mat);
      });
      row.querySelector('.btn-edit-mat').addEventListener('click', () => {
        adminState.editingMatId = mat.id;
        adminState.matProg = mat.targetProg === 'en' ? 'en' : 'tr';
        adminState.matMode = isFile ? 'file' : 'url';
        adminState.matFileObj = null;
        adminState.matFileData = mat.pdfData || '';
        adminState.matFileSize = mat.fileSize || 0;
        adminState.matExistingUrl = isFile && mat.pdfUrl ? mat.pdfUrl : '';
        adminState.matExistingChunkCount = Number(mat.chunkCount) || 0;
        adminState.matFileName = mat.pdfName || (isFile ? `${mat.title}.pdf` : '');
        syncAdminMaterialFormDefaults();
        setAdminMatSelectedDate(mat.date);
        renderAdminMatDateOptions(document.getElementById('adminMatDateSearch')?.value || '');
        populateAdminMatSlotSelect(mat.date, mat.slotNo);
        toggleAdminMatPicker(null, false);
        const titleEl = document.getElementById('adminMatTitleInput');
        const urlEl = document.getElementById('adminMatUrlInput');
        if (titleEl) titleEl.value = mat.title || '';
        if (urlEl) urlEl.value = !isFile ? (mat.pdfUrl || '') : '';
        setAdminMatUploadProgress(false);
        syncAdminMaterialModeUI();
        const formEl = document.getElementById('adminMaterialForm');
        if (formEl && typeof formEl.scrollIntoView === 'function') {
          formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      row.querySelector('.btn-del-mat').addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        if (adminState.deleteConfirmMatId !== mat.id) {
          adminState.deleteConfirmMatId = mat.id;
          renderAdminMaterialsList(false);
          return;
        }
        adminState.deleteConfirmMatId = '';
        const prevMats = Array.isArray(adminState.materials) ? [...adminState.materials] : [];
        row.classList.add('admin-row-exit');
        setTimeout(() => {
          adminState.materials = prevMats.filter((m) => m.id !== mat.id);
          applyLoadedLessonMaterialsList(adminState.materials);
          renderAdminMaterialsList(false);
        }, 200);
        showToast('Ders PDF\'i silindi');
        try {
          await api.deleteLessonMaterial(mat.id, secret === 'active' ? undefined : secret);
          void refreshAdminCloudData('materials');
          void refreshLessonMaterials(true);
        } catch (err) {
          adminState.materials = prevMats;
          applyLoadedLessonMaterialsList(prevMats);
          renderAdminMaterialsList(false);
          console.warn('Lesson material delete error:', err);
          showToast('Silme başarısız oldu');
        }
      });
      listEl.appendChild(row);
    });
  }

  async function refreshAdminCloudData(scope = 'all', options = {}) {
    const api = window.__INONU_AUTH__;
    const session = getActiveAuthSession();
    const icon = document.getElementById('iconAdminRefresh');
    if (!api || !session || !session.isAdmin) {
      if (scope === 'all' || scope === 'announcements') renderAdminAnnouncementsList();
      if (scope === 'all' || scope === 'materials') renderAdminMaterialsList();
      if (scope === 'all' || scope === 'cancellations') {
        renderAdminCancelDaySlots();
        renderAdminCancelledList();
      }
      if (scope === 'all' || scope === 'students') renderAdminStudentsList();
      return;
    }
    if (session.adminSecret && typeof api.setAdminWriteSecret === 'function') {
      api.setAdminWriteSecret(session.adminSecret);
    }
    if (options && options.markAllDirty) {
      adminCloudDirty.announcements = true;
      adminCloudDirty.materials = true;
      adminCloudDirty.cancellations = true;
      adminCloudDirty.students = true;
    }
    const wantAnn = scope === 'all' || scope === 'announcements';
    const wantMat = scope === 'all' || scope === 'materials';
    const wantCan = scope === 'all' || scope === 'cancellations';
    const wantStu = scope === 'all' || scope === 'students';
    const wantAccess = scope === 'all' || scope === 'students' || (options && options.includeAccess);

    if (icon) icon.classList.add('animate-spin-ios');
    try {
      const [anns, mats, cancels, exams, students, accessSettings] = await Promise.all([
        wantAnn ? api.listAllAnnouncements().catch((err) => { console.warn('Admin announcements load failed:', err); return null; }) : Promise.resolve(null),
        wantMat ? api.loadAllLessonMaterials().catch((err) => { console.warn('Admin materials load failed:', err); return null; }) : Promise.resolve(null),
        wantCan && typeof api.loadCancelledLessons === 'function'
          ? api.loadCancelledLessons().catch((err) => { console.warn('Admin cancelled lessons load failed:', err); return null; })
          : Promise.resolve(null),
        (scope === 'all' || scope === 'exams') && typeof api.loadExamCountdowns === 'function'
          ? api.loadExamCountdowns().catch(() => null)
          : Promise.resolve(null),
        wantStu ? api.loadAllAdminStudents(session.adminSecret || undefined).catch((err) => { console.warn('Admin students load failed:', err); return null; }) : Promise.resolve(null),
        wantAccess && typeof api.loadSiteAccessSettings === 'function'
          ? api.loadSiteAccessSettings().catch(() => null)
          : Promise.resolve(null)
      ]);
      if (accessSettings && typeof accessSettings === 'object') {
        applySiteAccessSettings(accessSettings);
      }
      if (Array.isArray(anns)) {
        adminState.announcements = anns;
        adminCloudDirty.announcements = false;
        renderAdminAnnouncementsList();
      }
      if (Array.isArray(mats)) {
        adminState.materials = mats;
        adminCloudDirty.materials = false;
        applyLoadedLessonMaterialsList(mats);
        renderAdminMaterialsList();
      }
      if (Array.isArray(cancels)) {
        adminState.cancelledLessons = cancels;
        adminCloudDirty.cancellations = false;
        applyLoadedCancelledLessonsList(cancels);
      }
      if (Array.isArray(exams)) {
        applyLoadedExamCountdownsList(exams);
      }
      if (Array.isArray(students)) {
        adminState.students = students;
        adminCloudDirty.students = false;
        renderAdminStudentsList();
      }
      syncAdminHubSummary();
    } finally {
      if (icon) icon.classList.remove('animate-spin-ios');
    }
  }

  function openAdminModal() {
    const session = getActiveAuthSession();
    if (!session || !session.isAdmin) return;
    if (session.adminSecret && window.__INONU_AUTH__ && typeof window.__INONU_AUTH__.setAdminWriteSecret === 'function') {
      window.__INONU_AUTH__.setAdminWriteSecret(session.adminSecret);
    }
    adminCloudDirty.announcements = true;
    adminCloudDirty.materials = true;
    adminCloudDirty.cancellations = true;
    adminCloudDirty.students = true;
    adminState.cancelProg = state.lang === 'en' ? 'en' : 'tr';
    toggleAdminMatPicker(null, false);
    toggleAdminCancelDatePicker(false);
    const sFilterEl = document.getElementById('adminStudentFilterInput');
    const sClearBtn = document.getElementById('btnClearAdminStudentFilter');
    if (sClearBtn) sClearBtn.classList.toggle('hidden', !String(sFilterEl?.value || '').trim());
    syncAdminModalLanguageUI();
    syncAdminAddStudentChips();
    const cardEl = document.getElementById('adminModalCard');
    if (cardEl) {
      cardEl.classList.remove('is-dragging', 'is-snapping-back');
      cardEl.style.transform = '';
    }
    const overlayEl = document.getElementById('adminModal');
    if (overlayEl) overlayEl.style.backgroundColor = '';
    switchAdminTab('hub', true);
    openAnimatedModal(overlayEl, cardEl, () => {
      syncAllAdminSegmentedIndicators(false);
    });
    requestAnimationFrame(() => syncAllAdminSegmentedIndicators(false));
    void refreshAdminCloudData('all', { includeAccess: true });
  }

  function closeAdminModal() {
    const cardEl = document.getElementById('adminModalCard');
    const overlayEl = document.getElementById('adminModal');
    if (cardEl) {
      cardEl.classList.remove('is-dragging', 'is-snapping-back');
      cardEl.style.transform = '';
    }
    if (overlayEl) overlayEl.style.backgroundColor = '';
    closeAnimatedModal(overlayEl, cardEl);
  }

  // ==================== BOOTSTRAP ====================
  onDomReady(() => {
    applyPalette(state.palette, false);
    applyTheme();
    try { localStorage.removeItem(STORE_KEY + 'navViewState'); } catch (e) {}
    const savedNav = loadSessionStore('navViewState', null);
    const scheduleDays = getScheduleDays();
    const restoredTab = (savedNav && typeof savedNav.activeTab === 'string' && VALID_NAV_TABS.has(savedNav.activeTab))
      ? savedNav.activeTab
      : 'daily';
    const restoredDate = (savedNav && typeof savedNav.selectedDate === 'string' && scheduleDays.some((d) => d.date === savedNav.selectedDate))
      ? savedNav.selectedDate
      : getBestDefaultDate();
    state.selectedDate = restoredDate;
    if (savedNav && typeof savedNav === 'object') {
      if (savedNav.weeklyFilterKurul === 'all' || savedNav.weeklyFilterKurul === '1' || savedNav.weeklyFilterKurul === '2') {
        state.weeklyFilterKurul = savedNav.weeklyFilterKurul;
      }
      if (typeof savedNav.weeklySelectedWeekKey === 'string' && savedNav.weeklySelectedWeekKey) {
        state.weeklySelectedWeekKey = savedNav.weeklySelectedWeekKey;
      }
      if (typeof savedNav.foodDateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(savedNav.foodDateISO)) {
        state.foodDateISO = savedNav.foodDateISO;
      }
      if (savedNav.foodViewMode === 'weekly' || savedNav.foodViewMode === 'daily') {
        state.foodViewMode = savedNav.foodViewMode;
      }
      if (typeof savedNav.searchQuery === 'string' && savedNav.searchQuery) {
        const qInp = document.getElementById('inputSearchQuery');
        if (qInp) qInp.value = savedNav.searchQuery;
      }
    }
    applyLanguageUI();

    const appHeaderEl = document.getElementById('appHeader');
    const headerSpacerEl = document.getElementById('headerSpacer');
    const syncHeaderSpacer = () => {
      if (appHeaderEl && headerSpacerEl && !appHeaderEl.classList.contains('hidden')) {
        headerSpacerEl.style.height = `${appHeaderEl.offsetHeight}px`;
      }
    };
    const scheduleLayoutResync = () => {
      syncHeaderSpacer();
      updateHeaderScrollState();
      updateTabIndicator(state.activeTab, false);
      requestAnimationFrame(() => {
        syncHeaderSpacer();
        updateTabIndicator(state.activeTab, false);
      });
    };
    scheduleLayoutResync();
    setTimeout(scheduleLayoutResync, 80);
    setTimeout(scheduleLayoutResync, 300);
    if (typeof ResizeObserver !== 'undefined' && appHeaderEl) {
      new ResizeObserver(syncHeaderSpacer).observe(appHeaderEl);
    }
    window.addEventListener('scroll', updateHeaderScrollState, { passive: true });
    window.addEventListener('resize', () => {
      syncHeaderSpacer();
      updateHeaderScrollState();
    });
    window.addEventListener('load', scheduleLayoutResync);
    window.addEventListener('pageshow', scheduleLayoutResync);
    window.addEventListener('orientationchange', () => {
      setTimeout(scheduleLayoutResync, 120);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncHeaderSpacer, { passive: true });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleLayoutResync);
    }

    setInterval(updateHeaderClock, 60000);

    document.getElementById('btnLangTr').addEventListener('click', () => setLanguage('tr'));
    document.getElementById('btnLangEn').addEventListener('click', () => setLanguage('en'));
    const btnAuthLangTr = document.getElementById('btnAuthLangTr');
    const btnAuthLangEn = document.getElementById('btnAuthLangEn');
    if (btnAuthLangTr) btnAuthLangTr.addEventListener('click', () => setLanguage('tr'));
    if (btnAuthLangEn) btnAuthLangEn.addEventListener('click', () => setLanguage('en'));

    setupDockInteractiveDrag();
    setupCarouselScrollIndicator();
    setupFoodCarouselScrollIndicator();
    setupDailyCalSwipe();

    // Delegated Card 3D Tilt & Parallax
    (() => {
      const mainEl = document.getElementById('appMain');
      if (!mainEl) return;
      let activeCard = null;
      let touchStartX = 0;
      let touchStartY = 0;

      const clearTilt = (card) => {
        if (!card) return;
        card.classList.remove('is-tilting');
        card.style.setProperty('--tilt-rx', '0deg');
        card.style.setProperty('--tilt-ry', '0deg');
        card.style.setProperty('--tilt-s', '1');
        card.style.setProperty('--glare-o', '0');
        if (activeCard === card) activeCard = null;
      };

      const applyTilt = (card, clientX, clientY) => {
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const px = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const py = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        const rx = (0.5 - py) * 7.5;
        const ry = (px - 0.5) * 7.5;
        card.classList.add('is-tilting');
        card.style.setProperty('--tilt-rx', `${rx.toFixed(2)}deg`);
        card.style.setProperty('--tilt-ry', `${ry.toFixed(2)}deg`);
        card.style.setProperty('--tilt-s', '1.012');
        card.style.setProperty('--glare-x', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--glare-y', `${(py * 100).toFixed(1)}%`);
        card.style.setProperty('--glare-o', '1');
      };

      mainEl.addEventListener('pointerdown', (e) => {
        const card = e.target && e.target.closest && e.target.closest('.slot-tilt-card');
        if (!card) return;
        if (activeCard && activeCard !== card) clearTilt(activeCard);
        activeCard = card;
        touchStartX = e.clientX;
        touchStartY = e.clientY;
        if (e.pointerType !== 'mouse') {
          applyTilt(card, e.clientX, e.clientY);
        }
      }, { passive: true });

      mainEl.addEventListener('pointermove', (e) => {
        const card = e.target && e.target.closest && e.target.closest('.slot-tilt-card');
        if (e.pointerType === 'mouse') {
          if (activeCard && activeCard !== card) clearTilt(activeCard);
          if (!card) return;
          activeCard = card;
          applyTilt(card, e.clientX, e.clientY);
        } else if (activeCard) {
          if (Math.abs(e.clientY - touchStartY) > 10 || Math.abs(e.clientX - touchStartX) > 14) {
            clearTilt(activeCard);
          } else {
            applyTilt(activeCard, e.clientX, e.clientY);
          }
        }
      }, { passive: true });

      const handleLeave = (e) => {
        if (!activeCard) return;
        if (e.type === 'pointerout' && activeCard.contains(e.relatedTarget)) return;
        clearTilt(activeCard);
      };
      mainEl.addEventListener('pointerup', handleLeave, { passive: true });
      mainEl.addEventListener('pointercancel', handleLeave, { passive: true });
      mainEl.addEventListener('pointerout', handleLeave, { passive: true });
    })();

    // Hide fixed bottom dock when Android/iPhone virtual keyboard opens on main form inputs
    (() => {
      const navEl = document.getElementById('appNav');
      if (!navEl) return;
      const baseViewportHeight = window.innerHeight;
      const isEditable = (el) => Boolean(
        el && el.tagName && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(checkbox|radio|file|button|submit|reset)$/i.test(el.type || '')))
      );
      const syncKeyboardDock = () => {
        const activeEl = document.activeElement;
        const editableFocused = isEditable(activeEl);
        const vv = window.visualViewport;
        const heightDrop = vv ? (baseViewportHeight - vv.height > 140) : false;
        const mainInputFocused = editableFocused && Boolean(activeEl.closest('#appMain'));
        const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        navEl.classList.toggle('is-keyboard-open', (isTouch && mainInputFocused) || (editableFocused && heightDrop));
      };
      document.addEventListener('focusin', syncKeyboardDock, { passive: true });
      document.addEventListener('focusout', () => setTimeout(syncKeyboardDock, 60), { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncKeyboardDock, { passive: true });
      }
    })();

    // Global subtle micro-haptics on interactive taps (capture phase so DOM re-renders don't cancel bubbling; zero buzz on scroll/drag)
    document.addEventListener('click', (e) => {
      if (!e.isTrusted || !state.hapticsEnabled) return;
      const rawTarget = e.target;
      if (!rawTarget || !rawTarget.closest) return;
      if (rawTarget.id === 'iosHapticSwitchLabel' || rawTarget.id === 'iosHapticSwitchInput') return;
      const target = rawTarget.closest('button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"]), [role="switch"], .ios-press, .group-chip, .food-cal-day, .palette-card, .week-day-btn, .food-day-btn, summary');
      if (!target) return;
      if (
        target.id === 'btnToggleHaptics' ||
        target.id === 'btnAppearanceLight' ||
        target.id === 'btnAppearanceDark' ||
        target.hasAttribute('data-palette-choice')
      ) {
        return;
      }
      triggerHaptic('light');
    }, true);

    const btnOpenSettingsMenu = document.getElementById('btnOpenSettingsMenu');
    if (btnOpenSettingsMenu) {
      btnOpenSettingsMenu.addEventListener('click', () => {
        triggerHaptic('tick');
        toggleSettingsMenu();
      });
    }
    const btnCloseSettingsMenu = document.getElementById('btnCloseSettingsMenu');
    if (btnCloseSettingsMenu) {
      btnCloseSettingsMenu.addEventListener('click', () => {
        triggerHaptic('tick');
        closeSettingsMenu();
      });
    }
    const settingsMenuModalEl = document.getElementById('settingsMenuModal');
    if (settingsMenuModalEl) {
      settingsMenuModalEl.addEventListener('click', (e) => {
        if (e.target && !e.target.closest('#settingsMenuCard')) {
          closeSettingsMenu();
        }
      });
    }

    const btnAppearanceLight = document.getElementById('btnAppearanceLight');
    const btnAppearanceDark = document.getElementById('btnAppearanceDark');
    if (btnAppearanceLight) {
      btnAppearanceLight.addEventListener('click', () => {
        if (state.darkMode) {
          state.darkMode = false;
          triggerHaptic('medium');
          applyTheme(true);
        }
      });
    }
    if (btnAppearanceDark) {
      btnAppearanceDark.addEventListener('click', () => {
        if (!state.darkMode) {
          state.darkMode = true;
          triggerHaptic('medium');
          applyTheme(true);
        }
      });
    }

    const btnToggleHaptics = document.getElementById('btnToggleHaptics');
    if (btnToggleHaptics) {
      btnToggleHaptics.addEventListener('click', () => {
        state.hapticsEnabled = !state.hapticsEnabled;
        saveStore('hapticsEnabled', state.hapticsEnabled);
        syncSettingsMenuUI(false);
        if (state.hapticsEnabled) {
          triggerHaptic('medium', true);
        }
        const loc = I18N[state.lang];
        showToast(state.hapticsEnabled ? loc.hapticsEnabledToast : loc.hapticsDisabledToast);
      });
    }

    const btnClearPdfCache = document.getElementById('btnClearPdfCache');
    if (btnClearPdfCache) {
      btnClearPdfCache.addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        if (!api || typeof api.clearLessonPdfCache !== 'function') return;
        btnClearPdfCache.disabled = true;
        triggerHaptic('medium');
        await api.clearLessonPdfCache();
        cachedPdfIds = new Set();
        cachedPdfStats = { count: 0, totalBytes: 0 };
        renderPdfCacheSettingsRow();
        invalidateScheduleRenderCache();
        runWithStaggerSuppressed(() => {
          if (state.activeTab === 'daily') renderDailyView();
          if (state.activeTab === 'weekly') renderWeeklyView();
        });
        showToast(I18N[state.lang].settingsPdfCacheClearedToast);
      });
    }

    const btnClosePaletteModal = document.getElementById('btnClosePaletteModal');
    if (btnClosePaletteModal) btnClosePaletteModal.addEventListener('click', closePaletteModal);
    const paletteModalEl = document.getElementById('paletteModal');
    if (paletteModalEl) {
      paletteModalEl.addEventListener('click', (e) => {
        if (e.target.id === 'paletteModal') closePaletteModal();
      });
    }
    document.querySelectorAll('[data-palette-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = normalizePaletteKey(btn.getAttribute('data-palette-choice'));
        triggerHaptic('medium');
        applyPalette(choice, true);
        const loc = I18N[state.lang];
        const pName = (loc.paletteNames && loc.paletteNames[choice]) || choice;
        showToast(loc.paletteChangedToast(pName));
      });
    });

    const authInputEl = document.getElementById('authStudentIdInput');
    const authPwdInputEl = document.getElementById('authAdminPasswordInput');
    const btnToggleAdminPwdVis = document.getElementById('btnToggleAdminPwdVis');
    const btnAuthBackToId = document.getElementById('btnAuthBackToId');
    const authFormEl = document.getElementById('authLoginForm');
    if (authInputEl) {
      authInputEl.addEventListener('input', () => {
        const digitsOnly = authInputEl.value.replace(/\D+/g, '').slice(0, 11);
        if (authInputEl.value !== digitsOnly) {
          authInputEl.value = digitsOnly;
        }
        clearAuthError();
      });
    }
    if (btnAuthBackToId) {
      btnAuthBackToId.addEventListener('click', () => {
        const prevId = authPendingAdminId;
        clearAuthError();
        setAuthLoginStep('id', prevId);
        requestAnimationFrame(() => {
          if (authInputEl) {
            authInputEl.focus();
            authInputEl.setSelectionRange(authInputEl.value.length, authInputEl.value.length);
          }
        });
      });
    }
    if (btnToggleAdminPwdVis && authPwdInputEl) {
      btnToggleAdminPwdVis.addEventListener('click', () => {
        const isPwd = authPwdInputEl.type === 'password';
        authPwdInputEl.type = isPwd ? 'text' : 'password';
        const eyeOpen = document.getElementById('iconPwdEyeOpen');
        const eyeClosed = document.getElementById('iconPwdEyeClosed');
        if (eyeOpen) eyeOpen.classList.toggle('hidden', isPwd);
        if (eyeClosed) eyeClosed.classList.toggle('hidden', !isPwd);
      });
    }
    if (authPwdInputEl) {
      authPwdInputEl.addEventListener('input', clearAuthError);
    }

    let authFailedCount = 0;
    let authLockedUntil = 0;
    if (authFormEl) {
      authFormEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const loc = I18N[state.lang];
        const nowMs = Date.now();
        if (nowMs < authLockedUntil) {
          const remSec = Math.max(1, Math.ceil((authLockedUntil - nowMs) / 1000));
          showAuthError(loc.authErrRateLimited(remSec));
          return;
        }
        const api = window.__INONU_AUTH__;
        if (!api || typeof api.verifyStudentId !== 'function') {
          showAuthError(loc.authErrSystem);
          return;
        }

        const raw = authLoginStep === 'password'
          ? (authPendingAdminId || (authInputEl ? authInputEl.value : ''))
          : (authInputEl ? authInputEl.value : '');
        const cleaned = api.normalizeStudentId(raw);
        if (!cleaned) {
          setAuthLoginStep('id');
          showAuthError(loc.authErrEmpty);
          if (authInputEl) authInputEl.focus();
          return;
        }
        if (!/^01\d{9}$/.test(cleaned)) {
          setAuthLoginStep('id');
          showAuthError(loc.authErrFormat);
          if (authInputEl) authInputEl.focus();
          return;
        }

        const isAdminAttempt = typeof api.isAdminStudentId === 'function'
          ? api.isAdminStudentId(cleaned)
          : cleaned === '01260102038';

        // Step 1 -> Step 2 transition for admin ID (password requested only after submitting ID)
        if (isAdminAttempt && authLoginStep === 'id') {
          clearAuthError();
          setAuthLoginStep('password', cleaned);
          return;
        }

        const submitBtn = document.getElementById('btnAuthSubmit');
        if (submitBtn) submitBtn.disabled = true;

        let verifiedAdminSecret = '';
        try {
          if (isAdminAttempt) {
            const pwdVal = authPwdInputEl ? authPwdInputEl.value : '';
            if (!pwdVal) {
              showAuthError(loc.authErrAdminPwdRequired);
              if (authPwdInputEl) authPwdInputEl.focus();
              return;
            }
            let pwdOk = false;
            if (typeof api.verifyAndUnlockAdmin === 'function') {
              const unlockRes = await api.verifyAndUnlockAdmin(pwdVal);
              pwdOk = Boolean(unlockRes && unlockRes.ok);
              verifiedAdminSecret = (unlockRes && unlockRes.writeSecret) || '';
            } else if (typeof api.verifyAdminPassword === 'function') {
              pwdOk = await api.verifyAdminPassword(pwdVal);
            }
            if (!pwdOk) {
              authFailedCount += 1;
              if (authFailedCount >= 5) {
                authLockedUntil = Date.now() + 15000;
                authFailedCount = 0;
                showAuthError(loc.authErrRateLimited(15));
              } else {
                showAuthError(loc.authErrAdminPwdWrong);
              }
              if (authPwdInputEl) {
                authPwdInputEl.value = '';
                authPwdInputEl.focus();
              }
              return;
            }
          }

          let match = null;
          let loginDeniedReason = 'not_found';
          if (typeof api.checkStudentLoginStatus === 'function') {
            const statusRes = await api.checkStudentLoginStatus(cleaned);
            if (statusRes && statusRes.ok) {
              match = statusRes.match;
            } else {
              loginDeniedReason = (statusRes && statusRes.reason) || 'not_found';
            }
          } else if (typeof api.lookupStudentWithCloud === 'function') {
            match = await api.lookupStudentWithCloud(cleaned);
          } else {
            match = api.verifyStudentId(cleaned);
          }
          if (!match) {
            authFailedCount += 1;
            if (authFailedCount >= 5) {
              authLockedUntil = Date.now() + 15000;
              authFailedCount = 0;
              showAuthError(loc.authErrRateLimited(15));
            } else if (loginDeniedReason === 'inactive') {
              showAuthError(loc.authErrAccountInactive);
            } else {
              showAuthError(loc.authErrDenied);
            }
            if (authInputEl) authInputEl.focus();
            return;
          }
          authFailedCount = 0;
          authLockedUntil = 0;

          const cloudKey = typeof api.deriveCloudDocId === 'function'
            ? await api.deriveCloudDocId(cleaned).catch(() => '')
            : '';

          if (match.prog === 'tr' || match.prog === 'en') {
            state.lang = match.prog;
            saveStore('lang', state.lang);
          }

          const localPrefs = getStudentPrefs(match.hash);
          const hasLocalMbu = Object.prototype.hasOwnProperty.call(localPrefs, 'myMbuGroup');
          state.myMbuGroup = hasLocalMbu && typeof localPrefs.myMbuGroup === 'string'
            ? localPrefs.myMbuGroup
            : (match.group || '');
          state.myLabGroup = typeof localPrefs.myLabGroup === 'string'
            ? localPrefs.myLabGroup
            : (typeof match.labGroup === 'string' ? match.labGroup : '');
          state.otherGroupMode = localPrefs.otherGroupMode === 'hide' ? 'hide' : 'dim';

          let cloudPromise = null;
          let resolvedCloudPrefs = undefined;
          if (cloudKey && typeof api.loadCloudStudentPrefs === 'function') {
            cloudPromise = api.loadCloudStudentPrefs(match.hash, cloudKey, { force: true }).catch(() => undefined);
            try {
              resolvedCloudPrefs = await Promise.race([
                cloudPromise,
                new Promise((resolve) => setTimeout(() => resolve(undefined), 3000))
              ]);
              if (resolvedCloudPrefs && typeof resolvedCloudPrefs === 'object') {
                state.myMbuGroup = typeof resolvedCloudPrefs.myMbuGroup === 'string'
                  ? resolvedCloudPrefs.myMbuGroup
                  : (match.group || '');
                state.myLabGroup = typeof resolvedCloudPrefs.myLabGroup === 'string'
                  ? resolvedCloudPrefs.myLabGroup
                  : (typeof match.labGroup === 'string' ? match.labGroup : '');
                state.otherGroupMode = resolvedCloudPrefs.otherGroupMode === 'hide' ? 'hide' : 'dim';
                if (resolvedCloudPrefs.lang === 'tr' || resolvedCloudPrefs.lang === 'en') {
                  state.lang = resolvedCloudPrefs.lang;
                  saveStore('lang', state.lang);
                }
                saveLocalStudentPrefs(match.hash, {
                  myMbuGroup: state.myMbuGroup,
                  myLabGroup: state.myLabGroup,
                  otherGroupMode: state.otherGroupMode,
                  lang: state.lang,
                  updatedAtMs: Number(resolvedCloudPrefs.updatedAtMs) || Date.now()
                });
              }
            } catch (err) {}
          }

          saveStore('myMbuGroup', state.myMbuGroup);
          saveStore('myLabGroup', state.myLabGroup);
          saveStore('otherGroupMode', state.otherGroupMode);
          saveStore('authSession', {
            hash: match.hash,
            cloudKey,
            last4: match.last4,
            group: match.group,
            prog: match.prog,
            name: match.name,
            source: match.source === 'custom' ? 'custom' : 'allowlist',
            isAdmin: Boolean(isAdminAttempt || match.isAdmin),
            adminSecret: (isAdminAttempt && verifiedAdminSecret) ? verifiedAdminSecret : '',
            at: Date.now()
          });
          cloudStartupSyncDoneForHash = match.hash;

          if (resolvedCloudPrefs === null) {
            if (hasNonEmptyGroupOrDisplayPrefs()) {
              saveCurrentStudentPrefs(true);
            }
          } else if (resolvedCloudPrefs === undefined && cloudPromise) {
            cloudPromise.then((lateCloudPrefs) => {
              if (lateCloudPrefs && typeof lateCloudPrefs === 'object') {
                applySyncedCloudPrefs(match.hash, lateCloudPrefs);
              } else if (lateCloudPrefs === null && hasNonEmptyGroupOrDisplayPrefs()) {
                saveCurrentStudentPrefs(true);
              }
            });
          }

          clearAuthError();
          if (authInputEl) authInputEl.value = '';
          if (authPwdInputEl) authPwdInputEl.value = '';
          setAuthLoginStep('id');
          closeAuthModal(true);
          syncSiteAccessGateUI();
          syncActiveStudentAccountWatch();
          syncStudentPrefsCloudSubscription();
          refreshAllVisibleTabsAfterAuthChange();
          void refreshDailyAnnouncements(true);
          void refreshLessonMaterials(true);
          showToast(I18N[state.lang].authWelcomeToast(match.group, match.name));
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    const handleAuthActionClick = () => {
      if (getActiveAuthSession()) {
        cloudStartupSyncDoneForHash = '';
        signOutStudent();
      } else {
        openAuthModal(false);
      }
    };
    const btnAuthActionInfo = document.getElementById('btnAuthActionInfo');
    if (btnAuthActionInfo) {
      btnAuthActionInfo.addEventListener('click', handleAuthActionClick);
    }
    const btnAuthActionDaily = document.getElementById('btnAuthActionDaily');
    if (btnAuthActionDaily) {
      btnAuthActionDaily.addEventListener('click', handleAuthActionClick);
    }
    const btnCloseAuthModal = document.getElementById('btnCloseAuthModal');
    if (btnCloseAuthModal) {
      btnCloseAuthModal.addEventListener('click', () => closeAuthModal());
    }
    const authGateOverlay = document.getElementById('authGate');
    if (authGateOverlay) {
      authGateOverlay.addEventListener('click', (e) => {
        if (e.target.id === 'authGate') closeAuthModal();
      });
    }

    const jumpToday = () => {
      state.selectedDate = getBestDefaultDate();
      switchTab('daily');
    };

    document.getElementById('btnJumpTodayTop').addEventListener('click', jumpToday);
    document.getElementById('btnBannerToday').addEventListener('click', jumpToday);
    document.getElementById('btnBannerTomorrow').addEventListener('click', () => {
      state.selectedDate = getTomorrowTargetDate();
      switchTab('daily');
    });

    const btnDailyDatePicker = document.getElementById('btnDailyDatePicker');
    if (btnDailyDatePicker) btnDailyDatePicker.addEventListener('click', openDailyDateModal);
    const btnCloseDailyDateModal = document.getElementById('btnCloseDailyDateModal');
    if (btnCloseDailyDateModal) btnCloseDailyDateModal.addEventListener('click', closeDailyDateModal);
    const dailyDateModalEl = document.getElementById('dailyDateModal');
    if (dailyDateModalEl) {
      dailyDateModalEl.addEventListener('click', (e) => {
        if (e.target.id === 'dailyDateModal') closeDailyDateModal();
      });
    }
    const btnDailyCalPrevMonth = document.getElementById('btnDailyCalPrevMonth');
    if (btnDailyCalPrevMonth) btnDailyCalPrevMonth.addEventListener('click', () => stepDailyCalMonth(-1));
    const btnDailyCalNextMonth = document.getElementById('btnDailyCalNextMonth');
    if (btnDailyCalNextMonth) btnDailyCalNextMonth.addEventListener('click', () => stepDailyCalMonth(1));
    const btnDailyCalJumpToday = document.getElementById('btnDailyCalJumpToday');
    if (btnDailyCalJumpToday) {
      btnDailyCalJumpToday.addEventListener('click', () => {
        state.selectedDate = getBestDefaultDate();
        closeDailyDateModal();
        renderDailyView();
      });
    }
    const btnDailyCalJumpK1 = document.getElementById('btnDailyCalJumpK1');
    if (btnDailyCalJumpK1) {
      btnDailyCalJumpK1.addEventListener('click', () => {
        const firstK1 = getScheduleDays().find((d) => Number(d.kurulNo) === 1);
        if (firstK1) {
          state.selectedDate = firstK1.date;
          closeDailyDateModal();
          renderDailyView();
        }
      });
    }
    const btnDailyCalJumpK2 = document.getElementById('btnDailyCalJumpK2');
    if (btnDailyCalJumpK2) {
      btnDailyCalJumpK2.addEventListener('click', () => {
        const firstK2 = getScheduleDays().find((d) => Number(d.kurulNo) === 2);
        if (firstK2) {
          state.selectedDate = firstK2.date;
          closeDailyDateModal();
          renderDailyView();
        }
      });
    }

    document.getElementById('btnExportDayIcs').addEventListener('click', () => {
      const dayObj = getScheduleDays().find((d) => d.date === state.selectedDate);
      if (dayObj) {
        const { visibleSlots } = filterSlotsForGroupPreference(dayObj.slots);
        exportSlotsToIcs(visibleSlots, `inonu-tip-${dayObj.date}-${state.lang}.ics`);
      }
    });

    document.getElementById('btnExportWeekIcs').addEventListener('click', () => {
      const weekDays = getScheduleDays().filter((d) => `${d.kurulNo}-${d.haftaNo}` === state.weeklySelectedWeekKey);
      const weekSlots = filterSlotsForGroupPreference(weekDays.flatMap((d) => d.slots)).visibleSlots;
      if (weekSlots.length > 0) {
        exportSlotsToIcs(weekSlots, `inonu-tip-hafta-${state.weeklySelectedWeekKey}-${state.lang}.ics`);
      }
    });

    const refreshActiveScheduleViews = () => {
      updateGroupFilterButtonUI();
      syncGroupModalUI();
      if (state.activeTab === 'daily') renderDailyView();
      if (state.activeTab === 'weekly') renderWeeklyView();
      if (state.activeTab === 'search') renderSearchView();
    };

    document.getElementById('btnOpenGroupModal').addEventListener('click', openGroupModal);
    document.getElementById('btnCloseGroupModal').addEventListener('click', closeGroupModal);
    document.getElementById('btnDoneGroupModal').addEventListener('click', closeGroupModal);
    document.getElementById('groupModal').addEventListener('click', (e) => {
      if (e.target.id === 'groupModal') closeGroupModal();
    });
    document.querySelectorAll('[data-mbu-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.myMbuGroup = btn.getAttribute('data-mbu-group') || '';
        saveStore('myMbuGroup', state.myMbuGroup);
        saveCurrentStudentPrefs(true);
        invalidateScheduleRenderCache();
        refreshActiveScheduleViews();
      });
    });
    document.querySelectorAll('[data-lab-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.myLabGroup = btn.getAttribute('data-lab-group') || '';
        saveStore('myLabGroup', state.myLabGroup);
        saveCurrentStudentPrefs(true);
        invalidateScheduleRenderCache();
        refreshActiveScheduleViews();
      });
    });
    document.querySelectorAll('[data-other-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.otherGroupMode = btn.getAttribute('data-other-mode') === 'hide' ? 'hide' : 'dim';
        saveStore('otherGroupMode', state.otherGroupMode);
        saveCurrentStudentPrefs(true);
        invalidateScheduleRenderCache();
        refreshActiveScheduleViews();
      });
    });
    document.getElementById('btnResetGroupFilter').addEventListener('click', () => {
      state.myMbuGroup = '';
      state.myLabGroup = '';
      state.otherGroupMode = 'dim';
      saveStore('myMbuGroup', '');
      saveStore('myLabGroup', '');
      saveStore('otherGroupMode', 'dim');
      saveCurrentStudentPrefs(true);
      invalidateScheduleRenderCache();
      refreshActiveScheduleViews();
    });

    document.getElementById('btnFilterKurulAll').addEventListener('click', () => { state.weeklyFilterKurul = 'all'; renderWeeklyView(); });
    document.getElementById('btnFilterKurul1').addEventListener('click', () => { state.weeklyFilterKurul = '1'; renderWeeklyView(); });
    document.getElementById('btnFilterKurul2').addEventListener('click', () => { state.weeklyFilterKurul = '2'; renderWeeklyView(); });

    document.getElementById('btnFoodModeDaily').addEventListener('click', () => {
      if (state.foodViewMode !== 'daily') {
        state.foodViewMode = 'daily';
        renderFoodView();
      }
    });
    document.getElementById('btnFoodModeWeekly').addEventListener('click', () => {
      if (state.foodViewMode !== 'weekly') {
        state.foodViewMode = 'weekly';
        renderFoodView();
      }
    });
    document.getElementById('btnFoodPrev').addEventListener('click', () => {
      const cur = state.foodDateISO || formatISODate(getTodayDateObj());
      state.foodDateISO = shiftISODate(cur, state.foodViewMode === 'weekly' ? -7 : -1);
      renderFoodView();
    });
    document.getElementById('btnFoodNext').addEventListener('click', () => {
      const cur = state.foodDateISO || formatISODate(getTodayDateObj());
      state.foodDateISO = shiftISODate(cur, state.foodViewMode === 'weekly' ? 7 : 1);
      renderFoodView();
    });
    setupFoodCalSwipe();
    document.getElementById('btnFoodDatePicker').addEventListener('click', openFoodDateModal);
    document.getElementById('btnCloseFoodDateModal').addEventListener('click', closeFoodDateModal);
    document.getElementById('foodDateModal').addEventListener('click', (e) => {
      if (e.target.id === 'foodDateModal') closeFoodDateModal();
    });
    document.getElementById('btnFoodCalPrevMonth').addEventListener('click', () => stepFoodCalMonth(-1));
    document.getElementById('btnFoodCalNextMonth').addEventListener('click', () => stepFoodCalMonth(1));
    document.getElementById('btnFoodRefresh').addEventListener('click', () => {
      foodAnnouncementsLoaded = false;
      renderFoodView(true);
    });

    document.getElementById('inputSearchQuery').addEventListener('input', renderSearchView);
    document.getElementById('btnClearSearch').addEventListener('click', () => {
      document.getElementById('inputSearchQuery').value = '';
      renderSearchView();
    });

    document.getElementById('btnCloseNoteModal').addEventListener('click', closeNoteModal);
    document.getElementById('noteModal').addEventListener('click', (e) => {
      if (e.target.id === 'noteModal') closeNoteModal();
    });
    const btnCloseLessonPdfsModal = document.getElementById('btnCloseLessonPdfsModal');
    if (btnCloseLessonPdfsModal) {
      btnCloseLessonPdfsModal.addEventListener('click', closeLessonPdfsModal);
    }
    const lessonPdfsModalEl = document.getElementById('lessonPdfsModal');
    if (lessonPdfsModalEl) {
      lessonPdfsModalEl.addEventListener('click', (e) => {
        if (e.target.id === 'lessonPdfsModal') closeLessonPdfsModal();
      });
    }
    document.getElementById('btnSaveNote').addEventListener('click', () => {
      if (!state.modalSlotKey) return;
      const slotKey = state.modalSlotKey;
      const val = document.getElementById('noteModalTextarea').value.trim();
      if (val) {
        state.notes[slotKey] = val;
      } else {
        delete state.notes[slotKey];
      }
      saveStore('notes', state.notes);
      closeNoteModal();
      showToast(t('noteSavedToast'));
      if (state.activeTab === 'daily') renderDailyView();
      if (state.activeTab === 'weekly') renderWeeklyView();
      if (state.activeTab === 'search') renderSearchView();
    });
    document.getElementById('btnDeleteNote').addEventListener('click', () => {
      if (!state.modalSlotKey) return;
      const slotKey = state.modalSlotKey;
      delete state.notes[slotKey];
      saveStore('notes', state.notes);
      closeNoteModal();
      showToast(t('noteDeletedToast'));
      if (state.activeTab === 'daily') renderDailyView();
      if (state.activeTab === 'weekly') renderWeeklyView();
      if (state.activeTab === 'search') renderSearchView();
    });

    let deferredInstallPrompt = null;
    const installActionWrap = document.getElementById('pwaInstallActionWrap');
    const btnInstallApp = document.getElementById('btnInstallApp');
    const btnOpenInstallModal = document.getElementById('btnOpenInstallModal');
    const installModal = document.getElementById('installModal');
    const btnCloseInstallModal = document.getElementById('btnCloseInstallModal');

    function checkIsStandalone() {
      return Boolean(
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        window.navigator.standalone === true ||
        (document.referrer && document.referrer.includes('android-app://'))
      );
    }

    function isAppInstalled() {
      if (checkIsStandalone()) return true;
      try {
        return localStorage.getItem('inonu_pwa_installed') === 'true';
      } catch (e) {
        return false;
      }
    }

    function hideInstallUI() {
      document.body.classList.add('is-app-installed');
      if (btnOpenInstallModal) {
        btnOpenInstallModal.classList.add('is-installed-hidden');
        btnOpenInstallModal.style.setProperty('display', 'none', 'important');
      }
      if (installActionWrap) {
        installActionWrap.classList.add('hidden');
      }
      closeInstallModal();
    }

    function showInstallUI() {
      if (isAppInstalled()) {
        hideInstallUI();
        return;
      }
      document.body.classList.remove('is-app-installed');
      if (btnOpenInstallModal) {
        btnOpenInstallModal.classList.remove('is-installed-hidden');
        btnOpenInstallModal.style.removeProperty('display');
      }
    }

    // Initial check on page load: show on web, hide when installed/standalone
    if (isAppInstalled()) {
      hideInstallUI();
    } else {
      showInstallUI();
    }

    // Dynamically react to display-mode changes
    const standaloneMql = window.matchMedia('(display-mode: standalone)');
    if (standaloneMql && standaloneMql.addEventListener) {
      standaloneMql.addEventListener('change', (e) => {
        if (e.matches) hideInstallUI();
        else if (!isAppInstalled()) showInstallUI();
      });
    }

    if (btnOpenInstallModal && installModal) {
      btnOpenInstallModal.addEventListener('click', openInstallModal);
    }
    if (btnCloseInstallModal && installModal) {
      btnCloseInstallModal.addEventListener('click', closeInstallModal);
    }
    if (installModal) {
      installModal.addEventListener('click', (e) => {
        if (e.target.id === 'installModal') closeInstallModal();
      });
    }

    const btnCloseFoodPhotoModal = document.getElementById('btnCloseFoodPhotoModal');
    const foodPhotoModal = document.getElementById('foodPhotoModal');
    if (btnCloseFoodPhotoModal) {
      btnCloseFoodPhotoModal.addEventListener('click', closeFoodPhotoModal);
    }
    if (foodPhotoModal) {
      foodPhotoModal.addEventListener('click', (e) => {
        if (e.target.id === 'foodPhotoModal') closeFoodPhotoModal();
      });
    }

    // ==================== ADMIN MODAL EVENT BINDINGS ====================
    const btnOpenAdminModal = document.getElementById('btnOpenAdminModal');
    if (btnOpenAdminModal) btnOpenAdminModal.addEventListener('click', openAdminModal);
    const btnCloseAdminModal = document.getElementById('btnCloseAdminModal');
    if (btnCloseAdminModal) btnCloseAdminModal.addEventListener('click', closeAdminModal);
    const adminModalOverlay = document.getElementById('adminModal');
    if (adminModalOverlay) {
      adminModalOverlay.addEventListener('click', (e) => {
        if (e.target.id === 'adminModal') closeAdminModal();
      });
    }

    // Hub Navigation & Back Button
    const btnAdminBackToHub = document.getElementById('btnAdminBackToHub');
    if (btnAdminBackToHub) {
      btnAdminBackToHub.addEventListener('click', () => {
        switchAdminTab('hub', true);
      });
    }
    document.querySelectorAll('[data-admin-hub-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tKey = btn.getAttribute('data-admin-hub-open') || 'announcements';
        switchAdminTab(tKey, true);
      });
    });

    // Feature 5: Quick Actions
    const btnAdminQuickCancelToday = document.getElementById('btnAdminQuickCancelToday');
    if (btnAdminQuickCancelToday) {
      btnAdminQuickCancelToday.addEventListener('click', () => {
        adminState.cancelProg = state.lang === 'en' ? 'en' : 'tr';
        adminState.cancelDate = '';
        switchAdminTab('cancellations', true);
        const days = getAdminCancelScheduleDays(adminState.cancelProg);
        const todayObj = getTodayDateObj();
        const todayDmy = formatDMY(todayObj);
        const preferred = (days.find((d) => d.date === todayDmy) || days.find((d) => parseDMY(d.date) >= todayObj) || days[0]);
        if (preferred) {
          setAdminCancelSelectedDate(preferred.date, 'none');
          renderAdminCancelDaySlots('next');
        }
      });
    }

    const btnAdminQuickUrgentAnn = document.getElementById('btnAdminQuickUrgentAnn');
    if (btnAdminQuickUrgentAnn) {
      btnAdminQuickUrgentAnn.addEventListener('click', () => {
        adminState.editingAnnId = '';
        adminState.annTone = 'urgent';
        adminState.annActive = true;
        adminState.annTargetGroup = '';
        adminState.annTargetProg = '';
        adminState.annExpiresAtMs = 0;
        const tInp = document.getElementById('adminAnnTitleInput');
        const mInp = document.getElementById('adminAnnMsgInput');
        const expInp = document.getElementById('adminAnnExpiresInput');
        if (tInp) tInp.value = '';
        if (mInp) mInp.value = '';
        if (expInp) expInp.value = '';
        switchAdminTab('announcements', true);
        syncAdminAnnFormUI(false);
        setTimeout(() => {
          if (tInp) tInp.focus();
        }, 220);
      });
    }

    const btnAdminQuickSiteLock = document.getElementById('btnAdminQuickSiteLock');
    if (btnAdminQuickSiteLock) {
      btnAdminQuickSiteLock.addEventListener('click', () => {
        const toggleBtn = document.getElementById('btnToggleSiteRequireLogin');
        if (toggleBtn) toggleBtn.click();
      });
    }

    // Feature 4: Mobile Bottom-Sheet Swipe-to-Dismiss on Grab Handle & Header
    (() => {
      const sheetCard = document.getElementById('adminModalCard');
      const sheetOverlay = document.getElementById('adminModal');
      const dragTargets = [
        document.getElementById('adminSheetHandle'),
        document.getElementById('adminModalHeader')
      ].filter(Boolean);
      if (!sheetCard || !sheetOverlay || dragTargets.length === 0) return;

      let dragging = false;
      let startY = 0;
      let startTime = 0;
      let currentDy = 0;

      const onTouchStart = (e) => {
        if (window.innerWidth >= 640) return;
        if (!e.touches || e.touches.length !== 1) return;
        const targetEl = e.target;
        if (targetEl && typeof targetEl.closest === 'function' && targetEl.closest('button, input, a')) return;
        dragging = true;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        currentDy = 0;
        sheetCard.classList.remove('is-snapping-back');
        sheetCard.classList.add('is-dragging');
      };

      const onTouchMove = (e) => {
        if (!dragging || !e.touches || e.touches.length !== 1) return;
        const dy = e.touches[0].clientY - startY;
        if (dy <= 0) {
          currentDy = dy * 0.14;
        } else {
          currentDy = dy;
          if (e.cancelable) e.preventDefault();
        }
        sheetCard.style.transform = `translate3d(0, ${currentDy}px, 0)`;
        const fadeRatio = Math.max(0.08, 0.4 * (1 - Math.min(Math.max(dy, 0) / 360, 0.85)));
        sheetOverlay.style.backgroundColor = `rgba(0, 0, 0, ${fadeRatio.toFixed(3)})`;
      };

      const onTouchEnd = () => {
        if (!dragging) return;
        dragging = false;
        sheetCard.classList.remove('is-dragging');
        const elapsed = Math.max(1, Date.now() - startTime);
        const velocity = currentDy / elapsed;
        if (currentDy > 95 || (currentDy > 42 && velocity > 0.45)) {
          sheetCard.style.transform = '';
          sheetOverlay.style.backgroundColor = '';
          closeAdminModal();
        } else {
          sheetCard.classList.add('is-snapping-back');
          sheetCard.style.transform = 'translate3d(0, 0, 0)';
          sheetOverlay.style.backgroundColor = '';
          setTimeout(() => {
            sheetCard.classList.remove('is-snapping-back');
            sheetCard.style.transform = '';
          }, 330);
        }
      };

      dragTargets.forEach((el) => {
        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('touchcancel', onTouchEnd, { passive: true });
      });
    })();

    const adminReunlockBar = document.getElementById('adminReunlockBar');
    if (adminReunlockBar) {
      adminReunlockBar.addEventListener('submit', async (e) => {
        e.preventDefault();
        const loc = I18N[state.lang];
        const api = window.__INONU_AUTH__;
        const inp = document.getElementById('adminUnlockPwdInput');
        const btn = document.getElementById('btnAdminUnlockSubmit');
        const pwd = inp ? inp.value : '';
        if (!api || typeof api.verifyAndUnlockAdmin !== 'function' || !pwd) {
          showToast(loc.authErrAdminPwdRequired);
          return;
        }
        if (btn) btn.disabled = true;
        try {
          const res = await api.verifyAndUnlockAdmin(pwd);
          if (!res || !res.ok || !res.writeSecret) {
            showToast(loc.authErrAdminPwdWrong);
            if (inp) { inp.value = ''; inp.focus(); }
            return;
          }
          const curSaved = loadStore('authSession', null);
          if (curSaved && typeof curSaved === 'object') {
            saveStore('authSession', { ...curSaved, adminSecret: res.writeSecret });
          }
          if (inp) inp.value = '';
          syncAdminUnlockBarUI();
          void refreshAdminCloudData('all', { markAllDirty: true, includeAccess: true });
          showToast(loc.adminUnlockedToast);
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    const btnAdminRefreshAll = document.getElementById('btnAdminRefreshAll');
    if (btnAdminRefreshAll) {
      btnAdminRefreshAll.addEventListener('click', () => {
        const curScope = adminState.activeTab === 'hub' ? 'all' : (adminState.activeTab || 'all');
        void refreshAdminCloudData(curScope, { markAllDirty: true, includeAccess: true });
      });
    }

    document.querySelectorAll('[data-ann-tone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.annTone = btn.getAttribute('data-ann-tone') || 'info';
        syncAdminAnnFormUI();
      });
    });
    document.querySelectorAll('[data-ann-target-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.annTargetGroup = btn.getAttribute('data-ann-target-group') || '';
        syncAdminAnnFormUI();
      });
    });
    document.querySelectorAll('[data-ann-target-prog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.annTargetProg = btn.getAttribute('data-ann-target-prog') || '';
        syncAdminAnnFormUI();
      });
    });
    const btnAdminAnnActiveToggle = document.getElementById('btnAdminAnnActiveToggle');
    if (btnAdminAnnActiveToggle) {
      btnAdminAnnActiveToggle.addEventListener('click', () => {
        adminState.annActive = !adminState.annActive;
        syncAdminAnnFormUI();
      });
    }
    const btnAdminAnnCancelEdit = document.getElementById('btnAdminAnnCancelEdit');
    if (btnAdminAnnCancelEdit) {
      btnAdminAnnCancelEdit.addEventListener('click', () => {
        adminState.editingAnnId = '';
        adminState.annTone = 'info';
        adminState.annActive = true;
        adminState.annTargetGroup = '';
        adminState.annTargetProg = '';
        adminState.annExpiresAtMs = 0;
        document.getElementById('adminAnnTitleInput').value = '';
        document.getElementById('adminAnnMsgInput').value = '';
        const expInp = document.getElementById('adminAnnExpiresInput');
        if (expInp) expInp.value = '';
        syncAdminAnnFormUI();
      });
    }

    // Feature 4 & 5: Expiry Presets, Themed Date/Time Pickers & Live Preview Listeners
    document.querySelectorAll('[data-ann-exp-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hrs = Number(btn.getAttribute('data-ann-exp-preset') || '0');
        const expInp = document.getElementById('adminAnnExpiresInput');
        if (hrs <= 0) {
          adminState.annExpiresAtMs = 0;
          if (expInp) expInp.value = '';
        } else {
          const targetMs = Date.now() + hrs * 60 * 60 * 1000;
          adminState.annExpiresAtMs = targetMs;
          if (expInp) expInp.value = formatDateTimeLocalInput(targetMs);
        }
        syncAdminAnnExpiresDisplay();
        renderAdminAnnLivePreview();
      });
    });

    const btnAdminAnnExpiresTrigger = document.getElementById('btnAdminAnnExpiresTrigger');
    if (btnAdminAnnExpiresTrigger) {
      btnAdminAnnExpiresTrigger.addEventListener('click', () => {
        const expInp = document.getElementById('adminAnnExpiresInput');
        openAdminDateTimeModal({
          mode: 'datetime',
          title: state.lang === 'en' ? 'Auto-Expire Date & Time' : 'Otomatik Bitiş Tarihi & Saati',
          initialValue: expInp?.value || '',
          onApply: (val) => {
            if (expInp) expInp.value = val || '';
            const ms = val ? new Date(val).getTime() : 0;
            adminState.annExpiresAtMs = ms > 0 && !Number.isNaN(ms) ? ms : 0;
            syncAdminAnnExpiresDisplay();
            renderAdminAnnLivePreview();
          }
        });
      });
    }

    document.querySelectorAll('[data-ann-pub-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hrs = Number(btn.getAttribute('data-ann-pub-preset')) || 0;
        const pubInp = document.getElementById('adminAnnPublishAtInput');
        if (hrs <= 0) {
          adminState.annPublishAtMs = 0;
          if (pubInp) pubInp.value = '';
        } else {
          const targetMs = Date.now() + hrs * 60 * 60 * 1000;
          adminState.annPublishAtMs = targetMs;
          if (pubInp) pubInp.value = formatDateTimeLocalInput(targetMs);
        }
        syncAdminAnnPublishAtDisplay();
      });
    });

    const btnAdminAnnPublishAtTrigger = document.getElementById('btnAdminAnnPublishAtTrigger');
    if (btnAdminAnnPublishAtTrigger) {
      btnAdminAnnPublishAtTrigger.addEventListener('click', () => {
        const pubInp = document.getElementById('adminAnnPublishAtInput');
        openAdminDateTimeModal({
          mode: 'datetime',
          title: state.lang === 'en' ? 'Schedule Publish Date & Time' : 'Yayın Başlangıç Tarihi & Saati',
          initialValue: pubInp?.value || '',
          onApply: (val) => {
            if (pubInp) pubInp.value = val || '';
            const ms = val ? new Date(val).getTime() : 0;
            adminState.annPublishAtMs = ms > 0 && !Number.isNaN(ms) ? ms : 0;
            syncAdminAnnPublishAtDisplay();
          }
        });
      });
    }

    const btnAdminExamDateTrigger = document.getElementById('btnAdminExamDateTrigger');
    if (btnAdminExamDateTrigger) {
      btnAdminExamDateTrigger.addEventListener('click', () => {
        const dateInp = document.getElementById('adminExamDateInput');
        openAdminDateTimeModal({
          mode: 'date',
          title: state.lang === 'en' ? 'Select Exam Date' : 'Sınav Tarihini Seç',
          initialValue: dateInp?.value || '',
          onApply: (val) => {
            if (dateInp) dateInp.value = val || '';
            syncAdminExamDateDisplay();
          }
        });
      });
    }

    // Themed Admin Date & Time Modal Bindings
    const adminDateTimeModal = document.getElementById('adminDateTimeModal');
    if (adminDateTimeModal) {
      adminDateTimeModal.addEventListener('click', (e) => {
        if (e.target.id === 'adminDateTimeModal') closeAdminDateTimeModal();
      });
    }
    const btnCloseAdminDateTimeModal = document.getElementById('btnCloseAdminDateTimeModal');
    if (btnCloseAdminDateTimeModal) btnCloseAdminDateTimeModal.addEventListener('click', closeAdminDateTimeModal);
    const btnAdminDtPrevMonth = document.getElementById('btnAdminDtPrevMonth');
    if (btnAdminDtPrevMonth) {
      btnAdminDtPrevMonth.addEventListener('click', () => {
        adminDtPickerState.viewMonth -= 1;
        if (adminDtPickerState.viewMonth < 0) {
          adminDtPickerState.viewMonth = 11;
          adminDtPickerState.viewYear -= 1;
        }
        renderAdminDateTimeModal();
        const gridEl = document.getElementById('adminDtDaysGrid');
        const lblEl = document.getElementById('adminDtMonthLabel');
        if (gridEl) { gridEl.classList.remove('admin-slide-prev', 'admin-slide-next'); void gridEl.offsetWidth; gridEl.classList.add('admin-slide-prev'); }
        if (lblEl) { lblEl.classList.remove('food-cal-label-prev', 'food-cal-label-next'); void lblEl.offsetWidth; lblEl.classList.add('food-cal-label-prev'); }
      });
    }
    const btnAdminDtNextMonth = document.getElementById('btnAdminDtNextMonth');
    if (btnAdminDtNextMonth) {
      btnAdminDtNextMonth.addEventListener('click', () => {
        adminDtPickerState.viewMonth += 1;
        if (adminDtPickerState.viewMonth > 11) {
          adminDtPickerState.viewMonth = 0;
          adminDtPickerState.viewYear += 1;
        }
        renderAdminDateTimeModal();
        const gridEl = document.getElementById('adminDtDaysGrid');
        const lblEl = document.getElementById('adminDtMonthLabel');
        if (gridEl) { gridEl.classList.remove('admin-slide-prev', 'admin-slide-next'); void gridEl.offsetWidth; gridEl.classList.add('admin-slide-next'); }
        if (lblEl) { lblEl.classList.remove('food-cal-label-prev', 'food-cal-label-next'); void lblEl.offsetWidth; lblEl.classList.add('food-cal-label-next'); }
      });
    }
    const btnAdminDtHourDec = document.getElementById('btnAdminDtHourDec');
    if (btnAdminDtHourDec) {
      btnAdminDtHourDec.addEventListener('click', () => {
        adminDtPickerState.hour = (adminDtPickerState.hour + 23) % 24;
        renderAdminDateTimeModal();
      });
    }
    const btnAdminDtHourInc = document.getElementById('btnAdminDtHourInc');
    if (btnAdminDtHourInc) {
      btnAdminDtHourInc.addEventListener('click', () => {
        adminDtPickerState.hour = (adminDtPickerState.hour + 1) % 24;
        renderAdminDateTimeModal();
      });
    }
    const btnAdminDtMinDec = document.getElementById('btnAdminDtMinDec');
    if (btnAdminDtMinDec) {
      btnAdminDtMinDec.addEventListener('click', () => {
        adminDtPickerState.minute = (adminDtPickerState.minute + 55) % 60;
        renderAdminDateTimeModal();
      });
    }
    const btnAdminDtMinInc = document.getElementById('btnAdminDtMinInc');
    if (btnAdminDtMinInc) {
      btnAdminDtMinInc.addEventListener('click', () => {
        adminDtPickerState.minute = (adminDtPickerState.minute + 5) % 60;
        renderAdminDateTimeModal();
      });
    }
    document.querySelectorAll('[data-dt-quick-time]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parts = (btn.getAttribute('data-dt-quick-time') || '23:59').split(':').map(Number);
        adminDtPickerState.hour = Number.isFinite(parts[0]) ? parts[0] : 23;
        adminDtPickerState.minute = Number.isFinite(parts[1]) ? parts[1] : 59;
        renderAdminDateTimeModal();
      });
    });
    const btnAdminDtToday = document.getElementById('btnAdminDtToday');
    if (btnAdminDtToday) {
      btnAdminDtToday.addEventListener('click', () => {
        const today = getTodayIso();
        const [y, m] = today.split('-').map(Number);
        adminDtPickerState.viewYear = y;
        adminDtPickerState.viewMonth = Math.max(0, m - 1);
        adminDtPickerState.selectedDate = today;
        if (adminDtPickerState.mode === 'date') {
          if (typeof adminDtPickerState.onApply === 'function') adminDtPickerState.onApply(today);
          closeAdminDateTimeModal();
        } else {
          renderAdminDateTimeModal();
        }
      });
    }
    const btnAdminDtClear = document.getElementById('btnAdminDtClear');
    if (btnAdminDtClear) {
      btnAdminDtClear.addEventListener('click', () => {
        if (typeof adminDtPickerState.onApply === 'function') adminDtPickerState.onApply('');
        closeAdminDateTimeModal();
      });
    }
    const btnAdminDtConfirm = document.getElementById('btnAdminDtConfirm');
    if (btnAdminDtConfirm) {
      btnAdminDtConfirm.addEventListener('click', () => {
        const baseDate = adminDtPickerState.selectedDate || getTodayIso();
        const pad = (n) => String(n).padStart(2, '0');
        const val = adminDtPickerState.mode === 'datetime'
          ? `${baseDate}T${pad(adminDtPickerState.hour)}:${pad(adminDtPickerState.minute)}`
          : baseDate;
        if (typeof adminDtPickerState.onApply === 'function') adminDtPickerState.onApply(val);
        closeAdminDateTimeModal();
      });
    }

    ['adminAnnTitleInput', 'adminAnnMsgInput', 'adminAnnExpiresInput'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', renderAdminAnnLivePreview);
    });
    const adminCancelReasonInp = document.getElementById('adminCancelReasonInput');
    if (adminCancelReasonInp) {
      adminCancelReasonInp.addEventListener('input', renderAdminCancelLivePreview);
    }

    // Feature 1 (iOS Edge Swipe Back): Left edge swipe right pops back to Hub
    (() => {
      const scrollBody = document.getElementById('adminModalScrollBody');
      if (!scrollBody) return;
      let edgeTracking = false;
      let sx = 0;
      let sy = 0;
      let curDx = 0;

      const getActiveSubPane = () => {
        const map = {
          announcements: 'adminPaneAnnouncements',
          cancellations: 'adminPaneCancellations',
          materials: 'adminPaneMaterials',
          exams: 'adminPaneExams',
          students: 'adminPaneStudents',
          'site-settings': 'adminPaneSiteSettings',
          'extras-feedback': 'adminPaneExtrasFeedback',
          'extras-polls': 'adminPaneExtrasPolls',
          'extras-overrides': 'adminPaneExtrasOverrides',
          'extras-extra-lessons': 'adminPaneExtrasExtraLessons',
          'extras-banner': 'adminPaneExtrasBanner'
        };
        const id = map[adminState.activeTab];
        return id ? document.getElementById(id) : null;
      };

      scrollBody.addEventListener('touchstart', (e) => {
        if (adminState.activeTab === 'hub' || !e.touches || e.touches.length !== 1) return;
        const rect = scrollBody.getBoundingClientRect();
        const relX = e.touches[0].clientX - rect.left;
        if (relX > 40) return;
        edgeTracking = true;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        curDx = 0;
      }, { passive: true });

      scrollBody.addEventListener('touchmove', (e) => {
        if (!edgeTracking || !e.touches || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - sx;
        const dy = e.touches[0].clientY - sy;
        if (Math.abs(dy) > Math.abs(dx) * 1.1 && curDx < 12) {
          edgeTracking = false;
          return;
        }
        if (dx > 6) {
          curDx = dx;
          const pane = getActiveSubPane();
          if (pane) {
            pane.style.transition = 'none';
            pane.style.transform = `translate3d(${Math.min(dx * 0.48, 120)}px, 0, 0)`;
            pane.style.opacity = String(Math.max(0.55, 1 - dx / 420));
          }
          if (e.cancelable) e.preventDefault();
        }
      }, { passive: false });

      const finishEdge = () => {
        if (!edgeTracking) return;
        edgeTracking = false;
        const pane = getActiveSubPane();
        if (pane) {
          pane.style.transition = '';
          pane.style.transform = '';
          pane.style.opacity = '';
        }
        if (curDx > 64) {
          triggerHaptic('selection');
          switchAdminTab('hub', true);
        }
      };
      scrollBody.addEventListener('touchend', finishEdge, { passive: true });
      scrollBody.addEventListener('touchcancel', finishEdge, { passive: true });
    })();

    // Feature 3: Bulk Full-Day Cancel / Restore Button
    const btnAdminCancelAllDay = document.getElementById('btnAdminCancelAllDay');
    if (btnAdminCancelAllDay) {
      btnAdminCancelAllDay.addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        const isEn = state.lang === 'en';
        const prog = adminState.cancelProg === 'en' ? 'en' : 'tr';
        const days = getAdminCancelScheduleDays(prog);
        const dayObj = days.find((d) => d.date === adminState.cancelDate) || days[0];
        if (!dayObj || !Array.isArray(dayObj.slots) || dayObj.slots.length === 0) return;

        const secArg = secret === 'active' ? undefined : secret;
        const activeSlots = dayObj.slots.filter((s) => !getCancelledLessonInfo(s, prog));
        const cancelledInfos = dayObj.slots.map((s) => getCancelledLessonInfo(s, prog)).filter(Boolean);
        btnAdminCancelAllDay.disabled = true;
        try {
          if (activeSlots.length > 0) {
            const reasonVal = (document.getElementById('adminCancelReasonInput')?.value || '').trim();
            const savedArr = await Promise.all(
              activeSlots.map((s) => api.saveCancelledLesson({
                date: dayObj.date,
                slotNo: s.slotNo,
                targetProg: prog,
                reason: reasonVal
              }, secArg))
            );
            const savedIds = new Set(savedArr.map((x) => x.id));
            applyLoadedCancelledLessonsList([...cancelledLessonsList.filter((x) => !savedIds.has(x.id)), ...savedArr]);
            pushAdminHistory({
              label: isEn ? `Full day cancelled (${savedArr.length})` : `Tüm gün iptal edildi (${savedArr.length} ders)`,
              sub: `${dayObj.date} · ${prog.toUpperCase()}`,
              undoType: 'bulk_cancel_day',
              undoData: { ids: savedArr.map((x) => x.id) }
            });
            showToast(isEn ? 'All lessons on this day cancelled.' : 'Günün tüm dersleri iptal edildi.');
          } else if (cancelledInfos.length > 0) {
            await Promise.all(cancelledInfos.map((info) => api.deleteCancelledLesson(info.id, secArg)));
            const delIds = new Set(cancelledInfos.map((x) => x.id));
            applyLoadedCancelledLessonsList(cancelledLessonsList.filter((x) => !delIds.has(x.id)));
            pushAdminHistory({
              label: isEn ? `Full day restored (${cancelledInfos.length})` : `Tüm gün geri alındı (${cancelledInfos.length} ders)`,
              sub: `${dayObj.date} · ${prog.toUpperCase()}`,
              undoType: 'bulk_restore_day',
              undoData: { items: cancelledInfos.map((x) => ({ date: x.date, slotNo: x.slotNo, targetProg: x.targetProg, reason: x.reason || '' })) }
            });
            showToast(isEn ? 'All lessons on this day restored.' : 'Günün tüm iptalleri geri alındı.');
          }
          renderAdminCancelDaySlots('next');
          renderAdminCancelledList(false);
          syncAdminHubSummary();
        } catch (err) {
          console.warn('Bulk day cancel error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        } finally {
          btnAdminCancelAllDay.disabled = false;
        }
      });
    }

    // Feature 2: Admin Exam Countdown Form Handlers
    document.querySelectorAll('[data-exam-prog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.examProg = btn.getAttribute('data-exam-prog') || '';
        syncAdminExamFormUI();
      });
    });
    const btnAdminExamCancelEdit = document.getElementById('btnAdminExamCancelEdit');
    if (btnAdminExamCancelEdit) {
      btnAdminExamCancelEdit.addEventListener('click', () => {
        adminState.editingExamId = '';
        adminState.examProg = '';
        ['adminExamTitleInput', 'adminExamDateInput', 'adminExamTimeInput', 'adminExamNoteInput'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        syncAdminExamFormUI();
      });
    }
    const adminExamForm = document.getElementById('adminExamForm');
    if (adminExamForm) {
      adminExamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        const isEn = state.lang === 'en';
        const title = (document.getElementById('adminExamTitleInput')?.value || '').trim();
        const date = (document.getElementById('adminExamDateInput')?.value || '').trim();
        const time = (document.getElementById('adminExamTimeInput')?.value || '').trim();
        const note = (document.getElementById('adminExamNoteInput')?.value || '').trim();
        if (!title || !date) {
          showToast(isEn ? 'Exam title and date are required.' : 'Sınav adı ve tarihi zorunludur.');
          return;
        }
        const btn = document.getElementById('btnAdminExamSubmit');
        if (btn) btn.disabled = true;
        try {
          const wasNew = !adminState.editingExamId;
          const saved = await api.saveExamCountdown({
            id: adminState.editingExamId || undefined,
            title,
            date,
            time,
            note,
            targetProg: adminState.examProg || ''
          }, secret === 'active' ? undefined : secret);
          applyLoadedExamCountdownsList([...managedExamsList.filter((x) => x.id !== saved.id), saved]);
          if (wasNew) {
            pushAdminHistory({
              label: isEn ? 'Exam added' : 'Sınav eklendi',
              sub: `${saved.title} (${saved.date})`,
              undoType: 'exam_create',
              undoData: { id: saved.id }
            });
          }
          adminState.editingExamId = '';
          adminState.examProg = '';
          ['adminExamTitleInput', 'adminExamDateInput', 'adminExamTimeInput', 'adminExamNoteInput'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = '';
          });
          syncAdminExamFormUI();
          showToast(isEn ? 'Exam countdown saved.' : 'Sınav geri sayımı kaydedildi.');
        } catch (err) {
          console.warn('Exam save error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    // Feature 6: Lesson Card Quick Admin Action Sheet Handlers
    const btnCloseAdminSlotQuick = document.getElementById('btnCloseAdminSlotQuick');
    if (btnCloseAdminSlotQuick) btnCloseAdminSlotQuick.addEventListener('click', closeAdminSlotQuickModal);
    const adminSlotQuickModal = document.getElementById('adminSlotQuickModal');
    if (adminSlotQuickModal) {
      adminSlotQuickModal.addEventListener('click', (e) => {
        if (e.target.id === 'adminSlotQuickModal' || e.target.id === 'adminSlotQuickStage') {
          closeAdminSlotQuickModal();
        }
      });
    }
    const btnAdminSlotQuickToggleCancel = document.getElementById('btnAdminSlotQuickToggleCancel');
    if (btnAdminSlotQuickToggleCancel) {
      btnAdminSlotQuickToggleCancel.addEventListener('click', async () => {
        const slot = adminQuickSlotTarget;
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!slot || !api || !secret) return;
        const isEn = state.lang === 'en';
        const prog = state.lang === 'en' ? 'en' : 'tr';
        const existing = getCancelledLessonInfo(slot, prog);
        const secArg = secret === 'active' ? undefined : secret;
        btnAdminSlotQuickToggleCancel.disabled = true;
        try {
          if (existing) {
            await api.deleteCancelledLesson(existing.id, secArg);
            applyLoadedCancelledLessonsList(cancelledLessonsList.filter((x) => x.id !== existing.id));
            pushAdminHistory({
              label: isEn ? 'Lesson restored' : 'Ders geri alındı',
              sub: `${slot.title} (${slot.date} · ${slot.slotNo}.)`,
              undoType: 'restore_slot',
              undoData: { date: slot.date, slotNo: slot.slotNo, targetProg: prog, reason: existing.reason || '' }
            });
            showToast(isEn ? 'Lesson restored.' : 'Ders iptali kaldırıldı.');
          } else {
            const reasonVal = (document.getElementById('adminSlotQuickReasonInput')?.value || '').trim();
            const saved = await api.saveCancelledLesson({
              date: slot.date,
              slotNo: slot.slotNo,
              targetProg: prog,
              reason: reasonVal
            }, secArg);
            applyLoadedCancelledLessonsList([...cancelledLessonsList.filter((x) => x.id !== saved.id), saved]);
            pushAdminHistory({
              label: isEn ? 'Lesson cancelled' : 'Ders iptal edildi',
              sub: `${slot.title} (${slot.date} · ${slot.slotNo}.)`,
              undoType: 'cancel_slot',
              undoData: { id: saved.id }
            });
            showToast(isEn ? 'Lesson marked as cancelled.' : 'Ders iptal edildi.');
          }
          closeAdminSlotQuickModal();
        } catch (err) {
          console.warn('Quick slot cancel error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        } finally {
          btnAdminSlotQuickToggleCancel.disabled = false;
        }
      });
    }
    const btnAdminSlotQuickOverride = document.getElementById('btnAdminSlotQuickOverride');
    if (btnAdminSlotQuickOverride) {
      btnAdminSlotQuickOverride.addEventListener('click', () => {
        const slot = adminQuickSlotTarget;
        closeAdminSlotQuickModal();
        if (!slot) return;
        (window as any).__INONU_LIVE_EXTRAS__?.openOverrideEditor?.(slot);
      });
    }
    const btnAdminSlotQuickAddPdf = document.getElementById('btnAdminSlotQuickAddPdf');
    if (btnAdminSlotQuickAddPdf) {
      btnAdminSlotQuickAddPdf.addEventListener('click', () => {
        const slot = adminQuickSlotTarget;
        closeAdminSlotQuickModal();
        if (!slot) return;
        adminState.editingMatId = '';
        adminState.matProg = state.lang === 'en' ? 'en' : 'tr';
        openAdminModal();
        switchAdminTab('materials', false);
        setAdminMatSelectedDate(slot.date);
        populateAdminMatSlotSelect(slot.date, slot.slotNo);
        const titleEl = document.getElementById('adminMatTitleInput');
        if (titleEl && !titleEl.value) titleEl.value = slot.title || '';
      });
    }
    const btnAdminSlotQuickAnnounce = document.getElementById('btnAdminSlotQuickAnnounce');
    if (btnAdminSlotQuickAnnounce) {
      btnAdminSlotQuickAnnounce.addEventListener('click', () => {
        const slot = adminQuickSlotTarget;
        closeAdminSlotQuickModal();
        if (!slot) return;
        adminState.editingAnnId = '';
        adminState.annTone = 'warn';
        adminState.annActive = true;
        adminState.annTargetGroup = '';
        adminState.annTargetProg = state.lang === 'en' ? 'en' : 'tr';
        openAdminModal();
        switchAdminTab('announcements', false);
        const tInp = document.getElementById('adminAnnTitleInput');
        const mInp = document.getElementById('adminAnnMsgInput');
        if (tInp) tInp.value = `${slot.title}`;
        if (mInp) {
          mInp.value = state.lang === 'en'
            ? `${slot.date} (${slot.time || ''}) - `
            : `${slot.date} (${slot.time || ''}) dersi hakkında: `;
        }
        syncAdminAnnFormUI(false);
        setTimeout(() => { if (mInp) mInp.focus(); }, 200);
      });
    }

    // Home Announcement Long-Press Context Menu Handlers
    const btnAdminAnnQuickEdit = document.getElementById('btnAdminAnnQuickEdit');
    if (btnAdminAnnQuickEdit) {
      btnAdminAnnQuickEdit.addEventListener('click', () => {
        const ann = adminQuickAnnTarget;
        closeAdminSlotQuickModal();
        if (!ann) return;
        adminState.editingAnnId = ann.id;
        adminState.annTone = ann.tone || 'info';
        adminState.annActive = ann.active !== false;
        adminState.annTargetGroup = ann.targetGroup || '';
        adminState.annTargetProg = ann.targetProg || '';
        adminState.annExpiresAtMs = Number(ann.expiresAtMs) || 0;
        adminState.annPublishAtMs = Number(ann.publishAtMs) || 0;
        openAdminModal();
        switchAdminTab('announcements', false);
        const tInp = document.getElementById('adminAnnTitleInput');
        const mInp = document.getElementById('adminAnnMsgInput');
        const expInp = document.getElementById('adminAnnExpiresInput');
        const pubInp = document.getElementById('adminAnnPublishAtInput');
        if (tInp) tInp.value = ann.title || '';
        if (mInp) mInp.value = ann.message || '';
        if (expInp) expInp.value = formatDateTimeLocalInput(adminState.annExpiresAtMs);
        if (pubInp) pubInp.value = formatDateTimeLocalInput(adminState.annPublishAtMs);
        syncAdminAnnPublishAtDisplay();
        if (ann.targetGroup || ann.targetProg || adminState.annExpiresAtMs > 0 || adminState.annPublishAtMs > 0) {
          setAdminAnnTargetOpen(true);
        }
        syncAdminAnnFormUI(false);
        setTimeout(() => { if (tInp) tInp.focus(); }, 220);
      });
    }
    const btnAdminAnnQuickHide = document.getElementById('btnAdminAnnQuickHide');
    if (btnAdminAnnQuickHide) {
      btnAdminAnnQuickHide.addEventListener('click', async () => {
        const ann = adminQuickAnnTarget;
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!ann || !api || !secret) return;
        btnAdminAnnQuickHide.disabled = true;
        try {
          await api.saveAnnouncement({
            id: ann.id,
            title: ann.title,
            message: ann.message,
            tone: ann.tone || 'info',
            active: false,
            targetGroup: ann.targetGroup || '',
            targetProg: ann.targetProg || '',
            expiresAtMs: Number(ann.expiresAtMs) || 0
          }, secret === 'active' ? undefined : secret);
          activeAnnouncementsList = (activeAnnouncementsList || []).filter((a) => a.id !== ann.id);
          renderDailyAnnouncements();
          closeAdminSlotQuickModal();
          showToast(state.lang === 'en' ? 'Announcement moved to draft.' : 'Duyuru gizlendi (taslağa alındı).');
          void refreshAdminCloudData('announcements');
          void refreshDailyAnnouncements(true);
        } catch (err) {
          console.warn('Quick hide announcement error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        } finally {
          btnAdminAnnQuickHide.disabled = false;
        }
      });
    }
    const btnAdminAnnQuickDelete = document.getElementById('btnAdminAnnQuickDelete');
    if (btnAdminAnnQuickDelete) {
      btnAdminAnnQuickDelete.addEventListener('click', async () => {
        const ann = adminQuickAnnTarget;
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!ann || !api || !secret) return;
        btnAdminAnnQuickDelete.disabled = true;
        try {
          await api.deleteAnnouncement(ann.id, secret === 'active' ? undefined : secret);
          void deleteAnnouncementReadStat(ann.id);
          activeAnnouncementsList = (activeAnnouncementsList || []).filter((a) => a.id !== ann.id);
          adminState.announcements = (adminState.announcements || []).filter((a) => a.id !== ann.id);
          runWithStaggerSuppressed(() => renderDailyAnnouncements());
          renderAdminAnnouncementsList(false);
          closeAdminSlotQuickModal();
          showToast(state.lang === 'en' ? 'Announcement deleted.' : 'Duyuru silindi.');
          void refreshAdminCloudData('announcements');
          void refreshDailyAnnouncements(true);
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          console.warn('Quick delete announcement error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        } finally {
          btnAdminAnnQuickDelete.disabled = false;
        }
      });
    }

    // Exam Card Long-Press Context Menu Handlers (Feature #2)
    const normalizeExamIsoDate = (rawDate) => {
      const s = String(rawDate || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const dmy = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
      return getTodayIso();
    };
    const btnAdminExamQuickEdit = document.getElementById('btnAdminExamQuickEdit');
    if (btnAdminExamQuickEdit) {
      btnAdminExamQuickEdit.addEventListener('click', () => {
        const exam = adminQuickExamTarget;
        closeAdminSlotQuickModal();
        if (!exam) return;
        adminState.editingExamId = exam.managed && exam.examId ? exam.examId : '';
        adminState.examProg = exam.targetProg || (state.lang === 'en' ? 'en' : 'tr');
        openAdminModal();
        switchAdminTab('exams', false);
        const t = document.getElementById('adminExamTitleInput');
        const d = document.getElementById('adminExamDateInput');
        const tm = document.getElementById('adminExamTimeInput');
        const n = document.getElementById('adminExamNoteInput');
        const dispTime = exam.startTime && exam.endTime ? `${exam.startTime}-${exam.endTime}` : (exam.rawTime || '');
        if (t) t.value = exam.title || '';
        if (d) d.value = normalizeExamIsoDate(exam.date);
        if (tm) tm.value = dispTime;
        if (n) n.value = exam.note || '';
        syncAdminExamFormUI(false);
        setTimeout(() => { if (n) n.focus(); }, 220);
      });
    }
    const btnAdminExamQuickAnnounce = document.getElementById('btnAdminExamQuickAnnounce');
    if (btnAdminExamQuickAnnounce) {
      btnAdminExamQuickAnnounce.addEventListener('click', () => {
        const exam = adminQuickExamTarget;
        closeAdminSlotQuickModal();
        if (!exam) return;
        const isEn = state.lang === 'en';
        const dispTime = exam.startTime && exam.endTime ? `${exam.startTime}-${exam.endTime}` : (exam.rawTime || '');
        adminState.editingAnnId = '';
        adminState.annTone = 'warn';
        adminState.annActive = true;
        adminState.annTargetGroup = '';
        adminState.annTargetProg = exam.targetProg || (isEn ? 'en' : 'tr');
        adminState.annExpiresAtMs = 0;
        openAdminModal();
        switchAdminTab('announcements', false);
        const tInp = document.getElementById('adminAnnTitleInput');
        const mInp = document.getElementById('adminAnnMsgInput');
        if (tInp) tInp.value = exam.title || '';
        if (mInp) {
          mInp.value = `${formatDateLong(exam.date)}${dispTime ? ` • ${dispTime}` : ''}${exam.note ? `\n${exam.note}` : ''}`;
        }
        syncAdminAnnFormUI(false);
        setTimeout(() => { if (mInp) mInp.focus(); }, 220);
      });
    }
    const btnAdminExamQuickDelete = document.getElementById('btnAdminExamQuickDelete');
    if (btnAdminExamQuickDelete) {
      btnAdminExamQuickDelete.addEventListener('click', async () => {
        const exam = adminQuickExamTarget;
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!exam || !exam.examId || !api || !secret) return;
        btnAdminExamQuickDelete.disabled = true;
        try {
          await api.deleteExamCountdown(exam.examId, secret === 'active' ? undefined : secret);
          applyLoadedExamCountdownsList(managedExamsList.filter((x) => x.id !== exam.examId));
          closeAdminSlotQuickModal();
          showToast(state.lang === 'en' ? 'Exam deleted.' : 'Sınav silindi.');
        } catch (err) {
          console.warn('Quick delete exam error:', err);
          showToast(I18N[state.lang].adminSaveErrorToast);
        } finally {
          btnAdminExamQuickDelete.disabled = false;
        }
      });
    }

    const adminAnnForm = document.getElementById('adminAnnForm');
    if (adminAnnForm) {
      adminAnnForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const loc = I18N[state.lang];
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        const titleVal = document.getElementById('adminAnnTitleInput').value.trim();
        const msgVal = document.getElementById('adminAnnMsgInput').value.trim();
        if (!titleVal || !msgVal) {
          showToast(loc.adminTitleMsgRequired);
          return;
        }
        const expRaw = document.getElementById('adminAnnExpiresInput')?.value || '';
        const parsedExp = expRaw ? new Date(expRaw).getTime() : 0;
        const expiresAtMs = parsedExp > 0 && !Number.isNaN(parsedExp) ? parsedExp : 0;
        const pubRaw = document.getElementById('adminAnnPublishAtInput')?.value || '';
        const parsedPub = pubRaw ? new Date(pubRaw).getTime() : 0;
        const publishAtMs = parsedPub > 0 && !Number.isNaN(parsedPub) ? parsedPub : 0;
        const btn = document.getElementById('btnAdminAnnSubmit');
        if (btn) btn.disabled = true;
        try {
          const wasNew = !adminState.editingAnnId;
          const savedAnn = await api.saveAnnouncement({
            id: adminState.editingAnnId || undefined,
            title: titleVal,
            message: msgVal,
            tone: adminState.annTone,
            active: adminState.annActive,
            targetGroup: adminState.annTargetGroup || '',
            targetProg: adminState.annTargetProg || '',
            expiresAtMs,
            publishAtMs
          }, secret === 'active' ? undefined : secret);
          if (savedAnn && savedAnn.id) {
            const existingIdx = adminState.announcements.findIndex((a) => a.id === savedAnn.id);
            if (existingIdx >= 0) {
              adminState.announcements[existingIdx] = savedAnn;
            } else {
              adminState.announcements.unshift(savedAnn);
            }
            if (wasNew) {
              pushAdminHistory({
                label: state.lang === 'en' ? 'Announcement published' : 'Duyuru yayınlandı',
                sub: savedAnn.title,
                undoType: 'ann_create',
                undoData: { id: savedAnn.id }
              });
            }
            activeAnnouncementsList = adminState.announcements.filter((a) => a && a.active);
            renderAdminAnnouncementsList();
            renderDailyAnnouncements();
          }
          adminState.editingAnnId = '';
          adminState.annTone = 'info';
          adminState.annActive = true;
          adminState.annTargetGroup = '';
          adminState.annTargetProg = '';
          adminState.annExpiresAtMs = 0;
          adminState.annPublishAtMs = 0;
          document.getElementById('adminAnnTitleInput').value = '';
          document.getElementById('adminAnnMsgInput').value = '';
          const expInp = document.getElementById('adminAnnExpiresInput');
          if (expInp) expInp.value = '';
          const pubInp = document.getElementById('adminAnnPublishAtInput');
          if (pubInp) pubInp.value = '';
          syncAdminAnnPublishAtDisplay();
          syncAdminAnnFormUI();
          showToast(loc.adminAnnSavedToast);
          void refreshAdminCloudData('announcements');
          void refreshDailyAnnouncements(true);
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          console.warn('Announcement save error:', err);
          showToast(loc.adminSaveErrorToast);
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    const btnAdminAnnToggleTarget = document.getElementById('btnAdminAnnToggleTarget');
    if (btnAdminAnnToggleTarget) {
      btnAdminAnnToggleTarget.addEventListener('click', () => {
        setAdminAnnTargetOpen(!adminState.annTargetOpen);
      });
    }

    document.querySelectorAll('[data-admin-students-subtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const subKey = btn.getAttribute('data-admin-students-subtab') || 'roster';
        switchAdminStudentsSubTab(subKey, true);
      });
    });

    const btnAdminToggleGhConfig = document.getElementById('btnAdminToggleGhConfig');
    if (btnAdminToggleGhConfig) {
      btnAdminToggleGhConfig.addEventListener('click', () => {
        setAdminGhConfigOpen(!adminState.ghConfigOpen);
      });
    }

    document.querySelectorAll('[data-ann-list-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.annListFilter = btn.getAttribute('data-ann-list-filter') || '';
        renderAdminAnnouncementsList(true);
      });
    });

    document.querySelectorAll('[data-cancel-prog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextProg = btn.getAttribute('data-cancel-prog') === 'en' ? 'en' : 'tr';
        const dir = nextProg === adminState.cancelProg ? 'none' : (nextProg === 'en' ? 'next' : 'prev');
        adminState.cancelProg = nextProg;
        toggleAdminCancelDatePicker(false);
        syncAdminCancelFormDefaults(true);
        renderAdminCancelDaySlots(dir);
      });
    });

    const btnAdminCancelPrevDay = document.getElementById('btnAdminCancelPrevDay');
    if (btnAdminCancelPrevDay) {
      btnAdminCancelPrevDay.addEventListener('click', () => stepAdminCancelDate(-1));
    }
    const btnAdminCancelNextDay = document.getElementById('btnAdminCancelNextDay');
    if (btnAdminCancelNextDay) {
      btnAdminCancelNextDay.addEventListener('click', () => stepAdminCancelDate(1));
    }

    const btnAdminCancelDateTrigger = document.getElementById('btnAdminCancelDateTrigger');
    if (btnAdminCancelDateTrigger) {
      btnAdminCancelDateTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAdminCancelDatePicker();
      });
    }

    const adminCancelDateSearch = document.getElementById('adminCancelDateSearch');
    if (adminCancelDateSearch) {
      adminCancelDateSearch.addEventListener('input', () => {
        renderAdminCancelDateOptions(adminCancelDateSearch.value || '', true);
      });
    }

    document.querySelectorAll('[data-cancel-list-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.cancelListFilterProg = btn.getAttribute('data-cancel-list-filter') || '';
        renderAdminCancelledList(true);
      });
    });

    const btnCloseInstructorModal = document.getElementById('btnCloseInstructorModal');
    if (btnCloseInstructorModal) {
      btnCloseInstructorModal.addEventListener('click', () => closeInstructorModal());
    }
    const instructorModalEl = document.getElementById('instructorModal');
    if (instructorModalEl) {
      instructorModalEl.addEventListener('click', (e) => {
        if (e.target === instructorModalEl) closeInstructorModal();
      });
    }
    const btnInstructorShowInSearch = document.getElementById('btnInstructorShowInSearch');
    if (btnInstructorShowInSearch) {
      btnInstructorShowInSearch.addEventListener('click', () => {
        const q = activeDetailModalValue || activeInstructorModalName;
        closeInstructorModal();
        if (!q) return;
        const searchInp = document.getElementById('inputSearchQuery');
        if (searchInp) searchInp.value = q;
        switchTab('search');
        renderSearchView();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const instModal = document.getElementById('instructorModal');
        if (instModal && !instModal.classList.contains('hidden')) {
          closeInstructorModal();
        }
      }
    });

    document.querySelectorAll('[data-mat-prog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.matProg = btn.getAttribute('data-mat-prog') === 'en' ? 'en' : 'tr';
        syncAdminMaterialFormDefaults();
        syncAdminSegmentedControl('adminMatProgChips', 'adminMatProgIndicator', 'data-mat-prog', adminState.matProg, true);
      });
    });

    document.querySelectorAll('[data-mat-list-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.matListFilterProg = btn.getAttribute('data-mat-list-filter') || '';
        renderAdminMaterialsList(true);
      });
    });

    document.querySelectorAll('[data-mat-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.matMode = btn.getAttribute('data-mat-mode') === 'url' ? 'url' : 'file';
        syncAdminMaterialModeUI(true);
      });
    });

    const btnAdminMatDateTrigger = document.getElementById('btnAdminMatDateTrigger');
    if (btnAdminMatDateTrigger) {
      btnAdminMatDateTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAdminMatPicker('date');
      });
    }
    const btnAdminMatSlotTrigger = document.getElementById('btnAdminMatSlotTrigger');
    if (btnAdminMatSlotTrigger) {
      btnAdminMatSlotTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAdminMatPicker('slot');
      });
    }
    const adminMatDateSearch = document.getElementById('adminMatDateSearch');
    if (adminMatDateSearch) {
      adminMatDateSearch.addEventListener('input', () => {
        renderAdminMatDateOptions(adminMatDateSearch.value, true);
      });
    }
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      if (
        !target.closest('#adminMatDatePickerPanel') &&
        !target.closest('#btnAdminMatDateTrigger') &&
        !target.closest('#adminMatSlotPickerPanel') &&
        !target.closest('#btnAdminMatSlotTrigger')
      ) {
        toggleAdminMatPicker(null, false);
      }
      if (
        !target.closest('#adminCancelDatePickerPanel') &&
        !target.closest('#btnAdminCancelDateTrigger')
      ) {
        toggleAdminCancelDatePicker(false);
      }
    });

    const adminMatFileInput = document.getElementById('adminMatFileInput');
    if (adminMatFileInput) {
      adminMatFileInput.addEventListener('change', () => {
        const file = adminMatFileInput.files && adminMatFileInput.files[0];
        if (!file) return;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (!isPdf) {
          showToast('Lütfen geçerli bir PDF dosyası seçin.');
          adminMatFileInput.value = '';
          return;
        }
        if (file.size > 250 * 1024 * 1024) {
          showToast('Dosya boyutu en fazla 250 MB olabilir.');
          adminMatFileInput.value = '';
          return;
        }
        adminState.matFileObj = file;
        adminState.matFileData = '';
        adminState.matFileName = file.name;
        adminState.matFileSize = file.size;
        const titleEl = document.getElementById('adminMatTitleInput');
        if (titleEl && !titleEl.value.trim()) {
          titleEl.value = file.name.replace(/\.pdf$/i, '').slice(0, 120);
        }
        // Auto-match lesson slot on the selected date if filename/title matches a course keyword
        try {
          const curDate = document.getElementById('adminMatDateSelect')?.value || state.selectedDate || '';
          const dayObj = getAdminMatScheduleDays().find((d) => d.date === curDate);
          if (dayObj && Array.isArray(dayObj.slots)) {
            const lowerName = (file.name || '').toLocaleLowerCase('tr-TR');
            const keywordToCode = [
              ['biyofizik', 'BF'],
              ['biophysics', 'BF'],
              ['fizyoloji', 'FİZ'],
              ['physiology', 'FİZ'],
              ['histoloji', 'HE'],
              ['embriyoloji', 'HE'],
              ['histology', 'HE'],
              ['biyokimya', 'TB'],
              ['biochemistry', 'TB'],
              ['anatomi', 'ANA'],
              ['anatomy', 'ANA'],
              ['mikrobiyoloji', 'TMB'],
              ['microbiology', 'TMB'],
              ['biyoistatistik', 'Bİ'],
              ['biostatistics', 'Bİ'],
              ['davranış', 'DB'],
              ['tıp tarihi', 'TT'],
              ['tıbbi biyoloji', 'TБ'],
            ];
            let matchedSlot = null;
            for (const [kw, code] of keywordToCode) {
              if (lowerName.includes(kw)) {
                matchedSlot = dayObj.slots.find((s) => String(s.code || '').toUpperCase().includes(code) || String(s.title || '').toLocaleLowerCase('tr-TR').includes(kw));
                if (matchedSlot) break;
              }
            }
            if (!matchedSlot) {
              matchedSlot = dayObj.slots.find((s) => !s.isFree && !s.isSpecial && s.code !== 'MBU');
            }
            if (matchedSlot) {
              populateAdminMatSlotSelect(curDate, matchedSlot.slotNo);
            }
          }
        } catch (e) {}
        setAdminMatUploadProgress(false);
        syncAdminMaterialModeUI();
      });
    }

    const btnClosePdfBanner = document.getElementById('btnClosePdfBanner');
    if (btnClosePdfBanner) {
      btnClosePdfBanner.addEventListener('click', () => closePdfDownloadBanner(true));
    }

    const pdfDownloadOpenLink = document.getElementById('pdfDownloadOpenLink');
    if (pdfDownloadOpenLink) {
      pdfDownloadOpenLink.addEventListener('click', handlePdfBannerOpenClick);
    }
    const pdfDownloadShareBtn = document.getElementById('pdfDownloadShareBtn');
    if (pdfDownloadShareBtn) {
      pdfDownloadShareBtn.addEventListener('click', handlePdfBannerShareClick);
    }

    const btnAdminMatCancelEdit = document.getElementById('btnAdminMatCancelEdit');
    if (btnAdminMatCancelEdit) {
      btnAdminMatCancelEdit.addEventListener('click', () => {
        adminState.editingMatId = '';
        adminState.matFileObj = null;
        adminState.matFileData = '';
        adminState.matFileName = '';
        adminState.matFileSize = 0;
        adminState.matExistingUrl = '';
        adminState.matExistingChunkCount = 0;
        const titleEl = document.getElementById('adminMatTitleInput');
        const urlEl = document.getElementById('adminMatUrlInput');
        if (titleEl) titleEl.value = '';
        if (urlEl) urlEl.value = '';
        if (adminMatFileInput) adminMatFileInput.value = '';
        setAdminMatUploadProgress(false);
        syncAdminMaterialModeUI();
      });
    }

    const adminMaterialForm = document.getElementById('adminMaterialForm');
    if (adminMaterialForm) {
      adminMaterialForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const api = window.__INONU_AUTH__;
        if (!api) {
          showToast('Uygulama modülü yüklenemedi. Sayfayı yenileyin.');
          return;
        }
        const secret = ensureAdminSecretReady();
        if (!secret) return;
        const dateVal = (document.getElementById('adminMatDateSelect')?.value || state.selectedDate || '').trim();
        const slotVal = parseInt(document.getElementById('adminMatSlotSelect')?.value || '1', 10) || 1;
        const targetProg = adminState.matProg === 'en' ? 'en' : 'tr';
        const titleVal = (document.getElementById('adminMatTitleInput')?.value || '').trim();
        const urlVal = (document.getElementById('adminMatUrlInput')?.value || '').trim();
        const isFile = adminState.matMode !== 'url';

        if (!dateVal || !titleVal) {
          showToast('Lütfen ders tarihi, saati ve PDF başlığını girin.');
          return;
        }
        if (isFile && !adminState.matFileObj && !adminState.matFileData && !adminState.matExistingUrl && !(adminState.matExistingChunkCount > 0)) {
          showToast('Lütfen cihazdan bir PDF dosyası seçin veya Web Bağlantısı moduna geçin.');
          return;
        }
        if (!isFile && !urlVal) {
          showToast('Lütfen geçerli bir PDF web bağlantısı (URL) girin.');
          return;
        }

        const btn = document.getElementById('btnAdminMatSubmit');
        if (btn) btn.disabled = true;
        try {
          const explicitSecret = secret === 'active' ? undefined : secret;
          const targetMatId =
            adminState.editingMatId ||
            (typeof api.generateLessonMaterialId === 'function' ? api.generateLessonMaterialId(dateVal, slotVal) : undefined);

          const savePayload = {
            id: targetMatId,
            date: dateVal,
            slotNo: slotVal,
            targetProg,
            title: titleVal,
            sourceType: isFile ? 'file' : 'url',
            pdfUrl: isFile ? '' : urlVal,
            pdfData: isFile ? adminState.matFileData : '',
            chunkCount: 0,
            pdfName: isFile ? (adminState.matFileName || `${titleVal}.pdf`) : titleVal,
            fileSize: adminState.matFileSize || undefined
          };

          if (isFile && adminState.matFileObj) {
            setAdminMatUploadProgress(true, 1, 0, adminState.matFileObj.size, 'Sunucuya yükleniyor...');
            await new Promise((r) => requestAnimationFrame(() => r()));
            const uploaded = await api.uploadLessonPdfFile(
              adminState.matFileObj,
              explicitSecret,
              (pct, loaded, total) => setAdminMatUploadProgress(true, pct, loaded, total, pct >= 95 ? 'Kaydediliyor...' : ''),
              targetMatId
            );
            savePayload.id = uploaded.materialId || targetMatId;
            if (adminState.matExistingUrl && adminState.matExistingUrl.startsWith('/api/lesson-pdf/')) {
              void api.deleteServerPdfByUrl(adminState.matExistingUrl, explicitSecret);
            }
            if (uploaded.fallbackBase64) {
              savePayload.sourceType = 'file';
              savePayload.chunkCount = 0;
              savePayload.pdfUrl = '';
              savePayload.pdfData = uploaded.fallbackBase64;
              savePayload.pdfName = uploaded.fileName;
              savePayload.fileSize = uploaded.size;
            } else if (uploaded.sourceType === 'server' && uploaded.url) {
              savePayload.sourceType = 'server';
              savePayload.chunkCount = 0;
              savePayload.pdfUrl = uploaded.url;
              savePayload.pdfData = '';
              savePayload.pdfName = uploaded.fileName;
              savePayload.fileSize = uploaded.size;
            } else {
              savePayload.sourceType = 'chunks';
              savePayload.chunkCount = uploaded.chunkCount;
              savePayload.pdfUrl = '';
              savePayload.pdfData = '';
              savePayload.pdfName = uploaded.fileName;
              savePayload.fileSize = uploaded.size;
            }
            setAdminMatUploadProgress(true, 100, uploaded.size, uploaded.size, 'Veritabanına kaydediliyor...');
          } else if (isFile && adminState.matExistingChunkCount > 0) {
            savePayload.sourceType = 'chunks';
            savePayload.chunkCount = adminState.matExistingChunkCount;
            savePayload.pdfUrl = '';
            savePayload.pdfData = '';
          } else if (isFile && adminState.matExistingUrl) {
            savePayload.sourceType = adminState.matExistingUrl.startsWith('/api/lesson-pdf/') ? 'server' : 'url';
            savePayload.chunkCount = 0;
            savePayload.pdfUrl = adminState.matExistingUrl;
            savePayload.pdfData = '';
          }

          const savedMat = await api.saveLessonMaterial(savePayload, explicitSecret);
          if (savedMat && savedMat.id) {
            const existingIdx = adminState.materials.findIndex((m) => m.id === savedMat.id);
            if (existingIdx >= 0) {
              adminState.materials[existingIdx] = savedMat;
            } else {
              adminState.materials.push(savedMat);
            }
            applyLoadedLessonMaterialsList(adminState.materials);
            renderAdminMaterialsList();
          }
          adminState.editingMatId = '';
          adminState.matFileObj = null;
          adminState.matFileData = '';
          adminState.matFileName = '';
          adminState.matFileSize = 0;
          adminState.matExistingUrl = '';
          adminState.matExistingChunkCount = 0;
          const titleEl = document.getElementById('adminMatTitleInput');
          const urlEl = document.getElementById('adminMatUrlInput');
          if (titleEl) titleEl.value = '';
          if (urlEl) urlEl.value = '';
          if (adminMatFileInput) adminMatFileInput.value = '';
          setAdminMatUploadProgress(false);
          syncAdminMaterialModeUI();
          showToast(`Ders PDF'i (${targetProg.toUpperCase()}) kaydedildi`);
          void refreshAdminCloudData('materials');
          void refreshLessonMaterials(true);
        } catch (err) {
          console.warn('Lesson material save error:', err);
          setAdminMatUploadProgress(false);
          const rawErr = err instanceof Error ? err.message : String(err || '');
          if (rawErr === 'PDF_TOO_LARGE') {
            showToast('PDF dosyası en fazla 250 MB olabilir.');
          } else {
            showToast('PDF yüklenemedi. Lütfen tekrar deneyin.');
          }
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    document.querySelectorAll('[data-add-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.addGroup = btn.getAttribute('data-add-group') || 'I';
        syncAdminAddStudentChips();
      });
    });
    document.querySelectorAll('[data-add-lab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.addLab = btn.getAttribute('data-add-lab') || '';
        syncAdminAddStudentChips();
      });
    });
    document.querySelectorAll('[data-add-lang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.addLang = btn.getAttribute('data-add-lang') === 'en' ? 'en' : 'tr';
        if (adminState.addLang === 'en') {
          adminState.addLab = '';
        }
        syncAdminAddStudentChips();
      });
    });

    const adminAddSidEl = document.getElementById('adminAddSid');
    if (adminAddSidEl) {
      adminAddSidEl.addEventListener('input', () => {
        adminAddSidEl.value = adminAddSidEl.value.replace(/\D+/g, '').slice(0, 11);
      });
    }
    const adminAddStudentForm = document.getElementById('adminAddStudentForm');
    if (adminAddStudentForm) {
      adminAddStudentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const loc = I18N[state.lang];
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        const sid = api.normalizeStudentId(document.getElementById('adminAddSid').value);
        const fullName = document.getElementById('adminAddName').value.trim();
        if (!/^01\d{9}$/.test(sid)) {
          showToast(loc.authErrFormat);
          return;
        }
        if (!fullName) {
          showToast(loc.adminNameRequired);
          return;
        }
        const btn = document.getElementById('btnAdminSaveNewStudent');
        if (btn) btn.disabled = true;
        try {
          const existsLocally = Array.isArray(adminState.students) && adminState.students.some((st) => st.studentId === sid);
          if (existsLocally) {
            showToast(loc.adminDuplicateStudentToast);
            return;
          }
          if (typeof api.isStudentAlreadyRegistered === 'function') {
            const alreadyRegistered = await api.isStudentAlreadyRegistered(sid);
            if (alreadyRegistered) {
              showToast(loc.adminDuplicateStudentToast);
              return;
            }
          }
          await api.addOrUpdateCustomStudent({
            studentId: sid,
            fullName,
            group: adminState.addGroup,
            labGroup: adminState.addLang === 'en' ? '' : adminState.addLab,
            prog: adminState.addLang,
            active: true
          }, secret === 'active' ? undefined : secret, { rejectIfExists: true });
          document.getElementById('adminAddSid').value = '';
          document.getElementById('adminAddName').value = '';
          adminCloudDirty.students = true;
          await refreshAdminCloudData('students');
          showToast(loc.adminStudentSavedToast);
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          if (err && err.message === 'DUPLICATE_STUDENT_ID') {
            showToast(loc.adminDuplicateStudentToast);
          } else {
            console.warn('Add student error:', err);
            showToast(loc.adminSaveErrorToast);
          }
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    const btnAdminCancelStudentEdit = document.getElementById('btnAdminCancelStudentEdit');
    if (btnAdminCancelStudentEdit) {
      btnAdminCancelStudentEdit.addEventListener('click', () => {
        adminState.editingStudent = null;
        adminState.deleteConfirmStudentHash = '';
        syncAdminStudentEditorUI();
      });
    }
    document.querySelectorAll('[data-edit-mbu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!adminState.editingStudent) return;
        adminState.editingStudent.myMbuGroup = btn.getAttribute('data-edit-mbu') || '';
        syncAdminStudentEditorUI();
      });
    });
    document.querySelectorAll('[data-edit-lab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!adminState.editingStudent) return;
        adminState.editingStudent.myLabGroup = btn.getAttribute('data-edit-lab') || '';
        syncAdminStudentEditorUI();
      });
    });
    document.querySelectorAll('[data-edit-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!adminState.editingStudent) return;
        adminState.editingStudent.otherGroupMode = btn.getAttribute('data-edit-mode') === 'hide' ? 'hide' : 'dim';
        syncAdminStudentEditorUI();
      });
    });
    document.querySelectorAll('[data-edit-lang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!adminState.editingStudent) return;
        const nextLang = btn.getAttribute('data-edit-lang') === 'en' ? 'en' : 'tr';
        adminState.editingStudent.lang = nextLang;
        syncAdminStudentEditorUI();
      });
    });
    const btnAdminEditActiveToggle = document.getElementById('btnAdminEditActiveToggle');
    if (btnAdminEditActiveToggle) {
      btnAdminEditActiveToggle.addEventListener('click', () => {
        if (!adminState.editingStudent) return;
        const api = window.__INONU_AUTH__;
        if (api && typeof api.isAdminStudentHash === 'function' && api.isAdminStudentHash(adminState.editingStudent.authHash)) {
          showToast(I18N[state.lang].adminCannotModifyAdminToast);
          return;
        }
        adminState.editingStudent.active = !adminState.editingStudent.active;
        syncAdminStudentEditorUI();
      });
    }
    const btnAdminSaveStudentEdit = document.getElementById('btnAdminSaveStudentEdit');
    if (btnAdminSaveStudentEdit) {
      btnAdminSaveStudentEdit.addEventListener('click', async () => {
        const loc = I18N[state.lang];
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        if (!adminState.editingStudent) return;
        const target = { ...adminState.editingStudent };
        const editedName = document.getElementById('adminEditNameInput').value.trim();
        const effLang = target.lang === 'en' ? 'en' : 'tr';
        const effLab = target.myLabGroup || '';
        const finalName = editedName || target.fullName;
        const prevStudents = Array.isArray(adminState.students) ? [...adminState.students] : [];

        // Optimistic local update: update in adminState.students immediately
        const targetIndex = adminState.students.findIndex((st) => (
          (target.authHash && st.authHash === target.authHash) ||
          (target.cloudKey && st.cloudKey === target.cloudKey) ||
          (target.studentId && st.studentId === target.studentId)
        ));
        if (targetIndex >= 0) {
          adminState.students[targetIndex] = {
            ...adminState.students[targetIndex],
            fullName: finalName,
            myMbuGroup: target.myMbuGroup,
            myLabGroup: effLab,
            otherGroupMode: target.otherGroupMode,
            lang: effLang,
            source: target.source,
            active: target.active,
            updatedAtMs: Date.now()
          };
        }

        // Instant UI feedback: close card, re-render and show toast with 0ms delay
        adminState.editingStudent = null;
        syncAdminStudentEditorUI();
        renderAdminStudentsList();
        showToast(loc.adminStudentUpdatedToast);

        // Background cloud save (non-blocking)
        try {
          await api.adminSaveStudentSettings({
            cloudKey: target.cloudKey,
            authHash: target.authHash,
            studentId: target.studentId,
            last4: target.last4,
            fullName: finalName,
            myMbuGroup: target.myMbuGroup,
            myLabGroup: effLab,
            otherGroupMode: target.otherGroupMode,
            lang: effLang,
            source: target.source,
            active: target.active
          }, secret === 'active' ? undefined : secret);
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          // Revert optimistic state on unexpected failure
          adminState.students = prevStudents;
          renderAdminStudentsList();
          if (err && err.message === 'CANNOT_DEACTIVATE_ADMIN') {
            showToast(loc.adminCannotModifyAdminToast);
          } else {
            console.warn('Student save error:', err);
            showToast(loc.adminSaveErrorToast);
          }
        }
      });
    }
    const btnAdminDeleteCustomStudent = document.getElementById('btnAdminDeleteCustomStudent');
    if (btnAdminDeleteCustomStudent) {
      btnAdminDeleteCustomStudent.addEventListener('click', async () => {
        const loc = I18N[state.lang];
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret || !adminState.editingStudent) return;
        const hash = adminState.editingStudent.authHash;
        if (!hash) return;
        if (typeof api.isAdminStudentHash === 'function' && api.isAdminStudentHash(hash)) {
          showToast(loc.adminCannotModifyAdminToast);
          return;
        }
        if (adminState.deleteConfirmStudentHash !== hash) {
          adminState.deleteConfirmStudentHash = hash;
          syncAdminStudentEditorUI();
          return;
        }
        adminState.deleteConfirmStudentHash = '';
        const target = { ...adminState.editingStudent };
        const prevStudents = Array.isArray(adminState.students) ? [...adminState.students] : [];

        // Optimistic local deletion: remove immediately from list
        adminState.students = adminState.students.filter((st) => (
          !(target.authHash && st.authHash === target.authHash) &&
          !(target.cloudKey && st.cloudKey === target.cloudKey)
        ));
        adminState.editingStudent = null;
        syncAdminStudentEditorUI();
        renderAdminStudentsList();
        showToast(loc.adminStudentDeletedToast);

        try {
          await api.deleteCustomStudent(
            hash,
            target.cloudKey,
            secret === 'active' ? undefined : secret,
            target
          );
          void queueAutoPushDataJsonToGitHub(false);
        } catch (err) {
          // Revert on failure
          adminState.students = prevStudents;
          renderAdminStudentsList();
          if (err && err.message === 'CANNOT_DELETE_ADMIN') {
            showToast(loc.adminCannotModifyAdminToast);
          } else {
            console.warn('Delete student error:', err);
            showToast(loc.adminSaveErrorToast);
          }
        }
      });
    }

    const adminStudentFilterInput = document.getElementById('adminStudentFilterInput');
    if (adminStudentFilterInput) {
      adminStudentFilterInput.addEventListener('input', renderAdminStudentsList);
    }
    const btnClearAdminStudentFilter = document.getElementById('btnClearAdminStudentFilter');
    if (btnClearAdminStudentFilter) {
      btnClearAdminStudentFilter.addEventListener('click', () => {
        if (adminStudentFilterInput) {
          adminStudentFilterInput.value = '';
          adminStudentFilterInput.focus();
        }
        renderAdminStudentsList();
      });
    }
    document.querySelectorAll('[data-filter-sgroup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminState.studentFilterGroup = btn.getAttribute('data-filter-sgroup') || '';
        renderAdminStudentsList();
      });
    });

    const adminPwdForm = document.getElementById('adminPwdForm');
    if (adminPwdForm) {
      adminPwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const loc = I18N[state.lang];
        const api = window.__INONU_AUTH__;
        const secret = ensureAdminSecretReady();
        if (!api || !secret) return;
        const newPwd = document.getElementById('adminNewPwdInput').value.trim();
        if (newPwd.length < 4) {
          showToast(loc.adminPwdInvalidToast);
          return;
        }
        const btn = document.getElementById('btnAdminSaveNewPwd');
        if (btn) btn.disabled = true;
        try {
          const res = await api.updateAdminPassword(newPwd, secret === 'active' ? undefined : secret);
          if (res.ok) {
            if (res.newWriteSecret) {
              const curSaved = loadStore('authSession', null);
              if (curSaved && typeof curSaved === 'object') {
                saveStore('authSession', { ...curSaved, adminSecret: res.newWriteSecret });
              }
            }
            document.getElementById('adminNewPwdInput').value = '';
            showToast(loc.adminPwdUpdatedToast);
          } else {
            showToast(loc.adminSaveErrorToast);
          }
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    async function setAdminSiteRequireLoginMode(nextVal) {
      const loc = I18N[state.lang];
      const api = window.__INONU_AUTH__;
      const secret = ensureAdminSecretReady();
      if (!api || !secret || typeof api.saveSiteAccessSettings !== 'function') return;

      const prevVal = siteRequireStudentLogin;
      const prevTs = siteAccessUpdatedAtMs;
      const nowTs = Math.max(Date.now(), prevTs + 1);
      siteRequireStudentLogin = Boolean(nextVal);
      siteAccessUpdatedAtMs = nowTs;
      saveStore('siteRequireLoginCache', siteRequireStudentLogin);
      saveStore('siteAccessUpdatedAtMs', siteAccessUpdatedAtMs);
      syncAdminSiteAccessUI();
      syncSiteAccessGateUI();
      showToast(siteRequireStudentLogin ? loc.adminSiteAccessToastLocked : loc.adminSiteAccessToastPublic);

      const toggleBtn = document.getElementById('btnToggleSiteRequireLogin');
      if (toggleBtn) toggleBtn.disabled = true;
      try {
        const saved = await api.saveSiteAccessSettings(siteRequireStudentLogin, secret === 'active' ? undefined : secret);
        if (saved && typeof saved === 'object') {
          applySiteAccessSettings(saved);
        }
        pushAdminHistory({
          label: siteRequireStudentLogin
            ? (state.lang === 'en' ? 'Site locked (login required)' : 'Site kilidi açıldı (giriş zorunlu)')
            : (state.lang === 'en' ? 'Site unlocked (public access)' : 'Site kilidi kapatıldı (herkese açık)'),
          undoType: 'site_lock',
          undoData: { prevVal }
        });
        void queueAutoPushDataJsonToGitHub(true);
      } catch (err) {
        siteRequireStudentLogin = prevVal;
        siteAccessUpdatedAtMs = prevTs;
        saveStore('siteRequireLoginCache', prevVal);
        saveStore('siteAccessUpdatedAtMs', prevTs);
        syncAdminSiteAccessUI();
        syncSiteAccessGateUI();
        console.warn('Site access toggle save error:', err);
        showToast(loc.adminSaveErrorToast);
      } finally {
        if (toggleBtn) toggleBtn.disabled = false;
      }
    }

    const btnToggleSiteRequireLogin = document.getElementById('btnToggleSiteRequireLogin');
    if (btnToggleSiteRequireLogin) {
      btnToggleSiteRequireLogin.addEventListener('click', () => {
        void setAdminSiteRequireLoginMode(!siteRequireStudentLogin);
      });
    }

    const btnAdminSyncRemoteDataJson = document.getElementById('btnAdminSyncRemoteDataJson');
    if (btnAdminSyncRemoteDataJson) {
      btnAdminSyncRemoteDataJson.addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const loc = I18N[state.lang];
        if (!api || typeof api.syncStaticCacheWithRemoteDataJson !== 'function') return;
        btnAdminSyncRemoteDataJson.disabled = true;
        try {
          const ok = await api.syncStaticCacheWithRemoteDataJson();
          await refreshAdminCloudData('all', { includeAccess: true, markAllDirty: true });
          await refreshDailyAnnouncements(true);
          showToast(ok ? loc.adminDataJsonSyncedToast : loc.adminDataJsonSyncEmptyToast);
        } finally {
          btnAdminSyncRemoteDataJson.disabled = false;
        }
      });
    }

    const ghPersistInputs = ['adminGhRepoInput', 'adminGhBranchInput', 'adminGhPathInput', 'adminGhTokenInput'];
    ghPersistInputs.forEach((inputId) => {
      const el = document.getElementById(inputId);
      if (el) {
        el.addEventListener('input', () => {
          saveGhPublishConfig(readLiveGhPublishConfig());
        });
      }
    });

    const btnAdminPushGitHubDataJson = document.getElementById('btnAdminPushGitHubDataJson');
    if (btnAdminPushGitHubDataJson) {
      btnAdminPushGitHubDataJson.addEventListener('click', async () => {
        const api = window.__INONU_AUTH__;
        const loc = I18N[state.lang];
        if (!api || typeof api.publishDataJsonToGitHub !== 'function') return;
        const liveCfg = readLiveGhPublishConfig();
        if (!isValidGhOrGistConfig(liveCfg)) {
          showToast(loc.adminDataJsonGhMissingToast);
          return;
        }
        saveGhPublishConfig(liveCfg);
        btnAdminPushGitHubDataJson.disabled = true;
        try {
          const cleanRepo = liveCfg.repo.trim();
          const isGist = isGistInput(cleanRepo);
          const parts = cleanRepo.split('/').map((s) => s.trim()).filter(Boolean);
          await api.publishDataJsonToGitHub({
            owner: isGist ? '' : (parts[0] || ''),
            repo: cleanRepo,
            branch: liveCfg.branch,
            path: liveCfg.path,
            token: liveCfg.token,
          });
          showToast(loc.adminDataJsonGhPushedToast);
        } catch (err) {
          console.warn('GitHub data.json push failed:', err);
          showToast(loc.adminDataJsonGhErrorToast);
        } finally {
          btnAdminPushGitHubDataJson.disabled = false;
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const dtModal = document.getElementById('adminDateTimeModal');
        if (dtModal && !dtModal.classList.contains('hidden')) {
          closeAdminDateTimeModal();
          return;
        }
        const quickModal = document.getElementById('adminSlotQuickModal');
        if (quickModal && !quickModal.classList.contains('hidden')) {
          closeAdminSlotQuickModal();
          return;
        }
        toggleAdminMatPicker(null, false);
        toggleAdminCancelDatePicker(false);
        closeSettingsMenu();
        closePaletteModal();
        closeAdminModal();
        closeAuthModal();
        closeFoodPhotoModal();
        closeFoodDateModal();
        closeNoteModal();
        closeLessonPdfsModal();
        closeGroupModal();
        closeInstallModal();
      }
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (!checkIsStandalone()) {
        try { localStorage.removeItem('inonu_pwa_installed'); } catch (err) {}
        showInstallUI();
        if (installActionWrap) {
          installActionWrap.classList.remove('hidden');
        }
      }
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      try { localStorage.setItem('inonu_pwa_installed', 'true'); } catch (err) {}
      hideInstallUI();
    });

    if (btnInstallApp) {
      btnInstallApp.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        await deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          deferredInstallPrompt = null;
          try { localStorage.setItem('inonu_pwa_installed', 'true'); } catch (err) {}
          hideInstallUI();
        }
      });
    }

    window.addEventListener('online', () => {
      updateOfflineBannerUI();
      showToast(t('onlineToast'));
      const api = window.__INONU_AUTH__;
      if (api && typeof api.flushPendingStudentPrefsSync === 'function') {
        void api.flushPendingStudentPrefsSync();
      }
      void verifyActiveStudentSessionNow();
      void syncActiveStudentCloudPrefs(false);
      if (state.activeTab === 'food') {
        void renderFoodView(true);
      }
    });
    window.addEventListener('offline', () => {
      updateOfflineBannerUI();
      showToast(t('offlineToast'));
    });
    window.addEventListener('inonu-read-stats-changed', () => {
      const modal = document.getElementById('adminModal');
      if (modal && !modal.classList.contains('hidden') && adminState.activeTab === 'announcements') {
        renderAdminAnnouncementsList(false);
      }
    });
    window.addEventListener('inonu-cloud-synced', () => {
      updateOfflineBannerUI();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void verifyActiveStudentSessionNow();
      }
    });

    window.addEventListener('resize', () => {
      updateTabIndicator(state.activeTab, false);
      updateSegmentedIndicator(
        document.getElementById('langSegmentedBar'),
        document.getElementById('langSegmentedIndicator'),
        state.lang === 'tr' ? document.getElementById('btnLangTr') : document.getElementById('btnLangEn'),
        false
      );
      updateSegmentedIndicator(
        document.getElementById('authLangSegmentedBar'),
        document.getElementById('authLangSegmentedIndicator'),
        state.lang === 'tr' ? document.getElementById('btnAuthLangTr') : document.getElementById('btnAuthLangEn'),
        false
      );
      const days = getScheduleDays();
      const curDay = days.find((d) => d.date === state.selectedDate);
      if (state.activeTab === 'daily') {
        const todayTarget = getBestDefaultDate();
        const tomTarget = getTomorrowTargetDate();
        const activeBannerBtn = state.selectedDate === todayTarget
          ? document.getElementById('btnBannerToday')
          : (state.selectedDate === tomTarget ? document.getElementById('btnBannerTomorrow') : null);
        updateSegmentedIndicator(
          document.getElementById('dailyBannerSegmentedBar'),
          document.getElementById('dailyBannerSegmentedIndicator'),
          activeBannerBtn,
          false
        );
      }
      if (state.activeTab === 'weekly') {
        const activeKBtn = state.weeklyFilterKurul === '1'
          ? document.getElementById('btnFilterKurul1')
          : (state.weeklyFilterKurul === '2' ? document.getElementById('btnFilterKurul2') : document.getElementById('btnFilterKurulAll'));
        updateSegmentedIndicator(
          document.getElementById('weeklyKurulSegmentedBar'),
          document.getElementById('weeklyKurulSegmentedIndicator'),
          activeKBtn,
          false
        );
        const pillsEl = document.getElementById('weekSelectorPills');
        const weekIndEl = document.getElementById('weekSelectorIndicator');
        const activeWeekPill = pillsEl && Array.from(pillsEl.querySelectorAll('button')).find((b) => b.classList.contains('text-white'));
        updateSegmentedIndicator(pillsEl, weekIndEl, activeWeekPill || null, false, 'segmented-pill-indicator-blue');
      }
      if (state.activeTab === 'food') {
        updateSegmentedIndicator(
          document.getElementById('foodModeSegmentedBar'),
          document.getElementById('foodModeSegmentedIndicator'),
          state.foodViewMode === 'weekly' ? document.getElementById('btnFoodModeWeekly') : document.getElementById('btnFoodModeDaily'),
          false
        );
      }
      const adminModalEl = document.getElementById('adminModal');
      if (adminModalEl && !adminModalEl.classList.contains('hidden')) {
        syncAllAdminSegmentedIndicators(false);
      }
      const carousel = document.getElementById('weekCarousel');
      if (curDay && carousel.clientWidth > 0) {
        const weeks = getUniqueWeeks();
        const idx = weeks.findIndex((w) => w.key === `${curDay.kurulNo}-${curDay.haftaNo}`);
        if (idx >= 0) carousel.scrollLeft = idx * carousel.clientWidth;
      }
      const foodCarousel = document.getElementById('foodWeekCarousel');
      if (foodCarousel && foodCarousel.clientWidth > 0 && state.foodDateISO) {
        const foodWeeks = getFoodCarouselWeeks(state.foodDateISO);
        const activeMon = getWeekdaysForISO(state.foodDateISO)[0].iso;
        const fIdx = foodWeeks.findIndex((w) => w[0].iso === activeMon);
        if (fIdx >= 0) foodCarousel.scrollLeft = fIdx * foodCarousel.clientWidth;
      }
    });

    let navScrollPersistTimer = null;
    window.addEventListener('scroll', () => {
      if (!navStateReady) return;
      clearTimeout(navScrollPersistTimer);
      navScrollPersistTimer = setTimeout(persistNavViewState, 220);
    }, { passive: true });
    window.addEventListener('pagehide', persistNavViewState);
    window.addEventListener('beforeunload', persistNavViewState);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persistNavViewState();
    });

    const initialScrollY = (savedNav && typeof savedNav.scrollY === 'number' && savedNav.scrollY > 0) ? savedNav.scrollY : 0;
    navStateReady = true;
    hydrateCachedLessonMaterials();
    switchTab(restoredTab, false, true);
    updateAuthSessionSummary();
    syncAdminSiteAccessUI();
    syncSiteAccessGateUI();
    syncActiveStudentCloudPrefs();
    refreshDailyAnnouncements(true);
    void refreshLessonMaterials(true);
    requestAnimationFrame(() => {
      if (!isSiteLoginLocked()) {
        updateTabIndicator(restoredTab, false);
      }
      if (initialScrollY > 0 && !isSiteLoginLocked()) {
        window.scrollTo(0, initialScrollY);
        updateHeaderScrollState();
      }
    });

    let inonuAuthHooksBound = false;
    let announcementsUnsub = null;

    function bindInonuAuthHooks() {
      const api = window.__INONU_AUTH__;
      if (!api || inonuAuthHooksBound) return;
      inonuAuthHooksBound = true;
      const session = getActiveAuthSession();
      if (session && session.isAdmin && session.adminSecret && typeof api.setAdminWriteSecret === 'function') {
        api.setAdminWriteSecret(session.adminSecret);
      }
      updateAuthSessionSummary();
      syncActiveStudentAccountWatch();
      syncStudentPrefsCloudSubscription();
      syncActiveStudentCloudPrefs();
      refreshDailyAnnouncements(true);
      void refreshCancelledLessons();
      void refreshLessonMaterials(true);
      if (typeof api.subscribeAnnouncements === 'function' && !announcementsUnsub) {
        announcementsUnsub = api.subscribeAnnouncements((list) => {
          activeAnnouncementsList = Array.isArray(list) ? list : [];
          announcementsInitialFetchDone = true;
          runWithStaggerSuppressed(() => renderDailyAnnouncements());
          const adminModalEl = document.getElementById('adminModal');
          if (adminModalEl && !adminModalEl.classList.contains('hidden')) {
            void api.listAllAnnouncements().then((allAnns) => {
              if (Array.isArray(allAnns)) {
                adminState.announcements = allAnns;
                renderAdminAnnouncementsList();
              }
            }).catch(() => {});
          }
        });
      }
      if (typeof api.subscribeCancelledLessons === 'function' && !cancelledLessonsUnsub) {
        cancelledLessonsUnsub = api.subscribeCancelledLessons((list) => {
          applyLoadedCancelledLessonsList(list);
        });
      }
      if (typeof api.subscribeExamCountdowns === 'function' && !examCountdownsUnsub) {
        examCountdownsUnsub = api.subscribeExamCountdowns((list) => {
          applyLoadedExamCountdownsList(list);
        });
      }
      if (typeof api.subscribeLessonMaterials === 'function' && !lessonMaterialsUnsub) {
        lessonMaterialsUnsub = api.subscribeLessonMaterials((list) => {
          applyLoadedLessonMaterialsList(list);
        });
      }
      if (typeof api.loadSiteAccessSettings === 'function') {
        api.loadSiteAccessSettings()
          .then((settings) => applySiteAccessSettings(settings))
          .catch(() => {});
      }
      if (typeof api.subscribeSiteAccessSettings === 'function' && !siteAccessSettingsUnsub) {
        siteAccessSettingsUnsub = api.subscribeSiteAccessSettings((settings) => {
          applySiteAccessSettings(settings);
        });
      }
    }

    // ==================== ELASTIC PULL-TO-REFRESH (DAILY & FOOD) ====================
    function setupPullToRefresh() {
      const mainEl = document.getElementById('appMain');
      const indicator = document.getElementById('ptrIndicator');
      const ringEl = document.getElementById('ptrRingProgress');
      const labelEl = document.getElementById('ptrLabel');
      if (!mainEl || !indicator || !ringEl || !labelEl) return;

      const CIRCUMFERENCE = 69.115;
      const THRESHOLD = 60;
      let startY = 0;
      let startX = 0;
      let pulling = false;
      let refreshing = false;
      let thresholdHapticFired = false;
      let currentPull = 0;

      const isAnyModalOpen = () => {
        if (document.documentElement.classList.contains('modal-open')) return true;
        return Boolean(document.querySelector('.ios-safe-modal:not(.hidden)'));
      };

      const resetIndicator = () => {
        indicator.classList.add('is-settling');
        indicator.classList.remove('is-refreshing', 'is-done');
        indicator.style.height = '0px';
        indicator.style.opacity = '0';
        ringEl.style.strokeDashoffset = String(CIRCUMFERENCE);
        currentPull = 0;
      };

      mainEl.addEventListener('touchstart', (e) => {
        if (refreshing || e.touches.length !== 1) return;
        if (state.activeTab !== 'daily' && state.activeTab !== 'food') return;
        if (window.scrollY > 2 || isAnyModalOpen()) return;
        const target = e.target;
        if (target && target.closest && target.closest('input, textarea, select, .snap-x, [data-no-ptr]')) return;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        pulling = true;
        thresholdHapticFired = false;
        currentPull = 0;
        indicator.classList.remove('is-settling', 'is-refreshing', 'is-done');
      }, { passive: true });

      mainEl.addEventListener('touchmove', (e) => {
        if (!pulling || refreshing || e.touches.length !== 1) return;
        const dy = e.touches[0].clientY - startY;
        const dx = e.touches[0].clientX - startX;
        if (dy <= 0 || window.scrollY > 2) {
          if (currentPull > 0) resetIndicator();
          pulling = false;
          return;
        }
        // Cancel immediately on horizontal swipe (e.g. carousels)
        if (Math.abs(dx) > Math.abs(dy) * 1.1 && currentPull < 10) {
          pulling = false;
          return;
        }
        if (dy > 8 && e.cancelable) {
          e.preventDefault();
        }
        const pullPx = Math.min(92, Math.pow(dy, 0.85) * 1.15);
        currentPull = pullPx;
        const progress = Math.min(1, pullPx / THRESHOLD);
        const loc = I18N[state.lang];
        indicator.style.height = `${Math.round(pullPx)}px`;
        indicator.style.opacity = String(Math.min(1, pullPx / 32));
        ringEl.style.strokeDashoffset = String((CIRCUMFERENCE * (1 - progress)).toFixed(2));
        labelEl.textContent = progress >= 1 ? loc.ptrRelease : loc.ptrPull;
        if (progress >= 1 && !thresholdHapticFired) {
          thresholdHapticFired = true;
          triggerHaptic('light');
        } else if (progress < 0.92 && thresholdHapticFired) {
          thresholdHapticFired = false;
        }
      }, { passive: false });

      const finishGesture = async () => {
        if (!pulling || refreshing) return;
        pulling = false;
        if (currentPull < THRESHOLD) {
          resetIndicator();
          return;
        }
        refreshing = true;
        const loc = I18N[state.lang];
        indicator.classList.add('is-settling', 'is-refreshing');
        indicator.style.height = '54px';
        indicator.style.opacity = '1';
        labelEl.textContent = loc.ptrRefreshing;

        const minSpinnerDelay = new Promise((r) => setTimeout(r, 380));
        try {
          if (state.activeTab === 'daily') {
            await Promise.all([
              refreshDailyAnnouncements(true),
              refreshLessonMaterials(true),
              minSpinnerDelay,
            ]);
          } else if (state.activeTab === 'food') {
            await Promise.all([
              renderFoodView(true),
              loadFoodAnnouncementsOnce(true),
              minSpinnerDelay,
            ]);
          }
        } catch {}

        indicator.classList.remove('is-refreshing');
        indicator.classList.add('is-done');
        labelEl.textContent = I18N[state.lang].ptrDone;
        triggerHaptic('medium');
        setTimeout(() => {
          resetIndicator();
          refreshing = false;
        }, 560);
      };

      mainEl.addEventListener('touchend', () => { void finishGesture(); }, { passive: true });
      mainEl.addEventListener('touchcancel', () => {
        pulling = false;
        if (!refreshing) resetIndicator();
      }, { passive: true });
    }

    updateOfflineBannerUI();
    setupPullToRefresh();
    void refreshPdfCacheStatsUI(false);

    if (window.__INONU_AUTH__) {
      bindInonuAuthHooks();
    }
    window.addEventListener('inonu-auth-ready', bindInonuAuthHooks);
    window.addEventListener('online', () => {
      void refreshLessonMaterials(true);
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => updateTabIndicator(state.activeTab, false));
    }

    (window as any).__INONU_BRIDGE__ = {
      getState: () => ({
        lang: state.lang === 'en' ? 'en' : 'tr',
        activeTab: state.activeTab,
        darkMode: !!state.darkMode,
        selectedDate: state.selectedDate,
        myMbuGroup: state.myMbuGroup || '',
        myLabGroup: state.myLabGroup || '',
        foodDateISO: state.foodDateISO || '',
        foodViewMode: state.foodViewMode || 'daily',
      }),
      getSession: () => {
        const s = getActiveAuthSession();
        if (!s) return null;
        return {
          hash: s.hash,
          last4: s.last4,
          name: s.name,
          group: s.group,
          prog: s.prog,
          isAdmin: Boolean(s.isAdmin),
        };
      },
      openAuthModal: () => openAuthModal(false),
      loginWithStudentId: async (studentId: string, adminPassword?: string) => {
        const api = window.__INONU_AUTH__;
        if (!api) return { ok: false, error: 'Auth hazır değil.' };
        const cleaned = api.normalizeStudentId(studentId || '');
        if (!cleaned) return { ok: false, error: 'Geçerli bir öğrenci numarası girin.' };
        const isAdminAttempt = typeof api.isAdminStudentId === 'function' && api.isAdminStudentId(cleaned);
        let verifiedAdminSecret = '';
        if (isAdminAttempt) {
          if (!adminPassword) {
            return { ok: false, needAdminPassword: true };
          }
          if (typeof api.verifyAndUnlockAdmin === 'function') {
            const res = await api.verifyAndUnlockAdmin(adminPassword);
            if (!res || !res.ok) return { ok: false, error: 'Yönetici şifresi hatalı.' };
            verifiedAdminSecret = res.writeSecret || '';
          } else if (typeof api.verifyAdminPassword === 'function') {
            const ok = await api.verifyAdminPassword(adminPassword);
            if (!ok) return { ok: false, error: 'Yönetici şifresi hatalı.' };
          }
        }
        let match: any = null;
        if (typeof api.checkStudentLoginStatus === 'function') {
          const stRes = await api.checkStudentLoginStatus(cleaned);
          if (stRes && stRes.ok) match = stRes.match;
        } else if (typeof api.lookupStudentWithCloud === 'function') {
          match = await api.lookupStudentWithCloud(cleaned);
        } else if (typeof api.verifyStudentId === 'function') {
          match = api.verifyStudentId(cleaned);
        }
        if (!match) return { ok: false, error: 'Öğrenci numarası sistemde bulunamadı.' };
        const cloudKey = typeof api.deriveCloudDocId === 'function'
          ? await api.deriveCloudDocId(cleaned).catch(() => '')
          : '';
        if (match.prog === 'tr' || match.prog === 'en') {
          state.lang = match.prog;
          saveStore('lang', state.lang);
        }
        state.myMbuGroup = match.group || state.myMbuGroup || '';
        saveStore('myMbuGroup', state.myMbuGroup);
        saveStore('authSession', {
          hash: match.hash,
          cloudKey,
          last4: match.last4,
          group: match.group,
          prog: match.prog,
          name: match.name,
          source: match.source === 'custom' ? 'custom' : 'allowlist',
          isAdmin: Boolean(isAdminAttempt || match.isAdmin),
          adminSecret: (isAdminAttempt && verifiedAdminSecret) ? verifiedAdminSecret : '',
          at: Date.now()
        });
        cloudStartupSyncDoneForHash = match.hash;
        syncSiteAccessGateUI();
        syncActiveStudentAccountWatch();
        syncStudentPrefsCloudSubscription();
        refreshAllVisibleTabsAfterAuthChange();
        void refreshDailyAnnouncements(true);
        void refreshLessonMaterials(true);
        return { ok: true };
      },
      isAdmin: () => Boolean(getActiveAuthSession()?.isAdmin),
      isSiteLocked: () => isSiteLoginLocked(),
      switchTab: (tabName: string) => switchTab(tabName, true),
      jumpToToday: () => {
        state.selectedDate = getBestDefaultDate();
        switchTab('daily', true);
      },
      openDailyDateModal: () => openDailyDateModal(),
      openGroupModal: () => openGroupModal(),
      openSettingsMenu: () => openSettingsMenu(),
      openAdminModal: (tabKey?: string) => {
        if (!getActiveAuthSession()?.isAdmin) return false;
        openAdminModal();
        if (tabKey) switchAdminTab(tabKey, false);
        return true;
      },
      switchAdminTab: (tabKey: string, animate: boolean = true) => switchAdminTab(tabKey, animate),
      triggerAdminQuickAction: (action: 'urgent-ann' | 'cancel-today') => {
        if (!getActiveAuthSession()?.isAdmin) return false;
        openAdminModal();
        const id = action === 'urgent-ann' ? 'btnAdminQuickUrgentAnn' : 'btnAdminQuickCancelToday';
        document.getElementById(id)?.click();
        return true;
      },
      toggleDarkMode: () => {
        state.darkMode = !state.darkMode;
        saveStore('darkMode', state.darkMode);
        applyTheme(true);
        syncSettingsMenuUI(true);
        saveCurrentStudentPrefs(true);
        window.dispatchEvent(new CustomEvent('inonu-ui-sync'));
      },
      triggerHaptic: (kind: string = 'light') => triggerHaptic(kind),
      showToast: (msg: string) => showToast(msg),
      syncModalScrollLock: () => syncModalScrollLock(),
      refreshDailyView: () => {
        lastDailyRenderSig = '';
        if (state.activeTab === 'daily') renderDailyView();
      },
      getScheduleDays: (prog?: 'tr' | 'en') => {
        if (prog === 'en') return SCHEDULE_DAYS_EN;
        if (prog === 'tr') return SCHEDULE_DAYS_TR;
        return getScheduleDays();
      },
      getAllMaterials: () => {
        const flat: any[] = lessonMaterialsMap ? Object.values(lessonMaterialsMap).flat() : [];
        const seen = new Set<string>();
        const daysTr = SCHEDULE_DAYS_TR || [];
        const daysEn = SCHEDULE_DAYS_EN || [];
        const lookupSlot = (date: string, slotNo: number, prog: string) => {
          const src = prog === 'en' ? daysEn : daysTr;
          const d = src.find((x: any) => x.date === date);
          return d ? d.slots.find((s: any) => Number(s.slotNo) === Number(slotNo)) : null;
        };
        const out: any[] = [];
        for (const m of flat) {
          if (!m || !m.id || seen.has(m.id)) continue;
          seen.add(m.id);
          const prog = m.targetProg === 'en' ? 'en' : 'tr';
          const slot = lookupSlot(m.date, m.slotNo, prog);
          out.push({
            ...m,
            targetProg: prog,
            cached: isPdfCachedOnDevice(m.id),
            lessonTitle: slot?.title || '',
            lessonCode: slot?.code || '',
            instructor: slot?.instructor || '',
          });
        }
        return out;
      },
      openMaterial: (mat: any) => {
        if (mat) openOrDownloadLessonMaterial(mat);
      },
      openDateTimePicker: (opts: any) => openAdminDateTimeModal(opts),
      getLiveSummary: () => {
        const todayStr = formatDMY(getTodayDateObj());
        const days = getScheduleDays();
        const todayObj = days.find((d) => d.date === todayStr) || null;
        const nowTime = getCurrentActiveTimeString();
        let liveSlot: any = null;
        let nextSlot: any = null;
        if (todayObj && Array.isArray(todayObj.slots)) {
          const filtered = filterSlotsForGroupPreference(todayObj.slots);
          const visibleSlots = Array.isArray(filtered?.visibleSlots) ? filtered.visibleSlots : todayObj.slots;
          for (const slot of visibleSlots) {
            if (getCancelledLessonInfo(slot)) continue;
            if (isSlotCurrentlyLive(slot)) {
              liveSlot = slot;
              break;
            }
            if (!nextSlot && slot.start && slot.start > nowTime) {
              nextSlot = slot;
            }
          }
        }
        const todayIso = getTodayIso();
        const prog = state.lang === 'en' ? 'en' : 'tr';
        const upcomingExams = (Array.isArray(managedExamsList) ? managedExamsList : [])
          .filter((ex: any) => ex && ex.date && ex.date >= todayIso && (!ex.program || ex.program === prog))
          .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
        const nextExam = upcomingExams[0] || null;
        let nextExamDays: number | null = null;
        if (nextExam && nextExam.date) {
          const t0 = new Date(todayIso + 'T00:00:00').getTime();
          const t1 = new Date(nextExam.date + 'T00:00:00').getTime();
          if (Number.isFinite(t0) && Number.isFinite(t1)) {
            nextExamDays = Math.max(0, Math.round((t1 - t0) / 86400000));
          }
        }
        return {
          todayStr,
          liveSlot: liveSlot ? { title: liveSlot.title, start: liveSlot.start, end: liveSlot.end, location: liveSlot.location || '', instructor: liveSlot.instructor || '' } : null,
          nextSlot: nextSlot ? { title: nextSlot.title, start: nextSlot.start, end: nextSlot.end, location: nextSlot.location || '', instructor: nextSlot.instructor || '' } : null,
          nextExam: nextExam ? { title: nextExam.title, date: nextExam.date, time: nextExam.time || '', daysLeft: nextExamDays } : null,
        };
      },
    };
    window.addEventListener('inonu-schedule-extras-changed', () => {
      lastDailyRenderSig = '';
      if (state.activeTab === 'daily') renderDailyView();
    });
    setInterval(() => {
      if ((activeAnnouncementsList || []).some((a) => a && a.publishAtMs && Number(a.publishAtMs) > 0)) {
        runWithStaggerSuppressed(() => renderDailyAnnouncements());
      }
    }, 30000);
    window.dispatchEvent(new CustomEvent('inonu-bridge-ready'));
  });
}
