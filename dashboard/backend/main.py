from fastapi import FastAPI, Depends, Header, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import asyncio, json, os, subprocess, platform, glob
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

API_KEY = os.environ.get("API_KEY", "")
BEARER_TOKEN = os.environ.get("BEARER_TOKEN", "")

app = FastAPI(title="Homelab Backend", version="1.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def require_api_key(x_api_key: Optional[str] = Header(default=None), authorization: Optional[str] = Header(default=None)):
    # Accept either X-API-KEY or Authorization: Bearer <token> (if configured)
    if API_KEY or BEARER_TOKEN:
        valid_api = API_KEY and x_api_key == API_KEY
        valid_bearer = False
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ",1)[1]
            valid_bearer = (BEARER_TOKEN and token == BEARER_TOKEN)
        if not (valid_api or valid_bearer):
            raise HTTPException(status_code=401, detail="Invalid or missing credentials")
    return True

class CheckSpec(BaseModel):
    type: str  # "http" | "tcp" | "ping"
    url: Optional[str] = None
    port: Optional[int] = None

class HealthRequest(BaseModel):
    target: str
    checks: List[CheckSpec]

def _is_windows()->bool:
    return platform.system().lower().startswith("win")

async def http_probe(url:str)->bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            "curl","-sk","--max-time","3","-o","/dev/null","-w","%{http_code}",url,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        out, err = await proc.communicate()
        if out:
            code = out.decode().strip()
            return code.isdigit() and int(code) > 0
        return proc.returncode == 0
    except Exception:
        return False

async def tcp_probe(host:str, port:int)->bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            "bash","-lc",f"timeout 3 bash -c '</dev/tcp/{host}/{port}' >/dev/null 2>&1"
        )
        await proc.communicate()
        return proc.returncode == 0
    except Exception:
        return False

async def ping_probe(host:str)->bool:
    try:
        cmd = ["ping","-c","1","-W","2",host] if not _is_windows() else ["ping","-n","1",host]
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await proc.communicate()
        return proc.returncode == 0
    except Exception:
        return False

@app.post("/api/health", dependencies=[Depends(require_api_key)])
async def health(req: HealthRequest):
    results = []
    for c in req.checks:
        if c.type == "http" and c.url:
            results.append(await http_probe(c.url))
        elif c.type == "tcp" and c.port:
            results.append(await tcp_probe(req.target, c.port))
        elif c.type == "ping":
            results.append(await ping_probe(req.target))
    status = "online" if any(results) else ("offline" if results and all(not r for r in results) else "unknown")
    return {"target": req.target, "status": status, "results": results}

DISCOVERY_CACHE = "/tmp/homelab_discoveries.json"

def load_cache()->List[Dict[str,Any]]:
    if os.path.exists(DISCOVERY_CACHE):
        try:
            return json.load(open(DISCOVERY_CACHE))
        except Exception:
            return []
    return []

def save_cache(items:List[Dict[str,Any]]):
    json.dump(items, open(DISCOVERY_CACHE,"w"), indent=2)

@app.get("/api/discoveries", dependencies=[Depends(require_api_key)])
def get_discoveries()->List[Dict[str,Any]]:
    return load_cache()


# --- Service fingerprinting (simple port-based) ---
COMMON_SERVICES = {
    22:  {"name":"SSH"},
    80:  {"name":"HTTP","link":"http://{host}"},
    443: {"name":"HTTPS","link":"https://{host}"},
    445: {"name":"SMB"},
    139: {"name":"NetBIOS"},
    8006:{"name":"Proxmox UI","link":"https://{host}:8006"},
    8080:{"name":"HTTP-Alt","link":"http://{host}:8080"},
    3000:{"name":"Grafana","link":"http://{host}:3000"},
    9090:{"name":"Prometheus","link":"http://{host}:9090"},
    9100:{"name":"Node Exporter","link":"http://{host}:9100/metrics"},
    8443:{"name":"HTTPS-Alt","link":"https://{host}:8443"},
}


def guess_role(host: str, services: list[str], banners: list[str]):
    txt = " ".join((services or []) + (banners or [])).lower()
    labels = []
    role = None
    # Heuristics
    if "proxmox" in txt or ":8006" in txt:
        role = role or "Hypervisor"
        labels.append("proxmox")
    if "grafana" in txt or ":3000" in txt:
        role = role or "Monitoring"
        labels.append("grafana")
    if "prometheus" in txt or ":9090" in txt:
        role = role or "Monitoring"
        labels.append("prometheus")
    if "smb" in txt or "microsoft-ds" in txt or ":445" in txt:
        role = role or "File server"
        labels.append("smb")
    if "nginx" in txt or "apache" in txt or "http" in txt:
        role = role or "Web server"
        labels.append("http")
    if "openssh" in txt or ":22" in txt:
        labels.append("ssh")
    if "mysql" in txt or ":3306" in txt:
        role = role or "Database"
        labels.append("mysql")
    if "postgres" in txt or ":5432" in txt:
        role = role or "Database"
        labels.append("postgres")
    if "kubernetes" in txt or "kube" in txt:
        role = role or "Kubernetes node"
        labels.append("k8s")
    if "docker" in txt:
        labels.append("docker")
    if "printer" in txt or "ipp" in txt:
        role = role or "Printer"
        labels.append("printer")
    return role, sorted(set(labels))

