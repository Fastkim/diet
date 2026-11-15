import { Vault, emptyData, STORAGE_KEY } from './vault.js';
import { todayISO, parseDate, formatDate, yearRecords, stats, movingAverage, chartRecords, monthlyStats, calendarDays } from './metrics.js';

const $ = (selector, context = document) => context.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const brand = () => `<div class="brand"><span class="brand-mark">${icon('leaf')}</span><div><span class="brand-name">하루의 무게</span><span class="brand-sub">A LITTLE, EVERY DAY</span></div></div>`;
const num = value => value == null ? '—' : Number(value).toFixed(1);
const signed = value => value == null ? '—' : `${value > 0 ? '+' : ''}${Math.abs(value) < .05 ? '0.0' : value.toFixed(1)}`;
const currentYear = () => Number(todayISO().slice(0,4));
const labels = {dashboard:'대시보드',calendar:'기록 캘린더',history:'모든 기록',settings:'나의 보관함'};
let vault, data = null, view = 'dashboard', year = currentYear(), range = 'year';
let historyMonth = '', historyQuery = '', historyPage = 1;
let authBusy = false, mutationBusy = false, epoch = 0, lastActivity = Date.now(), toastTimer;
let confirmResolve = null, recordOriginalDate = null;

function toast(message) {
  clearTimeout(toastTimer);
  const node = $('#toast'); node.textContent = message; node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; node.textContent = ''; }, 4200);
}

function renderAccess(message = '') {
  const exists = vault?.exists();
  $('#access').hidden = false;
  $('#access').innerHTML = `<div class="access-story">
    ${brand()}
    <div class="story-content"><p class="eyebrow">YOUR OWN PACE, YOUR OWN SPACE</p>
      <h1>나만의 속도로,<br><strong>하루의 무게.</strong></h1>
      <p class="story-copy">숫자 하나에 담긴 오늘의 나.<br>작은 기록을 모아, 변화의 흐름을 만나보세요.</p>
      <div class="story-visual" aria-hidden="true"><span class="eyebrow">LITTLE MOMENTS ADD UP</span><div class="mini-grid">${'<span class="mini-cell"></span>'.repeat(64)}</div><div class="visual-footer"><span>어제보다 꾸준한 오늘</span><span>ONE DAY AT A TIME ↗</span></div></div>
    </div><p class="access-footer">오직 나를 위한 작은 기록장.</p>
    </div><div class="access-form-side"><div class="access-form-wrap">
      <div class="access-lock">${icon('lock')}</div>
      <h2 id="access-title">${exists ? '다시 만나 반가워요.' : '나만의 기록을 시작해요.'}</h2>
      <p class="access-intro">${exists ? '이 브라우저에 보관된 기록이 잠겨 있어요.<br>비밀번호를 입력해 나의 기록장을 열어주세요.' : '기록을 지켜줄 비밀번호를 정해주세요.<br>나의 체중은 이 브라우저 안에만 암호화해 보관해요.'}</p>
      <form id="access-form">
        <label class="field"><span class="field-label">비밀번호</span><div class="password-wrap"><input id="access-password" name="password" type="password" autocomplete="${exists ? 'current-password' : 'new-password'}" minlength="10" maxlength="128" placeholder="10자 이상 입력해주세요" required><button type="button" class="show-password" data-action="show-password" aria-label="비밀번호 표시">보기</button></div></label>
        ${!exists ? '<label class="field"><span class="field-label">비밀번호 확인</span><input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" placeholder="한 번 더 입력해주세요" required><small>잊어버린 비밀번호는 복구할 수 없어요. 안전하게 보관해주세요.</small></label>' : ''}
        <p class="form-message" role="alert">${esc(message)}</p>
        <button class="primary full" type="submit">${exists ? '내 기록장 열기' : '기록장 만들기'} ${icon('arrow')}</button>
      </form>
      <div class="access-restore"><span>다른 기기의 기록이 있나요?</span><button type="button" class="text-button" data-action="restore">백업 가져오기</button></div>
      <div class="privacy-note">${icon('shield')}<p>링크를 공유해도 나의 기록은 공유되지 않아요.<br>기기 간 자동 동기화는 없어요. 기록은 암호화 백업으로 옮길 수 있어요.</p></div>
    </div></div>`;
}

function lock(message = '') {
  epoch++; vault?.lock(); data = null; authBusy = false; mutationBusy = false;
  historyQuery = ''; historyMonth = ''; historyPage = 1; range = 'year';
  $('#app').hidden = true; $('#app').replaceChildren();
  for (const dialog of document.querySelectorAll('dialog')) { if (dialog.open) dialog.close(); dialog.replaceChildren(); }
  confirmResolve?.(false); confirmResolve = null; recordOriginalDate = null;
  clearTimeout(toastTimer); $('#toast').hidden = true; $('#toast').textContent = '';
  renderAccess(message);
}

function startSession(result) {
  data = result; epoch++; lastActivity = Date.now();
  year = currentYear(); view = 'dashboard'; historyPage = 1; historyQuery = ''; historyMonth = ''; range = 'year';
  $('#access').hidden = true; $('#access').replaceChildren(); $('#app').hidden = false;
  renderApp(); window.scrollTo(0,0);
}

