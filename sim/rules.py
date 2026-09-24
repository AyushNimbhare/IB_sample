"""The rules engine — the single authority for this simulation.

The browser sends an action *name* and a small payload. It never sends a
result. Everything that decides anything happens here:

  * which step a player is allowed to reach
  * whether a quiz answer was right, and what it scores
  * which metric is the correct one
  * what the fair range is
  * whether a call is complete enough to lock

The consequences matter. The answer key is never serialised to the client
before the player has answered, the fair range is never sent before they
have picked the right metric, and the right call never leaves the server at
all. A player who edits the page cannot award themselves points, because
points are computed here and stored here.
"""

from __future__ import annotations

from typing import Any

from . import content, state as state_mod


class ActionError(Exception):
    """An action that is not allowed from the current state.

    Raised rather than ignored so that a client bug or a tampered request
    surfaces instead of silently doing nothing.
    """


# ---------------------------------------------------------------------------
# Domain derivations
# ---------------------------------------------------------------------------


def fair_range(deal: dict) -> tuple[float, float]:
    """The range the comparables imply.

    Derived, never stored: the low end is the cheapest comparable times the
    user base, the high end the dearest. Because it is computed from the same
    two inputs the screen shows, the numbers on screen cannot disagree with
    the numbers being scored.
    """
    task = deal["task"]
    values = [p["value"] for p in task["per_user"]]
    users = task["users_m"]
    return min(values) * users, max(values) * users


def price_in_range(state: dict, deal: dict) -> bool:
    low, high = fair_range(deal)
    price = state["deal"]["price_m"]
    return price is not None and low <= price <= high


def call_is_complete(state: dict, deal: dict) -> bool:
    """Whether the call screen has enough to move on.

    A walk-away needs no price and no protection. Anything else needs a price
    and at least one protection, because "go with protection" without naming
    a protection is not a call.
    """
    deal_state = state["deal"]
    choice = deal_state["choice"]
    if not choice:
        return False
    if not deal_state["reason"]:
        return False
    if choice == "walk":
        return True
    return bool(deal_state["protections"])


def points_breakdown(state: dict) -> dict[str, Any]:
    """The scoring, spelled out. Used by the receipt and the report."""
    briefing = content.BRIEFING
    correct = sum(1 for a in state["answers"].values() if a.get("correct"))
    return {
        "questions_correct": correct,
        "questions_total": len(briefing["questions"]),
        "points_per_question": briefing["points_per_question"],
        "points": state["points"],
        "points_possible": len(briefing["questions"]) * briefing["points_per_question"],
    }


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------


def _known_ids(items: list[dict]) -> set[str]:
    return {item["id"] for item in items}


def _terminal_texts(deal: dict) -> set[str]:
    """Every string a player is allowed to save as evidence.

    Membership is checked on save. Without this, a tampered client could push
    arbitrary text into the evidence tray and have it reappear on the report.
    """
    texts: set[str] = set()
    for page in deal["terminal"]["pages"]:
        for item in page.get("items", []):
            texts.add(item["text"])
    return texts


# ---------------------------------------------------------------------------
# Action handlers
#
# Each handler mutates `state` in place and returns a list of event messages
# for the client to show as toasts. They raise ActionError when the action is
# not permitted.
# ---------------------------------------------------------------------------


def _welcome_next(state: dict, payload: dict, deal: dict) -> list[str]:
    sub = state["w_sub"]
    if sub == "title":
        state["w_sub"] = "identity"
    elif sub == "identity":
        raise ActionError("the identity screen commits through welcome.identity.submit")
    elif sub == "role":
        state["w_sub"] = "desk"
    elif sub == "desk":
        raise ActionError("the desk screen advances through brief.open")
    else:
        raise ActionError(f"unknown welcome screen {sub!r}")
    return []


