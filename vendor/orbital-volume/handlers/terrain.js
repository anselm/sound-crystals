
import { getThree, ensureThree, removeNode, poseBind, poseUpdate, markSRGB } from './three-helper.js'
import { getElevationGrid, getSatelliteCanvas } from './load-helpers/terrain-tiles.js'

///
/// terrain handler
///
/// Renders a heightfield terrain, optionally draped with satellite imagery.
/// Elevation data can be supplied directly or fetched from web tile services
/// by lat/lon bounds (Terrarium elevation tiles + ArcGIS world imagery by
/// default - see load-helpers/terrain-tiles.js).
///
/// {
///   volume: {
///     geometry: 'terrain',
///     terrain: {
///       // option 1: fetch from web tiles
///       bounds: { north, south, east, west },
///       zoom: 14,                  // optional, auto-derived from bounds
///       satellite: true,           // drape satellite imagery
///
///       // option 2: supply a raw grid instead of bounds
///       elevations: Float32Array,  // row-major, width*height samples (meters)
///       width: 256, height: 256,
///
///       size: [100, 100],          // rendered width/depth in scene units
///       heightScale: 1.0,          // vertical scale applied to (elev - minElev)
///       color: 0x8b7355,           // material color when no satellite drape
///     },
///     pose: { position: [0,0,0] }
///   }
/// }
///
/// After building, the handler adds to the terrain component:
///   terrain.ready = true
///   terrain.minElev / terrain.maxElev (meters)
///   terrain.sample(x, z) -> scene-space height at node-local x/z, or 0 outside
///
/// The sampler is the piece other systems typically want - e.g. planting
/// vegetation or buildings on the surface.
///

export default async function terrain(sys, surface, entity, delta) {

	const THREE = await ensureThree()
	if (!THREE) return

	const volume = entity.volume

	if (entity.obliterate) {
		removeNode(volume.node)
		return
	}

	if (volume._built) {
		poseUpdate(surface, volume)
		return
	}
	volume._built = true

	const props = volume.terrain || {}
	const size = props.size || [100, 100]
	const heightScale = props.heightScale !== undefined ? props.heightScale : 1.0

	// resolve elevation data
	let grid = null
	let satellite = null
	if (props.elevations && props.width && props.height) {
		grid = { elevations: props.elevations, width: props.width, height: props.height }
		let minElev = Infinity, maxElev = -Infinity
		for (let i = 0; i < grid.elevations.length; i++) {
			if (grid.elevations[i] < minElev) minElev = grid.elevations[i]
			if (grid.elevations[i] > maxElev) maxElev = grid.elevations[i]
		}
		grid.minElev = minElev
		grid.maxElev = maxElev
	} else if (props.bounds) {
		try {
			grid = await getElevationGrid(props.bounds, props)
		} catch (error) {
			console.error('orbital/orbital-volume/terrain - elevation fetch failed', error)
			return
		}
		if (props.satellite) {
			try {
				satellite = await getSatelliteCanvas(props.bounds, props)
			} catch (error) {
				console.warn('orbital/orbital-volume/terrain - satellite fetch failed', error)
			}
		}
	} else {
		console.error('orbital/orbital-volume/terrain - needs terrain.bounds or terrain.elevations')
		return
	}

	// displaced plane, centered on the node origin
	const geometry = new THREE.PlaneGeometry(size[0], size[1], grid.width - 1, grid.height - 1)
	const vertices = geometry.attributes.position.array
	for (let i = 0; i < grid.elevations.length; i++) {
		vertices[i * 3 + 2] = (grid.elevations[i] - grid.minElev) * heightScale
	}
	geometry.computeVertexNormals()
	geometry.rotateX(-Math.PI / 2)

	let material
	if (satellite) {
		const texture = markSRGB(new THREE.CanvasTexture(satellite.canvas))
		texture.anisotropy = 8
		material = new THREE.MeshPhongMaterial({ map: texture, shininess: 4, specular: 0x111111 })
	} else {
		material = new THREE.MeshPhongMaterial({ color: props.color !== undefined ? props.color : 0x8b7355 })
	}

	const node = volume.node = new THREE.Mesh(geometry, material)
	node.receiveShadow = true

	// publish results back onto the component
	props.minElev = grid.minElev
	props.maxElev = grid.maxElev
	props.ready = true
	props.sample = (x, z) => {
		// node-local coords: x in [-size[0]/2, size[0]/2], z likewise
		const nx = (x + size[0] / 2) / size[0]
		const nz = (z + size[1] / 2) / size[1]
		if (nx < 0 || nx > 1 || nz < 0 || nz > 1) return 0
		const px = nx * (grid.width - 1)
		const pz = nz * (grid.height - 1)
		const x0 = Math.floor(px), x1 = Math.min(x0 + 1, grid.width - 1)
		const z0 = Math.floor(pz), z1 = Math.min(z0 + 1, grid.height - 1)
		const fx = px - x0, fz = pz - z0
		const v00 = grid.elevations[z0 * grid.width + x0]
		const v10 = grid.elevations[z0 * grid.width + x1]
		const v01 = grid.elevations[z1 * grid.width + x0]
		const v11 = grid.elevations[z1 * grid.width + x1]
		const v0 = v00 * (1 - fx) + v10 * fx
		const v1 = v01 * (1 - fx) + v11 * fx
		return ((v0 * (1 - fz) + v1 * fz) - grid.minElev) * heightScale
	}

	poseBind(surface, volume)
}
