// Frontend config: API base + API/bearer (from config.js or localStorage)
const API_BASE = (window.HOMELAB_API_BASE || window.location.origin).replace(/\/$/, '') + '/api';
let API_KEY = window.HOMELAB_API_KEY || localStorage.getItem('homelab.apiKey') || '';
let BEARER  = window.HOMELAB_BEARER   || localStorage.getItem('homelab.bearer') || '';

function authHeaders(extra={}){
  const h = Object.assign({'Content-Type':'application/json'}, extra);
  if(API_KEY) h['X-API-KEY'] = API_KEY;
  if(BEARER)  h['Authorization'] = 'Bearer ' + BEARER;
  return h;
}

function debounce(fn, ms){let t;return (...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args), ms)} }

async function loadConfig(){
  try {
    const res = await fetch(`${API_BASE}/servers`, { headers: authHeaders(), cache:'no-store' });
    if(res.ok){
      const data = await res.json();
      if(data && data.groups) return data;
    }
  } catch(_){}
  try {
    const res = await fetch('servers.json', {cache:'no-store'});
    if(res.ok){ return await res.json(); }
  } catch(_) {}
  const ls = localStorage.getItem('homelab.config');
  if(ls){ try{return JSON.parse(ls)}catch(_){} }
  const embedded = document.getElementById('servers-config')?.textContent;
  if(embedded){ return JSON.parse(embedded); }
  return {"groups":[]};
}

function extractAllTags(cfg){
  const s = new Set();
  cfg.groups?.forEach(g=>g.servers?.forEach(srv=> (srv.tags||[]).forEach(t=>s.add(t)) ));
  return [...s.values()].sort();
}

function buildTagBar(tags){
  const bar = document.getElementById('tagBar');
  bar.innerHTML = '';
  if(!tags.length){ bar.classList.add('d-none'); return; }
  bar.classList.remove('d-none');
  tags.forEach(t=>{
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = t;
    span.dataset.tag = t.toLowerCase();
    span.addEventListener('click', ()=>{
      span.classList.toggle('active');
      applyFilters();
    });
    bar.appendChild(span);
  });
}

function getActiveTags(){ return [...document.querySelectorAll('#tagBar .tag.active')].map(el=>el.dataset.tag); }

function applyFilters(){
  const q = (document.getElementById('searchInput').value||'').trim().toLowerCase();
  const activeTags = getActiveTags();
  document.querySelectorAll('[data-card]').forEach(card=>{
    const hay = [card.dataset.name, card.dataset.ip, card.dataset.os, card.dataset.role, card.dataset.tags].join(' ');
    const matchQ = !q || hay.includes(q);
    const cardTags = (card.dataset.tags||'').split(' ').filter(Boolean);
    const matchTags = !activeTags.length || activeTags.every(t=>cardTags.includes(t));
    card.parentElement.classList.toggle('d-none', !(matchQ && matchTags));
  });
}

function renderGrafana(cfg){
  const section = document.getElementById('grafanaSection');
  const rows = document.getElementById('grafanaRows');
  rows.innerHTML = '';
  const panels = cfg?.grafana?.panels || [];
  if(!panels.length){ section.classList.add('d-none'); return; }
  section.classList.remove('d-none');
  panels.forEach(p=>{
    const col = document.createElement('div');
    col.className = 'col-lg-6 mb-3';
    col.innerHTML = `
      <div class="card">
        <div class="card-body">
          <h5 class="card-title">${p.title||'Grafana Panel'}</h5>
          <div class="ratio ratio-16x9">
            <iframe src="${p.url}" frameborder="0"></iframe>
          </div>
        </div>
      </div>`;
    rows.appendChild(col);
  });
}

