# Sound Crystals — Initial Approach

**Devlog · 2026-07-16 · author: Anselm (+ Claude) · revised 2026-07-17 after review**
**Status:** design complete, pre-code. This document is meant to be handed to
another LLM (fable or otherwise) and be sufficient to build **Milestone 0** end
to end without further context.

---

## 1. The vision

A room-scale, walk-inside **field of giant sound crystals** — a shattered collection
of translucent geometric shards, each beautiful, colored, floating in a dark space.
Each crystal is a voice. Moving through the field, passing your hands (VR) or your
body/reticle (flat browser) through a crystal starts or stops its sound; you can
grab crystals and move them, and the sound moves with them in 3D. The whole field
is governed by an underlying **sound grammar** — a small policy that
deterministically maps each crystal's *size, shape, colour and placement* to
*pitch, timbre, filter and spatial position*, so the field reads as one coherent
instrument rather than noise. Same grammar, same seed → same field for everyone
(this is what makes it shareable and, later, multiplayer).

Because crystals **latch** (passing through toggles them), the field is an
instrument you *orchestrate by walking*: leave a chord ringing in one cluster,
cross the room, and wake another against it.

Two front-ends from one scene graph:
- **Flat mode (browser):** pointer-lock first-person "wander inside," body
  pass-through or reticle-click to toggle crystals. Runs anywhere, no headset.
  **This is Milestone 0.**
- **Immersive mode (WebXR):** Meta Quest and any WebXR headset; hand-joint or
  controller-ray intersection to toggle, pinch/grip to grab & move. **Milestone 1.**

Then **multiplayer** (Milestone 2): several people in the same field, seeing each
other's presence (head + hands) and hearing the same crystals toggle in real time.

---

## 2. Architecture: two declarative services over one bus

We reuse Anselm's standard **late-binding agent-manifest** architecture — the one
in `cloudreef-sim`: a tiny pub/sub bus, a manifest that is just a `load` array of
module URLs, and one file per concept in `agents/`. You add a feature by writing
one file and adding one string to the manifest. No static import graph, no build
step, native ES modules. Listeners register on the bus and observe declarative
blobs (entities, in an ECS pattern), updating their own state from them.

The defining design move of this project follows directly from that pattern:

> **Sound is a service, not an app feature.** We invent a new sound handler
> *similar to orbital-volume* — a declarative **`sound` service** that observes
> `sound` components on entities exactly the way orbital-volume observes `volume`
> components, and paints them into WebAudio instead of Three.js. Spatialized
> audio falls out of the same entity poses that drive the rendering.

So the runtime is **two peer services + pure data**:

| Service | Observes | Paints into |
|---|---|---|
| `orbital-volume` (extended, §7) | `entity.volume` | Three.js scene |
| **`sound` service** (new, §8 — `orbital-sound` candidate) | `entity.sound` | WebAudio graph |

A crystal is one entity carrying both components, derived from the same grammar
latents. The app itself (`agents/`) contains **no engine code** — only entities,
the generator, and small behaviors. When the sound service is stable it moves to
its own repo/package (`orbital-sound`), the same way volume did. (Alternative
considered and rejected: folding sound handlers *into* orbital-volume — that
would tangle a render library with audio; a sibling service keeps volume
render-only and lets either run without the other, including headless.)

### Bus lineage — read this before you code

There are **two generations** of the bus in the orbitalfoundation org. They are
the same idea; the API names differ. Do not mix them.

| | `orbital-sys` (older) | **`@orbitalfoundation/bus` (what we use)** |
|---|---|---|
| Repo | `orbital-sys` | `orbital-bus` (README: *"Descended from orbital-sys"*) |
| Boot | `import sys` then `sys({load:[...]})` | `import { createBus }` then `bus.resolve({load:[...]})` |
| Publish | `sys.resolve(blob)` | `bus.resolve(blob)` |
| Tick | hand-rolled `agents/time.js` `setTimeout` loop broadcasting `{time}` | built-in tick driver — but see §6: in this project the *display* drives the clock |
| Subscribe | branch on blob shape inside `resolve` | optional `resolve.filter = {key:true}` (matches **key presence**, not value) |
| Late binding | `manifest.anchor = import.meta.url` + relative paths | `inherits:'<spec>'` template + `{load:[...]}` (nested arrays recurse) |