def _welcome_identity_submit(state: dict, payload: dict, deal: dict) -> list[str]:
    if state["w_sub"] != "identity":
        raise ActionError("not on the identity screen")

    name = str(payload.get("name", "")).strip()
    nda = bool(payload.get("nda"))
    guidance = payload.get("guidance", state["guidance"])

    # Both conditions are enforced here, not in the browser. The Continue
    # button being disabled is a courtesy; this is the rule.
    if not name:
        raise ActionError("a name is required")
    if len(name) > 40:
        raise ActionError("that name is too long (40 characters maximum)")
    if not nda:
        raise ActionError("the confidentiality note has to be signed")

    state["name"] = name
    state["nda"] = nda
    state["guidance"] = guidance if guidance in ("normal", "less") else "normal"
    state["w_sub"] = "role"
    return []


def _welcome_tutorial(state: dict, payload: dict, deal: dict) -> list[str]:
    state["tutorial"] = not state["tutorial"]
    return []


def _guidance_set(state: dict, payload: dict, deal: dict) -> list[str]:
    mode = payload.get("mode")
    if mode not in ("normal", "less"):
        raise ActionError(f"unknown guidance mode {mode!r}")
    state["guidance"] = mode
    return []


def _brief_open(state: dict, payload: dict, deal: dict) -> list[str]:
    # The briefing room opens from the desk, and only once the player has
    # signed in. Without these two checks the entire welcome stage is
    # skippable by sending one action name — which is exactly the kind of
    # thing a curious reviewer will try.
    if not state["name"] or not state["nda"]:
        raise ActionError("sign the confidentiality note before entering the briefing room")
    if state["w_sub"] != "desk":
        raise ActionError("the briefing room opens from the desk")

    state["stage"] = "brief"
    return []


def _brief_open_word(state: dict, payload: dict, deal: dict) -> list[str]:
    word_id = payload.get("word_id")
    if content.word_by_id(word_id) is None:
        raise ActionError(f"no such word {word_id!r}")
    opened = state["words_opened"]
    if word_id in opened:
        opened.remove(word_id)
    else:
        opened.append(word_id)
    return []


def _brief_reveal_all(state: dict, payload: dict, deal: dict) -> list[str]:
    state["words_opened"] = [w["id"] for w in content.BRIEFING["words"]]
    return ["All six words opened."]


def _brief_start_quiz(state: dict, payload: dict, deal: dict) -> list[str]:
    if len(state["words_opened"]) < len(content.BRIEFING["words"]):
        raise ActionError("open all six word cards first")
    state["b_sub"] = "quiz"
    return []


def _brief_answer(state: dict, payload: dict, deal: dict) -> list[str]:
    question = content.question_at(state["q_index"])
    if question is None:
        raise ActionError("there is no question at this position")

    qid = question["id"]
    if qid in state["answers"]:
        raise ActionError("that question has already been answered")

    picked = payload.get("index")
    if not isinstance(picked, int) or not 0 <= picked < len(question["options"]):
        raise ActionError(f"{picked!r} is not an option on this question")

    # The correctness check happens here. The client was never told the answer.
    correct = picked == question["answer"]
    state["answers"][qid] = {"picked": picked, "correct": correct}

    if correct:
        awarded = content.BRIEFING["points_per_question"]
        state["points"] += awarded
        return [f"Correct. +{awarded} points."]
    return ["Not quite — read the explanation."]


def _brief_next_question(state: dict, payload: dict, deal: dict) -> list[str]:
    question = content.question_at(state["q_index"])
    if question is None:
        raise ActionError("there is no question at this position")
    if question["id"] not in state["answers"]:
        raise ActionError("answer this question before moving on")

    if state["q_index"] < len(content.BRIEFING["questions"]) - 1:
        state["q_index"] += 1
        return []

    state["b_sub"] = "dealbook"
    state["brief_done"] = True
    return []


