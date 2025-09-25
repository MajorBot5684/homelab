# Homelab Pro Dashboard — Docker Compose (v4)

New in v4:
- **Save & Backup** endpoint writes to `/data/backups/servers-YYYYmmdd-HHMMSS.json` (keeps last `BACKUP_KEEP`, default 20).
- **APScheduler** powers the scheduled scans (more reliable, cron-like interval).
- **Bearer token auth** supported in addition to `X-API-KEY` (set `BEARER_TOKEN` in env).

## Quick start
```bash
cd homelab-pro-compose-v4
cat > .env <<'EOF'
API_KEY=choose-a-strong-key
BEARER_TOKEN=optional-bearer-token
BACKUP_KEEP=20
SCHEDULE_ENABLED=false
SCAN_SUBNET=192.168.0.0/24
SCAN_INTERVAL_MIN=0
SCAN_TOP_PORTS=100
EOF

# Basic auth user for the site (frontend)
docker run --rm -it httpd:2.4-alpine htpasswd -nbB homelab 'your-password' > nginx/.htpasswd

docker compose up -d --build
# Open http://<host>:8080
# In the editor: set API key and/or bearer token → Save.
```

## Frontend auth
The UI sends both headers if present:
- `X-API-KEY: <your key>`
- `Authorization: Bearer <your token>`

## Save & Backup
- **Apply & Save** → `/api/save-config` (writes `/data/servers.json`)
- **Save & Backup** → `/api/save-config-with-backup` (writes `servers.json` **and** a timestamped copy under `/data/backups/`)
- List backups: `GET /api/backups`
- Download backup: `GET /api/backups/<filename>`
- Tune retention with `BACKUP_KEEP`

## Scheduled scans (APScheduler)
- Editor panel → enable **Scheduled Scan** and set subnet/interval/ports → **Save Schedule**
- Under the hood, APScheduler runs a job `net-scan` at your interval.
- You can seed settings from `.env` using:
  - `SCHEDULE_ENABLED=true`
  - `SCAN_SUBNET=192.168.0.0/24`
  - `SCAN_INTERVAL_MIN=10`
  - `SCAN_TOP_PORTS=100`

## HTTPS (optional)
Use `nginx/nginx-https.conf.sample` and mount certs at `/etc/nginx/certs`, then swap the nginx.conf via a volume.

## Files
- `frontend/` (index.html, style.css, script.js, config.js)
- `backend/` (main.py, Dockerfile, requirements.txt)
- `nginx/` (nginx.conf, nginx-https.conf.sample, .htpasswd mounted at runtime)
- `data/` (servers.json + backups/)
- `docker-compose.yml`, `.env`


## Service Autodiscovery
The backend maps common ports → services and suggests links (e.g., 8006 → Proxmox UI). The discovery modal shows:
- Open ports
- Service names
- Suggested links for one-click "Add with links"

You can extend mappings in `backend/main.py` under `COMMON_SERVICES`.

## Config validation
- `POST /api/validate` validates the JSON against a Pydantic schema.
- Both save endpoints validate and return **400** on schema errors with a readable message.

## Backup browser & restore
- In the editor panel, a **Backups** section lists files from `/data/backups/` with **Preview**/**Restore** buttons.
- Backend: `POST /api/restore-config` with `{ "name": "servers-YYYYmmdd-HHMMSS.json" }`.

## TLS-first
- Self-signed helper:
  ```bash
  ./scripts/gen-self-signed.sh homelab.local
  docker compose --profile tls up -d --build
  # open https://<host>:8443
  ```
- Or mount real certs into `./certs` (PEM names match the sample).

## Prometheus + Grafana (optional)
Bring up the monitoring profile:
```bash
docker compose --profile monitoring up -d
# Grafana → http://<host>:3000 (admin/admin)
# Datasource is preprovisioned to Prometheus
```

## Profiles summary
- `tls` → HTTPS frontend on 8443 using mounted certs
- `monitoring` → Prometheus + Node Exporter + cAdvisor + Grafana


## Developer notes
- **Backend** uses FastAPI + APScheduler; see `backend/main.py`.
- **Frontend** is static (Bootstrap 5), with a schema-aware editor that validates on the fly via `/api/validate`.
- **Service autodiscovery** lives in backend `scan()` + helpers `nmap_services_and_banners`, `guess_role`, `COMMON_SERVICES`.
- **Profiles**: `tls`, `monitoring` are optional docker-compose profiles.

## Repository layout (ready for GitHub)
```
.
├── backend/                 # FastAPI app
├── frontend/                # Static UI
├── nginx/                   # Reverse proxy
├── monitoring/              # Prometheus + Grafana (optional profile)
├── scripts/                 # Helpers (self-signed certs)
├── data/                    # servers.json + backups (bind-mounted)
├── docs/                    # documentation site (Markdown)
├── docker-compose.yml
├── .env.example
└── CONTRIBUTING.md
```

Copy `.env.example` to `.env` and edit.

