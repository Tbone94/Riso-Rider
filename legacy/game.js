// game.js — Drift (working title): draw lines, wind, ropes and gravity wells with
// limited ink, then press Go and get the rider into the ring.
// Everything lives in an 800×500 design space. Physics is position-based
// (predict → solve contacts/constraints → derive velocity) at 8 substeps per frame.
(function(){
'use strict';
const W=800,H=500,TAU=Math.PI*2;
const G=900,R=9,DT=1/60,SUB=8;
const COST={line:1,wind:1.2,rope:1.5,well:120};
const WIND={radius:40,speed:430,grip:7};          // currents carry the rider at a set speed
const WELL={k:6e6,max:2400,range:230,keepOut:80};  // gravity wells pull, but not right on the goal
const ROPE={k:150,damp:.25,pad:R+2};               // ropes are trampoline springs: push back ∝ stretch
const FRICTION=.0012;

// ---------- levels ----------
// blocks: solid polygons. hazards: polylines that pop the rider. start.vx: initial push.
const LEVELS=[
  {name:'First line',tools:['line'],ink:700,par:[320,470],
   hint:'Draw a line that carries the rider from the ledge to the ring, then press Go.',
   bg:{scene:'park',seed:3,inks:['Sunflower','Orange','Federal Blue']},
   start:{x:34,y:121,vx:150},goal:{x:700,y:377,r:26},
   blocks:[[[0,130],[150,130],[150,152],[0,152]],[[560,400],[800,400],[800,422],[560,422]],[[784,330],[800,330],[800,400],[784,400]]],
   hazards:[]},
  {name:'Springy',tools:['line','rope'],ink:380,par:[130,240],
   hint:'Ropes are trampolines. Drag to stretch one across the pit and bounce to the far ledge.',
   bg:{scene:'woodblock',seed:21,inks:['Flat Gold','Bright Red','Medium Blue']},
   start:{x:30,y:91,vx:160},goal:{x:680,y:267,r:26},
   blocks:[[[0,100],[130,100],[130,122],[0,122]],[[540,290],[800,290],[800,312],[540,312]],[[784,220],[800,220],[800,290],[784,290]]],
   hazards:[[[0,486],[800,486]]]},
  {name:'Updraft',tools:['line','wind'],ink:650,par:[420,560],
   hint:'Wind carries the rider in the direction you draw it. Lift them up to the high ledge.',
   bg:{scene:'cutouts',seed:4,inks:['Sunflower','Bright Red','Medium Blue']},
   start:{x:30,y:391,vx:190},goal:{x:700,y:127,r:26},
   blocks:[[[0,400],[150,400],[150,422],[0,422]],[[590,150],[800,150],[800,172],[590,172]],[[784,80],[800,80],[800,150],[784,150]]],
   hazards:[[[0,486],[800,486]]]},
  {name:'Pull',tools:['line','well'],ink:420,par:[130,280],
   hint:'Tap to drop a gravity well. It bends the rider’s path, so curve them into the tunnel.',
   bg:{scene:'orbits',seed:2,inks:['Coral','Violet','Federal Blue']},
   start:{x:30,y:101,vx:250},goal:{x:690,y:417,r:26},
   blocks:[[[0,110],[120,110],[120,132],[0,132]],[[440,262],[800,262],[800,284],[440,284]],[[440,440],[800,440],[800,462],[440,462]],[[784,284],[800,284],[800,440],[784,440]]],
   hazards:[[[0,486],[440,486]]]},
  {name:'Grand tour',tools:['line','wind','rope','well'],ink:700,par:[320,480],
   hint:'The ring is higher than where you start. Mix tools to get over the wall and up.',
   bg:{scene:'woodblock',seed:7,inks:['Flat Gold','Bright Red','Medium Blue']},
   start:{x:30,y:151,vx:150},goal:{x:705,y:77,r:26},
   blocks:[[[0,160],[130,160],[130,182],[0,182]],[[380,200],[420,200],[420,500],[380,500]],[[600,100],[800,100],[800,122],[600,122]],[[784,30],[800,30],[800,100],[784,100]]],
   hazards:[[[0,486],[380,486]],[[420,486],[800,486]]]},
];

// ---------- geometry ----------
function closest(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy||1;let t=((px-ax)*dx+(py-ay)*dy)/l2;t=t<0?0:t>1?1:t;return[ax+dx*t,ay+dy*t,t];}
const polyLen=p=>{let s=0;for(let i=1;i<p.length;i++)s+=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]);return s;};
function itemCost(it){return it.type==='well'?COST.well:it.type==='rope'?COST.rope*Math.hypot(it.b[0]-it.a[0],it.b[1]-it.a[1]):COST[it.type]*polyLen(it.pts);}
const inkUsed=items=>items.reduce((s,it)=>s+itemCost(it),0);

