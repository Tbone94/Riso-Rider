// ride.js — first-person renderer, ride backdrop and ride HUD.
// Every world surface is its side-view (x,y) geometry extruded along z by a half-width hw.
// Canvas 2D: surfaces are cut into short world-anchored chunks, clipped against a near
// plane, sorted far → near (painter's) and filled in the level's three riso inks on a
// transparent canvas that the app multiplies over the printed backdrop.
// Contract: ARCHITECTURE.md → ride.js. A WebGL rebuild can keep buildGeometry/camera and
// swap the painter for a depth buffer.
import {W,H,R,WIND,WELL,WIDTH,CRUMBLE,groundBelow} from './physics.js';
import {LEVELS} from './levels.js';

const TAU=Math.PI*2,CX=W/2,CY=H/2,NEAR=2,FAR=1150;
const P0=.1;                 // resting pitch (look slightly down at the ribbon)
const BG_SCALE=1.25;         // backdrop is shown scaled about its centre, leaving room to pan
const HB=Math.round(CY+(CY-Math.tan(P0)*400-CY)/BG_SCALE);   // backdrop horizon (design units)
const CHUNK={road:30,wall:40,line:14,haz:40,cap:60};
const LINE_VIS=.5,LINE_TH=3;   // tightropes are drawn narrower than their physics half-width, with a visible thickness
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const NONE='rgba(0,0,0,0)';   // an ink left out of the current plate pass (swoop)
const ease=(k,dt)=>1-Math.exp(-k*dt);
const hash=(i,s=0)=>{let h=Math.imul(i|0,374761393)+Math.imul(s|0,668265263)|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};

// Surface styles
const ROAD=1,WALL=2,UNDER=3,CAP=4,LINE=5,ROPE=6,HAZ=7,STREAK=8,LANE=9,WELLI=10,GOAL=11,CHEV=12,ICE=13,CRT=14,BOOSTP=15,DROPI=16;

// ---------- geometry built once per ride ----------
function polyArea(p){let a=0;for(let i=0;i<p.length;i++){const q=p[i],r=p[(i+1)%p.length];a+=q[0]*r[1]-r[0]*q[1];}return a/2;}
// Sutherland–Hodgman in 2D against x ≥ v (keep=1) or x ≤ v (keep=-1).
function clipX(poly,v,keep){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ia=(a[0]-v)*keep>=0,ib=(b[0]-v)*keep>=0;
  if(ia)out.push(a);if(ia!==ib){const t=(v-a[0])/(b[0]-a[0]);out.push([v,a[1]+(b[1]-a[1])*t]);}}return out;}
function chunkOf(P,st,extra){let cx=0,cy=0,cz=0;const n=P.length/3;for(let i=0;i<P.length;i+=3){cx+=P[i];cy+=P[i+1];cz+=P[i+2];}cx/=n;cy/=n;cz/=n;
  let rad=0;for(let i=0;i<P.length;i+=3)rad=Math.max(rad,Math.hypot(P[i]-cx,P[i+1]-cy,P[i+2]-cz));
  return Object.assign({P:Float32Array.from(P),st,cx,cy,cz,rad},extra);}
// A ribbon along an xy polyline, extruded to z∈[z0,z1]: forward along z0, back along z1.
function ribbon(pts,z0,z1){const P=[];for(const p of pts)P.push(p[0],p[1],z0);for(let i=pts.length-1;i>=0;i--)P.push(pts[i][0],pts[i][1],z1);return P;}
// Split a polyline into pieces of about `len` arc length; returns [{pts, s0}] (s0 = arc length at start).
function splitPolyline(pts,len){const out=[];let cur=[pts[0]],acc=0,s=0,s0=0;
  for(let i=1;i<pts.length;i++){let a=pts[i-1];const b=pts[i];let seg=Math.hypot(b[0]-a[0],b[1]-a[1]);
    while(acc+seg>=len&&seg>1e-6){const t=(len-acc)/seg,p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];cur.push(p);out.push({pts:cur,s0});s+=len-acc;s0=s;cur=[p];seg-=len-acc;acc=0;a=p;}
    acc+=seg;s+=seg;cur.push(b);}
  if(cur.length>1&&acc>.5)out.push({pts:cur,s0});return out;}

function buildGeometry(world,level){
  const chunks=[],hwB=level.blockHw||WIDTH.block;
  // Solids: every polygon edge is a face (tops are roads, then walls and undersides), plus end caps.
  // Ice and crumbling blocks are solids too, with their own top faces; crumble chunks know their
  // block (cr) so they can shake, split and fall as world.crumbles[cr].k advances.
  const solids=[...level.blocks.map(p=>({poly:p,kind:'block'})),...(level.ice||[]).map(p=>({poly:p,kind:'ice'})),...(level.crumble||[]).map((p,i)=>({poly:p,kind:'crumble',cr:i}))];
  let ci=0;
  for(const{poly,kind,cr}of solids){const sgn=polyArea(poly)>0?1:-1,crk=kind==='crumble';
    const more=()=>{ci++;return crk?{cr,crk:true,fall:[hash(ci,1),hash(ci,2),hash(ci,3)]}:{};};
    for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<1e-3)continue;
      const nx=sgn*dy/len,ny=-sgn*dx/len,top=ny<-.35,st=top?(kind==='ice'?ICE:crk?CRT:ROAD):ny>.35?UNDER:WALL,n=Math.max(1,Math.round(len/(top?CHUNK.road:CHUNK.wall)));
      for(let k=0;k<n;k++){const t0=k/n,t1=(k+1)/n,p=[a[0]+dx*t0,a[1]+dy*t0],q=[a[0]+dx*t1,a[1]+dy*t1];
        const extra=Object.assign({nx,ny,nz:0,px:p[0],py:p[1],pz:0,par:k&1},more());
        if(top){const ux=dx/len,uy=dy/len,cl=len/n,at=(u,z)=>[p[0]+ux*u,p[1]+uy*u,z],quad=(u0,z0,u1,z1,u2,z2,u3,z3)=>[...at(u0,z0),...at(u1,z1),...at(u2,z2),...at(u3,z3)],det=[];
          if(kind==='ice'){// slick diagonal hatching, and hairline kerbs
            for(let z=-hwB+8,j=0;z<hwB-16;z+=13,j++){const u=hash(ci*37+j,9)*Math.max(0,cl-13);det.push(quad(u,z,u+1.6,z,u+12.6,z+9,u+11,z+9));}
            det.push(ribbon([p,q],hwB-1.6,hwB),ribbon([p,q],-hwB,-hwB+1.6));}
          else if(crk){// a crack wandering across the slab, plus kerbs
            let pu=cl*(.2+.6*hash(ci,4)),pz=-hwB;for(let j=1;j<=5;j++){const z=-hwB+j*2*hwB/5,u=clamp(pu+(hash(ci*5+j,6)-.5)*cl*.7,1,cl-1);det.push(quad(pu-.7,pz,pu+.7,pz,u+.7,z,u-.7,z));pu=u;pz=z;}
            det.push(ribbon([p,q],hwB-3,hwB),ribbon([p,q],-hwB,-hwB+3));}
          else{// road markings: a bar across the road at the start of every other chunk, kerbs along both edges
            const bw=Math.min(4,cl*.3),kw=3.5;
            if(!(k&1))det.push(ribbon([p,[p[0]+ux*bw,p[1]+uy*bw]],-hwB+kw+4,hwB-kw-4));
            det.push(ribbon([p,q],hwB-kw,hwB),ribbon([p,q],-hwB,-hwB+kw));}
          extra.det=det;}
        chunks.push(chunkOf(ribbon([p,q],-hwB,hwB),st,extra));}}
    // End caps (the polygon itself at z=±hw), sliced along x so they sort with the rest.
    const xs=poly.map(p=>p[0]),x0=Math.min(...xs),x1=Math.max(...xs),n=Math.max(1,Math.round((x1-x0)/CHUNK.cap));
    for(let k=0;k<n;k++){let piece=clipX(poly,x0+(x1-x0)*k/n,1);piece=clipX(piece,x0+(x1-x0)*(k+1)/n,-1);if(piece.length<3)continue;
      for(const sz of[1,-1]){const P=[];piece.forEach(p=>P.push(p[0],p[1],sz*hwB));chunks.push(chunkOf(P,CAP,Object.assign({nx:0,ny:0,nz:sz,px:piece[0][0],py:piece[0][1],pz:sz*hwB},more())));}}}
  // Drawn lines: join the world's line segments back into polylines, then cut them into stripes.
  const lines=[];let cur=null;
  for(const s of world.segs){if(s.kind!=='line')continue;
    if(cur&&Math.abs(cur.pts[cur.pts.length-1][0]-s.ax)<1e-6&&Math.abs(cur.pts[cur.pts.length-1][1]-s.ay)<1e-6)cur.pts.push([s.bx,s.by]);
    else{cur={pts:[[s.ax,s.ay],[s.bx,s.by]],hw:s.hw};lines.push(cur);}}
  for(const ln of lines)for(const piece of splitPolyline(ln.pts,CHUNK.line)){const p=piece.pts,a=p[0],b=p[p.length-1];
    let nx=a[1]-b[1],ny=b[0]-a[0];const l=Math.hypot(nx,ny)||1;nx/=l;ny/=l;if(ny>0){nx=-nx;ny=-ny;}
    {const wv=ln.hw*LINE_VIS,down=p.map(q=>[q[0]-nx*LINE_TH,q[1]-ny*LINE_TH]);   // nx,ny point up: down is the ribbon's thickness
      chunks.push(chunkOf(ribbon(p,-wv,wv),LINE,{nx,ny,nz:0,px:a[0],py:a[1],pz:0,two:true,par:Math.round(piece.s0/CHUNK.line)&1,mid:p,hw:ln.hw,wv,
        edges:[ribbon(p,wv-.9,wv),ribbon(p,-wv,-wv+.9)],core:ribbon(p,-.8,.8),
        sides:[[...ribbon([p[0],p[p.length-1]],wv,wv).slice(0,6),...[down[down.length-1][0],down[down.length-1][1],wv,down[0][0],down[0][1],wv]],
               [...ribbon([p[0],p[p.length-1]],-wv,-wv).slice(0,6),...[down[down.length-1][0],down[down.length-1][1],-wv,down[0][0],down[0][1],-wv]]]}));}}
  // Hazards: a wide band (hw is infinite in physics) with spikes grown near the camera each frame.
  const HZ=320;   // the spike floor is infinite in z; draw a band around you (see collect)
  for(const s of world.hazards){const len=Math.hypot(s.bx-s.ax,s.by-s.ay),n=Math.max(1,Math.round(len/CHUNK.haz));
    let nx=s.ay-s.by,ny=s.bx-s.ax;const l=Math.hypot(nx,ny)||1;nx/=l;ny/=l;if(ny>0){nx=-nx;ny=-ny;}
    for(let k=0;k<n;k++){const p=[s.ax+(s.bx-s.ax)*k/n,s.ay+(s.by-s.ay)*k/n],q=[s.ax+(s.bx-s.ax)*(k+1)/n,s.ay+(s.by-s.ay)*(k+1)/n];
      const c=chunkOf(ribbon([p,q],-HZ,HZ),HAZ,{nx,ny,nz:0,p,q,two:true,seed:k*31+chunks.length});c.cz=0;c.rad=Math.hypot(q[0]-p[0],q[1]-p[1])/2;chunks.push(c);}}
  // Wind lanes: arc-length tables and seeded ink streaks.
  const winds=world.winds.map((wd,wi)=>{const P=wd.pts,cum=[0];for(let i=1;i<P.length;i++)cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
    const L=cum[cum.length-1]||1,n=Math.round(clamp(L/4.5,20,160)),streaks=[];
    for(let i=0;i<n;i++){const h=k=>hash(i*7+k,wi*101+13);streaks.push({u:h(0)*L,off:(h(1)*2-1)*WIND.radius*.7,z:(h(2)*2-1)*wd.hw*.9,len:10+h(3)*14,v:.75+h(4)*.5});}
    return{pts:P,cum,L,hw:wd.hw,streaks,lanes:splitPolyline(P,24)};});
  return{chunks,winds,hwB};}

