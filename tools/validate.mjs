// node tools/validate.mjs             check every level + difficulty report; exits non-zero on failure
// node tools/validate.mjs --search N  random-search N placements per level (default 4000): how many
//                                     win, and the cheapest wins (for setting par)
// options:  --level <id>   only that level      --quick   skip the difficulty report     --maps  print sling/well win maps
//           --density N    placements for solution density (default 600)
//           --clumsy N     clumsy-rider runs per assist level (default 50)
//
// Checks per level (these FAIL):
//   (a) an empty drawing fails under the 'auto' policy (the autopilot, standing in for a decent human)
//   (b) every entry in `solutions` wins under 'auto'
//   (c) every solution's ink cost is within level.ink, and par is sane (par[0] ≤ par[1] ≤ ink)
// Reported for information: the 'none' policy (never touch the keys).
//
// Difficulty report (these only WARN). Two separate axes:
//   puzzle = how hard the build is:  0.7·density term + 0.3·ink tightness
//            density = % of random placements (same sampler as --search) that win under 'auto';
//            the term maps 100% → 0, 10% → .33, 1% → .67, ≤0.1% → 1.
//            tightness = cheapest win found ÷ ink budget.
//   ride   = how hard it is to execute: 1 − win rate of a deliberately clumsy rider on the first
//            solution at assist 0 (slow noisy steering, jump presses jittered ±100 ms).
//   score  = 5·(puzzle + ride), 0..10.
// The curve should be a sawtooth: the score rises level to level, and dips on a level that brings
// in a new tool. Level 1 should be near-trivial on both axes, and no level should spike both.
import * as P from '../src/physics.js';
import {LEVELS} from '../src/levels.js';
import {clumsyRider,humanRider} from './tests/fairness.mjs';
import {DEV_LEVELS} from '../src/levels.js';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';

const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(k);return i<0?d:(args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true);};
function rng(seed){let s=(seed*2654435761>>>0)||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}

// ---------- random placements (shared by --search and the density measure) ----------
// Half the strokes start (and some end) near a block corner, like a player hooking a line onto a ledge.
const rint=(r,a,b)=>a+Math.floor(r()*(b-a+1));
const anchorsOf=L=>L._anchors||(L._anchors=L.blocks.flat().filter(([x])=>x>0&&x<800));
const nearAnchor=(L,r)=>{const a=anchorsOf(L)[Math.floor(r()*anchorsOf(L).length)];return[Math.max(0,Math.min(800,a[0]+rint(r,-20,20))),Math.max(0,a[1]+rint(r,-25,10))];};
export function sample(L,r){const tools=L.tools,k=r()<.6?1:r()<.85?2:3,items=[];
  for(let i=0;i<k;i++){const t=tools[Math.floor(r()*tools.length)];
    if(t==='well'){let x,y;do{x=rint(r,20,780);y=rint(r,20,480);}while(Math.hypot(x-L.goal.x,y-L.goal.y)<P.WELL.keepOut);items.push({type:'well',x,y});continue;}
    // Slings: half aimed roughly at the goal (±0.5 rad), like a player would, half anywhere.
    if(t==='sling'){const x=rint(r,20,780),y=rint(r,20,480),a=r()<.5?Math.atan2(L.goal.y-y,L.goal.x-x)+(r()-.5):(r()*2-1)*Math.PI;items.push({type:'sling',x,y,a:Math.round(a*100)/100});continue;}
    if(t==='rope'){const x=rint(r,0,760),y=rint(r,40,480),l=rint(r,40,260),a=(r()-.5)*1.4;items.push({type:'rope',a:[x,y],b:[Math.round(x+Math.cos(a)*l),Math.round(y+Math.sin(a)*l)]});continue;}
    const n=rint(r,2,3),pts=[r()<.5?nearAnchor(L,r):[rint(r,0,760),rint(r,20,480)]];
    for(let j=1;j<n;j++){const p=pts[j-1];pts.push([Math.min(800,p[0]+rint(r,30,300)),Math.max(0,Math.min(490,p[1]+rint(r,t==='wind'?-260:-120,t==='wind'?120:220)))]);}
    if(t==='line'&&r()<.3){const e=nearAnchor(L,r);if(e[0]>pts[0][0]+20)pts[n-1]=e;}
    items.push({type:t,pts});}
  return items;}
