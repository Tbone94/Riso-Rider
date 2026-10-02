// physics.js — one simulation for both views.
// The side view is the x/y plane (800×500 design units, y down). Every surface is
// extruded sideways along z with a half-width (hw), so the same world can be ridden
// in first person: steer along z, and if you drift past a surface's edge you fall
// past it. Position-based: predict → resolve contacts → derive velocity, 8 substeps.
// Pure module: no DOM, so it runs in node for tests (tools/validate.mjs).

export const W=800,H=500,G=900,R=9,DT=1/60,SUB=8;
export const COST={line:1,wind:1.2,rope:1.5,well:120,sling:120};
export const WIDTH={block:70,line:13,rope:24,hazard:1e9};   // half-widths along z
export const WIND={radius:40,speed:430,grip:7,hw:44,funnel:8,cross:.6};        // currents carry you at a set speed
// Gravity wells are smooth magnets. Pull = strength·(1−d/range)^p toward the well, eased to 0 inside `core`
// (no spike at the centre), with light velocity damping (coreDamp /s) in the core so nothing slingshots.
// The summed pull of all wells is capped at `max`. Wells only act while you're airborne (no rocking-on-the-
// ground traps). A well can briefly hold you up, but after `hold` s of airborne time in wells' reach their
// pull fades over `letGo` s (rider.wellGrip 1→0), so nothing hovers or loops forever: you fall along gravity.
// keepOut: wells can't be placed that close to the goal.
export const WELL={strength:1000,range:320,p:1,core:36,coreDamp:2.5,max:1100,hold:1.2,letGo:1,keepOut:80};
// Acceleration magnitude a well applies at distance d (design units/s²). Pure; the side view draws the
// pull field from this, so the picture matches the physics exactly.
export function wellForce(d){if(!(d<WELL.range)||d<0)return 0;const f=WELL.strength*Math.pow(1-d/WELL.range,WELL.p);return d<WELL.core?f*(d/WELL.core)*(2-d/WELL.core):f;}
export const ROPE={k:150,damp:.25,pad:R+2};
// Slings (contract v4): a ring you place and aim. Pass within rc (and |z| < rc) and you're caught: you orbit
// at radius ro, kinematically (no gravity, no collisions, no hazards), at speed clamp(entry, minSpeed, maxSpeed),
// turning the way you came in, until your heading equals the sling's aim `a` (at least minSweep of turn).
// Then you're released at unit(a)·speed·boost (capped at maxSpeed). The same sling can't re-catch you for
// `cooldown` s nor until you've left its capture radius, and each sling catches you at most `maxCatches` times per ride (no endless loops, e.g. aimed
// straight up or into a wall). z eases to the centre at zEase /s while orbiting. After release, gravity eases
// back in over `float` s (∝ t²), so a fling flies nearly straight at first, like a thrown dart: aim at the ring.
// launch: every fling leaves at this fixed speed, however fast the rider arrived, so the aim preview is exact
// and 'point it at the ring' works from anywhere on the path (the orbit itself still whips at the entry speed).
export const SLING={rc:34,ro:27,minSpeed:380,maxSpeed:700,minSweep:.6,boost:1.1,cooldown:.5,zEase:6,maxCatches:3,float:.6,launch:560};                  // ropes are trampoline springs
// Forgiveness (Celeste): coyote time after leaving an edge, a buffered jump press, and softer
// gravity near the top of a jump while the button is held (only for your own jumps, not falls).
export const JUMP={v:300,coyote:.15,buffer:.15,apexGravity:.6,apexBand:110};
// Lateral (z) control. Top level = wide roads; narrow = ribbons under 30 half-width (lines, ropes);
// air = airborne. acc: steering accel, damp: velocity damping (1/s), center: pull to z=0 (1/s²).
// Tightropes sway: a smooth side-to-side push of `sway` that builds over `build` seconds on the
// same line and swings at `freq` rad/s (scaled down below speed 150, so a stopped rider stays put).
// It's near-resonant, so if you never steer it slowly grows until it throws you off a long rope
// (~2.5 s+). Short lines are safe. Steering against it cancels it: the tension is readable, not random.
// assist 1 multiplies centring by assist.center and sway by assist.sway (app also runs 0.7× time).
export const STEER={acc:600,damp:6,center:5,sway:350,build:1.6,freq:2.4,
  narrow:{acc:250,damp:7.5,center:4},air:{acc:250,damp:4,center:2},assist:{center:3,sway:.3}};
// Push (↑) drives toward the level's forward direction; ↓ brakes, and once you're nearly stopped it rolls you
// backward (up to `back`). In the air ↑/↓ give a small forward/back nudge (`air`, up to `airMax` along x),
// except during a sling's fling, so the fling follows its preview exactly.
export const PUSH={acc:260,max:260,brake:1.6,back:160,air:120,airMax:260};
// Catching (playability): every surface and tool sits at z=0, but a rider arriving a little to the side used to
// sail past it in 3D (a rope "broke", a sling or wind "didn't pick up"). Arriving at a new surface, rope, wind
// or sling, the sideways window is `z` wider, and for `t` s afterwards (all the time on a rope or in wind) z is
// pulled inside half the surface's width at rate `pull` /s. Riders who steered off a side (offSide) get none of it.
export const CATCH={z:26,pull:14,t:.3};
// Round A. Ink drops: collected within r (x/y) and hz (z); refund counts for stars only.
export const DROP={r:16,hz:22};
// Ice: no friction, steering ×steer, lateral damping `damp` (you keep drifting), no centring/push/brake.
export const ICE={steer:.15,damp:.6};
// Boost pads: while grounded within `reach` of the pad, speed along a→b is driven up to `speed`.
export const BOOST={speed:520,acc:1400,reach:14};
// Crumbling blocks: gone `delay` s after first contact; the pieces fall for `fall` s (visual only).
export const CRUMBLE={delay:.35,fall:.6};
export const FRICTION=.0012;
export const NO_INPUT=Object.freeze({steer:0,jump:false,jumpHeld:false,push:0});
// Path samples record what the rider was doing, for the ghost trail in the editor.
export const STATE={ground:0,air:1,rope:2,wind:3};

