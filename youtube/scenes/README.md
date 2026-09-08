# scenes/ — snapshots from the console capture rig

These are copies. The rig itself lives at `~/dev/console-shot-rig` and is
**not under version control**, so anything fixed there is one `rm` away from
gone. That is the only reason these files are here.

`~/dev/console-shot-rig` is canonical. Edit there, record there, then copy the
changed file back into this directory so the change survives.

| File | Why it is worth keeping |
|---|---|
| `console-tour.mjs` | The console tour scene, including the beats that were deliberately cut and why. |
| `record-console.mjs` | Carries the masking fix. |

## The masking fix, in short

Console recordings put a live workspace on screen, and two separate leaks got
past a "looks fine" review:

1. An **operator email** was published on the marketing site for weeks. The
   original mask did a single text-node sweep; React re-rendered the header
   right after and put the address back. The mask is now a `MutationObserver`
   with a re-entrancy guard, so it re-masks on every DOM mutation.
2. An **`apikey:<uuid>`** identity on the Approvals card was about to go up on
   YouTube. Masking emails alone was never enough — the mask now also covers
   UUIDs and `sk_`/`acp_`-shaped tokens, keeping the last four characters so
   the UI still reads correctly.

Masking also **fails loud**. A client-side navigation can detach the frame
mid-call; that is retried. Anything that survives the retry aborts the
recording rather than continuing unmasked, because a silent failure here is
indistinguishable from success until it is public.

None of this substitutes for looking. Before publishing any console
recording, read real frames at native resolution and check the identity
column and the session meta line — and check the free text on screen, which
the mask has no opinion about. The tour's Policies beat is cut for exactly
that reason; see the comment in `console-tour.mjs`.
