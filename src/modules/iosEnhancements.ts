import { getBridge, type BridgeScheduleSlot } from './bridge.ts';

let initialized = false;
let ctxOpen = false;
let activeCtxSlot: BridgeScheduleSlot | null = null;

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==================== #2: UNIVERSAL iOS BOTTOM SHEET + SWIPE-TO-DISMISS ==================== */
interface SheetSpec {
  modalId: string;
  cardId: string;
  close: () => void;
}

function attachSwipeToDismissSheet(spec: SheetSpec): void {
  const modal = document.getElementById(spec.modalId);
  const card = document.getElementById(spec.cardId);
  if (!modal || !card || card.dataset.iosSheetBound === '1') return;
  card.dataset.iosSheetBound = '1';

  modal.classList.add('ios-sheet-modal');
  card.classList.add('ios-sheet-card');

  // Inject translucent iOS grab handle pill at top of card (mobile only via CSS)
  let handle = card.querySelector<HTMLDivElement>(':scope > .ios-sheet-grab');
  if (!handle) {
    handle = document.createElement('div');
    handle.className = 'ios-sheet-grab';
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = '<span></span>';
    card.insertBefore(handle, card.firstChild);
  }

  let tracking = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let currentDy = 0;

  const isScrollableAtTop = (targetEl: HTMLElement | null): boolean => {
    if (card.scrollTop > 2) return false;
    let node: HTMLElement | null = targetEl;
    while (node && node !== card) {
      const style = window.getComputedStyle(node);
      const oy = style.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 2) {
        if (node.scrollTop > 2) return false;
      }
      node = node.parentElement;
    }
    return true;
  };

  const resetCardStyle = () => {
    card.style.transition = '';
    card.style.transform = '';
    modal.style.backgroundColor = '';
    card.classList.remove('is-sheet-dragging', 'is-sheet-snapping');
  };

  card.addEventListener(
    'touchstart',
    (e) => {
      if (window.innerWidth >= 640) return;
      if (!e.touches || e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      const onHandle = Boolean(target?.closest('.ios-sheet-grab'));
      if (!onHandle) {
        // Ignore interactive controls or horizontal carousels unless starting directly on the grab handle
        if (target?.closest('button, a, input, textarea, select, [contenteditable], .snap-x')) return;
        if (!isScrollableAtTop(target)) return;
      }
      tracking = true;
      dragging = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      currentDy = 0;
    },
    { passive: true }
  );

  card.addEventListener(
    'touchmove',
    (e) => {
      if (!tracking || !e.touches || e.touches.length !== 1) return;
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = e.touches[0].clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 7 && dx < 7) return;
        if (dx > Math.abs(dy) * 0.85 || dy < -6) {
          tracking = false;
          return;
        }
        dragging = true;
        card.classList.remove('is-sheet-snapping');
        card.classList.add('is-sheet-dragging');
      }
      if (dy <= 0) {
        currentDy = dy * 0.14;
      } else {
        currentDy = dy;
        if (e.cancelable) e.preventDefault();
      }
      card.style.transform = `translate3d(0, ${currentDy.toFixed(1)}px, 0)`;
      const fadeRatio = Math.max(0.06, 0.38 * (1 - Math.min(Math.max(dy, 0) / 340, 0.86)));
      modal.style.backgroundColor = `rgba(0, 0, 0, ${fadeRatio.toFixed(3)})`;
    },
    { passive: false }
  );

  const finishDrag = () => {
    tracking = false;
    if (!dragging) return;
    dragging = false;
    card.classList.remove('is-sheet-dragging');
    const elapsed = Math.max(1, Date.now() - startTime);
    const velocity = currentDy / elapsed;
    if (currentDy > 86 || (currentDy > 38 && velocity > 0.42)) {
      resetCardStyle();
      getBridge()?.triggerHaptic('light');
      spec.close();
    } else {
      card.classList.add('is-sheet-snapping');
      card.style.transform = 'translate3d(0, 0, 0)';
      modal.style.backgroundColor = '';
      window.setTimeout(resetCardStyle, 320);
    }
  };

  card.addEventListener('touchend', finishDrag, { passive: true });
  card.addEventListener('touchcancel', finishDrag, { passive: true });
}