// N affordable placements; returns the wins sorted by cost.
// 3★ par may be at most PAR_RATIO × the cheapest solution found, when that cheapest is under PAR_CHEAP ink.
// (Above 200 ink the cheapest is usually a long, well-tuned stroke, and 1.6× would be meaninglessly loose.)
const PAR_RATIO=1.6,PAR_CHEAP=200;
export function search(L,N,seed=12345,maxT=15){const r=rng(seed),wins=[];let tried=0,guard=0;
  while(tried<N&&guard++<N*50){const items=sample(L,r),cost=P.inkUsed(items);if(cost>L.ink)continue;tried++;
    const res=P.simulate(L,items,{policy:'auto',maxT});if(res.status==='win')wins.push({cost:Math.round(cost),items,jumps:res.jumps});}
  return{tried,wins:wins.sort((a,b)=>a.cost-b.cost)};}

// ---------- per-level work (runs in a worker thread) ----------
function checkLevel(L,{quick,densityN,clumsyN}){
  const problems=[],rows=[];const fail=m=>problems.push(`${L.id}: ${m}`);
  const empty=P.simulate(L,[],{policy:'auto'});
  if(empty.status==='win')fail('(a) empty drawing wins under auto');
  if(!(L.par[0]<=L.par[1]&&L.par[1]<=L.ink))fail(`par ${L.par} not ordered within ink ${L.ink}`);
  if(!L.solutions||!L.solutions.length)fail('no solutions');
  (L.solutions||[]).forEach((items,i)=>{
    const cost=P.inkUsed(items),a=P.simulate(L,items,{policy:'auto'}),n=P.simulate(L,items,{policy:'none'});
    if(a.status!=='win')fail(`(b) solution ${i+1} ${a.status} under auto at (${a.x},${a.y},z ${a.z})`);
    if(cost>L.ink)fail(`(c) solution ${i+1} costs ${Math.round(cost)} > ink ${L.ink}`);
    rows.push({i:i+1,cost:Math.round(cost),stars:P.stars(L,cost),auto:a.status,autoT:a.t,jumps:a.jumps,none:n.status,noneT:n.t});});
  const drop=dropBalance(L,problems,{clumsyN:quick?0:Math.min(30,clumsyN)});
  const well=L.tools.includes('well')?wellSmoothness(L,problems):null;
  const sling=L.tools.includes('sling')?slingCheck(L,problems):null;
  // Par source: 3★ must come from the puzzle. Cheapest = cheapest rideable win among the listed solutions and a
  // random search (no-jump wins only when the level sets parFrom:'no-jump', i.e. before jumping is taught).
  {const noJump=L.parFrom==='no-jump',s=search(L,quick?0:densityN),pool=[...L.solutions.map(items=>({items,cost:P.inkUsed(items),jumps:P.simulate(L,items).jumps,won:P.simulate(L,items).status==='win'})).filter(w=>w.won),...s.wins];
    // Only drawings a decent human can actually ride count (≥ 6 of 10 noisy human riders win).
    const rideable=w=>{let k=0;for(let i=0;i<10&&k+(10-i)>=6;i++)if(P.simulate(L,w.items,{policy:humanRider(300+i)}).status==='win')k++;return k>=6;};
    const sorted=pool.filter(w=>!noJump||w.jumps===0).sort((a,b)=>a.cost-b.cost);let c=1e9;
    for(let k=0;k<Math.min(10,sorted.length);k++)if(rideable(sorted[k])){c=sorted[k].cost;break;}
    const ratio=L.par[0]/c;
    drop.parSrc={cheapest:Math.round(c),ratio,noJump};
    if(c<PAR_CHEAP&&ratio>PAR_RATIO)problems.push(`${L.id}: 3★ par ${L.par[0]} is ${ratio.toFixed(2)}× the cheapest solution found (${Math.round(c)}); keep ≤ ${PAR_RATIO}× so 3★ needs a clever drawing`);}
  let diff=null;
  if(!quick){const s=search(L,densityN),density=s.wins.length/s.tried,cheapest=s.wins.length?Math.min(s.wins[0].cost,...rows.map(r=>r.cost)):Math.min(...rows.map(r=>r.cost));
    const sol=L.solutions[0],clumsy=a=>{let k=0;for(let i=0;i<clumsyN;i++)if(P.simulate(L,sol,{policy:clumsyRider(900+i,a?.7:1),assist:a}).status==='win')k++;return k/clumsyN;};
    const c0=clumsy(0),c1=clumsy(1),dens=Math.min(1,Math.max(0,Math.log10(100/Math.max(density*100,.1))/3)),tight=cheapest/L.ink;
    const puzzle=.7*dens+.3*tight,ride=1-c0;
    diff={density,cheapest,tight,c0,c1,puzzle,ride,score:5*(puzzle+ride)};}
  return{id:L.id,empty:empty.status,rows,problems,diff,drop,well,sling};}