function yearOptions() {
  const years = new Set([currentYear(), currentYear()-1, currentYear()-2, year, ...data.records.map(r => Number(r.date.slice(0,4)))]);
  return [...years].sort((a,b)=>b-a).map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}년</option>`).join('');
}

function renderApp() {
  if (!data) return;
  const nav = [['dashboard','grid'],['calendar','calendar'],['history','list'],['settings','shield']];
  $('#app').innerHTML = `<aside class="sidebar" aria-label="주 메뉴">${brand()}<p class="nav-label">MY JOURNAL</p><nav class="nav-list">${nav.map(([key,i])=>`<button type="button" class="nav-item ${view===key?'active':''}" data-action="nav" data-view="${key}" ${view===key?'aria-current="page"':''}>${icon(i)}<span>${labels[key]}</span></button>`).join('')}</nav>
    <div class="sidebar-bottom"><div class="sidebar-note">${icon('leaf')}<p>빠르지 않아도 괜찮아요.<br>꾸준한 내가 더 소중하니까.</p><small>ONE DAY AT A TIME</small></div><div class="sidebar-private"><span class="private-icon">${icon('lock')}</span><div><strong>나만의 비공개 공간</strong><small>이 브라우저에 암호화 보관 중</small></div></div></div></aside>
    <div class="shell"><header class="topbar"><div class="breadcrumb"><span>하루의 무게</span><b aria-hidden="true">/</b><span>${labels[view]}</span></div><div class="topbar-actions"><span class="pill"><i class="pill-dot"></i> 나만 보는 기록</span><select id="year-select" class="year-picker" aria-label="기록 연도 선택">${yearOptions()}</select><button class="lock-button" data-action="lock" type="button">${icon('lock')} 잠그기</button></div></header>
    <main id="main-content" class="content" tabindex="-1">${renderHeading()}<div id="view-content">${view==='dashboard'?renderDashboard():view==='calendar'?renderCalendar():view==='history'?renderHistory():renderSettings()}</div><footer class="page-footer"><span>HARU · A LITTLE, EVERY DAY</span><span>이 브라우저에만 보관돼요. 소중한 기록은 가끔 백업해주세요.</span></footer></main></div>`;
  if(view === 'dashboard') syncQuickDate();
}

function renderHeading() {
  const title = view==='dashboard' ? '작은 기록이 만드는,<br><strong>가벼운 변화.</strong>' : view==='calendar' ? '<strong>나의 한 해를,</strong> 한눈에.' : view==='history' ? '차곡차곡 쌓인 <strong>나의 기록.</strong>' : '소중한 기록을 <strong>안전하게.</strong>';
  const desc = view==='dashboard' ? `${year}년의 나를 천천히 알아가는 중이에요.` : view==='calendar' ? '기록한 날을 눌러 하루의 무게를 살펴보세요.' : view==='history' ? '지나온 하루하루가 나만의 변화가 돼요.' : '백업과 목표 설정을 한곳에서 관리해요.';
  return `<div class="page-heading"><div><p class="eyebrow">${view==='dashboard'?'MY LITTLE PROGRESS':view==='calendar'?'A YEAR OF LITTLE MOMENTS':view==='history'?'EVERY DAY COUNTS':'MY PRIVATE SPACE'}</p><h1>${title}</h1><p class="intro">${desc}</p></div><div class="heading-right"><p class="heading-date">${icon('calendar')}${formatDate(todayISO(),{year:'numeric',month:'long',day:'numeric',weekday:'short'})}</p>${view!=='settings'?`<button type="button" class="primary" data-action="add">${icon('plus')} 오늘 기록하기</button>`:''}</div></div>`;
}

function renderStats() {
  const s = stats(data.records,year);
  const cards = [
    ['최근 체중',s.last?num(s.last.weight):'—','kg',s.last?`${formatDate(s.last.date)}에 남긴 기록`:'첫 체중을 기록해주세요','scale'],
    ['연간 체중 변화',signed(s.change),'kg',s.first?`${num(s.first.weight)}kg → ${num(s.last.weight)}kg · 첫 기록 대비`:'첫 기록부터 변화를 살펴봐요','trend'],
    ['최근 연속 기록',String(s.streak),'일',s.streak?`${formatDate(s.streakStart)} ~ ${formatDate(s.streakEnd)}`:'하루씩, 나만의 리듬으로','flame'],
    ['한 해 기록한 날',String(s.count),'일',`${year}년 ${calendarDays(year).length}일 중 나를 챙긴 날`,'calendar']
  ];
  return `<div class="stats-row">${cards.map(([label,value,unit,note,i],idx)=>`<article class="panel stat-card ${idx===1?'featured':''}"><div class="stat-label">${label}${icon(i)}</div><div class="stat-value number">${value}<small>${unit}</small></div><p class="stat-note">${note}</p></article>`).join('')}</div>`;
}

function renderDashboard() {
  return `${renderStats()}<div class="dashboard-grid"><div class="main-column">${renderChart()}${renderHeatmap()}${renderRecent()}</div><div class="right-column">${renderQuickForm()}${renderGoal()}${renderMonthly()}</div></div>`;
}

function renderChart() {
  const selected = chartRecords(data.records, year, range);
  return `<section class="panel chart-panel" aria-labelledby="trend-title"><div class="panel-head"><div><h2 class="panel-title" id="trend-title">체중의 흐름</h2><p class="panel-subtitle">매일의 숫자보다, 천천히 이어지는 흐름을 봐요.</p></div><div class="chart-toolbar" role="group" aria-label="차트 기간">${[['30','30일'],['90','90일'],['year','1년']].map(([v,t])=>`<button type="button" data-action="range" data-range="${v}" class="${range===v?'active':''}" aria-pressed="${range===v}">${t}</button>`).join('')}</div></div>
    <div class="chart-legend"><span><i class="legend-line"></i>기록한 체중</span><span><i class="legend-line average"></i>7일 이동 평균</span></div>
    ${selected.length ? chartSVG(selected) : `<div class="empty-state chart-empty">${icon('trend')}<strong>나의 변화가 시작될 자리</strong><p>첫 체중을 기록하면<br>이곳에 나만의 그래프가 그려져요.</p><button type="button" class="text-button" data-action="add">첫 기록 남기기 ${icon('arrow')}</button></div>`}
    <div class="chart-foot"><span>${selected.length ? `${formatDate(selected[0].date)} – ${formatDate(selected.at(-1).date)} · ${selected.length}개 기록` : `${year}년의 기록을 기다리고 있어요`}</span><span>${range==='year'?'선택한 연도 전체':'마지막 기록일 기준'}</span></div></section>`;
}

function chartSVG(records) {
  const W=700,H=242,L=45,R=22,T=22,B=32, innerW=W-L-R,innerH=H-T-B;
  const averages = movingAverage(data.records).filter(r=>r.date>=records[0].date&&r.date<=records.at(-1).date);
  const weights=[...records,...averages].map(r=>r.weight);
  let low=Math.min(...weights), high=Math.max(...weights);
  const pad=Math.max((high-low)*.22,.8); low=Math.floor((low-pad)*2)/2; high=Math.ceil((high+pad)*2)/2;
  const stamp = iso => parseDate(iso).getTime();
  const first=stamp(records[0].date),last=stamp(records.at(-1).date);
  const x=iso=>last===first?L+innerW/2:L+(stamp(iso)-first)/(last-first)*innerW;
  const y=weight=>T+(high-weight)/(high-low)*innerH;
  const points=records.map(r=>`${x(r.date).toFixed(2)},${y(r.weight).toFixed(2)}`).join(' ');
  const avPoints=averages.map(r=>`${x(r.date).toFixed(2)},${y(r.weight).toFixed(2)}`).join(' ');
  const yTicks=Array.from({length:5},(_,i)=>{const v=low+(high-low)*i/4;return `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#edf0e8" stroke-dasharray="3 5"/><text x="${L-10}" y="${y(v)+3}" text-anchor="end">${v.toFixed(1)}</text>`;}).join('');
  const indices=[...new Set(Array.from({length:Math.min(5,records.length)},(_,i)=>Math.round(i*(records.length-1)/Math.max(1,Math.min(5,records.length)-1))))];
  const xTicks=indices.map(i=>`<text x="${x(records[i].date)}" y="${H-9}" text-anchor="middle">${Number(records[i].date.slice(5,7))}.${Number(records[i].date.slice(8))}</text>`).join('');
  const circles=records.map(r=>`<circle class="chart-point" cx="${x(r.date)}" cy="${y(r.weight)}" r="${records.length>90?2:3.5}" tabindex="0" role="img" aria-label="${r.date}, ${num(r.weight)}kg" data-chart-date="${r.date}" data-weight="${num(r.weight)}"><title>${r.date} · ${num(r.weight)}kg</title></circle>`).join('');
  return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${year}년 체중 추이. 점에 마우스를 올리거나 키보드로 선택하면 날짜와 체중을 확인할 수 있어요."><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a4ba8c" stop-opacity=".23"/><stop offset="100%" stop-color="#a4ba8c" stop-opacity=".01"/></linearGradient></defs>${yTicks}${records.length>1?`<polygon points="${x(records[0].date)},${H-B} ${points} ${x(records.at(-1).date)},${H-B}" fill="url(#chart-fill)"/><polyline points="${avPoints}" fill="none" stroke="#b9c79c" stroke-width="2" stroke-dasharray="5 5"/><polyline points="${points}" fill="none" stroke="#5d8053" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`:''}${circles}${xTicks}</svg></div><p class="chart-selected" id="chart-selected" aria-live="polite">${records.length===1?'기록이 두 개 쌓이면 변화의 선이 이어져요.':'점을 선택해 그날의 체중을 확인해보세요.'}</p>`;
}

function renderHeatmap() {
  const days=calendarDays(year), map=new Map(yearRecords(data.records,year).map(r=>[r.date,r]));
  const firstOffset=(parseDate(days[0]).getDay()+6)%7;
  const cells=[...Array(firstOffset).fill(null),...days];
  while(cells.length%7)cells.push(null);
  const weeks=[];
  for(let i=0;i<cells.length;i+=7)weeks.push(cells.slice(i,i+7));
  const dayButton = d => d===null?'<span class="heat-day blank"></span>':`<button type="button" class="heat-day ${map.has(d)?'recorded':''} ${d===todayISO()?'today':''} ${d>todayISO()?'future':''}" data-action="day" data-date="${d}" ${d>todayISO()?'disabled':''} aria-label="${d}, ${map.has(d)?`${num(map.get(d).weight)}kg, 기록 수정`:'기록 없음, 기록 추가'}" title="${d}${map.has(d)?` · ${num(map.get(d).weight)}kg`:''}"></button>`;
  return `<section class="panel calendar-panel"><div class="panel-head"><div><h2 class="panel-title">나를 챙긴 날들</h2><p class="panel-subtitle">하루 한 칸, 조금씩 채워지는 나의 한 해</p></div><button type="button" class="text-button" data-action="nav" data-view="calendar">달력 보기 ${icon('arrow')}</button></div><div class="heatmap-container"><div class="heat-months" aria-hidden="true">${Array.from({length:12},(_,i)=>`<span>${i+1}월</span>`).join('')}</div><div class="heatmap" role="group" aria-label="${year}년 일별 기록 달력. 월요일부터 일요일 순서.">${weeks.map(w=>`<div class="heat-week">${w.map(dayButton).join('')}</div>`).join('')}</div><div class="heatmap-bottom"><span>${year}년, ${map.size}일의 소중한 기록</span><span class="heatmap-legend"><i class="legend-square"></i> 기록 전 <i class="legend-square filled"></i> 기록 완료</span></div></div></section>`;
}

function renderRecent() {
  const recent=yearRecords(data.records,year).reverse().slice(0,4);
  return `<section class="panel recent-panel"><div class="panel-head"><h2 class="panel-title">최근의 기록</h2><button type="button" class="text-button" data-action="nav" data-view="history">모두 보기 ${icon('arrow')}</button></div>${recent.length?`<ul class="records-list">${recent.map(r=>`<li class="record-row"><div class="record-date-box"><small>${Number(r.date.slice(5,7))}월</small><strong>${Number(r.date.slice(8))}</strong></div><div class="record-copy"><strong>${r.date===todayISO()?'오늘의 나':formatDate(r.date,{weekday:'long'})}</strong><p>${esc(r.note||'차곡차곡, 나를 위한 하루의 기록')}</p></div><span class="record-weight number">${num(r.weight)}<small>kg</small></span><button class="icon-button" type="button" data-action="edit" data-date="${r.date}" aria-label="${r.date} 기록 수정">${icon('edit')}</button></li>`).join('')}</ul>`:`<div class="empty-state"><p>아직 기록이 없어요.<br>오늘의 나를 가볍게 남겨볼까요?</p></div>`}</section>`;
}

function defaultDate() { return year===currentYear()?todayISO():`${year}-01-01`; }
function renderQuickForm() {
  return `<section class="panel quick-panel"><h2 class="panel-title">하루의 작은 기록</h2><p class="panel-subtitle">잠깐이면 충분해요.</p><form id="quick-form">${recordFields(defaultDate())}<p class="form-message" role="alert"></p><button type="submit" class="primary full">${icon('plus')}<span id="quick-submit-label">기록 남기기</span></button><p class="quick-hint">${icon('lock')} 비밀번호로 암호화해 저장해요</p></form></section>`;
}

function recordFields(date,record=null) {
  return `<label class="field"><span class="field-label">기록 날짜</span><input type="date" name="date" value="${date}" min="1000-01-01" max="${todayISO()}" required></label><label class="field"><span class="field-label">체중</span><div class="weight-field"><input type="number" name="weight" min="20" max="500" step="0.1" inputmode="decimal" value="${record?num(record.weight):''}" placeholder="0.0" required><span>kg</span></div></label><label class="field"><span class="field-label">하루의 메모 <span class="muted">(선택)</span></span><textarea name="note" maxlength="200" placeholder="오늘의 기분이나 작은 변화를 남겨보세요." rows="2">${esc(record?.note||'')}</textarea></label>`;
}

function syncQuickDate() {
  const form=$('#quick-form');if(!form||!data)return;
  const record=data.records.find(r=>r.date===form.elements.date.value);
  form.elements.weight.value=record?num(record.weight):'';
  form.elements.note.value=record?.note||'';
  $('#quick-submit-label').textContent=record?'기록 수정하기':'기록 남기기';
}

function renderGoal() {
  const s=stats(data.records,year),goal=data.goal;
  let inner;
  if(goal===null)inner='<p class="goal-empty">숫자보다 나의 페이스가 중요해요.<br>원한다면 나만의 목표를 정해보세요.</p>';
  else {
    const total=s.first?Math.abs(s.first.weight-goal):0;
    const progress=s.last?(total===0?(s.last.weight===goal?100:0):Math.max(0,Math.min(100,(1-Math.abs(s.last.weight-goal)/total)*100))):0;
    const left=s.last?Math.abs(s.last.weight-goal):null;
    inner=`<div class="goal-values"><div><strong class="number">${num(goal)}</strong><small>kg</small></div><span>${s.last?`최근 ${num(s.last.weight)} kg`:'첫 기록을 기다리는 중'}</span></div><div class="progress-track" role="progressbar" aria-label="목표 체중까지의 변화" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><svg class="progress-bar" width="${progress}%" height="5" aria-hidden="true"><rect width="100%" height="5" fill="#81976b"/></svg></div><p class="goal-caption">${left===null?'첫 기록부터 천천히 시작해봐요.':left<.05?'설정한 목표 체중에 도착했어요.':`목표까지 ${num(left)}kg · 나만의 속도로 가요.`}</p>`;
  }
  return `<section class="panel goal-panel"><div class="goal-header"><h2>나만의 목표</h2><button type="button" class="text-button" data-action="goal">${goal===null?'설정하기':'변경하기'} ${icon('arrow')}</button></div>${inner}</section>`;
}

function renderMonthly() {
  const months=monthlyStats(data.records,year),max=Math.max(1,...months.map(m=>m.count));
  return `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">월별 기록 습관</h2><p class="panel-subtitle">작은 꾸준함이 쌓이는 중</p></div></div><div class="monthly-bars" role="img" aria-label="월별 기록 일수: ${months.map(m=>`${m.month}월 ${m.count}일`).join(', ')}">${months.map(m=>`<div class="month-bar-column"><small>${m.count||''}</small><svg class="month-bar ${m.count?'':'empty'}" height="${m.count?Math.max(5,m.count/max*90):2}" aria-hidden="true"><rect width="100%" height="100%" fill="${m.count?'#9bb18a':'#edf1e7'}"/></svg></div>`).join('')}</div><div class="monthly-bar-labels" aria-hidden="true">${months.map(m=>`<span>${m.month}</span>`).join('')}</div></section>`;
}

