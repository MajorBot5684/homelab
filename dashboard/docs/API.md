# API Reference

- `POST /api/health` — Health probes
- `POST /api/scan` — Nmap discovery (now uses `-sV` for banners)
- `GET /api/discoveries` — Last scan results
- `GET /api/servers` — Persisted config
- `POST /api/save-config` — Save config (schema validated)
- `POST /api/save-config-with-backup` — Save + backup (schema validated)
- `GET /api/backups` — List backups
- `GET /api/backups/<name>` — Download backup
- `POST /api/restore-config` — Restore from backup (schema validated)
- `GET /api/schedule` — Get scheduler settings
- `POST /api/schedule` — Set scheduler settings
- `POST /api/validate` — Validate config JSON against schema

**Auth headers:** set either `X-API-KEY` or `Authorization: Bearer <token>` if configured.
