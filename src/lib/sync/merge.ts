// Last write wins per id. One rule, in one place, so both directions of sync agree.
export type Kind = 'shortlist' | 'saved' | 'activities' | 'settings';

export interface SyncRec {
  kind: Kind;
  id: string;
  /** ms since epoch; the clock of the device that made the change. */
  updatedAt: number;
  deleted: boolean;
  /** Server write time (ms), set by the server. Only on records that came from it; the pull cursor follows it. */
  syncedAt?: number;
  /** Null for a tombstone. */
  payload: unknown | null;
}

/** Which side wins. The newer updatedAt; on a tie a deletion wins (so a delete is never undone by an equal-time edit), else the local copy stays. */
export function winner(local: SyncRec | undefined, remote: SyncRec): 'local' | 'remote' {
  if (!local) return 'remote';
  if (remote.updatedAt !== local.updatedAt) return remote.updatedAt > local.updatedAt ? 'remote' : 'local';
  return remote.deleted && !local.deleted ? 'remote' : 'local';
}
