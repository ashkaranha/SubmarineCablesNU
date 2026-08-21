# Cloud Run backend deploy (Render fallback)

Use this only if Render keeps getting OOM-killed after the glibc/memory
fixes. Cloud Run's free tier gives you 1-2GiB of RAM per instance (vs
Render's fixed 512MB), and only bills for memory while a request is
actively being handled (it scales to zero between requests), so the same
backend code has far more headroom here.

No code changes are required to switch -- this deploys the exact same
`backend/Dockerfile`.

## One-time setup

1. Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install) and sign in:
   ```
   gcloud init
   gcloud auth login
   ```
2. Create a project (or reuse one) and enable billing on it. Cloud Run's
   free tier requires a billing account on file, but a low-traffic app like
   this should stay at $0/month (2M requests, 360,000 GiB-seconds, and
   180,000 vCPU-seconds are free every month).
3. Enable the required APIs:
   ```
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com
   ```
4. Pick a free-tier region, e.g. `us-central1`.

## Build and deploy

Run these from the repo root (`SubmarineCablesNU/`):

```bash
# Build the image from backend/Dockerfile with the repo root as context
# (needed because the Dockerfile copies the sibling data/ directory).
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_IMAGE=gcr.io/PROJECT_ID/submarinecables-backend .

# Deploy it. --port 8001 tells Cloud Run which port the container listens
# on (matches the Dockerfile's CMD) -- no need to change the Dockerfile.
gcloud run deploy submarinecables-backend \
  --image gcr.io/PROJECT_ID/submarinecables-backend \
  --region us-central1 \
  --port 8001 \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 8 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_API_KEY=your-gemini-key,CABLEINCIDENTS_CORS_ORIGINS=["https://your-frontend-domain.com"]
```

Replace `PROJECT_ID` with your actual GCP project ID, and the env vars with
your real values (see `backend/.env.example`). `--memory 1Gi` is 2x
Render's limit; bump to `2Gi` if you still see any pressure -- at this
traffic level it will not meaningfully affect free-tier cost either way.

If `CABLEINCIDENTS_CORS_ORIGINS` needs more than one URL, gcloud's default
`--set-env-vars` parsing splits on commas, which conflicts with the JSON
array's commas. Use a custom delimiter instead, e.g.:
```
--set-env-vars ^;^GOOGLE_API_KEY=your-gemini-key;CABLEINCIDENTS_CORS_ORIGINS=["https://a.com","https://b.com"]
```

`gcloud run deploy` prints a service URL like
`https://submarinecables-backend-xxxxx-uc.a.run.app` when it finishes.

## Point the frontend at it

Wherever the frontend is hosted (Vercel/Netlify), update the
`VITE_API_BASE_URL` environment variable to:

```
https://submarinecables-backend-xxxxx-uc.a.run.app/api/v1
```

then redeploy the frontend so the new value gets baked into the build.

## Redeploying after future code changes

Re-run both commands above (build, then deploy) -- there's no auto-deploy
from GitHub/GitLab pushes set up here, unlike Render. If you end up
sticking with Cloud Run long-term, a GitHub Action or Cloud Build trigger
watching the `production` branch could automate this later.

## Notes

- Cold starts: since Cloud Run scales to zero when idle, the first request
  after a period of inactivity will be slower (a few seconds) while it
  spins up a fresh container and loads the cross-encoder model. Set
  `--min-instances 1` on the deploy command if you'd rather pay the (small,
  likely still free-tier) cost of keeping one instance always warm.
- Logs: `gcloud run services logs read submarinecables-backend --region us-central1`
  or view them in the Cloud Console under Cloud Run > your service > Logs.
