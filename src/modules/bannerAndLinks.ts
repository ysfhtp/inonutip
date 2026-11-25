import { getBridge } from './bridge.ts';
import { getBannerReadCount, getLiveStore, subscribeLiveStore, trackContentRead } from './liveStore.ts';

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

    // Track unique student view for this banner revision (skips admins automatically)
    void trackContentRead('banner_current', 'banner', banner.updatedAtMs || 1);

    const bannerReads = isAdmin ? getBannerReadCount(banner.updatedAtMs) : 0;

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
            ? `<div class="em-banner-actions flex items-center gap-1.5">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-black/10 dark:bg-white/10 tabular-nums" title="${isEn ? 'Unique student views' : 'Tekil öğrenci görüntülenmesi'}">
                  <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                  <span>${bannerReads}</span>
                </span>
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
