import { getBridge } from './bridge.ts';
import {
  getLiveStore,
  getLocalVotedPollIndex,
  subscribeLiveStore,
  voteLivePoll,
} from './liveStore.ts';

let initialized = false;

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initLivePolls(): void {
  if (initialized) return;
  initialized = true;

  const annContainer = document.getElementById('dailyAnnouncementsContainer');
  if (!annContainer || !annContainer.parentElement) return;

  let host = document.getElementById('livePollsContainer');
  if (!host) {
    host = document.createElement('div');
    host.id = 'livePollsContainer';
    host.className = 'hidden space-y-2.5';
    annContainer.insertAdjacentElement('afterend', host);
  }

  const renderPolls = () => {
    if (!host) return;
    const bridge = getBridge();
    const lang = bridge?.getState().lang === 'en' ? 'en' : 'tr';
    const isEn = lang === 'en';
    const isAdmin = Boolean(bridge?.isAdmin());

    const activePolls = getLiveStore().polls.filter(
      (p) => p.active && (!p.targetProg || p.targetProg === lang)
    );

    if (activePolls.length === 0) {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }

    host.classList.remove('hidden');
    host.innerHTML = activePolls
      .map((poll) => {
        const votedIdx = getLocalVotedPollIndex(poll.id);
        const totalVotes = poll.counts.reduce((acc, n) => acc + (Number(n) || 0), 0);
        const hasVoted = votedIdx !== null;

        const optionsHtml = poll.options
          .map((opt, idx) => {
            const count = Number(poll.counts[idx]) || 0;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isSelected = votedIdx === idx;
            return `
              <button
                type="button"
                data-poll-id="${escapeHtml(poll.id)}"
                data-poll-opt="${idx}"
                class="poll-opt-btn ios-press ${isSelected ? 'is-selected' : ''}"
              >
                <span class="poll-opt-fill" style="width: ${hasVoted || isAdmin ? pct : 0}%"></span>
                <span class="poll-opt-inner">
                  <span class="poll-opt-left">
                    <span class="poll-opt-radio">${isSelected ? '✓' : ''}</span>
                    <span class="poll-opt-label">${escapeHtml(opt)}</span>
                  </span>
                  ${
                    hasVoted || isAdmin
                      ? `<span class="poll-opt-stats tabular-nums">${pct}% <small>(${count})</small></span>`
                      : ''
                  }
                </span>
              </button>
            `;
          })
          .join('');

        return `
          <div class="poll-card ios-glass rounded-2xl p-3.5 space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 mb-1">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
                    ${isEn ? 'LIVE POLL' : 'CANLI ANKET'}
                  </span>
                  <span class="text-[10.5px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                    ${totalVotes} ${isEn ? (totalVotes === 1 ? 'vote' : 'votes') : 'oy'}
                  </span>
                </div>
                <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug">${escapeHtml(poll.question)}</h4>
              </div>
              ${
                isAdmin
                  ? `<button type="button" data-poll-manage="1" class="ios-press px-2.5 py-1 rounded-full ios-pill-control text-[10.5px] font-semibold text-slate-600 dark:text-slate-300 shrink-0">${isEn ? 'Manage' : 'Yönet'}</button>`
                  : ''
              }
            </div>
            <div class="space-y-1.5">
              ${optionsHtml}
            </div>
          </div>
        `;
      })
      .join('');
  };

  host.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const manageBtn = target.closest('[data-poll-manage]');
    if (manageBtn) {
      getBridge()?.triggerHaptic('selection');
      window.__INONU_ADMIN_EXTRAS__?.openPane('extras-polls');
      return;
    }

    const optBtn = target.closest<HTMLButtonElement>('[data-poll-id][data-poll-opt]');
    if (!optBtn) return;
    const pollId = optBtn.getAttribute('data-poll-id') || '';
    const optIdx = Number(optBtn.getAttribute('data-poll-opt'));
    if (!pollId || Number.isNaN(optIdx)) return;

    const bridge = getBridge();
    bridge?.triggerHaptic('selection');
    await voteLivePoll(pollId, optIdx);
    const isEn = bridge?.getState().lang === 'en';
    bridge?.showToast(isEn ? 'Vote recorded!' : 'Oyun kaydedildi!');
  });

  subscribeLiveStore(renderPolls);
  window.addEventListener('inonu-ui-sync', renderPolls);
}
