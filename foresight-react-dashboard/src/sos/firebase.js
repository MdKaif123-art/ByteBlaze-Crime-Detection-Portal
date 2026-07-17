import { initializeApp, getApps } from "firebase/app";
import { getDatabase } from "firebase/database";

// Same Firebase app as sos admin (Makeathon `sos/sos/admin`) — hardcoded, no .env.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBlSprUJiA6MGTzF1DqUiYhoGtTcpoX3QY",
  authDomain: "sos-so.firebaseapp.com",
  databaseURL: "https://sos-so-default-rtdb.firebaseio.com",
  projectId: "sos-so",
  storageBucket: "sos-so.firebasestorage.app",
  messagingSenderId: "412396181955",
  appId: "1:412396181955:web:a8571c013bb2c9736d0576",
};

/** Same as admin `main.ts`: `onValue(ref(db, 'sos_alerts'), ...)` */
export const SOS_RTDB_PATH = "sos_alerts";

/** Same as admin: `onValue(ref(db, 'devices'), ...)` — “internet / mesh” live device locations */
export const DEVICES_RTDB_PATH = "devices";
export const PATROL_UNITS_RTDB_PATH = "patrol_units";
export const PATROL_ASSIGNMENTS_RTDB_PATH = "patrol_assignments";
export const PATROL_REPORTS_RTDB_PATH = "patrol_reports";

/** Patrol officer profile (written by patrol web app after login) */
export const PATROL_PROFILES_RTDB_PATH = "patrol_profiles";

/** Patrol → control room (inbox for dashboard) */
export const PATROL_TO_ADMIN_RTDB_PATH = "patrol_to_admin";

export function isFirebaseConfigured() {
  const c = FIREBASE_CONFIG;
  return Boolean(c.databaseURL && c.apiKey);
}

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) return null;
  const existing = getApps();
  if (existing.length) return existing[0];
  return initializeApp(FIREBASE_CONFIG);
}

export function getRealtimeDb() {
  const app = getFirebaseApp();
  return app ? getDatabase(app) : null;
}
