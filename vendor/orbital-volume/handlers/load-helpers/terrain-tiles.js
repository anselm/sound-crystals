
///
/// terrain-tiles - fetch and decode web elevation / satellite imagery tiles
///
/// Framework-free helpers (no three.js): fetches Terrarium or Mapbox encoded
/// elevation tiles plus optional satellite imagery for a lat/lon bounds and
/// returns merged grids. Client-side only (uses canvas + createImageBitmap).
///

const DEFAULTS = {
	// Terrarium tiles from AWS open data (no key required)
	tileUrl: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
	satelliteUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
	tileSize: 256,
	maxZoom: 15,
	encoding: 'terrarium' // 'terrarium' or 'mapbox'
}

const tileCache = new Map()

export function latLonToTile(lat, lon, zoom) {
	const n = Math.pow(2, zoom)
	const x = Math.floor((lon + 180) / 360 * n)
	const latRad = lat * Math.PI / 180
	const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
	return { x, y, z: zoom }
}

export function tileToLatLon(x, y, z) {
	const n = Math.pow(2, z)
	const lon = x / n * 360 - 180
	const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)))
	return { lat: latRad * 180 / Math.PI, lon }
}

function decodeElevation(r, g, b, encoding) {
	if (encoding === 'mapbox') {
		return -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1)
	}
	// terrarium
	return (r * 256 + g + b / 256) - 32768
}

function autoZoom(bounds, maxZoom) {
	const maxRange = Math.max(bounds.north - bounds.south, bounds.east - bounds.west)
	let zoom
	if (maxRange > 10) zoom = 6
	else if (maxRange > 5) zoom = 8
	else if (maxRange > 1) zoom = 10
	else if (maxRange > 0.5) zoom = 12
	else if (maxRange > 0.1) zoom = 13
	else zoom = 14
	return Math.min(zoom, maxZoom)
}

async function fetchElevationTile(x, y, z, config) {
	const key = `dem:${config.tileUrl}:${z}/${x}/${y}`
	if (tileCache.has(key)) return tileCache.get(key)

	const url = config.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y)
	try {
		const response = await fetch(url)
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		const bitmap = await createImageBitmap(await response.blob())

		const canvas = document.createElement('canvas')
		canvas.width = canvas.height = config.tileSize
		const ctx = canvas.getContext('2d')
		ctx.drawImage(bitmap, 0, 0)
		const imageData = ctx.getImageData(0, 0, config.tileSize, config.tileSize)

		const elevations = new Float32Array(config.tileSize * config.tileSize)
		for (let i = 0; i < imageData.data.length; i += 4) {
			elevations[i / 4] = decodeElevation(
				imageData.data[i], imageData.data[i + 1], imageData.data[i + 2], config.encoding)
		}
		const tile = { x, y, z, elevations }
		tileCache.set(key, tile)
		return tile
	} catch (error) {
		console.error(`terrain-tiles: failed elevation tile ${z}/${x}/${y}`, error)
		return null
	}
}

async function fetchImageTile(x, y, z, config) {
	const url = config.satelliteUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y)
	try {
		const response = await fetch(url)
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return await createImageBitmap(await response.blob())
	} catch (error) {
		console.error(`terrain-tiles: failed image tile ${z}/${x}/${y}`, error)
		return null
	}
}

///
/// Fetch a merged elevation grid for bounds {north,south,east,west}.
/// Returns { elevations, width, height, bounds, zoom, minElev, maxElev }.
///

export async function getElevationGrid(bounds, options = {}) {
	const config = { ...DEFAULTS, ...options }
	const zoom = options.zoom || autoZoom(bounds, config.maxZoom)

	const nw = latLonToTile(bounds.north, bounds.west, zoom)
	const se = latLonToTile(bounds.south, bounds.east, zoom)

	const promises = []
	for (let x = nw.x; x <= se.x; x++) {
		for (let y = nw.y; y <= se.y; y++) {
			promises.push(fetchElevationTile(x, y, zoom, config))
		}
	}
	const tiles = (await Promise.all(promises)).filter(t => t)
	if (!tiles.length) throw new Error('terrain-tiles: no elevation data for region')

	const size = config.tileSize
	const width = (se.x - nw.x + 1) * size
	const height = (se.y - nw.y + 1) * size
	const elevations = new Float32Array(width * height)

	tiles.forEach(tile => {
		const ox = (tile.x - nw.x) * size
		const oy = (tile.y - nw.y) * size
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				elevations[(oy + y) * width + (ox + x)] = tile.elevations[y * size + x]
			}
		}
	})

	let minElev = Infinity, maxElev = -Infinity
	for (let i = 0; i < elevations.length; i++) {
		if (elevations[i] < minElev) minElev = elevations[i]
		if (elevations[i] > maxElev) maxElev = elevations[i]
	}

	return {
		elevations, width, height, zoom, minElev, maxElev,
		bounds: {
			north: tileToLatLon(nw.x, nw.y, zoom).lat,
			south: tileToLatLon(se.x, se.y + 1, zoom).lat,
			west: tileToLatLon(nw.x, nw.y, zoom).lon,
			east: tileToLatLon(se.x + 1, se.y, zoom).lon
		}
	}
}

///
/// Fetch satellite imagery for bounds; returns { canvas, width, height, bounds, zoom }.
///

export async function getSatelliteCanvas(bounds, options = {}) {
	const config = { ...DEFAULTS, ...options }
	const zoom = options.zoom || autoZoom(bounds, config.maxZoom)

	const nw = latLonToTile(bounds.north, bounds.west, zoom)
	const se = latLonToTile(bounds.south, bounds.east, zoom)

	const promises = []
	const positions = []
	for (let x = nw.x; x <= se.x; x++) {
		for (let y = nw.y; y <= se.y; y++) {
			promises.push(fetchImageTile(x, y, zoom, config))
			positions.push({ x, y })
		}
	}
	const bitmaps = await Promise.all(promises)

	const size = config.tileSize
	const canvas = document.createElement('canvas')
	canvas.width = (se.x - nw.x + 1) * size
	canvas.height = (se.y - nw.y + 1) * size
	const ctx = canvas.getContext('2d')
	bitmaps.forEach((bitmap, i) => {
		if (bitmap) ctx.drawImage(bitmap, (positions[i].x - nw.x) * size, (positions[i].y - nw.y) * size)
	})

	return {
		canvas, width: canvas.width, height: canvas.height, zoom,
		bounds: {
			north: tileToLatLon(nw.x, nw.y, zoom).lat,
			south: tileToLatLon(se.x, se.y + 1, zoom).lat,
			west: tileToLatLon(nw.x, nw.y, zoom).lon,
			east: tileToLatLon(se.x + 1, se.y, zoom).lon
		}
	}
}
