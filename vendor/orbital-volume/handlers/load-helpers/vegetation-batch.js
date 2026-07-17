
import { getThree, markSRGB } from '../three-helper.js'

///
/// VegetationBatch - renders an entire field of stalk-form plants (bamboo,
/// reeds, saplings) in two instanced draw calls:
///
///   1. stalks - one InstancedMesh of a tapered, node-ringed stem (unit
///      height, scaled per instance), per-instance color, GPU wind sway
///   2. crowns - one InstancedMesh of a leaf cluster made of alpha-tested
///      crossed quads with a procedurally painted frond texture atlas
///
/// Growth/animation is expressed by rewriting instance matrices - geometry is
/// never rebuilt. Tens of thousands of plants render at interactive rates.
///

const STALK_RADIAL_SEGMENTS = 8
const STALK_INTERNODES = 9

function mulberry32(seed) {
	let a = seed >>> 0
	return function () {
		a |= 0; a = (a + 0x6D2B79F5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

// ---------------------------------------------------------------------------
// stalk geometry - lathe profile with node collars, unit height (y: 0..1),
// unit base radius; vertex colors darken the collars so they read even
// though extreme non-uniform instance scaling flattens normal detail
// ---------------------------------------------------------------------------

function buildStalkGeometry(THREE) {
	const points = []
	const bandColors = []

	const taper = (y) => 1.0 - 0.55 * Math.pow(y, 1.35)

	for (let i = 0; i < STALK_INTERNODES; i++) {
		const y0 = i / STALK_INTERNODES
		const r = taper(y0)
		points.push(new THREE.Vector2(r * 1.0, y0)); bandColors.push(0.92)
		points.push(new THREE.Vector2(r * 1.14, y0 + 0.004)); bandColors.push(0.58)
		points.push(new THREE.Vector2(r * 1.14, y0 + 0.014)); bandColors.push(0.62)
		points.push(new THREE.Vector2(r * 1.0, y0 + 0.024)); bandColors.push(1.05)
		const ym = y0 + 0.5 / STALK_INTERNODES
		points.push(new THREE.Vector2(taper(ym), ym)); bandColors.push(1.0)
	}
	points.push(new THREE.Vector2(taper(1.0), 1.0)); bandColors.push(0.95)
	points.push(new THREE.Vector2(0.001, 1.005)); bandColors.push(0.9)

	const geometry = new THREE.LatheGeometry(points, STALK_RADIAL_SEGMENTS)

	// flatten normals to pure radial: instance scale is wildly non-uniform
	// (radius ~0.1 vs height ~30) which would skew shading otherwise
	const pos = geometry.attributes.position
	const nrm = geometry.attributes.normal
	const colors = new Float32Array(pos.count * 3)
	const profileLen = points.length
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i), z = pos.getZ(i)
		const len = Math.sqrt(x * x + z * z) || 1
		nrm.setXYZ(i, x / len, 0, z / len)
		const band = bandColors[i % profileLen]
		colors[i * 3] = Math.min(1, band * 1.02)
		colors[i * 3 + 1] = Math.min(1, band)
		colors[i * 3 + 2] = Math.min(1, band * 0.82)
	}
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
	return geometry
}

// ---------------------------------------------------------------------------
// frond texture - two painted leaf-cluster variants side by side in an atlas
// ---------------------------------------------------------------------------

function paintLeaf(ctx, x, y, angle, length, width, hue, sat, lit) {
	ctx.save()
	ctx.translate(x, y)
	ctx.rotate(angle)
	const grad = ctx.createLinearGradient(0, 0, length, 0)
	grad.addColorStop(0, `hsl(${hue}, ${sat}%, ${Math.max(12, lit - 8)}%)`)
	grad.addColorStop(0.6, `hsl(${hue}, ${sat}%, ${lit}%)`)
	grad.addColorStop(1, `hsl(${hue + 10}, ${sat - 8}%, ${lit + 9}%)`)
	ctx.fillStyle = grad
	ctx.beginPath()
	ctx.moveTo(0, 0)
	ctx.quadraticCurveTo(length * 0.42, -width, length, 0)
	ctx.quadraticCurveTo(length * 0.42, width, 0, 0)
	ctx.closePath()
	ctx.fill()
	ctx.strokeStyle = `hsla(${hue - 6}, ${sat}%, ${Math.max(10, lit - 12)}%, 0.5)`
	ctx.lineWidth = 1
	ctx.beginPath()
	ctx.moveTo(0, 0)
	ctx.lineTo(length * 0.96, 0)
	ctx.stroke()
	ctx.restore()
}

function paintFrondVariant(ctx, ox, oy, w, h, rand) {
	const fronds = 7
	for (let f = 0; f < fronds; f++) {
		const baseAngle = -Math.PI / 2 + (f / (fronds - 1) - 0.5) * 2.4 + (rand() - 0.5) * 0.3
		const frondLen = h * (0.52 + rand() * 0.3)
		const sx = ox + w * 0.5 + (rand() - 0.5) * w * 0.14
		const sy = oy + h * 0.94
		const ex = sx + Math.cos(baseAngle) * frondLen
		const ey = sy + Math.sin(baseAngle) * frondLen * 0.9
		ctx.strokeStyle = `hsla(${70 + rand() * 20}, 30%, 32%, 0.85)`
		ctx.lineWidth = 2
		ctx.beginPath()
		ctx.moveTo(sx, sy)
		ctx.quadraticCurveTo(sx + Math.cos(baseAngle) * frondLen * 0.5,
			sy + Math.sin(baseAngle) * frondLen * 0.5 - 6, ex, ey)
		ctx.stroke()
		const leaves = 6 + Math.floor(rand() * 3)
		for (let l = 0; l < leaves; l++) {
			const t = 0.4 + 0.6 * (l / leaves) + rand() * 0.05
			const lx = sx + Math.cos(baseAngle) * frondLen * t
			const ly = sy + Math.sin(baseAngle) * frondLen * t - 6 * Math.sin(Math.PI * t)
			const side = (l % 2 === 0) ? 1 : -1
			const droop = 0.45 + rand() * 0.5
			const leafAngle = baseAngle + side * (0.5 + rand() * 0.45) + droop * 0.4
			const hue = 72 + rand() * 34
			const sat = 30 + rand() * 26
			const lit = 32 + rand() * 26
			paintLeaf(ctx, lx, ly, leafAngle,
				h * (0.19 + rand() * 0.12), h * (0.022 + rand() * 0.014), hue, sat, lit)
		}
	}
}

function buildLeafTexture(THREE) {
	const W = 512, H = 256
	const canvas = document.createElement('canvas')
	canvas.width = W; canvas.height = H
	const ctx = canvas.getContext('2d')
	ctx.clearRect(0, 0, W, H)
	paintFrondVariant(ctx, 0, 0, W / 2, H, mulberry32(101))
	paintFrondVariant(ctx, W / 2, 0, W / 2, H, mulberry32(707))
	const texture = markSRGB(new THREE.CanvasTexture(canvas))
	texture.anisotropy = 4
	return texture
}

// ---------------------------------------------------------------------------
// crown geometry - a cluster of crossed quads around the origin, hand-built
// (position/normal/uv/color/index) so we avoid the BufferGeometryUtils
// dependency; inner quads carry darker vertex colors as fake occlusion
// ---------------------------------------------------------------------------

function buildCrownGeometry(THREE) {
	const rand = mulberry32(4242)
	const positions = [], normals = [], uvs = [], colors = [], indices = []
	let vertexBase = 0

	const pushQuad = (center, yaw, tilt, w, h, variant, ao) => {
		// quad corners in local plane space, then rotated by tilt (z) and yaw (y)
		const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
		const cosT = Math.cos(tilt), sinT = Math.sin(tilt)
		const corners = [
			[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]
		]
		const uvCorners = [[0, 0], [1, 0], [1, 1], [0, 1]]
		// plane normal before yaw: rotate +z by tilt about z-axis has no effect
		// on +z; tilt is applied to the plane's local x/y, normal stays ~[sinY,0,cosY]
		for (let c = 0; c < 4; c++) {
			let [px, py] = corners[c]
			// tilt in plane (rotate about the plane's own z/facing axis)
			const tx = px * cosT - py * sinT
			const ty = px * sinT + py * cosT
			// yaw about world y
			const wx = tx * cosY
			const wz = -tx * sinY
			positions.push(center[0] + wx, center[1] + ty, center[2] + wz)
			normals.push(sinY, 0, cosY)
			uvs.push(uvCorners[c][0] * 0.5 + variant * 0.5, uvCorners[c][1])
			colors.push(ao, ao, ao)
		}
		indices.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase, vertexBase + 2, vertexBase + 3)
		vertexBase += 4
	}

	// fountain-shaped crown: a small plume covering the tip, then rings of
	// plumes spreading wider and larger further down the stalk, so foliage
	// drapes along the upper third instead of pooling in one puff at the top
	const rings = [
		{ count: 1, py: 0.42, radius: 0.05, scale: 0.85 },
		{ count: 3, py: -0.15, radius: 0.35, scale: 1.15 },
		{ count: 3, py: -0.95, radius: 0.6, scale: 1.45 },
		{ count: 3, py: -1.85, radius: 0.55, scale: 1.3 }
	]
	rings.forEach((ring) => {
		for (let p = 0; p < ring.count; p++) {
			const angle = (p / ring.count) * Math.PI * 2 + rand() * 2.0
			const radius = ring.radius * (0.7 + rand() * 0.6)
			const px = Math.cos(angle) * radius
			const pz = Math.sin(angle) * radius
			const py = ring.py + (rand() - 0.5) * 0.45
			const scale = ring.scale * (0.85 + rand() * 0.3)
			const variant = rand() < 0.5 ? 0 : 1
			const ao = Math.min(1, 0.68 + (radius + Math.max(0, py + 2) * 0.12) * 0.25)
			for (let c = 0; c < 2; c++) {
				pushQuad([px, py, pz],
					angle + c * Math.PI / 2 + rand() * 0.5,
					(rand() - 0.5) * 0.35,
					1.7 * scale, 1.0 * scale, variant, ao)
			}
		}
	})

	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
	geometry.setIndex(indices)
	return geometry
}

