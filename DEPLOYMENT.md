# Production Deployment Guide

Free-tier stack: **GitLab** (source) → mirrored to a **personal GitHub/GitLab** repo → **Render** (backend) + **Vercel/Netlify** (frontend) + **Supabase** (Postgres/pgvector).

## 0. Repo ownership (do this first)

Vercel and Netlify's free tiers only allow deploying from **personally-owned** repos, not organization/group-owned ones. If your source repo lives under a GitLab/GitHub group:

```bash
git remote add personal https://github.com/yourusername/SubmarineCablesNU.git
git push personal production
```

Connect Render/Vercel/Netlify to this personal mirror instead. Push to both remotes going forward, or make the personal one primary.

## 1. Database (Supabase, free tier)

1. Create a Supabase project → SQL Editor → run `create extension if not exists vector;`
2. Get the **connection pooler** string (Project Settings → Database → Connection string → **Transaction pooler**, port `6543`) — not the direct connection. Supabase's direct connection resolves to IPv6-only, which Render/Vercel can't reach.
3. Run the ingest script once, locally:
   ```bash
   cd backend
   pip install -r requirements.txt
   $env:GOOGLE_API_KEY="your-gemini-key"
   python -m scripts.ingest_vectordb --database-url "<pooler-connection-string>"
   ```
   Use `--fake-embeddings` first to test DB connectivity/schema without spending API quota. Free embedding quota is ~1000 requests/day; re-run overnight if it gets cut off partway (cables/incidents are written independently, so partial progress isn't lost).

## 2. Backend (Render, free web service)

- New Web Service → connect the personal repo → **Root Directory: blank** (repo root) → **Dockerfile Path: `backend/Dockerfile`**
  - Root Directory must be the repo root, not `backend/`, since the Dockerfile copies the sibling `data/` folder into the image (no bind mounts on Render).
- Environment variables:
  | Variable | Value |
  |---|---|
  | `GOOGLE_API_KEY` | Your Gemini key |
  | `CABLEINCIDENTS_DATABASE_URL` | Supabase pooler connection string |
  | `CABLEINCIDENTS_CORS_ORIGINS` | `["https://your-frontend-domain"]` (set after step 3) |
- Note your backend URL, e.g. `https://submarinecablesnu.onrender.com`.

## 3. Frontend (Vercel or Netlify, free tier)

- Import the personal repo → Root Directory: `frontend` → Build command: `npm run build` → Output directory: `dist`
- Environment variable: `VITE_API_BASE_URL=https://<your-render-backend>.onrender.com/api/v1` (must include `/api/v1`; Vite bakes this in at build time, so changing it requires a redeploy)
- Note your frontend URL, e.g. `https://your-app.vercel.app`.

## 4. Wire CORS + verify

1. Update `CABLEINCIDENTS_CORS_ORIGINS` on Render to your real frontend URL, redeploy.
2. Check: map loads, incident details open, "AI search" returns results, "Find more sources" returns results.
3. If "AI search" fails: check `CABLEINCIDENTS_DATABASE_URL` uses the pooler string, not direct connection.
4. If "Find more sources" fails: check `Response` body of the failed network request for the real error (frontend UI shows a generic message).

## Known gotchas

- **Render free tier spins down when idle** — first request after inactivity takes 30-60s.
- **Gemini free-tier quotas are daily**, reset at midnight Pacific: ~1000/day for embeddings, 500/day (shared Flash/Flash-Lite) for Search grounding used by "Find more sources."
- **Gemini model names deprecate** — if "Find more sources" ever 404s on the model, check [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations) and update `CABLEINCIDENTS_GOOGLE_MODEL_NAME` (or the default in `backend/app/config.py`).
- **Telegeography data is non-commercial-use licensed** — confirm this stays compliant before wider public hosting.
