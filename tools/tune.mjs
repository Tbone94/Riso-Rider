// node tools/tune.mjs --file src/levels/ch2.js --level <id> [--write] [--search N] [--par3 X] [--seed S]
// Authoring helper: derives a level's pars and places its ink drops so tools/validate.mjs's balance
// rules pass, so you only have to author geometry, ink and solutions (solutions[0] = the obvious drawing).
//   1. every listed solution must win under the autopilot (reports cost, human win rate, clumsy win rate)
//   2. 3★ par = cheapest *rideable* win (listed + a random search) × ~1.12, rounded up to 5
//      (a win is rideable when ≥ 6 of 10 noisy human riders win it). --par3 overrides.
//   3. 2★ par = a little above the obvious drawing's cost (capped at the ink budget)
//   4. drops: 2–5, placed on / beside the obvious ride so safe ≈ 0.5×gap and all ≈ 1.15×gap
//      (gap = obvious − 3★ par), checked with validate's own dropBalance
// --write rewrites `par:[…]` and `drops:[…]` inside that level's object in the file, and appends the
// cheapest search win to `solutions` when no listed solution earns 3★ on its own.
// Without --level it tunes every level in the file, one after another.
import * as P from '../src/physics.js';
import {humanRider,clumsyRider} from './tests/fairness.mjs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {cpus} from 'node:os';

const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(k);return i<0?d:(args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true);};
const FILE=isMainThread?opt('--file',null):workerData.file;
if(!FILE){console.error('usage: node tools/tune.mjs --file src/levels/<chapter>.js [--level id] [--write]');process.exit(2);}
const LEVELS=(await import(pathToFileURL(resolve(FILE)).href)).default;
const V=await import('./validate.mjs');   // sample/search/dropBalance (its main block doesn't run on import)

// ---------- worker: one slice of the random search ----------
if(!isMainThread){const L=LEVELS.find(l=>l.id===workerData.id),{wins,tried}=V.search(L,workerData.N,workerData.seed,15);
  parentPort.postMessage({tried,wins:wins.slice(0,40).map(w=>({cost:w.cost,items:w.items,jumps:w.jumps}))});}

async function parallelSearch(L,N,seed){const k=Math.max(1,Math.min(cpus().length-1,10)),per=Math.ceil(N/k);
  const runs=[...Array(k)].map((_,i)=>new Promise((res,rej)=>{const wk=new Worker(new URL(import.meta.url),{workerData:{file:FILE,id:L.id,N:per,seed:seed+i*7919}});wk.once('message',res);wk.once('error',rej);}));
  const out=await Promise.all(runs);return{tried:out.reduce((s,o)=>s+o.tried,0),wins:out.flatMap(o=>o.wins).sort((a,b)=>a.cost-b.cost)};}

const ceil5=v=>Math.ceil(v/5)*5,ceil10=v=>Math.ceil(v/10)*10,clamp=(v,a,b)=>v<a?a:v>b?b:v;
const rate=(L,items,mk,n=10,assist=0)=>{let k=0;for(let i=0;i<n;i++)if(P.simulate(L,items,{policy:mk(i),assist}).status==='win')k++;return k/n;};
const rideable=(L,items)=>{let k=0;for(let i=0;i<10&&k+(10-i)>=6;i++)if(P.simulate(L,items,{policy:humanRider(300+i)}).status==='win')k++;return k>=6;};
const round=items=>items.map(it=>{const r=v=>Math.round(v),q=p=>[r(p[0]),r(p[1])];
  return it.pts?{type:it.type,pts:it.pts.map(q)}:it.type==='rope'?{type:'rope',a:q(it.a),b:q(it.b)}:{...it,x:r(it.x),y:r(it.y)};});

