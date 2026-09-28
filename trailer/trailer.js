// trailer.js — the Riso Rider promo trailer, rendered offline from the game's own renderers.
// Every shot is real gameplay: side.js draws the sheet, ride.js draws the ride and the swoop,
// physics.js rides the known solutions. The trailer adds framing, captions, music and an encoder.
//   #sheet          render everything, upload a contact sheet (one thumbnail every 0.5 s)
//   #frames=a,b,c   upload full frames at those times (seconds)
//   #render         encode the MP4 (H.264 1080p60 + AAC) and upload it
import * as P from '../src/physics.js';
import {LEVELS} from '../src/levels.js';
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
async function printLevel(L){if(prints.has(L.id))return;status(`printing ${L.name}…`);await tick();
  const img=Riso.printSideBackdrop(L.bg,1600,1000),side=cv(1600,1000);side.getContext('2d').putImageData(img,0,0);
  const ride=createRide().printBackdrop(L,1600,1000);prints.set(L.id,{side,ride});}

// ---------- the sound log: every game sound, stamped with trailer time ----------
let T=0;                                    // trailer time of the frame being made
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
      settings:{fov:90,bob:false,chase:false,reducedMotion:false,assist:0}};
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
  sideBg(a=1){sx.globalAlpha=a;sx.drawImage(prints.get(this.L.id).side,0,0,GW,GH);sx.globalAlpha=1;}
  rideBg(b,a=1){const pr=prints.get(this.L.id).ride;sx.save();sx.globalAlpha=a;
    sx.translate(GW/2+(b&&+b.x||0)*PX,GH/2+(b&&+b.y||0)*PX);sx.scale(b&&+b.scale||1,b&&+b.scale||1);if(b&&b.rot)sx.rotate(b.rot*Math.PI/180);
    sx.drawImage(pr,-GW/2,-GH/2,GW,GH);sx.restore();}
  drawSide(t){if(DRY)return;plate();try{this.side.draw(g,t);}catch(e){console.error(e);}
    if(this.pen)pencil(g,this.pen,this.ink);finishPlate();
    sx.fillStyle=PAPER;sx.fillRect(0,0,GW,GH);this.sideBg();multiplyPlate();}
  drawRide(t,dt=DTF){if(DRY)return;plate();const o=this.ride.draw(g,this.world,this.L,this.S,t,dt)||{};finishPlate();
    sx.fillStyle=PAPER;sx.fillRect(0,0,GW,GH);this.rideBg(o.bg);multiplyPlate();}
  drawSwoop(t,p){sfx('transition',p);if(DRY)return;plate();
    const o=this.ride.drawTransition(g,this.world,this.L,this.S,t,p)||{};
    const sa=clamp(o.sideAlpha!=null?+o.sideAlpha:1-p,0,1),ra=clamp(o.rideBgAlpha!=null?+o.rideBgAlpha:p,0,1);
    if(sa>.004){sbx.setTransform(1,0,0,1,0,0);sbx.clearRect(0,0,GW,GH);sbx.setTransform(PX,0,0,PX,0,0);try{this.side.draw(sbx,t);}catch(e){console.error(e);}
      g.save();g.setTransform(1,0,0,1,0,0);g.globalAlpha=sa;g.drawImage(sideBuf,0,0);g.restore();}
    finishPlate();sx.fillStyle=PAPER;sx.fillRect(0,0,GW,GH);this.sideBg(1-ra);this.rideBg(o.bg,ra);multiplyPlate();}
}
function plate(){g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.clearRect(0,0,GW,GH);g.setTransform(PX,0,0,PX,0,0);}
function finishPlate(){g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='destination-out';g.drawImage(speck,0,0);g.globalCompositeOperation='source-over';}
function multiplyPlate(){sx.globalCompositeOperation='multiply';sx.drawImage(fg,0,0);sx.globalCompositeOperation='source-over';}

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
    if(it.type==='well'){if(st.state===0&&lt>=st.t0){st.state=2;S.items.push(JSON.parse(JSON.stringify(it)));sfx('draw','well','start',0);}
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
const SIDE={cx:1150,cy:560,s:.74,rot:0},FULL={cx:960,cy:540,s:1,rot:0};
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
function stampText(text,x,y,o={}){const{size=130,ink=curInk,age=1,rot=0,align='left',maxW=0,frame=false,alpha=1,spacing=.03,off=.035,base='alphabetic',paperBack=0}=o;
  if(age<0||DRY)return;
  lx.setTransform(1,0,0,1,0,0);lx.globalCompositeOperation='source-over';lx.globalAlpha=1;lx.clearRect(0,0,FW,FH);
  let sz=size;lx.font=`900 ${sz}px ${STENCIL}`;lx.letterSpacing=`${sz*spacing}px`;
  if(maxW){const w=lx.measureText(text).width;if(w>maxW){sz*=maxW/w;lx.font=`900 ${sz}px ${STENCIL}`;lx.letterSpacing=`${sz*spacing}px`;}}
  const down=age<2/FPS;lx.translate(x,y);lx.rotate(rot);if(down)lx.scale(1.05,1.05);
  lx.textAlign=align;lx.textBaseline=base;
  const m=lx.measureText(text),w=m.width,asc=m.actualBoundingBoxAscent,des=m.actualBoundingBoxDescent;
  const bx=align==='center'?-w/2:align==='right'?-w:0;
  if(frame||paperBack){const pad=sz*.2;
    if(paperBack){lx.fillStyle=PAPER;lx.globalAlpha=paperBack;lx.fillRect(bx-pad,-asc-pad,w+pad*2,asc+des+pad*2);lx.globalAlpha=1;}
    if(frame){lx.strokeStyle=ink.key;lx.lineWidth=sz*.035;for(const e of[0,sz*.075])lx.strokeRect(bx-pad+e,-asc-pad+e,w+pad*2-2*e,asc+des+pad*2-2*e);}}
  lx.fillStyle=ink.mid;lx.fillText(text,sz*off,sz*off*.75);lx.fillStyle=ink.key;lx.fillText(text,0,0);
  lx.setTransform(1,0,0,1,0,0);lx.globalCompositeOperation='destination-out';lx.fillStyle=inkMask;lx.fillRect(0,0,FW,FH);lx.globalCompositeOperation='source-over';
  ox.save();ox.setTransform(1,0,0,1,0,0);ox.globalAlpha=alpha;ox.globalCompositeOperation='multiply';if(down)ox.filter='brightness(.62) saturate(1.4)';ox.drawImage(lay,0,0);ox.restore();}
function typeText(text,x,y,{size=34,color=curInk.key,progress=1,align='left',alpha=1,bg=0}={}){if(DRY||progress<=0)return;
  const s=text.slice(0,Math.ceil(text.length*clamp(progress,0,1)));ox.save();ox.globalAlpha=alpha;ox.font=`${size}px ${MONO}`;ox.textAlign=align;ox.textBaseline='alphabetic';
  if(bg){const w=ox.measureText(text).width,bx=align==='center'?x-w/2:align==='right'?x-w:x;ox.fillStyle=PAPER;ox.globalAlpha=alpha*bg;ox.fillRect(bx-14,y-size*.95,w+28,size*1.35);ox.globalAlpha=alpha;}
  ox.fillStyle=color;ox.fillText(s,x,y);ox.restore();}
const typeP=(lt,t0,chars,cps=38)=>(lt-t0)*cps/Math.max(1,chars);

// ---------- win stamp (the game's CLEARED! stamp) ----------
function starPath(c,x,y,r){c.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.45:r;c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}c.closePath();}
function cleared(lt,t0,stars,ink,cx=960,cy=470){if(lt<t0)return;const a=lt-t0;
  stampText('CLEARED!',cx,cy,{size:230,ink,age:a,rot:-.12,align:'center',frame:true,paperBack:.55,spacing:.06,off:.04,base:'middle'});
  for(let i=0;i<3;i++){const ta=a-.38-i*.3;if(ta<0)continue;const down=ta<2/FPS,x=cx-170+i*170,y=cy+215+[-8,6,-2][i],r=down?74:70;
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
// The scenes. Times are local seconds; each scene starts on a beat (120 BPM, a beat = 0.5 s).
// =====================================================================================
const SC=[];
const scene=(name,dur,init,frame)=>SC.push({name,dur,init,frame});
const L_=id=>LEVELS.findIndex(l=>l.id===id);
const sol=(id,i=0)=>LEVELS[L_(id)].solutions[i];

// A "draw it, swoop, ride it" shot. opts: plan, swoopAt, swoopMs, policy, cap(lt, st) for captions.
function drawRideScene(name,dur,id,opts){scene(name,dur,()=>{const sh=new Shot(L_(id));
    return{sh,plan:opts.plan(sh).map(p=>({...p})),rideAt:opts.swoopAt+opts.swoopMs/1000,rode:false};},
  (lt,st)=>{const sh=st.sh;curInk=sh.ink;
    if(lt<opts.swoopAt){drawPlan(sh,st.plan,lt);sh.drawSide(T);deskBg();sheetFurniture(sh);place(scr,SIDE);}
    else if(lt<st.rideAt){if(!sh.world){drawPlan(sh,st.plan,1e9);sh.startRide(opts.policy||'auto');}
      const p=clamp((lt-opts.swoopAt)/(opts.swoopMs/1000),0,1);sh.drawSwoop(T,p);deskBg();sheetFurniture(sh,1-clamp(p*3,0,1));place(scr,mixLay(SIDE,FULL,ease(p)));}
    else{if(!st.rode){st.rode=true;sfx('transition',1);}sh.step();sh.drawRide(T);deskBg();place(scr,FULL);}
    opts.cap&&opts.cap(lt,st);});}

// 1 · COLD OPEN — draw a line, then ride it (0 – 6 s)
drawRideScene('open',6,'first-line',{swoopAt:1.9,swoopMs:1100,
  plan:()=>[{item:sol('first-line')[0],t0:.45,t1:1.6}],
  cap:(lt,st)=>{
    if(lt<2.3){const a=lt<1.9?1:1-(lt-1.9)/.4;stampText('DRAW',70,340,{size:190,age:lt-.1,rot:-.05,alpha:a});stampText('A LINE.',74,500,{size:150,maxW:330,age:lt-.35,rot:-.04,alpha:a});}
    if(lt>=3.0){stampText('NOW',80,200,{size:130,age:lt-3.0,rot:-.06});stampText('RIDE IT.',84,370,{size:190,age:lt-3.25,rot:-.05});}}});

// 2 · TITLE — three plates stamp the wordmark (6 – 9 s)
scene('title',3,()=>({sh:new Shot(L_('springy'))}),(lt,st)=>{const L=st.sh.L,ink=st.sh.ink;curInk=ink;
  if(DRY){if(lt===0){sfx('stamp',0);}if(Math.abs(lt-.5)<1e-6)sfx('stamp',1);if(Math.abs(lt-1)<1e-6)sfx('stamp',2);return;}
  deskBg();const s=1.28+lt*.03;ox.save();ox.globalAlpha=.55;ox.translate(FW/2,FH/2);ox.scale(s,s);ox.drawImage(prints.get(L.id).ride,-FW/2,-FW*5/16,FW,FW*10/16);ox.restore();
  ox.fillStyle=PAPER;ox.globalAlpha=.35;ox.fillRect(0,0,FW,FH);ox.globalAlpha=1;colourBar(ink);
  const plates=[[ink.light,26,19,0],[ink.mid,13,9.5,.5],[ink.key,0,0,1]];
  for(const[col,dx,dy,t0]of plates){if(lt<t0)continue;const a=lt-t0,down=a<2/FPS;
    lx.setTransform(1,0,0,1,0,0);lx.clearRect(0,0,FW,FH);lx.font=`900 ${down?322:310}px ${STENCIL}`;lx.letterSpacing='14px';lx.textAlign='center';lx.textBaseline='middle';
    lx.fillStyle=col;lx.fillText('RISO RIDER',FW/2+dx,500+dy);lx.globalCompositeOperation='destination-out';lx.fillStyle=inkMask;lx.fillRect(0,0,FW,FH);lx.globalCompositeOperation='source-over';
    ox.save();ox.globalCompositeOperation='multiply';if(down)ox.filter='brightness(.7)';ox.drawImage(lay,0,down?4:0);ox.restore();}
  typeText('Draw a track in 2D. Then ride it in first person.',FW/2,760,{size:48,progress:typeP(lt,1.45,49,60),align:'center',bg:.8});
  typeText('a physics puzzle, printed like a risograph',FW/2,840,{size:34,color:ink.key,progress:typeP(lt,2.2,42,70),align:'center',alpha:.9,bg:.8});},true);
// sound for the title plates, logged at the right beats
SC[SC.length-1].sounds=[[0,'stamp',0],[.5,'stamp',1],[1,'stamp',2]];

// 3 · TOOLS — four tools, one level each (9 – 23 s)
const toolCap=(big,small,y0=330)=>(lt,st)=>{const rideAt=st.rideAt;
  if(lt<st.rideAt-.3){stampText(big,70,y0,{size:170,maxW:340,age:lt-.02,rot:-.05});typeText(small,76,y0+80,{size:40,progress:typeP(lt,.25,small.length,45)});}
  else if(lt>=rideAt){stampText(big,70,210,{size:150,maxW:520,age:lt-rideAt,rot:-.05});typeText(small,78,285,{size:40,bg:.85});}};
const QUICK=420;
drawRideScene('lines',3.5,'tightrope',{swoopAt:.8,swoopMs:QUICK,plan:()=>[{item:sol('tightrope')[0],t0:.05,t1:.75}],cap:toolCap('LINES','become tightropes.')});
drawRideScene('ropes',3.5,'springy',{swoopAt:.8,swoopMs:QUICK,plan:()=>[{item:sol('springy',2)[0],t0:.1,t1:.65}],cap:toolCap('ROPES','become trampolines.')});
drawRideScene('wind',3.5,'updraft',{swoopAt:.8,swoopMs:QUICK,plan:()=>[{item:sol('updraft')[0],t0:.05,t1:.75}],cap:toolCap('WIND','carries you up.')});
drawRideScene('wells',3.5,'pull',{swoopAt:.8,swoopMs:QUICK,plan:()=>[{item:sol('pull')[0],t0:.3},{item:sol('pull')[1],t0:.6}],cap:toolCap('WELLS','pull you in.')});

// 4 · INK — not enough ink to reach? jump the gap (23 – 27 s)
drawRideScene('gap',4,'mind-the-gap',{swoopAt:.9,swoopMs:QUICK,plan:()=>[{item:sol('mind-the-gap')[0],t0:.15,t1:.8}],
  cap:(lt,st)=>{if(lt<st.rideAt-.3){stampText('SHORT',70,330,{size:170,maxW:340,age:lt-.02,rot:-.05});stampText('ON INK?',74,480,{size:150,maxW:340,age:lt-.25,rot:-.04});}
    const jt=st.rideAt+1.45;if(lt>=jt-.05){stampText('JUMP',80,230,{size:170,age:lt-jt+.05,rot:-.06});stampText('THE GAP.',84,390,{size:150,age:lt-jt-.2,rot:-.05});}}});

// 5 · FAILS — you will fall. a lot. (27 – 31 s)
const FAILS=[
  {id:'tightrope',items:sol('tightrope'),policy:w=>({steer:w.t>.9?1:0,jump:false,jumpHeld:false,push:0}),at:1.88,why:['Fell off the tightrope.','fall']},
  {id:'crumble',items:sol('crumble'),policy:'none',at:2.63,why:['Popped!','pop']},
  {id:'mind-the-gap',items:sol('mind-the-gap'),policy:'none',at:2.22,why:['Popped!','pop']},
  {id:'first-line',items:sol('first-line',1),policy:'none',at:2.32,why:['Fell off the edge.','fall']}];
FAILS.forEach((F,i)=>scene('fail'+i,1,()=>{const sh=new Shot(L_(F.id),F.items);sh.startRide(F.policy);sh.preroll(F.at-.7);return{sh};},(lt,st)=>{
  const sh=st.sh;curInk=sh.ink;
  if(lt<.72){sh.step();sh.drawRide(T);deskBg();place(scr,FULL);}
  else{if(!st.ghost){const w=sh.world;st.ghost=true;sh.S.mode='edit';sh.S.falls=i+1;sh.S.settings.reducedMotion=true;
      sh.S.ghost={path:w.path,events:w.events,status:w.status,at:[clamp(w.rider.x,0,P.W),clamp(w.rider.y,0,P.H)]};sfx('ui','slip');}
    sh.drawSide(T);deskBg();sheetFurniture(sh);place(scr,SIDE);slip([F.why[0],'R ride again · E edit your drawing'],F.why[1],sh.ink,1150,116,clamp((lt-.72)/.1,0,1));}
  const tot=i+lt;stampText('YOU WILL',70,lt<.72?200:560,{size:150,maxW:360,age:tot-.05,rot:-.05,paperBack:lt<.72?.5:0});
  stampText('FALL.',70,lt<.72?360:720,{size:190,maxW:360,age:tot-.3,rot:-.04,paperBack:lt<.72?.5:0});
  if(tot>=2){stampText('A LOT.',80,lt<.72?540:900,{size:170,maxW:360,age:tot-2,rot:.03,paperBack:lt<.72?.5:0});}
  if(lt>=.72)typeText(`${i+1} ${i?'FALLS':'FALL'} · no waiting, ride again`,440,1060-6,{size:24,alpha:0});}));

// 6 · INKS — ten levels, each printed in its own inks (31 – 33.5 s)
scene('inks',2.5,()=>{const r=rng(42);return{sheets:LEVELS.map((L,i)=>{const items=L.solutions[0],sh=new Shot(i,items);
    const res=P.simulate(L,items,{policy:'auto'}),w=res.world;sh.S.ghost={path:w.path,events:w.events,status:'win',at:[w.rider.x,w.rider.y]};sh.S.settings.reducedMotion=true;
    return{sh,lay:{cx:1170+(r()-.5)*110,cy:565+(r()-.5)*60,s:.6,rot:(r()-.5)*.14},img:null};})};},
  (lt,st)=>{const k=Math.min(9,Math.floor(lt/.25)),a=lt-k*.25;
    if(a<1e-6)sfx('ui','next');
    if(DRY)return;deskBg();
    for(let j=0;j<k;j++){const s=st.sheets[j];if(!s.img){s.img=cv(GW,GH);s.sh.drawSide(T);s.img.getContext('2d').drawImage(scr,0,0);}curInk=s.sh.ink;place(s.img,s.lay,{marks:false});}
    const s=st.sheets[k];curInk=s.sh.ink;s.sh.drawSide(T);const drop=a<3/FPS?1.06-.02*Math.floor(a*FPS):1;place(scr,{...s.lay,s:s.lay.s*drop});
    stampText(`${String(k+1).padStart(2,'0')}`,70,330,{size:230,age:a,rot:-.05});
    stampText('LEVELS',74,470,{size:130,age:lt,rot:-.04});
    typeText('each one printed',78,560,{size:38,progress:typeP(lt,.3,16,40)});typeText('in its own inks.',78,610,{size:38,progress:typeP(lt,.7,16,40)});});

// 7 · FINALE — mix every tool, then CLEARED! (33.5 – 39.5 s)
drawRideScene('finale',6,'grand-tour',{swoopAt:1.1,swoopMs:1100,
  plan:()=>[{item:sol('grand-tour')[0],t0:.1,t1:.6},{item:sol('grand-tour')[1],t0:.85}],
  cap:(lt,st)=>{if(lt<1.4){const a=lt<1.1?1:1-(lt-1.1)/.3;stampText('MIX',70,330,{size:190,age:lt-.02,rot:-.05,alpha:a});stampText('EVERY',74,480,{size:150,maxW:330,age:lt-.25,rot:-.04,alpha:a});stampText('TOOL.',74,630,{size:150,maxW:330,age:lt-.45,rot:-.05,alpha:a});}
    const w=st.sh.world;if(w&&w.status==='win'){if(st.winT==null){st.winT=lt;st.stars=P.stars(st.sh.L,P.inkUsed(st.sh.S.items),w.refund||0);}
      const t0=st.winT+.18;if(Math.abs(lt-t0)<DTF/2)sfx('stamp',0);for(let i=0;i<st.stars;i++)if(Math.abs(lt-(t0+.38+i*.3))<DTF/2)sfx('stamp',i+1);
      cleared(lt,t0,st.stars,st.sh.ink);}}});

// 8 · END CARD (39.5 – 44.5 s)
scene('end',5,()=>({ink:inksOf(LEVELS[L_('mind-the-gap')])}),(lt,st)=>{const ink=st.ink;curInk=ink;
  const line=[[470,560],[760,548],[1060,572],[1330,556]],d=dens(line,3),dk=clamp((lt-.35)/.6,0,1),n=Math.floor(dk*(d.length-1));
  if(Math.abs(lt-.35)<DTF/2)sfx('draw','line','start',0);if(lt>.35&&lt<.95)sfx('draw','line','move',1400);if(Math.abs(lt-.95)<DTF/2)sfx('draw','line','end',0);
  const rideK=clamp((lt-1.05)/1.25,0,1),ri=Math.floor(ease(rideK)*(d.length-1)),bp=d[Math.min(d.length-1,ri)],goal=[1420,516];
  if(Math.abs(lt-2.3)<DTF/2)sfx('event',{type:'win'});
  if(DRY)return;deskBg();colourBar(ink);
  stampText('RISO RIDER',FW/2,430,{size:250,age:lt-.05,align:'center',spacing:.05,off:.03});
  ox.save();ox.lineCap='round';ox.lineJoin='round';ox.globalCompositeOperation='multiply';
  for(const[col,o]of[[ink.mid,4],[ink.key,0]]){ox.strokeStyle=col;ox.lineWidth=8;ox.beginPath();d.slice(0,n+1).forEach((p,i)=>ox[i?'lineTo':'moveTo'](p[0]+o,p[1]+o*.7));ox.stroke();}
  ox.strokeStyle=ink.key;ox.lineWidth=7;ox.beginPath();ox.arc(goal[0],goal[1],34,0,TAU);ox.stroke();ox.strokeStyle=ink.mid;ox.setLineDash([9,10]);ox.lineWidth=4;ox.beginPath();ox.arc(goal[0],goal[1],48,0,TAU);ox.stroke();ox.restore();
  if(dk<1){const p=d[n];ox.save();ox.translate(0,0);ox.scale(1,1);pencilAt(p,ink);ox.restore();}
  else{const past=lt>2.3,x=past?goal[0]+(lt-2.3)*260:bp[0],y=past?goal[1]+Math.pow(lt-2.3,2)*0:bp[1]-24;riderBall(x,past?goal[1]:y,22,ink,lt*9);}
  stampText('DRAW IT. RIDE IT.',FW/2,720,{size:110,age:lt-1.3,align:'center',spacing:.05});
  typeText('Free · plays in your browser · install it on your phone',FW/2,815,{size:38,progress:typeP(lt,1.9,54,70),align:'center'});
  typeText('tbone94.github.io/Riso-Rider',FW/2,920,{size:56,progress:typeP(lt,2.7,28,40),align:'center'});
  if(lt>2.7+.7){ox.fillStyle=ink.mid;ox.fillRect(FW/2-420,940,840,5);}
  if(lt>4.4){ox.fillStyle=PAPER;ox.globalAlpha=0;ox.fillRect(0,0,FW,FH);ox.globalAlpha=1;}});
function pencilAt(p,ink){ox.save();ox.translate(p[0],p[1]);ox.scale(2.2,2.2);pencil(ox,[0,0],ink);ox.restore();}

// scene start times
let TOTAL=0;SC.forEach(s=>{s.t0=TOTAL;TOTAL+=s.dur;});

// =====================================================================================
// Running the timeline
// =====================================================================================
async function prepare(){await document.fonts.load(`900 40px ${STENCIL}`);await document.fonts.load(`20px ${MONO}`);
  for(const L of LEVELS)await printLevel(L);}
// Render every frame in order; onFrame(f, t) after each one is composed on `out`.
async function run(onFrame,{from=0,to=TOTAL}={}){LOG.length=0;RID=0;
  for(const s of SC){if(s.t0+s.dur<=from-1e-9&&!DRY)continue;const n=Math.round(s.dur*FPS);T=s.t0;const st=s.init();
    for(let f=0;f<n;f++){T=s.t0+f/FPS;if(T>=to)return;
      if(s.sounds)for(const[at,name,arg]of s.sounds)if(Math.abs(f/FPS-at)<DTF/2)sfx(name,arg);
      s.frame(f/FPS,st);
      if(!DRY&&T>=from-1e-9)await onFrame(Math.round(T*FPS),T);}}}

// ---------- music: 120 BPM, C – Am – F – G, built in the same offline context ----------
const BEAT=.5,BAR=2;
const CH=[[48,[60,64,67,72]],[45,[57,60,64,69]],[41,[57,60,65,69]],[43,[55,59,62,67]]];   // bass root, chord (MIDI)
const mtof=m=>440*Math.pow(2,(m-69)/12);
// sections in beats: what plays where
const SECT=[[0,4,'intro'],[4,6,'roll'],[6,12,'full'],[12,16,'title'],[16,18,'rise'],[18,54,'full'],[54,62,'fails'],[62,67,'full'],[67,77,'full'],[77,79,'final'],[79,89,'end']];
function music(ac,dest){const noise=(()=>{const b=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),d=b.getChannelData(0),r=rng(5);for(let i=0;i<d.length;i++)d[i]=r()*2-1;return b;})();
  const bus=ac.createGain();bus.gain.value=.5;const comp=ac.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=3;comp.attack.value=.005;comp.release.value=.15;
  bus.connect(comp);comp.connect(dest);
  const drums=ac.createGain();drums.connect(bus);const tone=ac.createGain();tone.connect(bus);
  const room=ac.createConvolver();{const len=ac.sampleRate*1.2,ir=ac.createBuffer(2,len,ac.sampleRate),r=rng(9);for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++)d[i]=(r()*2-1)*Math.exp(-i/ac.sampleRate/.25);}room.buffer=ir;}
  const rs=ac.createGain();rs.gain.value=.22;tone.connect(rs);rs.connect(room);room.connect(bus);
  const env=(p,t,a,peak,d)=>{p.setValueAtTime(0,t);p.linearRampToValueAtTime(peak,t+a);p.exponentialRampToValueAtTime(.0005,t+a+d);};
  const nz=(t,dur,type,f,q,peak,d,to=drums)=>{const s=ac.createBufferSource();s.buffer=noise;const fl=ac.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=q;const gg=ac.createGain();env(gg.gain,t,.002,peak,d);s.connect(fl);fl.connect(gg);gg.connect(to);s.start(t,Math.random()*1.5);s.stop(t+dur);return{s,fl,gg};};
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
  const sect=b=>{for(const[a,e,n]of SECT)if(b>=a&&b<e)return n;return null;};
  const melody=[[0,76],[1.5,79],[2,81],[3,79],[4,76],[5.5,74],[6,72],[7,74],[8,76],[9.5,79],[10,81],[11,84],[12,81],[13.5,79],[14,76],[15,74]];   // 4 bars, in beats
  const nb=89;
  for(let b=0;b<nb;b++){const t=b*BEAT,s=sect(b),bar=Math.floor(b/4),ch=CH[bar%4],inBar=b%4;
    if(s==='intro'){kick(t,.7,true);if(inBar===0)pad(t,ch[1],2,1);if(b>=2)hat(t+.25,.5);if(b===2)riser(t,1.0,.8);}
    if(s==='roll'){kick(t,.8,true);for(let k=0;k<(b===4?2:4);k++)snare(t+k*(b===4?.25:.125),.25+.12*k+(b-4)*.2);}
    if(s==='full'||s==='fails'){
      const half=s==='fails';
      if(!half||inBar%2===0)kick(t,1);if(!half&&inBar===1)kick(t+.25,.55);
      if(inBar===1||inBar===3)snare(t,half?.8:1);
      hat(t+.25,.9);if(!half){hat(t,.4);shaker(t+.125,.8);shaker(t+.375,.8);}
      bass(t,ch[0],.2,1);bass(t+.25,ch[0]+12,.18,.7);
      piano(t+.25,ch[1][1],.55,.35);piano(t+.25,ch[1][2],.5,.35);piano(t+.25,ch[1][3],.45,.35);   // offbeat stabs
      if(inBar===0)pad(t,ch[1],2,.6);
      if(b>=18&&b<54){const mb=(b-18)%16;for(const[at,m]of melody)if(Math.floor(at)===mb)piano(t+(at-mb)*BEAT,m+12,.9,1.4);}}
    if(s==='title'){if(inBar===0&&b===12)pad(t,[53,57,60,65],4,1.2);if(b===12){kick(t,1.1);piano(t,41,1,2);piano(t,53,.8,2);}}
    if(s==='rise'){if(b===16){pad(t,[55,59,62,67],1,1.2);riser(t,1,1);}snare(t,.35+(b-16)*.25);snare(t+.25,.4+(b-16)*.25);if(b===17)for(let k=0;k<4;k++)snare(t+k*.125,.5+k*.12);}
    if(s==='final'){if(b===77){kick(t,1.1);snare(t,.8);}}
    if(s==='end'){if(b===79){pad(t,[48,55,60,64,67],5,1.3);piano(t,48,.9,3);piano(t,60,.8,3);piano(t,64,.7,3);piano(t,67,.7,3);}
      if(b>=80&&b<86){const arp=[72,76,79,84,79,76];piano(t,arp[b-80],.45,1);}}}
  // the drop after the swoop, the title slam, the finale landing
  for(const tt of[3.0,9.0])riser(tt-1.0,1.0,.5);
  // fails: the music cuts out for each crash
  const F0=54*BEAT;for(let i=0;i<4;i++){const tf=F0+i+.66,p=bus.gain;p.setValueAtTime(.5,tf);p.linearRampToValueAtTime(.04,tf+.05);p.setValueAtTime(.04,tf+.3);p.linearRampToValueAtTime(.5,tf+.34);}
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
async function preview(){await run(async(f,t)=>{show();status(`${t.toFixed(2)}s`);await raf();});}

window.trailer={SC,run,contactSheet,frames,renderMP4,preview,renderAudio,get TOTAL(){return TOTAL;},LOG};
await prepare();
status(`ready · ${TOTAL}s · ${SC.length} scenes`);
$('#bPlay').onclick=preview;$('#bSheet').onclick=()=>contactSheet();$('#bRender').onclick=renderMP4;
const h=location.hash;
try{if(h==='#sheet')await contactSheet();else if(h.startsWith('#frames='))await frames(h.slice(8).split(','));else if(h==='#render')await renderMP4();}
catch(e){console.error(e);status('error: '+e.message);window.RENDER_ERR=String(e&&e.stack||e);}
