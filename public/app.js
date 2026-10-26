// Frontend FisioVault: memanggil API yang sudah ada (/auth, /files).
// Semua data dari server ditampilkan lewat textContent (bukan innerHTML)
// supaya nama file buatan pengguna tidak bisa menyisipkan script (XSS).
const $ = (sel) => document.querySelector(sel);

const authView = $('#auth-view');
const appView = $('#app-view');
let authMode = 'login';

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || 'Terjadi kesalahan'), { status: res.status });
  return body;
}

function postJson(path, data) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

function setMsg(el, text, type) {
  el.textContent = text;
  el.className = `msg ${type || ''}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function iconFor(file) {
  if (file.kind === 'form') return '🪪';
  if (file.mime.startsWith('image/')) return '🖼️';
  if (file.mime.startsWith('video/')) return '🎬';
  if (file.mime === 'application/pdf') return '📄';
  return '📃';
}

// ---------- Login / daftar ----------
function showAuth() {
  appView.hidden = true;
  authView.hidden = false;
}

async function showApp(username) {
  authView.hidden = true;
  appView.hidden = false;
  $('#username').textContent = username;
  await loadFiles();
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const isRegister = authMode === 'register';
    $('#auth-submit').textContent = isRegister ? 'Buat akun' : 'Masuk';
    $('#auth-hint').hidden = !isRegister;
    $('#auth-form [name=password]').autocomplete = isRegister ? 'new-password' : 'current-password';
    setMsg($('#auth-msg'), '');
  });
});

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $('#auth-msg');
  const data = { username: form.username.value.trim(), password: form.password.value };
  const button = $('#auth-submit');
  button.disabled = true;
  try {
    if (authMode === 'register') await postJson('/auth/register', data);
    const user = await postJson('/auth/login', data);
    form.reset();
    setMsg(msg, '');
    await showApp(user.username);
  } catch (err) {
    setMsg(msg, err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  showAuth();
});

// ---------- Panel unggah & data pribadi ----------
document.querySelectorAll('.action').forEach((btn) => {
  btn.addEventListener('click', () => {
    const panel = document.getElementById(btn.dataset.panel);
    const open = panel.hidden;
    document.querySelectorAll('.panel').forEach((p) => (p.hidden = true));
    document.querySelectorAll('.action').forEach((b) => b.classList.remove('active'));
    panel.hidden = !open;
    btn.classList.toggle('active', open);
  });
});

// Pakai XHR (bukan fetch) supaya progres unggah video besar bisa ditampilkan.
$('#upload-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = form.querySelector('.msg');
  const progress = form.querySelector('.progress');
  const bar = form.querySelector('.bar');
  const button = form.querySelector('button');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/files');
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) bar.style.width = `${(ev.loaded / ev.total) * 100}%`;
  };
  xhr.onloadend = async () => {
    button.disabled = false;
    progress.hidden = true;
    const body = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
    if (xhr.status === 201) {
      setMsg(msg, `"${body.name}" tersimpan terenkripsi.`, 'ok');
      form.reset();
      await loadFiles();
    } else if (xhr.status === 401) {
      showAuth();
    } else {
      setMsg(msg, body.error || 'Unggah gagal', 'error');
    }
  };

  bar.style.width = '0';
  progress.hidden = false;
  button.disabled = true;
  setMsg(msg, 'Mengunggah & mengenkripsi...');
  xhr.send(new FormData(form));
});

$('#profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = form.querySelector('.msg');
  const data = Object.fromEntries(new FormData(form));
  try {
    await postJson('/files/form', data);
    setMsg(msg, 'Data pribadi tersimpan terenkripsi.', 'ok');
    form.reset();
    await loadFiles();
  } catch (err) {
    setMsg(msg, err.message, 'error');
  }
});

// ---------- Daftar dokumen ----------
async function loadFiles() {
  let files;
  try {
    files = await api('/files');
  } catch (err) {
    if (err.status === 401) return showAuth();
    throw err;
  }

  const list = $('#file-list');
  list.replaceChildren();
  $('#empty').hidden = files.length > 0;

  const template = $('#file-item');
  for (const file of files) {
    const item = template.content.cloneNode(true);
    item.querySelector('.file-icon').textContent = iconFor(file);
    item.querySelector('.file-name').textContent = file.kind === 'form' ? 'Data pribadi' : file.name;
    item.querySelector('.file-meta').textContent =
      `${formatSize(file.size)} · ${new Date(file.createdAt).toLocaleString('id-ID')}`;

    const download = item.querySelector('.download');
    download.href = `/files/${encodeURIComponent(file.id)}/download?algo=${$('#algo').value}`;
    download.addEventListener('click', () => {
      download.href = `/files/${encodeURIComponent(file.id)}/download?algo=${$('#algo').value}`;
    });

    item.querySelector('.delete').addEventListener('click', async () => {
      if (!confirm(`Hapus "${file.kind === 'form' ? 'Data pribadi' : file.name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
      await api(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      await loadFiles();
    });

    list.append(item);
  }
}

// ---------- Mulai ----------
api('/auth/me')
  .then((user) => showApp(user.username))
  .catch(() => showAuth());
