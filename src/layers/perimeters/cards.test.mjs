import test from 'node:test';
import assert from 'node:assert/strict';
import { perimeterAnchorDegrees, buildIncidentCard } from './cards.js';

const square = [
  [-108.2, 35.0],
  [-108.0, 35.0],
  [-108.0, 35.2],
  [-108.2, 35.2],
  [-108.2, 35.0],
];
const tiny = [
  [-107.01, 34.0],
  [-107.0, 34.0],
  [-107.0, 34.01],
  [-107.01, 34.0],
];

test('the card anchors at the centroid of the largest polygon', () => {
  const anchor = perimeterAnchorDegrees([[tiny], [square]]);
  assert.ok(Math.abs(anchor.lon - -108.1) < 1e-9);
  assert.ok(Math.abs(anchor.lat - 35.1) < 1e-9);
});

test('a full incident row renders name, size, containment, and ages', () => {
  const now = 1758000000000;
  const card = buildIncidentCard(
    {
      stableId: '2026-NMGNF-000123',
      name: 'Frijoles',
      acres: 15956.4,
      containedPct: 74,
      state: 'US-NM',
      category: 'WF',
      discoveredTime: now - 36 * 3600000,
      updatedTime: now - 2 * 3600000,
    },
    now,
  );
  assert.equal(card.id, 'fire-perimeter-card:2026-NMGNF-000123');
  assert.equal(card.title, 'FIRE · Frijoles');
  assert.deepEqual(card.details, [
    '15,956 ac · 74% contained · US-NM',
    'discovered 1d ago · updated 2h ago',
  ]);
  assert.equal(card.selected, true);
  assert.equal(card.actionable, true);
  assert.equal(typeof card.accent, 'string');
});

test('missing attributes degrade to available facts instead of placeholders', () => {
  const card = buildIncidentCard(
    {
      stableId: 'x',
      name: null,
      acres: null,
      containedPct: null,
      state: null,
      category: 'RX',
      discoveredTime: null,
      updatedTime: null,
    },
    1758000000000,
  );
  assert.equal(card.title, 'FIRE · Unnamed incident');
  assert.deepEqual(card.details, ['containment unknown · RX']);
});
