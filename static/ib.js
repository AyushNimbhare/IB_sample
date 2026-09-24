/* ==========================================================================
   FinTree CDP — Investment Banking sample. Client.

   This file is a VIEW LAYER and nothing else. It has no idea:
     - which quiz answer is correct
     - which metric is the right one
     - what the fair range is
     - whether a step may be reached
     - what a call scores

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
  var noteDraft = '';
  var noteSeeded = false;

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
    if (!noteSeeded && state.view.kind === 'prism' && state.view.review) {
      noteDraft = state.view.review.note || '';
      noteSeeded = true;
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
        '</div>';

    if (r.show_tray) {
      html += '<div class="rail-card">' +
        '<span class="rail-card__title">Evidence tray \u00b7 ' + r.tray.length + ' saved</span>';
      if (!r.tray.length) {
        html += '<p class="tray__empty">Save a fact or a risk as you read. ' +
                'Meera refers back to what you saved.</p>';
      } else {
        r.tray.forEach(function (item) {
          var kind = item.kind === 'risk' ? ' tray__kind--risk' : ' tray__kind--fact';
          html += '<div class="tray__item">' +
                    '<span class="tray__kind' + kind + '">' + esc(item.kind) + '</span>' +
                    '<span>' + esc(item.text) + '</span>' +
                  '</div>';
        });
      }
      html += '</div>';
    }

    html += '<div class="rail-card">' +
      '<span class="rail-card__title">Briefing progress</span>' +
      '<div class="progress">' +
        '<span class="progress__track"><span class="progress__bar" style="width:' +
          r.progress.pct + '%"></span></span>' +
        '<span class="progress__label tnum">' + esc(r.progress.label) + '</span>' +
      '</div>' +
      '<p class="small muted">Six words opened, four questions answered. ' +
        'Points come from the questions only.</p>' +
    '</div>';

    return html + '</aside>';
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

  function dealCards(deals, interactive) {
    return deals.map(function (d) {
      var cls = d.open ? 'deal-card deal-card--open' : 'deal-card deal-card--locked';
      var open = interactive && d.open;
      var tag = open ? 'button' : (interactive ? 'button' : 'div');
      return '<' + tag + ' class="' + cls + '"' +
               (open ? ' data-action="deal.open" data-payload="' + attr({ deal_id: d.code.toLowerCase() }) + '"' : '') +
               (interactive && !d.open ? ' disabled' : '') + '>' +
               '<span class="deal-card__sector">' + esc(d.sector) + ' \u00b7 ' + d.year + '</span>' +
               '<span class="deal-card__code">' + esc(d.code) + '</span>' +
               '<span class="deal-card__status">' + esc(d.note) + '</span>' +
               (d.open ? '' : '<span class="deal-card__mark" aria-hidden="true">?</span>') +
             '</' + tag + '>';
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
        '<div class="dealbook">' + dealCards(v.deals, false) + '</div>' +
        '<div class="rule"></div>' +
        '<p class="small muted">' + esc(v.footer) + '</p>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">Start with Prism. Read the brief before you look at any number.</span>' +
        '<button class="btn btn--primary" data-action="brief.open" data-payload="{}">' +
          'Open the Briefing Room</button>' +
      '</div></div>';
  }

  /* ======================================================================
     Stage 2 — Briefing Room
     ====================================================================== */

  function renderBrief(v) {
    if (v.screen === 'briefing') return briefBriefing(v);
    if (v.screen === 'quiz') return briefQuiz(v);
    return briefDealBook(v);
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

  function briefDealBook(v) {
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
          '<div class="dealbook">' + dealCards(v.deals, true) + '</div>' +
          '<div class="rule"></div>' +
          '<p class="small muted">' + esc(v.footer) + '</p>' +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted">Deals open one at a time, in a fixed order.</span>' +
          '<button class="btn btn--primary" data-action="deal.open" ' +
            'data-payload="' + attr({ deal_id: 'prism' }) + '">Open Project Prism</button>' +
        '</div>' +
      '</div>';
  }

  /* ======================================================================
     Stage 3 — Project Prism
     ====================================================================== */

  function prismHead(v) {
    return '' +
      '<div class="stage-head">' +
        '<span class="eyebrow">' + esc(v.head.eyebrow) + '</span>' +
        '<h1>' + esc(v.head.title) + '</h1>' +
        '<p class="stage-head__lede">' + esc(v.head.lede) + '</p>' +
      '</div>';
  }

  function renderPrism(v) {
    if (v.step === 'brief') return prismBrief(v);
    if (v.step === 'research') return prismResearch(v);
    if (v.step === 'task') return prismTask(v);
    if (v.step === 'review') return prismReview(v);
    if (v.step === 'receipt') return prismReceipt(v);
    return prismCall(v);
  }

  function prismBrief(v) {
    return '' +
      prismHead(v) +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
        '<p class="lede">' + esc(v.brief.body) + '</p>' +
        '<div class="nda" style="border-style:solid">' +
          '<span class="nda__title">' + esc(v.brief.mood_label) + '</span>' +
          '<p>' + esc(v.brief.mood_line) + '</p>' +
        '</div>' +
        '<div class="btn-row">' +
          '<span class="sample-badge">Skills \u00b7 ' + esc(v.skills.join(' \u00b7 ')) + '</span>' +
          '<span class="sample-badge">' + esc(v.step_of) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">Research is next. Nothing you read costs points.</span>' +
        '<button class="btn btn--primary" data-action="deal.step" ' +
          'data-payload="' + attr({ step: 'research' }) + '">Open the Deal Terminal</button>' +
      '</div></div>';
  }

  function prismResearch(v) {
    var r = v.research;
    var page = r.page;

    var body = '<p class="lede">' + esc(page.body) + '</p>';

    if (page.stats && page.stats.length) {
      body += '<div class="stat-grid">' + page.stats.map(function (s) {
        return '<div class="stat' + (s.tone === 'good' ? ' stat--good' : '') + '">' +
                 '<span class="stat__label">' + esc(s.label) + '</span>' +
                 '<span class="stat__value">' + esc(s.value) + '</span>' +
                 (s.note ? '<span class="stat__note">' + esc(s.note) + '</span>' : '') +
               '</div>';
      }).join('') + '</div>';
    }

    if (page.items && page.items.length) {
      body += '<div class="item-list">' + page.items.map(function (it) {
        return '<div class="item">' +
                 '<span class="item__main">' +
                   (it.date ? '<span class="item__date">' + esc(it.date) + '</span>' : '') +
                   '<span class="item__text">' + esc(it.text) + '</span>' +
                 '</span>' +
                 (it.flag ? '<span class="flag flag--' + esc(it.flag) + '">' + esc(it.flag) + '</span>' : '') +
                 '<span class="item__save">' +
                   (it.saved
                     ? '<span class="flag flag--good">Saved</span>'
                     : '<button class="btn btn--ghost btn--sm" data-action="deal.save_evidence" ' +
                       'data-payload="' + attr({ text: it.text, kind: it.kind }) + '">Save</button>') +
                 '</span>' +
               '</div>';
      }).join('') + '</div>';
    }

    return '' +
      prismHead(v) +
      '<div class="card" style="overflow:hidden">' +
        '<div class="terminal__bar">' +
          '<span class="terminal__dots" aria-hidden="true">' +
            '<span class="terminal__dot"></span><span class="terminal__dot"></span>' +
            '<span class="terminal__dot"></span>' +
          '</span>' +
          '<span>' + esc(r.address) + '</span>' +
        '</div>' +
        '<div class="tabs" role="tablist">' +
          r.tabs.map(function (t) {
            return '<button class="tab' + (t.on ? ' tab--on' : '') + '" role="tab" ' +
                     'data-action="deal.tab" data-payload="' + attr({ page: t.id }) + '">' +
                     esc(t.label) +
                     (t.seen ? '<span class="tab__seen" aria-hidden="true">\u2713</span>' : '') +
                   '</button>';
          }).join('') +
        '</div>' +
        '<div class="terminal__page">' +
          '<span class="card__meta">' + esc(page.title) + '</span>' +
          body +
        '</div>' +
        '<div class="card__foot">' +
          '<span class="small muted tnum">' + r.seen + ' of ' + r.total + ' pages opened' +
            ' \u00b7 research is not a quiz, you may move on at any time</span>' +
          '<button class="btn btn--primary" data-action="deal.step" ' +
            'data-payload="' + attr({ step: 'task' }) + '">Go to the task</button>' +
        '</div>' +
      '</div>';
  }

  function rangeBar(range) {
    return '' +
      '<div class="rangebar">' +
        '<div class="rangebar__track">' +
          '<span class="rangebar__band" style="left:' + range.band_left_pct + '%;width:' +
            range.band_width_pct + '%"></span>' +
          '<span class="rangebar__marker" style="left:' + range.marker_left_pct + '%"></span>' +
        '</div>' +
        '<div class="rangebar__scale"><span>' + esc(range.scale_min_label) + '</span>' +
          '<span>' + esc(range.scale_max_label) + '</span></div>' +
        '<div class="rangebar__legend">' +
          '<span class="legend-item"><span class="legend-swatch"></span>Fair range, ' +
            esc(range.low_label) + ' to ' + esc(range.high_label) + '</span>' +
          '<span class="legend-item"><span class="legend-line"></span>Your price, ' +
            esc(range.price_label) + '</span>' +
        '</div>' +
      '</div>';
  }

  function prismTask(v) {
    var t = v.task;

    var metrics = t.metrics.map(function (m) {
      var cls = 'metric';
      if (m.state === 'correct') cls += ' metric--right';
      else if (m.state === 'wrong') cls += ' metric--wrong';
      return '<button class="' + cls + '" data-action="deal.pick_metric" ' +
               'data-payload="' + attr({ metric_id: m.id }) + '"' +
               (t.can_continue ? ' disabled' : '') + '>' +
               '<span class="metric__label">' + esc(m.label) + '</span>' +
               '<span class="metric__value">' + esc(m.value) + '</span>' +
               (m.note ? '<span class="metric__note">' + esc(m.note) + '</span>' : '') +
             '</button>';
    }).join('');

    var html = prismHead(v) +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:16px">' +
        '<div class="metric-grid">' + metrics + '</div>';

    if (t.explanation) {
      html += '<p class="explain">' + esc(t.explanation) + '</p>';
    }

    if (t.show_range) {
      html += '<div class="rule"></div>' +
        '<span class="card__title">' + esc(t.per_user_label) + '</span>' +
        '<div class="item-list">' +
          t.per_user.map(function (p) {
            return '<div class="item">' +
                     '<span class="item__main"><span class="item__text">' + esc(p.label) + '</span></span>' +
                     '<span class="item__date tnum">' + esc(p.value_label) + '</span>' +
                   '</div>';
          }).join('') +
        '</div>' +
        '<div class="rule"></div>' +
        '<div class="range-summary">' +
          '<strong>' + esc(t.range_label) + '</strong>' +
          '<span class="range-summary__calc">' + esc(t.range.calc) + '</span>' +
          '<span class="small muted">' + esc(t.range.note) + '</span>' +
        '</div>' +
        rangeBar(t.range);
    }

    html += '</div><div class="card__foot">' +
      '<span class="small muted">' +
        (t.can_continue ? 'Range built. Make the call next.'
                        : 'Pick the number that matters most to the buyer.') +
      '</span>' +
      '<button class="btn btn--primary" data-action="deal.step" ' +
        'data-payload="' + attr({ step: 'call' }) + '"' +
        (t.can_continue ? '' : ' disabled') + '>Make the call</button>' +
      '</div></div>';

    return html;
  }

  function prismCall(v) {
    var c = v.call;

    var html = prismHead(v) +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:18px">' +
        '<div class="call-grid">' +
          c.choices.map(function (ch) {
            return '<button class="call-choice' + (ch.selected ? ' call-choice--on' : '') + '" ' +
                     'data-action="deal.pick_call" data-payload="' + attr({ choice_id: ch.id }) + '">' +
                     '<span class="call-choice__label">' + esc(ch.label) + '</span>' +
                     '<span class="call-choice__blurb">' + esc(ch.blurb) + '</span>' +
                   '</button>';
          }).join('') +
        '</div>';

    if (c.show_protections) {
      html += '<div class="rule"></div>' +
        '<div style="display:flex;flex-direction:column;gap:9px">' +
          '<span class="card__title">' + esc(c.protection_label) + '</span>' +
          '<p class="small muted">' + esc(c.protection_note) + '</p>' +
          '<div class="protection-grid">' +
            c.protections.map(function (p) {
              return '<button class="protection' + (p.selected ? ' protection--on' : '') + '" ' +
                       'data-action="deal.toggle_protection" ' +
                       'data-payload="' + attr({ protection_id: p.id }) + '" ' +
                       'aria-pressed="' + (p.selected ? 'true' : 'false') + '">' +
                       '<span class="protection__box" aria-hidden="true">' +
                         (p.selected ? '\u2713' : '') + '</span>' +
                       '<span>' + esc(p.label) +
                         '<span class="protection__blurb">' + esc(p.blurb) + '</span>' +
                       '</span>' +
                     '</button>';
            }).join('') +
          '</div>' +
        '</div>';
    }

    if (c.show_price) {
      html += '<div class="rule"></div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<span class="card__title">' + esc(c.price_label) + '</span>' +
          '<div class="price-row">' +
            '<span class="price-display tnum">' + esc(c.range.price_label) + '</span>' +
            '<span class="price-controls">' +
              '<button class="stepper" data-action="deal.price" ' +
                'data-payload="' + attr({ delta: -50 }) + '" aria-label="Lower the price">\u2212</button>' +
              '<button class="stepper" data-action="deal.price" ' +
                'data-payload="' + attr({ delta: 50 }) + '" aria-label="Raise the price">+</button>' +
            '</span>' +
            '<span class="flag ' + (c.range.in_range ? 'flag--good' : 'flag--risk') + '">' +
              (c.range.in_range ? 'Inside your fair range' : 'Outside your fair range') + '</span>' +
          '</div>' +
          rangeBar(c.range) +
        '</div>';
    }

    if (c.show_reasons) {
      html += '<div class="rule"></div>' +
        '<div style="display:flex;flex-direction:column;gap:9px">' +
          '<span class="card__title">' + esc(c.reason_label) + '</span>' +
          '<div class="reason-list">' +
            c.reasons.map(function (r) {
              return '<button class="reason' + (r.selected ? ' reason--on' : '') + '" ' +
                       'data-action="deal.pick_reason" data-payload="' + attr({ reason_id: r.id }) + '">' +
                       '<span class="reason__dot" aria-hidden="true"></span>' +
                       '<span>' + esc(r.text) + '</span>' +
                     '</button>';
            }).join('') +
          '</div>' +
        '</div>';
    }

    html += '</div><div class="card__foot">' +
      '<span class="small muted">' +
        (c.can_review ? 'Ready to review.'
                      : 'Pick a call, a reason, and any protection you want.') +
      '</span>' +
      '<button class="btn btn--primary" data-action="deal.step" ' +
        'data-payload="' + attr({ step: 'review' }) + '"' +
        (c.can_review ? '' : ' disabled') + '>Review my call</button>' +
      '</div></div>';

    return html;
  }

  function prismReview(v) {
    var r = v.review;
    return '' +
      prismHead(v) +
      '<div class="card"><div class="card__body">' +
        '<table class="review-table"><tbody>' +
          r.rows.map(function (row) {
            return '<tr><td>' + esc(row.label) + '</td><td>' + esc(row.value) + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        '<div class="rule"></div>' +
        '<div class="field">' +
          '<label for="call-note">' + esc(r.note_label) + '</label>' +
          '<textarea class="textarea" id="call-note" maxlength="' + r.note_max + '" ' +
            'placeholder="' + esc(r.note_placeholder) + '">' + esc(noteDraft) + '</textarea>' +
        '</div>' +
      '</div>' +
      '<div class="card__foot">' +
        '<button class="btn" data-action="deal.step" ' +
          'data-payload="' + attr({ step: 'call' }) + '">Change something</button>' +
        '<button class="btn btn--primary" data-action="deal.lock" data-payload="{}">' +
          'Lock my call</button>' +
      '</div></div>';
  }

  function prismReceipt(v) {
    var r = v.receipt;
    return '' +
      prismHead(v) +
      '<div class="receipt">' +
        '<span class="stamp">' + esc(r.stamp) + '</span>' +
        '<p class="lede">' + esc(r.headline) + '</p>' +
        '<p class="small muted">' + esc(r.detail) + '</p>' +
      '</div>' +
      '<div class="card"><div class="card__body" style="display:flex;flex-direction:column;gap:12px">' +
        '<span class="card__title">What this sample covers</span>' +
        '<p class="small muted">' + esc(r.next_note) + '</p>' +
        '<div class="rule"></div>' +
        '<span class="card__title">Your run so far</span>' +
        '<table class="review-table"><tbody>' +
          r.summary.map(function (row) {
            return '<tr><td>' + esc(row.label) + '</td><td>' + esc(row.value) + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
      '</div>' +
      '<div class="card__foot">' +
        '<span class="small muted">Six skill scores and a leaderboard arrive at the Report stage.</span>' +
        '<button class="btn" data-action="restart" data-payload="{}">Run it again</button>' +
      '</div></div>';
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function render() {
    var v = payload.view;
    var main;
    if (v.kind === 'welcome') main = renderWelcome(v);
    else if (v.kind === 'brief') main = renderBrief(v);
    else main = renderPrism(v);

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
    } else if (el.id === 'call-note') {
      noteDraft = el.value;
    }
  }, false);

  document.addEventListener('change', function (event) {
    var el = event.target;
    if (el && el.id === 'nda-box') {
      draft.nda = !!el.checked;
      refreshIdentityGate();
    }
  }, false);

  /* The note is saved on blur and does not re-render, so the caret is never
     yanked out from under the player mid-sentence. */
  document.addEventListener('blur', function (event) {
    var el = event.target;
    if (el && el.id === 'call-note') {
      post('deal.note', { text: noteDraft }, { silent: true });
    }
  }, true);

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
