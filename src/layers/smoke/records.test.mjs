import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSmokeKml } from './records.js';

const placemark = ({
  density = 'Light',
  satellite = 'GOES-WEST',
  start = '2026266 1200UTC',
  end = '2026266 1500UTC',
  coordinates = `
        -84.103926,31.133006,0
        -84.129646,31.120145,0
        -84.138832,31.107285,0
        -84.103926,31.133006,0
      `,
} = {}) => `<Placemark><description><![CDATA[<div style="width:170px;">Start Time: ${start}<br>End Time: ${end}<br>Density: ${density}<br>Satellite: ${satellite}</div>]]></description>
<styleUrl>#Smoke_${density}_style</styleUrl>
<Polygon>
  <tessellate>1</tessellate>
  <outerBoundaryIs>
    <LinearRing>
      <coordinates>${coordinates}</coordinates>
    </LinearRing>
  </outerBoundaryIs>
</Polygon>
</Placemark>`;

const kml = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;

test('placemarks normalize to density, observation window, satellite, and rings', () => {
  const rows = normalizeSmokeKml(
    kml(placemark() + placemark({ density: 'Heavy', satellite: 'GOES-EAST' })),
    { day: '20260923' },
  );
  assert.equal(rows.length, 2);
  // 2026 day-of-year 266 = September 23; 1200UTC.
  assert.deepEqual(rows[0], {
    stableId: '20260923:0',
    density: 'Light',
    satellite: 'GOES-WEST',
    startTime: Date.UTC(2026, 8, 23, 12, 0),
    endTime: Date.UTC(2026, 8, 23, 15, 0),
    polygons: [
      [
        [
          [-84.103926, 31.133006],
          [-84.129646, 31.120145],
          [-84.138832, 31.107285],
          [-84.103926, 31.133006],
        ],
      ],
    ],
  });
  assert.equal(rows[1].density, 'Heavy');
  assert.equal(rows[1].stableId, '20260923:1');
});

test('unknown densities and missing attributes normalize to null, not undefined', () => {
  const body = `<Placemark><description><![CDATA[Density: Fog]]></description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>
  -84.1,31.1,0 -84.2,31.1,0 -84.2,31.2,0 -84.1,31.1,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  const rows = normalizeSmokeKml(kml(body), { day: 'd' });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    {
      density: rows[0].density,
      satellite: rows[0].satellite,
      startTime: rows[0].startTime,
      endTime: rows[0].endTime,
    },
    { density: null, satellite: null, startTime: null, endTime: null },
  );
});

test('an invalid placemark is skipped so one bad polygon cannot blank the layer', () => {
  for (const bad of [
    // Too few positions for a ring.
    placemark({ coordinates: '-84.1,31.1,0 -84.2,31.1,0' }),
    // Out-of-range longitude.
    placemark({
      coordinates: '-284.1,31.1,0 -84.2,31.1,0 -84.2,31.2,0 -284.1,31.1,0',
    }),
    // No polygon at all.
    '<Placemark><description>Density: Light</description></Placemark>',
  ]) {
    const rows = normalizeSmokeKml(kml(bad + placemark()), { day: 'd' });
    assert.equal(rows.length, 1, 'bad placemark must be skipped, not fatal');
  }
});

test('a quiet day parses to an empty snapshot; a non-KML payload is rejected', () => {
  assert.deepEqual(normalizeSmokeKml(kml(''), { day: 'd' }), []);
  for (const payload of [null, '', '<html>Not Found</html>', '{"rows":[]}']) {
    assert.equal(normalizeSmokeKml(payload, { day: 'd' }), null);
  }
});
