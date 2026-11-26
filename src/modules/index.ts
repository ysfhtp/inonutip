import { onBridgeReady } from './bridge.ts';
import { initCommitteeScores } from './committeeScores.ts';
import { initAnnouncementReads } from './announcementReads.ts';
import { initLiveStore } from './liveStore.ts';
import { initBannerAndLinks } from './bannerAndLinks.ts';
import { initLivePolls } from './livePolls.ts';
import { initPdfArchive } from './pdfArchive.ts';
import { initAdminExtras } from './adminExtras.ts';
import { initStudentFeedback } from './studentFeedback.ts';
import { initFoodRatings } from './foodRatings.ts';
import { initMaintenanceGate } from './maintenanceGate.ts';
import { initBottomSheet } from './bottomSheet.ts';
import { initOfflineSupport } from './offlineSupport.ts';
import { initBackNavigation } from './backNavigation.ts';
import { initIosEnhancements } from './iosEnhancements.ts';

export function initModularMenus(): void {
  initLiveStore();
  onBridgeReady(() => {
    initMaintenanceGate();
    initBackNavigation();
    initBottomSheet();
    initOfflineSupport();
    initCommitteeScores();
    initAnnouncementReads();
    initBannerAndLinks();
    initLivePolls();
    initPdfArchive();
    initStudentFeedback();
    initFoodRatings();
    initAdminExtras();
    initIosEnhancements();
  });
}
