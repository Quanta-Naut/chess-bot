// The service worker (with the manifest in index.html) is what lets the browser offer to install Pawnie
// as an app; the browser shows its own install prompt. It also keeps the big engine files cached. Production only.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // the app works the same without it, it just can't be installed
    });
  });
}
