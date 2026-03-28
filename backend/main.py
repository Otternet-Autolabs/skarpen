from __future__ import annotations
import io
import json
import os
import subprocess
import asyncio
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
import torch
import torchaudio
from faster_whisper import WhisperModel
from seamless_communication.inference import Translator

from backend.names import generate_name

app = FastAPI(title="Skarpen")

# ── Device selection ───────────────────────────────────────────────────────────
def _best_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"

_device = _best_device()
print(f"[seamless] loading model on device={_device}")
_translator = Translator(
    model_name_or_card="seamlessM4T_v2_large",
    vocoder_name_or_card="vocoder_v2",
    device=torch.device(_device),
    dtype=torch.float16 if _device == "cuda" else torch.float32,
)
print("[whisper] loading faster-whisper large-v3 for language detection")
_fw_model = WhisperModel("large-v3", device="cpu", compute_type="int8")
_executor = ThreadPoolExecutor(max_workers=2)

# Map UI language keys to SeamlessM4T language codes (ISO 639-3 style)
_LANG_CODE: dict[str, str] = {
    "en":      "eng",
    "qc":      "fra",
    "sml":     "swe",
    "lidingo": "swe",
    "gbg":     "swe",
    "blatte":  "swe",
}

# ISO 639-1 (Whisper) → SeamlessM4T codes
_WHISPER_LANG_MAP: dict[str, str] = {"en": "eng", "sv": "swe", "fr": "fra"}


def _detect_lang_whisper(wav_path: str) -> str | None:
    """Use faster-whisper large-v3 to detect spoken language. Returns SeamlessM4T code or None."""
    segments, info = _fw_model.transcribe(wav_path, beam_size=1, language=None, task="transcribe", without_timestamps=True)
    # Consume generator to trigger detection
    list(segments)
    lang = info.language
    prob = info.language_probability
    print(f"[whisper] lang={lang!r} prob={prob:.3f}")
    return _WHISPER_LANG_MAP.get(lang)


