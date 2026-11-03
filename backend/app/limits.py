"""Abuse limits for the inference service.

* UserLimiter: one analysis in flight per user, plus a sliding-window rate
  limit per user.
* EmbedGate: a process-wide semaphore around model.embed, so a burst of
  requests cannot run many transformer passes at once.

Both are per process. Run a fixed number of workers (see backend/README.md);
with several instances, the effective limits multiply and a shared store
(e.g. Redis) would be needed.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager


class AnalysisInProgress(Exception):
    pass


class RateLimited(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate limited")
        self.retry_after = retry_after


class ModelBusy(Exception):
    pass


class UserLimiter:
    def __init__(self, per_window: int, window_seconds: int, clock: Callable[[], float] = time.monotonic) -> None:
        self._per_window = per_window
        self._window = window_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._in_flight: set[uuid.UUID] = set()
        self._starts: dict[uuid.UUID, deque[float]] = {}

    @contextmanager
    def analysis(self, user_id: uuid.UUID) -> Iterator[None]:
        """Admits one analysis for the user or raises; always releases."""
        with self._lock:
            if user_id in self._in_flight:
                raise AnalysisInProgress()
            now = self._clock()
            starts = self._starts.setdefault(user_id, deque())
            while starts and now - starts[0] >= self._window:
                starts.popleft()
            if len(starts) >= self._per_window:
                raise RateLimited(retry_after=max(1, int(self._window - (now - starts[0])) + 1))
            starts.append(now)
            self._in_flight.add(user_id)
        try:
            yield
        finally:
            with self._lock:
                self._in_flight.discard(user_id)


class EmbedGate:
    def __init__(self, concurrency: int, wait_seconds: float) -> None:
        self._semaphore = threading.BoundedSemaphore(concurrency)
        self._wait = wait_seconds

    @contextmanager
    def slot(self) -> Iterator[None]:
        if not self._semaphore.acquire(timeout=self._wait):
            raise ModelBusy()
        try:
            yield
        finally:
            self._semaphore.release()