function initUniversalIosSheets(): void {
  const bridge = getBridge();
  if (!bridge) return;

  const specs: SheetSpec[] = [
    { modalId: 'settingsMenuModal', cardId: 'settingsMenuCard', close: () => bridge.closeModalById('settingsMenuModal') },
    { modalId: 'groupModal', cardId: 'groupModalCard', close: () => bridge.closeModalById('groupModal') },
    { modalId: 'noteModal', cardId: 'noteModalCard', close: () => bridge.closeModalById('noteModal') },
    { modalId: 'lessonPdfsModal', cardId: 'lessonPdfsModalCard', close: () => bridge.closeModalById('lessonPdfsModal') },
    { modalId: 'paletteModal', cardId: 'paletteModalCard', close: () => bridge.closeModalById('paletteModal') },
    { modalId: 'dailyDateModal', cardId: 'dailyDateModalCard', close: () => bridge.closeModalById('dailyDateModal') },
    { modalId: 'foodDateModal', cardId: 'foodDateModalCard', close: () => bridge.closeModalById('foodDateModal') },
    { modalId: 'installModal', cardId: 'installModalCard', close: () => bridge.closeModalById('installModal') },
    { modalId: 'instructorModal', cardId: 'instructorModalCard', close: () => bridge.closeModalById('instructorModal') },
    { modalId: 'studentFeedbackModal', cardId: 'studentFeedbackCard', close: () => window.__INONU_FEEDBACK__?.close() },
    { modalId: 'pdfArchiveModal', cardId: 'pdfArchiveCard', close: () => window.__INONU_PDF_ARCHIVE__?.close() },
  ];

  // Bind immediately for static DOM modals, and retry once on next frame for dynamically mounted module modals
  specs.forEach(attachSwipeToDismissSheet);
  window.setTimeout(() => specs.forEach(attachSwipeToDismissSheet), 250);
}

