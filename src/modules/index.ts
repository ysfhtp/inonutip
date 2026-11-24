import { onBridgeReady } from './bridge.ts';
import { initBottomSheet } from './bottomSheet.ts';
import { initCommitteeScores } from './committeeScores.ts';

export function initModularMenus(): void {
  onBridgeReady(() => {
    initBottomSheet();
    initCommitteeScores();
  });
}
