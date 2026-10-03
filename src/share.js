// share.js — custom levels as share codes, the clear check, and replays.
// Pure module (no DOM needed; CompressionStream when the browser has it), so tools can use it in node too.
//
// A share code is "RR1-" + base64url(deflate-raw(JSON)) of {v:1, level, proof}. Codes come from anyone, so
// decode() rebuilds the level from scratch through clean(): only known fields, finite numbers inside the
// course, capped list sizes and string lengths, known ink and scene names. Nothing from a code is ever
// put into the page as HTML (the app escapes names and hints).
//
// The clear check (contract v7): a level can only be shared once its maker has beaten it. The winning ride is
// kept as a proof: the drawing (items) plus every input of every physics step, and the steps at which the
// rider respawned at a checkpoint. The physics is deterministic, so replaying the proof wins again: that's
// how a received level is checked. (Browsers may differ in the last digit of Math.sin/exp; a proof that
// doesn't replay is reported as "not verified", never as a broken level.)
import * as P from './physics.js';

const MAX={poly:200,pts:64,line:600,items:80,checks:8,drops:12,boosts:40,name:32,hint:140,w:6400,steps:60*180};
export const SCENES=['woodblock','park','bauhaus','cutouts','orbits'];
export const PAPER_NAMES=['Natural','White','Cream','Kraft','Blush','Mint'];
const INK_NAMES=['Yellow','Sunflower','Orange','Fluorescent Pink','Bright Red','Red','Coral','Burgundy','Purple','Violet','Blue','Medium Blue',
  'Federal Blue','Aqua','Teal','Mint','Green','Hunter Green','Moss','Flat Gold','Brick','Light Gray','Black'];
const TOOLS=['line','wind','rope','sling'];

// ---------- cleaning ----------
const num=(v,a,b,d=a)=>{v=+v;return Number.isFinite(v)?Math.min(b,Math.max(a,Math.round(v*10)/10)):d;};
const str=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,n):'';
function pt(q,D){return Array.isArray(q)?[num(q[0],-80,D.w+80),num(q[1],-200,D.h+200)]:null;}
function pts(a,D,min,max){if(!Array.isArray(a))return null;const o=[];for(const q of a.slice(0,max)){const p=pt(q,D);if(p)o.push(p);}return o.length>=min?o:null;}
function list(a,max,f){return Array.isArray(a)?a.slice(0,max).map(f).filter(Boolean):[];}
function item(it,D){if(!it||typeof it!=='object')return null;
  if(it.type==='line'||it.type==='wind'){const p=pts(it.pts,D,2,MAX.line);return p&&{type:it.type,pts:p};}
  if(it.type==='rope'){const a=pt(it.a,D),b=pt(it.b,D);return a&&b&&Math.hypot(b[0]-a[0],b[1]-a[1])>=10?{type:'rope',a,b}:null;}
  if(it.type==='sling')return{type:'sling',x:num(it.x,0,D.w),y:num(it.y,0,D.h),a:Math.round(num(it.a,-7,7,0)*1e4)/1e4};
  return null;}
