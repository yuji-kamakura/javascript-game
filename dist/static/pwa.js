let deferredInstallPrompt = null;
const installButton = document.getElementById("installButton");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && typeof gameState !== "undefined" && gameState === "playing") {
    gameState = "paused";
  }
});

window.addEventListener("contextmenu", (event) => event.preventDefault());
