"""Content loading and validation.

Every deal is one JSON file with no logic in it. This module is the only
place that knows how to read them, and it validates the whole shape at
import time — so a malformed deal fails loudly when the server starts
rather than quietly halfway through a player's run.

Blueprint p19: "Each deal is one data file: brief, terminal pages,
documents, options, scoring rules, outcome. New deals can be added later
without code changes."
"""

from __future__ import annotations

import json
import pathlib

CONTENT_DIR = pathlib.Path(__file__).resolve().parent.parent / "content"


class ContentError(Exception):
    """Raised when a content file is missing, malformed or inconsistent."""


# ---------------------------------------------------------------------------
# Small assertion helpers. Each one names the file and the exact field, because
# "KeyError: 'answer'" at 2am tells you nothing.
# ---------------------------------------------------------------------------


def _require(condition: bool, where: str, message: str) -> None:
    if not condition:
        raise ContentError(f"{where}: {message}")


def _require_keys(obj: dict, keys: tuple[str, ...], where: str) -> None:
    _require(isinstance(obj, dict), where, f"expected an object, got {type(obj).__name__}")
    missing = [k for k in keys if k not in obj]
    _require(not missing, where, f"missing required key(s): {', '.join(missing)}")


def _require_unique_ids(items: list[dict], where: str) -> None:
    seen: set[str] = set()
    for item in items:
        item_id = item.get("id")
        _require(bool(item_id), where, "an entry has no 'id'")
        _require(item_id not in seen, where, f"duplicate id {item_id!r}")
        seen.add(item_id)


def _read_json(name: str) -> dict:
    path = CONTENT_DIR / name
    if not path.exists():
        raise ContentError(f"{path} does not exist")
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        raise ContentError(f"{path} is not valid JSON: {exc}") from exc


# ---------------------------------------------------------------------------
# Briefing
# ---------------------------------------------------------------------------


def _validate_briefing(data: dict) -> dict:
    where = "briefing.json"
    _require_keys(
        data,
        ("stage_lede", "stage_hint", "points_per_question", "words", "questions", "deal_book"),
        where,
    )

    words = data["words"]
    _require(isinstance(words, list) and words, where, "'words' must be a non-empty list")
    for word in words:
        _require_keys(word, ("id", "word", "meaning", "example", "where"), f"{where} word")
    _require_unique_ids(words, f"{where} words")

    questions = data["questions"]
    _require(isinstance(questions, list) and questions, where, "'questions' must be a non-empty list")
    for question in questions:
        q_where = f"{where} question {question.get('id', '?')}"
        _require_keys(question, ("id", "prompt", "options", "answer", "why"), q_where)
        options = question["options"]
        _require(
            isinstance(options, list) and len(options) >= 2,
            q_where,
            "'options' needs at least two entries",
        )
        answer = question["answer"]
        _require(
            isinstance(answer, int) and 0 <= answer < len(options),
            q_where,
            f"'answer' is {answer!r}, which is not an index into {len(options)} options",
        )
    _require_unique_ids(questions, f"{where} questions")

    deal_book = data["deal_book"]
    _require(isinstance(deal_book, list) and deal_book, where, "'deal_book' must be non-empty")
    for deal in deal_book:
        _require_keys(deal, ("code", "sector", "year", "status", "note"), f"{where} deal_book entry")
    open_deals = [d for d in deal_book if d["status"] == "open"]
    _require(
        len(open_deals) == 1,
        where,
        f"exactly one deal must be open in this sample, found {len(open_deals)}",
    )

    return data


# ---------------------------------------------------------------------------
# Deal
# ---------------------------------------------------------------------------


