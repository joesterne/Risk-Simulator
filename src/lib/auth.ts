import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const configWithKey = {
  ...firebaseConfig,
  apiKey: (import.meta as any).env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey
};

const app = initializeApp(configWithKey);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Request Workspace scopes
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/chat.messages');
provider.addScope('https://www.googleapis.com/auth/chat.spaces');

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0; // epoch ms
// Google access tokens live ~60 minutes; treat the cache as stale a little early so
// Drive/Chat calls don't start failing with a generic error an hour after sign-in.
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

const tokenStillValid = () => cachedAccessToken !== null && Date.now() < cachedTokenExpiresAt;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (tokenStillValid()) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken!);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        cachedTokenExpiresAt = 0;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      cachedTokenExpiresAt = 0;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    cachedTokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!tokenStillValid()) {
    cachedAccessToken = null;
    cachedTokenExpiresAt = 0;
    return null;
  }
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  cachedTokenExpiresAt = 0;
};
