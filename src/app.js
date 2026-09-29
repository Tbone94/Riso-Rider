// app.js — Riso Rider app shell: shared state S, layers + printing, the
// edit → ride → (win | back to edit) state machine, input, settings, assist and UI.
// Contract: ARCHITECTURE.md. Look and wording: UI.md ("the print shop").
import * as P from './physics.js';
import {LEVELS,CHAPTERS} from './levels.js';

const {W,H,DT}=P;
const TAU=Math.PI*2;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const hex=c=>(window.Riso&&Riso.INKS[c])||c;
const pad2=n=>String(n).padStart(2,'0');
const raf2=f=>requestAnimationFrame(()=>requestAnimationFrame(f));   // "a 2-frame hold"

// ---------- storage (always wrapped: private windows / blocked storage) ----------
const KEY={progress:'drift.progress.v2',settings:'drift.settings.v1',drafts:'drift.drafts.v1',last:'drift.last.v1',coached:'drift.coached.v1'};
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};

// ---------- errors from the parallel-built modules: log once, keep running ----------
const errSeen=new Set();
function report(where,e){const k=where+':'+(e&&e.message);if(errSeen.has(k))return;errSeen.add(k);console.error(`[app] ${where} threw:`,e);}
async function loadMod(path){try{return await import(path);}catch(e){report('import '+path,e);return null;}}
const fontsReady=Promise.race([Promise.all([document.fonts.load('800 16px "Big Shoulders Stencil Display"'),document.fonts.load('16px "Cutive Mono"')]).catch(()=>{}),new Promise(r=>setTimeout(r,1500))]);
const [sideMod,rideMod,audioMod]=await Promise.all([loadMod('./side.js'),loadMod('./ride.js'),loadMod('./audio.js'),fontsReady]);

// ---------- DOM ----------
const stage=$('#stage'),bgs=$('#bgs'),bgr=$('#bgr'),fg=$('#fg'),g=fg.getContext('2d');
const reduceMQ=matchMedia('(prefers-reduced-motion: reduce)');
const allJobs=/[?&]jobs=all\b/.test(location.search);

// ---------- state S (shape fixed by ARCHITECTURE.md) ----------
function sanitize(o){o=o&&typeof o==='object'?o:{};return{
  fov:clamp(Math.round(+o.fov||90),70,110),bob:!!o.bob,chase:typeof o.chase==='boolean'?o.chase:true,
  reducedMotion:typeof o.reducedMotion==='boolean'?o.reducedMotion:reduceMQ.matches,
  assist:[0,1,2].includes(o.assist)?o.assist:0,
  sound:typeof o.sound==='boolean'?o.sound:true,volume:Number.isFinite(+o.volume)&&o.volume!==null&&o.volume!==''?clamp(+o.volume,0,1):.7};}
const S={li:0,level:null,items:[],tool:'line',mode:'edit',stroke:null,ink:null,pat:null,ghost:null,falls:0,
  settings:sanitize(store.get(KEY.settings,null))};
const progress=store.get(KEY.progress,{})||{};
const drafts=store.get(KEY.drafts,{})||{};
const coached=store.get(KEY.coached,{})||{};   // one-time tips already shown, by name
function coachOnce(name){if(coached[name])return false;coached[name]=1;store.set(KEY.coached,coached);return true;}

// ---------- renderers ----------
// hooks.draw is offered in case side.js reports drawing phases itself; otherwise app.js infers them (see "drawing sounds").
let sideDraws=false;
// hooks.moved(prevItems): side.js dragged a sling, well or rope end; keep the pre-drag items so Z can undo the move.
const hooks={onChange,toast,flashInk,draw(tool,phase,speed){sideDraws=true;A('draw',tool,phase,speed);},moved(prev){hist.push({prev});}};
let side=null,ride=null,audio=null;
try{audio=audioMod&&audioMod.createAudio();}catch(e){report('createAudio',e);}
// Every audio call goes through here: missing methods or a throwing stub never break the game.
function A(name,...args){if(!audio||typeof audio[name]!=='function')return;try{audio[name](...args);}catch(e){report('audio.'+name,e);}}
try{side=sideMod&&sideMod.createSide({canvas:fg,getState:()=>S,hooks});}catch(e){report('createSide',e);}
try{ride=rideMod&&rideMod.createRide();}catch(e){report('createRide',e);}

// ---------- small helpers: patterns, grain, overprints, seeded tilt ----------
function dotPattern(color,step,rad){const c=canvas(step*2,step*2),x=c.getContext('2d');x.fillStyle=color;
  [[step/2,step/2],[step*1.5,step*1.5]].forEach(([a,b])=>{x.beginPath();x.arc(a,b,rad,0,TAU);x.fill();});return g.createPattern(c,'repeat');}
function speckle(pw,ph){const c=canvas(pw,ph),x=c.getContext('2d'),id=x.createImageData(pw,ph),d=id.data;
  for(let i=3;i<d.length;i+=4)d[i]=Math.random()<.18?60+Math.random()*150:0;x.putImageData(id,0,0);return c;}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function multiply(a,b){const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return'#'+A.map((v,i)=>Math.round(v*B[i]/255).toString(16).padStart(2,'0')).join('');}