def _validate_deal(data: dict) -> dict:
    where = f"{data.get('id', 'deal')}.json"
    _require_keys(
        data,
        ("id", "code", "sector", "year", "brief", "terminal", "task", "call", "receipt", "companion"),
        where,
    )

    _require_keys(
        data["brief"],
        ("headline", "body", "client_line", "mood_label", "mood_line"),
        f"{where} brief",
    )

    terminal = data["terminal"]
    _require_keys(terminal, ("lede", "address", "pages"), f"{where} terminal")
    pages = terminal["pages"]
    _require(isinstance(pages, list) and pages, where, "'terminal.pages' must be non-empty")
    _require_unique_ids(pages, f"{where} terminal pages")

    task = data["task"]
    _require_keys(
        task,
        (
            "prompt", "hint", "metrics", "correct_metric", "per_user", "users_m",
            "default_price_m", "price_step_m", "price_min_m", "price_max_m",
        ),
        f"{where} task",
    )
    _require_unique_ids(task["metrics"], f"{where} task metrics")
    metric_ids = {m["id"] for m in task["metrics"]}
    _require(
        task["correct_metric"] in metric_ids,
        f"{where} task",
        f"correct_metric {task['correct_metric']!r} is not one of the metrics {sorted(metric_ids)}",
    )

    per_user = task["per_user"]
    _require(
        isinstance(per_user, list) and len(per_user) >= 2,
        f"{where} task",
        "'per_user' needs at least two comparables to form a range",
    )
    _require_unique_ids(per_user, f"{where} per_user")
    _require(
        all(isinstance(p.get("value"), (int, float)) and p["value"] > 0 for p in per_user),
        f"{where} task",
        "every per_user value must be a positive number",
    )

    low, high = task["price_min_m"], task["price_max_m"]
    default = task["default_price_m"]
    _require(low < high, f"{where} task", f"price_min_m ({low}) must be below price_max_m ({high})")
    _require(
        low <= default <= high,
        f"{where} task",
        f"default_price_m ({default}) must sit between {low} and {high}",
    )
    _require(task["price_step_m"] > 0, f"{where} task", "price_step_m must be positive")

    # The range the comparables imply must be reachable inside the slider bounds,
    # or the band would render partly off the track.
    range_low = min(p["value"] for p in per_user) * task["users_m"]
    range_high = max(p["value"] for p in per_user) * task["users_m"]
    _require(
        low <= range_low and range_high <= high,
        f"{where} task",
        f"the implied fair range {range_low:g}–{range_high:g} falls outside the slider "
        f"bounds {low}–{high}, so the band would be clipped",
    )

    call = data["call"]
    _require_keys(
        call,
        ("prompt", "hint", "choices", "protections", "reasons", "price_label", "reason_label"),
        f"{where} call",
    )
    _require_unique_ids(call["choices"], f"{where} call choices")
    _require_unique_ids(call["protections"], f"{where} protections")
    _require_unique_ids(call["reasons"], f"{where} reasons")

    choice_ids = {c["id"] for c in call["choices"]}
    _require(
        {"go", "protect", "walk"} <= choice_ids,
        f"{where} call",
        f"the three calls go/protect/walk must all exist, found {sorted(choice_ids)}",
    )

    _require_keys(data["receipt"], ("stamp", "line", "detail"), f"{where} receipt")
    _require_keys(
        data["companion"],
        ("brief", "research", "task", "call", "receipt"),
        f"{where} companion",
    )

    return data


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------

BRIEFING: dict = _validate_briefing(_read_json("briefing.json"))

_DEAL_FILES = ("prism.json",)
DEALS: dict[str, dict] = {deal["id"]: deal for deal in (_validate_deal(_read_json(f)) for f in _DEAL_FILES)}

# The one deal this sample opens. A fuller build would resolve this from
# progress rather than hard-coding it.
FIRST_DEAL_ID = "prism"


def get_deal(deal_id: str) -> dict:
    try:
        return DEALS[deal_id]
    except KeyError:
        raise ContentError(
            f"no deal {deal_id!r}; this build ships {sorted(DEALS)}"
        ) from None


def word_by_id(word_id: str) -> dict | None:
    return next((w for w in BRIEFING["words"] if w["id"] == word_id), None)


def question_at(index: int) -> dict | None:
    questions = BRIEFING["questions"]
    if 0 <= index < len(questions):
        return questions[index]
    return None
