/* ====== FUENTES (scrapers) ======
   Cada fuente implementa:
     latest()          -> [{title,url,cover}]
     search(q)         -> [{title,url,cover}]
     genre(g)          -> [{title,url,cover}]
     detail(url)       -> {title,cover,synopsis,episodes:[numeros]}
     episodeUrl(url,n) -> url del capítulo
     servers(epUrl)    -> [{name,url}]  (url de reproductor embebido)
   Para añadir otra web, copia una fuente y cámbiale los selectores. */

const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

async function get(url, referer) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' };
  if (referer) headers['Referer'] = referer;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' en ' + url);
  return r.text();
}
const toDoc = h => new DOMParser().parseFromString(h, 'text/html');
const abs = (u, base) => { try { return new URL(u, base).href; } catch (e) { return u; } };
const unesc = s => s.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
const uniqBy = (arr, key) => { const s = new Set(); return arr.filter(x => !s.has(x[key]) && s.add(x[key])); };


/* ---- Extractor de enlace directo (para reproducir sin anuncios) ---- */
function unpackAll(html) {
  const out = [];
  const re = /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      let p = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      const a = +m[2]; let c = +m[3]; const k = m[4].split('|');
      const e = n => (n < a ? '' : e(parseInt(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
      const d = {};
      while (c--) d[e(c)] = k[c] || e(c);
      out.push(p.replace(/\b\w+\b/g, w => (d[w] !== undefined ? d[w] : w)));
    } catch (e) {}
  }
  return out;
}
async function resolveDirect(url, referer) {
  if (/\.(m3u8|mp4)(\?|#|$)/i.test(url)) return { url };
  const html = await get(url, referer);
  const text = [html, ...unpackAll(html)].join('\n').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const bad = /\.(jpg|jpeg|png|webp|gif|vtt|srt|ass|js|css)(\?|$)/i;
  const pats = [
    /["']?(?:file|src|source|hls\d?|url|video_url|contentUrl)["']?\s*[:=]\s*["'](https?:[^"'\s]+?\.m3u8[^"'\s]*)["']/i,
    /["']?(?:file|src|source|video_url|contentUrl|url)["']?\s*[:=]\s*["'](https?:[^"'\s]+?\.mp4[^"'\s]*)["']/i,
    /(https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*)/i,
    /<source[^>]+src=["']([^"']+)["']/i,
    /(https?:\/\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*)/i
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (m) { const u = abs(m[1].replace(/&amp;/g, '&'), url); if (!bad.test(u)) return { url: u }; }
  }
  return null;
}

/* ---------- JKAnime ---------- */
const JK = {
  id: 'jkanime', name: 'JKAnime', base: 'https://jkanime.net',
  root(u) {                       // https://jkanime.net/slug/12/ -> https://jkanime.net/slug/
    const p = new URL(u).pathname.split('/').filter(Boolean);
    return this.base + '/' + p[0] + '/';
  },
  parseList(doc) {
    const selectors = ['.anime__item', '.latest__item', '.col-lg-4', '.col-md-4', '.col-6', 'article', '.item'];
    let els = [];
    for (const sel of selectors) {
      els = [...doc.querySelectorAll(sel)];
      if (els.length > 0) break;
    }
    if (!els.length) {
      els = [...doc.querySelectorAll('a img')].map(img => img.closest('a')).filter(Boolean);
    }
    const items = els.map(el => {
      const a = el.querySelector('h5 a, h3 a, h4 a, a[href]') || (el.tagName === 'A' ? el : el.querySelector('a'));
      const pic = el.querySelector('[data-setbg]') || el;
      const img = el.querySelector('img') || (el.tagName === 'IMG' ? el : null);
      const href = a ? a.getAttribute('href') : (el.tagName === 'A' ? el.getAttribute('href') : null);
      if (!href) return null;
      let title = (a ? a.textContent.trim() : '') || (img && img.alt) || '';
      if (!title && a) title = a.title || '';
      return {
        title: title.trim(),
        url: JK.root(abs(href, JK.base)),
        cover: abs((pic && pic.dataset && pic.dataset.setbg) || (img && (img.src || img.dataset.src)) || '', JK.base)
      };
    }).filter(x => x && x.title && x.url);
    return uniqBy(items, 'url');
  },
  async latest() { return this.parseList(toDoc(await get(this.base + '/'))); },
  async search(q) { return this.parseList(toDoc(await get(this.base + '/buscar/' + encodeURIComponent(q) + '/'))); },
  async genre(g) {
    try {
      return this.parseList(toDoc(await get(this.base + '/genero/' + g + '/')));
    } catch (e) { return []; }
  },
  async detail(url) {
    const html = await get(url);
    const d = toDoc(html);
    const meta = p => (d.querySelector('meta[property="' + p + '"]') || {}).content || '';
    const title = (d.querySelector('.anime__details__title h3') || d.querySelector('h1,h3') || {}).textContent || meta('og:title');
    const picEl = d.querySelector('.anime__details__pic');
    const cover = (picEl && picEl.dataset.setbg) || meta('og:image');
    const synEl = d.querySelector('.anime__details__text p');
    const synopsis = (synEl && synEl.textContent.trim()) || meta('og:description');
    let eps = [];
    // 1) endpoint ajax de episodios
    try {
      const idEl = d.querySelector('#guardar-anime');
      const id = idEl && idEl.dataset.anime;
      if (id) {
        let page = 1, last = 1;
        do {
          const j = JSON.parse(await get(this.base + '/ajax/episodes/' + id + '/' + page + '/', url));
          const arr = Array.isArray(j) ? j : (j.data || j.episodes || []);
          arr.forEach(e => { const n = parseInt(e.number ?? e.episode ?? e.id); if (n) eps.push(n); });
          last = parseInt(j.last_page || j.lastPage || 1) || 1;
          page++;
        } while (page <= last && page <= 40);
      }
    } catch (e) { /* cae al plan B */ }
    // 2) plan B: contar por texto / enlaces
    if (!eps.length) {
      let max = 0;
      const m = html.match(/Episodios[^0-9<]{0,25}(?:<[^>]+>\s*)*(\d+)/i);
      if (m) max = parseInt(m[1]);
      const re = new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)/?', 'g');
      let x; while ((x = re.exec(html))) max = Math.max(max, parseInt(x[1]));
      for (let i = 1; i <= max; i++) eps.push(i);
    }
    eps = [...new Set(eps)].sort((a, b) => a - b);
    return { title: title.trim(), cover: abs(cover, this.base), synopsis, episodes: eps };
  },
  episodeUrl(url, n) { return url.replace(/\/?$/, '/') + n + '/'; },
  resolve(u) { return resolveDirect(u, this.base + '/'); },
  async servers(epUrl) {
    const html = await get(epUrl, this.base + '/');
    const out = [];
    const add = (name, url) => {
      if (!url || !/^https?:/i.test(url) || out.some(o => o.url === url)) return;
      if (out.some(o => o.name === name)) name += ' (2)';
      out.push({ name, url });
    };
    let list = [];
    const m = html.match(/var servers\s*=\s*(\[[\s\S]*?\]);/);
    if (m) { try { list = JSON.parse(m[1]); } catch (e) {} }
    const names = list.map(s => s.server);
    // etiquetas reales de las pestañas del reproductor (Desu, Magi, ...)
    const pdoc = toDoc(html);
    const tabLabel = {};
    pdoc.querySelectorAll('[onclick*="video["], [data-video], [data-id]').forEach(t => {
      const oc = t.getAttribute('onclick') || '';
      const mm = oc.match(/video\[(\d+)\]/);
      const idx = mm ? mm[1] : (t.getAttribute('data-video') || null);
      const txt = (t.textContent || '').trim();
      if (idx !== null && txt && txt.length < 30 && !(idx in tabLabel)) tabLabel[idx] = txt;
    });
    const found = [];
    const reIdx = /video\[(\d+)\]\s*=/g; let q;
    while ((q = reIdx.exec(html))) found.push(+q[1]);
    const base0 = found.length ? Math.min(...found) : 1;        // los indices pueden empezar en 0 o en 1
    const nameOf = i => tabLabel[i] || names[i - base0] || ('Servidor ' + (i - base0 + 1));
    // 1) todos los video[n] = '<iframe src=...>'
    const snippets = [];
    const re = /video\[(\d+)\]\s*=\s*(['"])([\s\S]*?)\2\s*;/g;
    let x;
    while ((x = re.exec(html))) {
      snippets.push(x[0].slice(0, 260));
      const s = x[3].match(/src=\\?["']([^"'\\\s]+)/);
      if (s) add(nameOf(+x[1]), abs(unesc(s[1]), this.base));
    }
    // 2) "remote" en base64 -> si es una URL, es un embed directo
    list.forEach(sv => {
      try { const d = atob(sv.remote); if (/^https?:\/\//i.test(d)) add(sv.server, d); } catch (e) {}
    });
    // 3) cualquier iframe suelto
    if (!out.length) toDoc(html).querySelectorAll('iframe[src]').forEach((f, i) => add('Servidor ' + (i + 1), abs(f.getAttribute('src'), this.base)));
    out.diag = 'JKAnime\nservers=' + (m ? m[1].slice(0, 2500) : '(no encontrado)') +
      '\n\ntabs=' + JSON.stringify(tabLabel) + ' base0=' + base0 + '\n\nvideo[] (' + snippets.length + '):\n' + snippets.join('\n') + '\n\nencontrados: ' + out.map(o => o.name).join(', ');
    return out;
  }
};

/* ---------- AnimeAV1 ---------- */
const AV = {
  id: 'animeav1', name: 'AnimeAV1', base: 'https://animeav1.com',
  slugOf(href) {
    const p = new URL(abs(href, AV.base)).pathname.split('/').filter(Boolean);
    return p[0] === 'media' && p.length === 2 ? p[1] : null;
  },
  parseList(doc) {
    const out = [];
    doc.querySelectorAll('a[href*="/media/"]').forEach(a => {
      const slug = AV.slugOf(a.getAttribute('href'));
      if (!slug) return;
      // sube por el DOM hasta el contenedor de la tarjeta (que tenga imagen y un solo anime)
      let box = a, best = null;
      for (let i = 0; i < 6; i++) {
        box = box.parentElement;
        if (!box || box === doc.body) break;
        const slugs = new Set([...box.querySelectorAll('a[href*="/media/"]')].map(l => (new URL(abs(l.getAttribute('href'), AV.base)).pathname.split('/')[2])));
        if (slugs.size > 1) break;
        if (box.querySelector('img')) best = box;
      }
      if (!best) return;
      const imgs = [...best.querySelectorAll('img')];
      const img = imgs.find(i => /covers/.test(i.getAttribute('src') || '')) || imgs[0];
      const h = best.querySelector('h3,h2');
      const title = ((h && h.textContent) || (img.getAttribute('alt') || '').replace(/^(Portada|Póster) de /, '')).trim();
      if (!title) return;
      out.push({ title, url: AV.base + '/media/' + slug, cover: abs(img.getAttribute('src') || img.dataset.src || '', AV.base) });
    });
    return uniqBy(out, 'url');
  },
  async latest() { return this.parseList(toDoc(await get(this.base + '/catalogo'))); },
  async search(q) { return this.parseList(toDoc(await get(this.base + '/catalogo?search=' + encodeURIComponent(q)))); },
  async genre(g) {
    try {
      const qMap = { romance: 'romance', accion: 'accion', comedia: 'comedia', fantasia: 'fantasia' };
      return this.search(qMap[g] || g);
    } catch (e) { return []; }
  },
  async detail(url) {
    const html = await get(url);
    const d = toDoc(html);
    const meta = p => (d.querySelector('meta[property="' + p + '"]') || {}).content || '';
    const slug = new URL(url).pathname.split('/').filter(Boolean)[1];
    const nums = new Set();
    const re = new RegExp('/media/' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(\\d+)', 'g');
    let x; while ((x = re.exec(html))) nums.add(parseInt(x[1]));
    const poster = [...d.querySelectorAll('img')].find(i => /covers/.test(i.getAttribute('src') || ''));
    const descM = d.querySelector('meta[name="description"]');
    return {
      title: ((d.querySelector('h1') || {}).textContent || meta('og:title')).trim(),
      cover: abs((poster && poster.getAttribute('src')) || meta('og:image'), this.base),
      synopsis: meta('og:description') || (d.querySelector('h1') && d.querySelector('h1').parentElement.querySelector('p') || {}).textContent || (descM && descM.content) || '',
      episodes: [...nums].sort((a, b) => a - b)
    };
  },
  episodeUrl(url, n) { return url.replace(/\/$/, '') + '/' + n; },
  resolve(u) { return resolveDirect(u, this.base + '/'); },
  async servers(epUrl) {
    const html = await get(epUrl, this.base + '/');
    const out = [];
    const junk = u => /animeav1\.com|discord\.gg|google|gstatic|w3\.org|svelte|github|schema\.org|\.(jpg|jpeg|png|webp|avif|svg|css|ico|woff2?)(\?|$)/i.test(u);
    const add = (lang, name, url) => {
      url = unesc(String(url));
      if (!/^https?:/i.test(url) || junk(url) || out.some(o => o.url === url)) return;
      out.push({ name: (lang ? lang + ' · ' : '') + name, url });
    };
    // A) objetos {server:"..",url:".."} dentro del HTML/JS de la página
    const objRe = /\{[^{}]*\}/g; let m;
    while ((m = objRe.exec(html))) {
      const c = m[0]; if (c.length > 700) continue;
      const u = c.match(/["']?(?:url|link|src|embed)["']?\s*[:=]\s*["'](https?:[^"']+)["']/i);
      const n = c.match(/["']?(?:server|name|provider|label)["']?\s*[:=]\s*["']([^"']+)["']/i);
      if (u && n) {
        const back = html.slice(Math.max(0, m.index - 400), m.index);
        const l = [...back.matchAll(/\b(SUB|DUB|LAT)\b["']?\s*:/g)].pop();
        add(l ? l[1] : '', n[1], u[1]);
      }
    }
    // B) endpoint de datos de SvelteKit (__data.json, formato devalue)
    let usedB = false;
    if (!out.length) {
      try {
        usedB = true;
        const j = JSON.parse(await get(epUrl.replace(/\/$/, '') + '/__data.json', epUrl));
        const res = (arr, i, d) => {
          if (typeof i !== 'number' || i < 0 || d > 14) return null;
          const v = arr[i];
          if (v === null || typeof v !== 'object') return v;
          if (Array.isArray(v)) return v.map(k => res(arr, k, d + 1));
          const o = {}; for (const k in v) o[k] = res(arr, v[k], d + 1); return o;
        };
        const walk = (o, lang) => {
          if (Array.isArray(o)) return o.forEach(i => walk(i, lang));
          if (!o || typeof o !== 'object') return;
          const ks = Object.keys(o);
          const uk = ks.find(k => /^(url|link|src|embed)$/i.test(k) && typeof o[k] === 'string');
          const nk = ks.find(k => /^(server|name|provider|label)$/i.test(k) && typeof o[k] === 'string');
          if (uk && nk) add(lang, o[nk], o[uk]);
          ks.forEach(k => walk(o[k], /^(SUB|DUB|LAT)$/i.test(k) ? k.toUpperCase() : lang));
        };
        (j.nodes || []).forEach(n => { if (n && Array.isArray(n.data)) walk(res(n.data, 0, 0), ''); });
      } catch (e) {}
    }
    // C) último recurso: cualquier URL externa que parezca un reproductor
    if (!out.length) {
      const seenH = new Set();
      for (const mm of html.matchAll(/https?:(?:\\?\/){2}[^"'\s<>\\]+(?:\\u002F[^"'\s\\<>]*)*/g)) {
        const u = unesc(mm[0]);
        let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { continue; }
        if (junk(u) || seenH.has(u)) continue;
        seenH.add(u); add('', host, u);
      }
    }
    out.diag = 'AnimeAV1\nhtml=' + html.length + ' bytes\nencontrados=' + out.map(o => o.name + ' -> ' + o.url).join('\n') +
      '\nusedDataJson=' + usedB + '\n\ncontexto:\n' + (html.match(/.{0,300}(?:SUB|embeds).{0,500}/s) || ['(sin SUB/embeds)'])[0];
    return out;
  }
};

const SOURCES = { jkanime: JK, animeav1: AV };
if (typeof module !== 'undefined') module.exports = { JK, AV };