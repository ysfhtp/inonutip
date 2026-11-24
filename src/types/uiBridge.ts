export type InonuTab = 'daily' | 'weekly' | 'search' | 'info' | 'food';
export type InonuLang = 'tr' | 'en';
export type InonuPalette =
  | 'medical-blue'
  | 'surgical-navy'
  | 'biochem-mint'
  | 'anatomy-crimson';
export type InonuOtherGroupMode = 'dim' | 'hide';
export type InonuIslandTone = 'info' | 'success' | 'warning' | 'accent';

export interface InonuSlotPreview {
  date: string;
  time: string;
  code: string;
  title: string;
  instructor: string;
  group: string;
  isLive: boolean;
  isToday: boolean;
}

export interface InonuAnnouncementPreview {
  id: string;
  title: string;
  body: string;
  tone: string;
}

export interface InonuExamPreview {
  title: string;
  date: string;
  daysLeft: number;
}

export interface InonuUiSnapshot {
  lang: InonuLang;
  darkMode: boolean;
  palette: InonuPalette;
  hapticsEnabled: boolean;
  activeTab: InonuTab;
  selectedDate: string;
  selectedDateLabel: string;
  myMbuGroup: string;
  myLabGroup: string;
  otherGroupMode: InonuOtherGroupMode;
  liveSlot: InonuSlotPreview | null;
  nextSlot: InonuSlotPreview | null;
  todayVisibleCount: number;
  announcements: InonuAnnouncementPreview[];
  nextExam: InonuExamPreview | null;
  notesCount: number;
  cachedPdfCount: number;
  isLoggedIn: boolean;
  isSiteLocked: boolean;
}

export interface InonuIslandNotification {
  id: number;
  message: string;
  tone: InonuIslandTone;
  timestamp: number;
}

export interface InonuUiBridge {
  getSnapshot: () => InonuUiSnapshot;
  setTheme: (dark: boolean) => void;
  setPalette: (palette: InonuPalette) => void;
  setLanguage: (lang: InonuLang) => void;
  setHaptics: (enabled: boolean) => void;
  setMbuGroup: (group: string) => void;
  setLabGroup: (group: string) => void;
  setOtherGroupMode: (mode: InonuOtherGroupMode) => void;
  resetGroups: () => void;
  switchTab: (tab: InonuTab) => void;
  jumpToToday: () => void;
  jumpToTomorrow: () => void;
  openDatePicker: () => void;
  openSearch: () => void;
  openSettingsModal: () => void;
  openAuthModal: () => void;
  exportDayIcs: () => void;
  refreshData: () => Promise<void>;
  triggerHaptic: (kind?: 'tick' | 'light' | 'medium' | 'success' | 'error') => void;
  notify: (message: string, tone?: InonuIslandTone) => void;
}

declare global {
  interface Window {
    __INONU_UI_BRIDGE__?: InonuUiBridge;
    __INONU_ISLAND_ACTIVE__?: boolean;
  }
}
