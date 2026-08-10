# CableIncidentsDB

Interactive map of submarine cable incidents layered on Telegeography cable routes.

- **Frontend:** React, TypeScript, Tailwind CSS, MapLibre GL JS
- **Backend:** FastAPI (Python)
- **Data:** `incidents.csv`, `cables_shortened.csv`, Telegeography GeoJSON snapshot
- **Vector DB (optional):** PostgreSQL + [pgvector](https://github.com/pgvector/pgvector) for semantic search
- **AI-found sources (optional):** Google Gemini, for suggesting additional sources on an incident

`combined.xlsx` is kept as an archive only and is **not** used by the application.

## Quick start (Docker)

This is the fastest way to get the map running. It does **not** include semantic search or AI-found sources — those are optional add-ons, see below.

```bash
docker compose up --build
```

- Web: http://localhost:5174
- API: http://localhost:8001 (docs at `/docs`)

That's it — the map, incident list, filters, and grouped-marker clicks all work with just this command. If it doesn't come up, see [Troubleshooting](#troubleshooting).

## Optional: semantic search

Lets you search incidents/cables by meaning (e.g. "anchor dragged near a strait") instead of exact keyword matching, via the `/api/v1/search` endpoint. Requires a one-time data load into Postgres.

1. Make sure the stack is running (`docker compose up --build`, or at least `docker compose up -d db` for just the database).
2. Load the data — reads the CSVs, embeds them locally with a small `sentence-transformers` model (no API key needed), and writes them into Postgres:
   ```bash
   docker compose run --rm api python -m scripts.ingest_vectordb --database-url postgresql://cableincidents:cableincidents@db:5432/cableincidents
   ```
   This takes a minute or two the first time (downloads the embedding model). Re-run it any time to refresh the data.
3. Semantic search is now live in the app — use the **"AI search"** toggle in the left rail, or call the API directly: `GET /api/v1/search?q=your+query&type=all&limit=10`.

## Optional: AI-found sources

On an incident's detail panel, the **"Find more sources"** button asks Gemini to web-search for additional sources not already in the dataset (clearly labeled as AI-found and unverified).

1. Get a free key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Put it in a `.env` file next to `docker-compose.yml` (already gitignored, safe to keep a real key in it):
   ```bash
   echo 'GOOGLE_API_KEY=your-key-here' > .env
   ```
3. Restart: `docker compose up`.

Without a key, the button just shows a friendly "unavailable" message — nothing else breaks.

## Local development (without Docker)

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5174 — the Vite dev server proxies `/api` to the backend on port 8001.

For semantic search or AI-found sources locally (without Docker), run Postgres yourself and set `CABLEINCIDENTS_DATABASE_URL` / `GOOGLE_API_KEY` as environment variables before starting the backend, then run `python -m scripts.ingest_vectordb` from `backend/` to load the vector DB.

## Troubleshooting

- **`docker compose up` fails immediately** — usually a stale image. Run `docker compose up --build` to force a rebuild (needed any time `requirements.txt` or `package.json` changes).
- **Map loads but says "Could not load map data"** — the API container isn't reachable. Check `docker compose logs api` for the actual error.
- **"Find more sources" or the AI search tab shows an error** — expected if you haven't done the corresponding optional setup above (no `GOOGLE_API_KEY`, or the vector DB hasn't been ingested yet). The rest of the app keeps working either way.

## Data

| File | Purpose |
|------|---------|
| `data/incidents.csv` | 243 incident records |
| `data/cables_shortened.csv` | 698 cable metadata rows |
| `data/telegeography/` | Pinned Telegeography API v3 snapshot |

To refresh Telegeography data, re-download and update `data/telegeography/VERSION.txt` with the fetch date:

- `https://www.submarinecablemap.com/api/v3/cable/cable-geo.json`
- `https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json`
- `https://www.submarinecablemap.com/api/v3/cable/all.json`

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
| GET | `/api/v1/search` | Semantic search over incidents/cables (needs vector DB setup) |
| GET | `/api/v1/incidents/{id}/sources` | Dataset sources + AI-found additional sources for one incident (needs `GOOGLE_API_KEY`) |

## Map behavior

- Full-viewport MapLibre map with Telegeography cable routes
- Left **incident rail** with keyword and AI (semantic) search, region, nation-state, and status filters
- Incidents sharing a location collapse into one numbered marker — click it for a list, then click an incident for details
- Incident detail is primary; cable context is secondary via a "Related cable" strip
- Cable hover shows name + incident name/date list
- Click cable → bottom panel (cable view)
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