function renderCalendar() {
  const selected=yearRecords(data.records,year),map=new Map(selected.map(r=>[r.date,r])),months=monthlyStats(data.records,year),s=stats(data.records,year);
  return `<div class="year-summary"><span>${year}년 ${s.count}일 기록</span><span>평균 ${num(s.average)} kg</span><span>최저 ${num(s.min)} kg · 최고 ${num(s.max)} kg</span></div><div class="months-grid">${months.map(m=>{
    const prefix=`${year}-${String(m.month).padStart(2,'0')}`;
    const days=calendarDays(year).filter(d=>d.startsWith(prefix));
    const offset=(parseDate(days[0]).getDay()+6)%7;
    return `<section class="panel month-card"><div class="month-title"><h2>${m.month}월</h2><span>${m.count}일의 기록</span></div><div class="month-grid">${['월','화','수','목','금','토','일'].map(d=>`<span class="weekday">${d}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(offset)}${days.map(d=>`<button type="button" class="month-day ${map.has(d)?'recorded':''} ${d===todayISO()?'today':''}" data-action="day" data-date="${d}" ${d>todayISO()?'disabled':''} aria-label="${d}${map.has(d)?`, ${num(map.get(d).weight)}kg, 기록 수정`:', 기록 추가'}"><span>${Number(d.slice(8))}</span><small>${map.has(d)?num(map.get(d).weight):'&nbsp;'}</small></button>`).join('')}</div><p class="month-foot"><span>평균 ${num(m.average)} kg</span><span>월간 변화 ${signed(m.change)} kg</span></p></section>`;
  }).join('')}</div>`;
}

function filteredHistory() {
  return yearRecords(data.records,year).reverse().filter(r=>(!historyMonth||Number(r.date.slice(5,7))===Number(historyMonth))&&(!historyQuery||`${r.date} ${r.weight.toFixed(1)} ${r.note}`.toLowerCase().includes(historyQuery.toLowerCase())));
}
function renderHistory() {
  const filtered=filteredHistory(),pages=Math.max(1,Math.ceil(filtered.length/20));historyPage=Math.min(historyPage,pages);
  const rows=filtered.slice((historyPage-1)*20,historyPage*20);
  return `<section class="panel"><div class="history-tools"><input id="history-search" class="search-input" type="search" placeholder="날짜, 체중, 메모로 찾기" aria-label="기록 검색" maxlength="200" value="${esc(historyQuery)}"><select id="history-month" aria-label="기록 월 선택"><option value="">모든 달</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(historyMonth)===i+1?'selected':''}>${i+1}월</option>`).join('')}</select><span class="history-count">총 ${filtered.length}개의 기록</span></div>${rows.length?`<div class="history-table-wrap"><table class="history-table"><thead><tr><th scope="col">날짜</th><th scope="col">체중</th><th scope="col">하루의 메모</th><th scope="col">관리</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${formatDate(r.date,{month:'long',day:'numeric',weekday:'short'})}</td><td class="weight-cell number">${num(r.weight)}<small>kg</small></td><td class="note-cell">${esc(r.note||'—')}</td><td><button class="icon-button" type="button" data-action="edit" data-date="${r.date}" aria-label="${r.date} 수정">${icon('edit')}</button><button class="icon-button" type="button" data-action="delete" data-date="${r.date}" aria-label="${r.date} 삭제">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div><div class="pagination"><button type="button" data-action="page" data-page="${historyPage-1}" ${historyPage<=1?'disabled':''}>이전</button><span>${historyPage} / ${pages}</span><button type="button" data-action="page" data-page="${historyPage+1}" ${historyPage>=pages?'disabled':''}>다음</button></div>`:`<div class="empty-state">${icon('list')}<strong>${historyQuery||historyMonth?'찾는 기록이 없어요.':'아직 남긴 기록이 없어요.'}</strong><p>${historyQuery||historyMonth?'검색어나 선택한 달을 바꿔보세요.':'첫 체중을 남기고 나만의 변화를 시작해보세요.'}</p></div>`}</section>`;
}

