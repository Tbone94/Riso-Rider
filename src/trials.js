// trials.js — Time Trial courses (contract v7). Pure data module (no DOM).
// A trial is a premade course longer than one sheet (w×500): no drawing, no ink, just ride it fast.
// Fields beyond a campaign level: mode 'trial', w, h, maxT, fixed (level-placed tools), checks (checkpoint
// rings, also respawn points), medals {author,gold,silver,bronze} in seconds, and routes (proof scripts for
// tools/trials.mjs: the autopilot plus jumps pressed at given x; the fastest sets the author medal).
// Speed only comes from slopes, boost pads and tools (flat road bleeds it, push only unsticks), so every
// course flows downhill on average and climbs back with boosts, ropes, wind and slings.
const R=Math.round;
// A stretch of road surface from (x0,y0) to (x1,y1), one point every ~step units, shaped by f (0→1):
// io = flat at both ends, so stretches join without kinks (a sharp V kills speed); lin = straight.
const io=t=>(1-Math.cos(Math.PI*t))/2,lin=t=>t;
const seg=(x0,y0,x1,y1,f=io,step=36)=>{const n=Math.max(1,R(Math.abs(x1-x0)/step));return Array.from({length:n+1},(_,i)=>[R(x0+(x1-x0)*i/n),R(y0+(y1-y0)*f(i/n))]);};
// ramp(b0,b1): a straight climb or drop that blends in over the first b0 and out over the last b1 of its run.
// b1 0 ends steep: a kicker. Boost pads go on the straight part (pad() below), up to the lip, so a rider who
// stalls anywhere on the climb rolls back onto the pad and gets sent up again.
const ramp=(b0=.25,b1=.25)=>t=>{const A=1-b0/2-b1/2,u=t-(1-b1);
  return(t<b0?t*t/(2*b0):t<1-b1?b0/2+t-b0:b0/2+1-b1-b0+u-(b1?u*u/(2*b1):0))/A;};
const pad=(x0,y0,x1,y1,b0=.25,b1=.25)=>{const f=ramp(b0,b1),at=t=>[R(x0+(x1-x0)*t),R(y0+(y1-y0)*f(t))];return{a:at(b0),b:at(1-b1)};};
// One road top from several stretches (shared joint points dropped), and the slab under it.
const top=(...parts)=>parts.flat().filter((q,i,a)=>!i||q[0]!==a[i-1][0]||q[1]!==a[i-1][1]);
const slab=(t,th=24)=>[...t,...t.slice().reverse().map(([x,y])=>[x,y+th])];