// ---------- world ----------
// side: which side of the rope the rider is pressing from (0 = not touching).
// depth: how far the rider has stretched it. wob: leftover wobble after a bounce.
function makeRope(a,b){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
  return{ax:a[0],ay:a[1],bx:b[0],by:b[1],len,tx:dx/len,ty:dy/len,nx:-dy/len,ny:dx/len,side:0,depth:0,cx:0,cy:0,wob:0,wobT:9,wobSide:1};}
function build(L,items){
  const w={t:0,status:'run',still:0,trail:[],rider:{x:L.start.x,y:L.start.y,vx:L.start.vx||0,vy:L.start.vy||0,a:0},segs:[],hazards:[],ropes:[],winds:[],wells:[]};
  const edges=(p,closed,th,out)=>{const n=closed?p.length:p.length-1;for(let i=0;i<n;i++){const a=p[i],b=p[(i+1)%p.length];out.push({ax:a[0],ay:a[1],bx:b[0],by:b[1],th});}};
  L.blocks.forEach(p=>edges(p,true,0,w.segs));
  L.hazards.forEach(p=>edges(p,false,4,w.hazards));
  items.forEach(it=>{
    if(it.type==='line')edges(it.pts,false,2.5,w.segs);
    else if(it.type==='wind'){const s=[];for(let i=1;i<it.pts.length;i++){const a=it.pts[i-1],b=it.pts[i],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;s.push({ax:a[0],ay:a[1],bx:b[0],by:b[1],tx:(b[0]-a[0])/l,ty:(b[1]-a[1])/l});}if(s.length)w.winds.push(s);}
    else if(it.type==='rope')w.ropes.push(makeRope(it.a,it.b));
    else if(it.type==='well')w.wells.push({x:it.x,y:it.y});});
  return w;}