// ---------- geometry ----------
export function closest(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy||1;let t=((px-ax)*dx+(py-ay)*dy)/l2;t=t<0?0:t>1?1:t;return[ax+dx*t,ay+dy*t,t];}
export const polyLen=p=>{let s=0;for(let i=1;i<p.length;i++)s+=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]);return s;};
export function itemCost(it){return it.type==='well'||it.type==='sling'?COST[it.type]:it.type==='rope'?COST.rope*Math.hypot(it.b[0]-it.a[0],it.b[1]-it.a[1]):COST[it.type]*polyLen(it.pts);}
export const inkUsed=items=>items.reduce((s,it)=>s+itemCost(it),0);
// refund (ink drops collected on the ride) lowers the ink that counts for stars.
export function stars(level,used,refund=0){const p=level.par,u=Math.max(0,used-(refund||0));return u<=p[0]?3:u<=p[1]?2:1;}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
// Broadphase: a uniform grid of CELL-unit cells. Each segment is listed in every cell its reach
// box touches (so a point query is exact), and in every column its x-range spans (for groundBelow).
const CELL=40,NONE=[],cellKey=(cx,cy)=>(cx+512)*4096+(cy+512);
function index(w){const grid=new Map(),cols=new Map(),add=(m,k,i)=>{let a=m.get(k);if(!a)m.set(k,a=[]);a.push(i);};
  w.segs.forEach((s,i)=>{const c0=Math.floor(s.x0/CELL),c1=Math.floor(s.x1/CELL),r0=Math.floor(s.y0/CELL),r1=Math.floor(s.y1/CELL);
    for(let cx=c0;cx<=c1;cx++){for(let cy=r0;cy<=r1;cy++)add(grid,cellKey(cx,cy),i);}
    for(let cx=Math.floor(Math.min(s.ax,s.bx)/CELL);cx<=Math.floor(Math.max(s.ax,s.bx)/CELL);cx++)add(cols,cx,i);});
  w.grid=grid;w.cols=cols;}
// (Falls back to every segment if the index is missing, e.g. on a world rebuilt from JSON.)
const near=(w,x,y)=>w.grid instanceof Map?w.grid.get(cellKey(Math.floor(x/CELL),Math.floor(y/CELL)))||NONE:w.segs.keys();

// ---------- world ----------
// side: which side of the rope the rider is pressing from (0 = not touching).
// depth: how far the rider has stretched it. wob: leftover wobble after a bounce.
export function makeRope(a,b){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
  return{ax:a[0],ay:a[1],bx:b[0],by:b[1],len,tx:dx/len,ty:dy/len,nx:-dy/len,ny:dx/len,hw:WIDTH.rope,side:0,depth:0,cx:0,cy:0,wob:0,wobT:9,wobSide:1};}

// Extra rider fields (read-only for renderers): jumped (airborne from your own jump),
// sway (-1..1, the tightrope's current push, for leaning the camera), lineT (s on this line),
// offSide (true once you've steered off the side of a surface and are falling past it),
// owner (id of the block/line/rope last stood on; ropes are negative),
// surface (the seg kind you're on: 'block'|'line'|'rope'|'ice'|'crumble', or null in the air).
// groundKind stays 'block'|'line'|'rope' (ice and crumble report 'block' there: they're wide roads).
export function build(L,items,opts={}){
  const w={t:0,status:'run',still:0,assist:opts.assist||0,path:[],events:[],trail:[],refund:0,
    rider:{x:L.start.x,y:L.start.y,z:0,vx:L.start.vx||0,vy:L.start.vy||0,vz:0,a:0,
      grounded:false,groundKind:null,groundHw:WIDTH.block,n:[0,-1],coyote:1e9,jumpBuf:0,airT:0,speed:0,
      jumped:false,sway:0,lineT:0,swayT:0,swaySign:1,offSide:false,offY:0,owner:0,surface:null,boost:-1,
      sling:-1,slingK:0,slingAng:0,slingDir:1,slingSpeed:0,slingSwept:0,slingSweep:0,slingLast:-1,slingLastT:-1e9,slingFly:9,catchT:0,catchHw:WIDTH.block,windIn:[],windSkip:[]},
    segs:[],hazards:[],ropes:[],winds:[],wells:[],drops:[],crumbles:[],boosts:[],slings:[],slingCatches:[]};
  // x0,x1,y0,y1: the segment's bounding box grown by its reach, for a cheap early-out.
  // owner: which block or drawn line the segment belongs to.
  let owner=0;
  const edges=(p,closed,th,hw,kind,out)=>{const n=closed?p.length:p.length-1,m=R+th+2;owner++;for(let i=0;i<n;i++){const a=p[i],b=p[(i+1)%p.length];
    out.push({ax:a[0],ay:a[1],bx:b[0],by:b[1],th,hw,kind,owner,x0:Math.min(a[0],b[0])-m,x1:Math.max(a[0],b[0])+m,y0:Math.min(a[1],b[1])-m,y1:Math.max(a[1],b[1])+m});}};
  L.blocks.forEach(p=>edges(p,true,0,L.blockHw||WIDTH.block,'block',w.segs));
  (L.ice||[]).forEach(p=>edges(p,true,0,L.blockHw||WIDTH.block,'ice',w.segs));
  (L.crumble||[]).forEach((p,i)=>{const n0=w.segs.length;edges(p,true,0,L.blockHw||WIDTH.block,'crumble',w.segs);
    for(let k=n0;k<w.segs.length;k++)w.segs[k].crumble=i;w.crumbles.push({poly:p,touchedAt:null,gone:false,k:0});});
  (L.boosts||[]).forEach(b=>{const dx=b.b[0]-b.a[0],dy=b.b[1]-b.a[1],l=Math.hypot(dx,dy)||1;w.boosts.push({ax:b.a[0],ay:b.a[1],bx:b.b[0],by:b.b[1],tx:dx/l,ty:dy/l,len:l});});
  (L.drops||[]).forEach(d=>w.drops.push({x:d.x,y:d.y,z:d.z||0,v:d.v||25,got:false,gotT:null}));
  (L.hazards||[]).forEach(p=>edges(p,false,4,WIDTH.hazard,'hazard',w.hazards));
  items.forEach(it=>{
    if(it.type==='line'){if(it.pts&&it.pts.length>1)edges(it.pts,false,2.5,WIDTH.line,'line',w.segs);}
    else if(it.type==='wind'){const s=[],m=WIND.radius;for(let i=1;i<it.pts.length;i++){const a=it.pts[i-1],b=it.pts[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<1e-6)continue;
      s.push({ax:a[0],ay:a[1],bx:b[0],by:b[1],tx:(b[0]-a[0])/l,ty:(b[1]-a[1])/l,x0:Math.min(a[0],b[0])-m,x1:Math.max(a[0],b[0])+m,y0:Math.min(a[1],b[1])-m,y1:Math.max(a[1],b[1])+m});}
      if(s.length){const grid=new Map();s.forEach((q,i)=>{for(let cx=Math.floor(q.x0/CELL);cx<=Math.floor(q.x1/CELL);cx++)for(let cy=Math.floor(q.y0/CELL);cy<=Math.floor(q.y1/CELL);cy++){const k=cellKey(cx,cy);let a=grid.get(k);if(!a)grid.set(k,a=[]);a.push(i);}});
        w.winds.push({segs:s,pts:it.pts,hw:WIND.hw,grid});}}
    else if(it.type==='rope'){const rp=makeRope(it.a,it.b);rp.owner=-(++owner);w.ropes.push(rp);}
    else if(it.type==='well')w.wells.push({x:it.x,y:it.y});
    else if(it.type==='sling')w.slings.push({x:it.x,y:it.y,a:Number.isFinite(it.a)?it.a:-Math.PI/4,rc:SLING.rc,ro:SLING.ro});});
  index(w);
  Object.defineProperty(w,'level',{value:L,enumerable:false,writable:true});   // for bots; hidden from JSON
  return w;}

