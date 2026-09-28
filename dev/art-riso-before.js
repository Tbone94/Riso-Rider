// Frozen copy of riso.js from before the round-B art pass, exposed as window.RisoBefore for dev/art-backdrops.html.
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

// ---------- printing ----------
// layer: {ink:'#hex', density:Float32Array(w*h), screen:'dots'|'grain'|'solid',
//         cell:px, angle:deg, offset:[dx,dy], rot:deg}
function screenLayer(L,w,h,seed,tex){
  const D=L.density,cov=new Float32Array(w*h),cx=w/2,cy=h/2;
  const ra=(L.rot||0)*Math.PI/180,cr=Math.cos(ra),sr=Math.sin(ra),[ox,oy]=L.offset||[0,0];
  const an=(L.angle??15)*Math.PI/180,ca=Math.cos(an),sa=Math.sin(an),cell=L.cell||6,mode=L.screen||'dots';
  const at=(x,y)=>{x=x|0;y=y|0;return x<0||y<0||x>=w||y>=h?0:D[y*w+x];};
  for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i++){
    const dx=x-cx-ox,dy=y-cy-oy,sx=cx+dx*cr+dy*sr,sy=cy-dx*sr+dy*cr;
    let c;
    if(mode==='dots'){
      const u=(sx*ca+sy*sa)/cell,v=(-sx*sa+sy*ca)/cell,iu=Math.floor(u)+.5,iv=Math.floor(v)+.5;
      const d=at((iu*ca-iv*sa)*cell,(iu*sa+iv*ca)*cell);
      if(d>.96)c=1;else{const R=.74*Math.pow(d,.7),dist=Math.hypot(u-iu,v-iv);c=clamp01((R-dist)*cell+.5);}
    }else if(mode==='grain'){const d=at(sx,sy);c=clamp01((d-hash2(x,y,seed+3))*5+.5);}
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
function layersFor(dens,inks,o={}){
  const r=rng((o.seed||1)+99),mis=o.mis??2.5,ang=[15,75,45];
  return dens.map((d,i)=>({ink:inks[i],density:d,screen:o.screen||'dots',cell:(o.cell||6)*(i===0?1.15:1),angle:ang[i%3],
    offset:i===dens.length-1?[0,0]:[gauss(r)*mis,gauss(r)*mis],rot:i===dens.length-1?0:gauss(r)*.06*mis}));}

// ---------- density-map utilities ----------
function densityFromCanvas(cv){const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data,n=cv.width*cv.height,o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=d[i*4+3]/255;return o;}
// Fade ink out of the middle of the page so the playfield stays readable.
function applyCalm(d,w,h,amt){if(!amt)return d;for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i++){const ex=(x/w-.5)/.42,ey=(y/h-.5)/.4,r=Math.sqrt(ex*ex+ey*ey),t=clamp01((1.1-r)/.5),m=t*t*(3-2*t);d[i]*=1-amt*m;}return d;}
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

