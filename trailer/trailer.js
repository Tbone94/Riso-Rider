// trailer.js — the Riso Rider promo trailer, rendered offline from the game's own renderers.
// Every shot is real gameplay: side.js draws the sheet, ride.js draws the ride and the swoop,
// physics.js rides the known solutions. The trailer adds framing, captions, music and an encoder.
//   #sheet          render everything, upload a contact sheet (one thumbnail every 0.5 s)
//   #frames=a,b,c   upload full frames at those times (seconds)
//   #render         encode the MP4 (H.264 1080p60 + AAC) and upload it
//   #look=id,sol,t… audition a level: its solved sheet plus ride frames at those ride times
//   #probe=id,sol,t… ride frames only
//   add &fp to any of them for the first-person camera; the default is the game's Chase camera (the ball visible)
// Run: python3 tools/serve.py 5173 (or the "static" launch config) and python3 trailer/receiver.py trailer/out,
// then open http://localhost:5173/trailer/index.html#render in a Chromium with WebCodecs H.264 (the Claude app's browser works).
import * as P from '../src/physics.js';
import {LEVELS,CHAPTERS} from '../src/levels.js';
import {createSide} from '../src/side.js';
import {createRide} from '../src/ride.js';
import {createAudio} from '../src/audio.js';

const FW=1920,FH=1080,FPS=60,DTF=1/FPS;
const GW=1920,GH=1200,PX=GW/P.W;              // the game sheet, 16:10, rendered at 2.4 px per design unit
const TAU=Math.PI*2;
const UPLOAD='http://127.0.0.1:5199/upload';
const STENCIL='"Big Shoulders Stencil Display"',MONO='"Cutive Mono"';
const PAPER='#f2ede3';
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,k)=>a+(b-a)*k;
const ease=k=>k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
const easeOut=k=>1-Math.pow(1-k,3);
const hex=n=>Riso.INKS[n]||n;
const cv=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const status=s=>{$('#status').textContent=s;};
function mulHex(a,b){const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return'#'+A.map((v,i)=>Math.round(v*B[i]/255).toString(16).padStart(2,'0')).join('');}
function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const inksOf=L=>({light:hex(L.bg.inks[0]),mid:hex(L.bg.inks[1]),key:hex(L.bg.inks[2])});

// ---------- canvases ----------
const out=cv(FW,FH),ox=out.getContext('2d');          // the video frame
const scr=cv(GW,GH),sx=scr.getContext('2d');          // the game sheet (backdrop + multiplied plate)
const fg=cv(GW,GH),g=fg.getContext('2d');             // the game plate (what #fg is in the game)
const sideBuf=cv(GW,GH),sbx=sideBuf.getContext('2d');
const lay=cv(FW,FH),lx=lay.getContext('2d');          // caption layer (stamped, then multiplied)
const view=$('#view'),vx=view.getContext('2d');
let DRY=false;                                        // physics + sound only, no pixels
const CHASE=!/[&,]fp/.test(location.hash);             // the game's chase camera (the ball visible on the road); #…&fp = first person
const HASH=location.hash.replace(/[&,]fp/,'');

// the game's speckle: random pixels knocked out of the plate
const speck=(()=>{const c=cv(GW,GH),x=c.getContext('2d'),id=x.createImageData(GW,GH),d=id.data,r=rng(7);
  for(let i=3;i<d.length;i+=4)d[i]=r()<.18?60+r()*150:0;x.putImageData(id,0,0);return c;})();
// starved stamp ink: small specks punched out of every caption
const inkMask=(()=>{const c=cv(256,256),x=c.getContext('2d'),r=rng(3);x.fillStyle='#000';
  for(let i=0;i<900;i++){const s=r()<.8?1.2:2.4;x.globalAlpha=.5+r()*.5;x.fillRect(r()*256,r()*256,s,s);}return ox.createPattern(c,'repeat');})();
// the desk: paper with grain
const desk=(()=>{const c=cv(FW,FH),x=c.getContext('2d'),r=rng(11);x.fillStyle=PAPER;x.fillRect(0,0,FW,FH);
  const id=x.getImageData(0,0,FW,FH),d=id.data;for(let i=0;i<d.length;i+=4){const n=(r()-.5)*14+(r()<.02?-22:0);d[i]+=n;d[i+1]+=n;d[i+2]+=n;}
  x.putImageData(id,0,0);return c;})();

// ---------- printing (once per level) ----------
const prints=new Map();
const tick=()=>new Promise(r=>setTimeout(r,0));
// Hero levels (ridden or shown big) get full-size side and ride prints; the rest only appear small in the
// fifty-sheet deal, so they get a smaller side print and no ride print (printing all 50 at full size takes ~10 min).
function printNow(L,hero=true){const had=prints.get(L.id);if(had&&(had.ride||!hero))return had;
  const w=hero?1600:1100,h=w*10/16,img=Riso.printSideBackdrop(L.bg,w,h),side=cv(w,h);side.getContext('2d').putImageData(img,0,0);
  const pr={side,ride:hero?createRide().printBackdrop(L,1600,1000):null};prints.set(L.id,pr);return pr;}
// Printed on first use, so a spot check of a few frames only prints the levels it shows.
const HERO=new Set(['orrery','first-line','the-wall','canyon','bank-shot','chimney','keyhole','ski-jump','afterburner','cavern','crossroads','floor-gives-way','low-ceiling','last-proof']);
const DEAL=Array.from({length:8},(_,j)=>Math.round(j*(LEVELS.length-1)/7));   // the sheets dealt onto the desk (level indexes)
const printOf=(L,ride=false)=>printNow(L,ride||HERO.has(L.id));
async function printLevel(L,hero=true){if(prints.has(L.id))return;status(`printing ${L.name}…`);await tick();printNow(L,hero);}

// ---------- the sound log: every game sound, stamped with trailer time ----------
let T=0;                                    // trailer time of the frame being made
const STAMPED=new Set();                    // captions already given their stamp sound
const LOG=[];
const sfx=(name,...args)=>LOG.push({t:T,name,args});
let RID=0;
function snap(w,id){const r=w.rider,p=w.path[w.path.length-1];
  return{id,rider:{speed:r.speed,grounded:r.grounded,surface:r.surface,groundKind:r.groundKind,sway:r.sway,boost:r.boost,inWind:r.inWind,vx:r.vx,vy:r.vy},
    ps:p?p[3]:0,ropes:w.ropes.map(q=>({side:q.side,depth:q.depth})),crumbles:(w.crumbles||[]).map(c=>({touchedAt:c.touchedAt,gone:c.gone}))};}

// ---------- a shot: one level, its state S, and the game's two renderers ----------
function pats(ink){const dot=(color,step,rad)=>{const c=cv(step*2,step*2),x=c.getContext('2d');x.fillStyle=color;
  [[step/2,step/2],[step*1.5,step*1.5]].forEach(([a,b])=>{x.beginPath();x.arc(a,b,rad,0,TAU);x.fill();});return g.createPattern(c,'repeat');};
  return{light:dot(ink.light,7,1.9),lightDense:dot(ink.light,6,2.4),mid:dot(ink.mid,6,1.7),key:dot(ink.key,5,1.6)};}
