
import { getThree } from '../three-helper.js'

import { Mixamo2VRM } from './Mixamo2VRM.js'

function _retarget(clip,vrm=null) {

	const THREE = getThree()
	if(!THREE) return

	const scene = clip._scene

	if(!scene || !vrm) {
		console.error('puppet body - cannot patch clip',clip,vrm)
		return null
	}

	const hips = scene.getObjectByName('Hips') || scene.getObjectByName('CC_Base_Hip') || scene.getObjectByName('mixamorigHips')
	if(!hips) {
		console.error('volume body retarget hips missing',clip)
		return null
	}

	const hipsPositionScale = hips.scale.y

	const restRotationInverse = new THREE.Quaternion()
	const parentRestWorldRotation = new THREE.Quaternion()
	const _quatA = new THREE.Quaternion()
	const tracks = []

	for (let i = 0; i < clip.tracks.length; i++) {
		let track = clip.tracks[i]
		const trackSplitted = track.name.split('.')
		const rigNodeName = trackSplitted[0]

		// the bone should exist in the clip scene
		const rigNode = scene.getObjectByName(rigNodeName)
		if(!rigNode) {
			console.warn('volume body retarget missing',rigNodeName)
			continue
		}

		// make track refer to vrm equivalent if any - cloning the track
	    const vrmBoneName = Mixamo2VRM[rigNodeName]
	    let vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBoneName)
	    if(!vrmNode && vrmBoneName === 'Armature') vrmNode = vrm.humanoid.normalizedHumanBonesRoot
	    if (vrmNode && vrmNode.name && vrmNode.name.length) {
	      const propertyName = trackSplitted[1]
	      track = track.clone()
	      track.name = `${vrmNode.name}.${propertyName}`
	      tracks.push(track)
	    } else {
	    	//console.warn('puppet animation vrm bone not found',rigNodeName,vrmBoneName)
	    	continue
	    }

		// rewrite track to vrm
		scene.updateWorldMatrix(true, true)
		rigNode.getWorldQuaternion(restRotationInverse).invert()
		rigNode.parent.getWorldQuaternion(parentRestWorldRotation)
		if (track instanceof THREE.QuaternionKeyframeTrack) {
			for (let i = 0; i < track.values.length; i += 4) {
				const flatQuaternion = track.values.slice(i, i + 4)
				_quatA.fromArray(flatQuaternion)
				_quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse)
				_quatA.toArray(flatQuaternion)
				flatQuaternion.forEach((v, index) => {
					track.values[index + i] = v
				})
			}
		} else if (track instanceof THREE.VectorKeyframeTrack) {
			const value = track.values.map((v) => v * hipsPositionScale)
			value.forEach((v, index) => {
				track.values[index] = v
			})
		}

	}

	return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}

const vrm_retargeted_cache = {}

export function retarget_vrm(node,clumps,vrm) {
	if(!node || !clumps || !vrm) return
	Object.entries(clumps).forEach(([key,clump]) => {
		const retargeted_clump = vrm_retargeted_cache[key] || []
		if(!retargeted_clump.length) {
			clump.forEach(clip=>{
				clip = _retarget(clip,vrm)
				if(!clip) {
					console.error('puppet body vrm patch fail',clump)
					return
				}
				retargeted_clump.push(clip)
			})
		}
		clumps[key] = vrm_retargeted_cache[key] = retargeted_clump
	})
}

