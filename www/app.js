const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let curSrc = store.get('src', 'jkanime');
let query = '';
const cache = {};
let token = 0;

const card = (src, a) => `<a class="card" href="#/anime/${src}/${enc(a.url)}">
  <img referrerpolicy="no-referrer" loading="lazy" src="${esc(a.cover)}" alt=""><span>${esc(a.title)}</span></a>`;
const errBox = (e, retry) => `<p class="msg">⚠️ ${esc(e.message || e)}<br><br>Puede ser falta de internet, que la web cambió o que bloquea la app.<br><br><button class="btn" onclick="${retry}">Reintentar</button></p>`;

/* ---- favoritos / historial ---- */
const favs = () => store.get('favs', []);
const isFav = (src, url) => favs().some(f => f.src === src && f.url === url);
function toggleFav(src, url) {
  let f = favs();
  if (isFav(src, url)) f = f.filter(x => !(x.src === src && x.url === url));
  else { const d = cache[src + url]; f.unshift({ src, url, title: d ? d.title : url, cover: d ? d.cover : '' }); }
  store.set('favs', f); route();
}
const seenKey = (s, u) => 'seen:' + s + '|' + u;
const seen = (s, u) => store.get(seenKey(s, u), []);
function markSeen(s, u, n) { const a = seen(s, u); if (!a.includes(n)) a.push(n); store.set(seenKey(s, u), a); store.set('last:' + s + '|' + u, n); }

/* ---- vistas ---- */
const GENRES = [
  { id: 'romance', name: 'Romance' },
  { id: 'accion', name: 'Acción / Lucha' },
  { id: 'comedia', name: 'Comedia' },
  { id: 'fantasia', name: 'Fantasía' }
];

async function viewHome() {
  const my = ++token;
  const chips = Object.values(SOURCES).map(s => `<button class="chip ${s.id === curSrc ? 'on' : ''}" data-s="${s.id}">${s.name}</button>`).join('');
  app.innerHTML = `<h1>MiAnime</h1><div class="chips">${chips}</div>
    <form id="sf"><input id="q" placeholder="Buscar anime…" value="${esc(query)}"><button class="btn">Buscar</button></form>
    <div id="content"><p class="msg">Cargando…</p></div>`;
  app.querySelectorAll('.chip').forEach(b => b.onclick = () => { curSrc = b.dataset.s; store.set('src', curSrc); viewHome(); });
  $('#sf').onsubmit = e => { e.preventDefault(); query = $('#q').value.trim(); viewHome(); };
  
  const src = SOURCES[curSrc];
  try {
    if (query) {
      const list = await src.search(query);
      if (my !== token) return;
      $('#content').innerHTML = `<div class="grid">${list.length ? list.map(a => card(curSrc, a)).join('') : '<p class="msg">Sin resultados.</p>'}</div>`;
    } else {
      const latestPromise = src.latest();
      const genrePromises = GENRES.map(async g => {
        try {
          const list = src.genre ? await src.genre(g.id) : await src.search(g.name);
          return { ...g, list: list.slice(0, 6) };
        } catch (e) {
          return { ...g, list: [] };
        }
      });
      
      const latest = await latestPromise;
      const genresData = await Promise.all(genrePromises);
      if (my !== token) return;

      let html = '';
      html += `<div class="section-title">Últimos animes</div>`;
      html += latest.length ? `<div class="horizontal-grid">${latest.slice(0, 10).map(a => card(curSrc, a)).join('')}</div>` : `<p class="msg">No hay animes recientes.</p>`;

      for (const g of genresData) {
        if (g.list.length > 0) {
          html += `<div class="section-title">${g.name}</div>`;
          html += `<div class="horizontal-grid">${g.list.map(a => card(curSrc, a)).join('')}</div>`;
        }
      }

      $('#content').innerHTML = html;
    }
  } catch (e) { if (my === token) $('#content').innerHTML = errBox(e, 'viewHome()'); }
}

