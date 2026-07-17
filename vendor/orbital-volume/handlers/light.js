
import { getThree, ensureThree, buildMaterial, removeNode, poseBind } from './three-helper.js'

export default async function light(sys,surface,entity,delta) {

	const THREE = await ensureThree()
	if(!THREE) return

	const volume = entity.volume

	if(entity.obliterate) {
		removeNode(volume.node)
		return
	}

	// only run on clients, and also only create once
	if(volume._built) return
	volume._built = true

	const material = buildMaterial(volume.material)

	switch(volume.light) {
	case 'pointLight':
	case 'point':
		// @todo would like to tidy up props under say volume.light = {} 
		volume.node = new THREE.PointLight(volume.color, volume.intensity, volume.distance, volume.decay)
		break

	case 'ambientLight':
	case 'ambient':
		volume.node = new THREE.AmbientLight(volume.color, volume.intensity)
		break

	case 'directionalLight':
	case 'directional':
		volume.node = new THREE.DirectionalLight(volume.color, volume.intensity)
		break

	case 'spotLight':
	case 'spot':
		volume.node = new THREE.SpotLight(volume.color, volume.intensity)
		break

	default:
		console.error('orbital/orbital-volume/light - error unknown',volume)
		return

	}

	// optional shadow casting: volume.shadow = true | { size, extent, near, far }
	// (same config shape as the scene handler's sun; the renderer's shadow map
	// must be on — e.g. scene { prettier: true })
	if(volume.shadow && volume.node.shadow) {
		const conf = typeof volume.shadow === 'object' ? volume.shadow : {}
		const node = volume.node
		node.castShadow = true
		node.shadow.mapSize.set(conf.size || 2048, conf.size || 2048)
		if(node.shadow.camera && node.shadow.camera.isOrthographicCamera) {
			const extent = conf.extent || 100
			node.shadow.camera.left = -extent
			node.shadow.camera.right = extent
			node.shadow.camera.top = extent
			node.shadow.camera.bottom = -extent
		}
		node.shadow.camera.near = conf.near || 1
		node.shadow.camera.far = conf.far || 500
		node.shadow.bias = -0.0004
		node.shadow.normalBias = 0.03
	}

	// directional/spot lights aim at a target; expose it as volume.target and
	// add it to the scene so three keeps it updated
	if(volume.target && volume.node.target) {
		volume.node.target.position.set(...volume.target)
		if(surface.scene) surface.scene.add(volume.node.target)
	}

	// live binding
	poseBind(surface,volume)

}