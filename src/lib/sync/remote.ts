// The server side of sync: maps records to rows in schema ridgeline. RLS limits every call to the signed-in user's own rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanActivity } from '../backup';
import type { Activity } from '../store';
import { APP_DATA_SCHEMA } from '../accounts/config';
import { PausedError, StaleEpochError, type PushFailure, type Remote } from './engine';
import type { Kind, SyncRec } from './merge';
import { fitTrack, trimTrack } from './trim';

const TABLE: Record<Kind, string> = { shortlist: 'shortlist', saved: 'saved', activities: 'activities', settings: 'settings' };
const CHUNK = 25;
/** Rows per pull page. Hikes carry routes (up to 1 MB each), so a page of them is small: 25 rows is at most about 25 MB. */
export const pageSize = (kind: Kind) => (kind === 'activities' ? 25 : 500);
/** Database refusals that retrying the same row can never fix: over a limit, a failed check, a value too long. */
export const PERMANENT = new Set(['RL003', '23514', '22001']);
const iso = (ms: number) => new Date(ms).toISOString();
type Row = Record<string, unknown>;

/** Hike fields that go in `stats`. The route is separate (`track`). Never add body or health fields here. */
export function activityToRow(userId: string, r: SyncRec, keepTracksLocal: boolean, epoch = 0): Row {
  if (r.deleted || !r.payload) return { user_id: userId, id: r.id, started_at: iso(0), stats: {}, track: null, updated_at: iso(r.updatedAt), deleted: true, epoch };
  const a = r.payload as Activity;
  const { id, trailId, startedAt, points, updatedAt: _u, ...stats } = a;
  void id; void _u;
  return {
    user_id: userId, id: a.id, trail_id: trailId ?? null, started_at: iso(startedAt), stats,
    track: keepTracksLocal ? null : fitTrack(trimTrack(points)), // first and last 200 m removed, thinned to fit the server cap; null when "phone only" or nothing is left
    updated_at: iso(r.updatedAt), deleted: false, epoch,
  };
}

export function toRow(userId: string, r: SyncRec, keepTracksLocal: boolean, epoch = 0): Row {
  if (r.kind === 'activities') return activityToRow(userId, r, keepTracksLocal, epoch);
  if (r.kind === 'settings') return { user_id: userId, data: r.payload ?? {}, updated_at: iso(r.updatedAt), epoch };
  const p = r.payload as { trail?: unknown; addedAt?: number } | null;
  return { user_id: userId, trail_id: r.id, trail: r.deleted ? null : p?.trail ?? null, added_at: iso(p?.addedAt ?? r.updatedAt), updated_at: iso(r.updatedAt), deleted: r.deleted, epoch };
}

/** Returns null for a row that does not look right (it is skipped, never half-applied). */
export function fromRow(kind: Kind, row: Row): SyncRec | null {
  const updatedAt = Date.parse(String(row.updated_at)), syncedAt = Date.parse(String(row.synced_at));
  if (!Number.isFinite(updatedAt) || !Number.isFinite(syncedAt)) return null;
  const base = { kind, updatedAt, syncedAt, editedAt: 0 };
  if (kind === 'settings') return { ...base, id: 'settings', deleted: false, payload: row.data ?? {} };
  const deleted = row.deleted === true;
  if (kind === 'activities') {
    const id = String(row.id ?? '');
    if (deleted) return { ...base, id, deleted: true, payload: null };
    const s = (row.stats && typeof row.stats === 'object' ? row.stats : {}) as Row;
    const a = cleanActivity({ ...s, id, name: typeof s.name === 'string' ? s.name : 'Hike', trailId: row.trail_id ?? undefined, startedAt: Date.parse(String(row.started_at)), points: Array.isArray(row.track) ? row.track : [] });
    if (!a) return null;
    if (typeof s.pausedMs === 'number') a.pausedMs = s.pausedMs;
    return { ...base, id, deleted: false, payload: a };
  }
  const id = String(row.trail_id ?? '');
  if (!id) return null;
  return { ...base, id, deleted, payload: deleted ? null : { trail: row.trail, addedAt: Date.parse(String(row.added_at)) } };
}

/** One request per set of columns (PostgREST fills a missing column with null on conflict, which would blank a stored route). True if every request worked. */
async function sendGroups(rows: Row[], send: (rows: Row[]) => Promise<unknown>): Promise<boolean> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) { const sig = Object.keys(row).sort().join(','); groups.set(sig, [...(groups.get(sig) ?? []), row]); }
  let ok = true;
  for (const g of groups.values()) if (await send(g)) ok = false;
  return ok;
}

export function supabaseRemote(c: SupabaseClient, userId: string, keepTracksLocal: () => boolean): Remote {
  const t = (k: Kind) => c.schema(APP_DATA_SCHEMA).from(TABLE[k]);
  return {
    async pull(kind, since) {
      const out = new Map<string, SyncRec>();
      let from = since, first = true;
      for (;;) {
        // Rows of one upsert share a synced_at, so later pages start AT the last timestamp (>=) and de-duplicate.
        const q = t(kind).select('*');
        const { data, error } = await (first ? q.gt('synced_at', iso(from)) : q.gte('synced_at', iso(from))).order('synced_at', { ascending: true }).limit(pageSize(kind));
        if (error) throw new Error('sync pull: ' + error.message);
        const rows = (data ?? []) as Row[];
        for (const row of rows) { const r = fromRow(kind, row); if (r) out.set(r.id, r); }
        if (rows.length < pageSize(kind)) break;
        first = false;
        from = Date.parse(String(rows[rows.length - 1].synced_at));
      }
      return [...out.values()];
    },
    async epoch() {
      const { data, error } = await c.schema(APP_DATA_SCHEMA).from('profiles').select('data_epoch').maybeSingle();
      if (error) throw new Error('sync epoch: ' + error.message);
      return typeof data?.data_epoch === 'number' ? data.data_epoch : 0;
    },
    async push(kind, recs, epoch) {
      const conflict = kind === 'settings' ? 'user_id' : kind === 'activities' ? 'user_id,id' : 'user_id,trail_id';
      const failed: PushFailure[] = [];
      const send = async (rows: Row[]) => {
        const { error } = await t(kind).upsert(rows, { onConflict: conflict });
        const code = (error as { code?: string } | null)?.code;
        if (code === 'RL001') throw new StaleEpochError();
        if (code === 'RL002') throw new PausedError();
        return error ? { permanent: PERMANENT.has(String(code)), full: code === 'RL003' } : null;
      };
      for (let i = 0; i < recs.length; i += CHUNK) {
        const batch = recs.slice(i, i + CHUNK);
        const rows = batch.map((r) => toRow(userId, r, keepTracksLocal(), epoch));
        const ok = await sendGroups(rows, send);
        if (ok) continue;
        // The batch failed: try the rows one by one so a single bad row cannot hold up the others.
        for (let j = 0; j < rows.length; j++) { const e = await send([rows[j]]); if (e) failed.push({ id: batch[j].id, permanent: e.permanent, full: e.full }); }
      }
      return { failed };
    },
  };
}
