
const isServer = (typeof window === 'undefined') ? true : false

globalThis.THREE = globalThis.THREE || null
let textureLoader = null
let threeLoading = null

// Lazy dynamic import rather than top-level await: keeps this module loadable
// on servers without three installed AND bundleable by esbuild/vite targets
// that reject top-level await. Handlers await ensureThree() before building.
if(isServer == false) {
	threeLoading = import('three').then((mod) => {
		globalThis.THREE = mod
		textureLoader = new mod.TextureLoader()
		return mod
	})
}

///
/// get a handle on threejs on client - quirky hoop to be able to at least not have an import fail on a server
///

export function getThree() {
	return isServer == true ? null : globalThis.THREE
}

///
/// await threejs availability - null on server; handlers call this first
///

export async function ensureThree() {
	if(isServer) return null
	return globalThis.THREE || threeLoading
}

///
/// mark a texture as sRGB across three.js versions
/// (texture.colorSpace landed ~r152; texture.encoding was removed ~r162)
///

export function markSRGB(texture) {
	if(!THREE || !texture) return texture
	if('colorSpace' in texture && THREE.SRGBColorSpace !== undefined) {
		texture.colorSpace = THREE.SRGBColorSpace
	} else if(THREE.sRGBEncoding !== undefined) {
		texture.encoding = THREE.sRGBEncoding
	}
	return texture
}

///
/// build a simple material from props
///

export function buildMaterial(props = null) {

	if(!THREE || !textureLoader || !props || typeof props !== 'object') return

	if(props.textureURL) {
		props.map = textureLoader.load( props.textureURL )
	}
	if(props.displacementURL) {
		props.displacementMap = props.bumpMap = textureLoader.load( props.displacementURL );
	}

	switch(props ? props.kind : 'fallback') {
		case 'fallback':
			return new THREE.MeshPhongMaterial({ color: 0xcccccc });
		case 'basic':
			props = { ... props }
			delete props.kind
			return new THREE.MeshBasicMaterial(props)
		default:
			props = { ... props }
			delete props.kind
			return new THREE.MeshPhongMaterial(props)
			break
	}
}



///
/// remove an object
///

export function removeNode(node) {

    if (!node || !(node instanceof THREE.Object3D)) return

	node.removeFromParent()
	node.parent = null

    if (node.geometry) node.geometry.dispose();
    node.geometry = null

    if (node.material) {
        if (node.material instanceof Array) {
            node.material.forEach(material => material.dispose());
        } else {
            node.material.dispose();
        }
    }
    node.material = null
}

///
/// poseBind
///
/// Given a volume component - directly bind to threejs
/// This means that volume fields are 'live' where declared first.
/// Will also unroll and rewrite triplet arrays to be {x,y,z} in place.
///
/// There are several risks:
/// - breaks the sys() pub/sub pattern of separation of roles
/// - users may make mistakes like volume.position = [1,2,3]
///