function viewFav() {
  const f = favs();
  app.innerHTML = `<h1>Favoritos</h1><div class="grid">${f.length ? f.map(a => card(a.src, a)).join('') : '<p class="msg">Aún no tienes favoritos. Ábrelos con ♥ desde la ficha de un anime.</p>'}</div>`;
}

async function getDetail(src, url) {
  const k = src + url;
  if (!cache[k]) cache[k] = await SOURCES[src].detail(url);
  return cache[k];
}

async function viewAnime(src, url) {
  const my = ++token;
  app.innerHTML = '<p class="msg">Cargando…</p>';
  try {
    const d = await getDetail(src, url);
    if (my !== token) return;
    const s = seen(src, url), last = store.get('last:' + src + '|' + url, 0);
    app.innerHTML = `<div class="row"><button class="btn sec" onclick="history.back()">← Volver</button>
      <button class="btn sec" onclick="toggleFav('${src}','${url.replace(/'/g, "\\'")}')">${isFav(src, url) ? '♥ Quitar' : '♡ Favorito'}</button></div>
      <div class="det"><img referrerpolicy="no-referrer" src="${esc(d.cover)}" alt="">
      <div><h2>${esc(d.title)}</h2><div class="syn">${esc(d.synopsis)}</div></div></div>
      <b>${d.episodes.length} episodios</b>
      <div class="eps">${d.episodes.map(n => `<a class="ep ${s.includes(n) ? 'seen' : ''} ${n === last ? 'last' : ''}" href="#/watch/${src}/${enc(url)}/${n}">${n}</a>`).join('') || '<p class="msg">No se encontraron episodios.</p>'}</div>`;
  } catch (e) { if (my === token) app.innerHTML = `<button class="btn sec" onclick="history.back()">← Volver</button>` + errBox(e, 'route()'); }
}

