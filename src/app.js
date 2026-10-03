// app.js — Riso Rider app shell: shared state S, layers + printing, the
// edit → ride → (win | back to edit) state machine, input, settings, assist and UI.
// Contract: ARCHITECTURE.md. Look and wording: UI.md ("the print shop").
import * as P from './physics.js';
import {LEVELS,CHAPTERS} from './levels.js';
import * as SH from './share.js';

const {W,H,DT}=P;
const TAU=Math.PI*2;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const hex=c=>(window.Riso&&Riso.INKS[c])||c;
const pad2=n=>String(n).padStart(2,'0');
const fmtT=t=>Number.isFinite(t)?t.toFixed(2):'—';
const MEDALS=['author','gold','silver','bronze'];
const medalFor=(L,t)=>{const m=L.medals||{};return MEDALS.find(k=>m[k]&&t<=m[k]+1e-9)||null;};
const raf2=f=>requestAnimationFrame(()=>requestAnimationFrame(f));   // "a 2-frame hold"

// ---------- storage (always wrapped: private windows / blocked storage) ----------
const KEY={progress:'drift.progress.v2',settings:'drift.settings.v1',drafts:'drift.drafts.v1',last:'drift.last.v1',coached:'drift.coached.v1',
  trials:'drift.trials.v1',mine:'drift.mine.v1',got:'drift.got.v1',shelf:'drift.shelf.v1'};
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};

// ---------- errors from the parallel-built modules: log once, keep running ----------
const errSeen=new Set();
function report(where,e){const k=where+':'+(e&&e.message);if(errSeen.has(k))return;errSeen.add(k);console.error(`[app] ${where} threw:`,e);}
async function loadMod(path){try{return await import(path);}catch(e){report('import '+path,e);return null;}}
const fontsReady=Promise.race([Promise.all([document.fonts.load('800 16px "Big Shoulders Stencil Display"'),document.fonts.load('16px "Cutive Mono"')]).catch(()=>{}),new Promise(r=>setTimeout(r,1500))]);
const [sideMod,rideMod,audioMod,makerMod,trialsMod,commMod]=await Promise.all([loadMod('./side.js'),loadMod('./ride.js'),loadMod('./audio.js'),loadMod('./maker.js'),loadMod('./trials.js'),loadMod('./community.js'),fontsReady]);
// Contract v7: four shelves of levels. Time trials and the community's featured levels are their own modules
// (a missing one leaves its shelf empty); your own levels and the ones you opened from codes live in storage.
const TRIALS=((trialsMod&&trialsMod.default)||[]).map((L,i)=>({...L,sheet:`TRIAL ${pad2(i+1)}`}));

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
// view: the side view's camera (contract v7) — world point → design units (p − (x,y))·k. make: the maker's pen.
// trial: the time-trial run in progress ({offset, ghost, rec, splits, snap, respawns}), else null.
const S={li:0,level:null,items:[],tool:'line',mode:'edit',stroke:null,ink:null,pat:null,ghost:null,falls:0,
  view:{x:0,y:0,k:1},make:{piece:'slab',material:'solid',snap:true},trial:null,
  settings:sanitize(store.get(KEY.settings,null))};
const SHELVES=['levels','trials','make','community'];
let shelf=SHELVES.includes(store.get(KEY.shelf,'levels'))?store.get(KEY.shelf,'levels'):'levels';
const listOf=sh=>sh==='levels'?LEVELS:sh==='trials'?TRIALS:sh==='make'?mine.map(e=>e.level):[...featured,...got].map(e=>e.level);
let list=[],loadedShelf=shelf;   // filled at boot, once your levels are read
const entryOf=L=>L&&(mine.find(e=>e.id===L.id)||got.find(e=>e.id===L.id)||featured.find(e=>e.id===L.id))||null;
const isTrial=L=>!!L&&L.mode==='trial';
const isCampaign=L=>LEVELS.includes(L);
let testing=null;   // your level's entry while you test it from the maker
const progress=store.get(KEY.progress,{})||{};
const trialBest=store.get(KEY.trials,{})||{};   // id → {t, medal, rec (the ghost), splits}
// Your levels: [{id, level, rev, proof, clear:{hash,t,ink}}]. Levels opened from codes: [{id, level, proof, verified}].
const mine=(store.get(KEY.mine,[])||[]).filter(e=>e&&e.id&&e.level).map(e=>{const L=SH.clean(e.level);return L&&{...e,level:{...L,id:e.id}};}).filter(Boolean);
const got=(store.get(KEY.got,[])||[]).filter(e=>e&&e.id&&e.level).map(e=>{const L=SH.clean(e.level);return L&&{...e,level:{...L,id:e.id}};}).filter(Boolean);
const saveMine=()=>store.set(KEY.mine,mine.map(e=>({...e,level:SH.clean(e.level)})));
const saveGot=()=>store.set(KEY.got,got.map(e=>({...e,level:SH.clean(e.level)})));
// Featured community levels ship with the game (src/community.js: [{level, proof}]), checked when opened.
const featured=((commMod&&commMod.default)||[]).map(e=>{const L=SH.clean(e.level);return L&&{id:'f-'+SH.levelHash(L),level:{...L,id:'f-'+SH.levelHash(L)},proof:e.proof,featured:true};}).filter(Boolean);
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
function nudge(){const els=$$('#tray,.acts,#barrow,#gear,#gmbar,#pieces,.mopts');els.forEach(e=>{e.classList.remove('overplay');e.style.removeProperty('--lift');});
  if(!gameMode||!S.level||(S.mode!=='edit'&&S.mode!=='make'))return;
  const r=stage.getBoundingClientRect(),v=S.view,k=r.width/W*v.k,L=S.level,zones=[];
  const Z=(x0,y0,x1,y1)=>zones.push([r.left+(x0-v.x)*k,r.top+(y0-v.y)*k,r.left+(x1-v.x)*k,r.top+(y1-v.y)*k]);
  Z(L.start.x-34,L.start.y-40,L.start.x+40,L.start.y+26);
  const G=L.goal;Z(G.x-G.r-16,G.y-G.r-16,G.x+G.r+16,G.y+G.r+16);
  for(const p of L.blocks){const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys);   // the start ledge
    if(L.start.x>=x0-10&&L.start.x<=x1+10&&y0-L.start.y>-4&&y0-L.start.y<30)Z(x0,y0-24,x1,y0+22);}
  const hit=(b,dy=0)=>zones.some(z=>b.left<z[2]&&b.right>z[0]&&b.top-dy<z[3]&&b.bottom-dy>z[1]);
  for(const e of els){e.style.removeProperty('--lift');const b=e.getBoundingClientRect();if(!b.width||!hit(b))continue;
    // bottom groups first try sliding up just clear of the start ledge / goal; the top bars just fade
    if(e.matches('#tray,.acts,#pieces')){let dy=0;const room=b.top-52;while(dy<=room&&hit(b,dy))dy+=6;
      if(dy<=room){e.style.setProperty('--lift',dy+'px');continue;}}
    e.classList.add('overplay');}}
let nudgeQ=0;const nudgeSoon=()=>{if(!nudgeQ)nudgeQ=requestAnimationFrame(()=>{nudgeQ=0;nudge();});};
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
const bgSig=L=>hash(JSON.stringify(L.bg)).toString(36);
const pkey=(kind,L,pw)=>`${kind}:${L.id}~${bgSig(L)}:${pw}`;
function printSide(L,pw){const ph=Math.round(pw*H/W),img=Riso.printSideBackdrop(L.bg,pw,ph,L.bg.paper?{paper:L.bg.paper}:{});
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
  if(on){el.classList.toggle('small',!full);$('#printjob').textContent=`LOADING ${sheetLabel()}…`;}}
// Paint whichever backdrop the current mode shows; print it first if needed.
function refreshBg(){const L=S.level;if(!L||!fg.width)return Promise.resolve();
  const kind=S.mode==='edit'||S.mode==='make'?'side':'ride',cv=kind==='side'?bgs:bgr,pw=printW(),k=pkey(kind,L,pw);
  if(cv.dataset.k===k)return Promise.resolve();
  if(prints.has(k)){paint(cv,prints.get(k),k);return Promise.resolve();}
  const full=!(cv.dataset.k||'').startsWith(kind+':'+L.id+'~');   // (key prefix is kind:id:)   // nothing of this job shown yet → cover the stage
  printing(true,full);
  return getPrint(kind,L,pw).then(c=>{printing(false);if(S.level===L&&cv.dataset.k!==k)paint(cv,c,k);if(kind==='side')idleWork();});}
