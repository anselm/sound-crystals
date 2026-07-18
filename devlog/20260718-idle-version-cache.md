# Sound Crystals — Strings That Die, Builds You Can See

**Devlog · 2026-07-18 · author: Claude (+ Anselm)**

Three fixes in one pass (v0.2.0), all from Anselm's phone-testing notes.

## 1. Finite sustain — crystals idle out like plucked strings

Latched crystals used to ring forever. Now the voice has a full ADSR:
attack → decay to a sustain shelf (`sustainLevel` × peak) → a *finite but
extended* sustain window → release. The grammar ties it to size: big low
crystals ring longest (`sustain` 18–40 s, `release` 2–5 s, both ∝ 1−pitchNorm),
like real resonators.

Two design points worth keeping:
- **The service owns the lifecycle.** When the sustain window ends,
  `services/sound.js` flips `sound.active = false` itself — the same single
  source of truth the interactions use, so everything downstream just follows.
- **Glow is now a function of the live envelope, not the toggle.** The service
  writes `sound.level` (actual gain node value) onto the component each tick;
  interaction maps it to `emissiveIntensity`/opacity. Crystals visibly fade as
  they die away, and `toggle()` shrank to one line with zero visual code.
  This incidentally softened the drone-saturation worry from the M0 review:
  the field now self-thins.

## 2. Version stamp

Bottom-right of the page: `v0.2.0 · 091afe5 · 2026-07-18T15:39Z`. App version
from `package.json`; build sha + time from `version.json`, which the deployer
writes into `/srv/site` after each sync (both fetched `cache: 'no-store'`).
Absent version.json = `dev`. "Which build am I looking at" is now answerable
from a phone.

## 3. Caching — the recurring one

Two separate cache bites in one day, both now recorded:
- **Server:** the Caddyfile copied from fish sent `max-age=3600` for JS — an
  hour of stale builds on an iterating experiment. Now `Cache-Control:
  no-cache` for everything: browsers revalidate each request, Caddy answers
  unchanged files with 304s, and the heavy deps (three, bus) come from CDNs
  with their own caching. Applied via re-run of `deploy/provision.sh`.
- **Harness:** our own verification scripts hit it too — the persistent
  Chromium profile served hour-old cached JS and "verified" a stale build
  (the ADSR check failed against prod while the deploy was in fact fine).
  Both scripts now set CDP `Network.setCacheDisabled` — a verifier must never
  read from cache. One more stale load may occur on devices that visited
  under the old header; after that, no-cache governs.

Verified on production, cache-disabled: version endpoint correct, idle-out
`{active:false, level:0}`, mobile tap `{active:true}`.
