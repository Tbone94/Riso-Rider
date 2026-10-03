// node tools/trials.mjs [--level <id>] [--clumsy N]
// Checks the time-trial courses in src/trials.js (contract v7) and proves their medals. Exits non-zero on failure.
// Per course:
//   data      mode/fields, ids unique and prefixed t-, w 1600–4800, h 500, everything inside 0..w × 0..h,
//             medals ordered, 2–5 checkpoints in x order, inks real with a dark key, maxT ≈ 2× bronze
//   safe      the plain autopilot (P.autopilot) wins, passing every checkpoint: the safe route
//   respawn   a fall respawns you from a copy of the world taken the step you passed the last checkpoint (contract
//             v7), so no checkpoint may be passed in a doomed state: whenever a clumsy run fails after a checkpoint,
//             the autopilot must finish from that checkpoint's copy (FAIL: a respawn trap)
//   skips     one extra jump pressed at any x (every 20 units) never flies past a checkpoint (FAIL): a ride that misses
//             one stalls in the finish bowl, and respawning at a later checkpoint can never collect it, so the run is
//             lost. Checkpoints belong at choke points: on climbs, after landings, on a sling's or tightrope's line.
//   routes    every scripted route in `routes` wins (and passes its `via` points); the fastest is the author time
//             Each route is also ridden with every jump nudged ±8 and ±16 units: how many of those still win, and the
//             slowest, says whether a human can repeat it (a route that only works to the unit is a bad author time)
//   clumsy    the clumsy human from tools/tests/fairness.mjs, N runs at assist 0: finish rate and median time
//   medals    author = fastest route rounded up to 0.1 s (FAIL if below it: it would be unbeatable);
//             (2026-10-03, the user found gold too hard: medals now hang off the clean ride, not the perfect one)
//             author ≈ fastest route×1.04, gold ≈ safe×0.96 (take a shortcut), silver ≈ safe×1.06 (a clean ride),
//             bronze ≈ safe×1.35 to 0.5 s (room for a respawn or two) (WARN);
//             bronze must be within the clumsy rider's median (FAIL)
// A route is {name, jump:[x…], via:[[x,y]…]}: the autopilot rides, and also presses jump the moment the rider
// first passes each x (the physics is deterministic, so this is a proof a human can repeat). via: points the
// ride must pass within 40 of, so a route that quietly fell back to the safe road doesn't count as the shortcut.
import * as P from '../src/physics.js';
import {clumsyRider} from './tests/fairness.mjs';

export function routePolicy(route){const xs=[...(route.jump||[])].sort((a,b)=>a-b);let k=0;
  return(w,L)=>{const a=P.autopilot(w,L),r=w.rider;let jump=a.jump;
    while(k<xs.length&&r.x>=xs[k]){k++;jump=true;}
    return{...a,jump,jumpHeld:jump||r.jumped};};}
// Did the ride pass near every via point?
export const viaOk=(path,via)=>(via||[]).every(([x,y])=>path.some(p=>Math.hypot(p[0]-x,p[1]-y)<40));
export const up10=t=>Math.ceil(t*10-1e-6)/10,half=t=>Math.round(t*2)/2;
// What the medals should be, from the proofs.
export function medalsFor(fast,safe){const r10=v=>Math.round(v*10)/10,author=up10(fast*1.04),gold=Math.max(r10(safe*.96),r10(author+.3)),silver=Math.max(r10(safe*1.06),r10(gold+.4));
  return{author,gold,silver,bronze:Math.max(half(safe*1.35),half(silver+1))};}

// Ride with a policy, keeping a copy of the world the step each checkpoint is passed (what a respawn restores).
export function ride(L,policy){const w=P.build(L,[]),saves=[];let n=0;
  while(w.status==='run'&&w.t<(L.maxT||45)){P.step(w,L,policy(w,L));const c=w.checks.filter(q=>q.got).length;if(c>n){n=c;saves.push(P.cloneWorld(w));}}
  return{w,saves};}
// From a respawn copy, can the autopilot still finish? (The respawned world keeps its clock.)
function rescue(L,save){const w=P.cloneWorld(save);while(w.status==='run'&&w.t<(L.maxT||45))P.step(w,L,P.autopilot(w,L));return w.status;}

const isMain=import.meta.url===`file://${process.argv[1]}`;
if(isMain){
const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(k);return i<0?d:(args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true);};
const {default:TRIALS}=await import('../src/trials.js');
const INKS=['Yellow','Sunflower','Orange','Fluorescent Pink','Bright Red','Red','Coral','Burgundy','Purple','Violet','Blue','Medium Blue',
  'Federal Blue','Aqua','Teal','Mint','Green','Hunter Green','Moss','Flat Gold','Brick','Light Gray','Black'];