// ---------------------------------------------------------------------------
// wind - injected into standard materials; stalks bend as height^2 with
// amplitude derived from the instance's own height, crowns follow via a
// per-instance amplitude attribute plus high-frequency flutter
// ---------------------------------------------------------------------------

function injectStalkWind(material, uniforms) {
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = uniforms.uTime
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;')
			.replace('#include <project_vertex>', `
				vec4 _wpos = vec4( transformed, 1.0 );
				#ifdef USE_INSTANCING
					_wpos = instanceMatrix * _wpos;
					float _hf = clamp( position.y, 0.0, 1.0 );
					float _amp = instanceMatrix[1][1] * 0.02;
					_wpos.x += sin( uTime * 1.3 + aPhase ) * _amp * _hf * _hf;
					_wpos.z += cos( uTime * 1.05 + aPhase * 1.7 ) * _amp * _hf * _hf;
				#endif
				vec4 mvPosition = modelViewMatrix * _wpos;
				gl_Position = projectionMatrix * mvPosition;
			`)
	}
}

function injectCrownWind(material, uniforms) {
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = uniforms.uTime
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;\nattribute float aAmp;')
			.replace('#include <project_vertex>', `
				vec4 _wpos = vec4( transformed, 1.0 );
				#ifdef USE_INSTANCING
					_wpos = instanceMatrix * _wpos;
					_wpos.x += sin( uTime * 1.3 + aPhase ) * aAmp;
					_wpos.z += cos( uTime * 1.05 + aPhase * 1.7 ) * aAmp;
					_wpos.y += sin( uTime * 3.9 + aPhase * 3.1 + position.x * 2.0 ) * ( 0.05 + aAmp * 0.12 );
				#endif
				vec4 mvPosition = modelViewMatrix * _wpos;
				gl_Position = projectionMatrix * mvPosition;
			`)
	}
}

