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
import { initAnatomy3D } from './anatomy3d/index.ts';

export function initModularMenus(): void {
  initLiveStore();
  onBridgeReady(() => {
    initMaintenanceGate();
    initBottomSheet();
    initOfflineSupport();
    initCommitteeScores();
    initAnnouncementReads();
    initBannerAndLinks();
    initLivePolls();
    initPdfArchive();
    initStudentFeedback();
    initFoodRatings();
    initAnatomy3D();
    initAdminExtras();
  });
}