function renderSettings() {
  return `<div class="settings-grid"><section class="panel settings-card"><h2>기록 백업과 복원</h2><p>다른 기기에서도 기록을 이어가고 싶다면?<br>암호화된 파일로 안전하게 옮길 수 있어요.</p><div class="backup-actions"><button type="button" class="primary" data-action="backup">${icon('download')} 암호화 백업</button><button type="button" class="secondary" data-action="restore">${icon('upload')} 백업 가져오기</button></div><div class="notice">이 브라우저에 총 <strong>${data.records.length}개</strong>의 기록이 있어요.<br>백업 파일에는 모든 연도의 기록과 목표가 함께 담겨요. 복원할 때는 백업을 만들 때 사용한 비밀번호가 필요해요.</div><p class="detail-note">브라우저 데이터를 삭제하거나 시크릿 모드를 종료하면 기록이 사라질 수 있어요. 정기적으로 백업해 주세요. 비밀번호를 잊어버리면 복구할 수 없어요.</p></section><div class="settings-stack"><section class="panel settings-card"><h2>나만의 목표 체중</h2><p>목표는 선택이에요. 내가 원하는 숫자를 정해보세요.</p><form id="goal-form"><div class="goal-form"><label class="field"><span class="field-label">목표 체중 (kg)</span><input id="goal-weight" name="goal" type="number" min="20" max="500" step="0.1" inputmode="decimal" placeholder="예: 65.0" value="${data.goal===null?'':num(data.goal)}" required></label><button type="submit" class="primary">저장</button></div><p class="form-message" role="alert"></p></form>${data.goal!==null?'<button type="button" class="text-button" data-action="remove-goal">목표 설정 지우기</button>':''}</section><section class="panel settings-card"><div class="privacy-heading">${icon('shield')}<h2>기록은 나에게만</h2></div><ul class="privacy-list"><li>${icon('check')}<span>체중과 메모는 이 브라우저에 암호화해 저장해요. 서버나 GitHub에 전송하지 않아요.</span></li><li>${icon('check')}<span>다른 사람이 링크를 열어도 내 기록은 보이지 않아요. 같은 기기를 함께 쓴다면 사용 후 잠가주세요.</span></li><li>${icon('check')}<span>다른 탭이나 앱으로 전환해도 열린 상태를 유지해요. 5분간 활동이 없으면 자동으로 잠겨요. 저장하지 않은 입력은 사라져요.</span></li><li>${icon('check')}<span>기기 간 자동 동기화는 없어요. 기록을 옮길 때 암호화 백업을 사용해주세요.</span></li></ul></section></div></div>`;
}

