#!/usr/bin/env bash
# Deploys the portal API to Cloud Run. Run in Cloud Shell from the repo root, with the project selected:
#   SHEET_ID=<id de la planilla> bash cloudrun/deploy.sh staging     (or prod)
# The Sheet ID is passed at deploy time and never stored in the repo.
set -euo pipefail
ENTORNO="${1:-}"
case "$ENTORNO" in staging|prod) ;; *) echo "Uso: SHEET_ID=<id> bash cloudrun/deploy.sh staging|prod"; exit 1 ;; esac
: "${SHEET_ID:?Falta SHEET_ID}"
PROYECTO="$(gcloud config get-value project 2>/dev/null)"
REGION=southamerica-west1 # Santiago

cp gas/Code.js cloudrun/Code.js # the service runs the same Code.js as Apps Script
trap 'rm -f cloudrun/Code.js' EXIT

# max-instances 1: one in-memory snapshot and one throttle counter (292 schools fit easily in one instance)
gcloud run deploy "portal-api-${ENTORNO}" \
  --source cloudrun \
  --region "$REGION" \
  --service-account "portal-api@${PROYECTO}.iam.gserviceaccount.com" \
  --no-invoker-iam-check \
  --set-env-vars "SHEET_ID=${SHEET_ID}" \
  --memory 1Gi --cpu 1 \
  --min-instances 0 --max-instances 1 --concurrency 80 \
  --timeout 60