/* ==================== #4: STUDENT iOS PEEK & POP CONTEXT MENU ==================== */
function initStudentSlotContextMenu(): {
  open: (slot: BridgeScheduleSlot) => void;
  close: () => void;
} {
  const overlay = document.createElement('div');
  overlay.id = 'studentSlotContextModal';
  overlay.className = 'ios-ctx-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="ios-ctx-stack" role="dialog" aria-modal="true" aria-labelledby="iosCtxTitle">
      <div class="ios-ctx-peek ios-glass">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span id="iosCtxMeta" class="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 tabular-nums"></span>
          <span id="iosCtxCode" class="hidden px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/12 text-blue-700 dark:text-blue-300"></span>
        </div>
        <h3 id="iosCtxTitle" class="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-white leading-snug"></h3>
        <p id="iosCtxSub" class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug"></p>
      </div>
      <div id="iosCtxMenu" class="ios-ctx-menu ios-glass"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const metaEl = document.getElementById('iosCtxMeta')!;
  const codeEl = document.getElementById('iosCtxCode')!;
  const titleEl = document.getElementById('iosCtxTitle')!;
  const subEl = document.getElementById('iosCtxSub')!;
  const menuEl = document.getElementById('iosCtxMenu')!;

  const close = () => {
    if (!ctxOpen) return;
    ctxOpen = false;
    activeCtxSlot = null;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    window.__INONU_BACK_NAV__?.sync('close');
    window.setTimeout(() => {
      if (!ctxOpen) {
        overlay.classList.add('hidden');
        getBridge()?.syncModalScrollLock();
      }
    }, 220);
  };

  const open = (slot: BridgeScheduleSlot) => {
    const bridge = getBridge();
    if (!bridge || bridge.isSiteLocked() || !slot) return;
    activeCtxSlot = slot;
    ctxOpen = true;

    const isEn = bridge.getState().lang === 'en';
    const hasNote = bridge.hasNoteForSlot(slot);
    const pdfCount = bridge.getMaterialsCountForSlot(slot);
    const hasInstructor = Boolean(slot.instructor && slot.instructor.trim());

    metaEl.textContent = `${slot.date || ''} • ${slot.time || ''}`.replace(/^\s*•\s*|\s*•\s*$/g, '');
    if (slot.code && slot.code.trim()) {
      codeEl.textContent = slot.code.trim();
      codeEl.classList.remove('hidden');
    } else {
      codeEl.classList.add('hidden');
    }
    titleEl.textContent = slot.title || (isEn ? 'Lesson' : 'Ders');
    const subParts = [slot.instructor, slot.location, slot.group].filter((x) => Boolean(x && String(x).trim()));
    subEl.textContent = subParts.join(' · ') || (isEn ? 'Lesson details' : 'Ders detayları');

    const rows: Array<{ action: string; label: string; badge?: string; icon: string; tone?: string }> = [
      {
        action: 'note',
        label: hasNote ? (isEn ? 'Edit Lesson Note' : 'Ders Notunu Düzenle') : (isEn ? 'Add Lesson Note' : 'Ders Notu Ekle'),
        badge: hasNote ? (isEn ? 'Saved' : 'Not Var') : undefined,
        icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>',
        tone: 'text-amber-600 dark:text-amber-400',
      },
      {
        action: 'pdfs',
        label: pdfCount > 0 ? (isEn ? 'View Lesson PDFs' : 'Ders PDF\'lerini Gör') : (isEn ? 'Open PDF Archive' : 'Kurul PDF Arşivini Aç'),
        badge: pdfCount > 0 ? `${pdfCount} PDF` : undefined,
        icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>',
        tone: 'text-rose-600 dark:text-rose-400',
      },
    ];

    if (hasInstructor) {
      rows.push({
        action: 'instructor',
        label: isEn ? 'Instructor\'s Other Lessons' : 'Hocanın Diğer Dersleri',
        icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>',
        tone: 'text-blue-600 dark:text-blue-400',
      });
    }

    rows.push({
      action: 'copy',
      label: isEn ? 'Copy Lesson Info' : 'Ders Bilgisini Kopyala',
      icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>',
      tone: 'text-slate-600 dark:text-slate-300',
    });

    menuEl.innerHTML = rows
      .map(
        (r) => `
          <button type="button" data-ios-ctx-action="${r.action}" class="ios-ctx-row ios-press">
            <span class="ios-ctx-row-main">
              <span class="ios-ctx-row-label">${escapeHtml(r.label)}</span>
              ${r.badge ? `<span class="ios-ctx-row-badge">${escapeHtml(r.badge)}</span>` : ''}
            </span>
            <span class="ios-ctx-row-icon ${r.tone || ''}">${r.icon}</span>
          </button>
        `
      )
      .join('');

    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    bridge.syncModalScrollLock();
    window.__INONU_BACK_NAV__?.sync('open');
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  menuEl.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ios-ctx-action]');
    if (!btn || !activeCtxSlot) return;
    const action = btn.getAttribute('data-ios-ctx-action');
    const slot = activeCtxSlot;
    const bridge = getBridge();
    if (!bridge) return;
    const isEn = bridge.getState().lang === 'en';

    close();
    bridge.triggerHaptic('selection');

    if (action === 'note') {
      bridge.openNoteModalForSlot(slot);
    } else if (action === 'pdfs') {
      const opened = bridge.openLessonPdfsForSlot(slot);
      if (!opened) {
        window.__INONU_PDF_ARCHIVE__?.open();
      }
    } else if (action === 'instructor' && slot.instructor) {
      bridge.openInstructorModalByName(slot.instructor);
    } else if (action === 'copy') {
      const text = [
        [slot.date, slot.time].filter(Boolean).join(' • '),
        slot.title,
        [slot.instructor, slot.location].filter(Boolean).join(' — '),
      ]
        .filter(Boolean)
        .join('\n');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        bridge.triggerHaptic('success');
        bridge.showToast(isEn ? 'Lesson info copied' : 'Ders bilgisi kopyalandı');
      } catch {
        bridge.showToast(isEn ? 'Could not copy' : 'Kopyalanamadı');
      }
    }
  });

  return { open, close };
}

