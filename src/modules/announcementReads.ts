import { getBridge } from './bridge.ts';

const STORAGE_KEY = 'inonu_tip_d1_ios_v3_annPrefs_v1';

interface AnnPrefs {
  readIds: string[];
  pinnedIds: string[];
}

let initialized = false;
let isEnhancing = false;

function loadPrefs(): AnnPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      readIds: Array.isArray(parsed?.readIds) ? parsed.readIds.map(String) : [],
      pinnedIds: Array.isArray(parsed?.pinnedIds) ? parsed.pinnedIds.map(String) : [],
    };
  } catch {
    return { readIds: [], pinnedIds: [] };
  }
}

function savePrefs(prefs: AnnPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

function getStrings(lang: 'tr' | 'en') {
  if (lang === 'en') {
    return {
      newBadge: 'NEW',
      pinTitle: 'Pin to top',
      unpinTitle: 'Unpin',
      markReadTitle: 'Mark as read & collapse',
      markUnreadTitle: 'Expand / mark unread',
      readDone: 'Read',
      pinnedToast: 'Announcement pinned to top',
      unpinnedToast: 'Announcement unpinned',
      readToast: 'Marked as read',
    };
  }
  return {
    newBadge: 'YENİ',
    pinTitle: 'Üste sabitle',
    unpinTitle: 'Sabitlemeyi kaldır',
    markReadTitle: 'Okundu olarak işaretle ve küçült',
    markUnreadTitle: 'Genişlet / okunmadı yap',
    readDone: 'Okundu',
    pinnedToast: 'Duyuru en üste sabitlendi',
    unpinnedToast: 'Sabitleme kaldırıldı',
    readToast: 'Okundu olarak işaretlendi',
  };
}

export function initAnnouncementReads(): void {
  if (initialized) return;
  const container = document.getElementById('dailyAnnouncementsContainer');
  if (!container) return;
  initialized = true;

  let prefs = loadPrefs();
  const readSet = new Set<string>(prefs.readIds);
  const pinnedSet = new Set<string>(prefs.pinnedIds);

  const persist = () => {
    prefs = {
      readIds: Array.from(readSet).slice(-120),
      pinnedIds: Array.from(pinnedSet).slice(-40),
    };
    savePrefs(prefs);
  };

  const syncCardVisual = (card: HTMLElement, annId: string) => {
    const bridge = getBridge();
    const lang = bridge?.getState().lang === 'en' ? 'en' : 'tr';
    const loc = getStrings(lang);
    const isRead = readSet.has(annId);
    const isPinned = pinnedSet.has(annId);

    card.classList.toggle('ann-is-read', isRead);
    card.classList.toggle('ann-is-pinned', isPinned);

    const newBadge = card.querySelector<HTMLElement>('.ann-new-badge');
    if (newBadge) {
      newBadge.textContent = loc.newBadge;
      newBadge.classList.toggle('hidden', isRead);
    }

    const pinBtn = card.querySelector<HTMLButtonElement>('.ann-btn-pin');
    if (pinBtn) {
      pinBtn.classList.toggle('is-active', isPinned);
      pinBtn.setAttribute('aria-label', isPinned ? loc.unpinTitle : loc.pinTitle);
      pinBtn.title = isPinned ? loc.unpinTitle : loc.pinTitle;
    }

    const readBtn = card.querySelector<HTMLButtonElement>('.ann-btn-read');
    if (readBtn) {
      readBtn.classList.toggle('is-active', isRead);
      readBtn.setAttribute('aria-label', isRead ? loc.markUnreadTitle : loc.markReadTitle);
      readBtn.title = isRead ? loc.markUnreadTitle : loc.markReadTitle;
      const lbl = readBtn.querySelector<HTMLElement>('.ann-read-lbl');
      if (lbl) lbl.textContent = isRead ? loc.readDone : '';
    }
  };

  const reorderCards = () => {
    const cards = Array.from(container.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && Boolean(el.dataset.annId)
    );
    if (cards.length <= 1) return;

    const scoreOf = (el: HTMLElement) => {
      const id = el.dataset.annId || '';
      if (pinnedSet.has(id)) return 0;
      if (!readSet.has(id)) return 1;
      return 2;
    };

    const sorted = [...cards].sort((a, b) => scoreOf(a) - scoreOf(b));
    let changed = false;
    for (let i = 0; i < sorted.length; i++) {
      if (cards[i] !== sorted[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    isEnhancing = true;
    try {
      sorted.forEach((c) => container.appendChild(c));
    } finally {
      isEnhancing = false;
    }
  };

  const enhanceCards = () => {
    if (isEnhancing) return;
    isEnhancing = true;
    try {
      const bridge = getBridge();
      const lang = bridge?.getState().lang === 'en' ? 'en' : 'tr';
      const loc = getStrings(lang);

      const cards = Array.from(container.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && Boolean(el.dataset.annId)
      );

      cards.forEach((card) => {
        const annId = card.dataset.annId || '';
        if (!annId) return;

        if (!card.dataset.annEnhanced) {
          card.dataset.annEnhanced = '1';
          const headerRow = card.firstElementChild as HTMLElement | null;
          const msgEl = card.querySelector('p');
          if (msgEl) msgEl.classList.add('ann-msg-body');

          if (headerRow) {
            const titleGroup = headerRow.firstElementChild as HTMLElement | null;
            if (titleGroup) {
              const newBadge = document.createElement('span');
              newBadge.className = 'ann-new-badge';
              newBadge.textContent = loc.newBadge;
              titleGroup.insertBefore(newBadge, titleGroup.firstChild);
            }

            const controls = document.createElement('div');
            controls.className = 'ann-controls';

            const pinBtn = document.createElement('button');
            pinBtn.type = 'button';
            pinBtn.className = 'ann-ctrl-btn ann-btn-pin ios-press';
            pinBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>`;

            const readBtn = document.createElement('button');
            readBtn.type = 'button';
            readBtn.className = 'ann-ctrl-btn ann-btn-read ios-press';
            readBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg><span class="ann-read-lbl"></span>`;

            const stopTouch = (e: Event) => e.stopPropagation();
            pinBtn.addEventListener('touchstart', stopTouch, { passive: true });
            readBtn.addEventListener('touchstart', stopTouch, { passive: true });
            pinBtn.addEventListener('mousedown', stopTouch);
            readBtn.addEventListener('mousedown', stopTouch);

            pinBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const b = getBridge();
              const curLoc = getStrings(b?.getState().lang === 'en' ? 'en' : 'tr');
              if (pinnedSet.has(annId)) {
                pinnedSet.delete(annId);
                b?.showToast(curLoc.unpinnedToast);
              } else {
                pinnedSet.add(annId);
                readSet.delete(annId);
                b?.showToast(curLoc.pinnedToast);
              }
              persist();
              b?.triggerHaptic('selection');
              syncCardVisual(card, annId);
              reorderCards();
            });

            readBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const b = getBridge();
              const curLoc = getStrings(b?.getState().lang === 'en' ? 'en' : 'tr');
              if (readSet.has(annId)) {
                readSet.delete(annId);
              } else {
                readSet.add(annId);
                pinnedSet.delete(annId);
                b?.showToast(curLoc.readToast);
              }
              persist();
              b?.triggerHaptic('light');
              syncCardVisual(card, annId);
              reorderCards();
            });

            // Clicking a collapsed read card expands it smoothly
            card.addEventListener('click', (e) => {
              if (!readSet.has(annId)) return;
              if ((e.target as HTMLElement)?.closest('button, a')) return;
              readSet.delete(annId);
              persist();
              getBridge()?.triggerHaptic('light');
              syncCardVisual(card, annId);
              reorderCards();
            });

            controls.appendChild(pinBtn);
            controls.appendChild(readBtn);
            headerRow.appendChild(controls);
          }
        }

        syncCardVisual(card, annId);
      });
    } finally {
      isEnhancing = false;
    }
    reorderCards();
  };

  const obs = new MutationObserver(() => enhanceCards());
  obs.observe(container, { childList: true });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('#btnLangTr, #btnLangEn, #btnAuthLangTr, #btnAuthLangEn')) {
      setTimeout(enhanceCards, 120);
    }
  });

  enhanceCards();
}
