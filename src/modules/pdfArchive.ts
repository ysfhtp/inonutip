import { getBridge, type BridgeMaterialItem } from './bridge.ts';

let initialized = false;
let modalOpen = false;
let searchQuery = '';
let filterProg: '' | 'tr' | 'en' = '';
let onlyCached = false;

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseDmyScore(dateStr: string): number {
  const parts = String(dateStr || '').split('.');
  if (parts.length !== 3) return 0;
  return Number(parts[2]) * 10000 + Number(parts[1]) * 100 + Number(parts[0]);
}

export function initPdfArchive(): void {
  if (initialized) return;
  initialized = true;

  // Create Liquid Glass Modal for Consolidated PDF Archive (#9)
  const overlay = document.createElement('div');
  overlay.id = 'pdfArchiveModal';
  overlay.className = 'pdf-arch-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div id="pdfArchiveCard" class="pdf-arch-card ios-glass" role="dialog" aria-modal="true" aria-labelledby="pdfArchTitle">
      <div class="pdf-arch-header">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-8 h-8 rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
          </span>
          <div class="min-w-0">
            <h3 id="pdfArchTitle" class="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-tight truncate">Kurul PDF Arşivi</h3>
            <p id="pdfArchSub" class="text-[11px] text-slate-500 dark:text-slate-400 truncate">Tüm yüklenen ders notları tek yerde</p>
          </div>
        </div>
        <button id="btnClosePdfArchive" type="button" class="ios-press w-8 h-8 rounded-full ios-pill-control text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0" aria-label="Kapat">✕</button>
      </div>

      <div class="pdf-arch-controls">
        <input id="pdfArchSearchInput" type="search" placeholder="Ders, konu veya tarih ara..." class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div id="pdfArchProgChips" class="flex items-center gap-1">
            <button type="button" data-arch-prog="" class="ios-press pdf-arch-chip is-active">Tümü</button>
            <button type="button" data-arch-prog="tr" class="ios-press pdf-arch-chip">TR</button>
            <button type="button" data-arch-prog="en" class="ios-press pdf-arch-chip">EN</button>
          </div>
          <button id="btnPdfArchCachedOnly" type="button" class="ios-press pdf-arch-chip">İndirilenler</button>
        </div>
      </div>

      <div id="pdfArchList" class="pdf-arch-list"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const titleEl = document.getElementById('pdfArchTitle')!;
  const subEl = document.getElementById('pdfArchSub')!;
  const searchInp = document.getElementById('pdfArchSearchInput') as HTMLInputElement;
  const cachedBtn = document.getElementById('btnPdfArchCachedOnly')!;
  const listEl = document.getElementById('pdfArchList')!;
  const closeBtn = document.getElementById('btnClosePdfArchive')!;

  let currentItems: BridgeMaterialItem[] = [];

  const renderList = () => {
    const bridge = getBridge();
    const isEn = bridge?.getState().lang === 'en';
    titleEl.textContent = isEn ? 'Lesson PDF Archive' : 'Kurul PDF Arşivi';
    searchInp.placeholder = isEn ? 'Search title, lesson, instructor, or date...' : 'Başlık, ders, hoca veya tarih ara...';
    cachedBtn.textContent = isEn ? 'Offline Cached' : 'Cihazda Kayıtlı';
    cachedBtn.classList.toggle('is-active', onlyCached);

    overlay.querySelectorAll<HTMLButtonElement>('[data-arch-prog]').forEach((b) => {
      const val = b.getAttribute('data-arch-prog') || '';
      if (val === '') b.textContent = isEn ? 'All' : 'Tümü';
      b.classList.toggle('is-active', val === filterProg);
    });

    const all = bridge ? bridge.getAllMaterials() : [];
    const q = searchQuery.trim().toLowerCase();

    currentItems = all
      .filter((m) => {
        if (filterProg && m.targetProg !== filterProg) return false;
        if (onlyCached && !m.cached) return false;
        if (!q) return true;
        const hay = `${m.title} ${m.pdfName || ''} ${m.lessonTitle || ''} ${m.lessonCode || ''} ${m.instructor || ''} ${m.date}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => parseDmyScore(b.date) - parseDmyScore(a.date) || a.slotNo - b.slotNo);

    subEl.textContent = isEn
      ? `${currentItems.length} of ${all.length} PDFs`
      : `Toplam ${all.length} PDF • ${currentItems.length} gösteriliyor`;

    if (currentItems.length === 0) {
      listEl.innerHTML = `
        <div class="ios-pill-control rounded-2xl p-6 text-center space-y-1">
          <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${isEn ? 'No PDFs found' : 'PDF bulunamadı'}</p>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">${isEn ? 'Uploaded lesson notes will appear here automatically.' : 'Yüklenen ders notları ve sunumlar burada listelenir.'}</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = currentItems
      .map((mat, idx) => {
        const sizeLabel = formatSize(mat.fileSize);
        const progTag = mat.targetProg === 'en' ? 'EN' : 'TR';
        return `
          <button type="button" data-arch-open-idx="${idx}" class="pdf-arch-item ios-press w-full text-left">
            <span class="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-500/12 text-slate-600 dark:text-slate-300 tabular-nums">${escapeHtml(mat.date)}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/12 text-blue-600 dark:text-blue-300">${progTag}</span>
                ${
                  mat.cached
                    ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">✓ ${isEn ? 'Saved' : 'Kayıtlı'}</span>`
                    : ''
                }
                ${sizeLabel ? `<span class="text-[10px] font-medium text-slate-400 tabular-nums">${sizeLabel}</span>` : ''}
              </div>
              <p class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug truncate mt-0.5">${escapeHtml(mat.title || mat.pdfName || 'PDF')}</p>
              ${
                mat.lessonTitle || mat.instructor
                  ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">${escapeHtml([mat.lessonTitle, mat.instructor].filter(Boolean).join(' · '))}</p>`
                  : ''
              }
            </div>
            <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
          </button>
        `;
      })
      .join('');
  };

  const openModal = () => {
    const bridge = getBridge();
    if (bridge?.isSiteLocked()) return;
    modalOpen = true;
    renderList();
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    bridge?.syncModalScrollLock();
    bridge?.triggerHaptic('light');
    window.__INONU_BACK_NAV__?.sync('open');
  };

  const closeModal = () => {
    if (!modalOpen) return;
    modalOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    window.__INONU_BACK_NAV__?.sync('close');
    window.setTimeout(() => {
      overlay.classList.add('hidden');
      getBridge()?.syncModalScrollLock();
    }, 220);
  };

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) closeModal();
  });

  searchInp.addEventListener('input', () => {
    searchQuery = searchInp.value;
    renderList();
  });

  overlay.querySelectorAll<HTMLButtonElement>('[data-arch-prog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterProg = (btn.getAttribute('data-arch-prog') || '') as '' | 'tr' | 'en';
      getBridge()?.triggerHaptic('selection');
      renderList();
    });
  });

  cachedBtn.addEventListener('click', () => {
    onlyCached = !onlyCached;
    getBridge()?.triggerHaptic('selection');
    renderList();
  });

  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-arch-open-idx]');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-arch-open-idx'));
    const mat = currentItems[idx];
    if (!mat) return;
    const bridge = getBridge();
    bridge?.triggerHaptic('selection');
    bridge?.openMaterial(mat);
  });

  window.__INONU_PDF_ARCHIVE__ = {
    open: openModal,
    close: closeModal,
  };
}
