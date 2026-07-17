
import { getThree, ensureThree, buildMaterial, removeNode, poseBind, poseUpdate, displaceVertices } from './three-helper.js'

export default async function prim(sys,surface,entity,delta) {

	// client side only
	const THREE = await ensureThree()
	if(!THREE) return

	const volume = entity.volume

	if(entity.obliterate) {
		removeNode(volume.node)
		return
	}

	// update?
	if(volume._built) {
		poseUpdate(surface,volume)
		return
	}
	volume._built = true

	// in the case of multiple instances may avoid building geometry
	if(volume.instances) {
		poseBind(surface,volume)
		if(volume.node) return
	}

	const material = buildMaterial(volume.material)

	let geometry

	switch(volume.geometry) {
		case 'cube':
		case 'box':
			geometry = new THREE.BoxGeometry(1,1,1);
			break;

		case 'sphere':
			geometry = new THREE.SphereGeometry(1, 32, 32);
			break;

		case 'cylinder':
			if(!volume.props) throw "Need Props"
			geometry = new THREE.CylinderGeometry(...volume.props);
			break;

		case 'plane':
			if(!volume.props) throw "Need Props"
			geometry = new THREE.PlaneGeometry(...volume.props);
			break;

		case 'crystal': {
			// facets selects the shape family; jitter shatters it (seeded, deterministic)
			const facets = volume.facets || 20
			geometry = facets <= 4 ? new THREE.TetrahedronGeometry(1)
			         : facets <= 8 ? new THREE.OctahedronGeometry(1)
			         :               new THREE.IcosahedronGeometry(1, 0)
			if(volume.jitter) displaceVertices(geometry, volume.jitter, volume.seed || 1)
			geometry.computeVertexNormals()
			break;
		}

		default:
			return
	}

	if(geometry) {
		const node = volume.node = new THREE.Mesh(geometry, material)
		// participate in shadows by default (no-op unless the renderer's
		// shadow map is on and a light casts); opt out with shadow: false
		node.castShadow = node.receiveShadow = volume.shadow !== false
		poseBind(surface,volume,node)
	}

}

