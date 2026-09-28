// node tools/tests/edges.mjs — physics edge cases. Exits non-zero on failure.
import * as P from '../../src/physics.js';

const base=(o)=>({id:'t',name:'t',tools:[],ink:1e4,par:[0,0],start:{x:30,y:91,vx:160},goal:{x:-500,y:-500,r:1},blocks:[],hazards:[],...o});
let bad=0;const ok=(name,cond,info='')=>{console.log(`${cond?'PASS':'FAIL'}  ${name}${info?'  ('+info+')':''}`);if(!cond)bad++;};
const finite=w=>{const r=w.rider;return[r.x,r.y,r.z,r.vx,r.vy,r.vz].every(Number.isFinite);};
function ride(L,items,pol,T=6,watch){const w=P.build(L,items);let maxV=0,allFinite=true;
  while(w.status==='run'&&w.t<T){P.step(w,L,pol(w));maxV=Math.max(maxV,w.rider.speed);if(!finite(w))allFinite=false;if(watch)watch(w);}
  return{w,maxV,allFinite};}
const none=()=>P.NO_INPUT;

// 1. Jumping off a rope: press jump while stretching it.
{const L=base({start:{x:200,y:300,vx:40},blocks:[],hazards:[[[0,486],[800,486]]]});
  let pressed=false,maxUp=0;
  const {w,allFinite}=ride(L,[{type:'rope',a:[120,400],b:[300,400]}],w=>{const r=w.rider;let jump=false;
    if(r.groundKind==='rope'&&r.grounded&&!pressed&&r.vy<50){pressed=true;jump=true;}return{steer:0,jump,jumpHeld:true,push:0};},4,w=>{maxUp=Math.min(maxUp,w.rider.vy);});
  const jumped=w.events.some(e=>e.type==='jump');
  ok('jump off a rope',allFinite&&jumped&&maxUp<-400&&maxUp>-1500,`jump=${jumped} peak vy=${maxUp.toFixed(0)}`);}

// 2. Landing exactly on a line's end.
for(const dx of [-3,0,3,8]){const L=base({start:{x:300+dx,y:200,vx:0},hazards:[]});
  const {w,maxV,allFinite}=ride(L,[{type:'line',pts:[[200,300],[300,300]]}],none,4);
  ok(`land on a line end (dx ${dx})`,allFinite&&maxV<Math.sqrt(2*P.G*(P.H+60-200))+30&&(dx>0||w.rider.y<300),`status=${w.status} maxV=${maxV.toFixed(0)} x=${w.rider.x.toFixed(0)}`);}

// 3. Riding into a wall: the wall contact is not ground, so you can't jump off it.
{let wallTouch=0,groundedAtWall=0;
  const L2=base({start:{x:380,y:200,vx:200,vy:-50},blocks:[[[400,100],[420,100],[420,500],[400,500]]]});
  const res=ride(L2,[],w=>({steer:0,jump:true,jumpHeld:false,push:0}),.8,w=>{const r=w.rider;if(Math.abs(r.x-391)<1.5){wallTouch++;if(r.grounded)groundedAtWall++;}});
  ok('walls are not ground',res.allFinite&&wallTouch>0&&groundedAtWall===0&&!res.w.events.some(e=>e.type==='jump'),`wall frames=${wallTouch} grounded there=${groundedAtWall}`);}

// 4. Winds while airborne carry you along the stroke.
{const L=base({start:{x:100,y:100,vx:100},hazards:[[[0,486],[800,486]]]});
  const {w,allFinite}=ride(L,[{type:'wind',pts:[[140,200],[400,200],[600,120]]}],none,3);
  const inWind=w.path.filter(p=>p[3]===P.STATE.wind).length;
  ok('wind while airborne',allFinite&&inWind>10&&w.rider.x>450,`wind samples=${inWind} x=${w.rider.x.toFixed(0)} status=${w.status}`);}

