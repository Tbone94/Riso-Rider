// riso.js — a risograph print engine.
// Pictures are made the way a riso makes them: one density map per ink drum,
// screened into halftone dots or grain, textured, nudged out of register,
// and multiplied onto paper. Density maps come from procedural scenes
// (Riso.renderScene) or from separating a real image into inks (Riso.separate).
(function(global){
'use strict';
const TAU=Math.PI*2;

// Approximations of the published Riso ink colors.
const INKS={
  'Yellow':'#ffe800','Sunflower':'#ffb511','Orange':'#ff6c2f','Fluorescent Pink':'#ff48b0',
  'Bright Red':'#f15060','Red':'#ff665e','Coral':'#ff8e91','Burgundy':'#914e72',
  'Purple':'#765ba7','Violet':'#9d7ad2','Blue':'#0078bf','Medium Blue':'#3255a4',
  'Federal Blue':'#3d5588','Aqua':'#5ec8e5','Teal':'#00838a','Mint':'#82d8d5',
  'Green':'#00a95c','Hunter Green':'#407060','Moss':'#68724d','Flat Gold':'#bb8b41',
  'Brick':'#a75154','Light Gray':'#88898a','Black':'#000000',
};
const PAPERS={'Natural':'#f2ede3','White':'#faf9f6','Cream':'#f5ecd7','Kraft':'#d8c3a0','Blush':'#f7dcd6','Mint':'#dcefe6'};
// Ink order is light → mid → dark (key), matching scene slots.
const PRESETS={
  'Zine':['Yellow','Fluorescent Pink','Blue'],
  'Ukiyo-e':['Flat Gold','Bright Red','Medium Blue'],
  'Park poster':['Sunflower','Orange','Federal Blue'],
  'Forest':['Yellow','Green','Hunter Green'],
  'Dusk':['Coral','Violet','Federal Blue'],
  'Sea glass':['Mint','Aqua','Teal'],
  'Cutouts':['Sunflower','Bright Red','Medium Blue'],
  'Moody':['Light Gray','Brick','Black'],
};

// ---------- noise ----------
function hash2(x,y,s){let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,982451653))|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return(h>>>0)/4294967296;}
function vnoise(x,y,s){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash2(xi,yi,s),b=hash2(xi+1,yi,s),c=hash2(xi,yi+1,s),d=hash2(xi+1,yi+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function rng(seed){let s=(Math.imul(seed|0,2654435761)>>>0)||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const gauss=r=>(r()+r()+r()+r()-2)*1.732;
const rgb01=hex=>{const n=parseInt(hex.slice(1),16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];};
const clamp01=v=>v<0?0:v>1?1:v;

// A 128² blue-noise threshold tile: white noise, high-passed a few times, then rank-ordered back to
// uniform. Stochastic like white noise but without its low-frequency clumps, so a flat tint prints as
// a fine, even grain (like a riso's Grain Touch) instead of TV static.
let BLUE=null;
function blueTile(){if(BLUE)return BLUE;const N=128,n=N*N,r=rng(4242),v=new Float32Array(n),t=new Float32Array(n);for(let i=0;i<n;i++)v[i]=r();
  const box=(a,b,dx,dy)=>{for(let y=0;y<N;y++)for(let x=0;x<N;x++){let s=0;for(let k=-2;k<=2;k++)s+=a[((y+k*dy+N)%N)*N+(x+k*dx+N)%N];b[y*N+x]=s/5;}};
  for(let pass=0;pass<3;pass++){const u=new Float32Array(n);box(v,t,1,0);box(t,u,0,1);for(let i=0;i<n;i++)v[i]-=u[i];}
  const idx=Array.from({length:n},(_,i)=>i).sort((a,b)=>v[a]-v[b]),out=new Float32Array(n);idx.forEach((k,i)=>out[k]=(i+.5)/n);return BLUE=out;}

// ---------- printing ----------
// layer: {ink:'#hex', density:Float32Array(w*h), screen:'dots'|'grain'|'solid'|'mixed',
//         cell:px, angle:deg, offset:[dx,dy], rot:deg, dotMask?:Float32Array(w*h), noise?:'white'|'blue'}
// 'grain' is the riso's native stochastic texture (Grain Touch); 'dots' is an AM halftone screen.
// 'mixed' prints grain, switching to dots only where dotMask > .5: the scene's deliberate halftone accents.
// Grain thresholds against white noise by default; noise:'blue' (the default for 'mixed') uses the blue-noise tile.
function screenLayer(L,w,h,seed,tex){
  const D=L.density,cov=new Float32Array(w*h),cx=w/2,cy=h/2;
  const ra=(L.rot||0)*Math.PI/180,cr=Math.cos(ra),sr=Math.sin(ra),[ox,oy]=L.offset||[0,0];
  const an=(L.angle??15)*Math.PI/180,ca=Math.cos(an),sa=Math.sin(an),cell=L.cell||6,mode=L.screen||'dots',DM=mode==='mixed'?L.dotMask:null;
  const at=(x,y)=>{x=x|0;y=y|0;return x<0||y<0||x>=w||y>=h?0:D[y*w+x];};
  const dm=(x,y)=>{x=x|0;y=y|0;return x<0||y<0||x>=w||y>=h?0:DM[y*w+x];};
  const BN=(L.noise||(mode==='mixed'?'blue':'white'))==='blue'?blueTile():null,bx=(hash2(seed,1,5)*128)|0,by=(hash2(seed,2,5)*128)|0;
  for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i++){
    const dx=x-cx-ox,dy=y-cy-oy,sx=cx+dx*cr+dy*sr,sy=cy-dx*sr+dy*cr;
    const m=mode!=='mixed'?mode:DM&&dm(sx,sy)>.5?'dots':'grain';
    let c;
    if(m==='dots'){
      const u=(sx*ca+sy*sa)/cell,v=(-sx*sa+sy*ca)/cell,iu=Math.floor(u)+.5,iv=Math.floor(v)+.5;
      const d=at((iu*ca-iv*sa)*cell,(iu*sa+iv*ca)*cell);
      if(d>.96)c=1;else{const R=.74*Math.pow(d,.7),dist=Math.hypot(u-iu,v-iv);c=clamp01((R-dist)*cell+.5);}
    }else if(m==='grain'){const d=at(sx,sy),th=BN?BN[((y+by)&127)*128+((x+bx)&127)]:hash2(x,y,seed+3);c=clamp01((d-th)*5+.5);}
    else c=at(sx,sy);
    if(c<=0)continue;
    const hole=hash2(x,y,seed+7)<.1*tex?.2:1;
    const mott=1-.2*tex*vnoise(x/70,y/70,seed+11);
    const streak=1-.12*tex*vnoise(x/500,y/2.2,seed+13);
    cov[i]=c*hole*mott*streak;
  }
  return cov;}

function print(o){
  const{w,h}=o,P=rgb01(o.paper||PAPERS.Natural),tex=o.texture??1,seed=o.seed||1,acc=new Float32Array(w*h*3);
  for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i++){const f=1-tex*(.03*hash2(x,y,seed)+.035*vnoise(x/50,y/12,seed+3));acc[i*3]=P[0]*f;acc[i*3+1]=P[1]*f;acc[i*3+2]=P[2]*f;}
  o.layers.forEach((L,li)=>{if(!L||!L.ink||!L.density)return;
    const K=rgb01(L.ink),k0=1-K[0],k1=1-K[1],k2=1-K[2],cov=screenLayer(L,w,h,seed+li*101,tex);
    for(let i=0;i<w*h;i++){const c=cov[i];if(c<=0)continue;acc[i*3]*=1-c*k0;acc[i*3+1]*=1-c*k1;acc[i*3+2]*=1-c*k2;}});
  const img=new ImageData(w,h),d=img.data;
  for(let i=0;i<w*h;i++){d[i*4]=acc[i*3]*255;d[i*4+1]=acc[i*3+1]*255;d[i*4+2]=acc[i*3+2]*255;d[i*4+3]=255;}
  return img;}

// Standard riso-ish print settings for 1–3 layers, with misregistration from a seed.
// o.screen is one screen for every plate ('dots' by default, as before) or an array, one per plate.
// A scene's halftone-accent mask (dens.dots, from renderScene) rides along and is used only by 'mixed'.
// o.noise ('white'|'blue') picks the grain's threshold noise; unset keeps each screen's default.
function layersFor(dens,inks,o={}){
  const r=rng((o.seed||1)+99),mis=o.mis??2.5,ang=[15,75,45],scr=i=>(Array.isArray(o.screen)?o.screen[i]:o.screen)||'dots';
  return dens.map((d,i)=>({ink:inks[i],density:d,screen:scr(i),dotMask:dens.dots||null,noise:o.noise,cell:(o.cell||6)*(i===0?1.15:1),angle:ang[i%3],
    offset:i===dens.length-1?[0,0]:[gauss(r)*mis,gauss(r)*mis],rot:i===dens.length-1?0:gauss(r)*.06*mis}));}

// ---------- density-map utilities ----------
function densityFromCanvas(cv){const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data,n=cv.width*cv.height,o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=d[i*4+3]/255;return o;}
// Fade ink out of the middle of the page so the playfield stays readable.
// shape 'oval' (default) clears a centred ellipse. 'band' clears the horizontal band where side-view
// gameplay lives (ledges at the left edge, rings at the right, so the full width), leaving the top and
// bottom strips and the corners at full strength. 'high' is the band carried up to the top edge, for
// levels whose play runs along the top of the sheet.
function calmMask(x,y,w,h,shape){
  if(shape==='band'||shape==='high'){const dy=shape==='high'?Math.max(0,y/h-.52):Math.abs(y/h-.52),t=clamp01((.47-dy)/.17),ex=Math.min(x/w,1-x/w),k=.8+.2*clamp01(ex/.08);return t*t*(3-2*t)*k;}
  const ex=(x/w-.5)/.42,ey=(y/h-.5)/.4,r=Math.sqrt(ex*ex+ey*ey),t=clamp01((1.1-r)/.5);return t*t*(3-2*t);}
function applyCalm(d,w,h,amt,shape){if(!amt)return d;for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i++)d[i]*=1-amt*calmMask(x,y,w,h,shape);return d;}
function blur(d,w,h,r){if(r<1)return d;const t=new Float32Array(w*h);
  for(let pass=0;pass<2;pass++){
    for(let y=0;y<h;y++){let s=0;const row=y*w;for(let x=-r;x<=r;x++)s+=d[row+Math.min(w-1,Math.max(0,x))];for(let x=0;x<w;x++){t[row+x]=s/(2*r+1);s+=d[row+Math.min(w-1,x+r+1)]-d[row+Math.max(0,x-r)];}}
    for(let x=0;x<w;x++){let s=0;for(let y=-r;y<=r;y++)s+=t[Math.min(h-1,Math.max(0,y))*w+x];for(let y=0;y<h;y++){d[y*w+x]=s/(2*r+1);s+=t[Math.min(h-1,y+r+1)*w+x]-t[Math.max(0,y-r)*w+x];}}}
  return d;}