function step(w,L){
  if(w.status!=='run')return;
  const h=DT/SUB,r=w.rider;
  for(let sub=0;sub<SUB;sub++){
    // forces
    let ax=0,ay=G;
    for(const wind of w.winds){let best=1e9,bs=null,bx=0,by=0;
      for(const s of wind){const[cx,cy]=closest(r.x,r.y,s.ax,s.ay,s.bx,s.by),d=Math.hypot(r.x-cx,r.y-cy);if(d<best){best=d;bs=s;bx=cx;by=cy;}}
      if(best<WIND.radius){const k=Math.sqrt(1-best/WIND.radius);
        ax+=(bs.tx*WIND.speed-r.vx)*WIND.grip*k+(bx-r.x)*4*k;ay+=(bs.ty*WIND.speed-r.vy)*WIND.grip*k+(by-r.y)*4*k-G*.85*k;}}
    for(const wl of w.wells){const dx=wl.x-r.x,dy=wl.y-r.y,d=Math.hypot(dx,dy);
      if(d<WELL.range&&d>1){const f=Math.min(WELL.max,WELL.k/(d*d+400))*(1-Math.pow(d/WELL.range,2));ax+=dx/d*f;ay+=dy/d*f;}}
    for(const rp of w.ropes){const rx=r.x-rp.ax,ry=r.y-rp.ay,t=(rx*rp.tx+ry*rp.ty)/rp.len,sd=rx*rp.nx+ry*rp.ny;
      if(!rp.side&&t>0&&t<1&&Math.abs(sd)<ROPE.pad)rp.side=sd<0?-1:1;
      if(!rp.side)continue;const p=ROPE.pad-rp.side*sd;
      if(p<=0||t<-.02||t>1.02){if(rp.depth>2){rp.wob=rp.depth;rp.wobT=0;rp.wobSide=rp.side;}rp.side=0;rp.depth=0;continue;}
      // Stiffer toward the anchors, like a real trampoline.
      const e=Math.max(.3,Math.sin(Math.PI*Math.min(1,Math.max(0,t)))),vn=(r.vx*rp.nx+r.vy*rp.ny)*rp.side,f=ROPE.k/e*p-ROPE.damp*vn;
      ax+=rp.nx*rp.side*f;ay+=rp.ny*rp.side*f;rp.depth=p;rp.cx=r.x-rp.nx*rp.side*ROPE.pad;rp.cy=r.y-rp.ny*rp.side*ROPE.pad;}
    r.vx+=ax*h;r.vy+=ay*h;
    const ox=r.x,oy=r.y;r.x+=r.vx*h;r.y+=r.vy*h;
    // contacts
    let contact=null;
    for(let it=0;it<2;it++){
      for(const s of w.segs){const[cx,cy]=closest(r.x,r.y,s.ax,s.ay,s.bx,s.by),dx=r.x-cx,dy=r.y-cy,d=Math.hypot(dx,dy),rad=R+s.th;
        if(d>=rad||d<1e-6)continue;const nx=dx/d,ny=dy/d;r.x+=nx*(rad-d);r.y+=ny*(rad-d);contact=[nx,ny];}}
    r.vx=(r.x-ox)/h;r.vy=(r.y-oy)/h;
    if(contact){const[nx,ny]=contact,vn=r.vx*nx+r.vy*ny,tx=r.vx-nx*vn,ty=r.vy-ny*vn;r.vx-=tx*FRICTION;r.vy-=ty*FRICTION;}
    r.a+=r.vx*h/R;
  }
  w.t+=DT;for(const rp of w.ropes)rp.wobT+=DT;
  if(w.t%(2*DT)<DT)w.trail.unshift([r.x,r.y]);if(w.trail.length>28)w.trail.pop();
  for(const s of w.hazards){const[cx,cy]=closest(r.x,r.y,s.ax,s.ay,s.bx,s.by);if(Math.hypot(r.x-cx,r.y-cy)<R+s.th){w.status='popped';return;}}
  if(Math.hypot(r.x-L.goal.x,r.y-L.goal.y)<L.goal.r){w.status='win';return;}
  if(r.y>H+40||r.x<-60||r.x>W+60){w.status='fell';return;}
  if(Math.hypot(r.vx,r.vy)<10){w.still+=DT;if(w.still>1.5)w.status='stuck';}else w.still=0;
  if(w.t>30)w.status='stuck';}

function simulate(li,items,maxT=20){const L=LEVELS[li],w=build(L,items);while(w.status==='run'&&w.t<maxT)step(w,L);return{status:w.status,t:+w.t.toFixed(2),x:Math.round(w.rider.x),y:Math.round(w.rider.y),ink:Math.round(inkUsed(items))};}

// ---------- rendering ----------
const hex=c=>Riso.INKS[c]||c;
function dotPattern(g,color,step,rad){const c=document.createElement('canvas');c.width=c.height=step*2;const x=c.getContext('2d');x.fillStyle=color;
  [[step/2,step/2],[step*1.5,step*1.5]].forEach(([a,b])=>{x.beginPath();x.arc(a,b,rad,0,TAU);x.fill();});return g.createPattern(c,'repeat');}
function speckle(pw,ph){const c=document.createElement('canvas');c.width=pw;c.height=ph;const g=c.getContext('2d'),id=g.createImageData(pw,ph),d=id.data;
  for(let i=0;i<d.length;i+=4)d[i+3]=Math.random()<.18?60+Math.random()*150:0;g.putImageData(id,0,0);return c;}
function path(g,p){g.beginPath();g.moveTo(p[0][0],p[0][1]);for(let i=1;i<p.length;i++)g.lineTo(p[i][0],p[i][1]);}
function offsetPts(p,d){return p.map((q,i)=>{const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return[q[0]-dy/l*d,q[1]+dx/l*d];});}

