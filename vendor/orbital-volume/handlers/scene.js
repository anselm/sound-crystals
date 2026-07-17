
const uuid = 'orbital/orbital-volume/scene'

import { getThree, ensureThree, markSRGB } from './three-helper.js'

//
// handle scene related events such as finding a rendering div and setting up a camera and updates
//

export default async function scene_handler(sys,surface,entity,delta) {

	// get 3js
	const THREE = await ensureThree()
	if(!THREE) return

	const volume = entity.volume

	if(entity.obliterate) {

		if(surface.scene) {
			surface.scene.children.forEach( removeObject )
			surface.scene.clear()
			surface.scene = null
		}

		if(surface.resizeObserver) {
			surface.resizeObserver.disconnect()
			surface.resizeObserver = null
		}

		if(surface.renderer) {
			surface.renderer.renderLists.dispose();
		    surface.renderer.forceContextLoss();
		    surface.renderer.context = null;
		    surface.renderer.domElement = null;
		    surface.renderer.dispose();
		    surface.renderer = null;
		}

		surface.camera = null
		return
	}

	// if a surface exists just update it - @todo handle obliterate
	// requestAnimationFrame() is called elsewhere and this is called for us when it is time to repaint
	if(surface.renderer) {
		surface.renderer.render(surface.scene,surface.camera)
		return
	}

	// only run once for now - allow revisions in the future @todo
	if(surface._built) return
	surface._built = true

	//
	// find a dom element to bind to by name and build renderer
	//

	let div = surface.div = document.getElementById(surface.name)

	if(!div) {
		div = surface.div = document.createElement("div")
		div.style = "width:100%;height:100%;padding:0px;margin:0px;position:absolute;top:0;left:0;"
		div.id = surface.name
		document.body.appendChild(div)
	}
	const alpha = volume.hasOwnProperty('alpha') ? volume.alpha : false
	const background = volume.hasOwnProperty('background') ? volume.background : 0x000000
	const render_args = {
		// antialias defaults on when the prettier pipeline is requested
		antialias: volume.hasOwnProperty('antialias') ? volume.antialias : !!volume.prettier,
		preserveDrawingBuffer: true,
		alpha,
	}

	const canvas = div instanceof HTMLCanvasElement ? div : null
	if(canvas) {
		render_args.canvas = canvas
	}

	const renderer = surface.renderer = new THREE.WebGLRenderer(render_args)

	// this is an issue for transparent backdrops - disabled for now
	//renderer.autoClearColor = false

	// for transparent backdrops must not set clear color
	if(background != 'transparent') {
		renderer.setClearColor(background)
	}

	//
	// Better low level color space support - also causes issues with transparent backdrops
	//

	if(volume.prettier) {
		surface.renderer.outputColorSpace = THREE.SRGBColorSpace
		surface.renderer.outputEncoding = THREE.sRGBEncoding
		surface.renderer.toneMapping = THREE.ACESFilmicToneMapping
		surface.renderer.toneMappingExposure = volume.exposure || 1.0
		surface.renderer.shadowMap.enabled = true
		surface.renderer.shadowMap.type = THREE.PCFSoftShadowMap
		surface.renderer.useLegacyLights = false
	}

	//
	// build scene
	//

	const scene = surface.scene = new THREE.Scene()
	if(background != 'transparent') {
		scene.background = new THREE.Color(background)
	}

	//
	// Atmosphere options
	//
	// sky: true for a default daylight gradient, or [zenith, mid, horizon]
	//      css color strings for a custom one (screen-space vertical gradient)
	// fog: { color, near, far }
	// hemisphere: { sky, ground, intensity } - hemisphere fill light
	// sun: { color, intensity, position:[x,y,z], target:[x,y,z],
	//        shadow: true | { size, extent, near, far } } - directional light
	//

	if(volume.sky) {
		const stops = Array.isArray(volume.sky) ? volume.sky : ['#7ab3dd','#b8d8ea','#f2ede2']
		const canvas = document.createElement('canvas')
		canvas.width = 2
		canvas.height = 512
		const ctx = canvas.getContext('2d')
		const grad = ctx.createLinearGradient(0, 0, 0, 512)
		stops.forEach((color,i) => grad.addColorStop(i / (stops.length - 1), color))
		ctx.fillStyle = grad
		ctx.fillRect(0, 0, 2, 512)
		scene.background = markSRGB(new THREE.CanvasTexture(canvas))
	}

	if(volume.fog) {
		scene.fog = new THREE.Fog(
			volume.fog.color !== undefined ? volume.fog.color : 0xe1ecf2,
			volume.fog.near !== undefined ? volume.fog.near : 100,
			volume.fog.far !== undefined ? volume.fog.far : 1000
		)
	}

	if(volume.hemisphere) {
		scene.add(new THREE.HemisphereLight(
			volume.hemisphere.sky !== undefined ? volume.hemisphere.sky : 0xcfe4f4,
			volume.hemisphere.ground !== undefined ? volume.hemisphere.ground : 0x8f7f5e,
			volume.hemisphere.intensity !== undefined ? volume.hemisphere.intensity : 1.0
		))
	}

	if(volume.sun) {
		const sun = new THREE.DirectionalLight(
			volume.sun.color !== undefined ? volume.sun.color : 0xfff1d8,
			volume.sun.intensity !== undefined ? volume.sun.intensity : 2.0
		)
		sun.position.set(...(volume.sun.position || [100, 120, 40]))
		sun.target.position.set(...(volume.sun.target || [0, 0, 0]))
		if(volume.sun.shadow) {
			const conf = typeof volume.sun.shadow === 'object' ? volume.sun.shadow : {}
			const extent = conf.extent || 100
			sun.castShadow = true
			sun.shadow.mapSize.set(conf.size || 2048, conf.size || 2048)
			sun.shadow.camera.left = -extent
			sun.shadow.camera.right = extent
			sun.shadow.camera.top = extent
			sun.shadow.camera.bottom = -extent
			sun.shadow.camera.near = conf.near || 1
			sun.shadow.camera.far = conf.far || 500
			sun.shadow.bias = -0.0004
			sun.shadow.normalBias = 0.03
		}
		scene.add(sun)
		scene.add(sun.target)
	}

	//
	// Scene lighting feature - this causes issues with transparent backdrops
	//

	if(volume.roomlighting) {
		const RoomEnvironment = (await import('three/addons/environments/RoomEnvironment.js')).RoomEnvironment
		const pmremGenerator = new THREE.PMREMGenerator( renderer )
		pmremGenerator.compileEquirectangularShader()
		scene.environment = pmremGenerator.fromScene( new RoomEnvironment() ).texture
	}

	//
	// adjust renderer size/aspect
	//

	surface.width = div.clientWidth || volume.width || 512
	surface.height = div.clientHeight || volume.height || 512
	surface.aspect = surface.width / surface.height
	//renderer.setSize(surface.width,surface.height)
	//renderer.setPixelRatio(window.devicePixelRatio)

	//
	// build default camera
	//

	const fov = volume.aperture || 35
	const near = volume.near || 0.01
	const far = volume.far || 100
	const camera = surface.camera = new THREE.PerspectiveCamera(fov, surface.aspect, near, far)
	scene.add(camera)

	//
	// other helpers
	//

	if(volume.axes && THREE.GridHelper && THREE.AxesHelper) {
		scene.add( new THREE.GridHelper( 16, 16 ) )
		scene.add( new THREE.AxesHelper( 8 ) )
	}

	//
	// resize observer leveraging https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
	//

	const resized = () => {
		if(!div.clientWidth || !div.clientHeight) return
		surface.width = div.clientWidth || volume.width || 512
		surface.height = div.clientHeight || volume.height || 512
		surface.aspect = surface.width / surface.height
		if(surface.camera) {
			surface.camera.aspect = surface.aspect
			surface.camera.updateProjectionMatrix()
		}
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
		renderer.setSize(surface.width,surface.height)
		renderer.render(surface.scene,surface.camera)
	}

	surface.resizeObserver = new ResizeObserver(resized).observe(div)

	//
	// attach this all to the display
	//

	if(!canvas) {
		div.appendChild(renderer.domElement)
	}

	//
	// display-driven clock (opt-in via volume.clock)
	//
	// when a surface owns a realtime display it may own the tick loop: setAnimationLoop
	// is identical to requestAnimationFrame outside XR and *required* during an XR
	// session, so flat and immersive modes share one tick path. apps using the bus's
	// { run:'realtime' } driver are untouched — do not enable both at once.
	//

	if(volume.clock) {
		let last = performance.now()
		renderer.setAnimationLoop(() => {
			const now = performance.now()
			sys.resolve({ tick:true, t: now/1000, dt: (now-last)/1000 })
			last = now
		})
	}
}