class Shot{
  constructor(li,items=[]){const L=this.L=LEVELS[li];this.li=li;const ink=inksOf(L);
    this.S={li,level:L,items:JSON.parse(JSON.stringify(items)),tool:L.tools[0],mode:'edit',stroke:null,ink,pat:pats(ink),ghost:null,falls:0,
      settings:{fov:90,bob:false,chase:CHASE,reducedMotion:false,assist:0}};
    this.side=createSide({canvas:cv(10,10),getState:()=>this.S,hooks:{}});
    this.ride=createRide();this.world=null;this.pen=null;}
  get ink(){return this.S.ink;}
  startRide(policy='auto'){this.policy=policy;this.world=P.build(this.L,this.S.items,{assist:0});this.S.mode='ride';this.S.stroke=null;this.pen=null;
    this.ride.reset(this.world,this.L,this.S);this.ev=0;this.rid=++RID;this.stopped=false;}
  step(quiet=false){const w=this.world;
    if(w.status==='run'){const inp=this.policy==='auto'?P.autopilot(w,this.L,{drops:true}):this.policy==='none'?P.NO_INPUT:this.policy(w);P.step(w,this.L,inp);}
    while(this.ev<w.events.length){const e=w.events[this.ev++];if(!quiet)sfx('event',{...e});}
    if(quiet)return;
    if(w.status==='run')sfx('ride',snap(w,this.rid),DTF);else if(!this.stopped){this.stopped=true;sfx('stopRide');}}
  // run the ride forward to `sec` without sound; the camera is kept warm by drawing into the plate
  preroll(sec){const n=Math.round(sec*FPS);for(let i=0;i<n;i++){this.step(true);if(!DRY&&(n-i)<=40){plate();this.ride.draw(g,this.world,this.L,this.S,i*DTF,DTF);}}
    if(!DRY)this.ride.draw(g,this.world,this.L,this.S,n*DTF,DTF);}
  sideBg(a=1){sx.globalAlpha=a;sx.drawImage(printOf(this.L).side,0,0,GW,GH);sx.globalAlpha=1;}
  rideBg(b,a=1){const pr=printOf(this.L,true).ride;sx.save();sx.globalAlpha=a;
    sx.translate(GW/2+(b&&+b.x||0)*PX,GH/2+(b&&+b.y||0)*PX);sx.scale(b&&+b.scale||1,b&&+b.scale||1);if(b&&b.rot)sx.rotate(b.rot*Math.PI/180);
    sx.drawImage(pr,-GW/2,-GH/2,GW,GH);sx.restore();}
  drawSide(t){if(DRY)return;plate();try{this.side.draw(g,t);}catch(e){console.error(e);}
    if(this.pen)pencil(g,this.pen,this.ink);finishPlate();
    sx.fillStyle=PAPER;sx.fillRect(0,0,GW,GH);this.sideBg();multiplyPlate();}
  drawRide(t,dt=DTF){if(DRY)return;plate();const o=this.ride.draw(g,this.world,this.L,this.S,t,dt)||{};finishPlate();
    sx.fillStyle=PAPER;sx.fillRect(0,0,GW,GH);this.rideBg(o.bg);multiplyPlate();}
  // the side view with the ride in progress on it: a dotted ink trail and the rider where it is now
  drawSideLive(t){if(DRY)return;plate();this.liveSide(g,t);finishPlate();sx.fillStyle=PAPER;sx.fillRect(0,0,GW,GH);this.sideBg();multiplyPlate();}
  liveSide(c,t){const S=this.S,L=S.level;S.level={...L,start:{...L.start,x:-900,y:-900}};   // hide the parked rider at the start
    try{this.side.draw(c,t);}catch(e){console.error(e);}S.level=L;if(this.world)liveRider(c,this.world,this.ink);}
  drawSwoop(t,p,live=false){sfx('transition',p);if(DRY)return;plate();
    const o=this.ride.drawTransition(g,this.world,this.L,this.S,t,p)||{};
    const sa=clamp(o.sideAlpha!=null?+o.sideAlpha:1-p,0,1),ra=clamp(o.rideBgAlpha!=null?+o.rideBgAlpha:p,0,1);
    if(sa>.004){sbx.setTransform(1,0,0,1,0,0);sbx.clearRect(0,0,GW,GH);sbx.setTransform(PX,0,0,PX,0,0);if(live)this.liveSide(sbx,t);else try{this.side.draw(sbx,t);}catch(e){console.error(e);}
      g.save();g.setTransform(1,0,0,1,0,0);g.globalAlpha=sa;g.drawImage(sideBuf,0,0);g.restore();}
    finishPlate();sx.fillStyle=PAPER;sx.fillRect(0,0,GW,GH);this.sideBg(1-ra);this.rideBg(o.bg,ra);multiplyPlate();}
}
function plate(){g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.clearRect(0,0,GW,GH);g.setTransform(PX,0,0,PX,0,0);}
function finishPlate(){g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='destination-out';g.drawImage(speck,0,0);g.globalCompositeOperation='source-over';}
function multiplyPlate(){sx.globalCompositeOperation='multiply';sx.drawImage(fg,0,0);sx.globalCompositeOperation='source-over';}

// The ride so far on the side view (design units): a dotted mid-ink trail and the rider as the sheet prints it.
function liveRider(c,w,ink){const PT=w.path,r=w.rider;c.save();c.lineCap='round';c.lineJoin='round';
  if(PT.length>1){c.strokeStyle=ink.mid;c.lineWidth=2.6;c.setLineDash([1,6]);c.beginPath();PT.forEach((q,i)=>c[i?'lineTo':'moveTo'](q[0],q[1]));c.lineTo(r.x,r.y);c.stroke();c.setLineDash([]);}
  c.fillStyle=ink.mid;c.beginPath();c.arc(r.x,r.y,P.R,0,TAU);c.fill();c.strokeStyle=ink.key;c.lineWidth=2;c.beginPath();c.arc(r.x+1.4,r.y-1,P.R,0,TAU);c.stroke();
  c.fillStyle=ink.key;c.beginPath();c.arc(r.x+Math.cos(r.a-.5)*4.5,r.y+Math.sin(r.a-.5)*4.5,1.8,0,TAU);c.fill();c.restore();}
// A pencil in the key ink, its nib on the pen point (design units).
function pencil(c,[x,y],ink){c.save();c.translate(x,y);c.rotate(-.62);c.lineJoin='round';
  c.fillStyle=ink.mid;c.beginPath();c.moveTo(1.5,-1);c.lineTo(15,-6);c.lineTo(62,-6);c.lineTo(62,6);c.lineTo(15,6);c.closePath();c.fill();
  c.fillStyle=ink.key;c.beginPath();c.moveTo(0,0);c.lineTo(13,-5.5);c.lineTo(13,5.5);c.closePath();c.fill();
  c.strokeStyle=ink.key;c.lineWidth=1.6;c.beginPath();c.rect(13,-5.5,48,11);c.moveTo(13,0);c.lineTo(61,0);c.stroke();
  c.fillStyle=ink.light;c.fillRect(61,-5.5,9,11);c.strokeRect(61,-5.5,9,11);c.restore();}

// ---------- drawing a solution by hand (with the pen sounds) ----------
function dens(pts,step=4){const o=[pts[0]];for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.round(l/step));
  for(let k=1;k<=n;k++)o.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);}return o;}
// plan: [{item,t0,t1}] — each item is drawn between t0 and t1 (a well is dropped at t0)
function drawPlan(shot,plan,lt){const S=shot.S;shot.pen=null;
  for(const st of plan){const it=st.item;st.state=st.state||0;
    if(it.type==='well'||it.type==='sling'){   // dropped at t0; a sling then swings round to its aim over 0.3 s
      if(st.state===0&&lt>=st.t0){st.state=1;S.tool=it.type;S.items.push(JSON.parse(JSON.stringify(it)));st.idx=S.items.length-1;sfx('draw',it.type,'start',0);}
      if(st.state===1&&it.type==='sling'){const k=easeOut(clamp((lt-st.t0)/.3,0,1));S.items[st.idx].a=it.a+(1-k)*-1.4;if(k>=1)st.state=2;}else if(st.state===1)st.state=2;
      if(lt>=st.t0-.25&&lt<st.t0+.12)shot.pen=[it.x,it.y-(lt<st.t0?(st.t0-lt)*60:0)];continue;}
    if(st.state===2||lt<st.t0)continue;
    const k=ease(clamp((lt-st.t0)/(st.t1-st.t0),0,1));
    if(st.state===0){st.state=1;S.tool=it.type;sfx('draw',it.type,'start',0);st.last=null;}
    let pen;
    if(it.type==='rope'){const b=[lerp(it.a[0],it.b[0],k),lerp(it.a[1],it.b[1],k)];S.stroke={type:'rope',a:it.a.slice(),b};pen=b;}
    else{const d=st.d||(st.d=dens(it.pts)),n=k*(d.length-1),i=Math.floor(n),f=n-i,p=i+1<d.length?[lerp(d[i][0],d[i+1][0],f),lerp(d[i][1],d[i+1][1],f)]:d[i];
      S.stroke={type:it.type,pts:[...d.slice(0,i+1),p]};pen=p;}
    const sp=st.last?Math.hypot(pen[0]-st.last[0],pen[1]-st.last[1])*FPS:0;st.last=pen;sfx('draw',it.type,'move',sp);shot.pen=pen;
    if(k>=1){st.state=2;S.stroke=null;S.items.push(JSON.parse(JSON.stringify(it)));sfx('draw',it.type,'end',0);}}}

// ---------- framing: the sheet on the desk ----------
const SIDE={cx:1150,cy:560,s:.74,rot:0},FULL={cx:960,cy:480,s:1,rot:0};
const mixLay=(a,b,k)=>({cx:lerp(a.cx,b.cx,k),cy:lerp(a.cy,b.cy,k),s:lerp(a.s,b.s,k),rot:lerp(a.rot||0,b.rot||0,k)});
function place(src,L,{marks=true,alpha=1}={}){ox.save();ox.globalAlpha=alpha;ox.translate(L.cx,L.cy);ox.rotate(L.rot||0);ox.scale(L.s,L.s);
  ox.drawImage(src,-GW/2,-GH/2);ox.restore();
  if(marks&&L.s<.97){const w=GW*L.s/2,h=GH*L.s/2,c=Math.cos(L.rot||0),s=Math.sin(L.rot||0);
    for(const[a,b]of[[-1,-1],[1,-1],[-1,1],[1,1]]){const px=a*(w+22),py=b*(h+22);regMark(L.cx+px*c-py*s,L.cy+px*s+py*c,11,curInk.key);}}}
function regMark(x,y,r,col){ox.save();ox.strokeStyle=col;ox.globalAlpha=.85;ox.lineWidth=2;ox.beginPath();ox.arc(x,y,r*.62,0,TAU);
  ox.moveTo(x-r,y);ox.lineTo(x+r,y);ox.moveTo(x,y-r);ox.lineTo(x,y+r);ox.stroke();ox.restore();}
