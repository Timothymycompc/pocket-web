#!/bin/bash
# deploy.sh — builds in Cloud Build and deploys Pocket Web to Cloud Run (service pocket-web).
# The Gemini key is read at startup from Secret Manager (GEMINI_API_KEY); it is never baked into the image.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=x300-506418
REGION=us-central1
SERVICE=pocket-web
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" --source . \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT_ID=$PROJECT" \
  --memory 512Mi --cpu 1 --min-instances 0 --max-instances 1 --no-cpu-throttling \
  --quiet
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format "value(status.url)"
