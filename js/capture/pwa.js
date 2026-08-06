const SW_PATH = './sw.js';
const INSTALL_DISMISS_KEY = 'atlas_capture_install_dismissed';
const INSTALL_DISMISS_DAYS = 7;

let deferredInstallEvent = null;
let registration = null;

export function registerCaptureServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  
  return navigator.serviceWorker.register(SW_PATH, { scope: './' })
    .then(reg => {
      registration = reg;
      
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateAvailable();
          }
        });
      });
      
      return reg;
    })
    .catch(() => null);
}

export function initInstallExperience() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallEvent = e;
    
    if (!isInstallDismissed()) {
      showInstallButton();
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallEvent = null;
    hideInstallButton();
    showInstallSuccess();
  });

  const btnInstall = document.getElementById('btnInstall');
  const btnInstallLater = document.getElementById('btnInstallLater');

  if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
      if (!deferredInstallEvent) return;
      deferredInstallEvent.prompt();
      const { outcome } = await deferredInstallEvent.userChoice;
      if (outcome === 'dismissed') {
        dismissInstall();
      }
      deferredInstallEvent = null;
      hideInstallButton();
    });
  }

  if (btnInstallLater) {
    btnInstallLater.addEventListener('click', () => {
      dismissInstall();
      hideInstallButton();
    });
  }
}

export function showUpdateAvailable() {
  const banner = document.getElementById('updateBanner');
  if (!banner) return;
  banner.hidden = false;

  const btnUpdate = document.getElementById('btnUpdate');
  const btnLater = document.getElementById('btnUpdateLater');

  if (btnUpdate) {
    btnUpdate.addEventListener('click', () => {
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });
      banner.hidden = true;
    });
  }

  if (btnLater) {
    btnLater.addEventListener('click', () => {
      banner.hidden = true;
    });
  }
}

export function applyServiceWorkerUpdate() {
  if (registration && registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
}

function showInstallButton() {
  const banner = document.getElementById('installBanner');
  if (banner) banner.hidden = false;
}

function hideInstallButton() {
  const banner = document.getElementById('installBanner');
  if (banner) banner.hidden = true;
}

function showInstallSuccess() {
  import('./app.js').then(mod => {
    if (mod.showToast) mod.showToast('Atlas Capture установлен');
  }).catch(() => {});
}

function dismissInstall() {
  try {
    const dismissUntil = Date.now() + INSTALL_DISMISS_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(INSTALL_DISMISS_KEY, String(dismissUntil));
  } catch (_) {}
}

function isInstallDismissed() {
  try {
    const until = Number(localStorage.getItem(INSTALL_DISMISS_KEY));
    return until > 0 && Date.now() < until;
  } catch (_) {
    return false;
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || 
         window.navigator.standalone === true;
}

export function getServiceWorkerStatus() {
  if (!('serviceWorker' in navigator)) return 'не поддерживается';
  if (!registration) return 'не зарегистрирован';
  if (registration.active && registration.waiting) return 'ождает обновления';
  if (registration.active) return 'активен';
  return 'устанавливается';
}