// While the player is idle: pre-print the ride backdrop (so Ride never waits), then job-board thumbnails.
let lastActivity=0;
function idleWork(delay=400){clearTimeout(idleWork.t);idleWork.t=setTimeout(()=>{
  if((S.mode!=='edit'&&S.mode!=='make')||S.stroke||performance.now()-lastActivity<700||pending.size)return idleWork();
  const L=S.level,pw=printW();
  if(S.mode==='edit'&&!prints.has(pkey('ride',L,pw)))return getPrint('ride',L,pw).then(()=>idleWork());
  const j=list.findIndex(l=>!thumbs.has(thumbKey(l)));if(j<0)return;
  try{thumbs.set(thumbKey(list[j]),printThumb(list[j]));}catch(e){report('thumbnail',e);thumbs.set(thumbKey(list[j]),null);}
  renderJobs();idleWork(120);},delay);}   // thumbnails are cheap: once idle, print them back to back

// ---------- job board: mini printed sheets clipped to a line ----------
const thumbs=new Map();
const thumbKey=L=>L.id+':'+((entryOf(L)||{}).rev||0);
// A wide course is fitted to the thumbnail's width, centred top to bottom.
function printThumb(L){const w=148,h=92,D=P.dims(L),s=Math.min(w/D.w,h/D.h),oy=(h-D.h*s)/2;
  const img=Riso.printSideBackdrop(L.bg,w,h,{cell:2.4,mis:.8,...(L.bg.paper?{paper:L.bg.paper}:{})});
  const c=canvas(w,h),x=c.getContext('2d');x.putImageData(img,0,0);x.globalCompositeOperation='multiply';x.setTransform(s,0,0,s,0,oy);
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
  // tools the level places: lines solid, ropes dashed, wind streaked (mid), slings ringed
  (L.fixed||[]).forEach(it=>{x.setLineDash([]);x.strokeStyle=K;x.lineWidth=7;
    if(it.type==='line'){x.beginPath();it.pts.forEach((q,i)=>x[i?'lineTo':'moveTo'](q[0],q[1]));x.stroke();}
    else if(it.type==='rope'){x.setLineDash([14,9]);x.beginPath();x.moveTo(it.a[0],it.a[1]);x.lineTo(it.b[0],it.b[1]);x.stroke();}
    else if(it.type==='wind'){x.strokeStyle=M;x.setLineDash([22,14]);x.lineWidth=9;x.beginPath();it.pts.forEach((q,i)=>x[i?'lineTo':'moveTo'](q[0],q[1]));x.stroke();}
    else if(it.type==='sling'){x.lineWidth=8;x.beginPath();x.arc(it.x,it.y,26,0,TAU);x.stroke();}});x.setLineDash([]);
  (L.checks||[]).forEach(cp=>{x.strokeStyle=K;x.lineWidth=7;x.setLineDash([14,10]);x.beginPath();x.arc(cp.x,cp.y,cp.r||30,0,TAU);x.stroke();x.setLineDash([]);});
  x.strokeStyle=hex(L.bg.inks[2]);x.lineWidth=9;x.beginPath();x.arc(L.goal.x,L.goal.y,L.goal.r,0,TAU);x.stroke();
  x.fillStyle=hex(L.bg.inks[1]);x.beginPath();x.arc(L.start.x,L.start.y,14,0,TAU);x.fill();
  return c;}
// Clearing a level opens the next two, so one hard level never blocks the way on (campaign and time trials).
// Your own levels and community levels are always open.
const doneOn=L=>!!L&&(isTrial(L)?!!trialBest[L.id]:!!progress[L.id]);
const ordered=()=>shelf==='levels'||shelf==='trials';
const unlocked=i=>!ordered()||allJobs||i===0||(i===S.li&&loadedShelf===shelf)||doneOn(list[i])||doneOn(list[i-1])||(i>1&&doneOn(list[i-2]));
const kindWord=()=>shelf==='trials'?'Trial':'Level';
const lockedMsg=i=>`${kindWord()} ${pad2(i+1)} is locked. Clear ${kindWord().toLowerCase()} ${pad2(i)}${i>1?` or ${pad2(i-1)}`:''} first.`;
const starSvg=n=>Array.from({length:n},()=>'<svg viewBox="0 0 24 24"><use href="#star"/></svg>').join('');
// The label the level goes by: LEVEL 03, TRIAL 02, or CUSTOM for your own and community levels.
function sheetLabel(){const L=S.level;return!L?'LEVEL':isCampaign(L)?`LEVEL ${pad2(LEVELS.indexOf(L)+1)}`:L.sheet||'CUSTOM';}
const medalShort={author:'AUTH',gold:'GOLD',silver:'SILV',bronze:'BRNZ'};
// Each card says how you did: stars for puzzles, your best medal for trials, CLEAR on your own cleared levels.
function cardMark(L){if(shelf==='make'){const e=entryOf(L);return e&&clearOk(e)?'<span class="medalmark got">CLEAR</span>':'';}
  if(isTrial(L)){const b=trialBest[L.id],m=b&&medalFor(L,b.t);return m?`<span class="medalmark got">${medalShort[m]}</span>`:b?`<span class="medalmark">${fmtT(b.t)}</span>`:'';}   // from your time, so re-tuned medals show right
  return starSvg(progress[L.id]||0);}
function addCard(box,mark,label,fn,name){const b=document.createElement('button');b.className='job paper add';tilt(b,'add:'+name);b.title=label;b.setAttribute('aria-label',label);
  b.innerHTML=`<svg class="clip"><use href="#clip"/></svg><span class="blank">${mark}</span><span class="jn"><span>${esc(name)}</span></span><span class="inks">${esc(label)}</span>`;b.onclick=fn;box.append(b);}
function renderJobs(){const box=$('#jobs');box.innerHTML='';
  $$('.shelf').forEach(b=>{const on=b.dataset.shelf===shelf;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;});
  if(shelf==='make'){addCard(box,'+','Make a new puzzle level',()=>newLevel('puzzle'),'Puzzle');addCard(box,'+','Make a new time trial',()=>newLevel('trial'),'Trial');}
  if(shelf==='community')addCard(box,'CODE','Open a level from a code',()=>openShare('open'),'Open');
  list.forEach((L,i)=>{
  const ch=shelf==='levels'&&CHAPTERS.find(c=>c.from===i);   // a chapter tab before each chapter's first level
  if(ch){const t=document.createElement('div');t.className='chap';t.innerHTML=`<span>CH ${ch.n}</span><span class="cname">${esc(ch.name)}</span>`;box.append(t);}
  const b=document.createElement('button'),open=unlocked(i),t=thumbs.get(thumbKey(L)),on=i===S.li&&loadedShelf===shelf;
  b.className='job paper'+(on?' on':'')+(open?'':' locked');tilt(b,'job:'+L.id);
  b.title=open?`${shelf==='trials'?'Trial':shelf==='levels'?'Level':isTrial(L)?'Time trial':'Puzzle'} ${pad2(i+1)} · ${L.name}`:lockedMsg(i);
  b.setAttribute('aria-label',open?`${pad2(i+1)}, ${L.name}`:`${pad2(i+1)}, locked`);
  if(!open)b.setAttribute('aria-disabled','true');
  b.innerHTML=`<svg class="clip"><use href="#clip"/></svg>${open&&t?'':`<span class="blank">${pad2(i+1)}</span>`}
    <span class="jn"><span>${pad2(i+1)}</span><span class="st">${open?cardMark(L):''}</span></span><span class="inks">${open?esc(L.name):'locked'}</span>`;
  if(open&&t){const c=canvas(t.width,t.height);c.getContext('2d').drawImage(t,0,0);b.querySelector('.clip').after(c);}
  b.dataset.snd=open?'press':'locked';
  b.onclick=()=>{if(!open){toast(lockedMsg(i));return;}if(shelf==='make')openMaker(i);else if(!on||testing||S.mode==='make')load(i);};
  box.append(b);});
  const on=box.querySelector('.job.on'),bd=$('#board');
  if(on&&(on.offsetLeft<bd.scrollLeft||on.offsetLeft+on.offsetWidth>bd.scrollLeft+bd.clientWidth))bd.scrollLeft=on.offsetLeft-bd.clientWidth/2+on.offsetWidth/2;}
function setShelf(sh){if(!SHELVES.includes(sh))return;shelf=sh;list=listOf(sh);store.set(KEY.shelf,sh);$('#board').scrollLeft=0;renderJobs();idleWork(200);}
$$('.shelf').forEach(b=>{b.dataset.snd='tool';b.onclick=()=>setShelf(b.dataset.shelf);
  b.onkeydown=e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const i=(SHELVES.indexOf(shelf)+(e.key==='ArrowLeft'?3:1))%4;setShelf(SHELVES[i]);$(`.shelf[data-shelf="${SHELVES[i]}"]`).focus();};});

