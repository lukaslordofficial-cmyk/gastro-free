/**
 * Extract Voice CRUD v2 (_menu_id_from_payload … voice_dispatch_v2) from server.py
 * Keep _is_missing_column_error / _cat_matches in server.py.
 */
import fs from 'node:fs';

const lines = fs.readFileSync('server.py', 'utf8').split(/\r?\n/);
// 1-based: 10593 _menu_id_from_payload … 10953 end of voice_dispatch_v2
const start = 10592; // 0-index for line 10593
const end = 10953; // exclusive end line 10953 (0-index 10952 is last content line of return None)
let body = lines.slice(start, end).join('\n');

body = body.replace(/_httpx_verify\(\)/g, 'httpx_verify()');
body = body.replace(/_resolve_by_fuzzy\(/g, '_fuzzy(');
body = body.replace(/_recompute_menu_availability\(/g, '_recompute(');
body = body.replace(/_availability_changed_count\(/g, '_avail_count(');

// Inject tenant at start of voice_dispatch_v2 after docstring
body = body.replace(
  /(async def voice_dispatch_v2\(intent: str, p: dict\):\n {4}"""[\s\S]*?"""\n)/,
  '$1    _tenant()\n',
);

const header = `"""
Voice CRUD v2 — bulk/delete/availability/scale + voice_dispatch_v2.
Wydzielone z server.py. Mutacje wymagają require_tenant_account_key().
"""
from __future__ import annotations

import httpx

from http_ssl import httpx_verify
from supabase_rest import sb_delete, sb_get, sb_patch, sb_post

_ALL_ROWS = {"id": "not.is.null"}


def _tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


def _fuzzy(query, rows, *, key: str = "name", threshold: int = 55):
    from server import _resolve_by_fuzzy

    return _resolve_by_fuzzy(query, rows, key=key, threshold=threshold)


async def _recompute(client, **kwargs):
    from server import _recompute_menu_availability

    return await _recompute_menu_availability(client, **kwargs)


def _avail_count(result) -> int:
    from server import _availability_changed_count

    return _availability_changed_count(result)


def _cat_matches(row_cat: str, wanted: str, threshold: int = 72) -> bool:
    from server import _cat_matches as _cm

    return _cm(row_cat, wanted, threshold)


def _is_missing_column_error(exc: httpx.HTTPStatusError) -> bool:
    from server import _is_missing_column_error as _imce

    return _imce(exc)

`;

fs.writeFileSync('voice_crud_v2_routes.py', `${header}\n${body}\n`, 'utf8');

// Remove from server.py: from _menu_id_from_payload through voice_dispatch_v2 (keep helpers above)
let server = fs.readFileSync('server.py', 'utf8');
const markerStart = 'async def _menu_id_from_payload(client, p):';
const markerEnd = '# ─────────────────────────────────────────────────────────────────────────────\n# Voice CRUD DISPATCH';
const i = server.indexOf(markerStart);
const j = server.indexOf(markerEnd);
if (i < 0 || j < 0) {
  console.error('markers', i, j);
  process.exit(1);
}
const stub = `# Voice CRUD v2: backend/voice_crud_v2_routes.py (voice_dispatch_v2)\n\n`;
server = server.slice(0, i) + stub + server.slice(j);

// Also remove unused _ALL_ROWS if only used by extracted code - keep if still referenced
// Fix voice_dispatch to add tenant + lazy import v2
server = server.replace(
  /(async def voice_dispatch\(req: VoiceDispatchRequest\):\n(?: {4}"""[\s\S]*?"""\n)?)/,
  '$1    require_tenant_account_key()\n',
);
server = server.replace(
  /v2 = await voice_dispatch_v2\(it, p\)/,
  'from voice_crud_v2_routes import voice_dispatch_v2\n    v2 = await voice_dispatch_v2(it, p)',
);

fs.writeFileSync('server.py', server, 'utf8');
const out = fs.readFileSync('voice_crud_v2_routes.py', 'utf8');
console.log('v2 lines', out.split('\n').length);
console.log('has tenant', out.includes('_tenant()'));
console.log('server still has _menu_id', server.includes('async def _menu_id_from_payload'));
console.log('server has v2 lazy', server.includes('from voice_crud_v2_routes import voice_dispatch_v2'));
console.log('server has dispatch tenant', /async def voice_dispatch[\s\S]{0,200}require_tenant_account_key/.test(server));