const DARK=['Burgundy','Purple','Blue','Medium Blue','Federal Blue','Teal','Hunter Green','Moss','Brick','Black'];
const SCENES=['woodblock','park','bauhaus','cutouts','orbits'];
const N=+opt('--clumsy',30),only=opt('--level',null);
let failed=0;const fail=(L,m)=>{failed++;console.log(`  FAIL ${L.id}: ${m}`);},warn=(L,m)=>console.log(`  warn ${L.id}: ${m}`);
const ids=new Set(),inksSeen=new Map(),rows=[];

for(const L of TRIALS){
  if(ids.has(L.id))fail(L,'duplicate id');ids.add(L.id);
  if(only&&L.id!==only)continue;
  console.log(`\n${L.id} · ${L.name} · w ${L.w}`);
  // ---- data ----
  if(!/^t-[a-z0-9-]+$/.test(L.id))fail(L,'id must be t-…');
  if(L.mode!=='trial')fail(L,"mode must be 'trial'");
  if(!Array.isArray(L.tools)||L.tools.length||L.ink!==0||String(L.par)!=='0,0'||!Array.isArray(L.drops)||L.drops.length)fail(L,'tools [], ink 0, par [0,0], drops [] (no drawing in a trial)');
  if(!(L.w>=1600&&L.w<=4800))fail(L,`w ${L.w} not in 1600..4800`);
  if(L.h!==500)fail(L,'h must be 500');
  if(!L.name||L.name.split(/\s+/).length>3)fail(L,'name: 1–3 words');
  if(!L.hint||/\n/.test(L.hint))fail(L,'hint: one plain sentence');
  const b=L.bg||{};if(!SCENES.includes(b.scene)||!Number.isFinite(b.seed)||!Array.isArray(b.inks)||b.inks.length!==3||!b.inks.every(k=>INKS.includes(k)))fail(L,'bg: scene, seed, 3 real inks');
  else{if(!DARK.includes(b.inks[2]))fail(L,`key ink ${b.inks[2]} isn't dark`);const k=b.inks.join('/');if(inksSeen.has(k))fail(L,`same inks as ${inksSeen.get(k)}`);inksSeen.set(k,L.id);}
  const m=L.medals||{};if(!(m.author<m.gold&&m.gold<m.silver&&m.silver<m.bronze))fail(L,'medals must be author < gold < silver < bronze');
  const checks=L.checks||[];if(checks.length<2||checks.length>5)fail(L,`${checks.length} checkpoints (want 2–5)`);
  checks.forEach((c,i)=>{const r=c.r||P.CHECK.r;if(r<30||r>40)warn(L,`checkpoint ${i+1} r ${r} (30–40 reads best)`);if(i&&c.x<checks[i-1].x)warn(L,'checkpoints not in x order');
    if(!(c.x>L.start.x&&c.x<L.goal.x))fail(L,`checkpoint ${i+1} isn't between start and goal`);});
  if(!(L.goal.x>L.start.x))fail(L,'courses run left → right');
  // Everything on the sheet: every point of every shape inside 0..w × 0..h.
  const pts=[[L.start.x,L.start.y],[L.goal.x,L.goal.y],...checks.map(c=>[c.x,c.y]),...L.blocks.flat(),...(L.ice||[]).flat(),...(L.crumble||[]).flat(),
    ...(L.hazards||[]).flat(),...(L.boosts||[]).flatMap(o=>[o.a,o.b]),...(L.fixed||[]).flatMap(it=>it.type==='rope'?[it.a,it.b]:it.type==='sling'?[[it.x,it.y]]:it.pts||[])];
  const out=pts.filter(([x,y])=>!(x>=0&&x<=L.w&&y>=0&&y<=L.h));if(out.length)fail(L,`${out.length} points outside 0..${L.w} × 0..${L.h}, e.g. ${JSON.stringify(out[0])}`);
  for(const it of L.fixed||[])if(!['line','wind','rope','sling'].includes(it.type))fail(L,`fixed item type ${it.type}`);
  // ---- safe route: the plain autopilot ----
  const safe=P.simulate(L,[],{policy:'auto'});
  if(safe.status!=='win')fail(L,`autopilot: ${safe.status} at (${safe.x},${safe.y}) t ${safe.t}s, checkpoints ${safe.checks}/${checks.length}`);
  console.log(`  safe    autopilot ${safe.status} ${safe.t}s  checks ${safe.checks}/${checks.length}  jumps ${safe.jumps}`);
  // ---- skips: a single extra jump anywhere must not fly past a checkpoint ----
  const skips=[];for(let x=L.start.x+20;x<L.goal.x;x+=20){const res=P.simulate(L,[],{policy:routePolicy({jump:[x]})});
    if(res.status!=='win'&&res.checks<checks.length&&Math.hypot(res.x-L.goal.x,res.y-L.goal.y)<L.goal.r+60)
      skips.push(`${x}→#${res.world.checks.map((c,i)=>c.got?0:i+1).filter(Boolean).join(',')}`);}
  if(skips.length)fail(L,`a jump at these x skips a checkpoint: ${skips.join(' ')}`);
  // ---- scripted fast routes ----
  let best=safe.status==='win'?safe.t:1e9,bestName='safe';
  for(const rt of L.routes||[]){const res=P.simulate(L,[],{policy:routePolicy(rt)}),via=viaOk(res.world.path,rt.via);
    let ok=0,n=0,worst=0;for(let j=0;j<(rt.jump||[]).length;j++)for(const d of [-16,-8,8,16]){n++;const jump=rt.jump.map((x,k)=>k===j?x+d:x),r2=P.simulate(L,[],{policy:routePolicy({jump})});
      if(r2.status==='win'&&viaOk(r2.world.path,rt.via)){ok++;worst=Math.max(worst,r2.t);}}
    console.log(`  route   ${rt.name.padEnd(14)} ${res.status} ${res.t}s  jumps ${res.jumps}${via?'':'  (missed its via points)'}  nudged: ${ok}/${n} win${ok?`, slowest ${worst}s`:''}`);
    if(res.status!=='win')fail(L,`route ${rt.name}: ${res.status} at (${res.x},${res.y}) t ${res.t}s`);
    else if(!via)fail(L,`route ${rt.name} doesn't pass its via points`);
    else if(res.t<best){best=res.t;bestName=rt.name;}}
  if(L.routes&&L.routes.length&&bestName==='safe')warn(L,'no scripted route beats the safe one');
  // ---- clumsy human (and its respawns) ----
  const ts=[];let fin=0;const fails={},traps=new Set();
  for(let i=0;i<N;i++){const {w,saves}=ride(L,clumsyRider(7000+i));if(w.status==='win'){fin++;ts.push(+w.t.toFixed(2));continue;}
    const k=`${w.status}@${Math.round(w.rider.x/100)*100}`;fails[k]=(fails[k]||0)+1;
    if(saves.length){const sv=saves[saves.length-1];if(rescue(L,sv)!=='win')traps.add(`#${saves.length} (${Math.round(sv.rider.x)},${Math.round(sv.rider.y)})`);}}
  if(traps.size)fail(L,`respawn trap: the autopilot can't finish from ${[...traps].join(', ')}`);
  ts.sort((a,b)=>a-b);const med=ts.length?ts[ts.length>>1]:Infinity,rate=fin/N;
  console.log(`  clumsy  ${fin}/${N} finish (${Math.round(rate*100)}%)  median ${ts.length?med.toFixed(2)+'s':'-'}${Object.keys(fails).length?'  fails '+Object.entries(fails).map(([k,v])=>`${k}×${v}`).join(' '):''}`);
  // ---- medals ----
  if(best<1e9){const want=medalsFor(best,safe.t);
    console.log(`  medals  ${['author','gold','silver','bronze'].map(k=>`${k} ${m[k]}`).join('  ')}   (proof: ${bestName} ${best}s → ${want.author}/${want.gold}/${want.silver}/${want.bronze})`);
    if(m.author<up10(best)-1e-9)fail(L,`author ${m.author} beats every proven route (${best}s): unbeatable`);
    else if(m.author!==want.author)warn(L,`author ${m.author} should be ${want.author}`);
    if(Math.abs(m.gold-want.gold)>.3)warn(L,`gold ${m.gold}, want ≈${want.gold}`);
    if(Math.abs(m.silver-want.silver)>.5)warn(L,`silver ${m.silver}, want ≈${want.silver}`);
    if(Math.abs(m.bronze-want.bronze)>.5)warn(L,`bronze ${m.bronze}, want ≈${want.bronze}`);}
  if(med>m.bronze)fail(L,`bronze ${m.bronze} is out of the clumsy rider's reach (median ${med})`);
  if(!(L.maxT>=60))fail(L,`maxT ${L.maxT} (want ≥ 60)`);else if(L.maxT<m.bronze*1.8||L.maxT>Math.max(60,m.bronze*2.2))warn(L,`maxT ${L.maxT}, want ≈ ${Math.max(60,Math.round(m.bronze*2))}`);
  rows.push({id:L.id,name:L.name,w:L.w,m,safe:safe.t,best,rate,med});
}
console.log('\ncourse              w     author  gold  silver bronze  safe    fast    clumsy');
for(const r of rows)console.log(`${(r.id).padEnd(18)}${String(r.w).padEnd(6)}${String(r.m.author).padEnd(8)}${String(r.m.gold).padEnd(6)}${String(r.m.silver).padEnd(7)}${String(r.m.bronze).padEnd(8)}${(r.safe+'s').padEnd(8)}${(r.best+'s').padEnd(8)}${Math.round(r.rate*100)}% (median ${r.med===Infinity?'-':r.med+'s'})`);
console.log(failed?`\n${failed} failure(s)`:'\nall trials ok');
process.exit(failed?1:0);
}