// 5. Steering off the side of a tightrope over spikes: a clean 'fell' close to where you left.
{const L=base({start:{x:30,y:191,vx:160},blocks:[[[0,200],[90,200],[90,222],[0,222]]],hazards:[[[0,486],[800,486]]]});
  let leftAt=null;
  const {w,allFinite}=ride(L,[{type:'line',pts:[[88,203],[742,343]]}],w=>({steer:w.rider.x>250?1:0,jump:false,jumpHeld:false,push:0}),8,
    w=>{if(leftAt===null&&w.rider.offSide)leftAt=w.rider.x;});
  const e=w.events.find(e=>e.type==='fell');
  ok('steer off the side -> fell',allFinite&&w.status==='fell'&&leftAt!==null&&e&&e.y<486,`status=${w.status} left at x=${leftAt&&leftAt.toFixed(0)} ended at (${w.rider.x.toFixed(0)},${w.rider.y.toFixed(0)}) t=${w.t.toFixed(2)}`);}

// 6. Steer off, then steer back while below the line: you keep falling (no pop back up).
{const L=base({start:{x:30,y:191,vx:160},blocks:[[[0,200],[90,200],[90,222],[0,222]]],hazards:[[[0,486],[800,486]]]});
  let minYAfter=1e9,offY=null;
  const {w,allFinite}=ride(L,[{type:'line',pts:[[88,203],[742,343]]}],w=>{const r=w.rider;return{steer:r.x<250?0:r.offSide?-1:1,jump:false,jumpHeld:false,push:0};},8,
    w=>{if(w.rider.offSide){if(offY===null)offY=w.rider.y;minYAfter=Math.min(minYAfter,w.rider.y-offY);}});
  ok('no pop back onto a line you fell past',allFinite&&w.status==='fell'&&minYAfter>-3,`status=${w.status} rise after leaving=${(-minYAfter).toFixed(1)}`);}

// 7. Two drawn lines crossing: no NaNs, no explosions.
for(const [a,b] of [[[[100,150],[500,350]],[[100,350],[500,150]]],[[[100,100],[500,300]],[[300,100],[300,400]]],[[[100,200],[400,300]],[[250,240],[600,240]]]]){
  const L=base({start:{x:110,y:120,vx:120},hazards:[]});
  const {w,maxV,allFinite}=ride(L,[{type:'line',pts:a},{type:'line',pts:b}],none,6);
  const bound=Math.hypot(120,Math.sqrt(2*P.G*(P.H+60-100)))+60;
  ok('crossing lines',allFinite&&maxV<bound,`status=${w.status} maxV=${maxV.toFixed(0)}`);}

// 8. Degenerate items: zero-length line, rope, wind; well on the rider.
{const L=base({start:{x:100,y:100,vx:50}});
  const {w,allFinite}=ride(L,[{type:'line',pts:[[100,120],[100,120]]},{type:'line',pts:[[50,150]]},{type:'rope',a:[100,200],b:[100,200]},{type:'wind',pts:[[100,110],[100,110]]},{type:'well',x:100,y:100}],none,3);
  ok('degenerate items',allFinite,`status=${w.status}`);}

// 9. The autopilot never jumps a gap a passive rider would roll across fine.
{const L=base({start:{x:30,y:91,vx:200},goal:{x:600,y:280,r:26},blocks:[[[0,100],[150,100],[150,122],[0,122]],[[400,290],[800,290],[800,312],[400,312]]],hazards:[[[0,486],[800,486]]]});
  const items=[{type:'line',pts:[[150,104],[300,200],[402,292]]}];
  const a=P.simulate(L,items,{policy:'auto'}),n=P.simulate(L,items,{policy:'none'});
  ok('autopilot leaves a passive win alone',a.status==='win'&&n.status==='win'&&a.jumps===0,`auto=${a.status}/${a.jumps} jumps none=${n.status}`);}

