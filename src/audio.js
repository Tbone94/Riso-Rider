// audio.js — every sound in Drift, synthesized live with the Web Audio API. No files, no libraries.
// API: ARCHITECTURE.md, contract v2 §4. Every method is a safe no-op before unlock() or when
// there is no AudioContext.
//
// The palette is the print shop: paper, graphite, felt, wood, rubber, tape, and a small room.
// Built from filtered noise (paper, pencil, air), a plucked string model (ropes), a few sine partials
// (felt-piano chord, ink droplets) and a short generated room reverb. No bleeps: no square waves,
// no bare oscillators without an envelope and a filter, and nothing above ~9 kHz.
//
// MIX TABLE — measured, not guessed: dev/audio-test.html → "Measure mix" renders every sound offline
// through the real chain and reports its peak. "out" = what the player hears at the default volume 0.7
// (master → 9 kHz lowpass → small room → compressor, threshold -18 dB, ratio 3.5, with Chrome's makeup
// gain). Levels are set by the MIX (one-shots, dB) and PEN_LVL / RIDE_LVL (loops) tables below.
// Noise-based sounds vary about ±2 dB between plays by design (humanised).
// Bands: rewards and big moments -9..-12, events -13..-20, UI -14..-23, loops -16..-24 (RMS ~ -30).
// Loudest anything gets at volume 1.0: -6 dBFS (CLEARED! stamp, swoop). Nothing clips.
//
//   sound                        out peak dBFS @0.7   what it imitates
//   stamp(0) CLEARED!                 -9             heavy rubber stamp on a stack of paper
//   swoop (transition)                -9             paper rushing past; tearing through a sheet mid-way
//   win                              -10             felt-piano sus4 resolving to C major
//   drop v40 / v25                  -12 / -16         ink droplet "plip", rising pentatonic streak
//   land (hard / soft)              -13 / -26         body landing on card (thrummed wire / glass tick variants)
//   stamp(1..3) star                 -14             small rubber stamp, each a whole tone higher
//   ui clear                         -14             sheet torn off the pad
//   bounce                           -15             warm plucked rope gliding up a fourth
//   boost                            -15             wind-up toy let go
//   fell                             -15             breathy falling whistle, cut short
//   crumble                          -15             dry card cracking through, bits landing
//   ui press / next                  -16             rubber stamp button / paper fed in + wooden clack
//   stuck                            -16             deflating note
//   popped                           -18             soft cork pop
//   draw well                        -18             felt thup
//   ui locked                        -19             two dull wooden knocks
//   inkEmpty                         -19             dry nib skipping
//   jump                             -20             paper flex push-off
//   ui toggle / slip / undo        -21 / -21 / -22    switch click / paper slip / eraser rub
//   ui tool                          -22             light wooden tick
//   draw line / wind / rope      -12 / -14 / -20     pencil scratch (peaky, RMS -32) / soft brush / creak + stretch
//   ride road @500 / @150          -16 / -24          card rumble with the ball's rolling rhythm
//   ride wire (+ sway creak)       -20 (-17)          thin wire hum; creak follows rider.sway
//   ride ice / air / wind / boost  -19/-19/-16/-17    glassy hiss / air rush / gusting current / flywheel whirr
//   ride rope                        -22             low stretched twang, sags with rope depth
//   sling release (v700 / v330)    -13 / -15          "thwip": band twang snapping up + snap + air tear
//   sling capture                    -17             rubbery grab: low thud + short twang
//   ride sling orbit                 -15             band stretch creak + whoosh + taut hum rising with slingK
//   draw sling place                 -20             rubber band plucked against felt
//   draw sling aim (per tick)        -25             wooden ratchet tooth, at most one per 60 ms

const AC=typeof window!=='undefined'?(window.AudioContext||window.webkitAudioContext):null;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const rnd=(a,b)=>a+Math.random()*(b-a);
const jit=(x,amt)=>x*(1+(Math.random()*2-1)*amt);          // humanise: no two taps identical
// Ink drops climb a C-major pentatonic (G4 → C6), so a streak plays a little tune that the win chord resolves.
// Level trims in dB for each one-shot (applied on the voice's output). This is the mix: tune here,
// then re-measure with dev/audio-test.html. Continuous loops are balanced by RIDE_LVL / PEN_LVL below.
const MIX={stampBig:2,stampStar:7.5,land:0,bounce:4,crumble:1,crack:0,win:-1.5,popped:5,drop:9.5,boost:6,jump:9.5,fell:4,stuck:-3,
  press:6,tool:10.5,toggle:4.5,slip:7.5,undo:12,clear:2,next:-3,locked:-4,inkEmpty:11,well:-1.5,ropeSet:-5,lift:0,give:0,
  slingSet:10,ratchet:14,slingIn:6,slingOut:11};
const DROP_NOTES=[392,440,523.25,587.33,659.25,783.99,880,1046.5];