`cloudreef-sim` uses `orbital-sys`. **We use `@orbitalfoundation/bus`** because the
thing we are extending — `orbital-volume` — targets it: `orbital-volume@2.2.0`
declares `"@orbitalfoundation/bus": "^2.0.0"` as its dependency, and the
networking stack (`orbital-server`) fans changes out on *the bus*.

**The mental model of the bus (identical in both):** one verb, `resolve(blob)`.
A blob *with* a `resolve` function is a **listener** (a system); a blob *without*
one is an **event** (or a data entity). Events are **not cloned** — listeners
mutate them in place and downstream listeners see the mutation. A listener that
returns a non-`undefined` value ends the chain (first-responder / query answer).
On registration a listener is invoked once with `{registered:true}` — its init
hook. Full spec: `orbital-bus/SPEC.md`; contract tests:
`orbital-bus/packages/bus/test/conformance.test.js`.

---

## 3. The stack (exact versions & sources)

Build-free ES modules resolved by an importmap. No bundler, no `npm install` for
runtime deps.

| Piece | Source | Role |
|---|---|---|
| `three` | `https://unpkg.com/three@0.148.0/build/three.module.js` | 3D. Pinned to 0.148 to match orbital-volume's peer range. |
| `three/addons/` | `https://unpkg.com/three@0.148.0/examples/jsm/` | `VRButton`, `XRControllerModelFactory`, `XRHandModelFactory`, `PointerLockControls`. |
| `@orbitalfoundation/bus` | `https://cdn.jsdelivr.net/npm/@orbitalfoundation/bus@2/index.js` | The bus + manifest loader. |
| `@orbitalfoundation/utils` | jsDelivr (dependency of the bus) | `mulberry32` seeded PRNG for the grammar. |
| `orbital-volume` | **local, extended** — see §7 | Declarative Three.js. We extend it (crystal geometry, XR, tick-driving, hand input) and push. |
| `sound` service | **this repo**, `services/sound.js` — see §8 | Declarative WebAudio. Extractable as `orbital-sound`. |
| `orbital-server` | `orbital-server` repo | M2 only: socket.io gateway + room fan-out for multiplayer. |

**Serving (dev):** run any static server at the **parent** dir
(`projects/2026/`) and open `sound-crystals/index.html` — that way the importmap
alias `"orbital-volume/": "../orbital-volume/"` reaches the sibling checkout and
edits to the library are live. (Or symlink it under `vendor/` and serve the repo
root.)
**Deploy:** exe.dev VM + Caddy container + on-VM autodeploy, exactly like `fish` /
`water-atlas` (see §11). Target URL: **`crystals.exe.xyz`** (name ≥5 chars; final
name TBD — `soundcrystals` also free). For deploy, either (a) **push + publish**
the extended `orbital-volume` to npm and pin a CDN version — the stated intent —
or (b) **vendor** a copy into `sound-crystals/vendor/orbital-volume/` as the
zero-friction fallback for the first deploy.

---

## 4. Repository layout

```
sound-crystals/
├── index.html                  # importmap + <script type=module src=index.js>
├── index.js                    # createBus(); bus.resolve({load:[ volume, sound, agents/all.js ]})
├── package.json                # type:module, dev script (serve), no runtime deps
├── services/
│   └── sound.js                # THE SOUND SERVICE (§8) — observes `sound` components
├── agents/
│   ├── all.js                  # THE MANIFEST — export const manifest = { load:[ ... ] }
│   ├── config.js               # globals: POLICY (room size, seed, grammar) — loaded first
│   ├── stage.js                # scene + camera + lights + fog entities (volume + sound.listener)
│   ├── field.js                # THE GRAMMAR: seeded generator → emits crystal entities
│   ├── interaction.js          # flat-mode: pointer-lock walk, pass-through & reticle toggling
│   │                           #   (M1 adds {xrinput} handling & grab here)
│   └── hud.js                  # DOM overlay: title, "click to enter" (gesture gate), help
├── vendor/                     # (fallback) vendored extended orbital-volume for deploy
├── deploy/                     # Caddyfile, provision.sh, deploy.sh, autodeploy.sh (from fish)
└── devlog/
    └── 20260716-initial-approach.md   # this file
```