// ---------- round A mechanics ----------
// 10. Crumble mid-ride: stop on a crumbling block; it goes, you fall through cleanly.
{const L=base({start:{x:200,y:291,vx:0},crumble:[[[100,300],[400,300],[400,322],[100,322]]],hazards:[[[0,486],[800,486]]]});
  let fellThrough=false;
  const {w,allFinite}=ride(L,[],none,3,w=>{if(w.crumbles[0].gone&&w.rider.y>330)fellThrough=true;});
  const c=w.crumbles[0],ev=w.events.find(e=>e.type==='crumble');
  ok('crumble mid-ride',allFinite&&c.gone&&c.k===1&&ev&&Math.abs(ev.t-P.CRUMBLE.delay)<.1&&fellThrough&&w.status==='popped'&&!P.groundBelow(w,200,280,0),
    `gone at ${ev&&ev.t.toFixed(2)}s status=${w.status}`);}
// 11. Boost into a wall: fast, but no tunnelling or explosion.
{const L=base({start:{x:30,y:291,vx:100},blocks:[[[0,300],[500,300],[500,322],[0,322]],[[400,150],[420,150],[420,300],[400,300]]],boosts:[{a:[100,300],b:[390,300]}]});
  let maxX=0;const {w,maxV,allFinite}=ride(L,[],none,4,w=>{maxX=Math.max(maxX,w.rider.x);});
  const b=w.events.filter(e=>e.type==='boost').length;
  ok('boost into a wall',allFinite&&b===1&&maxX<400&&maxV<P.BOOST.speed+60,`boost events=${b} maxX=${maxX.toFixed(1)} maxV=${maxV.toFixed(0)} status=${w.status}`);}
// 12. Ice steering: steering barely bites, but what you commit to sticks (no centring, no push).
{const flat=(kind)=>base({start:{x:30,y:291,vx:150},blocks:kind==='ice'?[]:[[[0,300],[800,300],[800,322],[0,322]]],ice:kind==='ice'?[[[0,300],[800,300],[800,322],[0,322]]]:[]});
  const steer=w=>({steer:w.t<.5?1:0,jump:false,jumpHeld:false,push:1});
  const zAt=(kind,t)=>{let z=0;ride(flat(kind),[],steer,t,w=>{z=w.rider.z;});return z;};
  const zi=zAt('ice',.5),zb=zAt('block',.5),zi2=zAt('ice',1.5),zb2=zAt('block',1.5);
  const a=ride(flat('ice'),[],steer,1.5),c=ride(flat('ice'),[],none,1.5);
  ok('ice steering',a.allFinite&&a.w.rider.surface==='ice'&&zi>0&&zi<zb*.4&&zi2>zi&&zb2<zb&&a.w.rider.vx<=150.5&&Math.abs(c.w.rider.vx-150)<1,
    `after 0.5s steer: ice z ${zi.toFixed(1)} vs road ${zb.toFixed(1)}; 1s later ice ${zi2.toFixed(1)} (keeps drifting), road ${zb2.toFixed(1)} (recentres); ice vx ${a.w.rider.vx.toFixed(1)} with push held`);}
// 13. Drops at the edge of the z window: |dz| < DROP.hz collects, beyond doesn't.
{const hz=P.DROP.hz;const L=base({start:{x:30,y:291,vx:200},blocks:[[[0,300],[800,300],[800,322],[0,322]]],
    drops:[{x:150,y:290,z:hz-.5,v:15},{x:250,y:290,z:-(hz-.5),v:25},{x:350,y:290,z:hz+.5,v:40},{x:450,y:305+P.DROP.r,z:0,v:15}]});
  const {w}=ride(L,[],none,2.5);const got=w.drops.map(d=>d.got?1:0).join('');
  ok('drops at the z window edge',got==='1100'&&w.refund===40&&w.events.filter(e=>e.type==='drop').length===2,`got ${got} refund ${w.refund}`);}