export function poseBind(surface,volume,node=null) {

	// find node if any
	if(node) volume.node = node; else node = volume.node

	// instancemesh tracking / registration
	if(volume.instances && volume.url) {
		if(!surface.groups) surface.groups={}
		let group = surface.groups[volume.url]
		if(!group) {
			if(!node) {
				// @todo i feel this is a slightly sloppy subtlety around binding
				console.warn('volume: instancemesh bind must have first node')
				return
			}
			group = surface.groups[volume.url] = {
				members:[],
				referencemesh: node,
				instancemeshes: [],
				instances: volume.instances,
			}
			node.traverse((child) => {
				if(!child.isMesh) return
				const instancedmesh = new THREE.InstancedMesh(
					child.geometry, // .clone()
					child.material, // .clone()
					volume.instances
				)
				instancedmesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage )
				surface.scene.add(instancedmesh)
				group.instancemeshes.push(instancedmesh)
			})
		}
		group.instancemeshes.forEach(mesh=>{mesh.count=group.members.length})
		volume.instanceindex = group.members.length
		group.members.push(volume)
		node = volume.node = new THREE.Group()
	}

	// must have node by now
	if(!node) {
		console.error('volume: bind no node')
		return
	}

	//
	// normal nodes are added to the scene
	//

	if(!volume.instances) {
		//if(entity.parent && entity.parent.volume && entity.parent.volume.node) {
		//	entity.parent.volume.node.add(volume.node)
		//} else {
		surface.scene.add(node)
		//}
	}

	// given [0,1,2] or { x:0, y:1, z:2 } return [0,1,2]
	const unroll = (xyz) => { return Array.isArray(xyz) ? xyz : Object.values(xyz) }

	// pull values from outside manifests - can be arrays or objects
	let pose = volume.pose
	if(!pose) {
		pose = volume.pose = {}
	}

	// backwards support
	if(volume.xyz) pose.position = volume.xyz
	if(volume.ypr) pose.rotation = volume.ypr
	if(volume.whd) pose.scale = volume.whd

	// stuff this into every object as a way to set a target - avoiding using the reserved term 'target'
	Object.defineProperty(node, 'love', {
		value: new THREE.Vector3(),
		enumerable: true,
		configurable: true
	});

	// copy from manifest to node
	if(true) {
		if(pose.position) node.position.set(...unroll(pose.position) )
		if(pose.rotation) node.rotation.set(...unroll(pose.rotation) )
		if(pose.scale) node.scale.set(...unroll(pose.scale) )
		if(pose.quaternion) node.quaternion.set(...unroll(pose.quaternion) )
		if(pose.lookat) node.lookAt(...unroll(pose.lookat) )
		if(pose.love) node.love.set(...unroll(pose.love) )
	}

	// rewrite into manifest ... allows direct changes to live geometry ...
	// @todo there are some risks here; it may break expectations around publishing datagrams and original state
	if(true) {
		pose.position = node.position
		pose.rotation = node.rotation
		pose.scale = node.scale
		pose.quaternion = node.quaternion
		pose.lookat = node.lookAt
		pose.love = node.love
		pose.matrix = node.matrix
		pose.matrixWorld = node.matrixWorld
	}

	// force update for good luck
	node.updateMatrix()
	node.matrixWorldNeedsUpdate = true
}

///
/// displaceVertices
///
/// nudge vertices radially by a seeded random amount for a shattered / crystalline look.
/// displacement is keyed on vertex *position* so coincident vertices (non-indexed
/// polyhedron faces) move together and faces stay welded. deterministic per seed so
/// networked clients generate identical geometry.
///

export function displaceVertices(geometry, amount = 0.15, seed = 1) {
	const pos = geometry.attributes.position
	if(!pos) return
	for(let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
		const h = Math.abs(Math.sin(x*127.1 + y*311.7 + z*74.7 + seed*13.131) * 43758.5453) % 1
		const s = 1 + (h - 0.5) * 2 * amount
		pos.setXYZ(i, x*s, y*s, z*s)
	}
	pos.needsUpdate = true
}

// scratch matrix — guarded so this module is importable on the server, where THREE is null
const matrix = THREE ? new THREE.Matrix4() : null

///
/// poseUpdate
///
/// update pose
/// update multiple instancing
///

export function poseUpdate(surface,volume) {

	// due to live binding nothing is needed for most volumes
	if(!volume.instances || !volume.url) {
		return
	}

	// hmm
	if(!volume.node) {
		return
	}

	// find instance binding
	let group = surface.groups[volume.url]
	if(!group) {
		return
	}

	// update because not attached to scene
	volume.node.updateMatrix()

	// update the parts of the instanced mesh
	group.instancemeshes.forEach(mesh=>{
		mesh.setMatrixAt(volume.instanceindex,volume.node.matrix)
		//mesh.setMatrixAt(volume.instanceindex,matrix)
		mesh.instanceMatrix.needsUpdate = true
	})
}

export function updateGroups(surface) {
	const groups = surface.groups
	if(!groups) return
	groups.forEach(group=>{
		updateGroup(surface,group.members[i])
	})
}