function posterize(d,steps){if(!steps)return d;for(let i=0;i<d.length;i++)d[i]=Math.round(d[i]*steps)/steps;return d;}

// ---------- separating a real image into inks ----------
// Each pixel is modeled as paper × Π(1 − dᵢ·(1 − inkᵢ)); the best dᵢ per color
// comes from brute force over a grid of ink amounts, cached in a 32³ color LUT.
function inkTable(inks,paper,L){
  const n=inks.length,K=inks.map(rgb01),P=rgb01(paper),total=L**n,amt=new Float32Array(total*n),col=new Float32Array(total*3);
  for(let c=0;c<total;c++){let r=P[0],g=P[1],b=P[2],t=c;for(let i=0;i<n;i++){const d=(t%L)/(L-1);t=(t/L)|0;amt[c*n+i]=d;r*=1-d*(1-K[i][0]);g*=1-d*(1-K[i][1]);b*=1-d*(1-K[i][2]);}col[c*3]=r;col[c*3+1]=g;col[c*3+2]=b;}
  return{n,total,amt,col};}
function nearest(T,r,g,b){let bi=0,be=1e9;const{col,total,amt,n}=T;
  for(let c=0;c<total;c++){const dr=col[c*3]-r,dg=col[c*3+1]-g,db=col[c*3+2]-b,dl=(dr*.3+dg*.59+db*.11);let e=dr*dr*.3+dg*dg*.59+db*db*.11+dl*dl*2;
    for(let i=0;i<n;i++)e+=amt[c*n+i]*.0015;if(e<be){be=e;bi=c;}}return[bi,be];}
