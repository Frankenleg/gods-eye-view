import * as Cesium from 'cesium';
import {
  PERIMETER_OVERLAY_SOURCE_ID,
  perimeterAnchorDegrees,
  buildIncidentCard,
} from './cards.js';
export { normalizeFirePerimeterSnapshot } from './records.js';
export { createWfigsPerimeterSource } from './source.js';
export * from './cards.js';

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

const PICK_PREFIX = 'fire-perimeter:';

/** Own one fire-perimeter display, its refresh lifecycle, and click selection. */
export function createFirePerimetersLayer({
  source,
  overlayHost = null,
  screenSpaceEventHandlerFactory = null,
  picking = null,
  pointer = null,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Fire perimeters require a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _clickHandler = null;
  let _selectedId = null;
  const _rowById = new Map();

  const canSelect = () =>
    overlayHost && screenSpaceEventHandlerFactory && picking;

  function publishSelectedCard() {
    if (!canSelect()) return;
    const row = _selectedId ? _rowById.get(_selectedId) : null;
    if (!row) {
      _selectedId = null;
      overlayHost.setEntries(PERIMETER_OVERLAY_SOURCE_ID, [], {
        cohortLimit: 1,
        collisionCapacity: 1,
        moving: false,
      });
      return;
    }
    const anchor = perimeterAnchorDegrees(row.polygons);
    overlayHost.setEntries(
      PERIMETER_OVERLAY_SOURCE_ID,
      [
        {
          ...buildIncidentCard(row, Date.now()),
          position: Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat),
        },
      ],
      { cohortLimit: 1, collisionCapacity: 1, moving: false },
    );
  }

  /** Resolve a scene pick to one of this layer's incident ids, or null. */
  function pickedIncidentId(picked) {
    const pickId = picking.resolvePickId(picked);
    if (typeof pickId !== 'string' || !pickId.startsWith(PICK_PREFIX))
      return null;
    const incidentId = pickId.slice(PICK_PREFIX.length).split(':')[0];
    return _rowById.has(incidentId) ? incidentId : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickHandler || !_viewer) return;
    picking.registerPickOwner(layer.id, (pickId) =>
      String(pickId).startsWith(PICK_PREFIX),
    );
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const picked = _viewer.scene.pick(click.position);
      const incidentId = picked ? pickedIncidentId(picked) : null;
      if (incidentId) {
        _selectedId = incidentId;
        publishSelectedCard();
        return;
      }
      // A pick that belongs to a sibling layer (e.g. an aircraft) is not
      // "empty space" — leave the selection alone and let that layer handle it.
      if (picked) {
        const pickId = picking.resolvePickId(picked);
        if (pickId && picking.isOwnedByOtherLayer(layer.id, pickId)) return;
      }
      if (_selectedId) {
        _selectedId = null;
        publishSelectedCard();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClickHandler() {
    if (!canSelect()) return;
    picking.unregisterPickOwner(layer.id);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
  }

  function clearSelection() {
    _selectedId = null;
    if (overlayHost) {
      overlayHost.clearSource(PERIMETER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible?.(PERIMETER_OVERLAY_SOURCE_ID, false);
    }
  }

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
      overlayHost?.setVisible?.(PERIMETER_OVERLAY_SOURCE_ID, true);
      installClickHandler();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      removeClickHandler();
      clearSelection();
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
            cause: row.cause,
            behavior: row.behavior,
            personnel: row.personnel,
            county: row.county,
            costToDate: row.costToDate,
            complexity: row.complexity,
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
        _rowById.clear();
        for (const row of rows) _rowById.set(row.stableId, row);
        // Refresh (or drop) the selected incident's card against the new feed.
        if (_selectedId) publishSelectedCard();
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
      removeClickHandler();
      clearSelection();
      _rowById.clear();
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
          cause: p?.cause?.getValue(now) ?? null,
          behavior: p?.behavior?.getValue(now) ?? null,
          personnel: p?.personnel?.getValue(now) ?? null,
          county: p?.county?.getValue(now) ?? null,
          costToDate: p?.costToDate?.getValue(now) ?? null,
          complexity: p?.complexity?.getValue(now) ?? null,
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
