#!/bin/bash
# deploy-job.sh — deploys the daily live check (Cloud Run job pocket-web-peer-check) and its
# schedule (Cloud Scheduler pocket-web-peer-check-daily, 5:00 AM Dallas time).
# Results go to gs://x300-506418-pulse-videos/pocket-web/status/ and the server shows them.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=x300-506418
REGION=us-central1
JOB=pocket-web-peer-check
SA=1021990235790-compute@developer.gserviceaccount.com
cp tests/browser/peer-check.mjs jobs/peer-check/peer-check.mjs
gcloud run jobs deploy "$JOB" \
  --project "$PROJECT" --region "$REGION" --source jobs/peer-check \
  --memory 2Gi --cpu 2 --task-timeout 3600 --max-retries 0 \
  --set-env-vars "SITE=https://pocket-web-1021990235790.us-central1.run.app" \
  --quiet
URI="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run"
if gcloud scheduler jobs describe "$JOB-daily" --project "$PROJECT" --location "$REGION" > /dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB-daily" --project "$PROJECT" --location "$REGION" \
    --schedule "0 5 * * *" --time-zone "America/Chicago" --uri "$URI" --http-method POST \
    --oauth-service-account-email "$SA" --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform" --quiet
else
  gcloud scheduler jobs create http "$JOB-daily" --project "$PROJECT" --location "$REGION" \
    --schedule "0 5 * * *" --time-zone "America/Chicago" --uri "$URI" --http-method POST \
    --oauth-service-account-email "$SA" --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform" --quiet
fi
echo "Job $JOB deployed; runs daily at 5:00 AM Dallas time."