// Old prints sit on yellowed paper. Estimate the paper tone from the brightest
// 4% of pixels and scale it back to white so it doesn't soak up ink.
function paperTone(d){const n=d.length/4,step=Math.max(1,(n/4000)|0),S=[];
  for(let i=0;i<n;i+=step)S.push([d[i*4],d[i*4+1],d[i*4+2]]);S.sort((a,b)=>(b[0]*.3+b[1]*.59+b[2]*.11)-(a[0]*.3+a[1]*.59+a[2]*.11));
  const top=S.slice(0,Math.max(1,(S.length*.04)|0)),m=[0,1,2].map(k=>top.reduce((s,p)=>s+p[k],0)/top.length/255);return m.map(v=>Math.max(.35,v));}
function adjust(img,o){const d=img.data,con=o.contrast??1,bri=o.brightness??0,sat=o.saturation??1,out=new Float32Array(img.width*img.height*3);
  const wp=o.agedPaper?paperTone(d):[1,1,1];
  for(let i=0,j=0;i<d.length;i+=4,j+=3){let r=Math.min(1,d[i]/255/wp[0]),g=Math.min(1,d[i+1]/255/wp[1]),b=Math.min(1,d[i+2]/255/wp[2]);const l=r*.3+g*.59+b*.11;
    r=l+(r-l)*sat;g=l+(g-l)*sat;b=l+(b-l)*sat;out[j]=clamp01((r-.5)*con+.5+bri);out[j+1]=clamp01((g-.5)*con+.5+bri);out[j+2]=clamp01((b-.5)*con+.5+bri);}
  return out;}
