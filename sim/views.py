"""State -> render payload.

The client renders whatever this module hands it and nothing else. That makes
this file the privacy boundary as much as a presentation layer, so the rule is
simple and worth stating plainly:

    a field that would let the player skip the thinking is not in the payload
    until they have done the thinking.

In practice, in this three-stage sample:

  * the quiz question carries its options but **not** the answer index, and
    `correct_index` / `why` stay null until the question has been answered
  * only the question the player is on is built at all — the rest are absent
    from the response, not hidden by the CSS
  * the Deal Book lists the five mandates but carries nothing about how any
    of them turns out

Only the section for the current stage is built, so a future stage is not
merely hidden by the CSS — it is not in the response.
"""

from __future__ import annotations

from typing import Any

from . import content, rules, state as state_mod

# The stage rail. `stage` is None for the parts this sample does not build;
# they still render, dashed, so the shape of the full programme stays visible.
CHIPS: tuple[dict[str, Any], ...] = (
    {"n": 1, "label": "Welcome", "stage": "welcome"},
    {"n": 2, "label": "Brief", "stage": "brief"},
    {"n": 3, "label": "Deal Book", "stage": "dealbook"},
    {"n": 4, "label": "Prism", "stage": None},
    {"n": 5, "label": "Vault", "stage": None},
    {"n": 6, "label": "Cedar", "stage": None},
    {"n": 7, "label": "Anvil", "stage": None},
    {"n": 8, "label": "Monsoon", "stage": None},
    {"n": 9, "label": "Defend", "stage": None},
    {"n": 10, "label": "Truth", "stage": None},
    {"n": 11, "label": "Report", "stage": None},
)

WELCOME_SCREENS = ("title", "identity", "role", "desk")

ROLE_CARDS = (
    ("Buy", "A client wants to acquire a company. You value it, find the risks, and set a price."),
    ("Sell", "A client wants to exit. You run the process and get the best price."),
    ("Raise money", "A client needs capital. You find the investors and agree the terms."),
    ("Fix a company in trouble", "A client cannot pay its debts. You restructure what it owes."),
)

TUTORIAL_SCRIPT = (
    ("Meera", "Welcome to Ashford & Rowe. I am Meera, and I will be with you for the whole run."),
    ("Meera", "Five clients have given us five jobs. For each one you will read the brief, "
              "research the target, do one main task, and then make the call."),
    ("Meera", "You always have three choices: go, go with protection, or walk away. "
              "Walking away is a real answer."),
    ("Meera", "One thing before we start. Not every deal on your desk is a good deal. "
              "Your job is to know the difference."),
)


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def _clock_label(seconds: int) -> str:
    if seconds <= 0:
        return "Time up"
    return f"{-(-seconds // 60)} min"


def _mandates(briefing: dict) -> list[dict[str, Any]]:
    """The desk, as the client draws it. Shared by the welcome desk screen and
    the Deal Book, so the two can never disagree about what is on the desk."""
    return [
        {
            "code": d["code"],
            "sector": d["sector"],
            "year": d["year"],
            "status": d["status"],
            "note": d["note"],
            "open": d["status"] == "open",
        }
        for d in briefing["deal_book"]
    ]


# ---------------------------------------------------------------------------
# Shared chrome
# ---------------------------------------------------------------------------


def _topbar(state: dict) -> dict[str, Any]:
    left = state_mod.seconds_left(state)
    return {
        "name": state["name"] or None,
        # Always zero: this sample stops at the Deal Book, one stage before the
        # first deal opens. The counter is here because it is part of the real
        # programme's chrome, and hiding it would misrepresent the full build.
        "deals_done": 0,
        "deals_total": len(content.BRIEFING["deal_book"]),
        "points": state["points"],
        "clock_label": _clock_label(left),
        # Seconds as well as a label: the client counts down locally between
        # actions so the clock does not look frozen, and every response
        # re-syncs it to the server's value.
        "seconds_left": left,
        "clock_low": left <= 300,
        "guidance": state["guidance"],
    }


def _chips(state: dict) -> list[dict[str, Any]]:
    here = state_mod.STAGE_ORDER.index(state["stage"])
    out: list[dict[str, Any]] = []
    for chip in CHIPS:
        if chip["stage"] is None:
            chip_state = "unbuilt"
        else:
            there = state_mod.STAGE_ORDER.index(chip["stage"])
            chip_state = "active" if there == here else ("done" if there < here else "upcoming")
        out.append({"n": chip["n"], "label": chip["label"], "state": chip_state})
    return out


def _companion(state: dict) -> dict[str, str]:
    if state["stage"] == "welcome":
        lines = {
            "title": "Five clients. Five decisions. Not every deal on your desk is a good one. "
                     "Your job is to know the difference.",
            "identity": "Sign in and pick how much help you want. You can change it later.",
            "role": "Buy, sell, raise money, or fix a company in trouble. Today you are on the "
                    "buy side.",
            "desk": "Five mandates, still face down. The briefing room comes first.",
        }
        tag = f"Welcome · {state['w_sub']}"
        line = lines.get(state["w_sub"], lines["title"])
    elif state["stage"] == "brief":
        lines = {
            "briefing": "You do not need to know these by heart. You will see each one again "
                        "inside a deal.",
            "quiz": "Wrong answers cost you nothing but points. Read the explanation either way.",
        }
        tag = f"Briefing · {state['b_sub']}"
        line = lines.get(state["b_sub"], lines["briefing"])
    else:
        tag = "Deal Book · On your desk"
        line = "Five mandates. Five sectors. One desk. This is where the sample stops."
    return {"tag": tag, "line": line}