def nmap_services_and_banners(ip: str, top_ports: int):
    banners = []
    ports = []
    try:
        out = subprocess.check_output(
            ["nmap","-Pn","-sV","--top-ports", str(top_ports), ip],
            text=True, stderr=subprocess.STDOUT, timeout=120
        )
        for ln in out.splitlines():
            if "/tcp" in ln:
                # example: "22/tcp open  ssh     OpenSSH 8.4p1 Debian 5"
                try:
                    pstr = ln.split("/tcp")[0].strip()
                    if pstr.isdigit():
                        ports.append(int(pstr))
                except Exception:
                    pass
                banners.append(ln.strip())
    except Exception:
        pass
    return ports, banners

\g<0>
    services = []
    links = []
    for p in sorted(set(open_ports)):
        meta = COMMON_SERVICES.get(p)
        if meta:
            services.append(meta["name"])
            if "link" in meta:
                try:
                    links.append({"label": meta["name"], "url": meta["link"].format(host=host)})
                except Exception:
                    pass
    return {"services": services, "links": links}

class ScanRequest(BaseModel):
    subnet: str = Field(..., example="192.168.0.0/24")
    top_ports: int = 100

@app.post("/api/scan", dependencies=[Depends(require_api_key)])
def scan(req: ScanRequest):
    try:
        cmd = ["nmap","-sn",req.subnet]
        hosts = []
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT, timeout=120)
        for line in out.splitlines():
            if "Nmap scan report for" in line:
                parts = line.split()[-1]
                hosts.append({"ip": parts, "open_ports": [], "vendor": None})
        for h in hosts:
            try:
                ports, banners = nmap_services_and_banners(h['ip'], req.top_ports)
                h["open_ports"] = ports
                # attach service suggestions
                hints = build_suggestions(h["ip"], ports)
                h["services"] = hints.get("services", [])
                h["suggested_links"] = hints.get("links", [])
                h["banners"] = banners
                role_guess, labels = guess_role(h["ip"], h["services"], banners)
                if role_guess: h["role_guess"] = role_guess
                if labels: h["labels"] = labels
        save_cache(hosts)
        return {"count": len(hosts), "hosts": hosts, "ts": datetime.utcnow().isoformat()+"Z"}
    except subprocess.CalledProcessError as e:
        return {"error": "nmap failed", "detail": e.output}
    except FileNotFoundError:
        return {"error": "nmap not installed"}

# ---- Config persistence + Backups + APScheduler ----
DATA_PATH = os.environ.get("DATA_PATH", "/data")
SERVERS_JSON = os.path.join(DATA_PATH, "servers.json")
BACKUPS_DIR = os.path.join(DATA_PATH, "backups")
BACKUP_KEEP = int(os.environ.get("BACKUP_KEEP", "20"))

SCHED_ENABLED = os.environ.get("SCHEDULE_ENABLED", "false").lower() in ("1","true","yes","on")
SCHED_SUBNET = os.environ.get("SCAN_SUBNET", "192.168.0.0/24")
SCHED_INTERVAL_MIN = int(os.environ.get("SCAN_INTERVAL_MIN", "0") or "0")
SCHED_TOP_PORTS = int(os.environ.get("SCAN_TOP_PORTS", "100"))


# ---- Config schema validation ----
class Link(BaseModel):
    label: str
    url: str

class Check(BaseModel):
    type: str
    url: Optional[str] = None
    port: Optional[int] = None

class Server(BaseModel):
    name: str
    ip: Optional[str] = None
    os: Optional[str] = None
    role: Optional[str] = None
    tags: Optional[list[str]] = []
    links: Optional[list[Link]] = []
    checks: Optional[list[Check]] = []

class Group(BaseModel):
    name: str
    servers: list[Server] = []

class DashboardConfig(BaseModel):
    grafana: Optional[Dict[str, Any]] = None
    groups: list[Group] = []

@app.post("/api/validate", dependencies=[Depends(require_api_key)])
def validate_config(payload: Dict[str, Any] = Body(...)):
    try:
        DashboardConfig(**payload)
        return {"ok": True}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})

@app.get("/api/servers", dependencies=[Depends(require_api_key)])
def get_servers():
    try:
        if os.path.exists(SERVERS_JSON):
            return json.load(open(SERVERS_JSON))
        return {"groups":[]}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error":"failed to read servers.json","detail":str(e)})

