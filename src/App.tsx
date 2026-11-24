import { useCallback, useEffect, useState } from 'react';
import { initInonuApp } from './legacyApp.ts';
import { DynamicIslandMenu } from './components/DynamicIslandMenu.tsx';
import type { InonuUiBridge, InonuUiSnapshot } from './types/uiBridge.ts';

const FALLBACK_SNAPSHOT: InonuUiSnapshot = {
  lang: 'tr',
  darkMode: true,
  palette: 'medical-blue',
  hapticsEnabled: true,
  activeTab: 'daily',
  selectedDate: '',
  selectedDateLabel: '',
  myMbuGroup: '',
  myLabGroup: '',
  otherGroupMode: 'dim',
  liveSlot: null,
  nextSlot: null,
  todayVisibleCount: 0,
  announcements: [],
  nextExam: null,
  notesCount: 0,
  cachedPdfCount: 0,
  isLoggedIn: false,
  isSiteLocked: false,
};

export default function App() {
  const [bridge, setBridge] = useState<InonuUiBridge | null>(
    () => window.__INONU_UI_BRIDGE__ ?? null
  );
  const [snapshot, setSnapshot] = useState<InonuUiSnapshot>(() =>
    window.__INONU_UI_BRIDGE__
      ? window.__INONU_UI_BRIDGE__.getSnapshot()
      : FALLBACK_SNAPSHOT
  );
  const [islandExpanded, setIslandExpanded] = useState(false);

  const syncFromBridge = useCallback(() => {
    const activeBridge = window.__INONU_UI_BRIDGE__ ?? null;
    setBridge(activeBridge);
    if (activeBridge) {
      setSnapshot(activeBridge.getSnapshot());
    }
  }, []);

  useEffect(() => {
    initInonuApp();
    syncFromBridge();

    const onUiState = () => syncFromBridge();
    window.addEventListener('inonu-ui-state', onUiState);
    window.addEventListener('inonu-auth-ready', onUiState);

    const htmlObserver = new MutationObserver(() => syncFromBridge());
    htmlObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-palette', 'lang'],
    });

    const bootSync = window.setTimeout(syncFromBridge, 120);

    return () => {
      window.clearTimeout(bootSync);
      window.removeEventListener('inonu-ui-state', onUiState);
      window.removeEventListener('inonu-auth-ready', onUiState);
      htmlObserver.disconnect();
    };
  }, [syncFromBridge]);

  return (
    <DynamicIslandMenu
      snapshot={snapshot}
      bridge={bridge}
      expanded={islandExpanded}
      onExpandedChange={setIslandExpanded}
    />
  );
}
