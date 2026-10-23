# Work item: Node.js October 2026 security releases

**Status:** fixed · **Opened:** 2026-10-23 · **Advisory:** <https://nodejs.org/en/blog/vulnerability/october-2026-security-releases> (released 2026-10-21)

## Summary

This server is a stdio MCP process whose only attack surface is the outbound
HTTPS it makes with Node's global `fetch` (undici) to third-party weather hosts
(`aviationweather.gov`, `api.open-meteo.com`, `ensemble-api.open-meteo.com`).
Several of the October 2026 CVEs land in exactly that path, so a malicious,
compromised, or network-intercepted response could reach them. The project
pinned no Node version, shipped docs recommending "Node 18 or later," and ran CI
on EOL Node 20 — which received no patch for these CVEs.

## Exposure assessment

| CVE | Sev | Applies here? | Why |
|-----|-----|---------------|-----|
| CVE-2026-111497 — Brotli decoder OOB write (RCE) | High | **Yes** | `fetch`/undici auto-decodes any response with `Content-Encoding: br` through Node's Brotli decoder. Not mitigable in app code (undici decodes by the response header regardless of `Accept-Encoding`); the fix is the Node version. |
| CVE-2026-106069 / -105483 / -106072 — TLS hostname-verification bypass | High / med | **Yes** | Apply to any TLS client; this server opens HTTPS connections. |
| CVE-2026-105481 — keep-alive response desync | Med | **Yes** | `fetch`/undici uses keep-alive connections. |
| CVE-2026-105482 — `dns.resolve` NUL truncation | High | Minor | Not called directly; fixed by the upgrade regardless. |
| CVE-2026-106074 — RNG caches in snapshots / SEA | Med | No | No startup snapshots or single-executable build. |
| CVE-2026-106070 / -106071 — ZipFile / Permission Model (26.x only) | Low | No | No ZipFile use; 26.x-only. |
| CVE-2026-106073 — Permission Model `fs.realpathSync` bypass | Low | No | Not run under `--permission`. |

## Fix

A published library cannot force end users onto a given Node build, so the
remediation is pin + warn + document, and keep EOL Node out of CI:

- [x] `package.json` — add `engines.node` requiring patched lines:
      `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1`.
- [x] `index.ts` — startup guard that prints a clear stderr warning when running
      on a Node build missing these fixes. Non-fatal by design: crashing would
      break the MCP integration outright; a loud warning is the proportionate
      signal for a tool that can't control the host's Node.
- [x] `README.md` — replace "Node 18 or later" with the patched minimums.
- [x] `.github/workflows/ci.yml` — drop EOL Node 20, test 22 / 24 / 26.

## Patched Node versions

- 22.x (LTS): **22.23.4**
- 24.x (LTS): **24.22.1**
- 26.x (Current): **26.12.1**

Node 20.x is end-of-life and got no patch — upgrade off it.
