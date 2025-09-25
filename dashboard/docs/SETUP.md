# Setup Guide

## Prerequisites
- Docker + Docker Compose
- A host on your LAN (Linux recommended)

## Steps
1. Copy `.env.example` to `.env` and set `API_KEY` (and optionally `BEARER_TOKEN`).
2. Create nginx Basic Auth file:
   ```bash
   docker run --rm -it httpd:2.4-alpine htpasswd -nbB homelab 'your-password' > nginx/.htpasswd
   ```
3. Start the stack:
   ```bash
   docker compose up -d --build
   ```
4. Open `http://<host>:8080`, login, set your API key in the **Edit** panel.

## TLS (optional)
```bash
./scripts/gen-self-signed.sh homelab.local
docker compose --profile tls up -d --build
# Visit https://<host>:8443
```

## Monitoring (optional)
```bash
docker compose --profile monitoring up -d
# Grafana: http://<host>:3000 (admin/admin)
# Prometheus: http://<host>:9090
```

