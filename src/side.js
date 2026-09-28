// side.js — the side view: renderer, drawing editor, and the ghost trail of the last ride.
// Contract (ARCHITECTURE.md): createSide({canvas,getState,hooks}) -> {draw(g,t), destroy()}
//   draw(g,t)  g is already in 800×500 design units; t is seconds. Paints in the level's inks on a
//              transparent canvas that is multiplied over the printed backdrop.
//   editor     pointer handlers on `canvas`, active only while S.mode==='edit'. Writes S.stroke and
//              S.items, enforces the ink budget and the well keep-out, calls hooks.onChange() on
//              every change, hooks.flashInk() when out of ink, hooks.toast(msg) for refusals.
//
// First-person width is drawn as each ribbon's far edge, projected obliquely "into the page"
// (up and to the right). A drawn line gets a thin double hairline (a tightrope), a rope a medium
// band, a block a wide road band. The ghost trail shifts along the same direction by the rider's z,
// so a rider who drifted off a tightrope visibly leaves its band before falling.
import * as P from './physics.js';
import {W,H,R,DT,G,COST,WIDTH,WIND,WELL,STATE,itemCost as physItemCost,polyLen,makeRope,closest} from './physics.js';

const TAU=Math.PI*2;
// ---------- the sling (contract v4), feature-detected until physics lands it ----------
const SLING_FALLBACK={rc:34,ro:27,minSpeed:320,maxSpeed:700,boost:1.1,cooldown:.5,keepOut:80};
const SL=()=>({...SLING_FALLBACK,...(P.SLING||{})});
const slingCost=()=>COST.sling!=null?COST.sling:120;
// Costs that understand sling items even before physics.js knows them.
function itemCost(it){return it.type==='sling'?slingCost():physItemCost(it);}
const inkUsed=items=>items.reduce((s,it)=>s+itemCost(it),0);
// The first stretch of the fling after release: physics' own slingPreview when present, else a matching estimate.
function slingArc(sl,speed=450,t=.45){if(typeof P.slingPreview==='function'){try{const r=P.slingPreview(sl,speed,t,0);/* dir 0: the centre line; the real exit is ±ro either side, depending on which way the rider orbits */if(r&&r.length)return r;}catch(_){}}
  const k=SL(),ux=Math.cos(sl.a),uy=Math.sin(sl.a),v=Math.min(k.maxSpeed,Math.max(speed,k.minSpeed)*k.boost);
  // release where the orbit's tangent equals the aim (the side that turns clockwise on screen)
  const x0=sl.x+uy*k.ro,y0=sl.y-ux*k.ro,out=[];
  for(let i=0;i<=18;i++){const tt=t*i/18;out.push([x0+ux*v*tt,y0+uy*v*tt+.5*G*tt*tt]);}return out;}
// Well pull at distance d. Uses physics' wellForce(d) when it exists (it replaces the old falloff), else the
// v1 formula with the current constants. Read WELL.range live: physics may retune it.
function wellForce(d){if(typeof P.wellForce==='function')return P.wellForce(d);
  return d<WELL.range&&d>1?Math.min(WELL.max,WELL.k/(d*d+400))*(1-Math.pow(d/WELL.range,2)):0;}
const DEPTH=(()=>{const l=Math.hypot(.5,1);return[.5/l,-1/l];})();  // screen direction of +z
const band=hw=>Math.max(0,1.4*Math.sqrt(hw)-1.6);  // side-view depth of a half-width: line 3.4, rope 5.3, block 10.1
const Z_MAX=14;                                     // cap on how far ghost marks shift for |z|
const SAMPLE=6, STREAM=.3, SNAP=12, CHAIKIN=2, MIN_GAP=3.5, MIN_LEN=10, MIN_ROPE=24;
const REASON={fell:'FELL',popped:'POPPED',stuck:'STUCK',timeout:'STUCK'};
const WIDTH_NAME={line:'TIGHTROPE',rope:'TRAMPOLINE',wind:'TAILWIND'};
const GHOST_SPACING=[6,13,8,12,5];   // ...and 4 = orbiting in a sling                    // arc-length between marks per state: ground, air, rope, wind
const MONO='ui-monospace,Menlo,Consolas,monospace';
// Touch drawing: the line goes exactly where the finger is (the player asked for this over an offset pen),
// and a LOUPE_PX magnifier beside the finger shows what the fingertip is covering. OFF_PX>0 would restore an offset pen.
const OFF_PX=0, LOUPE_PX=90, LOUPE_ZOOM=2;
// Touch draws like a finger on paper: no loupe, no crosshair/tether, no trailing, no reshaping on lift. The aids
// are kept in the code behind TOUCH_AIDS in case they come back. TOUCH_SAMPLE is the finer touch sampling step,
// TOUCH_SNAP the tight start-snap radius (ledge corners only).
const TOUCH_AIDS=false, TOUCH_SAMPLE=4, TOUCH_SNAP=8;
// The two faces from UI.md: the stencil for labels and stamps, the typewriter for small typed notes.
const STENCIL=`'Big Shoulders Stencil Display',${MONO}`, TYPE=`'Cutive Mono',${MONO}`;

// ---------- geometry helpers ----------
const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const r1=v=>Math.round(v*10)/10;
function path(g,p,dx=0,dy=0){g.beginPath();g.moveTo(p[0][0]+dx,p[0][1]+dy);for(let i=1;i<p.length;i++)g.lineTo(p[i][0]+dx,p[i][1]+dy);}
function offsetPts(p,d){return p.map((q,i)=>{const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return[q[0]-dy/l*d,q[1]+dx/l*d];});}
function inside(pt,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
  if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
// Chaikin corner cutting that keeps both endpoints (so snapped ends stay snapped). Never lengthens.
function chaikin(p,passes){for(let k=0;k<passes&&p.length>2;k++){const o=[p[0]];
  for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];if(i>0)o.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25]);if(i<p.length-2)o.push([a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);}
  o.push(p[p.length-1]);p=o;}return p;}
function decimate(p,gap){const o=[p[0]];for(let i=1;i<p.length-1;i++)if(dist(o[o.length-1],p[i])>=gap)o.push(p[i]);
  const e=p[p.length-1];if(o.length>1&&dist(o[o.length-1],e)<gap*.5)o[o.length-1]=e;else o.push(e);return o;}
// Cut a polyline so its cost fits `room` ink.
function trim(p,unit,room){let used=0;const o=[p[0]];for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],c=dist(a,b)*unit;
  if(used+c<=room+1e-6){o.push(b);used+=c;continue;}const f=(room-used)/c;if(f>.02)o.push([r1(a[0]+(b[0]-a[0])*f),r1(a[1]+(b[1]-a[1])*f)]);break;}
  // rounding a cut point can nudge the cost over by a hair; drop points until it fits
  while(o.length>2&&polyLen(o)*unit>room+1e-6)o.pop();return o;}
// Surface edges of a block polygon whose outward normal faces up: the parts you can ride on.
const topCache=new WeakMap();
function topEdges(poly){let e=topCache.get(poly);if(e)return e;e=[];
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);if(l<1)continue;
    let nx=dy/l,ny=-dx/l;const m=[(a[0]+b[0])/2+nx,(a[1]+b[1])/2+ny];if(inside(m,poly)){nx=-nx;ny=-ny;}
    if(ny<-.5)e.push([a,b]);}
  topCache.set(poly,e);return e;}
