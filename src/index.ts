import booleanPointInPolygon from "@turf/boolean-point-in-polygon"
import difference from "@turf/difference"
import {
	featureCollection,
	lineString,
	multiPolygon,
	point,
	polygon,
} from "@turf/helpers"
import { getGeom } from "@turf/invariant"
import lineIntersect from "@turf/line-intersect"
import lineOffset from "@turf/line-offset"
import lineOverlap from "@turf/line-overlap"
import lineToPolygon from "@turf/line-to-polygon"
import unkinkPolygon from "@turf/unkink-polygon"
import {
	Feature,
	FeatureCollection,
	GeoJsonProperties,
	LineString,
	MultiPolygon,
	Polygon,
} from "geojson"

/**
 * Slices {@link Polygon} using a {@link Linestring}.
 *
 * @name polygonSlice
 * @param {Feature<Polygon>} poly Polygon to slice
 * @param {Feature<LineString>} splitter LineString used to slice Polygon
 * @returns {FeatureCollection<Polygon>} Sliced Polygons
 * @example
 * var polygon = {
 *   "geometry": {
 *     "type": "Polygon",
 *     "coordinates": [[
 *         [0, 0],
 *         [0, 10],
 *         [10, 10],
 *         [10, 0],
 *         [0, 0]
 *     ]]
 *   }
 * };
 * var linestring =  {
 *     "type": "Feature",
 *     "properties": {},
 *     "geometry": {
 *       "type": "LineString",
 *       "coordinates": [
 *         [5, 15],
 *         [5, -15]
 *       ]
 *     }
 *   }
 * var sliced = polygonSlice(polygon, linestring);
 * //=sliced
 */
export default function polygonSlice(
	poly: Feature<Polygon, GeoJsonProperties>,
	splitter: Feature<LineString, GeoJsonProperties>,
): FeatureCollection<Polygon> {
	const line = trimStartEndPoints(poly, getGeom(splitter))
	if (line == null) return featureCollection([poly])

	const newPolygons = []

	const upperCut = cutPolygon(poly, line, 1, "upper")
	const lowerCut = cutPolygon(poly, line, -1, "lower")
	if (upperCut != null && lowerCut != null) {
		newPolygons.push(upperCut.geometry)
		newPolygons.push(lowerCut.geometry)
	} else {
		newPolygons.push(poly.geometry)
	}

	const generatedPolygons: Polygon[] = []
	newPolygons.forEach((polyg) => {
		if (polyg.type == "Polygon") {
			generatedPolygons.push(polyg)
		}
		if (polyg.type == "MultiPolygon") {
			polyg.coordinates.forEach((p) => {
				generatedPolygons.push(polygon([p[0]]).geometry)
			})
		}
	})

	return featureCollection(
		generatedPolygons.map((p) => polygon(p.coordinates)),
	)
}

function cutPolygon(
	poly: Feature<Polygon, GeoJsonProperties>,
	line: LineString,
	direction: number,
	id: string,
) {
	let j
	const cutPolyGeoms = []
	let retVal = null

	if (poly.geometry.type != "Polygon" || line.type != "LineString")
		return retVal

	const intersectPoints = lineIntersect(poly, line)
	const nPoints = intersectPoints.features.length
	if (nPoints == 0 || nPoints % 2 != 0) return retVal

	const thickLinePolygon = prepareDiffLinePolygon(line, direction)
	if (!thickLinePolygon) return null

	let clipped: Feature<Polygon | MultiPolygon> | null
	try {
		clipped = difference(featureCollection([poly, thickLinePolygon]))
	} catch (e) {
		return retVal
	}
	if (!clipped) return null

	if (clipped.geometry.type == "MultiPolygon") {
		for (j = 0; j < clipped.geometry.coordinates.length; j++) {
			const polyg = polygon(clipped.geometry.coordinates[j])
			const overlap = lineOverlap(polyg, line, {
				tolerance: 0.00005,
			})

			if (overlap.features.length > 0) {
				cutPolyGeoms.push(polyg.geometry.coordinates)
			}
		}
	} else {
		const polyg = polygon(clipped.geometry.coordinates)
		const overlap = lineOverlap(polyg, line, { tolerance: 0.00005 })

		if (overlap.features.length > 0) {
			cutPolyGeoms.push(polyg.geometry.coordinates)
		}
	}

	if (cutPolyGeoms.length == 1) {
		retVal = polygon(cutPolyGeoms[0], { id: id })
	} else if (cutPolyGeoms.length > 1) {
		retVal = multiPolygon(cutPolyGeoms, { id: id })
	}

	return retVal
}
/**
 * return non self intersection polygon
 * for difference-cutting
 */
function prepareDiffLinePolygon(line: LineString, direction: number) {
	let j,
		k,
		offsetLine,
		polyCoords = []
	let thickLinePolygon: Feature<Polygon, GeoJsonProperties> | null = null

	const offsetScales = [0.01, 0.001, 0.0001]

	for (j = 0; j < offsetScales.length; j++) {
		polyCoords = []
		offsetLine = lineOffset(line, offsetScales[j] * direction, {
			units: "kilometers",
		})
		for (k = 0; k < line.coordinates.length; k++) {
			polyCoords.push(line.coordinates[k])
		}
		for (k = offsetLine.geometry.coordinates.length - 1; k >= 0; k--) {
			polyCoords.push(offsetLine.geometry.coordinates[k])
		}
		polyCoords.push(line.coordinates[0])
		const thickLineString = lineString(polyCoords)
		thickLinePolygon = lineToPolygon(thickLineString) as Feature<
			Polygon,
			GeoJsonProperties
		>

		const result = unkinkPolygon(thickLinePolygon)

		const selfIntersectPolygons = result.features.length

		if (selfIntersectPolygons == 1) {
			return thickLinePolygon
		}
	}
	return thickLinePolygon
}

/**
 * Prepare linestrings from polygon-cut
 * avoid start and end points inside polygon for calculation
 */
function trimStartEndPoints(
	poly: Feature<Polygon, GeoJsonProperties>,
	line: LineString,
) {
	let j
	let startAt = 0
	let endAt = line.coordinates.length

	for (j = 0; j < line.coordinates.length; j++) {
		if (booleanPointInPolygon(point(line.coordinates[j]), poly)) {
			startAt++
		} else {
			break
		}
	}

	for (j = line.coordinates.length - 1; j >= 0; j--) {
		if (booleanPointInPolygon(point(line.coordinates[j]), poly)) {
			endAt--
		} else {
			break
		}
	}

	line.coordinates = line.coordinates.slice(startAt, endAt)

	return line.coordinates.length > 1 ? line : null
}