/* ==================== #6: iOS COLLAPSING LARGE TITLE ==================== */
function getTabLargeTitle(tab: string, lang: 'tr' | 'en'): string {
  const trMap: Record<string, string> = {
    daily: 'Günlük Program',
    weekly: 'Haftalık Program',
    food: 'Yemekhane',
    search: 'Arama',
    info: 'Sınav & Bilgi',
  };
  const enMap: Record<string, string> = {
    daily: 'Daily Schedule',
    weekly: 'Weekly Schedule',
    food: 'Cafeteria',
    search: 'Search',
    info: 'Exams & Info',
  };
  return (lang === 'en' ? enMap : trMap)[tab] || (lang === 'en' ? 'Schedule' : 'Program');
}

function initCollapsingLargeTitle(): { sync: () => void } {
  const mainEl = document.getElementById('appMain');
  const headerTitleEl = document.getElementById('headerAppTitle');
  if (!mainEl) return { sync: () => {} };

  let bar = document.getElementById('iosLargeTitleBar') as HTMLDivElement | null;
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'iosLargeTitleBar';
    bar.className = 'ios-large-title-bar';
    bar.innerHTML = `<h2 id="iosLargeTitleText" class="ios-large-title-text">Günlük Program</h2>`;
    const ptr = document.getElementById('ptrIndicator');
    if (ptr && ptr.parentElement === mainEl) {
      ptr.insertAdjacentElement('afterend', bar);
    } else {
      mainEl.insertBefore(bar, mainEl.firstChild);
    }
  }

  const titleTextEl = document.getElementById('iosLargeTitleText')!;
  let defaultHeaderTitle = headerTitleEl?.textContent?.trim() || 'İnönü Tıp Dönem I';
  let isCollapsed = false;
  let rafPending = false;

  const applyScrollState = () => {
    rafPending = false;
    const bridge = getBridge();
    const state = bridge?.getState();
    const lang: 'tr' | 'en' = state?.lang === 'en' ? 'en' : 'tr';
    const tab = state?.activeTab || 'daily';
    const tabTitle = getTabLargeTitle(tab, lang);

    if (titleTextEl.textContent !== tabTitle) {
      titleTextEl.textContent = tabTitle;
    }

    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const progress = Math.min(1, Math.max(0, y / 40));
    const opacity = Math.max(0, 1 - progress * 1.15);
    const shiftY = -(progress * 10);
    const scale = 1 - progress * 0.045;

    titleTextEl.style.opacity = opacity.toFixed(3);
    titleTextEl.style.transform = `translate3d(0, ${shiftY.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    bar?.classList.toggle('is-collapsed', progress >= 0.85);

    const nextCollapsed = y >= 32;
    if (headerTitleEl && nextCollapsed !== isCollapsed) {
      isCollapsed = nextCollapsed;
      headerTitleEl.classList.add('ios-header-title-swap');
      if (isCollapsed) {
        headerTitleEl.textContent = tabTitle;
      } else {
        headerTitleEl.textContent = defaultHeaderTitle;
      }
    } else if (headerTitleEl && isCollapsed && headerTitleEl.textContent !== tabTitle) {
      headerTitleEl.textContent = tabTitle;
    }
  };

  const sync = () => {
    const bridge = getBridge();
    const lang: 'tr' | 'en' = bridge?.getState().lang === 'en' ? 'en' : 'tr';
    defaultHeaderTitle = lang === 'en' ? 'İnönü Medicine Year I' : 'İnönü Tıp Dönem I';
    if (headerTitleEl && !isCollapsed) {
      headerTitleEl.textContent = defaultHeaderTitle;
    }
    applyScrollState();
  };

  window.addEventListener(
    'scroll',
    () => {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(applyScrollState);
      }
    },
    { passive: true }
  );

  sync();
  return { sync };
}

export function initIosEnhancements(): void {
  if (initialized) return;
  initialized = true;

  initUniversalIosSheets();
  const ctxMenu = initStudentSlotContextMenu();
  const largeTitle = initCollapsingLargeTitle();

  window.addEventListener('inonu-ui-sync', () => largeTitle.sync());

  window.__INONU_IOS__ = {
    openStudentSlotMenu: ctxMenu.open,
    closeStudentSlotMenu: ctxMenu.close,
    syncLargeTitle: largeTitle.sync,
  };
}