let curInk={light:'#ffb511',mid:'#ff6c2f',key:'#3d5588'};
function deskBg(){ox.setTransform(1,0,0,1,0,0);ox.globalAlpha=1;ox.globalCompositeOperation='source-over';ox.filter='none';ox.drawImage(desk,0,0);}
// the level's slug line above the sheet, the wordmark, and the ink meter below it
function sheetFurniture(shot,alpha=1){if(alpha<=0)return;const L=shot.L,ink=shot.ink;ox.save();ox.globalAlpha=alpha;
  ox.fillStyle=ink.key;ox.font=`24px ${MONO}`;ox.textBaseline='alphabetic';ox.textAlign='left';
  ox.fillText(`LEVEL ${String(shot.li+1).padStart(2,'0')} · ${L.name.replace(/ \(prototype\)/,'').toUpperCase()}`,440,92);
  ox.textAlign='right';ox.font=`900 40px ${STENCIL}`;ox.letterSpacing='3px';ox.fillStyle=ink.mid;ox.fillText('RISO RIDER',1863,94);ox.fillStyle=ink.key;ox.fillText('RISO RIDER',1860,92);ox.letterSpacing='0px';
  // ink meter: the colour bar, emptying right to left
  const S=shot.S,used=P.inkUsed(S.items)+(S.stroke?P.itemCost(S.stroke):0),left=clamp(1-used/L.ink,0,1),x0=440,x1=1560,y=1030,h=22,n=34;
  const cyc=[ink.key,mulHex(ink.mid,ink.key),ink.mid,mulHex(ink.light,ink.mid),ink.light,mulHex(ink.light,ink.key)],w=(x1-x0)/n;
  for(let i=0;i<n;i++){const a=x0+i*w,full=(i+1)/n<=left+1e-6||a<x0+(x1-x0)*left;
    if(full){ox.fillStyle=cyc[i%6];ox.fillRect(a,y,w-2,h);}else{ox.strokeStyle=ink.key;ox.lineWidth=1.2;ox.setLineDash([3,3]);ox.strokeRect(a+.5,y+.5,w-3,h-1);ox.setLineDash([]);}}
  for(const[k,lab]of[[L.par[0],'★★★'],[L.par[1],'★★']]){const tx=x0+(x1-x0)*(1-k/L.ink);ox.strokeStyle=ink.key;ox.lineWidth=2;ox.beginPath();ox.moveTo(tx,y-8);ox.lineTo(tx,y+h+8);ox.stroke();
    ox.fillStyle=ink.key;ox.font=`800 16px ${STENCIL}`;ox.textAlign='center';ox.fillText(lab,tx,y-11);}
  const st=P.stars(L,used);ox.textAlign='left';ox.font=`900 26px ${STENCIL}`;ox.letterSpacing='2px';ox.fillStyle=ink.key;ox.fillText('INK',1590,y+20);ox.letterSpacing='0px';
  ox.font=`24px ${MONO}`;ox.fillText(`${Math.max(0,Math.round(L.ink-used))} left ${'★'.repeat(st)}${'☆'.repeat(3-st)}`,1648,y+20);
  ox.restore();}

// ---------- captions: stamped in stencil, typed in mono ----------
// age: seconds since it was stamped (<0 = not yet). The stamp lands with a 2-frame hold (bigger, darker).
function stampText(text,x,y,o={}){const{size=130,ink=curInk,age=1,rot=0,align='left',maxW=0,frame=false,alpha=1,spacing=.03,off=.035,base='alphabetic',paperBack=0,solid=0}=o;
  if(age>=0&&age<DTF*1.5&&size>=130&&!o.mute){const key=text+'@'+Math.round((T-age)*30);if(!STAMPED.has(key)){STAMPED.add(key);sfx('stamp',1);}}
  if(age<0||DRY)return;
  lx.setTransform(1,0,0,1,0,0);lx.globalCompositeOperation='source-over';lx.globalAlpha=1;lx.clearRect(0,0,FW,FH);
  let sz=size;lx.font=`900 ${sz}px ${STENCIL}`;lx.letterSpacing=`${sz*spacing}px`;
  if(maxW){const w=lx.measureText(text).width;if(w>maxW){sz*=maxW/w;lx.font=`900 ${sz}px ${STENCIL}`;lx.letterSpacing=`${sz*spacing}px`;}}
  const down=age<2/FPS;lx.translate(x,y);lx.rotate(rot);if(down)lx.scale(1.05,1.05);
  lx.textAlign=align;lx.textBaseline=base;
  const m=lx.measureText(text),w=m.width,asc=m.actualBoundingBoxAscent,des=m.actualBoundingBoxDescent;
  const bx=align==='center'?-w/2:align==='right'?-w:0;
  const pad=sz*.2;
  if(frame||paperBack){
    if(paperBack){lx.fillStyle=PAPER;lx.globalAlpha=paperBack;lx.fillRect(bx-pad,-asc-pad,w+pad*2,asc+des+pad*2);lx.globalAlpha=1;}
    if(frame){lx.strokeStyle=ink.key;lx.lineWidth=sz*.035;for(const e of[0,sz*.075])lx.strokeRect(bx-pad+e,-asc-pad+e,w+pad*2-2*e,asc+des+pad*2-2*e);}}
  lx.fillStyle=ink.mid;lx.fillText(text,sz*off,sz*off*.75);lx.fillStyle=ink.key;lx.fillText(text,0,0);
  lx.setTransform(1,0,0,1,0,0);lx.globalCompositeOperation='destination-out';lx.fillStyle=inkMask;lx.fillRect(0,0,FW,FH);lx.globalCompositeOperation='source-over';
  if(solid){ox.save();ox.setTransform(1,0,0,1,0,0);ox.translate(x,y);ox.rotate(rot);if(down)ox.scale(1.05,1.05);ox.globalAlpha=alpha*solid;ox.fillStyle=PAPER;
    ox.fillRect(bx-pad,-asc-pad,w+pad*2,asc+des+pad*2);ox.globalAlpha=alpha*solid*.55;ox.strokeStyle=ink.key;ox.lineWidth=2;ox.strokeRect(bx-pad,-asc-pad,w+pad*2,asc+des+pad*2);ox.restore();}
  ox.save();ox.setTransform(1,0,0,1,0,0);ox.globalAlpha=alpha;ox.globalCompositeOperation='multiply';if(down)ox.filter='brightness(.62) saturate(1.4)';ox.drawImage(lay,0,0);ox.restore();}
function typeText(text,x,y,{size=34,color=curInk.key,progress=1,align='left',alpha=1,bg=0}={}){if(DRY||progress<=0)return;
  const s=text.slice(0,Math.ceil(text.length*clamp(progress,0,1)));ox.save();ox.globalAlpha=alpha;ox.font=`${size}px ${MONO}`;ox.textAlign=align;ox.textBaseline='alphabetic';
  if(bg){const w=ox.measureText(text).width,bx=align==='center'?x-w/2:align==='right'?x-w:x;ox.fillStyle=PAPER;ox.globalAlpha=alpha*bg;ox.fillRect(bx-14,y-size*.95,w+28,size*1.35);ox.globalAlpha=alpha;}
  ox.fillStyle=color;ox.fillText(s,x,y);ox.restore();}
const typeP=(lt,t0,chars,cps=38)=>(lt-t0)*cps/Math.max(1,chars);

// ---------- win stamp (the game's CLEARED! stamp) ----------
function starPath(c,x,y,r){c.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.45:r;c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}c.closePath();}
function cleared(lt,t0,stars,ink,cx=960,cy=440){if(lt<t0)return;const a=lt-t0;
  if(!DRY){ox.save();ox.fillStyle=PAPER;ox.globalAlpha=.5;ox.fillRect(0,0,FW,FH);ox.restore();}
  stampText('CLEARED!',cx,cy,{size:230,ink,age:a,rot:-.12,align:'center',frame:true,spacing:.06,off:.04,base:'middle',mute:true});
  for(let i=0;i<3;i++){const ta=a-.38-i*.3;if(ta<0)continue;const down=ta<2/FPS,x=cx-190+i*190,y=cy+250+[-8,6,-2][i],r=down?74:70;
    ox.save();ox.translate(x,y);ox.rotate([-.14,.07,-.05][i]);if(down)ox.filter='brightness(.62)';ox.globalCompositeOperation='multiply';
    if(i<stars){ox.fillStyle=ink.mid;starPath(ox,0,0,r);ox.fill();ox.strokeStyle=ink.key;ox.lineWidth=5;starPath(ox,5,-4,r);ox.stroke();}
    else{ox.setLineDash([8,8]);ox.strokeStyle=ink.key;ox.lineWidth=4;starPath(ox,0,0,r);ox.stroke();}ox.restore();}}

// ---------- the fail slip (the game's toast), dropped from the sheet's top edge ----------
const MARK={fall:c=>{c.moveTo(15,3);c.lineTo(15,20);c.moveTo(8,13);c.lineTo(15,21);c.lineTo(22,13);},
  pop:c=>{for(const[a,b,e,f]of[[15,3,15,8],[15,18,15,23],[5,13,10,13],[20,13,25,13],[8,6,11.5,9.5],[22,6,18.5,9.5],[8,20,11.5,16.5],[22,20,18.5,16.5]]){c.moveTo(a,b);c.lineTo(e,f);}},
  stuck:c=>{c.moveTo(10,6);c.lineTo(10,20);c.moveTo(20,6);c.lineTo(20,20);}};
