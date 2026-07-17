// globals — loaded first; everything else reads globalThis.SC (cloudreef-style).

globalThis.SC = {

	POLICY: {
		seed: 20260716,                  // change → new field. shared across clients (M2).
		count: 48,                       // number of crystals
		room: { x: 12, y: 6, z: 12 },    // metres; you wander inside this box
		clusters: 6,                     // the field "shatters" into this many chord-clusters

		// musical
		root: 220,                       // A3
		scale: [0, 2, 4, 7, 9],          // major pentatonic — safe, always consonant
		octaves: 3,                      // pitch spread
	},

	crystals: [],                        // filled by field.js; read by interaction.js

	eyeHeight: 1.6,
	walkSpeed: 3.2,
	reach: 3.5,                          // reticle toggle range, metres
	bodyRadius: 0.35,                    // pass-through test radius around the camera
}

export default []
