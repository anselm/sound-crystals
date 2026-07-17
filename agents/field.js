// field — THE GRAMMAR. a pure function (policy, seed, index) → crystal, where each
// crystal carries a visual component and an audio component derived from the SAME
// latents. deterministic: same seed → bit-identical field on every client (never
// Math.random — it would desync M2 multiplayer).
//
// the mapping (devlog §5.2):
//   pitch        → size (bigger = lower, like real resonators) + oscillator freq
//   pitch-class  → hue (same note = same colour family)
//   facet count  → shape family + waveform brightness
//   octave band  → lightness + filter cutoff
//   cluster id   → placement (shatter shards) + chord membership
//   position     → where it sits + HRTF pan
//   saturation   → colour saturation + voice gain ceiling

import { mulberry32 } from '@orbitalfoundation/utils'

const uuid = 'sound-crystals/field'

const lerp = (a, b, t) => a + (b - a) * t

function generate(bus) {
	const P = globalThis.SC.POLICY
	const rng = mulberry32(P.seed)

	// cluster centres: poisson-ish rejection sampling inside the room, margin off walls
	const margin = 1.8
	const centres = []
	let guard = 0
	while(centres.length < P.clusters && guard++ < 400) {
		const c = [
			(rng() - 0.5) * (P.room.x - 2*margin),
			0,
			(rng() - 0.5) * (P.room.z - 2*margin),
		]
		const clear = centres.every(o => (o[0]-c[0])**2 + (o[2]-c[2])**2 > 3*3)
		if(clear || guard > 300) centres.push(c)
	}

	// one cluster ≈ one chord: three notes stacked in scale-steps of two (pseudo-thirds)
	// from a rotating root — nearby crystals are consonant, distant clusters contrast
	const chords = centres.map((c, k) => {
		const off = k % P.scale.length
		return [0, 1, 2].map(j => P.scale[(off + j*2) % P.scale.length])
	})

	for(let i = 0; i < P.count; i++) {

		// --- latents, all drawn from the one seeded stream ---
		const cluster = i % P.clusters
		const chord = chords[cluster]
		const degree = chord[Math.floor(rng() * chord.length)]
		const octave = Math.floor(rng() * P.octaves)
		const semitone = degree + 12 * octave
		const facets = [4, 8, 20][Math.floor(rng() * 3)]
		const satLatent = rng()

		// --- audio side ---
		const freq = P.root * Math.pow(2, semitone / 12)
		const waveform = facets <= 4 ? 'sine' : facets <= 8 ? 'triangle' : 'sawtooth'
		const cutoff = 700 * Math.pow(2, octave)          // higher octave = brighter filter
		const gain = lerp(0.10, 0.22, satLatent)

		// --- visual side, read off the same latents ---
		const pitchNorm = semitone / (12 * P.octaves)
		const radius = lerp(0.22, 0.85, 1 - pitchNorm)    // bigger crystal = lower note
		const hue = Math.round((degree % 12) / 12 * 360)  // colour == pitch-class
		const sat = Math.round(lerp(60, 90, satLatent))
		const light = 52 + octave * 9                     // higher octave = glassier
		const color = `hsl(${hue}, ${sat}%, ${light}%)`
		const dim   = `hsl(${hue}, 80%, 12%)`             // emissive at rest — a faint inner light
		const glow  = `hsl(${hue}, 90%, 48%)`             // emissive while ringing

		// placement: scatter around the cluster centre, biased toward walking height
		const centre = centres[cluster]
		const angle = rng() * Math.PI * 2
		const spread = 0.5 + rng() * 1.9
		const x = centre[0] + Math.cos(angle) * spread
		const z = centre[2] + Math.sin(angle) * spread
		const y = 0.6 + Math.pow(rng(), 1.5) * (P.room.y - 2.2)

		const crystal = {
			id: `crystal-${i}`,
			crystal: { i, cluster, degree, octave, radius, dim, glow },
			volume: {
				geometry: 'crystal',
				facets,
				jitter: 0.16,
				seed: P.seed + i * 7919,                    // per-crystal shard displacement
				material: {
					color, transparent: true, opacity: 0.5,
					emissive: dim, shininess: 120, specular: 0xaaccee,
					flatShading: true,
				},
				pose: {
					position: [x, y, z],
					rotation: [rng()*Math.PI, rng()*Math.PI, rng()*Math.PI],
					scale: [radius, radius, radius],
				},
			},
			sound: {
				synth: 'voice',
				freq, waveform,
				cutoff, q: 2.5, gain,
				attack: 0.25, release: 0.4,
				active: false,                              // THE toggle. one source of truth.
			},
		}

		globalThis.SC.crystals.push(crystal)
		bus.resolve(crystal)
	}
}

export default [{
	id: uuid,
	resolve: function(blob, bus) {
		if(blob.registered) generate(bus)
	}
}]
