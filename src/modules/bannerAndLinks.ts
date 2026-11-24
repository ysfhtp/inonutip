import { getBridge } from './bridge.ts';
import { getLiveStore, subscribeLiveStore } from './liveStore.ts';

let initialized = false;

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initBannerAndLinks(): void {
  if (initialized) return;
  initialized = true;

  const mainEl = document.querySelector('main');
  if (!mainEl) return;

  let bannerHost = document.getElementById('emergencyBannerHost');
  if (!bannerHost) {
    bannerHost = document.createElement('div');
    bannerHost.id = 'emergencyBannerHost';
    bannerHost.className = 'hidden mb-3';
    mainEl.insertBefore(bannerHost, mainEl.firstChild);
  }

  const renderBanner = () => {
    if (!bannerHost) return;
    const bridge = getBridge();
    const isEn = bridge?.getState().lang === 'en';
    const isAdmin = Boolean(bridge?.isAdmin());
    const { banner } = getLiveStore();

    if (!banner.active || !banner.text.trim()) {
      bannerHost.classList.add('hidden');
      bannerHost.innerHTML = '';
      return;
    }

    const toneCls =
      banner.tone === 'info'
        ? 'em-banner-info'
        : banner.tone === 'warn'
          ? 'em-banner-warn'
          : 'em-banner-urgent';
    const toneTag =
      banner.tone === 'info'
        ? isEn ? 'INFO' : 'BİLGİ'
        : banner.tone === 'warn'
          ? isEn ? 'NOTICE' : 'UYARI'
          : isEn ? 'URGENT' : 'ACİL';

    bannerHost.classList.remove('hidden');
    bannerHost.innerHTML = `
      <div class="em-banner ios-glass ${toneCls}" role="alert" aria-live="assertive">
        <div class="em-banner-body">
          <span class="em-banner-tag">
            <span class="em-banner-pulse" aria-hidden="true"></span>
            <span>${toneTag}</span>
          </span>
          <p class="em-banner-text">${escapeHtml(banner.text)}</p>
        </div>
        ${
          isAdmin
            ? `<div class="em-banner-actions">
                <button type="button" data-em-edit="1" class="ios-press em-banner-edit-btn">${isEn ? 'Edit' : 'Düzenle'}</button>
              </div>`
            : ''
        }
      </div>
    `;

    bannerHost.querySelector('[data-em-edit]')?.addEventListener('click', () => {
      bridge?.triggerHaptic('selection');
      window.__INONU_ADMIN_EXTRAS__?.openPane('extras-banner');
    });
  };

  subscribeLiveStore(renderBanner);
  window.addEventListener('inonu-ui-sync', renderBanner);
}
