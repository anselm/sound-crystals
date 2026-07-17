
import { RPMFace2Reallusion } from './RPMFace2Reallusion.js'

//
// copy morph targets
//
// my choreography system uses rpm part names
//
// vrm does not use a dictionary - so there is very little to do here...
// also please convert your vrms using blender-puppet-rpm-to-vrm.py
//
// reallusion facial morph targets are remapped on the fly for now
// @note later may deprecate this feature and require users to pre-bake their reallusion rigs
//

export function morph_targets(node,vrm) {

	// vrm doesn't need to do any work in part due to art asset pipeline improvements
	// please convert your vrms using blender-puppet-rpm-to-vrm.py
	if(vrm) {
		return { morphs: null, dictionary: null }
	}

	const morphs = []
	const dictionary = {}

	// check if reallusion
	const reallusion = node.getObjectByName("CC_Base_Head") ? true : false

	// find bones participating in facial expressions

	node.traverse((part) => {

		// ignore bones that do not have morph targets
		if(!part.morphTargetDictionary || Object.entries(part.morphTargetDictionary).length < 1 ) {
			return
		}

		// also may as well detect if this is an oculus/arkit/rpm rig based on the naming - helpful to know
		if(part.morphTargetDictionary['viseme_sil'] !== undefined) {
			if(reallusion) {
				console.warn("puppet face - inconsistent bone naming",part.name)
			}
		}
		else if(part.morphTargetDictionary["EE"] !== undefined) {
			if(!reallusion) {
				console.warn("puppet face - reallusion visemes but not reallusion body?",part.name)
			}
		}

		// this bone has some morph targets - let's remember it
		morphs.push(part)
	})

	// visit every morph and build a dictionary of morph target names to index lookups; these are hopefully the same between bones
	// written as small groups or arrays so that support for reallusion array remaps is simpler

	morphs.forEach(part => {
		Object.entries(part.morphTargetDictionary).forEach( ([k,v]) => {
			//console.log("puppet face - rpm morph target",k,v)
			dictionary[k]=[v]
		})
	})

	// visit all targets again if reallusion, and inject a remapped dictionary of morph target lookups so we can drive reallusion rigs
	// we support a concept of a single morph target such as cheekPuff mapping to cheek Puff Left and cheek Puff Right

	if(reallusion) {
		Object.entries(RPMFace2Reallusion).forEach( ([k,v]) => {
			if(!Array.isArray(v)) {
				const t = dictionary[v]
				if(t) {
					dictionary[k] = [t]
					//console.log("puppet face - retargeting rpm,reallusion,index =",k,v,t)
				}
			}
			else {
				const v2 = []
				v.forEach(name=>{
					const target = dictionary[name]
					if(target) {
						v2.push(target)
					}
				})
				if(v2.length) {
					dictionary[k] = v2
					//console.log("puppet face - retargeting rpm,reallusion,indexes =",k,v,v2)
				}
			}
		})
	}

	return { morphs, dictionary }
}