Add a feature = new file in `agents/` + one line in `agents/all.js`. That single
edit is the whole point of the pattern. (v1 of this doc had `agents/audio.js` and
`agents/boot.js`; both are gone — audio became the `services/sound.js` peer
service, and the clock is driven by the display, §6, so nothing needs booting.)

---

## 5. The sound grammar (the heart)

The grammar is a pure function: **`(policy, seed, index) → crystal`**, where a
crystal carries *both* its visual component and its audio component derived from
the **same** latent parameters. Because it is a pure function of a shared `seed`,
every client generates a bit-identical field — no field data needs to cross the
network, only the seed.

### 5.1 Policy object (lives in `agents/config.js`)
```js
export const POLICY = {
  seed: 20260716,               // change → new field. Shared across clients (M2).
  count: 48,                    // number of crystals
  room: { x: 12, y: 6, z: 12 }, // metres; you wander inside this box
  clusters: 6,                  // the field "shatters" into this many chord-clusters
  // musical
  root: 220,                    // A3 in Hz
  scale: [0, 2, 4, 7, 9],       // major pentatonic (semitone offsets) — safe, always consonant
  octaves: 3,                   // pitch spread across this many octaves
  // one cluster ≈ one chord: members drawn from a rotating subset of the scale
  // visual palette is DERIVED from pitch (see mapping) so colour == pitch-class
};
```

### 5.2 The mapping (deterministic; the visuals *are* the audio, read off the same latents)

| Latent (from seed) | Visual | Audio |
|---|---|---|
| **pitch** (scale degree × octave) | **size** — bigger crystal = lower note (inverse, like real resonators). `scale = lerp(0.4, 1.8m, 1 - pitchNorm)` | oscillator **frequency** |
| **pitch-class** (note within octave) | **hue** — pitch-class → colour wheel, so same note = same colour family (legible) | (correlates; not independent) |
| **facet count / shape** (tetra=4 … octa=8 … icosa=20) | **geometry** — more facets = more crystalline | **timbre**: facet count → waveform brightness / number of additive harmonics (few→triangle/soft, many→saw/bright) |
| **octave band** | crystal **lightness/glassiness** (higher = brighter) | filter **cutoff** (higher octave = brighter filter) |
| **cluster id** | spatial **placement** — members of a cluster are packed together (shatter shards) | **chord membership**: a cluster's members share a consonant chord |
| **3D position** | where it sits in the room | **spatial pan** via `PannerNode` (HRTF); position of the sounding source in your ears |
| **saturation / amplitude latent** | colour saturation | voice **gain** ceiling |
| **`sound.active` (runtime state)** | emissive glow — a sounding crystal shines | the voice is ringing |

**Placement / "shatter":** pick `clusters` seed points in the room (Poisson-ish via
rejection on the seeded PRNG). Assign each crystal to a cluster; scatter it around
its cluster centre with jitter. Give each cluster a **chord** (root + a couple of
scale degrees) so nearby crystals are harmonically related and distant clusters
contrast — the field has musical geography.

**Determinism:** use a seeded PRNG — `mulberry32` from `@orbitalfoundation/utils`
(already a dependency of the bus), or inline the 5-line implementation. Never use
`Math.random` in the generator — it would desync clients in M2.