function hash(s){let h=2166136261;for(const ch of s){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function tilt(el,name){const h=hash(name),deg=(h&1?1:-1)*(.4+(h>>>1)%1000/1000*.8);el.style.setProperty('--tilt',deg.toFixed(2)+'deg');}

// ---------- phone game mode (landscape, full screen) / portrait prompt ----------
// CSS does the layout under html.gm; this decides when it applies. ?layout=game|desk forces it (for testing
// at phone sizes on a desktop browser, which reports a fine pointer).
const GMQ=matchMedia('(pointer:coarse) and (orientation:landscape) and (max-height:560px)');
const TURNQ=matchMedia('(pointer:coarse) and (orientation:portrait) and (max-width:560px)');
const forceLayout=(location.search.match(/[?&]layout=(game|desk)\b/)||[])[1]||null;
let gameMode=false;
function layout(){const root=document.documentElement,land=innerWidth>=innerHeight;
  const gm=forceLayout?forceLayout==='game'&&land:GMQ.matches,turn=forceLayout?forceLayout==='game'&&!land:TURNQ.matches;
  root.style.setProperty('--vh100',innerHeight+'px');
  if(gm!==gameMode||root.classList.contains('turn')!==turn){gameMode=gm;root.classList.toggle('gm',gm);root.classList.toggle('turn',turn);if(!gm)toggleLevels(false);}
  requestAnimationFrame(nudge);}
function toggleLevels(open){const root=document.documentElement;open=open==null?!root.classList.contains('levels'):open;
  root.classList.toggle('levels',!!open&&gameMode);$('#levelsbtn').setAttribute('aria-expanded',!!open&&gameMode);
  if(open&&gameMode)renderJobs();}
// Controls docked over the stage corners must not hide the start ledge or the goal: fade any that overlap.
function nudge(){const els=$$('#tray,.acts,#barrow,#gear,#gmbar');els.forEach(e=>{e.classList.remove('overplay');e.style.removeProperty('--lift');});
  if(!gameMode||!S.level||S.mode!=='edit')return;
  const r=stage.getBoundingClientRect(),k=r.width/W,L=S.level,zones=[];
  const Z=(x0,y0,x1,y1)=>zones.push([r.left+x0*k,r.top+y0*k,r.left+x1*k,r.top+y1*k]);
  Z(L.start.x-34,L.start.y-40,L.start.x+40,L.start.y+26);
  const G=L.goal;Z(G.x-G.r-16,G.y-G.r-16,G.x+G.r+16,G.y+G.r+16);
  for(const p of L.blocks){const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys);   // the start ledge
    if(L.start.x>=x0-10&&L.start.x<=x1+10&&y0-L.start.y>-4&&y0-L.start.y<30)Z(x0,y0-24,x1,y0+22);}
  const hit=(b,dy=0)=>zones.some(z=>b.left<z[2]&&b.right>z[0]&&b.top-dy<z[3]&&b.bottom-dy>z[1]);
  for(const e of els){e.style.removeProperty('--lift');const b=e.getBoundingClientRect();if(!b.width||!hit(b))continue;
    // bottom groups first try sliding up just clear of the start ledge / goal; the top bars just fade
    if(e.matches('#tray,.acts')){let dy=0;const room=b.top-52;while(dy<=room&&hit(b,dy))dy+=6;
      if(dy<=room){e.style.setProperty('--lift',dy+'px');continue;}}
    e.classList.add('overplay');}}
function showHint(){if(S.level&&S.level.hint)slip([esc(S.level.hint)],{hold:3800});}

// ---------- sizing ----------
let px=1,cssW=W,speck=null;
function resize(){const r=stage.getBoundingClientRect();if(r.width<2)return;
  const dpr=Math.min(devicePixelRatio||1,2),pw=Math.round(r.width*dpr),ph=Math.round(pw*H/W);cssW=r.width;
  if(fg.width!==pw||fg.height!==ph){fg.width=pw;fg.height=ph;speck=speckle(pw,ph);}
  px=pw/W;clearTimeout(resize.t);resize.t=setTimeout(refreshBg,200);}

// ---------- printing (async, cached per kind + level + size bucket) ----------
const prints=new Map(),pending=new Map();
const printW=()=>clamp(Math.round(fg.width/200)*200,400,1600);
// Side backdrops print with riso.js's per-scene side profile (quiet middle band, grain with deliberate dot
// accents); a level can override it with bg.side. The cache lives in memory, so every reload reprints.
const pkey=(kind,L,pw)=>`${kind}:${L.id}:${pw}`;
function printSide(L,pw){const ph=Math.round(pw*H/W),img=Riso.printSideBackdrop(L.bg,pw,ph);
  const c=canvas(pw,ph);c.getContext('2d').putImageData(img,0,0);return c;}
function printRide(L,pw){const ph=Math.round(pw*H/W);let c=null;
  try{c=ride&&ride.printBackdrop(L,pw,ph);}catch(e){report('ride.printBackdrop',e);}
  if(!c){c=canvas(pw,ph);const x=c.getContext('2d');x.fillStyle=Riso.PAPERS.Natural;x.fillRect(0,0,pw,ph);}return c;}
function getPrint(kind,L,pw){const k=pkey(kind,L,pw);
  if(prints.has(k))return Promise.resolve(prints.get(k));if(pending.has(k))return pending.get(k);
  // rAF + timeout: let "PRINTING…" paint before the (blocking) print starts.
  // (with a timer fallback, since hidden tabs get no frames)
  const p=new Promise(res=>{let started=false;const go=()=>{if(started)return;started=true;let c;
    try{c=kind==='side'?printSide(L,pw):printRide(L,pw);}catch(e){report('print '+kind,e);c=canvas(pw,Math.round(pw*H/W));}
    prints.set(k,c);pending.delete(k);res(c);};
    requestAnimationFrame(()=>setTimeout(go,16));setTimeout(go,150);});
  pending.set(k,p);return p;}
function paint(cv,src,k){cv.width=src.width;cv.height=src.height;cv.getContext('2d').drawImage(src,0,0);cv.dataset.k=k;}
let printingN=0;
function printing(on,full){const el=$('#printing');printingN=Math.max(0,printingN+(on?1:-1));el.hidden=printingN===0;
  if(on){el.classList.toggle('small',!full);$('#printjob').textContent=`LOADING LEVEL ${pad2(S.li+1)}…`;}}
// Paint whichever backdrop the current mode shows; print it first if needed.
function refreshBg(){const L=S.level;if(!L||!fg.width)return Promise.resolve();
  const kind=S.mode==='edit'?'side':'ride',cv=kind==='side'?bgs:bgr,pw=printW(),k=pkey(kind,L,pw);
  if(cv.dataset.k===k)return Promise.resolve();
  if(prints.has(k)){paint(cv,prints.get(k),k);return Promise.resolve();}
  const full=!(cv.dataset.k||'').startsWith(kind+':'+L.id+':');   // (key prefix is kind:id:)   // nothing of this job shown yet → cover the stage
  printing(true,full);
  return getPrint(kind,L,pw).then(c=>{printing(false);if(S.level===L&&cv.dataset.k!==k)paint(cv,c,k);if(kind==='side')idleWork();});}
// While the player is idle: pre-print the ride backdrop (so Ride never waits), then job-board thumbnails.
let lastActivity=0;
function idleWork(delay=400){clearTimeout(idleWork.t);idleWork.t=setTimeout(()=>{
  if(S.mode!=='edit'||S.stroke||performance.now()-lastActivity<700||pending.size)return idleWork();
  const L=S.level,pw=printW();
  if(!prints.has(pkey('ride',L,pw)))return getPrint('ride',L,pw).then(()=>idleWork());
  const j=LEVELS.findIndex(l=>!thumbs.has(l.id));if(j<0)return;
  try{thumbs.set(LEVELS[j].id,printThumb(LEVELS[j]));}catch(e){report('thumbnail',e);thumbs.set(LEVELS[j].id,null);}
  renderJobs();idleWork(120);},delay);}   // thumbnails are cheap: once idle, print them back to back

// ---------- job board: mini printed sheets clipped to a line ----------
const thumbs=new Map();
function printThumb(L){const w=148,h=92,s=w/W;
  const img=Riso.printSideBackdrop(L.bg,w,h,{cell:2.4,mis:.8});
  const c=canvas(w,h),x=c.getContext('2d');x.putImageData(img,0,0);x.globalCompositeOperation='multiply';x.setTransform(s,0,0,s,0,0);
  const poly=(p,dx,dy)=>{x.beginPath();p.forEach((q,i)=>x[i?'lineTo':'moveTo'](q[0]+dx,q[1]+dy));x.closePath();};
  L.blocks.forEach(p=>{x.fillStyle=hex(L.bg.inks[1]);poly(p,6,5);x.fill();x.fillStyle=hex(L.bg.inks[2]);poly(p,0,0);x.fill();});
  const K=hex(L.bg.inks[2]),M=hex(L.bg.inks[1]),Lt=hex(L.bg.inks[0]);
  (L.ice||[]).forEach(p=>{x.fillStyle=Lt;poly(p,0,0);x.fill();x.save();poly(p,0,0);x.clip();x.strokeStyle=K;x.lineWidth=5;   // ice: slick diagonal hatching
    x.beginPath();for(let k=-H;k<W;k+=22){x.moveTo(k,H);x.lineTo(k+H,0);}x.stroke();x.restore();x.strokeStyle=K;x.lineWidth=6;poly(p,0,0);x.stroke();});
  (L.crumble||[]).forEach(p=>{x.fillStyle=M;poly(p,0,0);x.fill();x.strokeStyle=K;x.lineWidth=7;x.setLineDash([16,10]);poly(p,0,0);x.stroke();x.setLineDash([]);  // crumble: dashed + cracks
    const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    x.lineWidth=4;x.beginPath();for(let cx=x0+24;cx<x1-10;cx+=46){x.moveTo(cx,y0);x.lineTo(cx+8,(y0+y1)/2);x.lineTo(cx-4,y1);}x.stroke();});
  (L.boosts||[]).forEach(b=>{const a=b.a,c=b.b,len=Math.hypot(c[0]-a[0],c[1]-a[1])||1,tx=(c[0]-a[0])/len,ty=(c[1]-a[1])/len;   // boost: chevrons
    x.strokeStyle=M;x.lineWidth=7;x.beginPath();for(let d=10;d<len;d+=26){const px_=a[0]+tx*d,py_=a[1]+ty*d-12;
      x.moveTo(px_-tx*9-ty*9,py_-ty*9+tx*9);x.lineTo(px_,py_);x.lineTo(px_-tx*9+ty*9,py_-ty*9-tx*9);}x.stroke();});
  (L.drops||[]).forEach(d=>{const r=d.v>=40?13:d.v>=25?11:9;x.fillStyle=M;x.beginPath();x.moveTo(d.x,d.y-r*1.7);   // drops: little ink drops
    x.quadraticCurveTo(d.x+r*1.1,d.y-r*.2,d.x,d.y+r);x.quadraticCurveTo(d.x-r*1.1,d.y-r*.2,d.x,d.y-r*1.7);x.fill();x.strokeStyle=K;x.lineWidth=3;x.stroke();});
  (L.slings||[]).forEach(sl=>{const a=+sl.a||0,ex=sl.x+Math.cos(a)*62,ey=sl.y+Math.sin(a)*62;   // slings: a ring and the arrow it flings along
    x.strokeStyle=K;x.lineWidth=8;x.beginPath();x.arc(sl.x,sl.y,26,0,TAU);x.stroke();
    x.strokeStyle=M;x.lineWidth=8;x.beginPath();x.moveTo(sl.x,sl.y);x.lineTo(ex,ey);
    x.moveTo(ex-Math.cos(a-.5)*20,ey-Math.sin(a-.5)*20);x.lineTo(ex,ey);x.lineTo(ex-Math.cos(a+.5)*20,ey-Math.sin(a+.5)*20);x.stroke();});
  x.strokeStyle=hex(L.bg.inks[1]);x.lineWidth=10;(L.hazards||[]).forEach(p=>{x.beginPath();p.forEach((q,i)=>x[i?'lineTo':'moveTo'](q[0],q[1]));x.stroke();});
  x.strokeStyle=hex(L.bg.inks[2]);x.lineWidth=9;x.beginPath();x.arc(L.goal.x,L.goal.y,L.goal.r,0,TAU);x.stroke();
  x.fillStyle=hex(L.bg.inks[1]);x.beginPath();x.arc(L.start.x,L.start.y,14,0,TAU);x.fill();
  return c;}
// Clearing a level opens the next two, so one hard level never blocks the way on.
const unlocked=i=>allJobs||i===0||i===S.li||!!progress[LEVELS[i].id]||!!progress[LEVELS[i-1].id]||(i>1&&!!progress[LEVELS[i-2].id]);
const lockedMsg=i=>`Level ${pad2(i+1)} is locked. Clear level ${pad2(i)}${i>1?` or ${pad2(i-1)}`:''} first.`;
const starSvg=n=>Array.from({length:n},()=>'<svg viewBox="0 0 24 24"><use href="#star"/></svg>').join('');
function renderJobs(){const box=$('#jobs');box.innerHTML='';LEVELS.forEach((L,i)=>{
  const ch=CHAPTERS.find(c=>c.from===i);   // a chapter tab before each chapter's first level
  if(ch){const t=document.createElement('div');t.className='chap';t.innerHTML=`<span>CH ${ch.n}</span><span class="cname">${esc(ch.name)}</span>`;box.append(t);}
  const b=document.createElement('button'),st=progress[L.id]||0,open=unlocked(i),t=thumbs.get(L.id);
  b.className='job paper'+(i===S.li?' on':'')+(open?'':' locked');tilt(b,'job:'+L.id);
  b.title=open?`Level ${pad2(i+1)} · ${L.name}`:lockedMsg(i);
  b.setAttribute('aria-label',open?`Level ${i+1}, ${L.name}, ${st} of 3 stars`:`Level ${i+1}, locked`);
  if(!open)b.setAttribute('aria-disabled','true');
  b.innerHTML=`<svg class="clip"><use href="#clip"/></svg>${open&&t?'':`<span class="blank">${pad2(i+1)}</span>`}
    <span class="jn"><span>${pad2(i+1)}</span><span class="st">${starSvg(st)}</span></span><span class="inks">${open?esc(L.name):'locked'}</span>`;
  if(open&&t){const c=canvas(t.width,t.height);c.getContext('2d').drawImage(t,0,0);b.querySelector('.clip').after(c);}
  b.dataset.snd=open?'press':'locked';
  b.onclick=()=>{if(!open){toast(lockedMsg(i));return;}if(i!==S.li)load(i);};
  box.append(b);});
  const on=box.querySelector('.job.on'),bd=$('#board');
  if(on&&(on.offsetLeft<bd.scrollLeft||on.offsetLeft+on.offsetWidth>bd.scrollLeft+bd.clientWidth))bd.scrollLeft=on.offsetLeft-bd.clientWidth/2+on.offsetWidth/2;}

// ---------- level load ----------
function load(i){i=clamp(i|0,0,LEVELS.length-1);cancelRide();hideWin();hideOffer();hideSlip();
  const L=LEVELS[i];S.li=i;S.level=L;S.mode='edit';S.stroke=null;S.ghost=null;S.falls=0;lastCleared=null;lastRide=null;swoopedLevel=null;
  S.items=cloneItems(drafts[L.id]||[]).filter(it=>L.tools.includes(it.type));hist=[];lastLen=S.items.length;   // e.g. wells from before the sling
  S.ink={light:hex(L.bg.inks[0]),mid:hex(L.bg.inks[1]),key:hex(L.bg.inks[2])};
  S.pat={light:dotPattern(S.ink.light,7,1.9),lightDense:dotPattern(S.ink.light,6,2.4),mid:dotPattern(S.ink.mid,6,1.7),key:dotPattern(S.ink.key,5,1.6)};
  const rs=document.documentElement.style,I=S.ink;
  [['--light',I.light],['--mid',I.mid],['--key',I.key],['--lm',multiply(I.light,I.mid)],['--mk',multiply(I.mid,I.key)],['--lk',multiply(I.light,I.key)]].forEach(([k,v])=>rs.setProperty(k,v));
  $('#num').textContent=pad2(i+1);$('#lname').textContent=L.name;$('#hint').textContent=L.hint||'';
  $('#gmnum').textContent=pad2(i+1);$('#gmlname').textContent=L.name;toggleLevels(false);
  $$('[data-tool]').forEach(b=>b.hidden=!L.tools.includes(b.dataset.tool));
  if(!L.tools.includes(S.tool))S.tool=L.tools[0];
  const n3=$('#n3'),n2=$('#n2');n3.style.left=((1-L.par[0]/L.ink)*100)+'%';n2.style.left=((1-L.par[1]/L.ink)*100)+'%';
  n3.title=`3 stars: use ${L.par[0]} ink or less`;n2.title=`2 stars: use ${L.par[1]} ink or less`;
  store.set(KEY.last,L.id);renderJobs();applyMode();
  // First run (no stars anywhere yet, level 1, nothing drawn): two short notes: how to draw, then how to ride.
  coach=i===0&&!Object.keys(progress).length&&!S.items.length?1:0;
  refreshBg().then(()=>{if(S.level!==L||S.mode!=='edit')return;
    if(coach===1&&!S.items.length)slip([isTouch()?'Drag your finger across the picture to draw a line from the ledge to the ring.':'Drag across the picture to draw a line from the ledge to the ring.'],{hold:4200});
    else if(gameMode)showHint();});   // game mode has no hint line, so the hint arrives as a slip (tap the level name for it again)
  requestAnimationFrame(nudge);}
let coach=0;
function cloneItems(a){try{return JSON.parse(JSON.stringify(a)).filter(it=>it&&typeof it.type==='string');}catch(e){return[];}}
function saveDraft(){if(!S.level)return;const id=S.level.id,items=S.items;clearTimeout(saveDraft.t);saveDraft.t=setTimeout(()=>{drafts[id]=items;store.set(KEY.drafts,drafts);},250);}

// ---------- UI ----------
// Colour bar: patches of the 3 inks and their overprints; they empty right → left as ink is used.
(function buildBar(){const cyc=['var(--key)','var(--mk)','var(--mid)','var(--lm)','var(--light)','var(--lk)'],n=30;
  $$('#meter .patches').forEach(el=>{el.innerHTML=Array.from({length:n},(_,i)=>`<i style="background:${cyc[i%cyc.length]}"></i>`).join('');});})();
function safeCost(it){try{return P.itemCost(it);}catch(e){return 0;}}
let lastMeter='';
// Stars from ink used minus ink refunded by drops. Only a new physics.js produces refunds, so a refund > 0
// implies the 3-argument stars(); otherwise fall back to scoring the net ink with the 2-argument call.
function starsFor(L,used,refund=0){if(!refund)return P.stars(L,used);try{return P.stars(L,used,refund);}catch(e){return P.stars(L,Math.max(0,used-refund));}}
const starTxt=n=>'★'.repeat(n)+'☆'.repeat(3-n);
let lastRide=null;   // {refund,got,total} from the last ride on this level, shown as a marker on the ink bar
function meter(){const L=S.level;if(!L)return;const used=P.inkUsed(S.items)+(S.stroke?safeCost(S.stroke):0);
  const lr=lastRide&&lastRide.refund>0?lastRide:null;
  const sig=Math.round(used*10)+'|'+L.id+'|'+(lr?lr.refund:0);if(sig===lastMeter)return;lastMeter=sig;
  const left=clamp(1-used/L.ink,0,1),st=P.stars(L,used);
  $('#meter .empty').style.clipPath=`inset(0 0 0 ${(left*100).toFixed(2)}%)`;
  const mk=$('#lastride');mk.hidden=!lr;
  if(lr){const w=Math.min(lr.refund/L.ink,1-left);mk.style.left=(left*100).toFixed(2)+'%';mk.style.width=(w*100).toFixed(2)+'%';
    mk.title=`Last ride collected ${lr.refund} ink in drops (${lr.got}/${lr.total})`;}
  $('#inkleft').innerHTML=`${Math.max(0,Math.round(L.ink-used))} left · ${starTxt(st)}`+(lr?` <span class="last">· last ride +${lr.refund} → ${starTxt(starsFor(L,used,lr.refund))}</span>`:'');
  const m=$('#meter');m.setAttribute('aria-valuemax',L.ink);m.setAttribute('aria-valuenow',Math.max(0,Math.round(L.ink-used)));m.setAttribute('aria-valuetext',`${Math.round(L.ink-used)} ink left, ${st} stars`);}
function slug(){if(!S.level)return;$('#slug').textContent=`LEVEL ${pad2(S.li+1)} · ${S.level.name.toUpperCase()}${S.falls?` · ${S.falls} ${S.falls===1?'FALL':'FALLS'}`:''}`;}
function ui(){lastMeter='';meter();slug();$$('[data-tool]').forEach(b=>{const on=b.dataset.tool===S.tool;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
  $('#undo').disabled=!S.items.length&&!lastCleared;$('#clear').disabled=!S.items.length;}
function applyMode(){const m=S.mode;stage.classList.toggle('editing',m==='edit');stage.classList.toggle('riding',m==='ride');stage.classList.toggle('winning',m==='win');
  $('#editbar').hidden=m!=='edit';$('#ridebar').hidden=m!=='ride';$('#winbar').hidden=m!=='win';$('#hud').hidden=m!=='ride';
  if(m!=='ride'){bgr.style.transform='';bgT='';}document.documentElement.dataset.mode=m;ui();requestAnimationFrame(nudge);}
function onChange(){lastActivity=performance.now();lastCleared=null;
  if(S.items.length>lastLen)hist.push('add');lastLen=S.items.length;ui();saveDraft();
  if(S.level.tools.includes('sling')&&S.items.some(i=>i.type==='sling')&&coachOnce('sling-aim'))slip(['Drag its arrow to aim.'],{hold:3200});
  else if(coach===1&&S.items.length&&!S.stroke){coach=2;slip([isTouch()?'Nice line. Tap RIDE to ride it.':'Nice line. Press RIDE or Enter to ride it.'],{hold:3000});}}
function flashInk(){const now=performance.now();if(now-(flashInk.t||0)>350){flashInk.t=now;A('inkEmpty');}const m=$('#meter');m.classList.remove('flash');void m.offsetWidth;m.classList.add('flash');}

// ---------- proof slips (toasts): slide out of the top edge, typed, with a proofreader's mark ----------
const MARKS={
  fall:'<path d="M15 3v17M8 13l7 8 7-8"/>',                                                  // arrow down
  pop:'<path d="M15 3v5M15 18v5M5 13h5M20 13h5M8 6l3.5 3.5M22 6l-3.5 3.5M8 20l3.5-3.5M22 20l-3.5-3.5"/>',  // burst
  stuck:'<path d="M10 6v14M20 6v14" stroke-width="3"/>',                                          // pause bars
  note:'<circle cx="15" cy="13" r="2.2" fill="currentColor" stroke="none"/>'};
const slipEl=$('#slip');let slipTimer=0,slipAnim=null;
(function tornEdge(){const pts=['0 0','100% 0'],n=26;for(let i=n;i>=0;i--){const d=(hash('torn'+i)%50)/10;pts.push(`${(i/n*100).toFixed(2)}% calc(100% - ${d.toFixed(1)}px)`);}slipEl.style.clipPath=`polygon(${pts.join(',')})`;})();
function slip(lines,{mark='note',hold=1400}={}){
  slipEl.querySelector('.mark').innerHTML=MARKS[mark]||MARKS.note;
  slipEl.querySelector('.txt').innerHTML=lines.map(l=>`<p>${l}</p>`).join('');tilt(slipEl,'slip:'+lines[0]);
  clearTimeout(slipTimer);if(slipAnim)slipAnim.cancel();slipEl.style.visibility='visible';A('ui','slip');
  const rm=S.settings.reducedMotion,out=rm?[{opacity:0,translate:'0 0'},{opacity:1,translate:'0 0'}]:[{translate:'0 -115%'},{translate:'0 0'}];
  slipAnim=slipEl.animate(out,{duration:rm?120:190,easing:'ease-out',fill:'forwards'});
  slipTimer=setTimeout(()=>{slipAnim=slipEl.animate(out.slice().reverse(),{duration:rm?120:170,easing:'ease-in',fill:'forwards'});
    slipAnim.finished.then(()=>{slipEl.style.visibility='hidden';}).catch(()=>{});},(rm?120:190)+hold);}
function hideSlip(){clearTimeout(slipTimer);if(slipAnim)slipAnim.cancel();slipAnim=null;slipEl.style.visibility='hidden';}
function toast(msg){slip([esc(msg)]);}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isTouch=()=>gameMode||document.body.classList.contains('touch');

// ---------- transitions ----------
const wipeEl=$('#wipe'),flashEl=$('#flash');
// Ride: an ink band rolls across like a drum pass (≤400 ms); the mode switches while it covers the stage.
// Phases run on timers (the animations are only the look), so a hidden tab can't stall the state machine.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function wipe(onCovered){const rm=S.settings.reducedMotion,[a,b]=rm?[90,120]:[170,190];wipeEl.getAnimations().forEach(x=>x.cancel());
  const done=()=>{wipeEl.getAnimations().forEach(x=>x.cancel());wipeEl.style.opacity='';wipeEl.style.transform='';};
  const k1=rm?[{opacity:0},{opacity:1}]:[{transform:'translateX(-104%)'},{transform:'translateX(0)'}];
  const k2=rm?[{opacity:1},{opacity:0}]:[{transform:'translateX(0)'},{transform:'translateX(106%)'}];
  if(rm)wipeEl.style.transform='none';
  wipeEl.animate(k1,{duration:a,easing:'cubic-bezier(.55,0,.9,.55)',fill:'forwards'});
  return sleep(a).then(()=>{onCovered();wipeEl.getAnimations().forEach(x=>x.cancel());
    wipeEl.animate(k2,{duration:b,easing:'cubic-bezier(.1,.45,.45,1)',fill:'forwards'});return sleep(b);}).then(done);}
function paperFlash(){flashEl.getAnimations().forEach(a=>a.cancel());flashEl.animate([{opacity:.85},{opacity:0}],{duration:S.settings.reducedMotion?120:160,easing:'ease-out'});}

// ---------- ride state machine ----------
let world=null,rideTok=0,running=false,acc=0,lastLineT=-9,busy=false,keyhintT=0,evIdx=0;
let swoop=null,swoopedLevel=null,skippedAt=-1e9;
function cancelRide(){if(world)A('stopRide');rideTok++;running=false;world=null;busy=false;endSwoopState();stage.classList.remove('busy');}
function startRide(){if(!S.level)return;const tok=++rideTok,fromEdit=S.mode==='edit';
  if(world)A('stopRide');endSwoopState();
  hideWin();hideOffer();hideSlip();S.stroke=null;
  try{world=P.build(S.level,S.items,{assist:S.settings.assist});}catch(e){report('physics.build',e);return;}
  running=false;acc=0;lastLineT=-9;jumpEdge=false;evIdx=0;refundHud(true);
  try{ride&&ride.reset(world,S.level,S);}catch(e){report('ride.reset',e);}
  const enter=()=>{if(tok!==rideTok)return;S.mode='ride';applyMode();showHud();return refreshBg();};
  if(!fromEdit){enter();running=true;return;}                 // restart mid-ride / from the win stamp: instant
  busy=true;stage.classList.add('busy');
  // The camera swoop (contract v2 §3): full on the first ride after a level loads, quick after that.
  // Reduced motion, or a ride.js without drawTransition, keeps the ink wipe / fade below.
  if(ride&&typeof ride.drawTransition==='function'&&!S.settings.reducedMotion){
    const full=swoopedLevel!==S.level.id,tm=ride.transitionMs||{};swoopedLevel=S.level.id;
    const ms=+(full?tm.full:tm.quick)||(full?1100:420);
    swoop={tok,ms,t0:null,p:0};S.mode='ride';applyMode();stage.classList.add('swooping');
    refreshBg().then(()=>{if(!swoop||swoop.tok!==tok)return;swoop.t0=performance.now();
      swoop.timer=setTimeout(()=>finishSwoop(tok),ms+500);});   // timer backstop: hidden tabs get no frames
    return;}
  let printed=Promise.resolve();
  wipe(()=>{printed=enter()||printed;}).then(()=>printed).then(()=>{if(tok!==rideTok)return;busy=false;stage.classList.remove('busy');running=true;acc=0;});}
function endSwoopState(){if(swoop)clearTimeout(swoop.timer);swoop=null;stage.classList.remove('swooping');bgs.style.opacity='';bgr.style.opacity='';}
function finishSwoop(tok){if(!swoop||swoop.tok!==tok)return;endSwoopState();A('transition',1);
  if(tok!==rideTok)return;busy=false;stage.classList.remove('busy');running=true;acc=0;showHud();}
function skipSwoop(){if(!swoop)return false;skippedAt=performance.now();finishSwoop(swoop.tok);return true;}
function endRide(status){running=false;A('stopRide');if(status==='win')return win();fail(status);}
// Fail fast: hold the crash for a beat, then snap back to the drawing (<300 ms total).
const RETRY=()=>isTouch()?'Tap RIDE to retry, or redraw.':'<kbd>R</kbd> ride again · <kbd>E</kbd> edit your drawing';
function rememberRide(w){const tot=(w.drops||[]).length;lastRide=tot?{refund:Math.round(w.refund||0),got:w.drops.filter(d=>d.got).length,total:tot}:null;}
function fail(status,quit=false){const tok=rideTok,w=world,r=w.rider;running=false;rememberRide(w);
  S.ghost={path:w.path,events:w.events,status,at:[clamp(r.x,0,W),clamp(r.y,0,H)]};
  if(!quit)S.falls++;
  const why=quit?null:status==='popped'?['Popped!','pop']:status==='stuck'?['Stuck. The rider stopped rolling.','stuck']
    :[w.t-lastLineT<1.2?'Fell off the tightrope.':'Fell off the edge.','fall'];
  const back=()=>{if(tok!==rideTok)return;cancelRide();S.mode='edit';applyMode();refreshBg();paperFlash();
    const tip=why&&S.level.tools.includes('sling')&&S.items.some(i=>i.type==='sling')&&coachOnce('sling-fail')?'Put it in the rider’s path and point it at the ring.':null;
    if(why)slip([why[0],tip||RETRY()],{mark:why[1],hold:tip?3600:2600});maybeOfferAssist();};
  if(quit)back();else setTimeout(back,110);}
function toEdit(){if(S.mode==='ride'&&world)return fail(world.status==='run'?'quit':world.status,true);
  cancelRide();hideWin();S.mode='edit';applyMode();refreshBg();paperFlash();}
// New physics events go to audio.event(); drops also tick the refund counter.
function forwardEvents(){const ev=world.events;while(evIdx<ev.length){const e=ev[evIdx++];A('event',e);if(e.type==='drop')refundHud(false,e);}}
let refundShown=0,refundAnim=0;
function refundHud(reset,e){const el=$('#refund'),tot=world&&world.drops?world.drops.length:0;
  if(reset){refundShown=0;cancelAnimationFrame(refundAnim);el.hidden=!tot;if(tot)setRefundText(0,0,tot);return;}
  const target=Math.round(world.refund!=null?world.refund:refundShown+(e&&e.v||0)),got=world.drops.filter(d=>d.got).length,from=refundShown,t0=performance.now();
  refundShown=target;el.hidden=false;
  el.classList.add('down');raf2(()=>el.classList.remove('down'));                       // stamp: 2-frame hold
  cancelAnimationFrame(refundAnim);const tick=()=>{const k=Math.min(1,(performance.now()-t0)/260);setRefundText(Math.round(from+(target-from)*k),got,tot);if(k<1)refundAnim=requestAnimationFrame(tick);};
  setRefundText(target,got,tot);if(!S.settings.reducedMotion){setRefundText(from,got,tot);tick();}
  clearTimeout(refundHud.t);refundHud.t=setTimeout(()=>{if(refundShown===target)setRefundText(target,got,tot);},320);}   // backstop if frames stall
function setRefundText(v,got,tot){const el=$('#refund');el.querySelector('b').textContent=`+${v} ink`;el.querySelector('span').textContent=`${got}/${tot} drops`;}
function stepRide(dt){if(S.mode!=='ride'||!running||!world||panelOpen)return;
  const a=S.settings.assist;acc+=dt*(a===1?.7:1);let n=0;
  while(acc>=DT&&n<10){const inp=a===2?P.autopilot(world,S.level):readInput();
    try{P.step(world,S.level,inp);}catch(e){report('physics.step',e);running=false;return;}
    jumpEdge=false;acc-=DT;n++;forwardEvents();
    const r=world.rider;if(r.grounded&&r.groundKind==='line')lastLineT=world.t;
    if(world.status!=='run'){endRide(world.status);return;}}
  if(n>=10)acc=0;
  if(a===2)jumpEdge=false;}

// ---------- win: the proof is approved, "OK TO PRINT" is stamped on the sheet ----------
let winTimers=[];
function win(){const w=world,L=S.level,r=w.rider,used=P.inkUsed(S.items),refund=Math.round(w.refund||0),stars=starsFor(L,used,refund),spoils=S.falls;
  rememberRide(w);const nd=(w.drops||[]).length,gotD=nd?w.drops.filter(d=>d.got).length:0;
  S.mode='win';S.ghost={path:w.path,events:w.events,status:'win',at:[r.x,r.y]};S.falls=0;
  const prev=progress[L.id]||0;if(stars>prev){progress[L.id]=stars;store.set(KEY.progress,progress);}
  applyMode();renderJobs();
  const jumps=w.events.filter(e=>e.type==='jump').length,last=S.li>=LEVELS.length-1;
  $('#okdate').textContent=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
  $('#okstars').innerHTML=[0,1,2].map(i=>`<svg viewBox="0 0 24 24" class="${i<stars?'got':'miss'}" style="transform:rotate(${[-8,4,-3][i]}deg)"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/>${i<stars?'<path class="k" d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/>':''}</svg>`).join('');
  const ticket=$('#ticket');tilt(ticket,'ticket:'+L.id);
  ticket.innerHTML=`<b>Level ${pad2(S.li+1)} · ${esc(L.name)}${stars>prev&&prev?' · new best':''}</b>
    <span>${nd?`Ink ${Math.round(used)} − ${refund} from drops = ${Math.max(0,Math.round(used)-refund)}`:`Ink ${Math.round(used)} of ${L.ink}`} · par ★★★ ${L.par[0]} · ★★ ${L.par[1]}</span>
    <span>${nd?`Drops ${gotD}/${nd} · `:''}Time ${w.t.toFixed(1)} s · ${jumps} jump${jumps===1?'':'s'} · ${spoils} fall${spoils===1?'':'s'}</span>`;
  $('#next').hidden=last;slug();
  winTimers.forEach(clearTimeout);winTimers=[];
  const ok=$('#ok'),rm=S.settings.reducedMotion;ok.hidden=false;
  ok.querySelectorAll('.okframe,.got').forEach(el=>el.classList.remove('down','inked'));
  // A stamp: instant down, a 2-frame hold (darker ink, sheet jolts), then up. No tween, no bounce.
  // Reduced motion: everything is inked at once, but the stamp sounds keep their rhythm.
  if(rm)ok.querySelectorAll('.okframe,.got').forEach(el=>el.classList.add('inked'));
  const land=(el,i)=>{A('stamp',i);if(rm)return;el.classList.add('down');stage.classList.add('thunk');
    raf2(()=>{el.classList.remove('down');el.classList.add('inked');stage.classList.remove('thunk');});};
  const at=(ms,f)=>winTimers.push(setTimeout(f,ms));
  at(180,()=>land(ok.querySelector('.okframe'),0));
  ok.querySelectorAll('.got').forEach((el,i)=>at(560+i*300,()=>land(el,i+1)));
  at(200,()=>(last?$('#retry'):$('#next')).focus({preventScroll:true}));}
function hideWin(){winTimers.forEach(clearTimeout);winTimers=[];$('#ok').hidden=true;stage.classList.remove('thunk');}

// ---------- the shop note (assist offer): once, without judgment ----------
const offeredLevels=new Set();let offerDeclined=false;
function maybeOfferAssist(){if(S.falls<3||S.settings.assist||offerDeclined||offeredLevels.has(S.level.id))return;
  offeredLevels.add(S.level.id);const el=$('#offer');tilt(el,'note');el.hidden=false;
  el.animate(S.settings.reducedMotion?[{opacity:0},{opacity:1}]:[{translate:'0 -14px',opacity:0},{translate:'0 0',opacity:1}],{duration:S.settings.reducedMotion?120:180,easing:'ease-out'});}
function hideOffer(){$('#offer').hidden=true;}
function setAssist(a){S.settings.assist=a;saveSettings();syncSettings();}
$('#offer1').onclick=()=>{setAssist(1);hideOffer();toast('Slow-mo on. Stars still count.');};
$('#offer2').onclick=()=>{setAssist(2);hideOffer();toast('Auto-ride on. Stars still count.');};
$('#offer0').onclick=()=>{offerDeclined=true;hideOffer();};

// ---------- the machine panel (settings) ----------
let panelOpen=false;
function saveSettings(){store.set(KEY.settings,S.settings);}
function setSwitch(el,on){const s=el.querySelectorAll('span');s[0].classList.toggle('on',!on);s[1].classList.toggle('on',!!on);el.setAttribute('aria-checked',!!on);}
function syncSettings(){const s=S.settings;$('#s-fov').value=s.fov;$('#fovv').textContent=`${s.fov}°`;
  setSwitch($('#s-chase'),s.chase);setSwitch($('#s-bob'),s.bob);setSwitch($('#s-rm'),s.reducedMotion);setSwitch($('#s-snd'),s.sound);
  $('#s-vol').value=Math.round(s.volume*100);$('#s-vol').disabled=!s.sound;$('#volv').textContent=s.sound?Math.round(s.volume*100)+'%':'OFF';
  $$('#s-assist span').forEach(b=>{const on=+b.dataset.a===s.assist;b.classList.toggle('on',on);b.setAttribute('aria-checked',on);});
  const badge=$('#badge');badge.hidden=!s.assist;badge.textContent=s.assist===2?'Auto-ride on':'Slow-mo on';}
function togglePanel(open=!panelOpen){panelOpen=open;const el=$('#panel');$('#gear').setAttribute('aria-expanded',open);acc=0;
  if(!open){el.hidden=true;return;}
  syncSettings();tilt(el,'panel');el.hidden=false;
  el.animate(S.settings.reducedMotion?[{opacity:0},{opacity:1}]:[{translate:'0 -10px',opacity:0},{translate:'0 0',opacity:1}],{duration:S.settings.reducedMotion?120:170,easing:'ease-out'});}
$('#gear').onclick=()=>togglePanel();
$('#gmdone').onclick=()=>togglePanel(false);
$('#gmname').onclick=showHint;
$('#levelsbtn').onclick=()=>toggleLevels();
// game mode sheets close when you tap anywhere else
addEventListener('pointerdown',e=>{if(!gameMode)return;const t=e.target;
  if(document.documentElement.classList.contains('levels')&&!t.closest('#board,#levelsbtn'))toggleLevels(false);
  if(panelOpen&&!t.closest('#panel,#gear'))togglePanel(false);},true);
$('#s-fov').oninput=e=>{S.settings.fov=+e.target.value;syncSettings();saveSettings();};
[['#s-chase','chase'],['#s-bob','bob'],['#s-rm','reducedMotion'],['#s-snd','sound']].forEach(([sel,k])=>{$(sel).dataset.snd='toggle';$(sel).onclick=()=>{S.settings[k]=!S.settings[k];syncSettings();saveSettings();applySound();};});
function applySound(){A('setMuted',!S.settings.sound);A('setVolume',S.settings.volume);}
$('#s-vol').oninput=e=>{S.settings.volume=clamp(+e.target.value/100,0,1);syncSettings();saveSettings();applySound();};
$$('#s-assist span').forEach(b=>{b.onclick=()=>{A('ui','toggle');setAssist(+b.dataset.a);};
  b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();setAssist(+b.dataset.a);}
    else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();const a=clamp(S.settings.assist+(e.key==='ArrowLeft'?-1:1),0,2);setAssist(a);$(`#s-assist [data-a="${a}"]`).focus();}};});