// ---------------------------------------------------------------------------

export class VegetationBatch {

	///
	/// options:
	///   capacity            max plants (default 4096)
	///   crownFraction       crown center as fraction of plant height (0.87)
	///   crownMinHeight      plants shorter than this have no crown (1.5)
	///   crownMaxScale       crown scale clamp (2.9)
	///   leafColor           hex leaf tint that plant colors are pulled toward
	///
	constructor(options = {}) {
		const THREE = this.THREE = getThree()
		if (!THREE) throw new Error('VegetationBatch is client-side only')

		this.capacity = options.capacity || 4096
		this.crownFraction = options.crownFraction !== undefined ? options.crownFraction : 0.92
		this.crownMinHeight = options.crownMinHeight !== undefined ? options.crownMinHeight : 1.5
		this.crownMaxScale = options.crownMaxScale !== undefined ? options.crownMaxScale : 2.9
		this.leafColor = new THREE.Color(options.leafColor !== undefined ? options.leafColor : 0x9cbd60)

		this.uniforms = { uTime: { value: 0 } }
		this.count = 0

		this._matrix = new THREE.Matrix4()
		this._position = new THREE.Vector3()
		this._quaternion = new THREE.Quaternion()
		this._euler = new THREE.Euler()
		this._scale = new THREE.Vector3()
		this._color = new THREE.Color()
		this._offset = new THREE.Vector3()
		this._zero = new THREE.Matrix4().makeScale(0, 0, 0)

		this.stalkGeometry = buildStalkGeometry(THREE)
		this.crownGeometry = buildCrownGeometry(THREE)
		this.leafTexture = buildLeafTexture(THREE)

		const stalkMaterial = new THREE.MeshPhongMaterial({
			vertexColors: true,
			color: 0xffffff,
			shininess: 24,
			specular: 0x233420
		})
		injectStalkWind(stalkMaterial, this.uniforms)

		this.stalkMesh = new THREE.InstancedMesh(this.stalkGeometry, stalkMaterial, this.capacity)
		this.stalkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		this.stalkMesh.castShadow = true
		this.stalkMesh.receiveShadow = true
		this.stalkMesh.frustumCulled = false
		this.stalkMesh.count = 0

		// emissive reuses the leaf texture - cheap stand-in for light
		// scattering through a real canopy so shaded leaves stay green
		const crownMaterial = new THREE.MeshLambertMaterial({
			map: this.leafTexture,
			vertexColors: true,
			alphaTest: 0.45,
			side: THREE.DoubleSide,
			emissive: 0x51682e,
			emissiveMap: this.leafTexture,
			emissiveIntensity: 0.55
		})
		injectCrownWind(crownMaterial, this.uniforms)

		this.crownMesh = new THREE.InstancedMesh(this.crownGeometry, crownMaterial, this.capacity)
		this.crownMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		this.crownMesh.castShadow = true
		this.crownMesh.frustumCulled = false
		this.crownMesh.count = 0
		this.crownMesh.customDepthMaterial = new THREE.MeshDepthMaterial({
			depthPacking: THREE.RGBADepthPacking,
			map: this.leafTexture,
			alphaTest: 0.45
		})

		this.phases = new Float32Array(this.capacity)
		this.amps = new Float32Array(this.capacity)
		for (let i = 0; i < this.capacity; i++) this.phases[i] = (i * 2.399963) % (Math.PI * 2)
		const phaseAttr = new THREE.InstancedBufferAttribute(this.phases, 1)
		const ampAttr = new THREE.InstancedBufferAttribute(this.amps, 1)
		ampAttr.setUsage(THREE.DynamicDrawUsage)
		this.stalkGeometry.setAttribute('aPhase', phaseAttr)
		this.crownGeometry.setAttribute('aPhase', phaseAttr)
		this.crownGeometry.setAttribute('aAmp', ampAttr)

		for (let i = 0; i < this.capacity; i++) {
			this.stalkMesh.setMatrixAt(i, this._zero)
			this.crownMesh.setMatrixAt(i, this._zero)
		}
		this.stalkMesh.setColorAt(0, this._color.setHex(0xffffff))
		this.crownMesh.setColorAt(0, this._color.setHex(0xffffff))

		this.node = new THREE.Group()
		this.node.add(this.stalkMesh)
		this.node.add(this.crownMesh)
	}

