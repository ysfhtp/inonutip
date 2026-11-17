import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export interface GoogleAuthUserSummary {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
}

// Keep Firebase ID token strictly in memory (never persisted to localStorage)
let inMemoryIdToken = '';
let currentAuthUser: GoogleAuthUserSummary | null = null;

function toUserSummary(user: User | null): GoogleAuthUserSummary | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || user.email || '',
    photoURL: user.photoURL || '',
  };
}

export function getCurrentGoogleUser(): GoogleAuthUserSummary | null {
  return currentAuthUser || toUserSummary(auth.currentUser);
}

export async function getFreshInMemoryIdToken(forceRefresh = false): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    inMemoryIdToken = '';
    return '';
  }
  if (!forceRefresh && inMemoryIdToken) {
    return inMemoryIdToken;
  }
  try {
    inMemoryIdToken = await user.getIdToken(forceRefresh);
    return inMemoryIdToken;
  } catch {
    inMemoryIdToken = '';
    return '';
  }
}

export async function signInWithGoogleAccount(): Promise<GoogleAuthUserSummary | null> {
  const cred = await signInWithPopup(auth, googleAuthProvider);
  inMemoryIdToken = await cred.user.getIdToken();
  currentAuthUser = toUserSummary(cred.user);
  return currentAuthUser;
}

export async function signOutGoogleAccount(): Promise<void> {
  inMemoryIdToken = '';
  currentAuthUser = null;
  await signOut(auth);
}

export function subscribeGoogleAuthUser(
  callback: (user: GoogleAuthUserSummary | null) => void,
): Unsubscribe {
  return onAuthStateChanged(auth, async (user) => {
    currentAuthUser = toUserSummary(user);
    if (user) {
      try {
        inMemoryIdToken = await user.getIdToken();
      } catch {
        inMemoryIdToken = '';
      }
    } else {
      inMemoryIdToken = '';
    }
    callback(currentAuthUser);
  });
}
