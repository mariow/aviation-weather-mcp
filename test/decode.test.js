// Unit tests for the pure decoding/classification helpers.
// Run against the built artifact (dist/), so the bundled airport DB resolves
// the same way it does in production. No network is touched — these are fast,
// deterministic, and gate every PR.
//
//   npm run build && node --test
//
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVisibSM,
  flightCategory,
  visToKm,
  windStr,
  cloudStr,
  wmoDesc,
  inIconD2Coverage,
  selectModel,
  groupDaylightHours,
  enumerateMembers,
  computeOutlook,
  computeDeterministicTrend,
  noGoCategory,
  lookupAirport,
  lerp,
  deriveCeiling,
  ceilingStr,
} from '../dist/index.js';

test('parseVisibSM handles statute-mile encodings', () => {
  assert.equal(parseVisibSM(undefined), 10, 'missing → assume good (10 SM)');
  assert.equal(parseVisibSM(6), 6, 'numeric passthrough');
  assert.equal(parseVisibSM('10+'), 10);
  assert.equal(parseVisibSM('P6SM'), 10);
  assert.equal(parseVisibSM('1/2'), 0.5, 'simple fraction');
  assert.equal(parseVisibSM('3/4'), 0.75);
  assert.equal(parseVisibSM('2 1/2'), 2.5, 'mixed number');
  assert.equal(parseVisibSM('garbage'), 10, 'unparseable → assume good');
});

test('flightCategory maps visibility + ceiling to the right band', () => {
  // Boundaries matter most: these are the lines pilots make go/no-go calls on.
  assert.equal(flightCategory(10, 50), 'VFR', 'clear day, high ceiling');
  assert.equal(flightCategory('1/2', 8), 'LIFR', 'vis < 1 SM → LIFR');
  assert.equal(flightCategory(10, 4), 'LIFR', 'ceiling 400ft → LIFR');
  assert.equal(flightCategory(2, 50), 'IFR', 'vis 2 SM → IFR');
  assert.equal(flightCategory(10, 9), 'IFR', 'ceiling 900ft → IFR');
  assert.equal(flightCategory(4, 50), 'MVFR', 'vis 4 SM → MVFR');
  assert.equal(flightCategory(10, 30), 'MVFR', 'ceiling 3000ft → MVFR');
  assert.equal(flightCategory(10, null), 'VFR', 'unlimited ceiling → VFR');
});

test('visToKm converts and caps at >10km', () => {
  assert.equal(visToKm(10), '>10km', '10 SM ≈ 16km → capped');
  assert.equal(visToKm(6), '9.7km', '6 SM ≈ 9.66km, just under the 10km cap');
  assert.equal(visToKm(7), '>10km', '7 SM ≈ 11.3km → capped');
  assert.equal(visToKm(1), '1.6km');
  assert.equal(visToKm('1/2'), '0.8km');
});

test('windStr formats direction, speed, and gusts', () => {
  assert.equal(windStr(undefined, undefined, undefined), '---', 'no wind data');
  assert.equal(windStr(90, 12, undefined), '090°/12kt');
  assert.equal(windStr(270, 15, 25), '270°/15kt G25kt', 'with gust');
  assert.equal(windStr('VRB', 3, undefined), 'VRB/3kt');
  assert.equal(windStr(0, 0, undefined), 'VRB/0kt', 'calm/variable');
});

test('cloudStr renders layers, clear flags, and vertical visibility', () => {
  assert.equal(cloudStr({ vertVis: 2 }), 'VV200ft', 'obscured sky');
  assert.equal(cloudStr({ cldCvg1: 'CLR' }), 'CLR');
  assert.equal(cloudStr({ cldCvg1: 'SKC' }), 'SKC');
  assert.equal(cloudStr({}), 'SKC', 'no layers → SKC');
  assert.equal(cloudStr({ cldCvg1: 'BKN', cldBas1: 25 }), 'BKN@2500ft');
  assert.equal(
    cloudStr({ cldCvg1: 'SCT', cldBas1: 18, cldCvg2: 'OVC', cldBas2: 40 }),
    'SCT@1800ft, OVC@4000ft',
    'multiple layers joined',
  );
});

test('wmoDesc buckets weather codes', () => {
  assert.equal(wmoDesc(null), '');
  assert.equal(wmoDesc(0), 'Clear');
  assert.equal(wmoDesc(2), 'Partly cloudy');
  assert.equal(wmoDesc(45), 'Fog');
  assert.equal(wmoDesc(65), 'Rain');
  assert.equal(wmoDesc(75), 'Snow');
  assert.equal(wmoDesc(95), 'Thunderstorm');
});

