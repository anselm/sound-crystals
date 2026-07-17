// touch — mobile-mode input: left-thumb virtual joystick to walk, drag anywhere
// else to look, tap a crystal to ring it. No-ops unless the primary pointer is
// coarse (SC.touch), so desktop is untouched. Body pass-through toggling still
// comes from interaction.js — that is just a distance test on the camera, and
// works the same however the camera is driven.

const uuid = 'sound-crystals/touch'

const R = 48          // joystick radius, px
const LOOK_SENS = 0.006
const TAP_MS = 300
const TAP_PX = 12

const T = {
	ready: false, entered: false,
	camera: null, raycaster: null,
	yaw: 0, pitch: 0,
	stickId: null, anchor: null, vec: { x: 0, y: 0 },
	lookId: null, last: null, start: null, t0: 0,
	base: null, knob: null,
}

function buildStick() {
	const base = T.base = document.createElement('div')
	base.style.cssText = `position:fixed; z-index:8; width:${R*2}px; height:${R*2}px;
		border-radius:50%; border:1.5px solid rgba(180,200,255,0.35);
		background:rgba(60,80,120,0.18); display:none; pointer-events:none;`
	const knob = T.knob = document.createElement('div')
	knob.style.cssText = `position:absolute; left:50%; top:50%; width:${R}px; height:${R}px;
		margin:-${R/2}px 0 0 -${R/2}px; border-radius:50%; background:rgba(180,200,255,0.4);`
	base.appendChild(knob)
	document.body.appendChild(base)
}

function knobTo(dx, dy) {
	T.knob.style.transform = `translate(${dx}px, ${dy}px)`
}

function onStart(e) {
	if(!T.entered) return                       // let the hud's tap-to-enter through untouched
	e.preventDefault()
	for(const t of e.changedTouches) {
		const stickZone = t.clientX < innerWidth * 0.45 && t.clientY > innerHeight * 0.5
		if(T.stickId === null && stickZone) {
			T.stickId = t.identifier
			T.anchor = { x: t.clientX, y: t.clientY }
			T.base.style.display = 'block'
			T.base.style.left = (t.clientX - R) + 'px'
			T.base.style.top = (t.clientY - R) + 'px'
			knobTo(0, 0)
		} else if(T.lookId === null) {
			T.lookId = t.identifier
			T.last = { x: t.clientX, y: t.clientY }
			T.start = { x: t.clientX, y: t.clientY }
			T.t0 = performance.now()
		}
	}
}

function onMove(e) {
	if(!T.entered) return
	e.preventDefault()
	for(const t of e.changedTouches) {
		if(t.identifier === T.stickId) {
			let dx = t.clientX - T.anchor.x, dy = t.clientY - T.anchor.y
			const len = Math.hypot(dx, dy)
			if(len > R) { dx = dx / len * R; dy = dy / len * R }
			knobTo(dx, dy)
			T.vec.x = dx / R                     // strafe
			T.vec.y = -dy / R                    // stick up = forward
		} else if(t.identifier === T.lookId && T.camera) {
			const dx = t.clientX - T.last.x, dy = t.clientY - T.last.y
			T.last = { x: t.clientX, y: t.clientY }
			T.yaw -= dx * LOOK_SENS
			T.pitch = Math.max(-1.4, Math.min(1.4, T.pitch - dy * LOOK_SENS))
			T.camera.rotation.y = T.yaw
			T.camera.rotation.x = T.pitch
		}
	}
}

function onEnd(e) {
	if(!T.entered) return
	for(const t of e.changedTouches) {
		if(t.identifier === T.stickId) {
			T.stickId = null
			T.vec.x = T.vec.y = 0
			T.base.style.display = 'none'
		} else if(t.identifier === T.lookId) {
			const moved = Math.hypot(t.clientX - T.start.x, t.clientY - T.start.y)
			if(moved < TAP_PX && performance.now() - T.t0 < TAP_MS) tap(t.clientX, t.clientY)
			T.lookId = null
		}
	}
}

// tap a crystal to toggle it — same verb as the desktop reticle, aimed by finger.
// reach is doubled on touch: you cannot aim as precisely while walking a phone.
function tap(px, py) {
	const SC = globalThis.SC
	if(!T.raycaster || !SC.toggle) return
	const ndc = { x: (px / innerWidth) * 2 - 1, y: -(py / innerHeight) * 2 + 1 }
	T.raycaster.setFromCamera(ndc, T.camera)
	const nodes = SC.crystals.map(e => e.volume.node).filter(Boolean)
	const hits = T.raycaster.intersectObjects(nodes, false)
	if(!hits.length || hits[0].distance > SC.reach * 2) return
	const entity = SC.crystals.find(e => e.volume.node === hits[0].object)
	if(entity) SC.toggle(entity)
}

function init(bus) {
	const surface = bus.volume?.surface?.()
	if(!surface || !surface.camera) return false
	T.camera = surface.camera
	T.camera.rotation.order = 'YXZ'             // yaw/pitch look, same as PointerLockControls
	T.yaw = T.camera.rotation.y
	T.pitch = T.camera.rotation.x
	T.raycaster = new globalThis.THREE.Raycaster()
	T.ready = true
	return true
}

function tick(blob) {
	if(!T.ready || (!T.vec.x && !T.vec.y)) return
	const SC = globalThis.SC
	const P = SC.POLICY
	const dt = Math.min(blob.dt || 0.016, 0.1)
	const sp = SC.walkSpeed * dt
	const yaw = T.yaw
	const p = T.camera.position
	p.x += (-Math.sin(yaw) * T.vec.y + Math.cos(yaw) * T.vec.x) * sp
	p.z += (-Math.cos(yaw) * T.vec.y - Math.sin(yaw) * T.vec.x) * sp
	p.x = Math.max(-P.room.x/2 + 0.3, Math.min(P.room.x/2 - 0.3, p.x))
	p.z = Math.max(-P.room.z/2 + 0.3, Math.min(P.room.z/2 - 0.3, p.z))
	p.y = SC.eyeHeight
}

export default [{
	id: uuid,
	resolve: function(blob, bus) {
		if(!globalThis.SC?.touch) return
		if(blob.registered) {
			buildStick()
			window.addEventListener('touchstart', onStart, { passive: false })
			window.addEventListener('touchmove', onMove, { passive: false })
			window.addEventListener('touchend', onEnd)
			window.addEventListener('touchcancel', onEnd)
			return
		}
		if(blob.enter) {
			T.entered = true
			if(!T.ready) init(bus)
			bus.resolve({ locked: true })       // "in the experience" — hides the hud
			return
		}
		if(blob.tick) {
			if(!T.ready) init(bus)
			tick(blob)
		}
	}
}]
