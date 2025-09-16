// js/parser.js

// Parse quick-add text like: "Сделать обзор #дом @Проект !сегодня 10:00 ~30м p2"
export function parseQuick(text){
  const out = {title:text};
  // checklist
  const mChecklist = text.match(/✓([^\s#@!~p][^#@!~p]*)/i);
  if(mChecklist){ out.checklist=mChecklist[1].trim(); out.title=out.title.replace(mChecklist[0],'').trim(); }
  // tag
  const mTag = text.match(/#([^\s#@!~p]+)/i);
  if(mTag){ out.tag=mTag[1].trim(); out.title=out.title.replace(mTag[0],'').trim(); }
  // project
  const mProj = text.match(/@([^\s#@!~p][^#@!~p]*)/i);
  if(mProj){ out.project=mProj[1].trim(); out.title=out.title.replace(mProj[0],'').trim(); }
  // estimate: ~30, ~30м, ~1h, ~1ч
  const mEst = text.match(/~\s*([0-9]{1,3})\s*(м|мин|m|min|ч|h|hour|час|часа|часов)?/i);
  if(mEst){
    let val = parseInt(mEst[1],10);
    const unit = (mEst[2]||'').toLowerCase();
    if(/ч|h|hour|час/.test(unit)) val = val*60;
    out.estimate = val;
    out.title=out.title.replace(mEst[0],'').trim();
  }
  // priority p1..p4
  const mPr = text.match(/\bp([1-4])\b/i);
  if(mPr){ out.priority=parseInt(mPr[1]); out.title=out.title.replace(mPr[0],'').trim(); }
  // when !...
  const mWhen = text.match(/!([^\s].*)/i);
  if(mWhen){
    const raw = mWhen[1].trim();
    out.when = parseWhenRU(raw);
    out.title = out.title.replace(mWhen[0],'').trim();
  }
  out.title = out.title.replace(/\s{2,}/g,' ').trim();
  return out;
}

export function parseWhenRU(s){
  s = s.toLowerCase().trim();
  const weekdayMap = {
    'пн':1,'вт':2,'ср':3,'чт':4,'пт':5,'сб':6,'вс':0,
    'понедельник':1,'вторник':2,'среда':3,'четверг':4,'пятница':5,'суббота':6,'воскресенье':0
  };
  const now = new Date(); let target = new Date(now);
  // относительные
  if(s.startsWith('сейчас')) return {date:now.getTime(), label:'сейчас'};
  if(s.startsWith('завтра')){ target.setDate(now.getDate()+1); s=s.replace('завтра','').trim(); }
  else if(s.startsWith('послезавтра')){ target.setDate(now.getDate()+2); s=s.replace('послезавтра','').trim(); }
  else if(s.startsWith('сегодня')){ s=s.replace('сегодня','').trim(); }
  const mRel = s.match(/через\s+(\d+)\s*(ч|час|часа|часов|м|мин|минут)/);
  if(mRel){
    const n=parseInt(mRel[1],10); const unit=mRel[2];
    target = new Date(now);
    if(/ч|час/.test(unit)) target.setHours(target.getHours()+n);
    else target.setMinutes(target.getMinutes()+n);
    return {date:target.getTime(), label:`через ${n}${/ч|час/.test(unit)?'ч':'м'}`};
  }
  // день недели
  for(const [k,v] of Object.entries(weekdayMap)){
    if(s.startsWith(k)){
      const diffRaw = (v - now.getDay() + 7) % 7;
      const diff = diffRaw===0 ? 7 : diffRaw; // ближайший следующий
      target.setDate(now.getDate()+diff);
      s=s.slice(k.length).trim(); break;
    }
  }
  // время HH[:MM]
  const mTime = s.match(/(\d{1,2})(?::(\d{2}))?/);
  if(mTime){
    const hh=parseInt(mTime[1],10); const mm=mTime[2]?parseInt(mTime[2],10):0;
    target.setHours(hh, mm, 0, 0);
    return {date:target.getTime(), label:target.toLocaleString()};
  }
  // дата по умолчанию
  return {date:target.getTime(), label:target.toLocaleDateString()};
}

