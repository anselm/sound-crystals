# Orbital Volume

See a demo at https://orbitalfoundation.github.io/orbital-volume/

## About

A 3d helper service

- provides a declarative shim on top of https://threejs.org
- uses a data driven approach where it observes events and reacts to them on top of [`@orbitalfoundation/bus`](https://github.com/orbitalfoundation/orbital-bus) (the maintained successor to orbital-sys)
- provides basic support for 3d scenes, cameras, lights, 3d model loading
- provides support for loading rigged human animated models with visemes using RPM, VRM, Reallusion
- streams real-world terrain (elevation + satellite tiles) as a `terrain` volume
- renders whole fields of instanced, wind-animated vegetation as a `vegetation` volume

## Running the demo

Build-free ES modules — serve the folder and open `index.html`: `npx serve .`
Entry point is `demo-scene.js`; `npm run smoke` runs a Node check of the bus wiring.
Revision notes live in [`devlog/`](devlog).

There is a second demo at `terrain.html` (entry `demo-terrain.js`) showing the
2.1 terrain + vegetation handlers: a satellite-draped Grand Canyon heightfield
planted with a few thousand growing, swaying bamboo culms in two draw calls.

## New in 2.2: lines, light shadows, static entities

`geometry: 'line'` — a polyline in world space: `{ points: [[x,y,z],…],
material: { color, opacity, dashed }, rev: 0 }`. Mutate `points` and bump
`rev` to rebuild; fewer than two points hides the node.

Shadow casting on lights: `volume.shadow = true | { size, extent, near, far }`
(same shape as the scene handler's `sun`), plus `volume.target: [x,y,z]` for
directional/spot lights. Prim meshes now cast and receive shadows by default
(opt out with `shadow: false`) — a no-op until a shadow-casting light exists.

`volume.static = true` — build the entity once and skip it on tick revisits,
a large win for scenes with many immobile parts. Live-bound pose mutation
still works; explicit `{ volume }` deltas and `obliterate` still reach it.

## New in 2.1: terrain, vegetation, atmosphere

`geometry: 'terrain'` — heightfield terrain from raw elevation grids or
fetched by lat/lon bounds from public tile services (AWS Terrarium elevation,
ArcGIS World Imagery drape by default; see
`handlers/load-helpers/terrain-tiles.js`). After building, the handler
publishes `terrain.sample(x,z)` (ground height at node-local coords) and
`terrain.minElev/maxElev` back onto the component so other systems can plant
things on the surface. Also registered under the alias `geometry: 'dem'`.

`geometry: 'vegetation'` — an entire field of stalk-form plants (bamboo,
reeds, saplings) rendered as two instanced draw calls: tapered node-ringed
stalks plus alpha-tested painted leaf crowns with GPU wind and proper shadow
casting. Declare `vegetation.plants = [{xyz, height, radius, color, tilt}]`,
mutate the array in place, and set `vegetation.dirty = true` to upload
changes — growth animation never rebuilds geometry. Thousands of animated
plants cost roughly the same as two meshes.

Scene atmosphere options on `geometry: 'scene'` volumes: `sky` (gradient
background), `fog {color,near,far}`, `hemisphere {sky,ground,intensity}`,
`sun {color,intensity,position,shadow}` for a shadow-casting key light,
`exposure`, and `antialias` (defaults on with `prettier`). All additive and
backwards compatible.

This comes out of earlier efforts which are still visible at:

- https://github.com/anselm/blox
- https://github.com/anselm/blox2
- https://github.com/anselm/blox3

## Design Tensions to resolve still:

This service is experimental, and is testing ways to decouple declarations from code. The philosophy is generally to be reactive, where the programmer focuses just on declaring state the way they want.

This service is built on [`@orbitalfoundation/bus`](https://github.com/orbitalfoundation/orbital-bus) (the successor to orbital-sys), which provides manifests (discussed below) and decouples services. Some tensions below now have positions in the bus's [SPEC](https://github.com/orbitalfoundation/orbital-bus/blob/main/SPEC.md) (identity via `id`, first-responder queries, live uncloned state). The rest, still being explored:

- UUIDs. It's highly convenient to have uuids on objects. It's arguable that orbital-sys should inject these even. There are some hacks here, I generate a uuid if needed, but this still needs a more aggressive study. UUDS also arguably should be non collidant and global, even over networks, perhaps with a formal path naming scheme.

- Server/Client. Volume does provide 3d rendering on the client, but server side also needs some of the services here. Right now each file has to do a bit of work to detect if it is client or server.

- Queries. The pub/sub architecture does allow global event handlers to observe most activity, and this is a way to register, or build up a database, of 3d related objects for later queries, but it puts some burden on volume to do this work. Volume does need to do spatial indexing and navigation (see the sparse voxel octree) but it is still arguable that there could be a separate dedicated 3d spatial indexing service unrelated to volume. Arguably a separate database could be used.

- Binding. There are process memory isolation boundaries being broken by volume. Right now I bind properties such as position and orientation into passed objects. Should the Volume service be treated as a shared memory concept? Conceptually individual agents could be process isolated but Volume could effectively be a kind of kernel service.

- Authoritative instances. Right now I will declare a scene element - such as a camera - and pass it to sys, but then make changes to that scene element - leveraging an idea of binding (see above). The message passing scheme doesn't inherently have a concept of an authoritative instance of a state object. Right now we allow back-writing into objects, as if they were the real or canonical instance of state. But a caller could pass an arbitrary datagram with some state in it, and a uuid, and want to apply that as a change overtop of an existing object. There's no reason why any given datagram is authoritative and that needs study. A flag could be used, or perhaps everybody should always pass datagrams rather than ever binding to some kind of authoritative shared state instance.

- Updates/Events. For Volume events performance is critical. It's debatable if volume objects should receive direct messages or not - and how that is rationalized in a thread isolation design.

## Notation

Typically objects are declared as an 'entity' and decorated with a 'volume' component that describes one 3d representation associated with the entity in general. See demo-scene.js for an example of this.

I haven't documented the notation specifically here yet - you will have to review volume.js itself or look at examples.

#  Understanding Avatars, rigging, art pipelines, tools and resources

While most of this library is just a shim around threejs, there is some specific support for loading 3d animatable models. RPMs, VRMS and Reallusion rigs can be loaded.

## Avatars in general:

* Ready Player Me (RPM) is an excellent source for custom avatars with permissive licensing
* RPM supports exactly what we want for face animation - RPM GLB assets work "as is" with no changes at all; don"t even have to use blender.
* Character Creator 4 (CC4) can also be used although licensing can be problematic depending on how you use it; use blender to convert to FBX to GLB
* Reallusion and CC4 also provides avatars although licensing is problematic in some cases depending on your raw sources
* Metahuman has licensing issues that preclude its use
* There"s an emerging set of machine learning driven avatar solutions that may help soon for creating unencumbered avatar assets
* Different avatar sources use different naming for bones and shapes often in arbitrary and annoying ways that require renaming prior to use
* See https://www.youtube.com/watch?v=vjL4g8oYj7k for an example of where the industry is going for machine learning based solutions circa 2024

## Shape Keys, Visemes

* Can load shape keys / blend shapes / morph targets (different tools use different words).
* Internally we _only_ support Oculus and ARKit facial morph targets.
* See: https://docs.readyplayer.me/ready-player-me/api-reference/avatars/morph-targets/oculus-ovr-libsync
* See: https://docs.readyplayer.me/ready-player-me/api-reference/avatars/morph-targets/apple-arkit

## Creating avatars

* You can use Ready Player Me to create avatars - be certain to download ARKit and Oculus Viseme targets:

* See: https://docs.readyplayer.me/ready-player-me/api-reference/rest-api/avatars/get-3d-avatars
* Example: https://models.readyplayer.me/664956c743dbd726eefeb99b.glb?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png

## GLB, FBX, Quirks

* GLTF/GLB the preferred format that avatars can be specified in (Graphics Library Transmission Format); Blender supports it.
* Note there"s an annoying industry split between T pose avatars and A pose avatars - you may have issues if your avatar is in A pose.
* Mixamo can magically auto-rig avatars into a t-pose if you send an FBX and then apply a t-pose and then export again.
* Blender is useful but there are a ton of small quirks to be aware of:
- Sometimes textures are not opaque and this looks weird - you have to select the meshes then the materials and mark them as opaque / no alpha.
- Weirdly Mixamo FBX animations don't play well in 3js - I tend to re-export them as glb animations with no skin via blender.
- Sometimes Mixamo cannot understand texture paths; if you export from Mixamo with a skin you should be able to see the skin in Blender.

## VRMS specifically

* Some developers like VRM for performance reasons for scenarios with many avatars.
* This engine detects and supports VRM models that have the correct facial targets.
* In this folder you should see a file called 'blender-puppet-rpm-to-vrm.py' which can be used to decorate VRM rigs with the RPM facial targets. This can be pasted into the blender scripting interface and run as is on a loaded VRM puppet if that VRM puppet arrives from a CC4 or Reallusion pipeline. - Otherwise you'll have to figure out some way to define the correct facial targets yourself (possibly by modifying this script or painfully remapping each desired shape key by hand in Blender - which may take hours).

* For more commentary on VRM in general see:

https://hackmd.io/@XR/avatars
https://vrm-addon-for-blender.info/en/
https://vrm.dev/en/univrm/blendshape/univrm_blendshape/
https://vrm-addon-for-blender.info/en/scripting-api/
https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md

* body performances - other resources

* https://openhuman-ai.github.io/awesome-gesture_generation/
* https://medium.com/human-centered-ai/chi24-preprint-collection-hci-ai-0caac4b0b798
* https://www.youtube.com/watch?v=LNidsMesxSE ... a detailed video on the state of the art in video-game animation blending
* https://cascadeur.com ... a commercial animation blending system
* https://assetstore.unity.com/packages/tools/animation/animation-designer-210513 ... an embeddable animation blending system




