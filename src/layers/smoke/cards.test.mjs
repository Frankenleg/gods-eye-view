import test from 'node:test';
import assert from 'node:assert/strict';
import { densityAccent, smokeAnchorDegrees, buildSmokeCard } from './cards.js';

const ring = [
  [-84.1, 31.1],
  [-84.2, 31.1],
  [-84.2, 31.2],
  [-84.1, 31.1],
];

test('density maps to a smoke ramp with a fallback for unclassified plumes', () => {
  const accents = ['Light', 'Medium', 'Heavy', null].map(densityAccent);
  assert.equal(new Set(accents).size, 4, 'each density needs its own accent');
  for (const accent of accents) assert.match(accent, /^#[0-9a-f]{6}$/i);
});

test('the card anchors at the centroid of the largest polygon', () => {
  const anchor = smokeAnchorDegrees([[ring]]);
  assert.ok(Math.abs(anchor.lon - -84.1667) < 0.001);
  assert.ok(Math.abs(anchor.lat - 31.1333) < 0.001);
});

test('a full row renders density, satellite, observation window, and age', () => {
  const now = Date.UTC(2026, 8, 23, 18, 0);
  const card = buildSmokeCard(
    {
      stableId: '20260923:4',
      density: 'Heavy',
      satellite: 'GOES-WEST',
      startTime: Date.UTC(2026, 8, 23, 12, 0),
      endTime: Date.UTC(2026, 8, 23, 15, 0),
    },
    now,
  );
  assert.equal(card.id, 'smoke-card:20260923:4');
  assert.equal(card.title, 'SMOKE · Heavy density');
  assert.deepEqual(card.details, [
    'GOES-WEST · observed 12:00–15:00 UTC',
    'ended 3h ago',
  ]);
  assert.equal(card.selected, true);
  assert.equal(card.interactive, false);
  assert.equal(card.accent, densityAccent('Heavy'));
});

test('missing attributes degrade to available facts instead of placeholders', () => {
  const card = buildSmokeCard(
    {
      stableId: 'd:0',
      density: null,
      satellite: null,
      startTime: null,
      endTime: null,
    },
    Date.UTC(2026, 8, 23, 18, 0),
  );
  assert.equal(card.title, 'SMOKE · Unclassified density');
  assert.deepEqual(card.details, []);
});
