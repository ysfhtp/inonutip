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

function formatScore(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function getStrings(lang: 'tr' | 'en') {
  if (lang === 'en') {
    return {
      title: 'Committee Score History (C1–C5)',
      avgLabel: (n: number, avg: string) => `${n}/${COMMITTEE_COUNT} Avg: ${avg}`,
      emptyAvg: 'Type or save scores',
      saveBtn: (i: number, val: string) => `Save ${val} to C${i}`,
      clearBtn: (i: number) => `Clear C${i}`,
      shortPrefix: 'C',
      inputAria: (i: number) => `Committee ${i} Score`,
      savedToast: (i: number, val: string) => `Committee ${i} saved (${val}) • Average updated`,
      clearedToast: (i: number) => `Committee ${i} cleared`,
    };
  }
  return {
    title: 'Kurul Notu Geçmişi (K1–K5)',
    avgLabel: (n: number, avg: string) => `${n}/${COMMITTEE_COUNT} Ort: ${avg}`,
    emptyAvg: 'Puan yazın veya kaydedin',
    saveBtn: (i: number, val: string) => `K${i}'e Kaydet (${val})`,
    clearBtn: (i: number) => `K${i} Temizle`,
    shortPrefix: 'K',
    inputAria: (i: number) => `${i}. Kurul Puanı`,
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
  const scores = loadScores();

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

  const syncKurulOrtInput = (avg: number | null, clearWhenEmpty = false) => {
    if (avg === null) {
      if (!clearWhenEmpty) return;
      inpKurulOrt.value = '';
      inpKurulOrt.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    inpKurulOrt.value = avg.toFixed(2);
    inpKurulOrt.dispatchEvent(new Event('input', { bubbles: true }));
  };

  interface SlotNodes {
    wrap: HTMLDivElement;
    label: HTMLLabelElement;
    input: HTMLInputElement;
  }

  const slots: SlotNodes[] = [];

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

    for (let i = 1; i <= COMMITTEE_COUNT; i++) {
      const slot = slots[i - 1];
      if (!slot) continue;
      const v = scores[String(i)];
      const hasVal = typeof v === 'number';
      const isSelected = i === selectedIdx;

      slot.wrap.classList.toggle('is-selected', isSelected);
      slot.wrap.classList.toggle('is-filled', hasVal);
      slot.label.textContent = `${loc.shortPrefix}${i}`;
      slot.input.setAttribute('aria-label', loc.inputAria(i));
      if (document.activeElement !== slot.input) {
        slot.input.value = hasVal ? formatScore(v) : '';
      }
    }

    btnSave.textContent = loc.saveBtn(selectedIdx, curStr);
    btnSave.disabled = curVal === null;

    const selectedHasVal = typeof scores[String(selectedIdx)] === 'number';
    btnClear.classList.toggle('hidden', !selectedHasVal);
    btnClear.textContent = loc.clearBtn(selectedIdx);
  };

  // Build persistent K1–K5 editable slot inputs once so focus is never lost on render
  for (let i = 1; i <= COMMITTEE_COUNT; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'cs-slot';

    const label = document.createElement('label');
    label.className = 'cs-slot-lbl';
    label.htmlFor = `csSlotInput${i}`;

    const input = document.createElement('input');
    input.id = `csSlotInput${i}`;
    input.className = 'cs-slot-input';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 6;
    input.placeholder = '—';

    wrap.addEventListener('click', (e) => {
      if (e.target !== input) {
        input.focus();
      }
    });

    input.addEventListener('focus', () => {
      if (selectedIdx !== i) {
        selectedIdx = i;
        getBridge()?.triggerHaptic('selection');
        render();
      }
    });

    input.addEventListener('input', () => {
      const cleaned = input.value.replace(/[^0-9.,]/g, '');
      if (cleaned !== input.value) {
        input.value = cleaned;
      }

      const normalized = cleaned.replace(/,/g, '.').trim();
      if (!normalized || normalized === '.') {
        scores[String(i)] = null;
        saveScores(scores);
        const { avg } = computeAvg();
        syncKurulOrtInput(avg, true);
        render();
        return;
      }

      const parsed = parseFloat(normalized);
      if (!Number.isFinite(parsed)) return;

      let val = Math.round(parsed * 100) / 100;
      if (val > 100) {
        val = 100;
        input.value = '100';
      } else if (val < 0) {
        val = 0;
        input.value = '0';
      }

      scores[String(i)] = val;
      saveScores(scores);
      const { avg } = computeAvg();
      syncKurulOrtInput(avg, true);
      render();
    });

    input.addEventListener('blur', () => {
      const v = scores[String(i)];
      input.value = typeof v === 'number' ? formatScore(v) : '';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (i < COMMITTEE_COUNT) {
          slots[i]?.input.focus();
        } else {
          input.blur();
        }
      }
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    gridEl.appendChild(wrap);
    slots.push({ wrap, label, input });
  }

  btnSave.addEventListener('click', () => {
    const curVal = getCurrentCalculatedScore();
    if (curVal === null) return;
    const bridge = getBridge();
    const lang = bridge?.getState().lang === 'en' ? 'en' : 'tr';
    const loc = getStrings(lang);

    const targetIdx = selectedIdx;
    scores[String(targetIdx)] = curVal;
    saveScores(scores);
    const targetSlot = slots[targetIdx - 1];
    if (targetSlot) {
      targetSlot.input.value = formatScore(curVal);
    }

    const { avg } = computeAvg();
    syncKurulOrtInput(avg, true);
    bridge?.triggerHaptic('medium');
    bridge?.showToast(loc.savedToast(targetIdx, curVal.toFixed(2)));

    // Auto-advance to next empty committee slot if available
    for (let i = targetIdx + 1; i <= COMMITTEE_COUNT; i++) {
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
    const targetIdx = selectedIdx;
    scores[String(targetIdx)] = null;
    saveScores(scores);
    const targetSlot = slots[targetIdx - 1];
    if (targetSlot) {
      targetSlot.input.value = '';
    }
    const { avg } = computeAvg();
    syncKurulOrtInput(avg, true);
    bridge?.triggerHaptic('light');
    bridge?.showToast(loc.clearedToast(targetIdx));
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