// ---------- sling learnability (contract v4) ----------
// The rule players should be able to learn: "put a sling in the rider's path, point it at the ring".
// Learnability: place a sling at points every 15 units along the natural (no-item) fall path and aim each
// straight at the goal; the share that win must be a clear majority (≥ SLING_LEARN) on levels where the
// sling is the only tool (the intro). On mixed levels it's reported only, since other tools may be needed.
// Smoothness: over a SLING_GRID grid, a placement wins if any of 9 aims (at the goal + 8 compass
// directions) wins; FAIL below 60% of winning cells with ≥ 3 winning neighbours, or under 25 cells.
const SLING_LEARN=.6,SLING_GRID=25;
function slingFallPath(L){const w=P.build(L,[]),pts=[];let last=null;
  while(w.status==='run'&&w.t<6){P.step(w,L,P.NO_INPUT);const r=w.rider;
    if(!r.grounded&&r.y>L.start.y+10&&r.y<P.H-20&&(!last||Math.hypot(r.x-last[0],r.y-last[1])>=15)){last=[r.x,r.y];pts.push(last);}}
  return pts;}
function slingCheck(L,problems){const intro=L.tools.length===1,pts=slingFallPath(L);
  const learnMap=pts.map(([x,y])=>P.simulate(L,[{type:'sling',x,y,a:Math.atan2(L.goal.y-y,L.goal.x-x)}],{policy:'auto',maxT:10}).status==='win');
  const learn=pts.length?learnMap.filter(Boolean).length/pts.length:0;
  if(intro&&learn<SLING_LEARN)problems.push(`${L.id}: sling: only ${Math.round(learn*100)}% of slings on the fall path aimed at the goal win (want ≥ ${SLING_LEARN*100}%)`);
  const aims=(x,y)=>[Math.atan2(L.goal.y-y,L.goal.x-x),...[...Array(8)].map((_,i)=>-Math.PI+i*Math.PI/4)],map=[];
  for(let y=SLING_GRID/2;y<P.H;y+=SLING_GRID){const row=[];for(let x=SLING_GRID/2;x<P.W;x+=SLING_GRID){
    if(Math.hypot(x-L.goal.x,y-L.goal.y)<L.goal.r+P.SLING.rc){row.push(-1);continue;}
    row.push(aims(x,y).some(a=>P.simulate(L,[{type:'sling',x,y,a}],{policy:'auto',maxT:10}).status==='win')?1:0);}map.push(row);}
  let wins=0,inner=0;map.forEach((row,j)=>row.forEach((c,i)=>{if(c!==1)return;wins++;let n=0;for(const[a,b]of[[1,0],[-1,0],[0,1],[0,-1]])if(map[j+b]?.[i+a]===1)n++;if(n>=3)inner++;}));
  const smooth=wins?inner/wins:0;
  if(intro&&smooth<WELL_SMOOTH)problems.push(`${L.id}: sling: best-aim win map is speckled (${Math.round(smooth*100)}% of winning cells have ≥3 winning neighbours)`);
  if(intro&&wins<WELL_MIN)problems.push(`${L.id}: sling: only ${wins} winning sling positions (want ≥ ${WELL_MIN})`);
  return{intro,learn,learnStr:learnMap.map(b=>b?'#':'.').join(''),n:pts.length,wins,cells:map.flat().filter(c=>c>=0).length,smooth,map};}