function slip(lines,mark,ink,cx=1150,top=116,k=1){if(DRY)return;const w=820,h=128,y=top-h*(1-easeOut(k));ox.save();
  ox.beginPath();ox.rect(cx-w/2-40,top,w+80,h+40);ox.clip();
  ox.fillStyle='#fbfaf7';ox.beginPath();ox.moveTo(cx-w/2,y);ox.lineTo(cx+w/2,y);for(let i=26;i>=0;i--)ox.lineTo(cx-w/2+i/26*w,y+h-((i*37)%11)*.6);ox.closePath();ox.fill();
  ox.strokeStyle=ink.key;ox.globalAlpha=.45;ox.lineWidth=2;ox.beginPath();ox.moveTo(cx-w/2,y);ox.lineTo(cx-w/2,y+h);ox.moveTo(cx+w/2,y);ox.lineTo(cx+w/2,y+h);ox.stroke();ox.globalAlpha=1;
  ox.save();ox.translate(cx-w/2+26,y+22);ox.scale(2.1,2.1);ox.strokeStyle=ink.mid;ox.lineWidth=1.8;ox.lineCap='round';ox.beginPath();MARK[mark](ox);ox.stroke();ox.restore();
  ox.fillStyle=ink.key;ox.font=`40px ${MONO}`;ox.textBaseline='top';ox.fillText(lines[0],cx-w/2+110,y+22);
  ox.font=`27px ${MONO}`;ox.globalAlpha=.9;ox.fillText(lines[1],cx-w/2+110,y+74);ox.restore();}

// the rider as the side view prints it
function riderBall(x,y,r,ink,a=0){ox.save();ox.fillStyle=ink.mid;ox.beginPath();ox.arc(x,y,r,0,TAU);ox.fill();ox.strokeStyle=ink.key;ox.lineWidth=r*.22;ox.beginPath();ox.arc(x+r*.16,y-r*.11,r,0,TAU);ox.stroke();
  ox.fillStyle=ink.key;ox.beginPath();ox.arc(x+Math.cos(a-.5)*r*.5,y+Math.sin(a-.5)*r*.5,r*.2,0,TAU);ox.fill();ox.restore();}
// the colour bar strip + registration marks, for the title and end cards
function colourBar(ink,y=1036){const cyc=[ink.key,mulHex(ink.mid,ink.key),ink.mid,mulHex(ink.light,ink.mid),ink.light,mulHex(ink.light,ink.key)];
  for(let i=0;i<24;i++){ox.fillStyle=cyc[i%6];ox.fillRect(600+i*30,y,28,18);}
  for(const[x,yy]of[[60,60],[FW-60,60],[60,FH-60],[FW-60,FH-60]])regMark(x,yy,16,ink.key);}

// =====================================================================================
// The scenes. Times are local seconds; every scene starts on a beat (120 BPM, a beat = 0.5 s).
// =====================================================================================
const SC=[];
const scene=(name,dur,init,frame)=>SC.push({name,dur,init,frame});
const L_=id=>LEVELS.findIndex(l=>l.id===id);
const sol=(id,i=0)=>LEVELS[L_(id)].solutions[i];
const AUTO=(w,L)=>P.autopilot(w,L,{drops:true});
// When does something happen on a ride? (the first event matching `type`, or the ride's end)
function eventT(id,items,type,policy=AUTO){const L=LEVELS[L_(id)],w=P.build(L,items);const pol=policy==='none'?()=>P.NO_INPUT:policy;
  while(w.status==='run'&&w.t<20){P.step(w,L,pol(w,L));const e=type&&w.events.find(e=>e.type===type);if(e)return e.t;}return w.t;}
const lvlTag=sh=>`level ${String(sh.li+1).padStart(2,'0')} · ${sh.L.name.toLowerCase()}`;

// A "draw it, swoop, ride it" shot. opts: plan, swoopAt, swoopMs, policy, rollInSwoop, cap(lt, st) for captions.
function drawRideScene(name,dur,id,opts){scene(name,dur,()=>{const sh=new Shot(L_(id));
    return{sh,plan:opts.plan(sh).map(p=>({...p})),rideAt:opts.swoopAt+opts.swoopMs/1000,rode:false};},
  (lt,st)=>{const sh=st.sh;curInk=sh.ink;
    if(lt<opts.swoopAt){drawPlan(sh,st.plan,lt);sh.drawSide(T);deskBg();sheetFurniture(sh);place(scr,SIDE);}
    else if(lt<st.rideAt){if(!sh.world){drawPlan(sh,st.plan,1e9);sh.startRide(opts.policy||'auto');}
      const p=clamp((lt-opts.swoopAt)/(opts.swoopMs/1000),0,1);if(opts.rollInSwoop&&p>.35)sh.step();sh.drawSwoop(T,p);deskBg();sheetFurniture(sh,1-clamp(p*3,0,1));place(scr,mixLay(SIDE,FULL,ease(p)));}
    else{if(!st.rode){st.rode=true;sfx('transition',1);}sh.step();sh.drawRide(T);deskBg();place(scr,FULL);}
    opts.cap&&opts.cap(lt,st);});}

// 1 · HOOK — straight into a ride, then the camera lifts out through the paper: it was a drawing all along. (0 – 5 s)
const HOOK={id:'first-line',items:sol('first-line',0),from:.25,fp:1.5,back:1.5};
scene('hook',5,()=>{const sh=new Shot(L_(HOOK.id),HOOK.items);sh.startRide('auto');sh.preroll(HOOK.from);return{sh};},(lt,st)=>{const sh=st.sh;curInk=sh.ink;
  const b0=HOOK.fp,b1=HOOK.fp+HOOK.back;
  if(lt<b0){sh.step();sh.drawRide(T);deskBg();place(scr,FULL);}
  else if(lt<b1){const k=(lt-b0)/HOOK.back,p=1-ease(k);if(Math.round(lt*FPS)%2===0)sh.step();   // half-speed while the camera lifts off
    sh.drawSwoop(T,p,true);deskBg();sheetFurniture(sh,clamp((.33-p)*3,0,1));place(scr,mixLay(SIDE,FULL,ease(p)));}
  else{sh.step();sh.drawSideLive(T);deskBg();sheetFurniture(sh);place(scr,SIDE);}
  if(lt>=b1+.25){const a=lt-b1-.25;stampText('YOU',70,330,{size:170,maxW:330,age:a,rot:-.05});stampText('DREW',74,490,{size:170,maxW:330,age:a-.3,rot:-.04});stampText('THAT.',74,650,{size:170,maxW:330,age:a-.6,rot:-.05});}});

// 2 · TITLE — three plates stamp the wordmark (6 – 10 s)
scene('title',4,()=>({sh:new Shot(L_('orrery'))}),(lt,st)=>{const L=st.sh.L,ink=st.sh.ink;curInk=ink;
  if(DRY)return;
  deskBg();const s=1.28+lt*.03;ox.save();ox.globalAlpha=.55;ox.translate(FW/2,FH/2);ox.scale(s,s);ox.drawImage(printOf(L,true).ride,-FW/2,-FW*5/16,FW,FW*10/16);ox.restore();
  ox.fillStyle=PAPER;ox.globalAlpha=.35;ox.fillRect(0,0,FW,FH);ox.globalAlpha=1;colourBar(ink);
  const plates=[[ink.light,26,19,0],[ink.mid,13,9.5,.5],[ink.key,0,0,1]];
  for(const[col,dx,dy,t0]of plates){if(lt<t0)continue;const a=lt-t0,down=a<2/FPS;
    lx.setTransform(1,0,0,1,0,0);lx.clearRect(0,0,FW,FH);lx.font=`900 ${down?322:310}px ${STENCIL}`;lx.letterSpacing='14px';lx.textAlign='center';lx.textBaseline='middle';
    lx.fillStyle=col;lx.fillText('RISO RIDER',FW/2+dx,500+dy);lx.globalCompositeOperation='destination-out';lx.fillStyle=inkMask;lx.fillRect(0,0,FW,FH);lx.globalCompositeOperation='source-over';
    ox.save();ox.globalCompositeOperation='multiply';if(down)ox.filter='brightness(.7)';ox.drawImage(lay,0,down?4:0);ox.restore();}
  typeText('Draw a track on paper. Then ride it.',FW/2,760,{size:52,progress:typeP(lt,1.5,36,34),align:'center',bg:.8});
  typeText('a physics puzzle, printed like a risograph',FW/2,840,{size:34,color:ink.key,progress:typeP(lt,2.7,42,60),align:'center',alpha:.9,bg:.8});});
SC[SC.length-1].sounds=[[0,'stamp',0],[.5,'stamp',1],[1,'stamp',2]];

// 3 · HOW — draw a kicker, the full swoop, ride it over the wall (10 – 16.5 s)
drawRideScene('how',6.5,'the-wall',{swoopAt:1.9,swoopMs:1100,rollInSwoop:true,
  plan:()=>[{item:sol('the-wall',1)[0],t0:.35,t1:1.65}],
  cap:(lt,st)=>{
    if(lt<2.3){const a=lt<1.9?1:1-(lt-1.9)/.4;stampText('DRAW',70,340,{size:190,maxW:340,age:lt-.1,rot:-.05,alpha:a});stampText('A TRACK.',74,500,{size:150,maxW:330,age:lt-.4,rot:-.04,alpha:a});}
    if(lt>=st.rideAt+.1){stampText('THEN',80,200,{size:130,age:lt-st.rideAt-.1,rot:-.06,solid:.94});stampText('RIDE IT.',84,370,{size:190,age:lt-st.rideAt-.4,rot:-.05,solid:.94});}}});