// ---------- ride HUD (DOM part; ride.js draws the in-canvas HUD) ----------
function showHud(){syncSettings();const kh=$('#keyhint');
  kh.textContent=S.settings.assist===2?'Auto-ride is on · E — back to your drawing':isTouch()?'◀ ▶ steer · tap to jump':'← → steer · space jump (hold to float) · ↑ push · ↓ brake · R restart · E edit';
  kh.classList.remove('fade');clearTimeout(keyhintT);keyhintT=setTimeout(()=>kh.classList.add('fade'),3200);}

// ---------- input ----------
const pressed=new Set(),touchHeld={left:new Set(),right:new Set(),jump:new Set()};
let jumpEdge=false;
const CODES={left:['ArrowLeft','KeyA'],right:['ArrowRight','KeyD'],up:['ArrowUp','KeyW'],down:['ArrowDown','KeyS'],jump:['Space']};
const held=k=>CODES[k].some(c=>pressed.has(c))||(touchHeld[k]&&touchHeld[k].size>0);
function readInput(){return{steer:(held('right')?1:0)-(held('left')?1:0),jump:jumpEdge,jumpHeld:held('jump'),push:(held('up')?1:0)-(held('down')?1:0)};}
const TOOLKEYS={Digit1:'line',Digit2:'wind',Digit3:'rope',Digit4:'sling',Numpad1:'line',Numpad2:'wind',Numpad3:'rope',Numpad4:'sling'};   // the well is retired; 4 is the sling
addEventListener('keydown',e=>{
  const t=e.target;
  if(t.closest&&t.closest('input,select,textarea')){if(e.key==='Escape')togglePanel(false);return;}
  if(e.metaKey||e.ctrlKey||e.altKey){if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.code==='KeyZ'&&S.mode==='edit'){e.preventDefault();undo();}return;}
  const c=e.code;pressed.add(c);lastActivity=performance.now();
  if(c==='Escape'&&panelOpen){e.preventDefault();togglePanel(false);return;}
  if(swoop){if(c==='Space'||c.startsWith('Arrow'))e.preventDefault();if(e.repeat)return;   // any key skips the swoop (E/Esc goes back instead)
    if(c==='KeyE'||c==='Escape'){cancelRide();S.mode='edit';applyMode();refreshBg();}
    else{skipSwoop();if(c==='Space')jumpEdge=true;}   // a jump press skips *and* still counts as the first jump
    return;}
  if(busy){if(c==='Space'||c.startsWith('Arrow'))e.preventDefault();
    if((c==='KeyE'||c==='Escape')&&!e.repeat){cancelRide();S.mode='edit';applyMode();refreshBg();}   // changed their mind mid-wipe
    return;}
  const onButton=t.tagName==='BUTTON'||t.getAttribute&&t.getAttribute('role')==='radio';
  if(S.mode==='ride'){
    if(c==='Space'||c.startsWith('Arrow'))e.preventDefault();
    if(c==='Space'&&!e.repeat)jumpEdge=true;
    else if(c==='KeyR'&&!e.repeat)startRide();
    else if((c==='KeyE'||c==='Escape')&&!e.repeat)toEdit();
    return;}
  if(S.mode==='win'){
    if(e.repeat)return;
    if(c==='KeyR'){e.preventDefault();startRide();}
    else if(c==='KeyE'||c==='Escape'){e.preventDefault();toEdit();}
    else if((c==='Enter'||c==='KeyN')&&!$('#next').hidden&&!onButton){e.preventDefault();load(S.li+1);}
    return;}
  // edit
  if((c==='Enter'||c==='Space')&&!onButton){e.preventDefault();if(!e.repeat)startRide();}
  else if(c==='KeyR'&&!e.repeat)startRide();
  else if(c==='KeyZ'||(c==='Backspace'&&!onButton)){e.preventDefault();if(S.items.length||lastCleared)A('ui','undo');undo();}
  else if(TOOLKEYS[c]&&S.level.tools.includes(TOOLKEYS[c])){if(S.tool!==TOOLKEYS[c])A('ui','tool');S.tool=TOOLKEYS[c];ui();}
  else if(c==='Escape'){hideOffer();hideSlip();}});
