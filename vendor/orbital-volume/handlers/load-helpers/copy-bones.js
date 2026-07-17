
import { getThree } from '../three-helper.js'

import { RPMBody2Reallusion } from './RPMBody2Reallusion.js'

export function copy_bones(node,vrm=null) {

	const bones = {}

	if(!node) return bones
	const THREE = getThree()
	if(!THREE) return bones

	// collect all bones
	node.traverse((child) => {
		if(!child || !child.name || child.type !== 'Bone') return
		bones[child.name] = child
	})

	// also map reallusion bones to rpm namespace
	const reallusion = node.getObjectByName("CC_Base_Head") ? true : false
	if(reallusion) {
		Object.entries(RPMBody2Reallusion).forEach( ([k,v]) => {
			const o = node.getObjectByName(reallusion?v:k)
			if(!o) {
				console.error("puppet - copy bones - cannot find part in rig",v,node)
			} else {
				// @todo the bones could be renamed for the animation engine to support reallusion rigs as is
				// o.name = k
				bones[k] = o
			}
		})
	}

	// overlay vrm normalized bones in rpm name space
	if(vrm) {
		bones.armature = vrm.humanoid.normalizedHumanBonesRoot
		Object.entries(VRM2Mixamo).forEach( ([k,v]) => {
			bones[k] = v
			bones[v] = vrm.humanoid.getNormalizedBoneNode(k) || {
				position: new THREE.Vector3(),
				quaternion: new THREE.Quaternion(),
				scale: new THREE.Vector3(),
				updateWorldMatrix: ()=>{},
				getWorldPosition: ()=> { return new THREE.Vector3() }
			}
		})
	}

	return bones
}

