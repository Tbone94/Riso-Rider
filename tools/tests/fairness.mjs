// node tools/tests/fairness.mjs [runs]
// First-person fairness check: a human-like, noisy keyboard steerer rides a long straight
// tightrope (13 half-width) over spikes. Reports the fall rate at assist 0 and assist 1,
// plus what happens if you never touch the keys (passive) and with the autopilot.
//
// The "human": sees the rider's lateral offset with a reaction delay (160–260 ms real time,
// scaled by the app's 0.7× clock at assist 1), misjudges it by a little noise, and steers with
// digital keys (full left / full right / nothing). Presses last at least 5 frames, it aims at
// where it thinks the rider is heading, and now and then it looks away for a moment.
import * as P from '../../src/physics.js';

const LONG={id:'test-rope',name:'Long tightrope',tools:['line'],ink:9999,par:[0,0],
  start:{x:30,y:191,vx:160},goal:{x:770,y:328,r:26},
  blocks:[[[0,200],[90,200],[90,222],[0,222]],[[740,340],[800,340],[800,362],[740,362]]],
  hazards:[[[0,486],[800,486]]]};
const ROPE_ITEMS=[{type:'line',pts:[[88,203],[742,343]]}];

function rng(seed){let s=(seed*2654435761>>>0)||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const gauss=r=>(r()+r()+r()+r()-2)*1.732;

export function human(seed,{timeScale=1,skill=1,target=null}={}){
  const r=rng(seed),delay=Math.round((.16+r()*.1)/skill*timeScale*60),hist=[];
  const noise=1.6/skill,dead=3.5+r()*1.5,lead=.25+r()*.15;let key=0,held=0,lapse=0;
  return(w)=>{const R=w.rider;hist.push([R.z-(target?target(w):0),R.vz]);const seen=hist[Math.max(0,hist.length-1-delay)];
    if(lapse>0){lapse--;}else if(r()<.3/(60*timeScale)){lapse=Math.round((.2+r()*.3)*60*timeScale);}  // glance away (rates in real time)
    held++;
    if(held>=5&&lapse<=0){const zp=seen[0]+gauss(r)*noise+seen[1]*lead;const want=zp>dead?-1:zp<-dead?1:(Math.abs(zp)<1.5?0:key);
      if(want!==key){key=want;held=0;}}
    else if(lapse>0&&held>=5){key=0;}
    return{steer:key,jump:false,jumpHeld:false,push:0};};}

// ---------- riders ----------
// Decent human: noisy keyboard steering, presses jump 0–115 ms after the autopilot would.
export function humanRider(seed,timeScale=1,{drops=false}={}){const steer=human(seed,{timeScale,target:drops?P.dropAim:null}),r=rng(seed*7+3);let pending=-1;
  return(w,L)=>{const inp=steer(w),a=P.autopilot(w,L,{drops});
    if(a.jump&&pending<0)pending=Math.round(r()*7);
    let jump=false;if(pending===0){jump=true;pending=-1;}else if(pending>0)pending--;
    return{steer:inp.steer,jump,jumpHeld:jump||w.rider.jumped,push:a.push};};}
// Clumsy human: slower, noisier steering (skill .75) and jump presses anywhere from 100 ms early to
// 100 ms late of the autopilot's moment (real time; the app's 0.7× clock at assist 1 shrinks that).
export function clumsyRider(seed,timeScale=1,{drops=false}={}){const steer=human(seed,{timeScale,skill:.75,target:drops?P.dropAim:null}),r=rng(seed*13+5),J=Math.round(6*timeScale);
  const draw=()=>Math.round((r()*2-1)*J);let off=draw(),pending=-1;
  return(w,L)=>{const inp=steer(w),R=w.rider,a=P.autopilot(w,L,{drops});let jump=false;
    if(pending<0&&!R.jumped){
      if(a.jump)pending=Math.max(0,off);
      else if(off<0&&R.grounded){const c=P.cloneWorld(w);    // early: will the autopilot want to jump within |off| frames?
        for(let k=0;k<-off&&c.status==='run';k++){P.step(c,L,{steer:inp.steer,jump:false,jumpHeld:false,push:a.push});if(P.autopilot(c,L,{drops}).jump){jump=true;break;}}}}
    if(pending===0){jump=true;pending=-1;}else if(pending>0)pending--;
    if(jump)off=draw();
    return{steer:inp.steer,jump,jumpHeld:jump||R.jumped,push:a.push};};}

function run(assist,policyFor,N){let fell=0,win=0,t=0;
  for(let i=0;i<N;i++){const res=P.simulate(LONG,ROPE_ITEMS,{policy:policyFor(i),assist,maxT:20});
    if(res.status==='win'){win++;t+=res.t;}else fell++;}
  return{fell,win,rate:fell/N,avgT:win?t/win:0};}

if(import.meta.url===`file://${process.argv[1]}`){
const N=+process.argv[2]||300;
const out=[];
for(const assist of [0,1]){const ts=assist?.7:1;
  out.push({assist,policy:'human',...run(assist,i=>human(1000+i,{timeScale:ts}),N)});
  out.push({assist,policy:'clumsy human',...run(assist,i=>human(5000+i,{timeScale:ts,skill:.75}),N)});
  out.push({assist,policy:'passive',...run(assist,()=>'none',1)});
  out.push({assist,policy:'autopilot',...run(assist,()=>'auto',1)});}
console.log(`Long straight tightrope, ${Math.round(P.polyLen(ROPE_ITEMS[0].pts))} units, half-width ${P.WIDTH.line}`);
console.log('assist  policy         runs  falls  fall rate  avg ride');
for(const o of out)console.log(`${String(o.assist).padEnd(8)}${o.policy.padEnd(15)}${String(o.fell+o.win).padEnd(6)}${String(o.fell).padEnd(7)}${(o.rate*100).toFixed(1).padStart(6)}%   ${o.avgT?o.avgT.toFixed(2)+' s':'-'}`);
}