// opts.context: render into a given (e.g. Offline) AudioContext — used by the dev page to measure levels.
// opts.raw: skip the master stage (no room, no lowpass, no compressor) for raw level measurement.
export function createAudio(opts={}){
  let ctx=null,M=null,B=null;            // context, master graph, noise buffers
  let muted=false,volume=.7,dead=!AC&&!opts.context;
  const offline=!!opts.context&&typeof OfflineAudioContext!=='undefined'&&opts.context instanceof OfflineAudioContext;
  let voices=0,voiceNodes=0,made=0;       // stats: live one-shot voices / their nodes / total nodes created
  let warnedErr=false;
  const now=()=>ctx.currentTime;
  const volGain=()=>Math.pow(volume,1.6)*1.25;   // perceptual taper; 0.7 → 0.70, 1 → 1.25

  // ---------- buffers: made once, shared by everything ----------
  function makeBuffers(){
    const sr=ctx.sampleRate,N=Math.floor(sr*2);
    const mk=fill=>{const b=ctx.createBuffer(1,N,sr),d=b.getChannelData(0);fill(d,sr);
      let m=0;for(let i=0;i<N;i++)m=Math.max(m,Math.abs(d[i]));if(m>0)for(let i=0;i<N;i++)d[i]/=m;return b;};
    return{
      white:mk(d=>{for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;}),
      // pink (Paul Kellet's filter): air, breath, brush
      pink:mk(d=>{let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;
        b0=.99886*b0+w*.0555179;b1=.99332*b1+w*.0750759;b2=.969*b2+w*.153852;b3=.8665*b3+w*.3104856;b4=.55*b4+w*.5329522;b5=-.7616*b5-w*.016898;
        d[i]=b0+b1+b2+b3+b4+b5+b6+w*.5362;b6=w*.115926;}}),
      // brown: card and table rumble. The ends are tilted to meet so the loop seam doesn't click.
      brown:mk(d=>{let l=0,mean=0;for(let i=0;i<d.length;i++){l=(l+.02*(Math.random()*2-1))/1.02;d[i]=l;mean+=l;}mean/=d.length;
        const n=d.length,e=d[n-1]-d[0];for(let i=0;i<n;i++)d[i]=d[i]-mean-e*i/(n-1);}),
      // grain: graphite on paper tooth. Noise whose loudness jumps every 3–14 ms (the paper's fibres),
      // with a slight high tilt and the odd sharper catch.
      grain:mk((d,sr)=>{let env=.3,tgt=.3,next=0,click=0,prev=0;for(let i=0;i<d.length;i++){
        if(i>=next){next=i+Math.floor(sr*rnd(.003,.014));tgt=.12+Math.pow(Math.random(),2)*.88;}
        env+=(tgt-env)*.02;if(Math.random()<.0005)click=rnd(.2,.45)*(Math.random()<.5?-1:1);
        const w=Math.random()*2-1;d[i]=(w-prev*.6)*env+click;prev=w;click*=.82;}}),
      // crackle: sparse dry snaps (card fibres breaking, a dry nib catching)
      crackle:mk((d,sr)=>{let i=0;while(i<d.length){i+=Math.floor(sr*-Math.log(1-Math.random())*.006)+1;
        const a=Math.pow(Math.random(),1.6)*(Math.random()<.5?-1:1),len=Math.floor(sr*rnd(.0002,.0016));
        for(let k=0;k<len&&i+k<d.length;k++)d[i+k]+=a*(Math.random()*2-1)*Math.exp(-k/(len*.3));}}),
    };}

  // A small room (a print shop, not a hall): 0.45 s, early taps, darkening as it decays.
  function makeRoom(){const sr=ctx.sampleRate,len=Math.floor(sr*.45),ir=ctx.createBuffer(2,len,sr);
    for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);let lp=0;
      for(let i=0;i<len;i++){const t=i/sr;lp+=((Math.random()*2-1)-lp)*(.55-.45*t/.45);d[i]=lp*Math.exp(-t/.075)*Math.min(1,t/.003);}
      for(const[ms,a]of[[7+ch*2,.5],[13+ch*3,.35],[21-ch*2,.25]])d[Math.floor(sr*ms/1000)]+=a*(ch?-1:1);}
    return ir;}

  // ---------- master: sfx bus + dry bus → master (volume) → lowpass → compressor → out ----------
  function build(){
    B=makeBuffers();
    const fx=ctx.createGain(),dry=ctx.createGain(),master=ctx.createGain();
    master.gain.value=muted?0:volGain();
    fx.connect(master);dry.connect(master);
    const nodes=[fx,dry,master];
    if(opts.raw)master.connect(ctx.destination);
    else{
      const room=ctx.createConvolver(),send=ctx.createGain(),dsend=ctx.createGain();
      room.buffer=makeRoom();send.gain.value=.2;dsend.gain.value=.07;
      fx.connect(send);dry.connect(dsend);send.connect(room);dsend.connect(room);room.connect(master);
      const tone=ctx.createBiquadFilter();tone.type='lowpass';tone.frequency.value=9000;tone.Q.value=.5;
      const comp=ctx.createDynamicsCompressor();
      comp.threshold.value=-18;comp.knee.value=12;comp.ratio.value=3.5;comp.attack.value=.004;comp.release.value=.2;
      master.connect(tone);tone.connect(comp);comp.connect(ctx.destination);
      nodes.push(room,send,dsend,tone,comp);}
    M={fx,dry,master,nodes};
    if(!offline&&!opts.context)setInterval(sweep,1000);}

  const ok=()=>ctx&&M&&!muted;
  // cancel what's scheduled on a param and hold its current value (so the next ramp starts from it)
  function hold(p,t){if(p.cancelAndHoldAtTime)p.cancelAndHoldAtTime(t);else{const v=p.value;p.cancelScheduledValues(t);p.setValueAtTime(v,t);}}

  // ---------- one-shot voices ----------
  // Every one-shot sound is a voice: an output gain on a bus plus the nodes feeding it. All of a
  // voice's nodes are disconnected together when it has finished (plucked strings are feedback
  // loops and would otherwise keep each other alive). Capped so a burst of events can't pile up.
  function voice(dur,{bus=M.fx,pan=0}={}){
    if(voices>=40)return null;
    const out=ctx.createGain(),v={out,nodes:[out]};made++;voices++;voiceNodes++;out.gain.value=trim;
    if(pan&&ctx.createStereoPanner){const p=ctx.createStereoPanner();p.pan.value=pan;out.connect(p);p.connect(bus);reg(v,p);}else out.connect(bus);
    const end=()=>{for(const n of v.nodes){try{n.disconnect();}catch(e){}}voices--;voiceNodes-=v.nodes.length;};
    if(offline)setTimeout(end,60000);else setTimeout(end,(dur+.3)*1000);
    return v;}
  function reg(v,n){v.nodes.push(n);voiceNodes++;made++;return n;}
  function filt(v,type,f,q=.7){const b=reg(v,ctx.createBiquadFilter());b.type=type;b.frequency.value=f;b.Q.value=q;return b;}
  // envelope: 0 → peak over a, hold, then exponential decay with time constant tau
  function envl(g,t,a,peak,hold,tau){g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+a);if(hold)g.gain.setValueAtTime(peak,t+a+hold);g.gain.setTargetAtTime(0,t+a+hold,tau);return t+a+hold+tau*7;}
  // an oscillator partial with a pitch glide, optionally lowpassed
  function osc(v,{type='sine',f,f2=f,glide=.05,t,a=.004,peak,hold=0,tau,lp=0,dest=v.out,stop=0}){
    const o=reg(v,ctx.createOscillator()),g=reg(v,ctx.createGain());o.type=type;
    o.frequency.setValueAtTime(f,t);if(f2!==f)o.frequency.exponentialRampToValueAtTime(f2,t+glide);
    const end=stop||envl(g,t,a,peak,hold,tau);if(stop)envl(g,t,a,peak,hold,tau);
    if(lp){const l=filt(v,'lowpass',lp,.7);o.connect(l);l.connect(g);}else o.connect(g);
    g.connect(dest);o.start(t);o.stop(end);return g;}
  // a filtered noise burst, optionally sweeping its filter
  function nz(v,{buf='white',t,a=.002,peak,hold=0,tau,type='bandpass',f=1000,f2=0,sweep=.1,q=1,rate=1,dest=v.out}){
    const s=reg(v,ctx.createBufferSource()),fl=filt(v,type,f,q),g=reg(v,ctx.createGain());
    s.buffer=B[buf];s.loop=true;s.playbackRate.value=rate;
    if(f2){fl.frequency.setValueAtTime(f,t);fl.frequency.exponentialRampToValueAtTime(f2,t+sweep);}
    const end=envl(g,t,a,peak,hold,tau);
    s.connect(fl);fl.connect(g);g.connect(dest);s.start(t,Math.random()*1.5);s.stop(end);return g;}
  // Plucked string (Karplus–Strong): a noise burst circulating in a delay line with a lowpass in the
  // loop. The delay can glide, which is the rope tightening as it throws you. f must stay under ~340 Hz
  // (a delay inside a feedback loop can't be shorter than one 128-sample render block).
  function pluck(v,{f,f2=f,glide=.1,t,t60=.6,peak,bright=2400,dest=v.out}){
    f=Math.min(f,330);f2=Math.min(f2,330);const P=1/f;
    const ex=reg(v,ctx.createBufferSource()),exf=filt(v,'lowpass',bright,.5),eg=reg(v,ctx.createGain());
    ex.buffer=B.white;eg.gain.setValueAtTime(peak,t);eg.gain.setTargetAtTime(0,t+P*.7,P*.25);
    const sum=reg(v,ctx.createGain()),dl=reg(v,ctx.createDelay(.05)),lp=filt(v,'lowpass',Math.min(bright*1.4,5000),-3),fb=reg(v,ctx.createGain());   // Q is in dB: -3 = Butterworth, never above unity gain in the loop
    dl.delayTime.setValueAtTime(P,t);if(f2!==f)dl.delayTime.exponentialRampToValueAtTime(1/f2,t+glide);
    fb.gain.value=Math.min(.985,Math.pow(10,-3*P/t60));
    ex.connect(exf);exf.connect(eg);eg.connect(sum);sum.connect(dl);dl.connect(lp);lp.connect(fb);fb.connect(sum);dl.connect(dest);
    ex.start(t,Math.random());ex.stop(t+P*6+.02);}
  // Felt piano note: a few sine partials, soft 8 ms attack, higher partials die first, a felt hammer thump.
  function felt(v,f,t,peak,until=0){
    for(const[k,a,d]of[[1,1,1],[2,.3,.55],[3,.09,.35],[4.12,.02,.2]]){
      const g=osc(v,{f:f*k,t,a:.008,peak:peak*a,tau:.85*d});if(until)g.gain.setTargetAtTime(0,until,.06);}
    nz(v,{buf:'brown',t,peak:peak*1.4,tau:.018,type:'lowpass',f:260});}

  // ---------- the one-shot sound library ----------
  const S={
    // rubber stamp button: a short low thud, the rubber's give, then the paper tap
    press(){const t=now(),v=voice(.4,{pan:rnd(-.06,.06)});if(!v)return;
      osc(v,{f:jit(150,.04),f2:72,glide:.06,t,a:.002,peak:.2,tau:.04});
      nz(v,{buf:'brown',t,peak:.35,tau:.022,type:'lowpass',f:520});
      nz(v,{t:t+.005,peak:.09,tau:.011,f:jit(2100,.08),q:1.1});},
    // tool select: a light wooden tick (inharmonic wood-block partials + a hard tip)
    tool(){const t=now(),v=voice(.25,{pan:rnd(-.1,.1)});if(!v)return;const r=jit(1,.04);
      osc(v,{f:1180*r,t,a:.001,peak:.06,tau:.016});osc(v,{f:2720*r,t,a:.001,peak:.022,tau:.007});osc(v,{f:430*r,t,a:.001,peak:.04,tau:.02});
      nz(v,{t,peak:.05,tau:.003,f:3600,q:1.8});},
    // two-position switch: the lever's click, then the lower snap as it seats
    toggle(){const t=now(),v=voice(.25);if(!v)return;
      nz(v,{t,peak:.16,tau:.004,f:jit(3000,.05),q:2.2});osc(v,{f:900,t,a:.001,peak:.035,tau:.008});
      nz(v,{t:t+.028,peak:.13,tau:.005,f:1850,q:1.8});osc(v,{f:240,t:t+.028,a:.001,peak:.07,tau:.02});},
    // paper slip sliding out of the feed: grainy rising rustle over a soft body
    slip(){const t=now(),v=voice(.5,{pan:rnd(-.1,.1)});if(!v)return;
      nz(v,{buf:'grain',t,a:.03,hold:.07,peak:.11,tau:.05,f:1100,f2:2500,sweep:.16,q:.8});
      nz(v,{buf:'pink',t,a:.03,hold:.07,peak:.08,tau:.05,type:'lowpass',f:900});},
    // undo: an eraser rubbed twice (rubber chatter on paper), the second stroke shorter
    undo(){const t=now(),v=voice(.45);if(!v)return;
      nz(v,{buf:'grain',rate:.55,t,a:.02,hold:.05,peak:.26,tau:.025,f:900,q:1.3});
      nz(v,{buf:'grain',rate:.5,t:t+.11,a:.015,hold:.03,peak:.18,tau:.025,f:760,q:1.3});},
    // clear: the sheet torn off the pad: a crackling rip that slows, over the paper's swish
    clear(){const t=now(),v=voice(.8);if(!v)return;
      nz(v,{buf:'crackle',t,a:.04,hold:.2,peak:.36,tau:.05,f:2200,f2:1100,sweep:.28,q:.7});
      nz(v,{buf:'pink',t,a:.05,hold:.14,peak:.12,tau:.09,f:800,f2:380,sweep:.3,q:.8});},
    // next level: a sheet fed in (rising swish) then the platen's wooden clack
    next(){const t=now(),v=voice(.7);if(!v)return;
      nz(v,{buf:'pink',t,a:.07,hold:.06,peak:.14,tau:.05,f:500,f2:1500,sweep:.18,q:.9});
      osc(v,{f:220,t:t+.2,a:.001,peak:.14,tau:.03});osc(v,{f:545,t:t+.2,a:.001,peak:.04,tau:.014});
      nz(v,{t:t+.2,peak:.08,tau:.008,f:1500,q:1.2});},
    // locked: two dull knocks on a wooden drawer, the second lower (a polite "no")
    locked(){const t=now(),v=voice(.5);if(!v)return;
      for(const[dt,r,l]of[[0,1,1],[.1,.86,.8]]){
        osc(v,{f:190*r,f2:172*r,glide:.04,t:t+dt,a:.001,peak:.16*l,tau:.035});osc(v,{f:465*r,t:t+dt,a:.001,peak:.04*l,tau:.018});
        nz(v,{buf:'brown',t:t+dt,peak:.22*l,tau:.012,type:'lowpass',f:700});}},
    // dry pen: a nib catching and skipping on paper, fading out
    inkEmpty(){const t=now(),v=voice(.6);if(!v)return;let tt=t;
      for(let i=0;i<6;i++){const l=1-i*.13;nz(v,{buf:'grain',t:tt,a:.001,hold:rnd(.004,.018),peak:.2*l,tau:.008,f:rnd(1500,2600),q:1.5});tt+=rnd(.025,.06);}
      nz(v,{buf:'crackle',t,a:.01,hold:.18,peak:.14,tau:.04,f:2000,q:.9});},
    // felt well placed: a low "thup" (a mallet on felt), woolly and short
    well(){const t=now(),v=voice(.5);if(!v)return;
      osc(v,{f:110,f2:52,glide:.09,t,a:.003,peak:.3,tau:.065});
      nz(v,{buf:'brown',t,peak:.35,tau:.03,type:'lowpass',f:450});
      nz(v,{buf:'pink',t,a:.004,peak:.1,tau:.045,f:260,q:.9});},
    // rope set: the finished rope plucked once at the pitch it was stretched to
    ropeSet(f){const t=now(),v=voice(.9);if(!v)return;
      pluck(v,{f,t,t60:.45,peak:.35,bright:1800});},
    // the pencil lifts off: a tiny dry tick
    lift(){const t=now(),v=voice(.1);if(!v)return;nz(v,{t,peak:.03,tau:.004,f:3000,q:1.5});},

    // sling placed: a rubber band plucked once against a felt block
    slingSet(){const t=now(),v=voice(.7,{pan:rnd(-.08,.08)});if(!v)return;
      pluck(v,{f:jit(150,.03),f2:165,glide:.05,t,t60:.3,peak:.3,bright:1200});
      nz(v,{buf:'brown',t,peak:.2,tau:.015,type:'lowpass',f:500});},
    // aiming the sling: one tooth of a small wooden ratchet
    ratchet(k){const t=now(),v=voice(.12,{pan:rnd(-.1,.1)});if(!v)return;
      nz(v,{t,peak:.08+.05*k,tau:.003,f:jit(2300,.06),q:2.5});
      osc(v,{f:jit(1250,.05),t,a:.001,peak:.02,tau:.006});osc(v,{f:380,t,a:.001,peak:.03,tau:.012});},
    // sling capture: the band catches you: a soft rubbery grab (low thud + short twang)
    slingIn(){const t=now(),v=voice(.6);if(!v)return;
      osc(v,{f:140,f2:88,glide:.07,t,a:.003,peak:.16,tau:.05});
      nz(v,{buf:'brown',t,peak:.22,tau:.025,type:'lowpass',f:600});
      pluck(v,{f:118,t,t60:.22,peak:.18,bright:1000});},
    // sling release: "thwip": the band's twang snapping up, a crisp snap, and air torn past.
    // k (0..1) from release speed makes it brighter and a touch louder.
    slingOut(k){const t=now(),v=voice(.6);if(!v)return;const l=.75+.25*k;
      pluck(v,{f:170,f2:250+40*k,glide:.05,t,t60:.25,peak:.3*l,bright:1800});
      nz(v,{t,peak:.14*l,tau:.005,f:1700,q:1.4});
      nz(v,{buf:'pink',t,a:.008,hold:.03,peak:.3*l,tau:.05,f:600,f2:1800+900*k,sweep:.12,q:1});},
    // swoop "giving way": the paper gives and you're through: a muffled air thump and a short tear
    give(){const t=now(),v=voice(.7);if(!v)return;
      osc(v,{f:82,f2:55,glide:.12,t,a:.01,peak:.22,tau:.09});
      nz(v,{buf:'crackle',t,a:.006,hold:.035,peak:.3,tau:.03,f:1300,q:.8});
      nz(v,{buf:'pink',t,a:.01,peak:.22,tau:.08,type:'lowpass',f:600});},

    // push-off: a paper flex "fwp" with a small rising body
    jump(surf){const t=now(),v=voice(.35);if(!v)return;
      nz(v,{buf:'pink',t,a:.005,peak:.2,tau:.04,f:380,f2:720,sweep:.08,q:.9});
      osc(v,{f:130,f2:190,glide:.07,t,a:.004,peak:.06,tau:.04});
      if(surf==='line')osc(v,{f:520,t,a:.002,peak:.02,tau:.12});},
    // landing on card: thump + slap, both growing with impact speed; a thrummed wire on tightropes,
    // a glassy tick on ice
    land(vel,surf){const t=now(),k=clamp(((vel||200)-80)/450,0,1),v=voice(.7);if(!v)return;
      osc(v,{f:88+34*k,f2:48,glide:.1,t,a:.002,peak:.08+.24*k,tau:.05+.07*k});
      if(surf!=='ice')nz(v,{buf:'brown',t,peak:.12+.32*k,tau:.02+.03*k,type:'lowpass',f:400+1100*k});
      nz(v,{buf:'grain',t,peak:.03+.06*k,tau:.014,f:1600,q:.9});
      if(surf==='line'){osc(v,{f:260,t,a:.002,peak:.03+.04*k,tau:.25});osc(v,{f:522,t,a:.002,peak:.015+.02*k,tau:.15});}
      if(surf==='ice'){osc(v,{f:2100,t,a:.001,peak:.03,tau:.02});nz(v,{t,peak:.08+.1*k,tau:.02,type:'lowpass',f:1400});}},
    // rope bounce: a warm plucked rope gliding up a fourth as it throws you, over a round body
    bounce(vel){const t=now(),k=clamp((vel||250)/450,.5,1),v=voice(1.2);if(!v)return;const f=jit(98,.03);
      const lp=filt(v,'lowpass',1300,.6);lp.connect(v.out);
      pluck(v,{f,f2:f*1.335,glide:.12,t,t60:.7,peak:.45*k,bright:1600,dest:lp});
      osc(v,{f,f2:f*1.335,glide:.12,t,a:.012,peak:.16*k,tau:.14,dest:lp});},
    // ink drop: a water "plip" (a bubble's pitch jumps up as it closes), climbing with the streak.
    // Big drops (v 40) get a second plip a fifth above.
    drop(val,n){const t=now(),f=DROP_NOTES[Math.min(n,DROP_NOTES.length-1)],l=val<=15?.8:1,v=voice(.5,{pan:rnd(-.15,.15)});if(!v)return;
      osc(v,{f,f2:f*1.45,glide:.045,t,a:.002,peak:.2*l,tau:.05});
      osc(v,{f:f*2.01,f2:f*2.8,glide:.04,t,a:.002,peak:.025*l,tau:.02});
      nz(v,{t,peak:.05,tau:.002,f:3800,q:1.5});
      if(val>=40)osc(v,{f:f*1.5,f2:f*2.1,glide:.045,t:t+.075,a:.002,peak:.09,tau:.05});},
    // boost pad: a wind-up toy let go: a rising whoosh and a lowpassed rising buzz
    boost(){const t=now(),v=voice(.7);if(!v)return;
      nz(v,{buf:'pink',t,a:.02,hold:.05,peak:.26,tau:.07,f:500,f2:2200,sweep:.22,q:1});
      osc(v,{type:'sawtooth',f:90,f2:200,glide:.25,t,a:.01,peak:.07,tau:.12,lp:700});},
    // crumble: dry card cracking through (crackle + low crunk), then little bits landing below
    crumble(){const t=now(),v=voice(1);if(!v)return;
      nz(v,{buf:'crackle',t,a:.003,hold:.12,peak:.5,tau:.12,f:1600,q:.6});
      osc(v,{f:85,f2:50,glide:.08,t,a:.002,peak:.2,tau:.06});
      nz(v,{buf:'brown',t,peak:.28,tau:.1,type:'lowpass',f:300});
      for(let i=0;i<4;i++){const tt=t+rnd(.15,.55);nz(v,{buf:'crackle',t:tt,peak:.2*rnd(.5,1),tau:.015,f:rnd(1200,2500),q:1});}},
    // crumble warning (first touch): two small creaking cracks while it still holds
    crack(){const t=now(),v=voice(.4);if(!v)return;
      nz(v,{buf:'crackle',t,a:.002,hold:.03,peak:.16,tau:.025,f:2200,q:1});
      nz(v,{buf:'crackle',t:t+.13,a:.002,hold:.04,peak:.22,tau:.03,f:1800,q:1});},
    // fell: a breathy falling whistle, cut off, with a faint far-off thud
    fell(){const t=now(),v=voice(.8);if(!v)return;
      const g=osc(v,{f:980,f2:360,glide:.45,t,a:.03,peak:.1,tau:.5,stop:t+.5});g.gain.setTargetAtTime(0,t+.43,.008);
      nz(v,{t,a:.03,hold:.4,peak:.05,tau:.008,f:980,f2:360,sweep:.45,q:9});
      nz(v,{buf:'brown',t:t+.46,peak:.12,tau:.03,type:'lowpass',f:220});},
    // popped: a soft cork pop
    popped(){const t=now(),v=voice(.35);if(!v)return;
      osc(v,{f:320,f2:110,glide:.03,t,a:.001,peak:.2,tau:.025});
      nz(v,{t,peak:.2,tau:.012,type:'lowpass',f:1800});
      nz(v,{buf:'pink',t,peak:.1,tau:.04,f:600,q:.8});},
    // stuck: a slowly deflating note, soft and nasal, with its leaking breath
    stuck(){const t=now(),v=voice(1.2);if(!v)return;
      osc(v,{type:'triangle',f:262,f2:175,glide:.6,t,a:.03,peak:.16,hold:.45,tau:.1,lp:900});
      nz(v,{buf:'pink',t,a:.05,hold:.45,peak:.06,tau:.1,f:600,f2:350,sweep:.6,q:1});},
    // win: a felt-piano sus4 (G3 C4 F4) that resolves to C major (E4 G4 C5), strummed by hand
    win(){const t=now(),v=voice(5.5);if(!v)return;
      felt(v,196,t,.09);felt(v,261.63,t+.03,.09);felt(v,349.23,t+.06,.08,t+.34);
      felt(v,329.63,t+.34,.09);felt(v,392,t+.37,.08);felt(v,523.25,t+.41,.06);},
    // stamp 0: the big CLEARED! rubber stamp: heavy thunk, rubber mass, paper slap, the table under it
    stampBig(){const t=now(),v=voice(.9);if(!v)return;
      osc(v,{f:110,f2:42,glide:.1,t,a:.002,peak:.36,tau:.09});osc(v,{f:68,t,a:.004,peak:.14,tau:.12});
      nz(v,{buf:'brown',t,peak:.6,tau:.04,type:'lowpass',f:380});
      nz(v,{t:t+.005,peak:.16,tau:.02,f:1700,q:.9});nz(v,{buf:'grain',t:t+.005,peak:.05,tau:.01,f:3000,q:1});
      osc(v,{f:190,t:t+.01,a:.002,peak:.05,tau:.05});},
    // star stamp i (1..3): the same gesture, smaller, each a whole tone higher
    stampStar(i){const t=now(),r=Math.pow(2,(i-1)*2/12),v=voice(.5,{pan:(i-2)*.12});if(!v)return;
      osc(v,{f:170*r,f2:85*r,glide:.06,t,a:.002,peak:.22,tau:.05});
      nz(v,{buf:'brown',t,peak:.34,tau:.025,type:'lowpass',f:600*r});
      nz(v,{t:t+.004,peak:.1,tau:.012,f:2000*r,q:1});},
  };

  // every sound's level trim comes from the MIX table (set just before the sound builds its voice)
  let trim=1;
  for(const k of Object.keys(S)){const f=S[k];S[k]=function(a,b){trim=Math.pow(10,(MIX[k]||0)/20);return f(a,b);};}

  // ---------- continuous groups (built on first use, torn down when idle) ----------
  // A group is a set of looping sources and filters feeding one gate gain. It's built once and reused
  // every frame (only AudioParam targets change), and torn down after a few idle seconds.
  const G={pen:null,swoop:null,ride:null};
  function group(){const g={nodes:[],srcs:[],used:performance.now()};
    g.n=x=>{g.nodes.push(x);made++;return x;};
    g.gain=(v,to)=>{const x=g.n(ctx.createGain());x.gain.value=v;if(to)x.connect(to);return x;};
    g.filt=(type,f,q,to)=>{const x=g.n(ctx.createBiquadFilter());x.type=type;x.frequency.value=f;x.Q.value=q;if(to)x.connect(to);return x;};
    g.loop=(buf,rate=1)=>{const s=g.n(ctx.createBufferSource());s.buffer=B[buf];s.loop=true;s.playbackRate.value=rate;s.start(0,Math.random()*1.8);g.srcs.push(s);return s;};
    g.osc=(type,f,to)=>{const o=g.n(ctx.createOscillator());o.type=type;o.frequency.value=f;if(to)o.connect(to);o.start();g.srcs.push(o);return o;};
    return g;}
  function teardown(k){const g=G[k];if(!g)return;G[k]=null;
    for(const s of g.srcs){try{s.stop();}catch(e){}}for(const n of g.nodes){try{n.disconnect();}catch(e){}}}
  const IDLE={pen:4000,swoop:1500,ride:2500};
  // (an "active" group — mid-stroke, mid-ride — gets 20 s of silence before it's reclaimed)
  function sweep(){const t=performance.now();for(const k in G){const g=G[k];if(g&&t-g.used>(g.active?20000:IDLE[k]))teardown(k);}}
  // Target a param only when it has really moved, so per-frame calls don't flood the automation list.
  function aim(g,i,p,v,tc){if(Math.abs(v-g.last[i])<=Math.abs(g.last[i])*.004+1e-4)return;g.last[i]=v;p.setTargetAtTime(v,ctx.currentTime,tc);}

  // Pen: pencil (grain noise, two bands), brush (pink noise), rope (creak + rising stretch tone).
  function pen(){if(G.pen)return G.pen;const g=group();G.pen=g;
    g.out=g.gain(0,M.fx);
    // pencil: graphite grain through a bright band (the scratch) and a low band (the paper under it)
    g.lineG=g.gain(0,g.out);g.grain=g.loop('grain');
    const hp=g.filt('highpass',600,.7);g.grain.connect(hp);g.bp=g.filt('bandpass',2600,.9,g.lineG);hp.connect(g.bp);
    const body=g.filt('bandpass',900,1.1);g.grain.connect(body);body.connect(g.gain(.45,g.lineG));
    // brush: a soft breathy stroke
    g.windG=g.gain(0,g.out);const pk=g.loop('pink');g.wlp=g.filt('lowpass',2000,.5,g.windG);g.wbp=g.filt('bandpass',800,.7,g.wlp);pk.connect(g.wbp);
    // rope: stick-slip creak (a slow sawtooth ringing a resonant band, its rate wobbling) and the
    // string's pitch rising as you pull it tighter
    g.ropeG=g.gain(0,g.out);g.cbp=g.filt('bandpass',700,7,g.gain(.9,g.ropeG));g.saw=g.osc('sawtooth',30,g.cbp);
    g.osc('sine',3.3,g.gain(7,g.saw.frequency));
    g.slp=g.filt('lowpass',700,.7,g.gain(.35,g.ropeG));g.str=g.osc('triangle',140,g.slp);
    g.last=new Float32Array(8).fill(-1);g.tool=null;g.dist=0;g.at=0;return g;}
  const PEN_LVL={line:.65,wind:.35,rope:.15};

  // Swoop whoosh: pink noise band + slowed paper grain (the flutter of sheets rushing past).
  function swoop(){if(G.swoop)return G.swoop;const g=group();G.swoop=g;
    g.out=g.gain(0,M.fx);g.duck=g.gain(1,g.out);
    g.bp=g.filt('bandpass',400,.8,g.duck);g.loop('pink').connect(g.bp);
    g.gr=g.loop('grain',.45);g.gbp=g.filt('bandpass',1100,1,g.gain(.35,g.duck));g.gr.connect(g.gbp);
    g.last=new Float32Array(4).fill(-1);g.p=0;g.gave=false;g.watch=0;return g;}

  // Ride: every surface texture runs at once; ride() just moves their gains and pitches.
  function rideGroup(){if(G.ride)return G.ride;const g=group();G.ride=g;
    g.gate=g.gain(0,M.dry);
    const brown=g.loop('brown'),white=g.loop('white'),pink=g.loop('pink'),grain=g.loop('grain',.8);g.grain=grain;
    // rolling rhythm: the ball's rotation rate, a gentle tremolo on road and wire
    g.tread=g.osc('sine',4);
    // road: card rumble (brown noise, speed opens the lowpass, a cardboard resonance) + paper grit
    g.roadG=g.gain(0,g.gate);const roadAM=g.gain(.8,g.roadG);g.tread.connect(g.gain(.2,roadAM.gain));
    const pkc=g.filt('peaking',320,1.4,roadAM);pkc.gain.value=6;g.roadLP=g.filt('lowpass',300,.7,pkc);brown.connect(g.roadLP);
    g.gritBP=g.filt('bandpass',1600,.8,g.gain(.25,roadAM));grain.connect(g.gritBP);
    // tightrope: a thin wire hum (three slightly stretched partials + bowed noise at the 2nd),
    // pitch tracks speed and bends with sway
    g.wireG=g.gain(0,g.gate);const wireAM=g.gain(.85,g.wireG);g.tread.connect(g.gain(.15,wireAM.gain));
    const wlp=g.filt('lowpass',1800,.5,wireAM);
    g.w1=g.osc('sine',220,g.gain(.5,wlp));g.w2=g.osc('sine',441,g.gain(.2,wlp));g.w3=g.osc('sine',663,g.gain(.07,wlp));
    g.wbp=g.filt('bandpass',440,25,g.gain(2.5,wlp));white.connect(g.wbp);
    // tightrope creak: stick-slip clicks ringing a woody band, panned with the sway
    g.creakG=g.gain(0);g.pan=ctx.createStereoPanner?g.n(ctx.createStereoPanner()):null;
    if(g.pan){g.creakG.connect(g.pan);g.pan.connect(g.gate);}else g.creakG.connect(g.gate);
    g.cbp=g.filt('bandpass',520,6,g.creakG);g.saw=g.osc('sawtooth',14,g.cbp);
    // rope underfoot: a low stretched twang whose pitch sags as it takes your weight
    g.ropeG=g.gain(0,g.gate);const rlp=g.filt('lowpass',500,.7,g.ropeG);g.r1=g.osc('sine',140,rlp);g.r2=g.osc('sine',282,g.gain(.3,rlp));
    // ice: a smooth glassy hiss, no grain, with a faint beating shimmer
    g.iceG=g.gain(0,g.gate);g.iceBP=g.filt('bandpass',3000,.6,g.iceG);white.connect(g.iceBP);
    const shim=g.gain(.012,g.iceG);g.s1=g.osc('sine',1320,shim);g.s2=g.osc('sine',1326,shim);
    // air: wind rushing past, brighter with speed
    g.airG=g.gain(0,g.gate);g.airBP=g.filt('bandpass',400,.5,g.airG);pink.connect(g.airBP);
    // wind current: a gusting breathy hiss (the brush from the drawing, now all around you)
    g.windG=g.gain(0,g.gate);const wam=g.gain(.75,g.windG);g.osc('sine',.13,g.gain(.25,wam.gain));
    g.windBP=g.filt('bandpass',900,1.1,wam);pink.connect(g.windBP);g.osc('sine',.45,g.gain(320,g.windBP.frequency));
    // boost pad: a whirring fluttery buzz, like a spinning toy flywheel
    g.boostG=g.gain(0,g.gate);const bam=g.gain(.7,g.boostG);g.osc('sine',26,g.gain(.3,bam.gain));
    g.boostLP=g.filt('lowpass',600,3,bam);g.bsaw=g.osc('sawtooth',70,g.boostLP);
    // sling orbit: the band stretching (stick-slip creak in a rubbery band) over air whooshing round,
    // and a taut hum whose pitch climbs as the orbit winds toward release
    g.slingG=g.gain(0,g.gate);
    g.slBP=g.filt('bandpass',500,1,g.slingG);pink.connect(g.slBP);
    g.slCbp=g.filt('bandpass',420,5,g.gain(.6,g.slingG));g.slSaw=g.osc('sawtooth',20,g.slCbp);
    g.slLP=g.filt('lowpass',700,-3,g.gain(.35,g.slingG));g.slHum=g.osc('triangle',110,g.slLP);
    g.last=new Float32Array(40).fill(-1);g.world=null;g.streak=0;g.warned=new Uint8Array(64);g.swayPrev=0;g.watch=-1;g.active=true;
    return g;}
  // loudness of each loop at full intensity (see the mix table)
  const RIDE_LVL={road:.11,wire:.09,creak:.35,rope:.045,ice:.08,air:.25,wind:.3,boost:.08,sling:.18};

  // ---------- public API ----------
  const api={
    unlock(){if(dead)return;
      if(!ctx){ctx=opts.context||new AC({latencyHint:'interactive'});build();
        if(!offline){const b=ctx.createBuffer(1,1,ctx.sampleRate),s=ctx.createBufferSource();s.buffer=b;s.connect(ctx.destination);s.start();}}  // iOS unlock
      if(!offline&&ctx.state!=='running'&&!muted){const p=ctx.resume();if(p&&p.catch)p.catch(()=>{});}},
    setMuted(m){muted=!!m;if(!ctx||!M)return;const t=now();hold(M.master.gain,t);M.master.gain.setTargetAtTime(muted?0:volGain(),t,.03);
      if(offline)return;
      if(muted){for(const k in G)if(G[k])G[k].active=false;setTimeout(()=>{if(muted&&ctx.state==='running')ctx.suspend().catch(()=>{});},200);}   // nothing to hear: stop the clock
      else if(ctx.state!=='running'){const p=ctx.resume();if(p&&p.catch)p.catch(()=>{});}},
    setVolume(x){volume=clamp(+x||0,0,1);if(!ctx||!M||muted)return;const t=now();hold(M.master.gain,t);M.master.gain.setTargetAtTime(volGain(),t,.03);},
    ui(name){if(!ok())return;const f=S[name];if(f&&name!=='give'&&name in UI_NAMES)f();},
    draw(tool,phase,speed){if(!ok())return;
      if(tool==='well'){if(phase==='start')S.well();return;}
      if(tool==='sling'){const tt=performance.now();   // place = one pluck (start/end may both arrive); aim = ratchet ticks
        if(phase!=='move'){if(tt-lastSling>150){lastSling=tt;S.slingSet();}}
        else if(tt-lastTick>=60&&tt-lastSling>80){lastTick=tt;S.ratchet(clamp((+speed||0)/800,0,1));}
        return;}
      if(!PEN_LVL[tool])return;
      const g=pen(),t=now();g.used=performance.now();
      if(phase==='start'||!g.tool){g.tool=tool;g.dist=0;g.at=t;g.active=true;
        for(const k of['line','wind','rope']){const p=g[k+'G'].gain;hold(p,t);p.setTargetAtTime(k===tool?1:0,t,.008);}
        g.last.fill(-1);}
      if(phase==='end'){hold(g.out.gain,t);g.out.gain.setTargetAtTime(0,t,.025);g.active=false;
        if(g.tool==='rope'&&g.dist>20)S.ropeSet(g.str.frequency.value);else if(g.tool==='line')S.lift();return;}
      tool=g.tool||tool;speed=Math.max(0,+speed||0);
      const dt=clamp(t-g.at,0,.1);g.at=t;g.dist+=speed*dt;
      const u=1-Math.exp(-speed/450),lvl=u<.02?0:(.2+.8*u)*PEN_LVL[tool];
      // the gate decays by itself ~90 ms after the last move, so a pen held still goes quiet
      hold(g.out.gain,t);g.out.gain.setTargetAtTime(lvl,t,.025);g.out.gain.setTargetAtTime(0,t+.09,.04);
      if(tool==='line'){aim(g,0,g.bp.frequency,1900+2300*u,.03);aim(g,1,g.grain.playbackRate,.8+.45*u,.03);}
      else if(tool==='wind'){aim(g,2,g.wbp.frequency,500+1000*u,.04);aim(g,3,g.wlp.frequency,1400+1600*u,.04);}
      else{aim(g,4,g.saw.frequency,16+48*u,.03);aim(g,5,g.cbp.frequency,600+260*u,.04);
        aim(g,6,g.str.frequency,140*(1+Math.min(g.dist,500)/500),.05);}},
    inkEmpty(){if(!ok())return;const t=performance.now();if(t-lastEmpty<380)return;lastEmpty=t;S.inkEmpty();},
    transition(p){if(!ok())return;p=clamp(+p||0,0,1);
      const g=swoop(),t=now();g.used=performance.now();
      if(p<g.p-.05||!g.active){g.gave=false;g.active=true;}              // a new swoop
      if(p>=1){if(g.active){hold(g.out.gain,t);g.out.gain.setTargetAtTime(0,t,.06);g.active=false;}g.p=p;return;}
      // loudest and brightest in the middle of the move, like air rushing past at top speed
      const a=Math.pow(Math.sin(Math.PI*Math.pow(p,1.15)),1.3);
      aim(g,0,g.bp.frequency,300+1700*a,.04);aim(g,1,g.gr.playbackRate,.4+.5*a,.05);aim(g,2,g.gbp.frequency,800+900*a,.05);
      if(t-g.watch>.08||Math.abs(a-g.last[3])>.05){g.watch=t;g.last[3]=a;hold(g.out.gain,t);g.out.gain.setTargetAtTime(.32*a+.02,t,.03);g.out.gain.setTargetAtTime(0,t+.2,.05);}
      // the give: the paper resists (the rush dips) and then you're through
      if(!g.gave&&g.p<.47&&p>=.47&&p<.8){g.gave=true;const d=g.duck.gain;hold(d,t);d.setTargetAtTime(.4,t,.012);d.setTargetAtTime(1,t+.06,.05);S.give();}
      g.p=p;},
    ride(world,dt){if(!ok()||!world||!world.rider)return;
      const g=rideGroup(),t=now(),r=world.rider;g.used=performance.now();g.active=true;
      if(G.swoop&&G.swoop.active){const s=G.swoop;hold(s.out.gain,t);s.out.gain.setTargetAtTime(0,t,.06);s.active=false;}   // swoop done
      if(world!==g.world){g.world=world;g.streak=0;g.warned.fill(0);g.swayPrev=0;}
      const sp=r.speed||0,u=clamp(sp/500,0,1.1),kind=r.grounded?(r.surface||r.groundKind):null;
      const sway=clamp(r.sway||0,-1,1),sr=dt>0?Math.abs(sway-g.swayPrev)/dt:0;g.swayPrev=sway;
      const path=world.path,inWind=r.inWind!=null?!!r.inWind:!!(path&&path.length&&path[path.length-1][3]===3);
      const boosting=r.grounded&&r.boost!=null&&r.boost>=0;
      let depth=0;if(kind==='rope'&&world.ropes)for(const rp of world.ropes)if(rp.side&&rp.depth>depth)depth=rp.depth;
      const moving=Math.min(1,sp/40),L=RIDE_LVL;
      aim(g,0,g.roadG.gain,(kind==='block'||kind==='crumble')?L.road*moving*(.3+.7*u):0,.04);
      aim(g,1,g.wireG.gain,kind==='line'?L.wire*Math.min(1,sp/60)*(.5+.5*u):0,.04);
      aim(g,2,g.creakG.gain,kind==='line'?L.creak*Math.min(1,Math.pow(Math.abs(sway),1.3)*.7+Math.min(1,sr*.35)*.5):0,.05);
      aim(g,3,g.ropeG.gain,kind==='rope'?L.rope*clamp(depth/10,.15,1):0,.03);
      aim(g,4,g.iceG.gain,kind==='ice'?L.ice*moving*(.35+.65*u):0,.04);
      const slung=r.sling!=null&&r.sling>=0,K=slung?clamp(+r.slingK||0,0,1):0;
      aim(g,25,g.slingG.gain,slung?L.sling*(.45+.55*K):0,.03);
      aim(g,26,g.slBP.frequency,450+1400*K,.03);aim(g,27,g.slSaw.frequency,18+40*K,.03);
      aim(g,28,g.slCbp.frequency,380+320*K,.03);aim(g,29,g.slHum.frequency,110*(1+K),.03);
      aim(g,5,g.airG.gain,(slung?.4:1)*L.air*(!r.grounded?clamp((sp-60)/480,0,1):.25*clamp((sp-250)/300,0,1)),.06);
      aim(g,6,g.windG.gain,inWind?L.wind:0,.08);
      aim(g,7,g.boostG.gain,boosting?L.boost:0,.04);
      // pitches and colours
      aim(g,8,g.roadLP.frequency,160+900*u,.05);aim(g,9,g.gritBP.frequency,1200+1400*u,.05);
      aim(g,10,g.tread.frequency,clamp(sp/56.5,.5,14),.05);aim(g,11,g.grain.playbackRate,.6+.6*u,.05);
      const f0=(190+260*u)*(1+.035*sway);aim(g,12,g.w1.frequency,f0,.04);aim(g,13,g.w2.frequency,f0*2.004,.04);aim(g,14,g.w3.frequency,f0*3.01,.04);aim(g,15,g.wbp.frequency,f0*2,.04);
      aim(g,16,g.saw.frequency,9+30*Math.abs(sway)+6*Math.min(1,sr),.05);aim(g,17,g.cbp.frequency,480+200*Math.abs(sway),.05);
      if(g.pan)aim(g,18,g.pan.pan,sway*.35,.05);
      const rf=clamp(150-5*depth,70,150);aim(g,19,g.r1.frequency,rf,.03);aim(g,20,g.r2.frequency,rf*2.01,.03);
      aim(g,21,g.iceBP.frequency,2400+2400*u,.05);aim(g,22,g.airBP.frequency,250+1100*u,.06);
      aim(g,23,g.bsaw.frequency,55+110*u,.05);aim(g,24,g.boostLP.frequency,500+700*u,.05);
      // crumbling block, first touch: a warning crack while it still holds
      if(world.crumbles)for(let i=0;i<world.crumbles.length&&i<64;i++){const c=world.crumbles[i];if(c&&c.touchedAt!=null&&!c.gone&&!g.warned[i]){g.warned[i]=1;S.crack();}}
      // watchdog: the gate stays open while ride() keeps being called and closes by itself ~0.3 s after
      if(t-g.watch>.1||g.watch<0){g.watch=t;const p=g.gate.gain;hold(p,t);p.setTargetAtTime(1,t,.03);p.setTargetAtTime(0,t+.3,.05);}},
    event(e){if(!ok()||!e)return;const g=G.ride,r=g&&g.world&&g.world.rider,surf=r?(r.surface||r.groundKind):null;
      const tt=performance.now();if(lastEv[e.type]&&tt-lastEv[e.type]<40)return;lastEv[e.type]=tt;
      switch(e.type){
        case'jump':return S.jump(surf);
        case'land':return S.land(e.v,surf);
        case'bounce':return S.bounce(e.v!=null?e.v:r?r.speed:250);
        case'drop':{const n=g?g.streak++:dropN++;return S.drop(e.v||25,n);}
        case'boost':return S.boost();
        case'sling':return S.slingIn();
        case'slingOut':return S.slingOut(clamp(((e.v!=null?e.v:(r?r.speed:450))-320)/380,0,1));
        case'crumble':return S.crumble();
        case'win':return S.win();
        case'fell':return S.fell();
        case'popped':return S.popped();
        case'stuck':return S.stuck();}},
    stamp(i){if(!ok())return;(i|0)===0?S.stampBig():S.stampStar(clamp(i|0,1,3));},
    stopRide(){if(!ctx||!M)return;const g=G.ride;dropN=0;if(!g)return;
      const t=now(),p=g.gate.gain;hold(p,t);p.setTargetAtTime(0,t,.035);p.setValueAtTime(0,t+.18);   // ~95% gone in 105 ms, silent at 180
      g.world=null;g.streak=0;g.watch=-1;g.active=false;g.used=performance.now();},
    // dev/test only
    _stats(){return{state:ctx?ctx.state:'none',voices,voiceNodes,groupNodes:Object.values(G).reduce((s,g)=>s+(g?g.nodes.length:0),0),
      groups:Object.keys(G).filter(k=>G[k]),masterNodes:M?M.nodes.length:0,created:made};},
    get _ctx(){return ctx;},
  };
  const UI_NAMES={press:1,tool:1,undo:1,clear:1,toggle:1,slip:1,locked:1,next:1};
  let lastEmpty=-1e9,dropN=0,lastSling=-1e9,lastTick=-1e9;const lastEv={};
  // Never let sound break the game: every public method swallows its own errors.
  for(const k of Object.keys(api)){const f=api[k];if(typeof f!=='function'||k[0]==='_')continue;
    api[k]=function(a,b,c){if(dead)return;try{return f.call(api,a,b,c);}catch(err){if(!warnedErr){warnedErr=true;console.warn('audio:',err);}}};}
  return api;}
