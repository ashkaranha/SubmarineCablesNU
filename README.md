# CableIncidentsDB

Interactive map of submarine cable incidents layered on Telegeography cable routes.

## Stack

- **Frontend:** React, TypeScript, Tailwind CSS, MapLibre GL JS
- **Backend:** FastAPI (Python)
- **Data:** `incidents.csv`, `cables_shortened.csv`, Telegeography GeoJSON snapshot
- **Vector DB:** PostgreSQL + [pgvector](https://github.com/pgvector/pgvector), embedded with a local `sentence-transformers` model, for semantic search over incidents and cables

`combined.xlsx` is kept as an archive only and is **not** used by the application.

## Project structure

```
SubmarineCablesNU/
  backend/          FastAPI service
  frontend/         React app
  data/             CSVs + Telegeography snapshot
  docker-compose.yml
```

## Prerequisites

- Python 3.11+
- Node.js 20+
- npm

## Run locally (recommended for development)

### 1. Backend

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

API docs: http://127.0.0.1:8001/docs

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5174

The Vite dev server proxies `/api` to the backend on port 8001.

## Run with Docker Compose

```bash
docker compose up --build
```

- Web: http://localhost:5174
- API: http://localhost:8001

## Data

| File | Purpose |
|------|---------|
| `data/incidents.csv` | 243 incident records |
| `data/cables_shortened.csv` | 698 cable metadata rows |
| `data/telegeography/` | Pinned Telegeography API v3 snapshot |

To refresh Telegeography data, re-download:

- `https://www.submarinecablemap.com/api/v3/cable/cable-geo.json`
- `https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json`
- `https://www.submarinecablemap.com/api/v3/cable/all.json`

Update `data/telegeography/VERSION.txt` with the fetch date.

## Vector DB (semantic search)

Incidents and cables can be loaded into a Postgres/pgvector database for semantic (nearest-neighbor) search, separate from the CSV-backed map API above.

### 1. Start Postgres with pgvector

```bash
docker compose up -d db
```

This starts `pgvector/pgvector:pg16` on `localhost:5432` (user/password/db: `cableincidents`).

### 2. Ingest the data

```bash
cd backend
python -m pip install -r requirements.txt
python -m scripts.ingest_vectordb
```

This reads `data/incidents.csv` and `data/cables_shortened.csv`, builds a short text document per row, embeds each document locally with `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions, no API key required), and writes rows + embeddings into the `incidents` and `cables` tables (schema in `backend/db/schema.sql`, created automatically). Re-running the script truncates and reloads both tables.

Override defaults with flags, e.g. `--database-url`, `--model`, `--data-dir`, `--batch-size`.

### 3. Query via the API

With the FastAPI backend running and `CABLEINCIDENTS_DATABASE_URL` pointing at the same database (defaults to `postgresql://cableincidents:cableincidents@localhost:5432/cableincidents`):

```
GET /api/v1/search?q=anchor+drag+near+taiwan&type=all&limit=10
```

- `q` — free-text query, embedded with the same model and compared by cosine similarity
- `type` — `all` (default), `incidents`, or `cables`
- `limit` — max results per type (default 10, max 50)

Returns `{ query, incidents: [...], cables: [...] }`, each result including a `score` (cosine similarity, higher is more relevant).

## AI-suggested sources

For a single incident, the incident detail panel has a "Find more sources" button that calls:

```
GET /api/v1/incidents/{id}/sources
```

This returns the sources already recorded in the dataset (`existing_sources`) plus, on demand, sources found live via Gemini's Google Search grounding tool (`llm_sources`) — clearly labeled in the UI as AI-found and unverified, distinct from the dataset's own sources. Requires a `GOOGLE_API_KEY` environment variable on the backend (a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)); without one, the endpoint returns a 503 and the button surfaces a friendly error instead of breaking the panel. The model defaults to `gemini-2.5-flash` (override with `CABLEINCIDENTS_GOOGLE_MODEL_NAME`).

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Service health + counts |
| GET | `/api/v1/cables` | Cable list with incident counts |
| GET | `/api/v1/cables/{name}` | Cable detail + incidents |
| GET | `/api/v1/incidents` | All incidents |
| GET | `/api/v1/incidents/{id}` | Single incident |
| GET | `/api/v1/markers` | Map marker groups |
| GET | `/api/v1/map/cables` | Cable GeoJSON |
| GET | `/api/v1/map/landing-points` | Landing point GeoJSON |
| GET | `/api/v1/search` | Semantic search over incidents/cables (pgvector) |
| GET | `/api/v1/incidents/{id}/sources` | Dataset sources + AI-found additional sources for one incident |

## Map behavior

- Full-viewport MapLibre map with Telegeography cable routes
- Left **incident rail** with search, region (geo theater), nation-state, and status filters
- Map markers sync to the filtered incident set; list selection flies to / highlights the incident
- Incident detail is primary; cable context is secondary via a “Related cable” strip
- Cable hover shows name + incident name/date list
- Click cable → bottom panel (cable view)
- Click incident marker → bottom panel (incident view)
- Click map background, Close button, or Escape → dismiss panel
- Light/dark mode toggle (persisted in `localStorage`)

## Marker colors

| Color | Meaning |
|-------|---------|
| Red | Confirmed state actor |
| Yellow | Suspected state actor |
| Green | No state actor, resolved |
| Gray | No state actor, unresolved |

## License note

Telegeography map data is used under their non-commercial terms. See [submarinecablemap.com](https://www.submarinecablemap.com) for licensing details.