// ---------- level load ----------
function load(i){if(!list.length)return;i=clamp(i|0,0,list.length-1);testing=null;loadedShelf=shelf;setLevel(list[i],i,'edit');}
// Everything a level brings with it: its inks (the whole interface reprints in them), paper, tools, ink bar or
// medal strip, title, and the ghost of your best run (time trials). mode: 'edit' to play it, 'make' to build it.
function setLevel(L,i,mode){cancelRide();hideWin();hideOffer();hideSlip();closeSheets();
  S.li=i;S.level=L;S.mode=mode;S.stroke=null;S.ghost=null;S.falls=0;S.trial=null;lastCleared=null;lastRide=null;swoopedLevel=null;
  if(!isCampaign(L)&&!L.sheet)L.sheet='CUSTOM';
  const trial=isTrial(L);
  S.items=trial?[]:cloneItems(drafts[L.id]||[]).filter(it=>L.tools.includes(it.type));hist=[];lastLen=S.items.length;   // e.g. wells from before the sling
  S.view={x:0,y:0,k:1};
  applyInks(L);
  $('#kindlbl').textContent=isCampaign(L)?'LEVEL':trial&&!testing&&loadedShelf==='trials'?'TRIAL':'CUSTOM';
  $('#num').textContent=pad2(i+1);$('#lname').textContent=L.name;$('#hint').textContent=L.hint||'';
  $('#gmnum').textContent=pad2(i+1);$('#gmlname').textContent=L.name;toggleLevels(false);
  document.documentElement.dataset.lmode=trial?'trial':'puzzle';
  $$('[data-tool]').forEach(b=>b.hidden=!L.tools.includes(b.dataset.tool));
  if(!L.tools.includes(S.tool))S.tool=L.tools[0];
  $('#tray').hidden=trial||!L.tools.length;$('#undo').hidden=$('#clear').hidden=trial;
  $('#meter').hidden=$('#inkread').hidden=trial;$('#medals').hidden=!trial;
  if(!trial){const n3=$('#n3'),n2=$('#n2'),k=L.ink||1;n3.style.left=((1-L.par[0]/k)*100)+'%';n2.style.left=((1-L.par[1]/k)*100)+'%';
    n3.title=`3 stars: use ${L.par[0]} ink or less`;n2.title=`2 stars: use ${L.par[1]} ink or less`;}
  else{showBestGhost();medalStrip();}
  $('#testbar').hidden=!testing;
  if(mode==='edit')store.set(KEY.last,{shelf:loadedShelf,id:L.id});
  renderJobs();applyMode();
  // First run (no stars anywhere yet, level 1, nothing drawn): two short notes: how to draw, then how to ride.
  coach=isCampaign(L)&&i===0&&!Object.keys(progress).length&&!S.items.length?1:0;
  refreshBg().then(()=>{if(S.level!==L||S.mode!=='edit')return;
    if(coach===1&&!S.items.length)slip([isTouch()?'Drag your finger across the picture to draw a line from the ledge to the ring.':'Drag across the picture to draw a line from the ledge to the ring.'],{hold:4200});
    else if(trial&&P.dims(L).w>W&&coachOnce('trial-pan'))slip([isTouch()?'Drag the picture to look along the course. Tap RIDE to go.':'Drag the picture to look along the course. Press RIDE or Enter to go.'],{hold:3600});
    else if(gameMode)showHint();});   // game mode has no hint line, so the hint arrives as a slip (tap the level name for it again)
  requestAnimationFrame(nudge);}
// The level's three inks and paper, on the canvas patterns and on every piece of interface.
function applyInks(L){S.ink={light:hex(L.bg.inks[0]),mid:hex(L.bg.inks[1]),key:hex(L.bg.inks[2])};
  S.pat={light:dotPattern(S.ink.light,7,1.9),lightDense:dotPattern(S.ink.light,6,2.4),mid:dotPattern(S.ink.mid,6,1.7),key:dotPattern(S.ink.key,5,1.6)};
  const rs=document.documentElement.style,I=S.ink,paper=(window.Riso&&Riso.PAPERS[L.bg.paper])||'#f2ede3';
  [['--light',I.light],['--mid',I.mid],['--key',I.key],['--lm',multiply(I.light,I.mid)],['--mk',multiply(I.mid,I.key)],['--lk',multiply(I.light,I.key)],['--paper',paper]].forEach(([k,v])=>rs.setProperty(k,v));}
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
function meter(){const L=S.level;if(!L||isTrial(L))return;const used=P.inkUsed(S.items)+(S.stroke?safeCost(S.stroke):0);
  const lr=lastRide&&lastRide.refund>0?lastRide:null;
  const sig=Math.round(used*10)+'|'+L.id+'|'+(lr?lr.refund:0);if(sig===lastMeter)return;lastMeter=sig;
  const left=clamp(1-used/L.ink,0,1),st=P.stars(L,used);
  $('#meter .empty').style.clipPath=`inset(0 0 0 ${(left*100).toFixed(2)}%)`;
  const mk=$('#lastride');mk.hidden=!lr;
  if(lr){const w=Math.min(lr.refund/L.ink,1-left);mk.style.left=(left*100).toFixed(2)+'%';mk.style.width=(w*100).toFixed(2)+'%';
    mk.title=`Last ride collected ${lr.refund} ink in drops (${lr.got}/${lr.total})`;}
  $('#inkleft').innerHTML=`${Math.max(0,Math.round(L.ink-used))} left · ${starTxt(st)}`+(lr?` <span class="last">· last ride +${lr.refund} → ${starTxt(starsFor(L,used,lr.refund))}</span>`:'');
  const m=$('#meter');m.setAttribute('aria-valuemax',L.ink);m.setAttribute('aria-valuenow',Math.max(0,Math.round(L.ink-used)));m.setAttribute('aria-valuetext',`${Math.round(L.ink-used)} ink left, ${st} stars`);}
function slug(){if(!S.level)return;
  if(S.mode==='make'){$('#slug').textContent=`MAKING · ${S.level.name.toUpperCase()} · ${isTrial(S.level)?'TIME TRIAL':'PUZZLE'}`;return;}
  $('#slug').textContent=`${sheetLabel()} · ${S.level.name.toUpperCase()}${S.falls?` · ${S.falls} ${S.falls===1?'FALL':'FALLS'}`:''}`;}
