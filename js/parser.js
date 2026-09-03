// Deterministic parser for the direct Task mode in Quick Dock.
// Inbox mode deliberately does not call this parser: capture remains literal.

const META_BOUNDARY = String.raw`(?=\s+(?:[#@!~]|p[1-4]\b)|$)`;

function pad(value){
  return String(value).padStart(2, '0');
}

function localDate(value){
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function localTime(value){
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function removeOnce(text, match){
  return text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length);
}

export function parseWhenRU(value, { now = new Date() } = {}){
  const source = String(value || '').trim().toLowerCase();
  if (!source) return { error: 'После ! укажите дату или время' };

  const base = new Date(now);
  const target = new Date(base);
  let rest = source;
  let kind = 'future';

  const relative = rest.match(/^через\s+(\d+)\s*(мин(?:ут[уы]?)?|м|час(?:а|ов)?|ч)(?=\s|$)/u);
  if (relative) {
    const amount = Number(relative[1]);
    const hours = /^(?:ч|час)/u.test(relative[2]);
    if (hours) target.setHours(target.getHours() + amount);
    else target.setMinutes(target.getMinutes() + amount);
    return {
      due: { date: localDate(target), time: localTime(target) },
      kind: localDate(target) === localDate(base) ? 'today' : 'future',
      label: `через ${amount}${hours ? 'ч' : 'м'}`,
    };
  }

  if (rest.startsWith('сейчас')) {
    kind = 'now';
    rest = rest.slice('сейчас'.length).trim();
  } else if (rest.startsWith('послезавтра')) {
    target.setDate(target.getDate() + 2);
    rest = rest.slice('послезавтра'.length).trim();
  } else if (rest.startsWith('завтра')) {
    target.setDate(target.getDate() + 1);
    rest = rest.slice('завтра'.length).trim();
  } else if (rest.startsWith('сегодня')) {
    kind = 'today';
    rest = rest.slice('сегодня'.length).trim();
  } else {
    const exact = rest.match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{4}))?/u);
    if (exact) {
      const year = Number(exact[3] || base.getFullYear());
      const month = Number(exact[2]);
      const day = Number(exact[1]);
      const candidate = new Date(year, month - 1, day);
      if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) {
        return { error: `Некорректная дата: ${exact[0]}` };
      }
      target.setFullYear(year, month - 1, day);
      rest = rest.slice(exact[0].length).trim();
      if (localDate(target) === localDate(base)) kind = 'today';
    } else {
      const weekdays = new Map([
        ['воскресенье', 0], ['понедельник', 1], ['вторник', 2], ['среда', 3],
        ['четверг', 4], ['пятница', 5], ['суббота', 6], ['вс', 0], ['пн', 1],
        ['вт', 2], ['ср', 3], ['чт', 4], ['пт', 5], ['сб', 6],
      ]);
      const weekday = [...weekdays.keys()].find(name => rest === name || rest.startsWith(`${name} `));
      if (!weekday) return { error: `Не удалось распознать дату: ${value}` };
      const delta = (weekdays.get(weekday) - target.getDay() + 7) % 7 || 7;
      target.setDate(target.getDate() + delta);
      rest = rest.slice(weekday.length).trim();
    }
  }

  let time = null;
  if (kind === 'now' && !rest) time = localTime(base);
  if (rest) {
    const timeMatch = rest.match(/^(\d{1,2})(?::(\d{2}))?$/u);
    if (!timeMatch) return { error: `Некорректное время: ${rest}` };
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] || 0);
    if (hours > 23 || minutes > 59) return { error: `Некорректное время: ${rest}` };
    time = `${pad(hours)}:${pad(minutes)}`;
  }

  const due = { date: localDate(target), time };
  return { due, kind, label: time ? `${due.date} ${time}` : due.date };
}

