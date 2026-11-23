// Local evidence for review, independent of the truncated operation log.
export const REVIEW_HISTORY_DAYS = 90;
export const REVIEW_HISTORY_LIMIT = 2000;
const DAY = 86400000;
const KINDS = new Set(['task.done', 'task.reopened', 'project.review', 'project.create', 'domain.create', 'domain.review']);

export function prepareReviewHistory(value, now = Date.now()) {
  if (value == null) return { since: now, events: [] };
  if (!Number.isFinite(value.since) || value.since <= 0 || !Array.isArray(value.events) || value.events.length > REVIEW_HISTORY_LIMIT) {
    throw new Error('Повреждена история обзора. Исходник сохранён.');
  }
  const ids = new Set();
  for (const event of value.events) {
    if (!event || typeof event.id !== 'string' || ids.has(event.id) || !KINDS.has(event.kind) ||
        !Number.isFinite(event.timestamp) || event.timestamp <= 0 ||
        typeof event.entityId !== 'string' || typeof event.title !== 'string' ||
        !['task', 'project', 'domain'].includes(event.entityType)) {
      throw new Error('Повреждена запись истории обзора. Исходник сохранён.');
    }
    ids.add(event.id);
  }
  return { since: value.since, events: value.events.map(event => ({ ...event })) };
}

export function recordReviewOperation(atlas, operation) {
  const timestamp = operation.timestamp;
  const history = atlas.reviewHistory || { since: timestamp, events: [] };
  atlas.reviewHistory = history;
  const { before, after } = operation.payload || {};
  let kind = operation.type;
  if (kind === 'task.update') {
    if (before?.status !== 'done' && after?.status === 'done') kind = 'task.done';
    else if (before?.status === 'done' && after?.status !== 'done') kind = 'task.reopened';
  }
  if (KINDS.has(kind)) {
    const entity = after || operation.payload;
    const project = operation.entityType === 'project' ? entity : atlas.projects.find(p => p.id === entity?.projectId);
    const domainId = operation.entityType === 'domain' ? operation.entityId : (project?.domainId || entity?.domainId || null);
    const domain = atlas.domains.find(d => d.id === domainId);
    history.events.push({
      id: operation.id, kind, timestamp, entityType: operation.entityType, entityId: operation.entityId,
      title: String(entity?.title || '').slice(0, 200), domainId, domainTitle: domain?.title?.slice(0, 200) || null,
      projectId: project?.id || null, projectTitle: project?.title?.slice(0, 200) || null,
      lifecycle: kind === 'project.review' ? entity.lifecycle : null,
      previousLifecycle: kind === 'project.review' ? (before?.lifecycle || 'active') : null,
      detail: String(kind === 'project.review'
        ? (entity.lifecycle === 'paused' ? entity.pauseReason : entity.outcome)
        : (kind === 'domain.review' ? entity.intention : '')).slice(0, 500),
      nextActionTitle: kind === 'project.review'
        ? (atlas.tasks.find(task => task.id === entity.nextActionId)?.title || '').slice(0, 200) : null,
    });
  }
  // Trimming advances coverage explicitly, including count-based truncation.
  const cutoff = timestamp - REVIEW_HISTORY_DAYS * DAY;
  history.events.sort((a, b) => a.timestamp - b.timestamp);
  history.events = history.events.filter(event => event.timestamp >= cutoff);
  history.since = Math.max(history.since, cutoff);
  if (history.events.length > REVIEW_HISTORY_LIMIT) {
    const removed = history.events.splice(0, history.events.length - REVIEW_HISTORY_LIMIT);
    history.since = Math.max(history.since, removed.at(-1).timestamp + 1);
  }
}

export function validateDomainAttention(domain) {
  if (domain.reviewEveryDays != null && ![0, 7, 14, 30, 90].includes(domain.reviewEveryDays)) {
    throw new Error('Выберите ритм обзора сферы.');
  }
  if (domain.intention != null && (typeof domain.intention !== 'string' || domain.intention.length > 500)) {
    throw new Error('Намерение сферы должно содержать до 500 символов.');
  }
  for (const key of ['attentionSince', 'attentionReviewedAt']) {
    if (domain[key] != null && (!Number.isFinite(domain[key]) || domain[key] <= 0)) {
      throw new Error('Повреждена дата обзора сферы.');
    }
  }
}

export function domainAttention(domain, now = Date.now()) {
  const interval = domain.reviewEveryDays || 0;
  const anchor = Math.max(domain.attentionReviewedAt || 0, domain.attentionSince || 0);
  const next = new Date(anchor || now);
  next.setDate(next.getDate() + interval);
  next.setHours(0, 0, 0, 0);
  const nextAt = interval && anchor ? +next : null;
  return { interval, nextAt, due: nextAt !== null && nextAt <= now };
}
