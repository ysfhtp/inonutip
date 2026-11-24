export interface LiveSlotSummary {
  title: string;
  start: string;
  end: string;
  location: string;
  instructor: string;
}

export interface NextExamSummary {
  title: string;
  date: string;
  time: string;
  daysLeft: number | null;
}

export interface InonuBridge {
  getState: () => {
    lang: 'tr' | 'en';
    activeTab: string;
    darkMode: boolean;
    selectedDate: string;
    myMbuGroup: string;
    myLabGroup: string;
  };
  isAdmin: () => boolean;
  isSiteLocked: () => boolean;
  switchTab: (tabName: string) => void;
  jumpToToday: () => void;
  openDailyDateModal: () => void;
  openGroupModal: () => void;
  openSettingsMenu: () => void;
  openAdminModal: (tabKey?: string) => boolean;
  triggerAdminQuickAction: (action: 'urgent-ann' | 'cancel-today') => boolean;
  toggleDarkMode: () => void;
  triggerHaptic: (kind?: string) => void;
  showToast: (msg: string) => void;
  syncModalScrollLock: () => void;
  getLiveSummary: () => {
    todayStr: string;
    liveSlot: LiveSlotSummary | null;
    nextSlot: LiveSlotSummary | null;
    nextExam: NextExamSummary | null;
  };
}

declare global {
  interface Window {
    __INONU_BRIDGE__?: InonuBridge;
    __INONU_BOTTOM_SHEET__?: {
      open: () => void;
      close: () => void;
      toggle: () => void;
    };
  }
}

export function getBridge(): InonuBridge | null {
  return typeof window !== 'undefined' && window.__INONU_BRIDGE__ ? window.__INONU_BRIDGE__ : null;
}

export function onBridgeReady(cb: (bridge: InonuBridge) => void): void {
  const existing = getBridge();
  if (existing) {
    cb(existing);
    return;
  }
  window.addEventListener(
    'inonu-bridge-ready',
    () => {
      const b = getBridge();
      if (b) cb(b);
    },
    { once: true }
  );
}