addEventListener('keyup',e=>pressed.delete(e.code));
addEventListener('blur',()=>{pressed.clear();Object.values(touchHeld).forEach(s=>s.clear());$$('.pad').forEach(b=>b.classList.remove('down'));});

// touch: the on-screen pads, and tapping the ride stage jumps
if(matchMedia('(pointer:coarse)').matches)document.body.classList.add('touch');
let unlocked_=false;const unlockAudio=()=>{if(unlocked_)return;unlocked_=true;A('unlock');applySound();};
addEventListener('keydown',unlockAudio,true);
addEventListener('pointerdown',e=>{unlockAudio();if(swoop&&!e.target.closest('#panel,#gear'))skipSwoop();},true);
addEventListener('pointerdown',e=>{if(e.pointerType==='touch')document.body.classList.add('touch');else if(e.pointerType==='mouse')document.body.classList.remove('touch');lastActivity=performance.now();},true);
$$('.pad').forEach(b=>{const k=b.dataset.pad,set=touchHeld[k];
  const up=e=>{set.delete(e.pointerId);if(!set.size)b.classList.remove('down');};
  b.addEventListener('pointerdown',e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId);}catch(_){}set.add(e.pointerId);b.classList.add('down');if(k==='jump')jumpEdge=true;});
  ['pointerup','pointercancel','lostpointercapture'].forEach(t=>b.addEventListener(t,up));
  b.addEventListener('contextmenu',e=>e.preventDefault());});
