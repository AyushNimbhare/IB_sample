/* ==========================================================================
   FinTree CDP — Investment Banking sample. Client.

   This file is a VIEW LAYER and nothing else. It has no idea:
     - which quiz answer is correct
     - what a question's explanation says
     - how many points anything is worth
     - which screen may be reached next
     - how any deal turns out

   It asks the server for a render payload, draws it, and posts action names
   back. Every decision is made in Python (sim/rules.py). If you deleted this
   file's logic and rewrote it from scratch, the simulation would behave
   identically — which is the point.

   Style: ES5, no dependencies, no build step. Matches the rest of the project.
   ========================================================================== */

(function () {
  'use strict';

  var app = document.getElementById('app');

  var payload = null;      // last render payload from the server
  var clockSecs = null;    // server seconds, interpolated locally for display
  var busy = false;        // one action in flight at a time
  var draft = { name: '', nda: false, guidance: 'normal', seeded: false };

  /* ======================================================================
     Helpers
     ====================================================================== */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Serialise a payload for an HTML attribute. Going through esc() is what
     makes this safe to drop into data-payload="...". */
  function attr(obj) {
    return esc(JSON.stringify(obj || {}));
  }

  function clockLabel(seconds) {
    if (seconds <= 0) return 'Time up';
    return Math.ceil(seconds / 60) + ' min';
  }

  function toast(message) {
    var host = document.getElementById('toasts');
    if (!host || !message) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    host.appendChild(el);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3600);
  }

  /* ======================================================================
     Talking to the server
     ====================================================================== */

  function adopt(state) {
    payload = state;
    clockSecs = state.topbar.seconds_left;
    if (!draft.seeded && state.view.kind === 'welcome' && state.view.screen === 'identity') {
      draft.name = state.view.name || '';
      draft.nda = !!state.view.nda;
      draft.guidance = state.view.guidance || 'normal';
      draft.seeded = true;
    }
  }

  function post(action, body, options) {
    options = options || {};
    if (busy && !options.force) return;
    busy = true;

    window.fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: action, payload: body || {} })
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { status: response.status, data: data };
        });
      })
      .then(function (result) {
        busy = false;
        var data = result.data || {};

        /* A rejected action still carries the authoritative state, so the view
           can resync even when the request was refused. */
        if (data.state) adopt(data.state);

        if (!data.ok) {
          toast(data.error || 'That action was refused.');
          render();
          return;
        }

        if (options.silent) return;
        render();
        (data.events || []).forEach(toast);
      })
      .catch(function (err) {
        busy = false;
        toast('Could not reach the server.');
        if (window.console) window.console.error(err);
      });
  }

  function load() {
    window.fetch('/api/state', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        adopt(data.state);
        render();
      })
      .catch(function () {
        app.innerHTML = '<div class="empty" style="margin:64px auto;max-width:560px">' +
          'Could not reach the server. Is <code>python app.py</code> still running?</div>';
      });
  }

  /* ======================================================================
     Chrome
     ====================================================================== */

  function renderTopbar() {
    var t = payload.topbar;
    return '' +
      '<header class="topbar">' +
        '<div class="topbar__inner">' +
          '<div class="brand">' +
            '<span class="brand__mark" aria-hidden="true">A</span>' +
            '<span class="brand__name">Ashford &amp; Rowe</span>' +
            '<span class="brand__you">' +
              (t.name ? esc(t.name) + ' \u00b7 the new analyst' : 'You: the new analyst') +
            '</span>' +
          '</div>' +
          '<div class="topbar__spacer"></div>' +
          '<div class="topbar__meta">' +
            '<span>Deals <span class="meta-strong tnum">' + t.deals_done + '/' + t.deals_total + '</span></span>' +
            '<span>Points <span class="meta-strong tnum">' + t.points + '</span></span>' +
            '<span class="clock' + (t.clock_low ? ' clock--low' : '') + '">' +
              'Time left <span class="meta-strong tnum" id="clock-value">' +
                esc(clockLabel(clockSecs)) + '</span>' +
            '</span>' +
            '<span>Guidance <span class="meta-strong">' +
              (t.guidance === 'less' ? 'Less' : 'Normal') + '</span></span>' +
            '<button class="btn btn--ghost btn--sm" data-action="restart" data-payload="{}">Restart</button>' +
          '</div>' +
        '</div>' +
        renderChips() +
      '</header>';
  }

  function renderChips() {
    var html = '<div class="chips" role="list" aria-label="Programme stages">';
    payload.chips.forEach(function (c) {
      var cls = 'chip';
      var title = '';
      if (c.state === 'unbuilt') { cls += ' chip--sample'; title = ' title="Not part of this three-stage sample"'; }
      else if (c.state === 'active') cls += ' chip--active';
      else if (c.state === 'done') cls += ' chip--done';
      html += '<span class="' + cls + '" role="listitem"' + title + '>' +
                '<span class="chip__num">' + c.n + '</span>' + esc(c.label) +
              '</span>';
    });
    return html + '</div>';
  }

  function renderRail() {
    var r = payload.rail;
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
          '<span class="companion__tag">' + esc(payload.companion.tag) + '</span>' +
          '<p class="companion__line">' + esc(payload.companion.line) + '</p>' +
        '</div>' +
        '<div class="rail-card">' +
          '<span class="rail-card__title">Briefing progress</span>' +
          '<div class="progress">' +
            '<span class="progress__track"><span class="progress__bar" style="width:' +
              r.progress.pct + '%"></span></span>' +
            '<span class="progress__label tnum">' + esc(r.progress.label) + '</span>' +
          '</div>' +
          '<p class="small muted">Six words opened, four questions answered. ' +
            'Points come from the questions only.</p>' +
        '</div>' +
      '</aside>';

    return html;
  }

  /* ======================================================================
     Stage 1 — Welcome
     ====================================================================== */

  function renderWelcome(v) {
    if (v.screen === 'title') return welcomeTitle(v);
    if (v.screen === 'identity') return welcomeIdentity(v);
    if (v.screen === 'role') return welcomeRole(v);
    return welcomeDesk(v);
  }

  function welcomeTitle(v) {
    return '' +
      '<div class="welcome">' +
        '<span class="welcome__mark" aria-hidden="true">A</span>' +
        '<span class="sample-badge"><span class="sample-badge__dot"></span>' +
          'Three-stage sample of an eleven-stage programme</span>' +
        '<h1>' + esc(v.title) + '</h1>' +
        '<p class="welcome__lede">' + esc(v.lede) + '</p>' +
        '<div class="welcome__facts">' +
          v.facts.map(function (f) {
            return '<span class="fact"><span class="fact__dot"></span>' + esc(f) + '</span>';
          }).join('') +
        '</div>' +
        '<p class="welcome__note">' + esc(v.note) + '</p>' +
        '<div class="btn-row">' +
          '<button class="btn btn--primary" data-action="welcome.next" data-payload="{}">' +
            'Start simulation</button>' +
          '<button class="btn" data-action="welcome.tutorial" data-payload="{}">' +
            (v.tutorial_open ? 'Hide tutorial' : 'Watch tutorial (1 min)') + '</button>' +
        '</div>' +
        (v.tutorial_open ? tutorialPanel(v.tutorial) : '') +
        '<p class="small muted">' + esc(v.footnote) + '</p>' +
      '</div>';
  }

  function tutorialPanel(lines) {
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
          lines.map(function (l) {
            return '<p style="margin-bottom:8px"><strong>' + esc(l.speaker) + ':</strong> ' +
                   esc(l.line) + '</p>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function welcomeIdentity(v) {
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
            'placeholder="Type your name" value="' + esc(draft.name) + '">' +
          '<span class="field__hint">Shown on the leaderboard and on your report. ' +
            'You can hide it from the board later.</span>' +
        '</div>' +
        '<div class="nda">' +
          '<span class="nda__title">Confidentiality</span>' +
          '<p>Live deals are never discussed by name. Until the Truth, every target in this ' +
            'programme is referred to by a codename only.</p>' +
          '<div class="codenames">' +
            v.codenames.map(function (c) {
              return '<span class="codename">' + esc(c) + '</span>';
            }).join('') +
          '</div>' +
          '<label class="check">' +
            '<input type="checkbox" id="nda-box"' + (draft.nda ? ' checked' : '') + '>' +
            '<span>I agree to keep client names confidential until the Truth.</span>' +
          '</label>' +
        '</div>' +
        '<div class="field">' +
          '<label>Guidance mode</label>' +
          '<div class="mode-row">' +
            v.modes.map(function (m) {
              return '<button class="mode' + (draft.guidance === m.id ? ' mode--on' : '') + '" ' +
                       'data-action="draft.guidance" data-payload="' + attr({ mode: m.id }) + '">' +
                       '<span class="mode__name">' + esc(m.name) + '</span>' +
                       '<span class="mode__desc">' + esc(m.desc) + '</span>' +
                     '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted" id="identity-status"></span>' +
        '<button class="btn btn--primary" id="identity-continue" ' +
          'data-action="welcome.identity.submit" data-payload="{}">Continue</button>' +
      '</div></div>';
  }

  function welcomeRole(v) {
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 1 \u00b7 Screen 1.3</span>' +
        '<h1>What bankers do</h1>' +
        '<p class="stage-head__lede">Four jobs, in plain words. Today you are on the buy side.</p>' +
      '</div>' +
      '<div class="card"><div class="card__body">' +
        '<div class="word-grid">' +
          v.jobs.map(function (j) {
            return '<div class="word-card" style="min-height:auto">' +
                     '<span class="word-card__word">' + esc(j.title) + '</span>' +
                     '<span class="word-card__example">' + esc(j.desc) + '</span>' +
                   '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">One more screen and the desk is yours.</span>' +
        '<button class="btn btn--primary" data-action="welcome.next" data-payload="{}">Continue</button>' +
      '</div></div>';
  }

  /* Mandate cards are never interactive in this sample: opening one is stage 4
     and stage 4 is not built, so they are plain elements rather than buttons
     that would do nothing. The open mandate is still visually distinct. */
  function dealCards(deals) {
    return deals.map(function (d) {
      var cls = d.open ? 'deal-card deal-card--open' : 'deal-card deal-card--locked';
      return '<div class="' + cls + '">' +
               '<span class="deal-card__sector">' + esc(d.sector) + ' \u00b7 ' + d.year + '</span>' +
               '<span class="deal-card__code">' + esc(d.code) + '</span>' +
               '<span class="deal-card__status">' + esc(d.note) + '</span>' +
               (d.open ? '' : '<span class="deal-card__mark" aria-hidden="true">?</span>') +
             '</div>';
    }).join('');
  }

  function welcomeDesk(v) {
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 1 \u00b7 Screen 1.4</span>' +
        '<h1>Your job today</h1>' +
        '<p class="stage-head__lede">Five face-down deal cards. Sector and year only \u2014 ' +
          'the company names stay hidden until the Truth.</p>' +
      '</div>' +
      '<div class="card"><div class="card__body">' +
        '<div class="dealbook">' + dealCards(v.deals) + '</div>' +
        '<div class="rule"></div>' +
        '<p class="small muted">' + esc(v.footer) + '</p>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">The words come first. Read them before you look at ' +
          'any number.</span>' +
        '<button class="btn btn--primary" data-action="brief.open" data-payload="{}">' +
          'Open the Briefing Room</button>' +
      '</div></div>';
  }

  /* ======================================================================
     Stage 2 — Briefing Room
     ====================================================================== */

  function renderBrief(v) {
    if (v.screen === 'quiz') return briefQuiz(v);
    return briefBriefing(v);
  }

  function briefBriefing(v) {
    var cards = v.words.map(function (w) {
      return '' +
        '<button class="word-card' + (w.open ? ' word-card--open' : '') + '" ' +
          'data-action="brief.open_word" data-payload="' + attr({ word_id: w.id }) + '" ' +
          'aria-pressed="' + (w.open ? 'true' : 'false') + '">' +
          (w.open ? '<span class="word-card__check" aria-hidden="true">\u2713</span>' : '') +
          '<span class="word-card__word">' + esc(w.word) + '</span>' +
          (w.open
            ? '<span class="word-card__meaning">' + esc(w.meaning) + '</span>' +
              '<span class="word-card__example">' + esc(w.example) + '</span>' +
              '<span class="word-card__where">Matters most in \u00b7 ' + esc(w.where) + '</span>'
            : '<span class="word-card__cue">Tap to see the meaning and an example</span>') +
        '</button>';
    }).join('');

    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 2 \u00b7 Briefing Room</span>' +
        '<h1>' + esc(v.lede) + '</h1>' +
        '<p class="stage-head__lede">' + esc(v.hint) + '</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">Six words you will use today</span>' +
          '<span class="card__meta tnum">' + v.opened + ' of ' + v.total + ' opened</span>' +
        '</div>' +
        '<div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
          '<div class="progress">' +
            '<span class="progress__track"><span class="progress__bar" style="width:' +
              v.pct + '%"></span></span>' +
            '<span class="progress__label tnum">' + v.pct + '%</span>' +
          '</div>' +
          '<div class="word-grid">' + cards + '</div>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted">' +
            (v.can_start_quiz
              ? 'All six opened. Four quick questions next.'
              : 'Open all six to continue \u2014 or reveal them if you already know these words.') +
          '</span>' +
          '<div class="btn-row">' +
            (v.can_start_quiz ? '' :
              '<button class="btn btn--ghost btn--sm" data-action="brief.reveal_all" ' +
              'data-payload="{}">Reveal all</button>') +
            '<button class="btn btn--primary" data-action="brief.start_quiz" data-payload="{}"' +
              (v.can_start_quiz ? '' : ' disabled') + '>Four quick questions</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function briefQuiz(v) {
    var letters = ['A', 'B', 'C', 'D'];
    var options = v.question.options.map(function (text, i) {
      var cls = 'option';
      if (v.answered) {
        /* The server told us the answer only because it has been answered. */
        if (i === v.correct_index) cls += ' option--right';
        else if (i === v.picked) cls += ' option--wrong';
      }
      return '<button class="' + cls + '" data-action="brief.answer" ' +
               'data-payload="' + attr({ index: i }) + '"' + (v.answered ? ' disabled' : '') + '>' +
               '<span class="option__key" aria-hidden="true">' + letters[i] + '</span>' +
               '<span>' + esc(text) + '</span>' +
             '</button>';
    }).join('');

    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 2 \u00b7 Quick check \u00b7 Question ' + v.number +
          ' of ' + v.total + '</span>' +
        '<h1>Four quick questions</h1>' +
        '<p class="stage-head__lede">Twenty-five points each. You get the explanation either way.</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title tnum">Question ' + v.number + ' of ' + v.total + '</span>' +
          '<span class="card__meta tnum">' + v.points + ' points</span>' +
        '</div>' +
        '<div class="card__body quiz">' +
          '<p class="quiz__prompt">' + esc(v.question.prompt) + '</p>' +
          '<div class="options">' + options + '</div>' +
          (v.answered ? '<p class="explain">' + esc(v.why) + '</p>' : '') +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted tnum">' + v.answered_count + ' of ' + v.total + ' answered</span>' +
          '<button class="btn btn--primary" data-action="brief.next_question" data-payload="{}"' +
            (v.can_advance ? '' : ' disabled') + '>' +
            (v.is_last ? 'To the Deal Book' : 'Next question') + '</button>' +
        '</div>' +
      '</div>';
  }

  /* ======================================================================
     Stage 3 — Deal Book
     ====================================================================== */

  function renderDealBook(v) {
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Stage 3 \u00b7 Deal Book</span>' +
        '<h1>' + esc(v.lede) + '</h1>' +
        '<p class="stage-head__lede">' + esc(v.hint) + '</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">On your desk</span>' +
          '<span class="card__meta">' + (v.brief_done ? 'Briefing complete' : '') + '</span>' +
        '</div>' +
        '<div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
          '<div class="dealbook">' + dealCards(v.deals) + '</div>' +
          '<div class="rule"></div>' +
          '<p class="small muted">' + esc(v.footer) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">Your run so far</span>' +
          '<span class="card__meta tnum">' + esc(v.summary[1].value) + ' points</span>' +
        '</div>' +
        '<div class="card__body">' +
          '<table class="summary-table"><tbody>' +
            v.summary.map(function (row) {
              return '<tr><td>' + esc(row.label) + '</td><td>' + esc(row.value) + '</td></tr>';
            }).join('') +
          '</tbody></table>' +
          '<div class="rule"></div>' +
          '<p class="small muted">' + esc(v.close) + '</p>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted">Six skill scores and a leaderboard arrive at the ' +
            'Report stage.</span>' +
          '<button class="btn" data-action="restart" data-payload="{}">Run it again</button>' +
        '</div>' +
      '</div>';
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function render() {
    var v = payload.view;
    var main;
    if (v.kind === 'welcome') main = renderWelcome(v);
    else if (v.kind === 'brief') main = renderBrief(v);
    else main = renderDealBook(v);

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

    if (v.kind === 'welcome' && v.screen === 'identity') refreshIdentityGate();
  }

  /* The name and the confidentiality tick are a draft the browser holds until
     it submits them, so the button's enabled state is computed here. This is
     a courtesy to the player; the rule itself is enforced in Python, and a
     submit that skips it is rejected. */
  function refreshIdentityGate() {
    var button = document.getElementById('identity-continue');
    var status = document.getElementById('identity-status');
    if (!button) return;
    var ready = draft.name.trim().length > 0 && draft.nda;
    button.disabled = !ready;
    if (status) {
      status.textContent = ready
        ? 'Ready.'
        : 'Add a name and sign the note to continue.';
    }
  }

  /* ======================================================================
     Events
     ====================================================================== */

  document.addEventListener('click', function (event) {
    var el = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!el || el.disabled) return;

    var action = el.getAttribute('data-action');
    if (!action) return;

    if (action === 'restart') {
      if (window.confirm('Start this track again? Your current run will be cleared.')) {
        post('restart', {}, { force: true });
      }
      return;
    }

    /* Two actions carry a draft rather than a fixed payload. */
    if (action === 'welcome.identity.submit') {
      post(action, { name: draft.name, nda: draft.nda, guidance: draft.guidance });
      return;
    }
    if (action === 'draft.guidance') {
      draft.guidance = JSON.parse(el.getAttribute('data-payload') || '{}').mode;
      render();
      return;
    }

    var raw = el.getAttribute('data-payload');
    var body = {};
    if (raw) {
      try { body = JSON.parse(raw); } catch (err) { body = {}; }
    }
    post(action, body);
  }, false);

  document.addEventListener('input', function (event) {
    var el = event.target;
    if (!el || !el.id) return;
    if (el.id === 'analyst-name') {
      draft.name = el.value;
      refreshIdentityGate();
    }
  }, false);

  document.addEventListener('change', function (event) {
    var el = event.target;
    if (el && el.id === 'nda-box') {
      draft.nda = !!el.checked;
      refreshIdentityGate();
    }
  }, false);

  /* The clock ticks locally between actions so it does not look frozen, and
     every server response resyncs it. The server's value is the truth. */
  window.setInterval(function () {
    if (clockSecs === null || clockSecs <= 0) return;
    clockSecs -= 1;
    var node = document.getElementById('clock-value');
    if (node) node.textContent = clockLabel(clockSecs);
  }, 1000);

  load();
})();
