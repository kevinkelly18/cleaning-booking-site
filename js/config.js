/*
 * Paste your Firebase web app settings here.
 * Firebase console → Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
 * These values are meant to be public; the security rules in firestore.rules protect your data.
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAcdoCC9sSagYdmJNd9BerTObG50HVXxRU",
  authDomain: "kristally-klean.firebaseapp.com",
  projectId: "kristally-klean",
  storageBucket: "kristally-klean.firebasestorage.app",
  messagingSenderId: "827986917812",
  appId: "1:827986917812:web:c18c7b334d6872d25a5ae1",
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
