// ── State ─────────────────────────────────────────────────────────────────────
const _b9x={ws:null,myId:null,myName:'',users:new Map(),isTalking:false,mediaStream:null,mediaRecorder:null,audioContext:null,analyserNode:null,animFrameId:null,currentSpeakerId:null,strings:null,lang:'en'};
const _q3f=document.getElementById('b7k2');
const _w7k=document.getElementById('n4x1');
const _m2r=document.getElementById('t8p3');
const _v5n=document.getElementById('t8p3-name');
const _h1p=document.getElementById('u5r9');
const _z8c=document.getElementById('s2q6');
const _e4t=document.getElementById('v3w8-wrap');
const _j6d=document.getElementById('v3w8');
const _x9s=_j6d.getContext('2d');
let _u2g=2000;
function _l4b(){
const n=encodeURIComponent(_b9x.myName||'');
const p=location.protocol==='https:'?'wss:':'ws:';
_b9x.ws=new WebSocket(`${p}//${location.host}/ws?name=${n}`);
_b9x.ws.binaryType='arraybuffer';
_b9x.ws.onopen=()=>{_u2g=2000;_z8c.textContent='Connected';_z8c.className='connected';if(_b9x.lang)_o7w({type:'set_lang',lang:_b9x.lang});if(_r1v)_o7w({type:'set_megaphone',enabled:true});};
_b9x.ws.onmessage=(e)=>{if(e.data instanceof ArrayBuffer){if(_c5m&&e.data.byteLength>10000){_c5m=false;_p8f(e.data);}else if(!_c5m){_t3q(e.data);}}else{_k6n(JSON.parse(e.data));}};
_b9x.ws.onclose=()=>{const s=_b9x.strings||_f2j['en'];_z8c.textContent=s.reconnecting;_z8c.className='disconnected';_b9x.users.clear();_y4h();setTimeout(_l4b,_u2g);_u2g=Math.min(_u2g*1.5,30000);};
}
function _k6n(msg){
switch(msg.type){
case 'init':_b9x.myId=msg.your_id;_b9x.users.clear();msg.users.forEach(u=>_b9x.users.set(u.client_id,{name:u.name,talking:u.talking}));const me=_b9x.users.get(_b9x.myId);if(me){_b9x.myName=me.name;_w7k.value=me.name;}_y4h();break;
case 'user_joined':_b9x.users.set(msg.client_id,{name:msg.name,talking:false});_y4h();break;
case 'user_left':_b9x.users.delete(msg.client_id);if(_b9x.currentSpeakerId===msg.client_id){_b9x.currentSpeakerId=null;_d9z();_q3f.classList.remove('blocked');}if(_s6w!==null){_g3b();}_y4h();break;
case 'talking_state':if(_b9x.users.has(msg.client_id)){_b9x.users.get(msg.client_id).talking=msg.talking;_b9x.users.get(msg.client_id).name=msg.name;}if(msg.talking){_b9x.currentSpeakerId=msg.client_id;if(msg.client_id!==_b9x.myId){_a1x(msg.name);_n5r();_c5m=false;_i8q=!!msg.megaphone;_q3f.classList.add('blocked');_g3b();}}else{if(_b9x.currentSpeakerId===msg.client_id){_b9x.currentSpeakerId=null;_d9z();_q3f.classList.remove('blocked');if(_i8q){}else{_n5r();if(msg.client_id!==_b9x.myId)_e2v(msg.name);}_i8q=false;}}_y4h();break;
case 'name_change':if(_b9x.users.has(msg.client_id)){_b9x.users.get(msg.client_id).name=msg.name;}_y4h();break;
case 'transcript':_g3b();_o4k(msg.text,!msg.final);break;
case 'translated_audio_start':_c5m=true;_g3b();if(msg.text)_o4k(msg.text,false);break;
}}
function _o7w(obj){if(_b9x.ws&&_b9x.ws.readyState===WebSocket.OPEN){_b9x.ws.send(JSON.stringify(obj));}}
function _h5p(){const t=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];for(const x of t){if(MediaRecorder.isTypeSupported(x))return x;}return '';}
let _m3j='';
async function _z7q(){
if(_b9x.isTalking)return;
if(_b9x.currentSpeakerId&&_b9x.currentSpeakerId!==_b9x.myId)return;
_f6c();_b9x.isTalking=true;_q3f.classList.add('active');_v9t();
try{
if(!_b9x.mediaStream){_b9x.mediaStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});_r8n(_b9x.mediaStream);}
const mt=_h5p();_m3j=mt;const ro={};if(mt)ro.mimeType=mt;
_b9x.mediaRecorder=new MediaRecorder(_b9x.mediaStream,ro);
const ut=mt.includes('webm')||mt.includes('ogg');
_b9x.mediaRecorder.ondataavailable=(e)=>{if(e.data&&e.data.size>0&&_b9x.ws?.readyState===WebSocket.OPEN){_b9x.ws.send(e.data);}};
_b9x.mediaRecorder.onstop=()=>{_o7w({type:'talking_stop'});};
_b9x.mediaRecorder.onerror=(e)=>console.error('Recorder error:',e.error);
_b9x.mediaRecorder.start(ut?100:undefined);
_o7w({type:'talking_start'});
}catch(err){console.error('Mic error:',err);_b9x.isTalking=false;_q3f.classList.remove('active');}
}
function _w4m(){
if(!_b9x.isTalking)return;
_b9x.isTalking=false;_q3f.classList.remove('active');
const rc=_b9x.mediaRecorder;_b9x.mediaRecorder=null;_b1s();
if(rc&&rc.state!=='inactive'){rc.stop();if(_b9x.mediaStream){_b9x.mediaStream.getTracks().forEach(t=>t.stop());_b9x.mediaStream=null;}}else{_o7w({type:'talking_stop'});}
}
const _p2x=document.getElementById('r6n4');
const _K8=5;
function _o4k(text,isInterim){
if(isInterim){let it=_p2x.querySelector('.q1z7');if(!it){it=document.createElement('div');it.className='m9f5 q1z7';_p2x.appendChild(it);}it.textContent=text;return;}
const it=_p2x.querySelector('.q1z7');if(it)it.remove();
const es=_p2x.querySelectorAll('.m9f5');es.forEach(el=>{if(el.classList.contains('w3k8')){el.classList.add('p4j2');}else{el.classList.add('w3k8');}});
const al=_p2x.querySelectorAll('.m9f5');if(al.length>=_K8){al[0].remove();}
const en=document.createElement('div');en.className='m9f5';en.textContent=text;_p2x.prepend(en);
setTimeout(()=>en.classList.add('w3k8'),60000);setTimeout(()=>en.remove(),300000);
}
const _q1n=document.getElementById('c5v7');
const _j7v=document.getElementById('c5v7-name');
let _s6w=null;
function _e2v(name){_s6w=name;_j7v.textContent=name;_q1n.classList.add('visible');}
function _g3b(){_s6w=null;_q1n.classList.remove('visible');}
let _c5m=false;
let _i8q=false;
function _p8f(ab){const ac=_f6c();ac.decodeAudioData(ab.slice(0),(d)=>{const s=ac.createBufferSource();s.buffer=d;s.connect(ac.destination);s.start(0);},()=>{});}
let _n2b=null;
let _t7r=[];
function _f6c(){if(!_n2b||_n2b.state==='closed'){_n2b=new AudioContext();}if(_n2b.state==='suspended'){_n2b.resume();}return _n2b;}
function _n5r(){_t7r=[];_u8z=0;}
function _t3q(ab){_t7r.push(ab);_x4c();}
function _x4c(){
if(_t7r.length===0)return;
const bl=new Blob(_t7r,{type:_m3j||_h5p()||'audio/webm;codecs=opus'});
bl.arrayBuffer().then(buf=>{const ac=_f6c();const pr=ac.decodeAudioData(buf.slice(0),(d)=>{_h9w(d);},()=>{});if(pr&&typeof pr.catch==='function')pr.catch(()=>{});});
}
let _u8z=0;
function _h9w(d){
const ac=_f6c();const now=ac.currentTime;
if(_u8z<now){_u8z=now+0.05;}
const s=ac.createBufferSource();s.buffer=d;s.connect(ac.destination);
const la=_u8z-now;
if(la<0.5){s.start(_u8z);_u8z=_u8z+d.duration;}
}
function _r8n(stream){_b9x.audioContext=new AudioContext();const s=_b9x.audioContext.createMediaStreamSource(stream);_b9x.analyserNode=_b9x.audioContext.createAnalyser();_b9x.analyserNode.fftSize=256;_b9x.analyserNode.smoothingTimeConstant=0.8;s.connect(_b9x.analyserNode);}
function _v9t(){_e4t.classList.add('visible');_j6d.width=_j6d.offsetWidth*devicePixelRatio;_j6d.height=_j6d.offsetHeight*devicePixelRatio;_c8r();}
function _b1s(){_e4t.classList.remove('visible');if(_b9x.animFrameId){cancelAnimationFrame(_b9x.animFrameId);_b9x.animFrameId=null;}_x9s.clearRect(0,0,_j6d.width,_j6d.height);}
let _k3p=0;
function _c8r(){
_b9x.animFrameId=requestAnimationFrame(_c8r);
const w=_j6d.offsetWidth;const h=_j6d.offsetHeight;_x9s.clearRect(0,0,w,h);
const ha=!!_b9x.analyserNode;const bl=ha?_b9x.analyserNode.frequencyBinCount:32;const da=new Uint8Array(bl);
if(ha)_b9x.analyserNode.getByteFrequencyData(da);
const mx=ha?Math.max(...da):0;const hs=mx>8;const bw=w/bl;
if(!hs){
_k3p+=0.05;const my=h/2;const it=document.body.classList.contains('f1m3');
const lc=it?'rgba(0,255,65,0.25)':'rgba(160,0,0,0.25)';const dc=it?'rgba(0,255,65,0.5)':'rgba(160,0,0,0.5)';
_x9s.fillStyle=lc;_x9s.fillRect(0,my-0.5,w,1);
for(let d=0;d<3;d++){const x=w*(d+1)/4;const pu=0.3+0.3*Math.sin(_k3p+d*2.1);const r=1.5+pu*1.5;_x9s.beginPath();_x9s.arc(x,my,r,0,Math.PI*2);_x9s.fillStyle=dc;_x9s.fill();}
return;
}
for(let i=0;i<bl;i++){const v=da[i]/255;const bh=v*h;const al=0.3+v*0.7;const it=document.body.classList.contains('f1m3');_x9s.fillStyle=it?`rgba(0,255,65,${al})`:`rgba(200,20,0,${al})`;_x9s.fillRect(i*bw,h-bh,Math.max(bw-1,1),bh);}
}
function _a1x(name){_v5n.textContent=name;_m2r.classList.add('visible');}
function _d9z(){_m2r.classList.remove('visible');}
function _z5k(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function _y4h(){
const s=_b9x.strings||_f2j['e9k2'];const c=_b9x.users.size;
_z8c.textContent=`Connected · ${c} on channel`;_z8c.className='connected';
_h1p.innerHTML='';
for(const[id,u] of _b9x.users){const el=document.createElement('div');el.className='z4r1'+(u.talking?' x6w9':'');el.innerHTML=`<span class="d8n5${u.talking?' active':''}"></span>`+`<span>${_z5k(u.name)}</span>`+(u.talking?`<span class="h2v7">${s.userLive}</span>`:'')+( id===_b9x.myId?`<span class="g3p4">${s.userYou}</span>`:'');_h1p.appendChild(el);}
}
_q3f.addEventListener('pointerdown',(e)=>{e.preventDefault();_q3f.setPointerCapture(e.pointerId);_z7q();});
_q3f.addEventListener('pointerup',_w4m);
_q3f.addEventListener('pointercancel',_w4m);
document.addEventListener('keydown',(e)=>{if(e.code==='Space'&&!e.repeat&&document.activeElement!==_w7k){e.preventDefault();_z7q();}});
document.addEventListener('keyup',(e)=>{if(e.code==='Space'){e.preventDefault();_w4m();}});
_w7k.addEventListener('change',()=>{const n=_w7k.value.trim();if(n){_b9x.myName=n;_o7w({type:'name_change',name:n});}});
const _q7t=['e9k2','f1m3'];let _r4w=0;
document.getElementById('j5x8').addEventListener('click',()=>{document.body.classList.remove(_q7t[_r4w]);_r4w=(_r4w+1)%_q7t.length;document.body.classList.add(_q7t[_r4w]);});
let _r1v=false;
document.getElementById('k7b4').addEventListener('click',()=>{_r1v=!_r1v;document.getElementById('k7b4').classList.toggle('active',_r1v);_o7w({type:'set_megaphone',enabled:_r1v});});
const _f2j={en:{tagline:'– bara säg till',nameLabel:'Name',pttLabel:'Hold to Talk',bannerPrefix:'NOW TALKING:',userYou:'you',userLive:'LIVE',reconnecting:'Reconnecting…'},qc:{tagline:'– dis-le moé',nameLabel:'Nom',pttLabel:'Tiens pis parle',bannerPrefix:'ASTEURE Y\'PARLE:',userYou:'toé',userLive:'SUR LES ONDES',reconnecting:'On r\'essaye…'},sml:{tagline:'– säj ba te',nameLabel:'Namn',pttLabel:'Håll å prat',bannerPrefix:'NU PRATAR:',userYou:'du sjölv',userLive:'PÅ LUFTEN',reconnecting:'Försöker igen…'},lidingo:{tagline:'– typ, säg till asså',nameLabel:'Namn',pttLabel:'Håll in, liksom',bannerPrefix:'PRATAR JUST NU:',userYou:'du asså',userLive:'PÅ LUFTEN',reconnecting:'Reconnectar…'},gbg:{tagline:'– ba säj te dåå',nameLabel:'Namn',pttLabel:'Håll i å snacka',bannerPrefix:'SNACKAR NU:',userYou:'du dåå',userLive:'PÅ LOFTET',reconnecting:'Försöker igen dåå…'},blatte:{tagline:'– lägg ett snack',nameLabel:'Namn',pttLabel:'Tryck å keff',bannerPrefix:'KEFFAR NU:',userYou:'du själv bre',userLive:'I TRAFIKEN',reconnecting:'Vänta bre…'}};
function _d3n(lang){const s=_f2j[lang];_b9x.strings=s;_b9x.lang=lang;document.querySelector('.y2t6').textContent=s.tagline;document.getElementById('l8q3').textContent=s.nameLabel;document.querySelector('.o5c1').textContent=s.pttLabel;document.querySelector('#t8p3 span:first-of-type').textContent=s.bannerPrefix;document.querySelectorAll('.w1n6').forEach(btn=>{btn.classList.toggle('active',btn.dataset.lang===lang);});_o7w({type:'set_lang',lang});_y4h();}
document.querySelectorAll('.w1n6').forEach(btn=>{btn.addEventListener('click',()=>_d3n(btn.dataset.lang));});
function _m6p(){
_d3n('en');
const ul=document.getElementById('a4v2');const ht=document.getElementById('a4v2-hint');
ul.addEventListener('click',async()=>{_n2b=new AudioContext();_n2b.resume();ht.textContent='Requesting microphone…';try{_b9x.mediaStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});_r8n(_b9x.mediaStream);}catch(err){}ul.style.display='none';_l4b();},{once:true});
}
_m6p();
