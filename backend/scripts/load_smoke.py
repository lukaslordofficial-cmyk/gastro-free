"""
Prosty test obciążeniowy API Gastro Manager (bez zewnętrznych narzędzi).

Użycie:
  python backend/scripts/load_smoke.py --base https://TWOJ-BACKEND --users 10 --requests 50

Wylicza latency p50/p95 oraz przybliżone RPS. Nie wymaga k6.
"""
from __future__ import annotations

import argparse
import asyncio
import statistics
import time
from typing import Any

import httpx


async def hit(client: httpx.AsyncClient, url: str) -> tuple[float, int]:
    t0 = time.perf_counter()
    try:
        r = await client.get(url, timeout=20.0)
        return (time.perf_counter() - t0) * 1000, r.status_code
    except Exception:  # noqa: BLE001
        return (time.perf_counter() - t0) * 1000, 0


async def run_load(base: str, concurrency: int, total: int, path: str) -> dict[str, Any]:
    url = base.rstrip("/") + path
    sem = asyncio.Semaphore(concurrency)
    latencies: list[float] = []
    codes: dict[int, int] = {}

    async with httpx.AsyncClient() as client:
        async def one() -> None:
            async with sem:
                ms, code = await hit(client, url)
                latencies.append(ms)
                codes[code] = codes.get(code, 0) + 1

        t0 = time.perf_counter()
        await asyncio.gather(*[one() for _ in range(total)])
        elapsed = time.perf_counter() - t0

    latencies.sort()
    def pct(p: float) -> float:
        if not latencies:
            return 0.0
        i = min(len(latencies) - 1, int(round((p / 100) * (len(latencies) - 1))))
        return latencies[i]

    return {
        "path": path,
        "concurrency": concurrency,
        "total": total,
        "elapsed_s": round(elapsed, 2),
        "rps": round(total / elapsed, 1) if elapsed else 0,
        "p50_ms": round(pct(50), 1),
        "p95_ms": round(pct(95), 1),
        "p99_ms": round(pct(99), 1),
        "status_counts": codes,
    }


def estimate_capacity(p95_ms: float, rps: float) -> str:
    """Bardzo zgrubne szacunki dla endpointu health (bez AI Vision)."""
    if p95_ms <= 0 or rps <= 0:
        return "Brak danych."
    # Przyjmujemy, że jeden worker utrzymuje ~rps; 20% zapasu.
    safe_rps = rps * 0.8
    lines = [
        f"Zmierzono ~{rps} RPS (p95={p95_ms} ms) na lekkim endpoincie.",
        f"Bezpieczny bufor ~{safe_rps:.0f} RPS → orientacyjnie:",
        f"  • 10 użytkowników (1 req/s) — OK jeśli < {safe_rps:.0f} RPS",
        f"  • 50 użytkowników (0.5 req/s ≈ 25 RPS) — {'OK' if safe_rps >= 25 else 'ryzyko'}",
        f"  • 200 użytkowników (0.5 req/s ≈ 100 RPS) — {'OK' if safe_rps >= 100 else 'potrzebny scaling (więcej workerów / Railway)'}",
        "Uwaga: skany Vision/OCR są 10–50× cięższe — limituj równoległe skany kredytami + queue.",
    ]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="np. https://xxx.up.railway.app")
    ap.add_argument("--users", type=int, default=10, help="równoległość (concurrency)")
    ap.add_argument("--requests", type=int, default=100)
    ap.add_argument("--path", default="/api/health")
    args = ap.parse_args()

    print(f"Load: {args.users} concurrent × {args.requests} → {args.base}{args.path}")
    result = asyncio.run(run_load(args.base, args.users, args.requests, args.path))
    for k, v in result.items():
        print(f"  {k}: {v}")
    print()
    print(estimate_capacity(float(result["p95_ms"]), float(result["rps"])))
    print()
    print("Multi-user / to samo konto:")
    print("  • Ten sam e-mail+hasło na telefonie barmana i tablecie kuchni = OK (Supabase multi-session).")
    print("  • Osobne konta pracowników ze wspólnym magazynem = jeszcze NIE (1 user = 1 account_key).")
    print("  • Role (barman/kucharz/manager) = roadmapa team/invite, na razie współdzielcie login restauracji.")


if __name__ == "__main__":
    main()