const SCENES={
  woodblock:{name:'Woodblock coast',after:'Edo-period ukiyo-e landscapes (Hiroshige, Hokusai)',draw(c,r){const[L,M,D]=c;
    const H0=300+r()*40;
    L.fillStyle=vg(L,H0-200,H0,[[0,0],[.7,.5],[1,.75]]);L.fillRect(0,0,W,H0);
    const sunLeft=r()<.5,sx=sunLeft?110+r()*130:560+r()*130,sy=H0-120-r()*60;L.fillStyle=A(1);disc(L,sx,sy,38+r()*14);
    M.fillStyle=vg(M,0,170,[[0,.9],[.35,.6],[1,0]]);M.fillRect(0,0,W,170);
    const fx=sunLeft?470+r()*200:130+r()*200,peak=H0-170-r()*40,base=H0+2,half=260+r()*60;
    const fuji=new Path2D();fuji.moveTo(fx-half,base);fuji.quadraticCurveTo(fx-half*.35,base-20,fx-18,peak);fuji.lineTo(fx+18,peak);fuji.quadraticCurveTo(fx+half*.35,base-20,fx+half,base);fuji.closePath();
    D.fillStyle=vg(D,peak,base,[[0,.75],[1,.25]]);D.fill(fuji);M.fillStyle=A(.18);M.fill(fuji);
    // Snow cap: clear everything above a line that drips down the slopes in streaks.
    const snowY=peak+32,drips=9,sl=fx-half*.55,sr=fx+half*.55;
    [D,M,L].forEach(k=>erase(k,()=>{k.clip(fuji);k.beginPath();k.moveTo(sl,peak-10);k.lineTo(sr,peak-10);k.lineTo(sr,snowY-8);
      for(let i=1;i<drips*2;i++){const x=sr-(sr-sl)*i/(drips*2),edge=Math.abs(x-fx)/(sr-fx);k.lineTo(x,snowY+(i%2?(18+r()*22)*(1-edge*.8):-4)+edge*20);}
      k.lineTo(sl,snowY-8);k.closePath();k.fill();}));
    D.strokeStyle=A(.75);D.lineWidth=1.4;D.stroke(fuji);
    for(let i=0;i<4;i++){const cy=peak+60+r()*(H0-peak-80),cx=r()*W,len=140+r()*200,th=11+r()*8;
      const pill=k=>{k.beginPath();k.roundRect(cx-len/2,cy-th/2,len,th,th/2);k.fill();};erase(D,()=>pill(D));M.fillStyle=A(.5);pill(M);}
    D.fillStyle=vg(D,H0,H,[[0,.3],[.25,.55],[1,.85]]);D.fillRect(0,H0,W,H-H0);
    erase(D,()=>{for(let i=0;i<140;i++){const y=H0+6+Math.pow(r(),1.5)*90,x=r()*W;D.fillRect(x,y,10+r()*26,1.2);}});
    const R=20;for(let row=0,y=440;y<H+R;y+=R*.5,row++)for(let x=(row%2?R:0)-R;x<W+R;x+=R*2){
      erase(D,()=>disc(D,x,y,R));D.fillStyle=A(.82);disc(D,x,y,R);
      erase(D,()=>{D.lineWidth=2.2;[.78,.56,.34].forEach(k=>{D.beginPath();D.arc(x,y,R*k,Math.PI,TAU);D.stroke();});});}
    const left=!sunLeft?false:true,ex=left?-10:810,inner=left?250+r()*60:550-r()*60,top=[ex,H0-60-r()*30],ctl=[ex+(inner-ex)*.55,H0-75],end=[inner,H0+120];
    D.fillStyle=A(.92);D.beginPath();D.moveTo(ex,H);D.lineTo(top[0],top[1]);D.quadraticCurveTo(ctl[0],ctl[1],end[0],end[1]);D.lineTo(inner,H);D.closePath();D.fill();
    M.fillStyle=A(.3);M.beginPath();M.moveTo(ex,H);M.lineTo(top[0],top[1]);M.quadraticCurveTo(ctl[0],ctl[1],end[0],end[1]);M.lineTo(inner,H);M.closePath();M.fill();
    for(let k=0;k<3;k++){const[px,py]=quad(top,ctl,end,.15+k*.2);pine(D,px,py+4,90+r()*70,left?.8:-.8,r,1);}
    if(r()<.35){M.strokeStyle=A(.45);M.lineWidth=.8;for(let i=0;i<260;i++){const x=r()*900-50,y=r()*H;M.beginPath();M.moveTo(x,y);M.lineTo(x-18,y+60);M.stroke();}}
    D.strokeStyle=A(.9);D.lineWidth=1.6;for(let i=0;i<6;i++){const x=200+r()*400,y=60+r()*100,s=5+r()*5;D.beginPath();D.moveTo(x-s,y-s*.4);D.quadraticCurveTo(x-s*.4,y-s*.5,x,y);D.quadraticCurveTo(x+s*.4,y-s*.5,x+s,y-s*.4);D.stroke();}
  }},
  park:{name:'Park poster',after:'1930s WPA national-park silkscreen posters',draw(c,r){const[L,M,D]=c;
    const H0=300+r()*30,sx=250+r()*300,sy=H0-100-r()*50;
    L.fillStyle=vg(L,0,H0,[[0,.12],[1,.7]]);L.fillRect(0,0,W,H0);
    L.save();L.beginPath();L.rect(0,0,W,H0);L.clip();L.fillStyle=A(.35);for(let i=0;i<18;i+=2){const a=i/18*TAU;L.beginPath();L.moveTo(sx,sy);L.arc(sx,sy,1000,a,a+TAU/18);L.closePath();L.fill();}L.restore();
    L.fillStyle=A(1);disc(L,sx,sy,62);M.fillStyle=A(.35);M.beginPath();M.arc(sx,sy,74,0,TAU);M.arc(sx,sy,64,0,TAU,true);M.fill();
    const far=ridge(r,-20,820,H0-110+gauss(r)*20,H0-110+gauss(r)*20,.12,5);M.fillStyle=A(.35);fillRidge(M,far,H0);
    const mid=ridge(r,-20,820,H0-60+gauss(r)*15,H0-60+gauss(r)*15,.1,5);M.fillStyle=A(.35);fillRidge(M,mid,H0);D.fillStyle=A(.35);fillRidge(D,mid,H0);
    const near=ridge(r,-20,820,H0-25,H0-25,.06,5);D.fillStyle=A(.6);fillRidge(D,near,H0);
    M.fillStyle=A(.45);M.fillRect(0,H0,W,110);D.fillStyle=vg(D,H0,H0+110,[[0,.15],[1,.45]]);D.fillRect(0,H0,W,110);
    D.save();D.translate(0,2*H0);D.scale(1,-1);D.beginPath();D.rect(0,H0-110,W,110);D.clip();D.fillStyle=A(.4);fillRidge(D,mid,H0);D.restore();
    [M,D].forEach(k=>erase(k,()=>{for(let y=H0+3;y<H0+110;y+=4+(y-H0)*.08)k.fillRect(0,y,W,1.6+(y-H0)*.02);}));
    const hill=new Path2D();hill.moveTo(-10,H);hill.lineTo(-10,H0+96);hill.bezierCurveTo(250,H0+80+r()*30,550,H0+120+r()*30,810,H0+90);hill.lineTo(810,H);hill.closePath();
    D.fillStyle=A(.92);D.fill(hill);M.fillStyle=A(.3);M.fill(hill);
    const tree=(x,y,h)=>{D.fillStyle=A(1);D.fillRect(x-h*.03,y-h*.2,h*.06,h*.2);for(let k=0;k<3;k++){const ty=y-h*.12-k*h*.26,tw=h*(.34-k*.08);D.beginPath();D.moveTo(x,ty-h*.42);D.lineTo(x+tw,ty);D.lineTo(x-tw,ty);D.closePath();D.fill();}};
    [[0,170],[630,800]].forEach(([a,b])=>{for(let i=0;i<5;i++){const x=a+r()*(b-a),y=H0+110+r()*70;tree(x,y,120+r()*110);}});
    for(let i=0;i<10;i++)tree(r()*W,H0+2,18+r()*14);
  }},
  bauhaus:{name:'Bauhaus geometry',after:'1920s Bauhaus and constructivist posters',draw(c,r){
    const anchors=[[60,60],[740,60],[60,440],[740,440],[400,-10],[400,510],[-10,250],[810,250],[200,480],[600,20],[160,20],[640,480]].sort(()=>r()-.5);
    const pick=()=>c[r()<.3?0:r()<.55?1:2];
    const big=anchors[0];c[0].fillStyle=A(.6);disc(c[0],big[0],big[1],200+r()*60);
    const shapes=[
      (k,s)=>disc(k,0,0,s),
      (k,s)=>{k.beginPath();k.arc(0,0,s,0,Math.PI);k.closePath();k.fill();},
      (k,s)=>{k.beginPath();k.moveTo(0,0);k.arc(0,0,s*1.3,0,Math.PI/2);k.closePath();k.fill();},
      (k,s)=>{k.lineWidth=s*.18;k.strokeStyle=k.fillStyle;k.beginPath();k.arc(0,0,s*.8,0,TAU);k.stroke();},
      (k,s)=>k.fillRect(-s*1.3,-s*.15,s*2.6,s*.3),
      (k,s)=>{for(let i=0;i<5;i++)for(let j=0;j<5;j++)disc(k,(i-2)*s*.35,(j-2)*s*.35,s*.07);},
      (k,s)=>{k.beginPath();k.moveTo(0,-s);k.lineTo(s*.9,s*.6);k.lineTo(-s*.9,s*.6);k.closePath();k.fill();},
      (k,s)=>{for(let i=0;i<7;i++)k.fillRect(-s*.8,(i-3)*s*.2,s*1.6,s*.08);},
    ];
    for(let i=1;i<10;i++){const[x,y]=anchors[i%anchors.length],k=pick(),s=60+r()*120;k.save();k.translate(x+gauss(r)*25,y+gauss(r)*25);k.rotate(Math.round(r()*8)*Math.PI/4);
      k.fillStyle=A(r()<.7?1:.45);shapes[(r()*shapes.length)|0](k,s);k.restore();}
    c[2].fillStyle=A(1);c[2].fillRect(0,H-14,W,14);
  }},
  cutouts:{name:'Paper cut-outs',after:'Matisse’s late gouache cut-outs',draw(c,r){
    c[0].fillStyle=A(.12);c[0].fillRect(0,0,W,H);
    const edgePt=t=>{const p=t*2*(W+H);return p<W?[p,0]:p<W+H?[W,p-W]:p<2*W+H?[2*W+H-p,H]:[0,2*(W+H)-p];};
    const seaweed=(k,S,lobes,r)=>{const L=[],R=[];for(let t=0;t<=1.001;t+=.02){const bend=Math.sin(t*2.2)*S*.12,w=S*.22*(1-t*.55);
      L.push([bend-w*(.35+.65*Math.pow(Math.abs(Math.sin(t*Math.PI*lobes)),.6)),-t*S]);R.push([bend+w*(.35+.65*Math.pow(Math.abs(Math.sin(t*Math.PI*lobes+1.3)),.6)),-t*S]);}
      k.beginPath();L.forEach(p=>k.lineTo(p[0],p[1]));R.reverse().forEach(p=>k.lineTo(p[0],p[1]));k.closePath();k.fill();};
    for(let i=0;i<10;i++){const[x,y]=edgePt((i+r()*.6)/10),k=c[1+(r()*2|0)],S=110+r()*110;k.save();k.translate(x,y);
      k.rotate(Math.atan2(H/2-y,W/2-x)+Math.PI/2+gauss(r)*.35);k.fillStyle=A(1);seaweed(k,S,2+(r()*3|0),r);k.restore();}
    for(let i=0;i<9;i++){const[x,y]=edgePt(r()),k=c[r()*3|0];k.fillStyle=A(1);const ix=x+(W/2-x)*(.1+r()*.15),iy=y+(H/2-y)*(.1+r()*.2);r()<.5?star(k,ix,iy,10+r()*14,r()*TAU):disc(k,ix,iy,5+r()*8);}
  }},
  orbits:{name:'Orbits',after:'Hilma af Klint’s geometric series',draw(c,r){const[L,M,D]=c;
    L.fillStyle=A(.1);L.fillRect(0,0,W,H);
    const right=r()<.5,cx=right?620+r()*40:180-r()*40,cy=250+gauss(r)*15,R=150+r()*40;
    M.fillStyle=A(.85);M.beginPath();M.arc(cx,cy,R,Math.PI/2,Math.PI*1.5);M.closePath();M.fill();
    D.fillStyle=A(.75);D.beginPath();D.arc(cx,cy,R,-Math.PI/2,Math.PI/2);D.closePath();D.fill();
    [M,D].forEach(k=>erase(k,()=>{k.lineWidth=3;[.8,.6,.4].forEach(f=>{k.beginPath();k.arc(cx,cy,R*f,0,TAU);k.stroke();});}));
    L.fillStyle=A(1);disc(L,cx,cy,R*.24);
    for(let i=0;i<10;i++){const a=i/10*TAU,px=cx+Math.cos(a)*(R+34),py=cy+Math.sin(a)*(R+34);L.save();L.translate(px,py);L.rotate(a);L.fillStyle=A(.8);L.beginPath();L.ellipse(0,0,20,7,0,0,TAU);L.fill();L.restore();}
    const ox=W-cx+gauss(r)*30,oy=r()<.5?130:370;L.strokeStyle=A(1);L.lineWidth=9;L.lineCap='round';L.beginPath();
    for(let t=0;t<4*TAU;t+=.08){const rr=4+t*4.2;L.lineTo(ox+Math.cos(t)*rr,oy+Math.sin(t)*rr);}L.stroke();
    D.fillStyle=A(1);for(let i=0;i<9;i++){const a=-Math.PI*.9+i*.22;disc(D,cx+Math.cos(a)*(R+80),cy+Math.sin(a)*(R+80)*.9,4+i%3*3);}
  }},
};
function renderScene(name,seed,w,h,calm=0){
  const cvs=[0,1,2].map(()=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').setTransform(w/W,0,0,h/H,0,0);return cv;});
  SCENES[name].draw(cvs.map(cv=>cv.getContext('2d')),rng(seed));
  return cvs.map((cv,i)=>applyCalm(densityFromCanvas(cv),w,h,calm*(i===0?.5:1)));}
// Two-ink prints fold the mid and dark plates together.
function mergeTo(dens,n){if(n>=dens.length)return dens;const a=dens[1],b=dens[2],m=new Float32Array(a.length);for(let i=0;i<a.length;i++)m[i]=1-(1-a[i])*(1-b[i]);return[dens[0],m];}

global.RisoBefore={INKS,PAPERS,PRESETS,SCENES,print,layersFor,renderScene,mergeTo,separate,suggestInks,fitImage,applyCalm,rng};
})(window);
