/* ==========================================================================
   FinTree CDP — Investment Banking sample engine
   Three stages: Welcome (1) -> Brief (2-3) -> Prism (4)

   Blueprint references:
     p5   Welcome: title, who you are, what bankers do, your job today
     p6   Briefing Room (six words, four questions) + Deal Book
     p9   Prism: brief, metric choice, comparables, fair range, the call
     p7   "Anatomy of every deal" — Brief, Research, Task, Your call
     p19  auto-save after every action; resume at the same screen

   SCOPE NOTE
     Stages 5-11 of the blueprint (Vault, Cedar, Anvil, Monsoon, Defend,
     Truth, Report) are not built here. They appear in the stage rail as
     dashed chips so the shape of the full programme stays visible. The deal
     ends on a receipt, exactly as the blueprint requires (p7: "No outcome
     yet.") — nothing is revealed early.

   TIMER NOTE
     The blueprint runs a global clock and a per-deal countdown, and specifies
     expiry behaviour for exactly one of them (p6). This sample displays the
     global clock and clamps at zero without blocking, so a reviewer who
     leaves the tab open still sees the whole flow. See the README.

   Style: ES5, no dependencies, no build step. Matches the sibling build.
   ========================================================================== */

(function () {
  'use strict';

  var BRIEFING = window.IB_BRIEFING;
  var DEAL = window.IB_DEAL;

  var SAVE_KEY = 'fintree.ib.sample.v1';
  var TOTAL_SECONDS = 40 * 60;

  /* Stage rail. `stage` is null for the parts not in this sample. */
  var CHIPS = [
    { n: 1,  label: 'Welcome',   stage: 'welcome' },
    { n: 2,  label: 'Brief',     stage: 'brief' },
    { n: 3,  label: 'Deal Book', stage: 'brief' },
    { n: 4,  label: 'Prism',     stage: 'prism' },
    { n: 5,  label: 'Vault',     stage: null },
    { n: 6,  label: 'Cedar',     stage: null },
    { n: 7,  label: 'Anvil',     stage: null },
    { n: 8,  label: 'Monsoon',   stage: null },
    { n: 9,  label: 'Defend',    stage: null },
    { n: 10, label: 'Truth',     stage: null },
    { n: 11, label: 'Report',    stage: null }
  ];

  var STAGE_ORDER = ['welcome', 'brief', 'prism'];

  /* ======================================================================
     State
     ====================================================================== */

  function blankState() {
    return {
      stage: 'welcome',
      wSub: 'title',
      name: '',
      nda: false,
      guidance: 'normal',
      tutorial: false,

      bSub: 'briefing',
      wordsOpened: {},
      qIndex: 0,
      answers: {},
      points: 0,
      briefDone: false,

      prism: {
        step: 'brief',
        seen: {},
        tray: [],
        metric: null,
        metricRight: false,
        priceM: DEAL.task.defaultPriceM,
        choice: null,
        protections: {},
        reason: null,
        note: '',
        locked: false
      },

      startedAt: null,
      secondsLeft: TOTAL_SECONDS
    };
  }

  var state = blankState();

  function save() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (err) { /* private mode — the run still works, it just will not resume */ }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.stage) state = parsed;
    } catch (err) { state = blankState(); }
  }

  function resetRun() {
    try { window.localStorage.removeItem(SAVE_KEY); } catch (err) {}
    state = blankState();
    render();
  }

  /* ======================================================================
     Helpers
     ====================================================================== */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* millions of USD -> "$540M" / "$1.5B" / "$1B" */
  function money(m) {
    if (m == null) return '\u2014';
    if (m >= 1000) {
      var b = m / 1000;
      var s = (Math.round(b * 10) / 10);
      return '$' + (s % 1 === 0 ? s.toFixed(0) : s.toFixed(1)) + 'B';
    }
    return '$' + Math.round(m) + 'M';
  }

  function v(key) {
    /* Vocabulary hook. The blueprint wants one engine speaking each track's
       language; the sample only needs the default wording. */
    var table = {
      inbox: 'deal book',
      pitchVerb: 'opened'
    };
    return table[key] || key;
  }

  function fairRange() {
    var vals = DEAL.task.perUser.map(function (p) { return p.value; });
    var low = Math.min.apply(null, vals) * DEAL.task.usersM;
    var high = Math.max.apply(null, vals) * DEAL.task.usersM;
    return { low: low, high: high };
  }

  function rangePos(valueM) {
    var min = DEAL.task.priceMinM;
    var max = DEAL.task.priceMaxM;
    var p = ((valueM - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, p));
  }

  var toastTimer = null;
  function toast(message) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    host.appendChild(el);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3600);
    if (toastTimer) window.clearTimeout(toastTimer);
  }

  function clockLabel() {
    if (state.secondsLeft <= 0) return 'Time up';
    return Math.ceil(state.secondsLeft / 60) + ' min';
  }

  function wordsOpenedCount() {
    var n = 0;
    for (var i = 0; i < BRIEFING.words.length; i++) {
      if (state.wordsOpened[BRIEFING.words[i].id]) n++;
    }
    return n;
  }

  function answersCorrect() {
    var n = 0;
    for (var i = 0; i < BRIEFING.questions.length; i++) {
      var a = state.answers[BRIEFING.questions[i].id];
      if (a && a.correct) n++;
    }
    return n;
  }

  function trayHas(text) {
    for (var i = 0; i < state.prism.tray.length; i++) {
      if (state.prism.tray[i].text === text) return true;
    }
    return false;
  }

  /* ======================================================================
     Shell
     ====================================================================== */

  function chipState(chip) {
    if (!chip.stage) return 'chip chip--sample';
    var here = STAGE_ORDER.indexOf(state.stage);
    var there = STAGE_ORDER.indexOf(chip.stage);
    if (there === here) return 'chip chip--active';
    if (there < here) return 'chip chip--done';
    return 'chip';
  }

  function renderChips() {
    var html = '<div class="chips" role="list" aria-label="Programme stages">';
    for (var i = 0; i < CHIPS.length; i++) {
      var c = CHIPS[i];
      var title = c.stage ? '' : ' title="Not part of this three-stage sample"';
      html += '<span class="' + chipState(c) + '" role="listitem"' + title + '>' +
                '<span class="chip__num">' + c.n + '</span>' + esc(c.label) +
              '</span>';
    }
    html += '</div>';
    return html;
  }

  function renderTopbar() {
    var dealsDone = state.stage === 'prism' && state.prism.locked ? 1 : 0;
    return '' +
      '<header class="topbar">' +
        '<div class="topbar__inner">' +
          '<div class="brand">' +
            '<span class="brand__mark" aria-hidden="true">A</span>' +
            '<span class="brand__name">Ashford &amp; Rowe</span>' +
            '<span class="brand__you">' +
              (state.name ? esc(state.name) + ' \u00b7 the new analyst' : 'You: the new analyst') +
            '</span>' +
          '</div>' +
          '<div class="topbar__spacer"></div>' +
          '<div class="topbar__meta">' +
            '<span>Deals <span class="meta-strong tnum">' + dealsDone + '/5</span></span>' +
            '<span>Points <span class="meta-strong tnum">' + state.points + '</span></span>' +
            '<span class="clock' + (state.secondsLeft <= 300 ? ' clock--low' : '') + '">' +
              'Time left <span class="meta-strong tnum">' + clockLabel() + '</span>' +
            '</span>' +
            '<span>Guidance <span class="meta-strong">' +
              (state.guidance === 'less' ? 'Less' : 'Normal') + '</span></span>' +
            '<button class="btn btn--ghost btn--sm" data-action="restart">Restart</button>' +
          '</div>' +
        '</div>' +
        renderChips() +
      '</header>';
  }

  function companionLine() {
    var c = DEAL.companion;
    if (state.stage === 'welcome') {
      if (state.wSub === 'title') return 'Five clients. Five decisions. Not every deal on your desk is a good one. Your job is to know the difference.';
      if (state.wSub === 'identity') return 'Sign in and pick how much help you want. You can change it later.';
      if (state.wSub === 'role') return 'Buy, sell, raise money, or fix a company in trouble. Today you are on the buy side.';
      return 'Start with Prism. Read the brief before you look at any number.';
    }
    if (state.stage === 'brief') {
      if (state.bSub === 'briefing') return 'You do not need to know these by heart. You will see each one again inside a deal.';
      if (state.bSub === 'quiz') return 'Wrong answers cost you nothing but points. Read the explanation either way.';
      return 'Five mandates. Five sectors. One desk.';
    }
    return c[state.prism.step] || c.brief;
  }

  function companionTag() {
    if (state.stage === 'welcome') return 'Welcome \u00b7 ' + state.wSub;
    if (state.stage === 'brief') return 'Briefing \u00b7 ' + state.bSub;
    return 'Project Prism \u00b7 ' + state.prism.step;
  }

  function renderRail() {
    /* Everything the rail contains must come back as ONE element. Returning
       the cards as siblings makes them separate children of the two-column
       .body grid, so the third one wraps into row 2 of the main column. */
    var html = '' +
      '<aside class="rail">' +
        '<div class="companion">' +
          '<div class="companion__head">' +
            '<span class="companion__avatar" aria-hidden="true">MS</span>' +
            '<span>' +
              '<span class="companion__name">Meera Sethi</span><br>' +
              '<span class="companion__role">Managing Director \u00b7 M&amp;A</span>' +
            '</span>' +
          '</div>' +
          '<span class="companion__tag">' + esc(companionTag()) + '</span>' +
          '<p class="companion__line">' + esc(companionLine()) + '</p>' +
        '</div>';

    if (state.stage === 'prism' && state.prism.step === 'research') {
      html += renderTrayCard();
    }

    html += renderProgressCard();
    html += '</aside>';
    return html;
  }

  function renderTrayCard() {
    var tray = state.prism.tray;
    var html = '<div class="rail-card">' +
      '<span class="rail-card__title">Evidence tray \u00b7 ' + tray.length + ' saved</span>';
    if (!tray.length) {
      html += '<p class="tray__empty">Save a fact or a risk as you read. Meera refers back to what you saved.</p>';
    } else {
      for (var i = 0; i < tray.length; i++) {
        var kindClass = tray[i].kind === 'risk' ? ' tray__kind--risk' : ' tray__kind--fact';
        html += '<div class="tray__item">' +
                  '<span class="tray__kind' + kindClass + '">' + esc(tray[i].kind) + '</span>' +
                  '<span>' + esc(tray[i].text) + '</span>' +
                '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  function renderProgressCard() {
    var total = BRIEFING.words.length + BRIEFING.questions.length;
    var done = wordsOpenedCount() + Object.keys(state.answers).length;
    var pct = Math.round((done / total) * 100);
    return '' +
      '<div class="rail-card">' +
        '<span class="rail-card__title">Briefing progress</span>' +
        '<div class="progress">' +
          '<span class="progress__track"><span class="progress__bar" style="width:' + pct + '%"></span></span>' +
          '<span class="progress__label tnum">' + done + '/' + total + '</span>' +
        '</div>' +
        '<p class="small muted">Six words opened, four questions answered. ' +
          'Points come from the questions only.</p>' +
      '</div>';
  }

  /* ======================================================================
     Stage 1 — Welcome
     ====================================================================== */

  function renderWelcome() {
    if (state.wSub === 'title') return welcomeTitle();
    if (state.wSub === 'identity') return welcomeIdentity();
    if (state.wSub === 'role') return welcomeRole();
    return welcomeDesk();
  }

  function welcomeTitle() {
    return '' +
      '<div class="welcome">' +
        '<span class="welcome__mark" aria-hidden="true">A</span>' +
        '<span class="sample-badge"><span class="sample-badge__dot"></span>' +
          'Three-stage sample of an eleven-stage programme</span>' +
        '<h1>Five real deals. Five industries. You make the calls.</h1>' +
        '<p class="welcome__lede">You are the new analyst at Ashford &amp; Rowe. ' +
          'Advise each client: go, go with protection, or walk away.</p>' +
        '<div class="welcome__facts">' +
          '<span class="fact"><span class="fact__dot"></span>About 40 minutes</span>' +
          '<span class="fact"><span class="fact__dot"></span>5 real deals</span>' +
          '<span class="fact"><span class="fact__dot"></span>Leaderboard</span>' +
        '</div>' +
        '<p class="welcome__note">At the end, you find out which real companies these were.</p>' +
        '<div class="btn-row">' +
          '<button class="btn btn--primary" data-action="w-next">Start simulation</button>' +
          '<button class="btn" data-action="w-tutorial">' +
            (state.tutorial ? 'Hide tutorial' : 'Watch tutorial (1 min)') +
          '</button>' +
        '</div>' +
        (state.tutorial ? tutorialPanel() : '') +
        '<p class="small muted">Best on a laptop. Keep 40 minutes free. Headphones help.</p>' +
      '</div>';
  }

  /* The blueprint asks for a tutorial video with captions (p5) and a text
     altertrack for every voice moment (p19). There is no video in this
     sample, so the script itself is the accessible artefact. */
  function tutorialPanel() {
    return '' +
      '<div class="card" style="text-align:left;max-width:620px">' +
        '<div class="card__head">' +
          '<span class="card__title">Tutorial \u00b7 1 minute</span>' +
          '<span class="card__meta">Script \u00b7 captions included</span>' +
        '</div>' +
        '<div class="card__body">' +
          '<p class="small muted" style="margin-bottom:10px">' +
            'In the full programme this is a captioned video. The script is reproduced here ' +
            'so nothing depends on sound or on watching.' +
          '</p>' +
          '<p style="margin-bottom:8px"><strong>Meera:</strong> Welcome to Ashford &amp; Rowe. ' +
            'I am Meera, and I will be with you for the whole run.</p>' +
          '<p style="margin-bottom:8px"><strong>Meera:</strong> Five clients have given us five jobs. ' +
            'For each one you will read the brief, research the target, do one main task, ' +
            'and then make the call.</p>' +
          '<p style="margin-bottom:8px"><strong>Meera:</strong> You always have three choices: go, ' +
            'go with protection, or walk away. Walking away is a real answer.</p>' +
          '<p><strong>Meera:</strong> One thing before we start. Not every deal on your desk is a ' +
            'good deal. Your job is to know the difference.</p>' +
        '</div>' +
      '</div>';
  }

  function welcomeIdentity() {
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 1 \u00b7 Screen 1.2</span>' +
        '<h1>Who you are</h1>' +
        '<p class="stage-head__lede">Type your name. An Analyst badge fills in.</p>' +
      '</div>' +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:18px">' +
        '<div class="field">' +
          '<label for="analyst-name">Your name</label>' +
          '<input class="input" id="analyst-name" type="text" maxlength="40" ' +
            'placeholder="Type your name" value="' + esc(state.name) + '">' +
          '<span class="field__hint">Shown on the leaderboard and on your report. ' +
            'You can hide it from the board later.</span>' +
        '</div>' +
        '<div class="nda">' +
          '<span class="nda__title">Confidentiality</span>' +
          '<p>Live deals are never discussed by name. Until the Truth, every target in this ' +
            'programme is referred to by a codename only.</p>' +
          '<div class="codenames">' +
            BRIEFING.dealBook.map(function (d) {
              return '<span class="codename">' + esc(d.code) + '</span>';
            }).join('') +
          '</div>' +
          '<label class="check">' +
            '<input type="checkbox" data-action="toggle-nda"' + (state.nda ? ' checked' : '') + '>' +
            '<span>I agree to keep client names confidential until the Truth.</span>' +
          '</label>' +
        '</div>' +
        '<div class="field">' +
          '<label>Guidance mode</label>' +
          '<div class="mode-row">' +
            '<button class="mode' + (state.guidance === 'normal' ? ' mode--on' : '') + '" ' +
              'data-action="guidance" data-value="normal">' +
              '<span class="mode__name">Normal guidance</span>' +
              '<span class="mode__desc">Meera explains the next action and why it matters.</span>' +
            '</button>' +
            '<button class="mode' + (state.guidance === 'less' ? ' mode--on' : '') + '" ' +
              'data-action="guidance" data-value="less">' +
              '<span class="mode__name">Less guidance</span>' +
              '<span class="mode__desc">Meera stays quiet unless you ask. Same points either way.</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">' +
          (state.nda && state.name.trim() ? 'Ready.' : 'Add a name and sign the note to continue.') +
        '</span>' +
        '<button class="btn btn--primary" data-action="w-next"' +
          (state.nda && state.name.trim() ? '' : ' disabled') + '>Continue</button>' +
      '</div></div>';
  }

  function welcomeRole() {
    var jobs = [
      { t: 'Buy', d: 'A client wants to acquire a company. You value it, find the risks, and set a price.' },
      { t: 'Sell', d: 'A client wants to exit. You run the process and get the best price.' },
      { t: 'Raise money', d: 'A client needs capital. You find the investors and agree the terms.' },
      { t: 'Fix a company in trouble', d: 'A client cannot pay its debts. You restructure what it owes.' }
    ];
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 1 \u00b7 Screen 1.3</span>' +
        '<h1>What bankers do</h1>' +
        '<p class="stage-head__lede">Four jobs, in plain words. Today you are on the buy side.</p>' +
      '</div>' +
      '<div class="card"><div class="card__body">' +
        '<div class="word-grid">' +
          jobs.map(function (j) {
            return '<div class="word-card" style="min-height:auto">' +
                     '<span class="word-card__word">' + esc(j.t) + '</span>' +
                     '<span class="word-card__example">' + esc(j.d) + '</span>' +
                   '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">One more screen and the desk is yours.</span>' +
        '<button class="btn btn--primary" data-action="w-next">Continue</button>' +
      '</div></div>';
  }

  function welcomeDesk() {
    var cards = BRIEFING.dealBook.map(function (d) {
      var cls = d.status === 'open' ? 'deal-card deal-card--open' : 'deal-card deal-card--locked';
      return '<div class="' + cls + '">' +
               '<span class="deal-card__sector">' + esc(d.sector) + ' \u00b7 ' + d.year + '</span>' +
               '<span class="deal-card__code">' + esc(d.code) + '</span>' +
               '<span class="deal-card__status">' + esc(d.note) + '</span>' +
               (d.status === 'locked' ? '<span class="deal-card__mark" aria-hidden="true">?</span>' : '') +
             '</div>';
    }).join('');

    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 1 \u00b7 Screen 1.4</span>' +
        '<h1>Your job today</h1>' +
        '<p class="stage-head__lede">Five face-down deal cards. Sector and year only \u2014 ' +
          'the company names stay hidden until the Truth.</p>' +
      '</div>' +
      '<div class="card"><div class="card__body">' +
        '<div class="dealbook">' + cards + '</div>' +
        '<div class="rule"></div>' +
        '<p class="small muted">' + esc(BRIEFING.dealBookFooter) + '</p>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">Start with Prism. Read the brief before you look at any number.</span>' +
        '<button class="btn btn--primary" data-action="go-brief">Open the Briefing Room</button>' +
      '</div></div>';
  }

  /* ======================================================================
     Stage 2 — Briefing Room + Deal Book
     ====================================================================== */

  function renderBrief() {
    if (state.bSub === 'briefing') return briefBriefing();
    if (state.bSub === 'quiz') return briefQuiz();
    return briefDealBook();
  }

  function briefBriefing() {
    var opened = wordsOpenedCount();
    var total = BRIEFING.words.length;

    var cards = BRIEFING.words.map(function (w) {
      var isOpen = !!state.wordsOpened[w.id];
      return '' +
        '<button class="word-card' + (isOpen ? ' word-card--open' : '') + '" ' +
          'data-action="open-word" data-word="' + esc(w.id) + '" ' +
          'aria-pressed="' + (isOpen ? 'true' : 'false') + '">' +
          (isOpen ? '<span class="word-card__check" aria-hidden="true">\u2713</span>' : '') +
          '<span class="word-card__word">' + esc(w.word) + '</span>' +
          (isOpen
            ? '<span class="word-card__meaning">' + esc(w.meaning) + '</span>' +
              '<span class="word-card__example">' + esc(w.example) + '</span>' +
              '<span class="word-card__where">Matters most in \u00b7 ' + esc(w.where) + '</span>'
            : '<span class="word-card__cue">Tap to see the meaning and an example</span>') +
        '</button>';
    }).join('');

    var pct = Math.round((opened / total) * 100);

    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 2 \u00b7 Briefing Room</span>' +
        '<h1>' + esc(BRIEFING.stageLede) + '</h1>' +
        '<p class="stage-head__lede">' + esc(BRIEFING.stageHint) + '</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">Six words you will use today</span>' +
          '<span class="card__meta tnum">' + opened + ' of ' + total + ' opened</span>' +
        '</div>' +
        '<div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
          '<div class="progress">' +
            '<span class="progress__track"><span class="progress__bar" style="width:' + pct + '%"></span></span>' +
            '<span class="progress__label tnum">' + pct + '%</span>' +
          '</div>' +
          '<div class="word-grid">' + cards + '</div>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted">' +
            (opened === total ? 'All six opened. Four quick questions next.' :
              'Open all six to continue \u2014 or reveal them if you already know these words.') +
          '</span>' +
          '<div class="btn-row">' +
            (opened === total ? '' :
              '<button class="btn btn--ghost btn--sm" data-action="reveal-all">Reveal all</button>') +
            '<button class="btn btn--primary" data-action="go-quiz"' +
              (opened === total ? '' : ' disabled') + '>Four quick questions</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function briefQuiz() {
    var qs = BRIEFING.questions;
    var q = qs[state.qIndex];
    if (!q) return briefDealBook();

    var given = state.answers[q.id];
    var letters = ['A', 'B', 'C', 'D'];

    var options = q.options.map(function (text, i) {
      var cls = 'option';
      if (given) {
        if (i === q.answer) cls += ' option--right';
        else if (i === given.picked) cls += ' option--wrong';
      }
      return '<button class="' + cls + '" data-action="answer" data-index="' + i + '"' +
               (given ? ' disabled' : '') + '>' +
               '<span class="option__key" aria-hidden="true">' + letters[i] + '</span>' +
               '<span>' + esc(text) + '</span>' +
             '</button>';
    }).join('');

    var answeredCount = Object.keys(state.answers).length;

    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 2 \u00b7 Quick check \u00b7 Question ' +
          (state.qIndex + 1) + ' of ' + qs.length + '</span>' +
        '<h1>Four quick questions</h1>' +
        '<p class="stage-head__lede">Twenty-five points each. You get the explanation either way.</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title tnum">Question ' + (state.qIndex + 1) + ' of ' + qs.length + '</span>' +
          '<span class="card__meta tnum">' + state.points + ' points</span>' +
        '</div>' +
        '<div class="card__body quiz">' +
          '<p class="quiz__prompt">' + esc(q.prompt) + '</p>' +
          '<div class="options">' + options + '</div>' +
          (given ? '<p class="explain">' + esc(q.why) + '</p>' : '') +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted tnum">' + answeredCount + ' of ' + qs.length + ' answered</span>' +
          '<button class="btn btn--primary" data-action="quiz-next"' +
            (given ? '' : ' disabled') + '>' +
            (state.qIndex === qs.length - 1 ? 'To the Deal Book' : 'Next question') +
          '</button>' +
        '</div>' +
      '</div>';
  }

  function briefDealBook() {
    var cards = BRIEFING.dealBook.map(function (d) {
      var isOpen = d.status === 'open';
      var cls = isOpen ? 'deal-card deal-card--open' : 'deal-card deal-card--locked';
      return '<button class="' + cls + '"' +
               (isOpen ? ' data-action="start-prism"' : ' disabled') + '>' +
               '<span class="deal-card__sector">' + esc(d.sector) + ' \u00b7 ' + d.year + '</span>' +
               '<span class="deal-card__code">' + esc(d.code) + '</span>' +
               '<span class="deal-card__status">' + esc(d.note) + '</span>' +
               (isOpen ? '' : '<span class="deal-card__mark" aria-hidden="true">?</span>') +
             '</button>';
    }).join('');

    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 3 \u00b7 Deal Book</span>' +
        '<h1>' + esc(BRIEFING.dealBookLede) + '</h1>' +
        '<p class="stage-head__lede">' + esc(BRIEFING.dealBookHint) + '</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">On your desk</span>' +
          '<span class="card__meta">' + (state.briefDone ? 'Briefing complete' : '') + '</span>' +
        '</div>' +
        '<div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
          '<div class="dealbook">' + cards + '</div>' +
          '<div class="rule"></div>' +
          '<p class="small muted">' + esc(BRIEFING.dealBookFooter) + '</p>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted">Deals open one at a time, in a fixed order.</span>' +
          '<button class="btn btn--primary" data-action="start-prism">Open Project Prism</button>' +
        '</div>' +
      '</div>';
  }

  /* ======================================================================
     Stage 3 — Project Prism
     ====================================================================== */

  function renderPrism() {
    var step = state.prism.step;
    if (step === 'brief') return prismBrief();
    if (step === 'research') return prismResearch();
    if (step === 'task') return prismTask();
    if (step === 'call') return prismCall();
    if (step === 'review') return prismReview();
    return prismReceipt();
  }

  function prismHead(stepLabel, stepNum, title, lede) {
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">' + esc(DEAL.code) + ' \u00b7 ' + esc(DEAL.sector) + ' \u00b7 ' +
          DEAL.year + ' \u00b7 ' + esc(stepLabel) + '</span>' +
        '<h1>' + esc(title) + '</h1>' +
        '<p class="stage-head__lede">' + esc(lede) + '</p>' +
      '</div>';
  }

  function prismBrief() {
    return '' +
      prismHead('Step 1 of 4', 1, DEAL.brief.headline, DEAL.brief.clientLine) +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
        '<p class="lede">' + esc(DEAL.brief.body) + '</p>' +
        '<div class="nda" style="border-style:solid">' +
          '<span class="nda__title">' + esc(DEAL.brief.mood.label) + '</span>' +
          '<p>' + esc(DEAL.brief.mood.line) + '</p>' +
        '</div>' +
        '<div class="btn-row">' +
          '<span class="sample-badge">Skills \u00b7 ' + esc(DEAL.skills.join(' \u00b7 ')) + '</span>' +
          '<span class="sample-badge">' + esc(DEAL.stepOf) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">Research is next. Nothing you read costs points.</span>' +
        '<button class="btn btn--primary" data-action="p-step" data-step="research">' +
          'Open the Deal Terminal</button>' +
      '</div></div>';
  }

  function prismResearch() {
    var pages = DEAL.terminal.pages;
    var activeId = state.prism.activePage || pages[0].id;
    var page = null;
    for (var i = 0; i < pages.length; i++) { if (pages[i].id === activeId) page = pages[i]; }
    if (!page) page = pages[0];

    var tabs = pages.map(function (p) {
      return '<button class="tab' + (p.id === page.id ? ' tab--on' : '') + '" ' +
               'data-action="term-tab" data-page="' + esc(p.id) + '">' +
               esc(p.label) +
               (state.prism.seen[p.id] ? '<span class="tab__seen" aria-hidden="true">\u2713</span>' : '') +
             '</button>';
    }).join('');

    var body = '<p class="lede">' + esc(page.body) + '</p>';

    if (page.stats) {
      body += '<div class="stat-grid">' + page.stats.map(function (s) {
        return '<div class="stat' + (s.tone === 'good' ? ' stat--good' : '') + '">' +
                 '<span class="stat__label">' + esc(s.label) + '</span>' +
                 '<span class="stat__value">' + esc(s.value) + '</span>' +
                 (s.note ? '<span class="stat__note">' + esc(s.note) + '</span>' : '') +
               '</div>';
      }).join('') + '</div>';
    }

    if (page.items) {
      body += '<div class="item-list">' + page.items.map(function (it) {
        var text = it.text;
        var saved = trayHas(text);
        return '<div class="item">' +
                 '<span class="item__main">' +
                   (it.date ? '<span class="item__date">' + esc(it.date) + '</span>' : '') +
                   '<span class="item__text">' + esc(text) + '</span>' +
                 '</span>' +
                 (it.flag ? '<span class="flag flag--' + esc(it.flag) + '">' + esc(it.flag) + '</span>' : '') +
                 '<span class="item__save">' +
                   (saved
                     ? '<span class="flag flag--good">Saved</span>'
                     : '<button class="btn btn--ghost btn--sm" data-action="save-evidence" ' +
                       'data-text="' + esc(text) + '" ' +
                       'data-kind="' + (it.flag === 'risk' ? 'risk' : 'fact') + '">Save</button>') +
                 '</span>' +
               '</div>';
      }).join('') + '</div>';
    }

    var seenCount = Object.keys(state.prism.seen).length;

    return '' +
      prismHead('Step 2 of 4', 2, 'The Deal Terminal',
        'A safe, built-in research desk. Every page is fictional in name but based on real, dated facts.') +
      '<div class="card" style="overflow:hidden">' +
        '<div class="terminal__bar">' +
          '<span class="terminal__dots" aria-hidden="true">' +
            '<span class="terminal__dot"></span><span class="terminal__dot"></span>' +
            '<span class="terminal__dot"></span>' +
          '</span>' +
          '<span>' + esc(DEAL.terminal.address) + '</span>' +
        '</div>' +
        '<div class="tabs" role="tablist">' + tabs + '</div>' +
        '<div class="terminal__page">' +
          '<span class="card__meta">' + esc(page.title) + '</span>' +
          body +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted tnum">' + seenCount + ' of ' + pages.length + ' pages opened' +
            ' \u00b7 research is not a quiz, you may move on at any time</span>' +
          '<button class="btn btn--primary" data-action="p-step" data-step="task">' +
            'Go to the task</button>' +
        '</div>' +
      '</div>';
  }

  function prismTask() {
    var t = DEAL.task;
    var range = fairRange();

    /* A wrong pick is shown in red and then released, so the player can try
       again. Only the correct pick locks the grid. Locking on the first pick
       — right or wrong — strands the player on this step with no way to
       reach the call, which is a dead end rather than a gate. */
    var metrics = t.metrics.map(function (m) {
      var cls = 'metric';
      if (state.prism.metricRight) {
        if (m.id === t.correctMetric) cls += ' metric--right';
        else if (m.id === state.prism.metric) cls += ' metric--wrong';
      } else if (state.prism.metric === m.id) {
        cls += ' metric--wrong';
      }
      return '<button class="' + cls + '" data-action="pick-metric" data-metric="' + esc(m.id) + '"' +
               (state.prism.metricRight ? ' disabled' : '') + '>' +
               '<span class="metric__label">' + esc(m.label) + '</span>' +
               '<span class="metric__value">' + esc(m.value) + '</span>' +
               (m.note ? '<span class="metric__note">' + esc(m.note) + '</span>' : '') +
             '</button>';
    }).join('');

    var html = '' +
      prismHead('Step 3 of 4', 3, t.prompt, t.hint) +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
        '<div class="metric-grid">' + metrics + '</div>';

    if (state.prism.metric && !state.prism.metricRight) {
      html += '<p class="explain">Revenue and profit are zero because there is nothing to sell yet. ' +
              'The buyer is not paying for what the company earns today \u2014 it is paying for the ' +
              'users it would otherwise have to win one at a time. Try another number.</p>';
    }

    if (state.prism.metricRight) {
      var perUserRows = t.perUser.map(function (p) {
        return '<div class="item">' +
                 '<span class="item__main"><span class="item__text">' + esc(p.label) + '</span></span>' +
                 '<span class="item__date tnum">$' + p.value + ' per user</span>' +
               '</div>';
      }).join('');

      var bandLeft = rangePos(range.low);
      var bandWidth = rangePos(range.high) - bandLeft;
      var markerLeft = rangePos(state.prism.priceM);

      html += '' +
        '<div class="rule"></div>' +
        '<span class="card__title">' + esc(t.perUserLabel) + '</span>' +
        '<div class="item-list">' + perUserRows + '</div>' +
        '<div class="rule"></div>' +
        '<div class="range-summary">' +
          '<strong>' + esc(t.rangeLabel) + '</strong>' +
          '<span class="range-summary__calc">' +
            DEAL.task.usersM + 'M users \u00d7 $' + t.perUser[0].value + ' to $' +
            t.perUser[t.perUser.length - 1].value + ' = ' +
            money(range.low) + ' to ' + money(range.high) +
          '</span>' +
          '<span class="small muted">' + esc(t.rangeNote) + '</span>' +
        '</div>' +
        '<div class="rangebar">' +
          '<div class="rangebar__track">' +
            '<span class="rangebar__band" style="left:' + bandLeft + '%;width:' + bandWidth + '%"></span>' +
            '<span class="rangebar__marker" style="left:' + markerLeft + '%"></span>' +
          '</div>' +
          '<div class="rangebar__scale"><span>' + money(t.priceMinM) + '</span>' +
            '<span>' + money(t.priceMaxM) + '</span></div>' +
          '<div class="rangebar__legend">' +
            '<span class="legend-item"><span class="legend-swatch"></span>Fair range the comparables support</span>' +
            '<span class="legend-item"><span class="legend-line"></span>Your price, ' +
              money(state.prism.priceM) + '</span>' +
          '</div>' +
        '</div>';
    }

    html += '</div><div class="card__foot">' +
      '<span class="small muted">' +
        (state.prism.metricRight ? 'Range built. Make the call next.'
          : 'Pick the number that matters most to the buyer.') +
      '</span>' +
      '<button class="btn btn--primary" data-action="p-step" data-step="call"' +
        (state.prism.metricRight ? '' : ' disabled') + '>Make the call</button>' +
      '</div></div>';

    return html;
  }

  function prismCall() {
    var c = DEAL.call;
    var t = DEAL.task;
    var range = fairRange();
    var p = state.prism;

    var choices = c.choices.map(function (ch) {
      return '<button class="call-choice' + (p.choice === ch.id ? ' call-choice--on' : '') + '" ' +
               'data-action="pick-call" data-call="' + esc(ch.id) + '">' +
               '<span class="call-choice__label">' + esc(ch.label) + '</span>' +
               '<span class="call-choice__blurb">' + esc(ch.blurb) + '</span>' +
             '</button>';
    }).join('');

    var html = '' +
      prismHead('Step 4 of 4', 4, c.prompt, c.hint) +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:18px">' +
        '<div class="call-grid">' + choices + '</div>';

    if (p.choice === 'protect') {
      html += '<div class="rule"></div>' +
        '<div style="display:flex;flex-direction:column;gap:9px">' +
          '<span class="card__title">' + esc(c.protectionLabel) + '</span>' +
          '<p class="small muted">' + esc(c.protectionNote) + '</p>' +
          '<div class="protection-grid">' +
            c.protections.map(function (pr) {
              var on = !!p.protections[pr.id];
              return '<button class="protection' + (on ? ' protection--on' : '') + '" ' +
                       'data-action="toggle-protection" data-protection="' + esc(pr.id) + '" ' +
                       'aria-pressed="' + (on ? 'true' : 'false') + '">' +
                       '<span class="protection__box" aria-hidden="true">' + (on ? '\u2713' : '') + '</span>' +
                       '<span>' + esc(pr.label) +
                         '<span class="protection__blurb">' + esc(pr.blurb) + '</span>' +
                       '</span>' +
                     '</button>';
            }).join('') +
          '</div>' +
        '</div>';
    }

    if (p.choice && p.choice !== 'walk') {
      var bandLeft = rangePos(range.low);
      var bandWidth = rangePos(range.high) - bandLeft;
      var markerLeft = rangePos(p.priceM);
      var inRange = p.priceM >= range.low && p.priceM <= range.high;

      html += '<div class="rule"></div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<span class="card__title">' + esc(c.priceLabel) + '</span>' +
          '<div class="price-row">' +
            '<span class="price-display tnum">' + money(p.priceM) + '</span>' +
            '<span class="price-controls">' +
              '<button class="stepper" data-action="price" data-delta="-50" aria-label="Lower the price">\u2212</button>' +
              '<button class="stepper" data-action="price" data-delta="50" aria-label="Raise the price">+</button>' +
            '</span>' +
            '<span class="flag ' + (inRange ? 'flag--good' : 'flag--risk') + '">' +
              (inRange ? 'Inside your fair range' : 'Outside your fair range') + '</span>' +
          '</div>' +
          '<div class="rangebar">' +
            '<div class="rangebar__track">' +
              '<span class="rangebar__band" style="left:' + bandLeft + '%;width:' + bandWidth + '%"></span>' +
              '<span class="rangebar__marker" style="left:' + markerLeft + '%"></span>' +
            '</div>' +
            '<div class="rangebar__scale"><span>' + money(t.priceMinM) + '</span>' +
              '<span>' + money(t.priceMaxM) + '</span></div>' +
            '<div class="rangebar__legend">' +
              '<span class="legend-item"><span class="legend-swatch"></span>Your fair range, ' +
                money(range.low) + ' to ' + money(range.high) + '</span>' +
              '<span class="legend-item"><span class="legend-line"></span>Your price, ' +
                money(p.priceM) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    if (p.choice) {
      html += '<div class="rule"></div>' +
        '<div style="display:flex;flex-direction:column;gap:9px">' +
          '<span class="card__title">' + esc(c.reasonLabel) + '</span>' +
          '<div class="reason-list">' +
            c.reasons.map(function (r) {
              return '<button class="reason' + (p.reason === r.id ? ' reason--on' : '') + '" ' +
                       'data-action="pick-reason" data-reason="' + esc(r.id) + '">' +
                       '<span class="reason__dot" aria-hidden="true"></span>' +
                       '<span>' + esc(r.text) + '</span>' +
                     '</button>';
            }).join('') +
          '</div>' +
        '</div>';
    }

    var ready = p.choice && p.reason &&
                (p.choice === 'walk' || p.choice === 'go' || Object.keys(p.protections).length > 0);

    html += '</div><div class="card__foot">' +
      '<span class="small muted">' +
        (ready ? 'Ready to review.' : 'Pick a call, a reason, and any protection you want.') +
      '</span>' +
      '<button class="btn btn--primary" data-action="p-step" data-step="review"' +
        (ready ? '' : ' disabled') + '>Review my call</button>' +
      '</div></div>';

    return html;
  }

  function prismReview() {
    var p = state.prism;
    var c = DEAL.call;
    var range = fairRange();

    var choiceLabel = '';
    for (var i = 0; i < c.choices.length; i++) {
      if (c.choices[i].id === p.choice) choiceLabel = c.choices[i].label;
    }
    var reasonText = '';
    for (var j = 0; j < c.reasons.length; j++) {
      if (c.reasons[j].id === p.reason) reasonText = c.reasons[j].text;
    }
    var protectionLabels = c.protections.filter(function (pr) {
      return p.protections[pr.id];
    }).map(function (pr) { return pr.label; });

    return '' +
      prismHead('Review', 4, 'Review before it locks', 'Once you lock this, it is final. No going back.') +
      '<div class="card"><div class="card__body">' +
        '<table class="review-table">' +
          '<tbody>' +
            '<tr><td>Deal</td><td>' + esc(DEAL.code) + ' \u00b7 ' + esc(DEAL.sector) + ' \u00b7 ' + DEAL.year + '</td></tr>' +
            '<tr><td>Call</td><td>' + esc(choiceLabel) + '</td></tr>' +
            (p.choice === 'walk' ? '' :
              '<tr><td>Price</td><td class="tnum">' + money(p.priceM) + '</td></tr>' +
              '<tr><td>Fair range</td><td class="tnum">' + money(range.low) + ' \u2013 ' + money(range.high) + '</td></tr>') +
            (protectionLabels.length
              ? '<tr><td>Protection</td><td>' + esc(protectionLabels.join(', ')) + '</td></tr>'
              : '') +
            '<tr><td>Reason</td><td>' + esc(reasonText) + '</td></tr>' +
            (p.note ? '<tr><td>Note</td><td>' + esc(p.note) + '</td></tr>' : '') +
          '</tbody>' +
        '</table>' +
        '<div class="rule"></div>' +
        '<div class="field">' +
          '<label for="call-note">' + esc(c.noteLabel) + '</label>' +
          '<textarea class="textarea" id="call-note" maxlength="' + c.noteMax + '" ' +
            'placeholder="' + esc(c.notePlaceholder) + '">' + esc(p.note) + '</textarea>' +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<button class="btn" data-action="p-step" data-step="call">Change something</button>' +
        '<button class="btn btn--primary" data-action="lock-call">Lock my call</button>' +
      '</div></div>';
  }

  function prismReceipt() {
    var p = state.prism;
    var c = DEAL.call;
    var choiceLabel = '';
    for (var i = 0; i < c.choices.length; i++) {
      if (c.choices[i].id === p.choice) choiceLabel = c.choices[i].label;
    }

    return '' +
      prismHead('Receipt', 4, 'Your call is on the record', DEAL.receipt.line) +
      '<div class="receipt">' +
        '<span class="stamp">' + esc(DEAL.receipt.stamp) + '</span>' +
        '<p class="lede">' + esc(DEAL.code) + ' \u2014 ' + esc(choiceLabel) +
          (p.choice === 'walk' ? '' : ' at ' + money(p.priceM)) + '</p>' +
        '<p class="small muted">' + esc(DEAL.receipt.detail) + '</p>' +
      '</div>' +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:12px">' +
        '<span class="card__title">What this sample covers</span>' +
        '<p class="small muted">The next stage in the full programme would open Project Vault. ' +
          'Nothing about how this deal really ended is shown here \u2014 that is the Truth stage, ' +
          'and the blueprint keeps it sealed until the end of the run.</p>' +
        '<div class="rule"></div>' +
        '<span class="card__title">Your run so far</span>' +
        '<table class="review-table"><tbody>' +
          '<tr><td>Briefing answers correct</td><td class="tnum">' + answersCorrect() + ' of 4</td></tr>' +
          '<tr><td>Points</td><td class="tnum">' + state.points + '</td></tr>' +
          '<tr><td>Evidence saved</td><td class="tnum">' + p.tray.length + '</td></tr>' +
          '<tr><td>Guidance mode</td><td>' + (state.guidance === 'less' ? 'Less' : 'Normal') + '</td></tr>' +
        '</tbody></table>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">Six skill scores and a leaderboard arrive at the Report stage.</span>' +
        '<button class="btn" data-action="restart">Run it again</button>' +
      '</div></div>';
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function render() {
    var app = document.getElementById('app');
    if (!app) return;

    var main = '';
    if (state.stage === 'welcome') main = renderWelcome();
    else if (state.stage === 'brief') main = renderBrief();
    else main = renderPrism();

    app.innerHTML = '' +
      '<div class="shell">' +
        renderTopbar() +
        '<div class="body">' +
          '<main class="main">' + main + '</main>' +
          renderRail() +
        '</div>' +
        '<footer class="footer">' +
          '<span>Investment Banking Simulation \u00b7 Career Discovery Program \u00b7 FinTree</span>' +
          '<span>Three-stage sample</span>' +
        '</footer>' +
      '</div>' +
      '<div class="toast-host" id="toasts" aria-live="polite"></div>';

    /* keep the name input focused through re-renders caused by typing */
    if (state.stage === 'welcome' && state.wSub === 'identity' && state.focusName) {
      var input = document.getElementById('analyst-name');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    if (state.stage === 'brief' && state.bSub === 'quiz' && state.focusQuiz) {
      var opts = document.querySelector('.options .option');
      if (opts) opts.focus();
    }
  }

  /* ======================================================================
     Actions
     ====================================================================== */

  function goStage(id) {
    state.stage = id;
    if (id === 'brief') state.bSub = state.bSub || 'briefing';
    save();
    render();
    window.scrollTo(0, 0);
  }

  function handleAction(action, el) {
    var p = state.prism;

    if (action === 'restart') {
      if (window.confirm('Start this track again? Your current run will be cleared.')) resetRun();
      return;
    }

    /* --- welcome -------------------------------------------------------- */
    if (action === 'w-next') {
      if (state.wSub === 'title') state.wSub = 'identity';
      else if (state.wSub === 'identity') state.wSub = 'role';
      else if (state.wSub === 'role') state.wSub = 'desk';
      save(); render(); window.scrollTo(0, 0);
      return;
    }
    if (action === 'w-tutorial') {
      state.tutorial = !state.tutorial;
      save(); render();
      return;
    }
    if (action === 'toggle-nda') {
      state.nda = !!el.checked;
      save(); render();
      return;
    }
    if (action === 'guidance') {
      state.guidance = el.getAttribute('data-value');
      save(); render();
      return;
    }
    if (action === 'go-brief') { goStage('brief'); return; }

    /* --- briefing ------------------------------------------------------- */
    if (action === 'open-word') {
      var wid = el.getAttribute('data-word');
      state.wordsOpened[wid] = !state.wordsOpened[wid];
      save(); render();
      return;
    }
    if (action === 'reveal-all') {
      for (var i = 0; i < BRIEFING.words.length; i++) {
        state.wordsOpened[BRIEFING.words[i].id] = true;
      }
      save(); render();
      toast('All six words opened.');
      return;
    }
    if (action === 'go-quiz') {
      state.bSub = 'quiz';
      state.focusQuiz = true;
      save(); render(); window.scrollTo(0, 0);
      return;
    }
    if (action === 'answer') {
      var q = BRIEFING.questions[state.qIndex];
      if (!q || state.answers[q.id]) return;
      var picked = parseInt(el.getAttribute('data-index'), 10);
      var correct = picked === q.answer;
      state.answers[q.id] = { picked: picked, correct: correct };
      if (correct) {
        state.points += BRIEFING.pointsPerQuestion;
        toast('Correct. +' + BRIEFING.pointsPerQuestion + ' points.');
      } else {
        toast('Not quite \u2014 read the explanation.');
      }
      save(); render();
      return;
    }
    if (action === 'quiz-next') {
      if (state.qIndex < BRIEFING.questions.length - 1) {
        state.qIndex++;
        state.focusQuiz = true;
      } else {
        state.bSub = 'dealbook';
        state.briefDone = true;
        state.focusQuiz = false;
      }
      save(); render(); window.scrollTo(0, 0);
      return;
    }
    if (action === 'start-prism') {
      p.step = 'brief';
      state.stage = 'prism';
      if (!state.startedAt) state.startedAt = Date.now();
      save(); render(); window.scrollTo(0, 0);
      return;
    }

    /* --- prism ---------------------------------------------------------- */
    if (action === 'p-step') {
      p.step = el.getAttribute('data-step');
      state.focusQuiz = false;
      save(); render(); window.scrollTo(0, 0);
      return;
    }
    if (action === 'term-tab') {
      p.activePage = el.getAttribute('data-page');
      p.seen[p.activePage] = true;
      save(); render();
      return;
    }
    if (action === 'save-evidence') {
      var text = el.getAttribute('data-text');
      var kind = el.getAttribute('data-kind');
      if (!trayHas(text)) {
        p.tray.push({ kind: kind, text: text });
        toast('Saved to the evidence tray as a ' + kind + '.');
      }
      save(); render();
      return;
    }
    if (action === 'pick-metric') {
      var mid = el.getAttribute('data-metric');
      p.metric = mid;
      p.metricRight = mid === DEAL.task.correctMetric;
      if (p.metricRight) toast('That is the one. Range built from the comparables.');
      save(); render();
      return;
    }
    if (action === 'pick-call') {
      p.choice = el.getAttribute('data-call');
      if (p.choice === 'walk') { p.protections = {}; }
      save(); render();
      return;
    }
    if (action === 'toggle-protection') {
      var pid = el.getAttribute('data-protection');
      if (p.protections[pid]) delete p.protections[pid];
      else p.protections[pid] = true;
      save(); render();
      return;
    }
    if (action === 'price') {
      var delta = parseInt(el.getAttribute('data-delta'), 10);
      p.priceM = Math.max(DEAL.task.priceMinM,
                 Math.min(DEAL.task.priceMaxM, p.priceM + delta));
      save(); render();
      return;
    }
    if (action === 'pick-reason') {
      p.reason = el.getAttribute('data-reason');
      save(); render();
      return;
    }
    if (action === 'lock-call') {
      p.locked = true;
      p.step = 'receipt';
      save(); render(); window.scrollTo(0, 0);
      toast('Call locked. ' + DEAL.code + ' is on the record.');
      return;
    }
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  document.addEventListener('click', function (event) {
    var el = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!el) return;
    if (el.disabled) return;
    var action = el.getAttribute('data-action');
    if (!action) return;
    handleAction(action, el);
  }, false);

  /* The name field lives outside the click path, so it needs its own
     listener. Re-rendering on every keystroke would lose the caret, so the
     value is written straight into state and only saved. */
  document.addEventListener('input', function (event) {
    var el = event.target;
    if (!el || !el.id) return;
    if (el.id === 'analyst-name') {
      state.name = el.value;
      state.focusName = true;
      save();
      var foot = document.querySelector('.card__foot .small.muted');
      if (foot) {
        foot.textContent = state.nda && state.name.trim()
          ? 'Ready.' : 'Add a name and sign the note to continue.';
      }
      var btn = document.querySelector('[data-action="w-next"]');
      if (btn) btn.disabled = !(state.nda && state.name.trim());
      return;
    }
    if (el.id === 'call-note') {
      state.prism.note = el.value;
      save();
    }
  }, false);

  document.addEventListener('change', function (event) {
    var el = event.target;
    if (el && el.getAttribute && el.getAttribute('data-action') === 'toggle-nda') {
      state.nda = !!el.checked;
      save(); render();
    }
  }, false);

  /* Clock. Display only in this sample — it clamps at zero and never blocks
     the run. See the README for why. */
  var lastWholeMinute = null;
  window.setInterval(function () {
    if (!state.startedAt) return;
    if (state.secondsLeft <= 0) return;
    state.secondsLeft = Math.max(0, state.secondsLeft - 1);
    var label = clockLabel();
    if (label !== lastWholeMinute) {
      lastWholeMinute = label;
      var clock = document.querySelector('.clock');
      if (clock) {
        clock.innerHTML = 'Time left <span class="meta-strong tnum">' + label + '</span>';
      }
      if (state.secondsLeft === 0) {
        toast('Time is up. In the full programme this closes the stage.');
      }
    }
  }, 1000);

  /* ======================================================================
     Boot
     ====================================================================== */

  load();
  render();
})();
