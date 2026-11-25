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

export interface BridgeMaterialItem {
  id: string;
  date: string;
  slotNo: number;
  targetProg: 'tr' | 'en';
  title: string;
  pdfName?: string;
  fileSize?: number;
  url?: string;
  cached?: boolean;
  lessonTitle?: string;
  lessonCode?: string;
  instructor?: string;
}

export interface BridgeScheduleSlot {
  date: string;
  slotNo: number;
  time: string;
  title: string;
  instructor?: string;
  location?: string;
  code?: string;
  group?: string;
}

export interface BridgeScheduleDay {
  date: string;
  kurulNo: number;
  haftaNo: number;
  slots: BridgeScheduleSlot[];
}

export interface InonuBridge {
  getState: () => {
    lang: 'tr' | 'en';
    activeTab: string;
    darkMode: boolean;
    selectedDate: string;
    myMbuGroup: string;
    myLabGroup: string;
    foodDateISO?: string;
    foodViewMode?: string;
  };
  getSession: () => {
    hash: string;
    last4: string;
    name: string;
    group: string;
    prog: string;
    isAdmin: boolean;
  } | null;
  openAuthModal: () => void;
  loginWithStudentId: (studentId: string, adminPassword?: string) => Promise<{ ok: boolean; needAdminPassword?: boolean; error?: string }>;
  isAdmin: () => boolean;
  isSiteLocked: () => boolean;
  switchTab: (tabName: string) => void;
  jumpToToday: () => void;
  openDailyDateModal: () => void;
  openGroupModal: () => void;
  openSettingsMenu: () => void;
  openAdminModal: (tabKey?: string) => boolean;
  switchAdminTab: (tabKey: string, animate?: boolean) => void;
  triggerAdminQuickAction: (action: 'urgent-ann' | 'cancel-today') => boolean;
  toggleDarkMode: () => void;
  triggerHaptic: (kind?: string) => void;
  showToast: (msg: string) => void;
  syncModalScrollLock: () => void;
  refreshDailyView: () => void;
  getScheduleDays: (prog?: 'tr' | 'en') => BridgeScheduleDay[];
  getAllMaterials: () => BridgeMaterialItem[];
  openMaterial: (mat: BridgeMaterialItem) => void;
  openDateTimePicker: (opts: {
    mode: 'date' | 'datetime';
    title: string;
    initialValue?: string;
    onApply: (val: string) => void;
  }) => void;
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
    __INONU_PDF_ARCHIVE__?: {
      open: () => void;
      close: () => void;
    };
    __INONU_FEEDBACK__?: {
      open: () => void;
      close: () => void;
    };
    __INONU_ANATOMY_3D__?: {
      open: (opts?: {
        modelId?: 'cell' | 'heart' | 'brain' | 'skull' | 'femur' | 'thorax';
        partId?: string;
        lessonTitle?: string;
      }) => void;
      close: () => void;
      matchLesson: (slot: { title?: string; code?: string }) => {
        modelId: 'cell' | 'heart' | 'brain' | 'skull' | 'femur' | 'thorax';
        partId?: string;
        labelTr: string;
        labelEn: string;
      } | null;
    };
    __INONU_ADMIN_EXTRAS__?: {
      openPane: (paneKey: string) => void;
      openOverrideForSlot: (slot: {
        date: string;
        slotNo: number;
        time?: string;
        location?: string;
        instructor?: string;
        title?: string;
      }) => void;
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