// Highest surface at or below (x,y) that is under the rider laterally (|z| within its width).
// Used for the blob shadow, the autopilot's gap check, and landing previews.
export function groundBelow(w,x,y,z){let best=null;
  const test=(ax,ay,bx,by,hw,kind)=>{if(Math.abs(z)>hw+R*.4)return;const lo=Math.min(ax,bx),hi=Math.max(ax,bx);if(x<lo||x>hi||hi-lo<1e-6)return;
    const yy=ay+(by-ay)*(x-ax)/(bx-ax);if(yy>=y-2&&(!best||yy<best.y))best={y:yy,kind};};
  const col=w.cols instanceof Map?w.cols.get(Math.floor(x/CELL))||NONE:null;
  if(col)for(const i of col){const s=w.segs[i];if(s.crumble!=null&&w.crumbles[s.crumble].gone)continue;test(s.ax,s.ay,s.bx,s.by,s.hw,s.kind);}
  else for(const s of w.segs)if(s.crumble==null||!w.crumbles[s.crumble].gone)test(s.ax,s.ay,s.bx,s.by,s.hw,s.kind);
  for(const rp of w.ropes)test(rp.ax,rp.ay,rp.bx,rp.by,rp.hw,'rope');
  return best;}

// input: {steer:-1..1, jump:bool (pressed this frame), jumpHeld:bool, push:-1..1}
export function step(w,L,input=NO_INPUT){
  if(w.status!=='run')return;
  const r=w.rider,h=DT/SUB,assist=w.assist,wasGrounded=r.grounded;
  if(r.sling>=0){orbit(w,r);return tail(w,L,r,input,false,false);}
  if(input.jump)r.jumpBuf=JUMP.buffer;

  // ---- lateral (z): steering, a gentle pull to the middle, tightrope sway ----
  const narrow=r.grounded&&r.groundHw<30,onIce=r.grounded&&r.surface==='ice',K=!r.grounded?STEER.air:narrow?STEER.narrow:STEER;
  const aC=onIce?0:assist?STEER.assist.center:1,aS=assist?STEER.assist.sway:1;
  if(r.grounded&&r.groundKind==='line'){if(r.lineT===0)r.swaySign=Math.floor(r.x/37)%2?-1:1;r.lineT+=DT;r.swayT+=DT;}
  else if(r.grounded){r.lineT=0;r.swayT=0;}
  else r.lineT=Math.max(0,r.lineT-DT*.5);          // brief hops keep the tension; a real flight resets it
  if(!r.grounded&&r.lineT===0)r.swayT=0;
  const ramp=Math.min(1,r.lineT/STEER.build);
  r.sway=r.grounded&&r.groundKind==='line'?r.swaySign*ramp*ramp*Math.min(1,r.speed/150)*Math.sin(STEER.freq*r.swayT):0;   // a stopped rider doesn't sway
  let az=clamp(input.steer||0,-1,1)*K.acc*(onIce?ICE.steer:1)-(r.offSide?0:r.z*K.center*aC)+r.sway*STEER.sway*aS;
  r.vz=(r.vz+az*DT)*Math.exp(-(onIce?ICE.damp:K.damp)*DT);
  if(!Number.isFinite(r.vz))r.vz=0;
  r.z+=r.vz*DT;
  if(r.catchT>0&&!r.offSide){const lim=r.catchHw*.5,zt=clamp(r.z,-lim,lim);if(zt!==r.z){r.z+=(zt-r.z)*(1-Math.exp(-CATCH.pull*DT));if(r.vz*(r.z-zt)>0)r.vz=0;}r.catchT=Math.max(0,r.catchT-DT);}
  const slack=r.offSide?0:CATCH.z;   // the wider sideways window for arriving at something new

  // A well can't trap you: after `hold` s of airborne time inside wells' reach, their pull fades out
  // over `letGo` s, so any back-and-forth dies and you fall along gravity. Leaving every field resets it.
  if(w.wells.length){const inField=w.wells.some(wl=>Math.hypot(wl.x-r.x,wl.y-r.y)<WELL.range);
    r.wellT=inField?(r.wellT||0)+(r.grounded?0:DT):0;r.wellGrip=clamp(1-(r.wellT-WELL.hold)/WELL.letGo,0,1);}
  let grounded=false,inWind=false,onRope=false;const windIn=[];
  for(let sub=0;sub<SUB;sub++){
    let ax=0,ay=G;
    const fly=r.slingFly+sub*h;if(fly<SLING.float&&!r.grounded){const q=fly/SLING.float;ay*=q*q;}   // the fling's float
    if(r.jumped&&input.jumpHeld&&!r.grounded&&Math.abs(r.vy)<JUMP.apexBand)ay*=JUMP.apexGravity;
    for(let wi=0;wi<w.winds.length;wi++){const wind=w.winds[wi];if(Math.abs(r.z)>wind.hw+slack)continue;let best=1e9,bs=null,bx=0,by=0;
      for(const si of wind.grid instanceof Map?wind.grid.get(cellKey(Math.floor(r.x/CELL),Math.floor(r.y/CELL)))||NONE:wind.segs.keys()){const s=wind.segs[si];if(r.x<s.x0||r.x>s.x1||r.y<s.y0||r.y>s.y1)continue;const[cx,cy]=closest(r.x,r.y,s.ax,s.ay,s.bx,s.by),d=Math.hypot(r.x-cx,r.y-cy);if(d<best){best=d;bs=s;bx=cx;by=cy;}}
      // A sling's fling isn't grabbed back by the current it was caught from, until it has left that current.
      if(r.windSkip.includes(wi)){if(best>=WIND.radius)r.windSkip=r.windSkip.filter(i=>i!==wi);continue;}
      if(best<WIND.radius){const k=Math.sqrt(1-best/WIND.radius);inWind=true;if(!windIn.includes(wi))windIn.push(wi);
        // Grip is strongest when you're moving across the current (that's when fast riders used to punch through).
        const vn=Math.abs(r.vx*bs.ty-r.vy*bs.tx),gk=WIND.grip*(1+Math.min(WIND.cross,vn/300))*k;
        ax+=(bs.tx*WIND.speed-r.vx)*gk+(bx-r.x)*WIND.funnel*k;ay+=(bs.ty*WIND.speed-r.vy)*gk+(by-r.y)*WIND.funnel*k-G*.85*k;}}
    if(w.wells.length&&!r.grounded){let wx=0,wy=0,damp=0;   // wells pull only while you're in the air
      for(const wl of w.wells){const dx=wl.x-r.x,dy=wl.y-r.y,d=Math.hypot(dx,dy);
        if(d<WELL.range&&d>1e-6){const f=wellForce(d);wx+=dx/d*f;wy+=dy/d*f;if(d<WELL.core)damp=Math.max(damp,1-d/WELL.core);}}
      const m=Math.hypot(wx,wy);if(m>WELL.max){wx*=WELL.max/m;wy*=WELL.max/m;}const gr=r.wellGrip??1;ax+=wx*gr;ay+=wy*gr;
      if(damp>0){ax-=r.vx*WELL.coreDamp*damp;ay-=r.vy*WELL.coreDamp*damp;}}
    for(const rp of w.ropes){
      if(Math.abs(r.z)>rp.hw+R*.4+slack){if(rp.side){rp.side=0;rp.depth=0;}continue;}
      const rx=r.x-rp.ax,ry=r.y-rp.ay,t=(rx*rp.tx+ry*rp.ty)/rp.len,sd=rx*rp.nx+ry*rp.ny;
      if(!rp.side&&t>0&&t<1&&Math.abs(sd)<ROPE.pad)rp.side=sd<0?-1:1;
      if(!rp.side)continue;const p=ROPE.pad-rp.side*sd;
      if(p<=0||t<-.02||t>1.02){if(rp.depth>2){rp.wob=rp.depth;rp.wobT=0;rp.wobSide=rp.side;w.events.push({type:'bounce',x:r.x,y:r.y,t:w.t});}rp.side=0;rp.depth=0;continue;}
      // Stiffer toward the anchors, like a real trampoline.
      const e=Math.max(.3,Math.sin(Math.PI*Math.min(1,Math.max(0,t)))),vn=(r.vx*rp.nx+r.vy*rp.ny)*rp.side,f=ROPE.k/e*p-ROPE.damp*vn;
      ax+=rp.nx*rp.side*f;ay+=rp.ny*rp.side*f;rp.depth=p;rp.cx=r.x-rp.nx*rp.side*ROPE.pad;rp.cy=r.y-rp.ny*rp.side*ROPE.pad;
      onRope=true;grounded=true;r.n=[rp.nx*rp.side,rp.ny*rp.side];r.groundHw=rp.hw;r.groundKind='rope';r.owner=rp.owner;r.catchT=CATCH.t;r.catchHw=rp.hw;}
    // push / brake along the surface you're on. Push always drives toward the level's forward direction
    // (the way the first-person camera faces), so ↑ while rolling backward slows you and sends you forward.
    const fwd=L?Math.sign(L.goal.x-L.start.x)||1:1;
    if(r.grounded&&input.push&&r.surface!=='ice'){const tx=-r.n[1],ty=r.n[0],dir=Math.sign(tx*fwd)||1,along=(r.vx*tx+r.vy*ty)*dir;
      if(input.push>0){if(along<PUSH.max){ax+=tx*dir*PUSH.acc*input.push;ay+=ty*dir*PUSH.acc*input.push;}}
      else if(along>30){const k=1-PUSH.brake*h*-input.push;r.vx*=k;r.vy*=k;}       // brake…
      else if(along>-PUSH.back){ax+=tx*dir*PUSH.acc*input.push;ay+=ty*dir*PUSH.acc*input.push;}}   // …then roll backward
    else if(!r.grounded&&input.push&&r.sling<0&&r.slingFly>=SLING.float){const along=r.vx*fwd*Math.sign(input.push);
      if(along<PUSH.airMax)ax+=fwd*PUSH.air*input.push;}
    // boost pads: drive speed along the pad up to BOOST.speed while grounded on it
    if(r.grounded&&w.boosts.length){let on=-1;for(let bi=0;bi<w.boosts.length;bi++){const b=w.boosts[bi],[cx,cy]=closest(r.x,r.y,b.ax,b.ay,b.bx,b.by);
        if(Math.hypot(r.x-cx,r.y-cy)<=BOOST.reach&&Math.abs(r.z)<=WIDTH.block+R*.4){on=bi;const va=r.vx*b.tx+r.vy*b.ty;if(va<BOOST.speed){const dv=Math.min(BOOST.acc*h,BOOST.speed-va);ax+=b.tx*dv/h;ay+=b.ty*dv/h;}break;}}
      if(on>=0&&r.boost!==on)w.events.push({type:'boost',i:on,x:r.x,y:r.y,t:w.t});r.boost=on;}
    else if(!r.grounded&&r.airT>.1)r.boost=-1;
    r.vx+=ax*h;r.vy+=ay*h;const pvx=r.vx,pvy=r.vy;
    const ox=r.x,oy=r.y;r.x+=r.vx*h;r.y+=r.vy*h;
    // Contacts. A surface only counts while you're over it laterally, and only if you reach it
    // from outside: if you were already deep inside it before this substep (you fell past it
    // off its side and then steered back), you keep falling instead of being popped out.
    let contact=null;
    for(let it=0;it<2;it++)for(const si of near(w,r.x,r.y)){const s=w.segs[si];if(r.x<s.x0||r.x>s.x1||r.y<s.y0||r.y>s.y1)continue;
      // the wider window only for something new (landing, or rolling onto another surface), or while still settling onto it
      if(Math.abs(r.z)>s.hw+R*.4+(!r.grounded||s.owner!==r.owner||r.catchT>0?slack:0))continue;
      if(s.crumble!=null&&w.crumbles[s.crumble].gone)continue;
      const[cx,cy]=closest(r.x,r.y,s.ax,s.ay,s.bx,s.by),dx=r.x-cx,dy=r.y-cy,d=Math.hypot(dx,dy),rad=R+s.th;
      if(d>=rad||d<1e-6)continue;
      {const[qx,qy]=closest(ox,oy,s.ax,s.ay,s.bx,s.by);if(Math.hypot(ox-qx,oy-qy)<rad-4)continue;}
      const nx=dx/d,ny=dy/d;r.x+=nx*(rad-d);r.y+=ny*(rad-d);
      if(s.crumble!=null&&w.crumbles[s.crumble].touchedAt==null)w.crumbles[s.crumble].touchedAt=w.t;
      if(!contact||ny<contact[1])contact=[nx,ny,s];}     // keep the most floor-like contact
    r.vx=(r.x-ox)/h;r.vy=(r.y-oy)/h;
    // Contacts only redirect or absorb speed. When a surface pinches the rider (a line wedged against a block,
    // a sling releasing inside a ledge), stacked push-outs would otherwise turn into a launch at thousands/s.
    if(contact){const s0=Math.hypot(pvx,pvy)+1,s1=Math.hypot(r.vx,r.vy);if(s1>s0){const k=s0/s1;r.vx*=k;r.vy*=k;}}
    if(contact){const[nx,ny,s]=contact,vn=r.vx*nx+r.vy*ny,tx=r.vx-nx*vn,ty=r.vy-ny*vn,f=s.kind==='ice'?0:FRICTION;r.vx-=tx*f;r.vy-=ty*f;
      if(ny<-.2){if(!r.grounded||r.owner!==s.owner||r.catchT>0){r.catchT=Math.max(r.catchT,!r.grounded||r.owner!==s.owner?CATCH.t:0);r.catchHw=s.hw;}
        grounded=true;r.n=[nx,ny];r.groundHw=s.hw;r.groundKind=s.kind==='line'?'line':'block';r.surface=s.kind;r.owner=s.owner;}}   // walls/ceilings aren't ground
    r.a+=r.vx*h/R;
  }
  if(!Number.isFinite(r.x+r.y+r.vx+r.vy)){r.vx=r.vy=0;r.x=Number.isFinite(r.x)?r.x:L.start.x;r.y=Number.isFinite(r.y)?r.y:H+100;}
  r.grounded=grounded;r.speed=Math.hypot(r.vx,r.vy);r.windIn=windIn;
  if(inWind&&!r.offSide){r.catchT=CATCH.t;r.catchHw=WIND.hw;}
  if(onRope&&grounded&&r.groundKind==='rope')r.surface='rope';else if(!grounded)r.surface=null;
  if(grounded){if(!wasGrounded&&r.airT>.15)w.events.push({type:'land',x:r.x,y:r.y,t:w.t,v:r.speed});r.coyote=0;r.airT=0;r.jumped=false;r.offSide=false;}
  else{r.coyote+=DT;r.airT+=DT;
    // Lost the surface because you steered past its edge (not by jumping or rolling off its end).
    if(!r.offSide&&!r.jumped&&r.airT<.1&&Math.abs(r.z)>r.groundHw+R*.4+(r.catchT>0?CATCH.z:0)){r.offSide=true;r.offY=r.y;r.coyote=1e9;}}

  // jump: buffered press + coyote time, pushed off the surface and up
  if(r.jumpBuf>0&&r.coyote<=JUMP.coyote){let jx=r.n[0]*.5,jy=r.n[1]*.5-.5;const l=Math.hypot(jx,jy)||1;jx/=l;jy/=l;
    const vn=r.vx*jx+r.vy*jy;if(vn<0){r.vx-=jx*vn;r.vy-=jy*vn;}
    r.vx+=jx*JUMP.v;r.vy+=jy*JUMP.v;r.coyote=1e9;r.jumpBuf=0;r.grounded=false;r.jumped=true;w.events.push({type:'jump',x:r.x,y:r.y,t:w.t});}
  r.jumpBuf=Math.max(0,r.jumpBuf-DT);
  if(r.slingFly<9)r.slingFly=r.grounded?9:r.slingFly+DT;
  if(w.slings.length)capture(w,r);
  return tail(w,L,r,input,onRope,inWind);}