const inkOk=c=>typeof c==='string'&&(INK_NAMES.includes(c)||/^#[0-9a-fA-F]{6}$/.test(c));
// A level built only from what it should have. Returns null if it can't be played at all.
export function clean(src){if(!src||typeof src!=='object')return null;
  const trial=src.mode==='trial',D={w:trial?num(src.w,800,MAX.w,2400):P.W,h:P.H};
  const L={mode:trial?'trial':'puzzle',name:str(src.name,MAX.name)||'Untitled',hint:str(src.hint,MAX.hint)};
  if(trial){L.w=D.w;L.h=D.h;}
  const bg=src.bg||{},inks=Array.isArray(bg.inks)&&bg.inks.length===3&&bg.inks.every(inkOk)?bg.inks.slice():['Sunflower','Orange','Federal Blue'];
  L.bg={scene:SCENES.includes(bg.scene)?bg.scene:'park',seed:num(bg.seed,1,9999,1)|0,inks};
  if(PAPER_NAMES.includes(bg.paper)&&bg.paper!=='Natural')L.bg.paper=bg.paper;
  L.tools=trial?[]:[...new Set(list(src.tools,4,t=>TOOLS.includes(t)&&t))];
  L.ink=trial?0:num(src.ink,0,5000,600)|0;
  const par=Array.isArray(src.par)?src.par:[];L.par=trial?[0,0]:[num(par[0],0,L.ink,L.ink)|0,num(par[1],0,L.ink,L.ink)|0];if(L.par[0]>L.par[1])L.par[1]=L.par[0];
  const s=src.start||{},g=src.goal||{};
  L.start={x:num(s.x,0,D.w,30),y:num(s.y,0,D.h,100),vx:num(s.vx,-400,400,150)};
  L.goal={x:num(g.x,0,D.w,D.w-60),y:num(g.y,0,D.h,300),r:num(g.r,18,60,26)};
  const poly=p=>pts(p,D,3,MAX.pts);
  L.blocks=list(src.blocks,MAX.poly,poly);L.ice=list(src.ice,MAX.poly,poly);L.crumble=list(src.crumble,MAX.poly,poly);
  L.hazards=list(src.hazards,MAX.poly,p=>pts(p,D,2,MAX.pts));
  L.boosts=list(src.boosts,MAX.boosts,b=>{const a=b&&pt(b.a,D),c=b&&pt(b.b,D);return a&&c?{a,b:c}:null;});
  L.drops=trial?[]:list(src.drops,MAX.drops,d=>d&&{x:num(d.x,0,D.w),y:num(d.y,0,D.h),z:num(d.z,-60,60,0),v:[15,25,40].includes(+d.v)?+d.v:25});
  L.fixed=list(src.fixed,MAX.items,it=>item(it,D));
  L.checks=trial?list(src.checks,MAX.checks,c=>c&&{x:num(c.x,0,D.w),y:num(c.y,0,D.h),r:num(c.r,20,50,30)}):[];
  if(trial){const m=src.medals||{};L.medals={};for(const k of['author','gold','silver','bronze'])if(Number.isFinite(+m[k])&&m[k]>0)L.medals[k]=Math.round(+m[k]*100)/100;
    L.maxT=num(src.maxT,30,180,90);}
  if(!L.blocks.length&&!L.ice.length&&!L.crumble.length&&!L.fixed.length)return null;
  return L;}
export const cleanItems=(a,L)=>list(a,MAX.items,it=>item(it,P.dims(L)));

// The gameplay of a level, in a fixed key order, so the same level always hashes the same.
const PLAY=['mode','w','h','tools','ink','start','goal','blocks','ice','crumble','hazards','boosts','drops','fixed','checks'];
export function playKey(L){return JSON.stringify(PLAY.map(k=>L[k]??null));}
export function hash(s){let h1=0x811c9dc5,h2=0x9e3779b9;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,16777619);h2=Math.imul(h2^c,2246822519);}
  return((h1>>>0).toString(36)+(h2>>>0).toString(36)).slice(0,12);}
export const levelHash=L=>hash(playKey(L));

// ---------- inputs: recorded per physics step, replayed exactly ----------
// Analog values are quantized to 1/32 (the app feeds the same quantized input to the live ride).
export const q32=v=>Math.round(Math.max(-1,Math.min(1,v||0))*32)/32;
export const packInput=inp=>[Math.round(q32(inp.steer)*32),Math.round(q32(inp.push)*32),(inp.jump?1:0)|(inp.jumpHeld?2:0)];
const unpack=a=>({steer:a[0]/32,push:a[1]/32,jump:!!(a[2]&1),jumpHeld:!!(a[2]&2)});
// run-length: [count, steer, push, flags, count, …]
export function rle(steps){const o=[];for(const s of steps){const n=o.length;if(n&&o[n-3]===s[0]&&o[n-2]===s[1]&&o[n-1]===s[2])o[n-4]++;else o.push(1,s[0],s[1],s[2]);}return o;}
function unrle(a){const o=[];if(!Array.isArray(a))return o;for(let i=0;i+3<a.length&&o.length<MAX.steps;i+=4){const n=Math.min(+a[i]|0,MAX.steps-o.length);const s=[a[i+1]|0,a[i+2]|0,a[i+3]&3];for(let k=0;k<n;k++)o.push(s);}return o;}