// 14. Stars with refund: the 2-argument call is unchanged.
{const L={par:[100,200]};ok('stars with refund',P.stars(L,150)===2&&P.stars(L,150,50)===3&&P.stars(L,90,500)===3&&P.stars(L,250,40)===1&&P.stars(L,250,60)===2,'');}

// ---------- slings (contract v4) ----------
const evs=(w,t)=>w.events.filter(e=>e.type===t);
// 15. Entering from each side: passing below the centre turns one way, above the other; release heads along `a`.
// (start vy −300 makes the ballistic path pass the sling's height at x=300)
for(const [label,y0] of [['below the centre (ccw)',220],['above the centre (cw)',180]]){
  const a=-Math.PI/3,L=base({start:{x:100,y:y0,vx:300,vy:-300},hazards:[]});let dir=0,outV=null;
  const {w,allFinite}=ride(L,[{type:'sling',x:300,y:200,a}],none,1.2,w=>{if(w.rider.sling>=0)dir=w.rider.slingDir;const o=evs(w,'slingOut')[0];if(o&&!outV)outV=[w.rider.vx,w.rider.vy];});
  const ang=outV?Math.atan2(outV[1],outV[0]):NaN;
  ok(`sling entry ${label}`,allFinite&&evs(w,'sling').length>=1&&outV&&Math.abs(ang-a)<.2&&dir===(y0>200?-1:1),`dir ${dir} release angle ${ang.toFixed(2)} (aim ${a.toFixed(2)})`);}
// 16. Slow entry: orbit speed is lifted to minSpeed, release = minSpeed·boost.
{const L=base({start:{x:260,y:120,vx:0},hazards:[]});let v=null;
  const {w,allFinite}=ride(L,[{type:'sling',x:262,y:160,a:0}],none,1.5,w=>{const o=evs(w,'slingOut')[0];if(o&&v==null)v=o.v;});
  ok('sling slow entry',allFinite&&v!=null&&Math.abs(v-P.SLING.launch)<1,`release v ${v&&v.toFixed(0)} (want the fixed launch ${P.SLING.launch})`);}
// 17. Capture while grounded: rolling along a road into a sling just above it.
{const L=base({start:{x:30,y:291,vx:200},blocks:[[[0,300],[800,300],[800,322],[0,322]]]});
  const {w,allFinite}=ride(L,[{type:'sling',x:180,y:280,a:-Math.PI/2.5}],none,2);
  const up=Math.min(...w.path.map(p=>p[1]));
  ok('sling capture while grounded',allFinite&&evs(w,'sling').length>=1&&evs(w,'slingOut').length>=1&&up<250,`captures ${evs(w,'sling').length}, highest y ${up.toFixed(0)}`);}
// 18. Re-capture cooldown: released inside the ring, not re-caught for SLING.cooldown; aimed straight up it
// catches you again only after you fall back through it.
{const L=base({start:{x:100,y:200,vx:300,vy:-300},hazards:[]});
  let early=0;const {w,allFinite}=ride(L,[{type:'sling',x:300,y:200,a:-Math.PI/2}],none,3,w=>{const o=evs(w,'slingOut')[0];if(o&&w.t-o.t<P.SLING.cooldown&&w.rider.sling>=0)early++;});
  const cap=evs(w,'sling'),out=evs(w,'slingOut'),gap=cap.length>1?cap[1].t-out[0].t:null;
  ok('sling re-capture cooldown',allFinite&&early===0&&cap.length>=2&&gap>=P.SLING.cooldown,`captures ${cap.length}, second catch ${gap&&gap.toFixed(2)} s after release`);}
