// maker.js — the level maker: place pieces on the sheet, move them, erase them, pan and zoom.
// createMaker({canvas, getState, hooks}) -> {draw(g,t), setPiece(name), undo(), redo(), canUndo(), canRedo(), reset(), zoom(f)}
// Active only while S.mode==='make'. It edits S.level in place (the side view draws it as it would in play), and
// calls hooks.onChange() after every finished change, hooks.toast(msg) for refusals, hooks.sound(kind, phase).
//
// Pieces (S.make.piece):
//   slab    drag along the road you want: a 22-thick slab under the drag (solid, ice or crumble: S.make.material)
//   box     drag a rectangle (walls, pillars, platforms), in the same materials
//   spikes  drag a line of spikes          boost   drag along the top of a slab
//   line, wind  draw freehand (they're placed by the level, cost the player nothing)
//   rope    drag between two anchors       sling   tap to place (aimed at the ring), drag its arrow to aim
//   drop    tap: an ink drop (puzzles); tap one again to change its value
//   check   tap: a checkpoint ring (time trials)
//   move    drag any piece, the start or the ring; drag empty paper to look around
//   erase   tap or drag across pieces to remove them
import * as P from './physics.js';
import {W,H,R,closest,polyLen} from './physics.js';

const TAU=Math.PI*2,SLAB=22,GRID=10,CRUMBLE_PIECE=30;
export const LIMITS={poly:200,items:80,checks:8,drops:12,boosts:40};
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const r1=v=>Math.round(v*10)/10;
const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const STENCIL=`'Big Shoulders Stencil Display',ui-monospace,Menlo,monospace`;
// What a level snapshot keeps (undo, and "has it changed since the clear").
const KEYS=['name','hint','mode','w','h','tools','ink','par','bg','start','goal','blocks','ice','crumble','hazards','boosts','drops','fixed','checks','medals','maxT'];
export const snapshot=L=>JSON.parse(JSON.stringify(KEYS.reduce((o,k)=>(L[k]!==undefined&&(o[k]=L[k]),o),{})));
export function restore(L,s){for(const k of KEYS)if(k in s)L[k]=JSON.parse(JSON.stringify(s[k]));else delete L[k];}

// A new level, ready to edit: a start ledge, a ring on a landing, spikes along the floor.
export function blank(mode,inks=['Sunflower','Orange','Federal Blue']){
  if(mode==='trial')return{mode:'trial',name:'My course',hint:'',w:2400,h:500,maxT:90,tools:[],ink:0,par:[0,0],
    bg:{scene:'park',seed:1+Math.floor(Math.random()*999),inks},start:{x:40,y:191,vx:200},goal:{x:2320,y:367,r:30},
    blocks:[[[0,200],[260,200],[260,222],[0,222]],[[260,200],[900,330],[900,352],[260,222]],[[2180,380],[2400,380],[2400,402],[2180,402]]],
    ice:[],crumble:[],hazards:[[[0,486],[2400,486]]],boosts:[],drops:[],fixed:[],checks:[],medals:{}};
  return{mode:'puzzle',name:'My level',hint:'',tools:['line','wind','rope','sling'],ink:600,par:[300,450],
    bg:{scene:'park',seed:1+Math.floor(Math.random()*999),inks},start:{x:34,y:141,vx:150},goal:{x:700,y:337,r:26},
    blocks:[[[0,150],[150,150],[150,172],[0,172]],[[580,360],[800,360],[800,382],[580,382]]],
    ice:[],crumble:[],hazards:[[[0,486],[800,486]]],boosts:[],drops:[],fixed:[],checks:[]};}