const tap=$('#tap');
tap.addEventListener('pointerdown',e=>{e.preventDefault();if(S.mode!=='ride')return;   // a tap that skips the swoop also jumps, like Space
  try{tap.setPointerCapture(e.pointerId);}catch(_){}touchHeld.jump.add(e.pointerId);jumpEdge=true;});
['pointerup','pointercancel','lostpointercapture'].forEach(t=>tap.addEventListener(t,e=>touchHeld.jump.delete(e.pointerId)));

// drawing sounds: side.js owns the editor, so unless it calls hooks.draw itself, infer the phases from the
// pointer on the canvas. A capture listener on the stage runs before the editor's handler, the fg listener after it.
let drawing=null,itemsAtDown=0;
const designPt=e=>{const r=fg.getBoundingClientRect();return[(e.clientX-r.left)/r.width*W,(e.clientY-r.top)/r.height*H];};
stage.addEventListener('pointerdown',()=>{itemsAtDown=S.items.length;},true);
fg.addEventListener('pointerdown',e=>{if(sideDraws||S.mode!=='edit'||busy)return;const tool=S.tool;
  if(S.stroke){drawing={tool,p:designPt(e),t:performance.now()};A('draw',tool,'start',0);}
  else if(S.items.length>itemsAtDown){A('draw',tool,'start',0);A('draw',tool,'end',0);}});   // a sling (or a legacy well) lands in one tap