async function viewWatch(src, url, n) {
  const my = ++token;
  app.innerHTML = '<p class="msg">Buscando servidores…</p>';
  try {
    const S = SOURCES[src];
    const d = await getDetail(src, url);
    const servers = await S.servers(S.episodeUrl(url, n));
    if (my !== token) return;
    markSeen(src, url, n);
    const i = d.episodes.indexOf(n);
    const prev = d.episodes[i - 1], next = d.episodes[i + 1];
    const pref = store.get('pref', '');
    let idx = Math.max(0, servers.findIndex(s => s.name === pref));
    app.innerHTML = `<div class="row"><button class="btn sec" onclick="history.back()">← ${esc(d.title).slice(0, 28)}</button></div>
      <b>Episodio ${n}</b>
      <div class="player" id="pl"><button class="fsx" id="fsx">Salir ✕</button>${servers.length ? '' : '<p class="msg">No se encontraron servidores.</p>'}</div>
      <div class="row" id="srv">${servers.map((s, k) => `<button class="chip" data-k="${k}">${esc(s.name)}</button>`).join('')}</div>
      <div class="row"><button class="btn sec" id="fs">⛶ Pantalla completa</button>
      ${prev ? `<a class="btn sec" href="#/watch/${src}/${enc(url)}/${prev}">◀ Anterior</a>` : ''}
      ${next ? `<a class="btn" href="#/watch/${src}/${enc(url)}/${next}">Siguiente ▶</a>` : ''}</div>
      <p class="msg" style="padding:4px">${servers.length} servidores encontrados. Si uno no carga, prueba otro. Gira el celular para ver mejor.</p>
      <div class="row"><button class="btn sec" id="tgS"></button><button class="btn sec" id="tgD"></button></div>
      <button class="btn sec" id="dg">🛠 Diagnóstico</button>
      <textarea id="dgbox" readonly style="display:none;width:100%;height:220px;margin-top:8px;background:#1a1d27;color:#ccc;border:0;border-radius:8px;font-size:11px"></textarea>`;
    const pl = $('#pl');
    let ptok = 0;
    const clearPl = () => pl.querySelectorAll('iframe,video,.pmsg').forEach(f => f.remove());
    const say = t => { clearPl(); const d = document.createElement('div'); d.className = 'pmsg'; d.style.cssText = 'color:#aaa;padding:16px;font-size:14px'; d.textContent = t; pl.appendChild(d); };
    const showFrame = u => {
      clearPl();
      const f = document.createElement('iframe');
      f.src = u;
      f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
      f.allowFullscreen = true;
      f.referrerPolicy = 'no-referrer';
      // sandbox sin allow-popups ni allow-top-navigation: los anuncios no pueden abrir ventanas ni redirigir la app
      if (store.get('shield2', false)) f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
      pl.appendChild(f);
    };
    const showVideo = (u, onFail) => {
      clearPl();
      const v = document.createElement('video');
      v.controls = true; v.autoplay = true; v.playsInline = true;
      v.style.cssText = 'width:100%;height:100%;background:#000';
      v.onerror = onFail;
      v.src = u;
      pl.appendChild(v);
    };
    const play = async k => {
      if (!servers[k]) return;
      const my = ++ptok;
      const sv = servers[k];
      $('#srv').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', +c.dataset.k === k));
      store.set('pref', sv.name);
      if (/\.(m3u8|mp4)(\?|#|$)/i.test(sv.url)) { showVideo(sv.url, () => showFrame(sv.url)); return; }
      if (store.get('direct', true)) {
        say('Buscando enlace directo (sin anuncios)…');
        try {
          const r = await Promise.race([S.resolve(sv.url), new Promise(res => setTimeout(() => res(null), 8000))]);
          if (my !== ptok) return;
          if (r && r.url) { showVideo(r.url, () => { if (my === ptok) showFrame(sv.url); }); return; }
        } catch (e) { if (my !== ptok) return; }
      }
      showFrame(sv.url);
    };
    const refreshToggles = () => {
      $('#tgS').textContent = '🧱 Sandbox (puede bloquear reproductores): ' + (store.get('shield2', false) ? 'ON' : 'OFF');
      $('#tgD').textContent = '⚡ Enlace directo: ' + (store.get('direct', true) ? 'ON' : 'OFF');
    };
    let cur = 0;
    $('#tgS').onclick = () => { store.set('shield2', !store.get('shield2', false)); refreshToggles(); play(cur); };
    $('#tgD').onclick = () => { store.set('direct', !store.get('direct', true)); refreshToggles(); play(cur); };
    refreshToggles();
    $('#dg').onclick = () => {
      const box = $('#dgbox');
      box.style.display = 'block';
      box.value = (servers.diag || 'sin datos') + '\n\nURL: ' + S.episodeUrl(url, n);
      box.focus(); box.select();
      try { document.execCommand('copy'); } catch (e) {}
    };
    $('#srv').querySelectorAll('.chip').forEach(c => c.onclick = () => { cur = +c.dataset.k; play(cur); });
    $('#fs').onclick = () => pl.classList.add('fs');
    $('#fsx').onclick = () => pl.classList.remove('fs');
    cur = idx; play(idx);
  } catch (e) { if (my === token) app.innerHTML = `<button class="btn sec" onclick="history.back()">← Volver</button>` + errBox(e, 'route()'); }
}

/* ---- router por hash (el botón "atrás" de Android funciona solo) ---- */
function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  const nav = $('#nav');
  nav.classList.toggle('hide', p[0] === 'watch');
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.t === (p[0] === 'fav' ? 'fav' : 'home')));
  window.scrollTo(0, 0);
  if (p[0] === 'anime') viewAnime(p[1], decodeURIComponent(p[2]));
  else if (p[0] === 'watch') viewWatch(p[1], decodeURIComponent(p[2]), parseInt(p[3]));
  else if (p[0] === 'fav') viewFav();
  else viewHome();
}
window.addEventListener('hashchange', route);
route();