// Point at arc length s along a wind polyline, with its unit tangent.
function along(wd,s,o){const{pts,cum}=wd;let i=1;while(i<cum.length-1&&cum[i]<s)i++;
  const a=pts[i-1],b=pts[i],l=cum[i]-cum[i-1]||1,t=clamp((s-cum[i-1])/l,0,1);o[0]=a[0]+(b[0]-a[0])*t;o[1]=a[1]+(b[1]-a[1])*t;o[2]=(b[0]-a[0])/l;o[3]=(b[1]-a[1])/l;return o;}

// ---------- the ride backdrop (a riso scene printed once per level) ----------
const A=a=>`rgba(0,0,0,${clamp(a,0,1)})`;
const sheetNo=level=>Math.max(1,LEVELS.findIndex(l=>l.id===level.id)+1);
function ridge(r,x0,x1,y0,y1,rough,depth){let p=[[x0,y0],[x1,y1]],amp=(x1-x0)*rough;
  for(let d=0;d<depth;d++){const o=[];for(let i=0;i<p.length-1;i++)o.push(p[i],[(p[i][0]+p[i+1][0])/2,(p[i][1]+p[i+1][1])/2+(r()+r()+r()-1.5)*amp]);o.push(p[p.length-1]);p=o;amp*=.55;}return p;}
function fillTo(c,pts,bottom){c.beginPath();c.moveTo(pts[0][0],pts[0][1]);pts.forEach(p=>c.lineTo(p[0],p[1]));c.lineTo(pts[pts.length-1][0],bottom);c.lineTo(pts[0][0],bottom);c.closePath();c.fill();}
function erase(c,a,fn){c.save();c.globalCompositeOperation='destination-out';c.fillStyle=c.strokeStyle=A(a);fn();c.restore();}
function disc(c,x,y,r){c.beginPath();c.arc(x,y,r,0,TAU);c.fill();}

function rideScene(c,r,level,sheetNo){const[L,M,D]=c,kind=level.bg.scene;
  // 1. Split-fountain sky: mid ink at the top blending into light ink at the horizon,
  //    with uneven roller banding (irregular bands of more and less ink).
  const ph=[r()*TAU,r()*TAU,r()*TAU],bands=[];for(let y=0;y<HB;){const h=6+r()*26;bands.push([y,y+h,(r()-.5)*.22]);y+=h;}
  for(let y=0;y<HB;y+=1){const t=y/HB,b=bands.find(q=>y>=q[0]&&y<q[1]),band=1+.08*Math.sin(y*.09+ph[0])+.05*Math.sin(y*.023+ph[1])+(b?b[2]:0);
    M.fillStyle=A(Math.pow(1-t,1.3)*.8*band);M.fillRect(0,y,W,1.1);L.fillStyle=A((.2+.8*t)*.78*band);L.fillRect(0,y,W,1.1);}
  // tyre tracks: the feed rollers lift a little ink in two vertical lanes
  [W*.27+r()*20,W*.7+r()*20].forEach(x=>{erase(M,.22,()=>M.fillRect(x,0,14,HB));erase(L,.12,()=>L.fillRect(x+3,0,9,HB));});
  // 2. Far plates standing on the horizon, one vocabulary per level scene
  const far=()=>{const a=ridge(r,-20,820,HB-60+(r()-.5)*30,HB-60+(r()-.5)*30,.1,6);M.fillStyle=A(.42);fillTo(M,a,HB);
    const b=ridge(r,-20,820,HB-28,HB-24,.07,6);M.fillStyle=A(.35);fillTo(M,b,HB);D.fillStyle=A(.45);fillTo(D,b,HB);return b;};
  if(kind==='woodblock'){
    const fx=250+r()*300,peak=HB-150-r()*25,half=240,fuji=new Path2D();fuji.moveTo(fx-half,HB);fuji.quadraticCurveTo(fx-half*.35,HB-18,fx-16,peak);fuji.lineTo(fx+16,peak);fuji.quadraticCurveTo(fx+half*.35,HB-18,fx+half,HB);fuji.closePath();
    D.fillStyle=A(.62);D.fill(fuji);M.fillStyle=A(.25);M.fill(fuji);
    [D,M,L].forEach(k=>erase(k,1,()=>{k.save();k.clip(fuji);k.beginPath();k.moveTo(fx-120,peak-5);k.lineTo(fx+120,peak-5);
      for(let i=0;i<=14;i++){const x=fx+120-i*240/14,e=Math.abs(x-fx)/120;k.lineTo(x,peak+30+(i%2?16+r()*16:-2)*(1-e*.7)+e*18);}k.closePath();k.fill();k.restore();}));
    for(let i=0;i<5;i++){const cy=40+r()*(HB-90),cx=r()*W,len=120+r()*220,th=9+r()*7;erase(M,1,()=>{M.beginPath();M.roundRect(cx-len/2,cy-th/2,len,th,th/2);M.fill();});}
    D.fillStyle=A(.5);D.fillRect(0,HB-6,W,10);
    const Rw=13;for(let row=0,y=HB+2;row<2;row++,y+=Rw*.55)for(let x=(row?Rw:0)-Rw;x<W+Rw;x+=Rw*2){erase(D,1,()=>disc(D,x,y,Rw));D.fillStyle=A(.55-row*.2);disc(D,x,y,Rw);erase(D,1,()=>{D.lineWidth=1.6;[.7,.42].forEach(f=>{D.beginPath();D.arc(x,y,Rw*f,Math.PI,TAU);D.stroke();});});}
  }else if(kind==='cutouts'){
    for(let i=0;i<7;i++){const x=i<4?r()*230:W-r()*230,k=r()<.5?M:D,S=90+r()*110;k.save();k.translate(x,HB+4);k.rotate((r()-.5)*.5);k.fillStyle=A(.85);k.beginPath();
      const Lp=[],Rp=[];for(let t=0;t<=1.001;t+=.04){const w=S*.2*(1-t*.6),bend=Math.sin(t*2.4)*S*.1;Lp.push([bend-w*(.4+.6*Math.abs(Math.sin(t*Math.PI*3))),-t*S]);Rp.push([bend+w*(.4+.6*Math.abs(Math.sin(t*Math.PI*3+1.2))),-t*S]);}
      Lp.forEach(p=>k.lineTo(p[0],p[1]));Rp.reverse().forEach(p=>k.lineTo(p[0],p[1]));k.closePath();k.fill();k.restore();}
    for(let i=0;i<7;i++){const x=150+r()*500,y=30+r()*(HB-80),s=6+r()*9,a0=r()*TAU;D.fillStyle=A(.8);D.beginPath();for(let j=0;j<10;j++){const a=a0+j*Math.PI/5,rr=j%2?s*.45:s;D.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}D.closePath();D.fill();}
    M.fillStyle=A(.35);M.fillRect(0,HB-3,W,6);
  }else if(kind==='orbits'){
    const right=r()<.5,ox=right?560+r()*80:240-r()*80,oy=HB-20,Ro=120+r()*30;
    M.fillStyle=A(.75);M.beginPath();M.arc(ox,oy,Ro,Math.PI,Math.PI*1.5);M.lineTo(ox,oy);M.closePath();M.fill();
    D.fillStyle=A(.6);D.beginPath();D.arc(ox,oy,Ro,Math.PI*1.5,TAU);D.lineTo(ox,oy);D.closePath();D.fill();
    [M,D].forEach(k=>erase(k,1,()=>{k.lineWidth=2.5;[.8,.6,.4].forEach(f=>{k.beginPath();k.arc(ox,oy,Ro*f,0,TAU);k.stroke();});}));
    erase(L,.7,()=>disc(L,ox,oy,Ro*.22));
    const sx=W-ox,sy=70+r()*40;D.strokeStyle=A(.6);D.lineWidth=4;D.lineCap='round';D.beginPath();for(let t=0;t<3.2*TAU;t+=.08){const rr=3+t*3.4;D.lineTo(sx+Math.cos(t)*rr,sy+Math.sin(t)*rr);}D.stroke();
    far();
  }else if(kind==='bauhaus'){
    L.fillStyle=A(.6);disc(L,160+r()*480,HB-40,90+r()*50);D.fillStyle=A(.7);D.fillRect(r()*500,HB-70-r()*40,160+r()*120,12);
    M.fillStyle=A(.8);M.beginPath();M.moveTo(560,HB);M.lineTo(640,HB-120);M.lineTo(720,HB);M.closePath();M.fill();far();
  }else{// park poster (default): layered ridges, a paper-white sun, tiny pines on the near ridge
    const sx=180+r()*440,sy=HB-110-r()*40;[M,L].forEach(k=>erase(k,1,()=>disc(k,sx,sy,40)));M.fillStyle=A(.35);M.beginPath();M.arc(sx,sy,50,0,TAU);M.arc(sx,sy,44,0,TAU,true);M.fill();
    const b=far();D.fillStyle=A(.9);for(let i=0;i<26;i++){const p=b[(r()*b.length)|0],h=8+r()*10;D.beginPath();D.moveTo(p[0],p[1]-h);D.lineTo(p[0]+h*.3,p[1]+2);D.lineTo(p[0]-h*.3,p[1]+2);D.closePath();D.fill();}
  }
  // 3. The valley far below the ribbons: a band of distant fields, then broken furrows
  //    that thin out toward the viewer, then open paper so the track reads.
  M.fillStyle=A(.38);M.fillRect(0,HB,W,16);erase(M,1,()=>{for(let i=0;i<60;i++)M.fillRect(r()*W,HB+3+r()*12,8+r()*30,1.1);});
  for(let k=0;k<20;k++){const y=HB+18+Math.pow(k/19,1.7)*170,a=.32*(1-k/22);let x=-20+r()*40;
    while(x<W){const len=40+r()*160*(1+k*.15);D.fillStyle=A(a*(.6+r()*.4));D.fillRect(x,y,len,.8+k*.09);x+=len+10+r()*70;}}
  L.fillStyle=(()=>{const g=L.createLinearGradient(0,HB,0,H);g.addColorStop(0,A(.4));g.addColorStop(.5,A(.12));g.addColorStop(1,A(0));return g;})();L.fillRect(0,HB,W,H-HB);
  // 4. Print furniture inside the visible area: registration marks (printed on every drum,
  //    so they show the misregistration) and a slug line.
  const vis=(1-1/BG_SCALE)/2,x0=W*vis+12,x1=W*(1-vis)-12,y0=H*vis+12;
  [[x0,y0],[x1,y0]].forEach(([x,y])=>c.forEach(k=>{k.strokeStyle=A(.9);k.lineWidth=.8;k.beginPath();k.arc(x,y,5,0,TAU);k.moveTo(x-9,y);k.lineTo(x+9,y);k.moveTo(x,y-9);k.lineTo(x,y+9);k.stroke();}));
  D.fillStyle=A(.85);D.font='8px "Cutive Mono",ui-monospace,Menlo,monospace';D.textBaseline='top';
  D.fillText(`LEVEL ${String(sheetNo).padStart(2,'0')} · ${level.name.toUpperCase()}`,x0-5,y0+11);}

