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
2. **Node.js** (version 18 or later) — download from https://nodejs.org (pick the LTS version)

To check if Node.js is already installed, open Terminal (Mac) or Command Prompt (Windows) and type:
```
node --version
```
If you see a version number like `v22.x.x`, you're good to go.

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
| "Any PIREPs near EDDK?" | Recent pilot reports near Cologne |
| "SIGMETs over Germany" | Active significant weather warnings |
| "Hourly forecast for 48.14, 11.57" | ICON-D2 NWP model data for any coordinates |

## Data Sources

- **[aviationweather.gov](https://aviationweather.gov)** — METARs, TAFs, PIREPs, SIGMETs (FAA/NOAA, worldwide)
- **[Open-Meteo](https://open-meteo.com)** — ICON-D2 / ICON-EU NWP forecasts (DWD models)

## Notes

- Works worldwide for METARs, TAFs, PIREPs, and SIGMETs
- ICON-D2 high-resolution forecasts (2km) cover Central Europe (43-58°N / 4-21°E, 48h horizon)
- Outside Central Europe, it falls back to ICON-EU (7km resolution, 120h horizon)
- ICAO codes are resolved automatically — just use the 4-letter code
- Visibility is reported in km

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
