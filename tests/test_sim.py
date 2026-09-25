"""Tests for the simulation's rules engine and its privacy boundary.

These run against Flask's test client, so they need no server, no port and
no network. Run them with:

    python -m unittest discover -s tests -v

Most of what follows is a gate: the simulation refuses to move until the
player has done the thing that earns the move. The interesting part is
TestPrivacy, which asserts the claim the whole architecture exists to
support — that a player who reads every byte the browser receives still
does not know the answer.

The sample covers three stages: Welcome, Briefing Room and Deal Book. The
deal stages were cut, so the deal gates went with them; what is left is the
whole of what ships.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402
from sim import content, rules, state as state_mod  # noqa: E402

BRIEFING = content.BRIEFING
QUESTIONS = BRIEFING["questions"]
QUESTION_COUNT = len(QUESTIONS)
WORDS = BRIEFING["words"]
DEAL_BOOK = BRIEFING["deal_book"]

BUILT_ACTIONS = [
    "brief.answer",
    "brief.next_question",
    "brief.open",
    "brief.open_word",
    "brief.reveal_all",
    "brief.start_quiz",
    "guidance.set",
    "restart",
    "welcome.identity.submit",
    "welcome.next",
    "welcome.tutorial",
]

# Exactly the fields the desk is allowed to show for a mandate.
MANDATE_KEYS = {"code", "sector", "year", "status", "note", "open"}


def _all_keys(node):
    """Every key name anywhere in a payload, at any depth."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from _all_keys(value)
    elif isinstance(node, list):
        for item in node:
            yield from _all_keys(item)


