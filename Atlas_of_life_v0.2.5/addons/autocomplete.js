// === Atlas v0.2.6 — Autocomplete for quick add (#tag / @project) ===
(function () {
  const SELS = [
    "#quickAdd",
    "input[data-quick]",
    "input#quick",
    "input[name=quickAdd]",
    'input[placeholder^="Быстро"]',
    'input[placeholder^="Quick"]',
  ];
  const input = document.querySelector(SELS.join(","));
  if (!input) return;

  function uniq(a) {
    return Array.from(new Set(a.filter(Boolean)));
  }

  function gatherTags() {
    const tags = [];
    try {
      if (window.state && Array.isArray(state.tasks)) {
        state.tasks.forEach(
          (t) =>
            Array.isArray(t.tags) &&
            t.tags.forEach((x) => tags.push(String(x).trim()))
        );
      }
      if (window.state && Array.isArray(state.projects)) {
        state.projects.forEach(
          (p) =>
            Array.isArray(p.tags) &&
            p.tags.forEach((x) => tags.push(String(x).trim()))
        );
      }
    } catch (e) {}
    return uniq(tags).sort((a, b) => a.localeCompare(b));
  }
  function gatherProjects() {
    try {
      if (window.state && Array.isArray(state.projects)) {
        return state.projects
          .map((p) => ({ id: p.id, title: String(p.title || "").trim() }))
          .filter((p) => p.title);
      }
    } catch (e) {}
    return [];
  }

  const TAGS = gatherTags();
  const PROJECTS = gatherProjects();

  const dim = document.createElement("div");
  dim.className = "ac-dim";
  dim.style.display = "none";
  const pop = document.createElement("div");
  pop.className = "ac-popup";
  pop.style.display = "none";
  document.body.appendChild(dim);
  document.body.appendChild(pop);

  let items = [];
  let idx = -1;
  let lastTrig = null;

  function hide() {
    pop.style.display = "none";
    dim.style.display = "none";
    idx = -1;
    items = [];
    lastTrig = null;
  }
  function show(x, y, w) {
    pop.style.display = "block";
    pop.style.left = x + "px";
    pop.style.top = y + 6 + "px";
    pop.style.minWidth = Math.max(220, w) + "px";
    dim.style.display = "block";
  }
  function renderRows(rows, q, kind) {
    pop.innerHTML = "";
    rows.slice(0, 20).forEach((r, i) => {
      const el = document.createElement("div");
      el.className = "row";
      el.dataset.idx = i;
      el.innerHTML =
        `<span class="kind">${
          kind === "tag" ? "#" : "@"
        }</span><span>${highlight(r.label, q)}</span>` +
        (r.meta ? ` <span class="pill">${r.meta}</span>` : "");
      el.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        commit(r.insert);
      });
      pop.appendChild(el);
    });
    items = rows;
    highlightActive();
  }
  function highlight(s, q) {
    try {
      const i = s.toLowerCase().indexOf(q.toLowerCase());
      if (i >= 0)
        return (
          s.slice(0, i) +
          "<b>" +
          s.slice(i, i + q.length) +
          "</b>" +
          s.slice(i + q.length)
        );
    } catch (e) {}
    return s;
  }
  function highlightActive() {
    Array.from(pop.children).forEach((el, i) => {
      el.classList.toggle("active", i === idx);
    });
  }

  function commit(repl) {
    if (!lastTrig) return hide();
    const { start, end, trigger } = lastTrig;
    const v = input.value;
    const before = v.slice(0, start);
    const after = v.slice(end);
    input.value = before + trigger + repl + " " + after;
    const caret = (before + trigger + repl + " ").length;
    if (input.setSelectionRange) input.setSelectionRange(caret, caret);
    hide();
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function onKey(e) {
    if (pop.style.display === "block") {
      if (e.key === "ArrowDown") {
        idx = Math.min(items.length - 1, idx + 1);
        highlightActive();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        idx = Math.max(0, idx - 1);
        highlightActive();
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        if (idx >= 0) {
          e.preventDefault();
          commit(items[idx].insert);
        }
        return;
      }
      if (e.key === "Escape") {
        hide();
        return;
      }
    }
  }
  function findTrigger(text, caret) {
    const left = text.slice(0, caret);
    const m = left.match(/(^|[\s,.;])([#@])([^\s#@]{0,32})$/);
    if (!m) return null;
    const trigger = m[2];
    const q = m[3] || "";
    const start = left.lastIndexOf(trigger + q);
    const end = start + (trigger + q).length;
    return { trigger, q, start, end };
  }
  function rectBelow(el) {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + window.scrollX,
      y: r.bottom + window.scrollY,
      w: r.width,
    };
  }

  input.addEventListener("keydown", onKey);
  dim.addEventListener("mousedown", hide);

  input.addEventListener("input", () => {
    const caret = input.selectionStart || input.value.length;
    const trig = findTrigger(input.value, caret);
    if (!trig) {
      hide();
      return;
    }
    lastTrig = trig;
    const rc = rectBelow(input);
    if (trig.trigger === "#") {
      const list = TAGS.map((t) => ({ label: t, insert: t })).filter((x) =>
        x.label.toLowerCase().includes(trig.q.toLowerCase())
      );
      if (list.length === 0) {
        hide();
        return;
      }
      renderRows(list, trig.q, "tag");
      show(rc.x, rc.y, rc.w);
    } else if (trig.trigger === "@") {
      const list = PROJECTS.map((p) => ({
        label: p.title,
        insert: p.title,
      })).filter((x) => x.label.toLowerCase().includes(trig.q.toLowerCase()));
      if (list.length === 0) {
        hide();
        return;
      }
      renderRows(list, trig.q, "project");
      show(rc.x, rc.y, rc.w);
    }
  });

  input.addEventListener("blur", () => setTimeout(hide, 80));
})();
