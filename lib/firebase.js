// lib/firebase.js
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  increment,
  query,
  orderBy,
  Timestamp,
  writeBatch,
  runTransaction,
} from 'firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// A missing or unloaded .env.local surfaces as "FirebaseError: auth/invalid-api-key"
// pointing at getAuth(app) — 25 lines below the real cause — which sends you hunting in
// entirely the wrong place. Fail here instead, and say what to do about it.
const MISSING_ENV = Object.entries({
  NEXT_PUBLIC_FIREBASE_API_KEY: firebaseConfig.apiKey,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: firebaseConfig.storageBucket,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: firebaseConfig.messagingSenderId,
  NEXT_PUBLIC_FIREBASE_APP_ID: firebaseConfig.appId,
}).filter(([, v]) => !v).map(([k]) => k);

if (MISSING_ENV.length) {
  throw new Error(
    `Firebase config is empty — .env.local was not loaded.\n\n`
    + `Missing: ${MISSING_ENV.join(', ')}\n\n`
    + `Fix:\n`
    + `  1. .env.local must sit next to package.json (NOT inside lib/).\n`
    + `  2. On Windows, make sure it is not actually named ".env.local.txt"\n`
    + `     (File Explorer hides known extensions).  cmd:  dir /a .env*\n`
    + `  3. Env vars are read at STARTUP only — stop the dev server,\n`
    + `     delete .next, and restart:  rd /s /q .next && npm run dev\n\n`
    + `Copy .env.local.example to .env.local and fill in your Firebase values.`,
  );
}

// Prevent multiple initializations in Next.js dev mode
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Offline-first persistence via the modern cache API. Configured at init time
// (client only) so it doesn't trip the dev Fast-Refresh reload loop the old
// enableMultiTabIndexedDbPersistence() call caused. Falls back to a plain
// in-memory Firestore on the server / SSR pass.
let db;
if (typeof window !== 'undefined') {
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    // initializeFirestore throws if Firestore was already initialized for this
    // app (e.g. Fast Refresh re-running the module) — reuse the existing one.
    db = getFirestore(app);
  }
} else {
  db = getFirestore(app);
}

const auth = getAuth(app);

export {
  db,
  auth,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  increment,
  query,
  orderBy,
  Timestamp,
  writeBatch,
  runTransaction,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
};
