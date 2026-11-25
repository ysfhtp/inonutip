import { getBridge } from './bridge.ts';
import { LAST_SYNC_LS_KEY } from './liveStore.ts';

let initialized = false;

function formatLastSyncLabel(isEn: boolean): string {
  try {
    const ms = Number(localStorage.getItem(LAST_SYNC_LS_KEY) || 0);
    if (!ms) return isEn ? 'Local cache ready' : 'Yerel önbellek hazır';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return isEn ? `Last synced: ${timeStr}` : `Son eşitleme: ${timeStr}`;
  } catch {
    return isEn ? 'Local cache ready' : 'Yerel önbellek hazır';
  }
}

function detectPlatform(): 'ios' | 'android' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function initOfflineSupport(): void {
  if (initialized) return;
  initialized = true;

  const installCard = document.getElementById('installModalCard');
  if (installCard && !document.getElementById('pwaOfflineStatusPill')) {
    const statusBox = document.createElement('div');
    statusBox.id = 'pwaOfflineStatusPill';
    statusBox.className =
      'ios-pill-control rounded-2xl px-3 py-2.5 flex items-center justify-between gap-2 text-[11.5px]';
    statusBox.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span id="pwaOfflineDot" class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
        <div class="min-w-0">
          <span id="pwaOfflineStatusHeading" class="block font-bold text-slate-800 dark:text-slate-100 leading-tight truncate">Çevrimdışı Kullanıma Hazır</span>
          <span id="pwaOfflineSyncMeta" class="block text-[10.5px] text-slate-500 dark:text-slate-400 truncate tabular-nums mt-0.5"></span>
        </div>
      </div>
      <span id="pwaPlatformHintChip" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/12 text-blue-600 dark:text-blue-300 shrink-0">PWA</span>
    `;
    const stepsEl = document.getElementById('installStepsList');
    if (stepsEl && stepsEl.parentElement === installCard) {
      installCard.insertBefore(statusBox, stepsEl);
    } else {
      installCard.appendChild(statusBox);
    }
  }

  const syncOfflineCardUI = () => {
    const isEn = getBridge()?.getState().lang === 'en';
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const platform = detectPlatform();

    const dotEl = document.getElementById('pwaOfflineDot');
    const headingEl = document.getElementById('pwaOfflineStatusHeading');
    const metaEl = document.getElementById('pwaOfflineSyncMeta');
    const chipEl = document.getElementById('pwaPlatformHintChip');

    if (dotEl) {
      dotEl.className = isOffline
        ? 'w-2 h-2 rounded-full bg-amber-500 shrink-0 animate-pulse'
        : 'w-2 h-2 rounded-full bg-emerald-500 shrink-0';
    }
    if (headingEl) {
      headingEl.textContent = isOffline
        ? isEn
          ? 'Offline Mode Active'
          : 'Çevrimdışı Mod Aktif'
        : isEn
          ? 'Offline Ready & Cached'
          : 'Çevrimdışı Kullanıma Hazır';
    }
    if (metaEl) {
      metaEl.textContent = formatLastSyncLabel(isEn);
    }
    if (chipEl) {
      chipEl.textContent =
        platform === 'ios' ? 'iOS Safari' : platform === 'android' ? 'Android' : 'PWA';
    }
  };

  // Non-intrusive 1-tap PWA update bar when a fresh service worker version is available
  let pendingUpdateApply: (() => void) | null = null;
  const showUpdateBar = (applyFn: () => void) => {
    pendingUpdateApply = applyFn;
    let bar = document.getElementById('pwaUpdateReadyBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pwaUpdateReadyBar';
      bar.className =
        'fixed inset-x-3 sm:inset-x-auto sm:right-4 z-50 ios-glass rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-3 shadow-lg border border-blue-500/25';
      bar.style.bottom = 'calc(5.2rem + env(safe-area-inset-bottom, 0px))';
      document.body.appendChild(bar);
    }
    const isEn = getBridge()?.getState().lang === 'en';
    bar.classList.remove('hidden');
    bar.innerHTML = `
      <div class="min-w-0">
        <p class="text-xs font-bold text-slate-900 dark:text-white truncate">${isEn ? 'New version available' : 'Yeni güncelleme hazır'}</p>
        <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${isEn ? 'Tap to apply latest schedule & fixes.' : 'En güncel program ve iyileştirmeler için yenileyin.'}</p>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button id="btnPwaUpdateNow" type="button" class="ios-press px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold">${isEn ? 'Update' : 'Güncelle'}</button>
        <button id="btnPwaUpdateLater" type="button" class="ios-press w-7 h-7 rounded-full ios-pill-control text-slate-500 dark:text-slate-300 text-xs font-bold" aria-label="Kapat">✕</button>
      </div>
    `;
    bar.querySelector('#btnPwaUpdateNow')?.addEventListener('click', () => {
      getBridge()?.triggerHaptic('selection');
      bar?.classList.add('hidden');
      pendingUpdateApply?.();
    });
    bar.querySelector('#btnPwaUpdateLater')?.addEventListener('click', () => {
      bar?.classList.add('hidden');
    });
  };

  window.addEventListener('inonu-pwa-offline-ready', () => {
    syncOfflineCardUI();
    const isEn = getBridge()?.getState().lang === 'en';
    getBridge()?.showToast(
      isEn ? 'App cached for offline access.' : 'Uygulama çevrimdışı kullanım için önbelleğe alındı.'
    );
  });

  window.addEventListener('inonu-pwa-update-available', (ev: Event) => {
    const detail = (ev as CustomEvent<{ applyUpdate?: () => void }>).detail;
    if (typeof detail?.applyUpdate === 'function') {
      showUpdateBar(detail.applyUpdate);
    }
  });

  window.addEventListener('online', syncOfflineCardUI);
  window.addEventListener('offline', syncOfflineCardUI);
  window.addEventListener('inonu-cloud-synced', syncOfflineCardUI);
  window.addEventListener('inonu-ui-sync', syncOfflineCardUI);

  syncOfflineCardUI();
}
