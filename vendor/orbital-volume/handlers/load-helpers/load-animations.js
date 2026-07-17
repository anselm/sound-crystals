
const uuid = 'orbital/orbital-volume/animations'

import { getThree, buildMaterial } from '../three-helper.js'

const cache = {}

//
// load some animations once only ever - returning a hash of { key: array of clips }
//

async function _load_raw_animations(loader,animations={}) {

	// result set
	const clumps = {}

	// get three
	const THREE = getThree()
	if(!THREE) return clumps

	// paranoia checks
	if(!animations || Array.isArray(animations) || typeof animations !== 'object') {
		console.error(uuid,'corrupt target')
		return {}
	}

	// visit each file
	for(const [key,value] of Object.entries(animations)) {

		// it is legal to have empty keys
		if(!value) {
			console.warn(uuid,"empty key",key,value)
			clumps[key] = null
			continue
		}

		if(Array.isArray(value)) {
			console.error(uuid,"unsupported type")
			continue
		}

		// vanilla clip?
		let filename
		let subclip = null
		if(typeof value === 'string' || value instanceof String) {
			filename = value
		}

		// subclip?
		else if(typeof value === 'object') {
			subclip = value
			filename = value.path
			if(!filename) {
				console.error(uuid,"bad subclip",filename,key,value)
				continue
			}
		}

		// find named collection in global cache?
		let clump = cache[filename]

		// load?
		if (!clump) {

			cache[filename] = clump = []

			try {
				if(filename.endsWith(".json")) {
					const response = await fetch(filename)
					const json = await response.json()
					json.forEach((jsonclip) => {
						let clip = THREE.AnimationClip.parse(jsonclip)
						clip._scene = null
						clump.push(clip)
					})
				} else if(filename.endsWith(".glb") || filename.endsWith(".gltf")) {
					let blob = await loader.loadAsync(filename)
					blob.animations.forEach(clip => {
						clip._scene = blob.scene
						clump.push(clip)
					})
				} else if(filename.endsWith(".fbx")) {
					let blob = await loader.loadAsync(filename)
					for(let clip of blob.animations) {
						clip._scene = blob.scene
						clump.push(clip)
					}
				}
			} catch(err) {
				console.error(uuid,"cannot load animation file",filename,err)
			}
		}

		// valid?
		if(!clump || !clump.length) {
			console.error(uuid,'loaded clips are too short',filename,clump)
			continue
		}
		//console.log(uuid,'loaded clips',filename)

		// for now throw away all except first
		let clip = clump[0]

		// snip out a piece?
		if(subclip && subclip.hasOwnProperty('start') && subclip.hasOwnProperty('end')) {
			clip = THREE.AnimationUtils.subclip(clip,key+"clipped",0,20)
		}

		// stash just one for now @todo improve
		clumps[key.toLowerCase()] = [ clip ]
	}

	return clumps
}

///
/// given a volume component, load animations and write some state into that volume component
///
/// @todo note this is critical state but there is no formal schema for a volume component yet
///

export async function load_animations(loader,volume,built_in=null) {

	let clumps = {}

	// get them
	if(volume.animations) {
		clumps = await _load_raw_animations(loader,volume.animations)
	} else {
		clumps = {}
	}

	// merge built in
	if(built_in && built_in.length) {
		for(let clip of built_in) {
			clumps[clip.name] = [clip]
		}
	}

	// set a default
	const values = Object.values(clumps)
	if(values && values.length && !clumps.hasOwnProperty('default')) {
		clumps['default'] = values[0]
	}

	return clumps
}

