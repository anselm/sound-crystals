
///
/// @todo this needs revisiting - i need a portable way of doing queries without polluting process isolation
///
/// spatial query support
/// supports both querying bitmap layers and also 3d objects
/// currently unoptimized
/// later will use sparse voxel octree
///

export default function query(props) {

	const callback = props.callback

	const entities = this._entities

	/////////////////////////////////////////////////////////////////////////////////////////////////////
	//
	// layer queries (into bitmaps) are performed separately / disjointly with any other query
	// @todo this needs to be generalized
	// @todo it is absurdly expensive to find some random locations in this way - improve
	//
	/////////////////////////////////////////////////////////////////////////////////////////////////////

	if(props.hasOwnProperty('minElevation')) {

		const minElevation = props.minElevation || 0
		const maxElevation = props.maxElevation || Infinity
		const order = props.order
		const limit = props.limit

		// @todo sloppy to just get first one
		const surfaces = Object.values(this._surfaces)
		if(!surfaces.length || !surfaces[0].layers || !surfaces[0].layers.length) return
		const layer = surfaces[0].layers[0]
		const data = layer.elevations
		const size = layer.width

		let positions = [];

		for (let z = 0; z < size; z++) {
			for (let x = 0; x < size; x++) {
				const index = x + z * size;
				if (index >= data.length) {
					console.error(`Index out of range: ${index}, layer length: ${data.length}`);
					continue;
				}
				const y = data[index];
				if (y >= minElevation && y <= maxElevation) {
					positions.push({ x,y,z })
				}
			}
		}

		// always randomly sort the collection
		// https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array

		const shuffle = (array) => {
			let currentIndex = array.length
			while (currentIndex != 0) {
				let randomIndex = Math.floor(Math.random() * currentIndex)
				currentIndex--
				[array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]]
			}
		}
		shuffle(positions)

		// also filter by a position?
		if(props.position) {
			const maxDistance = 20
			positions = positions.filter(xyz => 
				Math.abs(xyz.x - props.position.x) <= maxDistance &&
				Math.abs(xyz.z - props.position.z) <= maxDistance
			)
		}

		// nothing?
		if(!positions.length) return

		// return the desired number of candidates
		for(let i = 0; i < limit; i++) {
			const randomIndex = Math.floor(Math.random() * positions.length);
			const position = positions[randomIndex];
			if(callback) callback(position,i)
		}

		// do not fall thru - but do return the positions also
		return positions
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////
	//
	// for non layer searches optionally pre-filter candidates
	// @todo note it is expensive to do this; hashing of components would help
	// @todo note this also duplicates some of the query capabilities of other components
	//
	/////////////////////////////////////////////////////////////////////////////////////////////////////

	const query_matches = (args,candidate) => {
		for (const [key,val] of Object.entries(args)) {
			if(!candidate.hasOwnProperty(key)) return false
			if(candidate[key] instanceof Object) continue
			if(candidate[key]!==val) return false
		}
		return true
	}

	let candidates = []

	if(props.filter) {
		Object.values(entities).forEach(entity => {
			if(query_matches(props.filter,entity)) {
				candidates.push(entity)
			}
		})
	} else {
		candidates = Object.values(entities)
	}

	// return nothing if no candidates

	if(!candidates.length) {
		return []
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////
	//
	// return all candidates if no other filters
	//
	/////////////////////////////////////////////////////////////////////////////////////////////////////

	if(!props.position) {
		candidates.forEach(entity=>{
			if(callback)callback(entity)
		})
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////
	//
	// else explicitly look at position and return nearest spatial match only
	// @todo note a real spatial hash would be less costly
	//
	/////////////////////////////////////////////////////////////////////////////////////////////////////

	else {

		const position = props.position
		let minDistance = props.radius || Infinity
		let nearestEntity = null

		candidates.forEach(entity => {
			const distance = Math.sqrt(
				Math.pow(position.x - entity.volume.pose.position.x, 2) +
				Math.pow(position.y - entity.volume.pose.position.y, 2) +
				Math.pow(position.z - entity.volume.pose.position.z, 2)
			)
			if (distance < minDistance) {
				minDistance = distance
				nearestEntity = entity
			}
		})

		if(nearestEntity) {
			if(callback)callback(nearestEntity)
		}
	}

	// also return the candidates as a convenience
	return candidates
}