// Everything after the motion: clocks, crumbles, drops, the path, and how the ride ends.
function tail(w,L,r,input,onRope,inWind){
  w.t+=DT;for(const rp of w.ropes)rp.wobT+=DT;
  for(let i=0;i<w.crumbles.length;i++){const c=w.crumbles[i];if(c.touchedAt==null||c.k>=1)continue;const el=w.t-c.touchedAt;
    c.k=Math.min(1,el/(CRUMBLE.delay+CRUMBLE.fall));if(!c.gone&&el>=CRUMBLE.delay){c.gone=true;w.events.push({type:'crumble',i,x:r.x,y:r.y,t:w.t});}}
  // ink drops: swept test from last frame's position, so fast riders don't skip them
  if(w.drops.length){const px=w.prevX??r.x,py=w.prevY??r.y;for(const d of w.drops){if(d.got||Math.abs(r.z-d.z)>=DROP.hz)continue;
    const[cx,cy]=closest(d.x,d.y,px,py,r.x,r.y);if(Math.hypot(d.x-cx,d.y-cy)<DROP.r){d.got=true;d.gotT=w.t;w.refund+=d.v;w.events.push({type:'drop',x:d.x,y:d.y,z:d.z,v:d.v,t:w.t});}}}
  w.prevX=r.x;w.prevY=r.y;
  if(Math.round(w.t/DT)%2===0&&!w.rollout){w.path.push([r.x,r.y,r.z,onRope?STATE.rope:inWind?STATE.wind:r.grounded?STATE.ground:STATE.air]);
    w.trail.unshift([r.x,r.y]);if(w.trail.length>28)w.trail.pop();}

  const end=(status)=>{w.status=status;w.events.push({type:status,x:r.x,y:r.y,t:w.t});};
  if(r.sling<0)for(const s of w.hazards){if(r.x<s.x0||r.x>s.x1||r.y<s.y0||r.y>s.y1)continue;const[cx,cy]=closest(r.x,r.y,s.ax,s.ay,s.bx,s.by);if(Math.hypot(r.x-cx,r.y-cy)<R+s.th)return end(r.offSide?'fell':'popped');}
  if(Math.hypot(r.x-L.goal.x,r.y-L.goal.y)<L.goal.r&&Math.abs(r.z)<L.goal.r)return end('win');
  if(r.y>H+60||r.x<-80||r.x>W+80||Math.abs(r.z)>300)return end('fell');
  // Off the side and well below where you left, with nothing under you: call it now, cleanly.
  if(r.offSide&&r.y>r.offY+90&&![0,.3,.6].some(k=>groundBelow(w,r.x+r.vx*k,r.y,r.z)))return end('fell');
  if(r.speed<10){w.still+=DT;if(w.still>2.5)return end('stuck');}else w.still=0;   // pushing against a wall still counts as stuck
  if(w.t>45)end('stuck');}