def _webm_to_wav(src_path: str, dst_path: str):
    """Convert any audio file to 16kHz mono wav using ffmpeg."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-probesize", "50M", "-i", src_path, "-ar", "16000", "-ac", "1", "-f", "wav", dst_path],
        capture_output=True,
    )
    if result.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, result.args, stderr=result.stderr)


def _translate_speech(audio_bytes: bytes, tgt_lang: str) -> tuple[bytes, str]:
    """
    Run SeamlessM4T speech-to-speech translation.
    audio_bytes: webm/opus audio from MediaRecorder
    tgt_lang: SeamlessM4T language code (eng/swe/fra)
    src_lang is omitted — model auto-detects source language from audio.
    Returns: wav bytes (16kHz mono)
    """
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        tmp_in = f.name

    tmp_wav = tmp_in + "_input.wav"
    tmp_out = None
    try:
        # Convert webm → 16kHz mono wav via ffmpeg
        _webm_to_wav(tmp_in, tmp_wav)

        # Run S2ST — src_lang omitted so model auto-detects source language
        texts, speech_output = _translator.predict(
            input=tmp_wav,
            task_str="S2ST",
            tgt_lang=tgt_lang,
        )
        text = str(texts[0]).strip() if texts else ""
        print(f"[seamless] S2ST tgt={tgt_lang!r} text={text!r}")

        # Encode output as wav bytes
        buf = io.BytesIO()
        out_audio = speech_output.audio_wavs[0].cpu().to(torch.float32)
        # Ensure exactly 2D: [channels, samples]
        while out_audio.dim() > 2:
            out_audio = out_audio.squeeze(0)
        if out_audio.dim() == 1:
            out_audio = out_audio.unsqueeze(0)
        torchaudio.save(buf, out_audio, speech_output.sample_rate, format="wav")
        return buf.getvalue(), text
    finally:
        os.unlink(tmp_in)
        if os.path.exists(tmp_wav):
            os.unlink(tmp_wav)


class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, dict] = {}
        self.audio_buffers: dict[str, list[bytes]] = {}

    async def connect(self, ws: WebSocket, client_id: str, name: str):
        await ws.accept()
        self.connections[client_id] = {"ws": ws, "name": name, "talking": False, "lang": "en", "megaphone": False}
        await ws.send_text(json.dumps({
            "type": "init",
            "your_id": client_id,
            "users": self._user_list(),
        }))
        await self.broadcast_json(
            {"type": "user_joined", "client_id": client_id, "name": name},
            exclude=client_id,
        )

    async def disconnect(self, client_id: str):
        self.audio_buffers.pop(client_id, None)
        conn = self.connections.pop(client_id, None)
        if conn and conn["talking"]:
            await self.broadcast_json(
                {"type": "talking_state", "client_id": client_id, "name": conn["name"], "talking": False}
            )
        await self.broadcast_json({"type": "user_left", "client_id": client_id})

    async def broadcast_json(self, msg: dict, exclude: str | None = None):
        text = json.dumps(msg)
        for cid, conn in list(self.connections.items()):
            if cid == exclude:
                continue
            try:
                await conn["ws"].send_text(text)
            except Exception:
                pass

    async def send_bytes_to(self, client_id: str, data: bytes):
        conn = self.connections.get(client_id)
        if conn:
            try:
                await conn["ws"].send_bytes(data)
            except Exception:
                pass

    async def broadcast_bytes(self, data: bytes, exclude: str | None = None):
        for cid, conn in list(self.connections.items()):
            if cid == exclude:
                continue
            try:
                await conn["ws"].send_bytes(data)
            except Exception:
                pass

    async def set_talking(self, client_id: str, talking: bool):
        if client_id not in self.connections:
            return
        self.connections[client_id]["talking"] = talking
        name = self.connections[client_id]["name"]
        megaphone = self.connections[client_id].get("megaphone", False)
        await self.broadcast_json(
            {"type": "talking_state", "client_id": client_id, "name": name, "talking": talking, "megaphone": megaphone}
        )

    async def update_name(self, client_id: str, name: str):
        if client_id not in self.connections:
            return
        name = name.strip()[:24] or generate_name()
        self.connections[client_id]["name"] = name
        await self.broadcast_json(
            {"type": "name_change", "client_id": client_id, "name": name}
        )

    def update_lang(self, client_id: str, lang: str):
        if client_id in self.connections and lang in _LANG_CODE:
            self.connections[client_id]["lang"] = lang

    def update_megaphone(self, client_id: str, enabled: bool):
        if client_id in self.connections:
            self.connections[client_id]["megaphone"] = enabled

    def start_recording(self, client_id: str):
        self.audio_buffers[client_id] = []

    def append_audio(self, client_id: str, data: bytes):
        if client_id in self.audio_buffers:
            self.audio_buffers[client_id].append(data)


    async def forward_chunk(self, client_id: str, data: bytes):
        """Forward a raw audio chunk to all listeners when speaker is in megaphone mode."""
        if not self.connections.get(client_id, {}).get("megaphone", False):
            return
        for cid, conn in list(self.connections.items()):
            if cid == client_id:
                continue
            try:
                await conn["ws"].send_bytes(data)
            except Exception:
                pass

    async def stop_recording(self, client_id: str):
        chunks = self.audio_buffers.pop(client_id, [])
        if not chunks:
            return
        audio_bytes = b"".join(chunks)
        if len(audio_bytes) < 3200:
            return
        if client_id not in self.connections:
            return

        # Capture megaphone state now, before any await gives it a chance to change
        speaker_mega = self.connections[client_id].get("megaphone", False)

        # Group all listeners by target language
        targets: dict[str, list[str]] = {}
        for cid, conn in list(self.connections.items()):
            if cid == client_id:
                continue
            target_seamless = _LANG_CODE.get(conn["lang"], "eng")
            print(f"[seamless] listener {conn['name']!r} lang={conn['lang']!r} → {target_seamless}")
            targets.setdefault(target_seamless, []).append(cid)

        loop = asyncio.get_event_loop()

        def run_translations():
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
                f.write(audio_bytes)
                tmp_in = f.name
            tmp_wav = tmp_in + "_input.wav"
            try:
                _webm_to_wav(tmp_in, tmp_wav)
                with open(tmp_wav, "rb") as wf:
                    wav_data = wf.read()

                detected_lang = _detect_lang_whisper(tmp_wav)
                detected_text = ""
                if detected_lang:
                    try:
                        asr_texts, _ = _translator.predict(input=tmp_wav, task_str="ASR", tgt_lang=detected_lang)
                        detected_text = str(asr_texts[0]).strip() if asr_texts else ""
                    except Exception:
                        pass
                print(f"[seamless] detected={detected_lang!r} text={detected_text!r}")

                results: dict[str, tuple[bytes | None, str]] = {}
                for tgt_lang in targets:
                    try:
                        if speaker_mega:
                            # Text only — S2TT
                            if detected_lang == tgt_lang:
                                results[tgt_lang] = (None, detected_text)
                            else:
                                s2tt_texts, _ = _translator.predict(input=tmp_wav, task_str="S2TT", tgt_lang=tgt_lang)
                                text = str(s2tt_texts[0]).strip() if s2tt_texts else ""
                                results[tgt_lang] = (None, text)
                            print(f"[mega] {tgt_lang}: {results[tgt_lang][1]!r}")
                        else:
                            # S2ST audio + text
                            if detected_lang == tgt_lang:
                                print(f"[seamless] {tgt_lang}: PASSTHROUGH")
                                results[tgt_lang] = (wav_data, detected_text)
                            else:
                                print(f"[seamless] {tgt_lang}: S2ST")
                                results[tgt_lang] = _translate_speech(audio_bytes, tgt_lang)
                    except Exception as e:
                        print(f"[seamless] →{tgt_lang} error: {e!r}, falling back to original audio")
                        results[tgt_lang] = (None, detected_text) if speaker_mega else (wav_data, detected_text)

                return results
            finally:
                os.unlink(tmp_in)
                if os.path.exists(tmp_wav):
                    os.unlink(tmp_wav)

        try:
            results = await loop.run_in_executor(_executor, run_translations)
            for tgt_lang, (wav_bytes, text) in results.items():
                for cid in targets[tgt_lang]:
                    conn = self.connections.get(cid)
                    if conn:
                        try:
                            if wav_bytes is None:
                                # Megaphone: text only
                                if text:
                                    await conn["ws"].send_text(json.dumps({
                                        "type": "transcript", "text": text, "final": True, "from": client_id,
                                    }))
                            else:
                                # Normal: audio + text
                                await conn["ws"].send_text(json.dumps({
                                    "type": "translated_audio_start",
                                    "from": client_id,
                                    "text": text,
                                }))
                                await conn["ws"].send_bytes(wav_bytes)
                        except Exception as e:
                            print(f"[seamless] send to {cid} failed: {e!r}")
        except Exception as e:
            ffmpeg_stderr = getattr(e, 'stderr', b'')
            if ffmpeg_stderr:
                print(f"[seamless] ffmpeg stderr: {ffmpeg_stderr.decode(errors='replace')[-500:]}")
            print(f"[seamless] stop_recording error: {e!r}")

    def _user_list(self) -> list[dict]:
        return [
            {"client_id": cid, "name": c["name"], "talking": c["talking"]}
            for cid, c in self.connections.items()
        ]


manager = ConnectionManager()


@app.get("/api/users")
async def users():
    return manager._user_list()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, name: str = Query(default="")):
    client_id = str(uuid.uuid4())
    name = name.strip()[:24] or generate_name()
    await manager.connect(ws, client_id, name)
    try:
        while True:
            msg = await ws.receive()
            if "bytes" in msg and msg["bytes"]:
                manager.append_audio(client_id, msg["bytes"])
                await manager.forward_chunk(client_id, msg["bytes"])
            elif "text" in msg and msg["text"]:
                data = json.loads(msg["text"])
                t = data.get("type")
                if t == "talking_start":
                    manager.start_recording(client_id)
                    await manager.set_talking(client_id, True)
                elif t == "talking_stop":
                    await manager.set_talking(client_id, False)
                    await manager.stop_recording(client_id)
                elif t == "name_change":
                    await manager.update_name(client_id, data.get("name", ""))
                elif t == "set_lang":
                    manager.update_lang(client_id, data.get("lang", "en"))
                elif t == "set_megaphone":
                    manager.update_megaphone(client_id, bool(data.get("enabled", False)))
    except WebSocketDisconnect:
        await manager.disconnect(client_id)
    except Exception:
        await manager.disconnect(client_id)


app.mount("/", StaticFiles(directory="frontend", html=True), name="static")
