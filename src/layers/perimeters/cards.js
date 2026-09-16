/** Card model for one selected fire-perimeter incident. Pure — no Cesium types. */

export const PERIMETER_OVERLAY_SOURCE_ID = 'fire-perimeters';

/** CSS accent for a perimeter card by containment progress (mirrors the fill). */
export function containmentAccent(containedPct) {
  if (!Number.isFinite(containedPct) || containedPct <= 0) return '#ff3b30';
  if (containedPct < 50) return '#ff7a00';
  if (containedPct < 100) return '#ffb300';
  return '#8bc34a';
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
 * Anchor point for the incident card: the centroid of the largest polygon's
 * outer ring. Degrees, so callers own the Cartesian conversion.
 * @param {Array<Array<Array<[number, number]>>>} polygons - Normalized rows' polygons.
 * @returns {{lon: number, lat: number}}
 */
export function perimeterAnchorDegrees(polygons) {
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
  // Vertex mean over the closed ring (first == last point dropped): perimeters
  // are compact enough that this stays inside or near the polygon.
  let lon = 0;
  let lat = 0;
  const count = best.length - 1;
  for (let i = 0; i < count; i++) {
    lon += best[i][0];
    lat += best[i][1];
  }
  return { lon: lon / count, lat: lat / count };
}

/** Compact USD, e.g. $85K / $4.2M / $1.3B. Null under $1,000. */
function formatCost(dollars) {
  if (!Number.isFinite(dollars) || dollars < 1000) return null;
  const units = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [scale, suffix] of units) {
    if (dollars >= scale) {
      const value = dollars / scale;
      return `$${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}${suffix}`;
    }
  }
  return null;
}

function formatAge(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return null;
  const hours = Math.floor(deltaMs / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(deltaMs / 60000))}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Build the overlay-host entry for one selected incident. The caller supplies
 * `position` (Cartesian) separately — this model stays JSON-safe for tests.
 * @param {Object} row - Normalized perimeter row (see records.js).
 * @param {number} nowMs - Current epoch milliseconds.
 * @returns {Object} World-overlay entry without `position`.
 */
export function buildIncidentCard(row, nowMs) {
  const facts = [];
  if (Number.isFinite(row.acres))
    facts.push(`${Math.round(row.acres).toLocaleString('en-US')} ac`);
  facts.push(
    Number.isFinite(row.containedPct)
      ? `${Math.round(row.containedPct)}% contained`
      : 'containment unknown',
  );
  if (row.state) facts.push(row.state);
  else if (row.category) facts.push(row.category);

  const situation = [];
  if (row.cause) situation.push(`${row.cause} cause`);
  if (row.behavior) situation.push(row.behavior);
  if (row.complexity) situation.push(row.complexity);

  const response = [];
  if (Number.isFinite(row.personnel))
    response.push(
      `${Math.round(row.personnel).toLocaleString('en-US')} personnel`,
    );
  if (row.county) response.push(`${row.county} County`);
  if (Number.isFinite(row.costToDate)) {
    const cost = formatCost(row.costToDate);
    if (cost) response.push(`${cost} to date`);
  }

  const ages = [];
  const discovered = formatAge(nowMs - row.discoveredTime);
  if (row.discoveredTime != null && discovered)
    ages.push(`discovered ${discovered} ago`);
  const updated = formatAge(nowMs - row.updatedTime);
  if (row.updatedTime != null && updated) ages.push(`updated ${updated} ago`);

  const details = [facts.join(' · ')];
  if (situation.length) details.push(situation.join(' · '));
  if (response.length) details.push(response.join(' · '));
  if (ages.length) details.push(ages.join(' · '));

  return {
    id: `fire-perimeter-card:${row.stableId}`,
    actionable: true,
    selected: true,
    title: `FIRE · ${row.name || 'Unnamed incident'}`,
    details,
    accent: containmentAccent(row.containedPct),
    priority: Number.MAX_SAFE_INTEGER,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}
