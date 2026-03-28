from __future__ import annotations
import io,json,os,subprocess,asyncio,tempfile,uuid
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI,WebSocket,WebSocketDisconnect,Query
from fastapi.staticfiles import StaticFiles
import torch,torchaudio
from faster_whisper import WhisperModel
from seamless_communication.inference import Translator
from backend.x7f2 import g9k1
x3b=FastAPI(title="Skarpen")
def _d8n()->str:
 if torch.cuda.is_available():return "cuda"
 return "cpu"
_q1w=_d8n()
print(f"[seamless] loading model on device={_q1w}")
_r5t=Translator(model_name_or_card="seamlessM4T_v2_large",vocoder_name_or_card="vocoder_v2",device=torch.device(_q1w),dtype=torch.float16 if _q1w=="cuda" else torch.float32,)
print("[whisper] loading faster-whisper large-v3 for language detection")
_h2m=WhisperModel("large-v3",device="cpu",compute_type="int8")
_p6x=ThreadPoolExecutor(max_workers=2)
_v9c:dict[str,str]={"en":"eng","qc":"fra","sml":"swe","lidingo":"swe","gbg":"swe","blatte":"swe",}
_z4j:dict[str,str]={"en":"eng","sv":"swe","fr":"fra"}
def _k8q(n4r:str)->str|None:
 w1s,m3p=_h2m.transcribe(n4r,beam_size=1,language=None,task="transcribe",without_timestamps=True)
 list(w1s)
 b7f=m3p.language
 e2l=m3p.language_probability
 print(f"[whisper] lang={b7f!r} prob={e2l:.3f}")
 return _z4j.get(b7f)
def _s1n(c5v:str,u8b:str):
 r6g=subprocess.run(["ffmpeg","-y","-probesize","50M","-i",c5v,"-ar","16000","-ac","1","-f","wav",u8b],capture_output=True,)
 if r6g.returncode!=0:raise subprocess.CalledProcessError(r6g.returncode,r6g.args,stderr=r6g.stderr)
def _f3w(o9d:bytes,l2k:str)->tuple[bytes,str]:
 with tempfile.NamedTemporaryFile(suffix=".webm",delete=False) as t5h:
  t5h.write(o9d);a4m=t5h.name
 i7p=a4m+"_input.wav";q2r=None
 try:
  _s1n(a4m,i7p)
  y6n,j1c=_r5t.predict(input=i7p,task_str="S2ST",tgt_lang=l2k,)
  w8x=str(y6n[0]).strip() if y6n else ""
  print(f"[seamless] S2ST tgt={l2k!r} text={w8x!r}")
  b3z=io.BytesIO()
  d5q=j1c.audio_wavs[0].cpu().to(torch.float32)
  while d5q.dim()>2:d5q=d5q.squeeze(0)
  if d5q.dim()==1:d5q=d5q.unsqueeze(0)
  torchaudio.save(b3z,d5q,j1c.sample_rate,format="wav")
  return b3z.getvalue(),w8x
 finally:
  os.unlink(a4m)
  if os.path.exists(i7p):os.unlink(i7p)