// A ride you can step one input at a time. Respawning at the last checkpoint is part of the ride (time trials):
// the world after the step that passed a checkpoint is kept, and a respawn restores a copy of it.
export function rider(L,items,assist=0){const w0=P.build(L,items,{assist});const r={world:w0,snap:null,offset:0,n:0,
  step(inp){const w=r.world,ev=w.events.length;P.step(w,L,inp);r.n++;
    for(let i=ev;i<w.events.length;i++)if(w.events[i].type==='check'){r.snap=P.cloneWorld(w);break;}},
  // returns false if there's no checkpoint to go back to
  respawn(){if(!r.snap)return false;r.offset+=r.world.t-r.snap.t;r.world=P.cloneWorld(r.snap);return true;},
  get time(){return r.world.t+r.offset;}};return r;}

// Replay a proof: {items, assist, steps (rle), respawns:[step index…]} → {ok, t}
export function replay(L,proof){try{if(!proof||(proof.assist|0)===2)return{ok:false};
  const items=cleanItems(proof.items||[],L),steps=unrle(proof.steps),rs=new Set((proof.respawns||[]).map(n=>n|0)),R=rider(L,items,proof.assist===1?1:0);
  // the drawing must be one the player could make: the level's tools, within its ink, no sling on the ring
  if(items.some(it=>!L.tools.includes(it.type)||(it.type==='sling'&&Math.hypot(it.x-L.goal.x,it.y-L.goal.y)<80))||P.inkUsed(items)>L.ink+1e-6)return{ok:false};
  for(let i=0;i<steps.length;i++){if(rs.has(i))R.respawn();if(R.world.status!=='run')break;R.step(unpack(steps[i]));}
  return{ok:R.world.status==='win',t:Math.round(R.time*100)/100,ink:Math.round(P.inkUsed(items)),refund:Math.round(R.world.refund||0)};}catch(e){return{ok:false};}}

// ---------- codes ----------
const b64u={enc(bytes){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');},
  dec(t){t=t.replace(/-/g,'+').replace(/_/g,'/');while(t.length%4)t+='=';const s=atob(t),o=new Uint8Array(s.length);for(let i=0;i<s.length;i++)o[i]=s.charCodeAt(i);return o;}};
async function pipe(bytes,stream){const r=new Blob([bytes]).stream().pipeThrough(stream);return new Uint8Array(await new Response(r).arrayBuffer());}
const canZip=()=>typeof CompressionStream==='function'&&typeof DecompressionStream==='function';
// Share fields only: the level as clean() reads it, and the proof.
export async function encode(L,proof){const lv=clean(L);if(!lv)throw new Error('empty level');
  const json=JSON.stringify({v:1,level:lv,proof:proof?{items:proof.items,assist:proof.assist|0,steps:proof.steps,respawns:proof.respawns||[],t:proof.t}:null});
  const raw=new TextEncoder().encode(json);
  if(canZip())return'RR1-'+b64u.enc(await pipe(raw,new CompressionStream('deflate-raw')));
  return'RR0-'+b64u.enc(raw);}
// → {level, proof, verified:{ok,t}} or throws with a plain message
export async function decode(code){code=String(code||'').trim();const m=code.match(/RR([01])-([A-Za-z0-9_-]{8,})/);if(!m)throw new Error('That doesn’t look like a level code.');
  if(m[2].length>400000)throw new Error('That code is too long.');
  let bytes;try{bytes=b64u.dec(m[2]);}catch(e){throw new Error('That code is damaged.');}
  if(m[1]==='1'){if(!canZip())throw new Error('This browser can’t open level codes.');try{bytes=await pipe(bytes,new DecompressionStream('deflate-raw'));}catch(e){throw new Error('That code is damaged.');}}
  if(bytes.length>2e6)throw new Error('That code is too long.');
  let o;try{o=JSON.parse(new TextDecoder().decode(bytes));}catch(e){throw new Error('That code is damaged.');}
  const level=clean(o&&o.level);if(!level)throw new Error('That code has no level in it.');
  const pr=o.proof&&typeof o.proof==='object'?{items:cleanItems(o.proof.items||[],level),assist:o.proof.assist===1?1:0,steps:Array.isArray(o.proof.steps)?o.proof.steps.slice(0,MAX.steps*4).map(v=>v|0):[],
    respawns:Array.isArray(o.proof.respawns)?o.proof.respawns.slice(0,500).map(v=>v|0):[],t:Number.isFinite(+o.proof.t)?Math.min(999,Math.max(0,Math.round(o.proof.t*100)/100)):0}:null;
  return{level,proof:pr,verified:pr?replay(level,pr):{ok:false}};}