// 4 · TOOLS — four tools: draw on the sheet, a short dive into the page, ride it (15 – 29 s)
// The caption starts big on the desk and slides up into a paper label as the camera dives.
const TS=.8;       // dive length (s)
const toolCap=(big,small,at)=>(lt,st)=>{const k=ease(clamp((lt-at)/TS,0,1)),y=lerp(330,215,k),sz=lerp(170,150,k);
  stampText(big,70,y,{size:sz,maxW:lerp(340,520,k),age:lt-.05,rot:-.05,solid:k*.94});
  typeText(small,lerp(76,78,k),y+lerp(82,76,k),{size:lerp(33,40,k),progress:typeP(lt,.4,small.length,40),bg:k*.9});};
const toolScene=(name,id,plan,at,cap)=>drawRideScene(name,3.5,id,{swoopAt:at,swoopMs:TS*1000,rollInSwoop:true,plan,cap:toolCap(cap[0],cap[1],at)});
toolScene('lines','canyon',()=>[{item:sol('canyon')[0],t0:.1,t1:.75}],.9,['LINES','roll and slide.']);
toolScene('ropes','bank-shot',()=>[{item:sol('bank-shot')[0],t0:.15,t1:.7}],.9,['ROPES','bounce you back.']);
toolScene('wind','chimney',()=>[{item:sol('chimney',1)[0],t0:.1,t1:.75}],.9,['WIND','carries you up.']);
toolScene('slings','keyhole',()=>[{item:sol('keyhole',1)[0],t0:.3}],.9,['SLINGS','fling you through.']);

// 5 · THE PAGE FIGHTS BACK — ice, boosts, spikes, from behind the ball (30.5 – 38 s)
const CLIPS=[
  {id:'ski-jump',items:sol('ski-jump',0),at:()=>.3,word:'ICE.'},
  {id:'afterburner',items:sol('afterburner',2),at:()=>0,word:'BOOSTS.'},
  {id:'cavern',items:sol('cavern',1),at:()=>0,word:'SPIKES.'}];
const CD=2.5;
scene('elements',CLIPS.length*CD,()=>({clips:CLIPS.map(()=>null)}),(lt,st)=>{const k=Math.min(CLIPS.length-1,Math.floor(lt/CD)),a=lt-k*CD,C=CLIPS[k];
  let c=st.clips[k];if(!c){const sh=new Shot(L_(C.id),C.items);sh.startRide('auto');sh.preroll(Math.max(0,C.at()));c=st.clips[k]={sh};}
  const sh=c.sh;curInk=sh.ink;sh.step();sh.drawRide(T);deskBg();place(scr,FULL);
  stampText(C.word,70,220,{size:170,maxW:600,age:a-.04,rot:-.05,solid:.94});
  typeText(lvlTag(sh),78,305,{size:32,bg:.9,progress:typeP(a,.2,24,50)});});

// 6 · ONE LEVEL, MANY ANSWERS — four sheets of the same level, four different drawings, all riding at once (38 – 46.5 s)
const ANS={id:'crossroads',sols:[[0,'a line'],[3,'a sling'],[2,'a rope'],[1,'wind']],draw:2.6};
const TILE=(i)=>({cx:[800,1525][i%2],cy:[292,790][Math.floor(i/2)],s:.36,rot:[-.008,.006,.005,-.006][i]});
scene('answers',8.5,()=>({tiles:ANS.sols.map(([k,label],i)=>{const items=sol(ANS.id,k),sh=new Shot(L_(ANS.id));
    const plan=items.map((it,j)=>({item:it,t0:.35+i*.5+j*.2,t1:.35+i*.5+j*.2+.9}));return{sh,items,plan,label,img:cv(GW,GH),winT:null};})}),
  (lt,st)=>{if(!DRY)deskBg();
    st.tiles.forEach((tl,i)=>{const sh=tl.sh;curInk=sh.ink;
      if(lt<ANS.draw){drawPlan(sh,tl.plan,lt);sh.drawSide(T);}
      else{if(!sh.world){drawPlan(sh,tl.plan,1e9);sh.startRide('auto');}sh.step(true);sh.drawSideLive(T);
        if(tl.winT==null&&sh.world.status==='win'){tl.winT=lt;sfx('stamp',1);}}
      if(DRY)return;tl.img.getContext('2d').drawImage(scr,0,0);const lay=TILE(i);place(tl.img,lay,{marks:false});
      ox.save();ox.strokeStyle=sh.ink.key;ox.globalAlpha=.7;ox.lineWidth=2;ox.translate(lay.cx,lay.cy);ox.rotate(lay.rot);ox.strokeRect(-GW*lay.s/2,-GH*lay.s/2,GW*lay.s,GH*lay.s);ox.restore();
      const used=Math.round(P.inkUsed(tl.items));
      typeText(`${tl.label} · ${used} ink`,lay.cx-GW*lay.s/2+4,lay.cy+GH*lay.s/2+40,{size:30,progress:typeP(lt,.5+i*.5,16,40)});
      if(tl.winT!=null){const a=lt-tl.winT,down=a<2/FPS;ox.save();ox.translate(lay.cx+GW*lay.s/2-48,lay.cy-GH*lay.s/2+54);ox.rotate(-.12);ox.globalCompositeOperation='multiply';if(down)ox.filter='brightness(.62)';
        ox.fillStyle=sh.ink.mid;starPath(ox,0,0,down?40:38);ox.fill();ox.strokeStyle=sh.ink.key;ox.lineWidth=3;starPath(ox,3,-2,down?40:38);ox.stroke();ox.restore();}});
    curInk=st.tiles[0].sh.ink;
    stampText('ONE',70,330,{size:170,maxW:330,age:lt-.05,rot:-.05});stampText('LEVEL.',74,480,{size:150,maxW:330,age:lt-.3,rot:-.04});
    if(lt>=3.2){stampText('MANY',74,700,{size:150,maxW:330,age:lt-3.2,rot:-.05});stampText('ANSWERS.',74,850,{size:130,maxW:330,age:lt-3.45,rot:-.04});}});

// 7 · FAILS — you will fall. a lot. (46.5 – 54 s)
const FAILS=[
  {id:'canyon',items:sol('canyon'),policy:w=>({steer:w.t>.7?1:0,jump:false,jumpHeld:false,push:0}),why:['Fell off the tightrope.','fall']},
  {id:'floor-gives-way',items:[],policy:'none',why:['Popped!','pop']},
  {id:'low-ceiling',items:sol('low-ceiling',2),policy:w=>({steer:0,jump:w.t>1.05&&w.t<1.1,jumpHeld:true,push:0}),why:['Popped!','pop']}];
const FD=2.5,FX=1.15;      // each fail: its length, and how far into it the crash lands
FAILS.forEach((F,i)=>scene('fail'+i,FD,()=>{const at=eventT(F.id,F.items,null,F.policy==='auto'?AUTO:F.policy);const sh=new Shot(L_(F.id),F.items);
    const pre=Math.max(0,at-FX);sh.startRide(F.policy);sh.preroll(pre);return{sh,cut:at-pre+.3};},(lt,st)=>{
  const sh=st.sh;curInk=sh.ink;const ride=lt<st.cut;
  if(ride){sh.step();sh.drawRide(T);deskBg();place(scr,FULL);}
  else{if(!st.ghost){const w=sh.world;st.ghost=true;sh.S.mode='edit';sh.S.falls=i+1;sh.S.settings.reducedMotion=true;
      sh.S.ghost={path:w.path,events:w.events,status:w.status,at:[clamp(w.rider.x,0,P.W),clamp(w.rider.y,0,P.H)]};sfx('ui','slip');}
    sh.drawSide(T);deskBg();sheetFurniture(sh);place(scr,SIDE);slip([F.why[0],'R ride again · E edit your drawing'],F.why[1],sh.ink,1150,116,clamp((lt-st.cut)/.12,0,1));}
  const tot=i*FD+lt,o=ride?{solid:.94}:{};
  stampText('YOU WILL',70,ride?200:560,{size:150,maxW:360,age:tot-.05,rot:-.05,...o});
  stampText('FALL.',70,ride?360:720,{size:190,maxW:360,age:tot-.3,rot:-.04,...o});
  if(i===2){stampText('A LOT.',80,ride?540:900,{size:170,maxW:360,age:lt-.15,rot:.03,...o});}}));

// 8 · FIFTY SHEETS — every level is its own sheet, in its own inks; one lands on the desk every beat (53 – 58.5 s)
scene('sheets',5.5,()=>{const r=rng(42);return{sheets:DEAL.map(i=>{const items=LEVELS[i].solutions[0],sh=new Shot(i,items);
    const res=P.simulate(LEVELS[i],items,{policy:'auto'}),w=res.world;sh.S.ghost={path:w.path,events:w.events,status:'win',at:[w.rider.x,w.rider.y]};sh.S.settings.reducedMotion=true;
    return{sh,lay:{cx:1240+(r()-.5)*130,cy:560+(r()-.5)*80,s:.6,rot:(r()-.5)*.18},img:null};})};},
  (lt,st)=>{const n=DEAL.length,per=4/n,k=Math.min(n-1,Math.floor(lt/per)),a=lt-k*per;
    if(a<DTF/2&&lt<4)sfx('ui','next');   // (a sheet every beat)
    if(DRY)return;deskBg();
    const img=s=>{if(!s.img){s.img=cv(GW,GH);s.sh.drawSide(T);s.img.getContext('2d').drawImage(scr,0,0);}return s.img;};
    for(let j=Math.max(0,k-7);j<k;j++){const s=st.sheets[j];curInk=s.sh.ink;place(img(s),s.lay,{marks:false});}
    const s=st.sheets[k];curInk=s.sh.ink;
    const drop=a<3/FPS?1.05-.017*Math.floor(a*FPS):1;place(img(s),{...s.lay,s:s.lay.s*drop});
    const ch=[...CHAPTERS].reverse().find(c=>DEAL[k]>=c.from);
    stampText(String(DEAL[k]+1).padStart(2,'0'),70,330,{size:230,age:a,rot:-.05});
    stampText('LEVELS',74,470,{size:130,age:lt-.1,rot:-.04});
    typeText('six chapters,',78,560,{size:34,progress:typeP(lt,.4,13,36)});typeText('each in its own inks.',78,606,{size:34,progress:typeP(lt,.95,21,36)});
    typeText(`chapter ${ch.n} · ${ch.name.toLowerCase()} · ${s.sh.L.name.toLowerCase()}`,78,1040,{size:28,alpha:.9});});

