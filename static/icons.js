/* ==========================================================================
   Investment Banking Simulation — icon set

   Inline SVG, stroke-based, 24x24 on a 1.6 grid, drawn in `currentColor` so an
   icon always matches the text it sits with. No fills, no gradients, no
   colour literals: the palette belongs to ib.css and an icon that named a
   colour would break that.

   Why inline and not a sprite or a font:
     * no extra request, and no flash of missing glyph
     * `currentColor` means one icon works on white, on cyan and on yellow
     * stroke-width stays crisp at any size without a second asset

   Every icon is decorative here. Each one sits next to a text label that
   already carries the meaning, so they are all `aria-hidden` at the call site.
   ========================================================================== */

(function (global) {
  'use strict';

  /* Each entry is the inner markup of a 24x24 viewBox. `s(width, height)`
     wraps it with the shared attributes. */
  var PATHS = {
    /* --- chrome ---------------------------------------------------------- */
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    points: '<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8z"/>',
    deals: '<rect x="3" y="7" width="18" height="13"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12h18"/>',

    /* --- the four jobs --------------------------------------------------- */
    buy: '<path d="M12 5v14M5 12h14"/>',
    sell: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    raise: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h5M9.5 14h5"/>',
    fix: '<path d="M14.5 3.5a5 5 0 0 0-6.2 6.6L3.5 15l4.5 4.5 4.9-4.8a5 5 0 0 0 6.6-6.2l-3 3-2.8-.7-.7-2.8z"/>',

    /* --- the five sectors ------------------------------------------------ */
    tech: '<rect x="7" y="7" width="10" height="10"/><rect x="10" y="10" width="4" height="4"/><path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3"/>',
    media: '<rect x="3" y="5" width="18" height="14"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
    pharma: '<path d="M8.5 4.5h7M10 4.5v5.2L5.6 18a2 2 0 0 0 1.7 3h9.4a2 2 0 0 0 1.7-3L14 9.7V4.5"/><path d="M7.3 14h9.4"/>',
    steel: '<path d="M3 8h18M3 12h18M3 16h18M6 5v14M12 5v14M18 5v14"/>',
    shop: '<path d="M4 8h16l-1.2 11.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',

    /* --- briefing and quiz ----------------------------------------------- */
    word: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2.5 2.5 0 0 1 2 1 2.5 2.5 0 0 1 2-1h4.5A1.5 1.5 0 0 1 20 5.5v12a1.5 1.5 0 0 1-1.5 1.5H14a2.5 2.5 0 0 0-2 1 2.5 2.5 0 0 0-2-1H5.5A1.5 1.5 0 0 1 4 17.5z"/><path d="M12 5v15"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    cross: '<path d="M6 6l12 12M18 6L6 18"/>',
    arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    seal: '<circle cx="12" cy="9.5" r="5.5"/><path d="M8.5 14.2L7 21l5-2.4L17 21l-1.5-6.8"/>',
    sparkle: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.5 6.5l3 3M14.5 14.5l3 3M17.5 6.5l-3 3M9.5 14.5l-3 3"/>'
  };

  function s(name, size, extraClass) {
    var body = PATHS[name];
    if (!body) return '';
    var px = size || 20;
    return '<svg class="ico' + (extraClass ? ' ' + extraClass : '') +
           '" viewBox="0 0 24 24" width="' + px + '" height="' + px +
           '" fill="none" stroke="currentColor" stroke-width="1.6" ' +
           'stroke-linecap="round" stroke-linejoin="round" ' +
           'aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  global.ICON = s;
  global.ICON_PATHS = PATHS;
})(window);
