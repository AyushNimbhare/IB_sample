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

# The three stages this sample implements, in order. The full programme has
# eleven; stages 4-11 are shown as dashed chips in the rail and nothing more.
STAGE_ORDER = ("welcome", "brief", "dealbook")


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

        "started_at": None,
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
    """Start the run clock, once, when the analyst signs in."""
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
