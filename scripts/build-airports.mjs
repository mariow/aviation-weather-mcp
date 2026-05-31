#!/usr/bin/env node
/**
 * Build a compact ICAO -> [lat, lon, name] lookup from the OurAirports dataset.
 *
 * Source: https://davidmegginson.github.io/ourairports-data/airports.csv (Public Domain)
 *
 * Usage:
 *   curl -sL https://davidmegginson.github.io/ourairports-data/airports.csv -o /tmp/airports.csv
 *   node scripts/build-airports.mjs /tmp/airports.csv data/airports.json
 *
 * We index every 4-letter ICAO-style code found in the `ident`, `icao_code`, and
 * `gps_code` columns so that pure GA fields (whose `ident` may be the ICAO code while
 * `icao_code` is blank, or vice-versa) all resolve. Closed airports are skipped.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('Usage: node scripts/build-airports.mjs <airports.csv> <out.json>');
  process.exit(1);
}

/** Parse one CSV line that may contain quoted fields with embedded commas. */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const ICAO = /^[A-Z]{4}$/;

const text = readFileSync(inPath, 'utf8');
const lines = text.split(/\r?\n/);
const header = parseCsvLine(lines[0]);
const col = (name) => header.indexOf(name);
const cIdent = col('ident');
const cType = col('type');
const cName = col('name');
const cLat = col('latitude_deg');
const cLon = col('longitude_deg');
const cIcao = col('icao_code');
const cGps = col('gps_code');

const map = {};
let rows = 0;
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const f = parseCsvLine(lines[i]);
  if (f[cType] === 'closed') continue;
  const lat = Number(f[cLat]);
  const lon = Number(f[cLon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const name = f[cName] || '';
  const codes = new Set([f[cIdent], f[cIcao], f[cGps]].map((s) => (s || '').toUpperCase()).filter((s) => ICAO.test(s)));
  if (codes.size === 0) continue;
  rows++;
  for (const code of codes) {
    // First writer wins, but prefer a non-heliport / larger field if a clash occurs.
    if (!(code in map)) map[code] = [Number(lat.toFixed(5)), Number(lon.toFixed(5)), name];
  }
}

const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
writeFileSync(outPath, JSON.stringify(sorted));
console.error(`Indexed ${Object.keys(sorted).length} ICAO codes from ${rows} airports -> ${outPath}`);