// 9 · FINALE — the last level: a rope, a sling, the swoop, and CLEARED! (59.5 – 68.5 s)
drawRideScene('finale',9,'last-proof',{swoopAt:1.25,swoopMs:1100,
  plan:()=>[{item:sol('last-proof',1)[0],t0:.1,t1:.6},{item:sol('last-proof',1)[1],t0:.85}],
  cap:(lt,st)=>{if(lt<1.6){const a=lt<1.25?1:1-(lt-1.25)/.35;stampText('THEN',70,330,{size:170,maxW:330,age:lt-.02,rot:-.05,alpha:a});stampText('MIX',74,490,{size:170,maxW:330,age:lt-.25,rot:-.04,alpha:a});stampText('THEM.',74,650,{size:170,maxW:330,age:lt-.45,rot:-.05,alpha:a});}
    const w=st.sh.world;if(w&&w.status==='win'){if(st.winT==null){st.winT=lt;st.stars=P.stars(st.sh.L,P.inkUsed(st.sh.S.items),w.refund||0);}
      const t0=st.winT+.18;if(Math.abs(lt-t0)<DTF/2)sfx('stamp',0);for(let i=0;i<st.stars;i++)if(Math.abs(lt-(t0+.38+i*.3))<DTF/2)sfx('stamp',i+1);
      cleared(lt,t0,st.stars,st.sh.ink);}}});

// 10 · END CARD (68.5 – 74.5 s)
scene('end',6,()=>({ink:inksOf(LEVELS[L_('the-wall')])}),(lt,st)=>{const ink=st.ink;curInk=ink;
  const line=[[470,560],[760,548],[1060,572],[1330,556]],d=dens(line,3),dk=clamp((lt-.35)/.6,0,1),n=Math.floor(dk*(d.length-1));
  if(Math.abs(lt-.35)<DTF/2)sfx('draw','line','start',0);if(lt>.35&&lt<.95)sfx('draw','line','move',1400);if(Math.abs(lt-.95)<DTF/2)sfx('draw','line','end',0);
  const rideK=clamp((lt-1.05)/1.25,0,1),ri=Math.floor(ease(rideK)*(d.length-1)),bp=d[Math.min(d.length-1,ri)],goal=[1420,516];
  if(Math.abs(lt-2.3)<DTF/2)sfx('event',{type:'win'});
  if(DRY)return;deskBg();colourBar(ink);
  stampText('RISO RIDER',FW/2,430,{size:250,age:lt-.05,align:'center',spacing:.05,off:.03});
  ox.save();ox.lineCap='round';ox.lineJoin='round';ox.globalCompositeOperation='multiply';
  for(const[col,o]of[[ink.mid,4],[ink.key,0]]){ox.strokeStyle=col;ox.lineWidth=8;ox.beginPath();d.slice(0,n+1).forEach((p,i)=>ox[i?'lineTo':'moveTo'](p[0]+o,p[1]+o*.7));ox.stroke();}
  ox.strokeStyle=ink.key;ox.lineWidth=7;ox.beginPath();ox.arc(goal[0],goal[1],34,0,TAU);ox.stroke();ox.strokeStyle=ink.mid;ox.setLineDash([9,10]);ox.lineWidth=4;ox.beginPath();ox.arc(goal[0],goal[1],48,0,TAU);ox.stroke();ox.restore();
  if(dk<1){const p=d[n];pencilAt(p,ink);}
  else{const past=lt>2.3,k=clamp((lt-2.3)/.25,0,1),x=past?lerp(d[d.length-1][0],goal[0],easeOut(k)):bp[0],y=past?lerp(d[d.length-1][1]-24,goal[1],easeOut(k)):bp[1]-24;riderBall(x,y,22,ink,past?2.3*9+k*3:lt*9);}
  stampText('DRAW IT. RIDE IT.',FW/2,720,{size:110,age:lt-1.3,align:'center',spacing:.05});
  typeText('50 levels · free · plays in your browser · install it on your phone',FW/2,815,{size:38,progress:typeP(lt,1.9,66,80),align:'center'});
  typeText('tbone94.github.io/Riso-Rider',FW/2,920,{size:56,progress:typeP(lt,2.8,28,40),align:'center'});
  if(lt>2.8+.7){ox.fillStyle=ink.mid;ox.fillRect(FW/2-420,940,840,5);}});
function pencilAt(p,ink){ox.save();ox.translate(p[0],p[1]);ox.scale(2.2,2.2);pencil(ox,[0,0],ink);ox.restore();}

// scene start times
let TOTAL=0;SC.forEach(s=>{s.t0=TOTAL;TOTAL+=s.dur;});

// =====================================================================================
// Running the timeline
// =====================================================================================
async function prepare(full=true){await document.fonts.load(`900 40px ${STENCIL}`);await document.fonts.load(`20px ${MONO}`);if(!full)return;
  for(const L of LEVELS)if(HERO.has(L.id))await printLevel(L,true);
  for(const i of DEAL)await printLevel(LEVELS[i],false);}
// Render every frame in order; onFrame(f, t) after each one is composed on `out`.
async function run(onFrame,{from=0,to=TOTAL}={}){LOG.length=0;RID=0;STAMPED.clear();
  for(const s of SC){if(s.t0+s.dur<=from-1e-9&&!DRY)continue;const n=Math.round(s.dur*FPS);T=s.t0;const st=s.init();
    for(let f=0;f<n;f++){T=s.t0+f/FPS;if(T>=to)return;
      if(s.sounds)for(const[at,name,arg]of s.sounds)if(Math.abs(f/FPS-at)<DTF/2)sfx(name,arg);
      s.frame(f/FPS,st);
      if(!DRY&&T>=from-1e-9)await onFrame(Math.round(T*FPS),T);}}}

