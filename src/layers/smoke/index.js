import * as Cesium from 'cesium';
import {
  SMOKE_OVERLAY_SOURCE_ID,
  smokeAnchorDegrees,
  buildSmokeCard,
  densityAccent,
} from './cards.js';
export { normalizeSmokeKml } from './records.js';
export { createSmokeSource } from './source.js';
export * from './cards.js';

/** Fill color for a plume by analyst density (same ramp as the card accent). */
export function densityColor(density) {
  return Cesium.Color.fromCssColorString(densityAccent(density));
}

// Heavier smoke reads darker AND denser on the globe.
const FILL_ALPHA = Object.freeze({ Light: 0.18, Medium: 0.28, Heavy: 0.38 });

const ringPositions = (ring) =>
  ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));

const PICK_PREFIX = 'smoke:';
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Own one smoke-plume display, its refresh lifecycle, and click selection. */
export function createSmokeLayer({
  source,
  overlayHost = null,
  screenSpaceEventHandlerFactory = null,
  picking = null,
  pointer = null,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Smoke requires a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _clickHandler = null;
  let _selectedId = null;
  let _selectedCardId = null;
  /** @type {Map<string, {stableId: string, anchor: {lon: number, lat: number}}>} */
  const _rowById = new Map();

  const canSelect = () =>
    overlayHost && screenSpaceEventHandlerFactory && picking;

  function publishSelectedCard() {
    if (!canSelect()) return;
    const row = _selectedId ? _rowById.get(_selectedId) : null;
    if (!row) {
      _selectedId = null;
      _selectedCardId = null;
      overlayHost.setEntries(SMOKE_OVERLAY_SOURCE_ID, [], CARD_HOST_OPTIONS);
      return;
    }
    const card = {
      ...buildSmokeCard(row, Date.now()),
      position: Cesium.Cartesian3.fromDegrees(row.anchor.lon, row.anchor.lat),
    };
    _selectedCardId = card.id;
    overlayHost.setEntries(SMOKE_OVERLAY_SOURCE_ID, [card], CARD_HOST_OPTIONS);
  }

  /** Resolve a scene pick to one of this layer's plume ids, or null. */
  function pickedPlumeId(picked) {
    const pickId = picking.resolvePickId(picked);
    if (typeof pickId !== 'string' || !pickId.startsWith(PICK_PREFIX))
      return null;
    const plumeId = pickId
      .slice(PICK_PREFIX.length)
      .split(':')
      .slice(0, 2)
      .join(':');
    return _rowById.has(plumeId) ? plumeId : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickHandler || !_viewer) return;
    // Not registered in the pick-ownership registry, for the same reason as
    // fire perimeters: claiming large ground polygons would make sibling
    // layers' overlay cards inert anywhere over a plume.
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const picked = _viewer.scene.pick(click.position);
      const plumeId = picked ? pickedPlumeId(picked) : null;
      if (plumeId) {
        _selectedId = plumeId;
        publishSelectedCard();
        return;
      }
      // A pick that belongs to a sibling layer is not "empty space".
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
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
  }

  function clearSelection() {
    _selectedId = null;
    _selectedCardId = null;
    if (overlayHost) {
      overlayHost.clearSource(SMOKE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible?.(SMOKE_OVERLAY_SOURCE_ID, false);
    }
  }

  const layer = {
    id: 'smoke',
    name: 'Smoke Plumes',
    icon: '≋',
    source: 'NOAA HMS',
    updateInterval: 600000,

    init(viewer) {
      if (_viewer) throw new Error('Smoke layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('smoke');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:Smoke] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost?.setVisible?.(SMOKE_OVERLAY_SOURCE_ID, true);
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
        _rowById.clear();
        for (const row of rows) {
          const color = densityColor(row.density);
          const alpha = FILL_ALPHA[row.density] ?? 0.22;
          for (const [index, rings] of row.polygons.entries()) {
            const [outer, ...holes] = rings;
            nextEntities.push(
              new Cesium.Entity({
                id: `smoke:${row.stableId}:${index}`,
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(
                    ringPositions(outer),
                    holes.map(
                      (hole) =>
                        new Cesium.PolygonHierarchy(ringPositions(hole)),
                    ),
                  ),
                  material: new Cesium.ColorMaterialProperty(
                    color.withAlpha(alpha),
                  ),
                },
              }),
            );
          }
          const { polygons, ...facts } = row;
          _rowById.set(row.stableId, {
            ...facts,
            anchor: smokeAnchorDegrees(polygons),
          });
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_selectedId) publishSelectedCard();
        _count = rows.length;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Smoke] Updated: ${_count} plumes, ${nextEntities.length} polygons`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Smoke] Fetch error:', e);
        _lastError = e?.message || 'Smoke source unavailable';
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

    /** Snapshot plume facts (with card-anchor coordinates) for the analyst query engine. */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of _rowById.values()) {
        if (result.length >= limit) break;
        const { anchor, stableId, ...facts } = row;
        result.push({
          id: stableId,
          ...facts,
          lat: anchor.lat,
          lon: anchor.lon,
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
