let CARS = [];
const carsReady = fetch('/api/cars').then(r => r.json()).then(d => { CARS = d; });

let mode='worldwide',queue=[],cur=null,score=0,idx=0,answered=false,timerInt=null,tLeft=30;
const TOTAL=10;

const cv=document.getElementById('bg'),cx=cv.getContext('2d');
let lns=[];
function initBg(){cv.width=cv.offsetWidth||640;cv.height=cv.offsetHeight||580;lns=Array.from({length:16},()=>({x:Math.random()*cv.width,y:Math.random()*cv.height,len:40+Math.random()*100,spd:0.3+Math.random()*0.7,op:0.03+Math.random()*0.06}));}
function drawBg(){cx.clearRect(0,0,cv.width,cv.height);lns.forEach(l=>{cx.beginPath();cx.moveTo(l.x,l.y);cx.lineTo(l.x+l.len,l.y);cx.strokeStyle=`rgba(200,169,110,${l.op})`;cx.lineWidth=1;cx.stroke();l.x+=l.spd;if(l.x>cv.width+l.len)l.x=-l.len;});requestAnimationFrame(drawBg);}
initBg();drawBg();

function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000);}

const MODE_TAG={worldwide:'Worldwide',japan:'Japan',germany:'Germany',usa:'USA',france:'France',italy:'Italy',uk:'UK',niche:'Niche',timeattack:'Time Attack'};

async function go(dest){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  if(dest==='home'){document.getElementById('s-home').classList.add('active');return;}
  if(dest==='regional'){document.getElementById('s-regional').classList.add('active');return;}
  if(dest==='leaderboard'){document.getElementById('s-leaderboard').classList.add('active');initLeaderboard();return;}
  if(dest==='party'){document.getElementById('s-party').classList.add('active');return;}
  await carsReady;
  mode=dest;
  document.getElementById('modeTag').textContent=MODE_TAG[dest]||dest;
  document.getElementById('s-game').classList.add('active');
  restart();
}

function shuffle(a){return [...a].sort(()=>Math.random()-0.5);}
function getQueue(){
  let p=mode==='niche'?CARS.filter(c=>c.niche):mode==='worldwide'||mode==='timeattack'?[...CARS]:CARS.filter(c=>c.region===mode);
  while(p.length<TOTAL)p=[...p,...p];
  return shuffle(p).slice(0,TOTAL);
}

function restart(){
  score=0;idx=0;answered=false;queue=getQueue();
  document.getElementById('scoreDisplay').textContent='0';
  document.getElementById('fb').style.display='none';
  document.getElementById('hintTxt').style.display='none';
  document.getElementById('nextBtn').style.display='none';
  document.getElementById('finalWrap').style.display='none';
  document.getElementById('subBtn').style.display='';
  document.querySelector('.fields-row').style.display='';
  document.getElementById('carImg').style.display='';
  clearTimer();resetInputs();loadCar();
}

function resetInputs(){['iMake','iModel','iYear'].forEach(id=>{const e=document.getElementById(id);e.value='';e.disabled=false;});}
function clearTimer(){if(timerInt){clearInterval(timerInt);timerInt=null;}document.getElementById('timer').style.display='none';}

function startTimer(){
  tLeft=30;const el=document.getElementById('timer');
  el.style.display='';el.className='g-timer';el.textContent='0:30';clearTimer();
  timerInt=setInterval(()=>{tLeft--;el.textContent=`0:${tLeft.toString().padStart(2,'0')}`;if(tLeft<=10)el.className='g-timer urgent';if(tLeft<=0){clearTimer();if(!answered)autoSubmit();}},1000);
}

function loadCar(){
  cur=queue[idx];
  document.getElementById('progress').textContent=`Car ${idx+1} of ${TOTAL}`;
  const wrap=document.getElementById('carImg');
  wrap.innerHTML='<i class="ti ti-loader-2" style="font-size:36px;color:#222;" aria-hidden="true"></i>';
  const img=new Image();
  img.onload=()=>{wrap.innerHTML='';img.style.cssText='width:100%;height:100%;object-fit:cover;';wrap.appendChild(img);};
  img.onerror=()=>{wrap.innerHTML=`<div style="color:#333;font-size:13px;text-align:center;">${cur.make} ${cur.model}<br><span style="font-size:11px;color:#2a2a2a;">image unavailable in sandbox</span></div>`;};
  img.src=cur.img;
  if(mode==='timeattack')startTimer();
  document.getElementById('iMake').focus();
}

// STRICT matching — strip special chars, require exact match
function clean(s){return s.toLowerCase().replace(/[^a-z0-9]/g,'').trim();}