// ---------- music: 120 BPM, C – Am – F – G, built in the same offline context ----------
const BEAT=.5,BAR=2;
const CH=[[48,[60,64,67,72]],[45,[57,60,64,69]],[41,[57,60,65,69]],[43,[55,59,62,67]]];   // bass root, chord (MIDI)
const mtof=m=>440*Math.pow(2,(m-69)/12);
// Sections follow the cut: scene start times in beats.
const tOf=name=>{const s=SC.find(x=>x.name===name);return s?s.t0:0;},bOf=name=>Math.round(tOf(name)/BEAT);
function music(ac,dest){const noise=(()=>{const b=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),d=b.getChannelData(0),r=rng(5);for(let i=0;i<d.length;i++)d[i]=r()*2-1;return b;})();
  const bus=ac.createGain();bus.gain.value=.5;const comp=ac.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=3;comp.attack.value=.005;comp.release.value=.15;
  bus.connect(comp);comp.connect(dest);
  const drums=ac.createGain();drums.connect(bus);const tone=ac.createGain();tone.connect(bus);
  const room=ac.createConvolver();{const len=ac.sampleRate*1.2,ir=ac.createBuffer(2,len,ac.sampleRate),r=rng(9);for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++)d[i]=(r()*2-1)*Math.exp(-i/ac.sampleRate/.25);}room.buffer=ir;}
  const rs=ac.createGain();rs.gain.value=.22;tone.connect(rs);rs.connect(room);room.connect(bus);
  const env=(p,t,a,peak,d)=>{p.setValueAtTime(0,t);p.linearRampToValueAtTime(peak,t+a);p.exponentialRampToValueAtTime(.0005,t+a+d);};
  const nz=(t,dur,type,f,q,peak,d,to=drums)=>{const s=ac.createBufferSource();s.buffer=noise;const fl=ac.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=q;const gg=ac.createGain();env(gg.gain,t,.002,peak,d);s.connect(fl);fl.connect(gg);gg.connect(to);s.start(t,(t*7.31)%1.5);s.stop(t+dur);return{s,fl,gg};};
  const kick=(t,v=1,muff=false)=>{const o=ac.createOscillator(),gg=ac.createGain();o.frequency.setValueAtTime(155,t);o.frequency.exponentialRampToValueAtTime(46,t+.13);env(gg.gain,t,.003,.95*v,.4);
    let n=gg;if(muff){const f=ac.createBiquadFilter();f.type='lowpass';f.frequency.value=180;gg.connect(f);n=f;}n.connect(drums);o.connect(gg);o.start(t);o.stop(t+.5);
    if(!muff)nz(t,.03,'bandpass',3000,1,.25*v,.012);};
  const snare=(t,v=1)=>{nz(t,.3,'bandpass',1900,.7,.55*v,.16);nz(t,.3,'highpass',5000,.5,.18*v,.08);const o=ac.createOscillator(),gg=ac.createGain();o.type='triangle';o.frequency.setValueAtTime(210,t);o.frequency.exponentialRampToValueAtTime(160,t+.08);env(gg.gain,t,.002,.35*v,.09);o.connect(gg);gg.connect(drums);o.start(t);o.stop(t+.2);};
  const hat=(t,v=1)=>nz(t,.08,'highpass',7500,.6,.16*v,.035);
  const shaker=(t,v=1)=>nz(t,.12,'bandpass',5200,1.2,.07*v,.06);
  const bass=(t,m,dur,v=1)=>{const o=ac.createOscillator(),f=ac.createBiquadFilter(),gg=ac.createGain();o.type='sawtooth';o.frequency.value=mtof(m);f.type='lowpass';f.Q.value=4;
    f.frequency.setValueAtTime(900,t);f.frequency.exponentialRampToValueAtTime(220,t+dur);gg.gain.setValueAtTime(0,t);gg.gain.linearRampToValueAtTime(.3*v,t+.006);gg.gain.setValueAtTime(.3*v,t+dur*.7);gg.gain.linearRampToValueAtTime(0,t+dur);
    o.connect(f);f.connect(gg);gg.connect(tone);o.start(t);o.stop(t+dur+.02);};
  // felt piano: a few sine partials with a quick bright attack
  const piano=(t,m,v=1,len=1)=>{const f0=mtof(m),lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2600;lp.connect(tone);
    for(const[k,a,d]of[[1,1,.9],[2,.32,.5],[3,.1,.32],[4.12,.03,.18]]){const o=ac.createOscillator(),gg=ac.createGain();o.frequency.value=f0*k;env(gg.gain,t,.004,.085*a*v,d*len);o.connect(gg);gg.connect(lp);o.start(t);o.stop(t+d*len*6);}};
  const pad=(t,ms,dur,v=1)=>{for(const m of ms)for(const det of[-6,6]){const o=ac.createOscillator(),f=ac.createBiquadFilter(),gg=ac.createGain();o.type='triangle';o.frequency.value=mtof(m);o.detune.value=det;
    f.type='lowpass';f.frequency.value=1100;gg.gain.setValueAtTime(0,t);gg.gain.linearRampToValueAtTime(.022*v,t+.35);gg.gain.setValueAtTime(.022*v,t+dur-.4);gg.gain.linearRampToValueAtTime(0,t+dur);
    o.connect(f);f.connect(gg);gg.connect(tone);o.start(t);o.stop(t+dur+.05);}};
  const riser=(t,dur,v=1)=>{const s=ac.createBufferSource();s.buffer=noise;s.loop=true;const f=ac.createBiquadFilter();f.type='bandpass';f.Q.value=1.4;f.frequency.setValueAtTime(300,t);f.frequency.exponentialRampToValueAtTime(4200,t+dur);
    const gg=ac.createGain();gg.gain.setValueAtTime(0,t);gg.gain.linearRampToValueAtTime(.22*v,t+dur);gg.gain.linearRampToValueAtTime(0,t+dur+.03);s.connect(f);f.connect(gg);gg.connect(drums);s.start(t);s.stop(t+dur+.05);};
  // the cut, in beats
  const LIFT=Math.round(HOOK.fp/BEAT),TITLE=bOf('title'),HOW=bOf('how'),TOOLS=bOf('lines'),FAILS=bOf('fail0'),SHEETS=bOf('sheets'),END=bOf('end'),nb=Math.round(TOTAL/BEAT);
  const sect=b=>b<LIFT?'hook':b<TITLE-2?'lift':b<TITLE?'roll':b<TITLE+4?'title':b<HOW?'rise':b<FAILS?'full':b<SHEETS?'fails':b<END?'full':'end';
  const melody=[[0,76],[1.5,79],[2,81],[3,79],[4,76],[5.5,74],[6,72],[7,74],[8,76],[9.5,79],[10,81],[11,84],[12,81],[13.5,79],[14,76],[15,74]];   // 4 bars, in beats
  for(let b=0;b<nb;b++){const t=b*BEAT,s=sect(b),bar=Math.floor(b/4),ch=CH[bar%4],inBar=b%4;
    // hook: a held chord, a muffled pulse and ticking hats under the ride; a riser into the lift-off
    if(s==='hook'){kick(t,.75,true);if(b===0)pad(t,[48,55,60,64],LIFT*BEAT+.4,1.1);hat(t+.25,.45);if(b%2)shaker(t,.6);if(b===LIFT-2)riser(t,2*BEAT,1);}
    // the camera lifts out of the page: the beat drops away, one bright chord rings
    if(s==='lift'&&b===LIFT){piano(t,72,.8,2.2);piano(t,76,.65,2.2);piano(t,79,.6,2.2);piano(t,84,.45,2.2);pad(t,[53,57,60,65],(TITLE-2-LIFT)*BEAT+.3,1.2);}
    if(s==='roll'){kick(t,.8,true);const k0=b===TITLE-2;for(let k=0;k<(k0?2:4);k++)snare(t+k*(k0?.25:.125),.25+.12*k+(k0?0:.2));}
    if(s==='full'||s==='fails'){
      const half=s==='fails';
      if(!half||inBar%2===0)kick(t,1);if(!half&&inBar===1)kick(t+.25,.55);
      if(inBar===1||inBar===3)snare(t,half?.8:1);
      hat(t+.25,.9);if(!half){hat(t,.4);shaker(t+.125,.8);shaker(t+.375,.8);}
      bass(t,ch[0],.2,1);bass(t+.25,ch[0]+12,.18,.7);
      piano(t+.25,ch[1][1],.55,.35);piano(t+.25,ch[1][2],.5,.35);piano(t+.25,ch[1][3],.45,.35);   // offbeat stabs
      if(inBar===0)pad(t,ch[1],2,.6);
      if(b>=TOOLS&&b<FAILS){const mb=(b-TOOLS)%16;for(const[at,m]of melody)if(Math.floor(at)===mb)piano(t+(at-mb)*BEAT,m+12,.9,1.4);}}
    if(s==='title'){if(b===TITLE){pad(t,[53,57,60,65],4*BEAT,1.2);kick(t,1.1);piano(t,41,1,2);piano(t,53,.8,2);}}
    if(s==='rise'){if(b===TITLE+4){pad(t,[55,59,62,67],1,1.2);riser(t,1,1);}snare(t,.35+(b-TITLE-4)*.25);snare(t+.25,.4+(b-TITLE-4)*.25);if(b===HOW-1)for(let k=0;k<4;k++)snare(t+k*.125,.5+k*.12);}
    if(s==='end'){if(b===END){pad(t,[48,55,60,64,67],5,1.3);piano(t,48,.9,3);piano(t,60,.8,3);piano(t,64,.7,3);piano(t,67,.7,3);}
      if(b>=END+1&&b<END+7){const arp=[72,76,79,84,79,76];piano(t,arp[b-END-1],.45,1);}}}
  // the title slam gets a riser into it
  riser(tOf('title')-1,1,.5);
  // fails: the music cuts out for each crash
  const F0=tOf('fail0');for(const c of LOG){if(c.name!=='event'||!c.args[0]||!['fell','popped','stuck'].includes(c.args[0].type)||c.t<F0||c.t>=F0+3*FD)continue;
    const tf=c.t,p=bus.gain;p.setValueAtTime(.5,tf);p.linearRampToValueAtTime(.04,tf+.05);p.setValueAtTime(.04,tf+.55);p.linearRampToValueAtTime(.5,tf+.62);}
  // the finale's win lands on a big hit
  const win=LOG.find(c=>c.name==='event'&&c.args[0]&&c.args[0].type==='win'&&c.t>=tOf('finale'));
  if(win){kick(win.t,1.2);snare(win.t,.9);pad(win.t,[48,55,60,64,67],2.2,1.3);piano(win.t,84,.7,2);}
  // finish: fade the tail
  const end=TOTAL;bus.gain.setValueAtTime(.5,end-1.2);bus.gain.linearRampToValueAtTime(0,end-.05);
  return bus;}

// ---------- audio: game sounds replayed from the log + the music, rendered offline ----------
async function renderAudio(){const SR=48000,len=Math.ceil(TOTAL*SR),ac=new OfflineAudioContext(2,len,SR);
  const master=ac.createGain();master.gain.value=1;master.connect(ac.destination);
  music(ac,master);
  const realNow=performance.now.bind(performance);performance.now=()=>ac.currentTime*1000+1e6;
  const audio=createAudio({context:ac});audio.unlock();audio.setVolume(1);
  const Q=128/SR,groups=new Map();for(const c of LOG){const k=Math.max(1,Math.round(c.t/Q));if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
  const proxies=new Map();
  for(const[k,cmds]of groups){ac.suspend(k*Q).then(()=>{for(const c of cmds){try{
      if(c.name==='ride'){const s=c.args[0];let p=proxies.get(s.id);if(!p){p={rider:{},path:[[0,0,0,0]],ropes:[],crumbles:[]};proxies.set(s.id,p);}
        Object.assign(p.rider,s.rider);p.path[0][3]=s.ps;p.ropes=s.ropes;p.crumbles=s.crumbles;audio.ride(p,c.args[1]);}
      else if(c.name==='stamp')audio.stamp(c.args[0]);
      else if(typeof audio[c.name]==='function')audio[c.name](...c.args);}catch(e){console.warn(e);}}
    ac.resume();});}
  let buf;try{buf=await ac.startRendering();}finally{performance.now=realNow;}
  // normalise to -1 dBFS
  let peak=0;for(let c=0;c<2;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++){const v=Math.abs(d[i]);if(v>peak)peak=v;}}
  const gn=Math.pow(10,-1/20)/(peak||1);for(let c=0;c<2;c++){const d=buf.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=gn;}
  return buf;}
