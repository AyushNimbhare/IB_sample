"""State -> render payload.

The client renders whatever this module hands it and nothing else. That makes
this file the privacy boundary as much as a presentation layer, so the rule is
simple and worth stating plainly:

    a field that would let the player skip the thinking is not in the payload
    until they have done the thinking.

In practice:

  * the quiz question carries its options but **not** the answer index, and
    `correct_index` / `why` stay null until the question has been answered
  * only the question the player is on is built at all — the rest are absent
    from the response, not hidden by the CSS
  * the Deal Book lists the five mandates but carries nothing about how any
    of them turns out

Only the section for the current stage is built, so another stage is not
merely hidden by the CSS — it is not in the response.
"""

from __future__ import annotations

from typing import Any

from . import content, rules, state as state_mod

# The stage rail shows the shape of the whole programme, so a player can see
# where the run is going. Stages past the Deal Book are `stage: None` and render
# as locked: they carry a mark, a number and a name, and nothing else. They are
# never clickable, and no label, hint or tooltip is built for them, so the
# payload says no more about them than the shape.
CHIPS: tuple[dict[str, Any], ...] = (
    {"n": 1, "label": "Welcome", "stage": "welcome"},
    {"n": 2, "label": "Brief", "stage": "brief"},
    {"n": 3, "label": "Desk", "stage": "dealbook"},
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

# Sector -> icon key. Presentation only; the sector name always shows too.
SECTOR_ICONS = {
    "Tech": "tech",
    "Media": "media",
    "Pharma": "pharma",
    "Steel": "steel",
    "E-commerce": "shop",
}

ROLE_CARDS = (    ("Buy", "A client wants to acquire a company.", "buy"),
    ("Sell", "A client wants to exit.", "sell"),
    ("Raise money", "A client needs investors.", "raise"),
    ("Fix a company", "A client cannot pay its debts.", "fix"),
)

TUTORIAL_SCRIPT = (
    ("Meera", "Welcome to Ashford & Rowe. I am Meera, and I will be with you the whole run."),
    ("Meera", "Five clients, five jobs. For each one you read the brief, research the "
              "target, do one task, and make the call."),
    ("Meera", "Three answers every time: go, go with protection, or walk away. Walking "
              "away is a real answer."),
    ("Meera", "Not every deal on your desk is a good deal. Knowing the difference is the job."),
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
    the Deal Book, so the two can never disagree about what is on the desk.

    `icon` is a key into the client's icon set, chosen from the sector. It is
    presentation only — it carries no information the sector string does not
    already carry, and the sector is always shown beside it.
    """
    return [
        {
            "code": d["code"],
            "sector": d["sector"],
            "year": d["year"],
            "status": d["status"],
            "note": d["note"],
            "open": d["status"] == "open",
            "icon": SECTOR_ICONS.get(d["sector"], "deals"),
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
    """The rail. Three states for a stage in the run, one for everything after.

    `locked` is a different thing from `upcoming`. An upcoming stage is one the
    player is going to reach; a locked one is not open to them at all, so it
    reads as closed rather than as pending.
    """
    here = state_mod.STAGE_ORDER.index(state["stage"])
    out: list[dict[str, Any]] = []
    for chip in CHIPS:
        if chip["stage"] is None:
            chip_state = "locked"
        else:
            there = state_mod.STAGE_ORDER.index(chip["stage"])
            chip_state = "active" if there == here else ("done" if there < here else "upcoming")
        out.append({"n": chip["n"], "label": chip["label"], "state": chip_state})
    return out


def _companion(state: dict) -> dict[str, str]:
    """Meera's line: one sentence, and never a restatement of the screen.

    The distinction matters. Meera is the voice that prompts a player — she
    asks, nudges and reminds. The lede under the heading states context. When
    both carried the same sentence the screen said everything twice, which is
    the flattest thing a layout can do.
    """
    if state["stage"] == "welcome":
        lines = {
            "title": "Not every deal on your desk is a good deal. Knowing the "
                     "difference is the job.",
            "identity": "I will be beside you the whole run. Say so if that is too much.",
            "role": "You are on the buy side. Keep that in mind for the first deal.",
            "desk": "Five mandates. I would start with the words, not the numbers.",
        }
        line = lines.get(state["w_sub"], lines["title"])
    elif state["stage"] == "brief":
        lines = {
            "briefing": "You do not need these by heart. You will meet each one again.",
            "quiz": "A wrong answer costs points and nothing else.",
        }
        line = lines.get(state["b_sub"], lines["briefing"])
    else:
        line = "That is the run. Here is where you stand."
    return {"tag": "Meera", "line": line}


def _rail(state: dict) -> dict[str, Any]:
    """Whole-run briefing progress: six words opened plus questions answered.

    One number for the run, so a screen can show it without restating what the
    screen already says. The client shows it on the Briefing Room only.
    """
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
            "title": "Five real deals. You make the calls.",
            "lede": "You are the new analyst at Ashford & Rowe.",
            "facts": ["About 40 minutes", "5 real deals", "Leaderboard"],
            "note": "At the end you find out which real companies these were.",
            "tutorial_open": state["tutorial"],
            "tutorial": [{"speaker": s, "line": t} for s, t in TUTORIAL_SCRIPT],
        })

    elif screen == "identity":
        base.update({
            "name": state["name"],
            "nda": state["nda"],
            "guidance": state["guidance"],
            "codenames": [d["code"] for d in content.BRIEFING["deal_book"]],
            "modes": [
                {"id": "normal", "name": "Normal",
                 "desc": "Meera explains each step."},
                {"id": "less", "name": "Less",
                 "desc": "Meera stays quiet. Same points."},
            ],
            # Note: no `can_continue` here on purpose. The name and the tick are
            # a draft the browser holds until submit, so the button's enabled
            # state is computed client-side. The rule that actually matters is
            # enforced in rules._welcome_identity_submit.
        })

    elif screen == "role":
        base["jobs"] = [{"title": t, "desc": d, "icon": i} for t, d, i in ROLE_CARDS]

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
    """The desk, and the end of the run.

    The five mandates are listed and the open one is highlighted. A mandate is
    not a button here: it has no page to go to yet, and a button that does
    nothing is worse than no button.
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
        # The two numbers the closing panel leads with, sent as numbers so the
        # client never has to parse them back out of a formatted string.
        "score": {"points": scoring["points"],
                  "possible": scoring["points_possible"]},
        # The three receipt counters from the desk. They are the only place the
        # run shows a deal tally, and they carry no outcome: a receipt says what
        # happened to the process, never whether the client did well.
        "receipts": [
            {"label": "Closed", "value": state["deals_closed"]},
            {"label": "Walked away", "value": state["deals_walked"]},
            {"label": "Lost to rival", "value": state["deals_lost"]},
        ],
        "summary": [
            {"label": "Answers correct",
             "value": f"{scoring['questions_correct']} of {scoring['questions_total']}"},
            {"label": "Points",
             "value": f"{scoring['points']} of {scoring['points_possible']}"},
            {"label": "Guidance",
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
        "view": view,
    }
