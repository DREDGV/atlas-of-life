// js/wip.js
// WIP (Work In Progress) management functions

import { state } from "./state.js";

export function updateWip() {
  // New WIP logic: count tasks with status=today OR due=today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  
  const wip = state.tasks.filter((t) => {
    // Status is today
    if (t.status === "today") return true;
    
    // Has deadline today
    if (t.scheduledFor) {
      const taskDate = new Date(t.scheduledFor);
      taskDate.setHours(0, 0, 0, 0);
      return taskDate.getTime() === todayTimestamp;
    }
    
    return false;
  }).length;
  
  // Get WIP limit from settings, default to 5
  const wipLimit = state.settings?.wipTodayLimit || 5;
  
  const el = document.getElementById("wipInfo");
  if (el) {
    el.textContent = `WIP: ${wip} / ${wipLimit}`;
    el.className = "wip" + (wip > wipLimit ? " over" : "");
  }
  
  // Show warning if over limit
  if (wip > wipLimit) {
    if (window.showToast) {
      window.showToast(`Превышен лимит WIP: ${wip}/${wipLimit}`, "warn");
    }
  }
}
