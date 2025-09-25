# Backend API
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt && apt-get update && apt-get install -y curl nmap iputils-ping && rm -rf /var/lib/apt/lists/*
COPY backend/main.py /app/main.py
ENV API_KEY=
ENV BEARER_TOKEN=
ENV DATA_PATH=/data
ENV BACKUP_KEEP=20
ENV SCHEDULE_ENABLED=false
ENV SCAN_SUBNET=192.168.0.0/24
ENV SCAN_INTERVAL_MIN=0
ENV SCAN_TOP_PORTS=100
VOLUME ["/data"]
EXPOSE 9000
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","9000"]