export function parseQuick(value, { now = new Date() } = {}){
  const rawText = String(value ?? '');
  let working = rawText;
  const errors = [];
  const tags = [];

  for (const match of [...working.matchAll(/(?:^|\s)#([^\s#@!~]+)/gu)].reverse()) {
    const tag = match[1].trim();
    if (tag && !tags.some(item => item.toLowerCase() === tag.toLowerCase())) tags.unshift(tag);
    working = removeOnce(working, match);
  }

  const projectPattern = new RegExp(String.raw`(?:^|\s)@(?:"([^"]+)"|(.+?))${META_BOUNDARY}`, 'iu');
  const projectMatches = [...working.matchAll(new RegExp(projectPattern.source, 'giu'))];
  let projectQuery = null;
  if (/(?:^|\s)@(?=\s|$)/u.test(working)) errors.push('После @ укажите проект');
  if (projectMatches.length > 1) errors.push('Укажите только один @проект');
  if (projectMatches[0]) {
    projectQuery = String(projectMatches[0][1] || projectMatches[0][2] || '').trim();
  }
  for (const match of projectMatches.reverse()) working = removeOnce(working, match);

  const estimatePattern = /(?:^|\s)~\s*(\d{1,3})\s*(м|мин(?:ут[уы]?)?|m|min|ч|час(?:а|ов)?|h|hour(?:s)?)?(?=\s|$)/giu;
  const estimateMatches = [...working.matchAll(estimatePattern)];
  let estimateMin = null;
  if (estimateMatches.length > 1) errors.push('Укажите только одну оценку времени');
  if (estimateMatches[0]) {
    estimateMin = Number(estimateMatches[0][1]);
    if (/^(?:ч|час|h|hour)/iu.test(estimateMatches[0][2] || '')) estimateMin *= 60;
    if (estimateMin <= 0) errors.push('Оценка должна быть больше нуля');
  }
  for (const match of estimateMatches.reverse()) working = removeOnce(working, match);

  const priorityMatches = [...working.matchAll(/(?:^|\s)p(\d+)(?=\s|$)/giu)];
  const validPriorities = priorityMatches.filter(match => Number(match[1]) >= 1 && Number(match[1]) <= 4);
  if (priorityMatches.some(match => Number(match[1]) < 1 || Number(match[1]) > 4)) {
    errors.push('Приоритет должен быть в диапазоне p1–p4');
  }
  if (priorityMatches.length > 1) errors.push('Укажите только один приоритет');
  const priority = validPriorities[0] ? Number(validPriorities[0][1]) : 2;
  for (const match of priorityMatches.reverse()) working = removeOnce(working, match);

  const whenPattern = new RegExp(String.raw`(?:^|\s)!(.+?)${META_BOUNDARY}`, 'iu');
  const whenMatches = [...working.matchAll(new RegExp(whenPattern.source, 'giu'))];
  const whenMatch = whenMatches[0] || null;
  let due = null;
  let whenKind = null;
  let whenLabel = null;
  if (/(?:^|\s)!(?=\s|$)/u.test(working)) errors.push('После ! укажите дату или время');
  if (whenMatches.length > 1) errors.push('Укажите только одно время');
  if (whenMatch) {
    const parsedWhen = parseWhenRU(whenMatch[1], { now });
    if (parsedWhen.error) errors.push(parsedWhen.error);
    else {
      due = parsedWhen.due;
      whenKind = parsedWhen.kind;
      whenLabel = parsedWhen.label;
    }
  }
  for (const match of whenMatches.reverse()) working = removeOnce(working, match);

  const title = working.replace(/\s{2,}/g, ' ').trim();
  if (!title) errors.push('Введите название задачи');

  return {
    rawText, title, tags, projectQuery, due, whenKind, whenLabel,
    estimateMin, priority, errors,
  };
}

export function resolveQuickDraft(parsed, {
  projects = [],
  domains = [],
  activeDomainId = null,
  selectedProjectId = null,
} = {}){
  const errors = [...(parsed?.errors || [])];
  let projectId = null;
  let domainId = null;

  if (selectedProjectId && parsed?.projectQuery) {
    const selected = projects.find(project => project.id === selectedProjectId);
    if (!selected) errors.push('Выбранный проект больше не существует');
    else if (String(selected.title || '').trim().toLocaleLowerCase('ru-RU') !== parsed.projectQuery.toLocaleLowerCase('ru-RU')) {
      errors.push('Выбранный проект не совпадает с текущим @проектом');
    }
    else {
      projectId = selected.id;
      domainId = selected.domainId;
    }
  } else if (parsed?.projectQuery) {
    const query = parsed.projectQuery.toLocaleLowerCase('ru-RU');
    const matches = projects.filter(project => String(project.title || '').trim().toLocaleLowerCase('ru-RU') === query);
    if (matches.length === 0) errors.push(`Проект «${parsed.projectQuery}» не найден`);
    else if (matches.length > 1) errors.push(`Проект «${parsed.projectQuery}» неоднозначен — выберите его из списка`);
    else {
      projectId = matches[0].id;
      domainId = matches[0].domainId;
    }
  } else {
    const domain = domains.find(item => item.id === activeDomainId);
    if (!domain) errors.push('Выберите домен-контекст для задачи');
    else domainId = domain.id;
  }

  return {
    ...parsed,
    projectId,
    domainId,
    status: parsed?.whenKind === 'today' || parsed?.whenKind === 'now' ? 'today' : 'backlog',
    errors: [...new Set(errors)],
  };
}