function renderDashboard(cfg){
  const root = document.getElementById('dashboard');
  root.innerHTML = '';
  buildTagBar(extractAllTags(cfg));
  renderGrafana(cfg);

  cfg.groups?.forEach((group, idx)=>{
    const section = document.createElement('section');
    const gid = `grp_${idx}`;
    section.innerHTML = `
      <div class="d-flex align-items-center justify-content-between">
        <h2 class="group-title mb-0">${group.name}</h2>
        <button class="btn btn-sm btn-outline-secondary" data-bs-toggle="collapse" data-bs-target="#${gid}">
          <i class="bi bi-arrows-collapse me-1"></i>Toggle
        </button>
      </div>
      <div class="collapse show mt-3" id="${gid}">
        <div class="row" data-group></div>
      </div>`;

    const row = section.querySelector('[data-group]');

    (group.servers||[]).forEach(server=>{
      const col = document.createElement('div');
      col.className = 'col-xl-3 col-lg-4 col-md-6';

      const tags = (server.tags||[]).map(t=>`<span class="tag me-1">${t}</span>`).join('');
      const links = (server.links||[]).map(l=>`<a class="btn btn-sm btn-outline-light link-btn me-1 mt-1" target="_blank" href="${l.url}"><i class="bi bi-box-arrow-up-right me-1"></i>${l.label}</a>`).join('');

      const cardId = `status-${server.name.replace(/[^a-z0-9]/gi,'_')}`;

      col.innerHTML = `
        <div class="card mb-3" data-card data-name="${(server.name||'').toLowerCase()}" data-ip="${server.ip||''}" data-os="${(server.os||'').toLowerCase()}" data-role="${(server.role||'').toLowerCase()}" data-tags="${(server.tags||[]).join(' ').toLowerCase()}">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start">
              <h5 class="card-title">${server.name||'Unnamed'}</h5>
              <span class="badge bg-secondary" id="${cardId}"><span class="status-dot dot-unknown"></span>Unknown</span>
            </div>
            <div class="small muted mb-2">${server.role||''}</div>
            <div class="mb-2">
              <div><i class="bi bi-cpu me-1"></i>OS: ${server.os||'—'}</div>
              <div><i class="bi bi-ethernet me-1"></i>IP/Host: <span class="text-info">${server.ip||'—'}</span></div>
            </div>
            ${tags ? `<div class="mb-2">${tags}</div>`:''}
            ${links ? `<div class="mt-2">${links}</div>`:''}
          </div>
        </div>`;

      row.appendChild(col);
      runBackendChecks(server).then(status=>updateBadge(cardId, status));
    });

    root.appendChild(section);
  });

  applyFilters();
}

function updateBadge(id, status){
  const el = document.getElementById(id);
  if(!el) return;
  if(status==='online'){ el.className='badge bg-success'; el.innerHTML='<span class="status-dot dot-online"></span>Online'; }
  else if(status==='offline'){ el.className='badge bg-danger'; el.innerHTML='<span class="status-dot dot-offline"></span>Offline'; }
  else { el.className='badge bg-secondary'; el.innerHTML='<span class="status-dot dot-unknown"></span>Unknown'; }
}

// ---------- Backend API integration ----------
async function runBackendChecks(server){
  const checks = server.checks || [];
  if(checks.length===0){ return 'unknown'; }
  try{
    const resp = await fetch(`${API_BASE}/health`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ target: server.ip, checks })
    });
    if(!resp.ok) throw new Error('Health API failed');
    const data = await resp.json();
    return data.status || 'unknown';
  }catch(e){ return 'unknown'; }
}

// Discovery banner / flow
async function loadDiscoveries(){
  try{
    const resp = await fetch(`${API_BASE}/discoveries`, { headers: authHeaders() });
    if(!resp.ok) return;
    const list = await resp.json();
    if(Array.isArray(list) && list.length){
      window._discoveries = list;
      document.getElementById('discoverBanner').classList.remove('d-none');
    }
  }catch(_){}
}

function ensureDiscoveredGroup(cfg){
  if(!Array.isArray(cfg.groups)) cfg.groups = [];
  let g = cfg.groups.find(x => (x.name||'').toLowerCase() === 'discovered');
  if(!g){ g = { name: "Discovered", servers: [] }; cfg.groups.push(g); }
  if(!Array.isArray(g.servers)) g.servers = [];
  return g;
}