class _X2p:
 def __init__(self):
  self.e8r:dict[str,dict]={}
  self.n3v:dict[str,list[bytes]]={}
 async def r7t(self,ws:WebSocket,c1d:str,m5b:str):
  await ws.accept()
  self.e8r[c1d]={"ws":ws,"name":m5b,"talking":False,"lang":"en","megaphone":False}
  await ws.send_text(json.dumps({"type":"init","your_id":c1d,"users":self._u4l(),}))
  await self.q9s({"type":"user_joined","client_id":c1d,"name":m5b},exclude=c1d,)
 async def w2k(self,c1d:str):
  self.n3v.pop(c1d,None)
  z6f=self.e8r.pop(c1d,None)
  if z6f and z6f["talking"]:await self.q9s({"type":"talking_state","client_id":c1d,"name":z6f["name"],"talking":False})
  await self.q9s({"type":"user_left","client_id":c1d})
 async def q9s(self,msg:dict,exclude:str|None=None):
  h1x=json.dumps(msg)
  for v3n,p8c in list(self.e8r.items()):
   if v3n==exclude:continue
   try:await p8c["ws"].send_text(h1x)
   except Exception:pass
 async def b4g(self,c1d:str,data:bytes):
  k7j=self.e8r.get(c1d)
  if k7j:
   try:await k7j["ws"].send_bytes(data)
   except Exception:pass
 async def l5m(self,data:bytes,exclude:str|None=None):
  for v3n,p8c in list(self.e8r.items()):
   if v3n==exclude:continue
   try:await p8c["ws"].send_bytes(data)
   except Exception:pass
 async def t6p(self,c1d:str,talking:bool):
  if c1d not in self.e8r:return
  self.e8r[c1d]["talking"]=talking
  o2w=self.e8r[c1d]["name"]
  f9h=self.e8r[c1d].get("megaphone",False)
  await self.q9s({"type":"talking_state","client_id":c1d,"name":o2w,"talking":talking,"megaphone":f9h})
 async def u8n(self,c1d:str,name:str):
  if c1d not in self.e8r:return
  name=name.strip()[:24] or g9k1()
  self.e8r[c1d]["name"]=name
  await self.q9s({"type":"name_change","client_id":c1d,"name":name})
 def c3k(self,c1d:str,lang:str):
  if c1d in self.e8r and lang in _v9c:self.e8r[c1d]["lang"]=lang
 def m7r(self,c1d:str,enabled:bool):
  if c1d in self.e8r:self.e8r[c1d]["megaphone"]=enabled
 def s9v(self,c1d:str):self.n3v[c1d]=[]
 def a1b(self,c1d:str,data:bytes):
  if c1d in self.n3v:self.n3v[c1d].append(data)
 async def j4x(self,c1d:str,data:bytes):
  if not self.e8r.get(c1d,{}).get("megaphone",False):return
  for v3n,p8c in list(self.e8r.items()):
   if v3n==c1d:continue
   try:await p8c["ws"].send_bytes(data)
   except Exception:pass
 async def e5q(self,c1d:str):
  h8w=self.n3v.pop(c1d,[])
  if not h8w:return
  r2v=b"".join(h8w)
  if len(r2v)<3200:return
  if c1d not in self.e8r:return
  g3p=self.e8r[c1d].get("megaphone",False)
  y1n:dict[str,list[str]]={}
  for v3n,p8c in list(self.e8r.items()):
   if v3n==c1d:continue
   d7k=_v9c.get(p8c["lang"],"eng")
   print(f"[seamless] listener {p8c['name']!r} lang={p8c['lang']!r} → {d7k}")
   y1n.setdefault(d7k,[]).append(v3n)
  z8m=asyncio.get_event_loop()
  def _i6f():
   with tempfile.NamedTemporaryFile(suffix=".webm",delete=False) as t5h:
    t5h.write(r2v);a4m=t5h.name
   i7p=a4m+"_input.wav"
   try:
    _s1n(a4m,i7p)
    with open(i7p,"rb") as wf:c9x=wf.read()
    q5b=_k8q(i7p);n2s=""
    if q5b:
     try:
      l3w,_=_r5t.predict(input=i7p,task_str="ASR",tgt_lang=q5b)
      n2s=str(l3w[0]).strip() if l3w else ""
     except Exception:pass
    print(f"[seamless] detected={q5b!r} text={n2s!r}")
    u4r:dict[str,tuple[bytes|None,str]]={}
    for o8t in y1n:
     try:
      if g3p:
       if q5b==o8t:u4r[o8t]=(None,n2s)
       else:
        f2k,_=_r5t.predict(input=i7p,task_str="S2TT",tgt_lang=o8t)
        v7c=str(f2k[0]).strip() if f2k else ""
        u4r[o8t]=(None,v7c)
       print(f"[mega] {o8t}: {u4r[o8t][1]!r}")
      else:
       if q5b==o8t:
        print(f"[seamless] {o8t}: PASSTHROUGH")
        u4r[o8t]=(c9x,n2s)
       else:
        print(f"[seamless] {o8t}: S2ST")
        u4r[o8t]=_f3w(r2v,o8t)
     except Exception as e:
      print(f"[seamless] →{o8t} error: {e!r}, falling back to original audio")
      u4r[o8t]=(None,n2s) if g3p else (c9x,n2s)
    return u4r
   finally:
    os.unlink(a4m)
    if os.path.exists(i7p):os.unlink(i7p)
  try:
   w3b=await z8m.run_in_executor(_p6x,_i6f)
   for o8t,(x5n,h6v) in w3b.items():
    for v3n in y1n[o8t]:
     p8c=self.e8r.get(v3n)
     if p8c:
      try:
       if x5n is None:
        if h6v:await p8c["ws"].send_text(json.dumps({"type":"transcript","text":h6v,"final":True,"from":c1d,}))
       else:
        await p8c["ws"].send_text(json.dumps({"type":"translated_audio_start","from":c1d,"text":h6v,}))
        await p8c["ws"].send_bytes(x5n)
      except Exception as e:print(f"[seamless] send to {v3n} failed: {e!r}")
  except Exception as e:
   m1p=getattr(e,'stderr',b'')
   if m1p:print(f"[seamless] ffmpeg stderr: {m1p.decode(errors='replace')[-500:]}")
   print(f"[seamless] stop_recording error: {e!r}")
 def _u4l(self)->list[dict]:
  return [{"client_id":v3n,"name":p8c["name"],"talking":p8c["talking"]} for v3n,p8c in self.e8r.items()]
_w5z=_X2p()
@x3b.get("/api/users")
async def _b9n():return _w5z._u4l()
@x3b.websocket("/ws")
async def _o3c(ws:WebSocket,name:str=Query(default="")):
 c1d=str(uuid.uuid4())
 name=name.strip()[:24] or g9k1()
 await _w5z.r7t(ws,c1d,name)
 try:
  while True:
   msg=await ws.receive()
   if "bytes" in msg and msg["bytes"]:
    _w5z.a1b(c1d,msg["bytes"])
    await _w5z.j4x(c1d,msg["bytes"])
   elif "text" in msg and msg["text"]:
    data=json.loads(msg["text"]);t=data.get("type")
    if t=="talking_start":_w5z.s9v(c1d);await _w5z.t6p(c1d,True)
    elif t=="talking_stop":await _w5z.t6p(c1d,False);await _w5z.e5q(c1d)
    elif t=="name_change":await _w5z.u8n(c1d,data.get("name",""))
    elif t=="set_lang":_w5z.c3k(c1d,data.get("lang","en"))
    elif t=="set_megaphone":_w5z.m7r(c1d,bool(data.get("enabled",False)))
 except WebSocketDisconnect:await _w5z.w2k(c1d)
 except Exception:await _w5z.w2k(c1d)
x3b.mount("/",StaticFiles(directory="frontend",html=True),name="static")
