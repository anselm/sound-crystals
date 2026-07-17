
const uuid = 'orbital/orbital-volume/camera'

import { getThree, ensureThree, buildMaterial, removeNode, poseBind } from './three-helper.js'

export default async function camera(sys,surface,entity,delta) {

	// client side only
	const THREE = await ensureThree()
	if(!THREE) return

	const volume = entity.volume

	// obliterate?
	if(entity.obliterate) {
		if(volume.controls) {
			volume.controls.dispose()
			volume.controls.enabled = false
			volume.controls = null
		}
		return
	}

	// for now only build once and update otherwise
	if(volume._built) {
		if(volume.controls) {
			volume.controls.update()
		}
		return
	}
	volume._built = true

	// a surface has only one camera for now
	const camera = surface.camera
	if(!surface.camera || !surface.renderer || !surface.renderer.domElement) {
		console.error(uuid,'surface must be registered before camera')
		return
	}


	// use the camera but also bind the volume properties to it (especially volume.target)
	volume.node = camera
	poseBind(surface,volume)

	if(!volume.nocontrols) {

		// controls are connected to camera for now
		const cameraMin = volume.cameraMin || 1
		const cameraMax = volume.cameraMax || 1000

		// find what camera is looking at - actually this is obsolete due to new node.love concept
		// var lookAtVector = new THREE.Vector3(0,0, -1);
		// lookAtVector.applyQuaternion(camera.quaternion);

		// make controls
		const OrbitControls = (await import('three/addons/controls/OrbitControls.js')).OrbitControls
		let controls = volume.controls = new OrbitControls(camera, surface.renderer.domElement)

		controls.enabled = true
		controls.target = camera.love ? camera.love : new THREE.Vector3(0,0,0)
		controls.enableZoom = true
		controls.enableRotate = true
		controls.enableDamping = true
		controls.enablePan = true
		controls.autoRotateSpeed = 0
		controls.autoRotate = false
		controls.dampingFactor = 0.05
		controls.screenSpacePanning = false
		controls.minDistance = cameraMin
		controls.maxDistance = cameraMax
		//controls.maxPolarAngle = Math.PI / 2
		controls.update()
	}
}


/*

- unused logic
- the goal is to have some logic in the base camera to handle interpolation
- @todo

	_camera_set_focus() {
		camera.focus = {
			xyz: [0,opt.cameraHeight,0],
			ypr: [0,0,0],
			node:false,
			when:0,
			latched:true,
		}	
	}

	_camera_update() {

		const camera = this.camera
		const focus = camera.focus

		// may move camera
		if(focus.latched) {

			// get target position
			const target = new THREE.Vector3(...focus.xyz)
			// distance to it desired
			let distance = 5 // camera.position.distanceTo(target)
			// orientation we want to be behind it
			let rot = new THREE.Quaternion().setFromEuler( new THREE.Euler(...focus.ypr))
			// form a vector describing that rotation at a distance
			const v = new THREE.Vector3(0,0,-distance).applyQuaternion(rot)
			// this is the target position plus that vector
			const ideal = target.clone().add(v)

			camera.position.set(ideal.x,ideal.y,ideal.z)
			//camera.position.x += (ideal.x - camera.position.x ) / 2
			//camera.position.y += (ideal.y - camera.position.y ) / 2
			//camera.position.z += (ideal.z - camera.position.z ) / 2

			// update lookat
			//camera.target.x += (focus.xyz[0] - camera.target.x) / 2
			//camera.target.y += (focus.xyz[1] - camera.target.y) / 2
			//camera.target.z += (focus.xyz[2] - camera.target.z) / 2
			camera.target.x = focus.xyz[0]
			camera.target.y = focus.xyz[1]
			camera.target.z = focus.xyz[2]

			camera.lookAt(camera.target.x,camera.target.y,camera.target.z)
			if(this.controls) {
				this.controls.target.set(camera.target.x,camera.target.y,camera.target.z)
			}
		}

		focus.latched = false

		// update controls
		if(this.controls) {
			this.controls.update()
		}

		// hide or show target
		if(focus.node) {
			let distance = camera.position.distanceTo(camera.target)
			focus.node.visible = distance < 2 ? false : true
		}

	}
*/
