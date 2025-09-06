// === Atlas v0.2.6 — ICS Export ===
(function () {
  function fmtICSDate(ts) {
    const d = new Date(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return `${y}${m}${day}T${hh}${mm}${ss}Z`;
  }
  function icsEscape(s) {
    return String(s || "")
      .replace(/[\n\r]/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }
  function isSameDay(a, b) {
    const da = new Date(a),
      db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  }
  function collectTasks(todayOnly) {
    if (!window.state || !Array.isArray(state.tasks)) return [];
    const now = Date.now();
    return state.tasks.filter((t) => {
      if (!t || !t.due) return false;
      if (todayOnly) return isSameDay(t.due, now);
      return true;
    });
  }
  function buildICS(tasks) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Atlas of life//v0.2.6//RU",
    ];
    const stamp = fmtICSDate(Date.now());
    tasks.forEach((t, i) => {
      const dtstart = fmtICSDate(t.due);
      const dtend = fmtICSDate(
        (t.due || 0) + Math.max(5, t.estimateMin || 30) * 60 * 1000
      );
      const summary = icsEscape(t.title || "Задача");
      const desc = icsEscape(
        `#${(t.tags || []).join(" #")}  [${t.status || ""}]`
      );
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:atlas-${t.id || "task" + i}@local`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART:${dtstart}`);
      lines.push(`DTEND:${dtend}`);
      lines.push(`SUMMARY:${summary}`);
      if (desc) lines.push(`DESCRIPTION:${desc}`);
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  function saveFile(name, text) {
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportICS(todayOnly) {
    const tasks = collectTasks(todayOnly);
    if (tasks.length === 0) {
      alert("Нет задач с датой для экспорта.");
      return;
    }
    const ics = buildICS(tasks);
    const name = todayOnly ? "atlas_today.ics" : "atlas_all_due.ics";
    saveFile(name, ics);
  }
  function injectButton() {
    const strip =
      document.querySelector(".btn-strip") ||
      document.querySelector("header") ||
      document.querySelector(".topbar");
    const btn = document.createElement("button");
    btn.className = "btn-ics";
    btn.textContent = "Экспорт .ics";
    btn.title = "Экспорт задач с датой (due) в календарь";
    btn.addEventListener("click", () => {
      if (
        confirm(
          "Экспортировать только задачи на сегодня?\nОК — только сегодня, Отмена — все задачи с датой."
        )
      )
        exportICS(true);
      else exportICS(false);
    });
    if (strip) {
      if (strip.classList.contains("btn-strip")) strip.appendChild(btn);
      else {
        const wrap = document.createElement("div");
        wrap.className = "btn-strip";
        wrap.appendChild(btn);
        strip.appendChild(wrap);
      }
    } else {
      btn.style.position = "fixed";
      btn.style.right = "16px";
      btn.style.top = "16px";
      document.body.appendChild(btn);
    }
  }
  document.addEventListener("DOMContentLoaded", injectButton);
  window.AtlasICS = {
    exportAll: () => exportICS(false),
    exportToday: () => exportICS(true),
  };
})();