function ui(){lastMeter='';meter();slug();$$('[data-tool]').forEach(b=>{const on=b.dataset.tool===S.tool;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
  $('#undo').disabled=!S.items.length&&!lastCleared;$('#clear').disabled=!S.items.length;
  if(S.mode==='make')makeUi();}
function applyMode(){const m=S.mode;stage.classList.toggle('editing',m==='edit'||m==='make');stage.classList.toggle('riding',m==='ride');stage.classList.toggle('winning',m==='win');stage.classList.toggle('making',m==='make');
  $('#editbar').hidden=m!=='edit';$('#ridebar').hidden=m!=='ride';$('#winbar').hidden=m!=='win';$('#hud').hidden=m!=='ride';$('#makebar').hidden=m!=='make';$('#barrow').hidden=m==='make';
  $('#respawn').hidden=!(m==='ride'&&isTrial(S.level));$('#clock').hidden=!(m==='ride'&&isTrial(S.level));
  if(m!=='ride'){bgr.style.transform='';bgT='';}document.documentElement.dataset.mode=m;ui();requestAnimationFrame(nudge);}
function onChange(){lastActivity=performance.now();lastCleared=null;if(S.mode!=='edit')return;
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
// rec: every input of this ride, quantized exactly as it was fed to the physics (share.js replays it for the clear
// check), the steps at which you respawned, and the world kept at the last checkpoint passed.
let rec=null;
let swoop=null,swoopedLevel=null,skippedAt=-1e9;
function cancelRide(){countT.forEach(clearTimeout);countT=[];$('#count').hidden=true;if(world)A('stopRide');rideTok++;running=false;world=null;busy=false;endSwoopState();stage.classList.remove('busy');}
function startRide(){if(!S.level)return;const tok=++rideTok,fromEdit=S.mode==='edit';
  if(world)A('stopRide');endSwoopState();
  hideWin();hideOffer();hideSlip();closeSheets();S.stroke=null;
  try{world=P.build(S.level,S.items,{assist:S.settings.assist});}catch(e){report('physics.build',e);return;}
  rec={steps:[],respawns:[],assist:S.settings.assist,snap:null};
  S.trial=isTrial(S.level)?{offset:0,ghost:(trialBest[S.level.id]||null)&&{rec:trialBest[S.level.id].rec},rec:[],splits:[],respawns:0}:null;
  if(fromEdit&&P.dims(S.level).w>W)S.view={...S.view,x:0};   // the swoop dives from the start of the course
  running=false;acc=0;lastLineT=-9;jumpEdge=false;evIdx=0;refundHud(true);clockHud();
  try{ride&&ride.reset(world,S.level,S);}catch(e){report('ride.reset',e);}
  const enter=()=>{if(tok!==rideTok)return;S.mode='ride';applyMode();showHud();return refreshBg();};
  if(!fromEdit){enter();countdown(tok);return;}                // restart mid-ride / from the win stamp: no swoop, straight to 3·2·1
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
  wipe(()=>{printed=enter()||printed;}).then(()=>printed).then(()=>{if(tok!==rideTok)return;busy=false;stage.classList.remove('busy');countdown(tok);});}
function endSwoopState(){if(swoop)clearTimeout(swoop.timer);swoop=null;stage.classList.remove('swooping');bgs.style.opacity='';bgr.style.opacity='';}
function finishSwoop(tok){if(!swoop||swoop.tok!==tok)return;endSwoopState();A('transition',1);
  if(tok!==rideTok)return;busy=false;stage.classList.remove('busy');showHud();countdown(tok);}
// 3 · 2 · 1 · GO!, stamped on the sheet before every ride starts (a respawn mid-run doesn't count down). The physics
// waits, so a trial's clock starts at GO. Keys held at GO count (hold ↑ to push off); a jump pressed early doesn't.
const COUNT_MS=600;let countT=[];
function countdown(tok){countT.forEach(clearTimeout);countT=[];running=false;acc=0;const el=$('#count'),b=el.querySelector('b'),rm=S.settings.reducedMotion;
  const beat=(txt,i)=>{if(tok!==rideTok||S.mode!=='ride'){el.hidden=true;return;}b.textContent=txt;el.hidden=false;el.classList.toggle('go',i===3);tilt(el,'count'+i);A('stamp',i===3?0:3-i);
    if(!rm){el.classList.add('down');raf2(()=>el.classList.remove('down'));}};
  [0,1,2,3].forEach(i=>countT.push(setTimeout(()=>{beat(['3','2','1','GO!'][i],i);if(i===3&&tok===rideTok&&S.mode==='ride'){running=true;acc=0;jumpEdge=false;}},i*COUNT_MS)));
  countT.push(setTimeout(()=>{if(tok===rideTok)el.hidden=true;},3*COUNT_MS+450));}
function skipSwoop(){if(!swoop)return false;skippedAt=performance.now();finishSwoop(swoop.tok);return true;}
function endRide(status){running=false;A('stopRide');if(status==='win')return win();if(S.trial)return trialFall(status);fail(status);}
// Time trials never send you back to the course view: a fall puts you back at the last checkpoint you passed, with
// the speed you had there, and the clock keeps the time you lost. No checkpoint yet: straight back to the start.
// A checkpoint left behind (passed a later one, missed this one) can't be reached from a respawn, so that run starts over.
function missedCheck(){const w=world,sn=rec&&rec.snap;if(!w||!sn)return-1;return w.checks.findIndex(c=>!c.got&&c.x<sn.rider.x);}
function trialFall(status){const tok=rideTok;S.falls++;slug();
  const miss=missedCheck(),back=miss<0&&rec&&rec.snap;
  slip([status==='popped'?'Popped!':status==='stuck'?(miss>=0?`Missed checkpoint ${miss+1}.`:'Stuck.'):'Fell off.',back?`Back to checkpoint ${S.trial.splits.length}.`:'Back to the start.'],{mark:status==='popped'?'pop':status==='stuck'?'stuck':'fall',hold:miss>=0?1600:900});
  setTimeout(()=>{if(tok!==rideTok||S.mode!=='ride')return;if(!back||!respawn())startRide();},miss>=0?900:520);}
function respawn(){if(!S.trial||!rec||!rec.snap||!world||missedCheck()>=0)return false;
  S.trial.offset+=world.t-rec.snap.t;world=P.cloneWorld(rec.snap);rec.respawns.push(rec.steps.length);S.trial.respawns++;
  evIdx=0;acc=0;jumpEdge=false;running=true;A('stopRide');try{ride&&ride.reset(world,S.level,S);}catch(e){report('ride.reset',e);}return true;}
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
function toEdit(){if(S.trial&&(S.mode==='ride'||S.mode==='win')){cancelRide();hideWin();S.mode='edit';S.trial=null;showBestGhost();applyMode();refreshBg();paperFlash();return;}
  if(S.mode==='ride'&&world)return fail(world.status==='run'?'quit':world.status,true);
  cancelRide();hideWin();S.mode='edit';applyMode();refreshBg();paperFlash();}
// New physics events go to audio.event(); drops also tick the refund counter.
function forwardEvents(){const ev=world.events;let cp=false;while(evIdx<ev.length){const e=ev[evIdx++];A('event',e);if(e.type==='drop')refundHud(false,e);
    if(e.type==='check'&&!cp){cp=true;if(rec)rec.snap=P.cloneWorld(world);if(S.trial)split();}}}
// A checkpoint split: your time, and how it compares with the same checkpoint on your best run.
function split(){const T=world.t+S.trial.offset,n=S.trial.splits.length,b=trialBest[S.level.id],bt=b&&b.splits&&b.splits[n];S.trial.splits.push(Math.round(T*100)/100);
  const el=$('#split');el.className='';el.textContent=`CP ${n+1} · ${fmtT(T)}`+(bt!=null?` · ${T<=bt?'−':'+'}${Math.abs(T-bt).toFixed(2)}`:'');
  if(bt!=null)el.classList.add(T<=bt?'ahead':'behind');A('stamp',1);clearTimeout(split.t);split.t=setTimeout(()=>{el.textContent='';},2200);}
function clockHud(){const el=$('#clock');el.hidden=!S.trial;$('#split').textContent='';if(S.trial)el.querySelector('b').textContent='0.00';}
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
  while(acc>=DT&&n<10){const q=SH.packInput(a===2?P.autopilot(world,S.level):readInput()),inp={steer:q[0]/32,push:q[1]/32,jump:!!(q[2]&1),jumpHeld:!!(q[2]&2)};
    if(rec)rec.steps.push(q);
    try{P.step(world,S.level,inp);}catch(e){report('physics.step',e);running=false;return;}
    if(S.trial&&!S.trial.toldMiss){const G0=S.level.goal,r=world.rider,m=world.checks.findIndex(c=>!c.got);
      if(m>=0&&Math.hypot(r.x-G0.x,r.y-G0.y)<G0.r){S.trial.toldMiss=true;slip([`Missed checkpoint ${m+1}. The finish only counts once you’ve passed them all.`,'R starts again.'],{mark:'stuck',hold:2600});}}
    if(S.trial&&rec.steps.length%2===0){const r=world.rider;S.trial.rec.push([Math.round((world.t+S.trial.offset)*1000)/1000,Math.round(r.x*10)/10,Math.round(r.y*10)/10,Math.round(r.z*10)/10,r.grounded?(r.groundKind==='rope'?2:0):1]);}
    jumpEdge=false;acc-=DT;n++;forwardEvents();
    const r=world.rider;if(r.grounded&&r.groundKind==='line')lastLineT=world.t;
    if(world.status!=='run'){endRide(world.status);return;}}
  if(n>=10)acc=0;
  if(a===2)jumpEdge=false;}

// ---------- win: the proof is approved, "OK TO PRINT" is stamped on the sheet ----------
let winTimers=[];
function win(){const w=world,L=S.level,r=w.rider,used=P.inkUsed(S.items),refund=Math.round(w.refund||0),trial=!!S.trial;
  rememberRide(w);const nd=(w.drops||[]).length,gotD=nd?w.drops.filter(d=>d.got).length:0,T=Math.round((w.t+(S.trial?S.trial.offset:0))*100)/100,auto=S.settings.assist===2;
  const stars=trial?0:starsFor(L,used,refund),spoils=S.falls,jumps=w.events.filter(e=>e.type==='jump').length;
  S.mode='win';S.ghost=trial?trialPath(S.trial.rec,'win',[r.x,r.y]):{path:w.path,events:w.events,status:'win',at:[r.x,r.y]};S.falls=0;
  // The clear check: beating your own level (not on auto-ride) keeps the ride as its proof and sets its pars or medals.
  let cleared=false;if(testing&&!auto){cleared=passClear(testing,{T,used,refund});}
  let prev=0,best=null,newBest=false;
  if(trial){best=trialBest[L.id]||null;if(!auto&&(!best||T<best.t)){newBest=!!best;best=trialBest[L.id]={t:T,medal:medalFor(L,T),rec:S.trial.rec,splits:S.trial.splits};store.set(KEY.trials,trialBest);}}
  else{prev=progress[L.id]||0;if(stars>prev&&!testing){progress[L.id]=stars;store.set(KEY.progress,progress);}}
  applyMode();renderJobs();if(trial)medalStrip();
  const i=S.li,last=testing||i>=list.length-1||loadedShelf!==shelf;
  $('#okdate').textContent=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
  $('#ok .okframe b').textContent=trial?fmtT(T):'CLEARED!';
  const os=$('#okstars');
  if(trial){const m=medalFor(L,T),got=m?MEDALS.slice(MEDALS.indexOf(m)):[];os.className='okmedals';
    os.innerHTML=MEDALS.slice().reverse().filter(k=>L.medals&&L.medals[k]).map(k=>`<span class="${got.includes(k)?'got':'miss'}">${k.toUpperCase()}</span>`).join('');}
  else{os.className='stars';
    os.innerHTML=[0,1,2].map(i=>`<svg viewBox="0 0 24 24" class="${i<stars?'got':'miss'}" style="transform:rotate(${[-8,4,-3][i]}deg)"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/>${i<stars?'<path class="k" d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/>':''}</svg>`).join('');}
  const ticket=$('#ticket');tilt(ticket,'ticket:'+L.id);
  if(testing)ticket.innerHTML=cleared?`<b>Clear check passed</b><span>${esc(L.name)} is ready to share.</span><span>${trial?`Author medal: ${fmtT(L.medals.author)} s, your best clear.`:`★★★ par: ${L.par[0]} ink, from your best clear.`}</span>`
    :`<b>Cleared</b><span>${auto?'Auto-ride doesn’t count for the clear check. Beat it yourself to share it.':'This ride didn’t count.'}</span>`;
  else if(trial)ticket.innerHTML=`<b>${esc(sheetLabel())} · ${esc(L.name)}${newBest?' · new best':''}</b>
    <span>Time ${fmtT(T)} s${best&&best.t<T?` · best ${fmtT(best.t)} s`:''}${auto?' · auto-ride times don’t count':''}</span>
    <span>${MEDALS.filter(k=>L.medals&&L.medals[k]).map(k=>`${k[0].toUpperCase()+k.slice(1)} ${fmtT(L.medals[k])}`).join(' · ')}</span>
    <span>${S.trial.respawns} respawn${S.trial.respawns===1?'':'s'} · ${jumps} jump${jumps===1?'':'s'}</span>`;
  else ticket.innerHTML=`<b>${esc(sheetLabel())} · ${esc(L.name)}${stars>prev&&prev?' · new best':''}</b>
    <span>${nd?`Ink ${Math.round(used)} − ${refund} from drops = ${Math.max(0,Math.round(used)-refund)}`:`Ink ${Math.round(used)} of ${L.ink}`} · par ★★★ ${L.par[0]} · ★★ ${L.par[1]}</span>
    <span>${nd?`Drops ${gotD}/${nd} · `:''}Time ${w.t.toFixed(1)} s · ${jumps} jump${jumps===1?'':'s'} · ${spoils} fall${spoils===1?'':'s'}</span>`;
  // buttons: Retry · Next (or, testing: ◀ Maker · Share)
  $('#next').hidden=last&&!(testing&&cleared);$('#winmake').hidden=!testing;
  $('#next .face').textContent=testing?'Share':shelf==='trials'?'Next trial →':'Next level →';
  $('#retry .face').textContent=trial?'Ride again':'Retry';
  slug();
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
  ok.querySelectorAll('.got').forEach((el,i)=>at(560+i*300,()=>land(el,Math.min(3,i+1))));
  at(200,()=>($('#next').hidden?$('#retry'):$('#next')).focus({preventScroll:true}));}
function hideWin(){winTimers.forEach(clearTimeout);winTimers=[];$('#ok').hidden=true;stage.classList.remove('thunk');}
// A trial run's recorded samples as a side-view ghost trail.
function trialPath(rc,status,at){return{path:(rc||[]).map(q=>[q[1],q[2],q[3],q[4]]),events:[],status,at};}
function showBestGhost(){const b=S.level&&trialBest[S.level.id];S.ghost=b&&b.rec&&b.rec.length>1?trialPath(b.rec,'win',null):null;}
// The medal strip under the stage: each medal's time, inked once you've beaten it, and your best.
function medalStrip(){const L=S.level,b=trialBest[L.id],el=$('#medals');if(!isTrial(L))return;
  const m=b&&medalFor(L,b.t),got=m?MEDALS.slice(MEDALS.indexOf(m)):[];
  el.innerHTML=MEDALS.slice().reverse().filter(k=>L.medals&&L.medals[k]).map(k=>`<span class="medal ${k}${got.includes(k)?' got':''}" title="${k[0].toUpperCase()+k.slice(1)}: ${fmtT(L.medals[k])} s or faster"><b>${k}</b><i>${fmtT(L.medals[k])}</i></span>`).join('')
    +`<span class="medal best"><b>Best</b><i>${b?fmtT(b.t):'—'}</i></span>`;}

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
  kh.textContent=S.settings.assist===2?'Auto-ride is on · E — back to your drawing':isTouch()?'stick steers · ▲ push · ▼ brake, back · tap jumps':'← → steer · space jump (hold to float) · ↑ push · ↓ brake, then back · R restart · E edit';
  kh.classList.remove('fade');clearTimeout(keyhintT);keyhintT=setTimeout(()=>kh.classList.add('fade'),3200);}

// ---------- input ----------
const pressed=new Set(),touchHeld={jump:new Set()},stick={x:0,y:0,id:null};   // stick: analog, x steer, y push (up = +)
let jumpEdge=false;
const CODES={left:['ArrowLeft','KeyA'],right:['ArrowRight','KeyD'],up:['ArrowUp','KeyW'],down:['ArrowDown','KeyS'],jump:['Space']};
const held=k=>CODES[k].some(c=>pressed.has(c))||(touchHeld[k]&&touchHeld[k].size>0);
function readInput(){return{steer:clamp((held('right')?1:0)-(held('left')?1:0)+stick.x,-1,1),jump:jumpEdge,jumpHeld:held('jump'),push:clamp((held('up')?1:0)-(held('down')?1:0)+stick.y,-1,1)};}
const TOOLKEYS={Digit1:'line',Digit2:'wind',Digit3:'rope',Digit4:'sling',Numpad1:'line',Numpad2:'wind',Numpad3:'rope',Numpad4:'sling'};   // the well is retired; 4 is the sling
addEventListener('keydown',e=>{
  const t=e.target;
  if(t.closest&&t.closest('input,select,textarea')){if(e.key==='Escape')togglePanel(false);return;}
  if(e.metaKey||e.ctrlKey||e.altKey){if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.code==='KeyZ'){if(S.mode==='edit'){e.preventDefault();undo();}else if(S.mode==='make'&&maker){e.preventDefault();e.shiftKey?maker.redo():maker.undo();}}return;}
  const c=e.code;pressed.add(c);lastActivity=performance.now();
  if(c==='Escape'&&panelOpen){e.preventDefault();togglePanel(false);return;}
  if(c==='Escape'&&(!$('#makesheet').hidden||!$('#sharesheet').hidden)){e.preventDefault();closeSheets();return;}
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
    else if((c==='KeyC'||c==='Backspace')&&!e.repeat&&S.trial){e.preventDefault();if(running&&!respawn())toast('No checkpoint yet. R starts again.');}
    else if((c==='KeyE'||c==='Escape')&&!e.repeat)toEdit();
    return;}
  if(S.mode==='win'){
    if(e.repeat)return;
    if(c==='KeyR'){e.preventDefault();startRide();}
    else if(c==='KeyE'||c==='Escape'){e.preventDefault();toEdit();}
    else if((c==='Enter'||c==='KeyN')&&!$('#next').hidden&&!onButton){e.preventDefault();$('#next').click();}
    return;}
  if(S.mode==='make'){
    if(e.repeat&&!c.startsWith('Arrow'))return;
    const pc=$$('[data-piece]').filter(b=>b.offsetParent!==null),dn=/^(Digit|Numpad)(\d)$/.exec(c);
    if(c==='Enter'&&!onButton){e.preventDefault();testLevel();}
    else if(c==='KeyZ'){e.preventDefault();maker&&(e.shiftKey?maker.redo():maker.undo());}
    else if(c==='KeyY'){e.preventDefault();maker&&maker.redo();}
    else if(dn){const b=pc[(+dn[2]+9)%10];if(b)b.click();}
    else if(c.startsWith('Arrow')){e.preventDefault();const st=60;panBy(c==='ArrowLeft'?st:c==='ArrowRight'?-st:0,c==='ArrowUp'?st:c==='ArrowDown'?-st:0);}
    else if(c==='Equal'||c==='NumpadAdd')zoomBy(1.25);else if(c==='Minus'||c==='NumpadSubtract')zoomBy(1/1.25);
    else if(c==='Escape'){hideSlip();}
    return;}
  if(testing&&c==='KeyM'&&!e.repeat){backToMaker();return;}
  if(canPan()&&(c==='ArrowLeft'||c==='ArrowRight')){e.preventDefault();panBy(c==='ArrowLeft'?80:-80,0);return;}
  // edit
  if((c==='Enter'||c==='Space')&&!onButton){e.preventDefault();if(!e.repeat)startRide();}
  else if(c==='KeyR'&&!e.repeat)startRide();
  else if(c==='KeyZ'||(c==='Backspace'&&!onButton)){e.preventDefault();if(S.items.length||lastCleared)A('ui','undo');undo();}
  else if(TOOLKEYS[c]&&S.level.tools.includes(TOOLKEYS[c])){if(S.tool!==TOOLKEYS[c])A('ui','tool');S.tool=TOOLKEYS[c];ui();}
  else if(c==='Escape'){hideOffer();hideSlip();}});
