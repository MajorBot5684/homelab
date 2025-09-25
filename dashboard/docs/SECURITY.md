# Security Notes

- Site is protected by nginx **Basic Auth**; do not expose to the internet without stronger controls (TLS, firewalls, SSO).
- Backend requires `X-API-KEY` and/or `Bearer` token.
- Discovery uses nmap: only scan networks you own/are allowed to scan.
- Store secrets in `.env`; do not commit them to source control.
- Use HTTPS profile with valid certificates where possible.
