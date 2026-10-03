// node tools/peek.mjs --file src/levels/ch2.js --level <id> [--out path.png] [--items '<json>'] [--sol 1,2]
// Draws a level as a PNG map (needs python3 + Pillow): geometry, a 100-unit grid, the goal, drops, and
// the ride path of every listed solution under the autopilot (plus the empty drawing in grey), each
// ending in ✓ (win) or ✗ (fail). --items rides an extra drawing (JSON item list) in black.
// Made for authoring: look at the picture, move things, look again.
// Wide levels (contract v7, e.g. --file src/trials.js): the image is w×h scaled by --scale (default 1.5 up to one
// sheet, 1 beyond); --rows N wraps it into N stacked strips so a long course stays readable. Level-placed tools
// (fixed) are drawn in dark grey, checkpoints as numbered double rings. A trial has no solutions: its rides are the
// plain autopilot ('safe') and each scripted route in `routes` (the same input script tools/trials.mjs proves).
import * as P from '../src/physics.js';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';

const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(k);return i<0?d:(args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true);};
const FILE=opt('--file','src/levels.js'),mod=await import(pathToFileURL(resolve(FILE)).href),LEVELS=mod.default||mod.LEVELS;
const L=LEVELS.find(l=>l.id===opt('--level',LEVELS[0].id));if(!L){console.error('no such level');process.exit(2);}
const out=opt('--out',`${tmpdir()}/peek-${L.id}.png`);
const COLORS=['#d62828','#1d7a3a','#7b2cbf','#e07a00','#0077b6','#8d6e00'];
const pick=opt('--sol',null),sols=(L.solutions||[]).map((items,i)=>({items,i})).filter(s=>!pick||String(pick).split(',').map(Number).includes(s.i+1));
const trial=L.mode==='trial',{routePolicy}=trial?await import('./trials.mjs'):{};
const rides=[{label:trial?'safe':'empty',items:[],color:trial?'#0077b6':'#9a9a9a'},...(trial?(L.routes||[]).map((rt,i)=>({label:rt.name,items:[],policy:routePolicy(rt),color:COLORS[i%COLORS.length]})):[]),...sols.map(s=>({label:'sol '+(s.i+1),items:s.items,color:COLORS[s.i%COLORS.length]}))];
if(opt('--items',null))rides.push({label:'try',items:JSON.parse(opt('--items')),color:'#000000'});
const {w:LW,h:LH}=P.dims(L),medals=L.medals?` · medals ${['author','gold','silver','bronze'].map(k=>L.medals[k]).join('/')}`:'';
const scene={W:LW,H:LH,K:+opt('--scale',LW>P.W?1:1.5),rows:+opt('--rows',1),level:{fixed:L.fixed||[],checks:L.checks||[],blocks:L.blocks,ice:L.ice||[],crumble:L.crumble||[],boosts:L.boosts||[],hazards:L.hazards||[],drops:L.drops||[],start:L.start,goal:L.goal,name:trial?`${L.id} · ${L.name} · w ${LW}${medals} · maxT ${L.maxT}`:`${L.id} · ${L.name} · tools ${L.tools.join('+')} · ink ${L.ink} · par ${L.par}`},rides:[]};
for(const r of rides){const res=P.simulate(L,r.items,{policy:r.policy||'auto'});
  scene.rides.push({label:`${r.label}: ${res.status} ${res.t}s ink ${res.ink}${res.jumps?` jumps ${res.jumps}`:''}${res.dropsTotal===0&&L.checks?` checks ${res.checks}/${L.checks.length}`:''}`,color:r.color,items:r.items,
    path:res.world.path.map(p=>[p[0],p[1],p[3]]),end:[res.x,res.y],win:res.status==='win',jumps:res.world.events.filter(e=>e.type==='jump').map(e=>[e.x,e.y])});
  console.log(`${r.label.padEnd(7)} ${res.status.padEnd(7)} t ${res.t}s  ink ${res.ink}  end (${res.x},${res.y})  jumps ${res.jumps}  drops ${res.drops}/${res.dropsTotal}`);}
