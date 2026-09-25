"""Content loading and validation.

This build ships one content file — the briefing — and it is data with no logic
in it. This module is the only place that knows how to read it, and it validates
the whole shape at import time, so a malformed file fails loudly when the server
starts rather than quietly halfway through a player's run.

The same idea carries further in the full programme, where each deal is one data
file: brief, terminal pages, documents, options, scoring rules, outcome, so a new
deal can be added without code changes. A loader that did exactly that lived here
until the build was cut back to three stages; it is in the git history under the
tag `with-prism-v1`.
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
        (
            "stage_lede", "stage_hint", "points_per_question", "words", "questions",
            "deal_book", "deal_book_lede", "deal_book_hint", "deal_book_footer",
            "deal_book_close",
        ),
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

    # The deal book is the last screen of this sample, so its shape matters:
    # five mandates, exactly one of them open. `code` doubles as the codename
    # shown on the identity screen, which is why it has to be unique.
    deal_book = data["deal_book"]
    _require(isinstance(deal_book, list) and deal_book, where, "'deal_book' must be non-empty")
    for deal in deal_book:
        _require_keys(deal, ("code", "sector", "year", "status", "note"), f"{where} deal_book entry")
        _require(
            deal["status"] in ("open", "locked"),
            f"{where} deal_book entry {deal.get('code', '?')}",
            f"status is {deal['status']!r}, expected 'open' or 'locked'",
        )
    codes = [d["code"] for d in deal_book]
    _require(len(set(codes)) == len(codes), where, f"duplicate mandate codenames in {codes}")
    open_deals = [d for d in deal_book if d["status"] == "open"]
    _require(
        len(open_deals) == 1,
        where,
        f"exactly one mandate must be open on the desk, found {len(open_deals)}",
    )

    return data


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------

BRIEFING: dict = _validate_briefing(_read_json("briefing.json"))


def word_by_id(word_id: str) -> dict | None:
    return next((w for w in BRIEFING["words"] if w["id"] == word_id), None)


def question_at(index: int) -> dict | None:
    questions = BRIEFING["questions"]
    if 0 <= index < len(questions):
        return questions[index]
    return None
