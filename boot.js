/* Scriba — pre-paint boot (kept as a separate file so the CSP can forbid inline scripts).
   1) applies the saved/system theme before first paint (no white flash in dark mode)
   2) swaps the non-blocking web-font stylesheet to "all" once it has loaded */
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('scriba.v1') || 'null');
    var theme = saved && saved.settings && saved.settings.theme;
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* storage may be unavailable */ }

  var fonts = document.getElementById('webFonts');
  if (fonts) {
    var show = function () { fonts.media = 'all'; };
    if (fonts.sheet) show(); else fonts.addEventListener('load', show);
  }
})();