def _deal_open(state: dict, payload: dict, deal: dict) -> list[str]:
    deal_id = payload.get("deal_id", content.FIRST_DEAL_ID)

    # Checked before get_deal, which raises ContentError — an error about the
    # build, not about the request. A bad id from a client is the latter.
    if deal_id not in content.DEALS:
        raise ActionError(f"no such deal {deal_id!r}")
    opened = content.get_deal(deal_id)

    if not state["brief_done"]:
        raise ActionError("finish the briefing room before opening a deal")
    if deal_id != content.FIRST_DEAL_ID:
        raise ActionError(f"{opened['code']} is not part of this sample")

    state["stage"] = "prism"
    state["deal"]["id"] = deal_id
    state["deal"]["step"] = "brief"
    state["deal"]["price_m"] = opened["task"]["default_price_m"]
    state_mod.start_clock(state)
    return []


def _deal_step(state: dict, payload: dict, deal: dict) -> list[str]:
    target = payload.get("step")
    allowed = {"brief", "research", "task", "call", "review"}
    if target not in allowed:
        # 'receipt' is deliberately absent: the only route there is deal.lock.
        raise ActionError(f"{target!r} is not a step you can navigate to")

    order = ["brief", "research", "task", "call", "review"]
    current = state["deal"]["step"]
    if current in order and order.index(target) > order.index(current):
        if target in ("call", "review") and not state["deal"]["metric_right"]:
            raise ActionError("pick the metric that matters before making the call")
        if target == "review" and not call_is_complete(state, deal):
            raise ActionError("the call is not complete yet")

    state["deal"]["step"] = target
    return []


def _deal_tab(state: dict, payload: dict, deal: dict) -> list[str]:
    page_id = payload.get("page")
    if page_id not in _known_ids(deal["terminal"]["pages"]):
        raise ActionError(f"no such terminal page {page_id!r}")
    state["deal"]["active_page"] = page_id
    if page_id not in state["deal"]["seen"]:
        state["deal"]["seen"].append(page_id)
    return []


def _deal_save_evidence(state: dict, payload: dict, deal: dict) -> list[str]:
    text = payload.get("text")
    kind = payload.get("kind")

    if kind not in ("fact", "risk"):
        raise ActionError(f"evidence kind must be 'fact' or 'risk', got {kind!r}")
    if text not in _terminal_texts(deal):
        raise ActionError("that text is not part of this deal's research")

    tray = state["deal"]["tray"]
    if any(item["text"] == text for item in tray):
        raise ActionError("that is already in the tray")

    tray.append({"kind": kind, "text": text})
    return [f"Saved to the evidence tray as a {kind}."]


def _deal_pick_metric(state: dict, payload: dict, deal: dict) -> list[str]:
    if state["deal"]["metric_right"]:
        raise ActionError("the metric is already chosen")

    metric_id = payload.get("metric_id")
    if metric_id not in _known_ids(deal["task"]["metrics"]):
        raise ActionError(f"no such metric {metric_id!r}")

    # A wrong pick is recorded and released, so the player can retry. Locking
    # on the first pick — right or wrong — would strand them on this step with
    # no route to the call.
    state["deal"]["metric"] = metric_id
    state["deal"]["metric_right"] = metric_id == deal["task"]["correct_metric"]

    if state["deal"]["metric_right"]:
        return ["That is the one. Range built from the comparables."]
    return []


def _deal_pick_call(state: dict, payload: dict, deal: dict) -> list[str]:
    if state["deal"]["locked"]:
        raise ActionError("this call is locked")

    choice_id = payload.get("choice_id")
    if choice_id not in _known_ids(deal["call"]["choices"]):
        raise ActionError(f"no such call {choice_id!r}")

    state["deal"]["choice"] = choice_id
    if choice_id == "walk":
        # Walking away carries no protection: there is nothing to protect.
        state["deal"]["protections"] = []
    return []


