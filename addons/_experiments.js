// addons/_experiments.js
(function () {
  const LS_KEY = 'atlas:experiments:enabled';
  const enabled = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(enabled))); } catch (_) {}
  }

  const Experiments = {
    _items: new Map(), // id -> {id,title,created,enable,disable}
    register(meta) {
      if (!meta || !meta.id) return;
      this._items.set(meta.id, meta);
      // auto-enable via ?exp= or localStorage
      try {
        const url = new URL(window.location.href);
        const query = new Set((url.searchParams.getAll('exp') || []).flatMap(s => String(s).split(',')));
        if (query.has(meta.id)) enabled.add(meta.id);
      } catch (_) {}
      // Enable experiments for all browsers
      if (enabled.has(meta.id)) {
        try { meta.enable && meta.enable(); } catch (e) { console.warn('exp enable error', meta.id, e); }
      }
      this._ensureLauncher();
      console.log('[Experiments] registered:', meta.id, meta.title || '');
    },
    enable(id) {
      const x = this._items.get(id);
      if (!x) return;
      if (!enabled.has(id)) {
        try { x.enable && x.enable(); } finally { enabled.add(id); save(); }
      }
      this._ensureLauncher();
    },
    disable(id) {
      const x = this._items.get(id);
      if (!x) return;
      if (enabled.has(id)) {
        try { x.disable && x.disable(); } finally { enabled.delete(id); save(); }
      }
      this._ensureLauncher();
    },
    isEnabled(id) { return enabled.has(id); },
    list() { return Array.from(this._items.values()); },

    _ensureLauncher() {
      if (document.getElementById('expBadge')) return;
      const host = document.querySelector('header') || document.body;
      const btn = document.createElement('div');
      btn.id = 'expBadge';
      btn.textContent = '🧪';
      btn.title = 'Experiments';
      Object.assign(btn.style, {
        cursor: 'pointer', padding: '4px 8px', opacity: '0.85', userSelect: 'none'
      });
      btn.onclick = () => this._openPanel();
      host.appendChild(btn);
    },
    _openPanel() {
      const old = document.getElementById('expPanel');
      if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.id = 'expPanel';
      Object.assign(wrap.style, {
        position: 'fixed', right: '16px', top: '52px', zIndex: 9999,
        background: '#0f172a', color: '#e5e7eb', padding: '12px 12px 10px',
        border: '1px solid #334155', borderRadius: '12px',
        boxShadow: '0 6px 22px rgba(0,0,0,0.35)', minWidth: '280px'
      });
      const title = document.createElement('div');
      title.textContent = 'Experiments';
      Object.assign(title.style, { fontWeight: '600', marginBottom: '8px' });
      wrap.appendChild(title);

      this.list().forEach(meta => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px', margin: '6px 0'
        });
        const info = document.createElement('div');
        info.innerHTML = `<div>${meta.title || meta.id}</div>
          <div style="opacity:.7;font-size:12px">${meta.id}${meta.created ? ' · ' + meta.created : ''}</div>`;
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = enabled.has(meta.id);
        chk.onchange = () => chk.checked ? this.enable(meta.id) : this.disable(meta.id);
        row.appendChild(info);
        row.appendChild(chk);
        wrap.appendChild(row);
      });

      const close = document.createElement('button');
      close.textContent = 'Close';
      Object.assign(close.style, { marginTop: '8px' });
      close.onclick = () => wrap.remove();
      wrap.appendChild(close);

      document.body.appendChild(wrap);
    },
  };

  try { window.Experiments = Experiments; } catch (_) {}
})();

