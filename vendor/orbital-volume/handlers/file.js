import { getThree, ensureThree, buildMaterial, removeNode, poseBind, poseUpdate } from './three-helper.js'

import { load_animations } from './load-helpers/load-animations.js'
import { morph_targets } from './load-helpers/morph-targets.js'
import { copy_bones } from './load-helpers/copy-bones.js'
import { retarget_vrm } from './load-helpers/retarget-vrm.js'
import { misc_cleanup } from './load-helpers/misc-cleanup.js'

const uuid = 'orbital/orbital-volume/load-helper/file'

const loadCache = {}

//
// get 3js loader - cached at surface level not here
// @todo for now the loader is conserved; unsure if that is ok
// @todo most other loaders such as vrm are turned off for performance for now since not used much
//

async function _loader() {

	const GLTFLoader = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader
	const loader = new GLTFLoader()
	loader.setCrossOrigin('anonymous')

return loader

	// dead code below intentionally commented out: bundlers (esbuild/vite)
	// resolve dynamic import strings at build time, and MeshOptDecoder.js is
	// not a real three/addons path (a local copy lives in load-helpers/)
	//
	// const DRACOLoader = (await import('three/addons/loaders/DRACOLoader.js')).DRACOLoader
	// const dracoLoader = new DRACOLoader()
	// dracoLoader.setDecoderPath("@todo")
	// loader.setDRACOLoader(dracoLoader)
	//
	// const KTX2Loader = (await import('three/addons/loaders/KTX2Loader.js')).KTX2Loader
	// const ktx2Loader = new KTX2Loader()
	// ktx2Loader.setTranscoderPath(import.meta.url+"@todo")
	// loader.setKTX2Loader(ktx2Loader)
	//
	// const MeshOptDecoder = (await import('./load-helpers/meshopt_decoder.js')).MeshoptDecoder
	// loader.setMeshoptDecoder(MeshOptDecoder)
	//
	// import { VRM, VRMUtils, VRMHumanoid, VRMLoaderPlugin } from './three-vrm.module.js'
	// loader.register((parser) => { return new VRMLoaderPlugin(parser) })
}

//
// play or switch to a requested animation - this is a very simple animation blender
//

function _play(volume,requested='default') {

	// sanity
	if(!volume || !volume.clumps || !volume.node) return
	if(typeof requested !== 'string') return
	if(requested == volume.latched) return

	// latch new player
	volume.latched = requested.length ? requested : 'default'

	// fade old?
	if(volume.action) {
		volume.action.fadeOut(0.5)
		volume.action = null
	}

	// find clip clump
	const clump = volume.clumps[requested.toLowerCase()]
	if(!clump || !clump.length) {
		console.warn(uuid,'animation clip not found!',requested)
		return
	}

	// make sure there is a mixer; also when done play default
	if(!volume.mixer) {
		volume.mixer = new THREE.AnimationMixer(volume.node)
		volume.mixer.addEventListener( 'finished', () => {
			_play(volume)
		})
	}

	// fade in clip
	const clip = clump[0]
	const action = volume.action = volume.mixer.clipAction(clip)
	action.reset()
	action.fadeIn(0.5)
	action.loop = (requested === 'default') ? THREE.LoopRepeat : THREE.LoopOnce
	action.clampWhenFinished = true
	action.play()

	// there is a case where an animation hit an end to a set of loops @todo analyze
	action.onLoop = (e) => {
		// console.log('volume - animation has reached the end possibly',requested)
		if(event.type === 'loop' && event.willLoop === false) {
			// could cross fade to something else? @todo should crossfades be manual or?
			// action.crossFadeTo(newAction, duration, false)
		}
	}
}

async function _manufacture(surface,volume,gltf=null) {

	const loader = surface.loader || (surface.loader = await _loader())

	//
	// Placeholder - disabled for now
	//

	let placeholder = null
	if(false) {
		const geometry = new THREE.SphereGeometry( 0.1, 32, 16 )
		const material = new THREE.MeshBasicMaterial( { color: 0xffff00 } )
		placeholder = new THREE.Mesh( geometry, material )
		surface.scene.add( placeholder )
	}

	//
	// load geometry if null; else just will be cloning
	// @todo may wish to publish a loaded event instead of running synchronously
	//

	if(!gltf) {
		gltf = await loader.loadAsync(volume.url)
	} else {
		// @todo may wish to deep clone for instancemesh
	}

	if(!gltf || !gltf.scene) {
		console.error(uuid,'cannot load',volume.url)
		return null
	}

	// remember the root node although it is not used directly - but animations will need it
	volume.original = gltf

	// use this node for rendering, avoiding other errata such as cameras and lights in this file
	const node = volume.node = gltf.scene

	// please do not delete meshes
	node.traverse((child) => { if ( child.type == 'SkinnedMesh' ) { child.frustumCulled = false; } })

	// remove placeholder
	if(placeholder) {
		surface.scene.remove( placeholder )
	}

	// load animations if any - merge in any from the main gltf also
	const clumps = volume.clumps = await load_animations(loader,volume,gltf.animations)

	// set vrm if any - disabled for now but easy to turn back on by setting this - make sure to include vrm loaders
	const vrm = volume.vrm = null

	// find all the bones if any
	volume.bones = copy_bones(node,vrm)

	// find all the morph targets - can occur prior to finding bones
	volume.targets = {}
	volume.morphs = {}
	volume.dictionary = {}
	Object.assign(volume,morph_targets(node,vrm))

	// features related to loaded files that are human like
	{

		// vrms use their own naming - do some patching if any
		retarget_vrm(node,clumps,vrm)

		// other small fixes i prefer - do this last
		misc_cleanup(node,clumps)

		// track a few details for convenience for humans
		// eyes for gaze
		// head, neck, body
		volume.left_eye = volume.bones["LeftEye"]
		volume.right_eye = volume.bones["RightEye"]

	}

	// start play of default animation by default
	_play(volume)

	// return node if success
	return volume.node
}

//
// update existing volume over time
//

function _update(volume) {
	const time = performance.now()
	const timespan = volume._last_time ? (time-volume._last_time) : 0
	volume._last_time = time

	if(volume.mixer && volume.clumps && volume.node) {
		volume.mixer.update(timespan/1000)
	}

	if(volume.vrm) {
		volume.vrm.update(timespan/1000)
	}
}

//
// handle frame by frame updates on file assets with animation
//

export default async function handler(sys,surface,entity,delta) {

	// threejs is not available in server env
	const THREE = await ensureThree()
	if(!THREE) return

	const volume = entity.volume

	//
	// obliterate?
	//

	if(entity.obliterate && volume) {
		removeNode(volume.node)
		return
	}

	//
	// update?
	// @todo detect changes to volume url to force reload
	//

	if(volume._built) {
		_update(volume,delta)
		poseUpdate(surface,volume)
		return
	}
	volume._built = true

	//
	// @todo later clone if already loaded once
	// const previous = loadCache[volume.url]
	// loadCache[volume.url] = volume
	//

	//
	// if multiple instancing then may avoid manufacturing more than once
	// @todo if the file or multiple instancing changed this would not allow updates yet
	//

	if(volume.instances > 0) {
		poseBind(surface,volume)
		if(volume.node) return
	}

	//
	// manufacture - sets volume.node ...
	//

	await _manufacture(surface,volume)
	poseBind(surface,volume)
}



