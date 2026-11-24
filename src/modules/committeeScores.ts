import { getBridge } from './bridge.ts';

const STORAGE_KEY = 'inonu_tip_d1_ios_v3_committeeScores_v1';
const COMMITTEE_COUNT = 5;

type ScoreMap = Record<string, number | null>;

let initialized = false;
let selectedIdx = 1;

function loadScores(): ScoreMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const out: ScoreMap = {};
    for (let i = 1; i <= COMMITTEE_COUNT; i++) {
      const v = parsed?.[String(i)];
      out[String(i)] = typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
    }
    return out;
  } catch {
    return { '1': null, '2': null, '3': null, '4': null, '5': null };
  }
}

function saveScores(scores: ScoreMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch {}
}

function getStrings(lang: 'tr' | 'en') {
  if (lang === 'en') {
    return {
      title: 'Committee Score History (C1–C5)',
      avgLabel: (n: number, avg: string) => `${n}/${COMMITTEE_COUNT} Avg: ${avg}`,
      emptyAvg: 'No saved scores yet',
      saveBtn: (i: number, val: string) => `Save ${val} to C${i}`,
      clearBtn: (i: number) => `Clear C${i}`,
      shortPrefix: 'C',
      savedToast: (i: number, val: string) => `Committee ${i} saved (${val}) • Average updated`,
      clearedToast: (i: number) => `Committee ${i} cleared`,
    };
  }
  return {
    title: 'Kurul Notu Geçmişi (K1–K5)',
    avgLabel: (n: number, avg: string) => `${n}/${COMMITTEE_COUNT} Ort: ${avg}`,
    emptyAvg: 'Henüz kayıtlı kurul yok',
    saveBtn: (i: number, val: string) => `K${i}'e Kaydet (${val})`,
    clearBtn: (i: number) => `K${i} Temizle`,
    shortPrefix: 'K',
    savedToast: (i: number, val: string) => `${i}. Kurul kaydedildi (${val}) • Ortalama güncellendi`,
    clearedToast: (i: number) => `${i}. Kurul temizlendi`,
  };
}