// ---------- gravity-well smoothness ----------
// A well should be a predictable magnet: moving it a little changes the outcome a little. Take the first
// listed solution with exactly one well, sweep that well over a WELL_GRID grid (the rest of the drawing
// fixed), and look at the win map. Smoothness = share of winning cells with ≥ 3 winning 4-neighbours.
// A solid blob of N cells scores about 1 − perimeter/N (≈ 70–90% for blobs of 50–200 cells); a chaotic
// speckle scores under 30%. So FAIL below 60%, or with fewer than 25 winning cells (too hard to find).
const WELL_GRID=25,WELL_SMOOTH=.6,WELL_MIN=25;
function wellSmoothness(L,problems){const sol=L.solutions.find(x=>x.filter(i=>i.type==='well').length===1);
  if(!sol){problems.push(`${L.id}: wells: no listed solution with exactly one well to sweep`);return null;}
  const rest=sol.filter(i=>i.type!=='well'),map=[];
  for(let y=WELL_GRID/2;y<P.H;y+=WELL_GRID){const row=[];for(let x=WELL_GRID/2;x<P.W;x+=WELL_GRID){
    if(Math.hypot(x-L.goal.x,y-L.goal.y)<P.WELL.keepOut){row.push(-1);continue;}
    row.push(P.simulate(L,[...rest,{type:'well',x,y}],{policy:'auto',maxT:12}).status==='win'?1:0);}map.push(row);}
  let wins=0,inner=0;map.forEach((row,j)=>row.forEach((c,i)=>{if(c!==1)return;wins++;let n=0;for(const[a,b]of[[1,0],[-1,0],[0,1],[0,-1]])if(map[j+b]?.[i+a]===1)n++;if(n>=3)inner++;}));
  const smooth=wins?inner/wins:0,cells=map.flat().filter(c=>c>=0).length;
  if(smooth<WELL_SMOOTH)problems.push(`${L.id}: wells: win map is speckled (${Math.round(smooth*100)}% of winning cells have ≥3 winning neighbours; want ≥ ${WELL_SMOOTH*100}%)`);
  if(wins<WELL_MIN)problems.push(`${L.id}: wells: only ${wins} winning well positions (want ≥ ${WELL_MIN})`);
  return{wins,cells,smooth,map,other:rest.map(i=>i.type).join('+')||'none'};}

