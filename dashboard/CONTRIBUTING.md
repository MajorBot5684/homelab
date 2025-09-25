# Contributing

Thanks for your interest in improving Homelab Pro Dashboard!

## Getting started
- Fork the repo and clone locally.
- Ensure Docker and Docker Compose are installed.
- Copy `.env.example` to `.env` and set `API_KEY`.

## Development
- Backend API: edit `backend/main.py`. Run stack:
  ```bash
  docker compose up -d --build
  ```
- Frontend: static files in `frontend/`. Rebuild or mount as a volume during dev.

## Coding standards
- Python: follow PEP8; type hints where practical.
- JS: prefer small, readable functions; no framework required.

## Pull requests
- Include a concise description and testing steps.
- If you alter the config schema, update `/api/validate` and docs.
- Add or update docs under `/docs`.

## Security
- Do not commit secrets. Use `.env` and document variables.
- Avoid enabling unauthenticated endpoints unless behind a trusted network.
