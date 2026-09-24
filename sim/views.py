"""State -> render payload.

The client renders whatever this module hands it and nothing else. That makes
this file the privacy boundary as much as a presentation layer, so the rule is
simple and worth stating plainly:

    a field that would let the player skip the thinking is not in the payload
    until they have done the thinking.

In practice:

  * the quiz question carries its options but **not** the answer index, and
    `correct_index` / `why` stay null until the question has been answered
  * the metric grid carries four numbers but **not** which one is right
  * the fair range is absent until the right metric has been picked
  * the deal's `right_call` never appears in any payload at all

Only the section for the current step is built, so a future step is not merely
hidden by the CSS — it is not in the response.
"""

from __future__ import annotations

from typing import Any

from . import content, rules, state as state_mod

# The stage rail. `stage` is None for the parts this sample does not build;
# they still render, dashed, so the shape of the full programme stays visible.
CHIPS: tuple[dict[str, Any], ...] = (
    {"n": 1, "label": "Welcome", "stage": "welcome"},
    {"n": 2, "label": "Brief", "stage": "brief"},
    {"n": 3, "label": "Deal Book", "stage": "brief"},
    {"n": 4, "label": "Prism", "stage": "prism"},
    {"n": 5, "label": "Vault", "stage": None},
    {"n": 6, "label": "Cedar", "stage": None},
    {"n": 7, "label": "Anvil", "stage": None},
    {"n": 8, "label": "Monsoon", "stage": None},
    {"n": 9, "label": "Defend", "stage": None},
    {"n": 10, "label": "Truth", "stage": None},
    {"n": 11, "label": "Report", "stage": None},
)

WELCOME_SCREENS = ("title", "identity", "role", "desk")

STEP_LABELS = {
    "brief": "Brief",
    "research": "Research",
    "task": "Task",
    "call": "Your call",
    "review": "Review",
    "receipt": "Receipt",
}

STEP_OF = {"brief": 1, "research": 2, "task": 3, "call": 4, "review": 4, "receipt": 4}

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


def money(millions: float | None) -> str:
    """Millions of USD -> '$540M', '$1.5B', '$1B'."""
    if millions is None:
        return "—"
    if millions >= 1000:
        billions = millions / 1000
        if abs(billions - round(billions)) < 1e-9:
            return f"${billions:,.0f}B"
        return f"${billions:,.1f}B"
    return f"${millions:,.0f}M"


