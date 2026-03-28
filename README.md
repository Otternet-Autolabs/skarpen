# Skarpen

Real-time push-to-talk with automatic speech-to-speech translation. Everyone hears each other in their own language.

Built on [Meta SeamlessM4T v2](https://github.com/facebookresearch/seamless_communication) and [faster-whisper](https://github.com/guillaumekynast/faster-whisper). Runs as a single Docker container. Works as a PWA on mobile.

---

## How it works

1. User holds the button (or Space) and speaks
2. The server receives audio, detects the source language via Whisper
3. SeamlessM4T translates speech-to-speech for each listener in their selected language
4. Each listener hears translated audio in near real-time
5. Transcripts are shown in the UI

**Megaphone mode** — streams raw audio live to all listeners without waiting for translation, then delivers text-only transcripts at the end (no translated audio). Useful when low latency matters more than translation, or when the speaker's language is understood by most listeners. Enable with the 📢 button in the header — active state is highlighted.

**Themes** — toggle between two themes with the 🎨 button in the header: a clean light theme and a green-on-black radar/terminal theme.

---

## Supported languages

| UI label | Language       |
|----------|----------------|
| 🇬🇧 EN   | English        |
| QC       | Québécois French |
| SML      | Småländska (Swedish) |
| LDG      | Lidingö (Swedish) |
| GBG      | Göteborgska (Swedish) |
| BLT      | Blattesvenska (Swedish) |

Language is set per client — each person chooses their own.

---

## Requirements

- Docker with Compose
- **GPU (recommended):** NVIDIA GPU with CUDA 12.1+, [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed
- **CPU (fallback):** Any machine — slower, higher latency (~10–30s per translation instead of ~2–5s)

---

## Quick start

### GPU (recommended)

```bash
docker compose up -d
```

The `docker-compose.yml` requests all available NVIDIA GPUs by default. No changes needed.

### CPU only

Edit `docker-compose.yml` and remove the `deploy` block:

```yaml
services:
  skarpen:
    build: .
    ports:
      - "8003:8003"
    restart: unless-stopped
    # Remove or comment out the deploy section below:
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]
    networks:
      - skarpen_net
```

The backend auto-detects CUDA at startup and falls back to CPU if unavailable:

```
[seamless] loading model on device=cpu
```

On CPU, `torch.float32` is used instead of `float16`.

### Switching between GPU and CPU at runtime

You can override the device without editing any code by setting the environment variable `CUDA_VISIBLE_DEVICES`:

```bash
# Force CPU even if a GPU is present
CUDA_VISIBLE_DEVICES="" docker compose up -d

# Use only GPU 0
CUDA_VISIBLE_DEVICES="0" docker compose up -d
```

Or add it to `docker-compose.yml`:

```yaml
services:
  skarpen:
    build: .
    environment:
      - CUDA_VISIBLE_DEVICES=  # empty string = CPU only
```

---

## Build

First build downloads and caches the SeamlessM4T v2 large model (~10 GB) and faster-whisper large-v3 (~3 GB) inside the image. This only happens once.

```bash
docker compose build
```

---

## Access

Open `http://<host>:8003` in a browser. On first load, tap anywhere to unlock audio (browser requirement). Install as a PWA from the browser menu for a native-app feel on mobile.

---

## Logs

```bash
docker compose logs -f
```

Expected startup output:
```
[seamless] loading model on device=cuda
[whisper] loading faster-whisper large-v3 for language detection
```

Per-translation output:
```
[whisper] lang='sv' prob=0.97
[seamless] detected='swe' text='Hej, hur mår du?'
[seamless] S2ST tgt='eng' text='Hey, how are you?'
```

---

## Configuration

There is no config file — all settings are UI-driven per session (name, language, megaphone mode). Port can be changed in `docker-compose.yml`.

---

## Stack

| Component | Role |
|-----------|------|
| FastAPI + uvicorn | WebSocket server |
| SeamlessM4T v2 large | Speech-to-speech translation |
| faster-whisper large-v3 | Language detection |
| ffmpeg | Audio format conversion |
| Vanilla JS + Web Audio API | Frontend, PTT, visualizer |
| PWA | Installable on mobile |
