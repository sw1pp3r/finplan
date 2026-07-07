#!/usr/bin/env python3
"""Local latency benchmark for finplan's main user path.

The script expects a running server and measures the same HTTP API surface the
dashboard depends on. It prints a JSON payload so before/after runs can be
compared mechanically.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from dataclasses import dataclass
from typing import Any

import httpx


IMPORTANT_ENDPOINTS = [
    "/api/summary?horizon=180",
    "/api/forecast?horizon=180",
    "/api/expenses",
]

DASHBOARD_REQUESTS = [
    "/api/income",
    "/api/expenses",
    "/api/accounts",
    "/api/snapshots/last",
    "/api/rates",
    "/api/obligations",
    "/api/inflows",
    "/api/forecast?horizon=180",
    "/api/summary?horizon=180",
]


@dataclass
class Sample:
    ok: bool
    status: int
    ms: float
    error: str | None = None


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = (len(ordered) - 1) * p
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    frac = rank - lo
    return ordered[lo] * (1 - frac) + ordered[hi] * frac


def stats(samples: list[Sample]) -> dict[str, Any]:
    values = [s.ms for s in samples]
    return {
        "count": len(samples),
        "ok": sum(1 for s in samples if s.ok),
        "errors": sum(1 for s in samples if not s.ok),
        "statuses": sorted({s.status for s in samples}),
        "first_error": next((s.error for s in samples if s.error), None),
        "p50_ms": round(statistics.median(values), 3) if values else 0,
        "p95_ms": round(percentile(values, 0.95), 3),
        "max_ms": round(max(values), 3) if values else 0,
    }


async def timed_get(client: httpx.AsyncClient, path: str, headers: dict[str, str]) -> Sample:
    start = time.perf_counter()
    status = 0
    ok = False
    try:
        response = await client.get(path, headers=headers)
        status = response.status_code
        response.raise_for_status()
        ok = True
    except Exception as exc:
        ok = False
        return Sample(ok=ok, status=status, ms=(time.perf_counter() - start) * 1000, error=repr(exc))
    return Sample(ok=ok, status=status, ms=(time.perf_counter() - start) * 1000)


async def measure_endpoint(
    client: httpx.AsyncClient,
    path: str,
    headers: dict[str, str],
    rounds: int,
) -> list[Sample]:
    samples: list[Sample] = []
    for _ in range(rounds):
        samples.append(await timed_get(client, path, headers))
    return samples


async def measure_dashboard(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    rounds: int,
) -> list[Sample]:
    samples: list[Sample] = []
    for _ in range(rounds):
        start = time.perf_counter()
        responses = await asyncio.gather(
            *(client.get(path, headers=headers) for path in DASHBOARD_REQUESTS),
            return_exceptions=True,
        )
        ok = True
        status = 200
        for response in responses:
            if isinstance(response, Exception):
                ok = False
                status = 0
                continue
            status = max(status, response.status_code)
            if response.status_code >= 400:
                ok = False
        samples.append(Sample(ok=ok, status=status, ms=(time.perf_counter() - start) * 1000))
    return samples


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8741")
    parser.add_argument("--rounds", type=int, default=60)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()

    headers = {"X-Demo": "1"} if args.demo else {}
    timeout = httpx.Timeout(10.0)
    limits = httpx.Limits(max_connections=20, max_keepalive_connections=20)
    async with httpx.AsyncClient(base_url=args.base_url, timeout=timeout, limits=limits) as client:
        for _ in range(args.warmup):
            await timed_get(client, "/api/summary?horizon=180", headers)

        endpoints: dict[str, dict[str, Any]] = {}
        for path in IMPORTANT_ENDPOINTS:
            endpoints[path] = stats(await measure_endpoint(client, path, headers, args.rounds))

        dashboard = stats(await measure_dashboard(client, headers, args.rounds))

    payload = {
        "base_url": args.base_url,
        "rounds": args.rounds,
        "warmup": args.warmup,
        "demo": args.demo,
        "endpoints": endpoints,
        "dashboard_network": dashboard,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    all_stats = [*endpoints.values(), dashboard]
    return 0 if all(s["errors"] == 0 for s in all_stats) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
