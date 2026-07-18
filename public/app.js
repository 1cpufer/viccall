const CARS = [
  {make:"Toyota",model:"Supra",year:1994,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Toyota_Supra_mk4.jpg/1280px-Toyota_Supra_mk4.jpg",hint:"Iconic JDM sports car"},
  {make:"Mazda",model:"RX-7",year:1993,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Mazda_RX-7_FD3S%2C_front_right%2C_05-05-2024.jpg/1280px-Mazda_RX-7_FD3S%2C_front_right%2C_05-05-2024.jpg",hint:"Rotary engine legend"},
  {make:"Nissan",model:"GT-R",year:2009,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/2009_Nissan_GT-R_%28CBA-R35%29_rear.JPG/1280px-2009_Nissan_GT-R_%28CBA-R35%29_rear.JPG",hint:"Godzilla"},
  {make:"Honda",model:"NSX",year:1991,region:"japan",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Honda_E-NA1_NSX_%2822022010324%29.jpg/1280px-Honda_E-NA1_NSX_%2822022010324%29.jpg",hint:"Honda's supercar"},
  {make:"Mitsubishi",model:"Lancer Evolution",year:2003,region:"japan",niche:true,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/2005_Mitsubishi_Lancer_Evolution_IX_BS_O24.jpg/1280px-2005_Mitsubishi_Lancer_Evolution_IX_BS_O24.jpg",hint:"Rally homologation special"},
  {make:"BMW",model:"M3",year:2000,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/BMW_M3_coupe_E46.jpg/1280px-BMW_M3_coupe_E46.jpg",hint:"E46 era German icon"},
  {make:"Porsche",model:"911",year:1974,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/1988_Porsche_911_Carrera_coupe_%2821477045232%29.jpg/1280px-1988_Porsche_911_Carrera_coupe_%2821477045232%29.jpg",hint:"Air-cooled classic"},
  {make:"Volkswagen",model:"Golf GTI",year:1983,region:"germany",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/c/c5/Volkswagen_Golf_Mk1_GTI_MY_1983.jpg",hint:"Hot hatch pioneer"},
  {make:"Ford",model:"Mustang",year:1969,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Ford_Mustang_Fastback_1969_%2814473569652%29.jpg/1280px-Ford_Mustang_Fastback_1969_%2814473569652%29.jpg",hint:"Classic American muscle"},
  {make:"Chevrolet",model:"Corvette",year:1963,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/1963_Chevrolet_Corvette_Sting_Ray_Sport_Coupe%2C_rear_left%2C_06-24-2024.jpg/1280px-1963_Chevrolet_Corvette_Sting_Ray_Sport_Coupe%2C_rear_left%2C_06-24-2024.jpg",hint:"Split window Sting Ray"},
  {make:"Dodge",model:"Charger",year:1970,region:"usa",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/1970_Dodge_Charger_R-T_Hirschaid_22-20220709-RM-120204.jpg/1280px-1970_Dodge_Charger_R-T_Hirschaid_22-20220709-RM-120204.jpg",hint:"Muscle car era king"},
  {make:"Ferrari",model:"Testarossa",year:1986,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Ferrari_Testarossa_01.jpg/1280px-Ferrari_Testarossa_01.jpg",hint:"80s Italian exotic"},
  {make:"Lamborghini",model:"Countach",year:1978,region:"italy",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Lamborghini_Countach_LP_5000S_1983.jpg/1280px-Lamborghini_Countach_LP_5000S_1983.jpg",hint:"Poster car of a generation"},
  {make:"Peugeot",model:"205 GTI",year:1986,region:"france",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/1989_Peugeot_205_GTI_1.9_%2816556791566%29.jpg/1280px-1989_Peugeot_205_GTI_1.9_%2816556791566%29.jpg",hint:"French hot hatch"},
  {make:"Renault",model:"Alpine A110",year:1973,region:"france",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Renault_Alpine_A_110_%28Sp%29.JPG/1280px-Renault_Alpine_A_110_%28Sp%29.JPG",hint:"Rally legend from France"},
  {make:"Aston Martin",model:"DB5",year:1964,region:"uk",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/1964_Aston_Martin_DB5_Vantage_Rev.jpg/1280px-1964_Aston_Martin_DB5_Vantage_Rev.jpg",hint:"Bond's car"},
  {make:"Jaguar",model:"E-Type",year:1961,region:"uk",niche:false,img:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Jaguar_E-Type_Series_1_3.8_Litre_1961.jpg/1280px-Jaguar_E-Type_Series_1_3.8_Litre_1961.jpg",hint:"Enzo called it the most beautiful car ever made"},
];

let mode='worldwide',queue=[],cur=null,score=0,idx=0,answered=false,timerInt=null,tLeft=30;
const TOTAL=10;

const cv=document.getElementById('bg'),cx=cv.getContext('2d');
let lns=[];
function initBg(){cv.width=cv.offsetWidth||640;cv.height=cv.offsetHeight||580;lns=Array.from({length:16},()=>({x:Math.random()*cv.width,y:Math.random()*cv.height,len:40+Math.random()*100,spd:0.3+Math.random()*0.7,op:0.03+Math.random()*0.06}));}
function drawBg(){cx.clearRect(0,0,cv.width,cv.height);lns.forEach(l=>{cx.beginPath();cx.moveTo(l.x,l.y);cx.lineTo(l.x+l.len,l.y);cx.strokeStyle=`rgba(200,169,110,${l.op})`;cx.lineWidth=1;cx.stroke();l.x+=l.spd;if(l.x>cv.width+l.len)l.x=-l.len;});requestAnimationFrame(drawBg);}
initBg();drawBg();

function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000);}

function go(dest){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  if(dest==='home'){document.getElementById('s-home').classList.add('active');return;}
  if(dest==='regional'){document.getElementById('s-regional').classList.add('active');return;}
  mode=dest;
  const tag={worldwide:'Worldwide',japan:'Japan',germany:'Germany',usa:'USA',france:'France',italy:'Italy',uk:'UK',niche:'Niche',timeattack:'Time Attack'};
  document.getElementById('modeTag').textContent=tag[dest]||dest;
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
}

document.addEventListener('keydown',e=>{if(e.key==='Enter'){if(answered)next();else submit();}});
