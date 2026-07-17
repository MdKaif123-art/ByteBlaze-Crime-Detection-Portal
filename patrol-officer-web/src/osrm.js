/** Public OSRM demo — driving route (public server; replace for production). */
const OSRM_BASE = "https://router.project-osrm.org";

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

/**
 * Snap a WGS84 point to the nearest drivable edge.
 * @returns {{ lat: number, lng: number } | null}
 */
export async function osrmSnapToRoad(lat, lng) {
  try {
    const url = `${OSRM_BASE}/nearest/v1/driving/${round6(lng)},${round6(lat)}?number=1`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const loc = j.waypoints?.[0]?.location;
    if (!Array.isArray(loc) || loc.length < 2) return null;
    return { lng: loc[0], lat: loc[1] };
  } catch {
    return null;
  }
}

/**
 * Driving route between two GPS points. Among OSRM’s primary + alternative routes, the one with
 * the **smallest road distance** (meters) is used — not the default fastest-time route.
 *
 * Default: **start (patrol / you) uses exact WGS84** — not snapped to the road — so the map
 * matches your real coordinates. The **destination** is snapped to the nearest road so routing
 * reaches a drivable point near SOS. The returned polyline is prefixed with your exact start so
 * the line begins where you actually are.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.snapStart=false] If true, snap origin to road (old behaviour).
 * @param {boolean} [opts.snapEnd=true] Snap SOS end to nearest road.
 */
export async function fetchOsrmDrivingRoute(lat1, lng1, lat2, lng2, opts = {}) {
  const snapStart = opts.snapStart === true;
  const snapEnd = opts.snapEnd !== false;
  try {
    const [snapA, snapB] = await Promise.all([
      snapStart ? osrmSnapToRoad(lat1, lng1) : Promise.resolve(null),
      snapEnd ? osrmSnapToRoad(lat2, lng2) : Promise.resolve(null),
    ]);
    const sLng = snapA?.lng ?? lng1;
    const sLat = snapA?.lat ?? lat1;
    const eLng = snapB?.lng ?? lng2;
    const eLat = snapB?.lat ?? lat2;
    const path = `${round6(sLng)},${round6(sLat)};${round6(eLng)},${round6(eLat)}`;
    // alternatives=true: OSRM default route is fastest (min duration), not shortest distance.
    // We pick the returned route with smallest distance (meters) so the line is the shortest path offered.
    const url = `${OSRM_BASE}/route/v1/driving/${path}?overview=full&geometries=geojson&alternatives=true&steps=false`;
    const res = await fetch(url);
    const j = await res.json();
    const candidates = (j.routes || []).filter((r) => r?.geometry?.coordinates?.length);
    if (!candidates.length) return null;
    const route = candidates.reduce((best, r) => (r.distance < best.distance ? r : best));
    const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    if (!snapStart) {
      latlngs.unshift([lat1, lng1]);
    }
    return {
      latlngs,
      durationSec: route.duration,
      distanceM: route.distance,
    };
  } catch {
    return null;
  }
}