addEventListener('keyup',e=>pressed.delete(e.code));
addEventListener('blur',()=>{pressed.clear();Object.values(touchHeld).forEach(s=>s.clear());$$('.pad').forEach(b=>b.classList.remove('down'));stickRelease();});

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
// The stick: drag from anywhere in its box. Past a small dead zone, x steers and y pushes (up) or brakes then
// rolls back (down), both analog; the knob follows the thumb up to the ring.
const stickEl=$('#stick'),knob=stickEl.querySelector('.knob');
function stickMove(e){const r=stickEl.querySelector('.ring').getBoundingClientRect(),R=r.width/2;
  let dx=(e.clientX-(r.left+R))/R,dy=(e.clientY-(r.top+R))/R;const m=Math.hypot(dx,dy);if(m>1){dx/=m;dy/=m;}
  knob.style.transform=`translate(${dx*R*.62}px,${dy*R*.62}px)`;
  const dz=.16,ax=v=>Math.abs(v)<dz?0:Math.sign(v)*(Math.abs(v)-dz)/(1-dz);
  stick.x=ax(dx);stick.y=-ax(dy);}
function stickRelease(){stick.id=null;stick.x=stick.y=0;knob.style.transform='';stickEl.classList.remove('on');}
stickEl.addEventListener('pointerdown',e=>{e.preventDefault();if(stick.id!=null)return;stick.id=e.pointerId;try{stickEl.setPointerCapture(e.pointerId);}catch(_){}
  stickEl.classList.add('on');stickMove(e);});