// Rope outline: a V under the rider while stretched, a decaying wobble after.
function ropeShape(rp){const A=[rp.ax,rp.ay],B=[rp.bx,rp.by];
  if(rp.side&&rp.depth>0)return[A,[rp.cx,rp.cy],B];
  const amp=rp.wob*Math.exp(-rp.wobT*4)*Math.cos(rp.wobT*20),o=[];
  for(let i=0;i<=12;i++){const t=i/12,b=Math.sin(Math.PI*t)*amp*-rp.wobSide;o.push([A[0]+(B[0]-A[0])*t+rp.nx*b,A[1]+(B[1]-A[1])*t+rp.ny*b]);}return o;}
function drawScene(g,S,t){
  const L=S.level,ink=S.ink,w=S.world;
  g.lineCap='round';g.lineJoin='round';
  // goal: a stamp you're aiming for
  const G0=L.goal,pulse=1+.06*Math.sin(t*3);
  g.fillStyle=S.pat.mid;g.beginPath();g.arc(G0.x,G0.y,G0.r*1.3,0,TAU);g.fill();
  g.strokeStyle=ink.mid;g.lineWidth=2.5;g.setLineDash([5,6]);g.lineDashOffset=-t*14;g.beginPath();g.arc(G0.x,G0.y,G0.r*1.65*pulse,0,TAU);g.stroke();g.setLineDash([]);
  g.strokeStyle=ink.key;g.lineWidth=3.5;g.beginPath();g.arc(G0.x,G0.y,G0.r,0,TAU);g.stroke();
  g.fillStyle=ink.key;g.beginPath();g.arc(G0.x,G0.y,4,0,TAU);g.fill();
  // wells
  const wells=S.mode==='edit'?S.items.filter(i=>i.type==='well'):w?w.wells:[];
  wells.forEach(wl=>{g.fillStyle=S.pat.lightDense;g.beginPath();g.arc(wl.x,wl.y,58,0,TAU);g.fill();
    g.strokeStyle=ink.mid;g.lineWidth=2;[46,32,18].forEach((rr,i)=>{g.setLineDash([4,5]);g.lineDashOffset=t*(12+i*10)*(i%2?-1:1);g.beginPath();g.arc(wl.x,wl.y,rr,0,TAU);g.stroke();});g.setLineDash([]);
    g.strokeStyle=ink.key;g.globalAlpha=.25;g.lineWidth=1;g.beginPath();g.arc(wl.x,wl.y,WELL.range*.62,0,TAU);g.stroke();g.globalAlpha=1;
    g.fillStyle=ink.key;g.beginPath();g.arc(wl.x,wl.y,6,0,TAU);g.fill();});
  // wind
  S.items.filter(i=>i.type==='wind').forEach(it=>{if(it.pts.length<2)return;
    g.strokeStyle=ink.mid;g.lineWidth=2.2;g.setLineDash([10,9]);g.lineDashOffset=-t*70;
    [-12,0,12].forEach(k=>{path(g,offsetPts(it.pts,k));g.stroke();});g.setLineDash([]);
    const e=it.pts[it.pts.length-1],p=it.pts[Math.max(0,it.pts.length-4)],a=Math.atan2(e[1]-p[1],e[0]-p[0]);
    g.fillStyle=ink.key;g.beginPath();g.moveTo(e[0]+Math.cos(a)*12,e[1]+Math.sin(a)*12);g.lineTo(e[0]+Math.cos(a+2.5)*11,e[1]+Math.sin(a+2.5)*11);g.lineTo(e[0]+Math.cos(a-2.5)*11,e[1]+Math.sin(a-2.5)*11);g.fill();});
  // blocks: key ink with a misregistered mid-ink shadow
  L.blocks.forEach(p=>{g.fillStyle=ink.mid;g.save();g.translate(3,2.5);path(g,p);g.closePath();g.fill();g.restore();g.fillStyle=ink.key;path(g,p);g.closePath();g.fill();});
  // hazards: spikes
  L.hazards.forEach(p=>{g.fillStyle=ink.mid;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.floor(len/14);
    for(let k=0;k<n;k++){const x=a[0]+(b[0]-a[0])*(k+.5)/n,y=a[1]+(b[1]-a[1])*(k+.5)/n;g.beginPath();g.moveTo(x-7,y+10);g.lineTo(x,y-9);g.lineTo(x+7,y+10);g.fill();}}
    g.fillStyle=ink.key;g.fillRect(0,H-6,W,6);});
  // lines
  const lines=S.items.filter(i=>i.type==='line');
  lines.forEach(it=>{if(it.pts.length<2)return;g.strokeStyle=ink.mid;g.lineWidth=5;g.save();g.translate(1.6,1.3);path(g,it.pts);g.stroke();g.restore();g.strokeStyle=ink.key;path(g,it.pts);g.stroke();});
  // ropes
  const ropes=S.mode==='edit'||!w?S.items.filter(i=>i.type==='rope').map(i=>makeRope(i.a,i.b)):w.ropes;
  ropes.forEach(rp=>{const P=ropeShape(rp);g.strokeStyle=ink.mid;g.lineWidth=4;g.save();g.translate(1.5,1.2);path(g,P);g.stroke();g.restore();
    g.strokeStyle=ink.key;g.lineWidth=3;g.setLineDash([5,3]);path(g,P);g.stroke();g.setLineDash([]);
    g.fillStyle=ink.key;[P[0],P[P.length-1]].forEach(q=>{g.beginPath();g.arc(q[0],q[1],5,0,TAU);g.fill();});});
  // start flag
  const st=L.start;g.strokeStyle=ink.key;g.lineWidth=2;g.beginPath();g.moveTo(st.x-18,st.y+9);g.lineTo(st.x-18,st.y-22);g.stroke();
  g.fillStyle=ink.mid;g.beginPath();g.moveTo(st.x-18,st.y-22);g.lineTo(st.x-2,st.y-17);g.lineTo(st.x-18,st.y-12);g.fill();
  // rider
  const rd=w?w.rider:{x:st.x,y:st.y,a:0};
  if(w)w.trail.forEach((p,i)=>{if(i%2)return;g.globalAlpha=1-i/w.trail.length;g.fillStyle=ink.mid;g.beginPath();g.arc(p[0],p[1],3.2*(1-i/w.trail.length)+.8,0,TAU);g.fill();});g.globalAlpha=1;
  g.fillStyle=ink.mid;g.beginPath();g.arc(rd.x,rd.y,R,0,TAU);g.fill();
  g.strokeStyle=ink.key;g.lineWidth=2;g.beginPath();g.arc(rd.x+1.4,rd.y-1,R,0,TAU);g.stroke();
  g.fillStyle=ink.key;g.beginPath();g.arc(rd.x+Math.cos(rd.a-.5)*4.5,rd.y+Math.sin(rd.a-.5)*4.5,1.8,0,TAU);g.fill();
  // in-progress stroke
  const sk=S.stroke;if(sk){g.globalAlpha=.75;
    if(sk.type==='rope'){g.strokeStyle=ink.key;g.lineWidth=3;g.setLineDash([5,3]);g.beginPath();g.moveTo(sk.a[0],sk.a[1]);g.lineTo(sk.b[0],sk.b[1]);g.stroke();g.setLineDash([]);}
    else if(sk.pts.length>1){g.strokeStyle=sk.type==='wind'?ink.mid:ink.key;g.lineWidth=sk.type==='wind'?3:5;path(g,sk.pts);g.stroke();}
    g.globalAlpha=1;}
  // pop / splash when the run ends badly
  if(w&&(w.status==='popped'||w.status==='fell')){g.fillStyle=ink.mid;for(let i=0;i<10;i++){const a=i/10*TAU;g.beginPath();g.arc(rd.x+Math.cos(a)*16,rd.y+Math.sin(a)*16,3,0,TAU);g.fill();}}
}

