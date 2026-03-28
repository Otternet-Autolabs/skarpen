FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git gcc g++ build-essential && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.2.2+cu121 torchaudio==2.2.2+cu121 --index-url https://download.pytorch.org/whl/cu121
RUN pip install --no-cache-dir fairseq2==0.2.1
RUN pip install --no-cache-dir git+https://github.com/facebookresearch/seamless_communication.git
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" faster-whisper
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3', device='cpu', compute_type='int8')"
RUN python -c "from seamless_communication.inference import Translator; import torch; Translator('seamlessM4T_v2_large', 'vocoder_v2', device=torch.device('cpu'), dtype=torch.float32)"
COPY backend/ backend/
COPY frontend/ frontend/
EXPOSE 8003
CMD ["uvicorn", "backend.main:x3b", "--host", "0.0.0.0", "--port", "8003"]
