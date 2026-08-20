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

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