async function tune(L){const log=(...a)=>console.log(...a);log(`\n=== ${L.id}  "${L.name}"  tools ${L.tools.join('+')}  ink ${L.ink}`);
  let ok=true;
  const empty=P.simulate(L,[],{policy:'auto'});if(empty.status==='win'){log('  ✗ the empty drawing wins: the level needs more in the way');ok=false;}
  L.solutions.forEach((items,i)=>{const a=P.simulate(L,items,{policy:'auto'}),c=P.inkUsed(items);
    const hum=a.status==='win'?rate(L,items,s=>humanRider(300+s)):0,clm=a.status==='win'?rate(L,items,s=>clumsyRider(900+s,.7),10,1):0;
    log(`  sol ${i+1}: ${pad(Math.round(c),5)} ink  ${pad(a.status,7)} ${a.t}s  jumps ${a.jumps}  human ${Math.round(hum*100)}%  clumsy@assist1 ${Math.round(clm*100)}%  [${[...new Set(items.map(t=>t.type))].join('+')}]${c>L.ink?'  ✗ over ink':''}`);
    if(a.status!=='win'||c>L.ink)ok=false;});
  if(!ok){log('  → fix the solutions first');return null;}
  const N=+opt('--search',3000),s=await parallelSearch(L,N,+opt('--seed',12345));
  const byTool={};for(const w of s.wins){const k=[...new Set(w.items.map(i=>i.type))].sort().join('+');byTool[k]=(byTool[k]||0)+1;}
  log(`  search: ${s.wins.length} wins / ${s.tried} affordable random drawings (${(100*s.wins.length/Math.max(1,s.tried)).toFixed(1)}%)  by tools: ${Object.entries(byTool).map(([k,v])=>k+' '+v).join(', ')||'-'}`);
  // Cheapest win per tool set (listed + search): if one tool set is far cheaper than every other, that tool dominates the 3★.
  {const best={};for(const w of [...L.solutions.map(items=>({items,cost:P.inkUsed(items)})),...s.wins]){const k=[...new Set(w.items.map(i=>i.type))].sort().join('+');if(!(k in best)||w.cost<best[k])best[k]=Math.round(w.cost);}
    log('  cheapest per tool set: '+Object.entries(best).sort((a,b)=>a[1]-b[1]).map(([k,v])=>`${k} ${v}`).join(', '));}
  const pool=[...L.solutions.map((items,i)=>({items,cost:P.inkUsed(items),listed:i,jumps:P.simulate(L,items).jumps})),...s.wins].filter(w=>L.parFrom!=='no-jump'||w.jumps===0).sort((a,b)=>a.cost-b.cost);
  let cheap=null;for(let k=0;k<Math.min(14,pool.length);k++)if(rideable(L,pool[k].items)){cheap=pool[k];break;}
  if(!cheap){log('  ✗ nothing rideable found');return null;}
  for(const w of s.wins.slice(0,4))log(`    cheap win ${Math.round(w.cost)}: ${JSON.stringify(round(w.items))}`);
  const O=Math.round(P.inkUsed(L.solutions[0])),c=cheap.cost;
  let P3=opt('--par3',null)?+opt('--par3'):ceil5(c*1.12);if(c<200)P3=Math.min(P3,Math.floor(c*1.6/5)*5);P3=Math.max(P3,ceil5(c));
  log(`  cheapest rideable ${Math.round(c)} (${cheap.listed!=null?'listed #'+(cheap.listed+1):'search'}) → 3★ par ${P3};  obvious drawing ${O}`);
  const gap=O-P3;
  if(gap<20){log(`  ✗ gap ${gap}: the obvious drawing (solutions[0]) must cost clearly more than 3★ par. Make it the plain, generous drawing.`);return null;}
  if(gap>390){log(`  ✗ gap ${gap} is too big for drops (max 5×75). Make the obvious drawing cheaper or the level ink tighter.`);return null;}
  const P2=clamp(Math.max(O+10,ceil10(O*1.12)),P3+10,L.ink);
  // Listed solutions must include a 3★ drawing with zero drops.
  let solutions=L.solutions,added=null;
  if(!L.solutions.some(x=>P.inkUsed(x)<=P3)){added=round(cheap.items);solutions=[...L.solutions,added];
    if(P.simulate(L,added).status!=='win'||P.inkUsed(added)>P3){log('  ✗ the cheap solution did not survive rounding; add a cheap solution by hand');return null;}}
  const drops=placeDrops({...L,par:[P3,P2],solutions},gap,log);
  if(!drops){log('  ✗ could not place drops that pass the balance rules (see above)');return null;}
  log(`  → par:[${P3},${P2}]  drops:${fmtDrops(drops)}${added?`\n  → + solution ${JSON.stringify(added)}`:''}`);
  return{par:[P3,P2],drops,added};}

