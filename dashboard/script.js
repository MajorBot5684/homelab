async function loadServers() {
  const response = await fetch('servers.json');
  const data = await response.json();

  const dashboard = document.getElementById('dashboard');

  data.groups.forEach(group => {
    const groupDiv = document.createElement('div');
    groupDiv.innerHTML = `<h2 class="mt-4">${group.name}</h2><div class="row"></div>`;
    const row = groupDiv.querySelector('.row');

    group.servers.forEach(server => {
      const col = document.createElement('div');
      col.classList.add('col-md-4');

      let links = '';
      if (server.links) {
        links = server.links.map(l => `<a href="${l.url}" class="btn btn-sm btn-light me-1" target="_blank">${l.label}</a>`).join('');
      }

      col.innerHTML = `
        <div class="card bg-secondary mb-3">
          <div class="card-body">
            <h5 class="card-title">${server.name}</h5>
            <p>IP: ${server.ip}<br>OS: ${server.os}<br>Role: ${server.role}</p>
            <div>${links}</div>
            <span class="badge bg-warning text-dark" id="status-${server.ip}">Checking...</span>
          </div>
        </div>
      `;
      row.appendChild(col);

      // Run health check
      checkHealth(server.ip);
    });

    dashboard.appendChild(groupDiv);
  });
}

async function checkHealth(ip) {
  try {
    const resp = await fetch(`http://${ip}`, { mode: 'no-cors' });
    document.getElementById(`status-${ip}`).textContent = 'Online';
    document.getElementById(`status-${ip}`).className = 'badge bg-success';
  } catch (e) {
    document.getElementById(`status-${ip}`).textContent = 'Offline';
    document.getElementById(`status-${ip}`).className = 'badge bg-danger';
  }
}

loadServers();
