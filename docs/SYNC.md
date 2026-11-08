# How sync works, and what it does not protect against

Ridgeline keeps its data on the phone (IndexedDB) and, when a person signs in, mirrors it to their account (schema `ridgeline`, owner-only RLS).

- **Last write wins** per record, on `updatedAt`, which is the clock of the phone that made the edit. A deletion leaves a tombstone so it syncs too.
- **What to upload** is decided by a separate local edit stamp (a saved, strictly rising counter), never by server times.
- **Deleting your Ridgeline data** raises `profiles.data_epoch` on the server; every write carries the epoch the phone last saw, and the database refuses an older one. A phone that sees a newer epoch clears its account copy.

## Known limits

- **Clock skew.** Last write wins trusts each phone's clock. The server stops a time in the future (it is clamped to the server's "now"), but it cannot know a clock is wrong:
  - a phone whose clock is far **behind** will lose most conflicts, so its edits can be overwritten by an older edit from a phone with a correct clock;
  - a phone whose clock is **ahead** (but not in the future by the time the server sees it) will win conflicts it should lose.
  Edits to different records never conflict. Two phones editing the same hike or setting within seconds of each other is the case to expect surprises in.
- **Several phones during a delete.** Other phones that stay signed in are told on their next sync (the epoch) and clear their copy, but a phone that is offline keeps its copy until it reconnects.
- **Routes.** The first and last 200 m (straight line from the start and end point) never leave the phone. A route over about 5,000 points is thinned before upload. A route taken from the server is never trimmed or uploaded again.
