/**
 * Extract supplier intents block from server.py → supplier_intent_routes.py
 */
import fs from 'node:fs';

const lines = fs.readFileSync('server.py', 'utf8').split(/\r?\n/);
let body = lines.slice(10566, 10881).join('\n');
body = body.replace(/@app\.(post|get)/g, '@router.$1');
body = body.replace(/_resolve_by_fuzzy\(/g, '_fuzzy(');
body = body.replace(/_norm_pl\(/g, '_norm(');
body = body.replace(/_fuzzy_match\(/g, '_fuzzy_str(');
body = body.replace(/_httpx_verify\(\)/g, 'httpx_verify()');
body = body.replace(/_check_ai_access\(/g, '_ai_access(');
body = body.replace(/_guard_ai\(/g, '_ai_guard(');

function injectAfterDocstring(src, fnName) {
  const re = new RegExp(
    `(async def ${fnName}\\([^)]*\\):\\n(?: {4}"""[\\s\\S]*?"""\\n)?)`,
  );
  return src.replace(re, '$1    _tenant()\n');
}

body = injectAfterDocstring(body, 'supplier_flip_order');
body = injectAfterDocstring(body, 'supplier_budget_cap_order');
body = injectAfterDocstring(body, 'supplier_top_savings');
body = injectAfterDocstring(body, 'supplier_predictive_restock');

// top-savings: deal-hunter gate after tenant
body = body.replace(
  /(async def supplier_top_savings\(limit: int = 5\):\n(?: {4}"""[\s\S]*?"""\n)? {4}_tenant\(\)\n)( {4}async with httpx\.AsyncClient)/,
  '$1    async with httpx.AsyncClient(timeout=30.0, verify=httpx_verify()) as _probe:\n' +
    '        await _ai_access(_probe, needs_credits=False, needs_deal_hunter=True)\n$2',
);

const header = `"""
Supplier intents: flip-order, budget-cap, top-savings, predictive-restock.
Wydzielone z server.py — require_tenant_account_key na wszystkich.
"""
from __future__ import annotations

from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from http_ssl import httpx_verify
from supabase_rest import sb_get

router = APIRouter(tags=["supplier-intents"])


def _tenant() -> str:
    from server import require_tenant_account_key

    return require_tenant_account_key()


def _fuzzy(query, rows, *, key: str = "name", threshold: int = 55):
    from server import _resolve_by_fuzzy

    return _resolve_by_fuzzy(query, rows, key=key, threshold=threshold)


def _norm(text: str) -> str:
    from server import _norm_pl

    return _norm_pl(text)


def _fuzzy_str(query: str, choices: list[str], threshold: int = 70):
    from server import _fuzzy_match

    return _fuzzy_match(query, choices, threshold=threshold)


async def _ai_access(client, **kwargs):
    from server import _check_ai_access

    return await _check_ai_access(client, **kwargs)


async def _ai_guard(**kwargs):
    from server import _guard_ai

    return await _guard_ai(**kwargs)

`;

fs.writeFileSync('supplier_intent_routes.py', `${header}\n${body}\n`, 'utf8');
const out = fs.readFileSync('supplier_intent_routes.py', 'utf8');
console.log('ok lines', out.split('\n').length);
console.log(out.slice(0, 900));
console.log('--- flip tenant ---');
console.log(out.includes('_tenant()') ? 'has tenant' : 'MISSING tenant');
console.log(out.includes('@router.post("/api/suppliers/flip-order")') ? 'has flip' : 'no flip');