function openRecord(date=todayISO()) {
  if(!data||date>todayISO())return;
  const record=data.records.find(r=>r.date===date);recordOriginalDate=record?date:null;
  const dialog=$('#record-dialog');
  dialog.innerHTML=`<div class="dialog-head"><h2 id="record-dialog-title">${record?'하루의 기록 수정':'하루의 기록 남기기'}</h2><button type="button" class="icon-button" data-action="close" aria-label="닫기">${icon('close')}</button></div><form id="record-form">${recordFields(date,record)}<p class="form-message" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-action="close">취소</button><button type="submit" class="primary">${record?'수정 저장':'기록 저장'} ${icon('check')}</button></div></form>`;
  dialog.showModal();
  requestAnimationFrame(()=>$('input[name="weight"]',dialog)?.focus());
}

function askConfirm(title,message,action='확인') {
  const dialog=$('#confirm-dialog');
  dialog.innerHTML=`<h2 id="confirm-title">${esc(title)}</h2><p>${esc(message)}</p><div class="dialog-actions"><button type="button" class="secondary" data-action="confirm-cancel">취소</button><button type="button" class="danger" data-action="confirm-ok">${esc(action)}</button></div>`;
  dialog.showModal();
  return new Promise(resolve=>{confirmResolve=resolve;});
}