function scoreGuess(mg,mol,yr){
  const res=[];let pts=0;

  if(mg){
    const hit = clean(mg) === clean(cur.make);
    const p=hit?1:0;pts+=p;
    res.push({label:'Make',detail:hit?cur.make:`Not ${cur.make}`,pts:p});
  }
  if(mol){
    const hit = clean(mol) === clean(cur.model);
    const p=hit?2:0;pts+=p;
    res.push({label:'Model',detail:hit?cur.model:`Not ${cur.model}`,pts:p});
  }
  if(yr){
    const yg=parseInt(yr),ya=cur.year;let p=0,d='';
    if(!isNaN(yg)){
      const df=Math.abs(yg-ya);
      if(df===0){p=2;d=`Exact — ${ya}`;}
      else if(df<=5){p=1;d=`Within 5 yrs — ${ya}`;}
      else{p=0;d=`Off by ${df} — ${ya}`;}
    }
    pts+=p;res.push({label:'Year',detail:d,pts:p});
  }
  return{pts,res};
}

function showPopup(res,total){
  const pop=document.getElementById('popup');
  document.getElementById('prows').innerHTML=res.map(r=>`<div class="prow ${r.pts>0?'hit':''}"><span>${r.label}: ${r.detail}</span><span>${r.pts>0?'+'+r.pts:'0'}</span></div>`).join('');
  document.getElementById('ptotal').textContent=`+${total} pts`;
  pop.className='popup show';
  setTimeout(()=>{pop.className='popup fade';},2500);
  setTimeout(()=>{pop.className='popup';},3600);
}

function autoSubmit(){
  answered=true;
  ['iMake','iModel','iYear'].forEach(id=>document.getElementById(id).disabled=true);
  const fb=document.getElementById('fb');fb.style.display='block';fb.className='fb wrong';
  fb.textContent=`Time's up — ${cur.make} ${cur.model} (${cur.year})`;
  document.getElementById('hintTxt').textContent=cur.hint;document.getElementById('hintTxt').style.display='block';
  document.getElementById('nextBtn').style.display='block';idx++;
}

function submit(){
  if(answered)return;
  const mg=document.getElementById('iMake').value.trim();
  const mol=document.getElementById('iModel').value.trim();
  const yr=document.getElementById('iYear').value.trim();
  if(!mg&&!mol&&!yr)return;
  clearTimer();answered=true;
  ['iMake','iModel','iYear'].forEach(id=>document.getElementById(id).disabled=true);
  const{pts,res}=scoreGuess(mg,mol,yr);
  score+=pts;document.getElementById('scoreDisplay').textContent=score;
  showPopup(res,pts);
  const fb=document.getElementById('fb');fb.style.display='block';
  const ans=`${cur.make} ${cur.model} (${cur.year})`;
  if(pts>=4){fb.className='fb correct';fb.textContent=`Nailed it — ${ans}`;}
  else if(pts>0){fb.className='fb partial';fb.textContent=`Partial — ${ans}`;}
  else{fb.className='fb wrong';fb.textContent=`Nope — ${ans}`;}
  document.getElementById('hintTxt').textContent=cur.hint;document.getElementById('hintTxt').style.display='block';
  document.getElementById('nextBtn').style.display='block';idx++;
}

function next(){
  if(idx>=TOTAL){showFinal();return;}
  answered=false;
  document.getElementById('fb').style.display='none';
  document.getElementById('hintTxt').style.display='none';
  document.getElementById('nextBtn').style.display='none';
  resetInputs();loadCar();
}

function showFinal(){
  clearTimer();
  document.getElementById('carImg').style.display='none';
  document.querySelector('.fields-row').style.display='none';
  document.getElementById('subBtn').style.display='none';
  document.getElementById('fb').style.display='none';
  document.getElementById('hintTxt').style.display='none';
  document.getElementById('nextBtn').style.display='none';
  document.getElementById('finalWrap').style.display='block';
  const max=TOTAL*5;
  document.getElementById('fScore').textContent=score;
  document.getElementById('fSub').textContent=`out of ${max} possible points`;
  const pct=score/max;
  document.getElementById('fComment').textContent=pct>=0.8?"Car guy certified.":pct>=0.5?"Decent — keep driving.":"Back to the lot.";
  document.getElementById('scoreSubmit').style.display='flex';
  document.getElementById('scoreSaved').style.display='none';
  document.getElementById('iName').value=localStorage.getItem('vc_name')||'';
}

