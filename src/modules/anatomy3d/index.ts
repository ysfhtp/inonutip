import { getBridge } from '../bridge.ts';
import {
  ANATOMY_MODELS,
  getAnatomyModel,
  matchLessonToAnatomy,
  type AnatomyModelId,
  type AnatomyPartInfo,
} from './modelsData.ts';
import { AnatomyViewportEngine } from './viewportEngine.ts';

let initialized = false;
let modalOpen = false;
let engine: AnatomyViewportEngine | null = null;
let currentModelId: AnatomyModelId = 'cell';
let selectedPartId: string | null = null;
let explodeValue = 0;
let xrayActive = false;
let autoRotateActive = false;
let dockCollapsed = false;
let partsDrawerOpen = false;
let lessonContextTitle = '';

// Built-in Practical Station Quiz state
let quizActive = false;
let quizTargetPartId: string | null = null;
let quizCorrect = 0;
let quizTotal = 0;
let quizFeedbackMsg = '';
let quizFeedbackTone: 'ok' | 'err' | '' = '';

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getLang(): 'tr' | 'en' {
  return getBridge()?.getState().lang === 'en' ? 'en' : 'tr';
}

function pickRandomQuizPart(modelId: AnatomyModelId, excludeId?: string | null): AnatomyPartInfo {
  const parts = getAnatomyModel(modelId).parts;
  const pool = parts.filter((p) => p.id !== excludeId);
  const src = pool.length ? pool : parts;
  return src[Math.floor(Math.random() * src.length)];
}