### 5.3 The crystal entity (what `field.js` emits onto the bus)
```js
{
  id: `crystal-${i}`,
  crystal: { i, cluster, note },                        // identity tag + musical metadata
  volume: {                                             // consumed by orbital-volume
    geometry: 'crystal',                                // NEW type we add to prim.js (§7)
    facets: 20,                                          // 4|8|20 → shape family
    jitter: 0.15,                                        // vertex displacement → "shattered" look
    seed: hash(seed, i),                                 // per-crystal displacement seed
    material: { color:'#66ccff', transparent:true, opacity:0.6, emissive:'#112244' },
    pose: { position:[x,y,z], rotation:[rx,ry,rz], scale:[s,s,s] },
  },
  sound: {                                              // consumed by the sound service (§8)
    synth: 'voice',                                      // handler selector (like volume.geometry)
    freq, waveform:'sawtooth', harmonics:6,
    cutoff:1400, q:3, gain:0.15,
    attack:0.25, release:0.4,
    active:false,                                        // THE toggle. One source of truth.
  },
}
```
**One source of truth for on/off:** `sound.active`. Interaction flips it; the
sound service ramps the voice toward it; the visual glow reads it. (v1 had a
duplicated `crystal.active`/`sound.active` pair — dropped.)

---

## 6. Runtime model (how it all moves)

1. `index.js` creates the bus and resolves
   `{load:['orbital-volume/volume.js','here/services/sound.js','here/agents/all.js']}`.
   Importmap-aliased specs (`here/`, `orbital-volume/`) avoid relative-base
   ambiguity in the loader. **Verify nested-manifest recursion early** (§12); the
   fallback is one flat `load` array in `index.js`.
2. The **volume service** registers, installs itself as `bus.volume`; the **sound
   service** registers, installs itself as `bus.sound`. Order: volume first
   (sound reads poses that volume binds).
3. `config.js` exposes `POLICY` (via `globalThis.SC`, cloudreef-style).
4. `stage.js` resolves scene/camera/light entities. The scene entity carries
   `volume.xr: true` (M1) and the camera entity carries `sound: {listener:true}`.
5. `field.js`, on its `{registered}` init, runs the generator and
   `bus.resolve(crystal)` per crystal → volume builds meshes, sound registers
   voices (lazily — no audio nodes until first activation).
6. **The display drives the clock.** The extended scene handler (§7.3) calls
   `renderer.setAnimationLoop(...)` and emits `{tick,t,dt}` on the bus each
   frame. `setAnimationLoop` is identical to `requestAnimationFrame` when no XR
   session is active and is *required* during one — so flat and immersive modes
   share **one** tick path, and the v1 "don't double-drive the clock" hazard
   disappears. Nothing in this app calls `{run:'realtime'}`.
7. Per tick: `interaction.js` moves the player and tests intersections, flipping
   `sound.active`; the sound service ramps gains, updates panner positions from
   `entity.volume.pose.position` (a live `THREE.Vector3` after poseBind — mutate
   it and both mesh and panner follow, which is what makes grab-and-move free),
   and updates `ctx.listener` from the listener entity; volume repaints.

**Subscription idiom (@orbitalfoundation/bus):** tick-only systems declare
`resolve.filter = { tick:true }`; services that must catch entity arrival *and*
ticks use a no-filter listener branching on blob shape:
```js
function resolve(blob, bus){
  if (blob.sound && !blob.tick) return adopt(blob)   // an entity with a sound component arrived
  if (blob.tick)                return update(blob)  // per-frame
}
```

---

## 7. Extending orbital-volume (the "extend & push")

orbital-volume today is **desktop-only**: no crystal geometry, no XR, no input
publishing. Confirmed by reading the code — `handlers/scene.js` builds a plain
`WebGLRenderer`, never touches `renderer.xr`, renders via
`renderer.render(scene,camera)` per bus tick; `handlers/camera.js` wires
OrbitControls only (`nocontrols:true` opts out); `handlers/prim.js` supports only
`cube/box | sphere | cylinder | plane`. Four patches, in shipping order:

