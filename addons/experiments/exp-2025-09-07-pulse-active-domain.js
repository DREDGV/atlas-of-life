// addons/experiments/exp-2025-09-07-pulse-active-domain.js
// @id: pulse
// @title: Pulse active domain (sidebar)
// @created: 2025-09-07
(function () {
  const ID = 'pulse';
  let timer = null;
  let styleEl = null;

  function addStyles() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.textContent = `
@keyframes atlasPulse { 0%{ transform:scale(1)} 50%{ transform:scale(1.05)} 100%{ transform:scale(1)} }
.domains .row.pulse { animation: atlasPulse 3s ease-in-out infinite; transform-origin:left center; }
`;
    document.head.appendChild(styleEl);
  }

  function tick() {
    try {
      const wrap = document.getElementById('domainsList');
      if (!wrap) return;
      wrap.querySelectorAll('.row.pulse').forEach(el => el.classList.remove('pulse'));
      const id = (window.state && state.activeDomain) || null;
      if (!id) return;
      const el = wrap.querySelector(`.row[data-domain="${id}"]`);
      if (el) el.classList.add('pulse');
    } catch (e) {}
  }

  function enable() {
    addStyles();
    if (!timer) timer = setInterval(tick, 500);
    tick();
  }

  function disable() {
    if (timer) { clearInterval(timer); timer = null; }
    try {
      const wrap = document.getElementById('domainsList');
      if (wrap) wrap.querySelectorAll('.row.pulse').forEach(el => el.classList.remove('pulse'));
    } catch (e) {}
    if (styleEl) { styleEl.remove(); styleEl = null; }
  }

  (window.Experiments || { register: () => {} }).register({
    id: ID,
    title: 'Pulse active domain (sidebar)',
    created: '2025-09-07',
    enable,
    disable,
  });
})();