test('inIconD2Coverage / selectModel pick the right DWD model by region', () => {
  assert.equal(inIconD2Coverage(48.13, 11.58), true, 'Munich is inside ICON-D2');
  assert.equal(inIconD2Coverage(40.0, 11.0), false, 'Rome is south of ICON-D2');
  assert.equal(selectModel(48.13, 11.58), 'icon_d2', 'Germany → ICON-D2');
  assert.equal(selectModel(41.9, 12.5), 'icon_eu', 'Italy → ICON-EU');
  assert.equal(selectModel(40.7, -74.0), 'icon_seamless', 'New York → global seamless');
});

test('noGoCategory thresholds', () => {
  assert.match(noGoCategory(0.1), /GO-likely/);
  assert.match(noGoCategory(0.4), /MARGINAL/);
  assert.match(noGoCategory(0.8), /NO-GO-likely/);
  // Boundary checks (< 0.25 GO, <= 0.60 MARGINAL).
  assert.match(noGoCategory(0.24), /GO-likely/);
  assert.match(noGoCategory(0.25), /MARGINAL/);
  assert.match(noGoCategory(0.6), /MARGINAL/);
  assert.match(noGoCategory(0.61), /NO-GO-likely/);
});

test('lerp interpolates linearly', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(10, 20, 0.25), 12.5);
});

test('lookupAirport resolves bundled ICAO codes offline', () => {
  const eddm = lookupAirport('EDDM');
  assert.ok(eddm, 'EDDM should be in the bundled DB');
  assert.ok(Math.abs(eddm.lat - 48.35) < 0.1, 'Munich latitude');
  assert.ok(Math.abs(eddm.lon - 11.79) < 0.1, 'Munich longitude');
  assert.deepEqual(lookupAirport('eddm'), eddm, 'case-insensitive');
  assert.equal(lookupAirport('ZZZZ'), null, 'unknown code → null');
});

test('lookupAirport resolves typical German airfields, including pure GA fields', () => {
  // Major airports + GA fields Mario actually flies to. GA fields (EDVY, EDFE,
  // EDTF) have no METAR, so they would be unresolvable without the bundled DB.
  const fields = ['EDDM', 'EDDF', 'EDDB', 'EDDL', 'EDDS', 'EDDK', 'EDDH', 'EDJA', 'EDVY', 'EDFE', 'EDTF'];
  for (const icao of fields) {
    const c = lookupAirport(icao);
    assert.ok(c, `${icao} should resolve from the bundled DB`);
    assert.ok(c.lat > 47 && c.lat < 55.5, `${icao} latitude within Germany (got ${c.lat})`);
    assert.ok(c.lon > 5 && c.lon < 15.5, `${icao} longitude within Germany (got ${c.lon})`);
    assert.ok(c.name && c.name.length > 0, `${icao} has a name`);
  }
  assert.match(lookupAirport('EDVY').name, /Porta Westfalica/i, 'GA field name resolves');
});

test('groupDaylightHours keeps only hours within the daylight window', () => {
  const time = [
    '2026-06-07T05:00', '2026-06-07T08:00', '2026-06-07T12:00',
    '2026-06-07T19:00', '2026-06-07T20:00',
    '2026-06-08T09:00',
  ];
  const byDay = groupDaylightHours(time, 8, 20); // 08:00 inclusive .. 20:00 exclusive
  assert.deepEqual([...byDay.keys()], ['2026-06-07', '2026-06-08']);
  assert.deepEqual(byDay.get('2026-06-07'), [1, 2, 3], '08,12,19 in window; 05 and 20 excluded');
  assert.deepEqual(byDay.get('2026-06-08'), [5]);
});

test('enumerateMembers finds control + member suffixes for a variable', () => {
  const hourly = {
    time: [],
    cloud_cover_low: [],
    cloud_cover_low_member01: [],
    cloud_cover_low_member02: [],
    cloud_cover_mid: [], // different variable, must be ignored
    cape: [],
  };
  const sfx = enumerateMembers(hourly, 'cloud_cover_low').sort();
  assert.deepEqual(sfx, ['', '_member01', '_member02']);
});

