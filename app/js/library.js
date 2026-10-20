
const DATA=JSON.parse(document.getElementById('library-data').textContent);
const $=s=>document.querySelector(s);
const ACHIEVEMENT_KEY='kpl2k_achievements_v1';
let achievementToastTimer=null;
function fmt(v,d=1){return v==null||isNaN(v)?'-':(+v).toFixed(d)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function hue(s){let h=0;for(const c of String(s))h=(h*31+c.codePointAt(0))>>>0;return h%360}
function recordLibraryRead(id){
  try{
    const progress=JSON.parse(localStorage.getItem(ACHIEVEMENT_KEY)||'{}');
    if(!progress.libraryPlayers||typeof progress.libraryPlayers!=='object'||Array.isArray(progress.libraryPlayers))progress.libraryPlayers={};
    if(!progress.unlocked||typeof progress.unlocked!=='object'||Array.isArray(progress.unlocked))progress.unlocked={};
    progress.libraryPlayers=Object.fromEntries(Object.keys(progress.libraryPlayers).map(key=>[key.split('@')[0],true]));
    const before=Object.keys(progress.libraryPlayers).length;
    progress.libraryPlayers[id]=true;
    const count=Object.keys(progress.libraryPlayers).length,names=[];
    if(before<1&&count>=1&&!progress.unlocked.library_read){progress.unlocked.library_read=Date.now();names.push('初识群星')}
    if(before<10&&count>=10&&!progress.unlocked.library_ten){progress.unlocked.library_ten=Date.now();names.push('群星观察家')}
    localStorage.setItem(ACHIEVEMENT_KEY,JSON.stringify(progress));
    if(names.length){
      $('#achievement-toast-name').textContent=names.join('、');
      $('#achievement-toast').classList.add('show');
      clearTimeout(achievementToastTimer);
      achievementToastTimer=setTimeout(()=>$('#achievement-toast').classList.remove('show'),6500);
    }
  }catch(e){}
}
function toggleCard(el,id){
  const opening=!el.classList.contains('open');
  if(opening&&!el.dataset.versionsMounted){el.querySelector('.versions').innerHTML=versionHtml(byCardId.get(id));el.dataset.versionsMounted='1'}
  el.classList.toggle('open',opening);el.setAttribute('aria-expanded',String(opening));
  if(opening)recordLibraryRead(baseId(id));
}
const KEY_STATS={
  '对抗路':[['be_hurt_rate','承伤'],['hurt_rate','输出'],['towers','推塔']],
  '打野':[['kills','击杀'],['participation','参团'],['gpm','经济']],
  '中路':[['hurt_rate','输出'],['damage_convert','转化'],['participation','参团']],
  '发育路':[['kda','KDA'],['hurt_rate','输出'],['gpm','经济']],
  '游走':[['participation','参团'],['be_hurt_rate','承伤'],['assists','助攻']]
};
function keyStats(v){
  if(!v)return '资料不完整';
  const defs=KEY_STATS[v.position]||[['kda','KDA']];
  return defs.map(([k,label])=>{
    const val=v[k];
    if(val==null||isNaN(val))return `${label} -`;
    if(k==='hurt_rate'||k==='be_hurt_rate')return `${label} ${fmt(val,0)}%`;
    if(k==='participation')return `${label} ${fmt(val,0)}%`;
    return `${label} ${fmt(val)}`;
  }).join(' · ');
}
function versionHtml(p){
  return p.versions.map(v=>`
    <div class="ver">
      <div class="ver-top"><span>${esc(v.season_label)} · ${esc(v.team)} · ${esc(v.position)}
        ${v.peak?'<span class="badge b-peak">巅峰</span>':''}
      </span><span class="v-rating">战力 ${fmt(v.rating)}</span></div>
      <div class="v-stats">${keyStats(v)} · 胜率 ${fmt(v.win_rate==null?null:v.win_rate*100,0)}% · ${v.games} 场
        ${v.mvp_count?`<span class="v-mvp">· MVP ${v.mvp_count} 次（${fmt(v.mvp_per_game,2)}/场）</span>`:''}</div>
      ${v.heroes.length?`<div class="heroes">英雄池：${v.heroes.slice(0,12).map(esc).join(' / ')}${v.heroes.length>12?' …':''}</div>`:''}
    </div>`).join('');
}
function card(p){
  const peak=p.versions.find(v=>v.peak)||p.versions[0];
  const status=p.active?'<span class="badge b-active">现役</span>'
    :(p.current_team?`<span class="badge b-move">现役：${esc(p.current_team)}</span>`
    :'<span class="badge b-retire">退役</span>');
  const avatar=p.icon
    ? `<img class="ava" loading="lazy" decoding="async" width="44" height="44" src="${esc(p.icon)}" alt="${esc(p.name)}" data-fallback="${esc(p.name[0])}" data-hue="${hue(p.name)}">`
    : `<div class="ava" style="background:hsl(${hue(p.name)},65%,46%)">${esc(p.name[0])}</div>`;
  return `<div class="card" data-player-id="${esc(p.id)}" role="button" tabindex="0" aria-expanded="false" aria-label="${esc(p.name)} · ${esc(p.team)}，展开年度版本">
    <div class="head">
      ${avatar}
      <div>
        <div class="nm">${esc(p.name)}${p.legend?'<span class="badge b-legend">传奇</span>':''}</div>
        <div class="tm">${esc(p.team)}</div>
        <div class="st">${status}</div>
      </div>
      <div class="pk">${fmt(p.peak_rating)}<small>巅峰战力</small></div>
    </div>
    <div class="brief">
      <span class="b"><b>${p.version_count}</b> 版本</span>
      <span class="b"><b>${p.mvp_total}</b> 次 MVP</span>
      ${p.debut_year?`<span class="b"><b>${p.debut_year}</b> KPL 首秀</span>`:''}
      ${p.championship_count!=null?`<span class="b"><b>${p.championship_count}</b> 冠</span>`:''}
      <span class="b">${keyStats(peak)}</span>
    </div>
    <div class="tags">${p.positions.map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div>
    <div class="versions"></div>
  </div>`;
}
const baseId=id=>String(id).split('@')[0];
const byCardId=new Map(DATA.players.map(p=>[p.id,p]));
const searchIndex=new Map(DATA.players.map(p=>[p.id,[p.name,p.real_name,p.id,p.team].filter(Boolean).join(' ').toLocaleLowerCase()]));
const PAGE_SIZE=36;
let visibleLimit=PAGE_SIZE,filtered=[];
function render(reset=true){
  if(reset)visibleLimit=PAGE_SIZE;
  const q=$('#q').value.trim().toLocaleLowerCase(),team=$('#team').value,pos=$('#pos').value,sort=$('#sort').value;
  filtered=DATA.players.filter(p=>(!q||searchIndex.get(p.id).includes(q))&&(!team||p.team===team)&&(!pos||p.positions.includes(pos)));
  filtered.sort((a,b)=>{
    let order=0;
    if(sort==='name')order=a.name.localeCompare(b.name,'zh');
    else if(sort==='peak')order=a.peak_rating-b.peak_rating;
    else if(sort==='-mvp')order=b.mvp_total-a.mvp_total;
    else order=(!!b.icon-!!a.icon)||(!!b.active-!!a.active)||(b.last_order-a.last_order)||(b.peak_rating-a.peak_rating);
    return order||a.id.localeCompare(b.id);
  });
  const visible=filtered.slice(0,visibleLimit),groups=new Map();
  for(const p of visible){if(!groups.has(p.team))groups.set(p.team,[]);groups.get(p.team).push(p)}
  $('#meta').textContent=`${new Set(DATA.players.map(p=>baseId(p.id))).size} 位选手 · ${DATA.players.length} 张战队卡 · 共 ${DATA.players.reduce((s,p)=>s+p.version_count,0)} 个年度版本`;
  $('#list').innerHTML=visible.length?[...groups].map(([team,rows])=>`<section class="team"><h2>${esc(team)}<span>${rows.length} 张卡</span></h2><div class="cards">${rows.map(card).join('')}</div></section>`).join(''):'<div class="empty">没有匹配的选手</div>';
  $('#load-more').hidden=visible.length>=filtered.length;
  $('#load-more').textContent=`加载更多（已显示 ${visible.length} / ${filtered.length} 张卡）`;
  $('#list').querySelectorAll('img[data-fallback]').forEach(img=>img.addEventListener('error',()=>{const fallback=document.createElement('div');fallback.className='ava';fallback.style.background=`hsl(${Number(img.dataset.hue)||0},65%,46%)`;fallback.textContent=img.dataset.fallback||'?';img.replaceWith(fallback)},{once:true}));
}
function revealPlayer(value){
  if(!value)return;
  const exact=byCardId.get(value);
  const matches=exact?[exact]:DATA.players.filter(p=>baseId(p.id)===baseId(value)).sort((a,b)=>(!!b.active-!!a.active)||(b.last_order-a.last_order)||a.id.localeCompare(b.id));
  const target=matches[0];if(!target)return;
  $('#q').value='';$('#team').value='';$('#pos').value='';render();
  const index=filtered.findIndex(p=>p.id===target.id);visibleLimit=Math.max(PAGE_SIZE,Math.ceil((index+1)/PAGE_SIZE)*PAGE_SIZE);render(false);
  const el=[...document.querySelectorAll('.card[data-player-id]')].find(el=>el.dataset.playerId===target.id);
  if(el){toggleCard(el,target.id);el.focus();el.scrollIntoView({block:'center',behavior:'auto'})}
}
function requestedPlayer(){return new URL(location.href).searchParams.get('player')||new URLSearchParams(location.hash.replace(/^#(?:library)?\??/,'')).get('player')}
$('#load-more').addEventListener('click',()=>{const count=visibleLimit;visibleLimit+=PAGE_SIZE;render(false);[...document.querySelectorAll('.card[data-player-id]')].find(el=>el.dataset.playerId===filtered[count]?.id)?.focus()});
$('#list').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const el=event.target.closest('.card[data-player-id]');if(el){event.preventDefault();toggleCard(el,el.dataset.playerId)}}});
$('#list').addEventListener('click',event=>{
  const card=event.target.closest('.card[data-player-id]');
  if(card&&$('#list').contains(card))toggleCard(card,card.dataset.playerId);
});
$('#team').innerHTML='<option value="">全部战队</option>'+[...new Set(DATA.players.map(p=>p.team))].sort((a,b)=>a.localeCompare(b,'zh')).map(t=>`<option>${esc(t)}</option>`).join('');
['q','team','pos','sort'].forEach(id=>$('#'+id).addEventListener('input',()=>render()));
$('#rules-mask').setAttribute('role','dialog');$('#rules-mask').setAttribute('aria-modal','true');$('#rules-mask').setAttribute('aria-label','战力计算规则');
$('#rules-btn').addEventListener('click',function(){$('#rules-mask').classList.add('show');$('#rules-close').focus();});
$('#rules-close').addEventListener('click',function(){$('#rules-mask').classList.remove('show');$('#rules-btn').focus();});
$('#rules-mask').addEventListener('click',function(e){if(e.target===this)this.classList.remove('show');});
render();
revealPlayer(requestedPlayer());
window.addEventListener('hashchange',()=>revealPlayer(requestedPlayer()));

document.addEventListener('keydown',event=>{if(!$('#rules-mask').classList.contains('show'))return;if(event.key==='Escape'){$('#rules-close').click()}if(event.key==='Tab'){event.preventDefault();$('#rules-close').focus()}});
