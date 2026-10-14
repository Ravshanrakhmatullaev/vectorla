// Stroke icons as an inline SVG sprite (24 px grid, currentColor), injected once.
// Use: <svg class="i"><use href="#i-upload"/></svg>
;(function () {
  'use strict'
  const sym = (id, body) => `<symbol id="i-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`
  const icons = [
    sym('upload', '<path d="M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
    sym('download', '<path d="M12 4v11M7 10l5 5 5-5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
    sym('sun', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
    sym('moon', '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
    sym('menu', '<path d="M4 7h16M4 12h16M4 17h16"/>'),
    sym('x', '<path d="M6 6l12 12M18 6 6 18"/>'),
    sym('zoom-in', '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21M11 8v6M8 11h6"/>'),
    sym('zoom-out', '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21M8 11h6"/>'),
    sym('fit', '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    sym('split', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
    sym('side', '<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>'),
    sym('vector', '<path d="M5.5 18.5C8 9 16 15 18.5 5.5"/><rect x="3" y="16" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/>'),
    sym('outline', '<path d="M5 18 12 6l7 12z"/><rect x="10" y="4" width="4" height="4" rx=".5"/><rect x="3" y="16" width="4" height="4" rx=".5"/><rect x="17" y="16" width="4" height="4" rx=".5"/>'),
    sym('image', '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>'),
    sym('coin', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10h3.75a1.75 1.75 0 0 1 0 3.5H9.5"/>'),
    sym('clock', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.5"/>'),
    sym('check', '<path d="m5 12.5 4.5 4.5L19 7"/>'),
    sym('alert', '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4M12 17v.01"/>'),
    sym('arrow-right', '<path d="M5 12h14M13 6l6 6-6 6"/>'),
    sym('file', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
    sym('spark', '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>'),
    sym('bolt', '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>'),
    sym('plus', '<path d="M12 5v14M5 12h14"/>'),
    sym('minus', '<path d="M5 12h14"/>'),
    sym('globe', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>'),
    sym('user', '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
    sym('chevron-down', '<path d="m6 9 6 6 6-6"/>'),
    sym('command', '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>'),
    sym('search', '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>'),
    sym('grid', '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
    sym('list', '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
    sym('refresh', '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>'),
    sym('info', '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'),
    sym('lock', '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    sym('layers', '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  ]
  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${icons.join('')}</svg>`
  document.body.insertAdjacentHTML('afterbegin', sprite)
})()
