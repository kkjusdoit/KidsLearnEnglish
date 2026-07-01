#!/usr/bin/env bash
set -euo pipefail

INSTANCE="${INSTANCE:-newapi-relay-1}"
ZONE="${ZONE:-us-central1-a}"
REMOTE_DIR="${REMOTE_DIR:-~/kindergarten-english-mvp}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48 | tr -d '\n')}"
ADMIN_SHARED_SECRET="${ADMIN_SHARED_SECRET:-$(openssl rand -base64 24 | tr -d '\n')}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -base64 24 | tr -d '\n')}"

TMP_ARCHIVE="$(mktemp -t kindergarten-english.XXXXXX.tar.gz)"
tar \
  --exclude node_modules \
  --exclude apps/web/dist \
  --exclude apps/api/dist \
  --exclude apps/api/storage/recordings \
  --exclude work \
  --exclude outputs \
  -czf "$TMP_ARCHIVE" -C "$PROJECT_ROOT" .

gcloud compute ssh "$INSTANCE" --zone "$ZONE" --command "mkdir -p $REMOTE_DIR"
gcloud compute scp "$TMP_ARCHIVE" "$INSTANCE:/tmp/kindergarten-english.tar.gz" --zone "$ZONE"
gcloud compute ssh "$INSTANCE" --zone "$ZONE" --command "
  set -euo pipefail
  cd $REMOTE_DIR
  tar -xzf /tmp/kindergarten-english.tar.gz
  cat > apps/api/.env <<EOF
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/kindergarten_english
JWT_SECRET=${JWT_SECRET}
ADMIN_SHARED_SECRET=${ADMIN_SHARED_SECRET}
WEB_ORIGIN=*
PUBLIC_API_BASE_URL=http://localhost:8080
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=/app/storage
RECORDING_RETENTION_DAYS=7
EOF
  cat > .env <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
API_DOMAIN=:8080
CADDY_EMAIL=admin@example.com
EOF
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker \$USER || true
  fi
  sudo docker compose up -d --build postgres api
  API_CONTAINER=\$(sudo docker compose ps -q api)
  if [ -n "\$API_CONTAINER" ]; then
    for STORAGE_SUBDIR in demo uploads; do
      if [ -d "apps/api/storage/\$STORAGE_SUBDIR" ]; then
        sudo docker exec "\$API_CONTAINER" mkdir -p "/app/storage/\$STORAGE_SUBDIR"
        sudo docker cp "apps/api/storage/\$STORAGE_SUBDIR/." "\$API_CONTAINER:/app/storage/\$STORAGE_SUBDIR/"
      fi
    done
  fi
"

IP="$(gcloud compute instances describe "$INSTANCE" --zone "$ZONE" --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"

echo "API_ORIGIN=http://${IP}:8080"
echo "ADMIN_SHARED_SECRET=${ADMIN_SHARED_SECRET}"