// ---------- ink-drop balance (contract v2 §1) ----------
// O = ink of solutions[0] (the obvious drawing), P3 = 3★ par, gap = O − P3.
// safe drops = the ones the plain autopilot (steering to the middle, no drop hunting) picks up riding
// the obvious drawing; everything else is risky (off-centre, above the line, or off the route).
const TOL=.06;   // "± a little" on the ratio bands
const START_CLEAR=140;   // no drop this close to the start
function dropBalance(L,problems,{clumsyN}){const fail=m=>problems.push(`${L.id}: drops: ${m}`);
  const D=L.drops||[],sol=L.solutions[0],O=Math.round(P.inkUsed(sol)),P3=L.par[0],gap=O-P3;
  if(D.length<2||D.length>5)fail(`${D.length} drops (want 2–5)`);
  if((L.id==='first-line'||L.id==='mind-the-gap')&&D.length>3)fail('levels 1–2 keep to 2–3 obvious drops');
  D.forEach((d,i)=>{if(!(d.v>=10&&d.v<=75&&d.v%5===0))fail(`drop ${i+1} worth ${d.v} (multiples of 5 from 10 to 75)`);
    const far=Math.hypot(d.x-L.start.x,d.y-L.start.y);if(far<START_CLEAR)fail(`drop ${i+1} is ${Math.round(far)} from the start (keep ≥ ${START_CLEAR}: it blocks the view after the swoop)`);});
  const plain=P.simulate(L,sol,{policy:'auto'}).world.drops,safeIdx=D.map((d,i)=>i).filter(i=>plain[i].got);
  const safe=safeIdx.reduce((s,i)=>s+D[i].v,0),all=D.reduce((s,d)=>s+d.v,0),risky=D.filter((d,i)=>!safeIdx.includes(i));
  const hunt=P.simulate(L,sol,{policy:'drops'}),got=new Set();
  L.solutions.forEach(items=>P.simulate(L,items,{policy:'drops'}).world.drops.forEach((d,i)=>{if(d.got)got.add(i);}));
  const cheapest=Math.min(...L.solutions.map(x=>P.inkUsed(x)));
  const st={none:P.stars(L,O),safe:P.stars(L,O,safe),all:P.stars(L,O,all),ride:P.stars(L,O,hunt.refund),cheap:P.stars(L,cheapest)};
  if(gap<=0)fail(`obvious drawing (${O}) is already 3★ (par ${P3}): nothing for drops to do`);
  else{
    if(safe/gap<.4-TOL||safe/gap>.6+TOL)fail(`safe drops ${safe} = ${(safe/gap).toFixed(2)}×gap (want 0.4–0.6)`);
    if(all/gap<1-TOL||all/gap>1.3+TOL)fail(`all drops ${all} = ${(all/gap).toFixed(2)}×gap (want 1.0–1.3)`);}
  if(st.none===3)fail('obvious drawing gets 3★ without drops');
  if(st.safe===3)fail('obvious drawing + safe drops reaches 3★');
  if(hunt.status!=='win')fail(`riding the obvious drawing for drops ${hunt.status}`);
  else if(st.ride!==3)fail(`obvious drawing + a drop-hunting ride collects ${hunt.refund}, not enough for 3★`);
  if(st.cheap!==3)fail('no listed solution gets 3★ with zero drops');
  if(got.size<D.length)fail(`drop(s) ${D.map((d,i)=>i+1).filter(i=>!got.has(i-1)).join(',')} never collected by the drop-hunting autopilot`);
  if(risky.length&&safeIdx.length&&Math.min(...risky.map(d=>d.v))<Math.max(...safeIdx.map(i=>D[i].v)))fail('a risky drop is worth less than a safe one');
  // A risky drop needs a real decision: well off-centre (|z| ≥ 30; ≥ 20 over ice, where you can't correct),
  // or on the centre line but off the plain path (a hop or a longer line). Not merely "slightly left".
  D.forEach((d,i)=>{if(safeIdx.includes(i)||!d.z)return;const g=P.groundBelow(P.build(L,[]),d.x,d.y,d.z),ice=g&&g.kind==='ice';
    if(Math.abs(d.z)<(ice?20:30))fail(`risky drop ${i+1} is only ${d.z} off-centre (want |z| ≥ ${ice?20:30})`);});
  let cGot=0,cWin=0;for(let i=0;i<clumsyN;i++){const r=P.simulate(L,sol,{policy:clumsyRider(700+i,1,{drops:true})});cGot+=r.world.drops.filter(d=>d.got).reduce((s,d)=>s+d.v,0);if(r.status==='win')cWin++;}
  return{n:D.length,O,P3,gap,safe,all,st,hunt:hunt.refund,collect:clumsyN?cGot/(clumsyN*all||1):null,cwin:clumsyN?cWin/clumsyN:null};}

if(!isMainThread){const L=LEVELS.find(l=>l.id===workerData.id);
  if(workerData.mode==='search'){const{tried,wins}=search(L,workerData.N,12345,15);
    for(const w of wins)w.none=P.simulate(L,w.items,{policy:'none',maxT:15}).status;parentPort.postMessage({tried,wins});}
  else parentPort.postMessage(checkLevel(L,workerData.o));}
