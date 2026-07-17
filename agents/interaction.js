// interaction — flat-mode input: pointer-lock walk, body pass-through and reticle
// toggling. M1 adds {xrinput} handling here; the toggle logic is deliberately
// "a position and a radius", not "the player", so a future path-following mover
// reuses it verbatim.

import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'

const uuid = 'sound-crystals/interaction'

const S = {
	ready: false,
	controls: null,
	camera: null,
	raycaster: null,
	keys: {},
	inside: new Set(),   // crystals the body is currently within (exit-bounds refractory)
}

// the verb is TOGGLE, edge-triggered: flipped crystals STAY flipped — that is what
// lets you leave chords ringing and orchestrate the field by walking (devlog §9)
function toggle(entity) {
	const sound = entity.sound
	sound.active = !sound.active
	const node = entity.volume.node
	if(node && node.material) {
		node.material.emissive.setStyle(sound.active ? entity.crystal.glow : entity.crystal.dim)
		node.material.opacity = sound.active ? 0.85 : 0.5
	}
}

function init(bus) {
	const surface = bus.volume?.surface?.()
	if(!surface || !surface.renderer || !surface.camera) return false
	const THREE = globalThis.THREE

	S.camera = surface.camera
	S.controls = new PointerLockControls(S.camera, document.body)
	S.controls.addEventListener('lock',   () => { bus.resolve({ locked: true }) })
	S.controls.addEventListener('unlock', () => { bus.resolve({ locked: false }) })
	S.raycaster = new THREE.Raycaster()

	document.addEventListener('keydown', e => S.keys[e.code] = true)
	document.addEventListener('keyup',   e => S.keys[e.code] = false)
	document.addEventListener('click',   () => { if(S.controls.isLocked) reticle() })

	// exposed for movers, debugging, and headless verification
	globalThis.SC.toggle = toggle

	S.ready = true
	return true
}

// reticle: raycast from screen centre, toggle the aimed crystal within reach —
// precision at a distance without walking
function reticle() {
	const SC = globalThis.SC
	S.raycaster.setFromCamera({ x: 0, y: 0 }, S.camera)
	const nodes = SC.crystals.map(e => e.volume.node).filter(Boolean)
	const hits = S.raycaster.intersectObjects(nodes, false)
	if(!hits.length || hits[0].distance > SC.reach) return
	const entity = SC.crystals.find(e => e.volume.node === hits[0].object)
	if(entity) toggle(entity)
}

function tick(blob, bus) {
	if(!S.ready && !init(bus)) return
	const SC = globalThis.SC
	const P = SC.POLICY
	const dt = Math.min(blob.dt || 0.016, 0.1)

	// walk on XZ, clamped inside the room, eye height fixed
	if(S.controls.isLocked) {
		const fwd = (S.keys.KeyW ? 1 : 0) - (S.keys.KeyS ? 1 : 0)
		const right = (S.keys.KeyD ? 1 : 0) - (S.keys.KeyA ? 1 : 0)
		if(fwd) S.controls.moveForward(fwd * SC.walkSpeed * dt)
		if(right) S.controls.moveRight(right * SC.walkSpeed * dt)
		const p = S.camera.position
		p.x = Math.max(-P.room.x/2 + 0.3, Math.min(P.room.x/2 - 0.3, p.x))
		p.z = Math.max(-P.room.z/2 + 0.3, Math.min(P.room.z/2 - 0.3, p.z))
		p.y = SC.eyeHeight
	}

	// body pass-through: walking through a crystal toggles it (the flat-mode analog
	// of a hand-sweep). refractory until you exit its bounds, so no boundary flutter.
	const eye = S.camera.position
	for(const entity of SC.crystals) {
		const pos = entity.volume.pose?.position
		if(!pos || !entity.volume.node) continue
		const within = eye.distanceTo(pos) < entity.crystal.radius + SC.bodyRadius
		const was = S.inside.has(entity.id)
		if(within && !was) { S.inside.add(entity.id); toggle(entity) }
		else if(!within && was) { S.inside.delete(entity.id) }
	}
}

export default [{
	id: uuid,
	resolve: function(blob, bus) {
		if(blob.registered) return
		if(blob.enter) {
			if(!S.ready) init(bus)
			bus.sound?.unlock?.()
			if(!globalThis.SC.touch) S.controls?.lock?.()   // no pointer lock on phones
			return
		}
		if(blob.tick) tick(blob, bus)
	}
}]