stickEl.addEventListener('pointermove',e=>{if(e.pointerId===stick.id)stickMove(e);});
['pointerup','pointercancel','lostpointercapture'].forEach(t=>stickEl.addEventListener(t,e=>{if(e.pointerId===stick.id)stickRelease();}));
stickEl.addEventListener('contextmenu',e=>e.preventDefault());
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
$('#next').onclick=()=>{if(testing){openShare('share');return;}load(S.li+1);};
$('#respawn').onclick=()=>{if(running&&!respawn())toast('No checkpoint yet.');};

// ---------- the maker (contract v7): your own levels ----------
// Your level is S.level while you make it (maker.js edits it in place) and while you test it (testing = its entry).
let maker=null,makerFor=null;
try{maker=makerMod&&makerMod.createMaker({canvas:fg,getState:()=>S,hooks:{onChange:makerChanged,onLive(){lastActivity=performance.now();},toast,pan:panBy,zoom:zoomBy,
  sound(kind,phase,speed){if(kind==='tool')A('ui','tool');else if(kind==='clear')A('ui','clear');else A('draw',kind==='rope'?'rope':kind==='wind'?'wind':kind==='sling'?'sling':'line',phase,speed||0);}}});}catch(e){report('createMaker',e);}
const MK=makerMod||{};
// Cleared, and not changed since: the proof still belongs to this exact level.
function clearOk(e){return!!(e&&e.proof&&e.clear&&e.clear.hash===SH.levelHash(e.level));}
const curEntry=()=>testing||(S.level&&mine.find(e=>e.id===S.level.id))||null;
let saveT=0;const saveMineSoon=()=>{clearTimeout(saveT);saveT=setTimeout(saveMine,300);};
function makerChanged(){const e=curEntry();if(!e)return;e.rev=(e.rev||0)+1;lastActivity=performance.now();saveMineSoon();ui();clearStatus();idleWork(900);nudgeSoon();}
function clearStatus(){const e=curEntry();if(!e||S.mode!=='make')return;
  $('#hint').textContent=!e.proof?'Build it, then press TEST and beat it yourself. A level can only be shared once you’ve cleared it.'
    :clearOk(e)?`Cleared in ${fmtT(e.clear.t)} s. It’s ready to share.`:'Changed since your clear. Test it and beat it again to share it.';}
function newLevel(mode){if(!MK.blank)return toast('The maker didn’t load. Try reloading the page.');
  const presets=Object.values((window.Riso&&Riso.PRESETS)||{}),inks=presets.length?presets[Math.floor(Math.random()*presets.length)].slice():undefined;
  const id='m-'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36),level={...MK.blank(mode,inks),id};
  if(mine.length>=60)return toast('You have 60 levels. Delete one to make another.');
  mine.unshift({id,level,rev:0});saveMine();setShelf('make');openMaker(0);
  slip([mode==='trial'?'A new course. Pick a piece below and drag across the picture to place it. Drag empty paper with MOVE to look along it.':'A new level. Pick a piece below and drag across the picture to place it.'],{hold:4200});}
function openMaker(i){const L=list[i];if(!L||!maker)return;testing=null;loadedShelf='make';
  if(makerFor!==L.id){maker.reset();makerFor=L.id;}
  setLevel(L,i,'make');$('#kindlbl').textContent='MAKING';
  if((S.make.piece==='check'&&!isTrial(L))||(S.make.piece==='drop'&&isTrial(L)))S.make.piece='slab';
  clearStatus();makeUi();}
function testLevel(){const e=curEntry();if(!e||S.mode!=='make')return;closeSheets();
  if(!isTrial(e.level)&&!e.level.tools.length&&coachOnce('no-tools'))toast('This level gives the player no tools: it has to be won by riding.');
  testing=e;setLevel(e.level,S.li,'edit');$('#kindlbl').textContent='TESTING';}
function backToMaker(){const e=testing;if(!e)return;const i=mine.indexOf(e);testing=null;cancelRide();hideWin();
  if(i<0){setShelf('make');return;}if(shelf!=='make')setShelf('make');openMaker(i);}
// Beating your own level: keep the ride as its proof, and set the pars (puzzle) or medals (trial) from it.
function passClear(e,{T,used,refund}){const L=e.level,net=Math.max(0,Math.round(used)-refund);
  // Already cleared as it is, and that clear was better (faster, or less ink)? Keep it: medals and pars never get easier.
  if(clearOk(e)&&(isTrial(L)?e.clear.t<=T:(e.clear.net??e.clear.ink)<net||((e.clear.net??e.clear.ink)===net&&e.clear.t<=T)))return true;
  const proof={items:cloneItems(S.items),assist:rec.assist===1?1:0,steps:SH.rle(rec.steps),respawns:rec.respawns.slice(),t:T};
  const chk=SH.replay(L,proof);if(!chk.ok)report('clear check replay',new Error('the recorded ride did not replay to a win'));
  if(isTrial(L)){const a=Math.ceil(T*10)/10,r1=v=>Math.round(v*10)/10;L.medals={author:a,gold:r1(a*1.1),silver:r1(a*1.25),bronze:r1(a*1.6)};L.maxT=Math.min(180,Math.max(60,Math.ceil(a*3)));}
  else{const p3=Math.min(L.ink,net);L.par=[p3,Math.round(p3+(L.ink-p3)/2)];}
  e.proof=proof;e.clear={hash:SH.levelHash(L),t:T,ink:Math.round(used),net};e.rev=(e.rev||0)+1;saveMine();return true;}
function makeUi(){if(S.mode!=='make')return;const m=S.make,L=S.level;
  $$('[data-piece]').forEach(b=>{const on=b.dataset.piece===m.piece;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
  const mat=$('#m-mat');mat.classList.toggle('off',m.piece!=='slab'&&m.piece!=='box');
  mat.querySelectorAll('span').forEach(s=>{const on=s.dataset.mat===m.material;s.classList.toggle('on',on);s.setAttribute('aria-checked',on);});
  setSwitch($('#m-snap'),m.snap);
  $('#m-undo').disabled=!maker||!maker.canUndo();$('#m-redo').disabled=!maker||!maker.canRedo();
  $('#m-share').disabled=!clearOk(curEntry());$('#m-share').title=clearOk(curEntry())?'Share this level':'Beat your level first (press Test)';
  $('#zoomout').disabled=S.view.k<=minK()+1e-6;$('#zoomin').disabled=S.view.k>=2.5-1e-6;}
$$('[data-piece]').forEach(b=>{b.dataset.snd='tool';b.onclick=()=>{S.make.piece=b.dataset.piece;makeUi();};});
$$('#m-mat span').forEach(s=>{s.onclick=()=>{A('ui','toggle');S.make.material=s.dataset.mat;if(S.make.piece!=='slab'&&S.make.piece!=='box')S.make.piece='slab';makeUi();};
  s.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();s.click();}};});