def _pct(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return round(max(0.0, min(100.0, (value - low) / (high - low) * 100)), 2)


def _clock_label(seconds: int) -> str:
    if seconds <= 0:
        return "Time up"
    return f"{-(-seconds // 60)} min"


# ---------------------------------------------------------------------------
# Shared chrome
# ---------------------------------------------------------------------------


def _topbar(state: dict) -> dict[str, Any]:
    deals_done = 1 if state["deal"]["locked"] else 0
    left = state_mod.seconds_left(state)
    return {
        "name": state["name"] or None,
        "deals_done": deals_done,
        "deals_total": 5,
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


def _companion(state: dict, deal: dict) -> dict[str, str]:
    if state["stage"] == "welcome":
        lines = {
            "title": "Five clients. Five decisions. Not every deal on your desk is a good one. "
                     "Your job is to know the difference.",
            "identity": "Sign in and pick how much help you want. You can change it later.",
            "role": "Buy, sell, raise money, or fix a company in trouble. Today you are on the "
                    "buy side.",
            "desk": "Start with Prism. Read the brief before you look at any number.",
        }
        tag = f"Welcome · {state['w_sub']}"
        line = lines.get(state["w_sub"], lines["title"])
    elif state["stage"] == "brief":
        lines = {
            "briefing": "You do not need to know these by heart. You will see each one again "
                        "inside a deal.",
            "quiz": "Wrong answers cost you nothing but points. Read the explanation either way.",
            "dealbook": "Five mandates. Five sectors. One desk.",
        }
        tag = f"Briefing · {state['b_sub']}"
        line = lines.get(state["b_sub"], lines["briefing"])
    else:
        step = state["deal"]["step"]
        tag = f"{deal['code']} · {STEP_LABELS.get(step, step)}"
        line = deal["companion"].get(step, deal["companion"]["brief"])
    return {"tag": tag, "line": line}


def _rail(state: dict, deal: dict) -> dict[str, Any]:
    briefing = content.BRIEFING
    total = len(briefing["words"]) + len(briefing["questions"])
    done = len(state["words_opened"]) + len(state["answers"])
    tray = state["deal"]["tray"]
    return {
        "show_tray": state["stage"] == "prism" and state["deal"]["step"] == "research",
        "tray": [{"kind": item["kind"], "text": item["text"]} for item in tray],
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
            "deals": [
                {
                    "code": d["code"],
                    "sector": d["sector"],
                    "year": d["year"],
                    "status": d["status"],
                    "note": d["note"],
                    "open": d["status"] == "open",
                }
                for d in content.BRIEFING["deal_book"]
            ],
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

    if screen == "briefing":
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

    elif screen == "quiz":
        question = content.question_at(state["q_index"])
        if question is None:
            # Defensive: a corrupt q_index should not 500 the page.
            base.update({"kind": "brief", "screen": "dealbook", "deals": [], "lede": "",
                         "hint": "", "footer": ""})
            return base

        given = state["answers"].get(question["id"])
        answered = given is not None

        base.update({
            "index": state["q_index"],
            "number": state["q_index"] + 1,
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
            "is_last": state["q_index"] == len(briefing["questions"]) - 1,
        })

    else:  # dealbook
        base.update({
            "lede": briefing["deal_book_lede"],
            "hint": briefing["deal_book_hint"],
            "footer": briefing["deal_book_footer"],
            "deals": [
                {
                    "code": d["code"],
                    "sector": d["sector"],
                    "year": d["year"],
                    "status": d["status"],
                    "note": d["note"],
                    "open": d["status"] == "open",
                }
                for d in briefing["deal_book"]
            ],
            "brief_done": state["brief_done"],
        })

    return base


# ---------------------------------------------------------------------------
# Stage 3 — Project Prism
# ---------------------------------------------------------------------------


def _range_block(state: dict, deal: dict) -> dict[str, Any]:
    """The fair-range band geometry, computed server-side.

    The client gets percentages, not the arithmetic, so the band it draws is
    always the band the server scored against.
    """
    task = deal["task"]
    low, high = rules.fair_range(deal)
    price = state["deal"]["price_m"] or task["default_price_m"]
    band_left = _pct(low, task["price_min_m"], task["price_max_m"])
    band_right = _pct(high, task["price_min_m"], task["price_max_m"])
    return {
        "low_label": money(low),
        "high_label": money(high),
        "calc": (f"{task['users_m']:g}M users × ${task['per_user'][0]['value']:g} to "
                 f"${task['per_user'][-1]['value']:g} = {money(low)} to {money(high)}"),
        "note": task["range_note"],
        "band_left_pct": band_left,
        "band_width_pct": round(band_right - band_left, 2),
        "marker_left_pct": _pct(price, task["price_min_m"], task["price_max_m"]),
        "scale_min_label": money(task["price_min_m"]),
        "scale_max_label": money(task["price_max_m"]),
        "price_label": money(price),
        "in_range": low <= price <= high,
    }


def _prism_view(state: dict, deal: dict) -> dict[str, Any]:
    deal_state = state["deal"]
    step = deal_state["step"]
    task = deal["task"]

    view: dict[str, Any] = {
        "kind": "prism",
        "step": step,
        "head": {
            "eyebrow": (f"{deal['code']} · {deal['sector']} · {deal['year']} · "
                        f"{STEP_LABELS.get(step, step)}"),
            "step_label": f"Step {STEP_OF.get(step, 1)} of 4",
            "title": "",
            "lede": "",
        },
        "skills": deal["skills"],
        "step_of": deal["step_of"],
    }

    if step == "brief":
        view["head"].update({
            "title": deal["brief"]["headline"],
            "lede": deal["brief"]["client_line"],
        })
        view["brief"] = {
            "body": deal["brief"]["body"],
            "mood_label": deal["brief"]["mood_label"],
            "mood_line": deal["brief"]["mood_line"],
        }

    elif step == "research":
        pages = deal["terminal"]["pages"]
        active_id = deal_state["active_page"] or pages[0]["id"]
        active = next((p for p in pages if p["id"] == active_id), pages[0])
        seen = deal_state["seen"]
        tray_texts = {item["text"] for item in deal_state["tray"]}

        view["head"].update({
            "title": "The Deal Terminal",
            "lede": "A safe, built-in research desk. Every page is fictional in name but based "
                    "on real, dated facts.",
        })
        view["research"] = {
            "address": deal["terminal"]["address"],
            "tabs": [{"id": p["id"], "label": p["label"], "on": p["id"] == active["id"],
                      "seen": p["id"] in seen} for p in pages],
            "page": {
                "title": active["title"],
                "body": active["body"],
                "stats": active.get("stats", []),
                "items": [
                    {
                        "date": item.get("date"),
                        "text": item["text"],
                        "flag": item.get("flag"),
                        "saved": item["text"] in tray_texts,
                        "kind": "risk" if item.get("flag") == "risk" else "fact",
                    }
                    for item in active.get("items", [])
                ],
            },
            "seen": len(seen),
            "total": len(pages),
        }

    elif step == "task":
        view["head"].update({"title": task["prompt"], "lede": task["hint"]})
        metric_state = {}
        if deal_state["metric_right"]:
            metric_state = {task["correct_metric"]: "correct"}
            if deal_state["metric"] != task["correct_metric"]:
                metric_state[deal_state["metric"]] = "wrong"
        elif deal_state["metric"]:
            metric_state = {deal_state["metric"]: "wrong"}

        block: dict[str, Any] = {
            "prompt": task["prompt"],
            "metrics": [
                {
                    "id": m["id"],
                    "label": m["label"],
                    "value": m["value"],
                    "note": m["note"],
                    "state": metric_state.get(m["id"], "idle"),
                }
                for m in task["metrics"]
            ],
            "show_range": deal_state["metric_right"],
            "explanation": (task["wrong_metric_explanation"]
                            if deal_state["metric"] and not deal_state["metric_right"] else None),
            "can_continue": deal_state["metric_right"],
            "per_user_label": task["per_user_label"],
            "range_label": task["range_label"],
        }
        if deal_state["metric_right"]:
            block["per_user"] = [
                {"label": p["label"], "value_label": f"${p['value']:g} per user"}
                for p in task["per_user"]
            ]
            block["range"] = _range_block(state, deal)
        view["task"] = block

    elif step in ("call", "review"):
        call = deal["call"]
        selected_protections = set(deal_state["protections"])
        block = {
            "prompt": call["prompt"],
            "hint": call["hint"],
            "choices": [
                {"id": c["id"], "label": c["label"], "blurb": c["blurb"],
                 "selected": deal_state["choice"] == c["id"]}
                for c in call["choices"]
            ],
            "show_protections": deal_state["choice"] == "protect",
            "protection_label": call["protection_label"],
            "protection_note": call["protection_note"],
            "protections": [
                {"id": p["id"], "label": p["label"], "blurb": p["blurb"],
                 "selected": p["id"] in selected_protections}
                for p in call["protections"]
            ],
            "show_price": deal_state["choice"] not in (None, "walk"),
            "price_label": call["price_label"],
            "show_reasons": deal_state["choice"] is not None,
            "reason_label": call["reason_label"],
            "reasons": [
                {"id": r["id"], "text": r["text"], "selected": deal_state["reason"] == r["id"]}
                for r in call["reasons"]
            ],
            "can_review": rules.call_is_complete(state, deal),
            "range": _range_block(state, deal),
        }
        view["head"].update({"title": call["prompt"], "lede": call["hint"]})
        view["call"] = block

        if step == "review":
            choice_label = next((c["label"] for c in call["choices"]
                                 if c["id"] == deal_state["choice"]), "")
            reason_text = next((r["text"] for r in call["reasons"]
                                if r["id"] == deal_state["reason"]), "")
            protection_labels = [p["label"] for p in call["protections"]
                                 if p["id"] in selected_protections]
            low, high = rules.fair_range(deal)

            rows = [
                {"label": "Deal",
                 "value": f"{deal['code']} · {deal['sector']} · {deal['year']}"},
                {"label": "Call", "value": choice_label},
            ]
            if deal_state["choice"] != "walk":
                rows.append({"label": "Price", "value": money(deal_state["price_m"])})
                rows.append({"label": "Fair range", "value": f"{money(low)} – {money(high)}"})
            if protection_labels:
                rows.append({"label": "Protection", "value": ", ".join(protection_labels)})
            rows.append({"label": "Reason", "value": reason_text})

            view["review"] = {
                "title": "Review before it locks",
                "lede": "Once you lock this, it is final. No going back.",
                "rows": rows,
                "note_label": call["note_label"],
                "note_placeholder": call["note_placeholder"],
                "note_max": call["note_max"],
                "note": deal_state["note"],
            }

    else:  # receipt
        call = deal["call"]
        choice_label = next((c["label"] for c in call["choices"]
                             if c["id"] == deal_state["choice"]), "")
        headline = f"{deal['code']} — {choice_label}"
        if deal_state["choice"] != "walk":
            headline += f" at {money(deal_state['price_m'])}"

        scoring = rules.points_breakdown(state)
        view["head"].update({
            "title": "Your call is on the record",
            "lede": deal["receipt"]["line"],
        })
        # Note what is NOT here: deal['task']['right_call']. The outcome stays
        # sealed until the Truth stage, which this sample does not build.
        view["receipt"] = {
            "stamp": deal["receipt"]["stamp"],
            "headline": headline,
            "detail": deal["receipt"]["detail"],
            "summary": [
                {"label": "Briefing answers correct",
                 "value": f"{scoring['questions_correct']} of {scoring['questions_total']}"},
                {"label": "Points", "value": str(scoring["points"])},
                {"label": "Evidence saved", "value": str(len(deal_state["tray"]))},
                {"label": "Guidance mode",
                 "value": "Less" if state["guidance"] == "less" else "Normal"},
            ],
            "next_note": "The next stage in the full programme would open Project Vault. Nothing "
                         "about how this deal really ended is shown here — that is the Truth "
                         "stage, and the blueprint keeps it sealed until the end of the run.",
        }

    return view


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------


def build(state: dict) -> dict[str, Any]:
    """The complete render payload for one player."""
    deal_id = state["deal"]["id"] or content.FIRST_DEAL_ID
    deal = content.get_deal(deal_id)

    if state["stage"] == "welcome":
        view = _welcome_view(state)
    elif state["stage"] == "brief":
        view = _brief_view(state)
    else:
        view = _prism_view(state, deal)

    return {
        "stage": state["stage"],
        "topbar": _topbar(state),
        "chips": _chips(state),
        "companion": _companion(state, deal),
        "rail": _rail(state, deal),
        "view": view,
    }
