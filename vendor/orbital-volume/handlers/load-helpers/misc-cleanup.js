
function _cleanup(key,clip,node) {

	if(!key || !clip || !clip.tracks || !node) {
		console.error("orbital-volume/load/misc-cleanup - bad clip",key,clip,node)
		return
	}

	// remove mixamo prefix?
	clip.tracks.forEach((track) => {
		if(track.name.startsWith('mixamo')) {

			// patch scene itself
			const trackSplitted = track.name.split('.')
			const rigNodeName = trackSplitted[0]
			const node = node ? node.getObjectByName(rigNodeName) : null
			if(node) {
				node.name = rigNodeName
			}

			//console.log("puppet body - removing mixamo from",key,track.name)
			track.name = track.name.slice(9)

		}
	})

	// remove tips
	// remove the head from default only because it fights gaze() - @todo may not need to do this depending on timing
	// the last is a test for the stone glb @todo remove
	const rewrite = []
	clip.tracks.forEach(track => {
		if(key == "default" && track.name == 'Head.quaternion') return
		if(track.name.endsWith("_end.scale")) return
		if(track.name.endsWith("_end.position")) return
		if(track.name.endsWith("_end.quaternion")) return
		if(track.name.includes("_rootJoint.quaternion")) return
		if(track.name.includes("root_joint_00.quaternion")) return
		rewrite.push(track)
	})

	clip.tracks = rewrite
}

///
/// scan volume.clumps (animation clips)
/// there are some things i just don't like in the animation data - see above
///

export function misc_cleanup(node,clumps) {
	if(!node || !clumps) return
	Object.entries(clumps).forEach(([key,clump]) => {
		clump.forEach(clip => { _cleanup(key,clip,node) } )
	})
}

