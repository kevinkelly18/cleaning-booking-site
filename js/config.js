/*
 * Paste your Firebase web app settings here.
 * Firebase console → Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
 * These values are meant to be public; the security rules in firestore.rules protect your data.
 */
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  appId: "PASTE_APP_ID",
};

/* Shared start-up used by both pages. */
window.startFirebase = function () {
  const cfg = window.FIREBASE_CONFIG;
  const emulator = /[?&]emulator\b/.test(location.search);
  if (!emulator && (!cfg || String(cfg.apiKey).startsWith("PASTE"))) return null;
  const app = firebase.initializeApp(emulator ? { apiKey: "demo-key", projectId: "demo-crew", authDomain: "localhost" } : cfg);
  const db = firebase.firestore();
  if (emulator) {
    db.useEmulator("localhost", 8080);
    if (firebase.auth) firebase.auth().useEmulator("http://localhost:9099");
  }
  return { app, db };
};