function wav(buf){const n=buf.length,ch=2,b=new DataView(new ArrayBuffer(44+n*ch*2)),w=(o,s)=>{for(let i=0;i<s.length;i++)b.setUint8(o+i,s.charCodeAt(i));};
  w(0,'RIFF');b.setUint32(4,36+n*ch*2,true);w(8,'WAVEfmt ');b.setUint32(16,16,true);b.setUint16(20,1,true);b.setUint16(22,ch,true);b.setUint32(24,buf.sampleRate,true);
  b.setUint32(28,buf.sampleRate*ch*2,true);b.setUint16(32,ch*2,true);b.setUint16(34,16,true);w(36,'data');b.setUint32(40,n*ch*2,true);
  const L=buf.getChannelData(0),R=buf.getChannelData(1);for(let i=0;i<n;i++){b.setInt16(44+i*4,clamp(L[i],-1,1)*32767,true);b.setInt16(46+i*4,clamp(R[i],-1,1)*32767,true);}
  return new Blob([b.buffer],{type:'audio/wav'});}

async function upload(name,blob){const r=await fetch(`${UPLOAD}?name=${encodeURIComponent(name)}`,{method:'POST',body:blob});if(!r.ok)throw new Error('upload failed');}
const toBlob=(c,type='image/png',q)=>new Promise(r=>c.toBlob(r,type,q));
const show=()=>{vx.drawImage(out,0,0,view.width,view.height);};
const raf=()=>new Promise(r=>setTimeout(r,0));

// ---------- modes ----------
async function contactSheet(every=.5,name='contact.jpg'){const cols=8,tw=320,th=180,n=Math.ceil(TOTAL/every),rows=Math.ceil(n/cols);
  const c=cv(cols*tw,rows*th),x=c.getContext('2d');x.font='16px monospace';let i=0;
  await run(async(f,t)=>{if(Math.abs(t/every-Math.round(t/every))<DTF/2/every){const k=Math.round(t/every);x.drawImage(out,(k%cols)*tw,Math.floor(k/cols)*th,tw,th);
      x.fillStyle='#000';x.fillRect((k%cols)*tw,Math.floor(k/cols)*th,56,20);x.fillStyle='#fff';x.fillText(t.toFixed(1),(k%cols)*tw+3,Math.floor(k/cols)*th+15);show();status(`sheet ${t.toFixed(1)}/${TOTAL}s`);await raf();}});
  await upload(name,await toBlob(c,'image/jpeg',.85));status('contact sheet uploaded');}
async function frames(list){const want=list.map(Number).sort((a,b)=>a-b);
  await run(async(f,t)=>{for(const w of want)if(Math.round(w*FPS)===f){show();await upload(`frame-${w.toFixed(2)}.jpg`,await toBlob(out,'image/jpeg',.9));}},{from:want[0]-.001,to:want[want.length-1]+.02});
  status('frames uploaded');}
async function renderMP4(){
  const {Muxer,ArrayBufferTarget}=await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.mjs');
  status('dry run for sound…');DRY=true;await run(async()=>{});DRY=false;const log=LOG.slice();
  status('rendering audio…');const abuf=await renderAudio();await upload('trailer-audio.wav',wav(abuf));
  const muxer=new Muxer({target:new ArrayBufferTarget(),video:{codec:'avc',width:FW,height:FH,frameRate:FPS},audio:{codec:'aac',numberOfChannels:2,sampleRate:48000},fastStart:'in-memory',firstTimestampBehavior:'offset'});
  const venc=new VideoEncoder({output:(c,m)=>muxer.addVideoChunk(c,m),error:e=>{console.error(e);status('video encoder error '+e);}});
  venc.configure({codec:'avc1.640032',width:FW,height:FH,bitrate:20e6,framerate:FPS,latencyMode:'quality',avc:{format:'avc'}});
  const aenc=new AudioEncoder({output:(c,m)=>muxer.addAudioChunk(c,m),error:e=>{console.error(e);status('audio encoder error '+e);}});
  aenc.configure({codec:'mp4a.40.2',numberOfChannels:2,sampleRate:48000,bitrate:192000});
  {const n=abuf.length,L=abuf.getChannelData(0),R=abuf.getChannelData(1),CHK=1024;
    for(let i=0;i<n;i+=CHK){const m=Math.min(CHK,n-i),d=new Float32Array(m*2);d.set(L.subarray(i,i+m),0);d.set(R.subarray(i,i+m),m);
      const ad=new AudioData({format:'f32-planar',sampleRate:48000,numberOfFrames:m,numberOfChannels:2,timestamp:Math.round(i/48000*1e6),data:d});aenc.encode(ad);ad.close();}
    await aenc.flush();}
  const t0=performance.now();
  await run(async(f,t)=>{const vf=new VideoFrame(out,{timestamp:Math.round(f*1e6/FPS),duration:Math.round(1e6/FPS)});venc.encode(vf,{keyFrame:f%120===0});vf.close();
    while(venc.encodeQueueSize>6)await new Promise(r=>setTimeout(r,2));
    if(f%30===0){show();status(`encoding ${t.toFixed(1)}/${TOTAL}s · ${((performance.now()-t0)/1000).toFixed(0)}s elapsed`);await raf();}});
  await venc.flush();muxer.finalize();
  const blob=new Blob([muxer.target.buffer],{type:'video/mp4'});status(`uploading ${(blob.size/1e6).toFixed(1)} MB…`);
  await upload('riso-rider-trailer.mp4',blob);status(`done: riso-rider-trailer.mp4 (${(blob.size/1e6).toFixed(1)} MB, ${TOTAL}s)`);window.RENDER_DONE=blob.size;}
// Audition a ride: #probe=<level id>,<solution index>,t1,t2,… uploads first-person frames at those ride times.
async function probe(arg){const[id,si,...ts]=arg.split(',');const sh=new Shot(L_(id),sol(id,+si));await printLevel(sh.L,true);sh.startRide('auto');let t=0;
  for(const want of ts.map(Number)){sh.preroll(want-t);t=want;sh.drawRide(t);deskBg();place(scr,FULL);show();await upload(`probe-${id}-${want.toFixed(2)}${CHASE?'':'-fp'}.jpg`,await toBlob(out,'image/jpeg',.85));}
  status('probe uploaded');}
// Audition a level: #look=<level id>,<solution index>,t1,t2,… uploads the solved sheet and ride frames at those times.
async function look(arg){const[id,si,...ts]=arg.split(',');const sh=new Shot(L_(id),sol(id,+si));await printLevel(sh.L,true);curInk=sh.ink;
  sh.drawSide(0);deskBg();sheetFurniture(sh);place(scr,SIDE);show();await upload(`look-${id}-${si}-sheet.jpg`,await toBlob(out,'image/jpeg',.85));
  sh.startRide('auto');let t=0;for(const want of ts.map(Number)){sh.preroll(want-t);t=want;sh.drawRide(t);deskBg();place(scr,FULL);show();await upload(`look-${id}-${si}-${want.toFixed(2)}.jpg`,await toBlob(out,'image/jpeg',.85));}
  status('look uploaded');}
async function preview(){await run(async(f,t)=>{show();status(`${t.toFixed(2)}s`);await raf();});}

async function audioTest(){DRY=true;try{await run(async()=>{});}finally{DRY=false;}const b=await renderAudio();await upload('trailer-audio.wav',wav(b));
  const d=b.getChannelData(0),win=b.sampleRate,rms=[];for(let i=0;i<d.length;i+=win){let q=0,m=0;for(let j=i;j<Math.min(d.length,i+win);j++){q+=d[j]*d[j];m=Math.max(m,Math.abs(d[j]));}rms.push((20*Math.log10(Math.sqrt(q/win)+1e-9)).toFixed(0)+'/'+(20*Math.log10(m+1e-9)).toFixed(0));}
  return{log:LOG.length,names:[...new Set(LOG.map(c=>c.name))],rms:rms.join(' ')};}
window.trailer={audioTest,SC,run,contactSheet,frames,renderMP4,preview,renderAudio,get TOTAL(){return TOTAL;},LOG};
if(HASH.startsWith('#probe=')){await document.fonts.load(`900 40px ${STENCIL}`);await probe(decodeURIComponent(HASH.slice(7)));}
else if(HASH.startsWith('#look=')){await document.fonts.load(`900 40px ${STENCIL}`);await document.fonts.load(`20px ${MONO}`);await look(decodeURIComponent(HASH.slice(6)));}
else{await prepare(!HASH.startsWith('#frames='));
status(`ready · ${TOTAL}s · ${SC.length} scenes`);}
$('#bPlay').onclick=preview;$('#bSheet').onclick=()=>contactSheet();$('#bRender').onclick=renderMP4;
const h=HASH;
try{if(h.startsWith('#probe=')||h.startsWith('#look='));else if(h==='#sheet')await contactSheet();else if(h.startsWith('#frames='))await frames(h.slice(8).split(','));else if(h==='#render')await renderMP4();}
catch(e){console.error(e);status('error: '+e.message);window.RENDER_ERR=String(e&&e.stack||e);}
