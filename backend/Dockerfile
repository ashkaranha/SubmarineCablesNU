# Build context must be the repo root (not backend/), since this needs to
# COPY the sibling `data/` directory into the image -- Render (and most
# hosts) have no equivalent of docker-compose's local bind mount for `data/`.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