// Tone map: ignore the source hues and split light → dark tones across the inks
// (lightest ink takes the highlights, darkest the shadows), like a screenprint recolor.
function toneSplit(px,w,h,inks){const lum=c=>{const[r,g,b]=rgb01(c);return r*.3+g*.59+b*.11;};
  const order=inks.map((c,i)=>i).sort((a,b)=>lum(inks[b])-lum(inks[a])),n=inks.length,dens=inks.map(()=>new Float32Array(w*h));
  const ss=(a,b,x)=>{const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
  // [rise from, rise to, fall from, fall to]: each ink hands the deeper tones to the next,
  // keeping a little underneath so shadows stay rich rather than a single flat ink.
  const bands=n===2?[[.08,.4,.6,.95],[.4,.8,2,2]]:[[.05,.3,.45,.75],[.3,.55,.7,.95],[.55,.85,2,2]],keep=[.25,.35,1];
  for(let i=0;i<w*h;i++){const t=1-(px[i*3]*.3+px[i*3+1]*.59+px[i*3+2]*.11);
    order.forEach((k,j)=>{const[a,b,c,d]=bands[j],kp=j===n-1?1:keep[j];dens[k][i]=ss(a,b,t)*(1-(1-kp)*ss(c,d,t));});}
  return dens;}
function separate(img,inks,paper,o={}){
  if(o.method==='tone'){const dens=toneSplit(adjust(img,o),img.width,img.height,inks);dens.forEach(d=>{blur(d,img.width,img.height,o.soften|0);posterize(d,o.posterize|0);});return dens;}
  const n=inks.length,T=inkTable(inks,paper,n<=2?17:n===3?11:7),w=img.width,h=img.height,B=32,lut=new Int32Array(B*B*B).fill(-1);
  const px=adjust(img,o),dens=inks.map(()=>new Float32Array(w*h));
  for(let i=0;i<w*h;i++){const r=px[i*3],g=px[i*3+1],b=px[i*3+2],k=((r*(B-1)+.5)|0)*B*B+((g*(B-1)+.5)|0)*B+((b*(B-1)+.5)|0);
    let c=lut[k];if(c<0)c=lut[k]=nearest(T,r,g,b)[0];for(let j=0;j<n;j++)dens[j][i]=T.amt[c*n+j];}
  dens.forEach(d=>{blur(d,w,h,o.soften|0);posterize(d,o.posterize|0);});
  return dens;}
// Pick the n inks from a pool that reproduce an image best.
function suggestInks(img,paper,n=3,pool){
  pool=pool||['Yellow','Sunflower','Orange','Fluorescent Pink','Bright Red','Coral','Burgundy','Violet','Blue','Medium Blue','Federal Blue','Aqua','Teal','Green','Hunter Green','Flat Gold','Black'];
  const px=adjust(img,{agedPaper:true}),r=rng(5),S=[];for(let k=0;k<500;k++){const i=(r()*img.width*img.height)|0;S.push([px[i*3],px[i*3+1],px[i*3+2]]);}
  let best=null,be=1e9;const combos=[];
  (function pick(start,acc){if(acc.length===n){combos.push(acc.slice());return;}for(let i=start;i<pool.length;i++){acc.push(pool[i]);pick(i+1,acc);acc.pop();}})(0,[]);
  for(const combo of combos){const T=inkTable(combo.map(c=>INKS[c]),paper,n<=2?9:6);let e=0;for(const s of S){e+=nearest(T,s[0],s[1],s[2])[1];if(e>be)break;}if(e<be){be=e;best=combo;}}
  const lum=c=>{const[r,g,b]=rgb01(INKS[c]);return r*.3+g*.59+b*.11;};
  return best.sort((a,b)=>lum(b)-lum(a));}
// Cover-crop into w×h. fx/fy (0–1) choose which part of the image stays in frame; zoom ≥ 1 crops tighter.
function fitImage(src,w,h,o={}){const cv=document.createElement('canvas');cv.width=w;cv.height=h;const g=cv.getContext('2d'),sw=src.naturalWidth||src.width,sh=src.naturalHeight||src.height,k=Math.max(w/sw,h/sh)*(o.zoom||1);
  g.fillStyle='#fff';g.fillRect(0,0,w,h);g.drawImage(src,(w-sw*k)*(o.fx??.5),(h-sh*k)*(o.fy??.5),sw*k,sh*k);return g.getImageData(0,0,w,h);}

// ---------- procedural scenes ----------
// Drawn in an 800×500 design space onto three slot canvases: light, mid, dark.
// Opacity is ink density. Each recipe borrows the vocabulary of a real print tradition.
const W=800,H=500;
const A=a=>`rgba(0,0,0,${a})`;
function vg(c,y0,y1,stops){const g=c.createLinearGradient(0,y0,0,y1);stops.forEach(([t,a])=>g.addColorStop(t,A(a)));return g;}
function ridge(r,x0,x1,y0,y1,rough,depth){let p=[[x0,y0],[x1,y1]],amp=(x1-x0)*rough;for(let d=0;d<depth;d++){const o=[];for(let i=0;i<p.length-1;i++)o.push(p[i],[(p[i][0]+p[i+1][0])/2,(p[i][1]+p[i+1][1])/2+gauss(r)*amp]);o.push(p[p.length-1]);p=o;amp*=.55;}return p;}
function fillRidge(c,pts,bottom){c.beginPath();c.moveTo(pts[0][0],pts[0][1]);pts.forEach(p=>c.lineTo(p[0],p[1]));c.lineTo(pts[pts.length-1][0],bottom);c.lineTo(pts[0][0],bottom);c.closePath();c.fill();}
function disc(c,x,y,R){c.beginPath();c.arc(x,y,R,0,TAU);c.fill();}
function erase(c,fn){c.save();c.globalCompositeOperation='destination-out';c.fillStyle=c.strokeStyle='#000';fn();c.restore();}
const quad=(p0,p1,p2,t)=>[(1-t)*(1-t)*p0[0]+2*(1-t)*t*p1[0]+t*t*p2[0],(1-t)*(1-t)*p0[1]+2*(1-t)*t*p1[1]+t*t*p2[1]];
function pine(c,x,y,h,lean,r,a){const p0=[x,y],p1=[x+lean*h*.1,y-h*.6],p2=[x+lean*h*.5,y-h];
  c.strokeStyle=A(a);c.lineCap='round';c.lineWidth=h*.05;c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(p1[0],p1[1],p2[0],p2[1]);c.stroke();c.fillStyle=A(a);
  for(let k=0;k<5;k++){const[px,py]=quad(p0,p1,p2,.36+k*.16),w=h*(.46-.06*k)*(.8+r()*.4);c.beginPath();c.ellipse(px+(r()-.5)*w*.3,py,w/2,h*.065,0,0,TAU);c.fill();}}
function star(c,x,y,R,rot){c.beginPath();for(let i=0;i<10;i++){const a=rot+i*Math.PI/5,rr=i%2?R*.45:R;c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}c.closePath();c.fill();}

// Composition rule for every scene (they double as side-view backdrops): the key plate is the game's
// ink (blocks, lines, the rider, the ring), so the scenes keep their key-plate shapes to the top and
// bottom strips and the corners. The middle band, where ledges, rides and rings live, is carried by
// the light plate plus a restrained mid plate. Bold shapes frame the play; they never sit behind it.
// c[3] is an optional accent mask: where a scene paints it, a 'mixed' screen prints halftone dots
// instead of grain. Dots are kept for deliberate shading, never for large flat areas.
// A flat-based WPA cloud: a slab with a row of bumps on top. Adds subpaths; the caller begins and fills.
function cloud(c,x,y,w,h,r){c.rect(x-w/2,y-h*.3,w,h*.3);const n=3+(r()*3|0);
  for(let i=0;i<n;i++){const t=(i+.5)/n,cx=x-w/2+w*t,rr=h*(.3+.45*Math.sin(Math.PI*t))*(.8+r()*.4);c.moveTo(cx+rr,y-h*.3);c.arc(cx,y-h*.3,rr,0,TAU);}}
const SCENES={
  woodblock:{name:'Woodblock coast',after:'Edo-period ukiyo-e landscapes (Hiroshige, Hokusai)',draw(c,r){const[L,M,D,X]=c;
    const H0=300+r()*30;
    // Sky: a pale bokashi of the light ink toward the horizon, the classic red bokashi band across the top.
    L.fillStyle=vg(L,0,H0,[[0,.05],[.6,.28],[1,.45]]);L.fillRect(0,0,W,H0);
    const sunLeft=r()<.5,sx=sunLeft?110+r()*130:560+r()*130,sy=H0-150-r()*50;L.fillStyle=A(1);disc(L,sx,sy,34+r()*12);
    M.fillStyle=vg(M,0,120,[[0,.9],[.4,.48],[1,0]]);M.fillRect(0,0,W,120);
    // Red Fuji (after Hokusai's "Fine Wind, Clear Morning"): mid ink darkening toward the peak, snow left as paper.
    const fx=sunLeft?470+r()*200:130+r()*200,peak=H0-165-r()*40,base=H0+2,half=250+r()*60;
    const fuji=new Path2D();fuji.moveTo(fx-half,base);fuji.quadraticCurveTo(fx-half*.35,base-20,fx-18,peak);fuji.lineTo(fx+18,peak);fuji.quadraticCurveTo(fx+half*.35,base-20,fx+half,base);fuji.closePath();
    M.fillStyle=vg(M,peak,base,[[0,.78],[.5,.42],[1,.14]]);M.fill(fuji);L.fillStyle=A(.35);L.fill(fuji);
    const snowY=peak+30,drips=9,sl=fx-half*.55,sr=fx+half*.55;
    [M,L].forEach(k=>erase(k,()=>{k.clip(fuji);k.beginPath();k.moveTo(sl,peak-10);k.lineTo(sr,peak-10);k.lineTo(sr,snowY-8);
      for(let i=1;i<drips*2;i++){const x=sr-(sr-sl)*i/(drips*2),edge=Math.abs(x-fx)/(sr-fx);k.lineTo(x,snowY+(i%2?(18+r()*22)*(1-edge*.8):-4)+edge*20);}
      k.lineTo(sl,snowY-8);k.closePath();k.fill();}));
    M.strokeStyle=A(.55);M.lineWidth=1.2;M.stroke(fuji);
    // Kasumi: long mist bands left as paper, with a breath of light ink.
    for(let i=0;i<4;i++){const cy=peak+50+r()*(H0-peak-40),cx=r()*W,len=160+r()*220,th=10+r()*8;
      const pill=k=>{k.beginPath();k.roundRect(cx-len/2,cy-th/2,len,th,th/2);k.fill();};erase(M,()=>pill(M));erase(L,()=>pill(L));L.fillStyle=A(.2);pill(L);}
    // Sea: pale near the horizon, deepening into the key ink only along the bottom strip.
    L.fillStyle=A(.3);L.fillRect(0,H0,W,H-H0);
    D.fillStyle=vg(D,H0,H,[[0,.04],[(430-H0)/(H-H0),.12],[1,.7]]);D.fillRect(0,H0,W,H-H0);
    [L,D].forEach(k=>erase(k,()=>{for(let i=0;i<120;i++){const y=H0+6+Math.pow(r(),1.5)*90,x=r()*W;k.fillRect(x,y,10+r()*26,1.2);}}));
    // Seigaiha waves along the bottom edge.
    const R=18;for(let row=0,y=454;y<H+R;y+=R*.5,row++)for(let x=(row%2?R:0)-R;x<W+R;x+=R*2){
      erase(D,()=>disc(D,x,y,R));D.fillStyle=A(.82);disc(D,x,y,R);
      erase(D,()=>{D.lineWidth=2;[.78,.56,.34].forEach(k=>{D.beginPath();D.arc(x,y,R*k,Math.PI,TAU);D.stroke();});});}
    // A framing pine bough reaching in from the top corner above the sun (a Hiroshige repoussoir).
    const ex=sunLeft?-20:W+20,dir=sunLeft?1:-1,p0=[ex,-12+r()*16],p1=[ex+dir*(130+r()*40),18+r()*18],p2=[ex+dir*(250+r()*50),58+r()*22];
    D.strokeStyle=A(1);D.lineCap='round';D.lineWidth=8;D.beginPath();D.moveTo(p0[0],p0[1]);D.quadraticCurveTo(p1[0],p1[1],p2[0],p2[1]);D.stroke();
    // Pine pads as flat-bottomed domes (the ukiyo-e shorthand), with needle strokes left as paper.
    D.fillStyle=A(1);const pads=[];
    for(let k=0;k<5;k++){const t=.2+k*.19,[px,py]=quad(p0,p1,p2,t),w=(62-k*5)*(.85+r()*.3),h=15+r()*6,ox=dir*(r()-.3)*18,oy=-(6+r()*10);
      D.lineWidth=3;D.beginPath();D.moveTo(px,py);D.lineTo(px+ox,py+oy);D.stroke();
      D.beginPath();D.ellipse(px+ox,py+oy,w/2,h,0,Math.PI,TAU);D.closePath();D.fill();pads.push([px+ox,py+oy,w,h]);
      if(k%2===0){const hx=px+dir*8,hy=py+4,hw=w*.7,hh=h*.8;D.beginPath();D.moveTo(px,py);D.lineTo(hx,hy+hh*.9);D.stroke();D.beginPath();D.ellipse(hx,hy+hh*.9+hh,hw/2,hh,0,Math.PI,TAU);D.closePath();D.fill();pads.push([hx,hy+hh*.9+hh,hw,hh]);}}
    erase(D,()=>{D.lineWidth=1.3;pads.forEach(([x,y,w,h])=>{for(let j=1;j<6;j++){const a=Math.PI+j*Math.PI/6;D.beginPath();D.moveTo(x+Math.cos(a)*w*.12,y+Math.sin(a)*h*.2);D.lineTo(x+Math.cos(a)*w*.42,y+Math.sin(a)*h*.8);D.stroke();}});});
    // A low sandbar in the opposite bottom corner, with two small windswept pines.
    const sbx=sunLeft?W+10:-10,sbw=(170+r()*60)*(sunLeft?-1:1);
    D.fillStyle=A(.9);D.beginPath();D.moveTo(sbx,H);D.lineTo(sbx,418+r()*8);D.quadraticCurveTo(sbx+sbw*.5,424,sbx+sbw,462);D.lineTo(sbx+sbw,H);D.closePath();D.fill();
    for(let k=0;k<2;k++){const t=.18+k*.24,x=sbx+sbw*t;pine(D,x,426+t*24,58+r()*22,sunLeft?-.8:.8,r,1);}
    if(r()<.35){M.strokeStyle=A(.22);M.lineWidth=.8;for(let i=0;i<220;i++){const x=r()*900-50,y=r()*H;M.beginPath();M.moveTo(x,y);M.lineTo(x-18,y+60);M.stroke();}}
    M.strokeStyle=A(.8);M.lineWidth=1.5;for(let i=0;i<5;i++){const x=240+r()*320,y=40+r()*60,s=5+r()*5;M.beginPath();M.moveTo(x-s,y-s*.4);M.quadraticCurveTo(x-s*.4,y-s*.5,x,y);M.quadraticCurveTo(x+s*.4,y-s*.5,x+s,y-s*.4);M.stroke();}
  }},
  park:{name:'Park poster',after:'1930s WPA national-park silkscreen posters',draw(c,r){const[L,M,D,X]=c;
    const H0=290+r()*30,sx=180+r()*440,sy=80+r()*45;
    // Split-fountain sky: one roller carrying both inks, the mid ink along the top edge blending into the
    // light ink and on down to bare paper at the horizon, with the uneven banding a hand-inked roller leaves.
    const f1=.13+r()*.08,f2=.021+r()*.015,g1=r()*TAU,g2=r()*TAU;
    for(let y=0;y<H0;y+=2){const t=y/H0,band=1+.14*Math.sin(y*f1+g1)*Math.sin(y*f2+g2)+.05*(r()-.5);
      M.fillStyle=A(clamp01(.9*Math.pow(clamp01(1-t/.36),1.2)*band));M.fillRect(0,y,W,2);
      L.fillStyle=A(clamp01((.06+.5*Math.exp(-(((t-.2)/.17)**2)))*band));L.fillRect(0,y,W,2);}
    // Plain sun disc, high in the fountain so it overprints the mid ink.
    L.fillStyle=A(1);disc(L,sx,sy,44+r()*14);
    // Layered WPA cloud bands in the top strip: paper knocked out of the sky, a light body, a mid shadow sliver on the flat base.
    const cl=r()<.5;[[cl?60+r()*140:420+r()*160,34+r()*18,170+r()*60],[cl?420+r()*200:90+r()*180,58+r()*22,120+r()*60]].forEach(([x,y,w])=>{
      const h=w*.2,seed=(r()*1e9)|0;
      const draw=(k,dy)=>{const rr=rng(seed);k.beginPath();cloud(k,x,y+dy,w,h,rr);k.fill();};
      erase(M,()=>draw(M,0));erase(L,()=>draw(L,0));
      M.fillStyle=A(.5);draw(M,0);erase(M,()=>draw(M,-4));L.fillStyle=A(.22);draw(L,0);});
    // Ridges step back in the mid ink only; no key ink behind the playfield.
    const far=ridge(r,-20,820,H0-110+gauss(r)*20,H0-110+gauss(r)*20,.12,5);M.fillStyle=A(.2);fillRidge(M,far,H0);
    const mid=ridge(r,-20,820,H0-62+gauss(r)*15,H0-62+gauss(r)*15,.1,5);M.fillStyle=A(.24);fillRidge(M,mid,H0);L.fillStyle=A(.25);fillRidge(L,mid,H0);
    const near=ridge(r,-20,820,H0-25,H0-25,.06,5);M.fillStyle=A(.3);fillRidge(M,near,H0);
    // Lake: flat light ink with paper wave lines; the ridge's reflection is the one halftone accent.
    const lb=H0+100;L.fillStyle=A(.4);L.fillRect(0,H0,W,lb-H0);
    M.save();M.translate(0,2*H0);M.scale(1,-1);M.beginPath();M.rect(0,H0-(lb-H0),W,lb-H0);M.clip();M.fillStyle=A(.28);fillRidge(M,mid,H0);M.restore();
    X.fillStyle=A(1);X.fillRect(0,H0+2,W,lb-H0-2);
    [L,M].forEach(k=>erase(k,()=>{for(let y=H0+4;y<lb;y+=5+(y-H0)*.09)k.fillRect(0,y,W,1.4+(y-H0)*.018);}));
    // Foreground: the key-ink hill along the bottom strip, higher only at the very corners.
    const hill=new Path2D(),hL=424+r()*10,hR=424+r()*10;hill.moveTo(-10,H);hill.lineTo(-10,hL);
    hill.bezierCurveTo(180,452+r()*10,560,462+r()*10,810,hR);hill.lineTo(810,H);hill.closePath();
    L.fillStyle=A(.3);L.fillRect(0,lb,W,H-lb);M.fillStyle=A(.35);M.fillRect(0,lb,W,5);
    D.fillStyle=A(.9);D.fill(hill);M.fillStyle=A(.3);M.fill(hill);
    // Pines in the corners, in the mid ink: they frame the sheet without looking like the game's blocks.
    const tree=(k,x,y,h,a)=>{k.fillStyle=A(a);k.fillRect(x-h*.03,y-h*.2,h*.06,h*.2);for(let j=0;j<3;j++){const ty=y-h*.12-j*h*.26,tw=h*(.34-j*.08);k.beginPath();k.moveTo(x,ty-h*.42);k.lineTo(x+tw,ty);k.lineTo(x-tw,ty);k.closePath();k.fill();}};
    [[-10,110],[690,810]].forEach(([a,b])=>{for(let i=0;i<4;i++){const x=a+r()*(b-a),y=468+r()*30;tree(M,x,y,90+r()*80,.8);}});
    for(let i=0;i<10;i++)tree(M,r()*W,H0+2,16+r()*12,.4);
  }},
  bauhaus:{name:'Bauhaus geometry',after:'1920s Bauhaus and constructivist posters',draw(c,r){const[L,M,D,X]=c;
    // A composed poster, not confetti: a big halftone circle in one corner, a diagonal bar with rules
    // across the opposite corner, a stripe block and a key half-disc in the two remaining corners.
    const K=[[0,0],[W,0],[0,H],[W,H]],ci=(r()*4)|0,[ax,ay]=K[ci],[bx,by]=K[3-ci],sx=ax?-1:1,sy=ay?-1:1,tx=bx?-1:1,ty=by?-1:1;
    const R=200+r()*50,cx=ax+sx*(60+r()*50),cy=ay+sy*(40+r()*40);
    // The circle is the scene's halftone accent: dots swell toward the corner and thin out toward the playfield.
    const rg=L.createRadialGradient(ax,ay,0,ax,ay,Math.hypot(cx-ax,cy-ay)+R);rg.addColorStop(0,A(1));rg.addColorStop(.35,A(.78));rg.addColorStop(.75,A(.26));rg.addColorStop(1,A(.1));
    L.fillStyle=rg;disc(L,cx,cy,R);X.fillStyle=A(1);disc(X,cx,cy,R+4);
    M.fillStyle=A(.85);disc(M,ax+sx*(130+r()*50),ay+sy*(8+r()*20),58+r()*18);
    D.fillStyle=A(1);disc(D,ax+sx*(46+r()*20),ay+sy*(44+r()*14),24+r()*10);
    const band=(k,d0,d1)=>{k.beginPath();k.moveTo(bx+tx*d0,by);k.lineTo(bx+tx*d1,by);k.lineTo(bx,by+ty*d1);k.lineTo(bx,by+ty*d0);k.closePath();k.fill();};
    const d0=120+r()*40;M.fillStyle=A(1);band(M,d0,d0+46);[70,84,98].forEach(o=>{M.fillStyle=A(.8);band(M,d0+o,d0+o+4);});
    D.fillStyle=A(1);band(D,0,d0*.45);
    const topFree=ay===0?(ax?0:W):(bx?0:W),fx=topFree?-1:1,x0=topFree+fx*40,botFree=ay===H?(ax?0:W):(bx?0:W);
    M.fillStyle=A(.9);for(let i=0;i<5;i++)M.fillRect(fx>0?x0:x0-180,16+i*12,180,6);
    D.fillStyle=A(1);D.beginPath();D.arc(botFree+(botFree?-1:1)*(150+r()*60),H,52+r()*14,Math.PI,TAU);D.fill();
    L.fillStyle=A(.55);L.fillRect(botFree?W-26:0,0,26,H);
    D.fillStyle=A(1);D.fillRect(0,H-12,W,12);
  }},
  cutouts:{name:'Paper cut-outs',after:'Matisse’s late gouache cut-outs',draw(c,r){
    c[0].fillStyle=A(.12);c[0].fillRect(0,0,W,H);
    const edgePt=t=>{const p=t*2*(W+H);return p<W?[p,0]:p<W+H?[W,p-W]:p<2*W+H?[2*W+H-p,H]:[0,2*(W+H)-p];};
    const seaweed=(k,S,lobes,r)=>{const L=[],R=[];for(let t=0;t<=1.001;t+=.02){const bend=Math.sin(t*2.2)*S*.12,w=S*.22*(1-t*.55);
      L.push([bend-w*(.35+.65*Math.pow(Math.abs(Math.sin(t*Math.PI*lobes)),.6)),-t*S]);R.push([bend+w*(.35+.65*Math.pow(Math.abs(Math.sin(t*Math.PI*lobes+1.3)),.6)),-t*S]);}
      k.beginPath();L.forEach(p=>k.lineTo(p[0],p[1]));R.reverse().forEach(p=>k.lineTo(p[0],p[1]));k.closePath();k.fill();};
    // Cut-outs grow in from the edges. Along the top and bottom they may be tall and in any ink; along the
    // sides (where ledges and rings sit) they stay short and in the lighter inks.
    for(let i=0;i<11;i++){const[x,y]=edgePt((i+r()*.6)/11),side=x<=0||x>=W,k=side?c[r()<.5?0:1]:c[1+(r()*2|0)],S=side?60+r()*45:(y<=0?100+r()*80:90+r()*60);k.save();k.translate(x,y);
      k.rotate(Math.atan2(H/2-y,W/2-x)+Math.PI/2+gauss(r)*(side?.25:.35));k.fillStyle=A(1);seaweed(k,S,2+(r()*3|0),r);k.restore();}
    for(let i=0;i<9;i++){const[x,y]=edgePt(r()),k=c[r()*2|0];k.fillStyle=A(1);const ix=x+(W/2-x)*(.06+r()*.12),iy=y+(H/2-y)*(.06+r()*.14);r()<.5?star(k,ix,iy,10+r()*14,r()*TAU):disc(k,ix,iy,5+r()*8);}
  }},
  orbits:{name:'Orbits',after:'Hilma af Klint’s geometric series',draw(c,r){const[L,M,D,X]=c;
    L.fillStyle=A(.1);L.fillRect(0,0,W,H);
    // The great orb rises from a bottom corner: its upper half in the mid ink, its lower half in key,
    // shaded in halftone, sinking off the sheet.
    const right=r()<.5,cx=right?650+r()*50:150-r()*50,cy=455+r()*25,R=165+r()*35;
    M.fillStyle=A(.55);M.beginPath();M.arc(cx,cy,R,Math.PI,TAU);M.closePath();M.fill();
    D.fillStyle=A(.8);D.beginPath();D.arc(cx,cy,R,0,Math.PI);D.closePath();D.fill();X.fillStyle=A(1);X.beginPath();X.arc(cx,cy,R+3,0,Math.PI);X.closePath();X.fill();
    [M,D].forEach(k=>erase(k,()=>{k.lineWidth=3;[.8,.6,.4].forEach(f=>{k.beginPath();k.arc(cx,cy,R*f,0,TAU);k.stroke();});}));
    L.fillStyle=A(1);disc(L,cx,cy,R*.24);
    // An orbit ring with its moons (rings and beads, not rays: rays around a rising half-disc read as a sunburst).
    L.strokeStyle=A(.8);L.lineWidth=3;L.beginPath();L.arc(cx,cy,R+34,0,TAU);L.stroke();
    L.fillStyle=A(1);for(let i=0;i<5;i++){const a=Math.PI*(1.08+i*.2+r()*.06);disc(L,cx+Math.cos(a)*(R+34),cy+Math.sin(a)*(R+34),5+(i%3)*3);}
    // The spiral unwinds in the opposite top corner, in the light ink.
    const ox=right?120+r()*60:W-120-r()*60,oy=95+r()*20;L.strokeStyle=A(1);L.lineWidth=8;L.lineCap='round';L.beginPath();
    for(let t=0;t<4*TAU;t+=.08){const rr=4+t*3.8;L.lineTo(ox+Math.cos(t)*rr,oy+Math.sin(t)*rr);}L.stroke();
    // A row of key-ink planets along the top edge, growing toward the orb's side.
    D.fillStyle=A(1);for(let i=0;i<8;i++){const t=i/7,x=right?W*.3+t*W*.62:W*.7-t*W*.62;disc(D,x,26+Math.sin(t*Math.PI)*10,3+t*9);}
    M.strokeStyle=A(.6);M.lineWidth=1.5;M.beginPath();M.moveTo(right?W*.28:W*.72,26);M.lineTo(right?W*.94:W*.06,26);M.stroke();
  }},
};
// Recommended settings for printing each scene as a side-view backdrop (read by the app).
//   calm    renderScene calm amount (with shape 'band': the horizontal gameplay band)
//   pale    density multiplier for every plate, so the game's full-strength ink reads on top
//   screen  'mixed': grain everywhere, halftone dots only on the scene's accents
//   plates  how much of the calm each plate takes [light, mid, key]: the key plate goes first
SCENES.woodblock.side={calm:.7,pale:.78,screen:'mixed',shape:'band',plates:[.6,.85,1]};
SCENES.park.side={calm:.72,pale:.74,screen:'mixed',shape:'band',plates:[.6,.85,1]};
SCENES.bauhaus.side={calm:.7,pale:.8,screen:'mixed',shape:'band',plates:[.6,.85,1]};
SCENES.cutouts.side={calm:.7,pale:.82,screen:'mixed',shape:'band',plates:[.6,.85,1]};
SCENES.orbits.side={calm:.7,pale:.86,screen:'mixed',shape:'band',plates:[.6,.85,1]};

// o.shape / o.plates shape the calm (see applyCalm); the defaults are the original centred oval with
// half calm on the light plate. The scene's accent mask comes back as dens.dots (null if unused).
function renderScene(name,seed,w,h,calm=0,o={}){
  const cvs=[0,1,2,3].map(()=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').setTransform(w/W,0,0,h/H,0,0);return cv;});
  SCENES[name].draw(cvs.map(cv=>cv.getContext('2d')),rng(seed));
  const wt=o.plates||[.5,1,1],dens=cvs.slice(0,3).map((cv,i)=>applyCalm(densityFromCanvas(cv),w,h,calm*wt[i],o.shape));
  const dm=densityFromCanvas(cvs[3]);dens.dots=dm.some(v=>v>0)?dm:null;return dens;}
// Two-ink prints fold the mid and dark plates together.
function mergeTo(dens,n){if(n>=dens.length)return dens;const a=dens[1],b=dens[2],m=new Float32Array(a.length);for(let i=0;i<a.length;i++)m[i]=1-(1-a[i])*(1-b[i]);const out=[dens[0],m];out.dots=dens.dots;return out;}
// A scene printed as a side-view backdrop, following SCENES[scene].side (else the pre-profile
// 0.55 calm / 0.5 pale / dots). bg is a level's {scene, seed, inks:[names or #hex], side?:{…per-level overrides}}; o may override
// cell and mis (default: scaled from a 1600-wide print) or any profile field. Returns ImageData.
const SIDE_DEFAULT={calm:.55,pale:.5,screen:'dots',shape:'oval',plates:[.5,1,1]};
function sideProfile(scene){return Object.assign({},SIDE_DEFAULT,(SCENES[scene]||{}).side);}
function printSideBackdrop(bg,w,h,o={}){
  const p=Object.assign(sideProfile(bg.scene),bg.side,o),inks=bg.inks.map(c=>INKS[c]||c);
  const dens=mergeTo(renderScene(bg.scene,bg.seed,w,h,p.calm,{shape:p.shape,plates:p.plates}),inks.length);
  if(p.pale!==1)dens.forEach(d=>{for(let i=0;i<d.length;i++)d[i]*=p.pale;});
  const layers=layersFor(dens,inks,{seed:bg.seed,cell:p.cell??6*w/1600,mis:p.mis??2.5*w/1600,screen:p.screen});
  return print({w,h,paper:PAPERS[p.paper]||p.paper||PAPERS.Natural,layers,texture:p.texture??1,seed:bg.seed});}

global.Riso={INKS,PAPERS,PRESETS,SCENES,print,layersFor,renderScene,mergeTo,separate,suggestInks,fitImage,applyCalm,rng,sideProfile,printSideBackdrop};
})(window);
