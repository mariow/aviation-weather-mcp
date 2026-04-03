# Aviation Weather MCP Server

MCP server for aviation weather data. No API key required.

## Tools

| Tool | Description |
|------|-------------|
| `wx_metar` | Current METAR for an airport (decoded) |
| `wx_taf` | TAF forecast periods (decoded) |
| `wx_pireps` | Recent PIREPs near an airport |
| `wx_sigmets` | Active SIGMETs/AIRMETs (global/europe/germany) |
| `wx_icon_d2` | Hourly ICON-D2 NWP forecast for any lat/lon |
| `wx_preflight` | Composite VFR brief: METAR + TAF + ICON-D2 |
| `wx_route` | Direct-route brief: METARs + ICON-D2 + SIGMETs |

## Data Sources

- **[aviationweather.gov](https://aviationweather.gov)** — METARs, TAFs, PIREPs, SIGMETs (FAA/NOAA)
- **[Open-Meteo](https://open-meteo.com)** — ICON-D2 / ICON-EU NWP forecasts (DWD models, 2km resolution over Central Europe)

## Usage with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop. The tools will be available immediately.

## Usage with Claude Code

```bash
claude mcp add aviation-weather -- npx -y aviation-weather-mcp
```

## Manual Installation

```bash
git clone https://github.com/mariow/aviation-weather-mcp.git
cd aviation-weather-mcp
npm install
npm run build
node dist/index.js
```

## Notes

- ICAO codes are resolved to coordinates via the authoritative aviationweather.gov station database
- Visibility is reported in km
- ICON-D2 coverage: Central Europe (43-58°N / 4-21°E), 48h horizon, 2km resolution
- Outside ICON-D2 range, the server automatically falls back to ICON-EU (7km, 120h)

## License

MIT