$('#m-snap').dataset.snd='toggle';$('#m-snap').onclick=()=>{S.make.snap=!S.make.snap;makeUi();};
$('#m-undo').dataset.snd='undo';$('#m-undo').onclick=()=>{maker&&maker.undo();};$('#m-redo').onclick=()=>{maker&&maker.redo();};
$('#m-test').onclick=testLevel;$('#backmake').onclick=backToMaker;$('#winmake').onclick=backToMaker;
$('#m-share').onclick=()=>openShare('share');
$('#zoomin').onclick=()=>zoomBy(1.25);$('#zoomout').onclick=()=>zoomBy(1/1.25);

// ---------- the side view's camera: pan and zoom (maker, and looking along a time-trial course) ----------
const minK=()=>{const D=S.level?P.dims(S.level):{w:W,h:H};return S.mode==='make'?Math.max(.3,Math.min(1,W/D.w)):1;};
// Along an axis where the level fits on the stage it's centred and doesn't move; otherwise it pans, with a little
// paper margin past the edges in the maker.
const fits=()=>{const D=P.dims(S.level),v=S.view;return{x:D.w<=W/v.k+1e-6,y:D.h<=H/v.k+1e-6};};
function clampView(){const L=S.level;if(!L)return;const D=P.dims(L),v=S.view,vw=W/v.k,vh=H/v.k,m=S.mode==='make'?40:0,f=fits();
  v.x=f.x?(D.w-vw)/2:clamp(v.x,-m,D.w+m-vw);v.y=f.y?(D.h-vh)/2:clamp(v.y,-m,D.h+m-vh);}
function panBy(dx,dy){const r=stage.getBoundingClientRect();if(!r.width)return;const u=W/(r.width*S.view.k);S.view.x-=dx*u;S.view.y-=dy*u;clampView();nudgeSoon();}
function zoomBy(f,c){if(S.mode!=='make')return;const v=S.view,r=stage.getBoundingClientRect(),cx=c?(c[0]-r.left)/r.width*W:W/2,cy=c?(c[1]-r.top)/r.height*H:H/2;
  const wx=v.x+cx/v.k,wy=v.y+cy/v.k,k=clamp(v.k*f,minK(),2.5);v.k=k;v.x=wx-cx/k;v.y=wy-cy/k;clampView();makeUi();nudgeSoon();}
// A time-trial course is longer than the stage: drag the picture (or scroll) to look along it.
let panDrag=null;
const canPan=()=>S.level&&S.mode==='edit'&&!S.level.tools.length&&P.dims(S.level).w>W;
fg.addEventListener('pointerdown',e=>{if(!canPan())return;panDrag={id:e.pointerId,x:e.clientX,y:e.clientY};try{fg.setPointerCapture(e.pointerId);}catch(_){}fg.style.cursor='grabbing';});
fg.addEventListener('pointermove',e=>{if(!panDrag||e.pointerId!==panDrag.id)return;panBy(e.clientX-panDrag.x,0);panDrag.x=e.clientX;});
['pointerup','pointercancel'].forEach(t=>fg.addEventListener(t,e=>{if(panDrag&&e.pointerId===panDrag.id){panDrag=null;fg.style.cursor='';}}));
stage.addEventListener('wheel',e=>{if(!S.level)return;
  if(S.mode==='make'){if(e.ctrlKey||e.metaKey){e.preventDefault();zoomBy(Math.exp(-e.deltaY*.01),[e.clientX,e.clientY]);return;}
    const f=fits();if(f.x&&f.y)return;e.preventDefault();panBy(f.x?0:-(e.deltaX||(f.y?e.deltaY:0)),f.y?0:-e.deltaY);}
  else if(canPan()){e.preventDefault();panBy(-(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY),0);}},{passive:false});

