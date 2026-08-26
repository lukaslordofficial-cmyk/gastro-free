"""
Circuit breaker dla tras AI (OpenAI).

Po serii 5xx / timeoutów w oknie czasu trasy AI zwracają 503 z komunikatem PL
zamiast dokładać kolejki i koszt. Reset po cooldown albo po sukcesie.
"""
from __future__ import annotations

from collections import deque
import os
import time


CIRCUIT_OPEN_DETAIL = (
    "Usługa AI jest chwilowo przeciążona. Spróbuj za chwilę."
)


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.environ.get(name, str(default)) or default)))
    except ValueError:
        return default


class OpenAICircuit:
    def __init__(
        self,
        fail_threshold: int | None = None,
        window_s: float | None = None,
        cooldown_s: float | None = None,
    ) -> None:
        self.fail_threshold = (
            fail_threshold
            if fail_threshold is not None
            else _env_int("OPENAI_CIRCUIT_FAILS", 5, 2, 50)
        )
        self.window_s = float(
            window_s if window_s is not None else _env_int("OPENAI_CIRCUIT_WINDOW_S", 45, 10, 300)
        )
        self.cooldown_s = float(
            cooldown_s if cooldown_s is not None else _env_int("OPENAI_CIRCUIT_COOLDOWN_S", 30, 5, 300)
        )
        self._fails: deque[float] = deque()
        self._opened_at: float | None = None

    def reset(self) -> None:
        self._fails.clear()
        self._opened_at = None

    def is_open(self, now: float | None = None) -> bool:
        t = time.monotonic() if now is None else now
        if self._opened_at is None:
            return False
        if t - self._opened_at >= self.cooldown_s:
            self.reset()
            return False
        return True

    def allow(self, now: float | None = None) -> bool:
        return not self.is_open(now)

    def record_success(self) -> None:
        self.reset()

    def record_failure(self, now: float | None = None) -> None:
        t = time.monotonic() if now is None else now
        if self._opened_at is not None:
            return
        self._fails.append(t)
        cut = t - self.window_s
        while self._fails and self._fails[0] <= cut:
            self._fails.popleft()
        if len(self._fails) >= self.fail_threshold:
            self._opened_at = t


openai_circuit = OpenAICircuit()
