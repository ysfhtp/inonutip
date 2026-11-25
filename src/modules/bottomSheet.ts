import { getBridge } from './bridge.ts';

let initialized = false;

export function initBottomSheet(): void {
  if (initialized) return;
  initialized = true;

  // Swipe UP on bottom nav (#appNav) is ONLY active for Admin and directly opens Admin Settings (hub) with zero extra shortcuts.
  const navEl = document.getElementById('appNav');
  if (!navEl) return;

  let activePointerId: number | null = null;
  let sy = 0;
  let sx = 0;

  const openAdminDirectly = () => {
    const bridge = getBridge();
    if (!bridge || bridge.isSiteLocked() || !bridge.isAdmin()) return;
    const modal = document.getElementById('adminModal');
    if (modal && !modal.classList.contains('hidden')) return;
    bridge.triggerHaptic('selection');
    bridge.openAdminModal('hub');
  };

  navEl.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button && e.button !== 0) return;
      const bridge = getBridge();
      if (!bridge?.isAdmin() || bridge.isSiteLocked()) return;
      activePointerId = e.pointerId;
      sy = e.clientY;
      sx = e.clientX;
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
      if (dy > 40 && dy > dx * 1.4) {
        openAdminDirectly();
      }
    },
    { passive: true }
  );

  navEl.addEventListener(
    'pointercancel',
    () => {
      activePointerId = null;
    },
    { passive: true }
  );

  window.__INONU_BOTTOM_SHEET__ = {
    open: () => openAdminDirectly(),
    close: () => {},
    toggle: () => openAdminDirectly(),
  };
}
