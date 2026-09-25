/**
 * Normalize a NOAA HMS smoke-polygon KML day file, skipping individually
 * invalid placemarks. Only a payload that is not KML at all rejects the whole
 * snapshot — a quiet day legitimately parses to an empty array, and one
 * malformed polygon must never blank the layer.
 */

const DENSITIES = new Set(['Light', 'Medium', 'Heavy']);

/** "2026266 1200UTC" — year, day-of-year, HHMM — to epoch ms, or null. */
function hmsTimeMs(text) {
  const match = /^(\d{4})(\d{3}) (\d{2})(\d{2})UTC$/.exec(
    String(text ?? '').trim(),
  );
  if (!match) return null;
  const [, year, doy, hours, minutes] = match.map(Number);
  if (doy < 1 || doy > 366 || hours > 23 || minutes > 59) return null;
  return (
    Date.UTC(year, 0, 1) +
    (doy - 1) * 86_400_000 +
    hours * 3_600_000 +
    minutes * 60_000
  );
}

function parseRing(text) {
  const ring = [];
  for (const triple of String(text).trim().split(/\s+/)) {
    const [lon, lat] = triple.split(',').map(Number);
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
    ring.push([lon, lat]);
  }
  return ring.length >= 4 ? ring : null;
}

const field = (description, name) =>
  new RegExp(`${name}:\\s*([^<\\n]+?)\\s*(?:<|$)`).exec(description)?.[1] ??
  null;

export function normalizeSmokeKml(kmlText, { day }) {
  if (typeof kmlText !== 'string' || !/<kml[\s>]/i.test(kmlText)) return null;
  const rows = [];
  let index = 0;
  for (const [, placemark] of kmlText.matchAll(
    /<Placemark>([\s\S]*?)<\/Placemark>/g,
  )) {
    const stableId = `${day}:${index}`;
    index += 1;
    const rings = [];
    let valid = true;
    for (const [, coordinates] of placemark.matchAll(
      /<coordinates>([\s\S]*?)<\/coordinates>/g,
    )) {
      const ring = parseRing(coordinates);
      if (!ring) {
        valid = false;
        break;
      }
      rings.push(ring);
    }
    if (!valid || !rings.length) continue;
    const description = placemark.match(
      /<description>([\s\S]*?)<\/description>/,
    )?.[1];
    const density = field(description ?? '', 'Density');
    rows.push({
      stableId,
      density: DENSITIES.has(density) ? density : null,
      satellite: field(description ?? '', 'Satellite'),
      startTime: hmsTimeMs(field(description ?? '', 'Start Time')),
      endTime: hmsTimeMs(field(description ?? '', 'End Time')),
      // One KML polygon per placemark; keep the perimeters row shape
      // (array of polygons, each an array of rings) for shared card logic.
      polygons: [rings],
    });
  }
  return rows;
}
