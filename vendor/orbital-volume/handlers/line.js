import { ensureThree, removeNode } from './three-helper.js'

//
// line handler — a polyline in world space.
//
//   { volume: {
//       geometry: 'line',
//       points: [[x,y,z], ...],       // 2+ points
//       material: { color, opacity, transparent, dashed },
//       rev: 0,                        // bump to have the tick revisit rebuild
//   } }
//
// Unlike posed primitives, a line's truth is its point list, so updates go
// through data rather than a live-bound pose: mutate volume.points and bump
// volume.rev; the next tick rebuilds the geometry. An empty/short point list
// hides the line without removing it.
//

export default async function line(sys, surface, entity, delta) {

	const THREE = await ensureThree()
	if(!THREE) return

	const volume = entity.volume

	if(entity.obliterate) {
		removeNode(volume.node)
		return
	}

	// rebuild on rev bump
	if(volume._built) {
		if(volume.rev === volume._rev) return
		volume._rev = volume.rev
		const pts = (volume.points || []).map(p => new THREE.Vector3(...p))
		volume.node.visible = pts.length >= 2
		if(pts.length >= 2) {
			volume.node.geometry.dispose()
			volume.node.geometry = new THREE.BufferGeometry().setFromPoints(pts)
			if(volume.node.material.isLineDashedMaterial) volume.node.computeLineDistances()
		}
		return
	}
	volume._built = true
	volume._rev = volume.rev

	const m = volume.material || {}
	const material = m.dashed
		? new THREE.LineDashedMaterial({ color: m.color ?? 0xffffff, dashSize: m.dashSize ?? 0.6,
			gapSize: m.gapSize ?? 0.4, transparent: true, opacity: m.opacity ?? 1 })
		: new THREE.LineBasicMaterial({ color: m.color ?? 0xffffff,
			transparent: m.transparent ?? (m.opacity !== undefined), opacity: m.opacity ?? 1 })

	const pts = (volume.points || []).map(p => new THREE.Vector3(...p))
	const geometry = new THREE.BufferGeometry().setFromPoints(pts.length >= 2 ? pts : [new THREE.Vector3(), new THREE.Vector3()])
	const node = volume.node = new THREE.Line(geometry, material)
	if(m.dashed) node.computeLineDistances()
	node.visible = pts.length >= 2
	if(surface.scene) surface.scene.add(node)
}
