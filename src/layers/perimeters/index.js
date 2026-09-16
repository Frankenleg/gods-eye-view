import * as Cesium from 'cesium';
export { normalizeFirePerimeterSnapshot } from './records.js';
export { createWfigsPerimeterSource } from './source.js';

/** Fill/line color for a perimeter by containment progress. */
export function containmentColor(containedPct) {
  if (!Number.isFinite(containedPct) || containedPct <= 0)
    return Cesium.Color.fromCssColorString('#ff3b30');
  if (containedPct < 50) return Cesium.Color.fromCssColorString('#ff7a00');
  if (containedPct < 100) return Cesium.Color.fromCssColorString('#ffb300');
  return Cesium.Color.fromCssColorString('#8bc34a');
}

const ringPositions = (ring) =>
  ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));

/** Own one fire-perimeter display and its refresh lifecycle. */
export function createFirePerimetersLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Fire perimeters require a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'fire-perimeters',
    name: 'Fire Perimeters',
    icon: '🔥',
    source: 'NIFC WFIGS',
    updateInterval: 300000,

    init(viewer) {
      if (_viewer)
        throw new Error('Fire perimeter layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('fire-perimeters');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:FirePerimeters] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const rows = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        const nextEntities = [];
        for (const row of rows) {
          const color = containmentColor(row.containedPct);
          const properties = {
            name: row.name,
            acres: row.acres,
            containedPct: row.containedPct,
            state: row.state,
            category: row.category,
            discoveredTime: row.discoveredTime,
            updatedTime: row.updatedTime,
          };
          for (const [index, rings] of row.polygons.entries()) {
            const [outer, ...holes] = rings;
            nextEntities.push(
              new Cesium.Entity({
                id: `fire-perimeter:${row.stableId}:${index}`,
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(
                    ringPositions(outer),
                    holes.map(
                      (hole) =>
                        new Cesium.PolygonHierarchy(ringPositions(hole)),
                    ),
                  ),
                  material: new Cesium.ColorMaterialProperty(
                    color.withAlpha(0.25),
                  ),
                },
                // The fire line: ground-clamped outline (entity polygons cannot
                // outline clamped geometry themselves).
                polyline: {
                  positions: ringPositions(outer),
                  clampToGround: true,
                  width: 2,
                  material: new Cesium.ColorMaterialProperty(
                    color.withAlpha(0.9),
                  ),
                },
                properties,
              }),
            );
          }
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        _count = rows.length;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:FirePerimeters] Updated: ${_count} incidents, ${nextEntities.length} polygons`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:FirePerimeters] Fetch error:', e);
        _lastError = e?.message || 'Perimeter source unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /** Snapshot incident facts (no geometry) for the analyst query engine. */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const now = Cesium.JulianDate.now();
      const seen = new Set();
      const result = [];
      for (const entity of _dataSource.entities.values) {
        if (result.length >= limit) break;
        const incidentId = String(entity.id).split(':')[1] ?? null;
        if (incidentId == null || seen.has(incidentId)) continue;
        seen.add(incidentId);
        const p = entity.properties;
        result.push({
          id: incidentId,
          name: p?.name?.getValue(now) ?? null,
          acres: p?.acres?.getValue(now) ?? null,
          containedPct: p?.containedPct?.getValue(now) ?? null,
          state: p?.state?.getValue(now) ?? null,
          category: p?.category?.getValue(now) ?? null,
          discoveredTime: p?.discoveredTime?.getValue(now) ?? null,
          updatedTime: p?.updatedTime?.getValue(now) ?? null,
        });
      }
      return result;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