// ---------- drop placement ----------
function placeDrops(L,gap,log){
  const sol=L.solutions[0],w=P.simulate(L,sol,{policy:'auto'}).world,path=w.path,S0=L.start,G0=L.goal;
  const far=(x,y)=>Math.hypot(x-S0.x,y-S0.y)>=150&&Math.hypot(x-G0.x,y-G0.y)>=G0.r+24&&x>8&&x<792&&y>8&&y<492;
  const base=P.build(L,[]);
  // arc length along the ride, to spread drops out
  const arc=[0];for(let i=1;i<path.length;i++)arc.push(arc[i-1]+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));const total=arc[arc.length-1]||1;
  const safeC=[],riskC=[];
  path.forEach((p,i)=>{const[x,y,,st]=p,f=arc[i]/total;if(!far(x,y)||i%3)return;safeC.push({x:Math.round(x),y:Math.round(y),z:0,f});
    if(st===P.STATE.ground){const g=P.groundBelow(base,x,y+2,34);
      if(g&&g.kind!=='line'&&g.y-y<R2)riskC.push({x:Math.round(x),y:Math.round(y),z:(i/3)%2?34:-34,f,kind:'side'});
      if(g&&g.kind==='ice')riskC.push({x:Math.round(x),y:Math.round(y),z:(i/3)%2?24:-24,f,kind:'side'});
      if(y-44>8)riskC.push({x:Math.round(x),y:Math.round(y-42),z:0,f,kind:'hop'});}
    else if(st===P.STATE.air)riskC.push({x:Math.round(x),y:Math.round(y),z:(i/3)%2?30:-30,f,kind:'air'});});
  // A risky candidate must be collected by the drop-hunting autopilot on the obvious drawing and missed by the plain one.
  const test=d=>{const L1={...L,drops:[{...d,v:40}]},plain=P.simulate(L1,sol,{policy:'auto'}),hunt=P.simulate(L1,sol,{policy:'drops'});
    return hunt.status==='win'&&hunt.drops===1&&plain.drops===0;};
  const pick=(arr,n,fn)=>{const out=[];for(const d of arr){if(out.length>=n)break;if(out.some(o=>Math.abs(o.f-d.f)<.12))continue;if(fn(d))out.push(d);}return out;};
  const bySpread=(arr,seed)=>{const r=rng(seed);return arr.map(d=>({d,k:r()})).sort((a,b)=>a.k-b.k).map(o=>o.d);};
  const risky=pick(bySpread(riskC,7).sort((a,b)=>(a.kind==='side'?0:1)-(b.kind==='side'?0:1)),9,test);
  const safeOK=d=>{const L1={...L,drops:[{...d,v:25}]};return P.simulate(L1,sol,{policy:'auto'}).drops===1;};
  const safe=pick(bySpread(safeC,3),6,safeOK);
  log(`  drop candidates: ${safe.length} safe, ${risky.length} risky (${risky.map(d=>d.kind).join(',')})`);
  if(!safe.length||!risky.length)return null;
  // values: safe total ≈ .5 gap, all ≈ 1.15 gap, multiples of 5 in 10..75, every risky ≥ every safe
  const plans=[];for(const ns of [1,2])for(const nr of [1,2,3]){if(ns+nr<2||ns+nr>5)continue;
    for(const sf of [.5,.45,.55])for(const af of [1.15,1.1,1.2,1.05,1.25]){const sv=split(gap*sf,ns);if(!sv)continue;const rv=split(gap*af-sum(sv),nr);if(!rv)continue;
      if(Math.min(...rv)<Math.max(...sv))continue;plans.push({sv,rv});}}
  const r=rng(11);let tries=0;
  for(const plan of plans)for(let rep=0;rep<4&&tries<90;rep++,tries++){
    const ss=choose(safe,plan.sv.length,r),rr=choose(risky,plan.rv.length,r);if(!ss||!rr)continue;
    if([...ss,...rr].some((a,i,all)=>all.some((b,j)=>j>i&&Math.hypot(a.x-b.x,a.y-b.y)<30)))continue;
    const drops=[...ss.map((d,i)=>({x:d.x,y:d.y,v:plan.sv[i]})),...rr.map((d,i)=>({x:d.x,y:d.y,...(d.z?{z:d.z}:{}),v:plan.rv[i]}))].sort((a,b)=>a.x-b.x);
    const probs=[];V.dropBalance({...L,drops},probs,{clumsyN:0});if(!probs.length)return drops;
    if(tries<3)log('    try: '+probs.join(' | '));}
  return null;}
