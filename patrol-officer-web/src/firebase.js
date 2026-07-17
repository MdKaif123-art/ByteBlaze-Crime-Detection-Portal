import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBlSprUJiA6MGTzF1DqUiYhoGtTcpoX3QY",
  authDomain: "sos-so.firebaseapp.com",
  databaseURL: "https://sos-so-default-rtdb.firebaseio.com",
  projectId: "sos-so",
  storageBucket: "sos-so.firebasestorage.app",
  messagingSenderId: "412396181955",
  appId: "1:412396181955:web:a8571c013bb2c9736d0576",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export const PATROL_TO_ADMIN_PATH = "patrol_to_admin";
