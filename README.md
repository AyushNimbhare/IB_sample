# Investment Banking Simulation — three-stage sample

A working sample of the opening three stages of FinTree's Investment Banking simulation,
built from their `IB_Simulation_Experience_Blueprint` (20 pages, September 2026).

**Stage 1 Welcome → Stage 2–3 Briefing Room + Deal Book → Stage 4 Project Prism.**

It runs by opening `index.html`. No server, no build step, no dependencies.

---

## Screenshots

| | |
|---|---|
| ![Welcome](screenshots/01-welcome.png) | ![Briefing room](screenshots/02-briefing-room.png) |
| **Welcome.** Companion intro, then name, NDA and guidance mode. | **Briefing room.** Six deal words, each flipping to a meaning, an example and the deal it matters in. |
| ![Deal Terminal](screenshots/03-deal-terminal.png) | ![Fair range](screenshots/04-fair-range.png) |
| **Deal Terminal.** Company, news, industry, comparables, filings — with an evidence tray. | **The valuation.** Pick the metric, and the comparables build a fair range in dollars. |
| ![Your call](screenshots/05-your-call.png) | ![Receipt](screenshots/06-receipt.png) |
| **Your call.** Go, go with protection, or walk away — with a price, a reason and a review. | **Receipt.** The deal closes. Nothing about how it really ended is shown. |

---

## What is built

| Blueprint stage | Built? | What it contains |
|---|---|---|
| 1 Welcome | yes | Title, who you are (name, NDA, guidance mode), what bankers do, your job today |
| 2 Brief | yes | Six word cards, each with a plain meaning, a one-line example and the deal it matters in |
| 3 Deal Book | yes | Five mandates — codename, sector, year, status. Deals open one at a time |
| 4 Prism | yes | Brief → Deal Terminal research → valuation task → your call → review → receipt |
| 5–8 Vault, Cedar, Anvil, Monsoon | **no** | Shown as dashed chips in the stage rail |
| 9 Defend | **no** | |
| 10 Truth | **no** | |
| 11 Report | **no** | |

The stage rail shows all eleven so the shape of the full programme stays visible. The seven
unbuilt stages are dashed and carry a tooltip saying so. Nothing pretends to be finished.

## What is deliberately not built

The blueprint also specifies a leaderboard, server-side scoring, a Deal Assistant, a voice CEO
call, a counsellor/admin app, PDF export and a one-minute tutorial video. None of that is here.
It is not a matter of time — it is a matter of what a three-stage sample is for. Everything above
is *plumbing*; the stages themselves are the *product*, and that is what a sample should show.

---

## Running it

Open `index.html` in a browser. That is the whole instruction.

It also works from `file://` with no server, because there is nothing to serve — no `fetch`, no
XHR, no dynamic `import()`, no modules. Content loads as classic `<script>` tags, which are
exempt from the CORS restrictions that would otherwise block a `file://` page. The only network
dependency is Google Fonts, and the page degrades to system fonts without them.

Progress autosaves to `localStorage` under `fintree.ib.sample.v1`. Refresh and it resumes on the
same screen. The Restart button clears it.

---

## Decisions taken

Three things in the blueprint are ambiguous or self-contradictory, and this build had to pick a
reading. Each choice is stated here rather than hidden in the code.

**The palette is pinned to tokens, not to colour words.** The blueprint says the style should
match the VC simulation: *"cream workspace, navy, gold."* Against the design tokens recovered
from FinTree's live platform, that resolves to `--paper` ` #f6f9fb`, `--track-ib` ` #00bcd4` and
`--brand-accent` ` #facc15`. Worth noting that there is no token actually called "navy" — the
dark tone in the token set is `--sea` ` #006d7a`, a deep green. Naming tokens instead of colours
is what stops two builds drifting apart.

**The clock runs but never blocks.** The blueprint specifies a global clock *and* a per-deal
countdown, but gives expiry behaviour for only one of them (the briefing, p6). This sample shows
the global clock, counting down from 40 minutes, and clamps at zero without ending the run. A
reviewer who leaves the tab open still sees the whole flow. In the full programme the expiry
policy needs deciding for every clock before build.

**Nothing is revealed early — including by accident.** The blueprint is explicit that no outcome
is shown until the Truth (p2, p7, p14). The deal therefore ends on a receipt: *"Closed"*, and the
right call is stored in `data/deal-prism.js` but never rendered. That data field is annotated as
belonging to the Truth stage so a future build knows it is load-bearing and not dead code.

**Content is data.** Each deal is one file with no logic in it — `data/deal-prism.js` holds the
brief, the terminal pages, the comparables, the call options and the outcome. The engine reads
it. A new deal is a new file, not a new branch in the code. This is the pattern the blueprint
asks for on p19, and it is the same pattern the VC simulation uses.

---

## Two defects found and fixed while building

Both were caught by driving the finished build in a browser rather than by reading the code.

**1. The valuation task was a dead end.** The metric grid locked after the *first* pick — right
or wrong. Choosing "Revenue" by mistake disabled all four buttons and left the call button
permanently greyed out, so the player could never finish the deal. A wrong answer now shows in
red and then releases the grid, so it reads as a retry rather than a wall. Only the correct pick
locks. The bug was invisible in code review and obvious the moment it was clicked.

**2. The rail was not a rail.** `renderRail()` returned its cards as sibling elements. The page
body is a two-column grid, so the third card wrapped into row 2 *of the main column* — the
briefing-progress panel rendered underneath the content instead of beside it. Wrapping the rail
in a single container fixed it. Verified by measurement: `.body` now has exactly two children,
the rail sits at x=886 and the main column ends at x=862.

---

## Attribution

Built by Ayush as a portfolio piece, from FinTree's Investment Banking blueprint. The design
tokens in `assets/tokens.css` were recovered from FinTree's live platform so the sample reads as
track rather than as a pastiche. The deal content is adapted from the blueprint, which describes
real historical transactions; company names stay hidden behind codenames exactly as the blueprint
specifies, and the sample never states an outcome. Happy to remove or replace any of it on
request.
