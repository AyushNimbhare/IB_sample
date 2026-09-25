"""The rules engine — the single authority for this simulation.

The browser sends an action *name* and a small payload. It never sends a
result. Everything that decides anything happens here:

  * which screen a player is allowed to reach
  * whether a quiz answer was right, and what it scores
  * when the run clock starts

The consequences matter. The answer key is never serialised to the client
before the player has answered, and the score is computed here and stored
here, so a player who edits the page cannot award themselves points.

This sample implements the first three stages: Welcome, Briefing Room and
Deal Book. The deal handlers — research, the metric pick, the fair range, the
call, the receipt — were removed along with the Prism stage. They are in the
git history under the tag `with-prism-v1`.
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


def points_breakdown(state: dict) -> dict[str, Any]:
    """The scoring, spelled out. Shown on the Deal Book's closing summary."""
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
# Action handlers
#
# Each handler mutates `state` in place and returns a list of event messages
# for the client to show as toasts. They raise ActionError when the action is
# not permitted.
# ---------------------------------------------------------------------------


def _welcome_next(state: dict, payload: dict) -> list[str]:
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


def _welcome_identity_submit(state: dict, payload: dict) -> list[str]:
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

    # The run clock starts when the analyst signs in, not when they reach the
    # desk: the identity screen is the first thing that takes them any time.
    state_mod.start_clock(state)
    return []


def _welcome_tutorial(state: dict, payload: dict) -> list[str]:
    state["tutorial"] = not state["tutorial"]
    return []


def _guidance_set(state: dict, payload: dict) -> list[str]:
    mode = payload.get("mode")
    if mode not in ("normal", "less"):
        raise ActionError(f"unknown guidance mode {mode!r}")
    state["guidance"] = mode
    return []


def _require_brief_screen(state: dict, *screens: str) -> None:
    """The briefing actions only mean anything inside the briefing room.

    Without this, a tampered client could keep toggling word cards or
    re-firing the quiz from the Deal Book, where neither has a button.
    """
    if state["stage"] != "brief" or state["b_sub"] not in screens:
        raise ActionError("the briefing room is not open on that screen")


def _brief_open(state: dict, payload: dict) -> list[str]:
    # The briefing room opens from the desk, and only once the player has
    # signed in. Without these two checks the entire welcome stage is
    # skippable by sending one action name — which is exactly the kind of
    # thing a curious reviewer will try.
    if not state["name"] or not state["nda"]:
        raise ActionError("sign the confidentiality note before entering the briefing room")
    # The stage check is load-bearing: `w_sub` stays on "desk" for the rest of
    # the run, so without it a second brief.open would succeed from inside the
    # briefing room and reset b_sub, wiping the quiz progress behind it.
    if state["stage"] != "welcome" or state["w_sub"] != "desk":
        raise ActionError("the briefing room opens from the desk")

    state["stage"] = "brief"
    state["b_sub"] = "briefing"
    return []


def _brief_open_word(state: dict, payload: dict) -> list[str]:
    _require_brief_screen(state, "briefing")
    word_id = payload.get("word_id")
    if content.word_by_id(word_id) is None:
        raise ActionError(f"no such word {word_id!r}")
    opened = state["words_opened"]
    if word_id in opened:
        opened.remove(word_id)
    else:
        opened.append(word_id)
    return []


def _brief_reveal_all(state: dict, payload: dict) -> list[str]:
    _require_brief_screen(state, "briefing")
    state["words_opened"] = [w["id"] for w in content.BRIEFING["words"]]
    return ["All six words opened."]


def _brief_start_quiz(state: dict, payload: dict) -> list[str]:
    _require_brief_screen(state, "briefing")
    if len(state["words_opened"]) < len(content.BRIEFING["words"]):
        raise ActionError("open all six word cards first")
    state["b_sub"] = "quiz"
    return []


def _brief_answer(state: dict, payload: dict) -> list[str]:
    _require_brief_screen(state, "quiz")
    question = content.question_at(state["q_index"])
    if question is None:
        raise ActionError("there is no question at this position")

    qid = question["id"]
    if qid in state["answers"]:
        raise ActionError("that question has already been answered")

    picked = payload.get("index")
    if not isinstance(picked, int) or isinstance(picked, bool) or not 0 <= picked < len(question["options"]):
        raise ActionError(f"{picked!r} is not an option on this question")

    # The correctness check happens here. The client was never told the answer.
    correct = picked == question["answer"]
    state["answers"][qid] = {"picked": picked, "correct": correct}

    if correct:
        awarded = content.BRIEFING["points_per_question"]
        state["points"] += awarded
        return [f"Correct. +{awarded} points."]
    return ["Not quite — read the explanation."]


def _brief_next_question(state: dict, payload: dict) -> list[str]:
    _require_brief_screen(state, "quiz")
    question = content.question_at(state["q_index"])
    if question is None:
        raise ActionError("there is no question at this position")
    if question["id"] not in state["answers"]:
        raise ActionError("answer this question before moving on")

    if state["q_index"] < len(content.BRIEFING["questions"]) - 1:
        state["q_index"] += 1
        return []

    # The last question hands the player their desk. The Deal Book is a stage
    # in its own right rather than a screen of the briefing room, so the stage
    # moves — which is what lights chip 3 in the rail and leaves chip 2 done.
    state["stage"] = "dealbook"
    state["brief_done"] = True
    return ["Briefing complete. Five mandates on your desk."]


def _restart(state: dict, payload: dict) -> list[str]:
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
    return handler(state, payload or {})
