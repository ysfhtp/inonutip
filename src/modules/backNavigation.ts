import { getBridge } from './bridge.ts';

interface InonuHistoryState {
  __inonuNav?: boolean;
  __inonuDepth?: number;
  [key: string]: unknown;
}

let initialized = false;
let handlingPopstate = false;
let lastExitPromptAt = 0;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function getCurrentDepth(): number {
  const st = window.history.state as InonuHistoryState | null;
  if (st && st.__inonuNav && typeof st.__inonuDepth === 'number' && Number.isFinite(st.__inonuDepth)) {
    return Math.max(0, Math.floor(st.__inonuDepth));
  }
  return 0;
}

function isStandardModalOpen(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  return (
    !el.classList.contains('hidden') &&
    !el.classList.contains('modal-backdrop-out') &&
    !el.classList.contains('is-leaving')
  );
}

function isModuleOverlayOpen(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  return !el.classList.contains('hidden') && el.getAttribute('aria-hidden') !== 'true';
}

function isPanelOpen(id: string): boolean {
  const el = document.getElementById(id);
  return Boolean(el && !el.classList.contains('hidden'));
}

function isAnyAdminInlinePickerOpen(): boolean {
  return (
    isPanelOpen('adminMatDatePickerPanel') ||
    isPanelOpen('adminMatSlotPickerPanel') ||
    isPanelOpen('adminCancelDatePickerPanel') ||
    isPanelOpen('adminOvSlotPickerPanel')
  );
}