// ---------- app ----------
function App(root){
  const $=s=>root.querySelector(s);
  const bg=$('#bg'),fg=$('#fg'),stage=$('#stage'),bgCache={};
  const S={li:0,level:null,items:[],tool:'line',mode:'edit',world:null,stroke:null,ink:null,pat:null,undo:[]};
  let progress={};try{progress=JSON.parse(localStorage.getItem('drift.progress')||'{}');}catch(e){}
  let px=1,speck=null,cw=0;

  function resize(){const r=stage.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);cw=r.width;px=cw/W*dpr;
    const pw=Math.round(r.width*dpr),ph=Math.round(r.height*dpr);if(fg.width!==pw){fg.width=pw;fg.height=ph;speck=speckle(pw,ph);}printBg();}
  function printBg(){const L=S.level,pw=Math.min(1600,fg.width),ph=Math.round(pw*H/W),key=S.li+':'+pw;
    if(bgCache[key]){paintBg(bgCache[key]);return;}
    $('#printing').hidden=false;
    setTimeout(()=>{// Backdrop pass: printed pale so the game's full-strength ink reads on top of it.
      const inks=L.bg.inks.map(hex),dens=Riso.renderScene(L.bg.scene,L.bg.seed,pw,ph,.55);dens.forEach(d=>{for(let i=0;i<d.length;i++)d[i]*=.5;});
      const img=Riso.print({w:pw,h:ph,paper:Riso.PAPERS.Natural,layers:Riso.layersFor(dens,inks,{seed:L.bg.seed,cell:6*pw/1600,mis:2.5*pw/1600}),texture:1,seed:L.bg.seed});
      const c=document.createElement('canvas');c.width=pw;c.height=ph;c.getContext('2d').putImageData(img,0,0);bgCache[key]=c;
      if(key===S.li+':'+Math.min(1600,fg.width))paintBg(c);$('#printing').hidden=true;},30);}
  function paintBg(c){bg.width=c.width;bg.height=c.height;bg.getContext('2d').drawImage(c,0,0);}

  function load(i){S.li=i;S.level=LEVELS[i];S.items=[];S.undo=[];S.mode='edit';S.world=null;S.stroke=null;
    const L=S.level;S.ink={light:hex(L.bg.inks[0]),mid:hex(L.bg.inks[1]),key:hex(L.bg.inks[2])};
    const g=fg.getContext('2d');S.pat={light:dotPattern(g,S.ink.light,7,1.9),lightDense:dotPattern(g,S.ink.light,6,2.4),mid:dotPattern(g,S.ink.mid,6,1.7)};
    root.style.setProperty('--light',S.ink.light);root.style.setProperty('--mid',S.ink.mid);root.style.setProperty('--key',S.ink.key);
    $('#num').textContent=String(i+1).padStart(2,'0');$('#lname').textContent=L.name;$('#hint').textContent=L.hint;
    root.querySelectorAll('[data-tool]').forEach(b=>b.hidden=!L.tools.includes(b.dataset.tool));
    if(!L.tools.includes(S.tool))S.tool=L.tools[0];
    $('#card').hidden=true;renderLevels();ui();printBg();}

  function ui(){const L=S.level,used=inkUsed(S.items)+(S.stroke?itemCost(S.stroke):0),left=Math.max(0,1-used/L.ink);
    $('#inkfill').style.width=(left*100).toFixed(1)+'%';$('#inkpct').textContent=Math.round(left*100)+'%';
    const p=L.par;$('#inkstars').textContent=used<=p[0]?'★★★':used<=p[1]?'★★☆':'★☆☆';
    root.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===S.tool));
    $('#go').innerHTML=S.mode==='edit'?'<svg viewBox="0 0 20 20"><path d="M5 3l12 7-12 7z"/></svg>Go':'<svg viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="12"/></svg>Reset';
    $('#go').classList.toggle('run',S.mode!=='edit');
    stage.classList.toggle('editing',S.mode==='edit');}

  function renderLevels(){const box=$('#levels');box.innerHTML='';LEVELS.forEach((L,i)=>{const b=document.createElement('button');b.className='lv'+(i===S.li?' on':'');
    b.title=L.name;b.innerHTML=`<span>${i+1}</span><i>${'★'.repeat(progress[i]||0)}</i>`;b.onclick=()=>load(i);box.append(b);});}

  // ----- input
  function pos(e){const r=fg.getBoundingClientRect();return[(e.clientX-r.left)/r.width*W,(e.clientY-r.top)/r.height*H];}
  const room=extra=>inkUsed(S.items)+extra<=S.level.ink+1e-6;
  function flashInk(){const m=$('#meter');m.classList.remove('flash');void m.offsetWidth;m.classList.add('flash');}
  fg.addEventListener('pointerdown',e=>{if(S.mode!=='edit')return;const p=pos(e);fg.setPointerCapture(e.pointerId);
    if(S.tool==='well'){const G0=S.level.goal;if(Math.hypot(p[0]-G0.x,p[1]-G0.y)<WELL.keepOut){toast('Too close to the ring');return;}
      if(!room(COST.well)){flashInk();return;}commit({type:'well',x:p[0],y:p[1]});return;}
    S.stroke=S.tool==='rope'?{type:'rope',a:p,b:p}:{type:S.tool,pts:[p]};ui();});
  fg.addEventListener('pointermove',e=>{const sk=S.stroke;if(!sk)return;const p=pos(e);
    if(sk.type==='rope'){const nb=p;if(room(itemCost({type:'rope',a:sk.a,b:nb})))sk.b=nb;else flashInk();}
    else{const last=sk.pts[sk.pts.length-1],d=Math.hypot(p[0]-last[0],p[1]-last[1]);if(d<6)return;
      if(room(itemCost(sk)+COST[sk.type]*d))sk.pts.push(p);else flashInk();}
    ui();});
  const up=()=>{const sk=S.stroke;if(!sk)return;S.stroke=null;
    if(sk.type==='rope'?Math.hypot(sk.b[0]-sk.a[0],sk.b[1]-sk.a[1])>24:sk.pts.length>1&&polyLen(sk.pts)>10)commit(sk);else ui();};
  fg.addEventListener('pointerup',up);fg.addEventListener('pointercancel',up);
  function commit(it){S.items.push(it);ui();}

  function toast(t){const el=$('#toast');el.textContent=t;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}
  function go(){if(S.mode==='edit'){S.world=build(S.level,S.items);S.mode='run';}else{S.mode='edit';S.world=null;$('#card').hidden=true;}ui();}
  function win(){S.mode='done';const used=inkUsed(S.items),p=S.level.par,stars=used<=p[0]?3:used<=p[1]?2:1;
    progress[S.li]=Math.max(progress[S.li]||0,stars);try{localStorage.setItem('drift.progress',JSON.stringify(progress));}catch(e){}
    $('#cardstars').innerHTML=[0,1,2].map(i=>`<svg viewBox="0 0 24 24" class="${i<stars?'got':''}"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/></svg>`).join('');
    $('#cardink').textContent=`Ink used: ${Math.round(used)} of ${S.level.ink}`;
    $('#next').hidden=S.li>=LEVELS.length-1;$('#card').hidden=false;renderLevels();ui();}

  root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{S.tool=b.dataset.tool;ui();});
  $('#go').onclick=go;
  $('#undo').onclick=()=>{if(S.mode!=='edit')go();S.items.pop();ui();};
  $('#clear').onclick=()=>{if(S.mode!=='edit')go();S.items=[];ui();};
  $('#next').onclick=()=>load(S.li+1);
  $('#retry').onclick=()=>{go();};
  addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;const k=e.key.toLowerCase();
    if(k===' '||k==='enter'){e.preventDefault();go();}else if(k==='z'||k==='backspace')$('#undo').click();
    else{const t={'1':'line','2':'wind','3':'rope','4':'well'}[k];if(t&&S.level.tools.includes(t)){S.tool=t;ui();}}});

  // ----- loop
  let last=performance.now(),acc=0;
  function frame(now){acc=Math.min(acc+(now-last)/1000,.1);last=now;
    if(S.mode==='run'&&S.world){while(acc>=DT){step(S.world,S.level);acc-=DT;
        const st=S.world.status;if(st!=='run'){if(st==='win')win();else{toast({popped:'Popped!',fell:'Fell off the page',stuck:'Stuck. Try another line'}[st]);S.mode='fail';setTimeout(()=>{if(S.mode==='fail'){S.mode='edit';S.world=null;ui();}},900);}break;}}}
    else acc=0;
    const g=fg.getContext('2d');g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,fg.width,fg.height);g.setTransform(px,0,0,px,0,0);
    drawScene(g,S,now/1000);
    if(speck){g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='destination-out';g.drawImage(speck,0,0);g.globalCompositeOperation='source-over';}
    requestAnimationFrame(frame);}

  new ResizeObserver(resize).observe(stage);
  load(0);resize();requestAnimationFrame(frame);
  return{S,load,setItems(items){S.items=items;S.mode='edit';S.world=null;ui();},go,simulate,LEVELS,inkUsed};}

window.Drift={App,LEVELS,simulate,inkUsed,build,step,ROPE,WIND,WELL};
})();
