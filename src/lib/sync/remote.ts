// The server side of sync: maps records to rows in schema ridgeline. RLS limits every call to the signed-in user's own rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanActivity } from '../backup';
import type { Activity } from '../store';
import { activityClimb } from '../badges';
import { trackDistance } from '../tracker';
import { APP_DATA_SCHEMA } from '../accounts/config';
import type { Remote } from './engine';
import type { Kind, SyncRec } from './merge';
import { trimTrack } from './trim';

const TABLE: Record<Kind, string> = { shortlist: 'shortlist', saved: 'saved', activities: 'activities', settings: 'settings' };
const PAGE = 500, CHUNK = 25;
const iso = (ms: number) => new Date(ms).toISOString();
type Row = Record<string, unknown>;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Hike fields that go in `stats`. The route is separate (`track`). Never add body or health fields here.
 * `summary` (distance, time, climb) lets another phone list the hike when the route is not uploaded.
 * The `track` column is only sent when this phone actually holds a route to upload: with "phone only" on, or on a phone that
 * only has the summary, the column is left out so an upsert never blanks a route that is already on the server.
 */
export function activityToRow(userId: string, r: SyncRec, keepTracksLocal: boolean): Row {
  if (r.deleted || !r.payload) return { user_id: userId, id: r.id, started_at: iso(0), stats: {}, track: null, updated_at: iso(r.updatedAt), deleted: true };
  const a = r.payload as Activity;
  const { id, trailId, startedAt, points, updatedAt: _u, summary: _s, ...rest } = a;
  void id; void _u; void _s;
  const stats = { ...rest, summary: points.length >= 2 ? { distanceM: trackDistance(points), durationMs: (a.endedAt ?? startedAt) - startedAt, climbM: activityClimb(a, a.snapshot).m } : a.summary };
  const row: Row = { user_id: userId, id: a.id, trail_id: trailId ?? null, started_at: iso(startedAt), stats, updated_at: iso(r.updatedAt), deleted: false };
  if (!keepTracksLocal && points.length >= 2) row.track = trimTrack(points); // first and last 200 m removed; null when nothing is left
  return row;
}

export function toRow(userId: string, r: SyncRec, keepTracksLocal: boolean): Row {
  if (r.kind === 'activities') return activityToRow(userId, r, keepTracksLocal);
  if (r.kind === 'settings') return { user_id: userId, data: r.payload ?? {}, updated_at: iso(r.updatedAt) };
  const p = r.payload as { trail?: unknown; addedAt?: number } | null;
  return { user_id: userId, trail_id: r.id, trail: r.deleted ? null : p?.trail ?? null, added_at: iso(p?.addedAt ?? r.updatedAt), updated_at: iso(r.updatedAt), deleted: r.deleted };
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

export function supabaseRemote(c: SupabaseClient, userId: string, keepTracksLocal: () => boolean): Remote {
  const t = (k: Kind) => c.schema(APP_DATA_SCHEMA).from(TABLE[k]);
  return {
    async pull(kind, since) {
      const out = new Map<string, SyncRec>();
      let from = since, first = true;
      for (;;) {
        // Rows of one upsert share a synced_at, so later pages start AT the last timestamp (>=) and de-duplicate.
        const q = t(kind).select('*');
        const { data, error } = await (first ? q.gt('synced_at', iso(from)) : q.gte('synced_at', iso(from))).order('synced_at', { ascending: true }).limit(PAGE);
        if (error) throw new Error('sync pull: ' + error.message);
        const rows = (data ?? []) as Row[];
        for (const row of rows) { const r = fromRow(kind, row); if (r) out.set(r.id, r); }
        if (rows.length < PAGE) break;
        first = false;
        from = Date.parse(String(rows[rows.length - 1].synced_at));
      }
      return [...out.values()];
    },
    async push(kind, recs) {
      const conflict = kind === 'settings' ? 'user_id' : kind === 'activities' ? 'user_id,id' : 'user_id,trail_id';
      for (let i = 0; i < recs.length; i += CHUNK) {
        const rows = recs.slice(i, i + CHUNK).map((r) => toRow(userId, r, keepTracksLocal()));
        // One request per set of columns: PostgREST fills a missing column with null on conflict, which would blank a stored route.
        const groups = new Map<string, Row[]>();
        for (const row of rows) { const sig = Object.keys(row).sort().join(','); groups.set(sig, [...(groups.get(sig) ?? []), row]); }
        for (const g of groups.values()) {
          const { error } = await t(kind).upsert(g, { onConflict: conflict });
          if (error) throw new Error('sync push: ' + error.message);
        }
      }
    },
  };
}