// ---------- slings ----------
const TAU=Math.PI*2,wrap=a=>((a%TAU)+TAU)%TAU;
function capture(w,r){
  // Hysteresis: the sling you just left can't catch you again until you've been outside its capture radius.
  if(r.slingLast>=0&&!r.slingLeft){const sl=w.slings[r.slingLast];if(Math.hypot(r.x-sl.x,r.y-sl.y)>sl.rc+2)r.slingLeft=true;}
  for(let i=0;i<w.slings.length;i++){const sl=w.slings[i];
  if(i===r.slingLast&&(w.t-r.slingLastT<SLING.cooldown||!r.slingLeft))continue;
  if((w.slingCatches[i]||0)>=SLING.maxCatches)continue;
  // Swept: the closest point of this frame's motion, so a fast rider grazing the ring can't skip it.
  const px=w.prevX??r.x,py=w.prevY??r.y,[qx,qy]=closest(sl.x,sl.y,px,py,r.x,r.y),dx=qx-sl.x,dy=qy-sl.y,d=Math.hypot(dx,dy);
  if(d>=sl.rc||Math.abs(r.z)>=sl.rc+(r.offSide?0:CATCH.z))continue;
  const sp=Math.hypot(r.vx,r.vy),th=d>1e-6?Math.atan2(dy,dx):Math.atan2(-r.vy,-r.vx),cr=dx*r.vy-dy*r.vx,dir=cr<0?-1:1;
  const exitTh=sl.a-dir*Math.PI/2;let sweep=wrap(dir*(exitTh-th));if(sweep<SLING.minSweep)sweep+=TAU;
  Object.assign(r,{sling:i,slingDir:dir,slingAng:th,slingSwept:0,slingSweep:sweep,slingK:0,slingSpeed:clamp(Math.max(sp,SLING.minSpeed),0,SLING.maxSpeed),
    grounded:false,surface:null,groundKind:null,coyote:1e9,jumpBuf:0,jumped:false,offSide:false,lineT:0,swayT:0,sway:0,boost:-1,windSkip:[...r.windIn]});
  r.x=sl.x+sl.ro*Math.cos(th);r.y=sl.y+sl.ro*Math.sin(th);
  w.slingCatches[i]=(w.slingCatches[i]||0)+1;w.events.push({type:'sling',i,x:r.x,y:r.y,t:w.t});return;}}