	///
	/// write the full plant list into the instance buffers
	///
	/// each plant: {
	///   xyz: [x,y,z]      base position (local to the batch node)
	///   height            meters
	///   radius            base radius in meters (default height * 0.005)
	///   color             stalk hex color
	///   tilt: [dir,angle] optional lean, radians
	///   crown             optional false to suppress foliage
	/// }
	///

	commit(plants) {
		const n = Math.min(plants.length, this.capacity)
		if (plants.length > this.capacity) {
			console.warn('VegetationBatch: capacity', this.capacity, 'exceeded,', plants.length - this.capacity, 'plants dropped')
		}

		for (let i = 0; i < n; i++) {
			const plant = plants[i]
			const height = Math.max(plant.height || 0, 0.001)
			const radius = Math.max(plant.radius !== undefined ? plant.radius : height * 0.005, 0.008)
			const tiltDir = plant.tilt ? plant.tilt[0] : 0
			const tiltAngle = plant.tilt ? plant.tilt[1] : 0

			this._euler.set(tiltAngle, tiltDir, 0, 'YXZ')
			this._quaternion.setFromEuler(this._euler)
			this._position.set(plant.xyz[0], plant.xyz[1], plant.xyz[2])
			this._scale.set(radius, height, radius)
			this._matrix.compose(this._position, this._quaternion, this._scale)
			this.stalkMesh.setMatrixAt(i, this._matrix)
			this.stalkMesh.setColorAt(i, this._color.setHex(plant.color !== undefined ? plant.color : 0x7a8f4a))

			if (plant.crown !== false && height > this.crownMinHeight) {
				const crownScale = Math.min(0.55 + height * 0.1, this.crownMaxScale)
				this._offset.set(0, height * this.crownFraction, 0).applyQuaternion(this._quaternion)
				this._position.set(
					plant.xyz[0] + this._offset.x,
					plant.xyz[1] + this._offset.y,
					plant.xyz[2] + this._offset.z)
				this._scale.setScalar(crownScale)
				this._matrix.compose(this._position, this._quaternion, this._scale)
				this.crownMesh.setMatrixAt(i, this._matrix)
				// leaf tint: stalk color pulled toward leaf green - but only
				// partially, so a golden or gray-bloom stalk keeps a visibly
				// different crown - plus a deterministic per-crown wobble
				this._color.setHex(plant.color !== undefined ? plant.color : 0x7a8f4a).lerp(this.leafColor, 0.6)
				const w = Math.sin(i * 78.233) * 43758.5453
				const wobble = w - Math.floor(w)
				this._color.offsetHSL((wobble - 0.5) * 0.06, (wobble - 0.5) * 0.14, (wobble - 0.5) * 0.14)
				this.crownMesh.setColorAt(i, this._color)
				this.amps[i] = 0.013 * height
			} else {
				this.crownMesh.setMatrixAt(i, this._zero)
				this.amps[i] = 0
			}
		}

		// clear any slots beyond the new count
		for (let i = n; i < this.count; i++) {
			this.stalkMesh.setMatrixAt(i, this._zero)
			this.crownMesh.setMatrixAt(i, this._zero)
		}
		this.count = n

		this.stalkMesh.count = n
		this.crownMesh.count = n
		this.stalkMesh.instanceMatrix.needsUpdate = true
		this.crownMesh.instanceMatrix.needsUpdate = true
		if (this.stalkMesh.instanceColor) this.stalkMesh.instanceColor.needsUpdate = true
		if (this.crownMesh.instanceColor) this.crownMesh.instanceColor.needsUpdate = true
		this.crownGeometry.attributes.aAmp.needsUpdate = true
	}

	setTime(seconds) {
		this.uniforms.uTime.value = seconds
	}

	dispose() {
		this.node.removeFromParent()
		this.stalkMesh.dispose()
		this.crownMesh.dispose()
		this.stalkGeometry.dispose()
		this.crownGeometry.dispose()
		this.leafTexture.dispose()
	}
}
