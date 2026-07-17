// sound-crystals — two peer services (volume → three.js, sound → webaudio) plus
// pure data in agents/. see devlog/20260716-initial-approach.md for the design.

import { createBus } from '@orbitalfoundation/bus'

const bus = globalThis.bus = createBus({ description: 'sound-crystals' })

// order matters: volume first (sound reads poses volume binds), agents last.
// the display drives the clock (scene entity carries volume.clock) — no {run:'realtime'}.
await bus.resolve({ load: [
	'orbital-volume/volume.js',
	'here/services/sound.js',
	'here/agents/all.js',
]})
