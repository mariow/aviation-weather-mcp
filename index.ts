#!/usr/bin/env node
/**
 * Aviation Weather MCP Server
 *
 * Provides aviation weather tools using two free, keyless APIs:
 *   - aviationweather.gov  — METARs, TAFs, PIREPs, SIGMETs
 *   - open-meteo.com       — ICON-D2 / ICON-EU NWP forecasts (DWD models)
 *
 * Tools:
 *   wx_metar       — current METAR, decoded
 *   wx_taf         — TAF forecast periods, decoded
 *   wx_pireps      — recent PIREPs near an airport
 *   wx_sigmets     — active SIGMETs/AIRMETs (global / europe / germany filter)
 *   wx_icon_d2     — hourly ICON-D2 NWP forecast for any lat/lon
 *   wx_preflight   — composite VFR brief: METAR + TAF + ICON-D2
 *   wx_route       — direct-route brief: METARs + 5-point ICON-D2 + SIGMETs
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const AVWX_BASE = 'https://aviationweather.gov/api/data';
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1';

function log(msg: string): void {
  console.error(`[AVWX] ${msg}`);
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function avwxFetch(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${AVWX_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'NanoClaw/1.0 (aviation-weather-mcp)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`aviationweather.gov/${endpoint}: HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function openMeteoFetch(params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${OPEN_METEO_BASE}/forecast`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// ─── Type definitions ─────────────────────────────────────────────────────────

interface MetarData {
  icaoId?: string;
  rawOb?: string;
  obsTime?: number;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  wgst?: number;
  visib?: string | number;
  altim?: number;
  wxString?: string;
  cldCvg1?: string; cldBas1?: number;
  cldCvg2?: string; cldBas2?: number;
  cldCvg3?: string; cldBas3?: number;
  cldCvg4?: string; cldBas4?: number;
  vertVis?: number;
  fltcat?: string;
  ceil?: number; // hundreds of feet
  lat?: number;
  lon?: number;
  name?: string;
}

interface TafForecast {
  timeFrom?: number;
  timeTo?: number;
  wdir?: number | string;
  wspd?: number;
  wgst?: number;
  visib?: string | number;
  wxString?: string;
  cldCvg1?: string; cldBas1?: number;
  cldCvg2?: string; cldBas2?: number;
  cldCvg3?: string; cldBas3?: number;
  fltcat?: string;
  ceil?: number;
}

interface TafData {
  icaoId?: string;
  rawTAF?: string;
  issueTime?: string;
  validTimeFrom?: number;
  validTimeTo?: number;
  lat?: number;
  lon?: number;
  name?: string;
  fcsts?: TafForecast[];
}

interface StationData {
  icaoId?: string;
  lat?: number;
  lon?: number;
  name?: string;
  elev?: number;
}

interface OpenMeteoResponse {
  latitude?: number;
  longitude?: number;
  timezone?: string;
  hourly?: {
    time?: string[];
    visibility?: (number | null)[];
    cloud_cover_low?: (number | null)[];
    cloud_cover_mid?: (number | null)[];
    cloud_cover_high?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    wind_direction_10m?: (number | null)[];
    wind_speed_80m?: (number | null)[];
    wind_direction_80m?: (number | null)[];
    precipitation?: (number | null)[];
    cape?: (number | null)[];
    weather_code?: (number | null)[];
    cloud_base?: (number | null)[];
  };
}

// ─── Utility functions ────────────────────────────────────────────────────────

function parseVisibSM(visib: string | number | undefined): number {
  if (visib == null) return 10;
  if (typeof visib === 'number') return visib;
  if (visib === '10+' || visib === 'P6SM') return 10;
  // Handle fractions like "1/2", "3/4"
  const frac = visib.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  // Handle "2 1/2" style
  const mixed = visib.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const num = parseFloat(visib);
  return isNaN(num) ? 10 : num;
}

function flightCategory(visib: string | number | undefined, ceil: number | undefined | null): string {
  const visSM = parseVisibSM(visib);
  const ceilFt = ceil != null ? ceil * 100 : Infinity;
  if (visSM < 1 || ceilFt < 500) return 'LIFR';
  if (visSM < 3 || ceilFt < 1000) return 'IFR';
  if (visSM <= 5 || ceilFt <= 3000) return 'MVFR';
  return 'VFR';
}

function visToKm(visib: string | number | undefined): string {
  const sm = parseVisibSM(visib);
  const km = sm * 1.60934;
  return km >= 10 ? '>10km' : `${km.toFixed(1)}km`;
}

function windStr(wdir: number | string | undefined, wspd: number | undefined, wgst: number | undefined): string {
  if (wspd == null) return '---';
  const dir = (wdir === 0 || wdir === '0' || wdir === 'VRB') ? 'VRB' : `${String(wdir).padStart(3, '0')}°`;
  return `${dir}/${wspd}kt${wgst ? ` G${wgst}kt` : ''}`;
}

function cloudStr(m: { cldCvg1?: string; cldBas1?: number; cldCvg2?: string; cldBas2?: number; cldCvg3?: string; cldBas3?: number; cldCvg4?: string; cldBas4?: number; vertVis?: number }): string {
  if (m.vertVis != null) return `VV${m.vertVis * 100}ft`;
  const layers: string[] = [];
  for (const [cvg, bas] of [[m.cldCvg1, m.cldBas1], [m.cldCvg2, m.cldBas2], [m.cldCvg3, m.cldBas3], [m.cldCvg4, m.cldBas4]] as [string | undefined, number | undefined][]) {
    if (!cvg) break;
    if (cvg === 'CLR' || cvg === 'SKC') return cvg;
    if (cvg === 'CAVOK') return 'CAVOK';
    layers.push(`${cvg}@${bas != null ? bas * 100 : '?'}ft`);
  }
  return layers.length > 0 ? layers.join(', ') : 'SKC';
}

function wmoDesc(code: number | null): string {
  if (code == null) return '';
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 9) return 'Fog/misc';
  if (code <= 19) return 'Drizzle';
  if (code <= 29) return 'Rain';
  if (code <= 39) return 'Snow';
  if (code <= 49) return 'Fog';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 89) return 'Showers';
  if (code <= 99) return 'Thunderstorm';
  return `WMO${code}`;
}

function formatMetar(m: MetarData): string {
  const cat = m.fltcat || flightCategory(m.visib, m.ceil);
  const lines = [
    `**${m.icaoId || '?'}**${m.name ? ` (${m.name})` : ''} — Category: **${cat}**`,
    `Raw: \`${m.rawOb || 'N/A'}\``,
    `Wind: ${windStr(m.wdir, m.wspd, m.wgst)} | Vis: ${visToKm(m.visib)} | Ceil: ${m.ceil != null ? `${m.ceil * 100}ft` : 'Unlimited'}`,
    `Clouds: ${cloudStr(m)}`,
  ];
  if (m.wxString) lines.push(`Wx: ${m.wxString}`);
  if (m.temp != null) lines.push(`Temp/DP: ${m.temp}°C / ${m.dewp ?? '?'}°C | QNH: ${m.altim?.toFixed(0) ?? '?'} hPa`);
  return lines.join('\n');
}

function formatTafPeriod(f: TafForecast, label: string): string {
  const from = f.timeFrom ? new Date(f.timeFrom * 1000).toISOString().slice(11, 16) + 'Z' : '?';
  const to = f.timeTo ? new Date(f.timeTo * 1000).toISOString().slice(11, 16) + 'Z' : '?';
  const cat = f.fltcat || flightCategory(f.visib, f.ceil);
  const clouds = cloudStr(f as Parameters<typeof cloudStr>[0]);
  let line = `  ${label} ${from}→${to}: **${cat}** | Wind: ${windStr(f.wdir, f.wspd, f.wgst)} | Vis: ${visToKm(f.visib)} | ${clouds}`;
  if (f.wxString) line += ` | ${f.wxString}`;
  return line;
}

/** Returns true when coordinates are within ICON-D2 coverage area. */
function inIconD2Coverage(lat: number, lon: number): boolean {
  return lat >= 43 && lat <= 58 && lon >= -4 && lon <= 21;
}