addEventListener('pointermove',e=>{if(!drawing||sideDraws)return;if(!S.stroke){A('draw',drawing.tool,'end',0);drawing=null;return;}
  const p=designPt(e),now=performance.now(),dt=Math.max(1,now-drawing.t)/1000,sp=Math.hypot(p[0]-drawing.p[0],p[1]-drawing.p[1])/dt;
  drawing.p=p;drawing.t=now;A('draw',drawing.tool,'move',Math.min(sp,4000));});
['pointerup','pointercancel'].forEach(t=>addEventListener(t,()=>{if(!drawing)return;A('draw',drawing.tool,'end',0);drawing=null;}));

// stamps: instant down, held for 2 frames after release, then up
document.addEventListener('pointerdown',e=>{const b=e.target.closest('.stamp:not(.pad),.tool');if(!b||b.disabled)return;b.classList.add('press');
  const up=()=>{removeEventListener('pointerup',up);removeEventListener('pointercancel',up);raf2(()=>b.classList.remove('press'));};
  addEventListener('pointerup',up);addEventListener('pointercancel',up);});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(!b.classList.contains('pad'))A('ui',b.dataset.snd||'press');
  if(e.detail===0&&b.matches('.stamp,.tool')){b.classList.add('press');raf2(()=>raf2(()=>b.classList.remove('press')));}
  if(e.detail>0&&!b.closest('#panel'))b.blur();});   // pointer clicks drop focus so Space/Enter keep meaning "ride"
