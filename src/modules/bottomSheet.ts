import { getBridge } from './bridge.ts';

let initialized = false;
let sheetOpen = false;

function getStrings(lang: 'tr' | 'en') {
  if (lang === 'en') {
    return {
      title: 'Quick Control Sheet',
      subtitle: 'Swipe down to close',
      today: 'Today',
      todaySub: 'Jump to live schedule',
      calendar: 'Calendar',
      calendarSub: 'Pick any date',
      exams: 'Exams & Calc',
      examsSub: 'Countdown & grades',
      food: 'Cafeteria',
      foodSub: 'Daily & weekly menu',
      groups: 'My Groups',
      groupsSub: 'MBU & LAB filter',
      themeDark: 'Dark Mode',
      themeLight: 'Light Mode',
      themeSub: 'Tap to switch',
      adminSection: 'Admin Shortcuts',
      adminHub: 'Admin Panel',
      adminUrgent: 'Urgent Ann.',
      adminCancel: 'Cancel Today',
    };
  }
  return {
    title: 'Hızlı Kontrol Çekmecesi',
    subtitle: 'Kapatmak için aşağı kaydır',
    today: 'Bugün',
    todaySub: 'Günün programına git',
    calendar: 'Ders Takvimi',
    calendarSub: 'İstediğin güne atla',
    exams: 'Sınav & Not',
    examsSub: 'Geri sayım ve hesaplama',
    food: 'Yemekhane',
    foodSub: 'Günün yemek listesi',
    groups: 'Gruplarım',
    groupsSub: 'MBU ve LAB filtresi',
    themeDark: 'Koyu Tema',
    themeLight: 'Açık Tema',
    themeSub: 'Değiştirmek için dokun',
    adminSection: 'Yönetici Kısayolları',
    adminHub: 'Admin Paneli',
    adminUrgent: 'Acil Duyuru',
    adminCancel: 'Bugünü İptal',
  };
}