/** Choose best available DWD model for a location. */
function selectModel(lat: number, lon: number): string {
  if (inIconD2Coverage(lat, lon)) return 'icon_d2';
  // ICON-EU covers all of Europe
  if (lat >= 30 && lat <= 73 && lon >= -28 && lon <= 48) return 'icon_eu';
  return 'icon_seamless';
}

const ICON_D2_VARIABLES = [
  'visibility',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_speed_80m',
  'wind_direction_80m',
  'precipitation',
  'cape',
  'weather_code',
  'cloud_base',
].join(',');

function formatIconForecast(data: OpenMeteoResponse, hours: number, model: string): string {
  const h = data.hourly;
  if (!h?.time?.length) return 'No forecast data available.';

  const now = new Date();
  const limit = new Date(now.getTime() + hours * 3_600_000);

  const rows: string[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = new Date(h.time[i] + 'Z');
    if (t < now || t > limit) continue;

    const vis = h.visibility?.[i];
    const visKm = vis != null ? (vis >= 10000 ? '>10km' : `${(vis / 1000).toFixed(1)}km`) : '?';
    const cloudBase = h.cloud_base?.[i]; // metres
    const cloudBaseFt = cloudBase != null ? Math.round(cloudBase * 3.281) : null;
    const cloudLow = h.cloud_cover_low?.[i];
    const windSpd = h.wind_speed_10m?.[i]; // km/h → kt
    const windDir = h.wind_direction_10m?.[i];
    const windSpd80 = h.wind_speed_80m?.[i];
    const precip = h.precipitation?.[i];
    const cape = h.cape?.[i];
    const wxCode = h.weather_code?.[i] ?? null;

    const windKt = windSpd != null ? Math.round(windSpd / 1.852) : null;
    const wind80Kt = windSpd80 != null ? Math.round(windSpd80 / 1.852) : null;

    // Estimate category (thresholds in SM, convert from metres)
    const visSMNum = vis != null ? vis / 1609.34 : 10;
    let cat = 'VFR';
    if (visSMNum < 1 || (cloudBaseFt != null && cloudBaseFt < 500)) cat = 'LIFR';
    else if (visSMNum < 3 || (cloudBaseFt != null && cloudBaseFt < 1000)) cat = 'IFR';
    else if (visSMNum <= 5 || (cloudBaseFt != null && cloudBaseFt <= 3000)) cat = 'MVFR';

    const parts = [
      t.toISOString().slice(5, 16).replace('T', ' ') + 'Z',
      cat,
      windKt != null ? `${String(Math.round(windDir ?? 0)).padStart(3, '0')}/${windKt}kt` : '',
      `vis ${visKm}`,
      cloudBaseFt != null ? `base ~${cloudBaseFt}ft` : '',
      cloudLow != null ? `low cld ${cloudLow}%` : '',
      precip != null && precip > 0 ? `precip ${precip.toFixed(1)}mm` : '',
      cape != null && cape > 500 ? `⚠ CAPE ${Math.round(cape)}` : '',
      wind80Kt != null && wind80Kt !== windKt ? `@80m:${wind80Kt}kt` : '',
      wxCode ? wmoDesc(wxCode) : '',
    ].filter(Boolean);

    rows.push(parts.join(' | '));
  }

  if (rows.length === 0) return 'No hourly data in the requested window.';
  return `Model: ${model.toUpperCase()} | Lat ${data.latitude?.toFixed(2)} Lon ${data.longitude?.toFixed(2)}\n` + rows.join('\n');
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

interface Coords { lat: number; lon: number; name: string }

async function getStationCoords(icao: string): Promise<Coords | null> {
  try {
    const data = await avwxFetch('station', { ids: icao.toUpperCase(), format: 'json' }) as StationData[];
    if (Array.isArray(data) && data.length > 0 && data[0].lat != null && data[0].lon != null) {
      return { lat: data[0].lat, lon: data[0].lon, name: data[0].name || icao };
    }
  } catch (err) {
    log(`Station lookup failed for ${icao}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'aviation-weather', version: '1.0.0' });

// ─── wx_metar ────────────────────────────────────────────────────────────────

server.tool(
  'wx_metar',
  'Get the latest METAR for an airport. Returns raw METAR plus decoded ceiling, visibility, wind, and VFR/MVFR/IFR/LIFR flight category.',
  { icao: z.string().describe('ICAO airport code, e.g. "EDFE", "EDDM", "EGLL"') },
  async (args) => {
    const icao = args.icao.toUpperCase();
    log(`METAR ${icao}`);
    try {
      const data = await avwxFetch('metar', { ids: icao, format: 'json', taf: 'false', hours: '3' }) as MetarData[];
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: 'text' as const, text: `No METAR found for ${icao}. Verify the ICAO code.` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: formatMetar(data[0]) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `METAR fetch failed for ${icao}: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ─── wx_taf ──────────────────────────────────────────────────────────────────

server.tool(
  'wx_taf',
  'Get the Terminal Area Forecast (TAF) for an airport. Returns raw TAF plus decoded forecast periods with flight category, wind, visibility, and ceiling.',
  { icao: z.string().describe('ICAO airport code') },
  async (args) => {
    const icao = args.icao.toUpperCase();
    log(`TAF ${icao}`);
    try {
      const data = await avwxFetch('taf', { ids: icao, format: 'json' }) as TafData[];
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: 'text' as const, text: `No TAF found for ${icao}.` }], isError: true };
      }
      const taf = data[0];
      const lines = [
        `**${taf.icaoId || icao}** TAF${taf.name ? ` (${taf.name})` : ''} — Issued: ${taf.issueTime || '?'}`,
        `Raw: \`${taf.rawTAF || 'N/A'}\``,
        '',
        '**Forecast periods:**',
      ];
      for (let i = 0; i < (taf.fcsts?.length ?? 0); i++) {
        const dateStr = taf.fcsts![i].timeFrom
          ? new Date(taf.fcsts![i].timeFrom! * 1000).toISOString().slice(0, 10)
          : '';
        lines.push(formatTafPeriod(taf.fcsts![i], `P${i + 1}${dateStr ? ` (${dateStr})` : ''}`));
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `TAF fetch failed for ${icao}: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ─── wx_pireps ───────────────────────────────────────────────────────────────

server.tool(
  'wx_pireps',
  'Get pilot reports (PIREPs) near an airport. Reports recent turbulence, icing, cloud tops, and other in-flight observations.',
  {
    icao: z.string().describe('ICAO airport code to search around'),
    radius_nm: z.number().optional().describe('Search radius in nautical miles (default: 50)'),
  },
  async (args) => {
    const icao = args.icao.toUpperCase();
    const radius = args.radius_nm ?? 50;
    log(`PIREPs near ${icao} ${radius}nm`);
    try {
      const data = await avwxFetch('pirep', { id: icao, distance: String(radius), format: 'json', age: '3' }) as Array<{ rawOb?: string }>;
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: 'text' as const, text: `No PIREPs near ${icao} within ${radius}nm in the last 3 hours.` }] };
      }
      const lines = [`**PIREPs near ${icao}** (${radius}nm, last 3h): ${data.length} report(s)`, ''];
      for (const p of data.slice(0, 15)) {
        lines.push(`\`${p.rawOb || 'raw unavailable'}\``);
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `PIREPs fetch failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ─── wx_sigmets ──────────────────────────────────────────────────────────────

const EUROPE_FIRS = /EDGG|EDYY|LOVV|LKAA|EPWW|EKDK|ENBD|EFIN|ESAA|BIRD|LPPC|LECB|LFBB|LIMM|LYBA|LBSR|UKBV|UUWV/;

server.tool(
  'wx_sigmets',
  'Get active SIGMETs and AIRMETs. Filter by region to reduce noise.',
  {
    region: z.enum(['global', 'europe', 'germany']).optional().describe('Region filter: global (default), europe, germany'),
  },
  async (args) => {
    const region = args.region ?? 'global';
    log(`SIGMETs region=${region}`);
    try {
      const data = await avwxFetch('sigmet', { format: 'json' }) as Array<{ rawSigmet?: string }>;
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No active SIGMETs/AIRMETs.' }] };
      }

      let items = data;
      if (region === 'europe') {
        items = data.filter(s => EUROPE_FIRS.test((s.rawSigmet || '').toUpperCase()));
      } else if (region === 'germany') {
        items = data.filter(s => {
          const r = (s.rawSigmet || '').toUpperCase();
          return r.includes('EDGG') || r.includes('EDYY');
        });
      }

      if (items.length === 0) {
        return { content: [{ type: 'text' as const, text: `No active SIGMETs/AIRMETs for region: ${region}.` }] };
      }

      const lines = [`**Active SIGMETs/AIRMETs** (${region}): ${items.length} item(s)`, ''];
      for (const s of items.slice(0, 10)) {
        lines.push(`\`${s.rawSigmet || 'N/A'}\`\n`);
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `SIGMETs fetch failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ─── wx_icon_d2 ──────────────────────────────────────────────────────────────

server.tool(
  'wx_icon_d2',
  'Get DWD ICON-D2 NWP forecast for any lat/lon. Provides hourly wind (10m + 80m), visibility, cloud base, precipitation, and CAPE. ICON-D2 covers Central Europe at 2km resolution up to 48h. Falls back to ICON-EU (7km, Europe) or ICON-seamless outside coverage.',
  {
    lat: z.number().describe('Latitude in decimal degrees (e.g. 50.03)'),
    lon: z.number().describe('Longitude in decimal degrees (e.g. 8.97)'),
    hours: z.number().optional().describe('Forecast horizon in hours, 1–48 (default: 12)'),
  },
  async (args) => {
    const hours = Math.min(Math.max(args.hours ?? 12, 1), 48);
    const model = selectModel(args.lat, args.lon);
    log(`ICON ${model} lat=${args.lat} lon=${args.lon} +${hours}h`);
    try {
      const data = await openMeteoFetch({
        latitude: String(args.lat),
        longitude: String(args.lon),
        hourly: ICON_D2_VARIABLES,
        models: model,
        forecast_hours: '48',
        timezone: 'UTC',
      }) as OpenMeteoResponse;
      return { content: [{ type: 'text' as const, text: formatIconForecast(data, hours, model) }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `ICON-D2 fetch failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// ─── wx_preflight ────────────────────────────────────────────────────────────

server.tool(
  'wx_preflight',
  'VFR preflight weather brief for an airfield. Combines current METAR, TAF, and ICON-D2 NWP forecast into a single assessment. Only the ICAO code is required — coordinates are resolved authoritatively from the aviationweather.gov station database. Never supply coordinates yourself.',
  {
    icao: z.string().describe('4-letter ICAO airport code, passed exactly as given by the user (e.g. "EDFE", "EDDM", "EDLI")'),
    hours: z.number().optional().describe('Forecast horizon in hours (default: 12, max: 48)'),
  },
  async (args) => {
    const icao = args.icao.toUpperCase();
    const hours = Math.min(args.hours ?? 12, 48);

    // Resolve coordinates authoritatively from the station API — never use guessed coords
    let lat: number | undefined;
    let lon: number | undefined;
    const stationCoords = await getStationCoords(icao);
    if (stationCoords) { lat = stationCoords.lat; lon = stationCoords.lon; }

    const model = lat != null && lon != null ? selectModel(lat, lon) : 'icon_seamless';
    log(`Preflight ${icao} lat=${lat ?? '?'} lon=${lon ?? '?'} +${hours}h model=${model}`);

    // Fetch METAR and TAF in parallel first
    const [metarResult, tafResult] = await Promise.allSettled([
      avwxFetch('metar', { ids: icao, format: 'json', taf: 'false', hours: '3' }) as Promise<MetarData[]>,
      avwxFetch('taf', { ids: icao, format: 'json' }) as Promise<TafData[]>,
    ]);

    // Last-resort coord extraction from METAR response
    if ((lat == null || lon == null) && metarResult.status === 'fulfilled' && Array.isArray(metarResult.value) && metarResult.value.length > 0) {
      const m = metarResult.value[0];
      if (m.lat != null && m.lon != null) { lat = m.lat; lon = m.lon; }
    }

    // Now fetch ICON-D2 with resolved coords (if available)
    const iconResult = lat != null && lon != null
      ? await Promise.allSettled([openMeteoFetch({
          latitude: String(lat),
          longitude: String(lon),
          hourly: ICON_D2_VARIABLES,
          models: selectModel(lat, lon),
          forecast_hours: '48',
          timezone: 'UTC',
        }) as Promise<OpenMeteoResponse>])
      : null;

    const sections: string[] = [
      `# VFR Preflight Brief — ${icao}`,
      `Generated: ${new Date().toUTCString()}`,
      '',
    ];

    // METAR
    sections.push('## Current Conditions (METAR)');
    if (metarResult.status === 'fulfilled' && Array.isArray(metarResult.value) && metarResult.value.length > 0) {
      sections.push(formatMetar(metarResult.value[0]));
    } else {
      const err = metarResult.status === 'rejected' ? metarResult.reason : 'No METAR available';
      sections.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    sections.push('');

    // TAF
    sections.push('## TAF Forecast');
    if (tafResult.status === 'fulfilled' && Array.isArray(tafResult.value) && tafResult.value.length > 0) {
      const taf = tafResult.value[0];
      sections.push(`Issued: ${taf.issueTime || '?'} | Raw: \`${taf.rawTAF || 'N/A'}\``);
      const now = Date.now() / 1000;
      const relevant = (taf.fcsts || []).filter(f => (f.timeTo ?? 0) >= now && (f.timeFrom ?? 0) <= now + hours * 3600);
      if (relevant.length > 0) {
        sections.push('Periods relevant to window:');
        for (let i = 0; i < relevant.length; i++) {
          sections.push(formatTafPeriod(relevant[i], `P${i + 1}`));
        }
      } else {
        sections.push('No TAF periods in the requested window.');
      }
    } else {
      const err = tafResult.status === 'rejected' ? tafResult.reason : 'No TAF available';
      sections.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    sections.push('');

    // ICON-D2
    const resolvedModel = lat != null && lon != null ? selectModel(lat, lon) : 'unknown';
    sections.push(`## ${resolvedModel.toUpperCase()} NWP Forecast (+${hours}h)`);
    const iconSettled = iconResult?.[0];
    if (!iconSettled) {
      sections.push('Could not resolve coordinates for this airport — ICON-D2 forecast unavailable.');
    } else if (iconSettled.status === 'fulfilled') {
      sections.push(formatIconForecast(iconSettled.value, hours, resolvedModel));
    } else {
      sections.push(`Error: ${iconSettled.reason instanceof Error ? iconSettled.reason.message : String(iconSettled.reason)}`);
    }

    return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
  },
);

// ─── wx_route ────────────────────────────────────────────────────────────────

server.tool(
  'wx_route',
  'Route weather brief for a direct flight between two airports. Fetches METARs at departure and destination, ICON-D2 at 5 points along the great-circle route, and active SIGMETs. Coordinates are resolved from the station API — never guess them. Pass ICAO codes exactly as given by the user.',
  {
    from_icao: z.string().describe('Departure airport 4-letter ICAO code, passed exactly as given by the user'),
    to_icao: z.string().describe('Destination airport 4-letter ICAO code, passed exactly as given by the user'),
    hours_enroute: z.number().optional().describe('Estimated flight duration in hours (default: 2)'),
    forecast_horizon: z.number().optional().describe('How far ahead to check weather in hours (default: 6, max: 48)'),
  },
  async (args) => {
    const fromIcao = args.from_icao.toUpperCase();
    const toIcao = args.to_icao.toUpperCase();
    const enrouteHours = args.hours_enroute ?? 2;
    const horizon = Math.min(args.forecast_horizon ?? 6, 48);
    log(`Route ${fromIcao} → ${toIcao} enroute=${enrouteHours}h`);

    const sections: string[] = [
      `# Route Weather Brief — ${fromIcao} → ${toIcao}`,
      `Generated: ${new Date().toUTCString()}`,
      '',
    ];

    // Fetch METARs for both airports in parallel (also gives us coordinates)
    const [fromMetarResult, toMetarResult] = await Promise.allSettled([
      avwxFetch('metar', { ids: fromIcao, format: 'json', taf: 'false', hours: '3' }) as Promise<MetarData[]>,
      avwxFetch('metar', { ids: toIcao, format: 'json', taf: 'false', hours: '3' }) as Promise<MetarData[]>,
    ]);

    let fromCoords: Coords | null = null;
    let toCoords: Coords | null = null;

    sections.push('## Departure: ' + fromIcao);
    if (fromMetarResult.status === 'fulfilled' && Array.isArray(fromMetarResult.value) && fromMetarResult.value.length > 0) {
      const m = fromMetarResult.value[0];
      sections.push(formatMetar(m));
      if (m.lat != null && m.lon != null) fromCoords = { lat: m.lat, lon: m.lon, name: m.name || fromIcao };
    } else {
      const err = fromMetarResult.status === 'rejected' ? fromMetarResult.reason : 'No METAR';
      sections.push(`METAR error: ${err instanceof Error ? err.message : String(err)}`);
    }
    sections.push('');

    sections.push('## Destination: ' + toIcao);
    if (toMetarResult.status === 'fulfilled' && Array.isArray(toMetarResult.value) && toMetarResult.value.length > 0) {
      const m = toMetarResult.value[0];
      sections.push(formatMetar(m));
      if (m.lat != null && m.lon != null) toCoords = { lat: m.lat, lon: m.lon, name: m.name || toIcao };
    } else {
      const err = toMetarResult.status === 'rejected' ? toMetarResult.reason : 'No METAR';
      sections.push(`METAR error: ${err instanceof Error ? err.message : String(err)}`);
    }
    sections.push('');

    // Fallback: look up station coords if METAR didn't give them
    if (!fromCoords) fromCoords = await getStationCoords(fromIcao);
    if (!toCoords) toCoords = await getStationCoords(toIcao);

    if (!fromCoords || !toCoords) {
      sections.push('Could not determine airport coordinates — cannot compute route points.');
      return { content: [{ type: 'text' as const, text: sections.join('\n') }], isError: true };
    }

    // Sample 5 points along the direct route and fetch ICON-D2 in parallel
    const fractions = [0, 0.25, 0.5, 0.75, 1.0];
    const labels = ['Departure (DEP)', '25% enroute', 'Midpoint (MID)', '75% enroute', 'Destination (DEST)'];
    const points = fractions.map(t => ({
      lat: lerp(fromCoords!.lat, toCoords!.lat, t),
      lon: lerp(fromCoords!.lon, toCoords!.lon, t),
    }));

    const iconFetches = points.map(pt =>
      openMeteoFetch({
        latitude: pt.lat.toFixed(3),
        longitude: pt.lon.toFixed(3),
        hourly: [
          'visibility', 'cloud_cover_low', 'wind_speed_10m', 'wind_direction_10m',
          'wind_speed_80m', 'wind_direction_80m', 'precipitation', 'cape', 'weather_code', 'cloud_base',
        ].join(','),
        models: selectModel(pt.lat, pt.lon),
        forecast_hours: String(Math.min(horizon + enrouteHours + 2, 48)),
        timezone: 'UTC',
      }) as Promise<OpenMeteoResponse>,
    );

    const iconResults = await Promise.allSettled(iconFetches);

    sections.push('## En-Route Forecast (ICON-D2 / ICON-EU)');
    sections.push(`Route: ${fromCoords.name} → ${toCoords.name} | ${fractions.length} sample points`);
    sections.push('');

    for (let i = 0; i < fractions.length; i++) {
      const pt = points[i];
      sections.push(`### ${labels[i]} (${pt.lat.toFixed(2)}°N, ${pt.lon.toFixed(2)}°E)`);
      const r = iconResults[i];
      if (r.status === 'fulfilled') {
        sections.push(formatIconForecast(r.value, horizon, selectModel(pt.lat, pt.lon)));
      } else {
        sections.push(`Error: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
      sections.push('');
    }

    // SIGMETs — filter to Europe if route is there
    try {
      const routeInEurope = inIconD2Coverage(fromCoords.lat, fromCoords.lon) || inIconD2Coverage(toCoords.lat, toCoords.lon);
      const sigData = await avwxFetch('sigmet', { format: 'json' }) as Array<{ rawSigmet?: string }>;
      let items = Array.isArray(sigData) ? sigData : [];
      if (routeInEurope) {
        items = items.filter(s => EUROPE_FIRS.test((s.rawSigmet || '').toUpperCase()));
      }
      sections.push('## Active SIGMETs/AIRMETs');
      if (items.length === 0) {
        sections.push(`None active${routeInEurope ? ' for Europe' : ''}.`);
      } else {
        for (const s of items.slice(0, 5)) sections.push(`\`${s.rawSigmet || 'N/A'}\``);
      }
    } catch (err) {
      sections.push(`## SIGMETs\nError: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
  },
);

// ─── Connect ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
