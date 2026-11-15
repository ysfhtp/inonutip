import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import {
  addOrUpdateCustomStudent,
  adminSaveStudentSettings,
  checkStudentLoginStatus,
  checkStudentSessionActive,
  clearAdminWriteSecret,
  deleteAnnouncement,
  deleteCustomStudent,
  deleteLessonMaterial,
  hasAdminWriteSecret,
  isStudentAlreadyRegistered,
  listAllAnnouncements,
  loadActiveAnnouncements,
  loadAllAdminStudents,
  loadAllLessonMaterials,
  loadCloudStudentPrefs,
  lookupStudentForAdmin,
  lookupStudentWithCloud,
  saveAnnouncement,
  saveCloudStudentPrefs,
  saveLessonMaterial,
  setAdminWriteSecret,
  subscribeStudentAccountStatus,
  updateAdminPassword,
  verifyAdminPassword,
  verifyAndUnlockAdmin,
} from './firebasePrefs.ts';
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
      loadCloudStudentPrefs: typeof loadCloudStudentPrefs;
      saveCloudStudentPrefs: typeof saveCloudStudentPrefs;
      loadActiveAnnouncements: typeof loadActiveAnnouncements;
      listAllAnnouncements: typeof listAllAnnouncements;
      saveAnnouncement: typeof saveAnnouncement;
      deleteAnnouncement: typeof deleteAnnouncement;
      loadAllLessonMaterials: typeof loadAllLessonMaterials;
      saveLessonMaterial: typeof saveLessonMaterial;
      deleteLessonMaterial: typeof deleteLessonMaterial;
      addOrUpdateCustomStudent: typeof addOrUpdateCustomStudent;
      deleteCustomStudent: typeof deleteCustomStudent;
      loadAllAdminStudents: typeof loadAllAdminStudents;
      lookupStudentForAdmin: typeof lookupStudentForAdmin;
      adminSaveStudentSettings: typeof adminSaveStudentSettings;
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
  loadCloudStudentPrefs,
  saveCloudStudentPrefs,
  loadActiveAnnouncements,
  listAllAnnouncements,
  saveAnnouncement,
  deleteAnnouncement,
  loadAllLessonMaterials,
  saveLessonMaterial,
  deleteLessonMaterial,
  addOrUpdateCustomStudent,
  deleteCustomStudent,
  loadAllAdminStudents,
  lookupStudentForAdmin,
  adminSaveStudentSettings,
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
    if ((changed || hasStaleDom) && !sessionStorage.getItem('inonu_sw_reset_done')) {
      sessionStorage.setItem('inonu_sw_reset_done', '1');
      window.location.reload();
      return;
    }
    sessionStorage.removeItem('inonu_sw_reset_done');
  };
  void cleanupDevSw();
} else {
  registerSW({
    immediate: true,
  });
}

createRoot(document.getElementById('root')!).render(<App />);