// The orbit spirals in over its last `SPIRAL` rad, so the release is at the sling's centre, heading along the aim:
// the fling then follows the dotted preview line exactly (it used to leave from the ring's edge, ro to one side).
const SPIRAL=1.6;
function orbit(w,r){const sl=w.slings[r.sling],s=r.slingSpeed,om=s/sl.ro;let dth=om*DT,done=false;
  if(r.slingSwept+dth>=r.slingSweep){dth=r.slingSweep-r.slingSwept;done=true;}
  r.slingSwept+=dth;r.slingAng+=r.slingDir*dth;r.slingK=r.slingSweep?r.slingSwept/r.slingSweep:1;
  const left=r.slingSweep-r.slingSwept,span=Math.min(SPIRAL,r.slingSweep),u=clamp(left/span,0,1),rr=sl.ro*u*u*(3-2*u);
  const ox=r.x,oy=r.y;r.x=sl.x+rr*Math.cos(r.slingAng);r.y=sl.y+rr*Math.sin(r.slingAng);
  const tx=-Math.sin(r.slingAng)*r.slingDir,ty=Math.cos(r.slingAng)*r.slingDir;
  if(rr>2){r.vx=tx*s;r.vy=ty*s;}else{r.vx=(r.x-ox)/DT;r.vy=(r.y-oy)/DT;}r.speed=s;
  r.z*=Math.exp(-SLING.zEase*DT);r.vz=0;r.a+=s*DT/R;r.airT+=DT;
  if(done){r.x=sl.x;r.y=sl.y;const v=SLING.launch;r.vx=Math.cos(sl.a)*v;r.vy=Math.sin(sl.a)*v;r.speed=v;
    w.events.push({type:'slingOut',i:r.sling,x:r.x,y:r.y,t:w.t,v});r.slingLast=r.sling;r.slingLastT=w.t;r.slingLeft=false;r.sling=-1;r.slingK=1;r.slingFly=0;}}
