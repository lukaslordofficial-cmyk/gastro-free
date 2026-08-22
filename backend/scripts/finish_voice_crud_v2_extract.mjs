/**
 * Finish extract: remove Voice CRUD v2 body from server.py; wire tenant + lazy import.
 */
import fs from 'node:fs';

let server = fs.readFileSync('server.py', 'utf8');
const markerStart = 'async def _menu_id_from_payload(client, p):';
const markerEnd = '# Voice CRUD DISPATCH';
const i = server.indexOf(markerStart);
const j = server.indexOf(markerEnd);
if (i < 0 || j < 0) {
  console.error('markers', i, j);
  process.exit(1);
}
const stub = '\n# Voice CRUD v2: backend/voice_crud_v2_routes.py (voice_dispatch_v2)\n\n';
server = server.slice(0, i) + stub + server.slice(j);

// Drop unused _ALL_ROWS if no remaining references
if ((server.match(/_ALL_ROWS/g) || []).length === 1) {
  server = server.replace(
    /\n_ALL_ROWS = \{"id": "not\.is\.null"\}  # PostgREST: filtr dopasowujący WSZYSTKIE wiersze\n\n/,
    '\n',
  );
}

server = server.replace(
  /(async def voice_dispatch\(req: VoiceDispatchRequest\):\n(?: {4}"""[\s\S]*?"""\n)?)/,
  '$1    require_tenant_account_key()\n',
);

if (!server.includes('from voice_crud_v2_routes import voice_dispatch_v2')) {
  server = server.replace(
    /v2 = await voice_dispatch_v2\(it, p\)/,
    'from voice_crud_v2_routes import voice_dispatch_v2\n    v2 = await voice_dispatch_v2(it, p)',
  );
}

fs.writeFileSync('server.py', server, 'utf8');
console.log('has _menu_id', server.includes('async def _menu_id_from_payload'));
console.log('has lazy', server.includes('from voice_crud_v2_routes import voice_dispatch_v2'));
console.log(
  'dispatch tenant',
  /async def voice_dispatch\([\s\S]{0,400}require_tenant_account_key/.test(server),
);
console.log('ALL_ROWS left', (server.match(/_ALL_ROWS/g) || []).length);