function showDiscoveries(list){
  const container = document.getElementById('discoverList');
  container.innerHTML = '';
  list.forEach(item=>{
    const li = document.createElement('div');
    li.className = 'list-group-item list-group-item-dark';
    li.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div><strong>${item.ip}</strong> <span class="text-secondary">${item.vendor||''}</span></div>
          <div class="small text-secondary">Open ports: ${(item.open_ports||[]).join(', ')||'—'} | Services: ${(item.services||[]).join(', ')||'—'}</div>
          <div class="small mt-1">${(item.suggested_links||[]).map(l=>`<a target="_blank" href="${l.url}" class="me-2">${l.label}</a>`).join('') || ""}</div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-info" data-ip="${item.ip}"><i class="bi bi-plus-lg me-1"></i>Add</button>
          <button class="btn btn-sm btn-outline-success" data-addlinks="${item.ip}"><i class="bi bi-link-45deg me-1"></i>Add with links</button>
        </div>
      </div>`;
    const btn = li.querySelector('button[data-ip]');
    btn.addEventListener('click', ()=>addDiscoveredToConfig(item));
    const btn2 = li.querySelector('button[data-addlinks]');
    btn2.addEventListener('click', ()=>addDiscoveredToConfig(item, true));
    container.appendChild(li);
  });
  const modal = new bootstrap.Modal(document.getElementById('discoveryModal'));
  modal.show();
}

function addDiscoveredToConfig(item, withLinks=false){
  try{
    const ta = document.getElementById('configEditor');
    const cfg = JSON.parse(ta.value);
    const group = ensureDiscoveredGroup(cfg);
    group.servers.push({
      name: "New Device",
      ip: item.ip,
      os: "",
      role: "",
      tags: ["new","discovered"],
      links: (withLinks ? (item.suggested_links||[]) : []),
      checks: [{"type":"ping"}, {"type":"tcp","port":22}]
    });
    ta.value = JSON.stringify(cfg, null, 2);
  }catch(err){
    alert('Could not edit config JSON: '+err.message);
  }
}

// --- Editor & Search init ---
let originalConfigText = '';

async function loadSchedule(){
  try{
    const res = await fetch(`${API_BASE}/schedule`, { headers: authHeaders() });
    if(!res.ok) return;
    const s = await res.json();
    document.getElementById('schedEnabled').checked = !!s.enabled;
    document.getElementById('schedSubnet').value = s.subnet || '';
    document.getElementById('schedInterval').value = s.interval_min || '';
    document.getElementById('schedTopPorts').value = s.top_ports || '';
  }catch(_){}
}

async function saveSchedule(){
  try{
    const payload = {
      enabled: document.getElementById('schedEnabled').checked,
      subnet: document.getElementById('schedSubnet').value || '192.168.0.0/24',
      interval_min: parseInt(document.getElementById('schedInterval').value || '0', 10),
      top_ports: parseInt(document.getElementById('schedTopPorts').value || '100', 10)
    };
    const res = await fetch(`${API_BASE}/schedule`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error('Failed to save schedule');
    alert('Schedule saved.');
  }catch(e){ alert('Error: '+e.message); }
}

async function applyAndSave(withBackup=false){
  try{
    const txt = document.getElementById('configEditor').value;
    const next = JSON.parse(txt);
    // render + localStorage
    localStorage.setItem('homelab.config', JSON.stringify(next));
    renderDashboard(next);
    // persist to backend
    const path = withBackup ? '/save-config-with-backup' : '/save-config';
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(next)
    });
    if(!res.ok) throw new Error('Failed to save to backend');
    alert(withBackup ? 'Saved & backed up.' : 'Saved to backend (servers.json).');
  }catch(err){ alert('Invalid JSON or save failed: '+err.message); }
}

async function init(){
  const cfg = await loadConfig();
  originalConfigText = JSON.stringify(cfg, null, 2);
  document.getElementById('configEditor').value = localStorage.getItem('homelab.config') || originalConfigText;
  renderDashboard(cfg);

  const input = document.getElementById('searchInput');
  input.addEventListener('input', debounce(e=>{applyFilters()}, 120));
  window.addEventListener('keydown', (e)=>{ if(e.key==='/'){ e.preventDefault(); input.focus(); } });

  document.getElementById('btnApply').addEventListener('click', ()=>{
    try{
      const txt = document.getElementById('configEditor').value;
      const next = JSON.parse(txt);
      localStorage.setItem('homelab.config', JSON.stringify(next));
      renderDashboard(next);
    }catch(err){ alert('Invalid JSON: '+err.message); }
  });

  document.getElementById('btnApplySave').addEventListener('click', ()=>applyAndSave(false));
  document.getElementById('btnBackupSave').addEventListener('click', ()=>applyAndSave(true));

  document.getElementById('btnRevert').addEventListener('click', ()=>{
    localStorage.removeItem('homelab.config');
    document.getElementById('configEditor').value = originalConfigText;
    renderDashboard(JSON.parse(originalConfigText));
  });

  document.getElementById('btnClearLocal').addEventListener('click', ()=>{
    localStorage.removeItem('homelab.config');
    alert('Local changes cleared. Reopen the editor or reload the page.');
  });

  document.getElementById('btnExport').addEventListener('click', ()=>{
    const txt = document.getElementById('configEditor').value;
    const blob = new Blob([txt], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'servers.json';
    a.click();
  });

  document.getElementById('fileImport').addEventListener('change', async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const txt = await file.text();
    try{
      const obj = JSON.parse(txt);
      document.getElementById('configEditor').value = JSON.stringify(obj, null, 2);
      localStorage.setItem('homelab.config', JSON.stringify(obj));
      renderDashboard(obj);
    }catch(err){ alert('Invalid JSON: '+err.message); }
    e.target.value='';
  });

  document.getElementById('btnViewDiscoveries').addEventListener('click', ()=>{
    showDiscoveries(window._discoveries || []);
  });
  document.getElementById('btnDismissDiscoveries').addEventListener('click', ()=>{
    document.getElementById('discoverBanner').classList.add('d-none');
  });

  document.getElementById('btnRunScan').addEventListener('click', async ()=>{
    const subnet = document.getElementById('scanSubnet').value || '192.168.0.0/24';
    try{
      const resp = await fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ subnet })
      });
      if(!resp.ok) throw new Error('Scan failed');
      const data = await resp.json();
      window._discoveries = data.hosts || [];
      showDiscoveries(window._discoveries);
    }catch(err){ alert('Scan error: '+err.message); }
  });

  document.getElementById('btnScan').addEventListener('click', ()=>{
    const modal = new bootstrap.Modal(document.getElementById('discoveryModal'));
    modal.show();
  });

  // API key & bearer UI
  document.getElementById('btnSaveApiKey').addEventListener('click', ()=>{
    const val = document.getElementById('apiKeyInput').value.trim();
    if(!val){ alert('Enter an API key'); return; }
    API_KEY = val;
    localStorage.setItem('homelab.apiKey', API_KEY);
    alert('API key saved for this browser.');
  });
  document.getElementById('btnSaveBearer').addEventListener('click', ()=>{
    const val = document.getElementById('bearerInput').value.trim();
    if(!val){ alert('Enter a bearer token'); return; }
    BEARER = val;
    localStorage.setItem('homelab.bearer', BEARER);
    alert('Bearer token saved for this browser.');
  });

  // try load discoveries + schedule on startup
  loadDiscoveries();
  loadSchedule();
  attachAutocomplete();
  debouncedValidate();
  document.getElementById('btnInsertServer').addEventListener('click', ()=>insertTemplate('server'));
  document.getElementById('btnInsertGroup').addEventListener('click', ()=>insertTemplate('group'));
  refreshBackups();
  document.getElementById('btnRefreshBackups').addEventListener('click', refreshBackups);

  // Apply Now from discovery modal
  document.getElementById('btnApplyNowDiscoveries').addEventListener('click', ()=>{
    try{
      const txt = document.getElementById('configEditor').value;
      const next = JSON.parse(txt);
      localStorage.setItem('homelab.config', JSON.stringify(next));
      renderDashboard(next);
    }catch(err){ alert('Invalid JSON: '+err.message); }
  });
}


async function refreshBackups(){
  try{
    const res = await fetch(`${API_BASE}/backups`, { headers: authHeaders(), cache:'no-store' });
    if(!res.ok) throw new Error('Failed to list backups');
    const data = await res.json();
    const list = document.getElementById('backupList');
    list.innerHTML = '';
    (data.files||[]).reverse().forEach(name=>{
      const item = document.createElement('div');
      item.className = 'list-group-item list-group-item-dark d-flex justify-content-between align-items-center';
      item.innerHTML = `<span><i class="bi bi-archive me-2"></i>${name}</span>
        <span class="d-flex gap-2">
          <a class="btn btn-sm btn-outline-info" href="${API_BASE}/backups/${name}" target="_blank"><i class="bi bi-download"></i></a>
          <button class="btn btn-sm btn-outline-warning" data-restore="${name}"><i class="bi bi-arrow-counterclockwise"></i> Restore</button>
          <button class="btn btn-sm btn-outline-secondary" data-preview="${name}"><i class="bi bi-eye"></i> Preview</button>
        </span>`;
      list.appendChild(item);
      item.querySelector('button[data-restore]').addEventListener('click', async ()=>{
        if(!confirm('Restore this backup and overwrite servers.json?')) return;
        const res2 = await fetch(`${API_BASE}/restore-config`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name })
        });
        if(!res2.ok){ alert('Restore failed'); return; }
        alert('Restored. Reloading config…');
        const cfg = await loadConfig();
        document.getElementById('configEditor').value = JSON.stringify(cfg, null, 2);
        renderDashboard(cfg);
      });
      item.querySelector('button[data-preview]').addEventListener('click', async ()=>{
        const res3 = await fetch(`${API_BASE}/backups/${name}`, { headers: authHeaders() });
        if(!res3.ok){ alert('Preview failed'); return; }
        const txt = await res3.text();
        try{
          const obj = JSON.parse(txt);
          const pretty = JSON.stringify(obj, null, 2).slice(0, 4000);
          alert(pretty + (txt.length>4000 ? '\\n\\n…(truncated)…' : ''));
        }catch(_){
          alert('Invalid JSON in backup.');
        }
      });
    });
  }catch(e){
    alert(e.message);
  }
}


// ---- Schema-aware editor ----
const SERVER_TEMPLATE = {
  "name": "New Server",
  "ip": "192.168.0.10",
  "os": "Ubuntu 24.04",
  "role": "App server",
  "tags": ["app","linux"],
  "links": [ { "label":"SSH", "url":"ssh://root@192.168.0.10" } ],
  "checks": [ {"type":"ping"}, {"type":"tcp","port":22}, {"type":"http","url":"http://192.168.0.10"} ]
};

const GROUP_TEMPLATE = {
  "name": "New Group",
  "servers": [ Object.assign({}, SERVER_TEMPLATE) ]
};

const COMMON_KEYS = ["name","ip","os","role","tags","links","checks","grafana","groups","servers","label","url","type","port"];

function showValidation(result){
  const box = document.getElementById('validationErrors');
  box.innerHTML = '';
  if(result && result.ok === false){
    box.className = 'mt-2 small text-danger';
    box.textContent = 'Schema error: ' + (result.error || 'Unknown error');
  }else{
    box.className = 'mt-2 small text-success';
    box.textContent = 'Schema OK';
  }
}

const debouncedValidate = debounce(async () => {
  try{
    const txt = document.getElementById('configEditor').value;
    const obj = JSON.parse(txt);
    const res = await fetch(`${API_BASE}/validate`, {
      method:'POST',
      headers: authHeaders(),
      body: JSON.stringify(obj)
    });
    if(res.ok){
      showValidation({ok:true});
    }else{
      const data = await res.json().catch(()=>({error:'Invalid'}));
      showValidation({ok:false, error:data.error || res.statusText});
    }
  }catch(err){
    showValidation({ok:false, error: 'JSON parse error: ' + err.message});
  }
}, 400);

function attachAutocomplete(){
  const ta = document.getElementById('configEditor');
  ta.addEventListener('keyup', (e)=>{
    // naive autocomplete: on ':' typed after a common key, or on '{' start lines, do nothing special;
    // provide a simple hint banner of common keys.
    if(e.key === '{' || e.key === '"'){
      // Show a simple tooltip of COMMON_KEYS
      const box = document.getElementById('validationErrors');
      box.className = 'mt-2 small text-info';
      box.textContent = 'Common keys: ' + COMMON_KEYS.join(', ');
    }
    debouncedValidate();
  });
}

function insertTemplate(kind){
  try{
    const ta = document.getElementById('configEditor');
    const obj = JSON.parse(ta.value);
    if(kind === 'server'){
      if(!Array.isArray(obj.groups)) obj.groups = [];
      if(!obj.groups.length) obj.groups.push({name:"Ungrouped", servers:[]});
      obj.groups[0].servers = obj.groups[0].servers || [];
      obj.groups[0].servers.push(JSON.parse(JSON.stringify(SERVER_TEMPLATE)));
    }else if(kind === 'group'){
      obj.groups = obj.groups || [];
      obj.groups.push(JSON.parse(JSON.stringify(GROUP_TEMPLATE)));
    }
    ta.value = JSON.stringify(obj, null, 2);
    debouncedValidate();
  }catch(err){
    alert('Cannot insert template: ' + err.message);
  }
}

window.addEventListener('DOMContentLoaded', init);
