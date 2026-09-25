/* ==========================================================================
   Investment Banking Simulation — client.

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

   Style: ES5, no dependencies, no build step.
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
        app.innerHTML = '<p class="empty">' +
          'Could not reach the server. Is <code>python app.py</code> still running?</p>';
      });
  }

  /* ======================================================================
     Chrome
     ====================================================================== */

  function renderTopbar() {
    var t = payload.topbar;
    return '' +
      '<header class="topbar">' +
        '<div class="brand">' +
          '<span class="brand__name">Ashford &amp; Rowe</span>' +
          '<span class="brand__you">' +
            (t.name ? esc(t.name) : 'the new analyst') +
          '</span>' +
        '</div>' +
        '<div class="topbar__spacer"></div>' +
        '<span class="stat tnum">Deals <span class="stat__value">' +
          t.deals_done + '/' + t.deals_total + '</span></span>' +
        '<span class="stat tnum">Points <span class="stat__value">' +
          t.points + '</span></span>' +
        '<span class="stat' + (t.clock_low ? ' stat--low' : '') + '">Left ' +
          '<span class="stat__value" id="clock-value">' +
            esc(clockLabel(clockSecs)) + '</span></span>' +
        renderChips() +
      '</header>';
  }

  /* Eleven marks: the three the player can reach, and the eight that are locked.

     A locked chip is a span with no data-action, so there is nothing to click
     and nothing for the delegated handler to fire. It carries a number, a name
     and a padlock — the shape of the programme, and no more. The padlock is
     inline SVG rather than an emoji so it inherits ink and never arrives as a
     colour glyph that fights the palette. */
  var LOCK = '<svg class="chip__lock" viewBox="0 0 12 14" width="9" height="11" ' +
             'aria-hidden="true" focusable="false">' +
             '<path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" ' +
             'stroke-width="1.4"/><rect x="1" y="6" width="10" height="7" ' +
             'fill="currentColor"/></svg>';

  function renderChips() {
    var html = '<nav class="rail" aria-label="Stages">';
    payload.chips.forEach(function (c) {
      var cls = 'chip chip--' + c.state;
      var mark = c.state === 'active' ? ' aria-current="step"'
              : c.state === 'locked' ? ' aria-disabled="true"'
              : '';
      html += '<span class="' + cls + '"' + mark + '>' +
                '<span class="chip__num">' + c.n + '</span>' +
                '<span class="chip__name">' + esc(c.label) + '</span>' +
                (c.state === 'locked' ? LOCK : '') +
              '</span>';
    });
    return html + '</nav>';
  }

  /* Meera. One line, above the content, in the flow rather than in a rail —
     a persistent companion does not need a panel of her own to stay present. */
  function renderCompanion() {
    return '' +
      '<aside class="companion">' +
        '<span class="companion__avatar" aria-hidden="true">MS</span>' +
        '<p class="companion__line">' +
          '<span class="companion__name">Meera</span> \u00b7 ' +
          esc(payload.companion.line) + '</p>' +
      '</aside>';
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
        '<h1>' + esc(v.title) + '</h1>' +
        '<p class="welcome__lede">' + esc(v.lede) + '</p>' +
        '<p class="welcome__note">' + esc(v.note) + '</p>' +
        '<div class="welcome__facts">' +
          v.facts.map(function (f) {
            return '<span class="fact"><span class="fact__dot"></span>' + esc(f) + '</span>';
          }).join('') +
        '</div>' +
        '<div class="btn-row">' +
          '<button class="btn btn--primary" data-action="welcome.next" data-payload="{}">' +
            'Start</button>' +
          '<button class="btn btn--ghost" data-action="welcome.tutorial" data-payload="{}">' +
            (v.tutorial_open ? 'Hide the tour' : '1 min tour') + '</button>' +
        '</div>' +
        (v.tutorial_open ? tutorialPanel(v.tutorial) : '') +
      '</div>';
  }

  function tutorialPanel(lines) {
    return '' +
      '<div class="card tutorial">' +
        '<div class="card__head">' +
          '<span class="card__title">The tour</span>' +
          '<span class="card__meta">1 min \u00b7 read or skip</span>' +
        '</div>' +
        '<div class="card__body">' +
          lines.map(function (l) {
            return '<p><strong>' + esc(l.speaker) + ':</strong> ' + esc(l.line) + '</p>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function welcomeIdentity(v) {
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Sign in</span>' +
        '<h1>Who you are</h1>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__body" style="display:flex;flex-direction:column;gap:20px">' +
          '<div class="field">' +
            '<label for="analyst-name">Your name</label>' +
            '<input class="input" id="analyst-name" type="text" maxlength="40" ' +
              'placeholder="Type your name" value="' + esc(draft.name) + '">' +
          '</div>' +
          '<div class="nda">' +
            '<span class="nda__title">Confidentiality</span>' +
            '<p>Every target is a codename. Those five are yours today:</p>' +
            '<div class="codenames">' +
              v.codenames.map(function (c) {
                return '<span class="codename">' + esc(c) + '</span>';
              }).join('') +
            '</div>' +
            '<label class="check">' +
              '<input type="checkbox" id="nda-box"' + (draft.nda ? ' checked' : '') + '>' +
              '<span>I will keep the names confidential.</span>' +
            '</label>' +
          '</div>' +
          '<div class="field">' +
            '<label>Guidance</label>' +
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
          '<span class="small" id="identity-status"></span>' +
          '<button class="btn btn--primary" id="identity-continue" ' +
            'data-action="welcome.identity.submit" data-payload="{}">Continue</button>' +
        '</div>' +
      '</div>';
  }

  function welcomeRole(v) {
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Your job</span>' +
        '<h1>What bankers do</h1>' +
        '<p class="stage-head__lede">Four jobs. Yours today is the buy side.</p>' +
      '</div>' +
      '<div class="card"><div class="card__body">' +
        '<div class="job-list">' +
          v.jobs.map(function (j) {
            return '<div class="job">' +
                     '<span class="job__title">' + esc(j.title) + '</span>' +
                     '<span class="job__desc">' + esc(j.desc) + '</span>' +
                   '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small">One more screen.</span>' +
        '<button class="btn btn--primary" data-action="welcome.next" data-payload="{}">Continue</button>' +
      '</div></div>';
  }

  /* Mandate cards are not buttons: a mandate has no page to open yet, and a
     button that does nothing is worse than no button. The open one is the
     only one the player is on, so it is the only one that takes the accent. */
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
        '<span class="eyebrow">Your job today</span>' +
        '<h1>Five mandates</h1>' +
        '<p class="stage-head__lede">Sector and year only. That is all the card shows.</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">On your desk</span>' +
          '<span class="card__meta">1 open</span>' +
        '</div>' +
        '<div class="card__body">' +
          '<div class="dealbook">' + dealCards(v.deals) + '</div>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small">Read the words first.</span>' +
          '<button class="btn btn--primary" data-action="brief.open" data-payload="{}">' +
            'Open the Briefing Room</button>' +
        '</div>' +
      '</div>';
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
              '<span class="word-card__where">' + esc(w.where) + '</span>'
            : '') +
        '</button>';
    }).join('');

    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Briefing</span>' +
        '<h1>' + esc(v.lede) + '</h1>' +
        '<p class="stage-head__lede">' + esc(v.hint) + '</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">Opened</span>' +
          '<span class="card__meta tnum">' + v.opened + ' / ' + v.total + '</span>' +
        '</div>' +
        '<div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
          '<div class="progress">' +
            '<span class="progress__track"><span class="progress__bar" style="width:' +
              v.pct + '%"></span></span>' +
          '</div>' +
          '<div class="word-grid">' + cards + '</div>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small">' +
            (v.can_start_quiz ? 'All six open.' : 'Open all six to continue.') +
          '</span>' +
          '<div class="btn-row">' +
            (v.can_start_quiz ? '' :
              '<button class="btn btn--ghost btn--sm" data-action="brief.reveal_all" ' +
              'data-payload="{}">Reveal all</button>') +
            '<button class="btn btn--primary" data-action="brief.start_quiz" data-payload="{}"' +
              (v.can_start_quiz ? '' : ' disabled') + '>Quick check</button>' +
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

    /* The question is the heading. The number, the points and the tally are
       chrome around it, not a paragraph above it. */
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Quick check \u00b7 ' + v.number + ' of ' + v.total + '</span>' +
        '<h1>' + esc(v.question.prompt) + '</h1>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__body">' +
          '<div class="options">' + options + '</div>' +
          (v.answered ? '<p class="explain">' + esc(v.why) + '</p>' : '') +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small tnum">' + v.answered_count + ' of ' + v.total + ' \u00b7 ' +
            v.points + ' pts</span>' +
          '<button class="btn btn--primary" data-action="brief.next_question" data-payload="{}"' +
            (v.can_advance ? '' : ' disabled') + '>' +
            (v.is_last ? 'To your desk' : 'Next') + '</button>' +
        '</div>' +
      '</div>';
  }

  /* ======================================================================
     Stage 3 — Deal Book
     ====================================================================== */

  function renderDealBook(v) {
    var receipts = v.receipts.map(function (r) {
      return '<div class="receipt">' +
               '<span class="receipt__label">' + esc(r.label) + '</span>' +
               '<span class="receipt__value tnum">' + r.value + '</span>' +
             '</div>';
    }).join('');

    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">Deal Book</span>' +
        '<h1>' + esc(v.lede) + '</h1>' +
        '<p class="stage-head__lede">' + esc(v.hint) + '</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">Mandates</span>' +
          '<span class="card__meta">' + (v.brief_done ? 'Briefing complete' : '') + '</span>' +
        '</div>' +
        '<div class="card__body">' +
          '<div class="dealbook">' + dealCards(v.deals) + '</div>' +
          '<div class="receipts">' + receipts + '</div>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small">' + esc(v.footer) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<span class="card__title">Your run</span>' +
          '<span class="card__meta tnum">' + esc(v.summary[1].value) + ' pts</span>' +
        '</div>' +
        '<div class="card__body">' +
          '<table class="summary-table"><tbody>' +
            v.summary.map(function (row) {
              return '<tr><td>' + esc(row.label) + '</td><td>' + esc(row.value) + '</td></tr>';
            }).join('') +
          '</tbody></table>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small">' + esc(v.close) + '</span>' +
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

    /* .app is the full-height frame: the footer is pinned by main growing, so a
       short screen has no void under it. The topbar breaks out of the content
       column so the rail has room for all eleven marks on one line. */
    app.innerHTML = '' +
      '<div class="app">' +
        '<div class="topbar-wrap">' + renderTopbar() + '</div>' +
        '<div class="shell">' +
          renderCompanion() +
          '<main class="main' + (v.kind === 'welcome' && v.screen === 'title'
            ? ' main--centred' : '') + '">' + main + '</main>' +
          '<footer class="footer">' +
            '<span>Ashford &amp; Rowe \u00b7 Meera Sethi, Managing Director</span>' +
            '<span>Career Discovery Program</span>' +
          '</footer>' +
        '</div>' +
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
      status.textContent = ready ? 'Ready.' : 'Add a name and sign the note.';
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