export function initAnatomy3D(): void {
  if (initialized) return;
  initialized = true;

  // Full-screen interactive 3D Studio Modal (Zero Viewport Occlusion + Collapsible Bottom Dock)
  const overlay = document.createElement('div');
  overlay.id = 'anatomy3dModal';
  overlay.className = 'anat3d-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'anat3dTitle');

  overlay.innerHTML = `
    <div id="anat3dCanvasMount" class="anat3d-canvas-mount"></div>

    <div id="anat3dFallback" class="anat3d-fallback hidden">
      <div class="anat3d-fallback-card">
        <p id="anat3dFallbackTitle" class="text-sm font-bold"></p>
        <p id="anat3dFallbackDesc" class="text-xs opacity-75 mt-1"></p>
      </div>
    </div>

    <!-- Top minimal bar: title + model switcher + close -->
    <header class="anat3d-topbar">
      <div class="anat3d-topbar-head">
        <div class="min-w-0">
          <h2 id="anat3dTitle" class="anat3d-title"></h2>
          <p id="anat3dSub" class="anat3d-sub"></p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button id="btnAnat3dPartsList" type="button" class="anat3d-icon-btn" aria-expanded="false"></button>
          <button id="btnAnat3dClose" type="button" class="anat3d-close-btn" aria-label="Kapat">✕</button>
        </div>
      </div>
      <div id="anat3dModelTabs" class="anat3d-model-tabs" role="tablist"></div>
    </header>

    <!-- Optional slide-down structure index (opened only on demand so viewport stays 100% clear) -->
    <div id="anat3dPartsDrawer" class="anat3d-parts-drawer hidden">
      <div id="anat3dPartsGrid" class="anat3d-parts-grid"></div>
    </div>

    <!-- Compact Quiz Prompt Bar (only visible during Practice Quiz Mode) -->
    <div id="anat3dQuizBar" class="anat3d-quiz-bar hidden">
      <div class="flex items-center justify-between gap-2">
        <span id="anat3dQuizPrompt" class="anat3d-quiz-prompt"></span>
        <span id="anat3dQuizScore" class="anat3d-quiz-score tabular-nums"></span>
      </div>
      <p id="anat3dQuizFeedback" class="anat3d-quiz-feedback hidden"></p>
    </div>

    <!-- Compact Inspector Card (shown when a structure is tapped/selected) -->
    <section id="anat3dInspector" class="anat3d-inspector hidden" aria-live="polite">
      <div class="anat3d-inspector-head">
        <div class="min-w-0 flex-1">
          <div class="anat3d-inspector-meta">
            <span id="anat3dPartLatin" class="anat3d-part-latin"></span>
            <span aria-hidden="true">·</span>
            <span id="anat3dPartSystem" class="anat3d-part-system"></span>
          </div>
          <h3 id="anat3dPartName" class="anat3d-part-name"></h3>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button id="btnAnat3dPrevPart" type="button" class="anat3d-step-btn" aria-label="Önceki yapı">‹</button>
          <button id="btnAnat3dNextPart" type="button" class="anat3d-step-btn" aria-label="Sonraki yapı">›</button>
          <button id="btnAnat3dDismissInfo" type="button" class="anat3d-step-btn" aria-label="Bilgiyi gizle">✕</button>
        </div>
      </div>
      <p id="anat3dPartTip" class="anat3d-part-tip"></p>
    </section>

    <!-- Unified Collapsible Bottom Control Dock -->
    <div id="anat3dDockWrap" class="anat3d-dock-wrap">
      <button id="btnAnat3dToggleDock" type="button" class="anat3d-dock-toggle" aria-expanded="true"></button>
      <div id="anat3dDock" class="anat3d-dock">
        <div class="anat3d-explode-row">
          <label id="lblAnat3dExplode" for="inpAnat3dExplode" class="anat3d-explode-lbl"></label>
          <input id="inpAnat3dExplode" type="range" min="0" max="100" step="1" value="0" class="anat3d-slider" />
          <span id="outAnat3dExplodePct" class="anat3d-explode-val tabular-nums">0%</span>
        </div>
        <div class="anat3d-controls-row">
          <button id="btnAnat3dXray" type="button" class="anat3d-ctrl-btn"></button>
          <button id="btnAnat3dQuiz" type="button" class="anat3d-ctrl-btn"></button>
          <button id="btnAnat3dAutoRot" type="button" class="anat3d-ctrl-btn"></button>
          <button id="btnAnat3dResetCam" type="button" class="anat3d-ctrl-btn"></button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const canvasMount = document.getElementById('anat3dCanvasMount')!;
  const fallbackEl = document.getElementById('anat3dFallback')!;
  const fallbackTitleEl = document.getElementById('anat3dFallbackTitle')!;
  const fallbackDescEl = document.getElementById('anat3dFallbackDesc')!;
  const titleEl = document.getElementById('anat3dTitle')!;
  const subEl = document.getElementById('anat3dSub')!;
  const modelTabsEl = document.getElementById('anat3dModelTabs')!;
  const btnPartsList = document.getElementById('btnAnat3dPartsList') as HTMLButtonElement;
  const btnClose = document.getElementById('btnAnat3dClose') as HTMLButtonElement;
  const partsDrawer = document.getElementById('anat3dPartsDrawer')!;
  const partsGrid = document.getElementById('anat3dPartsGrid')!;

  const quizBar = document.getElementById('anat3dQuizBar')!;
  const quizPromptEl = document.getElementById('anat3dQuizPrompt')!;
  const quizScoreEl = document.getElementById('anat3dQuizScore')!;
  const quizFeedbackEl = document.getElementById('anat3dQuizFeedback')!;

  const inspectorEl = document.getElementById('anat3dInspector')!;
  const partLatinEl = document.getElementById('anat3dPartLatin')!;
  const partSystemEl = document.getElementById('anat3dPartSystem')!;
  const partNameEl = document.getElementById('anat3dPartName')!;
  const partTipEl = document.getElementById('anat3dPartTip')!;
  const btnPrevPart = document.getElementById('btnAnat3dPrevPart') as HTMLButtonElement;
  const btnNextPart = document.getElementById('btnAnat3dNextPart') as HTMLButtonElement;
  const btnDismissInfo = document.getElementById('btnAnat3dDismissInfo') as HTMLButtonElement;

  const dockWrap = document.getElementById('anat3dDockWrap')!;
  const btnToggleDock = document.getElementById('btnAnat3dToggleDock') as HTMLButtonElement;
  const lblExplode = document.getElementById('lblAnat3dExplode')!;
  const inpExplode = document.getElementById('inpAnat3dExplode') as HTMLInputElement;
  const outExplodePct = document.getElementById('outAnat3dExplodePct')!;
  const btnXray = document.getElementById('btnAnat3dXray') as HTMLButtonElement;
  const btnQuiz = document.getElementById('btnAnat3dQuiz') as HTMLButtonElement;
  const btnAutoRot = document.getElementById('btnAnat3dAutoRot') as HTMLButtonElement;
  const btnResetCam = document.getElementById('btnAnat3dResetCam') as HTMLButtonElement;

  const renderUI = () => {
    const lang = getLang();
    const isEn = lang === 'en';
    const isDark = Boolean(getBridge()?.getState().darkMode);
    overlay.classList.toggle('is-light', !isDark);

    const model = getAnatomyModel(currentModelId);
    titleEl.textContent = isEn ? model.en : model.tr;
    const contextPart = lessonContextTitle ? ` · ${lessonContextTitle}` : '';
    subEl.textContent = `${model.latin} · ${isEn ? model.committeeHintEn : model.committeeHintTr}${contextPart}`;

    btnPartsList.textContent = isEn
      ? `Structures (${model.parts.length})`
      : `Yapılar (${model.parts.length})`;
    btnPartsList.setAttribute('aria-expanded', partsDrawerOpen ? 'true' : 'false');
    btnPartsList.classList.toggle('is-active', partsDrawerOpen);

    // Model tabs
    modelTabsEl.innerHTML = ANATOMY_MODELS.map((m) => {
      const active = m.id === currentModelId;
      return `<button type="button" role="tab" aria-selected="${active ? 'true' : 'false'}" data-anat-model="${m.id}" class="anat3d-model-tab${active ? ' is-active' : ''}">${escapeHtml(isEn ? m.shortEn : m.shortTr)}</button>`;
    }).join('');

    // Structures drawer
    partsDrawer.classList.toggle('hidden', !partsDrawerOpen);
    if (partsDrawerOpen) {
      partsGrid.innerHTML = model.parts
        .map((p) => {
          const active = p.id === selectedPartId;
          return `
            <button type="button" data-anat-part="${p.id}" class="anat3d-part-item${active ? ' is-active' : ''}">
              <span class="anat3d-part-item-title">${escapeHtml(isEn ? p.en : p.tr)}</span>
              <span class="anat3d-part-item-latin">${escapeHtml(p.latin)}</span>
            </button>
          `;
        })
        .join('');
    }

    // Quiz bar
    quizBar.classList.toggle('hidden', !quizActive);
    if (quizActive && quizTargetPartId) {
      const target = model.parts.find((p) => p.id === quizTargetPartId);
      if (target) {
        quizPromptEl.textContent = isEn
          ? `Find on model: ${target.latin} (${target.en})`
          : `Modelde dokun: ${target.latin} (${target.tr})`;
      }
      quizScoreEl.textContent = `${quizCorrect}/${quizTotal}`;
      quizFeedbackEl.textContent = quizFeedbackMsg;
      quizFeedbackEl.classList.toggle('hidden', !quizFeedbackMsg);
      quizFeedbackEl.classList.toggle('is-ok', quizFeedbackTone === 'ok');
      quizFeedbackEl.classList.toggle('is-err', quizFeedbackTone === 'err');
    }

    // Inspector card (hidden in quiz mode until answered or when nothing selected)
    const selPart = selectedPartId ? model.parts.find((p) => p.id === selectedPartId) || null : null;
    const showInspector = Boolean(selPart) && !quizActive;
    inspectorEl.classList.toggle('hidden', !showInspector);
    if (showInspector && selPart) {
      partLatinEl.textContent = selPart.latin;
      partSystemEl.textContent = isEn ? selPart.systemEn : selPart.systemTr;
      partNameEl.textContent = isEn ? selPart.en : selPart.tr;
      partTipEl.textContent = isEn ? selPart.examTipEn : selPart.examTipTr;
    }

    // Dock labels & states
    overlay.classList.toggle('is-dock-collapsed', dockCollapsed);
    dockWrap.classList.toggle('is-collapsed', dockCollapsed);
    btnToggleDock.setAttribute('aria-expanded', dockCollapsed ? 'false' : 'true');
    btnToggleDock.textContent = dockCollapsed
      ? isEn ? '▴ Show Controls' : '▴ Kontrolleri Göster'
      : isEn ? '▾ Hide Controls' : '▾ Kontrolleri Gizle';

    lblExplode.textContent = isEn ? 'Explode' : 'Ayır';
    inpExplode.value = String(Math.round(explodeValue * 100));
    outExplodePct.textContent = `${Math.round(explodeValue * 100)}%`;

    btnXray.textContent = isEn ? 'X-Ray' : 'Saydam';
    btnXray.classList.toggle('is-active', xrayActive);

    btnQuiz.textContent = quizActive
      ? isEn ? 'Exit Quiz' : 'Testi Bitir'
      : isEn ? 'Station Quiz' : 'Pratik Test';
    btnQuiz.classList.toggle('is-active', quizActive);

    btnAutoRot.textContent = isEn ? 'Spin' : 'Döndür';
    btnAutoRot.classList.toggle('is-active', autoRotateActive);

    btnResetCam.textContent = isEn ? 'Reset' : 'Sıfırla';

    fallbackTitleEl.textContent = isEn ? '3D view unavailable' : '3D görünüm başlatılamadı';
    fallbackDescEl.textContent = isEn
      ? 'WebGL is disabled on this browser. You can still browse all anatomical terms via Structures.'
      : 'Bu tarayıcıda WebGL desteklenmiyor. Üstteki Yapılar menüsünden tüm anatomik terimleri inceleyebilirsin.';
  };

  const handlePartPicked = (partId: string | null) => {
    const bridge = getBridge();
    const isEn = getLang() === 'en';
    const model = getAnatomyModel(currentModelId);

    if (quizActive && quizTargetPartId) {
      if (!partId) return;
      quizTotal += 1;
      const tapped = model.parts.find((p) => p.id === partId);
      if (partId === quizTargetPartId) {
        quizCorrect += 1;
        quizFeedbackTone = 'ok';
        quizFeedbackMsg = isEn
          ? `Correct! ${tapped?.latin || ''} — ${tapped?.examTipEn || ''}`
          : `Doğru! ${tapped?.latin || ''} — ${tapped?.examTipTr || ''}`;
        bridge?.triggerHaptic('medium');
        engine?.flashQuizFeedback(partId, 'correct');
        const next = pickRandomQuizPart(currentModelId, quizTargetPartId);
        quizTargetPartId = next.id;
      } else {
        quizFeedbackTone = 'err';
        quizFeedbackMsg = isEn
          ? `That was ${tapped?.latin || ''} (${tapped?.en || ''}). Try again!`
          : `Dokunduğun yapı: ${tapped?.latin || ''} (${tapped?.tr || ''}). Tekrar dene!`;
        bridge?.triggerHaptic('light');
        engine?.flashQuizFeedback(partId, 'wrong');
      }
      renderUI();
      return;
    }

    selectedPartId = partId;
    if (partId) {
      bridge?.triggerHaptic('selection');
      partsDrawerOpen = false;
    }
    engine?.selectPart(partId, Boolean(partId));
    renderUI();
  };

  const switchModel = (nextId: AnatomyModelId, initialPartId?: string | null) => {
    currentModelId = nextId;
    selectedPartId = initialPartId || null;
    explodeValue = 0;
    xrayActive = false;
    partsDrawerOpen = false;
    if (quizActive) {
      quizTargetPartId = pickRandomQuizPart(nextId).id;
      quizFeedbackMsg = '';
      quizFeedbackTone = '';
    }
    engine?.setXray(false);
    engine?.loadModel(nextId, initialPartId || null);
    renderUI();
  };

  const openModal = (opts?: { modelId?: AnatomyModelId; partId?: string; lessonTitle?: string }) => {
    const bridge = getBridge();
    if (bridge?.isSiteLocked()) return;

    currentModelId = opts?.modelId || currentModelId || 'cell';
    selectedPartId = opts?.partId || null;
    lessonContextTitle = opts?.lessonTitle || '';
    explodeValue = 0;
    xrayActive = false;
    autoRotateActive = false;
    dockCollapsed = false;
    partsDrawerOpen = false;
    quizActive = false;
    quizTargetPartId = null;
    quizFeedbackMsg = '';
    quizFeedbackTone = '';

    modalOpen = true;
    fallbackEl.classList.add('hidden');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    renderUI();
    bridge?.syncModalScrollLock();
    bridge?.triggerHaptic('light');

    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      if (!engine) {
        engine = new AnatomyViewportEngine(
          canvasMount,
          {
            onSelectPart: handlePartPicked,
            onWebglError: () => fallbackEl.classList.remove('hidden'),
          },
          Boolean(bridge?.getState().darkMode)
        );
      } else {
        engine.setDarkTheme(Boolean(bridge?.getState().darkMode));
        engine.handleResize();
      }
      engine.setXray(false);
      engine.setAutoRotate(false);
      engine.loadModel(currentModelId, selectedPartId);
    });
  };

  const closeModal = () => {
    if (!modalOpen) return;
    modalOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      overlay.classList.add('hidden');
      if (engine) {
        engine.dispose();
        engine = null;
      }
      getBridge()?.syncModalScrollLock();
    }, 210);
  };

  // Wire controls
  btnClose.addEventListener('click', closeModal);

  modelTabsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-anat-model]');
    if (!btn) return;
    const id = btn.getAttribute('data-anat-model') as AnatomyModelId;
    if (id && id !== currentModelId) {
      lessonContextTitle = '';
      getBridge()?.triggerHaptic('selection');
      switchModel(id, null);
    }
  });

  btnPartsList.addEventListener('click', () => {
    partsDrawerOpen = !partsDrawerOpen;
    getBridge()?.triggerHaptic('selection');
    renderUI();
  });

  partsGrid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-anat-part]');
    if (!btn) return;
    const pid = btn.getAttribute('data-anat-part');
    if (!pid) return;
    quizActive = false;
    selectedPartId = pid;
    partsDrawerOpen = false;
    getBridge()?.triggerHaptic('selection');
    engine?.selectPart(pid, true);
    renderUI();
  });

  const stepSelectedPart = (dir: -1 | 1) => {
    const parts = getAnatomyModel(currentModelId).parts;
    if (!parts.length) return;
    const curIdx = parts.findIndex((p) => p.id === selectedPartId);
    const nextIdx = curIdx < 0 ? 0 : (curIdx + dir + parts.length) % parts.length;
    selectedPartId = parts[nextIdx].id;
    getBridge()?.triggerHaptic('selection');
    engine?.selectPart(selectedPartId, true);
    renderUI();
  };

  btnPrevPart.addEventListener('click', () => stepSelectedPart(-1));
  btnNextPart.addEventListener('click', () => stepSelectedPart(1));
  btnDismissInfo.addEventListener('click', () => {
    selectedPartId = null;
    engine?.selectPart(null, false);
    renderUI();
  });

  btnToggleDock.addEventListener('click', () => {
    dockCollapsed = !dockCollapsed;
    getBridge()?.triggerHaptic('selection');
    renderUI();
  });

  inpExplode.addEventListener('input', () => {
    explodeValue = Number(inpExplode.value) / 100;
    outExplodePct.textContent = `${Math.round(explodeValue * 100)}%`;
    engine?.setExplode(explodeValue);
  });

  btnXray.addEventListener('click', () => {
    xrayActive = !xrayActive;
    getBridge()?.triggerHaptic('selection');
    engine?.setXray(xrayActive);
    renderUI();
  });

  btnQuiz.addEventListener('click', () => {
    quizActive = !quizActive;
    getBridge()?.triggerHaptic('selection');
    if (quizActive) {
      selectedPartId = null;
      partsDrawerOpen = false;
      quizCorrect = 0;
      quizTotal = 0;
      quizFeedbackMsg = '';
      quizFeedbackTone = '';
      quizTargetPartId = pickRandomQuizPart(currentModelId).id;
      engine?.selectPart(null, false);
      engine?.resetCamera();
    } else {
      quizTargetPartId = null;
    }
    renderUI();
  });

  btnAutoRot.addEventListener('click', () => {
    autoRotateActive = !autoRotateActive;
    getBridge()?.triggerHaptic('selection');
    engine?.setAutoRotate(autoRotateActive);
    renderUI();
  });

  btnResetCam.addEventListener('click', () => {
    explodeValue = 0;
    xrayActive = false;
    selectedPartId = null;
    engine?.setExplode(0);
    engine?.setXray(false);
    engine?.selectPart(null, false);
    engine?.resetCamera();
    getBridge()?.triggerHaptic('light');
    renderUI();
  });

  document.addEventListener('keydown', (e) => {
    if (!modalOpen) return;
    if (e.key === 'Escape') {
      closeModal();
    } else if ((e.key === 'h' || e.key === 'H') && !(e.target instanceof HTMLInputElement)) {
      dockCollapsed = !dockCollapsed;
      renderUI();
    }
  });

  // Sync theme / language changes while open
  window.addEventListener('inonu-ui-sync', () => {
    syncLauncherCopy();
    if (!modalOpen) return;
    engine?.setDarkTheme(Boolean(getBridge()?.getState().darkMode));
    renderUI();
  });

  // 1) Inject 3D Anatomy Atlas Launcher Card into #viewInfo (Sınav / Bilgi tab)
  const injectViewInfoLauncher = () => {
    const viewInfo = document.getElementById('viewInfo');
    const authCard = document.getElementById('authSessionCard');
    if (!viewInfo || document.getElementById('anatomy3dInfoCard')) return;

    const card = document.createElement('div');
    card.id = 'anatomy3dInfoCard';
    card.className = 'ios-glass ios-tab-card rounded-3xl p-3.5 min-[360px]:p-4 flex items-center justify-between gap-3 flex-wrap';
    card.setAttribute('data-tab-stagger', '2');
    card.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <span class="w-9 h-9 rounded-2xl bg-sky-500/15 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
          </svg>
        </span>
        <div class="min-w-0">
          <p id="anat3dCardKicker" class="text-[11px] font-bold tracking-wide text-sky-600 dark:text-sky-300">3D Anatomi &amp; Hücre Atlası</p>
          <p id="anat3dCardDesc" class="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white mt-0.5 truncate">Hücre, Kalp, Beyin, Kafatası, Femur, Toraks · Pratik Test</p>
        </div>
      </div>
      <button id="btnOpenAnatomy3DInfo" type="button" class="ios-press w-full min-[360px]:w-auto min-h-[44px] justify-center px-4 py-2 rounded-full bg-sky-500/15 hover:bg-sky-500/25 text-sky-700 dark:text-sky-300 text-xs font-bold transition text-center whitespace-nowrap shrink-0">
        3D Atlası Aç
      </button>
    `;
    if (authCard) {
      viewInfo.insertBefore(card, authCard);
    } else {
      viewInfo.appendChild(card);
    }
    card.querySelector('#btnOpenAnatomy3DInfo')?.addEventListener('click', () => openModal({ modelId: 'cell' }));
  };

  // 2) Inject 3D Anatomy Atlas quick row into Settings Menu (#settingsMenuCard)
  const injectSettingsLauncher = () => {
    const settingsCard = document.getElementById('settingsMenuCard');
    if (!settingsCard || document.getElementById('settingsAnatomy3dRow')) return;

    const row = document.createElement('div');
    row.id = 'settingsAnatomy3dRow';
    row.className = 'pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between gap-2.5';
    row.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="w-8 h-8 rounded-2xl ios-pill-control flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
          </svg>
        </span>
        <div class="min-w-0">
          <p id="lblSettingsAnat3d" class="text-xs font-bold text-slate-900 dark:text-white truncate">3D Anatomi Atlası</p>
          <p id="descSettingsAnat3d" class="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">6 etkileşimli 3D model ve pratik testi</p>
        </div>
      </div>
      <button id="btnOpenAnatomy3DSettings" type="button" class="ios-press min-h-[44px] px-3.5 py-2 rounded-2xl bg-sky-500/15 hover:bg-sky-500/25 text-xs font-semibold text-sky-700 dark:text-sky-300 shrink-0 transition whitespace-nowrap">
        Aç
      </button>
    `;
    settingsCard.appendChild(row);
    row.querySelector('#btnOpenAnatomy3DSettings')?.addEventListener('click', () => {
      document.getElementById('btnCloseSettingsMenu')?.click();
      window.setTimeout(() => openModal({ modelId: 'cell' }), 140);
    });
  };

  const syncLauncherCopy = () => {
    const isEn = getLang() === 'en';
    const kicker = document.getElementById('anat3dCardKicker');
    const desc = document.getElementById('anat3dCardDesc');
    const btnInfo = document.getElementById('btnOpenAnatomy3DInfo');
    const lblSet = document.getElementById('lblSettingsAnat3d');
    const descSet = document.getElementById('descSettingsAnat3d');
    const btnSet = document.getElementById('btnOpenAnatomy3DSettings');
    if (kicker) kicker.textContent = isEn ? '3D Anatomy & Cell Atlas' : '3D Anatomi & Hücre Atlası';
    if (desc) desc.textContent = isEn ? 'Cell, Heart, Brain, Skull, Femur, Thorax · Practice Quiz' : 'Hücre, Kalp, Beyin, Kafatası, Femur, Toraks · Pratik Test';
    if (btnInfo) btnInfo.textContent = isEn ? 'Open 3D Atlas' : '3D Atlası Aç';
    if (lblSet) lblSet.textContent = isEn ? '3D Anatomy Atlas' : '3D Anatomi Atlası';
    if (descSet) descSet.textContent = isEn ? '6 interactive 3D models & station quiz' : '6 etkileşimli 3D model ve pratik testi';
    if (btnSet) btnSet.textContent = isEn ? 'Open' : 'Aç';
  };

  injectViewInfoLauncher();
  injectSettingsLauncher();
  syncLauncherCopy();

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('#btnLangTr, #btnLangEn, #btnAuthLangTr, #btnAuthLangEn')) {
      window.setTimeout(() => {
        syncLauncherCopy();
        if (modalOpen) renderUI();
      }, 100);
    }
  });

  window.__INONU_ANATOMY_3D__ = {
    open: openModal,
    close: closeModal,
    matchLesson: matchLessonToAnatomy,
  };
}