// Preview of a sling's throw: the release point and the ballistic arc for t seconds, as the physics does it.
// The rider is released from the sling's centre (dir 0, the default), so this is exactly the flight. dir ±1 starts
// the line ro to either side of the ring instead (the old release point; kept for API compatibility).
export function slingPreview(sl,speed=450,t=.45,dir=0){const ro=dir?sl.ro??SLING.ro:0,a=sl.a,th=a-dir*Math.PI/2;
  const x0=sl.x+ro*Math.cos(th),y0=sl.y+ro*Math.sin(th),v=SLING.launch;   // fixed launch speed; `speed` kept for API compatibility
  // Same integration as the physics (gravity eased in over SLING.float), stepped at the physics substep.
  const h=DT/SUB,n=Math.round(t/h),pts=[[x0,y0]];let x=x0,y=y0,vx=Math.cos(a)*v,vy=Math.sin(a)*v;
  for(let k=1;k<=n;k++){const f=(k-1)*h,g=f<SLING.float?G*(f/SLING.float)**2:G;vy+=g*h;x+=vx*h;y+=vy*h;if(k%Math.max(1,Math.round(n/18))===0||k===n)pts.push([x,y]);}return pts;}

// The aim (radians) whose fling passes closest to (tx,ty): a coarse sweep, then refinement, using slingPreview's
// own flight (centre line, dir 0). The side view uses it for a freshly placed sling's default aim.
export function slingAim(sl,tx,ty,t=1.4){const miss=a=>{const p=slingPreview({...sl,a},SLING.launch,t,0);let m=1e9;
    for(let i=1;i<p.length;i++){const[c0,c1]=closest(tx,ty,p[i-1][0],p[i-1][1],p[i][0],p[i][1]);m=Math.min(m,Math.hypot(tx-c0,ty-c1));}return m;};
  let best=Math.atan2(ty-sl.y,tx-sl.x),bm=miss(best);
  for(let k=0;k<72;k++){const a=-Math.PI+k*TAU/72,m=miss(a);if(m<bm){bm=m;best=a;}}
  for(let step=TAU/144;step>1e-3;step/=2)for(const a of [best-step,best+step]){const m=miss(a);if(m<bm){bm=m;best=a;}}
  return best;}

// ---------- autopilot ----------
// Stands in for a decent human: steers to the middle, holds jump only during its own jumps,
// pushes only when stalled on flat or uphill ground, and jumps only at an edge where rolling
// on would fail within a couple of seconds but jumping wouldn't (it looks ahead by simulating).
// Rolling off a ledge onto something lower, bouncing on ropes and riding wind are left alone.
function center(w,target=0){const r=w.rider,ice=r.grounded&&r.surface==='ice',k=ice?1/ICE.steer:r.grounded&&r.groundHw<30?1:.7;
  return clamp(-((r.z-target)*.2+r.vz*(ice?.5:.06))*k,-1,1);}
function pushFor(w,inWind){const r=w.rider;if(r.speed>20)w.apPushStall=0;
  if(!r.grounded||r.groundKind==='rope'||inWind||r.speed>60||(w.apPushStall||0)>1.5)return 0;   // pushing got nowhere for 1.5 s: a wall, give up
  const dir=Math.sign(r.vx)||1,ty=r.n[0]*dir;if(ty>=.08)return 0;   // travel tangent's y: <0 uphill, ~0 flat
  if(r.speed<10)w.apPushStall=(w.apPushStall||0)+DT;return .6;}
function inAnyWind(w){const r=w.rider;for(const wind of w.winds){if(Math.abs(r.z)>wind.hw)continue;
  for(const s of wind.segs){const[cx,cy]=closest(r.x,r.y,s.ax,s.ay,s.bx,s.by);if(Math.hypot(r.x-cx,r.y-cy)<WIND.radius)return true;}}return false;}
function simple(w,target=0){const r=w.rider,wind=inAnyWind(w);return{steer:center(w,target),jump:false,jumpHeld:r.jumped,push:pushFor(w,wind)};}
// Drop hunting: the next uncollected drop ahead that the rider's path passes near, and the lateral
// target to steer for (kept inside the surface under the drop, so it never steers off a ribbon).
const hwOf=k=>k==='line'?WIDTH.line:k==='rope'?WIDTH.rope:WIDTH.block;
// Where the rider will be over the next ~1.5 s if it just rides on (x/y only), refreshed every 8 frames.
function predicted(w){if(!w.level)return NONE;if(w.apPath&&w.t-w.apPath.t<8*DT-1e-9)return w.apPath.pts;const c=clone(w),pts=[];
  for(let k=0;k<90&&c.status==='run';k++){step(c,w.level,simple(c));pts.push([c.rider.x,c.rider.y]);}
  w.apPath={t:w.t,pts};return pts;}
function nextDrop(w){const r=w.rider,dir=Math.sign(r.vx)||1,look=Math.max(140,r.speed*1.3);let best=null,bd=1e9;
  for(let i=0;i<w.drops.length;i++){const d=w.drops[i];if(d.got)continue;const dx=(d.x-r.x)*dir;if(dx<-4||dx>look)continue;
    const g=groundBelow(w,d.x,d.y,d.z)||groundBelow(w,d.x,d.y,0);
    let ok=false;if(g&&g.y-d.y<R+75&&g.y-d.y>-5)ok=true;                           // over ground: ride or hop to it
    else{const pp=predicted(w);for(const q of pp)if(Math.hypot(q[0]-d.x,q[1]-d.y)<DROP.r+10){ok=true;break;}}   // on the predicted flight path
    if(ok&&dx<bd){bd=dx;best={i,d,hw:g&&g.y-d.y<R+75?hwOf(g.kind):WIDTH.block};}}   // in the air: as wide as a road
  return best;}
// Also kept inside the ribbon you're on now: never steer off a tightrope for a drop over the road ahead.
function dropTarget(nd,w){if(!nd)return 0;const r=w.rider,cur=r.grounded?r.groundHw:inAnyWind(w)?WIND.hw-2:WIDTH.block,lim=Math.min(nd.hw,cur)-6;
  const z=nd.d.z,aim=Math.sign(z)*Math.max(0,Math.abs(z)-8);   // a little inside the pickup window: less detour
  return clamp(aim,-lim,lim);}