$$('[data-tool]').forEach(b=>{b.dataset.snd='tool';b.onclick=()=>{S.tool=b.dataset.tool;ui();};});
$('#undo').dataset.snd='undo';$('#clear').dataset.snd='clear';$('#next').dataset.snd='next';
// Undo history: 'add' for each new item, {prev} for each drag-move. Undo reverts the most recent one.
let lastCleared=null,hist=[],lastLen=0;
function undo(){if(S.mode!=='edit')return;S.stroke=null;const h=hist.pop();
  if(h&&h.prev)S.items=h.prev;
  else if(!S.items.length&&lastCleared){S.items=lastCleared;lastCleared=null;}else if(S.items.length)S.items.pop();else return;
  lastLen=S.items.length;ui();saveDraft();}
$('#undo').onclick=undo;
$('#clear').onclick=()=>{if(!S.items.length)return;lastCleared=S.items;S.items=[];S.stroke=null;hist=[];lastLen=0;ui();saveDraft();toast('Drawing cleared. Z to undo.');};
$('#go').onclick=startRide;
$('#toedit').onclick=toEdit;$('#restart').onclick=startRide;
$('#retry').onclick=toEdit;
$('#next').onclick=()=>load(S.li+1);

// ---------- frame loop ----------
let last=performance.now(),bgT='';
function frame(now){const t=now/1000,dt=Math.min(.1,(now-last)/1000);last=now;
  stepRide(dt);
  g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.clearRect(0,0,fg.width,fg.height);
  if(S.level&&S.ink){g.save();g.setTransform(px,0,0,px,0,0);
    try{
      if(S.mode==='edit'){if(side)side.draw(g,t);}
      else if(swoop&&world&&ride)drawSwoop(t,now);
      else if(world&&ride){const out=ride.draw(g,world,S.level,S,t,dt);applyBgTransform(out);}
    }catch(e){report(swoop?'ride.drawTransition':S.mode==='edit'?'side.draw':'ride.draw',e);if(swoop)skipSwoop();}
    g.restore();}
  if(S.mode==='ride'&&running&&world)A('ride',world,dt);
  if(speck){g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='destination-out';g.drawImage(speck,0,0);g.globalCompositeOperation='source-over';}
  if(S.mode==='edit')meter();
  requestAnimationFrame(frame);}
