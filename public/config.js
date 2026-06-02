// Runtime configuration for the OrderFlow PWA.
//
// Loaded as a classic script BEFORE the app modules, so it can point the
// frontend at a backend on a different origin.
//
// - Backend-served mode (one server serves PWA + API): leave both empty.
// - Hybrid mode (PWA on GitHub Pages, API in the cloud): the Pages build
//   (scripts/build-pages.js) overwrites this file with the real API URL.
window.ORDERFLOW_CONFIG = {
  apiBase: "",       // e.g. "https://orderflow-api.onrender.com"
  socketScript: "",  // e.g. "./vendor/socket.io.min.js" (set by the Pages build)
};
