// stage — scene, camera, lights, floor. pure declarations.
// single default export: array order is dispatch order (scene must precede camera).

const scene = {
	volume: {
		geometry: 'scene',
		clock: true,                             // the display drives the bus tick (§6)
		background: 0x05070c,
		fog: { color: 0x05070c, near: 7, far: 24 },
		near: 0.05,
		far: 60,
	}
}

// the camera is also the ears: one entity, both components
const camera = {
	sound: { listener: true },
	volume: {
		geometry: 'camera',
		nocontrols: true,                        // interaction.js drives it (pointer-lock)
		pose: { position: [0, 1.6, 5] },
	}
}

const ambient = {
	volume: { geometry:'light', light:'ambient', color: 0x445566, intensity: 0.9 }
}

const key = {
	volume: { geometry:'light', light:'directional', color: 0xcfe0ff, intensity: 0.9,
		pose: { position: [4, 8, 2] } }
}

const fill = {
	volume: { geometry:'light', light:'directional', color: 0x8877aa, intensity: 0.35,
		pose: { position: [-5, 3, -4] } }
}

const floor = {
	volume: {
		geometry: 'plane',
		props: [40, 40],
		material: { color: 0x0a0d14, shininess: 30 },
		pose: { position: [0, 0, 0], rotation: [-Math.PI/2, 0, 0] },
		static: true,
	}
}

export default [ scene, camera, ambient, key, fill, floor ]
