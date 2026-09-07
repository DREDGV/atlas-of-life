// Read-only library queries shared by the workspace and Inspector.
export function knowledgeContext(state, item){
  const project = state.projects.find(entry => entry.id === item.projectId);
  const domain = state.domains.find(entry => entry.id === (project?.domainId || item.domainId));
  return { project, domain, label:[domain?.title, project?.title].filter(Boolean).join(' / ') || 'Без контекста' };
}
export function materialActions(state, id){ return state.tasks.filter(task => task.sourceKnowledgeId === id); }
export function queryKnowledge(state, {query='', kind='all', domain='all', sort='updated'} = {}){
  const terms = query.trim().toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean);
  return state.knowledge.filter(item => {
    const context = knowledgeContext(state, item);
    if (kind !== 'all' && item.kind !== kind) return false;
    if (domain === 'none' && (item.projectId || item.domainId)) return false;
    if (domain !== 'all' && domain !== 'none' && context.domain?.id !== domain) return false;
    const text = `${item.title}\n${item.text}\n${context.label}`.toLocaleLowerCase('ru-RU');
    return terms.every(term => text.includes(term));
  }).sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title,'ru') : (b.updatedAt || 0) - (a.updatedAt || 0) || a.id.localeCompare(b.id));
}
