
const uuid = '/orbital/orbital-volume'

const isServer = (typeof window === 'undefined') ? true : false

import camera from './handlers/camera.js'
import file from './handlers/file.js'
import layer from './handlers/layer.js'
import light from './handlers/light.js'
import line from './handlers/line.js'
import prim from './handlers/prim.js'
import scene from './handlers/scene.js'
import terrain from './handlers/terrain.js'
import vegetation from './handlers/vegetation.js'

import query from './volume_query.js'

const handlers = {
	camera,
	file,
	layer,
	light,
	line,
	scene,
	terrain,
	dem:terrain,
	vegetation,

	sphere:prim,
	cube:prim,
	box:prim,
	plane:prim,
	cylinder:prim,
	crystal:prim,
}

// @todo decide if this is good enough for a uuid - could be much better
let id = 1

// volume update helper
async function _update(bus,entity,delta) {

	// a change request or a new object @todo merge
	if(delta) {
		if(!delta.uuid) {
			// for now grant a new uuid (silent — was noisy console spam, one per entity)
			delta.uuid = delta._metadata ? `${delta._metadata.key}` : `volume-${id++}`
		}
		entity = this._entities[delta.uuid]
		if(!entity) {
			entity = this._entities[delta.uuid] = delta
			delta = null
		}
	}

	// allow registering a render handler - test
	if(entity.volume.handler) {
		handlers[entity.volume.geometry] = entity.volume.handler
	}

	// find handler for the type
	const handler = handlers[entity.volume.geometry] || entity.volume.handler
	if(!handler) {
		console.error(uuid,'no handler for',entity)
		return
	}

	// volume components have an associated 'surface'
	const name = entity.volume.surface || 'volume001'
	const surface = this._surfaces[name] || (this._surfaces[name] = {name,isServer})

	// update — handlers receive the bus first so they can publish back if they wish
	await handler(bus,surface,entity,delta)

	// remove after handling if desired
	if(entity.obliterate && entity.uuid) {
		delete this._entities[entity.uuid]
	}

}

async function resolve(blob,bus) {

	// Expose volume as a directly-callable service on the bus (bus.volume.query(...), etc).
	// This is the "install a service" pattern; the bus also offers bus.install(name,service),
	// but a plain assignment is fine here and idempotent across re-entry.
	bus.volume = this

	// visit all volume instances on tick
	if(blob.tick) {
		const entities = Object.values(this._entities)
		for(const entity of entities) {
			// entities marked { volume: { static: true } } are built once and
			// never revisited on tick — a large win for scenes with many
			// immobile parts (walls, floors, props). Live-bound pose mutation
			// still works (it writes straight into the three node), and
			// explicit { volume } deltas and obliterate still reach them.
			if(entity.volume.static && entity.volume._built && !entity.obliterate) continue
			await this._update(bus,entity,null)
		}
	}

	// visit one volume instance delta on explicit update request
	if(blob.volume) {
		await this._update(bus,null,blob)
	}
}



///
/// volume system
///
/// observe and react to volume components on entities
///
/// `id` identifies this listener to the bus (which keys on id, not uuid). `uuid` is retained
/// for human-readable logging and for any consumer that still references it.
///

export const volume_system = {
	id: uuid,
	uuid,
	resolve,
	query,
	_update,
	_entities: {},
	_surfaces: {},
	// public accessor so peers (input, audio) never reach into _surfaces internals
	surface: function(name='volume001') { return this._surfaces[name] },
}