function openRestore() {
  const dialog=$('#restore-dialog');
  dialog.innerHTML=`<div class="dialog-head"><h2 id="restore-title">기록 백업 가져오기</h2><button class="icon-button" type="button" data-action="close" aria-label="닫기">${icon('close')}</button></div><p class="dialog-description">암호화 백업 파일과, 백업을 만들 때 사용한 비밀번호를 입력해주세요.</p><form id="restore-form"><label class="field"><span class="field-label">암호화 백업 파일 (.json)</span><input class="file-input" name="backup" type="file" accept=".json,application/json" required></label><label class="field"><span class="field-label">백업의 비밀번호</span><input name="password" type="password" autocomplete="off" minlength="10" maxlength="128" required></label><div class="notice">${vault.exists()?'복원하면 이 브라우저의 기존 기록 전체가 백업 내용으로 교체돼요. 기존 기록을 먼저 백업하는 것을 권장해요.':'기록은 이 브라우저에만 복원돼요. 백업의 비밀번호로 기록장을 열 수 있어요.'}</div><p class="form-message" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-action="close">취소</button><button type="submit" class="primary">${icon('upload')} 복원하기</button></div></form>`;
  dialog.showModal();
}

async function persist(next) {
  const activeEpoch=epoch;
  const result=await vault.save(next);
  if(activeEpoch!==epoch||!data)return false;
  data=result;return true;
}

