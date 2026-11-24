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

export function initModularMenus(): void {
  initLiveStore();
  onBridgeReady(() => {
    initMaintenanceGate();
    initCommitteeScores();
    initAnnouncementReads();
    initBannerAndLinks();
    initLivePolls();
    initPdfArchive();
    initStudentFeedback();
    initFoodRatings();
    initAdminExtras();
  });
}