export function initBottomSheet(): void {
  if (initialized) return;
  initialized = true;

  // Glassmorphism Bottom Sheet Overlay & Sheet (opens via upward swipe on bottom nav)
  const overlay = document.createElement('div');
  overlay.id = 'quickBottomSheetOverlay';
  overlay.className = 'bs-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div id="quickBottomSheet" class="bs-sheet ios-glass" role="dialog" aria-modal="true" aria-labelledby="bsTitle">
      <div id="bsDragZone" class="bs-drag-zone">
        <div class="bs-grabber"></div>
        <div class="bs-header">
          <div class="min-w-0">
            <h3 id="bsTitle" class="text-base font-bold text-slate-900 dark:text-white leading-tight truncate">Hızlı Kontrol Çekmecesi</h3>
            <p id="bsSub" class="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">Kapatmak için aşağı kaydır</p>
          </div>
          <button id="bsCloseBtn" type="button" class="ios-press w-8 h-8 rounded-full ios-pill-control text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0" aria-label="Kapat">✕</button>
        </div>
      </div>

      <div id="bsBody" class="bs-body">
        <div id="bsGrid" class="bs-grid"></div>
        <div id="bsAdminWrap" class="bs-admin-wrap hidden">
          <span id="bsAdminLabel" class="bs-section-label">Yönetici Kısayolları</span>
          <div id="bsAdminGrid" class="bs-admin-grid"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const sheet = document.getElementById('quickBottomSheet')!;
  const dragZone = document.getElementById('bsDragZone')!;
  const closeBtn = document.getElementById('bsCloseBtn')!;
  const titleEl = document.getElementById('bsTitle')!;
  const subEl = document.getElementById('bsSub')!;
  const gridEl = document.getElementById('bsGrid')!;
  const adminWrap = document.getElementById('bsAdminWrap')!;
  const adminLabel = document.getElementById('bsAdminLabel')!;
  const adminGrid = document.getElementById('bsAdminGrid')!;

  const renderSheet = () => {
    const bridge = getBridge();
    if (!bridge) return;
    const st = bridge.getState();
    const loc = getStrings(st.lang);
    const isAdmin = bridge.isAdmin();

    titleEl.textContent = loc.title;
    subEl.textContent = loc.subtitle;

    const tiles = [
      {
        action: 'today',
        title: loc.today,
        sub: loc.todaySub,
        tone: 'blue',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>`,
      },
      {
        action: 'calendar',
        title: loc.calendar,
        sub: loc.calendarSub,
        tone: 'sky',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
      },
      {
        action: 'exams',
        title: loc.exams,
        sub: loc.examsSub,
        tone: 'indigo',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>`,
      },
      {
        action: 'food',
        title: loc.food,
        sub: loc.foodSub,
        tone: 'amber',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 14h15M5 14a7 7 0 0114 0M12 4.5V7M3 14h18"/>`,
      },
      {
        action: 'groups',
        title: loc.groups,
        sub: st.myMbuGroup ? `MBU ${st.myMbuGroup}${st.myLabGroup ? ` • LAB ${st.myLabGroup}` : ''}` : loc.groupsSub,
        tone: 'emerald',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>`,
      },
      {
        action: 'theme',
        title: st.darkMode ? loc.themeDark : loc.themeLight,
        sub: loc.themeSub,
        tone: 'violet',
        icon: st.darkMode
          ? `<path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>`
          : `<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M12 8a4 4 0 100 8 4 4 0 000-8z"/>`,
      },
    ];

    gridEl.innerHTML = tiles
      .map(
        (tile) => `
        <button type="button" data-bs-action="${tile.action}" class="bs-tile ios-press">
          <span class="bs-tile-icon bs-tone-${tile.tone}">
            <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${tile.icon}</svg>
          </span>
          <div class="min-w-0 flex-1 text-left">
            <span class="block text-xs font-bold text-slate-900 dark:text-white leading-tight truncate">${tile.title}</span>
            <span class="block text-[10.5px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">${tile.sub}</span>
          </div>
        </button>
      `
      )
      .join('');

    if (isAdmin) {
      adminWrap.classList.remove('hidden');
      adminLabel.textContent = loc.adminSection;
      adminGrid.innerHTML = `
        <button type="button" data-bs-action="admin-hub" class="bs-admin-chip ios-press bg-amber-500/15 text-amber-700 dark:text-amber-300">${loc.adminHub}</button>
        <button type="button" data-bs-action="admin-urgent" class="bs-admin-chip ios-press bg-blue-500/15 text-blue-600 dark:text-blue-300">${loc.adminUrgent}</button>
        <button type="button" data-bs-action="admin-cancel" class="bs-admin-chip ios-press bg-rose-500/15 text-rose-600 dark:text-rose-300">${loc.adminCancel}</button>
      `;
    } else {
      adminWrap.classList.add('hidden');
      adminGrid.innerHTML = '';
    }
  };

  let closeTimer: number | null = null;

  const openSheet = () => {
    const bridge = getBridge();
    if (bridge?.isSiteLocked()) return;
    if (closeTimer) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    sheetOpen = true;
    renderSheet();
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    sheet.style.transform = '';
    sheet.classList.remove('is-dragging');
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
    });
    bridge?.syncModalScrollLock();
    bridge?.triggerHaptic('light');
  };

  const closeSheet = () => {
    if (!sheetOpen) return;
    sheetOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    sheet.style.transform = '';
    sheet.classList.remove('is-dragging');
    closeTimer = window.setTimeout(() => {
      overlay.classList.add('hidden');
      getBridge()?.syncModalScrollLock();
      closeTimer = null;
    }, 300);
  };

  // Touch drag-to-dismiss on dragZone
  let startY = 0;
  let currentDy = 0;
  let dragging = false;

  dragZone.addEventListener(
    'touchstart',
    (e) => {
      if (!sheetOpen || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      currentDy = 0;
      dragging = true;
      sheet.classList.add('is-dragging');
    },
    { passive: true }
  );

  dragZone.addEventListener(
    'touchmove',
    (e) => {
      if (!dragging || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      currentDy = dy;
      if (dy > 0) {
        sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
      } else {
        sheet.style.transform = `translate3d(0, ${Math.max(-18, dy * 0.2)}px, 0)`;
      }
    },
    { passive: true }
  );

  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('is-dragging');
    if (currentDy > 75) {
      closeSheet();
    } else {
      sheet.style.transform = '';
    }
  };
  dragZone.addEventListener('touchend', finishDrag, { passive: true });
  dragZone.addEventListener('touchcancel', finishDrag, { passive: true });

  // Swipe UP on the bottom nav dock (#appNav) opens the sheet
  const navEl = document.getElementById('appNav');
  if (navEl) {
    let sy = 0;
    let sx = 0;
    navEl.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        sy = e.touches[0].clientY;
        sx = e.touches[0].clientX;
      },
      { passive: true }
    );
    navEl.addEventListener(
      'touchend',
      (e) => {
        if (sheetOpen || e.changedTouches.length !== 1) return;
        const dy = sy - e.changedTouches[0].clientY;
        const dx = Math.abs(sx - e.changedTouches[0].clientX);
        if (dy > 44 && dy > dx * 1.6) {
          openSheet();
        }
      },
      { passive: true }
    );
  }

  closeBtn.addEventListener('click', closeSheet);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSheet();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetOpen) closeSheet();
  });

  overlay.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-bs-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-bs-action');
    const bridge = getBridge();
    if (!bridge) return;
    bridge.triggerHaptic('selection');

    if (action === 'theme') {
      bridge.toggleDarkMode();
      renderSheet();
      return;
    }

    closeSheet();
    if (action === 'today') bridge.jumpToToday();
    else if (action === 'calendar') bridge.openDailyDateModal();
    else if (action === 'exams') bridge.switchTab('info');
    else if (action === 'food') bridge.switchTab('food');
    else if (action === 'groups') bridge.openGroupModal();
    else if (action === 'admin-hub') bridge.openAdminModal('hub');
    else if (action === 'admin-urgent') bridge.triggerAdminQuickAction('urgent-ann');
    else if (action === 'admin-cancel') bridge.triggerAdminQuickAction('cancel-today');
  });

  window.__INONU_BOTTOM_SHEET__ = {
    open: openSheet,
    close: closeSheet,
    toggle: () => (sheetOpen ? closeSheet() : openSheet()),
  };

  window.addEventListener('inonu-ui-sync', () => {
    if (sheetOpen) renderSheet();
  });
}
