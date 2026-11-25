import { getBridge } from './bridge.ts';

let initialized = false;
let lastOpenedAtMs = 0;

export function openAdminHubFromSwipe(): void {
  const now = Date.now();
  if (now - lastOpenedAtMs < 400) return;
  const bridge = getBridge();
  if (!bridge || bridge.isSiteLocked() || !bridge.isAdmin()) return;
  const modal = document.getElementById('adminModal');
  if (modal && !modal.classList.contains('hidden')) return;
  lastOpenedAtMs = now;
  bridge.triggerHaptic('selection');
  bridge.openAdminModal('hub');
}

export function initBottomSheet(): void {
  if (initialized) return;
  initialized = true;

  // Swipe UP on bottom nav (#appNav) is ONLY active for Admin and directly opens Admin Settings (hub) with zero extra shortcuts.
  const navEl = document.getElementById('appNav');
  if (!navEl) return;

  let activePointerId: number | null = null;
  let sy = 0;
  let sx = 0;
  let isLifting = false;

  const resetLift = () => {
    if (!isLifting) return;
    isLifting = false;
    navEl.style.transition = 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)';
    navEl.style.transform = '';
    window.setTimeout(() => {
      if (!isLifting) navEl.style.transition = '';
    }, 260);
  };

  navEl.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button && e.button !== 0) return;
      // Dock container handles its own pointer capture + upward swipe directly
      if ((e.target as HTMLElement | null)?.closest('#dockContainer')) return;
      const bridge = getBridge();
      if (!bridge?.isAdmin() || bridge.isSiteLocked()) return;
      activePointerId = e.pointerId;
      sy = e.clientY;
      sx = e.clientX;
      isLifting = false;
    },
    { passive: true }
  );

  navEl.addEventListener(
    'pointermove',
    (e) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      const dy = sy - e.clientY;
      const dx = Math.abs(sx - e.clientX);
      if (dy > 10 && dy > dx * 1.1) {
        isLifting = true;
        const lift = Math.min(22, Math.round((dy - 10) * 0.38));
        navEl.style.transition = 'none';
        navEl.style.transform = `translate3d(0, -${lift}px, 0)`;
      }
    },
    { passive: true }
  );

  navEl.addEventListener(
    'pointerup',
    (e) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      activePointerId = null;
      const dy = sy - e.clientY;
      const dx = Math.abs(sx - e.clientX);
      resetLift();
      if (dy > 34 && dy > dx * 1.15) {
        openAdminHubFromSwipe();
      }
    },
    { passive: true }
  );

  navEl.addEventListener(
    'pointercancel',
    () => {
      activePointerId = null;
      resetLift();
    },
    { passive: true }
  );

  window.__INONU_BOTTOM_SHEET__ = {
    open: () => openAdminHubFromSwipe(),
    close: () => {},
    toggle: () => openAdminHubFromSwipe(),
  };
}