// Stable pseudo-random numbers for hand-stamped wobble.
function hash(i,s){let h=Math.imul(i+1,374761393)^Math.imul(s|0,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}

export function createSide({canvas,getState,hooks={}}){
  try{if(typeof document!=='undefined'&&document.fonts){document.fonts.load(`800 12px ${STENCIL}`);document.fonts.load(`13px ${TYPE}`);}}catch(_){}
  const call=(k,...a)=>{if(typeof hooks[k]==='function')hooks[k](...a);};
  // editor state lives here, not on the items (items stay plain data for sharing)
  const ed={id:null,sm:null,raw:null,full:false,flashAt:-1e9,hover:null,ghostRef:null,ghostT0:0,lastT:0,
    touch:false,finger:null,aim:false,loupeSide:0,u:1,penT:0,penP:null,drag:null,cursor:''};
  const S_=()=>getState();
  const editing=()=>{const S=S_();return S&&S.level&&S.mode==='edit';};
  const pos=e=>{const r=canvas.getBoundingClientRect();return[(e.clientX-r.left)/r.width*W,(e.clientY-r.top)/r.height*H];};
  const unitsPerPx=()=>{const r=canvas.getBoundingClientRect();return r.width>0?W/r.width:1;};
  // Legibility on small screens: below ~640 CSS px of stage (more than 1.25 design units per pixel) text never
  // drops under its CSS minimum and marks grow gently with it. Larger stages (desktop) are left exactly as designed.
  const SMALL=1.25;
  const fsz=(design,css)=>ed.u>SMALL?Math.max(design,css*ed.u):design;
  const grow=()=>ed.u>SMALL?Math.min(1.8,1+(ed.u-SMALL)*.5):1;
  // Where the pen is. Mouse and stylus draw exactly under the pointer. A finger draws OFF_PX above itself; near the
  // top of the sheet the offset ramps down (monotonic, so the pen never jumps) so the very top is still reachable.
  function penOf(e,touch){const p=pos(e);if(!touch||!OFF_PX)return p;const off=OFF_PX*unitsPerPx(),eff=off*clamp(p[1]/(1.5*off),0,1);return[p[0],p[1]-eff];}
  // Drawing phases for sound (app.js hooks.draw): start / move with pen speed in design units per second / end.
  function phase(tool,ph,p){const n=performance.now();let sp=0;
    if(ph==='move'&&ed.penP){sp=Math.min(4000,dist(ed.penP,p)/Math.max(.001,(n-ed.penT)/1000));}
    if(p){ed.penP=p;ed.penT=n;}call('draw',tool,ph,sp);}
  const room=()=>{const S=S_();return S.level.ink-inkUsed(S.items);};
  const flash=(force)=>{const n=performance.now();if(force||n-ed.flashAt>450){ed.flashAt=n;call('flashInk');}};  // throttled while dragging

  // ---------- drag to adjust: wells by their centre, ropes by either anchor ----------
  // Returns {kind:'well',i} or {kind:'rope',i,end:'a'|'b'} for the handle under p, topmost (latest) first.
  const aimTip=it=>{const k=SL(),r=k.rc+22;return[it.x+Math.cos(it.a)*r,it.y+Math.sin(it.a)*r];};
  function handleAt(S,p,rad){let best=null,bd=rad;
    // a sling's aim handle wins over everything; its body is grabbable anywhere inside the ring
    for(let i=S.items.length-1;i>=0;i--){const it=S.items[i];if(it.type!=='sling')continue;
      const d=dist(p,aimTip(it));if(d<Math.max(rad,bd)*1.15){return{kind:'aim',i};}}
    for(let i=S.items.length-1;i>=0;i--){const it=S.items[i];if(it.type!=='sling')continue;
      if(Math.hypot(p[0]-it.x,p[1]-it.y)<SL().rc+2)return{kind:'sling',i};}
    for(let i=S.items.length-1;i>=0;i--){const it=S.items[i];
      if(it.type==='well'){const d=Math.hypot(p[0]-it.x,p[1]-it.y);if(d<bd){bd=d;best={kind:'well',i};}}
      else if(it.type==='rope')for(const end of['a','b']){const d=dist(p,it[end]);if(d<bd){bd=d;best={kind:'rope',i,end};}}}
    return best;}
  const grabRad=touch=>touch?Math.max(14,22*ed.u):Math.max(12,11*ed.u);
  function setCursor(c){if(ed.cursor===c)return;ed.cursor=c;canvas.style.cursor=c;}
  function startDrag(S,h,e,touch,p){const it=S.items[h.i];
    ed.drag={...h,before:JSON.parse(JSON.stringify(S.items)),orig:JSON.parse(JSON.stringify(it)),moved:false,
      grab:h.kind==='well'||h.kind==='sling'?[it.x-p[0],it.y-p[1]]:h.kind==='aim'?[0,0]:[it[h.end][0]-p[0],it[h.end][1]-p[1]]};   // relative: nothing jumps on pickup
    S.items[h.i]=JSON.parse(JSON.stringify(it));   // a fresh object: the snapshot never shares state with the live item
    try{canvas.setPointerCapture(e.pointerId);}catch(_){}
    ed.id=e.pointerId;if(!touch)setCursor('grabbing');}
  function dragTo(S,p,fine){const d=ed.drag,it=S.items[d.i];if(!it)return;const q=[p[0]+d.grab[0],p[1]+d.grab[1]];d.moved=true;
    if(d.kind==='aim'){let a=Math.atan2(q[1]-it.y,q[0]-it.x);if(!fine){const st=Math.PI/36;a=Math.round(a/st)*st;}   // 5° steps; Shift = free
      it.a=Math.round(a*1e4)/1e4;return;}
    if(d.kind==='well'||d.kind==='sling'){it.x=r1(clamp(q[0],0,W));it.y=r1(clamp(q[1],0,H));return;}
    const fixed=it[d.end==='a'?'b':'a'];let b=snapAt(S,q,fixed)||q;
    // ink budget: everything else stays, this rope may use what's left (length × COST.rope)
    const others=inkUsed(S.items)-itemCost(it),max=Math.max(MIN_ROPE,(S.level.ink-others)/COST.rope-.15),len=dist(fixed,b);
    if(len>max){const f=max/len;b=[fixed[0]+(b[0]-fixed[0])*f,fixed[1]+(b[1]-fixed[1])*f];flash();}
    else if(len<MIN_ROPE&&len>1e-3){const f=MIN_ROPE/len;b=[fixed[0]+(b[0]-fixed[0])*f,fixed[1]+(b[1]-fixed[1])*f];}
    it[d.end]=[r1(b[0]),r1(b[1])];}
  function endDrag(S,commit){const d=ed.drag;ed.drag=null;if(!d)return;const it=S.items[d.i];
    if(commit&&it&&(d.kind==='well'||d.kind==='sling')){const G0=S.level.goal,ko=d.kind==='sling'?SL().keepOut:WELL.keepOut;
      if(Math.hypot(it.x-G0.x,it.y-G0.y)<ko){S.items[d.i]=d.orig;call('toast','Too close to the ring');call('onChange');return;}}
    if(!commit){S.items[d.i]=d.orig;call('onChange');return;}
    if(d.moved&&JSON.stringify(it)!==JSON.stringify(d.orig)){call('moved',d.before);const tool=d.kind==='aim'?'sling':d.kind;phase(tool,'start',null);phase(tool,'end',null);}
    call('onChange');}

  // Block corners on a ridable top edge snap LINE_TH below the corner, so a drawn line's top sits flush with the
  // block's top. Snapping onto the corner itself leaves the line's thickness as a lip the rider bumps into and sticks on.
  const LINE_TH=2.5;   // physics: drawn-line segments have th 2.5 (build() in physics.js)
  function snapTargets(S){const out=[];
    for(const k of['blocks','ice','crumble'])(S.level[k]||[]).forEach(p=>{const tops=new Set();topEdges(p).forEach(([a,b])=>{tops.add(a);tops.add(b);});
      p.forEach(q=>out.push(tops.has(q)?[q[0],q[1]+LINE_TH]:q));});
    S.items.forEach(it=>{if(it.type==='line'||it.type==='wind'){if(it.pts.length){out.push(it.pts[0]);out.push(it.pts[it.pts.length-1]);}}
      else if(it.type==='rope'){out.push(it.a);out.push(it.b);}});
    return out;}
  function ledgeSnap(S,p){let best=null,bd=TOUCH_SNAP;
    for(const k of['blocks','ice','crumble'])(S.level[k]||[]).forEach(poly=>{const tops=new Set();topEdges(poly).forEach(([a,b])=>{tops.add(a);tops.add(b);});
      poly.forEach(q=>{const t=tops.has(q)?[q[0],q[1]+LINE_TH]:q,d=dist(t,p);if(d<bd){bd=d;best=t;}});});
    return best;}
  function snapAt(S,p,except){let best=null,bd=SNAP;for(const q of snapTargets(S)){if(except&&dist(q,except)<1)continue;const d=dist(q,p);if(d<bd){bd=d;best=q;}}return best;}
  const snap=(S,p,except)=>{const q=snapAt(S,p,except);return q?[q[0],q[1]]:[r1(p[0]),r1(p[1])];};

  function extend(sk,p){ // add a sample to a line/wind stroke if the ink allows; false once the budget is hit
    const last=sk.pts[sk.pts.length-1],d=dist(last,p),unit=COST[sk.type],left=room()-itemCost(sk);
    if(unit*d<=left+1e-6){sk.pts.push([r1(p[0]),r1(p[1])]);return true;}
    const f=left/(unit*d);if(f>.05)sk.pts.push([last[0]+(p[0]-last[0])*f,last[1]+(p[1]-last[1])*f]);  // spend exactly what's left
    ed.full=true;flash();return false;}

  function down(e){
    if(!editing()||ed.id!==null||(e.button!==undefined&&e.button!==0))return;
    const S=S_(),touch=e.pointerType==='touch',p=penOf(e,touch);e.preventDefault();
    ed.touch=touch;ed.finger=touch?pos(e):null;if(touch){ed.hover=p;const f=ed.finger[0];ed.loupeSide=f>W*.5?-1:1;}
    // pressing a well's centre or a rope anchor picks it up (a finger can press it directly or aim with the pen)
    ed.u=unitsPerPx();const h=handleAt(S,touch?ed.finger:p,grabRad(touch))||(touch?handleAt(S,p,grabRad(false)):null);
    if(h){startDrag(S,h,e,touch,p);call('onChange');return;}
    if(S.tool==='well')return;                     // legacy: wells can still be moved, but no longer placed
    if(S.tool==='sling'&&!touch){placeSling(S,p);return;}
    try{canvas.setPointerCapture(e.pointerId);}catch(_){}
    ed.id=e.pointerId;ed.full=false;ed.raw=p;
    if(S.tool==='sling'){ed.aim=true;return;}   // touch: preview under the finger, place on lift
    let a;if(touch){const q=ledgeSnap(S,p);a=q?[q[0],q[1]]:[r1(p[0]),r1(p[1])];ed.snapped=!!q;}else{a=snap(S,p);ed.snapped=false;}
    ed.sm=a.slice();
    if(S.tool==='rope')S.stroke={type:'rope',a,b:a.slice()};
    else{if(room()<=0){flash(true);ed.full=true;}S.stroke={type:S.tool==='wind'?'wind':'line',pts:[a]};}
    phase(S.stroke.type,'start',a);call('onChange');}
  function slingKeep(S,p){const G0=S.level.goal;return Math.hypot(p[0]-G0.x,p[1]-G0.y)<SL().keepOut;}
  // Default aim for a new sling: the aim whose fling actually passes through the goal ring (physics' slingAim
  // accounts for gravity), so a sling dropped anywhere on the rider's path works as placed. Cached on a 4-unit grid,
  // since the hover preview asks every frame. Falls back to pointing straight at the ring.
  const aimCache=new Map();
  const aimAtGoal=(S,p)=>{const G0=S.level.goal,straight=Math.atan2(G0.y-p[1],G0.x-p[0]);
    if(typeof P.slingAim!=='function')return Math.round(straight*1e4)/1e4;
    const k=S.level.id+':'+Math.round(p[0]/4)+':'+Math.round(p[1]/4);let a=aimCache.get(k);
    if(a===undefined){try{a=P.slingAim({x:p[0],y:p[1]},G0.x,G0.y);}catch(_){a=straight;}if(aimCache.size>4000)aimCache.clear();aimCache.set(k,a);}
    return Math.round(a*1e4)/1e4;};
  function placeSling(S,p){
    if(slingKeep(S,p)){call('toast','Too close to the ring');return;}
    if(slingCost()>room()+1e-6){flash(true);return;}
    S.items.push({type:'sling',x:r1(p[0]),y:r1(p[1]),a:aimAtGoal(S,p)});phase('sling','start',p);phase('sling','end',p);call('onChange');}
  function placeWell(S,p){const G0=S.level.goal;
    if(Math.hypot(p[0]-G0.x,p[1]-G0.y)<WELL.keepOut){call('toast','Too close to the ring');return;}
    if(COST.well>room()+1e-6){flash(true);return;}
    S.items.push({type:'well',x:r1(p[0]),y:r1(p[1])});phase('well','start',p);phase('well','end',p);call('onChange');}

  function move(e){
    const S=S_();if(!S||!S.level)return;
    const mine=e.pointerId===ed.id,touch=e.pointerType==='touch';
    if(touch&&!mine)return;                       // a second finger doesn't move the pen
    ed.hover=penOf(e,touch);if(touch)ed.finger=pos(e);
    if(mine&&ed.drag){if(!editing()){cancel();return;}dragTo(S,touch?ed.hover:pos(e),e.shiftKey);call('onChange');return;}
    if(!touch&&ed.id===null)setCursor(editing()&&handleAt(S,ed.hover,grabRad(false))?'grab':'');
    if(!mine||(!S.stroke&&!ed.aim))return;
    if(!editing()){cancel();return;}
    if(ed.aim)return;
    const sk=S.stroke,evs=(e.getCoalescedEvents&&e.getCoalescedEvents())||[];if(!evs.length)evs.push(e);
    let changed=false;
    for(const ev of evs){const p=penOf(ev,touch);ed.raw=p;
      if(sk.type==='rope'){let b=(touch?null:snapAt(S,p,sk.a))||p;const len=dist(sk.a,b),max=Math.max(0,room()/COST.rope-.15);   // margin so rounding never tips it over
        if(len>max){const f=max/len;b=[sk.a[0]+(b[0]-sk.a[0])*f,sk.a[1]+(b[1]-sk.a[1])*f];flash();}
        sk.b=[r1(b[0]),r1(b[1])];changed=true;continue;}
      // light streamline: the pen trails the pointer a little, which irons out hand jitter
      // (touch: none, the stroke's head stays exactly under the finger)
      const stream=touch?0:STREAM,sample=touch?TOUCH_SAMPLE:SAMPLE;
      ed.sm[0]+=(p[0]-ed.sm[0])*(1-stream);ed.sm[1]+=(p[1]-ed.sm[1])*(1-stream);
      if(ed.full){if(dist(sk.pts[sk.pts.length-1],p)>sample*3)flash();continue;}
      if(dist(sk.pts[sk.pts.length-1],ed.sm)>=sample){extend(sk,ed.sm);changed=true;}else if(touch)changed=true;}
    if(changed){phase(sk.type,'move',ed.raw);call('onChange');}}

  function finish(e){
    if(e.pointerId!==ed.id)return;ed.id=null;
    try{canvas.releasePointerCapture(e.pointerId);}catch(_){}
    const S=S_(),sk=S&&S.stroke,wasTouch=ed.touch;
    if(wasTouch){ed.finger=null;}
    if(ed.drag){if(wasTouch)ed.hover=null;else setCursor(handleAt(S,pos(e),grabRad(false))?'grab':'');endDrag(S,editing());return;}
    if(ed.aim){ed.aim=false;const p=ed.hover;if(wasTouch)ed.hover=null;if(p&&editing())placeSling(S,p);return;}
    if(wasTouch)ed.hover=null;
    if(!sk)return;S.stroke=null;phase(sk.type,'end',null);
    if(!editing()){call('onChange');return;}
    let item=null;
    if(sk.type==='rope'){if(dist(sk.a,sk.b)>=MIN_ROPE&&itemCost(sk)<=room()+1e-6)item=sk;}
    else{let pts=sk.pts.slice();
      // land the pen where the pointer is, and snap the end to a nearby end/corner
      if(!ed.full&&ed.raw&&dist(pts[pts.length-1],ed.raw)>1)pts.push([r1(ed.raw[0]),r1(ed.raw[1])]);
      if(wasTouch){pts=decimate(pts,.6).map(q=>[r1(q[0]),r1(q[1])]);}   // touch: what you drew is what you get (just drop near-duplicates)
      else{if(pts.length>1){const q=snapAt(S,pts[pts.length-1],pts[0]);if(q)pts[pts.length-1]=[q[0],q[1]];}
        pts=decimate(chaikin(pts,CHAIKIN),MIN_GAP).map(q=>[r1(q[0]),r1(q[1])]);}
      pts=trim(pts,COST[sk.type],room());      // keep the cost honest after smoothing/snapping
      if(pts.length>1&&polyLen(pts)>=MIN_LEN)item={type:sk.type,pts};}
    if(item)S.items.push(item);
    call('onChange');}

  function cancel(){const S=S_();ed.id=null;ed.aim=false;if(ed.drag)endDrag(S,false);if(ed.touch){ed.finger=null;ed.hover=null;}
    if(S&&S.stroke){phase(S.stroke.type,'end',null);S.stroke=null;call('onChange');}}
  const leave=e=>{if(ed.id===null)ed.hover=null;};
  const lostCapture=e=>{if(e.pointerId===ed.id)finish(e);};
  const cancelled=e=>{if(e.pointerId===ed.id)cancel();};
  canvas.addEventListener('pointerdown',down);
  canvas.addEventListener('pointermove',move);
  canvas.addEventListener('pointerup',finish);
  canvas.addEventListener('pointercancel',cancelled);
  canvas.addEventListener('lostpointercapture',lostCapture);
  canvas.addEventListener('pointerleave',leave);
  if(!canvas.style.touchAction)canvas.style.touchAction='none';

  // ---------- drawing ----------
  function draw(g,t){
    const S=S_();if(!S||!S.level||!S.ink)return;
    if(S.mode!=='edit'&&ed.id!==null)cancel();
    ed.u=unitsPerPx();
    scene(g,S,t,false);
    if(S.mode==='edit'&&ed.touch&&ed.finger&&ed.hover)touchAids(g,S,t);}

  // Everything on the side-view plate. lens=true when redrawn magnified inside the touch loupe.
  function scene(g,S,t,lens){
    const L=S.level,ink=S.ink,rm=!!(S.settings&&S.settings.reducedMotion);
    const tq=rm?0:Math.floor(t*12)/12;               // animate on twos (12 fps), frozen for reduced motion
    const pat=k=>(S.pat&&S.pat[k])||ink.light;
    const edit=S.mode==='edit';
    ed.lastT=t;
    g.save();g.lineCap='round';g.lineJoin='round';g.globalAlpha=1;g.setLineDash([]);

    // goal: a stamp you're aiming for
    const G0=L.goal,pulse=1+.06*Math.sin(tq*3);
    g.fillStyle=pat('mid');g.beginPath();g.arc(G0.x,G0.y,G0.r*1.3,0,TAU);g.fill();
    g.strokeStyle=ink.mid;g.lineWidth=2.5;g.setLineDash([5,6]);g.lineDashOffset=-tq*14;g.beginPath();g.arc(G0.x,G0.y,G0.r*1.65*pulse,0,TAU);g.stroke();g.setLineDash([]);
    g.strokeStyle=ink.key;g.lineWidth=3.5;g.beginPath();g.arc(G0.x,G0.y,G0.r,0,TAU);g.stroke();
    g.fillStyle=ink.key;g.beginPath();g.arc(G0.x,G0.y,4,0,TAU);g.fill();
    if(edit&&(S.tool==='well'||S.tool==='sling')){g.strokeStyle=ink.key;g.globalAlpha=.45;g.lineWidth=1;g.setLineDash([2,4]);g.beginPath();g.arc(G0.x,G0.y,WELL.keepOut,0,TAU);g.stroke();g.setLineDash([]);g.globalAlpha=1;}

    // wells: ringed
    S.items.forEach((it,i)=>{if(it.type!=='well')return;const live=ed.drag&&ed.drag.kind==='well'&&ed.drag.i===i;
      if(live)drawWellField(g,S,it.x,it.y,true);drawWell(g,S,it.x,it.y,tq,1,!live);});
    // wind: streaked lanes with an arrowhead
    S.items.forEach(it=>{if(it.type==='wind')drawWind(g,S,it.pts,tq,1);});
    // blocks: a wide road band (first-person width), then key ink with a misregistered mid shadow
    L.blocks.forEach(p=>drawRoadBand(g,S,p,band(L.blockHw||WIDTH.block)));
    L.blocks.forEach(p=>{g.fillStyle=ink.mid;path(g,p,3,2.5);g.closePath();g.fill();g.fillStyle=ink.key;path(g,p);g.closePath();g.fill();});
    // level mechanics (contract v2): ice, crumbling blocks, boost pads. Same road band as blocks.
    const hwB=band(L.blockHw||WIDTH.block);
    (L.ice||[]).forEach(p=>drawRoadBand(g,S,p,hwB));(L.crumble||[]).forEach(p=>drawRoadBand(g,S,p,hwB));
    (L.ice||[]).forEach(p=>drawIce(g,S,p));
    (L.crumble||[]).forEach((p,i)=>drawCrumble(g,S,p,i));
    (L.boosts||[]).forEach(b=>drawBoost(g,S,b,tq));
    // hazards: spikes on a base rule
    (L.hazards||[]).forEach(p=>drawHazard(g,S,p));

    drawGhostTrail(g,S,t,rm);

    // lines: tightropes (bold line + far hairline), ropes: trampolines (dashed + dashed far edge)
    S.items.forEach(it=>{if(it.type==='line'&&it.pts.length>1)drawLine(g,S,it.pts,1);});
    S.items.forEach(it=>{if(it.type==='rope')drawRope(g,S,it.a,it.b,1);});
    // slings: open ring + aim arrow; the one being edited gets the full preview arc
    S.items.forEach((it,i)=>{if(it.type!=='sling')return;const live=edit&&ed.drag&&(ed.drag.kind==='sling'||ed.drag.kind==='aim')&&ed.drag.i===i;
      drawSling(g,S,it,live?'active':'placed');});
    drawDrops(g,S);

    // start flag + rider at the start
    const st=L.start;g.strokeStyle=ink.key;g.lineWidth=2;g.beginPath();g.moveTo(st.x-18,st.y+9);g.lineTo(st.x-18,st.y-22);g.stroke();
    g.fillStyle=ink.mid;g.beginPath();g.moveTo(st.x-18,st.y-22);g.lineTo(st.x-2,st.y-17);g.lineTo(st.x-18,st.y-12);g.fill();
    g.fillStyle=ink.mid;g.beginPath();g.arc(st.x,st.y,R,0,TAU);g.fill();
    g.strokeStyle=ink.key;g.lineWidth=2;g.beginPath();g.arc(st.x+1.4,st.y-1,R,0,TAU);g.stroke();
    g.fillStyle=ink.key;g.beginPath();g.arc(st.x+Math.cos(-.5)*4.5,st.y+Math.sin(-.5)*4.5,1.8,0,TAU);g.fill();

    drawGhostMarks(g,S,t,rm);
    if(!S.ghost)drawMechanicLabels(g,S);   // name the new surfaces until the first ride of the level
    if(edit)drawPreviews(g,S,tq);
    if(S.stroke)drawStroke(g,S,tq,lens);
    g.restore();}

  // ---------- sling ----------
  // An open ring (key over a misregistered mid ring) with a centre dot, a faint dashed orbit, and a bold aim arrow
  // from the centre out past the rim ending in a round grab handle. Unlike the goal it has no fill and no target
  // rings: it reads as "a ring with an arrow". mode 'placed' | 'active' (being placed or edited) | 'ghost' (cursor).
  function drawSling(g,S,it,mode){const ink=S.ink,k=SL(),rc=k.rc,x=it.x,y=it.y,ux=Math.cos(it.a),uy=Math.sin(it.a),gr=grow();
    const active=mode!=='placed',alpha=mode==='ghost'?.75:1;g.save();g.globalAlpha=alpha;g.lineCap='round';
    slingPreviewArc(g,S,it,active);
    g.strokeStyle=ink.mid;g.lineWidth=3.2;g.beginPath();g.arc(x+1.5,y+1.2,rc,0,TAU);g.stroke();
    g.strokeStyle=ink.key;g.lineWidth=2.4;g.beginPath();g.arc(x,y,rc,0,TAU);g.stroke();
    g.lineWidth=.9;g.globalAlpha=alpha*.55;g.setLineDash([2,3]);g.beginPath();g.arc(x,y,k.ro,0,TAU);g.stroke();g.setLineDash([]);g.globalAlpha=alpha;
    g.fillStyle=ink.key;g.beginPath();g.arc(x,y,2.6,0,TAU);g.fill();
    // aim arrow + handle
    const tip=rc+22,head=rc+13,hr=5.5*gr;
    g.strokeStyle=ink.mid;g.lineWidth=4.2;g.beginPath();g.moveTo(x+ux*5+1.2,y+uy*5+1);g.lineTo(x+ux*head+1.2,y+uy*head+1);g.stroke();
    g.strokeStyle=ink.key;g.lineWidth=3.2;g.beginPath();g.moveTo(x+ux*5,y+uy*5);g.lineTo(x+ux*head,y+uy*head);g.stroke();
    g.fillStyle=ink.key;g.beginPath();g.moveTo(x+ux*(head+7),y+uy*(head+7));g.lineTo(x+ux*(head-3)-uy*6,y+uy*(head-3)+ux*6);g.lineTo(x+ux*(head-3)+uy*6,y+uy*(head-3)-ux*6);g.closePath();g.fill();
    g.save();g.globalCompositeOperation='destination-out';g.beginPath();g.arc(x+ux*tip,y+uy*tip,hr+1.5,0,TAU);g.fill();g.restore();
    g.fillStyle=ink.light;g.beginPath();g.arc(x+ux*tip,y+uy*tip,hr,0,TAU);g.fill();
    g.strokeStyle=ink.key;g.lineWidth=1.8;g.beginPath();g.arc(x+ux*tip,y+uy*tip,hr,0,TAU);g.stroke();
    g.restore();}
  // Dotted arc of the first ~0.45 s of the fling (physics' slingPreview), with a small arrowhead at its end.
  function slingPreviewArc(g,S,it,active){const ink=S.ink,pts=slingArc(it,450,.45);if(!pts||pts.length<2)return;
    g.save();g.fillStyle=ink.key;g.globalAlpha*=active?.9:.35;const step=active?1:2;
    for(let i=0;i<pts.length-1;i+=step){const q=pts[i];g.beginPath();g.arc(q[0],q[1],active?1.7:1.3,0,TAU);g.fill();}
    const e=pts[pts.length-1],q=pts[Math.max(0,pts.length-3)];arrowHead(g,e[0],e[1],Math.atan2(e[1]-q[1],e[0]-q[0]),active?6:4.5);g.restore();}

  // The pull field: a faint reach ring at WELL.range and sparse inward arrows whose length and ink follow
  // wellForce(d). clear=true for the well being placed or dragged; placed wells get a quieter version.
  let forceMax=0,forceKey='';
  function fieldScale(){const key=WELL.range+':'+(typeof P.wellForce);if(key!==forceKey){forceKey=key;forceMax=0;
      for(let d=4;d<WELL.range;d+=2)forceMax=Math.max(forceMax,wellForce(d));}return forceMax||1;}
  function drawWellField(g,S,x,y,clear){const ink=S.ink,range=WELL.range,fm=fieldScale(),u=Math.max(1,ed.u>1.25?ed.u*.8:1);
    g.save();g.lineCap='round';
    g.strokeStyle=ink.key;g.lineWidth=(clear?1.2:.9)*u;g.globalAlpha=clear?.55:.22;g.setLineDash([3*u,5*u]);
    g.beginPath();g.arc(x,y,range,0,TAU);g.stroke();g.setLineDash([]);
    const rings=clear?[.28,.45,.62,.8,.95]:[.45,.72,.95],per=clear?12:7;g.fillStyle=ink.key;
    rings.forEach((k,ri)=>{const d=range*k,f=Math.min(1,wellForce(d)/fm),len=(clear?5:4)*u+f*(clear?16:10)*u;
      if(f<.02)return;g.globalAlpha=(clear?.25+.65*f:.1+.3*f);g.lineWidth=(clear?1.1+.8*f:.9)*u;
      for(let a=0;a<per;a++){const th=(a+(ri%2)*.5)/per*TAU,cx=Math.cos(th),cy=Math.sin(th),ox=x+cx*d,oy=y+cy*d,tx=ox-cx*len,ty=oy-cy*len;
        g.beginPath();g.moveTo(ox,oy);g.lineTo(tx,ty);g.stroke();
        const hs=(2+f*2)*u;g.beginPath();g.moveTo(tx,ty);g.lineTo(tx+cx*hs-cy*hs*.6,ty+cy*hs+cx*hs*.6);g.lineTo(tx+cx*hs+cy*hs*.6,ty+cy*hs-cx*hs*.6);g.closePath();g.fill();}});
    g.restore();}
  function drawWell(g,S,x,y,tq,alpha,field=true){const ink=S.ink;if(field)drawWellField(g,S,x,y,false);g.globalAlpha=alpha;
    g.fillStyle=(S.pat&&S.pat.lightDense)||ink.light;g.beginPath();g.arc(x,y,58,0,TAU);g.fill();
    g.strokeStyle=ink.mid;g.lineWidth=2;[46,32,18].forEach((rr,i)=>{g.setLineDash([4,5]);g.lineDashOffset=tq*(12+i*10)*(i%2?-1:1);g.beginPath();g.arc(x,y,rr,0,TAU);g.stroke();});g.setLineDash([]);
    g.fillStyle=ink.key;g.beginPath();g.arc(x,y,6,0,TAU);g.fill();g.globalAlpha=1;}

  function arrowHead(g,x,y,a,s){g.beginPath();g.moveTo(x+Math.cos(a)*s,y+Math.sin(a)*s);g.lineTo(x+Math.cos(a+2.5)*s*.92,y+Math.sin(a+2.5)*s*.92);g.lineTo(x+Math.cos(a-2.5)*s*.92,y+Math.sin(a-2.5)*s*.92);g.fill();}
  function drawWind(g,S,pts,tq,alpha){if(pts.length<2)return;const ink=S.ink;g.globalAlpha=alpha;
    g.strokeStyle=ink.mid;g.lineWidth=2.2;g.setLineDash([10,9]);g.lineDashOffset=-tq*70;
    [-12,0,12].forEach(k=>{path(g,offsetPts(pts,k));g.stroke();});g.setLineDash([]);
    const e=pts[pts.length-1],p=pts[Math.max(0,pts.length-4)],a=Math.atan2(e[1]-p[1],e[0]-p[0]);
    g.fillStyle=ink.key;arrowHead(g,e[0],e[1],a,12);g.globalAlpha=1;}

  // Top faces of a block, pushed "into the page": a flat light-ink road with a hairline far edge.
  function drawRoadBand(g,S,poly,d){const ink=S.ink,ox=DEPTH[0]*d,oy=DEPTH[1]*d;
    for(const[a,b]of topEdges(poly)){g.fillStyle=ink.light;g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.lineTo(b[0]+ox,b[1]+oy);g.lineTo(a[0]+ox,a[1]+oy);g.closePath();g.fill();
      g.strokeStyle=ink.key;g.lineWidth=.9;g.globalAlpha=.85;g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(a[0]+ox,a[1]+oy);g.lineTo(b[0]+ox,b[1]+oy);g.lineTo(b[0],b[1]);g.stroke();
      // a dashed centre line: this is a road
      g.globalAlpha=.5;g.setLineDash([4,5]);g.beginPath();g.moveTo(a[0]+ox/2,a[1]+oy/2);g.lineTo(b[0]+ox/2,b[1]+oy/2);g.stroke();g.setLineDash([]);g.globalAlpha=1;}}

  function drawHazard(g,S,p){const ink=S.ink;g.fillStyle=ink.mid;
    for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.floor(len/14));
      for(let k=0;k<n;k++){const x=a[0]+(b[0]-a[0])*(k+.5)/n,y=a[1]+(b[1]-a[1])*(k+.5)/n;g.beginPath();g.moveTo(x-7,y+10);g.lineTo(x,y-9);g.lineTo(x+7,y+10);g.fill();}}
    g.strokeStyle=ink.key;g.lineWidth=3;path(g,p,0,7);g.stroke();}

  // A drawn line is a tightrope: the bold line is the surface, the hairline its narrow far edge.
  function drawLine(g,S,pts,alpha){const ink=S.ink,d=band(WIDTH.line),ox=DEPTH[0]*d,oy=DEPTH[1]*d,a=pts[0],b=pts[pts.length-1];
    g.globalAlpha=.8*alpha;g.strokeStyle=ink.key;g.lineWidth=.8;path(g,pts,ox,oy);g.stroke();
    g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(a[0]+ox,a[1]+oy);g.moveTo(b[0],b[1]);g.lineTo(b[0]+ox,b[1]+oy);g.stroke();
    g.globalAlpha=alpha;g.strokeStyle=ink.mid;g.lineWidth=4.5;path(g,pts,1.6,1.3);g.stroke();
    g.strokeStyle=ink.key;g.lineWidth=3.2;path(g,pts);g.stroke();g.globalAlpha=1;}

  // A rope is a trampoline: dashed, anchored, with a medium dashed far edge. Straight in the editor.
  function drawRope(g,S,A,B,alpha){const ink=S.ink,d=band(WIDTH.rope),ox=DEPTH[0]*d,oy=DEPTH[1]*d;
    g.globalAlpha=.8*alpha;g.strokeStyle=ink.key;g.lineWidth=.9;g.setLineDash([5,3]);g.beginPath();g.moveTo(A[0]+ox,A[1]+oy);g.lineTo(B[0]+ox,B[1]+oy);g.stroke();g.setLineDash([]);
    g.lineWidth=1.3;g.beginPath();g.moveTo(A[0],A[1]);g.lineTo(A[0]+ox,A[1]+oy);g.moveTo(B[0],B[1]);g.lineTo(B[0]+ox,B[1]+oy);g.stroke();
    g.globalAlpha=alpha;g.strokeStyle=ink.mid;g.lineWidth=4;g.beginPath();g.moveTo(A[0]+1.5,A[1]+1.2);g.lineTo(B[0]+1.5,B[1]+1.2);g.stroke();
    g.strokeStyle=ink.key;g.lineWidth=3;g.setLineDash([5,3]);g.beginPath();g.moveTo(A[0],A[1]);g.lineTo(B[0],B[1]);g.stroke();g.setLineDash([]);
    g.fillStyle=ink.key;[A,B].forEach(q=>{g.beginPath();g.arc(q[0],q[1],4.5,0,TAU);g.fill();});g.globalAlpha=1;}

  // ---------- level mechanics ----------
  function bottomAt(p,x){let y=-1e9;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];if((a[0]-x)*(b[0]-x)>0||a[0]===b[0])continue;y=Math.max(y,a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));}return y>-1e9?y:polyBox(p).y1;}
  function polyBox(p){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const[x,y]of p){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}return{x0,y0,x1,y1};}
  // Ice: light-ink slab with slick diagonal hatching and a hard key outline.
  function drawIce(g,S,p){const ink=S.ink,b=polyBox(p);
    g.fillStyle=ink.mid;path(g,p,3,2.5);g.closePath();g.fill();
    g.fillStyle=ink.light;path(g,p);g.closePath();g.fill();
    g.save();path(g,p);g.closePath();g.clip();g.strokeStyle=ink.key;g.lineWidth=1.3;g.beginPath();
    const h=b.y1-b.y0;for(let x=b.x0-h;x<b.x1;x+=6){g.moveTo(x,b.y1);g.lineTo(x+h,b.y0);}g.stroke();g.restore();
    g.strokeStyle=ink.key;g.lineWidth=2.4;path(g,p);g.closePath();g.stroke();}
  // Crumbling block: halftone key fill (it's weaker), seeded cracks knocked out of it, dashed outline.
  const crackCache=new WeakMap();
  function cracks(p,i){let c=crackCache.get(p);if(c)return c;const b=polyBox(p),w=b.x1-b.x0,seed=i*977+Math.round(b.x0*3+b.y0*7);c=[];
    const n=Math.max(2,Math.min(6,Math.round(w/45)));
    for(let k=0;k<n;k++){let x=b.x0+w*(k+.5+(hash(k,seed)-.5)*.6)/n,y=b.y0;const line=[[x,y]];
      while(y<b.y1){y+=4+hash(line.length,seed+k*31)*6;x+=(hash(line.length+9,seed+k*17)-.5)*9;line.push([x,Math.min(y,b.y1)]);}
      // a short side branch on some cracks
      if(hash(k,seed+5)<.6&&line.length>2){const m=line[1];c.push([m,[m[0]+(hash(k,seed+6)<.5?-1:1)*(5+hash(k,seed+7)*6),m[1]+4+hash(k,seed+8)*5]]);}
      c.push(line);}
    crackCache.set(p,c);return c;}
  function drawCrumble(g,S,p,i){const ink=S.ink;
    // misregistered mid shadow only around the rim (the halftone fill would let it show through)
    g.fillStyle=ink.mid;path(g,p,3,2.5);g.closePath();g.fill();
    g.save();g.globalCompositeOperation='destination-out';path(g,p);g.closePath();g.fill();g.restore();
    g.fillStyle=ink.key;g.globalAlpha=.62;path(g,p);g.closePath();g.fill();g.globalAlpha=1;   // a lighter tint of key: weaker than a block
    g.save();path(g,p);g.closePath();g.clip();
    g.save();g.globalCompositeOperation='destination-out';g.strokeStyle='#000';g.lineWidth=2.2;for(const c of cracks(p,i)){path(g,c);g.stroke();}g.restore();
    g.strokeStyle=ink.key;g.lineWidth=1;for(const c of cracks(p,i)){path(g,c,.8,.6);g.stroke();}g.restore();
    g.strokeStyle=ink.key;g.lineWidth=2.4;g.setLineDash([7,4]);path(g,p);g.closePath();g.stroke();g.setLineDash([]);}
  // Boost pad: a mid-ink strip on the surface with key chevrons pointing a→b (they creep forward on twos).
  function drawBoost(g,S,bo,tq){const ink=S.ink,[ax,ay]=bo.a,[bx,by]=bo.b,l=Math.hypot(bx-ax,by-ay);if(l<1)return;
    const tx=(bx-ax)/l,ty=(by-ay)/l;let nx=-ty,ny=tx;if(ny>0){nx=-nx;ny=-ny;}   // normal pointing up, off the surface
    const lift=4.5,ox=nx*lift,oy=ny*lift;
    g.strokeStyle=ink.mid;g.lineWidth=7;g.lineCap='butt';g.beginPath();g.moveTo(ax+ox,ay+oy);g.lineTo(bx+ox,by+oy);g.stroke();g.lineCap='round';
    g.strokeStyle=ink.key;g.lineWidth=1.8;const step=11,off=(tq*22)%step;
    for(let s=off+3;s<l-2;s+=step){const cx=ax+tx*s+ox,cy=ay+ty*s+oy;g.beginPath();
      g.moveTo(cx-tx*3.5+nx*4,cy-ty*3.5+ny*4);g.lineTo(cx+tx*1.5,cy+ty*1.5);g.lineTo(cx-tx*3.5-nx*4,cy-ty*3.5-ny*4);g.stroke();}}
  // A short arrow off the end of a boost pad: the way it throws you.
  function boostArrow(g,S,bo){const ink=S.ink,[ax,ay]=bo.a,[bx,by]=bo.b,l=Math.hypot(bx-ax,by-ay);if(l<1)return;const tx=(bx-ax)/l,ty=(by-ay)/l;
    let nx=-ty,ny=tx;if(ny>0){nx=-nx;ny=-ny;}const x0=bx+nx*R,y0=by+ny*R,L=54,pts=[];
    for(let i=0;i<=8;i++){const s=i/8;pts.push([x0+tx*L*s,y0+ty*L*s+8*s*s]);}
    g.strokeStyle=ink.key;g.fillStyle=ink.key;g.globalAlpha=.75;g.lineWidth=1.4;g.setLineDash([2,3.5]);path(g,pts);g.stroke();g.setLineDash([]);
    const e=pts[8],q=pts[6];arrowHead(g,e[0],e[1],Math.atan2(e[1]-q[1],e[0]-q[0]),5.5);g.globalAlpha=1;}
  function labelAt(g,S,text,x,y){const ink=S.ink,f=fsz(9,11),k=f/9;g.font=`800 ${f}px ${STENCIL}`;try{g.letterSpacing=`${1.6*k}px`;}catch(_){}g.textAlign='center';g.textBaseline='bottom';
    g.save();g.globalCompositeOperation='destination-out';g.strokeStyle='#000';g.lineWidth=4*k;g.lineJoin='round';g.strokeText(text,x,y);g.restore();
    g.fillStyle=ink.key;g.fillText(text,x,y);try{g.letterSpacing='0px';}catch(_){}g.textAlign='left';}
  // Name each new surface once (nearby pieces share a label), above the middle of its longest top edge.
  function drawMechanicLabels(g,S){const L=S.level,d=band(L.blockHw||WIDTH.block),placed=[];
    const put=(text,x,y)=>{if(placed.some(q=>q[0]===text&&Math.hypot(q[1]-x,q[2]-y)<260))return;placed.push([text,x,y]);labelAt(g,S,text,x,y);};
    const top=p=>{let best=null,bl=0;for(const[a,b]of topEdges(p)){const l=dist(a,b);if(l>bl){bl=l;best=[(a[0]+b[0])/2,(a[1]+b[1])/2];}}if(!best){const b=polyBox(p);best=[(b.x0+b.x1)/2,b.y0];}return best;};
    (L.ice||[]).forEach(p=>{const[x,y]=top(p);put('ICE',x+DEPTH[0]*d,y+DEPTH[1]*d-4*grow());});
    (L.crumble||[]).forEach(p=>{const[x,y]=top(p);put('CRUMBLES',x+DEPTH[0]*d,y+DEPTH[1]*d-4*grow());});
    (L.boosts||[]).forEach(bo=>{put('BOOST',(bo.a[0]+bo.b[0])/2,Math.min(bo.a[1],bo.b[1])-13*grow());});}

  // ---------- ink drops ----------
  // A droplet floats at (x,y). Its sideways offset z is drawn along the same "into the page" direction as the
  // road bands, tied back to a small centre tick so "this one is off to the side" reads at a glance.
  const DROP_SIZE={15:4.4,25:5.6,40:7};
  const dropShift=z=>clamp(z*.3,-22,22);
  function dropletPath(g,x,y,r){g.beginPath();g.moveTo(x,y-r*1.9);
    g.bezierCurveTo(x+r*.55,y-r*1.1,x+r,y-r*.45,x+r,y+r*.1);g.arc(x,y+r*.1,r,0,Math.PI);g.bezierCurveTo(x-r,y-r*.45,x-r*.55,y-r*1.1,x,y-r*1.9);g.closePath();}
  function drawDrops(g,S){const L=S.level,drops=L.drops;if(!drops||!drops.length)return;const ink=S.ink,gh=S.ghost,got=gh&&gh.events?gh.events.filter(e=>e.type==='drop'):null;
    for(const d of drops){const v=d.v||25,r=(DROP_SIZE[v]||5.6)*grow(),risky=v>=40,z=d.z||0,sh=dropShift(z),x=d.x+DEPTH[0]*sh,y=d.y+DEPTH[1]*sh,lab=String(v),fs=risky?fsz(13,12.5):fsz(11,11);
      const filled=!got||got.some(e=>Math.abs(e.x-d.x)<2&&Math.abs(e.y-d.y)<2);   // no ghost yet: all drops show as full
      // tie back to the centre line when the drop sits off to one side
      if(Math.abs(sh)>1.5){g.strokeStyle=ink.key;g.lineWidth=.9;g.globalAlpha=.85;g.setLineDash([1.5,2]);g.beginPath();g.moveTo(d.x,d.y);g.lineTo(x,y);g.stroke();g.setLineDash([]);
        g.lineWidth=1.2;g.beginPath();g.moveTo(d.x-3,d.y);g.lineTo(d.x+3,d.y);g.moveTo(d.x,d.y-3);g.lineTo(d.x,d.y+3);g.stroke();g.globalAlpha=1;}
      // knock a clean hole in the plate so a drop reads over blocks, lines and bands
      g.font=`${fs}px ${TYPE}`;g.textAlign='left';g.textBaseline='middle';
      g.save();g.globalCompositeOperation='destination-out';g.fillStyle='#000';g.strokeStyle='#000';g.lineWidth=3.5*fs/11;
      if(risky){g.beginPath();g.arc(x,y-r*.3,r*2.4,0,TAU);g.fill();}else{dropletPath(g,x,y,r+2);g.fill();}
      g.strokeText(lab,x+r+(risky?r*.9:3),y);g.restore();
      // risky drops glint: a light-ink disc and four short mid-ink rays
      if(risky){g.fillStyle=ink.light;g.beginPath();g.arc(x,y-r*.3,r*2.1,0,TAU);g.fill();
        g.strokeStyle=ink.mid;g.lineWidth=1.6;g.beginPath();for(let k=0;k<4;k++){const a=Math.PI/4+k*Math.PI/2;g.moveTo(x+Math.cos(a)*r*1.55,y-r*.3+Math.sin(a)*r*1.55);g.lineTo(x+Math.cos(a)*r*2.05,y-r*.3+Math.sin(a)*r*2.05);}g.stroke();}
      if(filled){g.fillStyle=ink.mid;dropletPath(g,x+1.2,y+1,r);g.fill();g.fillStyle=ink.key;dropletPath(g,x,y,r);g.fill();
        g.save();g.globalCompositeOperation='destination-out';g.globalAlpha=.85;g.beginPath();g.arc(x-r*.38,y-r*.05,r*.3,0,TAU);g.fill();g.restore();}
      else{g.strokeStyle=ink.key;g.lineWidth=1.4;g.setLineDash([2.2,1.8]);dropletPath(g,x,y,r);g.stroke();g.setLineDash([]);}   // missed last ride: hollow, dotted
      g.fillStyle=ink.key;g.globalAlpha=filled?1:.75;g.fillText(lab,x+r+(risky?r*.9:3),y);g.globalAlpha=1;}}

  // ---------- ghost of the last ride ----------
  function ghostReveal(S,t,rm){const gh=S.ghost;if(gh!==ed.ghostRef){ed.ghostRef=gh;ed.ghostT0=t;}return rm?1:clamp((t-ed.ghostT0)/.55,0,1);}
  const zShift=z=>Math.sign(z)*Math.min(Z_MAX,band(Math.abs(z)));
  // A crumbled piece is marked on its own top surface, under where the rider was.
  function crumbleSpot(S,e){const p=(S.level.crumble||[])[e.i];if(!p||e.x==null)return null;let best=null,bd=1e9;
    for(const[a,b]of topEdges(p)){const[cx,cy]=closest(e.x,e.y,a[0],a[1],b[0],b[1]),d=Math.hypot(e.x-cx,e.y-cy);if(d<bd){bd=d;best=[cx,cy];}}return best;}
  // Where the rider was at an event: its own x,y if it has them, else the path sample at its time. [x,y,z,state,heading]
  function pathAt(gh,e){const P=gh.path;if(!P||!P.length)return null;const i=clamp(Math.round((e.t||0)/(2*DT))-1,0,P.length-1),q=P[i],pr=P[Math.max(0,i-1)],nx=P[Math.min(P.length-1,i+1)];
    const a=Math.atan2(nx[1]-pr[1],nx[0]-pr[0])||0;return e.x!=null&&e.y!=null?[e.x,e.y,q[2],q[3],a]:[q[0],q[1],q[2],q[3],a];}
  function drawGhostTrail(g,S,t,rm){const gh=S.ghost;if(!gh||!gh.path||gh.path.length<2)return;
    const P=gh.path,n=Math.max(2,Math.ceil(P.length*ghostReveal(S,t,rm))),col=S.ink.mid;
    g.fillStyle=col;g.strokeStyle=col;
    let acc=1e9,prevState=-1;const orbit=orbitSpans(gh);
    for(let i=1;i<n;i++){const a=P[i-1],b=P[i],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);if(l<1e-3)continue;
      const st=orbit(i)?4:b[3]|0;if(st!==prevState){acc=1e9;prevState=st;}   // start each stretch with a mark
      acc+=l;if(acc<(GHOST_SPACING[st]||6))continue;acc=0;
      const z=b[2]||0,az=Math.abs(z),fade=clamp(1-(az-4)/40,.5,1),s=.55+.45*fade,sh=zShift(z);
      const x=b[0]+DEPTH[0]*sh,y=b[1]+DEPTH[1]*sh,ux=dx/l,uy=dy/l;
      g.globalAlpha=.95*fade;
      if(st===STATE.ground){g.beginPath();g.arc(x,y,2.1*s,0,TAU);g.fill();}
      else if(st===STATE.air){g.lineWidth=1.8*s;g.beginPath();g.moveTo(x-ux*3.2,y-uy*3.2);g.lineTo(x+ux*3.2,y+uy*3.2);g.stroke();}
      else if(st===STATE.rope){g.lineWidth=1.1;g.beginPath();g.arc(x,y,2.5*s,0,TAU);g.stroke();}
      else if(st===4){g.lineWidth=1.3;g.beginPath();g.moveTo(x-uy*3,y+ux*3);g.lineTo(x+uy*3,y-ux*3);g.stroke();}   // sling orbit: ticks across the path, like a coil
      else{const k=3.2*s;g.beginPath();g.moveTo(x+ux*k,y+uy*k);g.lineTo(x-ux*k-uy*k*.8,y-uy*k+ux*k*.8);g.lineTo(x-ux*k*.4,y-uy*k*.4);g.lineTo(x-ux*k+uy*k*.8,y-uy*k-ux*k*.8);g.closePath();g.fill();}}  // wind: little darts, carried along
    g.globalAlpha=1;}

  // Path indices spent orbiting a sling: from each 'sling' capture to its 'slingOut' (or a path state of 4 if physics records one).
  function orbitSpans(gh){const ev=gh.events||[],spans=[];let open=null;
    for(const e of ev){if(e.type==='sling')open=e.t;else if(e.type==='slingOut'&&open!=null){spans.push([idxAt(gh,open),idxAt(gh,e.t)]);open=null;}}
    if(open!=null)spans.push([idxAt(gh,open),gh.path.length]);
    return i=>(gh.path[i]&&gh.path[i][3]===4)||spans.some(([a,b])=>i>=a&&i<=b);}
  const idxAt=(gh,t)=>clamp(Math.round((t||0)/(2*DT))-1,0,gh.path.length-1);
  function drawGhostMarks(g,S,t,rm){const gh=S.ghost;if(!gh)return;const ink=S.ink,rev=ghostReveal(S,t,rm);
    const evs=gh.events||[],tMax=evs.length?Math.max(...evs.map(e=>e.t||0)):0;
    g.strokeStyle=ink.key;g.lineWidth=1.5;g.globalAlpha=.8;
    for(const e of evs){if(tMax&&(e.t||0)>tMax*rev+1e-6)continue;
      if(e.type==='jump'){const y=e.y-R-5;g.beginPath();g.moveTo(e.x-4,y+3);g.lineTo(e.x,y-1);g.lineTo(e.x+4,y+3);g.moveTo(e.x-4,y+7);g.lineTo(e.x,y+3);g.lineTo(e.x+4,y+7);g.stroke();}
      else if(e.type==='land'){g.beginPath();g.moveTo(e.x,e.y+R-3);g.lineTo(e.x,e.y+R+6);g.moveTo(e.x-3.5,e.y+R+6);g.lineTo(e.x+3.5,e.y+R+6);g.stroke();}
      else if(e.type==='slingOut'){const q=pathAt(gh,e);if(q){const P=gh.path,j=idxAt(gh,e.t),n1=P[Math.min(P.length-1,j+2)],a=n1&&(n1[0]!==q[0]||n1[1]!==q[1])?Math.atan2(n1[1]-q[1],n1[0]-q[0]):q[4];
        g.fillStyle=ink.key;g.beginPath();g.moveTo(q[0],q[1]);g.lineTo(q[0]+Math.cos(a)*9,q[1]+Math.sin(a)*9);g.stroke();arrowHead(g,q[0]+Math.cos(a)*10,q[1]+Math.sin(a)*10,a,4.5);}}
      else if(e.type==='boost'){const q=pathAt(gh,e);if(q){const a=q[4];g.fillStyle=ink.key;for(const o of[0,5]){const cx=q[0]+Math.cos(a)*o,cy=q[1]+Math.sin(a)*o;g.beginPath();g.moveTo(cx+Math.cos(a)*3,cy+Math.sin(a)*3);g.lineTo(cx+Math.cos(a+2.4)*3.5,cy+Math.sin(a+2.4)*3.5);g.lineTo(cx+Math.cos(a-2.4)*3.5,cy+Math.sin(a-2.4)*3.5);g.fill();}}}
      else if(e.type==='crumble'){const p=(S.level.crumble||[])[e.i];if(p){  // chips falling off the piece that gave way
        const bx=polyBox(p),x=(bx.x0+bx.x1)/2,y=bottomAt(p,x)+4;g.fillStyle=ink.key;
        for(const[dx,dy,a]of[[-8,1,.4],[0,7,1.9],[8,2,3.3]]){const cx=x+dx,cy=y+dy;g.beginPath();g.moveTo(cx+Math.cos(a)*3.2,cy+Math.sin(a)*3.2);g.lineTo(cx+Math.cos(a+2.2)*2.6,cy+Math.sin(a+2.2)*2.6);g.lineTo(cx+Math.cos(a+4.1)*2.9,cy+Math.sin(a+4.1)*2.9);g.fill();}}}}
    g.globalAlpha=1;
    if(gh.status==='win'||!gh.at||rev<1)return;
    // failure: a bold hand-stamped X, thumped in once the trail has drawn
    let[x,y]=gh.at;const off=x<14||x>W-14||y<14||y>H-14;x=clamp(x,18,W-18);y=clamp(y,18,H-26);
    const age=t-ed.ghostT0-.55,k=rm?1:1+.5*Math.max(0,1-age/.14),gr=grow(),sz=13*k*gr,seed=Math.round(gh.at[0]*7+gh.at[1]*13);
    const bar=(x0,y0,x1,y1,w,j)=>{const dx=x1-x0,dy=y1-y0,l=Math.hypot(dx,dy),nx=-dy/l*w/2,ny=dx/l*w/2,q=i=>(hash(i,seed+j)-.5)*1.6;
      g.beginPath();g.moveTo(x0+nx+q(0),y0+ny+q(1));g.lineTo((x0+x1)/2+nx*1.15+q(2),(y0+y1)/2+ny*1.15+q(3));g.lineTo(x1+nx*.8+q(4),y1+ny*.8+q(5));
      g.lineTo(x1-nx*.9+q(6),y1-ny*.9+q(7));g.lineTo((x0+x1)/2-nx+q(8),(y0+y1)/2-ny+q(9));g.lineTo(x0-nx*1.1+q(10),y0-ny*1.1+q(11));g.closePath();g.fill();};
    // lay out the reason label first: below-right, flipped above / left near the sheet edges
    const label=REASON[gh.status]||String(gh.status||'').toUpperCase();
    const lf=fsz(12,12),lk=lf/12;g.font=`800 ${lf}px ${STENCIL}`;try{g.letterSpacing=`${1.8*lk}px`;}catch(_){}
    const totW=g.measureText(label).width;
    let lx=x+sz*.55+4*lk,ly=y+sz*.55+3*lk;if(ly+lf+4>H-2)ly=y-sz-lf-6*lk;if(lx+totW>W-4)lx=x-sz-8-totW;
    // knock the stamp out of whatever is under it on this plate (spikes, lines), like a riso knockout
    g.save();g.globalCompositeOperation='destination-out';g.fillStyle='#000';
    bar(x-sz,y-sz,x+sz,y+sz,12*gr,1);bar(x+sz,y-sz*.95,x-sz*.95,y+sz,12*gr,2);
    g.strokeStyle='#000';g.lineWidth=4.5*lk;g.textBaseline='top';g.textAlign='left';g.strokeText(label,lx,ly);g.restore();
    g.fillStyle=ink.mid;bar(x-sz,y-sz,x+sz,y+sz,7.5*gr,1);bar(x+sz,y-sz*.95,x-sz*.95,y+sz,7.5*gr,2);
    // misregistered key-ink hairline of the same stamp
    g.strokeStyle=ink.key;g.lineWidth=1.1*gr;g.globalAlpha=.85;g.beginPath();g.moveTo(x-sz+1.5,y-sz+1);g.lineTo(x+sz+1.5,y+sz+1);g.moveTo(x+sz+1.5,y-sz*.95+1);g.lineTo(x-sz*.95+1.5,y+sz+1);g.stroke();
    if(off){g.globalAlpha=1;g.fillStyle=ink.key;const a=Math.atan2(gh.at[1]-y,gh.at[0]-x);arrowHead(g,x+Math.cos(a)*(sz+8),y+Math.sin(a)*(sz+8),a,5);}
    // the reason, in stencil caps
    g.globalAlpha=1;g.textBaseline='top';g.textAlign='left';
    g.fillStyle=ink.mid;g.fillText(label,lx+1.2*lk,ly+lk);g.fillStyle=ink.key;g.fillText(label,lx,ly);
    try{g.letterSpacing='0px';}catch(_){}}

  // ---------- local previews (never the whole solution) ----------
  function drawPreviews(g,S,tq){const ink=S.ink,h=ed.hover;
    if(ed.drag&&(ed.drag.kind==='sling'||ed.drag.kind==='aim')){const it=S.items[ed.drag.i];if(it){handleRing(g,S,ed.drag.kind==='aim'?aimTip(it):[it.x,it.y],true);
        if(ed.drag.kind==='aim')aimDial(g,S,it);
        else{const G0=S.level.goal,ko=SL().keepOut;g.strokeStyle=ink.key;g.globalAlpha=.5;g.lineWidth=1;g.setLineDash([2,4]);g.beginPath();g.arc(G0.x,G0.y,ko,0,TAU);g.stroke();g.setLineDash([]);g.globalAlpha=1;
          if(Math.hypot(it.x-G0.x,it.y-G0.y)<ko)badX(g,S,it.x,it.y);}}return;}
    if(ed.drag){const it=S.items[ed.drag.i];if(it){const q=ed.drag.kind==='well'?[it.x,it.y]:it[ed.drag.end];handleRing(g,S,q,true);
        if(ed.drag.kind==='well'){const G0=S.level.goal;g.strokeStyle=ink.key;g.globalAlpha=.5;g.lineWidth=1;g.setLineDash([2,4]);g.beginPath();g.arc(G0.x,G0.y,WELL.keepOut,0,TAU);g.stroke();g.setLineDash([]);g.globalAlpha=1;
          if(Math.hypot(it.x-G0.x,it.y-G0.y)<WELL.keepOut)badX(g,S,it.x,it.y);}
        else bounceArc(g,S,it.a,it.b);}return;}
    const grab=!S.stroke&&h&&!ed.aim?handleAt(S,h,grabRad(ed.touch)):null;
    if(grab){const it=S.items[grab.i];handleRing(g,S,grab.kind==='aim'?aimTip(it):grab.kind==='well'||grab.kind==='sling'?[it.x,it.y]:it[grab.end],false);
      if(grab.kind==='sling')slingPreviewArc(g,S,it,true);}
    if(!S.stroke&&h&&!grab){
      if(S.tool==='line'||S.tool==='wind'||S.tool==='rope'){const q=snapAt(S,h);if(q){g.strokeStyle=ink.key;g.lineWidth=1.2;g.globalAlpha=.8;g.beginPath();g.arc(q[0],q[1],5.5,0,TAU);g.stroke();g.globalAlpha=1;}}
      if(S.tool==='sling'){const bad=slingKeep(S,h)||slingCost()>room()+1e-6;   // the sling you'd place here, aimed at the ring
        if(bad){g.save();g.strokeStyle=ink.key;g.globalAlpha=.55;g.lineWidth=1.2;g.setLineDash([3,4]);g.beginPath();g.arc(h[0],h[1],SL().rc,0,TAU);g.stroke();g.setLineDash([]);g.restore();badX(g,S,h[0],h[1]);}
        else drawSling(g,S,{x:h[0],y:h[1],a:aimAtGoal(S,h)},'ghost');}
      for(const bo of S.level.boosts||[]){const[cx,cy]=closest(h[0],h[1],bo.a[0],bo.a[1],bo.b[0],bo.b[1]);if(Math.hypot(h[0]-cx,h[1]-cy)<18)boostArrow(g,S,bo);}
      // hovering an existing rope or wind lane
      for(const it of S.items){
        if(it.type==='rope'){const[cx,cy]=closest(h[0],h[1],it.a[0],it.a[1],it.b[0],it.b[1]);if(Math.hypot(h[0]-cx,h[1]-cy)<14)bounceArc(g,S,it.a,it.b);}
        else if(it.type==='wind'&&it.pts.length>1){let near=false;for(let i=1;i<it.pts.length&&!near;i++){const a=it.pts[i-1],b=it.pts[i],[cx,cy]=closest(h[0],h[1],a[0],a[1],b[0],b[1]);near=Math.hypot(h[0]-cx,h[1]-cy)<WIND.radius;}
          if(near)windArrows(g,S,it.pts,tq);}}}}

  // Grab affordance: a double ring around a draggable handle (solid while held).
  function handleRing(g,S,q,held){const ink=S.ink,u=Math.max(1,ed.u>1.25?ed.u*.7:1);g.save();g.strokeStyle=ink.key;g.lineWidth=1.4*u;g.globalAlpha=.9;
    if(!held)g.setLineDash([3*u,2.5*u]);g.beginPath();g.arc(q[0],q[1],10*u,0,TAU);g.stroke();g.setLineDash([]);
    g.lineWidth=.9*u;g.globalAlpha=.6;g.beginPath();g.arc(q[0],q[1],14*u,0,TAU);g.stroke();g.restore();}
  // While aiming: a faint dial of 5° ticks around the ring (15° longer), so the snapping is visible.
  function aimDial(g,S,it){const ink=S.ink,k=SL(),r0=k.rc+30;g.save();g.strokeStyle=ink.key;g.globalAlpha=.4;g.lineWidth=.9;g.beginPath();
    for(let d=0;d<72;d++){const a=d*Math.PI/36,l=d%3?3:6;g.moveTo(it.x+Math.cos(a)*r0,it.y+Math.sin(a)*r0);g.lineTo(it.x+Math.cos(a)*(r0+l),it.y+Math.sin(a)*(r0+l));}g.stroke();g.restore();}
  function badX(g,S,x,y){g.save();g.strokeStyle=S.ink.key;g.lineWidth=1.6;g.beginPath();g.moveTo(x-7,y-7);g.lineTo(x+7,y+7);g.moveTo(x+7,y-7);g.lineTo(x-7,y+7);g.stroke();g.restore();}
  // Short arc showing which way a rope throws you: the incoming fall reflected off the rope, bent by gravity.
  function bounceArc(g,S,A,B){const rp=makeRope(A,B);if(rp.len<MIN_ROPE)return;
    const dir=Math.sign(S.level.start.vx||1),vx=dir,vy=1.1,l0=Math.hypot(vx,vy);let nx=rp.nx,ny=rp.ny;if(ny>0){nx=-nx;ny=-ny;}
    const vn=(vx*nx+vy*ny)/l0,rx=vx/l0-2*vn*nx,ry=vy/l0-2*vn*ny,mx=(A[0]+B[0])/2+nx*R,my=(A[1]+B[1])/2+ny*R,L=52,sag=26,pts=[];
    for(let i=0;i<=10;i++){const s=i/10;pts.push([mx+rx*L*s,my+ry*L*s+sag*s*s]);}
    const ink=S.ink;g.strokeStyle=ink.key;g.fillStyle=ink.key;g.globalAlpha=.7;g.lineWidth=1.3;g.setLineDash([2,3.5]);path(g,pts);g.stroke();g.setLineDash([]);
    const e=pts[10],p=pts[8];arrowHead(g,e[0],e[1],Math.atan2(e[1]-p[1],e[0]-p[0]),5);g.globalAlpha=1;}

  function windArrows(g,S,pts,tq){const ink=S.ink,step=26;let acc=step*.5-((tq*40)%step);g.strokeStyle=ink.key;g.lineWidth=1.3;g.globalAlpha=.75;
    for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);if(l<1e-3)continue;const ux=dx/l,uy=dy/l;let s=acc;
      while(s<l){if(s>=0){const x=a[0]+ux*s,y=a[1]+uy*s;g.beginPath();g.moveTo(x-ux*4-uy*4,y-uy*4+ux*4);g.lineTo(x,y);g.lineTo(x-ux*4+uy*4,y-uy*4-ux*4);g.stroke();}s+=step;}acc=s-l;}
    g.globalAlpha=1;}

  // ---------- the stroke under the pen ----------
  function drawStroke(g,S,tq,lens){const sk=S.stroke,ink=S.ink;let pen;
    const fin=ed.touch?1:.8;   // touch: the stroke is drawn at its final look straight away
    if(sk.type==='rope'){drawRope(g,S,sk.a,sk.b,fin);bounceArc(g,S,sk.a,sk.b);pen=sk.b;
      const q=ed.touch?null:snapAt(S,sk.b,sk.a);if(q){g.strokeStyle=ink.key;g.lineWidth=1.2;g.beginPath();g.arc(q[0],q[1],6,0,TAU);g.stroke();}}
    else{const pts=sk.pts.slice();if(!ed.full&&ed.sm&&dist(pts[pts.length-1],ed.sm)>.5)pts.push(ed.sm);
      if(pts.length>1){if(sk.type==='line')drawLine(g,S,pts,fin);else{drawWind(g,S,pts,tq,fin);windArrows(g,S,pts,tq);}}
      else{g.fillStyle=ink.key;g.beginPath();g.arc(pts[0][0],pts[0][1],2.5,0,TAU);g.fill();}
      pen=pts[pts.length-1];
      if(sk.type==='line'&&ed.raw&&!ed.touch){const q=snapAt(S,ed.raw,sk.pts[0]);if(q){g.strokeStyle=ink.key;g.lineWidth=1.2;g.beginPath();g.arc(q[0],q[1],6,0,TAU);g.stroke();}}}  // the end will snap here on lift
    if(ed.touch&&ed.snapped){const q=sk.type==='rope'?sk.a:sk.pts[0],u=Math.max(1,ed.u>SMALL?ed.u*.6:1);g.strokeStyle=ink.key;g.lineWidth=1.2*u;g.beginPath();g.arc(q[0],q[1],5*u,0,TAU);g.stroke();}  // snapped start
    if(lens)return;
    // ink cost under the pen, plus what it becomes in first person
    // sizes never drop below a readable CSS size (phones have well under one pixel per design unit)
    const u=ed.u,f1=fsz(15,13),f2=fsz(9,9),gap=f1+2,big=u>SMALL;
    const c=Math.round(itemCost(sk));let x=clamp(pen[0]+(big?14*u:12),4,W-Math.max(70,f1*4.5));const y=clamp(pen[1]-(big?f1+f2+6*u:24),4,H-Math.max(30,gap+f2+4)),num=`−${c}`,sub=ed.full?'OUT OF INK':WIDTH_NAME[sk.type]||'';
    const typed=()=>{g.font=`${f1}px ${TYPE}`;try{g.letterSpacing='0px';}catch(_){}},stencil=()=>{g.font=`800 ${f2}px ${STENCIL}`;try{g.letterSpacing=`${f2*.15}px`;}catch(_){}};
    g.textAlign='left';g.textBaseline='top';
    // with a finger down, keep the readout on the side away from the loupe
    let yy=y;
    if(ed.touch&&ed.finger){   // clear of the fingertip: up and to the right, flipped left near the right edge, down beside it near the top
      typed();let w=g.measureText(num).width;stencil();w=Math.max(w,g.measureText(sub).width);const[fx,fy]=ed.finger,side=fx+30*u+w>W-4?-1:1,hgt=gap+f2;
      x=side>0?fx+30*u:fx-30*u-w;yy=fy-44*u-hgt;if(yy<4){yy=fy-hgt/2;x=side>0?fx+40*u:fx-40*u-w;}x=clamp(x,4,W-w-4);yy=clamp(yy,4,H-hgt-4);}
    // knock a halo out of the plate so the readout stays legible over blocks and lines
    g.save();g.globalCompositeOperation='destination-out';g.strokeStyle='#000';g.lineWidth=4;g.lineJoin='round';
    typed();g.strokeText(num,x,yy);stencil();g.strokeText(sub,x,yy+gap);g.restore();
    typed();g.fillStyle=ink.mid;g.fillText(num,x+1,yy+.8);g.fillStyle=ink.key;g.fillText(num,x,yy);
    stencil();g.fillStyle=ed.full?ink.mid:ink.key;g.fillText(sub,x,yy+gap);try{g.letterSpacing='0px';}catch(_){}}

  // ---------- touch aids: the offset pen tip, its tether to the finger, and the loupe ----------
  function crosshair(g,S,x,y,u){const ink=S.ink;g.strokeStyle=ink.key;g.lineWidth=1.4*u;g.setLineDash([]);
    g.beginPath();g.arc(x,y,5*u,0,TAU);g.stroke();g.beginPath();
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){g.moveTo(x+dx*7.5*u,y+dy*7.5*u);g.lineTo(x+dx*12*u,y+dy*12*u);}g.stroke();
    g.fillStyle=ink.key;g.beginPath();g.arc(x,y,1.1*u,0,TAU);g.fill();}
  function touchAids(g,S,t){if(!TOUCH_AIDS)return;const ink=S.ink,u=ed.u,[fx,fy]=ed.finger;
    // while dragging, the loupe and crosshair follow the handle being moved rather than the pen
    const di=ed.drag&&S.items[ed.drag.i],[px,py]=di?(ed.drag.kind==='well'?[di.x,di.y]:di[ed.drag.end]):ed.hover;
    g.save();g.lineCap='round';
    // tether from the top of the finger pad to the pen tip, and a faint ring where the finger is
    g.strokeStyle=ink.key;g.globalAlpha=.55;g.lineWidth=1*u;g.setLineDash([3*u,3*u]);
    const top=fy-14*u;if(top-py>13*u){g.beginPath();g.moveTo(fx,top);g.lineTo(px,py+13*u);g.stroke();}
    g.globalAlpha=.3;g.beginPath();g.arc(fx,fy,14*u,0,TAU);g.stroke();g.setLineDash([]);g.globalAlpha=1;
    crosshair(g,S,px,py,u);
    // the loupe: fg content redrawn at 2x in a clipped circle beside the pen, on the side with more room
    const r=LOUPE_PX/2*u,sep=r+26*u;let side=ed.loupeSide||1;
    const place=sd=>[clamp(px+sd*sep,r+2*u,W-r-2*u),clamp(py-6*u,r+2*u,H-r-2*u)];
    let[lx,ly]=place(side);if(Math.hypot(lx-px,ly-py)<r+10*u){side=-side;[lx,ly]=place(side);}ed.loupeEff=side;
    if(Math.hypot(lx-px,ly-py)<r+10*u)ly=clamp(py+sep,r+2*u,H-r-2*u);   // cornered: go below the tip
    g.save();g.beginPath();g.arc(lx,ly,r,0,TAU);g.clip();
    g.save();g.globalCompositeOperation='destination-out';g.fillRect(lx-r,ly-r,2*r,2*r);g.restore();   // no 1x plate under the lens
    g.fillStyle=ink.light;g.globalAlpha=.12;g.fillRect(lx-r,ly-r,2*r,2*r);g.globalAlpha=1;
    g.translate(lx,ly);g.scale(LOUPE_ZOOM,LOUPE_ZOOM);g.translate(-px,-py);
    scene(g,S,t,true);crosshair(g,S,px,py,u/LOUPE_ZOOM);
    g.restore();
    g.strokeStyle=ink.key;g.lineWidth=1.5*u;g.beginPath();g.arc(lx,ly,r,0,TAU);g.stroke();
    g.restore();}

  function destroy(){cancel();
    canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);
    canvas.removeEventListener('pointerup',finish);canvas.removeEventListener('pointercancel',cancelled);
    canvas.removeEventListener('lostpointercapture',lostCapture);canvas.removeEventListener('pointerleave',leave);}

  return{draw,destroy};}
