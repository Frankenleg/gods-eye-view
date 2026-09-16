import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirePerimetersLayer } from './index.js';

function harness(source) {
  const sources = [];
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createFirePerimetersLayer({ source });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources };
}

const ring = [
  [-108.1, 35.2],
  [-108.0, 35.2],
  [-108.0, 35.3],
  [-108.1, 35.2],
];
const row = {
  stableId: '2026-NMGNF-000123',
  name: 'Fixture Fire',
  acres: 512.5,
  containedPct: 40,
  state: 'US-NM',
  category: 'WF',
  discoveredTime: 1757900000000,
  updatedTime: 1757950000000,
  polygons: [[ring]],
};

test('each perimeter polygon renders as one filled entity with its fire line', async () => {
  const h = harness({
    getSnapshot: async () => [row, { ...row, stableId: 'other', polygons: [[ring], [ring]] }],
  });
  assert.equal(await h.layer.update(h.viewer), true);
  const entities = h.sources[0].entities.values;
  assert.equal(entities.length, 3);
  assert.equal(entities[0].id, 'fire-perimeter:2026-NMGNF-000123:0');
  assert.ok(entities[0].polygon, 'perimeter fill missing');
  assert.ok(entities[0].polyline, 'fire line missing');
  assert.equal(entities[1].id, 'fire-perimeter:other:0');
  assert.equal(entities[2].id, 'fire-perimeter:other:1');
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

test('analyst records expose incident facts without geometry payloads', async () => {
  const h = harness({ getSnapshot: async () => [row] });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'Fixture Fire');
  assert.equal(records[0].acres, 512.5);
  assert.equal(records[0].containedPct, 40);
  assert.equal(records[0].state, 'US-NM');
  assert.equal('polygons' in records[0], false);
});
