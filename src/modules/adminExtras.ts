import { getBridge } from './bridge.ts';
import {
  deleteExtraLesson,
  deleteLessonOverride,
  deleteLivePoll,
  deleteStudentFeedback,
  getBannerReadCount,
  getLessonOverrideForSlot,
  getLiveStore,
  getMaintenanceStatus,
  saveEmergencyBanner,
  saveExtraLesson,
  saveLessonOverride,
  saveLivePoll,
  saveMaintenanceConfig,
  subscribeLiveStore,
  updateStudentFeedback,
  type BannerTone,
} from './liveStore.ts';
import { hashStudentId, normalizeStudentId } from '../studentAllowlist.ts';

let initialized = false;

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isoToDmy(iso: string): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function dmyToIso(dmy: string): string {
  const m = String(dmy || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function formatFeedbackTime(ms: number): string {
  if (!ms) return '';
  try {
    const d = new Date(ms);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm} ${hh}:${mi}`;
  } catch {
    return '';
  }
}

const FEEDBACK_CAT_STYLES: Record<string, string> = {
  'Ders / Program': 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  'Amfi / Lab': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'Sınav': 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
  'Öneri': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'Diğer': 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
};

const EXTRA_PANE_IDS: Record<string, string> = {
  'extras-feedback': 'adminPaneExtrasFeedback',
  'extras-polls': 'adminPaneExtrasPolls',
  'extras-overrides': 'adminPaneExtrasOverrides',
  'extras-extra-lessons': 'adminPaneExtrasExtraLessons',
  'extras-banner': 'adminPaneExtrasBanner',
};

function replayExtraPaneEnter(el: HTMLElement | null, dir: string): void {
  if (!el) return;
  el.classList.remove('admin-pane-enter', 'admin-pane-enter-right', 'admin-pane-enter-left');
  void el.offsetWidth;
  if (dir === 'right') el.classList.add('admin-pane-enter-right');
  else if (dir === 'left') el.classList.add('admin-pane-enter-left');
  else el.classList.add('admin-pane-enter');
}

export function initAdminExtras(): void {
  if (initialized) return;
  initialized = true;

  const hubEl = document.getElementById('adminPaneHub');
  const scrollBody = document.getElementById('adminModalScrollBody');
  if (!hubEl || !scrollBody) return;

  // 1) Inject iOS Settings Group into #adminPaneHub
  if (!document.getElementById('adminHubGroupExtras')) {
    const groupWrap = document.createElement('div');
    groupWrap.id = 'adminHubGroupExtras';
    groupWrap.className = 'space-y-2';
    groupWrap.innerHTML = `
      <span id="lblAdminHubGroupExtras" class="block px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Canlı Araçlar</span>
      <div class="admin-glass-section overflow-hidden">
        <button type="button" data-admin-hub-open="extras-feedback" class="admin-hub-row w-full px-3.5 py-3 flex items-center gap-3 text-left">
          <span class="w-9 h-9 rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
          </span>
          <div class="min-w-0 flex-1">
            <span class="block text-sm font-bold text-slate-900 dark:text-white leading-tight">Temsilciye İlet Kutusu</span>
            <span class="block text-[11.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">Anonim öğrenci istek ve şikayetleri</span>
          </div>
          <span id="countHubFeedback" class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/15 text-teal-700 dark:text-teal-300 tabular-nums shrink-0">0</span>
          <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>

        <button type="button" data-admin-hub-open="extras-polls" class="admin-hub-row w-full px-3.5 py-3 flex items-center gap-3 text-left">
          <span class="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          </span>
          <div class="min-w-0 flex-1">
            <span class="block text-sm font-bold text-slate-900 dark:text-white leading-tight">Canlı Anketler</span>
            <span class="block text-[11.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">Sınıf içi hızlı oylama başlat</span>
          </div>
          <span id="countHubPolls" class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/12 text-indigo-600 dark:text-indigo-300 tabular-nums shrink-0">0</span>
          <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>

        <button type="button" data-admin-hub-open="extras-overrides" class="admin-hub-row w-full px-3.5 py-3 flex items-center gap-3 text-left">
          <span class="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
          </span>
          <div class="min-w-0 flex-1">
            <span class="block text-sm font-bold text-slate-900 dark:text-white leading-tight">Ders Saati / Amfi Değişikliği</span>
            <span class="block text-[11.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">Saat, derslik veya hoca güncelle</span>
          </div>
          <span id="countHubOverrides" class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/12 text-amber-700 dark:text-amber-300 tabular-nums shrink-0">0</span>
          <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>

        <button type="button" data-admin-hub-open="extras-extra-lessons" class="admin-hub-row w-full px-3.5 py-3 flex items-center gap-3 text-left">
          <span class="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          </span>
          <div class="min-w-0 flex-1">
            <span class="block text-sm font-bold text-slate-900 dark:text-white leading-tight">Ek / Telafi Ders Ekle</span>
            <span class="block text-[11.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">Seçili güne yeni ders ekle</span>
          </div>
          <span id="countHubExtraLessons" class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/12 text-emerald-600 dark:text-emerald-300 tabular-nums shrink-0">0</span>
          <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>

        <button type="button" data-admin-hub-open="extras-banner" class="admin-hub-row w-full px-3.5 py-3 flex items-center gap-3 text-left">
          <span class="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </span>
          <div class="min-w-0 flex-1">
            <span class="block text-sm font-bold text-slate-900 dark:text-white leading-tight">Acil / Bakım Bannerı</span>
            <span class="block text-[11.5px] text-slate-500 dark:text-slate-400 truncate mt-0.5">Kaldırılamaz sabit acil şerit</span>
          </div>
          <span id="statusHubBanner" class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-500/12 text-slate-500 dark:text-slate-300 shrink-0">Kapalı</span>
          <svg class="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>
      </div>
    `;
    hubEl.appendChild(groupWrap);

    groupWrap.querySelectorAll<HTMLButtonElement>('[data-admin-hub-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-admin-hub-open') || '';
        getBridge()?.switchAdminTab(key, true);
      });
    });
  }

  // 2) Mount the 5 Admin Panes inside #adminModalScrollBody (ZERO native <select> elements!)
  const panesWrapper = document.createElement('div');
  panesWrapper.innerHTML = `
    <!-- PANE: ANONİM TEMSİLCİYE İLET KUTUSU (#1) -->
    <div id="adminPaneExtrasFeedback" class="hidden space-y-3.5">
      <div class="admin-glass-section p-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">Anonim İstek &amp; Şikayetler</h4>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">Öğrencilerden kimlik bilgisi olmadan gelen iletiler</p>
        </div>
        <div id="adminFbFilterSeg" class="admin-seg-group">
          <button type="button" data-fb-filter="all" class="admin-seg-chip is-active ios-press">Tümü</button>
          <button type="button" data-fb-filter="pending" class="admin-seg-chip ios-press">Bekleyen</button>
          <button type="button" data-fb-filter="resolved" class="admin-seg-chip ios-press">Çözülen</button>
        </div>
      </div>
      <div id="adminFeedbackList" class="space-y-2.5"></div>
    </div>

    <!-- PANE: CANLI ANKETLER -->
    <div id="adminPaneExtrasPolls" class="hidden space-y-4">
      <form id="adminPollForm" class="admin-glass-section p-3.5 sm:p-4 space-y-3" novalidate>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">Yeni Canlı Anket</h4>
          <div id="adminPollProgSeg" class="admin-seg-group">
            <button type="button" data-poll-prog="" class="admin-seg-chip is-active ios-press">TR+EN</button>
            <button type="button" data-poll-prog="tr" class="admin-seg-chip ios-press">TR</button>
            <button type="button" data-poll-prog="en" class="admin-seg-chip ios-press">EN</button>
          </div>
        </div>
        <input id="adminPollQuestionInput" type="text" maxlength="200" placeholder="Anket sorusu (örn. Telafi dersi hangi gün olsun?)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
        <div id="adminPollOptionsWrap" class="space-y-2">
          <input type="text" maxlength="80" data-poll-opt-inp placeholder="Seçenek 1" class="w-full ios-pill-control rounded-xl px-3 py-2 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
          <input type="text" maxlength="80" data-poll-opt-inp placeholder="Seçenek 2" class="w-full ios-pill-control rounded-xl px-3 py-2 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
          <input type="text" maxlength="80" data-poll-opt-inp placeholder="Seçenek 3 (opsiyonel)" class="w-full ios-pill-control rounded-xl px-3 py-2 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
        </div>
        <div class="flex items-center justify-between gap-2">
          <button id="btnAdminPollAddOpt" type="button" class="ios-press px-3 py-1.5 rounded-full ios-pill-control text-[11px] font-semibold text-slate-600 dark:text-slate-300">+ Seçenek Ekle</button>
          <button type="submit" class="ios-press px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm">Anketi Yayınla</button>
        </div>
      </form>
      <div id="adminPollsList" class="space-y-2.5"></div>
    </div>

    <!-- PANE: DERS SAATİ / AMFİ DEĞİŞİKLİĞİ -->
    <div id="adminPaneExtrasOverrides" class="hidden space-y-4">
      <form id="adminOverrideForm" class="admin-glass-section p-3.5 sm:p-4 space-y-3" novalidate>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">Saat / Amfi / Hoca Değiştir</h4>
          <div id="adminOvProgSeg" class="admin-seg-group">
            <button type="button" data-ov-prog="tr" class="admin-seg-chip is-active ios-press">TR Programı</button>
            <button type="button" data-ov-prog="en" class="admin-seg-chip ios-press">EN Programı</button>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <input id="adminOvDateInput" type="hidden" value="" />
            <button id="btnAdminOvDateTrigger" type="button" class="ios-press w-full ios-pill-control rounded-2xl px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
              <span id="lblAdminOvDate" class="truncate">Tarih Seç</span>
              <svg class="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </button>
          </div>
          <div class="relative">
            <input id="adminOvSlotInput" type="hidden" value="" />
            <button id="btnAdminOvSlotTrigger" type="button" aria-expanded="false" class="ios-press w-full ios-pill-control rounded-2xl px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
              <span id="lblAdminOvSlot" class="truncate">Ders Saati Seç</span>
              <svg id="iconAdminOvSlotChevron" class="w-4 h-4 text-amber-500 shrink-0 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <div id="adminOvSlotPickerPanel" class="admin-in-site-picker hidden">
              <div id="adminOvSlotOptions" class="max-h-56 overflow-y-auto p-1.5 space-y-1"></div>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input id="adminOvTimeInput" type="text" maxlength="32" placeholder="Yeni Saat (örn. 14.00-14.50)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
          <input id="adminOvLocationInput" type="text" maxlength="120" placeholder="Yeni Amfi / Yer (örn. Amfi 2)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
        </div>
        <input id="adminOvInstructorInput" type="text" maxlength="140" placeholder="Yeni Öğretim Üyesi (opsiyonel)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
        <input id="adminOvNoteInput" type="text" maxlength="200" placeholder="Kısa not (örn. Derslik değişikliği)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
        <div class="flex justify-end">
          <button type="submit" class="ios-press px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-sm">Değişikliği Kaydet</button>
        </div>
      </form>
      <div id="adminOverridesList" class="space-y-2"></div>
    </div>

    <!-- PANE: EK / TELAFİ DERS EKLEME -->
    <div id="adminPaneExtrasExtraLessons" class="hidden space-y-4">
      <form id="adminExtraLessonForm" class="admin-glass-section p-3.5 sm:p-4 space-y-3" novalidate>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">Ek / Telafi Ders Ekle</h4>
          <div id="adminExProgSeg" class="admin-seg-group">
            <button type="button" data-ex-prog="tr" class="admin-seg-chip is-active ios-press">TR Programı</button>
            <button type="button" data-ex-prog="en" class="admin-seg-chip ios-press">EN Programı</button>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <input id="adminExDateInput" type="hidden" value="" />
            <button id="btnAdminExDateTrigger" type="button" class="ios-press w-full ios-pill-control rounded-2xl px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
              <span id="lblAdminExDate" class="truncate">Tarih Seç</span>
              <svg class="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </button>
          </div>
          <input id="adminExTimeInput" type="text" maxlength="32" placeholder="Saat (örn. 16.00-16.50)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
        </div>
        <input id="adminExTitleInput" type="text" maxlength="160" placeholder="Ders Adı (örn. Anatomi Telafi Dersi)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input id="adminExLocationInput" type="text" maxlength="120" placeholder="Amfi / Derslik (örn. Amfi 1)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
          <input id="adminExInstructorInput" type="text" maxlength="140" placeholder="Öğretim Üyesi (opsiyonel)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
        </div>
        <input id="adminExNoteInput" type="text" maxlength="200" placeholder="Açıklama / Not (opsiyonel)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none" />
        <div class="flex justify-end">
          <button type="submit" class="ios-press px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm">Ek Dersi Kaydet</button>
        </div>
      </form>
      <div id="adminExtraLessonsList" class="space-y-2"></div>
    </div>

    <!-- PANE: ACİL / BAKIM BANNERI -->
    <div id="adminPaneExtrasBanner" class="hidden space-y-4">
      <form id="adminBannerForm" class="admin-glass-section p-3.5 sm:p-4 space-y-3" novalidate>
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">Site Üstü Acil / Bakım Bannerı</h4>
              <span id="adminBannerReadStatBadge" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0">
                <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                <span id="adminBannerReadStatText">0 okunma</span>
              </span>
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Aktif edildiğinde tüm öğrencilerin ekranının en üstünde sabit görünür ve öğrenci tarafından kapatılamaz.</p>
          </div>
          <button id="btnAdminBannerToggle" type="button" role="switch" aria-checked="false" class="ios-toggle-switch shrink-0">
            <span class="ios-toggle-knob"></span>
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button type="button" data-banner-tone="urgent" class="ios-press pdf-arch-chip is-active">Acil (Kırmızı)</button>
          <button type="button" data-banner-tone="warn" class="ios-press pdf-arch-chip">Uyarı (Sarı)</button>
          <button type="button" data-banner-tone="info" class="ios-press pdf-arch-chip">Bilgi (Mavi)</button>
        </div>
        <textarea id="adminBannerTextInput" rows="3" maxlength="280" placeholder="Banner mesajı (örn. Bugün 13.30 sonrası dersler Amfi 2'ye alınmıştır!)" class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40"></textarea>
        <div class="flex justify-end">
          <button type="submit" class="ios-press px-4 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm">Bannerı Güncelle</button>
        </div>
      </form>
    </div>
  `;
  while (panesWrapper.firstElementChild) {
    scrollBody.appendChild(panesWrapper.firstElementChild);
  }

  // ==================== IN-SITE SEGMENTED CONTROLS STATE ====================
  let pollProgDraft: '' | 'tr' | 'en' = '';
  let ovProgDraft: 'tr' | 'en' = 'tr';
  let exProgDraft: 'tr' | 'en' = 'tr';
  let fbFilterDraft: 'all' | 'pending' | 'resolved' = 'all';

  const setSegActive = (containerId: string, attr: string, value: string) => {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute(attr) === value);
    });
  };

  document.getElementById('adminPollProgSeg')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-poll-prog]');
    if (!btn) return;
    const val = btn.getAttribute('data-poll-prog') || '';
    pollProgDraft = val === 'tr' || val === 'en' ? val : '';
    setSegActive('adminPollProgSeg', 'data-poll-prog', pollProgDraft);
    getBridge()?.triggerHaptic('selection');
  });

  document.getElementById('adminFbFilterSeg')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fb-filter]');
    if (!btn) return;
    const val = btn.getAttribute('data-fb-filter');
    fbFilterDraft = val === 'pending' || val === 'resolved' ? val : 'all';
    setSegActive('adminFbFilterSeg', 'data-fb-filter', fbFilterDraft);
    getBridge()?.triggerHaptic('selection');
    renderAdminLists();
  });

  // ==================== OVERRIDE DATE + IN-SITE SLOT PICKER ====================
  const ovDateInp = document.getElementById('adminOvDateInput') as HTMLInputElement;
  const ovDateLbl = document.getElementById('lblAdminOvDate')!;
  const ovSlotInp = document.getElementById('adminOvSlotInput') as HTMLInputElement;
  const ovSlotLbl = document.getElementById('lblAdminOvSlot')!;
  const ovSlotTrigger = document.getElementById('btnAdminOvSlotTrigger') as HTMLButtonElement;
  const ovSlotChevron = document.getElementById('iconAdminOvSlotChevron')!;
  const ovSlotPanel = document.getElementById('adminOvSlotPickerPanel')!;
  const ovSlotOptionsEl = document.getElementById('adminOvSlotOptions')!;
  const ovTimeInp = document.getElementById('adminOvTimeInput') as HTMLInputElement;
  const ovLocInp = document.getElementById('adminOvLocationInput') as HTMLInputElement;
  const ovInstInp = document.getElementById('adminOvInstructorInput') as HTMLInputElement;
  const ovNoteInp = document.getElementById('adminOvNoteInput') as HTMLInputElement;

  const setOvSlotPickerOpen = (open: boolean) => {
    ovSlotPanel.classList.toggle('hidden', !open);
    ovSlotTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    ovSlotChevron.style.transform = open ? 'rotate(180deg)' : '';
    if (open) {
      ovSlotPanel.classList.remove('admin-dropdown-enter');
      void ovSlotPanel.offsetWidth;
      ovSlotPanel.classList.add('admin-dropdown-enter');
    }
    window.__INONU_BACK_NAV__?.sync(open ? 'open' : 'close');
  };

  ovSlotTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = ovSlotPanel.classList.contains('hidden');
    setOvSlotPickerOpen(isHidden);
    getBridge()?.triggerHaptic('selection');
  });

  document.addEventListener('click', (e) => {
    if (ovSlotPanel.classList.contains('hidden')) return;
    const t = e.target as HTMLElement;
    if (!t.closest('#adminOvSlotPickerPanel') && !t.closest('#btnAdminOvSlotTrigger')) {
      setOvSlotPickerOpen(false);
    }
  });

  const syncOvFieldsFromSelection = () => {
    const dmy = ovDateInp.value;
    const slotNo = Number(ovSlotInp.value) || 0;
    const existing = getLessonOverrideForSlot(dmy, slotNo, ovProgDraft);
    if (existing) {
      ovTimeInp.value = existing.newTime;
      ovLocInp.value = existing.newLocation;
      ovInstInp.value = existing.newInstructor;
      ovNoteInp.value = existing.note;
    } else {
      ovTimeInp.value = '';
      ovLocInp.value = '';
      ovInstInp.value = '';
      ovNoteInp.value = '';
    }
  };

  const populateOvSlots = (preferredSlotNo?: number) => {
    const bridge = getBridge();
    const dmy = ovDateInp.value || bridge?.getState().selectedDate || '';
    ovDateInp.value = dmy;
    ovDateLbl.textContent = dmy || 'Tarih Seç';
    const days = bridge?.getScheduleDays(ovProgDraft) || [];
    const dayObj = days.find((d) => d.date === dmy);

    if (!dayObj || !dayObj.slots.length) {
      ovSlotInp.value = '';
      ovSlotLbl.textContent = 'Bu tarihte ders yok';
      ovSlotOptionsEl.innerHTML = `<div class="px-3 py-3 text-center text-xs text-slate-500 dark:text-slate-400">Bu tarihte kayıtlı ders bulunmuyor.</div>`;
      syncOvFieldsFromSelection();
      return;
    }

    const chosenSlot =
      (preferredSlotNo ? dayObj.slots.find((s) => Number(s.slotNo) === Number(preferredSlotNo)) : null) ||
      dayObj.slots.find((s) => String(s.slotNo) === ovSlotInp.value) ||
      dayObj.slots[0];

    ovSlotInp.value = String(chosenSlot.slotNo);
    ovSlotLbl.textContent = `${chosenSlot.slotNo}. Ders (${chosenSlot.time}) — ${chosenSlot.title.slice(0, 26)}`;

    ovSlotOptionsEl.innerHTML = dayObj.slots
      .map((s) => {
        const active = String(s.slotNo) === ovSlotInp.value;
        return `
          <button type="button" data-ov-slot-pick="${s.slotNo}" class="admin-in-site-opt ${active ? 'is-selected' : ''} ios-press">
            <span class="block text-xs font-bold truncate">${s.slotNo}. Ders · ${escapeHtml(s.time)}</span>
            <span class="block text-[11px] opacity-80 truncate mt-0.5">${escapeHtml(s.title)}</span>
          </button>
        `;
      })
      .join('');

    syncOvFieldsFromSelection();
  };

  ovSlotOptionsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ov-slot-pick]');
    if (!btn) return;
    const slotNo = Number(btn.getAttribute('data-ov-slot-pick')) || 0;
    if (!slotNo) return;
    ovSlotInp.value = String(slotNo);
    setOvSlotPickerOpen(false);
    populateOvSlots(slotNo);
    getBridge()?.triggerHaptic('selection');
  });

  document.getElementById('adminOvProgSeg')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ov-prog]');
    if (!btn) return;
    ovProgDraft = btn.getAttribute('data-ov-prog') === 'en' ? 'en' : 'tr';
    setSegActive('adminOvProgSeg', 'data-ov-prog', ovProgDraft);
    setOvSlotPickerOpen(false);
    populateOvSlots();
    getBridge()?.triggerHaptic('selection');
  });

  document.getElementById('btnAdminOvDateTrigger')?.addEventListener('click', () => {
    setOvSlotPickerOpen(false);
    getBridge()?.openDateTimePicker({
      mode: 'date',
      title: 'Ders Tarihi Seç',
      initialValue: dmyToIso(ovDateInp.value),
      onApply: (val) => {
        if (!val) return;
        ovDateInp.value = isoToDmy(val);
        populateOvSlots();
      },
    });
  });

  // Extra lesson segmented + in-site date trigger
  const exDateInp = document.getElementById('adminExDateInput') as HTMLInputElement;
  const exDateLbl = document.getElementById('lblAdminExDate')!;
  const syncExDateDefault = () => {
    if (!exDateInp.value) {
      exDateInp.value = getBridge()?.getState().selectedDate || '';
    }
    exDateLbl.textContent = exDateInp.value || 'Tarih Seç';
  };

  document.getElementById('adminExProgSeg')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ex-prog]');
    if (!btn) return;
    exProgDraft = btn.getAttribute('data-ex-prog') === 'en' ? 'en' : 'tr';
    setSegActive('adminExProgSeg', 'data-ex-prog', exProgDraft);
    getBridge()?.triggerHaptic('selection');
  });

  document.getElementById('btnAdminExDateTrigger')?.addEventListener('click', () => {
    getBridge()?.openDateTimePicker({
      mode: 'date',
      title: 'Ek Ders Tarihi Seç',
      initialValue: dmyToIso(exDateInp.value),
      onApply: (val) => {
        if (!val) return;
        exDateInp.value = isoToDmy(val);
        exDateLbl.textContent = exDateInp.value;
      },
    });
  });

  // ==================== BANNER CONTROLS ====================
  let bannerActiveDraft = false;
  let bannerToneDraft: BannerTone = 'urgent';
  const bannerToggleBtn = document.getElementById('btnAdminBannerToggle')!;
  const bannerTextInp = document.getElementById('adminBannerTextInput') as HTMLTextAreaElement;

  const syncBannerFormFromStore = () => {
    const { banner } = getLiveStore();
    bannerActiveDraft = banner.active;
    bannerToneDraft = banner.tone;
    bannerToggleBtn.setAttribute('aria-checked', bannerActiveDraft ? 'true' : 'false');
    bannerToggleBtn.classList.toggle('is-on', bannerActiveDraft);
    if (document.activeElement !== bannerTextInp) {
      bannerTextInp.value = banner.text;
    }
    document.querySelectorAll<HTMLButtonElement>('[data-banner-tone]').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-banner-tone') === bannerToneDraft);
    });
    const readTextEl = document.getElementById('adminBannerReadStatText');
    if (readTextEl) {
      const reads = getBannerReadCount(banner.updatedAtMs);
      readTextEl.textContent = `${reads} okunma`;
    }
  };

  bannerToggleBtn.addEventListener('click', () => {
    bannerActiveDraft = !bannerActiveDraft;
    bannerToggleBtn.setAttribute('aria-checked', bannerActiveDraft ? 'true' : 'false');
    bannerToggleBtn.classList.toggle('is-on', bannerActiveDraft);
    getBridge()?.triggerHaptic('selection');
  });

  document.querySelectorAll<HTMLButtonElement>('[data-banner-tone]').forEach((b) => {
    b.addEventListener('click', () => {
      bannerToneDraft = (b.getAttribute('data-banner-tone') as BannerTone) || 'urgent';
      document.querySelectorAll<HTMLButtonElement>('[data-banner-tone]').forEach((x) => {
        x.classList.toggle('is-active', x === b);
      });
      getBridge()?.triggerHaptic('selection');
    });
  });

  document.getElementById('adminBannerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = bannerTextInp.value.trim();
    if (bannerActiveDraft && !text) {
      getBridge()?.showToast('Aktif banner için mesaj yazın.');
      return;
    }
    await saveEmergencyBanner({
      active: bannerActiveDraft,
      text,
      tone: bannerToneDraft,
    });
    getBridge()?.showToast(bannerActiveDraft ? 'Acil banner sabit olarak yayınlandı.' : 'Banner kapatıldı.');
  });

  // ==================== MAINTENANCE MODE & SCHEDULED CONTROLS (#9) ====================
  let maintActiveDraft = false;
  let maintStartAtDraft = 0;
  let maintEndAtDraft = 0;
  let maintDraftDirty = false;
  const maintToggleBtn = document.getElementById('btnAdminMaintToggle')!;
  const maintTitleInp = document.getElementById('adminMaintTitleInput') as HTMLInputElement;
  const maintMsgInp = document.getElementById('adminMaintMsgInput') as HTMLTextAreaElement;
  const maintStatusBadge = document.getElementById('adminMaintStatusBadge');
  const maintSchedSummary = document.getElementById('adminMaintScheduleSummary');
  const maintSchedSummaryText = document.getElementById('adminMaintScheduleSummaryText');
  const maintStartLbl = document.getElementById('lblAdminMaintStart');
  const maintEndLbl = document.getElementById('lblAdminMaintEnd');

  const formatDateTimeShort = (ms: number): string => {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const toDateTimeLocalIso = (ms: number): string => {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const setupCollapsibleDrawer = (btnId: string, wrapId: string, chevronId: string) => {
    const btn = document.getElementById(btnId);
    const wrap = document.getElementById(wrapId);
    const chev = document.getElementById(chevronId);
    if (!btn || !wrap) return;
    btn.addEventListener('click', () => {
      const willOpen = wrap.classList.contains('is-collapsed');
      wrap.classList.toggle('is-collapsed', !willOpen);
      wrap.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (chev) chev.style.transform = willOpen ? 'rotate(180deg)' : '';
      getBridge()?.triggerHaptic('selection');
    });
  };
  setupCollapsibleDrawer('btnToggleMaintDetails', 'adminMaintDetailsWrap', 'iconMaintDetailsChevron');
  setupCollapsibleDrawer('btnToggleMaintWhitelist', 'adminMaintWhitelistWrap', 'iconMaintWhitelistChevron');

  const renderMaintScheduleLabels = () => {
    if (maintStartLbl) {
      maintStartLbl.textContent = maintStartAtDraft > 0 ? formatDateTimeShort(maintStartAtDraft) : 'Hemen başla';
    }
    if (maintEndLbl) {
      maintEndLbl.textContent = maintEndAtDraft > 0 ? formatDateTimeShort(maintEndAtDraft) : 'Manuel kapat';
    }
    if (maintSchedSummary && maintSchedSummaryText) {
      if (maintStartAtDraft > 0 || maintEndAtDraft > 0) {
        const parts: string[] = [];
        if (maintStartAtDraft > 0) parts.push(`Başlangıç: ${formatDateTimeShort(maintStartAtDraft)}`);
        if (maintEndAtDraft > 0) parts.push(`Oto Açılış: ${formatDateTimeShort(maintEndAtDraft)}`);
        maintSchedSummaryText.textContent = parts.join(' · ');
        maintSchedSummary.classList.remove('hidden');
      } else {
        maintSchedSummary.classList.add('hidden');
        maintSchedSummaryText.textContent = '';
      }
    }
  };

  const syncMaintenanceFormFromStore = (force = false) => {
    const { maintenance } = getLiveStore();
    const status = getMaintenanceStatus(maintenance);
    maintActiveDraft = maintenance.active;
    if (force || !maintDraftDirty) {
      maintStartAtDraft = maintenance.startAtMs || 0;
      maintEndAtDraft = maintenance.endAtMs || 0;
    }
    maintToggleBtn.setAttribute('aria-checked', maintActiveDraft ? 'true' : 'false');
    maintToggleBtn.classList.toggle('is-on', maintActiveDraft);
    if (document.activeElement !== maintTitleInp) {
      maintTitleInp.value = maintenance.title;
    }
    if (document.activeElement !== maintMsgInp) {
      maintMsgInp.value = maintenance.message;
    }
    if (maintStatusBadge) {
      if (status === 'active') {
        maintStatusBadge.textContent = 'Aktif';
        maintStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0';
      } else if (status === 'scheduled') {
        maintStatusBadge.textContent = 'Planlı';
        maintStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-700 dark:text-blue-300 shrink-0';
      } else if (status === 'expired') {
        maintStatusBadge.textContent = 'Süresi Doldu';
        maintStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shrink-0';
      } else {
        maintStatusBadge.textContent = 'Kapalı';
        maintStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/12 text-slate-500 dark:text-slate-300 shrink-0';
      }
    }
    const countBadge = document.getElementById('adminMaintAllowedCountBadge');
    if (countBadge) countBadge.textContent = String(maintenance.allowedHashes.length);
    renderMaintScheduleLabels();
  };

  maintToggleBtn.addEventListener('click', async () => {
    maintActiveDraft = !maintActiveDraft;
    maintToggleBtn.setAttribute('aria-checked', maintActiveDraft ? 'true' : 'false');
    maintToggleBtn.classList.toggle('is-on', maintActiveDraft);
    getBridge()?.triggerHaptic('selection');

    // If turning ON while previous endAtMs is already in the past, clear stale endAtMs so it doesn't stay expired
    const now = Date.now();
    let nextStart = maintStartAtDraft;
    let nextEnd = maintEndAtDraft;
    if (maintActiveDraft && nextEnd > 0 && nextEnd <= now) {
      nextStart = 0;
      nextEnd = 0;
      maintStartAtDraft = 0;
      maintEndAtDraft = 0;
    }

    const cur = getLiveStore().maintenance;
    maintDraftDirty = false;
    await saveMaintenanceConfig({
      active: maintActiveDraft,
      title: maintTitleInp.value.trim() || cur.title || 'Sistem Bakımda',
      message:
        maintMsgInp.value.trim() ||
        cur.message ||
        'Kısa süreli bakım ve güncelleme çalışması yapılıyor. Lütfen daha sonra tekrar deneyin.',
      allowedHashes: cur.allowedHashes,
      allowedLabels: cur.allowedLabels,
      startAtMs: nextStart,
      endAtMs: nextEnd,
    });
    const statusAfter = getMaintenanceStatus(getLiveStore().maintenance);
    getBridge()?.showToast(
      !maintActiveDraft
        ? 'Bakım modu kapatıldı.'
        : statusAfter === 'scheduled'
          ? 'Planlı bakım zamanlandı.'
          : 'Bakım modu aktif edildi.'
    );
  });

  document.getElementById('btnAdminMaintStartTrigger')?.addEventListener('click', () => {
    getBridge()?.openDateTimePicker({
      mode: 'datetime',
      title: 'Bakım Başlangıç Zamanı',
      initialValue: toDateTimeLocalIso(maintStartAtDraft || Date.now()),
      onApply: (val) => {
        if (!val) return;
        const ms = new Date(val).getTime();
        if (!Number.isNaN(ms)) {
          maintStartAtDraft = ms;
          maintDraftDirty = true;
          renderMaintScheduleLabels();
          getBridge()?.triggerHaptic('selection');
        }
      },
    });
  });

  document.getElementById('btnAdminMaintEndTrigger')?.addEventListener('click', () => {
    getBridge()?.openDateTimePicker({
      mode: 'datetime',
      title: 'Otomatik Açılış (Bitiş) Zamanı',
      initialValue: toDateTimeLocalIso(maintEndAtDraft || Date.now() + 60 * 60 * 1000),
      onApply: (val) => {
        if (!val) return;
        const ms = new Date(val).getTime();
        if (!Number.isNaN(ms)) {
          maintEndAtDraft = ms;
          maintDraftDirty = true;
          renderMaintScheduleLabels();
          getBridge()?.triggerHaptic('selection');
        }
      },
    });
  });

  document.getElementById('btnAdminMaintClearSchedule')?.addEventListener('click', () => {
    maintStartAtDraft = 0;
    maintEndAtDraft = 0;
    maintDraftDirty = true;
    renderMaintScheduleLabels();
    getBridge()?.triggerHaptic('selection');
  });

  document.querySelectorAll<HTMLButtonElement>('[data-maint-quick-min]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mins = Number(btn.getAttribute('data-maint-quick-min')) || 0;
      if (mins <= 0) return;
      const base = maintStartAtDraft > Date.now() ? maintStartAtDraft : Date.now();
      maintEndAtDraft = base + mins * 60 * 1000;
      maintActiveDraft = true;
      maintDraftDirty = true;
      maintToggleBtn.setAttribute('aria-checked', 'true');
      maintToggleBtn.classList.add('is-on');
      renderMaintScheduleLabels();
      getBridge()?.triggerHaptic('selection');
    });
  });

  document.getElementById('adminMaintForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (maintStartAtDraft > 0 && maintEndAtDraft > 0 && maintEndAtDraft <= maintStartAtDraft) {
      getBridge()?.showToast('Bitiş zamanı başlangıçtan sonra olmalıdır.');
      return;
    }
    const cur = getLiveStore().maintenance;
    maintDraftDirty = false;
    await saveMaintenanceConfig({
      active: maintActiveDraft,
      title: maintTitleInp.value.trim() || 'Sistem Bakımda',
      message:
        maintMsgInp.value.trim() ||
        'Kısa süreli bakım ve güncelleme çalışması yapılıyor. Lütfen daha sonra tekrar deneyin.',
      allowedHashes: cur.allowedHashes,
      allowedLabels: cur.allowedLabels,
      startAtMs: maintStartAtDraft,
      endAtMs: maintEndAtDraft,
    });
    const statusAfter = getMaintenanceStatus(getLiveStore().maintenance);
    getBridge()?.triggerHaptic('success');
    getBridge()?.showToast(
      !maintActiveDraft
        ? 'Bakım ayarları kaydedildi (kapalı).'
        : statusAfter === 'scheduled'
          ? 'Planlı bakım kaydedildi.'
          : 'Bakım ayarları kaydedildi ve aktif edildi.'
    );
  });

  document.getElementById('adminMaintAllowForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idInp = document.getElementById('adminMaintAllowIdInput') as HTMLInputElement;
    const lblInp = document.getElementById('adminMaintAllowLabelInput') as HTMLInputElement;
    const cleaned = normalizeStudentId(idInp.value);
    if (!cleaned || cleaned.length < 4) {
      getBridge()?.showToast('Geçerli bir öğrenci numarası girin.');
      idInp.focus();
      return;
    }
    const cur = getLiveStore().maintenance;
    if (cur.allowedHashes.length >= 50) {
      getBridge()?.showToast('En fazla 50 izinli numara eklenebilir.');
      return;
    }
    const h = hashStudentId(cleaned);
    if (cur.allowedHashes.includes(h)) {
      getBridge()?.showToast('Bu numara zaten izinli listede.');
      return;
    }
    const masked = `••••••${cleaned.slice(-4)}`;
    const extraLbl = lblInp.value.trim().slice(0, 40);
    const label = extraLbl ? `${masked} · ${extraLbl}` : masked;
    await saveMaintenanceConfig({
      active: cur.active,
      title: cur.title,
      message: cur.message,
      allowedHashes: [...cur.allowedHashes, h],
      allowedLabels: [...cur.allowedLabels, label],
      startAtMs: cur.startAtMs,
      endAtMs: cur.endAtMs,
    });
    idInp.value = '';
    lblInp.value = '';
    getBridge()?.triggerHaptic('success');
    getBridge()?.showToast('Numara bakım izin listesine eklendi.');
  });

  // ==================== POLLS FORM ====================
  const pollOptsWrap = document.getElementById('adminPollOptionsWrap')!;
  document.getElementById('btnAdminPollAddOpt')?.addEventListener('click', () => {
    const existingCount = pollOptsWrap.querySelectorAll('[data-poll-opt-inp]').length;
    if (existingCount >= 6) {
      getBridge()?.showToast('En fazla 6 seçenek eklenebilir.');
      return;
    }
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 80;
    inp.setAttribute('data-poll-opt-inp', '');
    inp.placeholder = `Seçenek ${existingCount + 1}`;
    inp.className = 'w-full ios-pill-control rounded-xl px-3 py-2 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none admin-card-reveal';
    pollOptsWrap.appendChild(inp);
    inp.focus();
  });

  document.getElementById('adminPollForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const qInp = document.getElementById('adminPollQuestionInput') as HTMLInputElement;
    const question = qInp.value.trim();
    const options = Array.from(pollOptsWrap.querySelectorAll<HTMLInputElement>('[data-poll-opt-inp]'))
      .map((i) => i.value.trim())
      .filter(Boolean);
    if (!question || options.length < 2) {
      getBridge()?.showToast('Soru ve en az 2 seçenek girin.');
      return;
    }
    await saveLivePoll({
      question,
      options,
      targetProg: pollProgDraft,
      active: true,
    });
    qInp.value = '';
    pollOptsWrap.querySelectorAll<HTMLInputElement>('[data-poll-opt-inp]').forEach((i) => (i.value = ''));
    getBridge()?.showToast('Canlı anket yayınlandı.');
  });

  // ==================== OVERRIDE FORM ====================
  document.getElementById('adminOverrideForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = ovDateInp.value.trim();
    const slotNo = Number(ovSlotInp.value) || 0;
    if (!date || slotNo < 1) {
      getBridge()?.showToast('Geçerli tarih ve ders saati seçin.');
      return;
    }
    if (!ovTimeInp.value.trim() && !ovLocInp.value.trim() && !ovInstInp.value.trim() && !ovNoteInp.value.trim()) {
      getBridge()?.showToast('En az bir değişiklik alanı doldurun.');
      return;
    }
    await saveLessonOverride({
      date,
      slotNo,
      targetProg: ovProgDraft,
      newTime: ovTimeInp.value.trim(),
      newLocation: ovLocInp.value.trim(),
      newInstructor: ovInstInp.value.trim(),
      note: ovNoteInp.value.trim(),
    });
    getBridge()?.showToast('Ders değişikliği kaydedildi.');
  });

  // ==================== EXTRA LESSON FORM ====================
  document.getElementById('adminExtraLessonForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = exDateInp.value.trim();
    const titleInp = document.getElementById('adminExTitleInput') as HTMLInputElement;
    const timeInp = document.getElementById('adminExTimeInput') as HTMLInputElement;
    const locInp = document.getElementById('adminExLocationInput') as HTMLInputElement;
    const instInp = document.getElementById('adminExInstructorInput') as HTMLInputElement;
    const noteInp = document.getElementById('adminExNoteInput') as HTMLInputElement;
    if (!date || !titleInp.value.trim() || !timeInp.value.trim()) {
      getBridge()?.showToast('Tarih, ders adı ve saat zorunludur.');
      return;
    }
    await saveExtraLesson({
      date,
      targetProg: exProgDraft,
      title: titleInp.value.trim(),
      time: timeInp.value.trim(),
      location: locInp.value.trim(),
      instructor: instInp.value.trim(),
      note: noteInp.value.trim(),
    });
    titleInp.value = '';
    timeInp.value = '';
    locInp.value = '';
    instInp.value = '';
    noteInp.value = '';
    getBridge()?.showToast('Ek / telafi ders eklendi.');
  });

  // ==================== RENDER ALL ADMIN LISTS + HUB COUNTS ====================
  const renderAdminLists = () => {
    const snap = getLiveStore();

    // Hub counts
    const cFb = document.getElementById('countHubFeedback');
    const cPolls = document.getElementById('countHubPolls');
    const cOv = document.getElementById('countHubOverrides');
    const cEx = document.getElementById('countHubExtraLessons');
    const sBan = document.getElementById('statusHubBanner');
    const sMaint = document.getElementById('statusHubMaintenance');
    const pendingFb = snap.feedbacks.filter((f) => f.status === 'pending').length;
    if (cFb) {
      cFb.textContent = String(pendingFb);
      cFb.className = pendingFb > 0
        ? 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/20 text-teal-700 dark:text-teal-300 tabular-nums shrink-0'
        : 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-500/12 text-slate-500 dark:text-slate-300 tabular-nums shrink-0';
    }
    if (cPolls) cPolls.textContent = String(snap.polls.filter((p) => p.active).length);
    if (cOv) cOv.textContent = String(snap.overrides.length);
    if (cEx) cEx.textContent = String(snap.extraLessons.length);
    if (sBan) {
      sBan.textContent = snap.banner.active ? 'Aktif' : 'Kapalı';
      sBan.className = snap.banner.active
        ? 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-300 shrink-0'
        : 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-500/12 text-slate-500 dark:text-slate-300 shrink-0';
    }
    if (sMaint) {
      const mStatus = getMaintenanceStatus(snap.maintenance);
      if (mStatus === 'active') {
        sMaint.textContent = 'Açık';
        sMaint.className = 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0';
      } else if (mStatus === 'scheduled') {
        sMaint.textContent = 'Planlı';
        sMaint.className = 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/15 text-blue-700 dark:text-blue-300 shrink-0';
      } else {
        sMaint.textContent = 'Kapalı';
        sMaint.className = 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-500/12 text-slate-500 dark:text-slate-300 shrink-0';
      }
    }

    syncBannerFormFromStore();
    syncMaintenanceFormFromStore(false);

    // Maintenance allowed list
    const maintList = document.getElementById('adminMaintAllowedList');
    if (maintList) {
      const { allowedHashes, allowedLabels } = snap.maintenance;
      if (allowedHashes.length === 0) {
        maintList.innerHTML = `<div class="ios-pill-control rounded-2xl p-3.5 text-center text-xs text-slate-500 dark:text-slate-400">Henüz izinli öğrenci numarası eklenmedi (yöneticiler her zaman girebilir).</div>`;
      } else {
        maintList.innerHTML = allowedHashes
          .map(
            (h, idx) => `
            <div class="ios-pill-control rounded-2xl px-3 py-2.5 flex items-center justify-between gap-2 admin-stagger-item" style="--admin-delay:${Math.min(idx * 35, 240)}ms">
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(allowedLabels[idx] || '••••')}</p>
                <p class="text-[10px] font-mono text-slate-400 truncate">Hash: ${escapeHtml(h.slice(0, 12))}…</p>
              </div>
              <button type="button" data-maint-del-hash="${escapeHtml(h)}" class="ios-press px-3 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold shrink-0">Kaldır</button>
            </div>
          `
          )
          .join('');
      }
    }

    // Student Feedback list
    const fbList = document.getElementById('adminFeedbackList');
    if (fbList) {
      const filteredFb = snap.feedbacks.filter((f) =>
        fbFilterDraft === 'all' ? true : f.status === fbFilterDraft
      );
      if (filteredFb.length === 0) {
        fbList.innerHTML = `<div class="ios-pill-control rounded-2xl p-5 text-center text-xs text-slate-500 dark:text-slate-400">Bu filtrede anonim ileti bulunmuyor.</div>`;
      } else {
        fbList.innerHTML = filteredFb
          .map((fb, idx) => {
            const catCls = FEEDBACK_CAT_STYLES[fb.category] || 'bg-slate-500/15 text-slate-600 dark:text-slate-300';
            const isResolved = fb.status === 'resolved';
            const delay = Math.min(idx * 42, 300);
            return `
              <div class="ios-pill-control rounded-2xl p-3.5 space-y-2.5 admin-stagger-item" style="--admin-delay:${delay}ms">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${catCls}">${escapeHtml(fb.category || 'Genel')}</span>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isResolved ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}">${isResolved ? 'Çözüldü' : 'Bekliyor'}</span>
                  </div>
                  <span class="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">${formatFeedbackTime(fb.createdAtMs)}</span>
                </div>
                <p class="text-xs sm:text-[13px] font-medium text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(fb.message)}</p>
                <div class="flex items-center gap-1.5">
                  <input type="text" maxlength="240" data-fb-note-inp="${escapeHtml(fb.id)}" value="${escapeHtml(fb.adminNote || '')}" placeholder="Öğrenciye anonim geri dönüt / yanıt yaz..." class="flex-1 min-w-0 ios-pill-control rounded-xl px-2.5 py-1.5 text-[11.5px] text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none" />
                  <button type="button" data-fb-save-note="${escapeHtml(fb.id)}" class="ios-press px-2.5 py-1.5 rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300 text-[11px] font-bold shrink-0">Yanıt Gönder</button>
                </div>
                <div class="flex items-center justify-end gap-1.5 pt-0.5">
                  <button type="button" data-fb-toggle="${escapeHtml(fb.id)}" class="ios-press px-3 py-1 rounded-full text-[11px] font-semibold ${isResolved ? 'ios-pill-control text-slate-700 dark:text-slate-200' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'}">${isResolved ? 'Bekleyene Al' : 'Çözüldü İşaretle'}</button>
                  <button type="button" data-fb-del="${escapeHtml(fb.id)}" class="ios-press px-3 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold">Sil</button>
                </div>
              </div>
            `;
          })
          .join('');
      }
    }

    // Polls list
    const pollsList = document.getElementById('adminPollsList');
    if (pollsList) {
      if (snap.polls.length === 0) {
        pollsList.innerHTML = `<div class="ios-pill-control rounded-2xl p-4 text-center text-xs text-slate-500 dark:text-slate-400">Henüz anket yok.</div>`;
      } else {
        pollsList.innerHTML = snap.polls
          .map((p, idx) => {
            const total = p.counts.reduce((a, b) => a + b, 0);
            const delay = Math.min(idx * 42, 300);
            return `
              <div class="ios-pill-control rounded-2xl p-3 space-y-2 admin-stagger-item" style="--admin-delay:${delay}ms">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${p.active ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/15 text-slate-500'}">${p.active ? 'Aktif' : 'Kapalı'}</span>
                    <span class="text-[10.5px] text-slate-500 ml-1 tabular-nums">${total} oy · ${p.targetProg ? p.targetProg.toUpperCase() : 'TR+EN'}</span>
                    <h5 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mt-1">${escapeHtml(p.question)}</h5>
                  </div>
                </div>
                <div class="space-y-1">
                  ${p.options
                    .map((o, i) => {
                      const c = p.counts[i] || 0;
                      const pct = total > 0 ? Math.round((c / total) * 100) : 0;
                      return `<div class="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300"><span>${escapeHtml(o)}</span><span class="font-bold tabular-nums">${pct}% (${c})</span></div>`;
                    })
                    .join('')}
                </div>
                <div class="flex items-center justify-end gap-1.5 pt-1">
                  <button type="button" data-poll-toggle="${escapeHtml(p.id)}" class="ios-press px-3 py-1 rounded-full ios-pill-control text-[11px] font-semibold text-slate-700 dark:text-slate-200">${p.active ? 'Kapat' : 'Aç'}</button>
                  <button type="button" data-poll-del="${escapeHtml(p.id)}" class="ios-press px-3 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold">Sil</button>
                </div>
              </div>
            `;
          })
          .join('');
      }
    }

    // Overrides list
    const ovList = document.getElementById('adminOverridesList');
    if (ovList) {
      if (snap.overrides.length === 0) {
        ovList.innerHTML = `<div class="ios-pill-control rounded-2xl p-4 text-center text-xs text-slate-500 dark:text-slate-400">Aktif ders değişikliği yok.</div>`;
      } else {
        ovList.innerHTML = snap.overrides
          .map(
            (o, idx) => `
            <div class="ios-pill-control rounded-2xl p-3 flex items-center justify-between gap-2 admin-stagger-item" style="--admin-delay:${Math.min(idx * 40, 280)}ms">
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-900 dark:text-white">${escapeHtml(o.date)} • ${o.slotNo}. Ders (${o.targetProg.toUpperCase()})</p>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escapeHtml([o.newTime, o.newLocation, o.newInstructor, o.note].filter(Boolean).join(' · '))}</p>
              </div>
              <button type="button" data-ov-del="${escapeHtml(o.id)}" class="ios-press px-3 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold shrink-0">Kaldır</button>
            </div>
          `
          )
          .join('');
      }
    }

    // Extra lessons list
    const exList = document.getElementById('adminExtraLessonsList');
    if (exList) {
      if (snap.extraLessons.length === 0) {
        exList.innerHTML = `<div class="ios-pill-control rounded-2xl p-4 text-center text-xs text-slate-500 dark:text-slate-400">Henüz ek / telafi ders eklenmedi.</div>`;
      } else {
        exList.innerHTML = snap.extraLessons
          .map(
            (ex, idx) => `
            <div class="ios-pill-control rounded-2xl p-3 flex items-center justify-between gap-2 admin-stagger-item" style="--admin-delay:${Math.min(idx * 40, 280)}ms">
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(ex.title)}</p>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escapeHtml(`${ex.date} • ${ex.time} (${ex.targetProg.toUpperCase()})${ex.location ? ` · ${ex.location}` : ''}`)}</p>
              </div>
              <button type="button" data-ex-del="${escapeHtml(ex.id)}" class="ios-press px-3 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold shrink-0">Sil</button>
            </div>
          `
          )
          .join('');
      }
    }
  };

  // Delegated actions for delete/toggle/feedback
  scrollBody.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;

    const fbToggle = t.closest<HTMLButtonElement>('[data-fb-toggle]');
    if (fbToggle) {
      const id = fbToggle.getAttribute('data-fb-toggle') || '';
      const fb = getLiveStore().feedbacks.find((x) => x.id === id);
      if (fb) {
        const nextStatus = fb.status === 'resolved' ? 'pending' : 'resolved';
        await updateStudentFeedback(id, { status: nextStatus });
        getBridge()?.triggerHaptic('selection');
        getBridge()?.showToast(nextStatus === 'resolved' ? 'Çözüldü olarak işaretlendi.' : 'Bekleyene alındı.');
      }
      return;
    }

    const fbSaveNote = t.closest<HTMLButtonElement>('[data-fb-save-note]');
    if (fbSaveNote) {
      const id = fbSaveNote.getAttribute('data-fb-save-note') || '';
      const inp = scrollBody.querySelector<HTMLInputElement>(`[data-fb-note-inp="${CSS.escape(id)}"]`);
      if (inp) {
        await updateStudentFeedback(id, { adminNote: inp.value.trim() });
        getBridge()?.triggerHaptic('selection');
        getBridge()?.showToast('Geri dönüt öğrenciye iletildi.');
      }
      return;
    }

    const maintDelHash = t.closest<HTMLButtonElement>('[data-maint-del-hash]');
    if (maintDelHash) {
      const hashToRemove = maintDelHash.getAttribute('data-maint-del-hash') || '';
      const cur = getLiveStore().maintenance;
      const idx = cur.allowedHashes.indexOf(hashToRemove);
      if (idx >= 0) {
        const nextHashes = cur.allowedHashes.filter((_, i) => i !== idx);
        const nextLabels = cur.allowedLabels.filter((_, i) => i !== idx);
        await saveMaintenanceConfig({
          active: cur.active,
          title: cur.title,
          message: cur.message,
          allowedHashes: nextHashes,
          allowedLabels: nextLabels,
        });
        getBridge()?.triggerHaptic('selection');
        getBridge()?.showToast('Numara izinli listeden kaldırıldı.');
      }
      return;
    }

    const fbDel = t.closest<HTMLButtonElement>('[data-fb-del]');
    if (fbDel) {
      await deleteStudentFeedback(fbDel.getAttribute('data-fb-del') || '');
      getBridge()?.showToast('İleti silindi.');
      return;
    }

    const pollToggle = t.closest<HTMLButtonElement>('[data-poll-toggle]');
    if (pollToggle) {
      const id = pollToggle.getAttribute('data-poll-toggle') || '';
      const poll = getLiveStore().polls.find((p) => p.id === id);
      if (poll) {
        await saveLivePoll({ ...poll, active: !poll.active });
        getBridge()?.showToast(poll.active ? 'Anket kapatıldı.' : 'Anket açıldı.');
      }
      return;
    }
    const pollDel = t.closest<HTMLButtonElement>('[data-poll-del]');
    if (pollDel) {
      await deleteLivePoll(pollDel.getAttribute('data-poll-del') || '');
      getBridge()?.showToast('Anket silindi.');
      return;
    }
    const ovDel = t.closest<HTMLButtonElement>('[data-ov-del]');
    if (ovDel) {
      await deleteLessonOverride(ovDel.getAttribute('data-ov-del') || '');
      getBridge()?.showToast('Ders değişikliği kaldırıldı.');
      return;
    }
    const exDel = t.closest<HTMLButtonElement>('[data-ex-del]');
    if (exDel) {
      await deleteExtraLesson(exDel.getAttribute('data-ex-del') || '');
      getBridge()?.showToast('Ek ders silindi.');
      return;
    }
  });

  // Sync extra pane visibility + directional animation whenever switchAdminTab runs in legacyApp.ts
  const syncExtraPanesVisibility = (activeTab: string, dir: string = 'right') => {
    setOvSlotPickerOpen(false);
    Object.entries(EXTRA_PANE_IDS).forEach(([tabKey, domId]) => {
      const el = document.getElementById(domId);
      if (!el) return;
      const isMatch = activeTab === tabKey;
      el.classList.toggle('hidden', !isMatch);
      if (isMatch) {
        replayExtraPaneEnter(el, dir);
      }
    });
    if (activeTab === 'extras-overrides') {
      populateOvSlots();
    } else if (activeTab === 'extras-extra-lessons') {
      syncExDateDefault();
    } else if (activeTab === 'extras-banner') {
      syncBannerFormFromStore();
    } else if (activeTab === 'site-settings') {
      maintDraftDirty = false;
      syncMaintenanceFormFromStore(true);
      renderAdminLists();
    } else if (activeTab === 'extras-feedback') {
      renderAdminLists();
    }
  };

  window.addEventListener('inonu-admin-tab-changed', (ev: Event) => {
    const detail = (ev as CustomEvent<{ tabKey?: string; dir?: string }>).detail;
    const tabKey = detail?.tabKey || 'hub';
    const dir = detail?.dir || 'right';
    syncExtraPanesVisibility(tabKey, dir);
  });

  const openOverrideForSlot = (slot: {
    date: string;
    slotNo: number;
    time?: string;
    location?: string;
    instructor?: string;
  }) => {
    const bridge = getBridge();
    if (!bridge || !bridge.isAdmin()) return;
    ovProgDraft = bridge.getState().lang === 'en' ? 'en' : 'tr';
    setSegActive('adminOvProgSeg', 'data-ov-prog', ovProgDraft);
    ovDateInp.value = slot.date;
    bridge.openAdminModal('extras-overrides');
    populateOvSlots(slot.slotNo);
    if (!ovTimeInp.value && slot.time) ovTimeInp.placeholder = `Yeni Saat (şu an: ${slot.time})`;
  };

  window.addEventListener('inonu-open-override-editor', (ev: Event) => {
    const slot = (ev as CustomEvent).detail;
    if (slot && slot.date && slot.slotNo) openOverrideForSlot(slot);
  });

  window.__INONU_ADMIN_EXTRAS__ = {
    openPane: (paneKey: string) => {
      const bridge = getBridge();
      if (!bridge || !bridge.isAdmin()) return;
      bridge.openAdminModal(paneKey);
    },
    openOverrideForSlot,
  };

  subscribeLiveStore(renderAdminLists);
}
