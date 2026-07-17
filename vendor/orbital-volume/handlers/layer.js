
import { getThree, ensureThree, buildMaterial, removeNode, poseBind } from './three-helper.js'

class PerlinNoise {
    constructor(seed=1234) {
        this.p = this.generatePermutation(seed);
    }

    generatePermutation(seed) {
        const p = [];
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }

        let n, swap;
        for (let i = 255; i > 0; i--) {
            n = Math.floor((seed % 1) * (i + 1));
            seed = seed * 16807 % 2147483647;
            swap = p[i];
            p[i] = p[n];
            p[n] = swap;
        }

        return p.concat(p); // Duplicate the array
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(t, a, b) {
        return a + t * (b - a);
    }

    grad(hash, x, y) {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
    }

    noise(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = this.fade(x);
        const v = this.fade(y);

        const aa = this.p[this.p[X] + Y];
        const ab = this.p[this.p[X] + Y + 1];
        const ba = this.p[this.p[X + 1] + Y];
        const bb = this.p[this.p[X + 1] + Y + 1];

        return this.lerp(v, this.lerp(u, this.grad(this.p[aa], x, y), this.grad(this.p[ba], x - 1, y)),
            this.lerp(u, this.grad(this.p[ab], x, y - 1), this.grad(this.p[bb], x - 1, y - 1)));
    }
}

function generateIslandElevationWithPerlin(size,seed=42) {
	const data = new Uint8Array(size*size)
	const noise = new PerlinNoise(seed)
	const noiseScale = 0.01; // Adjust for island size @todo hack - parameterize
	const elevationScale = 50; // Adjust for elevation height - @todo hack parameterize
	const centerX = size / 2
	const centerY = size / 2
	const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = x - centerX
			const dy = y - centerY
			const distance = Math.sqrt(dx * dx + dy * dy) / maxDistance
			const noiseValue = noise.noise(dx * noiseScale, dy * noiseScale)
			// Apply a radial gradient to create an island shape
			const radialGradient = Math.max(0, 1 - distance)
			const elevation = (noiseValue * 0.5 + 0.5) * radialGradient * elevationScale
			data[x + y * size] = elevation
		}
	}
	return data
}

async function generatePlane(volume,elevations) {

	const THREE = await ensureThree()
	if(!THREE) return

	const geometry = new THREE.PlaneGeometry(...volume.props)
	const vertices = geometry.attributes.position.array
	for (let i = 0, j = 0; i < vertices.length; i += 3, j++) {
		vertices[i + 2] = elevations[j]
	}
	geometry.computeVertexNormals()
	geometry.attributes.position.needsUpdate = true

	const material = buildMaterial(volume.material || null)

	const child = new THREE.Mesh(geometry, material) 

	// @todo - parameterize - force rotate for now to be flat and center
	child.rotation.set(-Math.PI/2,0,0)
	child.position.x += volume.props[0] / 2 
	child.position.z += volume.props[1] / 2 

	volume.node = new THREE.Group()
	volume.node.add(child)
}

export default async function layer(sys,surface,entity,delta) {

	const volume = entity.volume

	if(entity.obliterate) {
		removeNode(volume.node)
		return
	}

	if(volume._built) return
	volume._built = true

	if(volume.elevations || !surface.scene) return
	const width = volume.props[0]
	const height = volume.props[1]
	const elevations = volume.elevations = volume.elevations || generateIslandElevationWithPerlin(width,height)
	if(!surface.layers) surface.layers = []
	surface.layers.push({elevations,width})
	if(!surface.isServer) {
		await generatePlane(volume,elevations)
		poseBind(surface,volume)
	}
}