test('computeOutlook pools members into per-day P(No-Go)', () => {
  // Two daylight hours on one day. 3 members; thresholds: cloud > 80, cape > 500.
  // member '' : both hours clear      → GO
  // _member01 : both hours overcast   → NO-GO (2/2 bad ≥ 0.5)
  // _member02 : one hour high CAPE    → NO-GO (1/2 bad ≥ 0.5)
  // → 2 of 3 effective members say No-Go → pNoGo = 2/3.
  const ens = {
    hourly: {
      time: ['2026-06-07T10:00', '2026-06-07T14:00'],
      cloud_cover_low: [10, 20],
      cape: [0, 0],
      cloud_cover_low_member01: [90, 95],
      cape_member01: [0, 0],
      cloud_cover_low_member02: [10, 10],
      cape_member02: [0, 900],
    },
  };
  const { days, cloudMembers, capeMembers } = computeOutlook(ens, 8, 20, 80, 500);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-06-07');
  assert.equal(days[0].effectiveMembers, 3);
  assert.ok(Math.abs(days[0].pNoGo - 2 / 3) < 1e-9, 'pNoGo = 2/3');
  assert.equal(cloudMembers, 3, 'all three have cloud series');
  assert.equal(capeMembers, 3, 'all three have cape series');
});

test('computeOutlook ignores hours beyond a member horizon (all-null)', () => {
  // Second member drops out after the first hour (nulls) — must not count it
  // as a No-Go for hours it never forecast.
  const ens = {
    hourly: {
      time: ['2026-06-07T10:00', '2026-06-07T14:00'],
      cloud_cover_low: [10, 10],
      cape: [0, 0],
      cloud_cover_low_member01: [90, null],
      cape_member01: [0, null],
    },
  };
  const { days } = computeOutlook(ens, 8, 20, 80, 500);
  // member01 has 1 valid hour, 1 bad → 1/1 ≥ 0.5 → No-Go. Control is clear.
  assert.equal(days[0].effectiveMembers, 2);
  assert.ok(Math.abs(days[0].pNoGo - 0.5) < 1e-9);
});

test('computeDeterministicTrend aggregates daylight max/sum per day', () => {
  const data = {
    hourly: {
      time: ['2026-06-07T09:00', '2026-06-07T15:00', '2026-06-07T23:00'],
      cloud_cover_low: [40, 70, 90],
      cape: [100, 800, 1200],
      precipitation: [0.0, 1.5, 5.0],
    },
  };
  const trend = computeDeterministicTrend(data, 8, 20); // 23:00 excluded
  const day = trend.get('2026-06-07');
  assert.equal(day.maxLowCloud, 70, 'max over daylight hours only');
  assert.equal(day.maxCape, 800);
  assert.equal(day.precipSum, 1.5, 'sum over daylight hours only');
});

test('deriveCeiling finds the lowest BKN/OVC deck as ft AGL', () => {
  const data = {
    elevation: 100,
    hourly: {
      cloud_cover_1000hPa: [0], geopotential_height_1000hPa: [150],
      cloud_cover_975hPa: [10], geopotential_height_975hPa: [350],
      cloud_cover_950hPa: [40], geopotential_height_950hPa: [560],
      cloud_cover_925hPa: [90], geopotential_height_925hPa: [800], // first ≥50% → ceiling
    },
  };
  const c = deriveCeiling(data, 0);
  assert.equal(c.kind, 'ceiling');
  assert.equal(c.ft, 2297, '(800m − 100m) × 3.281 ≈ 2297 ft AGL');
});

test('deriveCeiling reports "no deck" (NOT clear) when every level is below threshold', () => {
  // Critical for safety: scattered cloud must not read as a confirmed clear sky.
  const data = {
    elevation: 0,
    hourly: {
      cloud_cover_1000hPa: [0], geopotential_height_1000hPa: [110],
      cloud_cover_925hPa: [30], geopotential_height_925hPa: [770],
      cloud_cover_700hPa: [20], geopotential_height_700hPa: [3000],
    },
  };
  const c = deriveCeiling(data, 0);
  assert.equal(c.kind, 'none');
  assert.equal(c.belowFt, Math.round(3000 * 3.281), 'highest checked level, AGL');
});

test('deriveCeiling returns nodata when pressure data or elevation is missing', () => {
  assert.equal(deriveCeiling({ elevation: 100, hourly: {} }, 0).kind, 'nodata', 'no pressure levels → nodata');
  assert.equal(
    deriveCeiling({ hourly: { cloud_cover_950hPa: [80], geopotential_height_950hPa: [500] } }, 0).kind,
    'nodata',
    'no elevation → nodata',
  );
});

test('ceilingStr renders every state distinctly and never blank', () => {
  assert.equal(ceilingStr({ kind: 'ceiling', ft: 1700 }), 'ceil ~1700ft');
  assert.equal(ceilingStr({ kind: 'none', belowFt: 8600 }), 'ceil none<8600ft');
  assert.equal(ceilingStr({ kind: 'nodata' }), 'ceil n/a', 'missing data is explicit, not empty');
});
