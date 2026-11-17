import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import {
  addOrUpdateCustomStudent,
  adminSaveStudentSettings,
  cacheLessonPdfBlob,
  checkStudentLoginStatus,
  checkStudentSessionActive,
  clearAdminWriteSecret,
  deleteAnnouncement,
  deleteCustomStudent,
  deleteLessonMaterial,
  deleteServerPdfByUrl,
  deleteCloudUserNote,
  downloadLessonMaterialChunks,
  generateLessonMaterialId,
  getCachedLessonPdfBlob,
  getGoogleAuthUser,
  hasAdminWriteSecret,
  isStudentAlreadyRegistered,
  listAllAnnouncements,
  loadActiveAnnouncements,
  loadAllAdminStudents,
  loadAllLessonMaterials,
  loadCloudStudentPrefs,
  loadCloudUserNotes,
  loadSiteAccessSettings,
  lookupStudentForAdmin,
  lookupStudentWithCloud,
  onGoogleAuthChanged,
  saveAnnouncement,
  saveCloudStudentPrefs,
  saveCloudUserNote,
  saveLessonMaterial,
  saveSiteAccessSettings,
  setAdminWriteSecret,
  signInWithGoogle,
  signOutGoogle,
  subscribeAnnouncements,
  subscribeLessonMaterials,
  subscribeSiteAccessSettings,
  subscribeStudentAccountStatus,
  updateAdminPassword,
  uploadLessonPdfFile,
  verifyAdminPassword,
  verifyAndUnlockAdmin,
} from './cloudApi.ts';
import {
  deriveAdminWriteSecret,
  deriveCloudDocId,
  isAdminStudentHash,
  isAdminStudentId,
  isValidAuthHash,
  isValidCloudDocId,
  normalizeStudentId,
  verifyStudentHash,
  verifyStudentId,
} from './studentAllowlist.ts';

declare global {
  interface Window {
    __INONU_AUTH__?: {
      normalizeStudentId: typeof normalizeStudentId;
      verifyStudentId: typeof verifyStudentId;
      verifyStudentHash: typeof verifyStudentHash;
      deriveCloudDocId: typeof deriveCloudDocId;
      deriveAdminWriteSecret: typeof deriveAdminWriteSecret;
      isValidCloudDocId: typeof isValidCloudDocId;
      isValidAuthHash: typeof isValidAuthHash;
      isAdminStudentId: typeof isAdminStudentId;
      isAdminStudentHash: typeof isAdminStudentHash;
      checkStudentLoginStatus: typeof checkStudentLoginStatus;
      checkStudentSessionActive: typeof checkStudentSessionActive;
      subscribeStudentAccountStatus: typeof subscribeStudentAccountStatus;
      isStudentAlreadyRegistered: typeof isStudentAlreadyRegistered;
      lookupStudentWithCloud: typeof lookupStudentWithCloud;
      verifyAdminPassword: typeof verifyAdminPassword;
      verifyAndUnlockAdmin: typeof verifyAndUnlockAdmin;
      setAdminWriteSecret: typeof setAdminWriteSecret;
      clearAdminWriteSecret: typeof clearAdminWriteSecret;
      hasAdminWriteSecret: typeof hasAdminWriteSecret;
      updateAdminPassword: typeof updateAdminPassword;
      loadSiteAccessSettings: typeof loadSiteAccessSettings;
      subscribeSiteAccessSettings: typeof subscribeSiteAccessSettings;
      saveSiteAccessSettings: typeof saveSiteAccessSettings;
      loadCloudStudentPrefs: typeof loadCloudStudentPrefs;
      saveCloudStudentPrefs: typeof saveCloudStudentPrefs;
      loadActiveAnnouncements: typeof loadActiveAnnouncements;
      subscribeAnnouncements: typeof subscribeAnnouncements;
      listAllAnnouncements: typeof listAllAnnouncements;
      saveAnnouncement: typeof saveAnnouncement;
      deleteAnnouncement: typeof deleteAnnouncement;
      loadAllLessonMaterials: typeof loadAllLessonMaterials;
      subscribeLessonMaterials: typeof subscribeLessonMaterials;
      saveLessonMaterial: typeof saveLessonMaterial;
      deleteLessonMaterial: typeof deleteLessonMaterial;
      uploadLessonPdfFile: typeof uploadLessonPdfFile;
      downloadLessonMaterialChunks: typeof downloadLessonMaterialChunks;
      getCachedLessonPdfBlob: typeof getCachedLessonPdfBlob;
      cacheLessonPdfBlob: typeof cacheLessonPdfBlob;
      generateLessonMaterialId: typeof generateLessonMaterialId;
      deleteServerPdfByUrl: typeof deleteServerPdfByUrl;
      addOrUpdateCustomStudent: typeof addOrUpdateCustomStudent;
      deleteCustomStudent: typeof deleteCustomStudent;
      loadAllAdminStudents: typeof loadAllAdminStudents;
      lookupStudentForAdmin: typeof lookupStudentForAdmin;
      adminSaveStudentSettings: typeof adminSaveStudentSettings;
      getGoogleAuthUser: typeof getGoogleAuthUser;
      onGoogleAuthChanged: typeof onGoogleAuthChanged;
      signInWithGoogle: typeof signInWithGoogle;
      signOutGoogle: typeof signOutGoogle;
      loadCloudUserNotes: typeof loadCloudUserNotes;
      saveCloudUserNote: typeof saveCloudUserNote;
      deleteCloudUserNote: typeof deleteCloudUserNote;
    };
  }
}

