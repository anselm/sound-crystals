// hud — DOM overlay: title, "click to enter" (the one gesture that unlocks BOTH
// audio and pointer-lock), help text, and the reticle dot while locked.

const uuid = 'sound-crystals/hud'

let overlay = null
let reticle = null

function build(bus) {
	const style = document.createElement('style')
	style.textContent = `
		#sc-hud {
			position: fixed; inset: 0; z-index: 10;
			display: flex; flex-direction: column; align-items: center; justify-content: center;
			background: rgba(4, 6, 12, 0.72); color: #dde6f2; cursor: pointer;
			font-family: ui-sans-serif, system-ui, sans-serif; text-align: center;
			backdrop-filter: blur(3px); user-select: none;
		}
		#sc-hud h1 {
			font-size: clamp(30px, 6vw, 54px); margin: 0 0 10px; font-weight: 600;
			background: linear-gradient(90deg, #6cc6ff, #b78bff, #ff8bc6);
			-webkit-background-clip: text; background-clip: text; color: transparent;
			letter-spacing: 0.04em;
		}
		#sc-hud p { margin: 6px 0; color: #9aa8bc; font-size: 15px; max-width: 460px; line-height: 1.6; }
		#sc-hud .enter { margin-top: 26px; color: #e7f0ff; font-size: 18px;
			border: 1px solid #3a4560; border-radius: 999px; padding: 10px 26px; }
		#sc-version { position: fixed; right: 10px; bottom: 8px; z-index: 11;
			font: 11px ui-monospace, monospace; color: #55627a; pointer-events: none; }
		#sc-reticle {
			position: fixed; left: 50%; top: 50%; z-index: 9; display: none;
			width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%;
			background: rgba(230, 240, 255, 0.85); box-shadow: 0 0 6px rgba(160,200,255,0.8);
			pointer-events: none;
		}
	`
	document.head.appendChild(style)

	const touch = globalThis.SC?.touch
	const help = touch
		? 'left thumb to walk · drag to look · tap a crystal to ring it'
		: 'WASD to walk · mouse to look · click to toggle the crystal you aim at · esc to pause'
	overlay = document.createElement('div')
	overlay.id = 'sc-hud'
	overlay.innerHTML = `
		<h1>Sound Crystals</h1>
		<p>A field of ringing crystals. Walk through one to wake it — it keeps
		ringing until you pass through again. Leave a chord behind you, cross the
		room, wake another against it.</p>
		<p>${help}</p>
		<div class="enter">${touch ? 'tap' : 'click'} to enter</div>
	`
	overlay.addEventListener('click', () => {
		// unlock synchronously IN the gesture handler — iOS will not resume an
		// AudioContext from the async side of a bus dispatch
		bus.sound?.unlock?.()
		bus.resolve({ enter: true })
	})
	document.body.appendChild(overlay)

	reticle = document.createElement('div')
	reticle.id = 'sc-reticle'
	document.body.appendChild(reticle)

	// version stamp — "which build am I looking at". package.json is the app
	// version; version.json is written by the deployer (sha + time), absent in dev.
	const ver = document.createElement('div')
	ver.id = 'sc-version'
	ver.textContent = '…'
	document.body.appendChild(ver)
	;(async () => {
		const get = async (f) => { try { const r = await fetch(f, { cache: 'no-store' }); return r.ok ? await r.json() : null } catch(e) { return null } }
		const pkg = await get('package.json')
		const build = await get('version.json')
		ver.textContent = `v${pkg?.version ?? '?'}` +
			(build ? ` · ${build.sha.slice(0, 7)} · ${build.at}` : ' · dev')
	})()

	// visit /?debug to watch audio state live — for diagnosing silent phones
	if(location.search.includes('debug')) {
		debug = document.createElement('div')
		debug.style.cssText = `position:fixed; top:8px; left:8px; z-index:20;
			font: 11px ui-monospace, monospace; color:#9fe8a0; background:rgba(0,0,0,0.6);
			padding:6px 8px; border-radius:6px; pointer-events:none; white-space:pre;`
		debug.textContent = 'audio: (locked — tap to enter)'
		document.body.appendChild(debug)
	}
}

let debug = null
let debugLast = 0

function debugTick(t, bus) {
	if(!debug || (t - debugLast) < 0.5) return
	debugLast = t
	const st = bus.sound?._state
	const SC = globalThis.SC
	debug.textContent =
		`ctx: ${st?.ctx?.state ?? 'none'}` +
		`\nsession: ${(typeof navigator !== 'undefined' && navigator.audioSession) ? navigator.audioSession.type : 'n/a'}` +
		`\nshim: ${st?.shim ? (st.shim.paused ? 'paused' : 'playing') : 'none'}` +
		`\nvoices: ${st?.voices?.size ?? 0} active: ${SC?.crystals?.filter(e => e.sound.active).length ?? 0}` +
		`\ntouch: ${SC?.touch}`
}

export default [{
	id: uuid,
	resolve: function(blob, bus) {
		if(blob.registered) { build(bus); return }
		if('locked' in blob && overlay) {
			overlay.style.display = blob.locked ? 'none' : 'flex'
			reticle.style.display = (blob.locked && !globalThis.SC?.touch) ? 'block' : 'none'
		}
		if(blob.tick) debugTick(blob.t, bus)
	}
}]