// ---------- details sheet ----------
function closeSheets(){$('#makesheet').hidden=true;$('#sharesheet').hidden=true;$('#m-details').setAttribute('aria-expanded',false);}
const SCENE_NAMES={woodblock:'Woodblock coast',park:'Park poster',bauhaus:'Bauhaus',cutouts:'Paper cut-outs',orbits:'Orbits'};
const opts=(el,items,sel)=>{el.innerHTML=items.map(([v,t])=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(t)}</option>`).join('');};
function fillSheet(){const L=S.level,R=window.Riso||{INKS:{},PRESETS:{},PAPERS:{}};
  $('#m-name').value=L.name;$('#m-hint').value=L.hint||'';
  $$('#m-tools span').forEach(s=>{const on=L.tools.includes(s.dataset.t);s.classList.toggle('on',on);s.setAttribute('aria-checked',on);});
  $('#m-ink').value=L.ink;$('#m-inkv').textContent=L.ink;$('#m-len').value=P.dims(L).w;$('#m-lenv').textContent=P.dims(L).w;
  const names=Object.keys(R.INKS),preset=Object.entries(R.PRESETS).find(([,v])=>v.join()===L.bg.inks.join());
  opts($('#m-set'),[['','Your own'],...Object.keys(R.PRESETS).map(k=>[k,k])],preset?preset[0]:'');
  [0,1,2].forEach(i=>opts($('#m-ink'+i),names.map(n=>[n,n]),L.bg.inks[i]));
  opts($('#m-scene'),Object.entries(SCENE_NAMES),L.bg.scene);opts($('#m-paper'),Object.keys(R.PAPERS).map(n=>[n,n]),L.bg.paper||'Natural');
  $('#m-note').textContent=isTrial(L)?'Your time on your clear sets the medals. Inks print in order: light, middle, dark.':'Your ink on your clear sets the ★★★ par. Inks print in order: light, middle, dark.';
  delArm=false;$('#m-delete .face').textContent='Delete level';}
let delArm=false,reprintT=0;
// Every change on the sheet is one undo step, like a piece on the picture.
function edit(f,{inks=false}={}){const L=S.level;if(!L||!maker||S.mode!=='make')return;const before=MK.snapshot(L);f(L);maker.record(before);
  if(inks){applyInks(L);clearTimeout(reprintT);reprintT=setTimeout(()=>{refreshBg();},350);}fillSheet();}
$('#m-details').onclick=()=>{const el=$('#makesheet'),open=el.hidden;closeSheets();if(!open)return;fillSheet();tilt(el,'makesheet');el.hidden=false;$('#m-details').setAttribute('aria-expanded',true);
  el.animate(S.settings.reducedMotion?[{opacity:0},{opacity:1}]:[{translate:'0 -10px',opacity:0},{translate:'0 0',opacity:1}],{duration:S.settings.reducedMotion?120:170,easing:'ease-out'});};
$('#m-done').onclick=closeSheets;
$('#m-name').oninput=e=>{$('#lname').textContent=e.target.value;$('#gmlname').textContent=e.target.value;};
$('#m-name').onchange=e=>edit(L=>{L.name=e.target.value.replace(/[<>]/g,'').trim().slice(0,32)||'Untitled';slug();});
$('#m-hint').onchange=e=>edit(L=>{L.hint=e.target.value.replace(/[<>]/g,'').trim().slice(0,140);});
$$('#m-tools span').forEach(s=>{s.onclick=()=>{A('ui','toggle');edit(L=>{const t=s.dataset.t;L.tools=L.tools.includes(t)?L.tools.filter(x=>x!==t):['line','wind','rope','sling'].filter(x=>x===t||L.tools.includes(x));});};
  s.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();s.click();}};});
$('#m-ink').oninput=e=>{$('#m-inkv').textContent=e.target.value;};
$('#m-ink').onchange=e=>edit(L=>{L.ink=+e.target.value;L.par=[Math.min(L.par[0],L.ink),Math.min(L.par[1],L.ink)];});
// A course can't get shorter than its pieces: the furthest piece (or the finish) plus a little room.
function furthest(L){let x=L.goal.x+L.goal.r;const see=p=>{if(p&&Number.isFinite(p[0]))x=Math.max(x,p[0]);};
  for(const k of['blocks','ice','crumble','hazards'])(L[k]||[]).forEach(p=>p.forEach(see));(L.boosts||[]).forEach(b=>{see(b.a);see(b.b);});
  (L.fixed||[]).forEach(it=>{if(it.pts)it.pts.forEach(see);if(it.a&&Array.isArray(it.a)){see(it.a);see(it.b);}if(it.type==='sling')see([it.x+34]);});(L.checks||[]).forEach(c=>see([c.x+c.r]));return x;}
$('#m-len').oninput=e=>{$('#m-lenv').textContent=e.target.value;};
$('#m-len').onchange=e=>{let w=+e.target.value;const need=Math.ceil((furthest(S.level)+20)/400)*400;if(w<need){w=need;toast('Some pieces are further along. Move them first to make the course shorter.');}
  edit(L=>{L.w=w;(L.hazards||[]).forEach(h=>{h.forEach(q=>{if(q[0]>w)q[0]=w;});});});clampView();};
$('#m-set').onchange=e=>{const p=window.Riso&&Riso.PRESETS[e.target.value];if(p)edit(L=>{L.bg={...L.bg,inks:p.slice()};},{inks:true});};
[0,1,2].forEach(i=>{$('#m-ink'+i).onchange=e=>edit(L=>{const inks=L.bg.inks.slice();inks[i]=e.target.value;L.bg={...L.bg,inks};},{inks:true});});
$('#m-scene').onchange=e=>edit(L=>{L.bg={...L.bg,scene:e.target.value};},{inks:true});
$('#m-paper').onchange=e=>edit(L=>{const bg={...L.bg,paper:e.target.value};if(bg.paper==='Natural')delete bg.paper;L.bg=bg;},{inks:true});
$('#m-reprint').onclick=()=>edit(L=>{L.bg={...L.bg,seed:1+Math.floor(Math.random()*9999)};},{inks:true});
$('#m-delete').onclick=()=>{if(!delArm){delArm=true;$('#m-delete .face').textContent='Sure? Press again';setTimeout(()=>{if(delArm){delArm=false;$('#m-delete .face').textContent='Delete level';}},3000);return;}
  const e=curEntry();if(!e)return;mine.splice(mine.indexOf(e),1);delete drafts[e.id];store.set(KEY.drafts,drafts);saveMine();closeSheets();makerFor=null;
  if(mine.length){setShelf('make');openMaker(0);}else{setShelf('levels');load(0);}toast('Level deleted.');};

// ---------- share codes: share your cleared level, or open someone else's ----------
let shareMode='share',shareCode='';
const inFrame=(()=>{try{return window.top!==window;}catch(e){return true;}})();   // itch.io plays the game in a frame: links there wouldn't carry the code
async function openShare(mode){shareMode=mode;closeSheets();const el=$('#sharesheet'),ta=$('#sharecode');
  if(mode==='share'){const e=curEntry();if(!clearOk(e)){toast('Beat your level first: press TEST and clear it.');return;}
    $('#sharemsg').textContent='Your level as a code. Anyone can paste it into Community → Open to play it. Its code includes your clear, so it can be checked.';
    ta.readOnly=true;ta.value='Making the code…';$('#sharego .face').textContent='Copy code';$('#sharelink').hidden=inFrame||!/^https?:/.test(location.protocol);
    try{shareCode=await SH.encode(e.level,e.proof);ta.value=shareCode;}catch(err){report('share.encode',err);ta.value='';toast('Couldn’t make a code for this level.');}}
  else{$('#sharemsg').textContent='Paste a level code someone shared with you.';ta.readOnly=false;ta.value='';$('#sharego .face').textContent='Open level';$('#sharelink').hidden=true;}
  tilt(el,'sharesheet');el.hidden=false;if(mode==='open')ta.focus();else ta.select();}
async function copyText(t){try{await navigator.clipboard.writeText(t);return true;}catch(e){const ta=$('#sharecode');ta.select();try{return document.execCommand('copy');}catch(_){return false;}}}
$('#sharego').onclick=async()=>{if(shareMode==='share'){if(shareCode)toast(await copyText(shareCode)?'Code copied.':'Select the code and copy it.');return;}openCode($('#sharecode').value);};
$('#sharelink').onclick=async()=>{if(!shareCode)return;const url=location.origin+location.pathname+'#play='+shareCode;toast(await copyText(url)?'Link copied.':'Couldn’t copy the link.');};
$('#sharedone').onclick=closeSheets;
// Open a code: check it, keep it on the Community shelf, and load it. The same code twice is the same level.
async function openCode(code){let res;try{res=await SH.decode(code);}catch(err){toast(err.message||'That code didn’t work.');return;}
  const id='c-'+SH.levelHash(res.level),old=got.find(e=>e.id===id)||featured.find(e=>e.id===id);
  if(!old){if(got.length>=100)got.pop();got.unshift({id,level:{...res.level,id},proof:res.proof,verified:!!res.verified.ok});saveGot();}
  closeSheets();setShelf('community');const i=list.findIndex(L=>L.id===id);if(i>=0)load(i);
  if(!res.verified.ok)slip(['Opened. Its maker’s clear couldn’t be checked on this device, so it may be unbeatable.'],{hold:3600});
  else slip([old?'You already have this level.':`Opened. Its maker cleared it${res.proof&&res.proof.t?` in ${fmtT(res.proof.t)} s`:''}.`],{hold:2600});}

// ---------- frame loop ----------
let last=performance.now(),bgT='';
function frame(now){const t=now/1000,dt=Math.min(.1,(now-last)/1000);last=now;
  stepRide(dt);
  g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.clearRect(0,0,fg.width,fg.height);
  if(S.level&&S.ink){g.save();g.setTransform(px,0,0,px,0,0);
    try{
      if(S.mode==='edit'||S.mode==='make'){const v=S.view;g.setTransform(px*v.k,0,0,px*v.k,-v.x*v.k*px,-v.y*v.k*px);
        if(side)side.draw(g,t);if(S.mode==='make'&&maker)maker.draw(g,t);}
      else if(swoop&&world&&ride)drawSwoop(t,now);
      else if(world&&ride){const out=ride.draw(g,world,S.level,S,t,dt);applyBgTransform(out);}
    }catch(e){report(swoop?'ride.drawTransition':S.mode==='edit'?'side.draw':'ride.draw',e);if(swoop)skipSwoop();}
    g.restore();}
  if(S.mode==='ride'&&running&&world)A('ride',world,dt);
  if(S.mode==='ride'&&S.trial&&world){const b=$('#clock b'),txt=fmtT(world.t+S.trial.offset);if(b.textContent!==txt)b.textContent=txt;}
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
    const sg=sideBuf.getContext('2d'),v=S.view;sg.setTransform(1,0,0,1,0,0);sg.clearRect(0,0,sideBuf.width,sideBuf.height);sg.setTransform(px*v.k,0,0,px*v.k,-v.x*v.k*px,-v.y*v.k*px);
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
const lastAt=store.get(KEY.last,null),lastRef=typeof lastAt==='string'?{shelf:'levels',id:lastAt}:lastAt||{shelf:'levels',id:null};
syncSettings();
{const sh=SHELVES.includes(lastRef.shelf)&&lastRef.shelf!=='make'?lastRef.shelf:'levels',at=listOf(sh).findIndex(l=>l.id===lastRef.id);
  const view=shelf;shelf=sh;list=listOf(sh);loadedShelf=sh;load(Math.max(0,at));if(view!==sh)setShelf(view);}
applySound();
// A shared link: …#play=RR1-… opens that level (and keeps it on the Community shelf).
{const m=location.hash.match(/play=(RR[01]-[A-Za-z0-9_-]+)/);if(m){history.replaceState(null,'',location.pathname+location.search);openCode(m[1]);}}
$('#board').addEventListener('wheel',e=>{const b=$('#board');if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&b.scrollWidth>b.clientWidth){b.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
requestAnimationFrame(frame);

// ---------- dev hook ----------
window.game={S,LEVELS,TRIALS,physics:P,share:SH,get maker(){return maker;},mine,got,setShelf,openMaker,openCode,testLevel,backToMaker,respawn,
  load,setItems(items){if(S.mode!=='edit')toEdit();S.items=cloneItems(items||[]);S.stroke=null;lastCleared=null;hist=[];lastLen=S.items.length;ui();saveDraft();},
  ride:startRide,edit:toEdit,get world(){return world;},panel:togglePanel,toast,
  // testing aid: advance the ride by `sec` of game time without waiting for frames (works in hidden tabs)
  skip:skipSwoop,get swoop(){return swoop&&{p:swoop.p,ms:swoop.ms};},renderers:()=>({side,ride,audio}),thumb:printThumb,
  advance(sec=1){if(swoop)skipSwoop();if(!running&&S.mode==='ride'&&countT.length){countT.forEach(clearTimeout);countT=[];$('#count').hidden=true;running=true;acc=0;jumpEdge=false;}for(let i=0;i<Math.round(sec/DT);i++){if(S.mode!=='ride'||!running)break;stepRide(DT);}return world&&{t:world.t,status:world.status};}};