### 7.1 Crystal geometry — **M0** (smallest change, do first)
In `handlers/prim.js`, new cases in the `switch(volume.geometry)`:
```js
case 'crystal': {
  const facets = volume.facets || 20;
  geometry = facets <= 4 ? new THREE.TetrahedronGeometry(1)
           : facets <= 8 ? new THREE.OctahedronGeometry(1)
           :               new THREE.IcosahedronGeometry(1, 0);
  if (volume.jitter) displaceVertices(geometry, volume.jitter, volume.seed || 1);
  geometry.computeVertexNormals();
  break;
}
```
`displaceVertices` (small helper in `three-helper.js`) nudges each vertex along
its normal by a **seeded** random amount — the shard look, reproducible across
clients. This alone unblocks the M0 visual. (Shortcut if ever blocked: emit
`geometry:'sphere'` from the generator and swap later — but this case is trivial.)

### 7.2 First-person controls — **M0**, *no library change*
Set `nocontrols:true` on the camera entity; `agents/interaction.js` uses
`three/addons/controls/PointerLockControls.js` + WASD directly. Zero surgery.

### 7.3 XR + display-driven ticks — **M1 core** (with the tick part landing in M0)
In `handlers/scene.js` after renderer construction:
```js
if (volume.xr) {
  renderer.xr.enabled = true;
  const { VRButton } = await import('three/addons/webxr/VRButton.js');
  document.body.appendChild(VRButton.createButton(renderer));
}
// display-driven clock — replaces the bus rAF realtime loop for this surface
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  bus.resolve({ tick:true, t: now/1000, dt: (now-last)/1000 });
  last = now;
});
```
Gate the tick-driving on an opt-in (`volume.clock: true`) so existing
orbital-volume apps that use `{run:'realtime'}` are untouched — that makes this a
clean upstream PR: *"a volume surface can own the clock when it owns a realtime
display."*

### 7.4 Hand & controller input — **M1** (new `handlers/xr-input.js`)
On init, grab `renderer.xr.getController(0/1)` / `getHand(0/1)`, attach
`XRControllerModelFactory` / `XRHandModelFactory` models, and **publish input onto
the bus** so apps stay renderer-agnostic:
```js
bus.resolve({ xrinput:{ hand:'left', joints:{ indexTip:[x,y,z] }, pinch:true }})
bus.resolve({ xrinput:{ controller:0, ray:{origin,dir}, select:true, squeeze:false }})
```
`interaction.js` treats a hand index-tip or controller ray exactly like the flat
reticle/body test → flips `sound.active`; pinch/squeeze-hold grabs: write the
crystal's `pose.position` from the hand each frame — mesh and panner both follow
the live vector (§6.7).

**While in there:** add a clean accessor `bus.volume.surface()` →
`{renderer, scene, camera}` so interaction and sound never reach into
`_surfaces[0]` internals.

---

## 8. The sound service (`services/sound.js` — `orbital-sound` candidate)

The mirror image of orbital-volume, ~150 lines. Observes `sound` components;
maintains a WebAudio graph; no app knowledge. Raw WebAudio, zero deps.

