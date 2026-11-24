import { getBridge } from './bridge.ts';
import {
  getLiveStore,
  submitStudentFeedback,
  subscribeLiveStore,
  type StudentFeedback,
} from './liveStore.ts';

let initialized = false;
let modalOpen = false;
let activeTab: 'compose' | 'inbox' = 'compose';
let selectedCategory = 'Ders / Program';

const DEVICE_SENDER_LS_KEY = 'inonu_anon_sender_key_v1';
const SEEN_REPLIES_LS_KEY = 'inonu_anon_seen_replies_v1';

const CATEGORIES = [
  { key: 'Ders / Program', tr: 'Ders / Program', en: 'Schedule / Lesson' },
  { key: 'Amfi / Lab', tr: 'Amfi / Lab', en: 'Hall / Lab' },
  { key: 'Sınav', tr: 'Sınav', en: 'Exam' },
  { key: 'Öneri', tr: 'Öneri', en: 'Suggestion' },
  { key: 'Diğer', tr: 'Diğer', en: 'Other' },
];

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getOrCreateDeviceSenderKey(): string {
  try {
    const existing = localStorage.getItem(DEVICE_SENDER_LS_KEY);
    if (existing && /^dev_[a-zA-Z0-9_-]{8,40}$/.test(existing)) return existing;
    const rand = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const next = `dev_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
    localStorage.setItem(DEVICE_SENDER_LS_KEY, next);
    return next;
  } catch {
    return 'dev_local_anon';
  }
}

function getActiveSenderKeys(): { primary: string; all: string[]; boundToAccount: boolean } {
  const session = getBridge()?.getSession();
  const deviceKey = getOrCreateDeviceSenderKey();
  if (session && session.hash) {
    const accKey = `acc_${session.hash}`;
    return { primary: accKey, all: [accKey, deviceKey], boundToAccount: true };
  }
  return { primary: deviceKey, all: [deviceKey], boundToAccount: false };
}

function getSeenReplyMap(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_REPLIES_LS_KEY) || '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function markRepliesSeen(list: StudentFeedback[]): void {
  try {
    const map = getSeenReplyMap();
    let changed = false;
    list.forEach((fb) => {
      const sig = `${fb.status}|${fb.adminNote || ''}`;
      if ((fb.adminNote || fb.status === 'resolved') && map[fb.id] !== sig) {
        map[fb.id] = sig;
        changed = true;
      }
    });
    if (changed) {
      localStorage.setItem(SEEN_REPLIES_LS_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore storage errors
  }
}

function countUnreadReplies(list: StudentFeedback[]): number {
  const map = getSeenReplyMap();
  return list.filter((fb) => {
    if (!fb.adminNote && fb.status !== 'resolved') return false;
    const sig = `${fb.status}|${fb.adminNote || ''}`;
    return map[fb.id] !== sig;
  }).length;
}

function formatDateTime(ms: number): string {
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

export function initStudentFeedback(): void {
  if (initialized) return;
  initialized = true;

  // 1) Mount Liquid Glass Modal (Compose + My Anonymous Messages & Replies)
  const overlay = document.createElement('div');
  overlay.id = 'studentFeedbackModal';
  overlay.className = 'fb-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div id="studentFeedbackCard" class="fb-card ios-glass" role="dialog" aria-modal="true" aria-labelledby="fbModalTitle">
      <div class="fb-header">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-8 h-8 rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
          </span>
          <div class="min-w-0">
            <h3 id="fbModalTitle" class="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-tight truncate">Temsilciye Anonim İlet</h3>
            <p id="fbModalSub" class="text-[11px] text-slate-500 dark:text-slate-400 truncate">Kimliğin gizli tutulur, yanıtlar hesabına düşer</p>
          </div>
        </div>
        <button id="btnCloseFeedbackModal" type="button" class="ios-press w-8 h-8 rounded-full ios-pill-control text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0" aria-label="Kapat">✕</button>
      </div>

      <div class="px-4 pt-3">
        <div id="fbTabSeg" class="admin-seg-group w-full grid grid-cols-2">
          <button type="button" data-fb-tab="compose" class="admin-seg-chip is-active ios-press text-center">Yeni Mesaj</button>
          <button type="button" data-fb-tab="inbox" class="admin-seg-chip ios-press text-center inline-flex items-center justify-center gap-1.5">
            <span id="lblFbInboxTab">Gönderdiklerim</span>
            <span id="fbInboxCountBadge" class="hidden px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-teal-500/20 text-teal-700 dark:text-teal-300 tabular-nums">0</span>
          </button>
        </div>
      </div>

      <form id="studentFeedbackForm" class="p-4 space-y-3" novalidate>
        <div id="fbAccountHint" class="fb-account-hint"></div>

        <div class="space-y-1.5">
          <span id="lblFbCategory" class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Konu</span>
          <div id="fbCategoryChips" class="flex items-center gap-1.5 flex-wrap"></div>
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <label id="lblFbMessage" for="fbMessageInput" class="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Mesajın</label>
            <span id="fbCharCounter" class="text-[10.5px] font-semibold text-slate-400 tabular-nums">0 / 600</span>
          </div>
          <textarea id="fbMessageInput" rows="4" maxlength="600" placeholder="İstek, sorun veya önerini yaz..." class="w-full ios-pill-control rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40"></textarea>
        </div>

        <button id="btnSubmitStudentFeedback" type="submit" class="ios-press w-full min-h-[42px] py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white text-xs sm:text-sm font-bold shadow-sm transition">Anonim Gönder</button>
      </form>

      <div id="studentFeedbackInbox" class="hidden p-4 pt-3 max-h-[62vh] overflow-y-auto space-y-2.5"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const titleEl = document.getElementById('fbModalTitle')!;
  const subEl = document.getElementById('fbModalSub')!;
  const catLbl = document.getElementById('lblFbCategory')!;
  const msgLbl = document.getElementById('lblFbMessage')!;
  const chipsWrap = document.getElementById('fbCategoryChips')!;
  const msgInp = document.getElementById('fbMessageInput') as HTMLTextAreaElement;
  const charCounter = document.getElementById('fbCharCounter')!;
  const submitBtn = document.getElementById('btnSubmitStudentFeedback') as HTMLButtonElement;
  const closeBtn = document.getElementById('btnCloseFeedbackModal')!;
  const formEl = document.getElementById('studentFeedbackForm') as HTMLFormElement;
  const inboxEl = document.getElementById('studentFeedbackInbox')!;
  const tabSeg = document.getElementById('fbTabSeg')!;
  const inboxCountBadge = document.getElementById('fbInboxCountBadge')!;
  const inboxTabLbl = document.getElementById('lblFbInboxTab')!;
  const accountHintEl = document.getElementById('fbAccountHint')!;

  const getMyFeedbacks = (): StudentFeedback[] => {
    const keys = getActiveSenderKeys();
    const keySet = new Set(keys.all);
    return getLiveStore().feedbacks.filter((f) => f.senderKey && keySet.has(f.senderKey));
  };

  const syncInfoCardBadge = () => {
    const isEn = getBridge()?.getState().lang === 'en';
    const myList = getMyFeedbacks();
    const unread = countUnreadReplies(myList);
    const totalReplies = myList.filter((f) => Boolean(f.adminNote)).length;
    const t = document.getElementById('infoFbCardTitle');
    const s = document.getElementById('infoFbCardSub');
    const b = document.getElementById('btnOpenFeedbackFromInfo');
    const badge = document.getElementById('infoFbReplyBadge');

    if (t) t.textContent = isEn ? 'Anonymous Feedback' : 'Temsilciye Anonim İlet';
    if (s) {
      s.textContent = unread > 0
        ? isEn
          ? `${unread} new reply from representative`
          : `Temsilciden ${unread} yeni geri dönüt var`
        : totalReplies > 0
          ? isEn
            ? 'Send anonymously & view representative replies'
            : 'Anonim ilet ve temsilci yanıtlarını gör'
          : isEn
            ? 'Send lesson, hall, or exam requests anonymously'
            : 'Ders, amfi veya sınav taleplerini anonim ilet';
    }
    if (b) {
      b.textContent = unread > 0 ? (isEn ? 'View' : 'Gör') : (isEn ? 'Open' : 'Aç');
    }
    if (badge) {
      if (unread > 0) {
        badge.classList.remove('hidden');
        badge.textContent = isEn ? `${unread} Reply` : `${unread} Yanıt`;
      } else {
        badge.classList.add('hidden');
      }
    }
  };

  const renderModalUI = () => {
    const isEn = getBridge()?.getState().lang === 'en';
    const keys = getActiveSenderKeys();
    const myList = getMyFeedbacks();
    const unread = countUnreadReplies(myList);

    titleEl.textContent = isEn ? 'Anonymous Feedback' : 'Temsilciye Anonim İlet';
    subEl.textContent = isEn
      ? 'Your identity stays hidden; replies link to your account'
      : 'Kimliğin gizli tutulur, yanıtlar hesabına düşer';
    catLbl.textContent = isEn ? 'Topic' : 'Konu';
    msgLbl.textContent = isEn ? 'Message' : 'Mesajın';
    msgInp.placeholder = isEn ? 'Write your request, issue, or suggestion...' : 'İstek, sorun veya önerini yaz...';
    submitBtn.textContent = isEn ? 'Send Anonymously' : 'Anonim Gönder';

    const composeBtn = tabSeg.querySelector<HTMLButtonElement>('[data-fb-tab="compose"]');
    const inboxBtn = tabSeg.querySelector<HTMLButtonElement>('[data-fb-tab="inbox"]');
    if (composeBtn) {
      composeBtn.textContent = isEn ? 'New Message' : 'Yeni Mesaj';
      composeBtn.classList.toggle('is-active', activeTab === 'compose');
    }
    if (inboxBtn) {
      inboxBtn.classList.toggle('is-active', activeTab === 'inbox');
    }
    inboxTabLbl.textContent = isEn ? 'My Sent & Replies' : 'Gönderdiklerim';

    if (myList.length > 0) {
      inboxCountBadge.classList.remove('hidden');
      inboxCountBadge.textContent = unread > 0 ? `${unread} yeni` : String(myList.length);
      inboxCountBadge.className = unread > 0
        ? 'px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-500 text-white tabular-nums'
        : 'px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/20 text-teal-700 dark:text-teal-300 tabular-nums';
    } else {
      inboxCountBadge.classList.add('hidden');
    }

    if (keys.boundToAccount) {
      accountHintEl.innerHTML = `
        <span class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal-700 dark:text-teal-300">
          <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
          <span>${isEn ? 'Linked anonymously to your student account — admin cannot see who you are.' : 'Öğrenci hesabına anonim bağlı — temsilci kimliğini görmez, yanıtları buradan alırsın.'}</span>
        </span>
      `;
    } else {
      accountHintEl.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-[11px] font-medium text-slate-600 dark:text-slate-300">${isEn ? 'Sign in to sync anonymous replies across devices.' : 'Yanıtları tüm cihazlardan görmek için hesabına giriş yapabilirsin.'}</span>
          <button type="button" data-fb-login="1" class="ios-press px-2.5 py-1 rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300 text-[10.5px] font-bold shrink-0">${isEn ? 'Sign In' : 'Giriş Yap'}</button>
        </div>
      `;
    }

    chipsWrap.innerHTML = CATEGORIES.map((c) => {
      const active = selectedCategory === c.key;
      return `<button type="button" data-fb-cat="${c.key}" class="ios-press fb-cat-chip ${active ? 'is-active' : ''}">${isEn ? c.en : c.tr}</button>`;
    }).join('');

    formEl.classList.toggle('hidden', activeTab !== 'compose');
    inboxEl.classList.toggle('hidden', activeTab !== 'inbox');

    if (activeTab === 'inbox') {
      if (myList.length === 0) {
        inboxEl.innerHTML = `
          <div class="ios-pill-control rounded-2xl p-6 text-center space-y-1.5">
            <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${isEn ? 'No anonymous messages yet' : 'Henüz gönderdiğin anonim mesaj yok'}</p>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">${isEn ? 'Messages you send and representative replies will appear here.' : 'Gönderdiğin iletiler ve temsilciden gelen geri dönütler burada görünür.'}</p>
          </div>
        `;
      } else {
        inboxEl.innerHTML = myList
          .map((fb, idx) => {
            const isResolved = fb.status === 'resolved';
            const hasReply = Boolean(fb.adminNote && fb.adminNote.trim());
            const delay = Math.min(idx * 40, 260);
            return `
              <div class="ios-pill-control rounded-2xl p-3.5 space-y-2 admin-stagger-item" style="--admin-delay:${delay}ms">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300">${escapeHtml(fb.category || 'Genel')}</span>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isResolved ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}">${isResolved ? (isEn ? 'Resolved' : 'Çözüldü') : (isEn ? 'Pending' : 'İnceleniyor')}</span>
                  </div>
                  <span class="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">${formatDateTime(fb.createdAtMs)}</span>
                </div>
                <p class="text-xs sm:text-[13px] font-medium text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(fb.message)}</p>
                ${
                  hasReply
                    ? `<div class="fb-reply-bubble">
                        <div class="flex items-center gap-1.5 mb-1">
                          <span class="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                          <span class="text-[10.5px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">${isEn ? 'Representative Reply' : 'Temsilci Geri Dönütü'}</span>
                        </div>
                        <p class="text-xs font-medium text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(fb.adminNote)}</p>
                      </div>`
                    : `<p class="text-[11px] italic text-slate-400 dark:text-slate-500">${isEn ? 'Waiting for representative response...' : 'Henüz temsilci yanıtı eklenmedi...'}</p>`
                }
              </div>
            `;
          })
          .join('');
      }
      if (modalOpen) {
        markRepliesSeen(myList);
        syncInfoCardBadge();
      }
    }
  };

  tabSeg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fb-tab]');
    if (!btn) return;
    activeTab = btn.getAttribute('data-fb-tab') === 'inbox' ? 'inbox' : 'compose';
    getBridge()?.triggerHaptic('selection');
    renderModalUI();
  });

  accountHintEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fb-login]');
    if (!btn) return;
    closeModal();
    getBridge()?.openAuthModal();
  });

  chipsWrap.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fb-cat]');
    if (!btn) return;
    selectedCategory = btn.getAttribute('data-fb-cat') || 'Ders / Program';
    getBridge()?.triggerHaptic('selection');
    renderModalUI();
  });

  msgInp.addEventListener('input', () => {
    charCounter.textContent = `${msgInp.value.length} / 600`;
  });

  const openModal = () => {
    const bridge = getBridge();
    if (bridge?.isSiteLocked()) return;
    const myList = getMyFeedbacks();
    const unread = countUnreadReplies(myList);
    activeTab = unread > 0 ? 'inbox' : 'compose';
    modalOpen = true;
    renderModalUI();
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    bridge?.syncModalScrollLock();
    bridge?.triggerHaptic('light');
  };

  const closeModal = () => {
    if (!modalOpen) return;
    modalOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      overlay.classList.add('hidden');
      getBridge()?.syncModalScrollLock();
    }, 220);
  };

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) closeModal();
  });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bridge = getBridge();
    const isEn = bridge?.getState().lang === 'en';
    const message = msgInp.value.trim();
    if (message.length < 3) {
      bridge?.showToast(isEn ? 'Please write a short message.' : 'Lütfen en az birkaç kelime yazın.');
      return;
    }
    const keys = getActiveSenderKeys();
    submitBtn.disabled = true;
    try {
      await submitStudentFeedback({
        category: selectedCategory,
        message,
        senderKey: keys.primary,
      });
      msgInp.value = '';
      charCounter.textContent = '0 / 600';
      activeTab = 'inbox';
      renderModalUI();
      bridge?.triggerHaptic('success');
      bridge?.showToast(isEn ? 'Sent anonymously to class admin!' : 'Anonim olarak temsilciye iletildi!');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // 2) Inject clean trigger card inside #viewInfo (Sınav & Bilgi tab)
  const viewInfo = document.getElementById('viewInfo');
  if (viewInfo && !document.getElementById('infoFeedbackCard')) {
    const card = document.createElement('div');
    card.id = 'infoFeedbackCard';
    card.className = 'ios-glass ios-tab-card rounded-3xl p-4 flex items-center justify-between gap-3';
    card.innerHTML = `
      <div class="flex items-center gap-3 min-w-0">
        <span class="w-10 h-10 rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
        </span>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 id="infoFbCardTitle" class="text-sm font-bold text-slate-900 dark:text-white leading-tight">Temsilciye Anonim İlet</h3>
            <span id="infoFbReplyBadge" class="hidden px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500 text-white">1 Yanıt</span>
          </div>
          <p id="infoFbCardSub" class="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">Ders, amfi veya sınav taleplerini anonim ilet</p>
        </div>
      </div>
      <button id="btnOpenFeedbackFromInfo" type="button" class="ios-press px-3.5 py-2 rounded-full bg-teal-500/15 hover:bg-teal-500/25 text-teal-700 dark:text-teal-300 text-xs font-bold shrink-0">Aç</button>
    `;
    viewInfo.appendChild(card);
    card.querySelector('#btnOpenFeedbackFromInfo')?.addEventListener('click', openModal);
  }

  const syncAll = () => {
    syncInfoCardBadge();
    if (modalOpen) renderModalUI();
  };

  subscribeLiveStore(syncAll);
  window.addEventListener('inonu-ui-sync', syncAll);
  syncAll();

  window.__INONU_FEEDBACK__ = {
    open: openModal,
    close: closeModal,
  };
}