@app.post("/api/save-config", dependencies=[Depends(require_api_key)])
def save_config(payload: Dict[str, Any] = Body(...)):
    try:
        DashboardConfig(**payload)  # validate
        os.makedirs(DATA_PATH, exist_ok=True)
        with open(SERVERS_JSON, "w") as f:
            json.dump(payload, f, indent=2)
        return {"ok": True, "path": SERVERS_JSON}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error":"failed to write servers.json","detail":str(e)})

@app.post("/api/save-config-with-backup", dependencies=[Depends(require_api_key)])
def save_config_with_backup(payload: Dict[str, Any] = Body(...)):
    try:
        DashboardConfig(**payload)  # validate
        os.makedirs(DATA_PATH, exist_ok=True)
        os.makedirs(BACKUPS_DIR, exist_ok=True)
        # Save main file
        with open(SERVERS_JSON, "w") as f:
            json.dump(payload, f, indent=2)
        # Save timestamped backup
        ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        bpath = os.path.join(BACKUPS_DIR, f"servers-{ts}.json")
        with open(bpath, "w") as bf:
            json.dump(payload, bf, indent=2)
        # Trim backups
        files = sorted(glob.glob(os.path.join(BACKUPS_DIR, "servers-*.json")))
        if len(files) > BACKUP_KEEP:
            for old in files[0:len(files)-BACKUP_KEEP]:
                try: os.remove(old)
                except Exception: pass
        return {"ok": True, "path": SERVERS_JSON, "backup": os.path.basename(bpath)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error":"failed to write servers.json or backup","detail":str(e)})

@app.get("/api/backups", dependencies=[Depends(require_api_key)])
def list_backups():
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    files = sorted([os.path.basename(p) for p in glob.glob(os.path.join(BACKUPS_DIR, "servers-*.json"))])
    return {"count": len(files), "files": files}

@app.get("/api/backups/{name}", dependencies=[Depends(require_api_key)])
def download_backup(name: str):
    path = os.path.join(BACKUPS_DIR, name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="application/json", filename=name)

class ScheduleConfig(BaseModel):
    enabled: bool
    subnet: str = Field(..., example="192.168.0.0/24")
    interval_min: int = Field(0, ge=0)
    top_ports: int = Field(100, ge=1, le=1000)

@app.get("/api/schedule", dependencies=[Depends(require_api_key)])
def get_schedule():
    return {
        "enabled": SCHED_ENABLED,
        "subnet": SCHED_SUBNET,
        "interval_min": SCHED_INTERVAL_MIN,
        "top_ports": SCHED_TOP_PORTS
    }

@app.post("/api/schedule", dependencies=[Depends(require_api_key)])
def set_schedule(cfg: ScheduleConfig):
    global SCHED_ENABLED, SCHED_SUBNET, SCHED_INTERVAL_MIN, SCHED_TOP_PORTS
    SCHED_ENABLED = cfg.enabled
    SCHED_SUBNET = cfg.subnet
    SCHED_INTERVAL_MIN = cfg.interval_min
    SCHED_TOP_PORTS = cfg.top_ports
    # Reconfigure APScheduler job
    if scheduler.get_job("net-scan"):
        scheduler.remove_job("net-scan")
    if SCHED_ENABLED and SCHED_INTERVAL_MIN > 0:
        scheduler.add_job(func=lambda: scan(ScanRequest(subnet=SCHED_SUBNET, top_ports=SCHED_TOP_PORTS)),
                          trigger=IntervalTrigger(minutes=SCHED_INTERVAL_MIN), id="net-scan", replace_existing=True)
    return {"ok": True, "schedule": get_schedule()}

scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def startup_tasks():
    # Start scheduler
    scheduler.start()
    # Seed job if enabled via env
    if SCHED_ENABLED and SCHED_INTERVAL_MIN > 0:
        scheduler.add_job(func=lambda: scan(ScanRequest(subnet=SCHED_SUBNET, top_ports=SCHED_TOP_PORTS)),
                          trigger=IntervalTrigger(minutes=SCHED_INTERVAL_MIN), id="net-scan", replace_existing=True)


@app.post("/api/restore-config", dependencies=[Depends(require_api_key)])
def restore_config(name: str = Body(..., embed=True)):
    try:
        src = os.path.join(BACKUPS_DIR, name)
        if not os.path.isfile(src):
            raise HTTPException(status_code=404, detail="backup not found")
        os.makedirs(DATA_PATH, exist_ok=True)
        with open(src, "r") as f:
            data = json.load(f)
        DashboardConfig(**data)  # validate before restore
        with open(SERVERS_JSON, "w") as out:
            json.dump(data, out, indent=2)
        return {"ok": True, "restored": name}
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(status_code=500, content={"error":"restore failed","detail":str(e)})

