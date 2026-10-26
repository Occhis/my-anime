/* ====== FUENTES (scrapers) ======
   Cada fuente implementa:
     latest()          -> [{title,url,cover}]
     search(q)         -> [{title,url,cover}]
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

/* ---------- JKAnime ---------- */
const JK = {
  id: 'jkanime', name: 'JKAnime', base: 'https://jkanime.net',
  root(u) {                       // https://jkanime.net/slug/12/ -> https://jkanime.net/slug/
    const p = new URL(u).pathname.split('/').filter(Boolean);
    return this.base + '/' + p[0] + '/';
  },
  parseList(doc) {
    const items = [...doc.querySelectorAll('.anime__item')].map(el => {
      const a = el.querySelector('h5 a') || el.querySelector('a');
      const pic = el.querySelector('[data-setbg]');
      const img = el.querySelector('img');
      if (!a || !a.getAttribute('href')) return null;
      return {
        title: a.textContent.trim() || (img && img.alt) || '',
        url: JK.root(abs(a.getAttribute('href'), JK.base)),
        cover: abs((pic && pic.dataset.setbg) || (img && img.src) || '', JK.base)
      };
    }).filter(x => x && x.title);
    return uniqBy(items, 'url');
  },
  async latest() { return this.parseList(toDoc(await get(this.base + '/'))); },
  async search(q) { return this.parseList(toDoc(await get(this.base + '/buscar/' + encodeURIComponent(q) + '/'))); },
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
  async servers(epUrl) {
    const html = await get(epUrl, this.base + '/');
    let names = [];
    const m = html.match(/var servers\s*=\s*(\[.*?\]);/s);
    if (m) { try { names = JSON.parse(m[1]).map(s => s.server); } catch (e) {} }
    const out = [];
    const re = /video\[(\d+)\]\s*=\s*(?:'|")<iframe[^>]*?src=\\?["']([^"'\\\s]+)/g;
    let x;
    while ((x = re.exec(html))) out.push({ name: names[x[1] - 1] || ('Servidor ' + x[1]), url: abs(unesc(x[2]), this.base) });
    if (!out.length) {
      toDoc(html).querySelectorAll('iframe[src]').forEach((f, i) => out.push({ name: 'Servidor ' + (i + 1), url: abs(f.getAttribute('src'), this.base) }));
    }
    return out;
  }
};

/* ---------- AnimeAV1 ---------- */
const AV = {
  id: 'animeav1', name: 'AnimeAV1', base: 'https://animeav1.com',
  parseList(doc) {
    const items = [...doc.querySelectorAll('a[href*="/media/"]')].map(a => {
      const img = a.querySelector('img');
      if (!img) return null;
      const h = a.querySelector('h3,h2,header');
      const href = abs(a.getAttribute('href'), AV.base);
      const p = new URL(href).pathname.split('/').filter(Boolean);   // media, slug, [ep]
      return {
        title: ((h && h.textContent) || img.alt || '').trim(),
        url: AV.base + '/media/' + p[1],
        cover: abs(img.getAttribute('src') || img.dataset.src || '', AV.base)
      };
    }).filter(x => x && x.title);
    return uniqBy(items, 'url');
  },
  async latest() { return this.parseList(toDoc(await get(this.base + '/catalogo'))); },
  async search(q) { return this.parseList(toDoc(await get(this.base + '/catalogo?search=' + encodeURIComponent(q)))); },
  async detail(url) {
    const html = await get(url);
    const d = toDoc(html);
    const meta = p => (d.querySelector('meta[property="' + p + '"]') || {}).content || '';
    const slug = new URL(url).pathname.split('/').filter(Boolean)[1];
    const nums = new Set();
    const re = new RegExp('/media/' + slug + '/(\\d+)', 'g');
    let x; while ((x = re.exec(html))) nums.add(parseInt(x[1]));
    const eps = [...nums].sort((a, b) => a - b);
    return {
      title: ((d.querySelector('h1') || {}).textContent || meta('og:title')).trim(),
      cover: abs(meta('og:image'), this.base),
      synopsis: meta('og:description'),
      episodes: eps
    };
  },
  episodeUrl(url, n) { return url.replace(/\/$/, '') + '/' + n; },
  async servers(epUrl) {
    const html = await get(epUrl, this.base + '/');
    const out = [];
    const pair = /["']?server["']?\s*:\s*"([^"]+)"\s*,\s*["']?url["']?\s*:\s*"([^"]+)"/g;
    const blocks = [...html.matchAll(/\b(SUB|DUB)\s*:\s*\[(.*?)\]/gs)];
    const scan = (txt, lang) => { let m; pair.lastIndex = 0; while ((m = pair.exec(txt))) out.push({ name: (lang ? lang + ' · ' : '') + m[1], url: unesc(m[2]) }); };
    if (blocks.length) blocks.forEach(b => scan(b[2], b[1])); else scan(html, '');
    return uniqBy(out, 'url');
  }
};

const SOURCES = { jkanime: JK, animeav1: AV };
if (typeof module !== 'undefined') module.exports = { JK, AV };
