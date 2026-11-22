import { useSyncExternalStore } from 'react';
import { gamesStatusStore } from './gamesStatus.service';
import { GAMES_STATUS } from './gamesStatusCore';

/** { phase: 'loading'|'ready'|'error', status, isMaintenance, retry, refresh } — مصدر واحد مشترك (جلب واحد وقناة Realtime واحدة مهما تعدّد المستهلكون). */
export function useGamesSectionStatus() {
  const snap = useSyncExternalStore(gamesStatusStore.subscribe, gamesStatusStore.getSnapshot, gamesStatusStore.getSnapshot);
  return {
    phase: snap.phase,
    status: snap.status,
    isMaintenance: snap.status === GAMES_STATUS.MAINTENANCE,
    retry: gamesStatusStore.retry,
    refresh: gamesStatusStore.refresh,
  };
}