// The swoop frame: ride.js draws the moving camera, the side drawing fades out on top of it (sideAlpha),
// and the two backdrops cross-fade (rideBgAlpha) with the ride backdrop following out.bg.
let sideBuf=null;
function drawSwoop(t,now){const sw=swoop,p=sw.t0==null?0:clamp((now-sw.t0)/sw.ms,0,1);sw.p=p;
  const out=ride.drawTransition(g,world,S.level,S,t,p)||{};applyBgTransform(out);
  const sa=clamp(out.sideAlpha!=null?+out.sideAlpha:1-p,0,1),ra=clamp(out.rideBgAlpha!=null?+out.rideBgAlpha:p,0,1);
  bgr.style.opacity=ra.toFixed(3);bgs.style.opacity=(1-ra).toFixed(3);
  if(side&&sa>.004){if(!sideBuf||sideBuf.width!==fg.width||sideBuf.height!==fg.height)sideBuf=canvas(fg.width,fg.height);
    const sg=sideBuf.getContext('2d');sg.setTransform(1,0,0,1,0,0);sg.clearRect(0,0,sideBuf.width,sideBuf.height);sg.setTransform(px,0,0,px,0,0);
    try{side.draw(sg,t);}catch(e){report('side.draw',e);}
    g.save();g.setTransform(1,0,0,1,0,0);g.globalAlpha=sa;g.drawImage(sideBuf,0,0);g.restore();}
  A('transition',p);
  if(p>=1)finishSwoop(sw.tok);}
// ride.draw may return {bg:{x,y,scale,rot?}}: x,y in design units (800×500), rot in degrees (camera roll on a
// tightrope), applied as a CSS transform on the ride backdrop.
function applyBgTransform(out){const b=out&&out.bg;let s='';
  if(b){const k=cssW/W;s=`translate(${((+b.x||0)*k).toFixed(2)}px,${((+b.y||0)*k).toFixed(2)}px) scale(${(+b.scale||1).toFixed(4)})`+(b.rot?` rotate(${(+b.rot).toFixed(2)}deg)`:'');}
  if(s!==bgT){bgT=s;bgr.style.transform=s;}}

// ---------- boot ----------
layout();
addEventListener('resize',layout);addEventListener('orientationchange',layout);
[GMQ,TURNQ].forEach(q=>q.addEventListener&&q.addEventListener('change',layout));
if(window.visualViewport)visualViewport.addEventListener('resize',layout);
new ResizeObserver(()=>{resize();requestAnimationFrame(nudge);}).observe(stage);
resize();
const lastId=store.get(KEY.last,null),startAt=Math.max(0,LEVELS.findIndex(l=>l.id===lastId));
syncSettings();load(startAt);applySound();
$('#board').addEventListener('wheel',e=>{const b=$('#board');if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&b.scrollWidth>b.clientWidth){b.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
requestAnimationFrame(frame);

// ---------- dev hook ----------
window.game={S,LEVELS,physics:P,
  load,setItems(items){if(S.mode!=='edit')toEdit();S.items=cloneItems(items||[]);S.stroke=null;lastCleared=null;hist=[];lastLen=S.items.length;ui();saveDraft();},
  ride:startRide,edit:toEdit,get world(){return world;},panel:togglePanel,toast,
  // testing aid: advance the ride by `sec` of game time without waiting for frames (works in hidden tabs)
  skip:skipSwoop,get swoop(){return swoop&&{p:swoop.p,ms:swoop.ms};},renderers:()=>({side,ride,audio}),thumb:printThumb,
  advance(sec=1){if(swoop)skipSwoop();for(let i=0;i<Math.round(sec/DT);i++){if(S.mode!=='ride'||!running)break;stepRide(DT);}return world&&{t:world.t,status:world.status};}};
