const smallScreen = '(max-width: 760px)';

export function showStudioPanel(name = '', { focus = true } = {}) {
  const app = document.querySelector('.app');
  if (!app || (name && !window.matchMedia(smallScreen).matches)) return;
  const previous = app.dataset.studioPanel;
  if (name) app.dataset.studioPanel = name;
  else delete app.dataset.studioPanel;

  for (const button of app.querySelectorAll('[data-studio-panel]')) {
    const active = button.dataset.studioPanel === name;
    button.setAttribute('aria-expanded', String(active));
    if (!focus) continue;
    if (active) {
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      panel.querySelector('.studio-panel-close')?.focus({ preventScroll: true });
    } else if (!name && button.dataset.studioPanel === previous) {
      button.focus({ preventScroll: true });
    }
  }
}

export function setupStudioPanels() {
  const app = document.querySelector('.app');
  for (const button of app.querySelectorAll('[data-studio-panel]')) {
    button.onclick = () => {
      const name = button.dataset.studioPanel;
      showStudioPanel(app.dataset.studioPanel === name ? '' : name);
    };
  }
  for (const button of app.querySelectorAll('.studio-panel-close, .studio-panel-backdrop')) {
    button.onclick = () => showStudioPanel();
  }
  app.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !app.dataset.studioPanel) return;
    event.preventDefault();
    showStudioPanel();
  });
  window.matchMedia(smallScreen).addEventListener('change', event => {
    if (!event.matches) showStudioPanel('', { focus: false });
  });
}