export function initCommitteeScores(): void {
  if (initialized) return;
  const hintEl = document.getElementById('calcKurulHint');
  const outKurulEl = document.getElementById('outKurulNotu');
  const inpKurulOrt = document.getElementById('inpKurulOrt') as HTMLInputElement | null;
  if (!hintEl || !outKurulEl || !inpKurulOrt) return;

  initialized = true;
  let scores = loadScores();

  const container = document.createElement('div');
  container.id = 'committeeHistoryWrap';
  container.className = 'cs-wrap';
  container.innerHTML = `
    <div class="cs-head">
      <span id="csTitle" class="cs-title"></span>
      <span id="csAvgBadge" class="cs-avg-badge"></span>
    </div>
    <div id="csGrid" class="cs-grid"></div>
    <div class="cs-actions">
      <button id="csBtnSave" type="button" class="cs-btn-save ios-press"></button>
      <button id="csBtnClear" type="button" class="cs-btn-clear ios-press hidden"></button>
    </div>
  `;
  hintEl.insertAdjacentElement('afterend', container);

  const titleEl = document.getElementById('csTitle')!;
  const avgBadge = document.getElementById('csAvgBadge')!;
  const gridEl = document.getElementById('csGrid')!;
  const btnSave = document.getElementById('csBtnSave') as HTMLButtonElement;
  const btnClear = document.getElementById('csBtnClear') as HTMLButtonElement;

  const getCurrentCalculatedScore = (): number | null => {
    const raw = (outKurulEl.textContent || '').replace(',', '.').trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
  };

  const computeAvg = (): { count: number; avg: number | null } => {
    const vals: number[] = [];
    for (let i = 1; i <= COMMITTEE_COUNT; i++) {
      const v = scores[String(i)];
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
    }
    if (!vals.length) return { count: 0, avg: null };
    const sum = vals.reduce((a, b) => a + b, 0);
    return { count: vals.length, avg: Math.round((sum / vals.length) * 100) / 100 };
  };

  const syncKurulOrtInput = (avg: number | null) => {
    if (avg === null) return;
    inpKurulOrt.value = avg.toFixed(2);
    inpKurulOrt.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const render = () => {
    const bridge = getBridge();
    const lang = bridge?.getState().lang === 'en' ? 'en' : 'tr';
    const loc = getStrings(lang);
    const { count, avg } = computeAvg();
    const curVal = getCurrentCalculatedScore();
    const curStr = curVal !== null ? curVal.toFixed(2) : '--';

    titleEl.textContent = loc.title;
    avgBadge.textContent = count > 0 && avg !== null ? loc.avgLabel(count, avg.toFixed(2)) : loc.emptyAvg;
    avgBadge.classList.toggle('has-avg', count > 0);

    gridEl.innerHTML = '';
    for (let i = 1; i <= COMMITTEE_COUNT; i++) {
      const v = scores[String(i)];
      const hasVal = typeof v === 'number';
      const isSelected = i === selectedIdx;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cs-slot ios-press${isSelected ? ' is-selected' : ''}${hasVal ? ' is-filled' : ''}`;
      btn.innerHTML = `
        <span class="cs-slot-lbl">${loc.shortPrefix}${i}</span>
        <span class="cs-slot-val">${hasVal ? v.toFixed(1) : '—'}</span>
      `;
      btn.addEventListener('click', () => {
        selectedIdx = i;
        bridge?.triggerHaptic('selection');
        render();
      });
      gridEl.appendChild(btn);
    }

    btnSave.textContent = loc.saveBtn(selectedIdx, curStr);
    btnSave.disabled = curVal === null;

    const selectedHasVal = typeof scores[String(selectedIdx)] === 'number';
    btnClear.classList.toggle('hidden', !selectedHasVal);
    btnClear.textContent = loc.clearBtn(selectedIdx);
  };

  btnSave.addEventListener('click', () => {
    const curVal = getCurrentCalculatedScore();
    if (curVal === null) return;
    const bridge = getBridge();
    const lang = bridge?.getState().lang === 'en' ? 'en' : 'tr';
    const loc = getStrings(lang);

    scores[String(selectedIdx)] = curVal;
    saveScores(scores);
    const { avg } = computeAvg();
    syncKurulOrtInput(avg);
    bridge?.triggerHaptic('medium');
    bridge?.showToast(loc.savedToast(selectedIdx, curVal.toFixed(2)));

    // Auto-advance to next empty committee slot if available
    for (let i = selectedIdx + 1; i <= COMMITTEE_COUNT; i++) {
      if (scores[String(i)] === null) {
        selectedIdx = i;
        break;
      }
    }
    render();
  });

  btnClear.addEventListener('click', () => {
    const bridge = getBridge();
    const lang = bridge?.getState().lang === 'en' ? 'en' : 'tr';
    const loc = getStrings(lang);
    scores[String(selectedIdx)] = null;
    saveScores(scores);
    const { avg } = computeAvg();
    syncKurulOrtInput(avg);
    bridge?.triggerHaptic('light');
    bridge?.showToast(loc.clearedToast(selectedIdx));
    render();
  });

  // Watch #outKurulNotu live changes so "Save X to K1" button always shows live score
  const obs = new MutationObserver(() => render());
  obs.observe(outKurulEl, { childList: true, characterData: true, subtree: true });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('#btnLangTr, #btnLangEn, #btnAuthLangTr, #btnAuthLangEn')) {
      setTimeout(render, 100);
    }
  });

  // Initial sync if committees were previously saved
  const initStats = computeAvg();
  if (initStats.count > 0 && initStats.avg !== null) {
    syncKurulOrtInput(initStats.avg);
  }
  render();
}