window.__INONU_AUTH__ = {
  normalizeStudentId,
  verifyStudentId,
  verifyStudentHash,
  deriveCloudDocId,
  deriveAdminWriteSecret,
  isValidCloudDocId,
  isValidAuthHash,
  isAdminStudentId,
  isAdminStudentHash,
  checkStudentLoginStatus,
  checkStudentSessionActive,
  subscribeStudentAccountStatus,
  isStudentAlreadyRegistered,
  lookupStudentWithCloud,
  verifyAdminPassword,
  verifyAndUnlockAdmin,
  setAdminWriteSecret,
  clearAdminWriteSecret,
  hasAdminWriteSecret,
  updateAdminPassword,
  loadSiteAccessSettings,
  subscribeSiteAccessSettings,
  saveSiteAccessSettings,
  loadCloudStudentPrefs,
  saveCloudStudentPrefs,
  loadActiveAnnouncements,
  subscribeAnnouncements,
  listAllAnnouncements,
  saveAnnouncement,
  deleteAnnouncement,
  loadAllLessonMaterials,
  subscribeLessonMaterials,
  saveLessonMaterial,
  deleteLessonMaterial,
  uploadLessonPdfFile,
  downloadLessonMaterialChunks,
  getCachedLessonPdfBlob,
  cacheLessonPdfBlob,
  generateLessonMaterialId,
  deleteServerPdfByUrl,
  addOrUpdateCustomStudent,
  deleteCustomStudent,
  loadAllAdminStudents,
  lookupStudentForAdmin,
  adminSaveStudentSettings,
  getGoogleAuthUser,
  onGoogleAuthChanged,
  signInWithGoogle,
  signOutGoogle,
  loadCloudUserNotes,
  saveCloudUserNote,
  deleteCloudUserNote,
};
window.dispatchEvent(new Event('inonu-auth-ready'));

if (import.meta.env.DEV) {
  const hasStaleDom = Boolean(document.getElementById('adminCloudAuthBar'));
  const cleanupDevSw = async () => {
    let changed = false;
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          if (await reg.unregister()) changed = true;
        }
      } catch {
        // Ignore SW cleanup errors in restricted iframes
      }
    }
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          if (key.includes('workbox') || key.includes('vite-plugin-pwa')) {
            if (await caches.delete(key)) changed = true;
          }
        }
      } catch {
        // Ignore CacheStorage errors
      }
    }
    try {
      if ((changed || hasStaleDom) && !sessionStorage.getItem('inonu_sw_reset_done')) {
        sessionStorage.setItem('inonu_sw_reset_done', '1');
        window.location.reload();
        return;
      }
      sessionStorage.removeItem('inonu_sw_reset_done');
    } catch {
      // Ignore sessionStorage errors in restricted or sandboxed iframes
    }
  };
  void cleanupDevSw();
} else {
  registerSW({
    immediate: true,
  });
}

createRoot(document.getElementById('root')!).render(<App />);