async function submitRecord(form) {
  if(mutationBusy||!data)return;
  const activeEpoch=epoch,original=form.id==='record-form'?recordOriginalDate:null;
  const date=form.elements.date.value,weight=Number(form.elements.weight.value),note=form.elements.note.value.trim();
  const other=data.records.find(r=>r.date===date&&r.date!==original);
  if(other) {
    const ok=await askConfirm('이 날짜에 기록이 있어요.',`${formatDate(date)}의 체중 ${num(other.weight)}kg과 메모를 새 내용으로 바꿀까요?`,'바꾸기');
    if(!ok||activeEpoch!==epoch||!data)return;
  }
  mutationBusy=true;const submit=$('button[type="submit"]',form);submit.disabled=true;
  try {
    const next={...data,records:[...data.records.filter(r=>r.date!==date&&r.date!==original),{date,weight,note}]};
    if(await persist(next)) {
      if($('#record-dialog').open)$('#record-dialog').close();
      recordOriginalDate=null;year=Number(date.slice(0,4));renderApp();toast(other||original?'기록을 수정했어요.':'오늘의 작은 기록을 남겼어요.');
    }
  }catch(error){if(activeEpoch===epoch)$('.form-message',form).textContent=error.message;}
  finally{mutationBusy=false;if(submit.isConnected)submit.disabled=false;}
}

async function submitAccess(form) {
  if(authBusy)return;authBusy=true;
  const activeEpoch=epoch,submit=$('button[type="submit"]',form),message=$('.form-message',form);message.textContent='';submit.disabled=true;
  try {
    const password=form.elements.password.value;
    let result;
    if(vault.exists()) result=await vault.unlock(password);
    else {
      if(password!==form.elements.confirm.value)throw new Error('두 비밀번호가 같지 않아요. 다시 확인해주세요.');
      result=await vault.setup(password,emptyData());
    }
    form.reset();if(activeEpoch===epoch)startSession(result);
  }catch(error){if(activeEpoch===epoch){message.textContent=error.message;form.elements.password.value='';if(form.elements.confirm)form.elements.confirm.value='';form.elements.password.focus();}}
  finally{authBusy=false;if(submit.isConnected)submit.disabled=false;}
}

async function submitRestore(form) {
  if(mutationBusy)return;
  const activeEpoch=epoch;
  const file=form.elements.backup.files[0];if(!file)return;
  if(file.size>32*1024*1024){$('.form-message',form).textContent='백업 파일은 32MB 이하여야 해요.';return;}
  mutationBusy=true;const button=$('button[type="submit"]',form);button.disabled=true;
  try {
    const json=await file.text();vault.inspectBackup(json);
    if(vault.exists()) {
      const ok=await askConfirm('기존 기록을 교체할까요?','백업 속 모든 연도의 기록으로 교체돼요. 현재 기록은 따로 백업하지 않았다면 되돌릴 수 없어요.','복원하기');
      if(!ok||activeEpoch!==epoch)return;
    }
    if(activeEpoch!==epoch)return;
    const result=await vault.restore(json,form.elements.password.value);
    form.reset();$('#restore-dialog').close();
    if(activeEpoch===epoch){startSession(result);toast('백업의 기록을 안전하게 복원했어요.');}
  }catch(error){if(activeEpoch===epoch)$('.form-message',form).textContent=error.message;}
  finally{mutationBusy=false;if(button.isConnected)button.disabled=false;}
}

async function submitGoal(form) {
  if(mutationBusy||!data)return;mutationBusy=true;const activeEpoch=epoch,button=$('button[type="submit"]',form);button.disabled=true;
  try{if(await persist({...data,goal:Number(form.elements.goal.value)})){renderApp();toast('나만의 목표를 저장했어요.');}}
  catch(error){if(activeEpoch===epoch)$('.form-message',form).textContent=error.message;}
  finally{mutationBusy=false;if(button.isConnected)button.disabled=false;}
}

