/* ==========================================================================
   Stage 3 — Project Prism
   Tech · 2012. Value a company that earns nothing yet.

   Blueprint references:
     p9   the brief, the metric choice, the three comparables, the fair range
     p7   "Anatomy of every deal" — Brief, Research, Task, Your call
     p7   the three calls: Go / Go with protection / Walk away
     p7   the protection list
     p11  "Illustrative numbers. Final figures from the content team."

   Content is data. No logic lives in this file.

   MONEY MODEL
     All figures are millions of US dollars, in the year of the deal.
     `task.range` is derived from `task.perUser` x `task.usersM` — the engine
     computes it rather than storing it, so the two can never disagree.
   ========================================================================== */

window.IB_DEAL = {

  id: 'prism',
  code: 'Prism',
  realName: 'withheld until the Truth',
  sector: 'Tech',
  year: 2012,
  minutes: 4,
  skills: ['Business sense', 'Valuation'],
  stepOf: 'Deal 1 of 5',

  /* --- 1. Brief -------------------------------------------------------- */
  brief: {
    headline: 'A company with no revenue. How do you put a price on it?',
    body:
      'The world\u2019s biggest social network wants to buy a two-year-old photo-sharing app. ' +
      'It has 13 staff, about 30 million users and no revenue. Another tech company is also ' +
      'interested.',
    clientLine: 'The client is the buyer. You are advising them on what to pay.',
    mood: {
      label: 'Market mood \u00b7 2012',
      line: 'Mobile is exploding. Two large platforms are racing to own the photo layer, ' +
            'and neither wants the other to get there first.'
    }
  },

  /* --- 2. Research — the Deal Terminal --------------------------------- */
  terminal: {
    lede: 'Every page is fictional in name but based on real, dated facts.',
    address: 'terminal.ashford / prism',

    pages: [
      {
        id: 'company',
        label: 'Company',
        title: 'Prism',
        body: 'A photo-sharing app. Founded 2010. Thirteen staff. About thirty million users. ' +
              'No revenue, and no plan for any this year.',
        stats: [
          { label: 'Revenue',  value: '$0',        tone: 'flat' },
          { label: 'Profit',   value: '$0',        tone: 'flat' },
          { label: 'Users',    value: '30M',       tone: 'good', note: 'Growing fast' },
          { label: 'Team',     value: '13',        tone: 'flat' }
        ]
      },
      {
        id: 'news',
        label: 'News \u00b7 2012',
        title: 'In the news',
        body: 'Dated items only. Nothing after the deal date appears anywhere in this terminal.',
        items: [
          { date: 'April 2012',   text: 'The app\u2019s Android version launched. Over a million downloads on day one.', flag: 'good' },
          { date: 'March 2012',   text: 'Two large platforms have looked at the company, according to people familiar with the talks.', flag: 'good' },
          { date: 'January 2012', text: 'The app passes thirty million registered users.', flag: 'good' },
          { date: 'December 2011', text: 'A year-end list names it the app of the year.', flag: 'neutral' }
        ]
      },
      {
        id: 'industry',
        label: 'Industry',
        title: 'How this sector works',
        body: 'Mobile photo sharing is the fastest-growing part of social. Users are moving ' +
              'from desktop to phones faster than the big platforms can follow.',
        items: [
          { text: 'A large platform can build a photo feature in a quarter.', flag: 'neutral' },
          { text: 'It cannot easily build the habit. That is what is scarce.', flag: 'good' },
          { text: 'Switching costs for users are close to zero, so scale is the only moat.', flag: 'risk' }
        ]
      },
      {
        id: 'comparables',
        label: 'Comparables',
        title: 'Three earlier app deals',
        body: 'Similar companies, or similar deals, with simple numbers. Price per user has ' +
              'risen every year.',
        items: [
          { date: 'Deal A \u00b7 2009', text: '$18 per user', flag: 'neutral' },
          { date: 'Deal B \u00b7 2010', text: '$32 per user', flag: 'neutral' },
          { date: 'Deal C \u00b7 2011', text: '$50 per user', flag: 'neutral' }
        ]
      },
      {
        id: 'filings',
        label: 'Filings',
        title: 'What the company has filed',
        body: 'Prism is a private company. It files no accounts and publishes no financials.',
        items: [
          { text: 'There are no audited accounts to read.', flag: 'risk' },
          { text: 'The only numbers available are the ones the company chooses to share.', flag: 'risk' }
        ]
      }
    ]
  },

  /* --- 3. Task — the valuation ---------------------------------------- */
  task: {
    prompt: 'Which number shows what Prism is worth?',
    hint: 'Revenue and profit are zero. Pick the number that matters most to the buyer.',

    metrics: [
      { id: 'revenue', label: 'Revenue', value: '$0',     note: null },
      { id: 'profit',  label: 'Profit',  value: '$0',     note: null },
      { id: 'users',   label: 'Users',   value: '30M',    note: 'Growing fast' },
      { id: 'team',    label: 'Team',    value: '13',     note: null }
    ],
    correctMetric: 'users',

    /* Shown only after the right metric is picked. */
    perUserLabel: 'Price per user in earlier app deals',
    perUser: [
      { id: 'a', label: 'Deal A \u00b7 2009', value: 18 },
      { id: 'b', label: 'Deal B \u00b7 2010', value: 32 },
      { id: 'c', label: 'Deal C \u00b7 2011', value: 50 }
    ],
    usersM: 30,

    rangeLabel: 'Fair range the system builds',
    rangeNote: 'Thirty million users at $18 to $50 each.',

    defaultPriceM: 1000,
    priceStepM: 50,
    priceMinM: 100,
    priceMaxM: 2500,

    /* The Truth stage consumes this. Not rendered in this sample — the deal
       ends on a receipt, exactly as the blueprint requires (p7: "No outcome
       yet."). Kept here so the data model is complete. */
    rightCall: 'Go, at a price inside a sensible range. Go with a stay bonus for the team also counts.'
  },

  /* --- 4. Your call ---------------------------------------------------- */
  call: {
    prompt: 'Your call on Project Prism',
    hint: 'Pick one. You can review before it locks.',

    choices: [
      { id: 'go',      label: 'Go',                 blurb: 'Buy at the agreed price and terms.' },
      { id: 'protect', label: 'Go with protection', blurb: 'Buy, but protect the client.' },
      { id: 'walk',    label: 'Walk away',          blurb: 'Advise the client not to buy.' }
    ],

    protectionLabel: 'Protection options',
    protectionNote: 'Each tool is explained in one line.',
    protections: [
      { id: 'lower',   label: 'Lower price',          blurb: 'Pay less than the asking price.' },
      { id: 'holdback', label: 'Money held back',     blurb: 'Part of the price is released later, once conditions are met.' },
      { id: 'guarantee', label: 'Seller guarantee',   blurb: 'The seller pays out if something they told you turns out to be untrue.' },
      { id: 'earnout', label: 'Earnout',              blurb: 'Part of the price is paid later, only if targets are hit.' },
      { id: 'stay',    label: 'Stay bonus for team',  blurb: 'Money for the staff, paid only if they stay.' }
    ],

    priceLabel: 'Your price',
    reasonLabel: 'Say in one line why the board should agree',
    reasons: [
      { id: 'build',  text: 'Growth this fast would take the client years to build in-house.' },
      { id: 'range',  text: 'The price sits inside the range the app deals support.' },
      { id: 'absorb', text: 'The client\u2019s balance sheet can absorb the price.' },
      { id: 'small',  text: 'The target is small enough to absorb quickly.' }
    ],

    noteLabel: 'Optional sentence, saved for the report',
    notePlaceholder: 'Add one sentence\u2026',
    noteMax: 240
  },

  receipt: {
    stamp: 'Closed',
    line: 'A deal receipt appears. No outcome yet.',
    detail: 'The Deal Book opens the next deal. What really happened is revealed at the Truth.'
  },

  /* --- Companion lines, keyed to the sub-step -------------------------- */
  companion: {
    brief:   'Read the brief before you look at any number.',
    research: 'Save what you find. Facts and risks, not impressions.',
    task:    'No revenue does not mean no value. What does the buyer get that it cannot build fast?',
    call:    'Your price is inside your range. Say in one line why the board should agree.',
    receipt: 'That is your call on the record. We find out at the Truth.'
  }
};