// 19. Sling near a wall: the orbit crosses the wall (collisions skipped); no NaNs, no explosion, clean outcome.
{const L=base({start:{x:100,y:190,vx:300,vy:-300},blocks:[[[320,100],[340,100],[340,400],[320,400]]],hazards:[[[0,486],[800,486]]]});
  const {w,maxV,allFinite}=ride(L,[{type:'sling',x:310,y:200,a:-Math.PI/4}],none,8);
  ok('sling near a wall',allFinite&&maxV<=Math.hypot(P.SLING.maxSpeed,Math.sqrt(2*P.G*(P.H+60)))&&w.status!=='run'&&evs(w,'sling').length<=P.SLING.maxCatches,`status ${w.status} maxV ${maxV.toFixed(0)}`);}
// 20. A drop on the orbit circle is collected while orbiting.
{const L=base({start:{x:100,y:200,vx:300,vy:-300},hazards:[],drops:[{x:300,y:200-P.SLING.ro,z:0,v:25}]});
  let gotInOrbit=false;const {w}=ride(L,[{type:'sling',x:300,y:200,a:Math.PI}],none,1.5,w=>{if(w.drops[0].got&&w.rider.sling>=0&&!gotInOrbit)gotInOrbit=true;});
  ok('drop collected during an orbit',gotInOrbit&&w.refund===25,`got in orbit ${gotInOrbit}`);}
// 22. Aimed straight down and straight up: never loops forever. Each sling catches at most maxCatches
// times, and the ride always ends (no 45 s timeout).
for(const [label,a,floor] of [['straight down',Math.PI/2,true],['straight up',-Math.PI/2,false],['down onto a road',Math.PI/2,true]]){
  const L=base({start:{x:100,y:200,vx:300,vy:-300},blocks:label==='down onto a road'?[[[0,300],[800,300],[800,322],[0,322]]]:[],hazards:floor&&label!=='down onto a road'?[[[0,486],[800,486]]]:[]});
  const {w,allFinite}=ride(L,[{type:'sling',x:300,y:200,a}],none,44);
  const caps=evs(w,'sling').length;
  ok(`sling aimed ${label}`,allFinite&&caps<=P.SLING.maxCatches&&w.status!=='run'&&w.t<20,`catches ${caps}, ${w.status} at ${w.t.toFixed(1)} s`);}
// 21. Autopilot gives no input while orbiting.
{const L=base({start:{x:100,y:200,vx:300,vy:-300},hazards:[]});const w=P.build(L,[{type:'sling',x:300,y:200,a:0}]);let bad=0;
  while(w.t<1&&w.status==="run"){P.step(w,L,P.autopilot(w,L));if(w.rider.sling>=0){const i=P.autopilot(w,L,{drops:true});if(i.steer||i.jump||i.push)bad++;}}
  ok('autopilot idle while orbiting',bad===0,'');}


// Contacts never launch: a line wedged against a ledge under the rider used to fire it off at ~2200/s.
{const L=base({start:{x:30,y:271,vx:150},blocks:[[[0,280],[90,280],[90,302],[0,302]]],hazards:[[[0,486],[800,486]]]});
  const {maxV,allFinite}=ride(L,[{type:'line',pts:[[22,274],[106,257]]}],none,3);
  ok('a wedged line does not launch the rider',allFinite&&maxV<Math.sqrt(150*150+2*P.G*(P.H+60-261))+40,`maxV=${maxV.toFixed(0)}`);}



// A sling tucked against a ledge must not release the rider inside the rock (it used to stall there until timeout).
{const L=base({start:{x:30,y:151,vx:150},blocks:[[[0,160],[130,160],[130,182],[0,182]]],hazards:[[[0,486],[800,486]]]});
  const {w}=ride(L,[{type:'sling',x:140,y:190,a:-0.63}],none,8);
  ok('sling against a ledge releases into open air',w.status!=='run'&&w.t<6&&w.events.some(e=>e.type==='slingOut'),`status=${w.status} t=${w.t.toFixed(1)}`);}

console.log(bad?`\n${bad} edge case(s) failed`:'\nall edge cases pass');
process.exit(bad?1:0);