function backup() {
  const json=vault.exportEncrypted(),url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`haru-backup-${todayISO()}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);toast('암호화 백업을 내려받았어요. 비밀번호도 안전하게 보관해주세요.');
}

document.addEventListener('submit',event=>{
  const form=event.target;
  if(!['access-form','quick-form','record-form','restore-form','goal-form'].includes(form.id))return;
  event.preventDefault();
  if(form.id==='access-form')submitAccess(form);
  else if(form.id==='restore-form')submitRestore(form);
  else if(form.id==='goal-form')submitGoal(form);
  else submitRecord(form);
});

document.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action;
  try {
    if(action==='lock')lock('기록장을 안전하게 잠갔어요.');
    else if(action==='show-password') {
      const input=$('input',button.parentElement);input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'보기':'숨기기';button.setAttribute('aria-label',input.type==='password'?'비밀번호 표시':'비밀번호 숨기기');
    }
    else if(action==='restore')openRestore();
    else if(action==='close'){const dialog=button.closest('dialog');dialog.close();dialog.replaceChildren();}
    else if(action==='confirm-ok'||action==='confirm-cancel') {
      const resolve=confirmResolve;confirmResolve=null;$('#confirm-dialog').close();resolve?.(action==='confirm-ok');
    }
    else if(!data)return;
    else if(action==='nav'){view=button.dataset.view;renderApp();window.scrollTo(0,0);$('#main-content').focus({preventScroll:true});}
    else if(action==='goal'){view='settings';renderApp();$('#goal-weight').focus();}
    else if(action==='add')openRecord(todayISO());
    else if(action==='edit'||action==='day')openRecord(button.dataset.date);
    else if(action==='range') {
      range=button.dataset.range;const panel=$('.chart-panel');panel.outerHTML=renderChart();$(`button[data-range="${range}"]`).focus({preventScroll:true});
    }
    else if(action==='page'){historyPage=Number(button.dataset.page);$('#view-content').innerHTML=renderHistory();}
    else if(action==='backup')backup();
    else if(action==='delete') {
      const activeEpoch=epoch,date=button.dataset.date;
      const confirmed=await askConfirm('이 날의 기록을 지울까요?',`${date}의 체중과 메모가 삭제돼요. 삭제한 기록은 되돌릴 수 없어요.`,'삭제하기');
      if(confirmed&&activeEpoch===epoch&&!mutationBusy&&data){mutationBusy=true;try{if(await persist({...data,records:data.records.filter(r=>r.date!==date)})){renderApp();toast('기록을 삭제했어요.');}}finally{mutationBusy=false;}}
    }
    else if(action==='remove-goal'&&!mutationBusy){mutationBusy=true;try{if(await persist({...data,goal:null})){renderApp();toast('목표 설정을 지웠어요.');}}finally{mutationBusy=false;}}
  }catch(error){toast(error.message);}
});

document.addEventListener('change',event=>{
  if(event.target.id==='year-select') {year=Number(event.target.value);historyPage=1;renderApp();}
  if(event.target.matches('#quick-form input[name="date"]'))syncQuickDate();
  if(event.target.id==='history-month'){historyMonth=event.target.value;historyPage=1;$('#view-content').innerHTML=renderHistory();}
});

document.addEventListener('input',event=>{
  if(event.target.id==='history-search') {
    historyQuery=event.target.value;historyPage=1;
    const start=event.target.selectionStart,end=event.target.selectionEnd;
    $('#view-content').innerHTML=renderHistory();const input=$('#history-search');input.focus();input.setSelectionRange(start,end);
  }
});

for(const name of ['pointerover','focusin'])document.addEventListener(name,event=>{
  const point=event.target.closest('[data-chart-date]');
  if(point&&$('#chart-selected'))$('#chart-selected').textContent=`${formatDate(point.dataset.chartDate,{month:'long',day:'numeric',weekday:'short'})} · ${point.dataset.weight} kg`;
});

$('#confirm-dialog').addEventListener('cancel',()=>{const resolve=confirmResolve;confirmResolve=null;resolve?.(false);});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{
  if(dialog.id==='confirm-dialog'){const resolve=confirmResolve;confirmResolve=null;resolve?.(false);}
  // Remove password and personal form values as soon as a dialog is dismissed.
  if(!dialog.open)dialog.replaceChildren();
});
for(const event of ['pointerdown','keydown','input','scroll'])document.addEventListener(event,()=>{lastActivity=Date.now();},{passive:true});
setInterval(()=>{if(data&&Date.now()-lastActivity>=5*60*1000)lock('5분 동안 활동이 없어 기록장을 잠갔어요.');},10000);
window.addEventListener('pagehide',()=>{if(vault)lock();});
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY||event.key===null)lock('다른 탭에서 보관함이 바뀌었어요. 다시 열어주세요.');});

try {
  vault=new Vault();
  if(!globalThis.crypto?.subtle||!globalThis.isSecureContext)throw new Error('이 기록장은 HTTPS 또는 localhost 주소에서 사용할 수 있어요. GitHub Pages의 HTTPS 주소나 로컬 미리보기 주소로 접속해주세요.');
  renderAccess();
}catch(error) {
  $('#access').innerHTML=`<div class="access-form-side"><div class="access-form-wrap">${brand()}<h1 id="access-title">기록장을 열 수 없어요.</h1><p class="unsupported">${esc(error.message)}</p></div></div>`;
}
