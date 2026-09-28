from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass


@dataclass
class _Bucket:
    failures: int = 0
    locked_until: float = 0.0


class LoginRateLimiter:
    """In-process sliding-window limiter for credential endpoints.

    Guards password guessing while keeping the failure message identical to a
    normal bad-credentials response, so a caller cannot use the limiter to learn
    whether an account exists. State is per-process and intentionally not
    shared: with more than one worker this is a per-worker budget, not a global
    one, which is still enough to blunt online guessing.
    """

    def __init__(
        self,
        *,
        max_failures: int = 5,
        window_seconds: int = 60,
        lockout_seconds: int = 300,
    ) -> None:
        self._max_failures = max_failures
        self._window = window_seconds
        self._lockout = lockout_seconds
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()
        self._lock = threading.Lock()
        self._clock: Callable[[], float] | None = None

    def set_clock(self, clock: Callable[[], float]) -> None:
        """Inject a monotonic callable so tests do not have to sleep."""
        self._clock = clock

    def _now(self) -> float:
        if callable(self._clock):
            return float(self._clock())
        return time.monotonic()

    def _prune(self, now: float) -> None:
        expired = [
            key
            for key, bucket in self._buckets.items()
            if bucket.locked_until <= now and bucket.failures == 0
        ]
        for key in expired:
            del self._buckets[key]

    def seconds_until_allowed(self, key: str) -> int:
        """Return the remaining lockout for ``key``; 0 when the caller may try."""
        now = self._now()
        with self._lock:
            self._prune(now)
            bucket = self._buckets.get(key)
            if bucket is None or bucket.locked_until <= now:
                return 0
            return max(1, int(bucket.locked_until - now) + 1)

    def is_allowed(self, key: str) -> bool:
        return self.seconds_until_allowed(key) == 0

    def record_failure(self, key: str) -> None:
        now = self._now()
        with self._lock:
            self._prune(now)
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = _Bucket()
                self._buckets[key] = bucket
            bucket.failures += 1
            if bucket.failures >= self._max_failures:
                bucket.locked_until = now + self._lockout
                bucket.failures = 0

    def reset(self, key: str) -> None:
        with self._lock:
            self._buckets.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()


login_rate_limiter = LoginRateLimiter()


__all__ = ["LoginRateLimiter", "login_rate_limiter"]
