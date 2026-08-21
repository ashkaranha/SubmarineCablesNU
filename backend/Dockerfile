# Build context must be the repo root (not backend/), since this needs to
# COPY the sibling `data/` directory into the image -- Render (and most
# hosts) have no equivalent of docker-compose's local bind mount for `data/`.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the reranker model at build time instead of on the first
# search request. Downloading it lazily at request time was unreliable on
# Cloud Run (intermittent "Could not load model ... from any source"
# failures, likely cold-start/networking related) and added latency to
# whichever request happened to trigger it. Baking it into the image means
# search never needs a network call to Hugging Face at runtime. Keep this
# model name in sync with `reranker_model_name` in app/config.py.
RUN python -c "from fastembed.rerank.cross_encoder import TextCrossEncoder; TextCrossEncoder(model_name='Xenova/ms-marco-MiniLM-L-6-v2', enable_cpu_mem_arena=False, threads=1)"

COPY backend/app ./app
COPY backend/scripts ./scripts
COPY backend/db ./db
COPY data /data

ENV CABLEINCIDENTS_DATA_DIR=/data
# glibc's malloc keeps multiple per-thread memory arenas by default, which
# fragments and inflates RSS under the kind of bursty allocations an ONNX
# model's forward pass does. Capping to one arena (combined with the
# explicit malloc_trim() call in app/services/reranker.py) keeps memory
# from creeping up across repeated search requests.
ENV MALLOC_ARENA_MAX=1

# Fixed at 8001 (matches Render's configured routing port). If deploying to
# a host that requires the container to listen on a platform-injected $PORT
# (e.g. Cloud Run), tell it to target 8001 explicitly at deploy time (e.g.
# `gcloud run deploy --port 8001`) rather than changing this.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