const R2=12;
const sum=a=>a.reduce((s,v)=>s+v,0);
function split(total,n){if(n<=0)return total<5?[]:null;const each=Math.round(total/n/5)*5;if(each<10||each>75)return null;return[...Array(n)].map(()=>each);}
function choose(arr,n,r){if(arr.length<n)return null;const a=[...arr],out=[];while(out.length<n){const d=a.splice(Math.floor(r()*a.length),1)[0];if(out.some(o=>Math.abs(o.f-d.f)<.1)&&a.length>=n-out.length)continue;out.push(d);}return out;}
function rng(seed){let s=(seed*2654435761>>>0)||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const pad=(s,n)=>String(s).padEnd(n);
const fmtDrops=d=>'['+d.map(o=>`{x:${o.x},y:${o.y}${o.z?`,z:${o.z}`:''},v:${o.v}}`).join(',')+']';

// ---------- rewriting the chapter file ----------
// Finds the level's object by its id and replaces the first `par:[…]` and `drops:[…]` inside it (bracket-matched).
function rewrite(src,id,{par,drops,added}){const at=src.indexOf(`id:'${id}'`);if(at<0)throw new Error('id not found: '+id);
  const next=src.indexOf("{id:'",at+5),end=next<0?src.length:next;
  const repl=(s,key,val)=>{const i=s.indexOf(key+':[',at);if(i<0||i>end)throw new Error(`${id}: no ${key}:[…] to replace`);let d=0,j=i+key.length+1;
    for(;j<s.length;j++){if(s[j]==='[')d++;else if(s[j]===']'&&--d===0)break;}return s.slice(0,i)+key+':'+val+s.slice(j+1);};
  let out=repl(src,'par',`[${par.join(',')}]`);out=repl(out,'drops',fmtDrops(drops));
  if(added){const i=out.indexOf('solutions:[',at);let d=0,j=i+'solutions:'.length;for(;j<out.length;j++){if(out[j]==='[')d++;else if(out[j]===']'&&--d===0)break;}
    out=out.slice(0,j)+`,\n     ${JSON.stringify(added).replace(/"(\w+)":/g,'$1:').replace(/"/g,"'")}`+out.slice(j);}
  return out;}

async function main(){const only=opt('--level',null),levels=LEVELS.filter(L=>!only||L.id===only);
  if(!levels.length){console.error('no such level');process.exit(2);}
  let src=readFileSync(FILE,'utf8'),changed=0,failed=0;
  for(const L of levels){const t=await tune(L);if(!t){failed++;continue;}
    if(opt('--write',false)){src=rewrite(src,L.id,t);changed++;}}
  if(changed){writeFileSync(FILE,src);console.log(`\nwrote ${changed} level(s) to ${FILE}`);}
  process.exit(failed?1:0);}

if(isMainThread)await main();
