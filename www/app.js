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
async function viewHome() {
  const my = ++token;
  const chips = Object.values(SOURCES).map(s => `<button class="chip ${s.id === curSrc ? 'on' : ''}" data-s="${s.id}">${s.name}</button>`).join('');
  app.innerHTML = `<h1>MiAnime</h1><div class="chips">${chips}</div>
    <form id="sf"><input id="q" placeholder="Buscar anime…" value="${esc(query)}"><button class="btn">Buscar</button></form>
    <div id="list" class="grid"><p class="msg">Cargando…</p></div>`;
  app.querySelectorAll('.chip').forEach(b => b.onclick = () => { curSrc = b.dataset.s; store.set('src', curSrc); viewHome(); });
  $('#sf').onsubmit = e => { e.preventDefault(); query = $('#q').value.trim(); viewHome(); };
  try {
    const src = SOURCES[curSrc];
    const list = query ? await src.search(query) : await src.latest();
    if (my !== token) return;
    $('#list').innerHTML = list.length ? list.map(a => card(curSrc, a)).join('') : '<p class="msg">Sin resultados (o los selectores de esta web cambiaron).</p>';
  } catch (e) { if (my === token) $('#list').innerHTML = errBox(e, 'viewHome()'); }
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
      <button class="btn sec" id="dg">🛠 Diagnóstico</button>
      <textarea id="dgbox" readonly style="display:none;width:100%;height:220px;margin-top:8px;background:#1a1d27;color:#ccc;border:0;border-radius:8px;font-size:11px"></textarea>`;
    const pl = $('#pl');
    const play = k => {
      if (!servers[k]) return;
      pl.querySelectorAll('iframe,video').forEach(f => f.remove());
      let f;
      if (/\.(m3u8|mp4)(\?|#|$)/i.test(servers[k].url)) {
        f = document.createElement('video');
        f.controls = true; f.autoplay = true; f.playsInline = true;
        f.style.cssText = 'width:100%;height:100%;background:#000';
        f.src = servers[k].url;
      } else {
        f = document.createElement('iframe');
        f.src = servers[k].url;
        f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
        f.allowFullscreen = true;
        f.referrerPolicy = 'origin';
      }
      pl.appendChild(f);
      $('#srv').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', +c.dataset.k === k));
      store.set('pref', servers[k].name);
    };
    $('#dg').onclick = () => {
      const box = $('#dgbox');
      box.style.display = 'block';
      box.value = (servers.diag || 'sin datos') + '\n\nURL: ' + S.episodeUrl(url, n);
      box.focus(); box.select();
      try { document.execCommand('copy'); } catch (e) {}
    };
    $('#srv').querySelectorAll('.chip').forEach(c => c.onclick = () => play(+c.dataset.k));
    $('#fs').onclick = () => pl.classList.add('fs');
    $('#fsx').onclick = () => pl.classList.remove('fs');
    play(idx);
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