async function submitScore(){
  const nameInput=document.getElementById('iName');
  const name=nameInput.value.trim();
  if(!name){nameInput.focus();return;}
  localStorage.setItem('vc_name',name);
  const max=TOTAL*5;
  const btn=document.querySelector('#scoreSubmit button');
  btn.disabled=true;
  try{
    const res=await fetch('/api/scores',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,mode,score,maxScore:max})
    });
    if(!res.ok)throw new Error('save failed');
    const data=await res.json();
    document.getElementById('scoreSubmit').style.display='none';
    const saved=document.getElementById('scoreSaved');
    saved.textContent=`Saved — ranked #${data.rank} of ${data.total} in ${MODE_TAG[mode]||mode}`;
    saved.style.display='block';
  }catch(e){
    toast('Could not save score — try again');
    btn.disabled=false;
  }
}

let lbMode='worldwide';
function initLeaderboard(){
  const tabs=document.getElementById('lbTabs');
  tabs.innerHTML=Object.keys(MODE_TAG).map(m=>
    `<button class="lb-tab ${m===lbMode?'active':''}" data-mode="${m}">${MODE_TAG[m]}</button>`
  ).join('');
  tabs.querySelectorAll('.lb-tab').forEach(btn=>{
    btn.onclick=()=>{lbMode=btn.dataset.mode;initLeaderboard();};
  });
  loadLeaderboard();
}

async function loadLeaderboard(){
  const list=document.getElementById('lbList');
  list.innerHTML='<div class="lb-empty">Loading…</div>';
  try{
    const res=await fetch(`/api/leaderboard?mode=${encodeURIComponent(lbMode)}`);
    const rows=await res.json();
    if(!rows.length){list.innerHTML='<div class="lb-empty">No scores yet — be the first.</div>';return;}
    list.innerHTML=rows.map((r,i)=>`<div class="lb-row"><span class="lb-rank">${i+1}</span><span class="lb-name">${escapeHtml(r.name)}</span><span class="lb-score">${r.score}/${r.maxScore}</span></div>`).join('');
  }catch(e){
    list.innerHTML='<div class="lb-empty">Could not load leaderboard.</div>';
  }
}

function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  if(e.target.id==='iName'){submitScore();return;}
  if(['pcName','pcMode'].includes(e.target.id)){partyCreate();return;}
  if(['pjName','pjCode'].includes(e.target.id)){partyJoin();return;}
  if(['pMake','pModel','pYear'].includes(e.target.id)){partySubmit();return;}
  if(document.getElementById('s-game').classList.contains('active')){if(answered)next();else submit();}
});

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

const socket=io();
let partyCode=null,partyYouId=null,partyMode=null,partyIsHost=false,partyPlayers=[],partySubmitted=false;

function partyMeIsHost(){
  const me=partyPlayers.find(p=>p.id===partyYouId);
  return !!(me&&me.host);
}

function renderLobby(){
  document.getElementById('lobbyCode').textContent=partyCode;
  document.getElementById('lobbyModeTag').textContent=MODE_TAG[partyMode]||partyMode;
  document.getElementById('lobbyPlayers').innerHTML=partyPlayers.map(p=>
    `<div class="lb-row"><span class="lb-name">${escapeHtml(p.name)}${p.id===partyYouId?' (you)':''}</span>${p.host?'<span class="lb-host-badge">HOST</span>':''}</div>`
  ).join('');
  partyIsHost=partyMeIsHost();
  document.getElementById('lobbyStartBtn').style.display=partyIsHost?'block':'none';
  document.getElementById('lobbyWaitTxt').style.display=partyIsHost?'none':'block';
}

function renderStandings(){
  const sorted=[...partyPlayers].sort((a,b)=>b.score-a.score);
  document.getElementById('pStandings').innerHTML=sorted.map(p=>
    `<div class="lb-row ${p.answered?'answered':''}"><span class="lb-dot"></span><span class="lb-name">${escapeHtml(p.name)}${p.id===partyYouId?' (you)':''}</span>${p.host?'<span class="lb-host-badge">HOST</span>':''}<span class="lb-score">${p.score}</span></div>`
  ).join('');
}

async function partyCreate(){
  const name=document.getElementById('pcName').value.trim();
  if(!name){toast('Enter a name first');return;}
  const mode=document.getElementById('pcMode').value;
  socket.emit('party:create',{name,mode},res=>{
    if(!res.ok){toast(res.error||'Could not create party');return;}
    partyCode=res.code;partyYouId=res.youId;partyMode=res.mode;partyPlayers=res.players;
    renderLobby();
    showScreen('s-party-lobby');
  });
}

