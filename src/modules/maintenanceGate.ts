import { getBridge } from './bridge.ts';
import { getLiveStore, subscribeLiveStore } from './liveStore.ts';
import { hashStudentId, isAdminStudentId, normalizeStudentId } from '../studentAllowlist.ts';

let initialized = false;
let secretPanelVisible = false;
let needAdminPasswordStep = false;
let pendingAdminStudentId = '';

const BYPASS_HASH_LS_KEY = 'inonu_maint_bypass_hash_v1';

function getStoredBypassHash(): string {
  try {
    const v = localStorage.getItem(BYPASS_HASH_LS_KEY) || '';
    return /^[a-f0-9]{32}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}

function setStoredBypassHash(hash: string): void {
  try {
    if (!hash) localStorage.removeItem(BYPASS_HASH_LS_KEY);
    else localStorage.setItem(BYPASS_HASH_LS_KEY, hash);
  } catch {
    // ignore storage errors
  }
}

export function initMaintenanceGate(): void {
  if (initialized) return;
  initialized = true;

  // 1) Full-screen Maintenance Gate Overlay (zero visible login buttons!)
  const overlay = document.createElement('div');
  overlay.id = 'maintenanceGateOverlay';
  overlay.className = 'maint-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div id="maintGateCard" class="maint-card ios-glass" role="dialog" aria-modal="true" aria-labelledby="maintGateTitle">
      <button id="maintSecretIcon" type="button" class="maint-icon-wrap" aria-label="Bakım durumu">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      </button>

      <div class="maint-status-pill">
        <span class="em-banner-pulse" aria-hidden="true"></span>
        <span id="maintStatusText">Bakım Çalışması</span>
      </div>

      <h2 id="maintGateTitle" class="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-2">Sistem Bakımda</h2>
      <p id="maintGateMessage" class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-2 max-w-sm mx-auto">Kısa süreli bakım ve güncelleme çalışması yapılıyor. Lütfen daha sonra tekrar deneyin.</p>

      <!-- Hidden Secret Access Form (revealed only via 5 taps on maintenance icon or Ctrl+Shift+M) -->
      <form id="maintSecretAccessForm" class="maint-secret-box hidden" novalidate>
        <div class="flex items-center justify-between gap-2 mb-2.5">
          <span id="maintSecretHeading" class="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Özel Erişim</span>
          <button id="btnMaintSecretClose" type="button" class="text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">Gizle</button>
        </div>

        <div id="maintSecretIdStep" class="space-y-2">
          <input id="maintStudentIdInput" type="text" inputmode="numeric" autocomplete="off" maxlength="20" placeholder="Öğrenci Numaranız" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-sm font-semibold text-center tracking-wider text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/45" />
        </div>

        <div id="maintSecretPwdStep" class="hidden space-y-2">
          <p id="maintSecretAdminHint" class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Yönetici doğrulaması için şifre girin</p>
          <input id="maintAdminPwdInput" type="password" autocomplete="current-password" placeholder="Yönetici Şifresi" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-sm font-semibold text-center text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/45" />
        </div>

        <p id="maintSecretError" class="hidden text-[11.5px] font-semibold text-rose-600 dark:text-rose-400 mt-2"></p>

        <div class="flex items-center gap-2 mt-3">
          <button id="btnMaintSecretBack" type="button" class="hidden ios-press px-3 py-2.5 rounded-2xl ios-pill-control text-xs font-bold text-slate-600 dark:text-slate-300">Geri</button>
          <button id="btnMaintSecretSubmit" type="submit" class="ios-press flex-1 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white text-xs sm:text-sm font-bold shadow-sm transition">Giriş Yap</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  // 2) Subtle Admin indicator banner inside app when Maintenance Mode is active (so Admin remembers it's ON)
  let adminMaintBar = document.getElementById('maintAdminNoticeHost');
  const mainEl = document.querySelector('main');
  if (mainEl && !adminMaintBar) {
    adminMaintBar = document.createElement('div');
    adminMaintBar.id = 'maintAdminNoticeHost';
    adminMaintBar.className = 'hidden mb-2.5';
    mainEl.insertBefore(adminMaintBar, mainEl.firstChild);
  }

  const cardEl = document.getElementById('maintGateCard')!;
  const secretIconBtn = document.getElementById('maintSecretIcon')!;
  const titleEl = document.getElementById('maintGateTitle')!;
  const msgEl = document.getElementById('maintGateMessage')!;
  const statusTxtEl = document.getElementById('maintStatusText')!;
  const secretForm = document.getElementById('maintSecretAccessForm') as HTMLFormElement;
  const secretCloseBtn = document.getElementById('btnMaintSecretClose')!;
  const idStepEl = document.getElementById('maintSecretIdStep')!;
  const pwdStepEl = document.getElementById('maintSecretPwdStep')!;
  const idInput = document.getElementById('maintStudentIdInput') as HTMLInputElement;
  const pwdInput = document.getElementById('maintAdminPwdInput') as HTMLInputElement;
  const errEl = document.getElementById('maintSecretError')!;
  const backBtn = document.getElementById('btnMaintSecretBack')!;
  const submitBtn = document.getElementById('btnMaintSecretSubmit') as HTMLButtonElement;

  const setError = (msg: string) => {
    if (!msg) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
      return;
    }
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    cardEl.classList.remove('ios-shake');
    void cardEl.offsetWidth;
    cardEl.classList.add('ios-shake');
    getBridge()?.triggerHaptic('error');
  };

  const resetSecretForm = () => {
    needAdminPasswordStep = false;
    pendingAdminStudentId = '';
    idStepEl.classList.remove('hidden');
    pwdStepEl.classList.add('hidden');
    backBtn.classList.add('hidden');
    idInput.value = '';
    pwdInput.value = '';
    setError('');
  };

  const setSecretVisible = (open: boolean) => {
    secretPanelVisible = open;
    secretForm.classList.toggle('hidden', !open);
    if (open) {
      secretForm.classList.remove('admin-card-reveal');
      void secretForm.offsetWidth;
      secretForm.classList.add('admin-card-reveal');
      getBridge()?.triggerHaptic('selection');
      setTimeout(() => idInput.focus(), 60);
    } else {
      resetSecretForm();
    }
  };

  // Secret Gesture: 5 quick taps on the maintenance gear icon within 2.8 seconds
  let tapCount = 0;
  let lastTapMs = 0;
  secretIconBtn.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastTapMs > 2800) {
      tapCount = 0;
    }
    lastTapMs = now;
    tapCount += 1;
    secretIconBtn.classList.remove('maint-icon-tap');
    void secretIconBtn.offsetWidth;
    secretIconBtn.classList.add('maint-icon-tap');
    if (tapCount >= 5) {
      tapCount = 0;
      setSecretVisible(!secretPanelVisible);
    }
  });

  // Desktop shortcut: Ctrl+Shift+M
  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('hidden') && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      setSecretVisible(!secretPanelVisible);
    }
  });

  secretCloseBtn.addEventListener('click', () => setSecretVisible(false));
  backBtn.addEventListener('click', () => {
    needAdminPasswordStep = false;
    pendingAdminStudentId = '';
    idStepEl.classList.remove('hidden');
    pwdStepEl.classList.add('hidden');
    backBtn.classList.add('hidden');
    pwdInput.value = '';
    setError('');
    idInput.focus();
  });

  const isCurrentVisitorAllowed = (): boolean => {
    const { maintenance } = getLiveStore();
    if (!maintenance.active) return true;
    const session = getBridge()?.getSession();
    if (session?.isAdmin) return true;
    if (session?.hash && maintenance.allowedHashes.includes(session.hash)) return true;
    const bypass = getStoredBypassHash();
    if (bypass && maintenance.allowedHashes.includes(bypass)) return true;
    return false;
  };

  const syncMaintenanceUI = () => {
    const bridge = getBridge();
    const isEn = bridge?.getState().lang === 'en';
    const { maintenance } = getLiveStore();
    const allowed = isCurrentVisitorAllowed();
    const blocked = maintenance.active && !allowed;

    // Clear stale bypass hash if maintenance is off or user was removed from whitelist
    const storedBypass = getStoredBypassHash();
    if (storedBypass && (!maintenance.active || !maintenance.allowedHashes.includes(storedBypass))) {
      if (maintenance.active) setStoredBypassHash('');
    }

    titleEl.textContent = maintenance.title || (isEn ? 'Under Maintenance' : 'Sistem Bakımda');
    msgEl.textContent =
      maintenance.message ||
      (isEn
        ? 'Maintenance is currently in progress. Please check back soon.'
        : 'Kısa süreli bakım ve güncelleme çalışması yapılıyor. Lütfen daha sonra tekrar deneyin.');
    statusTxtEl.textContent = isEn ? 'Maintenance Mode' : 'Bakım Çalışması';

    document.documentElement.classList.toggle('site-maintenance-locked', blocked);
    const appShellIds = ['appHeader', 'headerSpacer', 'appMain', 'appNav'];
    appShellIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('maint-hidden-shell', blocked);
    });

    if (blocked) {
      if (overlay.classList.contains('hidden')) {
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => overlay.classList.add('is-open'));
      }
      bridge?.syncModalScrollLock();
    } else {
      if (!overlay.classList.contains('hidden')) {
        overlay.classList.remove('is-open');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.classList.add('hidden');
        setSecretVisible(false);
        bridge?.syncModalScrollLock();
      }
    }

    // Show subtle top notice for Admin / whitelisted user while Maintenance Mode is active
    if (adminMaintBar) {
      const isAdmin = Boolean(bridge?.isAdmin());
      if (maintenance.active && !blocked) {
        adminMaintBar.classList.remove('hidden');
        adminMaintBar.innerHTML = `
          <div class="maint-active-chip ios-glass">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-2 h-2 rounded-full bg-amber-500 shrink-0 animate-pulse"></span>
              <span class="text-[11.5px] font-bold text-amber-800 dark:text-amber-200 truncate">
                ${
                  isAdmin
                    ? isEn
                      ? `Maintenance ON (${maintenance.allowedHashes.length} allowed)`
                      : `Bakım Modu Açık (${maintenance.allowedHashes.length} izinli numara)`
                    : isEn
                      ? 'Authorized Maintenance Access'
                      : 'Bakım Modu · Özel Erişimle Giriş Yapıldı'
                }
              </span>
            </div>
            ${
              isAdmin
                ? `<button type="button" data-maint-manage="1" class="ios-press px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-200 text-[11px] font-bold shrink-0">${isEn ? 'Manage' : 'Yönet'}</button>`
                : ''
            }
          </div>
        `;
        adminMaintBar.querySelector('[data-maint-manage]')?.addEventListener('click', () => {
          bridge?.triggerHaptic('selection');
          window.__INONU_ADMIN_EXTRAS__?.openPane('extras-maintenance');
        });
      } else {
        adminMaintBar.classList.add('hidden');
        adminMaintBar.innerHTML = '';
      }
    }
  };

  secretForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bridge = getBridge();
    const isEn = bridge?.getState().lang === 'en';
    const { maintenance } = getLiveStore();
    setError('');

    if (needAdminPasswordStep) {
      const pwd = pwdInput.value;
      if (!pwd) {
        setError(isEn ? 'Enter admin password.' : 'Yönetici şifresini girin.');
        pwdInput.focus();
        return;
      }
      submitBtn.disabled = true;
      try {
        const res = await bridge?.loginWithStudentId(pendingAdminStudentId, pwd);
        if (!res || !res.ok) {
          setError(res?.error || (isEn ? 'Wrong admin password.' : 'Yönetici şifresi hatalı.'));
          pwdInput.value = '';
          pwdInput.focus();
          return;
        }
        bridge?.triggerHaptic('success');
        bridge?.showToast(isEn ? 'Admin maintenance access granted.' : 'Yönetici bakım erişimi açıldı.');
        syncMaintenanceUI();
      } finally {
        submitBtn.disabled = false;
      }
      return;
    }

    const cleaned = normalizeStudentId(idInput.value);
    if (!cleaned || cleaned.length < 4) {
      setError(isEn ? 'Enter a valid student number.' : 'Geçerli bir öğrenci numarası girin.');
      idInput.focus();
      return;
    }

    // 1) Admin ID check -> step 2 password
    if (isAdminStudentId(cleaned)) {
      needAdminPasswordStep = true;
      pendingAdminStudentId = cleaned;
      idStepEl.classList.add('hidden');
      pwdStepEl.classList.remove('hidden');
      backBtn.classList.remove('hidden');
      pwdInput.value = '';
      pwdInput.focus();
      bridge?.triggerHaptic('selection');
      return;
    }

    // 2) Whitelisted student number check
    const hashed = hashStudentId(cleaned);
    if (!maintenance.allowedHashes.includes(hashed)) {
      setError(
        isEn
          ? 'This student number is not authorized during maintenance.'
          : 'Bu öğrenci numarası bakım modunda erişime yetkili değil.'
      );
      idInput.focus();
      return;
    }

    submitBtn.disabled = true;
    try {
      setStoredBypassHash(hashed);
      // Also sign into their student account automatically if present in directory
      await bridge?.loginWithStudentId(cleaned).catch(() => null);
      bridge?.triggerHaptic('success');
      bridge?.showToast(isEn ? 'Special access granted!' : 'Özel bakım erişimi onaylandı!');
      syncMaintenanceUI();
    } finally {
      submitBtn.disabled = false;
    }
  });

  subscribeLiveStore(syncMaintenanceUI);
  window.addEventListener('inonu-ui-sync', syncMaintenanceUI);
  syncMaintenanceUI();
}
