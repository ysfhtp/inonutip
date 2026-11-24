import { getBridge } from './bridge.ts';
import {
  FOOD_RATING_TAGS,
  getFoodRatingForDate,
  getLocalFoodVote,
  submitFoodRating,
  subscribeLiveStore,
} from './liveStore.ts';

let initialized = false;
let draftDateIso = '';
let draftStars = 0;
let draftTags = new Set<number>();

function getTodayIsoFallback(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function initFoodRatings(): void {
  if (initialized) return;
  initialized = true;

  const foodMenuContainer = document.getElementById('foodMenuContainer');
  if (!foodMenuContainer || !foodMenuContainer.parentElement) return;

  let host = document.getElementById('foodRatingCardHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'foodRatingCardHost';
    host.className = 'hidden';
    foodMenuContainer.insertAdjacentElement('afterend', host);
  }

  const syncDraftForDate = (iso: string) => {
    if (draftDateIso === iso) return;
    draftDateIso = iso;
    const saved = getLocalFoodVote(iso);
    draftStars = saved ? saved.stars : 0;
    draftTags = new Set<number>(saved ? saved.tags : []);
  };

  const render = () => {
    if (!host) return;
    const bridge = getBridge();
    const st = bridge?.getState();
    const isEn = st?.lang === 'en';
    const isWeekly = st?.foodViewMode === 'weekly';
    const dateIso = st?.foodDateISO && /^\d{4}-\d{2}-\d{2}$/.test(st.foodDateISO)
      ? st.foodDateISO
      : getTodayIsoFallback();

    if (isWeekly) {
      host.classList.add('hidden');
      return;
    }

    syncDraftForDate(dateIso);
    const doc = getFoodRatingForDate(dateIso);
    const savedVote = getLocalFoodVote(dateIso);
    const avg = doc.ratingCount > 0 ? (doc.ratingSum / doc.ratingCount).toFixed(1) : null;

    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="fr-card ios-glass rounded-3xl p-4 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <h3 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-tight">
              ${isEn ? "Rate Today's Meal" : 'Günün Yemeğini Puanla'}
            </h3>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              ${
                avg
                  ? `${isEn ? 'Live class average' : 'Canlı sınıf ortalaması'} · ${doc.ratingCount} ${isEn ? 'votes' : 'oy'}`
                  : isEn
                    ? 'Be the first to rate this menu'
                    : 'Bu menüyü ilk puanlayan sen ol'
              }
            </p>
          </div>
          <div class="fr-avg-pill">
            <span class="fr-avg-star">★</span>
            <span class="tabular-nums">${avg || '—'}</span>
          </div>
        </div>

        <div class="fr-stars-row" role="radiogroup" aria-label="${isEn ? 'Star rating' : 'Yıldız puanı'}">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) => `
              <button type="button" data-fr-star="${n}" class="fr-star-btn ios-press ${n <= draftStars ? 'is-filled' : ''}" aria-label="${n} ${isEn ? 'stars' : 'yıldız'}">★</button>
            `
            )
            .join('')}
        </div>

        <div class="flex items-center gap-1.5 flex-wrap">
          ${FOOD_RATING_TAGS.map((tag, idx) => {
            const selected = draftTags.has(idx);
            const cnt = doc.tagCounts[idx] || 0;
            return `
              <button type="button" data-fr-tag="${idx}" class="fr-tag-chip ios-press ${selected ? 'is-selected' : ''}">
                <span>${isEn ? tag.en : tag.tr}</span>
                ${cnt > 0 ? `<span class="fr-tag-count tabular-nums">${cnt}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>

        <div class="flex items-center justify-between gap-2 pt-1">
          <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            ${
              savedVote
                ? isEn
                  ? `Your rating: ${savedVote.stars}★`
                  : `Senin puanın: ${savedVote.stars}★`
                : isEn
                  ? 'Select stars & optional tags'
                  : 'Yıldız ve isteğe bağlı etiket seç'
            }
          </span>
          <button type="button" data-fr-submit="1" ${draftStars < 1 ? 'disabled' : ''} class="ios-press fr-submit-btn">
            ${savedVote ? (isEn ? 'Update' : 'Güncelle') : isEn ? 'Submit' : 'Puanla'}
          </button>
        </div>
      </div>
    `;
  };

  host.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const starBtn = t.closest<HTMLButtonElement>('[data-fr-star]');
    if (starBtn) {
      draftStars = Number(starBtn.getAttribute('data-fr-star')) || 0;
      getBridge()?.triggerHaptic('selection');
      render();
      return;
    }

    const tagBtn = t.closest<HTMLButtonElement>('[data-fr-tag]');
    if (tagBtn) {
      const idx = Number(tagBtn.getAttribute('data-fr-tag'));
      if (!Number.isNaN(idx)) {
        if (draftTags.has(idx)) draftTags.delete(idx);
        else draftTags.add(idx);
        getBridge()?.triggerHaptic('light');
        render();
      }
      return;
    }

    const subBtn = t.closest<HTMLButtonElement>('[data-fr-submit]');
    if (subBtn && draftStars >= 1) {
      const bridge = getBridge();
      const isEn = bridge?.getState().lang === 'en';
      subBtn.disabled = true;
      await submitFoodRating(draftDateIso, draftStars, Array.from(draftTags));
      bridge?.triggerHaptic('success');
      bridge?.showToast(isEn ? 'Meal rating saved!' : 'Yemek puanın kaydedildi!');
      render();
    }
  });

  // React to food date/mode changes smoothly
  const foodDateLabel = document.getElementById('foodDateBtnLabel');
  if (foodDateLabel) {
    new MutationObserver(() => render()).observe(foodDateLabel, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  const foodModeDaily = document.getElementById('btnFoodModeDaily');
  const foodModeWeekly = document.getElementById('btnFoodModeWeekly');
  foodModeDaily?.addEventListener('click', () => setTimeout(render, 30));
  foodModeWeekly?.addEventListener('click', () => setTimeout(render, 30));

  subscribeLiveStore(render);
  window.addEventListener('inonu-ui-sync', render);
  render();
}
