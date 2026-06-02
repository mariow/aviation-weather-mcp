#!/usr/bin/env node
/**
 * Startup smoke test — boots the BUILT server (dist/index.js) over real stdio,
 * performs the MCP handshake, and asserts every tool is registered.
 *
 * This is the layer plain unit tests can't cover: it catches "the server doesn't
 * start at all" (e.g. the import.meta.main entrypoint bug) and "a tool failed to
 * register". It touches NO network, so it's safe to gate `npm publish` on.
 *
 *   node scripts/smoke.mjs        (run `npm run build` first, or use `npm run test:smoke`)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'dist', 'index.js');

const EXPECTED_TOOLS = [
  'wx_metar', 'wx_taf', 'wx_pireps', 'wx_sigmets',
  'wx_icon_d2', 'wx_outlook', 'wx_preflight', 'wx_route',
];

const HANDSHAKE_TIMEOUT_MS = 10_000;

function fail(msg) {
  console.error(`✗ smoke test FAILED: ${msg}`);
  process.exit(1);
}

const srv = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
srv.on('error', (e) => fail(`could not spawn server: ${e.message}`));

let buf = '';
const pending = new Map();
srv.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});

let id = 0;
function rpc(method, params) {
  const myId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no response to "${method}" within ${HANDSHAKE_TIMEOUT_MS / 1000}s — did the server start?`)),
      HANDSHAKE_TIMEOUT_MS,
    );
    pending.set(myId, (m) => { clearTimeout(timer); resolve(m); });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
}
function notify(method, params) {
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1' },
  });
  if (init.error) fail(`initialize returned an error: ${JSON.stringify(init.error)}`);
  if (!init.result?.serverInfo?.name) fail('initialize response missing serverInfo');
  notify('notifications/initialized', {});

  const list = await rpc('tools/list', {});
  const tools = (list.result?.tools ?? []).map((t) => t.name);
  const missing = EXPECTED_TOOLS.filter((t) => !tools.includes(t));
  if (missing.length) fail(`tools/list is missing: ${missing.join(', ')} (got: ${tools.join(', ') || 'none'})`);

  console.error(`✓ smoke test passed — server "${init.result.serverInfo.name}" started and registered ${tools.length} tools`);
  srv.kill();
  process.exit(0);
} catch (err) {
  fail(err.message);
}
