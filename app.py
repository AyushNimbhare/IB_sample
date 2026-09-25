"""Flask application for the Investment Banking simulation sample.

Two endpoints do all the work:

    GET  /api/state    the full render payload for the current player
    POST /api/action   {action, payload} -> the new payload plus any events

The browser is a view layer. It never computes a score, never decides whether
a step is reachable, and never sees an answer it has not earned.

Run it:

    pip install -r requirements.txt
    python app.py
    # -> http://127.0.0.1:5057
"""

from __future__ import annotations

import os
import secrets
import threading
import time

from flask import Flask, jsonify, render_template, request, session

from sim import content, rules, state as state_mod, views

# ---------------------------------------------------------------------------
# App configuration
# ---------------------------------------------------------------------------

app = Flask(__name__)

# A random key each boot means sessions do not survive a restart, which is the
# right default for a sample: it is obvious rather than surprising. Set
# FINTREE_SECRET_KEY to keep runs alive across restarts.
app.config["SECRET_KEY"] = os.environ.get("FINTREE_SECRET_KEY") or secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["JSON_SORT_KEYS"] = False


# ---------------------------------------------------------------------------
# Session store
#
# Deliberately an in-memory dict. It is the smallest thing that demonstrates
# server-authoritative state, and it needs no setup to run.
#
# This is also why the deploy runs ONE worker process — see the Procfile. Every
# worker would hold its own copy of this dict, so a player's run would vanish
# whenever two of their clicks landed on different workers. That is the same
# failure a serverless platform gives you, which is why the app is not deployed
# to one.
#
# A real deployment at scale would put this in Redis or a database, behind the
# same three operations used here. See the README.
# ---------------------------------------------------------------------------

_SESSIONS: dict[str, dict] = {}
_SESSIONS_LOCK = threading.Lock()
MAX_SESSIONS = 500
SESSION_MAX_AGE_SECONDS = 6 * 60 * 60


def _evict_stale() -> None:
    """Drop runs that have not been touched in a long time.

    Without this the dict grows for the lifetime of the process, which is a
    slow leak rather than a crash — but it is still a leak.
    """
    stale = [sid for sid, st in _SESSIONS.items()
             if state_mod.is_stale(st, SESSION_MAX_AGE_SECONDS)]
    for sid in stale:
        _SESSIONS.pop(sid, None)

    if len(_SESSIONS) > MAX_SESSIONS:
        ordered = sorted(_SESSIONS.items(), key=lambda kv: kv[1].get("_touched_at", 0))
        for sid, _ in ordered[: len(_SESSIONS) - MAX_SESSIONS]:
            _SESSIONS.pop(sid, None)


def _current_state() -> dict:
    """The state for this browser, created on first contact.

    Not thread-safe on its own, and it does not need to be: every caller holds
    `_SESSIONS_LOCK` for the whole time it uses the dict it gets back. The lock
    is not held across a rules call, so a slow action cannot block other
    players — it only stops two threads from interleaving a read and a write on
    the same run.
    """
    sid = session.get("sid")
    if not sid or sid not in _SESSIONS:
        _evict_stale()
        sid = secrets.token_urlsafe(16)
        session["sid"] = sid
        _SESSIONS[sid] = state_mod.blank_state()

    st = _SESSIONS[sid]
    st["_touched_at"] = time.time()
    return st


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/robots.txt")
def robots():
    # Kept out of search indexes deliberately; the noindex meta tag in the
    # template does the same job for anything that ignores this file.
    return app.send_static_file("robots.txt")


@app.get("/api/state")
def api_state():
    with _SESSIONS_LOCK:
        st = _current_state()
    return jsonify({"ok": True, "state": views.build(st)})


@app.post("/api/action")
def api_action():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"ok": False, "error": "expected a JSON object"}), 400

    action = body.get("action")
    if not isinstance(action, str) or not action:
        return jsonify({"ok": False, "error": "'action' is required"}), 400

    payload = body.get("payload") or {}
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "'payload' must be an object"}), 400

    # One lock for the whole read-modify-write. `_current_state` can insert a new
    # run into the dict, `apply_action` mutates it, and `views.build` reads it —
    # so all three belong inside. The lock is per-process and is never held
    # across I/O, so it cannot become a bottleneck.
    with _SESSIONS_LOCK:
        st = _current_state()
        try:
            events = rules.apply_action(st, action, payload)
        except rules.ActionError as exc:
            # The state is left untouched, so a rejected action cannot half-apply.
            return jsonify({
                "ok": False,
                "error": str(exc),
                "action": action,
                "state": views.build(st),
            }), 409
        state_payload = views.build(st)

    return jsonify({"ok": True, "events": events, "state": state_payload})


@app.get("/api/health")
def api_health():
    """A small self-description. Useful when something looks wrong."""
    return jsonify({
        "ok": True,
        "stages": list(state_mod.STAGE_ORDER),
        "stages_in_rail": len(views.CHIPS),
        "mandates": [d["code"] for d in content.BRIEFING["deal_book"]],
        "actions": rules.known_actions(),
        "sessions_live": len(_SESSIONS),
    })


@app.errorhandler(404)
def not_found(_exc):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "no such endpoint"}), 404
    return render_template("index.html"), 404


@app.errorhandler(500)
def server_error(exc):
    app.logger.exception("unhandled error: %s", exc)
    return jsonify({"ok": False, "error": "internal error"}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    # Bound to loopback on purpose. Nothing here is meant to face the internet
    # without a real session store and HTTPS in front of it.
    #
    # The default port is 5057 rather than Flask's 5000 on purpose: on macOS,
    # AirPlay Receiver (ControlCenter) listens on 5000 and will answer requests
    # with a 403 before Flask ever sees them. Override with PORT=... if needed.
    port = int(os.environ.get("PORT", "5057"))
    debug = bool(os.environ.get("FINTREE_DEBUG"))

    print("  Ashford & Rowe — Investment Banking Simulation")
    print(f"  mandates     : {', '.join(d['code'] for d in content.BRIEFING['deal_book'])}")
    print(f"  stages       : {', '.join(state_mod.STAGE_ORDER)}")
    print(f"  listening on : http://127.0.0.1:{port}")
    print()

    app.run(host="127.0.0.1", port=port, debug=debug)