def _rail(state: dict) -> dict[str, Any]:
    briefing = content.BRIEFING
    total = len(briefing["words"]) + len(briefing["questions"])
    done = len(state["words_opened"]) + len(state["answers"])
    return {
        "progress": {
            "done": done,
            "total": total,
            "pct": round(done / total * 100) if total else 0,
            "label": f"{done}/{total}",
        },
    }


# ---------------------------------------------------------------------------
# Stage 1 — Welcome
# ---------------------------------------------------------------------------


def _welcome_view(state: dict) -> dict[str, Any]:
    screen = state["w_sub"]
    base: dict[str, Any] = {"kind": "welcome", "screen": screen}

    if screen == "title":
        base.update({
            "title": "Five real deals. Five industries. You make the calls.",
            "lede": "You are the new analyst at Ashford & Rowe. Advise each client: go, "
                    "go with protection, or walk away.",
            "facts": ["About 40 minutes", "5 real deals", "Leaderboard"],
            "note": "At the end, you find out which real companies these were.",
            "footnote": "Best on a laptop. Keep 40 minutes free. Headphones help.",
            "tutorial_open": state["tutorial"],
            # The blueprint asks for a captioned tutorial video (p5) and a text
            # altertrack for every voice moment (p19). There is no video in this
            # sample, so the script itself is the accessible artefact.
            "tutorial": [{"speaker": s, "line": t} for s, t in TUTORIAL_SCRIPT],
        })

    elif screen == "identity":
        base.update({
            "name": state["name"],
            "nda": state["nda"],
            "guidance": state["guidance"],
            "codenames": [d["code"] for d in content.BRIEFING["deal_book"]],
            "modes": [
                {"id": "normal", "name": "Normal guidance",
                 "desc": "Meera explains the next action and why it matters."},
                {"id": "less", "name": "Less guidance",
                 "desc": "Meera stays quiet unless you ask. Same points either way."},
            ],
            # Note: no `can_continue` here on purpose. The name and the tick are
            # a draft the browser holds until submit, so the button's enabled
            # state is computed client-side. The rule that actually matters is
            # enforced in rules._welcome_identity_submit.
        })

    elif screen == "role":
        base["jobs"] = [{"title": t, "desc": d} for t, d in ROLE_CARDS]

    else:  # desk
        base.update({
            "deals": _mandates(content.BRIEFING),
            "footer": content.BRIEFING["deal_book_footer"],
        })

    return base


# ---------------------------------------------------------------------------
# Stage 2 — Briefing Room
# ---------------------------------------------------------------------------


def _brief_view(state: dict) -> dict[str, Any]:
    briefing = content.BRIEFING
    screen = state["b_sub"]
    base: dict[str, Any] = {"kind": "brief", "screen": screen}

    if screen == "quiz":
        # `q_index` only ever advances to the last question, so this clamp is
        # unreachable in a healthy run. It is here so that a corrupt session
        # renders the last question instead of a 500.
        index = min(state["q_index"], len(briefing["questions"]) - 1)
        question = content.question_at(index)
        given = state["answers"].get(question["id"])
        answered = given is not None

        base.update({
            "index": index,
            "number": index + 1,
            "total": len(briefing["questions"]),
            "points": state["points"],
            "answered_count": len(state["answers"]),
            # The answer index is withheld until the question has been answered.
            "question": {"id": question["id"], "prompt": question["prompt"],
                         "options": question["options"]},
            "answered": answered,
            "picked": given["picked"] if answered else None,
            "correct_index": question["answer"] if answered else None,
            "why": question["why"] if answered else None,
            "can_advance": answered,
            "is_last": index == len(briefing["questions"]) - 1,
        })
        return base

    # briefing
    opened = state["words_opened"]
    total = len(briefing["words"])
    base.update({
        "lede": briefing["stage_lede"],
        "hint": briefing["stage_hint"],
        "words": [
            {
                "id": w["id"],
                "word": w["word"],
                "meaning": w["meaning"],
                "example": w["example"],
                "where": w["where"],
                "open": w["id"] in opened,
            }
            for w in briefing["words"]
        ],
        "opened": len(opened),
        "total": total,
        "pct": round(len(opened) / total * 100) if total else 0,
        "can_start_quiz": len(opened) == total,
    })
    return base


# ---------------------------------------------------------------------------
# Stage 3 — Deal Book
# ---------------------------------------------------------------------------


def _dealbook_view(state: dict) -> dict[str, Any]:
    """The desk, and the end of this sample.

    The five mandates are listed and the open one is highlighted, but nothing
    is clickable: opening a mandate is stage 4, and stage 4 is not built. A
    button that does nothing would be worse than no button, so the closing
    note says plainly where the sample stops.
    """
    briefing = content.BRIEFING
    scoring = rules.points_breakdown(state)
    return {
        "kind": "dealbook",
        "lede": briefing["deal_book_lede"],
        "hint": briefing["deal_book_hint"],
        "deals": _mandates(briefing),
        "footer": briefing["deal_book_footer"],
        "close": briefing["deal_book_close"],
        "brief_done": state["brief_done"],
        "summary": [
            {"label": "Briefing answers correct",
             "value": f"{scoring['questions_correct']} of {scoring['questions_total']}"},
            {"label": "Points",
             "value": f"{scoring['points']} of {scoring['points_possible']}"},
            {"label": "Guidance mode",
             "value": "Less" if state["guidance"] == "less" else "Normal"},
        ],
    }


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------


def build(state: dict) -> dict[str, Any]:
    """The complete render payload for one player."""
    if state["stage"] == "welcome":
        view = _welcome_view(state)
    elif state["stage"] == "brief":
        view = _brief_view(state)
    else:
        view = _dealbook_view(state)

    return {
        "stage": state["stage"],
        "topbar": _topbar(state),
        "chips": _chips(state),
        "companion": _companion(state),
        "rail": _rail(state),
        "view": view,
    }
