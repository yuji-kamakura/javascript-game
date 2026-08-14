let deferredInstallPrompt = null;
const installButtons = [
  document.getElementById("installButton"),
  document.getElementById("mobileInstallButton"),
].filter(Boolean);
const iosInstallHint = document.getElementById("iosInstallHint");
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

function setInstallButtonsVisible(visible) {
  installButtons.forEach((button) => {
    button.hidden = !visible;
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  setInstallButtonsVisible(true);
});

installButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      setInstallButtonsVisible(false);
    } else if (isIos && !isStandalone) {
      iosInstallHint.hidden = false;
    }
  });
});

if (isIos && !isStandalone) {
  const mobileButton = document.getElementById("mobileInstallButton");
  if (mobileButton) mobileButton.hidden = false;
}

document.querySelector("[data-dismiss-install]")?.addEventListener("click", () => {
  iosInstallHint.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  setInstallButtonsVisible(false);
  iosInstallHint.hidden = true;
});

function pauseForInterruption() {
  if (typeof resetInputState === "function") resetInputState();
  if (typeof gameState !== "undefined" && gameState === "playing") {
    gameState = "paused";
    if (typeof syncGameUI === "function") syncGameUI();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseForInterruption();
});
window.addEventListener("pagehide", pauseForInterruption);
window.matchMedia("(orientation: portrait)").addEventListener("change", (event) => {
  if (event.matches) pauseForInterruption();
});

document.getElementById("gameCanvas")?.addEventListener("contextmenu", (event) => {
  if (typeof gameState !== "undefined" && gameState === "playing") {
    event.preventDefault();
  }
});
