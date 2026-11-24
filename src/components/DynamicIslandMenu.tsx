import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Bell,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Megaphone,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sun,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import type {
  InonuIslandNotification,
  InonuUiBridge,
  InonuUiSnapshot,
} from '../types/uiBridge.ts';

interface DynamicIslandMenuProps {
  snapshot: InonuUiSnapshot;
  bridge: InonuUiBridge | null;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
}

const SPRING_ISLAND = {
  type: 'spring' as const,
  stiffness: 430,
  damping: 33,
  mass: 0.84,
};

const TONE_ACCENTS: Record<string, string> = {
  info: 'text-sky-400',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  accent: 'text-blue-400',
};

export const DynamicIslandMenu: React.FC<DynamicIslandMenuProps> = ({
  snapshot,
  bridge,
  expanded,
  onExpandedChange,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [notification, setNotification] = useState<InonuIslandNotification | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [annIndex, setAnnIndex] = useState(0);
  const dismissTimerRef = useRef<number | null>(null);

  const isEn = snapshot.lang === 'en';
  const activeAnns = snapshot.announcements || [];
  const safeAnnIdx = activeAnns.length > 0 ? annIndex % activeAnns.length : 0;
  const currentAnn = activeAnns[safeAnnIdx] || null;

  useEffect(() => {
    window.__INONU_ISLAND_ACTIVE__ = true;
    const handleNotify = (e: Event) => {
      const detail = (e as CustomEvent<InonuIslandNotification>).detail;
      if (!detail || !detail.message) return;
      if (dismissTimerRef.current) {
        window.clearTimeout(dismissTimerRef.current);
      }
      setNotification(detail);
      dismissTimerRef.current = window.setTimeout(() => {
        setNotification(null);
        dismissTimerRef.current = null;
      }, 2700);
    };
    window.addEventListener('inonu-island-notify', handleNotify);
    return () => {
      window.__INONU_ISLAND_ACTIVE__ = false;
      window.removeEventListener('inonu-island-notify', handleNotify);
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExpandedChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded, onExpandedChange]);

  if (snapshot.isSiteLocked) return null;

  const isNotifyMode = Boolean(notification) && !expanded;
  const primarySlot = snapshot.liveSlot || snapshot.nextSlot;
  const mbuPrefix = isEn ? 'PSP' : 'MBU';

  const compactSummary = (() => {
    if (snapshot.liveSlot) {
      const start = snapshot.liveSlot.time.split('-')[0] || '';
      return `${start} · ${snapshot.liveSlot.code || snapshot.liveSlot.title}`;
    }
    if (snapshot.nextSlot && snapshot.nextSlot.isToday) {
      const start = snapshot.nextSlot.time.split('-')[0] || '';
      return `${start} · ${snapshot.nextSlot.code || snapshot.nextSlot.title}`;
    }
    if (snapshot.myMbuGroup) {
      return snapshot.myLabGroup && !isEn
        ? `${mbuPrefix} ${snapshot.myMbuGroup} · LAB ${snapshot.myLabGroup}`
        : `${mbuPrefix} ${snapshot.myMbuGroup}`;
    }
    if (snapshot.nextExam && snapshot.nextExam.daysLeft >= 0) {
      return isEn
        ? `${snapshot.nextExam.daysLeft}d · ${snapshot.nextExam.title}`
        : `${snapshot.nextExam.daysLeft}g · ${snapshot.nextExam.title}`;
    }
    return isEn
      ? `${snapshot.todayVisibleCount} classes`
      : `${snapshot.todayVisibleCount} ders`;
  })();

  const handleQuickRefresh = async () => {
    if (!bridge || refreshing) return;
    setRefreshing(true);
    await bridge.refreshData();
    setRefreshing(false);
    bridge.notify(isEn ? 'Schedule & announcements synced' : 'Program ve duyurular güncellendi', 'success');
  };

  const handleToggleTheme = () => {
    if (!bridge) return;
    const nextDark = !snapshot.darkMode;
    bridge.setTheme(nextDark);
    bridge.notify(
      nextDark
        ? isEn
          ? 'Dark mode enabled'
          : 'Koyu görünüm açıldı'
        : isEn
          ? 'Light mode enabled'
          : 'Açık görünüm açıldı',
      'info'
    );
  };

  const handleToggleLang = () => {
    if (!bridge) return;
    const nextLang = snapshot.lang === 'tr' ? 'en' : 'tr';
    bridge.setLanguage(nextLang);
    bridge.notify(nextLang === 'en' ? 'Switched to English' : 'Türkçe programa geçildi', 'info');
  };

  const handleJumpToday = () => {
    bridge?.jumpToToday();
    onExpandedChange(false);
    bridge?.notify(isEn ? "Jumped to today's schedule" : 'Bugünün programına geçildi', 'info');
  };

  const handleOpenFood = () => {
    bridge?.switchTab('food');
    onExpandedChange(false);
  };

  const handleOpenSearch = () => {
    bridge?.openSearch();
    onExpandedChange(false);
  };

  const handleExportIcs = () => {
    bridge?.exportDayIcs();
    onExpandedChange(false);
  };

  const handleOpenSettings = () => {
    onExpandedChange(false);
    bridge?.openSettingsModal();
  };

  const transition = prefersReducedMotion ? { duration: 0.14 } : SPRING_ISLAND;

  return (
    <>
      {/* Click-away transparent backdrop when expanded */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="island-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => onExpandedChange(false)}
            className="inonu-floating-ui fixed inset-0 z-[44] bg-slate-950/25 dark:bg-black/45 backdrop-blur-[3px]"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Top-Center Dynamic Island Anchor */}
      <div
        className="inonu-floating-ui fixed left-1/2 -translate-x-1/2 z-[45] flex justify-center pointer-events-none"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 6px)' }}
      >
        <motion.div
          layout
          transition={transition}
          style={{
            borderRadius: expanded ? 28 : isNotifyMode ? 22 : 9999,
          }}
          className={`dynamic-island-surface pointer-events-auto text-white overflow-hidden select-none ${
            expanded
              ? 'w-[min(92vw,392px)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.72)]'
              : isNotifyMode
                ? 'w-[min(90vw,336px)] shadow-[0_14px_38px_-8px_rgba(0,0,0,0.62)]'
                : 'max-w-[min(78vw,238px)] shadow-[0_10px_28px_-6px_rgba(0,0,0,0.52)]'
          }`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {/* STATE 1: COMPACT IDLE PILL */}
            {!expanded && !isNotifyMode && (
              <motion.button
                key="island-compact"
                type="button"
                layout="position"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.16 }}
                onClick={() => {
                  bridge?.triggerHaptic('light');
                  onExpandedChange(true);
                }}
                aria-expanded={false}
                aria-label={isEn ? 'Open Dynamic Island menu' : 'Dinamik Ada menüsünü aç'}
                className="w-full h-[34px] px-3 flex items-center justify-between gap-2 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 rounded-full group"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {snapshot.liveSlot ? (
                    <span className="relative flex items-center justify-center w-4 h-4 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    </span>
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  )}
                  <span className="text-[11.5px] font-semibold tracking-tight text-white/95 truncate tabular-nums">
                    {compactSummary}
                  </span>
                </span>

                <span className="flex items-center gap-1 shrink-0 text-white/65 group-hover:text-white transition-colors">
                  {activeAnns.length > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-300 tabular-nums">
                      <Bell className="w-3 h-3" />
                      {activeAnns.length}
                    </span>
                  )}
                  <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                </span>
              </motion.button>
            )}

            {/* STATE 2: TRANSIENT NOTIFICATION MORPH */}
            {!expanded && isNotifyMode && notification && (
              <motion.div
                key={`island-notify-${notification.id}`}
                layout="position"
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="relative"
              >
                <button
                  type="button"
                  onClick={() => {
                    setNotification(null);
                    onExpandedChange(true);
                  }}
                  className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between gap-2.5 text-left cursor-pointer focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0 ${
                        TONE_ACCENTS[notification.tone] || 'text-sky-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <span className="text-xs font-semibold text-white/95 truncate leading-snug">
                      {notification.message}
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold text-white/50 shrink-0 whitespace-nowrap">
                    {isEn ? 'Menu' : 'Menü'}
                  </span>
                </button>
                {/* Auto-dismiss timeline progress bar */}
                {!prefersReducedMotion && (
                  <motion.div
                    initial={{ scaleX: 1 }}
                    animate={{ scaleX: 0 }}
                    transition={{ duration: 2.7, ease: 'linear' }}
                    style={{ transformOrigin: 'left center' }}
                    className="h-[2px] w-full bg-gradient-to-r from-sky-400 via-blue-400 to-emerald-400 opacity-75"
                  />
                )}
              </motion.div>
            )}

            {/* STATE 3: EXPANDED SMART TOP BAR */}
            {expanded && (
              <motion.div
                key="island-expanded"
                layout="position"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18 }}
                className="p-4 space-y-3"
              >
                {/* Header strip */}
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-white/60 truncate tabular-nums">
                      {snapshot.selectedDateLabel || snapshot.selectedDate}
                      {snapshot.myMbuGroup ? ` · ${mbuPrefix} ${snapshot.myMbuGroup}` : ''}
                      {snapshot.myLabGroup && !isEn ? ` · LAB ${snapshot.myLabGroup}` : ''}
                    </p>
                    <p className="text-sm font-bold tracking-tight text-white truncate">
                      {isEn ? 'Quick Command Center' : 'Dinamik Ada · Hızlı Eylemler'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onExpandedChange(false)}
                    aria-label={isEn ? 'Close' : 'Kapat'}
                    className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/18 active:scale-95 flex items-center justify-center text-white/80 hover:text-white transition shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Live / Next Lesson Focus Row */}
                {primarySlot && (
                  <button
                    type="button"
                    onClick={handleJumpToday}
                    className="w-full rounded-2xl bg-white/[0.08] hover:bg-white/[0.12] border border-white/10 px-3.5 py-2.5 flex items-center justify-between gap-3 text-left transition active:scale-[0.99] cursor-pointer"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-white/70 tabular-nums">
                        <span className={primarySlot.isLive ? 'text-emerald-400' : 'text-sky-400'}>
                          {primarySlot.isLive
                            ? isEn
                              ? 'Live Now'
                              : 'Şu An Derste'
                            : primarySlot.isToday
                              ? isEn
                                ? 'Up Next'
                                : 'Sıradaki Ders'
                              : primarySlot.date}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{primarySlot.time}</span>
                        {primarySlot.code && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{primarySlot.code}</span>
                          </>
                        )}
                      </div>
                      <p className="text-[13px] font-semibold text-white truncate">
                        {primarySlot.title}
                      </p>
                      {primarySlot.instructor && (
                        <p className="text-[11px] text-white/55 truncate">
                          {primarySlot.instructor}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/50 shrink-0" />
                  </button>
                )}

                {/* Active Announcement Row (if faculty announcements exist) */}
                {currentAnn && (
                  <div className="rounded-2xl bg-amber-400/12 border border-amber-300/20 px-3 py-2 flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <Megaphone className="w-3.5 h-3.5 text-amber-300 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-semibold text-amber-100 truncate">
                          {currentAnn.title || (isEn ? 'Announcement' : 'Duyuru')}
                        </p>
                        {currentAnn.body && (
                          <p className="text-[11px] text-white/70 line-clamp-2 leading-snug mt-0.5">
                            {currentAnn.body}
                          </p>
                        )}
                      </div>
                    </div>
                    {activeAnns.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setAnnIndex((i) => i + 1)}
                        className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/18 text-[10.5px] font-semibold text-amber-200 tabular-nums shrink-0 cursor-pointer"
                      >
                        {safeAnnIdx + 1}/{activeAnns.length}
                      </button>
                    )}
                  </div>
                )}

                {/* 4 Primary Quick Actions */}
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={handleJumpToday}
                    className="min-h-[54px] rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 flex flex-col items-center justify-center gap-1 px-1 transition cursor-pointer"
                  >
                    <Calendar className="w-4 h-4 text-sky-400" />
                    <span className="text-[10.5px] font-semibold text-white/90 whitespace-nowrap">
                      {isEn ? 'Today' : 'Bugün'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenFood}
                    className="min-h-[54px] rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 flex flex-col items-center justify-center gap-1 px-1 transition cursor-pointer"
                  >
                    <UtensilsCrossed className="w-4 h-4 text-amber-400" />
                    <span className="text-[10.5px] font-semibold text-white/90 whitespace-nowrap">
                      {isEn ? 'Dining' : 'Yemek'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenSearch}
                    className="min-h-[54px] rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 flex flex-col items-center justify-center gap-1 px-1 transition cursor-pointer"
                  >
                    <Search className="w-4 h-4 text-indigo-300" />
                    <span className="text-[10.5px] font-semibold text-white/90 whitespace-nowrap">
                      {isEn ? 'Search' : 'Arama'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleQuickRefresh()}
                    disabled={refreshing}
                    className="min-h-[54px] rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 disabled:opacity-60 flex flex-col items-center justify-center gap-1 px-1 transition cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-4 h-4 text-emerald-400 ${refreshing ? 'animate-spin' : ''}`}
                    />
                    <span className="text-[10.5px] font-semibold text-white/90 whitespace-nowrap">
                      {isEn ? 'Sync' : 'Yenile'}
                    </span>
                  </button>
                </div>

                {/* Bottom Utility Bar + Launch Glass Bottom Sheet */}
                <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleToggleTheme}
                      aria-label={isEn ? 'Toggle theme' : 'Temayı değiştir'}
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-white/[0.08] hover:bg-white/[0.15] active:scale-95 flex items-center justify-center text-white/90 transition cursor-pointer"
                    >
                      {snapshot.darkMode ? (
                        <Sun className="w-4 h-4 text-amber-300" />
                      ) : (
                        <Moon className="w-4 h-4 text-sky-300" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleLang}
                      aria-label={isEn ? 'Switch language' : 'Dili değiştir'}
                      className="min-h-[40px] px-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] active:scale-95 inline-flex items-center gap-1 text-xs font-bold text-white/90 transition cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5 text-sky-300" />
                      <span>{snapshot.lang.toUpperCase()}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportIcs}
                      aria-label={isEn ? 'Export day to calendar' : 'Günü takvime ekle'}
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-white/[0.08] hover:bg-white/[0.15] active:scale-95 flex items-center justify-center text-white/90 transition cursor-pointer"
                    >
                      <CalendarPlus className="w-4 h-4 text-emerald-300" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenSettings}
                    className="min-h-[40px] px-3.5 rounded-xl bg-white/[0.12] hover:bg-white/[0.18] active:scale-95 inline-flex items-center gap-1.5 text-xs font-semibold text-white transition whitespace-nowrap cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5 text-sky-300" />
                    <span>{isEn ? 'Settings' : 'Ayarlar'}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
};