def _deal_toggle_protection(state: dict, payload: dict, deal: dict) -> list[str]:
    if state["deal"]["locked"]:
        raise ActionError("this call is locked")
    if state["deal"]["choice"] != "protect":
        raise ActionError("protections only apply to a go-with-protection call")

    protection_id = payload.get("protection_id")
    if protection_id not in _known_ids(deal["call"]["protections"]):
        raise ActionError(f"no such protection {protection_id!r}")

    protections = state["deal"]["protections"]
    if protection_id in protections:
        protections.remove(protection_id)
    else:
        protections.append(protection_id)
    return []


def _deal_price(state: dict, payload: dict, deal: dict) -> list[str]:
    if state["deal"]["locked"]:
        raise ActionError("this call is locked")
    if state["deal"]["choice"] in (None, "walk"):
        raise ActionError("choose a call before setting a price")

    delta = payload.get("delta")
    if not isinstance(delta, (int, float)):
        raise ActionError("price delta must be a number")

    task = deal["task"]
    # Clamped here, so a tampered client cannot push the price outside the
    # range the slider is drawn over.
    new_price = (state["deal"]["price_m"] or task["default_price_m"]) + delta
    state["deal"]["price_m"] = max(task["price_min_m"], min(task["price_max_m"], new_price))
    return []


def _deal_pick_reason(state: dict, payload: dict, deal: dict) -> list[str]:
    if state["deal"]["locked"]:
        raise ActionError("this call is locked")

    reason_id = payload.get("reason_id")
    if reason_id not in _known_ids(deal["call"]["reasons"]):
        raise ActionError(f"no such reason {reason_id!r}")
    state["deal"]["reason"] = reason_id
    return []


def _deal_note(state: dict, payload: dict, deal: dict) -> list[str]:
    if state["deal"]["locked"]:
        raise ActionError("this call is locked")
    note = str(payload.get("text", ""))
    state["deal"]["note"] = note[: deal["call"]["note_max"]]
    return []


def _deal_lock(state: dict, payload: dict, deal: dict) -> list[str]:
    if state["deal"]["locked"]:
        raise ActionError("this call is already locked")
    if state["deal"]["step"] != "review":
        raise ActionError("review the call before locking it")
    if not call_is_complete(state, deal):
        raise ActionError("the call is not complete")

    state["deal"]["locked"] = True
    state["deal"]["step"] = "receipt"
    return [f"Call locked. {deal['code']} is on the record."]


def _restart(state: dict, payload: dict, deal: dict) -> list[str]:
    fresh = state_mod.blank_state()
    state.clear()
    state.update(fresh)
    return []


_HANDLERS = {
    "welcome.next": _welcome_next,
    "welcome.identity.submit": _welcome_identity_submit,
    "welcome.tutorial": _welcome_tutorial,
    "guidance.set": _guidance_set,
    "brief.open": _brief_open,
    "brief.open_word": _brief_open_word,
    "brief.reveal_all": _brief_reveal_all,
    "brief.start_quiz": _brief_start_quiz,
    "brief.answer": _brief_answer,
    "brief.next_question": _brief_next_question,
    "deal.open": _deal_open,
    "deal.step": _deal_step,
    "deal.tab": _deal_tab,
    "deal.save_evidence": _deal_save_evidence,
    "deal.pick_metric": _deal_pick_metric,
    "deal.pick_call": _deal_pick_call,
    "deal.toggle_protection": _deal_toggle_protection,
    "deal.price": _deal_price,
    "deal.pick_reason": _deal_pick_reason,
    "deal.note": _deal_note,
    "deal.lock": _deal_lock,
    "restart": _restart,
}


def known_actions() -> list[str]:
    return sorted(_HANDLERS)


def apply_action(state: dict, action: str, payload: dict | None = None) -> list[str]:
    """Apply one action to `state` in place. Returns event messages.

    Raises ActionError if the action is unknown or not permitted from here.
    """
    handler = _HANDLERS.get(action)
    if handler is None:
        raise ActionError(f"unknown action {action!r}")

    deal_id = state.get("deal", {}).get("id")
    deal = content.get_deal(deal_id) if deal_id else content.get_deal(content.FIRST_DEAL_ID)

    return handler(state, payload or {}, deal)
