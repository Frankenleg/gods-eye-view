/** Card model for one selected HMS smoke plume. Pure — no Cesium types. */

export const SMOKE_OVERLAY_SOURCE_ID = 'smoke';

const ACCENTS = Object.freeze({
  Light: '#c7bfae',
  Medium: '#a08f76',
  Heavy: '#6e5f4b',
});

/** CSS accent for a plume by analyst density; unclassified reads neutral gray. */
export function densityAccent(density) {
  return ACCENTS[density] ?? '#9a9a9a';
}

/** Shoelace area (degree², sign dropped) — relative sizes only. */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

/**
 * Anchor point for the plume card: the centroid of the largest polygon's
 * outer ring. Degrees, so callers own the Cartesian conversion.
 */
export function smokeAnchorDegrees(polygons) {
  let best = null;
  let bestArea = -1;
  for (const rings of polygons) {
    const outer = rings[0];
    const area = ringArea(outer);
    if (area > bestArea) {
      bestArea = area;
      best = outer;
    }
  }
  let lon = 0;
  let lat = 0;
  const count = best.length - 1;
  for (let i = 0; i < count; i++) {
    lon += best[i][0];
    lat += best[i][1];
  }
  return { lon: lon / count, lat: lat / count };
}

const utcHhmm = (ms) => {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

function formatAge(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return null;
  const hours = Math.floor(deltaMs / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(deltaMs / 60000))}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Build the overlay-host entry for one selected plume. The caller supplies
 * `position` (Cartesian) separately — this model stays JSON-safe for tests.
 * @param {Object} row - Normalized smoke row (see records.js).
 * @param {number} nowMs - Current epoch milliseconds.
 * @returns {Object} World-overlay entry without `position`.
 */
export function buildSmokeCard(row, nowMs) {
  const details = [];
  const observation = [];
  if (row.satellite) observation.push(row.satellite);
  if (Number.isFinite(row.startTime) && Number.isFinite(row.endTime))
    observation.push(
      `observed ${utcHhmm(row.startTime)}–${utcHhmm(row.endTime)} UTC`,
    );
  if (observation.length) details.push(observation.join(' · '));
  const age = Number.isFinite(row.endTime)
    ? formatAge(nowMs - row.endTime)
    : null;
  if (age) details.push(`ended ${age} ago`);

  return {
    id: `smoke-card:${row.stableId}`,
    selected: true,
    interactive: false,
    title: `SMOKE · ${row.density ?? 'Unclassified'} density`,
    details,
    accent: densityAccent(row.density),
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}