class Base(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.c = app.test_client()

    # -- plumbing ---------------------------------------------------------

    def state(self) -> dict:
        r = self.c.get("/api/state")
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        return r.get_json()["state"]

    def view(self) -> dict:
        return self.state()["view"]

    def raw(self, path: str = "/api/state") -> str:
        """The response body as bytes-as-text, with the handle closed.

        Closing matters for the static-file routes: werkzeug keeps the file
        open until the response is closed, so skipping this makes the suite
        print ResourceWarnings that look like a leak and are not one.
        """
        r = self.c.get(path)
        try:
            return r.get_data(as_text=True)
        finally:
            r.close()

    def act(self, action: str, payload: dict | None = None):
        r = self.c.post("/api/action", json={"action": action, "payload": payload or {}})
        return r.status_code, r.get_json()

    def ok(self, action: str, payload: dict | None = None) -> dict:
        code, body = self.act(action, payload)
        self.assertEqual(code, 200, f"{action} was refused: {body}")
        return body

    def denied(self, action: str, payload: dict | None = None) -> dict:
        code, body = self.act(action, payload)
        self.assertEqual(code, 409, f"{action} should have been refused, got {code}: {body}")
        return body

    # -- journeys ---------------------------------------------------------

    def sign_in(self):
        self.ok("welcome.next")
        self.ok("welcome.identity.submit", {"name": "A. Nimbhare", "nda": True})

    def reach_desk(self):
        self.sign_in()
        self.ok("welcome.next")

    def reach_brief(self):
        self.reach_desk()
        self.ok("brief.open")

    def reach_quiz(self):
        self.reach_brief()
        self.ok("brief.reveal_all")
        self.ok("brief.start_quiz")

    def answer_all(self, wrong_first: bool = False):
        """Answer everything. The last next_question hands over the desk."""
        for i in range(QUESTION_COUNT):
            q = QUESTIONS[i]
            pick = q["answer"]
            if wrong_first and i == 0:
                pick = (q["answer"] + 1) % len(q["options"])
            self.ok("brief.answer", {"index": pick})
            self.ok("brief.next_question")

    def reach_dealbook(self):
        self.reach_quiz()
        self.answer_all()


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------


class TestContent(Base):
    """The data file is the content. These check it says what it must."""

    def test_the_answer_index_points_at_a_real_option(self):
        for q in QUESTIONS:
            self.assertTrue(0 <= q["answer"] < len(q["options"]),
                            f"{q['id']}: answer {q['answer']} is outside {len(q['options'])} options")

    def test_every_question_explains_itself(self):
        for q in QUESTIONS:
            self.assertTrue(q["why"].strip(), f"{q['id']} has no explanation")

    def test_the_desk_has_exactly_one_open_mandate(self):
        self.assertEqual(len([d for d in DEAL_BOOK if d["status"] == "open"]), 1)
        self.assertEqual(len(DEAL_BOOK), 5)

    def test_mandate_codenames_are_unique(self):
        codes = [d["code"] for d in DEAL_BOOK]
        self.assertEqual(len(set(codes)), len(codes))

    def test_the_run_ends_with_a_closing_line(self):
        self.assertTrue(BRIEFING["deal_book_close"].strip())


# ---------------------------------------------------------------------------
# Stage gates
# ---------------------------------------------------------------------------


class TestWelcomeGate(Base):
    def test_starts_on_the_title_screen(self):
        v = self.view()
        self.assertEqual(self.state()["stage"], "welcome")
        self.assertEqual(v["screen"], "title")

    def test_identity_needs_a_name(self):
        self.ok("welcome.next")
        self.assertIn("name", self.denied("welcome.identity.submit",
                                          {"name": "   ", "nda": True})["error"])

    def test_identity_needs_the_nda(self):
        self.ok("welcome.next")
        self.assertIn("confidentiality",
                      self.denied("welcome.identity.submit",
                                  {"name": "A", "nda": False})["error"])

    def test_a_refused_action_leaves_the_state_untouched(self):
        self.ok("welcome.next")
        self.denied("welcome.identity.submit", {"name": "", "nda": True})
        self.assertEqual(self.view()["screen"], "identity")

    def test_an_overlong_name_is_refused(self):
        self.ok("welcome.next")
        self.denied("welcome.identity.submit", {"name": "x" * 41, "nda": True})

    def test_the_identity_screen_cannot_be_skipped(self):
        self.ok("welcome.next")       # title -> identity
        self.denied("welcome.next")   # identity commits through submit, not next

    def test_the_briefing_room_cannot_be_entered_without_signing(self):
        """Regression: `brief.open` used to skip the whole welcome stage.

        One action name from the title screen moved the player straight into
        the briefing room, past the name and the confidentiality note.
        """
        self.denied("brief.open")

        self.ok("welcome.next")       # -> identity
        self.denied("brief.open")     # still unsigned

        self.ok("welcome.identity.submit", {"name": "A. Nimbhare", "nda": True})
        self.denied("brief.open")     # signed, but not at the desk yet

        self.ok("welcome.next")       # role -> desk
        self.ok("brief.open")         # now it opens
        self.assertEqual(self.state()["stage"], "brief")

    def test_the_briefing_room_cannot_be_reopened(self):
        """Regression: `w_sub` stays on "desk" for the whole run.

        So `brief.open` still looked legal from inside the briefing room, and
        a replay reset b_sub to "briefing" — wiping the quiz behind it.
        """
        self.reach_brief()
        self.ok("brief.reveal_all")
        self.ok("brief.start_quiz")

        self.denied("brief.open")
        self.assertEqual(self.view()["screen"], "quiz", "the quiz was reset by a replay")

    def test_the_desk_cannot_be_left_without_opening_the_briefing_room(self):
        self.reach_desk()
        self.denied("welcome.next")

    def test_the_clock_starts_when_the_analyst_signs_in(self):
        self.assertEqual(self.state()["topbar"]["seconds_left"], state_mod.TOTAL_SECONDS)
        self.sign_in()
        left = self.state()["topbar"]["seconds_left"]
        self.assertLessEqual(left, state_mod.TOTAL_SECONDS)
        self.assertGreater(left, state_mod.TOTAL_SECONDS - 60)


class TestBriefingGate(Base):
    def test_the_quiz_needs_every_word_opened(self):
        self.reach_brief()
        self.assertIn("six", self.denied("brief.start_quiz")["error"])

    def test_a_question_cannot_be_answered_twice(self):
        self.reach_quiz()
        self.ok("brief.answer", {"index": QUESTIONS[0]["answer"]})
        self.denied("brief.answer", {"index": QUESTIONS[0]["answer"]})

    def test_an_out_of_range_answer_is_refused(self):
        self.reach_quiz()
        for bad in (99, -1, "0", None):
            self.denied("brief.answer", {"index": bad})

    def test_a_boolean_is_not_an_answer(self):
        """`True == 1` in Python, so an unchecked isinstance would score a
        client that sent `{"index": true}` on question 2."""
        self.reach_quiz()
        self.denied("brief.answer", {"index": True})
        self.denied("brief.answer", {"index": False})

    def test_the_next_question_needs_this_one_answered(self):
        self.reach_quiz()
        self.denied("brief.next_question")

    def test_an_unknown_word_card_is_refused(self):
        self.reach_brief()
        self.denied("brief.open_word", {"word_id": "not-a-word"})

    def test_word_cards_cannot_be_toggled_from_outside_the_briefing_room(self):
        self.reach_dealbook()
        self.denied("brief.open_word", {"word_id": WORDS[0]["id"]})
        self.denied("brief.reveal_all")
        self.denied("brief.start_quiz")

    def test_the_quiz_cannot_be_restarted_from_the_deal_book(self):
        self.reach_dealbook()
        self.denied("brief.answer", {"index": 0})
        self.denied("brief.next_question")


class TestDealBook(Base):
    def test_the_last_question_hands_over_the_desk(self):
        self.reach_quiz()
        for i, q in enumerate(QUESTIONS):
            self.ok("brief.answer", {"index": q["answer"]})
            self.ok("brief.next_question")
            expected = "dealbook" if i == QUESTION_COUNT - 1 else "brief"
            self.assertEqual(self.state()["stage"], expected,
                             f"stage after question {i + 1} was {self.state()['stage']}")

    def test_the_rail_shows_the_whole_programme(self):
        """The rail is eleven marks long: the shape of the run, not just its length.

        The first three are reachable. The other eight are locked, which is a
        different thing from upcoming — an upcoming stage is one the player is
        going to reach, a locked one is not open to them.
        """
        chips = {c["n"]: c["state"] for c in self.state()["chips"]}
        self.assertEqual(len(chips), 11, "the rail shows all eleven stages")
        self.assertEqual([chips[n] for n in (1, 2, 3)], ["active", "upcoming", "upcoming"])
        self.assertEqual({chips[n] for n in range(4, 12)}, {"locked"})

        self.reach_dealbook()
        chips = {c["n"]: c["state"] for c in self.state()["chips"]}
        self.assertEqual([chips[n] for n in (1, 2, 3)], ["done", "done", "active"])
        self.assertEqual({chips[n] for n in range(4, 12)}, {"locked"},
                         "finishing the desk must not unlock a later stage")

    def test_a_locked_stage_carries_nothing_to_play(self):
        """A locked chip is a number, a name and a padlock. Nothing else.

        No action, and no hint about what is behind it — the payload says no
        more about stage 4 than the shape of the rail does.
        """
        for chip in self.state()["chips"]:
            if chip["state"] != "locked":
                continue
            self.assertEqual(set(chip), {"n", "label", "state"},
                             f"locked chip {chip} carries extra fields")
            self.assertIn(chip["n"], range(4, 12))

        src = self.raw("/static/ib.js")
        # A locked chip must not be able to post anything. It is rendered as a
        # span with no data-action, and the client posts only what it finds.
        self.assertNotIn("data-action", src[src.index("function renderChips"):
                                            src.index("function renderCompanion")])

    def test_the_deal_book_lists_the_whole_desk(self):
        self.reach_dealbook()
        v = self.view()
        self.assertEqual(v["kind"], "dealbook")
        self.assertEqual(len(v["deals"]), len(DEAL_BOOK))
        self.assertEqual(len([d for d in v["deals"] if d["open"]]), 1)

    def test_the_deal_book_reports_the_run(self):
        self.reach_dealbook()
        v = self.view()
        labels = [row["label"] for row in v["summary"]]
        self.assertIn("Answers correct", labels)
        self.assertIn("Points", labels)
        self.assertEqual(dict((r["label"], r["value"]) for r in v["summary"])
                         ["Answers correct"], "4 of 4")

    def test_the_deal_book_is_terminal(self):
        self.reach_dealbook()
        for action, payload in (
            ("brief.open", {}),
            ("brief.open_word", {"word_id": WORDS[0]["id"]}),
            ("brief.reveal_all", {}),
            ("brief.start_quiz", {}),
            ("brief.answer", {"index": 0}),
            ("brief.next_question", {}),
            ("welcome.next", {}),
        ):
            self.denied(action, payload)
        self.assertEqual(self.state()["stage"], "dealbook")

    def test_restart_returns_to_the_title(self):
        self.reach_dealbook()
        self.ok("restart")
        state = self.state()
        self.assertEqual(state["stage"], "welcome")
        self.assertEqual(state["view"]["screen"], "title")
        self.assertEqual(state["topbar"]["points"], 0)

    def test_no_deal_actions_are_registered(self):
        """The Prism stage was cut, so nothing under `deal.` should remain."""
        self.assertEqual(rules.known_actions(), BUILT_ACTIONS)
        self.assertFalse([a for a in rules.known_actions() if a.startswith("deal.")])


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


class TestScoring(Base):
    def test_a_perfect_run_scores_every_point(self):
        self.reach_quiz()
        self.answer_all()
        expected = QUESTION_COUNT * BRIEFING["points_per_question"]
        self.assertEqual(self.state()["topbar"]["points"], expected)

    def test_a_wrong_answer_scores_nothing_but_still_explains(self):
        self.reach_quiz()
        q = QUESTIONS[0]
        wrong = (q["answer"] + 1) % len(q["options"])
        self.ok("brief.answer", {"index": wrong})

        v = self.view()
        self.assertEqual(self.state()["topbar"]["points"], 0)
        self.assertTrue(v["answered"])
        self.assertEqual(v["picked"], wrong)
        self.assertFalse(v["picked"] == v["correct_index"])
        # The explanation still arrives: a wrong answer teaches, it does not
        # dead-end the player.
        self.assertTrue(v["why"])

    def test_the_points_counter_cannot_be_edited_client_side(self):
        """The browser can only send an action name, never a score."""
        self.reach_quiz()
        code, _ = self.act("brief.answer",
                           {"index": QUESTIONS[0]["answer"], "points": 9999, "correct": True})
        self.assertEqual(code, 200)
        self.assertEqual(self.state()["topbar"]["points"],
                         BRIEFING["points_per_question"])


# ---------------------------------------------------------------------------
# The privacy boundary
# ---------------------------------------------------------------------------


class TestPrivacy(Base):
    """The tests that justify the server-authoritative design.

    Each reads the *raw* response body — the same bytes a player can read in
    devtools. If any of these fail, the browser knows something it should not.
    """

    def test_the_quiz_ships_only_the_current_question(self):
        """A future question is absent, not hidden by CSS."""
        self.reach_quiz()
        raw = self.raw()
        v = self.view()

        self.assertEqual(v["index"], 0)
        self.assertEqual(v["question"]["id"], QUESTIONS[0]["id"])
        self.assertNotIn("questions", v, "the view exposes a list of questions")

        for q in QUESTIONS[1:]:
            self.assertNotIn(q["prompt"], raw, f"{q['id']} was sent before it was reached")
            self.assertNotIn(q["why"], raw, f"the explanation for {q['id']} leaked early")

    def test_the_answer_key_is_absent_until_the_question_is_answered(self):
        self.reach_quiz()
        v = self.view()
        self.assertFalse(v["answered"])
        self.assertIsNone(v["correct_index"], "the answer index was sent before the answer")
        self.assertIsNone(v["why"], "the explanation leaked before the answer")
        self.assertIsNone(v["picked"])

    def test_the_answer_key_appears_once_the_question_is_answered(self):
        self.reach_quiz()
        q = QUESTIONS[0]
        self.ok("brief.answer", {"index": q["answer"]})
        v = self.view()
        self.assertEqual(v["correct_index"], q["answer"])
        self.assertTrue(v["why"])

    def test_no_explanation_leaves_the_server_before_its_answer(self):
        """The strongest form of the claim, over a whole run.

        Every response body is kept, and each question's explanation is
        checked against all of them. It may only appear in a body sent after
        that question was answered.
        """
        seen: list[str] = [self.raw()]
        self.reach_quiz()
        seen.append(self.raw())

        for q in QUESTIONS:
            for i, body in enumerate(seen):
                self.assertNotIn(q["why"], body,
                                 f"the explanation for {q['id']} leaked in response #{i}")

            _, body = self.act("brief.answer", {"index": q["answer"]})
            seen.append(json.dumps(body))
            _, body = self.act("brief.next_question")
            seen.append(json.dumps(body))

        # And the whole quiz is accounted for, so the loop above cannot pass
        # by never running.
        self.assertEqual(len(seen), 2 + 2 * QUESTION_COUNT)

    def test_the_deal_book_does_not_replay_the_quiz(self):
        self.reach_dealbook()
        raw = self.raw()
        for q in QUESTIONS:
            self.assertNotIn(q["why"], raw, f"the Deal Book repeats {q['id']}'s explanation")
            self.assertNotIn(q["prompt"], raw, f"the Deal Book repeats {q['id']}'s prompt")

    def test_the_deal_book_holds_no_outcome(self):
        """The mandates are listed by codename. Nothing says how any ends.

        This scans the payload's *keys*, not its prose: the closing note
        legitimately contains the word "outcome" when it says the outcome is
        sealed until the Truth stage. What must not exist is a field carrying
        one.
        """
        self.reach_dealbook()
        v = self.view()
        for row in v["deals"]:
            self.assertEqual(
                set(row), MANDATE_KEYS,
                f"{row['code']} carries more than the desk shows: {sorted(row)}")

        keys = set(_all_keys(json.loads(self.raw())))
        for forbidden in ("right_call", "right_metric", "outcome", "verdict", "correct"):
            self.assertNotIn(forbidden, keys, f"the payload has a '{forbidden}' field")

    def test_the_deal_book_names_every_mandate(self):
        self.reach_dealbook()
        raw = self.raw()
        for row in DEAL_BOOK:
            self.assertIn(row["code"], raw, f"{row['code']} is missing from the desk")

    def test_one_session_cannot_read_another(self):
        other = app.test_client()
        other.post("/api/action", json={"action": "welcome.next", "payload": {}})
        self.assertEqual(self.view()["screen"], "title", "state leaked across sessions")


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------


class TestPlumbing(Base):
    def test_unknown_actions_are_refused(self):
        code, body = self.act("deal.give_me_points")
        self.assertEqual(code, 409)
        self.assertIn("unknown action", body["error"])

    def test_a_malformed_body_is_refused(self):
        r = self.c.post("/api/action", data="not json", content_type="application/json")
        self.assertEqual(r.status_code, 400)

    def test_a_missing_action_name_is_refused(self):
        r = self.c.post("/api/action", json={"payload": {}})
        self.assertEqual(r.status_code, 400)

    def test_health_describes_the_build(self):
        h = self.c.get("/api/health").get_json()
        self.assertEqual(h["stages"], ["welcome", "brief", "dealbook"])
        self.assertEqual(h["stages_in_rail"], 11)
        self.assertEqual(h["mandates"], [d["code"] for d in DEAL_BOOK])
        self.assertIn("brief.answer", h["actions"])

    def test_the_index_renders_and_is_noindex(self):
        self.assertIn("noindex", self.raw("/"))

    def test_robots_disallows_everything(self):
        self.assertIn("Disallow: /", self.raw("/robots.txt"))

    def test_the_view_layer_carries_no_answer_key(self):
        """ib.js must not hold a copy of the answers it is not allowed to know.

        What must not be present is anything that says which option is right,
        or how any mandate turns out.
        """
        src = self.raw("/static/ib.js")
        for q in QUESTIONS:
            self.assertNotIn(q["why"], src, f"ib.js contains the explanation for {q['id']}")
            self.assertNotIn(q["prompt"], src, f"ib.js contains the prompt for {q['id']}")

    def test_the_client_holds_no_dead_deal_markup(self):
        """The Prism stage was cut; the client should not still be able to
        render it, or post to it."""
        src = self.raw("/static/ib.js")
        for stale in ("renderPrism", "prismResearch", "rangeBar", "deal.open",
                      "deal.pick_metric", "deal.lock", "deal.save_evidence"):
            self.assertNotIn(stale, src, f"ib.js still references {stale}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
