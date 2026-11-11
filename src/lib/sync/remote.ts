// The server side of sync: maps records to rows in schema ridgeline. RLS limits every call to the signed-in user's own rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanActivity } from '../backup';
import type { Activity } from '../store';
import { activityClimb } from '../badges';
import { trackDistance } from '../tracker';
import { APP_DATA_SCHEMA } from '../accounts/config';
import { PausedError, StaleEpochError, type PushFailure, type Remote } from './engine';
import type { Kind, SyncRec } from './merge';
import { fitTrack, trimTrack } from './trim';

const TABLE: Record<Kind, string> = { shortlist: 'shortlist', saved: 'saved', activities: 'activities', settings: 'settings' };
const CHUNK = 25;
/** The column that makes a row unique inside one user's table (the tie-breaker after synced_at). */
const KEY_COL: Record<Kind, string> = { shortlist: 'trail_id', saved: 'trail_id', activities: 'id', settings: 'user_id' };
/** A value inside a PostgREST filter: double-quoted, so commas, parentheses and dots in a trail id cannot change the filter. */
const quote = (v: string) => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
/** Rows per pull page. Hikes carry routes (up to 1 MB each), so a page of them is small: 25 rows is at most about 25 MB. */
export const pageSize = (kind: Kind) => (kind === 'activities' ? 25 : 500);
/** Database refusals that retrying the same row can never fix: over a limit (RL003), a row or value too big (54000, 22001), a failed check (23514). */
export const PERMANENT = new Set(['RL003', '54000', '23514', '22001']);
const iso = (ms: number) => new Date(ms).toISOString();
type Row = Record<string, unknown>;

/** Float residue (1e-17 from a subtraction) is refused by the database's json_ok check, and a refused hike would be parked for good. So before upload: any |x| < 1e-12
 *  becomes 0, and a non-finite number is dropped (removed from an object; null inside an array, so positions do not shift). Applied to every JSON column. */
export function cleanJson<T>(v: T): T {
  if (typeof v === 'number') return (Number.isFinite(v) ? (Math.abs(v) < 1e-12 ? 0 : v) : null) as T;
  if (Array.isArray(v)) return v.map((x) => cleanJson(x)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (typeof x === 'number' && !Number.isFinite(x)) continue; out[k] = cleanJson(x); }
    return out as T;
  }
  return v;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Hike fields that go in `stats`. The route is separate (`track`). Never add body or health fields here.
 * `summary` (distance, time, climb) lets another phone list the hike when the route is not uploaded.
 * The `track` column is only sent when this phone actually holds a route to upload: with "phone only" on, or on a phone that
 * only has the summary, the column is left out so an upsert never blanks a route that is already on the server.
 */
export function activityToRow(userId: string, r: SyncRec, keepTracksLocal: boolean, epoch = 0): Row {
  if (r.deleted || !r.payload) return { user_id: userId, id: r.id, started_at: iso(0), stats: {}, track: null, updated_at: iso(r.updatedAt), deleted: true, epoch };
  const a = r.payload as Activity;
  const { id, trailId, startedAt, points, updatedAt: _u, editedAt: _e, trackOrigin: _t, summary: _s, ...rest } = a;
  void id; void _u; void _e; void _t; void _s;
  const stats = { ...rest, summary: points.length >= 2 ? { distanceM: trackDistance(points), durationMs: (a.endedAt ?? startedAt) - startedAt, climbM: activityClimb(a, a.snapshot).m } : a.summary };
  const row: Row = { user_id: userId, id: a.id, trail_id: trailId ?? null, started_at: iso(startedAt), stats: cleanJson(stats), updated_at: iso(r.updatedAt), deleted: false, epoch };
  // Only a route recorded on this phone is uploaded, once, trimmed. A route that came from the server is already trimmed: sending it again would cut 200 m off each end per edit.
  if (!keepTracksLocal && points.length >= 2 && a.trackOrigin !== 'server') row.track = cleanJson(fitTrack(trimTrack(points))); // trimmed, thinned to fit the server cap; null when nothing is left
  return row;
}

export function toRow(userId: string, r: SyncRec, keepTracksLocal: boolean, epoch = 0): Row {
  if (r.kind === 'activities') return activityToRow(userId, r, keepTracksLocal, epoch);
  if (r.kind === 'settings') return { user_id: userId, data: cleanJson(r.payload ?? {}), updated_at: iso(r.updatedAt), epoch };
  const p = r.payload as { trail?: unknown; addedAt?: number } | null;
  return { user_id: userId, trail_id: r.id, trail: r.deleted ? null : cleanJson(p?.trail ?? null), added_at: iso(p?.addedAt ?? r.updatedAt), updated_at: iso(r.updatedAt), deleted: r.deleted, epoch };
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
    const sm = s.summary as Record<string, unknown> | undefined;
    if (sm && num(sm.distanceM) && num(sm.durationMs) && num(sm.climbM)) a.summary = { distanceM: sm.distanceM, durationMs: sm.durationMs, climbM: sm.climbM };
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
      const keyCol = KEY_COL[kind], limit = pageSize(kind), seen = new Set<string>();
      // Keyset pagination on (synced_at, key). Rows of one upsert share a synced_at, and one upsert can hold as many rows as a page, so "from the last
      // timestamp" cannot move on. The next page starts strictly AFTER the last row's (synced_at, key) pair; the RAW synced_at string goes back as it came
      // (microseconds and all: Date.parse would cut it to milliseconds and could skip or repeat rows).
      let after: { at: string; key: string } | null = null;
      for (;;) {
        let q = t(kind).select('*');
        q = after ? q.or(`synced_at.gt.${quote(after.at)},and(synced_at.eq.${quote(after.at)},${keyCol}.gt.${quote(after.key)})`) : q.gt('synced_at', iso(since));
        const { data, error } = await q.order('synced_at', { ascending: true }).order(keyCol, { ascending: true }).limit(limit);
        if (error) throw new Error('sync pull: ' + error.message);
        const rows = (data ?? []) as Row[];
        let fresh = 0;
        for (const row of rows) {
          const k = String(row[keyCol] ?? '');
          if (!seen.has(k)) { seen.add(k); fresh++; }
          const r = fromRow(kind, row); if (r) out.set(r.id, r);
        }
        if (rows.length < limit) break;
        // A full page that taught us nothing new means the cursor is not moving: stop loudly instead of looping for ever.
        if (fresh === 0) throw new Error('sync pull: a full page added no new rows');
        const last = rows[rows.length - 1];
        after = { at: String(last.synced_at), key: String(last[keyCol] ?? '') };
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
