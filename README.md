# Aviation Weather MCP Server

Aviation weather briefings directly in Claude. METARs, TAFs, PIREPs, SIGMETs, and ICON-D2 NWP forecasts — no API key required.

Just ask Claude things like:
- "METAR EDDM"
- "Preflight briefing EDLI"
- "Route weather EDDM to LOWI"
- "Any SIGMETs over Germany?"

## Prerequisites

You need two things installed:

1. **Claude Desktop** — download from https://claude.ai/download
2. **Node.js** — download from https://nodejs.org (pick the LTS version). Use a
   patched release: **22.23.4+**, **24.22.1+**, or **26.12.1+**. These carry the
   October 2026 security fixes (including a Brotli-decoder RCE reachable through
   `fetch`); older builds and the end-of-life Node 20 are vulnerable. The server
   prints a warning on startup if it detects an unpatched Node.

To check if Node.js is already installed, open Terminal (Mac) or Command Prompt (Windows) and type:
```
node --version
```
If you see a version at or above `v22.23.4` (or `v24.22.1` / `v26.12.1`), you're good to go. If it's lower, update Node from https://nodejs.org.

## Setup (3 minutes)

### Step 1: Open the Claude Desktop config

1. Open **Claude Desktop**
2. Click the **gear icon** (top right) to open Settings
3. Go to **Developer**
4. Click **Edit Config**

This opens a JSON file in your text editor.

### Step 2: Add the weather server

If the file is empty or just has `{}`, replace it with:

```json
{
  "mcpServers": {
    "aviation-weather": {
      "command": "npx",
      "args": ["-y", "aviation-weather-mcp"]
    }
  }
}
```

If the file already has content (e.g. other MCP servers), add the `"aviation-weather"` block inside the existing `"mcpServers"` section.

### Step 3: Restart Claude Desktop

Quit Claude Desktop completely and reopen it. The first start may take 10-15 seconds longer while it downloads the weather server.

### Step 4: Test it

Start a new chat and ask: **"METAR EDDF"**

Claude should respond with the current weather at Frankfurt airport. If it works, you're all set!

## What can it do?

| Ask Claude... | What it does |
|---------------|-------------|
| "METAR EDDM" | Current weather at Munich airport |
| "TAF EDDF" | Forecast for Frankfurt |
| "Preflight briefing EDLI" | Full VFR brief: METAR + TAF + NWP forecast |
| "Route weather EDDM to LOWI" | Weather along a direct route (METARs + NWP + SIGMETs) |
| "Outlook for EDFE next week" | Per-day VFR go/no-go probability for the next 3–15 days |
| "Any PIREPs near EDDK?" | Recent pilot reports near Cologne |
| "SIGMETs over Germany" | Active significant weather warnings |
| "Hourly forecast for 48.14, 11.57" | ICON-D2 NWP model data for any coordinates |

## Data Sources

- **[aviationweather.gov](https://aviationweather.gov)** — METARs, TAFs, PIREPs, SIGMETs (FAA/NOAA, worldwide)
- **[Open-Meteo](https://open-meteo.com)** — ICON-D2 / ICON-EU NWP forecasts (DWD models)
- **[Open-Meteo Ensemble](https://open-meteo.com/en/docs/ensemble-api)** — ensemble forecasts (ECMWF-ENS, GEFS) for the long-range outlook
- **[OurAirports](https://ourairports.com)** — bundled offline ICAO → coordinates database (~22k airports, incl. GA fields), Public Domain

## Notes

- Works worldwide for METARs, TAFs, PIREPs, and SIGMETs
- ICON-D2 high-resolution forecasts (2km) cover Central Europe (43-58°N / 4-21°E, 48h horizon)
- Outside Central Europe, it falls back to ICON-EU (7km resolution, 120h horizon)
- ICAO codes are resolved automatically — just use the 4-letter code. Resolution works **offline** from a bundled airport database, so even pure GA fields without a METAR (e.g. EDVY) work; you can also pass `lat`/`lon` directly
- Visibility is reported in km
- Open-Meteo serves no usable cloud base, so the hourly NWP forecasts (`wx_icon_d2`, `wx_preflight`, `wx_route`) **derive a cloud ceiling** from pressure-level cloud cover (lowest broken/overcast deck ≥50%, in ft AGL). The output always states it explicitly — `ceil ~1700ft`, `ceil none<8600ft` (no deck below), or `ceil n/a` (no data) — so a missing ceiling never looks like clear skies
- The 3–15 day outlook is a **coarse confidence measure** (share of ensemble members with poor VFR conditions), not a precise forecast. It uses low-cloud cover as the VFR proxy (Open-Meteo serves no usable cloud base) and shows the ECMWF-IFS trend plus an ICON-EU cross-check for the first ~5 days

## Usage with Claude Code

```bash
claude mcp add aviation-weather -- npx -y aviation-weather-mcp
```

## Troubleshooting

**Claude doesn't show weather tools:** Make sure you restarted Claude Desktop after editing the config. Check that the JSON syntax is valid (no trailing commas, matching brackets).

**"npx: command not found":** Node.js is not installed or not in your PATH. Download it from https://nodejs.org.

**Slow first start:** The first time, `npx` downloads the package (~30KB). After that it's cached and starts instantly.

## Disclaimer

This tool is for informational purposes only and is **not a replacement for an official pre-flight weather briefing**. Always use approved weather services and follow your national aviation authority's requirements for flight preparation.

## License

MIT