export default [
  // Every course ends in a finish bowl: the ring sits at the low point and the far wall climbs steeply to the
  // edge, so a rider who flies over the ring lands on the wall and rolls back down through it.
  // 1 · A warm-up: one long drop, boosted flats and a boosted climb, one small gap. Wide roads everywhere.
  {id:'t-downhill',name:'Downhill',mode:'trial',tools:[],ink:0,par:[0,0],drops:[],w:2600,h:500,maxT:60,
   hint:'Let the hill do the work, and ride the boost pads up the far side.',
   bg:{scene:'park',seed:101,inks:['Sunflower','Orange','Federal Blue']},
   start:{x:40,y:111,vx:200},goal:{x:2450,y:428,r:40},
   blocks:[slab(top(seg(0,120,160,120),seg(160,120,700,420),seg(700,420,1000,420),seg(1000,420,1340,250,ramp(.3,.4)))),
     slab(top(seg(1460,300,1520,300),seg(1520,300,1900,450),seg(1900,450,2100,450),seg(2100,450,2250,405),seg(2250,405,2450,465),seg(2450,465,2600,300,ramp(.4,0))))],
   boosts:[{a:[720,420],b:[1000,420]},pad(1000,420,1340,250,.3,.4),{a:[1920,450],b:[2100,450]}],
   hazards:[[[1340,486],[1460,486]]],
   checks:[{x:975,y:385,r:40},{x:2080,y:415,r:40}],
   medals:{author:6.1,gold:6.4,silver:7.0,bronze:9.0},
   // Hops skip the flats that bleed speed: off the start shelf, onto the valley floor, over the last bump.
   routes:[{name:'three hops',jump:[60,560,1940]}]},
  // 2 · Tightropes: two fixed lines over spike pits (they sway, so steer), and a boosted ramp jump between them.
  {id:'t-high-wire',name:'High wire',mode:'trial',tools:[],ink:0,par:[0,0],drops:[],w:3400,h:500,maxT:60,
   hint:'The thin lines sway under you, so steer against the sway and keep your speed up.',
   bg:{scene:'bauhaus',seed:102,inks:['Yellow','Fluorescent Pink','Blue']},
   start:{x:40,y:101,vx:200},goal:{x:3260,y:430,r:40},
   blocks:[slab(top(seg(0,110,150,110),seg(150,110,560,250),seg(560,250,620,252))),
     slab(top(seg(1036,356,1300,356),seg(1300,356,1500,250,ramp(.3,.3)))),
     slab(top(seg(1700,270,1760,272),seg(1760,272,1900,350),seg(1900,350,2110,262,ramp(.3,.5)),seg(2110,262,2180,264))),
     slab(top(seg(2716,339,2800,340),seg(2800,340,2940,300,ramp(.3,.5)),seg(2940,300,3260,468),seg(3260,468,3400,300,ramp(.4,0))))],
   fixed:[{type:'line',pts:[[622,255],[830,305],[1040,352]]},{type:'line',pts:[[2182,267],[2720,335]]}],
   boosts:[{a:[1050,356],b:[1300,356]},pad(1300,356,1500,250,.3,.3),pad(1900,350,2110,262,.3,.5),pad(2800,340,2940,300,0,.5)],
   hazards:[[[620,486],[1036,486]],[[1500,486],[1700,486]],[[2180,486],[2716,486]]],
   checks:[{x:1280,y:316,r:40},{x:2040,y:238,r:40},{x:2920,y:276,r:40}],
   medals:{author:8.7,gold:10.1,silver:11.1,bronze:14.0},
   // Hop off the start shelf, then twice through the dip after the ramp jump.
   routes:[{name:'hops',jump:[60,1800,2060]}]},
  // 3 · Ice and boosts: a chain of boosted islands, then an ice chute to a lip. Roll off and the low road climbs
  // back with boosts (safe); jump at the lip and the high ice bridge carries all your speed (fast). Ice won't
  // steer, so line up before the chute. It ends on a long wire, long enough to sway.
  {id:'t-ice-chute',name:'Ice chute',mode:'trial',tools:[],ink:0,par:[0,0],drops:[],w:4400,h:500,maxT:60,
   hint:'You can’t steer on ice, so line up before the chute, and jump at its lip if you dare the high bridge.',
   bg:{scene:'park',seed:103,inks:['Mint','Aqua','Teal']},
   start:{x:40,y:91,vx:200},goal:{x:4245,y:430,r:40},
   blocks:[slab(top(seg(0,100,150,100),seg(150,100,500,200),seg(500,200,700,200))),
     slab(top(seg(780,230,960,230))),slab(top(seg(1040,260,1240,260))),
     slab(top(seg(1760,440,1980,462),seg(1980,462,2380,390,ramp(.3,.3)),seg(2380,390,2480,390))),
     slab(top(seg(2480,390,2520,390),seg(2520,390,2780,450),seg(2780,450,3060,300,ramp(.3,.4)),seg(3060,300,3100,300))),
     slab(top(seg(4041,411,4085,412),seg(4085,412,4245,468),seg(4245,468,4400,300,ramp(.4,0))))],
   ice:[slab(top(seg(1240,260,1640,340),seg(1640,340,1700,340))),slab(top(seg(1850,310,2380,330,lin))),slab(top(seg(3100,300,3300,330)))],
   fixed:[{type:'line',pts:[[3302,333],[4045,407]]}],
   boosts:[{a:[540,200],b:[700,200]},{a:[790,230],b:[960,230]},{a:[1050,260],b:[1200,260]},pad(1980,462,2380,390,.3,.3),pad(2780,450,3060,300,.3,.4)],
   hazards:[[[700,486],[780,486]],[[960,486],[1040,486]],[[1700,486],[1760,486]],[[3300,486],[4041,486]]],
   checks:[{x:620,y:160,r:40},{x:2450,y:350,r:40},{x:2960,y:298,r:40}],
   medals:{author:9.2,gold:10.7,silver:11.8,bronze:15.0},
   routes:[{name:'high bridge',jump:[1690],via:[[2100,310]]},{name:'bridge and hops',jump:[60,780,1690,3320],via:[[2100,310]]}]},
  // 4 · Ropes and slings: trampolines over spike pits, and a fixed sling in a gap that flings you to the far side.
  // The fork: roll off the lip and bounce on the ropes (safe; the second is a net for short bounces), or jump at the
  // lip into the high sling (fast). Then a gap you have to jump.
  {id:'t-bounce',name:'Spring pits',mode:'trial',tools:[],ink:0,par:[0,0],drops:[],w:4000,h:500,maxT:60,
   hint:'Ropes bounce you over the spikes and slings throw you where they point, so don’t jump unless you mean it.',
   bg:{scene:'orbits',seed:104,inks:['Coral','Violet','Federal Blue']},
   start:{x:40,y:91,vx:200},goal:{x:3880,y:430,r:40},
   blocks:[slab(top(seg(0,100,150,100),seg(150,100,500,250),seg(500,250,600,250))),
     slab(top(seg(1000,290,1400,290))),
     slab(top(seg(2000,250,2100,250),seg(2100,250,2400,300),seg(2400,300,2500,300))),
     slab(top(seg(3000,330,3100,330),seg(3100,330,3200,390),seg(3200,390,3380,330,ramp(.3,.4)),seg(3380,330,3500,330))),
     slab(top(seg(3660,330,3720,330),seg(3720,330,3880,468),seg(3880,468,4000,300,ramp(.4,0))))],
   fixed:[{type:'rope',a:[650,330],b:[850,330]},{type:'sling',x:1500,y:320,a:-.55},
     {type:'rope',a:[2600,420],b:[2800,420]},{type:'rope',a:[2850,430],b:[2980,430]},{type:'sling',x:2620,y:220,a:-.15}],
   boosts:[{a:[1010,290],b:[1400,290]},pad(3200,390,3380,330,.3,.4)],
   hazards:[[[600,486],[1000,486]],[[1400,486],[2000,486]],[[2500,486],[3000,486]],[[3500,486],[3660,486]]],
   checks:[{x:1340,y:250,r:40},{x:2060,y:210,r:40},{x:3720,y:292,r:40}],
   medals:{author:10.0,gold:11.3,silver:12.5,bronze:16.0},
   routes:[{name:'high sling',jump:[2490],via:[[2620,220]]},{name:'sling and hops',jump:[60,640,2490,3380],via:[[2620,220]]}]},
  // 5 · Wind and crumble: an updraft lifts you out of the valley, then crumbling bridges drop away behind you.
  // The fork: roll down to the second updraft (safe), or jump onto the high crumble bridge and keep moving (fast).
  {id:'t-updraft',name:'Updraft',mode:'trial',tools:[],ink:0,par:[0,0],drops:[],w:4400,h:500,maxT:60,
   hint:'Ride the wind up the cliffs, and keep rolling on cracked bridges: they fall a moment after you touch them.',
   bg:{scene:'cutouts',seed:105,inks:['Sunflower','Bright Red','Medium Blue']},
   start:{x:40,y:91,vx:200},goal:{x:4280,y:430,r:40},
   // Two cliffs. Each updraft runs up a cliff face: the current catches you against the rock and lifts you onto
   // the top, however fast you came in (a fast rider crossing a lone current would shoot out of its side).
   blocks:[slab(top(seg(0,100,150,100),seg(150,100,650,420),seg(650,420,940,420))),
     [[940,150],[1500,150],[1500,500],[940,500]],
     slab(top(seg(2120,240,2200,240),seg(2200,240,2520,420),seg(2520,420,2860,420))),
     [[2860,250],[3300,250],[3300,500],[2860,500]],
     slab(top(seg(3300,250,3360,252),seg(3360,252,3700,340))),
     slab(top(seg(4000,360,4040,362),seg(4040,362,4280,468),seg(4280,468,4400,300,ramp(.4,0))))],
   // The first bridge has a broken span: two tiles gone and the far side level, so you have to hop it.
   crumble:[...Array.from({length:5},(_,i)=>slab([[1500+i*62,150+i*9],[1562+i*62,159+i*9]],22)),
     ...Array.from({length:3},(_,i)=>slab([[1934+i*62,195+i*15],[1996+i*62,210+i*15]],22)),
     ...Array.from({length:8},(_,i)=>slab([[2340+i*54,200+i*3],[2394+i*54,203+i*3]],22)),
     ...Array.from({length:5},(_,i)=>slab([[3700+i*60,340+i*4],[3760+i*60,344+i*4]],22))],
   fixed:[{type:'wind',pts:[[860,470],[900,300],[930,160],[990,140]]},{type:'wind',pts:[[2780,470],[2820,330],[2850,280],[2910,245]]}],
   boosts:[{a:[1060,150],b:[1400,150]},{a:[2130,240],b:[2200,240]},{a:[2960,250],b:[3200,250]}],
   hazards:[[[1500,486],[2120,486]],[[3700,486],[4000,486]]],
   checks:[{x:1300,y:110,r:40},{x:2170,y:200,r:40},{x:3100,y:210,r:40}],
   medals:{author:10.7,gold:11.5,silver:12.7,bronze:16.0},
   routes:[{name:'high bridge',jump:[2200],via:[[2550,195]]},{name:'bridge and hops',jump:[60,2200,2520,3540],via:[[2550,195]]}]},
  // 6 · The full course: a slow wire, a rope pit, an ice chute to the big fork (jump into the sling, or drop to
  // the updraft), a crumbling bridge, and a gap you have to jump.
  {id:'t-full-tilt',name:'Full tilt',mode:'trial',tools:[],ink:0,par:[0,0],drops:[],w:4800,h:500,maxT:60,
   hint:'Everything at once: steer on the wire, keep rolling on cracked bridges, and jump the last gap.',
   bg:{scene:'woodblock',seed:106,inks:['Flat Gold','Bright Red','Medium Blue']},
   start:{x:40,y:91,vx:200},goal:{x:4650,y:430,r:40},
   blocks:[slab(top(seg(0,100,150,100),seg(150,100,450,200),seg(450,200,700,200))),
     slab(top(seg(1296,267,1340,269),seg(1340,269,1560,320),seg(1560,320,1600,320))),
     slab(top(seg(2000,360,2150,360))),
     slab(top(seg(2600,460,2700,466),seg(2700,466,2960,466))),
     [[2960,220],[3500,220],[3500,500],[2960,500]],
     slab(top(seg(3950,300,4100,300))),
     slab(top(seg(4220,290,4260,290),seg(4260,290,4380,260,ramp(.3,.5)),seg(4380,260,4650,468),seg(4650,468,4800,300,ramp(.4,0))))],
   ice:[slab(top(seg(2150,360,2500,400),seg(2500,400,2550,400)))],
   crumble:Array.from({length:8},(_,i)=>slab([[3500+i*56,220+i*10],[3556+i*56,230+i*10]],22)),
   fixed:[{type:'line',pts:[[702,203],[1300,263]]},{type:'rope',a:[1650,400],b:[1850,400]},
     {type:'wind',pts:[[2880,490],[2920,320],[2950,250],[3010,215]]},{type:'sling',x:2700,y:344,a:-.5}],
   boosts:[{a:[1580,320],b:[1600,320]},{a:[2010,360],b:[2150,360]},{a:[3100,220],b:[3480,220]},pad(4260,290,4380,260,.3,.5)],
   hazards:[[[700,486],[1296,486]],[[1600,486],[2000,486]],[[2550,486],[2600,486]],[[3500,486],[3950,486]],[[4100,486],[4220,486]]],
   checks:[{x:660,y:160,r:40},{x:1580,y:280,r:40},{x:3200,y:180,r:40},{x:4340,y:230,r:40}],
   medals:{author:12.2,gold:15.8,silver:17.4,bronze:22.0},
   // Jumping at the bottom of the rope's stretch adds your jump to its throw: a launch over the chute into the sling.
   routes:[{name:'sling',jump:[2540],via:[[2700,344]]},{name:'rope launch',jump:[1860],via:[[2300,-60]]},{name:'sling and hops',jump:[380,740,2540,3360],via:[[2700,344]]}]},
];
