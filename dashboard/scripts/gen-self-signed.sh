#!/usr/bin/env bash
set -euo pipefail
mkdir -p ./certs
CN="${1:-homelab.local}"
openssl req -x509 -newkey rsa:2048 -nodes -keyout ./certs/privkey.pem -out ./certs/fullchain.pem -days 825 -subj "/CN=${CN}"
echo "Certificates written to ./certs (CN=${CN})"
