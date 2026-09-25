import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmokeLayer } from './index.js';

function harness(source, { pick = () => null, cardHit = () => null } = {}) {
  const sources = [];
  const overlay = { entries: new Map() };
  const clicks = { handler: null, destroyed: 0 };
  const viewer = {
    scene: { pick },
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createSmokeLayer({
    source,
    overlayHost: {
      setEntries(sourceId, entries) {
        overlay.entries.set(sourceId, entries);
      },
      setVisible() {},
      clearSource(sourceId) {
        overlay.entries.delete(sourceId);
      },
      hitTest: (x, y, options) => cardHit(x, y, options),
    },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(callback) {
        clicks.handler = callback;
      },
      destroy() {
        clicks.destroyed += 1;
        clicks.handler = null;
      },
    }),
    picking: {
      resolvePickId: (picked) => picked?.id ?? null,
      isOwnedByOtherLayer: (layerId, pickedId) =>
        String(pickedId).startsWith('other-layer:'),
    },
    pointer: { isPointerFree: () => true },
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, overlay, clicks };
}

const ring = [
  [-84.1, 31.1],
  [-84.2, 31.1],
  [-84.2, 31.2],
  [-84.1, 31.1],
];
const row = {
  stableId: '20260923:0',
  density: 'Heavy',
  satellite: 'GOES-WEST',
  startTime: 1758628800000,
  endTime: 1758639600000,
  polygons: [[ring]],
};

test('each plume renders as one filled entity', async () => {
  const h = harness({
    getSnapshot: async () => [row, { ...row, stableId: '20260923:1' }],
  });
  assert.equal(await h.layer.update(h.viewer), true);
  const entities = h.sources[0].entities.values;
  assert.equal(entities.length, 2);
  assert.equal(entities[0].id, 'smoke:20260923:0:0');
  assert.ok(entities[0].polygon, 'plume fill missing');
  assert.equal(h.layer.getStats().count, 2);
});

test('late refresh cannot publish after disable or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve, signal;
    const h = harness({
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve([row]);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    h.layer.destroy(h.viewer);
  }
});

test('clicking a plume publishes its card; empty space clears it', async () => {
  let pickResult = null;
  const h = harness(
    { getSnapshot: async () => [row] },
    { pick: () => pickResult },
  );
  await h.layer.update(h.viewer);
  pickResult = { id: 'smoke:20260923:0:0' };
  h.clicks.handler({ position: { x: 10, y: 10 } });
  const entries = h.overlay.entries.get('smoke');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'smoke-card:20260923:0');
  assert.ok(entries[0].position, 'card must carry a world anchor');

  pickResult = { id: 'other-layer:aircraft-1' };
  h.clicks.handler({ position: { x: 10, y: 10 } });
  assert.equal(
    h.overlay.entries.get('smoke')?.length,
    1,
    'sibling-layer picks must not clear the selection',
  );

  pickResult = null;
  h.clicks.handler({ position: { x: 10, y: 10 } });
  assert.equal(h.overlay.entries.get('smoke')?.length ?? 0, 0);
});

test('disable removes the click handler and any card', async () => {
  const h = harness(
    { getSnapshot: async () => [row] },
    { pick: () => ({ id: 'smoke:20260923:0:0' }) },
  );
  await h.layer.update(h.viewer);
  h.clicks.handler({ position: { x: 10, y: 10 } });
  h.layer.disable(h.viewer);
  assert.equal(h.clicks.destroyed, 1);
  assert.equal(h.overlay.entries.has('smoke'), false);
});

test('analyst records expose plume facts with anchor coordinates', async () => {
  const h = harness({ getSnapshot: async () => [row] });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, '20260923:0');
  assert.equal(records[0].density, 'Heavy');
  assert.equal(records[0].satellite, 'GOES-WEST');
  assert.equal(records[0].startTime, row.startTime);
  assert.equal(records[0].endTime, row.endTime);
  assert.ok(Math.abs(records[0].lat - 31.1333) < 0.001);
  assert.ok(Math.abs(records[0].lon - -84.1667) < 0.001);
  assert.equal('polygons' in records[0], false);
});