**Handler table keyed on the component** (parallel to volume's `geometry`):

| `sound.…` | Handler | Builds |
|---|---|---|
| `synth:'voice'` | voice | the per-crystal chain below |
| `listener:true` | listener | binds `ctx.listener` pose to this entity (the camera/head) |
| `master:true` | master | `DynamicsCompressor → destination` (+ optional convolver reverb) |

**Per-voice chain:**
```
Oscillator(s) → Gain(envelope) → BiquadFilter(lowpass) → PannerNode(HRTF, @pose) → master
```
- **Envelope / no clicks:** service ramps gain toward `active ? gain : 0` with
  `setTargetAtTime` (attack ~250 ms, release ~400 ms). Never hard-set gain.
- **Timbre:** start single-oscillator (`waveform` from facet count); add
  `harmonics` additive partials at `freq × n`, gain `1/n`, only if it sounds thin.
- **Spatial:** panner position ← `entity.volume.pose.position` each tick (falls
  back to `entity.sound.position` so the service runs without volume present);
  `ctx.listener` ← the `listener:true` entity's world pose. In XR the head *is*
  the camera, so the same listener entity works in both modes (verify world pose
  via `camera.matrixWorld`, §12).
- **Budget — panners are the real cost, not oscillators.** Voices are created
  lazily on first activation and parked (gain 0, osc running) when off, torn down
  after ~30 s parked. Cap concurrent **HRTF** voices (~16); beyond the cap new
  voices use `panningModel:'equalpower'` (cheap) — nearest voices get HRTF.
- **Autoplay policy:** the context starts suspended; the HUD's "click to enter"
  gesture calls `ctx.resume()` *and* requests pointer-lock — one gate, both
  unlocked. Also resume on first XR `select` (M1).
- **Shimmer (backlog):** slow LFO (0.1–0.4 Hz) on gain / few cents detune so a
  ringing crystal breathes.
- **Lifecycle:** `entity.obliterate` tears the voice down (mirror volume's
  contract).

---

## 9. Interaction model

**The verb is *toggle*, edge-triggered.** Passing through a crystal flips it and
it *stays* flipped — that's what lets you leave chords ringing and orchestrate
the field by moving through it (§1). Continuous hover-to-sound was considered and
rejected: it can never leave sound behind you. Debounce: after a flip, that
crystal is refractory ~400 ms (or until you exit its bounds) so boundary jitter
can't flutter it.

**Flat (M0):**
- HUD overlay → click → `PointerLockControls.lock()` + `audioCtx.resume()`.
- Mouse = look; WASD = walk on XZ (clamped inside the room box; eye height ~1.6 m).
- **Body pass-through:** each tick, sphere-test the camera position (~0.4 m
  radius) against crystal bounds — walking through a crystal toggles it. This is
  the flat-mode analog of a hand-sweep.
- **Reticle click:** raycast from screen centre; click toggles the aimed crystal
  within reach (~3 m) — precision at a distance without walking.

**Immersive (M1):** identical logic fed by `{xrinput}` — index-tip sphere or
controller ray replaces camera-sphere/reticle; pinch/squeeze-hold = grab & move
(write `pose.position`; sound follows free). Flat-mode grab (click-drag) goes to
the backlog rather than M0.

---

## 10. Multiplayer (M2) — plan, not built in M0

Designed network-ready from day one:
- **The field is deterministic from `seed`** — no geometry crosses the wire. The
  room fixes `POLICY.seed`; every client regenerates the identical field. New
  seed = new shared room.
- **What syncs:** (a) `sound.active` flips, (b) crystal `pose` when grabbed,
  (c) ephemeral **presence** (head + hand transforms) for avatars.

**Transport — `orbital-server`:** a thin socket.io allowlist gateway + room
fan-out over an `orbital-filespace`; successful writes announce
`{filespace:{changed}}` **on the bus**, which the server broadcasts to the room.
So the bridge is bus-native: `agents/net.js` (one file, per the pattern) turns
local toggles/moves into filespace commands and applies inbound changes back onto
local entities. Durable state (active flags, moved poses) lives at filespace
paths like `/{room}/crystals/{i}` — late joiners refetch. Presence at 72 Hz must
**not** hit durable storage; `orbital-server`'s README flags per-connection
identity binding / presence fan-out as "not here yet," so presence needs a small
server addition or a volatile side-channel — **M2 spike, budget it**. Remote
avatars are just more entities (volume components) that `net.js` emits and
updates.

Related pieces: `orbital-filespace` (path-addressed shared state),
`orbital-streams` (room message log), `orbital-store` (file / mongo / memory
backends). All bus listeners.

---

## 11. Milestones

- **M0 — Flat, single-player, deployed.** Extended orbital-volume (crystal
  geometry + display-driven clock), `services/sound.js`, grammar generator,
  pointer-lock walk, pass-through & reticle toggling, HUD gesture gate. Ship to
  `crystals.exe.xyz`. *Prove the idea — above all, that the field **sounds like a
  place** — before going deep.*
- **M1 — WebXR.** `volume.xr` + `handlers/xr-input.js` (hands/controllers →
  `{xrinput}`). Hand-through-crystal toggle, pinch grab & move. Test on Quest.
- **M2 — Multiplayer.** `orbital-server` room, seed-shared field, synced toggles/
  moves, presence avatars. Includes the presence-channel spike.
- **Backlog:** additive partials & per-facet harmonic tuning, convolver reverb,
  LFO shimmer, cluster chord voicing passes, refraction visuals
  (`MeshPhysicalMaterial.transmission` — needs three ≥0.150, check volume's peer
  range first), bloom, flat-mode grab, mobile touch, accessibility.

### Deploy (mirror `fish` / `water-atlas`)
Static site → exe.dev VM → Caddy container (`-p 8000:80`, serves `/srv/site`) →
on-VM systemd autodeploy polling GitHub `main`. Copy `deploy/` from
`parametric/fish`, rename VM/URL. Control-plane over SSH
(`ssh exe.dev new --name crystals`), then `provision.sh` + `deploy.sh`, then the
one manual `share set-public` step. Repo:
`github.com/orbitalfoundation/sound-crystals`.

---

## 12. Open questions / verify early

1. **Nested-manifest recursion in `@orbitalfoundation/bus`** — confirm
   `agents/all.js` exporting `{load:[...]}` recurses and resolves relative specs
   (orbital-sys needed `anchor: import.meta.url`; verify the equivalent).
   Fallback: flat `load` array in `index.js`.
2. **Upstream appetite for `volume.clock`** — the display-driven tick (§7.3) is
   the one patch that changes orbital-volume's *runtime contract* rather than
   adding a handler; gate it opt-in and confirm it doesn't disturb existing apps.
3. **Listener pose in XR** — `ctx.listener` must track the *world* head pose
   (`camera.matrixWorld` decompose, or `renderer.xr.getCamera()`), including
   rotation, or spatialization breaks when you turn your head.
4. **Grammar taste** — pentatonic + per-cluster chords is the safe default;
   audition and tune `root/scale/octaves/count/clusters`. This is where the piece
   lives or dies. Budget listening time, not just code time.
5. **Voice budget in practice** — measure the HRTF cap on a mid laptop and on
   Quest's browser; tune the cap and park-teardown timings.
6. **orbital-volume delivery for deploy** — publish-to-npm vs vendor for the
   first ship (§3); start vendored if publishing blocks the deploy.

---

## 13. References (all local checkouts under `/home/anselm/projects/2026/`)

- **Bus:** `orbital-bus/SPEC.md`, `orbital-bus/PRIMER.md`,
  `orbital-bus/packages/bus/{src/bus.js,src/load.js,src/tick.js}`,
  `orbital-bus/packages/bus/test/conformance.test.js`.
- **3D:** `orbital-volume/{volume.js, index.html, demo-scene.js}`,
  `orbital-volume/handlers/{scene.js, camera.js, prim.js, three-helper.js, light.js}`.
- **Pattern exemplar:** `cloudreef-sim/{index.html, index.js, agents/all.js,
  agents/time.js, agents/emitter.js, agents/terrain.js}`.
- **Networking:** `orbital-server/README.md`, `orbital-filespace/`, `orbital-streams/`.
- **Deploy pattern:** `parametric/fish/deploy/*` and `parametric/fish/deploy/DEPLOYMENT.md`;
  live sibling `water-atlas` (same autodeploy).

---

*Next action once this revision is approved: scaffold M0 — `index.html`,
`index.js`, `services/sound.js`, `agents/{all,config,stage,field,interaction,hud}.js`,
the `crystal` geometry + `volume.clock` patches to orbital-volume, local serve —
then iterate on the grammar until the field sounds like a place.*
