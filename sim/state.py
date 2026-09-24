"""Server-side simulation state.

One plain dict per player. It lives on the server and the browser never gets
a copy of the parts it has not earned — see sim/views.py.

Deliberately a dict rather than a class: it round-trips through the session
store and through JSON with no mapping layer, and the whole shape is visible
in one place.
"""

from __future__ import annotations

import copy
import time
from typing import Any

STATE_VERSION = 1
TOTAL_SECONDS = 40 * 60

# The three stages this sample implements, in order.
STAGE_ORDER = ("welcome", "brief", "prism")


def blank_state() -> dict[str, Any]:
    """A fresh run, at the very first screen."""
    return {
        "version": STATE_VERSION,
        "stage": "welcome",
        "w_sub": "title",           # title -> identity -> role -> desk
        "name": "",
        "nda": False,
        "guidance": "normal",       # normal | less
        "tutorial": False,

        "b_sub": "briefing",        # briefing -> quiz -> dealbook
        "words_opened": [],
        "q_index": 0,
        "answers": {},              # question id -> {"picked": int, "correct": bool}
        "points": 0,
        "brief_done": False,

        "deal": _blank_deal(),

        "started_at": None,
    }


def _blank_deal() -> dict[str, Any]:
    return {
        "id": None,
        "step": "brief",            # brief -> research -> task -> call -> review -> receipt
        "seen": [],
        "active_page": None,
        "tray": [],                 # [{"kind": "fact"|"risk", "text": str}]
        "metric": None,
        "metric_right": False,
        "price_m": None,
        "choice": None,             # go | protect | walk
        "protections": [],
        "reason": None,
        "note": "",
        "locked": False,
    }


def snapshot(state: dict[str, Any]) -> dict[str, Any]:
    """A deep copy, so a handler cannot half-mutate the live state."""
    return copy.deepcopy(state)


def seconds_left(state: dict[str, Any]) -> int:
    """Wall-clock time remaining.

    Computed from `started_at` rather than decremented, so the clock keeps
    honest time even if the tab is closed and reopened. It is display-only in
    this sample: it clamps at zero and never blocks the run, because the
    blueprint specifies expiry behaviour for only one of its three clocks
    (p6) and a dead demo is worse than an honest one.
    """
    started = state.get("started_at")
    if not started:
        return TOTAL_SECONDS
    elapsed = int(time.time() - started)
    return max(0, TOTAL_SECONDS - elapsed)


def start_clock(state: dict[str, Any]) -> None:
    """Start the run clock, once, the first time a deal opens."""
    if not state.get("started_at"):
        state["started_at"] = time.time()


def is_stale(state: dict[str, Any], max_age_seconds: int) -> bool:
    """True if a session has not been touched for a long time.

    Used to evict abandoned runs from the in-memory store.
    """
    touched = state.get("_touched_at") or state.get("started_at")
    if not touched:
        return False
    return (time.time() - touched) > max_age_seconds
