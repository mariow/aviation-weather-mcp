// Live integration tests — these hit the real Open-Meteo hosts and validate that
// wx_outlook's data pipeline returns sane answers for typical German airfields.
//
// Opt-in only (skipped by default so CI and offline runs stay deterministic):
//   RUN_LIVE_TESTS=1 npm run build && node --test test/live.test.js
//
// They exercise BOTH hosts wx_outlook depends on:
//   - ensemble-api.open-meteo.com  (the multi-model ensemble → P(No-Go))
//   - api.open-meteo.com           (ICON-EU + ECMWF-IFS deterministic trends)
// so a firewall/proxy blocking one of them, or a drift in our request params,
// shows up here per airfield instead of as an opaque timeout in the client.
//
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeOutlook, computeDeterministicTrend, lookupAirport } from '../dist/index.js';

const LIVE = process.env.RUN_LIVE_TESTS === '1';
const skip = LIVE ? false : 'set RUN_LIVE_TESTS=1 to run live network tests';

const ENSEMBLE = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

// Typical German destinations: major fields + pure GA fields (no METAR).
const AIRFIELDS = ['EDDM', 'EDJA', 'EDVY', 'EDDB', 'EDDL'];

async function getJson(url, host) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    assert.fail(`${host} unreachable (${err?.name || 'error'}): check firewall/proxy access to ${host}`);
  }
  assert.ok(res.ok, `${host} → HTTP ${res.status}`);
  return res.json();
}

for (const icao of AIRFIELDS) {
  test(`[live] wx_outlook returns valid data for ${icao}`, { skip }, async () => {
    const c = lookupAirport(icao);
    assert.ok(c, `${icao} resolves from the bundled DB`);
    const base = `latitude=${c.lat}&longitude=${c.lon}&timezone=auto`;

    // 1. Ensemble host → per-day P(No-Go)
    const ens = await getJson(
      `${ENSEMBLE}?${base}&hourly=cloud_cover_low,cape&models=ecmwf_ifs025,gfs025&forecast_days=7`,
      'ensemble-api.open-meteo.com',
    );
    const outlook = computeOutlook(ens, 8, 18, 50, 1000);
    assert.ok(outlook.days.length >= 5, `${icao}: at least 5 outlook days (got ${outlook.days.length})`);
    assert.ok(outlook.usableMembers >= 50, `${icao}: >=50 contributing members (got ${outlook.usableMembers})`);
    assert.ok(outlook.cloudMembers >= 40, `${icao}: ECMWF low-cloud members present (got ${outlook.cloudMembers})`);
    for (const d of outlook.days) {
      assert.ok(d.pNoGo >= 0 && d.pNoGo <= 1, `${icao} ${d.date}: pNoGo in [0,1] (got ${d.pNoGo})`);
      assert.ok(d.effectiveMembers > 0, `${icao} ${d.date}: effective members > 0`);
    }

    // 2. api host → ICON-EU (the model the timeout was attributed to) must yield ~5 days
    const eu = await getJson(
      `${FORECAST}?${base}&hourly=cloud_cover_low,cape,precipitation&models=icon_eu&forecast_days=5`,
      'api.open-meteo.com',
    );
    const euTrend = computeDeterministicTrend(eu, 8, 18);
    assert.ok(euTrend.size >= 4, `${icao}: ICON-EU yields >=4 daylight days (got ${euTrend.size})`);

    // 3. api host → ECMWF-IFS deterministic trend
    const ec = await getJson(
      `${FORECAST}?${base}&hourly=cloud_cover_low,cape,precipitation&models=ecmwf_ifs025&forecast_days=7`,
      'api.open-meteo.com',
    );
    const ecTrend = computeDeterministicTrend(ec, 8, 18);
    assert.ok(ecTrend.size >= 5, `${icao}: ECMWF-IFS yields >=5 daylight days (got ${ecTrend.size})`);
  });
}
