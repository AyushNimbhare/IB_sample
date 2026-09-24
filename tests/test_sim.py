"""Tests for the simulation's rules engine and its privacy boundary.

These run against Flask's test client, so they need no server, no port and
no network. Run them with:

    python -m unittest discover -s tests -v

Most of what follows is a gate: the simulation refuses to move until the
player has done the thing that earns the move. The interesting part is
TestPrivacy, which asserts the claim the whole architecture exists to
support — that a player who reads every byte the browser receives still
does not know the answer.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402
from sim import content, rules  # noqa: E402

DEAL = content.get_deal(content.FIRST_DEAL_ID)
TASK = DEAL["task"]
CALL = DEAL["call"]
QUESTIONS = content.BRIEFING["questions"]
QUESTION_COUNT = len(QUESTIONS)
WRONG_METRIC = [m["id"] for m in TASK["metrics"] if m["id"] != TASK["correct_metric"]][0]


def first_evidence_text() -> str:
    """The first research item a player is allowed to save. Page 0 has none."""
    for page in DEAL["terminal"]["pages"]:
        if page.get("items"):
            return page["items"][0]["text"]
    raise AssertionError("the deal ships no evidence items at all")


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

    def reach_brief(self):
        self.ok("welcome.next")
        self.ok("welcome.identity.submit", {"name": "A. Nimbhare", "nda": True})
        self.ok("welcome.next")
        self.ok("brief.open")

    def reach_quiz(self):
        self.reach_brief()
        self.ok("brief.reveal_all")
        self.ok("brief.start_quiz")

    def answer_all(self, wrong_first: bool = False):
        for i in range(QUESTION_COUNT):
            q = QUESTIONS[i]
            pick = q["answer"]
            if wrong_first and i == 0:
                pick = (q["answer"] + 1) % len(q["options"])
            self.ok("brief.answer", {"index": pick})
            self.ok("brief.next_question")

    def reach_deal(self):
        self.reach_quiz()
        self.answer_all()
        self.ok("deal.open", {"deal_id": content.FIRST_DEAL_ID})

    def reach_task(self):
        """The metric grid only exists on the task step, not on the brief."""
        self.reach_deal()
        self.ok("deal.step", {"step": "task"})

    def pick_right_metric(self):
        self.ok("deal.pick_metric", {"metric_id": TASK["correct_metric"]})

    def make_call(self, choice: str = "protect"):
        self.pick_right_metric()
        self.ok("deal.step", {"step": "call"})
        self.ok("deal.pick_call", {"choice_id": choice})
        if choice == "protect":
            self.ok("deal.toggle_protection", {"protection_id": CALL["protections"][0]["id"]})
        if choice != "walk":
            self.ok("deal.price", {"delta": 0})
        self.ok("deal.pick_reason", {"reason_id": CALL["reasons"][0]["id"]})


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

    def test_the_desk_cannot_be_left_without_opening_a_deal(self):
        self.reach_brief()
        self.denied("welcome.next")


class TestBriefingGate(Base):
    def test_the_quiz_needs_every_word_opened(self):
        self.reach_brief()
        self.assertIn("six", self.denied("brief.start_quiz")["error"])

    def test_the_deal_needs_the_briefing_finished(self):
        self.reach_brief()
        self.denied("deal.open", {"deal_id": content.FIRST_DEAL_ID})

    def test_a_question_cannot_be_answered_twice(self):
        self.reach_quiz()
        self.ok("brief.answer", {"index": QUESTIONS[0]["answer"]})
        self.denied("brief.answer", {"index": QUESTIONS[0]["answer"]})

    def test_an_out_of_range_answer_is_refused(self):
        self.reach_quiz()
        for bad in (99, -1, "0", None):
            self.denied("brief.answer", {"index": bad})

    def test_the_next_question_needs_this_one_answered(self):
        self.reach_quiz()
        self.denied("brief.next_question")

    def test_only_the_sample_deal_is_open(self):
        self.reach_quiz()
        self.answer_all()
        self.denied("deal.open", {"deal_id": "not-a-real-deal"})


class TestDealGates(Base):
    def test_the_call_needs_the_right_metric(self):
        self.reach_deal()
        self.ok("deal.step", {"step": "task"})
        self.assertIn("metric", self.denied("deal.step", {"step": "call"})["error"])

    def test_receipt_is_not_a_navigable_step(self):
        self.reach_deal()
        self.assertIn("not a step", self.denied("deal.step", {"step": "receipt"})["error"])

    def test_the_review_needs_a_complete_call(self):
        self.reach_deal()
        self.pick_right_metric()
        self.ok("deal.step", {"step": "call"})
        self.denied("deal.step", {"step": "review"})   # nothing chosen yet

    def test_a_protection_call_needs_a_protection(self):
        self.reach_deal()
        self.pick_right_metric()
        self.ok("deal.step", {"step": "call"})
        self.ok("deal.pick_call", {"choice_id": "protect"})
        self.ok("deal.pick_reason", {"reason_id": CALL["reasons"][0]["id"]})
        self.ok("deal.price", {"delta": 0})
        self.denied("deal.step", {"step": "review"})

    def test_walking_away_needs_no_price_and_no_protection(self):
        self.reach_deal()
        self.pick_right_metric()
        self.ok("deal.step", {"step": "call"})
        self.ok("deal.pick_call", {"choice_id": "walk"})
        self.ok("deal.pick_reason", {"reason_id": CALL["reasons"][0]["id"]})
        self.ok("deal.step", {"step": "review"})       # complete without either

    def test_protections_only_apply_to_a_protection_call(self):
        self.reach_deal()
        self.pick_right_metric()
        self.ok("deal.step", {"step": "call"})
        self.ok("deal.pick_call", {"choice_id": "walk"})
        self.denied("deal.toggle_protection", {"protection_id": CALL["protections"][0]["id"]})

    def test_locking_needs_the_review(self):
        self.reach_deal()
        self.make_call()
        self.denied("deal.lock")                       # still on the call step

    def test_a_locked_call_cannot_be_edited(self):
        self.reach_deal()
        self.make_call()
        self.ok("deal.step", {"step": "review"})
        self.ok("deal.lock")
        self.denied("deal.pick_call", {"choice_id": "walk"})
        self.denied("deal.price", {"delta": 10})
        self.denied("deal.note", {"text": "changed my mind"})
        self.denied("deal.lock")                       # and cannot lock twice

    def test_evidence_must_come_from_the_deal(self):
        self.reach_deal()
        self.ok("deal.step", {"step": "research"})
        self.denied("deal.save_evidence", {"kind": "fact", "text": "I made this up"})
        self.denied("deal.save_evidence", {"kind": "vibe", "text": "anything"})

    def test_evidence_can_be_saved_once(self):
        self.reach_deal()
        self.ok("deal.step", {"step": "research"})
        text = first_evidence_text()
        self.ok("deal.save_evidence", {"kind": "fact", "text": text})
        self.denied("deal.save_evidence", {"kind": "fact", "text": text})


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


class TestScoring(Base):
    def test_a_perfect_run_scores_every_point(self):
        self.reach_quiz()
        self.answer_all()
        expected = QUESTION_COUNT * content.BRIEFING["points_per_question"]
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
                         content.BRIEFING["points_per_question"])


# ---------------------------------------------------------------------------
# Price
# ---------------------------------------------------------------------------


class TestPrice(Base):
    def setUp(self):
        super().setUp()
        self.reach_deal()
        self.pick_right_metric()
        self.ok("deal.step", {"step": "call"})
        self.ok("deal.pick_call", {"choice_id": "protect"})

    def test_the_price_is_clamped_to_the_slider(self):
        self.ok("deal.price", {"delta": 10 ** 9})
        self.assertEqual(self.view()["call"]["range"]["marker_left_pct"], 100.0)

        self.ok("deal.price", {"delta": -10 ** 9})
        self.assertEqual(self.view()["call"]["range"]["marker_left_pct"], 0.0)

    def test_a_non_numeric_delta_is_refused(self):
        self.denied("deal.price", {"delta": "lots"})
        self.denied("deal.price", {"delta": None})

    def test_the_fair_range_is_derived_from_the_comparables(self):
        low, high = rules.fair_range(DEAL)
        per_user = [p["value"] for p in TASK["per_user"]]
        self.assertEqual(low, min(per_user) * TASK["users_m"])
        self.assertEqual(high, max(per_user) * TASK["users_m"])

    def test_the_slider_contains_the_fair_range(self):
        low, high = rules.fair_range(DEAL)
        self.assertLessEqual(TASK["price_min_m"], low)
        self.assertGreaterEqual(TASK["price_max_m"], high)

    def test_the_band_is_drawn_where_the_server_scored_it(self):
        low, high = rules.fair_range(DEAL)
        r = self.view()["call"]["range"]
        span = TASK["price_max_m"] - TASK["price_min_m"]
        self.assertAlmostEqual(r["band_left_pct"], (low - TASK["price_min_m"]) / span * 100, places=1)
        self.assertAlmostEqual(r["band_width_pct"], (high - low) / span * 100, places=1)


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

    def test_the_right_call_never_leaves_the_server(self):
        """The single most important assertion in this file."""
        secret = TASK["right_call"]
        self.assertTrue(secret, "the deal has no right_call to protect")

        bodies = [self.raw()]

        self.reach_quiz()
        bodies.append(self.raw())
        for q in QUESTIONS:
            r = self.c.post("/api/action", json={"action": "brief.answer",
                                                 "payload": {"index": q["answer"]}})
            bodies.append(r.get_data(as_text=True))
            r = self.c.post("/api/action", json={"action": "brief.next_question", "payload": {}})
            bodies.append(r.get_data(as_text=True))

        for action, payload in [
            ("deal.open", {"deal_id": content.FIRST_DEAL_ID}),
            ("deal.step", {"step": "research"}),
            ("deal.step", {"step": "task"}),
            ("deal.pick_metric", {"metric_id": TASK["correct_metric"]}),
            ("deal.step", {"step": "call"}),
            ("deal.pick_call", {"choice_id": "protect"}),
            ("deal.toggle_protection", {"protection_id": CALL["protections"][0]["id"]}),
            ("deal.price", {"delta": 0}),
            ("deal.pick_reason", {"reason_id": CALL["reasons"][0]["id"]}),
            ("deal.step", {"step": "review"}),
            ("deal.lock", {}),
        ]:
            r = self.c.post("/api/action", json={"action": action, "payload": payload})
            bodies.append(r.get_data(as_text=True))
        bodies.append(self.raw())

        for i, body in enumerate(bodies):
            self.assertNotIn(secret, body, f"right_call leaked in response #{i}")

    def test_the_metric_grid_is_unmarked_before_a_pick(self):
        self.reach_task()
        task = self.view()["task"]
        for m in task["metrics"]:
            self.assertEqual(m["state"], "idle", f"{m['id']} was marked before it was picked")
            self.assertNotIn("correct", m, f"{m['id']} carries a correctness flag")

    def test_the_fair_range_is_absent_until_the_metric_is_right(self):
        self.reach_task()
        self.assertNotIn("range", self.view()["task"], "the range was sent before the metric")
        self.assertFalse(self.view()["task"]["show_range"])

        # A wrong pick must not reveal the range either.
        self.ok("deal.pick_metric", {"metric_id": WRONG_METRIC})
        self.assertNotIn("range", self.view()["task"], "a wrong pick revealed the range")

        self.pick_right_metric()
        self.assertIn("range", self.view()["task"])

    def test_the_per_user_comparables_are_absent_until_the_metric_is_right(self):
        self.reach_task()
        self.assertNotIn("per_user", self.view()["task"])

    def test_a_wrong_metric_pick_does_not_strand_the_player(self):
        """Regression: the first version locked the grid on any first pick.

        Choosing 'Revenue' disabled every metric button, including the right
        one, so the call step became unreachable.
        """
        self.reach_task()
        self.ok("deal.pick_metric", {"metric_id": WRONG_METRIC})

        task = self.view()["task"]
        self.assertFalse(task["can_continue"], "a wrong pick should not unlock the call")
        self.assertTrue(task["explanation"], "a wrong pick should explain itself")
        self.assertEqual(len(task["metrics"]), len(TASK["metrics"]))

        # The right pick still works afterwards.
        self.pick_right_metric()
        self.assertTrue(self.view()["task"]["can_continue"])

    def test_a_correct_pick_cannot_be_changed(self):
        self.reach_deal()
        self.pick_right_metric()
        self.denied("deal.pick_metric", {"metric_id": WRONG_METRIC})

    def test_the_outcome_is_not_in_the_receipt(self):
        """The receipt records what you decided, not whether it was right."""
        self.reach_deal()
        self.make_call()
        self.ok("deal.step", {"step": "review"})
        self.ok("deal.lock")

        raw = self.raw()
        self.assertNotIn(TASK["right_call"], raw)

        receipt = self.view()["receipt"]
        self.assertTrue(receipt)
        for key in ("correct", "right", "wrong", "outcome", "score", "verdict"):
            self.assertNotIn(key, receipt, f"the receipt has a '{key}' field")

    def test_the_evidence_tray_cannot_be_filled_with_arbitrary_text(self):
        self.reach_deal()
        self.ok("deal.step", {"step": "research"})
        self.denied("deal.save_evidence",
                    {"kind": "fact", "text": "<script>alert(1)</script>"})

    def test_the_note_is_truncated_to_the_limit(self):
        self.reach_deal()
        self.make_call()
        self.ok("deal.step", {"step": "review"})
        self.ok("deal.note", {"text": "x" * (CALL["note_max"] + 500)})
        self.assertEqual(len(self.view()["review"]["note"]), CALL["note_max"])

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
        self.assertEqual(h["stages_built"], ["welcome", "brief", "prism"])
        self.assertEqual(h["first_deal"], content.FIRST_DEAL_ID)
        self.assertIn("deal.lock", h["actions"])

    def test_the_index_renders_and_is_noindex(self):
        self.assertIn("noindex", self.raw("/"))

    def test_robots_disallows_everything(self):
        self.assertIn("Disallow: /", self.raw("/robots.txt"))

    def test_the_view_layer_carries_no_answer_key(self):
        """ib.js must not hold a copy of the answers it is not allowed to know.

        Metric *ids* are fine here — they are button names, and the client is
        meant to render them. What must not be present is anything that says
        which one is right, or how the deal really ended.
        """
        src = self.raw("/static/ib.js")
        self.assertNotIn(TASK["right_call"], src)
        for q in QUESTIONS:
            self.assertNotIn(q["why"], src, f"ib.js contains the explanation for {q['id']}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
