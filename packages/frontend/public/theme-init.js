// Applies the persisted theme before React renders, to prevent a flash of
// the wrong theme. Kept as an external file (not an inline <script>) so it
// works under a strict script-src 'self' Content-Security-Policy.
try {
  var stored = JSON.parse(localStorage.getItem('ts6-ui') || '{}');
  var theme = (stored.state && stored.state.theme) || 'dark';
  if (theme === 'dark') document.documentElement.classList.add('dark');
  // A personal design choice; the installation default arrives from the server after login.
  if (stored.state && stored.state.designOverride) document.documentElement.dataset.design = stored.state.designOverride;
} catch (e) {
  document.documentElement.classList.add('dark');
}
