# Production Deployment Guide

Free-tier stack: **GitLab** (source) → mirrored to a **personal GitHub/GitLab** repo → **Render** (backend) + **Vercel/Netlify** (frontend). No database is needed — semantic search runs entirely in-process (BM25 candidate retrieval + a local cross-encoder reranker, see `backend/app/main.py`).

## 0. Repo ownership (do this first)

Vercel and Netlify's free tiers only allow deploying from **personally-owned** repos, not organization/group-owned ones. If your source repo lives under a GitLab/GitHub group:

```bash
git remote add personal https://github.com/yourusername/SubmarineCablesNU.git
git push personal production
```

Connect Render/Vercel/Netlify to this personal mirror instead. Push to both remotes going forward, or make the personal one primary.

## 1. Backend (Render, free web service)

- New Web Service → connect the personal repo → **Root Directory: blank** (repo root) → **Dockerfile Path: `backend/Dockerfile`**
  - Root Directory must be the repo root, not `backend/`, since the Dockerfile copies the sibling `data/` folder into the image (no bind mounts on Render).
- Environment variables:
  | Variable | Value |
  |---|---|
  | `GOOGLE_API_KEY` | Your Gemini key |
  | `CABLEINCIDENTS_CORS_ORIGINS` | `["https://your-frontend-domain"]` (set after step 2) |
- Note your backend URL, e.g. `https://submarinecablesnu.onrender.com`.

## 2. Frontend (Vercel or Netlify, free tier)

- Import the personal repo → Root Directory: `frontend` → Build command: `npm run build` → Output directory: `dist`
- Environment variable: `VITE_API_BASE_URL=https://<your-render-backend>.onrender.com/api/v1` (must include `/api/v1`; Vite bakes this in at build time, so changing it requires a redeploy)
- Note your frontend URL, e.g. `https://your-app.vercel.app`.

## 3. Wire CORS + verify

1. Update `CABLEINCIDENTS_CORS_ORIGINS` on Render to your real frontend URL, redeploy.
2. Check: map loads, incident details open, semantic search returns results, "Find more sources" returns results.
3. If semantic search only ever returns keyword matches: check the Render service logs — the reranker model may still be downloading on its first request, or the instance has no outbound internet access for that one-time download.
4. If "Find more sources" fails: check `Response` body of the failed network request for the real error (frontend UI shows a generic message).

## Known gotchas

- **Render free tier spins down when idle** — first request after inactivity takes 30-60s, plus a few extra seconds the very first time semantic search is used while the reranker model downloads.
- **Gemini free-tier quotas are daily**, reset at midnight Pacific: 500/day (shared Flash/Flash-Lite) for Search grounding used by "Find more sources."
- **Gemini model names deprecate** — if "Find more sources" ever 404s on the model, check [ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations) and update `CABLEINCIDENTS_GOOGLE_MODEL_NAME` (or the default in `backend/app/config.py`).
- **Telegeography data is non-commercial-use licensed** — confirm this stays compliant before wider public hosting.
