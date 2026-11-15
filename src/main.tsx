import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import {
  addOrUpdateCustomStudent,
  adminSaveStudentSettings,
  deleteAnnouncement,
  deleteCustomStudent,
  getFirebaseAdminStatus,
  listAllAnnouncements,
  loadActiveAnnouncements,
  loadAllAdminStudents,
  loadCloudStudentPrefs,
  lookupStudentForAdmin,
  lookupStudentWithCloud,
  saveAnnouncement,
  saveCloudStudentPrefs,
  signInAdminWithGoogle,
  signOutFirebaseAdmin,
  subscribeAdminAuthState,
  updateAdminPassword,
  verifyAdminPassword,
} from './firebasePrefs.ts';
import {
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
      isValidCloudDocId: typeof isValidCloudDocId;
      isValidAuthHash: typeof isValidAuthHash;
      isAdminStudentId: typeof isAdminStudentId;
      isAdminStudentHash: typeof isAdminStudentHash;
      lookupStudentWithCloud: typeof lookupStudentWithCloud;
      verifyAdminPassword: typeof verifyAdminPassword;
      updateAdminPassword: typeof updateAdminPassword;
      signInAdminWithGoogle: typeof signInAdminWithGoogle;
      signOutFirebaseAdmin: typeof signOutFirebaseAdmin;
      getFirebaseAdminStatus: typeof getFirebaseAdminStatus;
      subscribeAdminAuthState: typeof subscribeAdminAuthState;
      loadCloudStudentPrefs: typeof loadCloudStudentPrefs;
      saveCloudStudentPrefs: typeof saveCloudStudentPrefs;
      loadActiveAnnouncements: typeof loadActiveAnnouncements;
      listAllAnnouncements: typeof listAllAnnouncements;
      saveAnnouncement: typeof saveAnnouncement;
      deleteAnnouncement: typeof deleteAnnouncement;
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
  isValidCloudDocId,
  isValidAuthHash,
  isAdminStudentId,
  isAdminStudentHash,
  lookupStudentWithCloud,
  verifyAdminPassword,
  updateAdminPassword,
  signInAdminWithGoogle,
  signOutFirebaseAdmin,
  getFirebaseAdminStatus,
  subscribeAdminAuthState,
  loadCloudStudentPrefs,
  saveCloudStudentPrefs,
  loadActiveAnnouncements,
  listAllAnnouncements,
  saveAnnouncement,
  deleteAnnouncement,
  addOrUpdateCustomStudent,
  deleteCustomStudent,
  loadAllAdminStudents,
  lookupStudentForAdmin,
  adminSaveStudentSettings,
};
window.dispatchEvent(new Event('inonu-auth-ready'));

registerSW({
  immediate: true,
});

createRoot(document.getElementById('root')!).render(<App />);