function closeAdminOvSlotPicker(): boolean {
  const panel = document.getElementById('adminOvSlotPickerPanel');
  if (!panel || panel.classList.contains('hidden')) return false;
  panel.classList.add('hidden');
  const trigger = document.getElementById('btnAdminOvSlotTrigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  const chev = document.getElementById('iconAdminOvSlotChevron') as HTMLElement | null;
  if (chev) chev.style.transform = '';
  return true;
}

/**
 * True when the entire app is hard-blocked by Maintenance Gate or mandatory Login Gate.
 * In these states we should NOT trap the user's back button.
 */
function isHardBlocked(): boolean {
  if (isModuleOverlayOpen('maintenanceGateOverlay')) return true;
  const bridge = getBridge();
  if (bridge?.isSiteLocked() && isStandardModalOpen('authGate')) return true;
  return false;
}

/**
 * Counts all currently active dismissible UI layers (pickers, modals, admin sub-pane, non-home tab).
 */
function getActiveLayerCount(): number {
  if (isHardBlocked()) return 0;
  const bridge = getBridge();
  let count = 0;

  if (isModuleOverlayOpen('animeWelcomeOverlay')) count++;
  if (isStandardModalOpen('adminDateTimeModal')) count++;
  if (isStandardModalOpen('adminSlotQuickModal')) count++;
  if (isAnyAdminInlinePickerOpen()) count++;
  if (isModuleOverlayOpen('studentFeedbackModal')) count++;
  if (isModuleOverlayOpen('pdfArchiveModal')) count++;
  if (isStandardModalOpen('foodPhotoModal')) count++;
  if (isStandardModalOpen('instructorModal')) count++;
  if (isStandardModalOpen('lessonPdfsModal')) count++;
  if (isStandardModalOpen('noteModal')) count++;
  if (isStandardModalOpen('dailyDateModal')) count++;
  if (isStandardModalOpen('foodDateModal')) count++;
  if (isStandardModalOpen('groupModal')) count++;
  if (isStandardModalOpen('paletteModal')) count++;
  if (isStandardModalOpen('settingsMenuModal')) count++;
  if (isStandardModalOpen('installModal')) count++;
  if (isStandardModalOpen('authGate') && !bridge?.isSiteLocked()) count++;

  if (isStandardModalOpen('adminModal')) {
    count++;
    const adminTab = bridge?.getAdminActiveTab() || 'hub';
    if (adminTab !== 'hub') {
      count++;
    }
  }

  const activeTab = bridge?.getState().activeTab || 'daily';
  if (activeTab !== 'daily') {
    count++;
  }

  return count;
}

/**
 * Closes the single topmost open menu/modal/picker/sub-pane (and optionally non-home tab) in strict visual priority order.
 * Returns true if a layer was closed, false if nothing applicable was open.
 */
function closeTopmostLayer(includeTabs = true): boolean {
  if (isHardBlocked()) return false;
  const bridge = getBridge();
  if (!bridge) return false;

  // 0. Anime Welcome launch splash overlay
  if (isModuleOverlayOpen('animeWelcomeOverlay') && window.__INONU_ANIME_WELCOME__) {
    window.__INONU_ANIME_WELCOME__.close();
    return true;
  }

  // 1. Nested topmost pickers & WhatsApp-style quick context menu
  if (isStandardModalOpen('adminDateTimeModal')) {
    return bridge.closeModalById('adminDateTimeModal');
  }
  if (isStandardModalOpen('adminSlotQuickModal')) {
    return bridge.closeModalById('adminSlotQuickModal');
  }
  if (isAnyAdminInlinePickerOpen()) {
    const closedOv = closeAdminOvSlotPicker();
    const closedLegacy = bridge.closeModalById('adminPickers');
    return closedOv || closedLegacy;
  }

  // 2. Modular Liquid-Glass overlays (Anonymous Feedback & PDF Archive)
  if (isModuleOverlayOpen('studentFeedbackModal') && window.__INONU_FEEDBACK__) {
    window.__INONU_FEEDBACK__.close();
    return true;
  }
  if (isModuleOverlayOpen('pdfArchiveModal') && window.__INONU_PDF_ARCHIVE__) {
    window.__INONU_PDF_ARCHIVE__.close();
    return true;
  }

  // 3. Content & detail modals (highest visual priority first)
  const modalPriority = [
    'foodPhotoModal',
    'instructorModal',
    'lessonPdfsModal',
    'noteModal',
    'dailyDateModal',
    'foodDateModal',
    'groupModal',
    'paletteModal',
    'settingsMenuModal',
    'installModal',
  ];
  for (const id of modalPriority) {
    if (isStandardModalOpen(id)) {
      return bridge.closeModalById(id);
    }
  }

  // 4. Optional login modal (only dismissible if site isn't locked)
  if (isStandardModalOpen('authGate') && !bridge.isSiteLocked()) {
    return bridge.closeModalById('authGate');
  }

  // 5. Admin Panel: navigate back from any sub-pane to Hub first, then close Admin Modal
  if (isStandardModalOpen('adminModal')) {
    const adminTab = bridge.getAdminActiveTab() || 'hub';
    if (adminTab !== 'hub') {
      bridge.switchAdminTab('hub', true);
      return true;
    }
    return bridge.closeModalById('adminModal');
  }

  // 6. Non-home bottom-nav tabs return to Daily (home) tab (hardware Back only, not Escape)
  if (includeTabs) {
    const activeTab = bridge.getState().activeTab || 'daily';
    if (activeTab !== 'daily') {
      bridge.switchTab('daily');
      return true;
    }
  }

  return false;
}

function getDesiredDepth(): number {
  if (isHardBlocked()) return 0;
  // Base 1 = root guard (prevents accidental instant exit on home screen), +1 per open UI layer
  return 1 + getActiveLayerCount();
}

function pushUpToDepth(targetDepth: number): void {
  let cur = getCurrentDepth();
  if (cur >= targetDepth) return;
  try {
    while (cur < targetDepth) {
      cur += 1;
      window.history.pushState(
        { __inonuNav: true, __inonuDepth: cur } as InonuHistoryState,
        '',
        window.location.href
      );
    }
  } catch {
    // Ignore restricted history environments
  }
}

/**
 * Monotonic sync: ONLY pushes history entries when opening deeper UI layers.
 * NEVER calls history.go(-delta) on close/tab changes, eliminating async popstate races
 * that could unexpectedly close sub-panes (e.g. Student Settings) or bounce to Home.
 */
export function syncBackNav(reason: 'open' | 'close' | 'tab' = 'open'): void {
  if (!initialized || handlingPopstate || reason === 'close') return;
  const desired = getDesiredDepth();
  const cur = getCurrentDepth();
  if (cur < desired) {
    pushUpToDepth(desired);
  }
}

export function initBackNavigation(): void {
  if (initialized || typeof window === 'undefined' || !window.history) return;
  initialized = true;

  // Stamp the current base entry as depth 0 without touching the URL
  try {
    const existing = window.history.state;
    if (!isPlainObject(existing) || !existing.__inonuNav) {
      const base: InonuHistoryState = {
        ...(isPlainObject(existing) ? existing : {}),
        __inonuNav: true,
        __inonuDepth: 0,
      };
      window.history.replaceState(base, '', window.location.href);
    }
  } catch {
    // Ignore history replace errors
  }

  // Arm history entries on user gestures so Chromium's History Manipulation Intervention never skips them
  const armOnUserGesture = () => {
    if (handlingPopstate) return;
    const desired = getDesiredDepth();
    const cur = getCurrentDepth();
    if (cur < desired) {
      pushUpToDepth(desired);
    }
  };

  document.addEventListener('pointerdown', armOnUserGesture, { passive: true, capture: true });
  document.addEventListener('keydown', armOnUserGesture, { passive: true, capture: true });

  window.addEventListener('popstate', () => {
    const poppedDepth = getCurrentDepth();

    if (isHardBlocked()) {
      return;
    }

    // Dismiss lingering keyboard focus in main view & guarantee bottom dock is never stuck hidden
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && typeof activeEl.blur === 'function' && activeEl.closest('#appMain')) {
      activeEl.blur();
    }
    document.getElementById('appNav')?.classList.remove('is-keyboard-open');

    handlingPopstate = true;
    let closed = false;
    try {
      closed = closeTopmostLayer(true);
    } finally {
      handlingPopstate = false;
    }

    const bridge = getBridge();

    if (closed) {
      lastExitPromptAt = 0;
      bridge?.triggerHaptic('selection');
      const afterDesired = getDesiredDepth();
      if (poppedDepth < afterDesired) {
        pushUpToDepth(afterDesired);
      }
      return;
    }

    // Nothing was open -> user pressed Back at root home screen
    const now = Date.now();
    if (now - lastExitPromptAt < 2400) {
      lastExitPromptAt = 0;
      try {
        // Exit past depth-0 base entry in a single step regardless of prior non-trimmed depth
        window.history.go(-(poppedDepth + 1));
      } catch {
        // Ignore restricted history environments
      }
      return;
    }

    lastExitPromptAt = now;
    const isEn = bridge?.getState().lang === 'en';
    bridge?.showToast(
      isEn ? 'Press back again to exit' : 'Çıkmak için tekrar geri tuşuna basın'
    );
    bridge?.triggerHaptic('light');
    if (poppedDepth === 0) {
      pushUpToDepth(1);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (closeTopmostLayer(false)) {
      e.preventDefault();
      getBridge()?.triggerHaptic('selection');
    }
  });

  window.__INONU_BACK_NAV__ = {
    sync: syncBackNav,
    closeTopmost: (includeTabs = false) => closeTopmostLayer(includeTabs),
  };
}