else if(process.argv[1]&&new URL(import.meta.url).pathname===(await import('node:path')).resolve(process.argv[1])){
  const only=opt('--level',null),levels=LEVELS.filter(L=>!only||L.id===only);
  const run=(L,data)=>new Promise((res,rej)=>{const wk=new Worker(new URL(import.meta.url),{workerData:{id:L.id,...data}});wk.once('message',res);wk.once('error',rej);});
  const pad=(s,n)=>String(s).padEnd(n),pct=v=>(v*100).toFixed(v<.1?1:0)+'%';
  const searchN=opt('--search',0);
  if(searchN){const N=searchN===true?4000:+searchN,t0=Date.now();
    const results=await Promise.all(levels.map(L=>run(L,{mode:'search',N})));
    levels.forEach((L,li)=>{const{tried,wins}=results[li],q=p=>wins.length?wins[Math.min(wins.length-1,Math.floor(wins.length*p))].cost:'-';
      console.log(`\n${L.id}: ${wins.length} wins of ${tried} affordable placements (${pct(wins.length/tried)})  cheapest ${q(0)}  p10 ${q(.1)}  median ${q(.5)}  ink ${L.ink}  par now ${L.par}`);
      const byTool={};for(const w of wins){const k=[...new Set(w.items.map(i=>i.type))].sort().join('+');byTool[k]=(byTool[k]||0)+1;}
      console.log('  by tools: '+Object.entries(byTool).map(([k,v])=>`${k} ${v}`).join(', ')+`   passive loses (needs input): ${wins.filter(w=>w.none!=='win').length}`);
      for(const w of wins.slice(0,6))console.log(`  ${w.cost}  none:${w.none}  jumps:${w.jumps}  ${JSON.stringify(w.items)}`);});
    console.log(`\n(${((Date.now()-t0)/1000).toFixed(1)}s)`);process.exit(0);}

  const o={quick:!!opt('--quick',false),densityN:+opt('--density',600),clumsyN:+opt('--clumsy',50)},t0=Date.now();
  const res=await Promise.all(levels.map(L=>run(L,{mode:'check',o})));
  console.log('CHECKS');
  console.log(pad('level',14)+pad('ink',6)+pad('par',10)+pad('empty',9)+pad('sol',5)+pad('cost',6)+pad('★',3)+pad('auto',13)+pad('jumps',7)+'none');
  levels.forEach((L,li)=>res[li].rows.forEach((r,i)=>console.log((i?pad('',39):pad(L.id,14)+pad(L.ink,6)+pad(L.par.join('/'),10)+pad(res[li].empty,9))
    +pad(r.i,5)+pad(r.cost,6)+pad(r.stars,3)+pad(r.auto+(r.auto==='win'?' '+r.autoT+'s':''),13)+pad(r.jumps,7)+r.none+(r.none==='win'?' '+r.noneT+'s':''))));
  const problems=res.flatMap(r=>r.problems),warnings=[];
  const sl=levels.map((L,i)=>[L,res[i].sling]).filter(x=>x[1]);
  if(sl.length){console.log(`\nSLINGS  (learn = slings on the no-item fall path aimed at the goal that win; map = one sling on a ${SLING_GRID}-unit grid, best of 9 aims)`);
    for(const[L,g]of sl){console.log(`${pad(L.id,14)}learn ${pad(pct(g.learn),5)} ${pad(g.learnStr,22)} map wins ${g.wins}/${g.cells}  smooth ${pct(g.smooth)}${g.intro?'':'  (mixed tools: reported only)'}`);
      if(opt('--maps',false))console.log(g.map.map(r=>'  '+r.map(c=>c<0?'g':c?'#':'.').join('')).join('\n'));}}
  const wl=levels.map((L,i)=>[L,res[i].well]).filter(x=>x[1]);
  if(wl.length){console.log(`\nWELLS  (one well swept over a ${WELL_GRID}-unit grid, rest of the drawing fixed; smooth = winning cells with ≥3 winning neighbours)`);
    for(const[L,w]of wl){console.log(`${pad(L.id,14)}with ${pad(w.other,8)} wins ${w.wins}/${w.cells} (${pct(w.wins/w.cells)})  smooth ${pct(w.smooth)}`);
      if(opt('--maps',false))console.log(w.map.map(r=>'  '+r.map(c=>c<0?'g':c?'#':'.').join('')).join('\n'));}}
  for(const L of DEV_LEVELS){const r=P.simulate(L,[],{policy:'none'});if(r.status!=='win')problems.push(`${L.id}: dev level doesn't win with an empty drawing (${r.status})`);}
  console.log('\nDROP BALANCE  (par source = cheapest solution found → 3★ par, nj = no-jump wins only; O = obvious drawing ink, gap = O − 3★ par; stars for the obvious drawing with no / safe / all / hunted drops)');
  console.log(pad('level',14)+pad('par source',20)+pad('drops',6)+pad('O',5)+pad('P3',5)+pad('gap',5)+pad('safe',6)+pad('all',5)+pad('safe/gap',9)+pad('all/gap',8)+pad('★ none/safe/all/ride',21)+pad('cheapest ★',11)+'clumsy collects');
  levels.forEach((L,li)=>{const d=res[li].drop;if(!d)return;
    const ps=d.parSrc;console.log(pad(L.id,14)+pad(`${ps.cheapest}${ps.noJump?' nj':''} → ${d.P3} (${ps.ratio.toFixed(2)}×)`,20)+pad(d.n,6)+pad(d.O,5)+pad(d.P3,5)+pad(d.gap,5)+pad(d.safe,6)+pad(d.all,5)+pad(d.gap>0?(d.safe/d.gap).toFixed(2):'-',9)+pad(d.gap>0?(d.all/d.gap).toFixed(2):'-',8)
      +pad(`${d.st.none} / ${d.st.safe} / ${d.st.all} / ${d.st.ride} (${d.hunt})`,21)+pad(d.st.cheap,11)+(d.collect==null?'-':`${pct(d.collect)} of ink (wins ${pct(d.cwin)})`));});
  if(!o.quick){
    console.log('\nDIFFICULTY  (puzzle and ride are 0..1; score = 5·(puzzle+ride), 0..10)');
    console.log(pad('#',3)+pad('level',14)+pad('new',6)+pad('density',9)+pad('cheapest',9)+pad('tight',7)+pad('clumsy a0',11)+pad('clumsy a1',11)+pad('puzzle',8)+pad('ride',7)+pad('score',7)+'curve');
    const seen=new Set();let prev=null;
    levels.forEach((L,li)=>{const d=res[li].diff,isNew=L.curve?L.curve==='dip':li>0&&L.tools.some(t=>!seen.has(t));L.tools.forEach(t=>seen.add(t));
      let curve=li===0?'start':isNew?'dip':'rise',ok=true;
      if(li===0&&(d.puzzle>.4||d.ride>.2)){ok=false;warnings.push(`${L.id}: level 1 should be near-trivial (puzzle ${d.puzzle.toFixed(2)}, ride ${d.ride.toFixed(2)})`);}
      if(prev&&isNew&&d.score>=prev.score){ok=false;warnings.push(`${L.id}: introduces a new tool but doesn't dip (${d.score.toFixed(1)} ≥ ${prev.score.toFixed(1)})`);}
      if(prev&&!isNew&&d.score<=prev.score){ok=false;warnings.push(`${L.id}: no new tool but doesn't rise (${d.score.toFixed(1)} ≤ ${prev.score.toFixed(1)})`);}
      if(d.puzzle>.5&&d.ride>.4){ok=false;warnings.push(`${L.id}: spikes both axes (puzzle ${d.puzzle.toFixed(2)}, ride ${d.ride.toFixed(2)})`);}
      if(d.c1<.85)warnings.push(`${L.id}: clumsy rider wins only ${pct(d.c1)} at assist 1 (want > 85%)`);
      console.log(pad(li+1,3)+pad(L.id,14)+pad(isNew?'yes':'',6)+pad(pct(d.density),9)+pad(d.cheapest,9)+pad(d.tight.toFixed(2),7)+pad(pct(d.c0),11)+pad(pct(d.c1),11)
        +pad(d.puzzle.toFixed(2),8)+pad(d.ride.toFixed(2),7)+pad(d.score.toFixed(1),7)+curve+(ok?'':'  ⚠'));
      prev=d;});}
  // Broadphase benchmark: a long freehand stroke (~600 tiny segments) plus a long wind stroke.
  {const L=LEVELS[0],pts=[];for(let i=0;i<=600;i++){const t=i/600;pts.push([152+t*410+Math.sin(i*1.7)*.4,136+t*262+Math.cos(i*2.3)*.4]);}
    const items=[{type:'line',pts},{type:'wind',pts:pts.map(([x,y])=>[x,y-120])}];let n=0,ts=0,ta=0,pa=0;
    for(let k=0;k<5;k++){const w=P.build(L,items);while(w.status==='run'&&w.t<6){let t=performance.now();const inp=P.autopilot(w,L);const d=performance.now()-t;ta+=d;if(k)pa=Math.max(pa,d);
      t=performance.now();P.step(w,L,inp);ts+=performance.now()-t;n++;}}
    const segs=P.build(L,items).segs.length,ms=ts/n;
    console.log(`\nBENCHMARK  ${segs} segments + ${pts.length-1}-segment wind: step ${ms.toFixed(3)} ms, autopilot mean ${(ta/n).toFixed(3)} ms, peak ${pa.toFixed(1)} ms (a lookahead frame at an edge)`);
    if(ms>2)warnings.push(`step takes ${ms.toFixed(2)} ms with ${segs} segments (target < 2 ms)`);}
  if(warnings.length)console.log('\nWARNINGS (not failures):\n  '+warnings.join('\n  '));
  console.log(problems.length?'\nFAILURES:\n  '+problems.join('\n  '):`\nall ${levels.length} levels pass  (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  process.exit(problems.length?1:0);}