// ---------- geometry ----------
function inside(pt,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
  if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
function nearPoly(p,poly,closed,d){const n=closed?poly.length:poly.length-1;for(let i=0;i<n;i++){const a=poly[i],b=poly[(i+1)%poly.length],[cx,cy]=closest(p[0],p[1],a[0],a[1],b[0],b[1]);if(Math.hypot(p[0]-cx,p[1]-cy)<d)return true;}return false;}
// The slab under a drag a→b: the drag is its top surface, the thickness goes down (or right, for a wall).
function slabPoly(a,b){const l=dist(a,b)||1,ux=(b[0]-a[0])/l,uy=(b[1]-a[1])/l;let nx=-uy,ny=ux;if(ny<0||(Math.abs(ny)<1e-6&&nx<0)){nx=-nx;ny=-ny;}
  const o=(x,y)=>[r1(x),r1(y)];return[o(a[0],a[1]),o(b[0],b[1]),o(b[0]+nx*SLAB,b[1]+ny*SLAB),o(a[0]+nx*SLAB,a[1]+ny*SLAB)];}
// Top edges of solid polygons (the parts you can ride on, and put boost pads on).
function tops(L){const out=[];for(const k of['blocks','ice','crumble'])for(const poly of L[k]||[])for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);if(l<1)continue;
  let nx=dy/l,ny=-dx/l;const m=[(a[0]+b[0])/2+nx,(a[1]+b[1])/2+ny];if(inside(m,poly)){nx=-nx;ny=-ny;}if(ny<-.5)out.push([a,b]);}return out;}
function topUnder(L,p,reach=26){let best=null,bd=reach;for(const[a,b]of tops(L)){const[cx,cy,t]=closest(p[0],p[1],a[0],a[1],b[0],b[1]),d=Math.hypot(p[0]-cx,p[1]-cy);if(d<bd){bd=d;best={a,b,c:[cx,cy],t};}}return best;}
function chaikin(p){if(p.length<3)return p;const o=[p[0]];for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];if(i>0)o.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25]);if(i<p.length-2)o.push([a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);}o.push(p[p.length-1]);return o;}

