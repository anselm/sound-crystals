
import { getThree, ensureThree, poseBind, poseUpdate } from './three-helper.js'
import { VegetationBatch } from './load-helpers/vegetation-batch.js'

///
/// vegetation handler
///
/// Renders an entire field of stalk-form plants (bamboo, reeds, saplings) as
/// two instanced draw calls - tapered node-ringed stalks plus alpha-tested
/// leaf crowns, with GPU wind. Thousands of animated plants cost roughly the
/// same as two meshes.
///
/// {
///   volume: {
///     geometry: 'vegetation',
///     vegetation: {
///       plants: [
///         { xyz:[x,y,z], height: 12, radius: 0.08, color: 0x6a8f3c,
///           tilt: [direction, angle],   // optional lean, radians
///           crown: true },              // optional false = no foliage
///         ...
///       ],
///       dirty: true,          // set true after mutating plants; cleared here
///       capacity: 4096,       // optional
///       crownFraction: 0.87,  // optional - crown center vs plant height
///       crownMinHeight: 1.5,  // optional - shorter plants have no crown
///       crownMaxScale: 2.9,   // optional
///       leafColor: 0x9cbd60,  // optional
///     },
///     pose: { position: [0,0,0] }
///   }
/// }
///
/// Mutate the plants array in place (grow heights, change colors, add or
/// remove plants) and set vegetation.dirty = true; the next tick uploads the
/// changes. Wind runs continuously on the GPU either way.
///

export default async function vegetation(sys, surface, entity, delta) {

	const THREE = await ensureThree()
	if (!THREE) return

	const volume = entity.volume
	const props = volume.vegetation || {}

	if (entity.obliterate) {
		if (volume._batch) {
			volume._batch.dispose()
			volume._batch = null
		}
		volume.node = null
		return
	}

	if (!volume._built) {
		volume._built = true
		const batch = volume._batch = new VegetationBatch(props)
		volume.node = batch.node
		props.dirty = true
		poseBind(surface, volume)
	} else {
		poseUpdate(surface, volume)
	}

	const batch = volume._batch
	if (!batch) return

	batch.setTime(performance.now() / 1000)

	if (props.dirty) {
		props.dirty = false
		batch.commit(props.plants || [])
	}
}