// The lateral position a drop-hunting rider should aim for right now (0 if no drop is in reach).
export function dropAim(w){return dropTarget(nextDrop(w),w);}
function clone(w){return{...w,rider:{...w.rider,n:[...w.rider.n]},ropes:w.ropes.map(o=>({...o})),crumbles:w.crumbles.map(o=>({...o})),drops:w.drops.map(o=>({...o})),slingCatches:[...w.slingCatches],path:[],events:[],trail:[],rollout:true,level:w.level};}
// A copy of the world you can step forward without touching the original (for previews and bots).
// Static geometry is shared; the rider and ropes are copied; path/events/trail start empty.
export function cloneWorld(w){const c=clone(w);c.rollout=false;return c;}
// Score a short future: winning beats surviving beats failing late beats failing early.
// Reaching different ground (another line, block or rope) counts as surviving: any gap after
// that gets its own decision when the rider reaches it.
function rollout(w,L,jumpNow,T=1.8,target=0){const c=clone(w),from=w.rider.owner;let first=true,onNew=0;
  while(c.status==='run'&&c.t<w.t+T){const inp=simple(c,target);if(first&&jumpNow){inp.jump=true;inp.jumpHeld=true;}first=false;step(c,L,inp);
    const cr=c.rider;onNew=cr.grounded&&cr.owner!==from?onNew+DT:0;if(onNew>=.2||(cr.grounded&&cr.owner<0&&cr.owner!==from))return 5e3;}
  if(c.status==='win')return 1e4;if(c.status==='run')return c.rider.offSide?0:5e3+(c.rider.grounded?100:0);return c.t-w.t;}
// Jump for a drop that's above the path, if a jump now collects it and still lands safely.
function dropHop(w,L,nd,target){const c=clone(w);let first=true;
  while(c.status==='run'&&c.t<w.t+1.6){const inp=simple(c,target);if(first){inp.jump=true;inp.jumpHeld=true;}first=false;step(c,L,inp);
    if(c.drops[nd.i].got)break;}
  if(!c.drops[nd.i].got)return false;
  const rest=rollout(c,L,false,1.2,0);return rest>=5e3;}
// opts.drops: also hunt ink drops (steer to them, hop for high ones when it's safe). Off by default.
export function autopilot(w,L,opts){const r=w.rider,dir=Math.sign(r.vx)||1;let jump=false;
  if(r.sling>=0)return NO_INPUT;   // orbiting a sling: nothing you do matters
  // Rolling away from the goal (e.g. a well flung you back): push forward, and don't jump backwards.
  const fwd=L?Math.sign(L.goal.x-L.start.x)||1:1;if(L&&r.vx*fwd<-1&&!w.rollout)return{steer:center(w),jump:false,jumpHeld:r.jumped,push:r.grounded?1:0};
  const nd=opts&&opts.drops&&!w.rollout?nextDrop(w):null,target=dropTarget(nd,w);
  if(nd&&L&&r.grounded&&r.groundKind!=='rope'&&!r.jumped){const d=nd.d,dx=(d.x-r.x)*dir,g=groundBelow(w,d.x,d.y,d.z);
    if(g&&d.y<g.y-R-DROP.r+4&&dx>r.speed*.12&&dx<r.speed*.7+40&&(!w.apHop||w.t-w.apHop>=3*DT-1e-9)){w.apHop=w.t;
      const plain=clone(w);let got=false;while(plain.status==='run'&&plain.t<w.t+1.2&&!got){step(plain,L,simple(plain,target));got=plain.drops[nd.i].got;}
      if(!got&&dropHop(w,L,nd,target))return{steer:center(w,target),jump:true,jumpHeld:true,push:0};}}
  if(L&&!w.rollout&&r.groundKind!=='rope'&&!r.jumped&&(r.grounded||r.coyote<=JUMP.coyote)){
    // An edge = the ground just ahead is missing or falls away from the slope you're on.
    const reach=Math.max(20,r.speed*.1),slope=Math.abs(r.vx)>20?clamp(r.vy/Math.abs(r.vx),-3,3):0;let edge=false;   // slope from velocity: smooth on freehand strokes
    if(!r.grounded){const g=groundBelow(w,r.x,r.y,r.z);edge=!g||g.y-r.y>R+20;}   // coyote time, not just a bump
    for(let d=4;!edge&&d<=reach;d+=4){const g=groundBelow(w,r.x+dir*d,r.y-8,r.z);if(!g||g.y-(r.y+slope*dir*d)>25)edge=true;}
    // (Rolling on is re-checked only every 3rd frame while it keeps failing the same way.)
    if(edge){const stay=w.apStay&&w.t-w.apStay.t<3*DT-1e-9?w.apStay.v:rollout(w,L,false,1.8,target);w.apStay={t:w.apStay&&w.t-w.apStay.t<3*DT-1e-9?w.apStay.t:w.t,v:stay};
      if(stay<5e3){const hop=rollout(w,L,true,1.8,target);
        // Jump if it saves the run, or at the last coyote moment if it at least gets further.
        if(hop>=5e3||(hop>stay&&r.coyote+DT>JUMP.coyote))jump=true;}}}
  return{steer:center(w,target),jump,jumpHeld:jump||r.jumped,push:pushFor(w,inAnyWind(w))};}

// Run a whole ride without rendering. policy: 'auto' | 'drops' (autopilot hunting drops) | 'none' | (world, level) => input
export function simulate(L,items,{policy='auto',maxT=40,assist=0}={}){
  const w=build(L,items,{assist}),pol=policy==='none'?()=>NO_INPUT:policy==='auto'?autopilot:policy==='drops'?(w,L)=>autopilot(w,L,{drops:true}):policy;
  while(w.status==='run'&&w.t<maxT)step(w,L,pol(w,L));
  const r=w.rider;return{status:w.status==='run'?'timeout':w.status,t:+w.t.toFixed(2),x:Math.round(r.x),y:Math.round(r.y),z:Math.round(r.z),
    ink:Math.round(inkUsed(items)),jumps:w.events.filter(e=>e.type==='jump').length,
    refund:w.refund,drops:w.drops.filter(d=>d.got).length,dropsTotal:w.drops.length,world:w};}