async function partyJoin(){
  const name=document.getElementById('pjName').value.trim();
  const code=document.getElementById('pjCode').value.trim().toUpperCase();
  if(!name||!code){toast('Enter a name and code');return;}
  socket.emit('party:join',{name,code},res=>{
    if(!res.ok){toast(res.error||'Could not join party');return;}
    partyCode=res.code;partyYouId=res.youId;partyMode=res.mode;partyPlayers=res.players;
    renderLobby();
    showScreen('s-party-lobby');
  });
}

function partyStart(){
  socket.emit('party:start',{},res=>{
    if(!res.ok)toast(res.error||'Could not start');
  });
}

function partySubmit(){
  if(partySubmitted)return;
  const make=document.getElementById('pMake').value.trim();
  const model=document.getElementById('pModel').value.trim();
  const year=document.getElementById('pYear').value.trim();
  if(!make&&!model&&!year)return;
  socket.emit('party:guess',{make,model,year},res=>{
    if(!res.ok){toast(res.error||'Could not submit');return;}
    partySubmitted=true;
    ['pMake','pModel','pYear'].forEach(id=>document.getElementById(id).disabled=true);
    document.getElementById('pSubBtn').style.display='none';
    document.getElementById('pWaitHostTxt').style.display='block';
    showPopup(res.res,res.pts);
  });
}

function partyNext(){
  socket.emit('party:next',{},res=>{
    if(!res.ok)toast(res.error||'Could not continue');
  });
}

function partyLeave(){
  socket.emit('party:leave');
  partyCode=null;partyYouId=null;partyMode=null;partyIsHost=false;partyPlayers=[];partySubmitted=false;
  go('home');
}

socket.on('party:players',data=>{
  partyPlayers=data.players;
  if(document.getElementById('s-party-lobby').classList.contains('active'))renderLobby();
});

socket.on('party:round',data=>{
  if(data.players)partyPlayers=data.players;
  partySubmitted=false;
  showScreen('s-party-game');
  document.getElementById('pModeTag').textContent=MODE_TAG[partyMode]||partyMode;
  document.getElementById('pProgress').textContent=`Car ${data.idx+1} of ${data.total}`;
  document.getElementById('pAnsweredTxt').textContent='';
  ['pMake','pModel','pYear'].forEach(id=>{const e=document.getElementById(id);e.value='';e.disabled=false;});
  document.getElementById('pFieldsRow').style.display='';
  document.getElementById('pSubBtn').style.display='';
  document.getElementById('pFb').style.display='none';
  document.getElementById('pHintTxt').style.display='none';
  document.getElementById('pNextBtn').style.display='none';
  document.getElementById('pWaitHostTxt').style.display='none';
  const wrap=document.getElementById('pCarImg');
  wrap.innerHTML='<i class="ti ti-loader-2" style="font-size:36px;color:#222;" aria-hidden="true"></i>';
  const img=new Image();
  img.onload=()=>{wrap.innerHTML='';img.style.cssText='width:100%;height:100%;object-fit:cover;';wrap.appendChild(img);};
  img.onerror=()=>{wrap.innerHTML='<div style="color:#333;font-size:13px;">Image unavailable</div>';};
  img.src=data.img;
  renderStandings();
  document.getElementById('pMake').focus();
});

socket.on('party:progress',data=>{
  document.getElementById('pAnsweredTxt').textContent=`${data.answeredCount} of ${data.total} answered`;
});

socket.on('party:reveal',data=>{
  partyPlayers=data.standings;
  ['pMake','pModel','pYear'].forEach(id=>document.getElementById(id).disabled=true);
  document.getElementById('pFieldsRow').style.display='none';
  document.getElementById('pSubBtn').style.display='none';
  const fb=document.getElementById('pFb');
  fb.style.display='block';fb.className='fb correct';
  fb.textContent=`Answer — ${data.make} ${data.model} (${data.year})`;
  document.getElementById('pHintTxt').textContent=data.hint;
  document.getElementById('pHintTxt').style.display='block';
  const isHost=partyMeIsHost();
  document.getElementById('pNextBtn').style.display=isHost?'block':'none';
  document.getElementById('pWaitHostTxt').style.display=isHost?'none':'block';
  renderStandings();
});

socket.on('party:final',data=>{
  partyPlayers=data.standings;
  showScreen('s-party-final');
  document.getElementById('pFinalStandings').innerHTML=data.standings.map((p,i)=>
    `<div class="lb-row"><span class="lb-rank">${i+1}</span><span class="lb-name">${escapeHtml(p.name)}${p.id===partyYouId?' (you)':''}</span><span class="lb-score">${p.score}</span></div>`
  ).join('');
  document.getElementById('pPlayAgainBtn').style.display=partyMeIsHost()?'block':'none';
});