export function createMaker({canvas,getState,hooks={}}){
  const call=(k,...a)=>{if(typeof hooks[k]==='function')return hooks[k](...a);};
  const S_=()=>getState();
  const making=()=>{const S=S_();return S&&S.level&&S.mode==='make';};
  const M=()=>S_().make;
  const V=()=>{const v=S_().view;return v&&v.k>0?v:{x:0,y:0,k:1};};
  const pos=e=>{const r=canvas.getBoundingClientRect(),v=V();return[v.x+(e.clientX-r.left)/r.width*W/v.k,v.y+(e.clientY-r.top)/r.height*H/v.k];};
  const upp=()=>{const r=canvas.getBoundingClientRect();return r.width>0?W/(r.width*V().k):1;};   // world units per CSS pixel
  const dims=()=>P.dims(S_().level);
  const snapG=p=>M().snap?[Math.round(p[0]/GRID)*GRID,Math.round(p[1]/GRID)*GRID]:[r1(p[0]),r1(p[1])];
  const inWorld=p=>{const D=dims();return[clamp(p[0],0,D.w),clamp(p[1],0,D.h)];};
  let undoS=[],redoS=[],act=null,hover=null,ptrs=new Map(),gesture=null,cursor='';
  function setCursor(c){if(c!==cursor){cursor=c;canvas.style.cursor=c;}}
  function commit(before){undoS.push(before);if(undoS.length>100)undoS.shift();redoS=[];call('onChange');}

  // ---------- hit testing: the piece under p, topmost first ----------
  function hit(L,p){const u=Math.max(1,upp()),tol=7*u;
    if(dist(p,[L.start.x,L.start.y])<16*u||(p[0]>L.start.x-22&&p[0]<L.start.x-2&&p[1]>L.start.y-24&&p[1]<L.start.y+8))return{kind:'start'};
    if(dist(p,[L.goal.x,L.goal.y])<L.goal.r+4)return{kind:'goal'};
    const fx=L.fixed||[];
    for(let i=fx.length-1;i>=0;i--){const it=fx[i];if(it.type!=='sling')continue;const tip=[it.x+Math.cos(it.a)*56,it.y+Math.sin(it.a)*56];
      if(dist(p,tip)<12*u)return{kind:'aim',i};if(dist(p,[it.x,it.y])<34)return{kind:'fixed',i};}
    for(let i=(L.checks||[]).length-1;i>=0;i--){const c=L.checks[i];if(dist(p,[c.x,c.y])<(c.r||30)+3)return{kind:'checks',i};}
    for(let i=(L.drops||[]).length-1;i>=0;i--){const d=L.drops[i];if(dist(p,[d.x,d.y])<12*u)return{kind:'drops',i};}
    for(let i=fx.length-1;i>=0;i--){const it=fx[i];
      if(it.type==='rope'){for(const end of['a','b'])if(dist(p,it[end])<10*u)return{kind:'ropeEnd',i,end};if(nearPoly(p,[it.a,it.b],false,tol))return{kind:'fixed',i};}
      else if((it.type==='line'||it.type==='wind')&&nearPoly(p,it.pts,false,it.type==='wind'?18:tol))return{kind:'fixed',i};}
    for(let i=(L.boosts||[]).length-1;i>=0;i--){const b=L.boosts[i];if(nearPoly(p,[b.a,b.b],false,12))return{kind:'boosts',i};}
    for(let i=(L.hazards||[]).length-1;i>=0;i--){const h=L.hazards[i];if(nearPoly(p,h,false,12))return{kind:'hazards',i};}
    for(const k of['crumble','ice','blocks'])for(let i=(L[k]||[]).length-1;i>=0;i--){const poly=L[k][i];if(inside(p,poly)||nearPoly(p,poly,true,tol*.7))return{kind:k,i};}
    return null;}
  function removeHit(L,h){if(!h||h.kind==='start'||h.kind==='goal')return false;const k=h.kind==='fixed'||h.kind==='aim'||h.kind==='ropeEnd'?'fixed':h.kind;L[k].splice(h.i,1);return true;}
  // Translate any piece by (dx,dy).
  function shift(L,h,o,dx,dy){const mv=q=>[r1(q[0]+dx),r1(q[1]+dy)];
    if(h.kind==='start'){L.start={...L.start,x:r1(o.x+dx),y:r1(o.y+dy)};return;}
    if(h.kind==='goal'){L.goal={...L.goal,x:r1(o.x+dx),y:r1(o.y+dy)};return;}
    if(h.kind==='blocks'||h.kind==='ice'||h.kind==='crumble'||h.kind==='hazards'){L[h.kind][h.i]=o.map(mv);return;}
    if(h.kind==='boosts'){L.boosts[h.i]={a:mv(o.a),b:mv(o.b)};return;}
    if(h.kind==='drops'||h.kind==='checks'){L[h.kind][h.i]={...o,x:r1(o.x+dx),y:r1(o.y+dy)};return;}
    if(h.kind==='fixed'){const it=o;L.fixed[h.i]=it.type==='sling'?{...it,x:r1(it.x+dx),y:r1(it.y+dy)}:it.type==='rope'?{...it,a:mv(it.a),b:mv(it.b)}:{...it,pts:it.pts.map(mv)};}}
  const pieceOf=(L,h)=>h.kind==='start'?L.start:h.kind==='goal'?L.goal:h.kind==='fixed'||h.kind==='aim'||h.kind==='ropeEnd'?L.fixed[h.i]:L[h.kind][h.i];
  // A start dropped just above a surface sits on it (one rider radius up), like the campaign's starts.
  function settleStart(L){const s=L.start;let best=null;for(const[a,b]of tops(L)){if(s.x<Math.min(a[0],b[0])-2||s.x>Math.max(a[0],b[0])+2||Math.abs(b[0]-a[0])<1)continue;
      const y=a[1]+(b[1]-a[1])*(s.x-a[0])/(b[0]-a[0]);if(y>=s.y-14&&y-s.y<50&&(!best||y<best))best=y;}
    if(best!=null)L.start={...s,y:r1(best-R)};}
  const full=(L,k,max)=>{if((L[k]||[]).length>=max){call('toast','That’s as many of those as a level can have.');return true;}return false;};
  // The default aim for a new sling: through the ring (physics' slingAim), else straight at it.
  const aimAt=(L,p)=>{try{return Math.round(P.slingAim({x:p[0],y:p[1]},L.goal.x,L.goal.y)*1e4)/1e4;}catch(e){return Math.atan2(L.goal.y-p[1],L.goal.x-p[0]);}};

  // ---------- placing a piece while dragging ----------
  // Rebuilds the piece from the drag each move (from the snapshot taken on press), so it always shows exactly.
  function place(L,a,b){const m=M(),k=m.material==='ice'?'ice':m.material==='crumble'?'crumble':'blocks';
    switch(m.piece){
      case'slab':{if(dist(a,b)<GRID)return false;if(full(L,k,LIMITS.poly))return false;
        if(k==='crumble'){const l=dist(a,b),n=Math.max(1,Math.round(l/CRUMBLE_PIECE)),q=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
          for(let i=0;i<n;i++)L.crumble.push(slabPoly(q(i/n),q((i+1)/n)));}
        else L[k].push(slabPoly(a,b));return true;}
      case'box':{const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),y0=Math.min(a[1],b[1]),y1=Math.max(a[1],b[1]);if(x1-x0<GRID||y1-y0<GRID)return false;if(full(L,k,LIMITS.poly))return false;
        L[k].push([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]);return true;}
      case'spikes':{if(dist(a,b)<GRID*2||full(L,'hazards',LIMITS.poly))return false;L.hazards.push([a,b]);return true;}
      case'boost':{const t=topUnder(L,a);if(!t||full(L,'boosts',LIMITS.boosts))return false;const[ea,eb]=[t.a,t.b],l=dist(ea,eb),ux=(eb[0]-ea[0])/l,uy=(eb[1]-ea[1])/l;
        const s=u=>clamp(u,0,l),u0=(t.c[0]-ea[0])*ux+(t.c[1]-ea[1])*uy,u1=s((b[0]-ea[0])*ux+(b[1]-ea[1])*uy),uu0=s(u0);if(Math.abs(u1-uu0)<20)return false;
        const at=u=>[r1(ea[0]+ux*u),r1(ea[1]+uy*u)];L.boosts.push({a:at(uu0),b:at(u1)});return true;}
      case'rope':{if(dist(a,b)<24||full(L,'fixed',LIMITS.items))return false;L.fixed.push({type:'rope',a,b});return true;}}
    return false;}

  // ---------- pointer ----------
  function down(e){if(!making()||(e.button!==undefined&&e.button!==0&&e.button!==1))return;e.preventDefault();
    try{canvas.setPointerCapture(e.pointerId);}catch(_){}
    ptrs.set(e.pointerId,[e.clientX,e.clientY]);
    // a second finger: pan and zoom with two fingers; whatever the first finger started is undone
    if(ptrs.size===2){if(act&&act.before)restore(S_().level,act.before);act=null;const[a,b]=[...ptrs.values()];gesture={c:[(a[0]+b[0])/2,(a[1]+b[1])/2],d:Math.hypot(b[0]-a[0],b[1]-a[1])};return;}
    if(ptrs.size>2)return;
    const S=S_(),L=S.level,m=M(),p=pos(e),g=snapG(p),before=snapshot(L);
    if(e.button===1||e.shiftKey&&m.piece==='move'){act={pan:true,last:[e.clientX,e.clientY]};return;}   // middle button pans
    switch(m.piece){
      case'move':{const h=hit(L,p);if(!h){act={pan:true,last:[e.clientX,e.clientY]};setCursor('grabbing');return;}
        act={move:h,from:p,orig:JSON.parse(JSON.stringify(pieceOf(L,h))),before};setCursor('grabbing');call('sound','tool','start');return;}
      case'erase':{act={erase:true,before,n:0};eraseAt(L,p);return;}
      case'line':case'wind':{if(full(L,'fixed',LIMITS.items))return;L.fixed.push({type:m.piece,pts:[g]});act={stroke:L.fixed.length-1,last:p,before};call('sound',m.piece,'start');call('onLive');return;}
      case'sling':{const h=hit(L,p);   // pressing a sling's arrow aims it; pressing its ring picks it up
        if(h&&(h.kind==='aim'||(h.kind==='fixed'&&L.fixed[h.i].type==='sling'))){act={move:h,from:p,orig:{...L.fixed[h.i]},before};return;}
        if(full(L,'fixed',LIMITS.items))return;if(dist(p,[L.goal.x,L.goal.y])<80){call('toast','Too close to the ring');return;}
        L.fixed.push({type:'sling',x:g[0],y:g[1],a:aimAt(L,g)});commit(before);call('sound','sling','start');call('sound','sling','end');return;}
      case'drop':{const h=hit(L,p);if(h&&h.kind==='drops'){const d=L.drops[h.i],v=d.v===15?25:d.v===25?40:15;L.drops[h.i]={...d,v};commit(before);call('sound','tool','start');return;}
        if(full(L,'drops',LIMITS.drops))return;L.drops.push({x:g[0],y:g[1],v:25});commit(before);call('sound','tool','start');return;}
      case'check':{if(full(L,'checks',LIMITS.checks))return;L.checks.push({x:g[0],y:g[1],r:30});commit(before);call('sound','tool','start');return;}
      default:{act={drag:true,a:inWorld(g),before};call('sound',m.piece==='rope'?'rope':'line','start');}}}
  function eraseAt(L,p){const h=hit(L,p);if(h&&removeHit(L,h)){act.n++;call('sound','clear','start');call('onLive');}}
  function move(e){const S=S_();if(!S||!S.level)return;
    if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,[e.clientX,e.clientY]);
    if(gesture&&ptrs.size===2){const[a,b]=[...ptrs.values()],c=[(a[0]+b[0])/2,(a[1]+b[1])/2],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
      call('pan',(c[0]-gesture.c[0]),(c[1]-gesture.c[1]));if(gesture.d>20)call('zoom',d/gesture.d,c);gesture.c=c;gesture.d=d;return;}
    const p=pos(e);if(!act){hover=making()?{p,h:hit(S.level,p)}:null;
      setCursor(!making()?'':M().piece==='move'?(hover.h?'grab':'move'):M().piece==='erase'?(hover.h?'pointer':'not-allowed'):'crosshair');return;}
    if(!ptrs.has(e.pointerId))return;
    const L=S.level,m=M();
    if(act.pan){call('pan',e.clientX-act.last[0],e.clientY-act.last[1]);act.last=[e.clientX,e.clientY];return;}
    if(act.erase){eraseAt(L,p);return;}
    if(act.move){const h=act.move;
      if(h.kind==='aim'){const it=L.fixed[h.i];let a=Math.atan2(p[1]-it.y,p[0]-it.x);if(!e.shiftKey){const st=Math.PI/36;a=Math.round(a/st)*st;}L.fixed[h.i]={...it,a:Math.round(a*1e4)/1e4};}
      else if(h.kind==='ropeEnd'){const it=L.fixed[h.i];L.fixed[h.i]={...it,[h.end]:inWorld(snapG(p))};}
      else{let dx=p[0]-act.from[0],dy=p[1]-act.from[1];if(m.snap){dx=Math.round(dx/GRID)*GRID;dy=Math.round(dy/GRID)*GRID;}shift(L,h,act.orig,dx,dy);}
      act.moved=true;call('onLive');return;}
    if(act.stroke!=null){const it=L.fixed[act.stroke];if(!it)return;const q=inWorld(p),lp=it.pts[it.pts.length-1];if(dist(lp,q)>=6&&it.pts.length<590){it.pts.push([r1(q[0]),r1(q[1])]);call('sound',it.type,'move',800);call('onLive');}act.last=p;return;}
    if(act.drag){restore(L,act.before);act.ok=place(L,act.a,inWorld(snapG(p)));act.b=p;call('onLive');}}
  function up(e){ptrs.delete(e.pointerId);try{canvas.releasePointerCapture(e.pointerId);}catch(_){}
    if(gesture){if(ptrs.size<2)gesture=null;act=null;return;}
    const a=act;act=null;setCursor('');if(!a||!making())return;const L=S_().level;
    if(a.pan)return;
    if(a.erase){if(a.n)commit(a.before);return;}
    if(a.move){call('sound','tool','end');if(!a.moved)return;
      if(a.move.kind==='start')settleStart(L);
      if(a.move.kind==='fixed'&&L.fixed[a.move.i].type==='sling'&&dist([L.fixed[a.move.i].x,L.fixed[a.move.i].y],[L.goal.x,L.goal.y])<80){restore(L,a.before);call('toast','Too close to the ring');call('onLive');return;}
      commit(a.before);return;}
    if(a.stroke!=null){const it=L.fixed[a.stroke];call('sound',it&&it.type||'line','end');
      if(!it||it.pts.length<2||polyLen(it.pts)<12){restore(L,a.before);call('onLive');return;}
      it.pts=chaikin(chaikin(it.pts)).filter((q,i,arr)=>i===0||i===arr.length-1||dist(q,arr[i-1])>=3).map(q=>[r1(q[0]),r1(q[1])]);commit(a.before);return;}
    if(a.drag){call('sound',M().piece==='rope'?'rope':'line','end');
      if(a.ok)commit(a.before);else{restore(L,a.before);call('onLive');if(M().piece==='boost')call('toast','Drag boost pads along the top of a slab.');}}}
  function cancel(e){if(e)ptrs.delete(e.pointerId);if(act&&act.before)restore(S_().level,act.before);act=null;gesture=null;call('onLive');}
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);
  canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('pointerleave',()=>{if(!act)hover=null;});

  // ---------- overlay ----------
  function draw(g,t){const S=S_();if(!S||!S.level||S.mode!=='make')return;const L=S.level,ink=S.ink,v=V(),D=dims(),u=Math.max(.6,upp());
    g.save();g.lineCap='round';
    // the grid: faint registration dots every 20, crosses every 100
    if(M().snap){const x0=Math.max(0,Math.floor(v.x/20)*20),x1=Math.min(D.w,v.x+W/v.k),y0=Math.max(0,Math.floor(v.y/20)*20),y1=Math.min(D.h,v.y+H/v.k);
      g.fillStyle=ink.key;g.globalAlpha=.16;for(let x=x0;x<=x1;x+=20)for(let y=y0;y<=y1;y+=20){const big=x%100===0&&y%100===0,s=(big?1.6:.9)*u;g.fillRect(x-s/2,y-s/2,s,s);}
      g.globalAlpha=.28;g.strokeStyle=ink.key;g.lineWidth=.8*u;g.beginPath();for(let x=Math.ceil(x0/100)*100;x<=x1;x+=100)for(let y=Math.ceil(y0/100)*100;y<=y1;y+=100){g.moveTo(x-3*u,y);g.lineTo(x+3*u,y);g.moveTo(x,y-3*u);g.lineTo(x,y+3*u);}g.stroke();}
    // the edges of the course
    g.globalAlpha=.7;g.strokeStyle=ink.key;g.lineWidth=1.2*u;g.setLineDash([6*u,5*u]);g.strokeRect(0,0,D.w,D.h);g.setLineDash([]);
    // fixed slings: the aim handle
    (L.fixed||[]).forEach(it=>{if(it.type!=='sling')return;const tx=it.x+Math.cos(it.a)*56,ty=it.y+Math.sin(it.a)*56;g.globalAlpha=1;g.fillStyle=ink.light;g.beginPath();g.arc(tx,ty,5.5*u,0,TAU);g.fill();g.strokeStyle=ink.key;g.lineWidth=1.6*u;g.stroke();});
    // labels on the start and the ring
    tag(g,S,'START',L.start.x-10,L.start.y-28,u);tag(g,S,L.mode==='trial'?'FINISH':'GOAL',L.goal.x,L.goal.y-L.goal.r-8,u);
    // hover: a dashed outline (move) or a stamped X (erase) on the piece under the pointer
    const h=act&&act.move?act.move:hover&&hover.h;
    if(h&&(M().piece==='move'||M().piece==='erase'||act&&act.move)){const bb=bbox(L,h);if(bb){g.globalAlpha=.9;g.strokeStyle=M().piece==='erase'?ink.mid:ink.key;g.lineWidth=1.4*u;g.setLineDash([4*u,3*u]);g.strokeRect(bb[0]-5,bb[1]-5,bb[2]-bb[0]+10,bb[3]-bb[1]+10);g.setLineDash([]);
      if(M().piece==='erase'){const cx=(bb[0]+bb[2])/2,cy=(bb[1]+bb[3])/2,s=9*u;g.lineWidth=3.2*u;g.strokeStyle=ink.mid;g.beginPath();g.moveTo(cx-s,cy-s);g.lineTo(cx+s,cy+s);g.moveTo(cx+s,cy-s);g.lineTo(cx-s,cy+s);g.stroke();}}}
    // a boost pad needs a slab top: show where it would sit
    if(M().piece==='boost'&&hover&&!act){const tt=topUnder(L,hover.p);g.globalAlpha=.8;g.strokeStyle=ink.key;g.lineWidth=1.2*u;g.beginPath();
      if(tt){g.arc(tt.c[0],tt.c[1],5*u,0,TAU);}else{const[x,y]=hover.p,s=5*u;g.moveTo(x-s,y-s);g.lineTo(x+s,y+s);g.moveTo(x+s,y-s);g.lineTo(x-s,y+s);}g.stroke();}
    // a ring under the pen shows where the next piece will start (snapped)
    if(hover&&!act&&!['move','erase'].includes(M().piece)){const q=snapG(hover.p);g.globalAlpha=.75;g.strokeStyle=ink.key;g.lineWidth=1.1*u;g.beginPath();g.arc(q[0],q[1],4*u,0,TAU);g.stroke();}
    // while dragging a slab: its length, typed
    if(act&&act.drag&&act.b){const q=act.b,txt=M().piece==='box'?`${Math.round(Math.abs(q[0]-act.a[0]))} × ${Math.round(Math.abs(q[1]-act.a[1]))}`:`${Math.round(dist(act.a,q))}`;
      g.globalAlpha=1;g.font=`${13*u}px 'Cutive Mono',ui-monospace,monospace`;g.textBaseline='bottom';g.fillStyle=ink.key;g.fillText(txt,q[0]+10*u,q[1]-8*u);}
    g.restore();}
  function tag(g,S,text,x,y,u){const ink=S.ink,f=10*Math.max(1,u);g.save();g.font=`800 ${f}px ${STENCIL}`;try{g.letterSpacing=`${f*.16}px`;}catch(_){}g.textAlign='center';g.textBaseline='bottom';
    g.globalCompositeOperation='destination-out';g.strokeStyle='#000';g.lineWidth=4;g.lineJoin='round';g.strokeText(text,x,y);g.globalCompositeOperation='source-over';
    g.fillStyle=ink.key;g.fillText(text,x,y);g.restore();}
  function bbox(L,h){const pc=pieceOf(L,h);if(!pc)return null;let pts=[];
    if(h.kind==='start')pts=[[pc.x-20,pc.y-24],[pc.x+10,pc.y+10]];else if(h.kind==='goal'||h.kind==='checks')pts=[[pc.x-(pc.r||30),pc.y-(pc.r||30)],[pc.x+(pc.r||30),pc.y+(pc.r||30)]];
    else if(h.kind==='drops')pts=[[pc.x-8,pc.y-12],[pc.x+8,pc.y+8]];else if(h.kind==='boosts')pts=[pc.a,pc.b];
    else if(Array.isArray(pc))pts=pc;else if(pc.type==='sling')pts=[[pc.x-34,pc.y-34],[pc.x+34,pc.y+34]];else if(pc.type==='rope')pts=[pc.a,pc.b];else if(pc.pts)pts=pc.pts;
    if(!pts.length)return null;const xs=pts.map(q=>q[0]),ys=pts.map(q=>q[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}

  return{draw,
    undo(){const L=S_().level;if(!undoS.length)return false;redoS.push(snapshot(L));restore(L,undoS.pop());call('onChange');return true;},
    redo(){const L=S_().level;if(!redoS.length)return false;undoS.push(snapshot(L));restore(L,redoS.pop());call('onChange');return true;},
    canUndo:()=>undoS.length>0,canRedo:()=>redoS.length>0,
    // a change made outside the sheet (the details sheet): undoable like any other
    record(before){commit(before);},
    reset(){undoS=[];redoS=[];act=null;hover=null;ptrs.clear();gesture=null;}};}
