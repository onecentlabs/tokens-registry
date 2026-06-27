"""Background auto-refresh loop (plain asyncio, no extra dependency)."""

from __future__ import annotations

import asyncio
import logging

from . import config
from .refresh import run_refresh

log = logging.getLogger("scheduler")


async def _loop() -> None:
    interval = config.REFRESH_INTERVAL_SECONDS
    log.info("auto-refresh every %ss", interval)
    while True:
        await asyncio.sleep(interval)
        try:
            await run_refresh()
        except Exception as exc:  # noqa: BLE001 - keep the loop alive
            log.error("scheduled refresh failed: %s", exc)


def start() -> asyncio.Task | None:
    if config.REFRESH_INTERVAL_SECONDS <= 0:
        log.info("auto-refresh disabled (REFRESH_INTERVAL_SECONDS=0)")
        return None
    return asyncio.create_task(_loop())
