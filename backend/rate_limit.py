"""In-process rate limit (per worker). Enough to stop one tenant flooding OpenAI."""
from __future__ import annotations

import time
from collections import defaultdict, deque


class SlidingWindow:
    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        t = time.monotonic() if now is None else now
        q = self._hits[key]
        cut = t - self.window_s
        while q and q[0] <= cut:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(t)
        if len(self._hits) > 20_000:
            self._prune(t)
        return True

    def _prune(self, now: float) -> None:
        cut = now - self.window_s
        dead = [k for k, q in self._hits.items() if not q or q[-1] <= cut]
        for k in dead:
            self._hits.pop(k, None)


# AI (Whisper/GPT) — drogie. Zapis (apply) — luźniej.
AI_LIMIT = SlidingWindow(limit=40, window_s=60.0)
WRITE_LIMIT = SlidingWindow(limit=180, window_s=60.0)
IP_LIMIT = SlidingWindow(limit=80, window_s=60.0)


def allow_ai(tenant_or_ip: str) -> bool:
    return AI_LIMIT.allow(tenant_or_ip)


def allow_write(tenant_or_ip: str) -> bool:
    return WRITE_LIMIT.allow(tenant_or_ip)


def allow_ip(ip: str) -> bool:
    return IP_LIMIT.allow(ip or "0")
