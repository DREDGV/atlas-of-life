import { saveDomainAttention } from '../../core/commands.js';
import { domainAttention } from '../../core/review-history.js';

const drafts = new Map();
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => {
  if (drafts.size) { event.preventDefault(); event.returnValue = ''; }
});

export function appendDomainReview(host, domain, reopen) {
  const draft = drafts.get(domain.id) || { intention: domain.intention || '',
    reviewEveryDays: domain.reviewEveryDays || 0, baseVersion: domain.updatedAt };
  const make = (tag, text) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const section = make('section');
  section.className = 'project-review domain-review';
  section.append(make('h3', 'Внимание к сфере'));
  const form = make('form');
  const intentionLabel = make('label', 'Что важно поддерживать');
  const intention = make('textarea');
  intention.name = 'intention'; intention.rows = 2; intention.maxLength = 500; intention.value = draft.intention;
  intention.placeholder = 'Например, регулярно двигаться и высыпаться';
  intentionLabel.append(intention);
  const rhythmLabel = make('label', 'Как часто возвращаться к обзору');
  const rhythm = make('select'); rhythm.name = 'reviewEveryDays';
  for (const [value, label] of [[0, 'По необходимости'], [7, 'Каждую неделю'], [14, 'Раз в две недели'], [30, 'Раз в месяц'], [90, 'Раз в три месяца']]) {
    rhythm.append(new Option(label, value));
  }
  rhythm.value = String(draft.reviewEveryDays); rhythmLabel.append(rhythm);
  const remember = () => drafts.set(domain.id, { intention: intention.value,
    reviewEveryDays: Number(rhythm.value), baseVersion: draft.baseVersion });
  form.addEventListener('input', remember); form.addEventListener('change', remember);
  const save = make('button', 'Сохранить ритм'); save.type = 'submit'; save.className = 'btn';
  const review = make('button', 'Отметить обзор'); review.type = 'submit'; review.className = 'btn primary';
  review.id = 'domainMarkReview';
  const discard = make('button', 'Сбросить черновик'); discard.type = 'button'; discard.className = 'btn';
  discard.onclick = () => { drafts.delete(domain.id); reopen(); };
  const status = make('p'); status.className = 'domain-review-status'; status.setAttribute('role', 'status');
  const attention = domainAttention(domain);
  const last = domain.attentionReviewedAt ? new Date(domain.attentionReviewedAt).toLocaleDateString('ru-RU') : 'ещё не отмечен';
  form.append(intentionLabel, rhythmLabel, save, review, discard, status);
  section.append(form, make('p', `Последний обзор — ${last}.`));
  if (attention.nextAt) section.append(make('p', `${attention.due ? 'Пора вернуться' : 'Следующий обзор'} — ${new Date(attention.nextAt).toLocaleDateString('ru-RU')}.`));
  section.append(make('p', 'Отметка фиксирует проверку сферы. Выполненные задачи учитываются отдельно. Ритм и история хранятся на этом устройстве.'));
  form.onsubmit = event => {
    event.preventDefault(); remember();
    const reviewed = event.submitter === review;
    try {
      saveDomainAttention(domain.id, drafts.get(domain.id), { expectedUpdatedAt: draft.baseVersion, review: reviewed });
      drafts.delete(domain.id);
      window.mapApi?.refresh?.({ layout: true }); reopen();
      host.querySelector('.domain-review-status').textContent = reviewed ? 'Обзор отмечен. Следующая дата рассчитана.' : 'Ритм сохранён.';
    } catch (error) { status.textContent = error.message; }
  };
  host.insertBefore(section, host.querySelector('.list'));
}