// ---------- the renderer ----------
export function createRide(){
  let geo=null,worldRef=null,levelRef=null;
  // camera state
  let chA=0,lastLand=null,yaw=0,heading=1,flipT=0,pitch=P0,shake=0,squash=0,evIdx=0,camX=0,camY=0,camZ=0,chaseInit=false;
  // per-frame camera basis (module scratch for speed)
  let ex=0,ey=0,ez=0,fx=1,fy=0,fz=0,rx=0,ry=0,rz=1,dx=0,dy=1,dz=0,F=400;
  let g=null,ink=null,pat=null,fog=1,mis=1.5,distOff=0,sideMix=0,tNow=0,AM=1;
  let tr=0,roll=0,danger=0,dgSide=1,dgX=0,dgY=0,dgHw=0;   // tightrope blend (1 on a line, .5 on a rope), camera roll, edge warning   // AM: alpha multiplier for fading whole layers
  const stats={items:0,ms:0};
  const CXs=new Float64Array(96),CYs=new Float64Array(96),CZs=new Float64Array(96),OUT=new Float64Array(192);
  let sx1=0,sy1=0,sx2=0,sy2=0,ss1=0,ss2=0;
  const pool=[];let nItems=0;
  const item=()=>{let it=pool[nItems];if(!it)it=pool[nItems]={d:0,st:0,o:null,a:0,b:0,c:0};nItems++;return it;};

  // Transform a flat [x,y,z,...] polygon to the screen, clipped against the near plane.
  // Writes OUT and returns the vertex count (0 if nothing is visible).
  function project(P){const n=P.length/3;let front=0;
    for(let i=0,j=0;i<n;i++,j+=3){const X=P[j]-ex,Y=P[j+1]-ey,Z=P[j+2]-ez;CXs[i]=X*rx+Y*ry+Z*rz;CYs[i]=X*dx+Y*dy+Z*dz;const cz=CZs[i]=X*fx+Y*fy+Z*fz;if(cz>=NEAR)front++;}
    if(!front)return 0;let m=0,minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9;
    const put=(x,y,z)=>{const s=F/z,px=CX+x*s,py=CY+y*s;OUT[m*2]=px;OUT[m*2+1]=py;m++;if(px<minx)minx=px;if(px>maxx)maxx=px;if(py<miny)miny=py;if(py>maxy)maxy=py;};
    for(let i=0;i<n;i++){if(front===n){put(CXs[i],CYs[i],CZs[i]);continue;}
      const j=(i+1)%n,ia=CZs[i]>=NEAR,ib=CZs[j]>=NEAR;if(ia)put(CXs[i],CYs[i],CZs[i]);
      if(ia!==ib){const t=(NEAR-CZs[i])/(CZs[j]-CZs[i]);put(CXs[i]+(CXs[j]-CXs[i])*t,CYs[i]+(CYs[j]-CYs[i])*t,NEAR);}}
    if(m<3||maxx<-20||minx>W+20||maxy<-20||miny>H+20)return 0;return m;}
  function trace(m,ox,oy){g.moveTo(OUT[0]+ox,OUT[1]+oy);for(let i=1;i<m;i++)g.lineTo(OUT[i*2]+ox,OUT[i*2+1]+oy);g.closePath();}
  function fillPoly(P,style,alpha,ox=0,oy=0){const m=project(P);if(!m)return false;if(style===NONE)return true;g.globalAlpha=AM*(alpha);g.fillStyle=style;g.beginPath();trace(m,ox,oy);g.fill();return true;}
  // Project a 3D segment (clipped to the near plane) into sx1..sy2; ss1/ss2 are perspective scales.
  function seg(x1,y1,z1,x2,y2,z2){let X=x1-ex,Y=y1-ey,Z=z1-ez;let ax=X*rx+Y*ry+Z*rz,ay=X*dx+Y*dy+Z*dz,az=X*fx+Y*fy+Z*fz;X=x2-ex;Y=y2-ey;Z=z2-ez;let bx=X*rx+Y*ry+Z*rz,by=X*dx+Y*dy+Z*dz,bz=X*fx+Y*fy+Z*fz;
    if(az<NEAR&&bz<NEAR)return false;
    if(az<NEAR){const t=(NEAR-az)/(bz-az);ax+=(bx-ax)*t;ay+=(by-ay)*t;az=NEAR;}else if(bz<NEAR){const t=(NEAR-bz)/(az-bz);bx+=(ax-bx)*t;by+=(ay-by)*t;bz=NEAR;}
    ss1=F/az;ss2=F/bz;sx1=CX+ax*ss1;sy1=CY+ay*ss1;sx2=CX+bx*ss2;sy2=CY+by*ss2;return true;}
  function pt(x,y,z){const X=x-ex,Y=y-ey,Z=z-ez,cz=X*fx+Y*fy+Z*fz;if(cz<NEAR)return false;ss1=F/cz;sx1=CX+(X*rx+Y*ry+Z*rz)*ss1;sy1=CY+(X*dx+Y*dy+Z*dz)*ss1;return true;}
  const fogOf=d=>clamp(1.12-d/900,.16,1);
  const dist2=(x,y,z)=>{const a=x-ex,b=y-ey,c=z-ez;return a*a+b*b+c*c;};
  const ahead=(x,y,z,rad)=>(x-ex)*fx+(y-ey)*fy+(z-ez)*fz>-rad;

  // ---------- item painters ----------
  const shifted=(P,ox,oy,oz)=>{const Q=new Float32Array(P.length);for(let i=0;i<P.length;i+=3){Q[i]=P[i]+ox;Q[i+1]=P[i+1]+oy;Q[i+2]=P[i+2]+oz;}return Q;};
  function drawChunk(ch,d){let f=fogOf(d)*(tr>0?1-.6*tr*clamp((ch.cy-ey-60)/280,0,1):1),mo=mis*(.7+d/500),P=ch.P,det=ch.det;   // depth haze below a tightrope
    if(ch.cr!=null){const c=worldRef.crumbles&&worldRef.crumbles[ch.cr];
      if(c&&c.k>0){if(c.k>=1)return;const el=c.k*(CRUMBLE.delay+CRUMBLE.fall);let ox=0,oy=0,oz=0;
        if(el<CRUMBLE.delay){const a=1.6*el/CRUMBLE.delay;ox=(Math.random()-.5)*a;oy=(Math.random()-.5)*a;}   // it shivers first
        else{const tf=el-CRUMBLE.delay,[h1,h2,h3]=ch.fall;ox=(h2-.5)*70*tf;oy=.5*900*tf*tf*(.6+.8*h1)+tf*30;oz=(h3-.5)*80*tf;f*=clamp(1-tf/CRUMBLE.fall,0,1);}
        P=shifted(P,ox,oy,oz);if(det)det=det.map(D=>shifted(D,ox,oy,oz));}}
    const kerbs=(style,a,ox,oy)=>{if(style===NONE)return;g.globalAlpha=AM*(a);g.fillStyle=style;g.beginPath();for(const D of det){const m=project(D);if(m)trace(m,ox,oy);}g.fill();};
    switch(ch.st){
      case ROAD:// roads are light-ink slabs; the key-ink kerbs and bars carry the read, with a mid plate out of register
        if(!fillPoly(P,ink.light,.92*f))return;kerbs(ink.mid,.85*f,mo,mo*.7);kerbs(ink.key,f,0,0);return;
      case ICE:// ice: a thin mid-ink tint with key diagonal hatching, no kerb bars (nothing to grip)
        if(!fillPoly(P,ink.light,.92*f))return;fillPoly(P,ink.mid,.3*f);kerbs(ink.key,.9*f,0,0);break;
      case CRT:// crumbling: a road slab with a crack across it and a dashed outline (below)
        if(!fillPoly(P,ink.light,.92*f))return;kerbs(ink.mid,.8*f,mo,mo*.7);kerbs(ink.key,f,0,0);break;
      case WALL:{if(!fillPoly(P,ink.mid,.5*f))return;g.globalAlpha=AM*(f);g.fillStyle=pat.key;g.beginPath();trace(project(P),0,0);g.fill();break;}
      case UNDER:if(!fillPoly(P,pat.mid,f))return;break;
      case CAP:{if(!fillPoly(P,ink.light,.85*f))return;
        if(sideMix>0){fillPoly(P,ink.mid,sideMix,3*sideMix,2.5*sideMix);fillPoly(P,ink.key,sideMix);}   // the side view's solid key block
        break;}
      case LINE:{// a tightrope: a narrow mid-ink ribbon with key hairline edges and a key core wire
        const top=(ex-ch.px)*ch.nx+(ey-ch.py)*ch.ny>=0;
        if(!top){if(!fillPoly(P,pat.key,f))return;}
        else{if(!fillPoly(P,ink.key,.55*f,-mo,-mo*.7))return;fillPoly(P,ink.mid,f*(ch.par?.82:1));
          g.globalAlpha=AM*(f);g.fillStyle=ink.key;g.beginPath();for(const D of ch.edges){const m=project(D);if(m)trace(m,0,0);}const mc=project(ch.core);if(mc)trace(mc,0,0);g.fill();}
        // its thickness, seen from off to the side or below
        for(const sd of ch.sides){const zz=sd[2];if((ez-zz)*Math.sign(zz)>0)fillPoly(sd,ink.key,.8*f);}
        // walking it: a mid-ink warning strip on the side you're drifting toward
        if(danger>0&&(ch.cx-dgX)*(ch.cx-dgX)+(ch.cy-dgY)*(ch.cy-dgY)<150*150&&ch.hw===dgHw){const z0=dgSide*ch.wv,z1=dgSide*(ch.wv+1.5+5*danger),Q=ribbon(ch.mid,Math.min(z0,z1),Math.max(z0,z1)),a=f*Math.min(1,danger*1.4);
          // warning tape: a light-ink strip with key diagonal ticks along the edge you're drifting toward
          if(fillPoly(Q,ink.light,a)){const p0=ch.mid[0],p1=ch.mid[ch.mid.length-1],L=Math.hypot(p1[0]-p0[0],p1[1]-p0[1])||1,ux=(p1[0]-p0[0])/L,uy=(p1[1]-p0[1])/L,T=new Float32Array(12);
            g.globalAlpha=AM*(a);g.fillStyle=ink.key;g.beginPath();
            for(let u=1;u<L-3;u+=5){const q=[[u,z0],[u+1.6,z0],[u+3.6,z1],[u+2,z1]];q.forEach(([uu,zz],i)=>{T[i*3]=p0[0]+ux*uu;T[i*3+1]=p0[1]+uy*uu-.2;T[i*3+2]=zz;});const m=project(T);if(m)trace(m,0,0);}g.fill();}}
        // and the drop: dotted plumb lines from the edges, only while you're on a narrow ribbon
        if(tr>.05&&d<320){const q=ch.mid[0],gy=shadowY(ch);
          // the wire's own shadow, far down on whatever is below: moves at a different rate, so you feel the height
          if(gy-q[1]>40){const Q=ribbon(ch.mid.map(p=>[p[0],gy-1]),-ch.wv*1.3,ch.wv*1.3);fillPoly(Q,ink.key,.28*tr*f);}
          if(ch.par){g.globalAlpha=AM*(.65*tr*f);g.strokeStyle=ink.key;g.setLineDash([1.4,4]);g.lineWidth=1.1;g.beginPath();
            for(const zz of[-ch.wv,ch.wv])if(seg(q[0],q[1]+LINE_TH+2,zz,q[0],Math.min(gy,q[1]+260),zz)){g.moveTo(sx1,sy1);g.lineTo(sx2,sy2);}g.stroke();g.setLineDash([]);}}
        if(sideMix>0){// seen edge-on at the start of the swoop a ribbon has no area: stroke it like side.js does
          g.lineCap='round';for(const[col,w,ox,oy]of[[ink.mid,4.5,1.6,1.3],[ink.key,3.2,0,0]]){g.globalAlpha=AM*(sideMix);g.strokeStyle=col;g.lineWidth=w;g.beginPath();let on=false;
            for(const q of ch.mid){if(pt(q[0],q[1],0)){on?g.lineTo(sx1+ox,sy1+oy):g.moveTo(sx1+ox,sy1+oy);on=true;}}g.stroke();}g.lineCap='butt';}
        return;}
      case HAZ:{fillPoly(P,pat.mid,f*.45);drawSpikes(ch,d);return;}}
    if(ch.crk){const m=project(P);if(m){g.globalAlpha=AM*(f);g.strokeStyle=ink.key;g.lineWidth=1.3;g.setLineDash([5,4]);g.beginPath();trace(m,0,0);g.stroke();g.setLineDash([]);}}}
  // What lies under a tightrope chunk: the next surface down, else the spike floor, else the page bottom.
  function shadowY(ch){if(ch.shY!=null)return ch.shY;const q=ch.mid[0],gb=groundBelow(worldRef,q[0],q[1]+LINE_TH+6,0);let y=gb?gb.y:H+60;
    for(const h of worldRef.hazards){const lo=Math.min(h.ax,h.bx),hi=Math.max(h.ax,h.bx);if(q[0]>=lo&&q[0]<=hi&&hi>lo){const hy=h.ay+(h.by-h.ay)*(q[0]-h.ax)/(h.bx-h.ax);if(hy>q[1]&&hy<y)y=hy;}}
    return ch.shY=y;}
  // Spikes are grown only near the camera, jittered so they read as a thorn bed rather than a grid.
  function drawSpikes(ch,d){const[p,q]=[ch.p,ch.q],len=Math.hypot(q[0]-p[0],q[1]-p[1]),ux=(q[0]-p[0])/len,uy=(q[1]-p[1])/len;
    let nx=ch.nx,ny=ch.ny;if((ex-p[0])*nx+(ey-p[1])*ny<0){nx=-nx;ny=-ny;}
    const reach=380;if(d>reach+len||ink.key===NONE)return;g.fillStyle=ink.key;g.beginPath();let any=false;
    const z0=Math.floor((ez-260)/20),z1=Math.ceil((ez+260)/20);
    for(let s=0,i=0;s<len;s+=16,i++)for(let zi=z0;zi<=z1;zi++){const hs=hash(i*977+zi,ch.seed),jx=(hs-.5)*10,jz=(hash(zi*131+i,ch.seed+5)-.5)*14;
      const bx=p[0]+ux*(s+8+jx),by=p[1]+uy*(s+8+jx),bz=zi*20+jz,dd=dist2(bx,by,bz);if(dd>reach*reach)continue;
      const hgt=7+hs*6,w=3+hs*2;if(!pt(bx+nx*hgt,by+ny*hgt,bz))continue;const tx=sx1,ty=sy1;
      if(!seg(bx,by,bz-w,bx,by,bz+w))continue;g.moveTo(tx,ty);g.lineTo(sx1,sy1);g.lineTo(sx2,sy2);g.closePath();any=true;
      if(seg(bx-ux*w,by-uy*w,bz,bx+ux*w,by+uy*w,bz)){g.moveTo(tx,ty);g.lineTo(sx1,sy1);g.lineTo(sx2,sy2);g.closePath();}}   // crossed blades: a star from above, a spike from the side
    if(any){g.globalAlpha=AM*(fogOf(d)*.95);g.fill();}}

  // Ropes: drawn in their current shape. A stretched rope is a V through (cx,cy);
  // a released one wobbles toward -wobSide·normal.
  const ROPE_N=16,ropeBuf=[];
  function ropeShape(rp,out){const amp=rp.wob*Math.exp(-4*rp.wobT)*Math.cos(20*rp.wobT);
    for(let i=0;i<=ROPE_N;i++){const t=i/ROPE_N;let x,y;
      if(rp.side&&rp.depth>0){const cx=rp.cx,cy=rp.cy,ax=rp.ax,ay=rp.ay,bx=rp.bx,by=rp.by,tc=clamp(((cx-ax)*rp.tx+(cy-ay)*rp.ty)/rp.len,.02,.98);
        if(t<=tc){const k=t/tc;x=ax+(cx-ax)*k;y=ay+(cy-ay)*k;}else{const k=(t-tc)/(1-tc);x=cx+(bx-cx)*k;y=cy+(by-cy)*k;}}
      else{const s=-rp.wobSide*amp*Math.sin(Math.PI*t);x=rp.ax+(rp.bx-rp.ax)*t+rp.nx*s;y=rp.ay+(rp.by-rp.ay)*t+rp.ny*s;}
      out[i*2]=x;out[i*2+1]=y;}return out;}
  function drawRopeSeg(o,d){const{sh,i,hw}=o,x1=sh[i*2],y1=sh[i*2+1],x2=sh[i*2+2],y2=sh[i*2+3],f=fogOf(d);
    const P=o.P;P[0]=x1;P[1]=y1;P[2]=-hw;P[3]=x2;P[4]=y2;P[5]=-hw;P[6]=x2;P[7]=y2;P[8]=hw;P[9]=x1;P[10]=y1;P[11]=hw;
    fillPoly(P,ink.light,.9*f);
    if(sideMix>0&&!(i&1)&&seg(x1,y1,0,x2,y2,0)){g.globalAlpha=AM*(sideMix);g.strokeStyle=ink.key;g.lineWidth=3;g.beginPath();g.moveTo(sx1,sy1);g.lineTo(sx2,sy2);g.stroke();}
    // world-anchored dashed rails (dashed = rope, whatever the colour)
    g.globalAlpha=AM*(f);g.strokeStyle=ink.key;
    if(!(i&1))for(const zz of[-.62,0,.62]){if(seg(x1,y1,zz*hw,x2,y2,zz*hw)){g.lineWidth=clamp(1.6*(ss1+ss2)/2,.6,5);g.beginPath();g.moveTo(sx1,sy1);g.lineTo(sx2,sy2);g.stroke();}}
    if(i===0||i===ROPE_N-1){const ax=i===0?x1:x2,ay=i===0?y1:y2;// anchor posts, both sides
      for(const s of[-1,1])if(seg(ax,ay-6,s*hw,ax,ay+22,s*hw)){g.lineWidth=clamp(2.6*ss1,.8,8);g.beginPath();g.moveTo(sx1,sy1);g.lineTo(sx2,sy2);g.stroke();}}}

  // Wind: ink streaks flowing along the lane, and dotted lane edges at ±hw.
  const tmp4=[0,0,0,0];
  function drawStreak(o,d){const f=fogOf(d)*o.a*clamp((d-18)/70,0,1);if(f<.02)return;
    if(!seg(o.x1,o.y1,o.z,o.x2,o.y2,o.z))return;
    // tapered like a dry-brush stroke: fine tail, heavier head
    const vx=sx2-sx1,vy=sy2-sy1,l=Math.hypot(vx,vy)||1,w=clamp(.8*ss2,.35,2.6),nx=-vy/l*w,ny=vx/l*w;
    g.globalAlpha=AM*(f);g.fillStyle=ink.mid;g.beginPath();g.moveTo(sx1,sy1);g.lineTo(sx2+nx,sy2+ny);g.lineTo(sx2-nx,sy2-ny);g.closePath();g.fill();}
  const CHEV_UZ=[-7,-1,3,0,-7,1,-2,1,8,0,-2,-1],chevP=new Float32Array(18);
  function drawChevron(o,d){const a=o.hw*.55;for(let i=0;i<6;i++){const u=CHEV_UZ[i*2],z=CHEV_UZ[i*2+1]*a;chevP[i*3]=o.x+o.tx*u;chevP[i*3+1]=o.y+o.ty*u;chevP[i*3+2]=z;}
    const f=fogOf(d)*o.a*clamp((d-20)/60,.15,1);if(f<.02||!fillPoly(chevP,ink.mid,.9*f,mis,mis*.7))return;g.globalAlpha=AM*(f);g.fillStyle=ink.key;g.beginPath();trace(project(chevP),0,0);g.fill();}
  function drawLane(o,d){const f=fogOf(d)*.8,p=o.pts;g.globalAlpha=AM*(f);g.fillStyle=ink.mid;g.beginPath();
    for(const z of[-o.hw,o.hw])for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);
      for(let s=((o.s0%8)+8)%8;s<l;s+=8){const t=s/l;if(pt(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,z)){const rr=clamp(1.1*ss1,.4,4);g.moveTo(sx1+rr,sy1);g.arc(sx1,sy1,rr,0,TAU);}}}
    g.fill();}

  // A gravity well: a dark core with a halftone halo, rings that keep contracting into it
  // (the pull, made visible) and a dotted plumb line down to whatever is below.
  function drawWell(o,d,t,dist){const wl=o.w;if(!pt(wl.x,wl.y,0))return;const cx=sx1,cy=sy1,s=ss1,f=fogOf(d);
    for(let k=0;k<4;k++){const ph=(t*.35+k/4)%1,Rr=WELL.range*.85*(1-ph);if(Rr>dist*.8||Rr<14)continue;
      g.globalAlpha=AM*(f*Math.pow(ph,.6)*.9);g.strokeStyle=k&1?ink.mid:ink.key;g.lineWidth=clamp(2.2*s,.6,5);g.setLineDash([6*s+1,5*s+1]);g.lineDashOffset=-t*20*s;
      g.beginPath();g.arc(cx,cy,Rr*s,0,TAU);g.stroke();}
    g.setLineDash([]);
    g.globalAlpha=AM*(f);g.fillStyle=dots.light;g.beginPath();g.arc(cx,cy,34*s,0,TAU);g.fill();
    g.fillStyle=ink.mid;g.beginPath();g.arc(cx+mis,cy+mis*.7,13*s,0,TAU);g.fill();
    g.fillStyle=ink.key;g.beginPath();g.arc(cx,cy,12*s,0,TAU);g.fill();
    g.strokeStyle=ink.key;g.lineWidth=clamp(1.5*s,.6,4);g.beginPath();g.arc(cx,cy,20*s,0,TAU);g.stroke();
    const gb=groundBelow(worldRef,wl.x,wl.y+14,0),bot=gb?gb.y:H+40;g.fillStyle=ink.key;g.beginPath();
    for(let y=wl.y+22;y<bot;y+=9)if(pt(wl.x,y,0)){const rr=clamp(1.2*ss1,.4,3);g.moveTo(sx1+rr,sy1);g.arc(sx1,sy1,rr,0,TAU);}g.fill();}

  // The goal: a ring gate standing across the track (in the y–z plane) that you ride through.
  function drawGoal(o,d,t){const G=levelRef.goal,f=fogOf(d),n=40,rr=G.r;
    if(sideMix>0){g.globalAlpha=AM*(sideMix);g.strokeStyle=ink.key;g.lineWidth=3.5;g.beginPath();for(let i=0;i<=n;i++){const a=i/n*TAU;if(pt(G.x+Math.cos(a)*rr,G.y+Math.sin(a)*rr,0))i?g.lineTo(sx1,sy1):g.moveTo(sx1,sy1);}g.stroke();}
    // legs down to the ground so it stands in the world
    const gb=groundBelow(worldRef,G.x,G.y+rr*.6,0);g.globalAlpha=AM*(f);g.strokeStyle=ink.key;
    if(gb&&gb.y-G.y<220)for(const s of[-1,1]){const zx=s*rr*.72;if(seg(G.x,G.y+rr*.7,zx,G.x,gb.y,zx*1.25)){g.lineWidth=clamp(2.4*ss1,.8,7);g.beginPath();g.moveTo(sx1,sy1);g.lineTo(sx2,sy2);g.stroke();}}
    // halftone annulus between r and 1.35r
    const ring=(k,path)=>{for(let i=0;i<=n;i++){const a=i/n*TAU;if(pt(G.x,G.y+Math.sin(a)*rr*k,Math.cos(a)*rr*k)){i===0?path.moveTo(sx1,sy1):path.lineTo(sx1,sy1);}}};
    if(ahead(G.x,G.y,0,rr*1.4)){const p=new Path2D();ring(1.38,p);p.closePath();ring(1,p);p.closePath();g.fillStyle=dots.light;g.fill(p,'evenodd');}
    for(const[k,col,wid,dash]of[[1.24,ink.mid,2.2,true],[1,ink.key,5,false]]){g.strokeStyle=col;g.beginPath();let on=false,sc=0,cnt=0;
      for(let i=0;i<=n;i++){const a=i/n*TAU,a2=(i+1)/n*TAU;if(dash&&((i+Math.floor(t*6))&1))continue;
        if(seg(G.x,G.y+Math.sin(a)*rr*k,Math.cos(a)*rr*k,G.x,G.y+Math.sin(a2)*rr*k,Math.cos(a2)*rr*k)){g.moveTo(sx1,sy1);g.lineTo(sx2,sy2);sc+=ss1;cnt++;}}
      if(cnt){g.lineWidth=clamp(wid*sc/cnt,.8,18);g.lineCap='round';g.stroke();g.lineCap='butt';}}}

  // Boost pads: a mid-ink strip on the surface with key rails and chevrons sliding along a→b.
  const padP=new Float32Array(12),padC=new Float32Array(18),PAD=30;
  function onPad(b,u,z,o){o[0]=b.ax+b.tx*u;o[1]=b.ay+b.ty*u-.7;o[2]=z;return o;}
  function drawBoostPiece(o,d,t){const b=o.b,f=fogOf(d),q=[0,0,0],put=(A,i,u,z)=>{onPad(b,u,z,q);A[i*3]=q[0];A[i*3+1]=q[1];A[i*3+2]=q[2];};
    put(padP,0,o.s0,-PAD);put(padP,1,o.s1,-PAD);put(padP,2,o.s1,PAD);put(padP,3,o.s0,PAD);
    if(!fillPoly(padP,ink.mid,.55*f))return;
    g.globalAlpha=AM*(f);g.fillStyle=ink.key;g.beginPath();
    for(const z of[-PAD,PAD-2.5]){put(padP,0,o.s0,z);put(padP,1,o.s1,z);put(padP,2,o.s1,z+2.5);put(padP,3,o.s0,z+2.5);const m=project(padP);if(m)trace(m,0,0);}g.fill();
    const sp=26,off=((t*110)%sp+sp)%sp;
    for(let u=o.s0-((o.s0-off)%sp+sp)%sp+sp;u<o.s1;u+=sp){if(u<8||u>b.len-8)continue;
      for(let i=0;i<6;i++)put(padC,i,u+CHEV_UZ[i*2]*.8,CHEV_UZ[i*2+1]*PAD*.5);const fc=f*clamp((d-12)/45,.2,1);
      if(fillPoly(padC,ink.mid,fc,mis,mis*.7)){g.globalAlpha=AM*(fc);g.fillStyle=ink.key;g.beginPath();trace(project(padC),0,0);g.fill();}}}

  // Ink drops: a floating teardrop of key ink (bigger = worth more) with a mid plate out of register,
  // a shadow and dotted plumb line to the surface below, then a mid-ink splash and a rising "+25".
  const STENCIL='"Big Shoulders Stencil Display",ui-monospace,Menlo,monospace';
  function tear(cx,cy,r){const th=.94;g.beginPath();g.moveTo(cx,cy-1.7*r);g.lineTo(cx+r*Math.sin(th),cy-r*Math.cos(th));g.arc(cx,cy,r,-Math.PI/2+th,Math.PI*1.5-th);g.closePath();}
  function drawDrop(o,d,t){const dp=o.dp,f=fogOf(d),size=dp.v>=40?8.5:dp.v>=25?6.5:5;
    if(!dp.got){const y=dp.y+Math.sin(t*2.4+o.i*1.7)*2.5,gb=groundBelow(worldRef,dp.x,y,dp.z);
      if(gb){const P=[];for(let i=0;i<10;i++){const a=i/10*TAU;P.push(dp.x+Math.cos(a)*size*.9,gb.y-.5,dp.z+Math.sin(a)*size*.9);}fillPoly(P,ink.key,.3*f);
        if(gb.y-y>18){g.globalAlpha=AM*(.5*f);g.fillStyle=ink.key;g.beginPath();for(let yy=y+size+4;yy<gb.y-3;yy+=7)if(pt(dp.x,yy,dp.z)){const rr=clamp(.9*ss1,.4,2.2);g.moveTo(sx1+rr,sy1);g.arc(sx1,sy1,rr,0,TAU);}g.fill();}}
      if(!pt(dp.x,y,dp.z))return;
      // Cap the on-screen size and fade a drop that's right in your face, so it never hides the path ahead.
      const rRaw=Math.max(1.2,size*ss1*.8),r=Math.min(rRaw,20),near=clamp(1-(rRaw-20)/28,.22,1),cx=sx1,cy=sy1;
      g.globalAlpha=AM*f*near;g.fillStyle=ink.mid;tear(cx+mis*1.2,cy+mis*.8,r);g.fill();g.fillStyle=ink.key;tear(cx,cy,r);g.fill();
      if(dp.v>=40){g.strokeStyle=ink.key;g.lineWidth=clamp(.8*ss1,.6,2.5);g.setLineDash([3,3]);g.beginPath();g.arc(cx,cy-r*.3,r*2.1,0,TAU);g.stroke();g.setLineDash([]);}
      return;}
    const e=(worldRef.t-dp.gotT);if(e<0||e>1)return;
    // collected right under you in first person: lift the splash and number above the ball hint
    const vis=pt(dp.x,dp.y,dp.z),cx=vis?clamp(sx1,40,W-40):CX,cy=vis?Math.min(sy1,H*.7):H*.62,s=vis?Math.min(ss1,14):10;
    if(e<.55){const k=e/.55;g.globalAlpha=AM*(1-k);g.fillStyle=ink.mid;g.beginPath();
      for(let i=0;i<8;i++){const a=i/8*TAU+o.i,rr=(4+k*26)*s*.6*(.7+.6*hash(i,o.i)),x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr*.8+k*k*10*s*.3,dr=Math.max(.6,(2.4-1.6*k)*s*.35);g.moveTo(x+dr,y);g.arc(x,y,dr,0,TAU);}g.fill();}
    const k=e,size2=clamp(13*s*.5,13,34),y=cy-8-k*44;g.globalAlpha=AM*(clamp(1.4-k*1.4,0,1));g.font=`800 ${size2.toFixed(1)}px ${STENCIL}`;g.textAlign='center';g.textBaseline='middle';
    g.fillStyle=ink.mid;g.fillText('+'+dp.v,cx+1.6,y+1.2);g.fillStyle=ink.key;g.fillText('+'+dp.v,cx,y);g.textAlign='left';}

  // collected drops: splash and number drawn over the world (never hidden behind a surface)
  function drawDropFx(world,t){(world.drops||[]).forEach((dp,i)=>{if(dp.got&&world.t-dp.gotT<=1)drawDrop({dp,i},0,t);});}

  // ---------- per-frame ----------
  function setCamera(world,S,dt,t){const r=world.rider,set=S.settings||{},rm=!!set.reducedMotion,chase=!!set.chase;
    // heading: the smoothed sign of vx; a sustained reversal becomes a quick turn-around
    if(Math.abs(r.vx)>25&&Math.sign(r.vx)!==heading){flipT+=dt;if(flipT>.12){heading=-heading;flipT=0;}}else flipT=0;
    const yawT=heading>0?0:Math.PI;yaw+=(yawT-yaw)*ease(rm?6:10,dt);
    // pitch: follow the velocity angle a little; tilt down while falling to show the landing
    const hv=Math.max(80,Math.abs(r.vx));let pt0=P0+.28*Math.atan2(r.vy,hv);
    lastLand=null;
    if(!r.grounded){const land=lastLand=predictLanding(world);
      if(land){// Jumping Flash: in the air, the view swings toward where you'll come down
        const ly=land.y-(r.y-17),lx=Math.abs(land.x-r.x)+22,look=Math.atan2(ly,lx),w=clamp(r.airT/.3,0,1)*(r.vy>0?.8:.6);pt0=pt0*(1-w)+look*w;}
      else if(r.vy>0)pt0+=Math.min(.42,r.vy/1000)*clamp(r.airT/.25,0,1);}
    if(r.grounded&&r.n){pt0=P0+.5*Math.atan2(r.n[0]*heading,-r.n[1]);}
    // On a narrow ribbon (tr→1 on a line, ½ on a rope) the eye drops lower and closer, looks a touch
    // further down, and rolls with the wire's sway. Roads are untouched (tr→0).
    const trT=r.grounded?(r.groundKind==='line'?1:r.groundKind==='rope'?.5:0):(r.airT<.25?tr:0);tr+=(trT-tr)*ease(4,dt);
    pt0+=.16*tr;
    pitch+=(clamp(pt0,-.5,.85)-pitch)*ease(r.grounded?6:4,dt);
    const rollMax=(set.bob?.05:.02)*(rm?.3:1),rollT=tr*heading*clamp((r.sway||0)*rollMax+clamp(r.vz/500,-1,1)*rollMax*.35,-.08,.08);roll+=(rollT-roll)*ease(6,dt);
    const edgeZ=(r.groundHw||WIDTH.line)+R*.4;danger=r.grounded&&r.groundKind==='line'?clamp((Math.abs(r.z)-.4*edgeZ)/(.55*edgeZ),0,1):0;
    dgSide=Math.sign(r.z)||1;dgX=r.x;dgY=r.y;dgHw=r.groundHw;
    const fh=Math.cos(yaw),fzh=Math.sin(yaw);
    let tx,ty,tz;
    if(chase){// sit behind along the slope you're riding, so a steep line never passes over the camera
      chA+=(clamp(Math.atan2(r.vy,Math.max(60,Math.abs(r.vx))),-.75,.75)-chA)*ease(3,dt);const bk=95-15*tr;
      tx=r.x-fh*bk*Math.cos(chA);ty=r.y-bk*Math.sin(chA)-46+10*tr;tz=r.z-fzh*bk*Math.cos(chA);
      if(!chaseInit){camX=tx;camY=ty;camZ=tz;chaseInit=true;}
      const k=ease(7,dt);camX+=(tx-camX)*k;camY+=(ty-camY)*k;camZ+=(tz-camZ)*k;ex=camX;ey=camY;ez=camZ;}
    else{chaseInit=false;const back=22-6*tr,up=17+4*tr;ex=r.x-fh*back;ey=r.y-up;ez=r.z-fzh*back;
      if(set.bob&&!rm&&r.grounded)ey+=Math.sin(r.a*1.1)*1.3;}
    if(shake>0&&!rm){ex+=(Math.random()-.5)*shake;ey+=(Math.random()-.5)*shake;}
    let th=pitch;
    if(chase){const lx=r.x+fh*40-ex,ly=r.y-6-ey,lz=r.z+fzh*40-ez;th=Math.atan2(ly,Math.hypot(lx,lz))+(pitch-P0)*.5;}
    applyPose(ex,ey,ez,yaw,th,CX/Math.tan(clamp(set.fov||90,40,130)*Math.PI/360),roll*(chase?.6:1));
    return th;}
  // Any camera: eye position, yaw (0 = looking along +x, π/2 = +z) and pitch (down is positive).
  // Roll (radians, clockwise on screen) turns the right/down axes about the view direction.
  function applyPose(x,y,z,yw,th,f,roll=0){ex=x;ey=y;ez=z;const fh=Math.cos(yw),fzh=Math.sin(yw),ct=Math.cos(th),st=Math.sin(th),cr=Math.cos(roll),sr=Math.sin(roll);
    fx=ct*fh;fy=st;fz=ct*fzh;const r0x=-fzh,r0z=fh,d0x=-st*fh,d0y=ct,d0z=-st*fzh;
    rx=r0x*cr+d0x*sr;ry=d0y*sr;rz=r0z*cr+d0z*sr;dx=-r0x*sr+d0x*cr;dy=d0y*cr;dz=-r0z*sr+d0z*cr;F=f;}

  function collect(world,t){nItems=0;const ch=geo.chunks,fr2=(FAR+distOff)*(FAR+distOff),bias=(d,b)=>{const q=Math.sqrt(d)-b;return q>0?q*q:0;};
    for(let i=0;i<ch.length;i++){const c=ch[i];
      let d;if(c.st===HAZ){const cz=clamp(ez,-600,600);d=dist2(c.cx,c.cy,cz);if(!ahead(c.cx,c.cy,cz,c.rad+700))continue;}
      else{if(!ahead(c.cx,c.cy,c.cz,c.rad))continue;d=dist2(c.cx,c.cy,c.cz);}
      if(d>fr2)continue;
      if(!c.two&&(ex-c.px)*c.nx+(ey-c.py)*c.ny+(ez-c.pz)*c.nz<=0)continue;   // back face
      const it=item();it.d=d;it.st=c.st;it.o=c;}
    world.ropes.forEach((rp,ri)=>{const buf=ropeBuf[ri]||(ropeBuf[ri]={sh:new Float64Array((ROPE_N+1)*2),segs:[]});ropeShape(rp,buf.sh);
      for(let i=0;i<ROPE_N;i++){const o=buf.segs[i]||(buf.segs[i]={P:new Float32Array(12),sh:buf.sh,i,hw:rp.hw}),mx=(buf.sh[i*2]+buf.sh[i*2+2])/2,my=(buf.sh[i*2+1]+buf.sh[i*2+3])/2;
        if(!ahead(mx,my,0,rp.hw+20))continue;const it=item();it.d=dist2(mx,my,0);it.st=ROPE;it.o=o;}});
    const o4=tmp4;geo.winds.forEach(wd=>{
      for(const s of wd.streaks){const u=((s.u+t*WIND.speed*.55*s.v)%wd.L+wd.L)%wd.L,u0=Math.max(0,u-s.len);
        along(wd,u0,o4);const nx0=-o4[3],ny0=o4[2],x1=o4[0]+nx0*s.off,y1=o4[1]+ny0*s.off;along(wd,u,o4);const x2=o4[0]-o4[3]*s.off,y2=o4[1]+o4[2]*s.off;
        const mx=(x1+x2)/2,my=(y1+y2)/2;if(!ahead(mx,my,s.z,20))continue;const d=dist2(mx,my,s.z);if(d>fr2)continue;
        const it=item();it.d=d;it.st=STREAK;it.o=s;s.x1=x1;s.y1=y1;s.x2=x2;s.y2=y2;s.a=Math.min(1,u/30,(wd.L-u)/30);}
      // boost-pad chevrons on the underside of the lane, sliding along with the flow
      const CH=40,off=WIND.radius*.75;for(let k=0;k<Math.ceil(wd.L/CH);k++){const u=((k*CH+t*70)%wd.L+wd.L)%wd.L;if(u<10||u>wd.L-10)continue;
        along(wd,u,o4);let nx=-o4[3],ny=o4[2];if(ny<0){nx=-nx;ny=-ny;}const cx=o4[0]+nx*off,cy=o4[1]+ny*off;if(!ahead(cx,cy,0,wd.hw))continue;
        const d=dist2(cx,cy,0);if(d>fr2)continue;const it=item();it.d=d;it.st=CHEV;it.o={x:cx,y:cy,tx:o4[2],ty:o4[3],hw:wd.hw,a:Math.min(1,u/40,(wd.L-u)/40)};}
      for(const ln of wd.lanes){const p=ln.pts[0],q=ln.pts[ln.pts.length-1],mx=(p[0]+q[0])/2,my=(p[1]+q[1])/2;if(!ahead(mx,my,0,wd.hw+20))continue;
        const it=item();it.d=dist2(mx,my,0);it.st=LANE;it.o={pts:ln.pts,hw:wd.hw,s0:-t*40};}});
    world.wells.forEach(w=>{if(!ahead(w.x,w.y,0,WELL.range))return;const it=item();it.d=dist2(w.x,w.y,0);it.st=WELLI;it.o={w};});
    const G=levelRef.goal;if(ahead(G.x,G.y,0,G.r*1.5)){const it=item();it.d=dist2(G.x,G.y,0);it.st=GOAL;}
    // boost pads lie on a surface: sort them just in front of it
    (world.boosts||[]).forEach(b=>{for(let s0=0;s0<b.len;s0+=20){const s1=Math.min(b.len,s0+20),mx=b.ax+b.tx*(s0+s1)/2,my=b.ay+b.ty*(s0+s1)/2;
      if(!ahead(mx,my,0,PAD+20))continue;const d=dist2(mx,my,0);if(d>fr2)continue;const it=item();it.d=bias(d,28);it.st=BOOSTP;it.o={b,s0,s1};}});
    (world.drops||[]).forEach((dp,i)=>{if(dp.got||!ahead(dp.x,dp.y,dp.z,30))return;const d=dist2(dp.x,dp.y,dp.z);if(d>fr2)return;
      const it=item();it.d=bias(d,6);it.st=DROPI;it.o={dp,i};});
    // far → near; ties keep geometry order
    const list=pool.slice(0,nItems);list.sort((a,b)=>b.d-a.d);return list;}

  // Ballistic guess at the landing spot (gravity only; wind and wells will bend it).
  function predictLanding(world){const r=world.rider;let x=r.x,y=r.y,vx=r.vx,vy=r.vy;const h=1/30;
    for(let i=0;i<50;i++){const nx=x+vx*h,ny=y+vy*h;vy+=900*h;const gb=groundBelow(world,nx,y,r.z);if(gb&&gb.y<=ny+R)return{x:nx,y:gb.y};x=nx;y=ny;if(y>H+60)return null;}
    return null;}
  // Where does the surface ahead end? Returns {x,y,hw,land:{x,y}|null} or null.
  function edgeAhead(world){const r=world.rider;if(!r.grounded||r.groundKind==='rope')return null;
    const dir=heading;let y=r.y,lastX=r.x;
    for(let d=6;d<=300;d+=6){const x=r.x+dir*d,gb=groundBelow(world,x,y-30,r.z);
      if(gb&&gb.y-y<R+46){y=gb.y-R;lastX=x;continue;}
      // confirm it's a real gap, not a seam between two pieces
      const g2=groundBelow(world,x+dir*6,y-30,r.z);if(g2&&g2.y-y<R+46){continue;}
      let lo=lastX,hi=x;for(let k=0;k<6;k++){const m=(lo+hi)/2,gm=groundBelow(world,m,y-30,r.z);if(gm&&gm.y-y<R+46)lo=m;else hi=m;}
      const ex_=lo,ey_=y+R;let land=null;
      for(let dd=10;dd<=260;dd+=8){const lx=ex_+dir*dd,gl=groundBelow(world,lx,ey_-80,r.z);if(gl&&gl.y<ey_+170){land={x:lx,y:gl.y,kind:gl.kind};break;}}
      return{x:ex_,y:ey_,dist:Math.abs(ex_-r.x),land};}
    return null;}

  function hwOfKind(k){return k==='line'?WIDTH.line:k==='rope'?WIDTH.rope:geo.hwB;}
  // Registration crosshair ⊕ — the print's own mark doubles as the "edge ahead" sign.
  function regMark(x,y,z,size,a,t){if(!pt(x,y,z))return;const s=ss1,r=size*s,cx=sx1,cy=sy1;
    g.globalAlpha=AM*(a);g.lineWidth=clamp(1.6*s,.7,4);
    for(const[col,o]of[[ink.mid,mis+.8],[ink.key,0]]){g.strokeStyle=col;g.beginPath();g.arc(cx+o,cy+o*.7,r,0,TAU);g.moveTo(cx-r*1.7+o,cy+o*.7);g.lineTo(cx+r*1.7+o,cy+o*.7);g.moveTo(cx+o,cy-r*1.7+o*.7);g.lineTo(cx+o,cy+r*1.7+o*.7);g.stroke();}}
  function band(x,y,hw,wide,col,a){const P=[x,y-.3,-hw,x+wide,y-.3,-hw,x+wide,y-.3,hw,x,y-.3,hw];fillPoly(P,col,a);}

  function drawAids(world,S,t,edge){const r=world.rider;
    // blob shadow on the surface under the rider: shrinks and fades with height
    // in first person, while grounded, the shadow sits right under the ball hint: skip it
    const gb=r.grounded&&!(S.settings&&S.settings.chase)?null:groundBelow(world,r.x,r.y,r.z);
    if(gb){const h=Math.max(0,gb.y-r.y-R),k=clamp(h/260,0,.75),rad=R*1.25*(1-k),a=.55*(1-clamp(h/320,0,.8));
      const rz_=gb.kind==='line'?Math.min(rad,WIDTH.line*LINE_VIS+1):rad;   // on a wire the shadow is only as wide as the wire
      const P=[];for(let i=0;i<14;i++){const an=i/14*TAU;P.push(r.x+Math.cos(an)*rad,gb.y-.4,r.z+Math.sin(an)*rz_);}
      fillPoly(P,ink.key,a);const m=!r.grounded&&project(P);if(m){g.globalAlpha=AM*(Math.min(1,a+.3));g.strokeStyle=ink.mid;g.lineWidth=1.4;g.beginPath();trace(m,0,0);g.stroke();}
      if(!r.grounded&&h>24){g.fillStyle=ink.key;g.globalAlpha=AM*(.7);g.beginPath();for(let y=r.y+R+4;y<gb.y-4;y+=8)if(pt(r.x,y,r.z)){const rr=clamp(ss1,.5,2.5);g.moveTo(sx1+rr,sy1);g.arc(sx1,sy1,rr,0,TAU);}g.fill();}}
    // in the air: a ring where the ballistic guess says you'll touch down
    if(lastLand&&!r.grounded&&Math.abs(lastLand.x-r.x)>14){const P=[],rad=R*1.4;for(let i=0;i<16;i++){const an=i/16*TAU;P.push(lastLand.x+Math.cos(an)*rad,lastLand.y-.5,r.z+Math.sin(an)*rad);}
      const m=project(P);if(m){g.globalAlpha=AM*(.9);g.setLineDash([3,2.5]);g.strokeStyle=ink.mid;g.lineWidth=2;g.beginPath();trace(m,0,0);g.stroke();g.setLineDash([]);}}
    // the edge ahead: a light band across the lip, a ⊕ standing over it, a thinner band where you'd land
    if(edge&&edge.dist<280){const a=clamp(1.25-edge.dist/280,.25,1),hw=r.groundHw||WIDTH.line,dir=heading;
      band(edge.x-dir*5,edge.y,hw,dir*5,ink.light,a);
      g.setLineDash([4,3]);const ok=seg(edge.x,edge.y-.5,-hw,edge.x,edge.y-.5,hw);if(ok){g.globalAlpha=AM*(a);g.strokeStyle=ink.key;g.lineWidth=clamp(1.6*ss1,.7,4);g.beginPath();g.moveTo(sx1,sy1);g.lineTo(sx2,sy2);g.stroke();}g.setLineDash([]);
      regMark(edge.x,edge.y-26,0,6,a,t);
      if(edge.land){const lh=hwOfKind(edge.land.kind);band(edge.land.x,edge.land.y,lh,dir*4,ink.light,a*.9);}}}

  // ---------- HUD: the ball, the inset side view ----------
  function drawBallFP(world){const r=world.rider,sq=squash;// sinks out of view while falling, so it never hides the landing
    const drop=!r.grounded?clamp((r.airT-.12)*4,0,1)*60:0;const cx=CX,cy=H+92-sq*6+drop,rad=118;
    const ax=rad*(1+sq*.06),ay=rad*(1-sq*.04);
    g.globalAlpha=AM*(1);g.fillStyle=ink.light;g.beginPath();g.ellipse(cx,cy,ax,ay,0,0,TAU);g.fill();
    // rolling stripes as chords of the ellipse (a clip is costly in software raster)
    g.fillStyle=ink.mid;g.beginPath();const roll=r.a*R*1.6*heading,hw=y=>{const k=1-((y-cy)/ay)**2;return k>0?ax*Math.sqrt(k):0;};
    for(let k=0;k<7;k++){const y0=cy-ay+(((roll+k*44)%308)+308)%308,y1=y0+10;if(y0>H+2||y1<cy-ay)continue;const w0=hw(y0),w1=hw(y1);if(w0<=0&&w1<=0)continue;
      g.moveTo(cx-w0,y0);g.lineTo(cx+w0,y0);g.lineTo(cx+w1,y1);g.lineTo(cx-w1,y1);g.closePath();}g.fill();
    g.globalAlpha=AM*(1);g.strokeStyle=ink.key;g.lineWidth=3;g.beginPath();g.arc(cx+mis,cy-1,rad,0,TAU);g.stroke();}
  function drawBallChase(world,a=1){const r=world.rider;if(!pt(r.x,r.y,r.z))return;const cx=sx1,cy=sy1,rad=R*ss1;
    g.globalAlpha=AM*(a);g.fillStyle=ink.light;g.beginPath();g.arc(cx,cy,rad,0,TAU);g.fill();
    g.fillStyle=ink.mid;g.beginPath();g.arc(cx,cy,rad,r.a*heading,r.a*heading+Math.PI);g.fill();
    g.strokeStyle=ink.key;g.lineWidth=clamp(rad*.16,1,4);g.beginPath();g.arc(cx+mis*.8,cy+mis*.5,rad,0,TAU);g.stroke();}

  // The inset is a small printed proof slip: square corners, a thin key rule, crop marks,
  // a typed caption, and a slight hand-placed tilt.
  const IX=W-204,IY=H-132,IS=.235,IW=W*IS,IH=H*IS,MONO='"Cutive Mono",ui-monospace,Menlo,monospace';
  // The static part of the slip (level, drawing, goal) is printed once per ride into a small
  // device-resolution canvas; ropes, crumbles, drops, the trail and the rider are drawn live.
  let insetCv=null,insetKey='';
  function insetStatic(world){const m0=g.getTransform?g.getTransform():{a:1,b:0},px=Math.hypot(m0.a,m0.b)||1,key=px.toFixed(3)+ink.key+ink.mid+ink.light;
    if(insetCv&&insetKey===key&&insetCv.world===world)return insetCv;insetKey=key;
    const M=12,c=insetCv=document.createElement('canvas');c.world=world;c.width=Math.ceil((IW+2*M)*px);c.height=Math.ceil((IH+2*M)*px);
    const x=c.getContext('2d');if(!x||!x.setTransform)return c;x.setTransform(px,0,0,px,(M-IX)*px,(M-IY)*px);
    const m=(a,b)=>[IX+a*IS,IY+b*IS],L=levelRef,poly=p=>{x.beginPath();p.forEach((q,i)=>{const[u,v]=m(q[0],q[1]);i?x.lineTo(u,v):x.moveTo(u,v);});x.closePath();};
    x.fillStyle=ink.light;x.globalAlpha=.16;x.fillRect(IX,IY,IW,IH);x.globalAlpha=1;
    x.strokeStyle=ink.key;x.lineWidth=.8;x.strokeRect(IX,IY,IW,IH);
    x.lineWidth=.6;x.beginPath();for(const[a,b,sx,sy]of[[IX,IY,-1,-1],[IX+IW,IY,1,-1],[IX,IY+IH,-1,1],[IX+IW,IY+IH,1,1]]){x.moveTo(a+sx*3,b);x.lineTo(a+sx*9,b);x.moveTo(a,b+sy*3);x.lineTo(a,b+sy*9);}x.stroke();
    x.save();x.beginPath();x.rect(IX,IY,IW,IH);x.clip();
    x.fillStyle=ink.key;x.globalAlpha=.9;for(const p of L.blocks){poly(p);x.fill();}
    x.lineWidth=.8;for(const p of L.ice||[]){poly(p);x.globalAlpha=.9;x.stroke();x.save();x.clip();x.beginPath();const xs=p.map(q=>m(q[0],q[1])[0]),ys=p.map(q=>m(q[0],q[1])[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      for(let u=x0-(y1-y0);u<x1;u+=3){x.moveTo(u,y1);x.lineTo(u+(y1-y0),y0);}x.stroke();x.restore();}
    x.globalAlpha=1;x.strokeStyle=ink.mid;x.lineWidth=1.2;for(const b of world.boosts||[]){const a=Math.atan2(b.ty,b.tx);for(let u=6;u<b.len;u+=12){const[px_,py_]=m(b.ax+b.tx*u,b.ay+b.ty*u);x.beginPath();x.moveTo(px_-Math.cos(a-.7)*3,py_-Math.sin(a-.7)*3-1);x.lineTo(px_,py_-1);x.lineTo(px_-Math.cos(a+.7)*3,py_-Math.sin(a+.7)*3-1);x.stroke();}}
    x.beginPath();for(const sg of world.hazards){const n=Math.max(2,Math.round(Math.hypot(sg.bx-sg.ax,sg.by-sg.ay)/10));for(let i=0;i<=n;i++){const[u,v]=m(sg.ax+(sg.bx-sg.ax)*i/n,sg.ay+(sg.by-sg.ay)*i/n-(i&1?4:0));i?x.lineTo(u,v):x.moveTo(u,v);}}x.stroke();
    x.strokeStyle=ink.key;x.lineWidth=1.4;x.lineCap='round';x.beginPath();for(const sg of world.segs){if(sg.kind!=='line')continue;const a=m(sg.ax,sg.ay),b=m(sg.bx,sg.by);x.moveTo(a[0],a[1]);x.lineTo(b[0],b[1]);}x.stroke();
    x.strokeStyle=ink.mid;x.setLineDash([5,3]);x.lineWidth=2.2;x.beginPath();for(const wd of world.winds)wd.pts.forEach((q,i)=>{const[u,v]=m(q[0],q[1]);i?x.lineTo(u,v):x.moveTo(u,v);});x.stroke();x.setLineDash([]);
    x.strokeStyle=ink.key;x.fillStyle=ink.key;x.lineWidth=1;for(const w of world.wells){const[u,v]=m(w.x,w.y);x.beginPath();x.arc(u,v,2.5,0,TAU);x.fill();x.beginPath();x.arc(u,v,WELL.range*IS*.4,0,TAU);x.stroke();}
    {const[u,v]=m(L.goal.x,L.goal.y);x.lineWidth=1.8;x.beginPath();x.arc(u,v,L.goal.r*IS*1.1,0,TAU);x.stroke();}
    x.restore();return c;}
  function drawInset(world,S,t,edge){const m=(x,y)=>[IX+x*IS,IY+y*IS],inBox=(x,y)=>x>IX&&x<IX+IW&&y>IY&&y<IY+IH;
    const c=insetStatic(world),M=12;
    g.save();g.translate(IX+IW/2,IY+IH/2);g.rotate(-.011);g.translate(-IX-IW/2,-IY-IH/2);
    g.globalAlpha=AM*(1);if(c.width)g.drawImage(c,IX-M,IY-M,IW+2*M,IH+2*M);
    g.fillStyle=ink.key;g.font='10px '+MONO;g.textBaseline='bottom';g.fillText(`LEVEL ${String(sheetNo(levelRef)).padStart(2,'0')}`,IX,IY-3);
    g.textAlign='right';g.fillText(`${world.t.toFixed(1)}s`,IX+IW,IY-3);g.textAlign='left';
    const L=levelRef,poly=p=>{g.beginPath();p.forEach((q,i)=>{const[x,y]=m(q[0],q[1]);i?g.lineTo(x,y):g.moveTo(x,y);});g.closePath();};
    // crumble: dashed outline, fading as it goes
    g.strokeStyle=ink.key;g.setLineDash([2,1.5]);(L.crumble||[]).forEach((p,i)=>{const cr=world.crumbles&&world.crumbles[i],k=cr?cr.k:0;if(k>=1)return;g.globalAlpha=AM*(cr&&cr.gone?.35:.95);poly(p);g.lineWidth=1;g.stroke();});
    g.globalAlpha=AM*(1);g.setLineDash([2.5,1.8]);g.lineWidth=1.4;g.beginPath();world.ropes.forEach((rp,ri)=>{const sh=ropeBuf[ri]?ropeBuf[ri].sh:ropeShape(rp,new Float64Array((ROPE_N+1)*2));for(let i=0;i<=ROPE_N;i++){const[x,y]=m(sh[i*2],sh[i*2+1]);i?g.lineTo(x,y):g.moveTo(x,y);}});g.stroke();g.setLineDash([]);
    // drops: solid until collected, then hollow
    for(const dp of world.drops||[]){const[x,y]=m(dp.x,dp.y),rr=dp.v>=40?2.8:dp.v>=25?2.3:1.8;if(!inBox(x,y))continue;g.beginPath();g.arc(x,y,rr,0,TAU);
      if(dp.got){g.strokeStyle=ink.mid;g.lineWidth=.9;g.stroke();}else{g.fillStyle=ink.key;g.fill();}}
    // your ride so far and where you are
    g.fillStyle=ink.mid;g.beginPath();const P=world.path;for(let i=Math.max(0,P.length-160);i<P.length;i+=2){const[x,y]=m(P[i][0],P[i][1]);if(!inBox(x,y))continue;g.moveTo(x+.9,y);g.arc(x,y,.9,0,TAU);}g.fill();
    if(edge){const[x,y]=m(edge.x,edge.y);g.strokeStyle=ink.mid;g.lineWidth=1.3;g.beginPath();g.moveTo(x,y-7);g.lineTo(x,y+3);g.stroke();
      if(edge.land){const[lx,ly]=m(edge.land.x,edge.land.y);g.setLineDash([2,2]);g.beginPath();g.moveTo(x,y);g.quadraticCurveTo((x+lx)/2,Math.min(y,ly)-9,lx,ly);g.stroke();g.setLineDash([]);}}
    const r=world.rider,[rx_,ry_]=m(r.x,r.y);if(inBox(rx_,ry_)){g.fillStyle=ink.mid;g.beginPath();g.arc(rx_,ry_,3.2,0,TAU);g.fill();g.strokeStyle=danger>.35?ink.mid:ink.key;g.lineWidth=danger>.35?2:1.3;g.beginPath();g.arc(rx_+.8,ry_-.6,3.2+danger*1.5,0,TAU);g.stroke();
      g.strokeStyle=ink.key;g.lineWidth=1.3;g.beginPath();g.moveTo(rx_+heading*5,ry_);g.lineTo(rx_+heading*10,ry_);g.stroke();}
    g.restore();g.globalAlpha=AM*(1);}

  const api={
    // Riso-printed ride backdrop: split-fountain sky, far plates in the level's scene
    // vocabulary, the valley far below. Registered as a Riso scene so it prints like the rest.
    printBackdrop(level,pw,ph){
      const name='ride-'+level.id,sheet=sheetNo(level);
      Riso.SCENES[name]={name:'Ride: '+level.name,after:'the level’s print, seen from inside the sheet',draw:(c,r)=>rideScene(c,r,level,sheet)};
      const seed=(level.bg.seed||1)*7+3,inks=level.bg.inks.map(n=>Riso.INKS[n]||n);
      // Printing is per-pixel JS; cap the plate at 1280 wide and enlarge (the backdrop is shown
      // at 1.25× anyway) so a new level prints in about a second, not three.
      const k=Math.min(1,1280/pw),w=Math.round(pw*k),h=Math.round(ph*k);
      const dens=Riso.renderScene(name,seed,w,h,0);
      const layers=Riso.layersFor(dens,inks,{seed,screen:'grain',mis:2.2*w/1600});
      const img=Riso.print({w,h,paper:Riso.PAPERS.Natural,layers,texture:1,seed});
      const src=document.createElement('canvas');src.width=w;src.height=h;src.getContext('2d').putImageData(img,0,0);if(k===1)return src;
      const cv=document.createElement('canvas');cv.width=pw;cv.height=ph;const x=cv.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(src,0,0,pw,ph);return cv;},

    reset(world,level,S){worldRef=world;levelRef=level;geo=buildGeometry(world,level);ropeBuf.length=0;
      heading=Math.sign(world.rider.vx)||1;yaw=heading>0?0:Math.PI;flipT=0;pitch=P0;tr=0;roll=0;danger=0;chA=0;shake=0;squash=0;evIdx=0;chaseInit=false;lastLand=null;},

    draw(gc,world,level,S,t,dt){const t0=performance.now();begin(api,gc,world,level,S);
      const set=S.settings||{},rm=!!set.reducedMotion;dt=clamp(dt||1/60,0,.05);
      for(;evIdx<world.events.length;evIdx++){const e=world.events[evIdx];
        if(e.type==='land'){shake=Math.max(shake,clamp((e.v||0)/90,0,6));squash=1;}else if(e.type==='bounce'){shake=Math.max(shake,3);squash=1;}}
      shake*=Math.exp(-9*dt);squash*=Math.exp(-7*dt);
      // misregistration: a base offset that grows with speed; a crash snaps it into clean register
      const r=world.rider,failed=world.status==='fell'||world.status==='popped'||world.status==='stuck';
      mis=failed?0:rm?1.4:1.4+clamp((r.speed-150)/140,0,1)*2.2;
      if(failed)shake=0;
      distOff=0;sideMix=0;
      const th=setCamera(world,S,dt,t);
      g.save();g.lineJoin='round';
      paintWorld(world,t);
      const edge=edgeAhead(world);
      drawAids(world,S,t,edge);drawDropFx(world,t);
      g.globalAlpha=AM*(1);
      if(set.chase)drawBallChase(world);else drawBallFP(world);
      drawInset(world,S,t,edge);
      g.restore();g.globalAlpha=AM*(1);
      stats.items=nItems;stats.ms=performance.now()-t0;
      return{bg:bgFor(th,yaw,r.z,BG_SCALE)};},

    // ---------- the swoop: from the flat side view down into the ride ----------
    transitionMs:{full:1100,quick:420},
    drawTransition(gc,world,level,S,t,p){const t0=performance.now();begin(api,gc,world,level,S);p=clamp(p,0,1);
      const set=S.settings||{},r=world.rider;
      // The pose draw() will use on its first frame, computed without disturbing its smoothing state.
      const sv=[yaw,heading,flipT,pitch,camX,camY,camZ,chaseInit,lastLand,shake,tr,roll,danger,chA];shake=0;const th1=setCamera(world,S,1/60,t);
      const E={x:ex,y:ey,z:ez,yaw,th:th1,F};[yaw,heading,flipT,pitch,camX,camY,camZ,chaseInit,lastLand,shake,tr,roll,danger,chA]=sv;
      // Channels. Dolly (distance + lens) is a confident ease-in-out; the swing starts a beat later;
      // the aim point drifts from the page centre to just ahead of the rider.
      const cub=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2,sine=x=>-(Math.cos(Math.PI*x)-1)/2;
      const e=cub(p),rot=sine(clamp((p-.08)/.84,0,1)),aim=cub(clamp(p/.72,0,1));
      const D0=12000,D1=60,yaw0=-Math.PI/2;let yaw1=E.yaw;while(yaw1-yaw0>Math.PI)yaw1-=TAU;while(yaw1-yaw0<-Math.PI)yaw1+=TAU;
      const f1=[Math.cos(E.th)*Math.cos(E.yaw),Math.sin(E.th),Math.cos(E.th)*Math.sin(E.yaw)],T1=[E.x+f1[0]*D1,E.y+f1[1]*D1,E.z+f1[2]*D1];
      const cyaw=yaw0+(yaw1-yaw0)*rot,cth=E.th*rot+.42*Math.sin(Math.PI*rot)*(1-p*.3);   // a dive: look down across the sheet mid-swoop
      const d=Math.exp(Math.log(D0)+(Math.log(D1)-Math.log(D0))*e),Fc=Math.exp(Math.log(D0)+(Math.log(E.F)-Math.log(D0))*e);
      const T=[W/2+(T1[0]-W/2)*aim,H/2+(T1[1]-H/2)*aim,T1[2]*aim],cf=[Math.cos(cth)*Math.cos(cyaw),Math.sin(cth),Math.cos(cth)*Math.sin(cyaw)];
      applyPose(T[0]-cf[0]*d,T[1]-cf[1]*d,T[2]-cf[2]*d,cyaw,cth,Fc);
      distOff=Math.max(0,d-D1);sideMix=1-clamp((p-.08)/.4,0,1);danger=0;const trSave=tr;tr=0;
      // "The paper gives way": mid-swoop the three plates separate in depth (key near, light far)
      // and print over each other, then fall back into register as the camera lands.
      const b=Math.pow(Math.sin(Math.PI*clamp((p-.1)/.72,0,1)),2);
      mis=1.4+b*(set.reducedMotion?0:5);
      // Drawn straight onto the fg canvas (an offscreen layer would force a synchronous raster).
      const a3=clamp(p/.2,0,1);AM=a3*a3*(3-2*a3);g.save();g.lineJoin='round';
      if(b>.04){const real=ink,realPat=pat,realDots=dots,T0=NONE;const am=AM;   // plain source-over (multiply blending costs ~4× the raster); slightly see-through plates read as overprint
        for(const[k,sc,ox,oy,pa]of[['light',1-.12*b,-14*b,-9*b,1],['mid',1-.06*b,10*b,6*b,1-.18*b],['key',1+.025*b,0,0,1-.1*b]]){AM=am*pa;
          ink={light:T0,mid:T0,key:T0,[k]:real[k]};pat={light:T0,lightDense:T0,mid:T0,key:T0,[k]:realPat[k]};if(k==='light')pat.lightDense=realPat.lightDense;dots=k==='light'?realDots:{light:T0};
          g.save();g.translate(CX+ox,CY+oy);g.scale(sc,sc);g.translate(-CX,-CY);paintWorld(world,t);g.restore();}
        ink=real;pat=realPat;dots=realDots;AM=am;}
      else paintWorld(world,t);
      // the rider: a 3D ball that hands over to the first-person hint (or stays, for the chase camera)
      const hud=clamp((p-.8)/.2,0,1),ballA=set.chase?1:1-clamp((p-.5)/.3,0,1);
      if(ballA>0)drawBallChase(world,ballA);
      if(hud>0){AM=hud;const edge=edgeAhead(world);lastLand=null;drawAids(world,S,t,edge);drawDropFx(world,t);if(!set.chase)drawBallFP(world);drawInset(world,S,t,edge);}
      g.restore();AM=1;
      g=gc;distOff=0;sideMix=0;mis=1.4;tr=trSave;
      stats.items=nItems;stats.ms=performance.now()-t0;
      const bgS=BG_SCALE+(1.7-BG_SCALE)*(1-e);
      return{bg:bgFor(cth,cyaw,r.z*aim,bgS,E.F),sideAlpha:1-clamp((p-.03)/.27,0,1),rideBgAlpha:clamp((p-.22)/.45,0,1)};},
    stats};
  function begin(api,gc,world,level,S){if(worldRef!==world||levelRef!==level)api.reset(world,level,S);
    g=gc;ink=S.ink;tNow=world.t;
    dots=api.patMode==='app'&&S.pat?S.pat:ridePatterns(gc,ink);pat=api.patMode==='app'||api.patMode==='dots'?dots:tints(ink);
    if(api.smooth!=null)gc.imageSmoothingEnabled=api.smooth;}
  // Halftone patterns built at device resolution and mapped 1:1 to device pixels (no resampling):
  // the app's design-unit patterns get scaled by the canvas transform, which made pattern fills
  // the most expensive thing on screen.
  let patKey='',ownPat=null,dots=null,tintKey='',tintSet=null;
  // Large shaded faces (walls, undersides, the hazard floor) use flat tints at the dots' average
  // coverage: halftone pattern fills cost ~6× a flat fill per pixel in software raster. Dots stay
  // on small deliberate marks (goal ring, well halo).
  const rgba=(h,a)=>{const n=parseInt(h.slice(1),16);return`rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;};
  function tints(ink){const k=ink.light+ink.mid+ink.key;if(k!==tintKey){tintKey=k;tintSet={light:rgba(ink.light,.24),lightDense:rgba(ink.light,.34),mid:rgba(ink.mid,.3),key:rgba(ink.key,.36)};}return tintSet;}
  function ridePatterns(gc,ink){const m=gc.getTransform?gc.getTransform():{a:1,b:0},px=Math.hypot(m.a,m.b)||1,key=ink.light+ink.mid+ink.key+px.toFixed(3);
    if(key===patKey&&ownPat)return ownPat;patKey=key;
    const mk=(col,step,rad)=>{const T=Math.max(2,Math.round(step*px))*2,c=document.createElement('canvas');c.width=c.height=T;const x=c.getContext('2d');x.fillStyle=col;
      for(const[a,b]of[[T/4,T/4],[3*T/4,3*T/4]]){x.beginPath();x.arc(a,b,rad*px,0,TAU);x.fill();}
      const p=gc.createPattern(c,'repeat');if(p&&p.setTransform&&typeof DOMMatrix!=='undefined')p.setTransform(new DOMMatrix([1/px,0,0,1/px,0,0]));return p||col;};
    return ownPat={light:mk(ink.light,7,1.9),lightDense:mk(ink.light,6,2.4),mid:mk(ink.mid,6,1.7),key:mk(ink.key,5,1.6)};}
  function paintWorld(world,t){const list=collect(world,t);
    for(const it of list){const dr=Math.sqrt(it.d),d=Math.max(0,dr-distOff);switch(it.st){   // it.d is squared (for sorting)
      case ROPE:drawRopeSeg(it.o,d);break;
      case STREAK:drawStreak(it.o,d);break;
      case LANE:drawLane(it.o,d);break;
      case CHEV:drawChevron(it.o,d);break;
      case WELLI:drawWell(it.o,d,t,dr);break;
      case GOAL:drawGoal(it.o,d,t);break;
      case BOOSTP:drawBoostPiece(it.o,d,t);break;
      case DROPI:drawDrop(it.o,d,t);break;
      default:drawChunk(it.o,d);}}}
  // Backdrop: pitch moves the horizon, yaw slides it (a turn-around, the swoop), soft-clamped to the margin.
  function bgFor(th,yw,z,scale,fr=F){const marginY=H*(scale-1)/2,marginX=W*(scale-1)/2;
    return{rot:-roll*180/Math.PI,x:marginX*.8*Math.tanh((-Math.sin(yw)*120-z*(.06+.9*tr))/marginX),y:marginY*Math.tanh((-(Math.tan(clamp(th,-1.2,1.2))-Math.tan(P0))*fr)/marginY),scale};}
  return api;}