const json=`${tmpdir()}/peek-${L.id}.json`;writeFileSync(json,JSON.stringify(scene));
const py=String.raw`
import json,sys,math
from PIL import Image,ImageDraw,ImageFont
S=json.load(open(sys.argv[1]));L=S['level'];K=S['K'];W=S['W'];H=S['H']
img=Image.new('RGB',(int(W*K),int(H*K)+22+18*len(S['rides'])),'#fbf8f1');d=ImageDraw.Draw(img)
p=lambda x,y:(x*K,y*K)
for x in range(0,W+1,50):d.line([p(x,0),p(x,H)],fill='#ece6d8' if x%100 else '#d9d0bd',width=1)
for y in range(0,H+1,50):d.line([p(0,y),p(W,y)],fill='#ece6d8' if y%100 else '#d9d0bd',width=1)
for x in range(0,W,100):d.text(p(x+2,2),str(x),fill='#a89f8a')
for y in range(100,H,100):d.text(p(2,y+2),str(y),fill='#a89f8a')
poly=lambda pts:[p(*q) for q in pts]
for b in L['blocks']:d.polygon(poly(b),fill='#2b3a67')
for b in L['ice']:
  d.polygon(poly(b),fill='#bfe6f5',outline='#2b7a9c')
for b in L['crumble']:d.polygon(poly(b),fill='#f2b880',outline='#8a4b12')
for b in L['boosts']:
  (ax,ay),(bx,by)=b['a'],b['b'];d.line([p(ax,ay-3),p(bx,by-3)],fill='#1d9a4a',width=6)
  l=math.hypot(bx-ax,by-ay) or 1;tx,ty=(bx-ax)/l,(by-ay)/l
  for k in range(8,int(l),18):
    cx,cy=ax+tx*k,ay+ty*k-10;d.line([p(cx-tx*6-ty*6,cy-ty*6+tx*6),p(cx,cy),p(cx-tx*6+ty*6,cy-ty*6-tx*6)],fill='#1d9a4a',width=3)
for h in L['hazards']:d.line(poly(h),fill='#e63946',width=5)
for i,c in enumerate(L['checks']):
  x,y,r=c['x'],c['y'],c.get('r',30)
  for rr in (r,r-5):d.ellipse([p(x-rr,y-rr),p(x+rr,y+rr)],outline='#e07a00',width=3)
  d.text(p(x-3,y-6),str(i+1),fill='#e07a00')
g=L['goal'];d.ellipse([p(g['x']-g['r'],g['y']-g['r']),p(g['x']+g['r'],g['y']+g['r'])],outline='#111',width=4)
s=L['start'];d.ellipse([p(s['x']-9,s['y']-9),p(s['x']+9,s['y']+9)],fill='#111');d.text(p(s['x']-4,s['y']-24),'S',fill='#111')
for dr in L['drops']:
  x,y=dr['x'],dr['y'];col='#b5179e' if not dr.get('z') else '#f72585'
  d.ellipse([p(x-5,y-5),p(x+5,y+5)],fill=col);d.text(p(x+6,y-6),str(dr.get('v',25))+('' if not dr.get('z') else ' z%d'%dr['z']),fill=col)
def item(it,c):
    t=it['type']
    if t=='line':d.line(poly(it['pts']),fill=c,width=4)
    elif t=='rope':d.line([p(*it['a']),p(*it['b'])],fill=c,width=7);d.line([p(*it['a']),p(*it['b'])],fill='#fbf8f1',width=2)
    elif t=='wind':
      d.line(poly(it['pts']),fill=c,width=2)
      pts=it['pts'];bx,by=pts[-1];ax,ay=pts[-2];l=math.hypot(bx-ax,by-ay) or 1;tx,ty=(bx-ax)/l,(by-ay)/l
      d.polygon([p(bx,by),p(bx-tx*12-ty*6,by-ty*12+tx*6),p(bx-tx*12+ty*6,by-ty*12-tx*6)],fill=c)
      for q in pts:d.ellipse([p(q[0]-40,q[1]-40),p(q[0]+40,q[1]+40)],outline=c)
    elif t in('sling','well'):
      x,y=it['x'],it['y'];d.ellipse([p(x-34,y-34),p(x+34,y+34)],outline=c,width=3)
      a=it.get('a',-0.785);d.line([p(x,y),p(x+math.cos(a)*55,y+math.sin(a)*55)],fill=c,width=3)
for it in L['fixed']:item(it,'#555555')
for r in S['rides']:
  c=r['color']
  for it in r['items']:item(it,c)
  pts=[p(q[0],q[1]) for q in r['path']]
  if len(pts)>1:d.line(pts,fill=c,width=2)
  for j in r['jumps']:d.ellipse([p(j[0]-4,j[1]-4),p(j[0]+4,j[1]+4)],outline=c,width=2)
  ex,ey=r['end']
  if r['win']:d.text(p(ex+6,ey-14),'OK',fill=c)
  else:d.line([p(ex-7,ey-7),p(ex+7,ey+7)],fill=c,width=3);d.line([p(ex-7,ey+7),p(ex+7,ey-7)],fill=c,width=3)
y0=int(H*K)+4;d.text((6,y0),L['name'],fill='#111')
for i,r in enumerate(S['rides']):d.rectangle([6,y0+18*(i+1),20,y0+18*(i+1)+12],fill=r['color']);d.text((26,y0+18*(i+1)),r['label'],fill='#111')
n=max(1,S['rows'])
if n>1:   # wrap a long course into n stacked strips (a little overlap), legend under the last one
  sw=math.ceil(img.width/n)+int(40*K);sh=int(H*K);out=Image.new('RGB',(sw,(sh+8)*n+img.height-sh),'#fbf8f1')
  for i in range(n):x0=i*(sw-int(40*K));out.paste(img.crop((x0,0,min(img.width,x0+sw),sh)),(0,i*(sh+8)))
  out.paste(img.crop((0,sh,min(sw,img.width),img.height)),(0,(sh+8)*n));img=out
img.save(sys.argv[2])
`;
const r=spawnSync('python3',['-c',py,json,out],{encoding:'utf8'});
if(r.status!==0){console.error(r.stderr);process.exit(1);}
console.log(out);
