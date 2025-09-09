/* Atlas of Life — v0.2.6 hotfix addon (non-invasive, safe bootstrap + guards)
 * - Safe bootstrap: гарантирует window.state (пустые массивы) до инициализации ядра
 * - Guard: layoutMap/initMap/drawMap не падают, пока state не готов
 * - Автозапуск первого рендера, когда state появится
 * - DnD detach rules
 * - Instant UI refresh on saveState()
 * - fitAll / fitActiveDomain
 * - Domains multiselect (Ctrl/⌘-click)
 * - Fullscreen toggle button
 */

(function () {
  const W = window;
  const D = document;

  // --- SAFE BOOTSTRAP: подстрахуем глобальное состояние до старта ядра -----
  if (!W.state || typeof W.state !== "object") {
    W.state = { domains: [], projects: [], tasks: [], links: [], settings: {} };
  } else {
    W.state.domains = Array.isArray(W.state.domains) ? W.state.domains : [];
    W.state.projects = Array.isArray(W.state.projects) ? W.state.projects : [];
    W.state.tasks = Array.isArray(W.state.tasks) ? W.state.tasks : [];
    W.state.links = Array.isArray(W.state.links) ? W.state.links : [];
    W.state.settings = W.state.settings || {};
  }
  W.DPR = W.DPR || W.devicePixelRatio || 1;

  const stateReady = () => {
    const s = W.state;
    return !!(
      s &&
      Array.isArray(s.domains) &&
      Array.isArray(s.projects) &&
      Array.isArray(s.tasks)
    );
  };

  // ---- helpers -------------------------------------------------------------
  const rafOnce = (() => {
    let id = 0;
    return (fn) => {
      if (id) cancelAnimationFrame(id);
      id = requestAnimationFrame(() => {
        id = 0;
        try {
          fn();
        } catch (e) {
          console.error("[fixes] rafOnce", e);
        }
      });
    };
  })();

  function refreshNow(reason = "refresh") {
    rafOnce(() => {
      try {
        if (typeof W.layoutMap === "function") W.layoutMap();
        if (typeof W.drawMap === "function") W.drawMap();
        if (W.mapApi && typeof W.mapApi.fitActiveDomain === "function") {
          W.mapApi.fitActiveDomain();
        }
      } catch (e) {
        console.error("[fixes] refresh", reason, e);
      }
    });
  }

  function withDefault(val, def) {
    return val === undefined || val === null ? def : val;
  }

  function bboxOf(nodes) {
    nodes = Array.isArray(nodes) ? nodes : [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      if (!n) continue;
      const r = withDefault(n.r, 0);
      if (!isFinite(n.x) || !isFinite(n.y)) continue;
      minX = Math.min(minX, n.x - r);
      minY = Math.min(minY, n.y - r);
      maxX = Math.max(maxX, n.x + r);
      maxY = Math.max(maxY, n.y + r);
    }
    if (!isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }

  // ---- bus -----------------------------------------------------------------
  if (!W.bus) {
    W.bus = {
      emit: (type, detail) =>
        D.dispatchEvent(new CustomEvent(type, { detail })),
      on: (type, handler) => D.addEventListener(type, handler),
      off: (type, handler) => D.removeEventListener(type, handler),
    };
  }

  // ---- GUARDS: обернём ключевые вызовы карты, чтобы не падали до ready ----
  (function guardCore() {
    function wrapWhenReady(name) {
      const tick = setInterval(() => {
        const fn = W[name];
        if (typeof fn === "function" && !fn.__guarded_by_fixes026) {
          const orig = fn;
          const guarded = function (...args) {
            if (!stateReady()) return; // пока state не готов — пропускаем ранний вызов
            try {
              return orig.apply(this, args);
            } catch (e) {
              console.error(`[fixes] guarded ${name} error:`, e);
            }
          };
          guarded.__guarded_by_fixes026 = true;
          W[name] = guarded;
          clearInterval(tick);
        }
      }, 50);
      setTimeout(() => clearInterval(tick), 6000);
    }

    wrapWhenReady("layoutMap");
    wrapWhenReady("initMap");
    wrapWhenReady("drawMap");

    // как только state готов — принудительно выполним первый рендер
    const boot = setInterval(() => {
      if (
        stateReady() &&
        typeof W.layoutMap === "function" &&
        typeof W.drawMap === "function"
      ) {
        try {
          W.layoutMap();
          W.drawMap();
          if (W.mapApi?.fitActiveDomain) W.mapApi.fitActiveDomain();
        } catch (e) {
          console.error("[fixes] initial render error:", e);
        }
        clearInterval(boot);
      }
    }, 80);
    setTimeout(() => clearInterval(boot), 8000);
  })();

  // ---- patch saveState -> instant UI refresh -------------------------------
  (function patchSave() {
    const s = W.saveState;
    if (typeof s === "function" && !s.__patched_by_fixes026) {
      const wrapped = function (...args) {
        const res = s.apply(this, args);
        try {
          refreshNow("saveState");
        } catch (_) {}
        return res;
      };
      wrapped.__patched_by_fixes026 = true;
      W.saveState = wrapped;
      console.log("[fixes] saveState patched (instant refresh)");
    }
  })();

  // ---- map API shims (fitAll/fitActiveDomain) ------------------------------
  W.mapApi = W.mapApi || {};
  W.mapApi.fitActiveDomain = function () {
    const nodes = W.nodes || [];
    const state = W.state || {};
    if (!Array.isArray(nodes) || !nodes.length) return;
    const domId = state.activeDomain || null;

    if (!domId) {
      const bb = bboxOf(nodes);
      if (bb && typeof W.fitToBBox === "function") W.fitToBBox(bb);
      return;
    }
    const dn = nodes.find((n) => n && n._type === "domain" && n.id === domId);
    if (!dn) return;

    const related = [
      dn,
      ...nodes.filter((n) => {
        if (!n) return false;
        if (n._type === "project") {
          const p = (W.state?.projects || []).find((p) => p.id === n.id);
          return p && p.domainId === dn.id;
        }
        if (n._type === "task") {
          const t = (W.state?.tasks || []).find((t) => t.id === n.id);
          if (!t) return false;
          if (t.projectId) {
            const p = (W.state?.projects || []).find(
              (p) => p.id === t.projectId
            );
            return p && p.domainId === dn.id;
          }
          return t.domainId === dn.id;
        }
        return false;
      }),
    ];

    const bb = bboxOf(related);
    if (bb && typeof W.fitToBBox === "function") W.fitToBBox(bb);
  };

  W.mapApi.fitAll = function () {
    const bb = bboxOf(W.nodes || []);
    if (bb && typeof W.fitToBBox === "function") W.fitToBBox(bb);
  };

  // ---- fullscreen button ---------------------------------------------------
  (function ensureFullscreenBtn() {
    if (D.getElementById("btnFullscreen")) return;
    const bar =
      D.querySelector(".topbar, header, .brand, .btn-strip") || D.body;
    const btn = D.createElement("button");
    btn.id = "btnFullscreen";
    btn.className = "chip";
    btn.title = "Полный экран";
    btn.textContent = "⤢";
    btn.style.marginLeft = "8px";
    btn.onclick = () => {
      if (!D.fullscreenElement)
        D.documentElement.requestFullscreen().catch(() => {});
      else D.exitFullscreen().catch(() => {});
      setTimeout(() => {
        if (typeof W.onResize === "function") W.onResize();
        refreshNow("fullscreen");
      }, 100);
    };
    bar && bar.appendChild(btn);
  })();

  // ---- domains multiselect (Ctrl/⌘-click on domain nodes) ------------------
  (function enableDomainMultiselect() {
    const canvas = W.canvas || D.querySelector("canvas");
    if (!canvas) return;

    canvas.addEventListener(
      "click",
      (e) => {
        const nodes = W.nodes || [];
        const state = W.state || {};
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        let hit = null;
        for (const n of nodes) {
          if (!n || n._type !== "domain") continue;
          const dx = x - n.x,
            dy = y - n.y;
          if (isFinite(dx) && isFinite(dy) && Math.hypot(dx, dy) <= n.r) {
            hit = n;
            break;
          }
        }
        if (!hit) return;

        if (e.ctrlKey || e.metaKey) {
          state.selectedDomains = Array.isArray(state.selectedDomains)
            ? state.selectedDomains
            : [];
          if (!state.selectedDomains.includes(hit.id)) {
            state.selectedDomains.push(hit.id);
          } else {
            state.selectedDomains = state.selectedDomains.filter(
              (id) => id !== hit.id
            );
          }
          state.activeDomain = null;
          if (typeof W.saveState === "function") W.saveState();
          else refreshNow("multi-select");
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        state.selectedDomains = [];
        state.activeDomain = hit.id;
        if (typeof W.saveState === "function") W.saveState();
        else refreshNow("single-select");
      },
      true
    );
  })();

  // ---- DnD detach rules (без вмешательства в ядро) -------------------------
  (function dndDetach() {
    const canvas = W.canvas || D.querySelector("canvas");
    if (!canvas) return;

    canvas.addEventListener(
      "mouseup",
      () => {
        setTimeout(() => {
          try {
            if (!stateReady()) return;
            const state = W.state || {};
            const nodes = W.nodes || [];
            const last = W.__lastDraggedTaskId || null;
            if (!last) return;

            const t = (state.tasks || []).find((x) => x.id === last);
            if (!t) return;

            const tNode = nodes.find(
              (n) => n && n._type === "task" && n.id === t.id
            );
            if (!tNode) return;

            const DPR = W.DPR || 1;

            let onProject = false,
              projectDomainId = null,
              pNodeFound = null;
            if (t.projectId) {
              pNodeFound = nodes.find(
                (n) => n && n._type === "project" && n.id === t.projectId
              );
              if (pNodeFound) {
                const d = Math.hypot(
                  tNode.x - pNodeFound.x,
                  tNode.y - pNodeFound.y
                );
                if (d <= pNodeFound.r + 12 * DPR) onProject = true;
                const p = (state.projects || []).find(
                  (p) => p.id === t.projectId
                );
                projectDomainId = p ? p.domainId : null;
              }
            }

            let insideDomainId = null;
            for (const n of nodes) {
              if (!n || n._type !== "domain") continue;
              const d = Math.hypot(tNode.x - n.x, tNode.y - n.y);
              if (d <= n.r) {
                insideDomainId = n.id;
                break;
              }
            }

            if (!insideDomainId) {
              t.projectId = null;
              t.domainId = null;
              t.pos = { x: tNode.x, y: tNode.y };
              t.updatedAt = Date.now();
              if (typeof W.saveState === "function") W.saveState();
              else refreshNow("dnd-free");
              toast("Задача сделана самостоятельной");
              W.__lastDraggedTaskId = null;
              return;
            }

            if (!onProject && t.projectId) {
              t.projectId = null;
              t.domainId =
                insideDomainId || projectDomainId || t.domainId || null;
              if (state?.settings?.layoutMode !== "auto") {
                t.pos = { x: tNode.x, y: tNode.y };
              } else {
                delete t.pos;
              }
              t.updatedAt = Date.now();
              if (typeof W.saveState === "function") W.saveState();
              else refreshNow("dnd-detach");
              toast("Отвязано от проекта");
              W.__lastDraggedTaskId = null;
              return;
            }

            W.__lastDraggedTaskId = null;
          } catch (e) {
            console.warn("[fixes] dndDetach check skipped", e);
          }
        }, 0);
      },
      true
    );

    D.addEventListener(
      "mousemove",
      () => {
        try {
          const dn = W.draggedNode;
          if (dn && dn._type === "task") {
            W.__lastDraggedTaskId = dn.id;
          }
        } catch (_) {}
      },
      true
    );
  })();

  // ---- «Показать всё» кнопка ------------------------------------------------
  (function ensureShowAllBtn() {
    if (D.getElementById("btnShowAll")) return;
    const bar =
      D.querySelector(".topbar, header, .btn-strip, .brand") || D.body;
    const btn = D.createElement("button");
    btn.id = "btnShowAll";
    btn.className = "chip";
    btn.title = "Показать все домены";
    btn.textContent = "Все";
    btn.onclick = () => {
      const state = W.state || {};
      state.activeDomain = null;
      state.selectedDomains = [];
      if (typeof W.saveState === "function") W.saveState();
      else refreshNow("show-all");
      setTimeout(() => W.mapApi && W.mapApi.fitAll && W.mapApi.fitAll(), 50);
    };
    bar && bar.appendChild(btn);
  })();

  // ---- тост-сообщение ------------------------------------------------------
  function toast(text) {
    const el =
      D.getElementById("toast") ||
      (() => {
        const t = D.createElement("div");
        t.id = "toast";
        t.className = "toast";
        D.body.appendChild(t);
        return t;
      })();
    el.textContent = text;
    el.style.display = "block";
    el.style.opacity = "1";
    setTimeout(() => {
      el.style.opacity = "0";
    }, 1200);
    setTimeout(() => {
      el.style.display = "none";
    }, 1700);
  }

  console.log("[fixes] v0.2.6 hotfix addon loaded");
})();
