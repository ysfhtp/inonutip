import animeGirlImg from '../assets/images/anime_welcome_girl_1795691887550.jpg';
import { getBridge } from './bridge.ts';
import { getLiveStore, subscribeLiveStore } from './liveStore.ts';

let initialized = false;
let isOpen = false;
let hasPlayedThisLaunch = false;
let autoCloseTimer: number | null = null;

function isAppHardBlocked(): boolean {
  const maint = document.getElementById('maintenanceGateOverlay');
  if (maint && !maint.classList.contains('hidden') && maint.getAttribute('aria-hidden') !== 'true') {
    return true;
  }
  const bridge = getBridge();
  const auth = document.getElementById('authGate');
  if (bridge?.isSiteLocked() && auth && !auth.classList.contains('hidden')) {
    return true;
  }
  return false;
}

export function initAnimeWelcome(): void {
  if (initialized) return;
  initialized = true;

  // Build floating sakura petals HTML
  const petalsHtml = Array.from({ length: 12 }, (_, idx) => {
    const leftPct = (idx * 8.5 + 3) % 96;
    const delaySec = ((idx * 0.43) % 3.2).toFixed(2);
    const durSec = (4.2 + (idx % 4) * 0.85).toFixed(2);
    const sizePx = 11 + (idx % 4) * 3;
    return `<span class="aw-petal" style="left:${leftPct}%;width:${sizePx}px;height:${Math.round(sizePx * 0.72)}px;animation-delay:${delaySec}s;animation-duration:${durSec}s" aria-hidden="true"></span>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'animeWelcomeOverlay';
  overlay.className = 'aw-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="aw-petals-layer" aria-hidden="true">${petalsHtml}</div>
    <div id="animeWelcomeCard" class="aw-card ios-glass" role="dialog" aria-modal="true" aria-labelledby="awTitle">
      <div class="aw-portrait-wrap">
        <span class="aw-sparkle aw-sp-1" aria-hidden="true">✦</span>
        <span class="aw-sparkle aw-sp-2" aria-hidden="true">✧</span>
        <span class="aw-sparkle aw-sp-3" aria-hidden="true">✦</span>
        <div class="aw-portrait-ring">
          <img
            src="${animeGirlImg}"
            alt="Anime karşılama karakteri"
            class="aw-portrait-img"
            referrerpolicy="no-referrer"
            decoding="async"
          />
        </div>
        <span class="aw-wave-badge" aria-hidden="true">👋🌸</span>
      </div>

      <div class="aw-bubble">
        <h2 id="awTitle" class="aw-title">Hoş Geldin! 🌸</h2>
        <p id="awMessage" class="aw-message">Bugünkü derslerinde bol şans, harika bir gün dilerim!</p>
      </div>

      <button id="btnAwDismiss" type="button" class="aw-cta ios-press">
        <span>Başlayalım</span>
        <span aria-hidden="true">✨</span>
      </button>

      <div class="aw-progress-track" aria-hidden="true">
        <div id="awProgressFill" class="aw-progress-fill"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const titleEl = document.getElementById('awTitle')!;
  const msgEl = document.getElementById('awMessage')!;
  const progressFill = document.getElementById('awProgressFill') as HTMLElement;
  const dismissBtn = document.getElementById('btnAwDismiss')!;

  const clearAutoClose = () => {
    if (autoCloseTimer !== null) {
      window.clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    clearAutoClose();
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    window.__INONU_BACK_NAV__?.sync('close');
    window.setTimeout(() => {
      if (!isOpen) {
        overlay.classList.add('hidden');
        getBridge()?.syncModalScrollLock();
      }
    }, 320);
  };

  const open = (isPreview = false) => {
    const bridge = getBridge();
    const snap = getLiveStore();
    const cfg = snap.animeWelcome;
    const session = bridge?.getSession();
    const firstName = session?.name ? String(session.name).trim().split(/\s+/)[0] : '';

    const rawTitle = (cfg.title || 'Hoş Geldin! 🌸').trim();
    const renderedTitle =
      !isPreview && firstName && /^hoş\s*geldin!?(\s*🌸)?$/i.test(rawTitle)
        ? `Hoş Geldin, ${firstName}! 🌸`
        : rawTitle;
    titleEl.textContent = renderedTitle;
    msgEl.textContent =
      (cfg.message || 'Bugünkü derslerinde bol şans, harika bir gün dilerim!').trim();

    clearAutoClose();
    isOpen = true;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');

    // Restart auto-close progress bar cleanly
    progressFill.classList.remove('is-running');
    void progressFill.offsetWidth;

    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      progressFill.classList.add('is-running');
    });

    bridge?.syncModalScrollLock();
    bridge?.triggerHaptic('light');
    window.__INONU_BACK_NAV__?.sync('open');

    autoCloseTimer = window.setTimeout(() => {
      close();
    }, 5600);
  };

  const maybeTriggerOnLaunch = () => {
    if (hasPlayedThisLaunch || isOpen) return;
    if (isAppHardBlocked()) return;

    const bridge = getBridge();
    const session = bridge?.getSession();
    const sessionHash = String(session?.hash || '').trim().toLowerCase();
    if (!sessionHash || !/^[a-f0-9]{32}$/.test(sessionHash)) return;

    const cfg = getLiveStore().animeWelcome;
    if (!cfg.active) return;
    if (!cfg.allowedHashes.includes(sessionHash)) return;

    hasPlayedThisLaunch = true;
    // Slight delay so the main app shell finishes painting before the anime splash pops in
    window.setTimeout(() => {
      if (!isAppHardBlocked() && !isOpen) {
        open(false);
      }
    }, 320);
  };

  dismissBtn.addEventListener('click', () => {
    getBridge()?.triggerHaptic('selection');
    close();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  subscribeLiveStore(() => {
    maybeTriggerOnLaunch();
  });

  window.addEventListener('inonu-ui-sync', () => {
    maybeTriggerOnLaunch();
  });

  window.__INONU_ANIME_WELCOME__ = {
    preview: () => open(true),
    close,
  };

  maybeTriggerOnLaunch();
}
