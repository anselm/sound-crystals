// sound — a declarative WebAudio service, the mirror image of orbital-volume.
//
// observes `sound` components on entities and paints them into a WebAudio graph;
// no app knowledge, no dependencies. extractable as `orbital-sound` when stable.
//
// handler table (parallel to volume's `geometry`):
//   sound.synth:'voice'   → per-entity chain: osc → env → filter → panner → output → master
//   sound.listener:true   → binds ctx.listener to this entity's pose (the camera/head)
//
// two deliberate seams for later primitives (see devlog 20260717):
//   - excite() is the ONE excitation entry point — the latch drives it today; a
//     future one-shot `ping` is just a second caller, not a second code path.
//   - every voice ends in a plain `output` gain before master — wrapping a crystal
//     in an effect later is disconnect/reconnect at that node, not surgery.

const uuid = 'sound-crystals/sound'

const _state = {
	ctx: null,
	master: null,        // voices connect here (compressor → limiter-ish → destination)
	entities: new Set(), // entities carrying sound.synth
	voices: new Map(),   // entity → { osc, env, filter, panner, output, on }
	listener: null,      // entity carrying sound.listener
	shim: null,          // silent <audio> element — iOS ringer-channel workaround
}

// a tiny silent wav, generated rather than a magic base64 blob
function silentWavURL() {
	const n = 2205 // 0.05 s @ 44100
	const buf = new ArrayBuffer(44 + n * 2)
	const v = new DataView(buf)
	const w = (o, s) => { for(let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
	w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt ')
	v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
	v.setUint32(24, 44100, true); v.setUint32(28, 88200, true)
	v.setUint16(32, 2, true); v.setUint16(34, 16, true)
	w(36, 'data'); v.setUint32(40, n * 2, true)
	return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

// the audio context starts on the first user gesture (autoplay policy); the hud's
// tap/click-to-enter calls this SYNCHRONOUSLY in the gesture handler. safe to
// call repeatedly.
//
// iOS: Web Audio routes through the RINGER channel by default — with the
// hardware mute switch on, an AudioContext is silent while media apps play
// fine. Two-part fix, both inside the gesture: ask for the 'playback' audio
// session category where the API exists (iOS 16.4+), and play a looping silent
// <audio> element, which promotes the session on older WebKit. Chrome on iOS
// is WebKit, so this covers it too.
function unlock() {
	try { if(navigator.audioSession) navigator.audioSession.type = 'playback' } catch(e) {}
	if(!_state.shim) {
		const el = _state.shim = document.createElement('audio')
		el.src = silentWavURL()
		el.loop = true
		el.setAttribute('playsinline', '')
		el.play().catch(() => {})
	}
	if(!_state.ctx) {
		const ctx = _state.ctx = new AudioContext()
		const compressor = ctx.createDynamicsCompressor()
		const trim = ctx.createGain()
		trim.gain.value = 0.9
		compressor.connect(trim)
		trim.connect(ctx.destination)
		_state.master = compressor
		// iOS can flip a context to 'interrupted'/'suspended' on route changes
		// (call, headphones, tab switch) — nudge it back on any later gesture
		ctx.addEventListener('statechange', () => { if(ctx.state !== 'running') ctx.resume().catch(() => {}) })
		const nudge = () => { if(_state.ctx && _state.ctx.state !== 'running') _state.ctx.resume().catch(() => {}) }
		document.addEventListener('touchend', nudge, { passive: true })
		document.addEventListener('visibilitychange', nudge)
	}
	if(_state.ctx.state !== 'running') _state.ctx.resume().catch(() => {})
}

function adopt(entity) {
	const sound = entity.sound
	if(sound.listener) _state.listener = entity
	if(sound.synth) _state.entities.add(entity)
}

function obliterate(entity) {
	const voice = _state.voices.get(entity)
	if(voice) {
		try { voice.osc.stop() } catch(e) {}
		voice.output.disconnect()
		_state.voices.delete(entity)
	}
	_state.entities.delete(entity)
	if(_state.listener === entity) _state.listener = null
}

// voices are created lazily on first activation — 48 crystals cost nothing until touched
function buildVoice(entity) {
	const ctx = _state.ctx
	const sound = entity.sound

	const osc = ctx.createOscillator()
	osc.type = sound.waveform || 'sine'
	osc.frequency.value = sound.freq || 220

	const env = ctx.createGain()
	env.gain.value = 0

	const filter = ctx.createBiquadFilter()
	filter.type = 'lowpass'
	filter.frequency.value = sound.cutoff || 1200
	filter.Q.value = sound.q || 1

	const panner = ctx.createPanner()
	panner.panningModel = 'HRTF'
	panner.distanceModel = 'inverse'
	panner.refDistance = 1
	panner.rolloffFactor = 1

	const output = ctx.createGain() // the routing seam — future effects splice here

	osc.connect(env)
	env.connect(filter)
	filter.connect(panner)
	panner.connect(output)
	output.connect(_state.master)
	osc.start()

	return { osc, env, filter, panner, output, on: false }
}

// the one excitation entry point: ramp the envelope toward a target level.
// setTargetAtTime only — never hard-set gain (clicks).
function excite(entity, voice, level) {
	const sound = entity.sound
	const t = _state.ctx.currentTime
	const tc = level > 0 ? (sound.attack ?? 0.25) / 3 : (sound.release ?? 0.4) / 3
	voice.env.gain.cancelScheduledValues(t)
	voice.env.gain.setTargetAtTime(level, t, tc)
}

// entity position: prefer the pose volume live-binds (a THREE vector — mutating it
// moves mesh and panner together, which is what makes grab-and-move free), fall
// back to sound.position so this service runs without volume present.
function positionOf(entity) {
	const p = entity.volume?.pose?.position || entity.sound?.position
	if(!p) return null
	return Array.isArray(p) ? { x:p[0], y:p[1], z:p[2] } : p
}

function setParam(param, value) {
	if(param) param.value = value
}

function updateListener() {
	const entity = _state.listener
	if(!entity) return
	const listener = _state.ctx.listener
	const pose = entity.volume?.pose
	const p = positionOf(entity)
	if(!p) return

	// quaternion → forward (0,0,-1) and up (0,1,0), by rotation-matrix columns —
	// manual math keeps this service free of a three.js dependency
	const q = pose?.quaternion
	let fwd = { x:0, y:0, z:-1 }, up = { x:0, y:1, z:0 }
	if(q) {
		const { x, y, z, w } = q
		fwd = { x: -2*(x*z + w*y), y: -2*(y*z - w*x), z: -(1 - 2*(x*x + y*y)) }
		up  = { x:  2*(x*y - w*z), y:  1 - 2*(x*x + z*z), z:  2*(y*z + w*x) }
	}

	if(listener.positionX) {
		setParam(listener.positionX, p.x); setParam(listener.positionY, p.y); setParam(listener.positionZ, p.z)
		setParam(listener.forwardX, fwd.x); setParam(listener.forwardY, fwd.y); setParam(listener.forwardZ, fwd.z)
		setParam(listener.upX, up.x); setParam(listener.upY, up.y); setParam(listener.upZ, up.z)
	} else {
		listener.setPosition(p.x, p.y, p.z)
		listener.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z)
	}
}

function update() {
	if(!_state.ctx) return
	updateListener()
	for(const entity of _state.entities) {
		const sound = entity.sound
		let voice = _state.voices.get(entity)
		if(!voice) {
			if(!sound.active) continue
			voice = buildVoice(entity)
			_state.voices.set(entity, voice)
		}
		if(voice.on !== !!sound.active) {
			voice.on = !!sound.active
			excite(entity, voice, voice.on ? (sound.gain ?? 0.15) : 0)
		}
		const p = positionOf(entity)
		if(p) {
			if(voice.panner.positionX) {
				setParam(voice.panner.positionX, p.x)
				setParam(voice.panner.positionY, p.y)
				setParam(voice.panner.positionZ, p.z)
			} else {
				voice.panner.setPosition(p.x, p.y, p.z)
			}
		}
	}
}

function resolve(blob, bus) {
	bus.sound = this
	if(blob.registered) return
	if(blob.obliterate && blob.sound) { obliterate(blob); return }
	if(blob.sound && !blob.tick) adopt(blob)
	if(blob.tick) update()
	// never return a value — a non-undefined return would first-responder-stop the chain
}

export const sound_system = {
	id: uuid,
	resolve,
	unlock,
	excite: (entity, level) => { const v = _state.voices.get(entity); if(v) excite(entity, v, level) },
	_state,
}
