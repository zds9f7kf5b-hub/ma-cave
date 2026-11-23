// Stockage de la cave : copie locale (IndexedDB) + synchronisation avec un dépôt GitHub privé.
// Dépôt de données :
//   cave.json            → agencement, bouteilles, fiches importées, suppressions
//   photos/<id>.jpg      → photos des bouteilles
//   import/fiches.json   → fiches préparées à ajouter (+ leurs photos dans import/)
import { db } from './db.js';

export const DEFAULT_REPO = { owner: 'zds9f7kf5b-hub', repo: 'ma-cave-donnees' };
const API = 'https://api.github.com';

// ---------- Encodage ----------
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const textToB64 = t => bytesToB64(new TextEncoder().encode(t));
const b64ToText = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));
const blobToB64 = async blob => bytesToB64(new Uint8Array(await blob.arrayBuffer()));
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const now = () => new Date().toISOString();

// ---------- Client GitHub minimal ----------
class GitHub {
  constructor({ owner, repo, token }) { this.owner = owner; this.repo = repo; this.token = token; }
  url(path) {
    const p = path ? '/contents/' + path.split('/').map(encodeURIComponent).join('/') : '';
    return `${API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${p}`;
  }
  async req(path, { method = 'GET', body, raw = false } = {}) {
    const r = await fetch(this.url(path), {
      method, cache: 'no-store',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).message || msg; } catch { /* corps vide */ }
      const e = new Error(msg); e.status = r.status; throw e;
    }
    return raw ? r : r.json();
  }
  repoInfo() { return this.req(''); }
  async getFile(path) {
    try {
      const meta = await this.req(path);
      if (meta.content && meta.encoding === 'base64') return { text: b64ToText(meta.content), sha: meta.sha };
      const r = await this.req(path, { raw: true });
      return { text: await r.text(), sha: meta.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }
  async getBlob(path) { return (await this.req(path, { raw: true })).blob(); }
  putFile(path, base64, sha, message) {
    return this.req(path, { method: 'PUT', body: { message, content: base64, ...(sha ? { sha } : {}) } });
  }
}

// ---------- Fusion de deux états (appareils différents) ----------
function merge(local, remote) {
  const tomb = new Map();
  for (const t of [...(remote.tombstones || []), ...(local.tombstones || [])]) {
    if (!tomb.has(t.id) || tomb.get(t.id) < t.at) tomb.set(t.id, t.at);
  }
  const byId = new Map();
  for (const b of [...(remote.bottles || []), ...(local.bottles || [])]) {
    const cur = byId.get(b.id);
    if (!cur || (b.updatedAt || '') >= (cur.updatedAt || '')) byId.set(b.id, b);
  }
  const bottles = [...byId.values()].filter(b => !(tomb.has(b.id) && tomb.get(b.id) >= (b.updatedAt || '')));
  const useLocalLayout = local.layout && (!remote.layout || (local.layoutUpdatedAt || '') > (remote.layoutUpdatedAt || ''));
  return {
    layout: useLocalLayout ? local.layout : remote.layout || local.layout,
    layoutUpdatedAt: useLocalLayout ? local.layoutUpdatedAt : remote.layoutUpdatedAt || local.layoutUpdatedAt,
    importedIds: [...new Set([...(remote.importedIds || []), ...(local.importedIds || [])])],
    tombstones: [...tomb.entries()].map(([id, at]) => ({ id, at })),
    bottles,
  };
}

function friendly(e) {
  if (e && e.status === 401) return 'Jeton GitHub invalide ou expiré : mettez-le à jour dans les Réglages.';
  if (e && (e.status === 403 || e.status === 404)) return 'Dépôt de données introuvable, ou jeton sans droit d’écriture (Contents : Read and write).';
  if (e instanceof TypeError) return 'Hors ligne : les modifications sont gardées sur cet appareil et seront envoyées plus tard.';
  return 'Synchronisation impossible : ' + (e && e.message || e);
}

// ---------- Magasin principal ----------
class Store {
  constructor() {
    this.bottles = []; this.layout = null; this.layoutUpdatedAt = '';
    this.importedIds = []; this.tombstones = [];
    this.sha = null; this.dirty = false;
    this.cfg = { ...DEFAULT_REPO, token: '' };
    this.status = 'local'; this.statusMsg = '';
    this.statusListeners = new Set(); this.dataListeners = new Set();
    this.urls = new Map();
    this.chain = Promise.resolve(); this.timer = null;
  }

  get remote() { return !!(this.cfg.token && this.cfg.owner && this.cfg.repo); }
  get gh() { return new GitHub(this.cfg); }

  onStatus(fn) { this.statusListeners.add(fn); fn(this.status, this.statusMsg); }
  onData(fn) { this.dataListeners.add(fn); }
  _status(s, msg = '') { this.status = s; this.statusMsg = msg; this.statusListeners.forEach(f => f(s, msg)); }

  async init(defaultLayout) {
    const cfg = await db.getSetting('github');
    if (cfg) this.cfg = { ...this.cfg, ...cfg };
    this.layout = (await db.getSetting('layout')) || defaultLayout;
    this.layoutUpdatedAt = (await db.getSetting('layoutUpdatedAt')) || '';
    this.importedIds = (await db.getSetting('importedIds')) || [];
    this.tombstones = (await db.getSetting('tombstones')) || [];
    this.sha = (await db.getSetting('remoteSha')) || null;
    this.dirty = !!(await db.getSetting('dirty'));
    this.bottles = await db.allBottles();
    if (this.remote) await this.pull();
    else this._status('local', 'Données enregistrées sur cet appareil uniquement');
  }

  _snapshot() {
    return {
      layout: this.layout, layoutUpdatedAt: this.layoutUpdatedAt,
      importedIds: this.importedIds, tombstones: this.tombstones, bottles: this.bottles,
    };
  }

  async _apply(s, notify = true) {
    this.layout = s.layout; this.layoutUpdatedAt = s.layoutUpdatedAt || '';
    this.importedIds = s.importedIds || []; this.tombstones = s.tombstones || [];
    this.bottles = s.bottles || [];
    await db.replaceBottles(this.bottles);
    await db.setSetting('layout', this.layout);
    await db.setSetting('layoutUpdatedAt', this.layoutUpdatedAt);
    await db.setSetting('importedIds', this.importedIds);
    await db.setSetting('tombstones', this.tombstones);
    if (notify) this.dataListeners.forEach(f => f());
  }

  /** Récupère l'état du dépôt et le fusionne avec la copie locale. */
  pull() {
    if (!this.remote) return Promise.resolve();
    this.chain = this.chain.then(async () => {
      this._status('sync', 'Synchronisation…');
      const f = await this.gh.getFile('cave.json');
      let needPush;
      if (!f) {
        this.sha = null; needPush = true;
      } else {
        const remote = JSON.parse(f.text);
        // Jamais synchronisé depuis cet appareil, ou modifications en attente : on fusionne. Sinon le dépôt fait foi.
        const mergeNeeded = this.dirty || !this.sha;
        this.sha = f.sha;
        await this._apply(mergeNeeded ? merge(this._snapshot(), remote) : remote);
        needPush = mergeNeeded || this.bottles.some(b => b.photo instanceof Blob);
      }
      if (needPush) await this._doPush();
      else { await db.setSetting('remoteSha', this.sha); this._status('ok', 'Synchronisé avec GitHub'); }
    }).catch(e => this._status('error', friendly(e)));
    return this.chain;
  }

  _schedulePush() {
    if (!this.remote) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.chain = this.chain.then(() => this._doPush()).catch(e => this._status('error', friendly(e)));
    }, 700);
  }

  async _doPush(retry = true) {
    if (!this.remote) return;
    this._status('sync', 'Enregistrement sur GitHub…');
    // 1. Envoyer les photos encore locales (une seule fois par photo partagée)
    const uploaded = new Map();
    for (const b of this.bottles) {
      if (!(b.photo instanceof Blob)) continue;
      let path = uploaded.get(b.photo);
      if (!path) {
        path = `photos/${b.id}.jpg`;
        try { await this.gh.putFile(path, await blobToB64(b.photo), null, `Photo : ${b.producteur || b.appellation || b.id}`); }
        catch (e) { if (e.status !== 422) throw e; /* déjà envoyée */ }
        await db.putPhoto(path, b.photo);
        uploaded.set(b.photo, path);
      }
      this.urls.delete('blob:' + b.id);
      b.photo = path;
      await db.putBottle(b);
    }
    // 2. Écrire cave.json
    const body = JSON.stringify({ app: 'ma-cave', version: 2, updatedAt: now(), ...this._snapshot() }, null, 1);
    try {
      const r = await this.gh.putFile('cave.json', textToB64(body), this.sha, 'Mise à jour de la cave');
      this.sha = r.content.sha;
    } catch (e) {
      if (retry && (e.status === 409 || e.status === 422)) {
        // Modifié depuis un autre appareil entre-temps : on fusionne et on réessaie.
        const f = await this.gh.getFile('cave.json');
        if (f) { this.sha = f.sha; await this._apply(merge(this._snapshot(), JSON.parse(f.text))); } else this.sha = null;
        return this._doPush(false);
      }
      throw e;
    }
    this.dirty = false;
    await db.setSetting('dirty', false);
    await db.setSetting('remoteSha', this.sha);
    this._status('ok', 'Synchronisé avec GitHub');
  }

  /** À appeler au retour sur l'app (focus, reconnexion) pour récupérer les changements de l'autre appareil. */
  sync() {
    if (!this.remote) return Promise.resolve();
    return this.dirty ? (this._schedulePush(), Promise.resolve()) : this.pull();
  }

  async _changed() {
    this.dirty = true;
    await db.setSetting('dirty', true);
    this._schedulePush();
  }

  // ---------- Modifications ----------
  async saveBottle(b) {
    b.updatedAt = now();
    const i = this.bottles.findIndex(x => x.id === b.id);
    if (i >= 0) this.bottles[i] = b; else this.bottles.push(b);
    this.urls.delete('blob:' + b.id);
    await db.putBottle(b);
    await this._changed();
  }

  async deleteBottle(id) {
    this.bottles = this.bottles.filter(b => b.id !== id);
    this.tombstones = [...this.tombstones, { id, at: now() }];
    await db.deleteBottle(id);
    await db.setSetting('tombstones', this.tombstones);
    await this._changed();
  }

  async setLayout(layout) {
    this.layout = layout; this.layoutUpdatedAt = now();
    await db.setSetting('layout', layout);
    await db.setSetting('layoutUpdatedAt', this.layoutUpdatedAt);
    await this._changed();
  }

  async markImported(id) {
    if (this.importedIds.includes(id)) return;
    this.importedIds = [...this.importedIds, id];
    await db.setSetting('importedIds', this.importedIds);
    await this._changed();
  }

  // ---------- Photos ----------
  async photoBlob(b) {
    if (!b || !b.photo) return null;
    if (b.photo instanceof Blob) return b.photo;
    let blob = await db.getPhoto(b.photo);
    if (!blob && this.remote) {
      blob = await this.gh.getBlob(b.photo);
      await db.putPhoto(b.photo, blob);
    }
    return blob || null;
  }

  async photoURL(b) {
    if (!b || !b.photo) return null;
    const key = b.photo instanceof Blob ? 'blob:' + b.id : b.photo;
    if (this.urls.has(key)) return this.urls.get(key);
    try {
      const blob = await this.photoBlob(b);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      this.urls.set(key, url);
      return url;
    } catch { return null; }
  }

  // ---------- Fiches préparées ----------
  async listImports() {
    let list = [];
    if (this.remote) {
      const f = await this.gh.getFile('import/fiches.json').catch(() => null);
      if (f) { try { list = JSON.parse(f.text); } catch { list = []; } }
    } else if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      // Mode local (serveur sur le PC) : dossier import/ de l'application
      try { const r = await fetch('import/fiches.json', { cache: 'no-store' }); if (r.ok) list = await r.json(); } catch { /* aucun */ }
    }
    const done = new Set(this.importedIds);
    return (Array.isArray(list) ? list : []).filter(e => e && e.importId && e.fiche && !done.has(e.importId));
  }

  async importPhoto(name) {
    if (!name) return null;
    if (this.remote) return this.gh.getBlob('import/' + name);
    const r = await fetch('import/' + encodeURIComponent(name), { cache: 'no-store' });
    return r.ok ? r.blob() : null;
  }

  // ---------- Configuration GitHub ----------
  async setConfig({ owner, repo, token }) {
    const cfg = { owner: (owner || '').trim(), repo: (repo || '').trim(), token: (token || '').trim() };
    if (cfg.token) {
      const info = await new GitHub(cfg).repoInfo().catch(e => { throw new Error(friendly(e)); });
      if (info.permissions && !info.permissions.push) throw new Error('Ce jeton ne peut que lire le dépôt : donnez-lui « Contents : Read and write ».');
    }
    const changed = cfg.token !== this.cfg.token || cfg.owner !== this.cfg.owner || cfg.repo !== this.cfg.repo;
    this.cfg = cfg;
    await db.setSetting('github', cfg);
    if (!changed) return;
    this.sha = null; // fusion complète au premier échange avec ce dépôt
    await db.setSetting('remoteSha', null);
    if (this.remote) await this.pull();
    else this._status('local', 'Données enregistrées sur cet appareil uniquement');
  }

  // ---------- Sauvegarde fichier ----------
  async exportBackup() {
    const bottles = [];
    for (const b of this.bottles) {
      const blob = await this.photoBlob(b).catch(() => null);
      bottles.push({ ...b, photo: blob ? await blobToDataURL(blob) : null });
    }
    return { app: 'ma-cave', version: 2, exportedAt: now(), layout: this.layout, importedIds: this.importedIds, bottles };
  }

  async importBackup(data) {
    if (!data || data.app !== 'ma-cave' || !Array.isArray(data.bottles)) throw new Error('Fichier de sauvegarde invalide.');
    const keep = new Set(data.bottles.map(b => b.id));
    const at = now();
    const bottles = [];
    for (const b of data.bottles) {
      const photo = typeof b.photo === 'string' && b.photo.startsWith('data:') ? await (await fetch(b.photo)).blob() : null;
      bottles.push({ ...b, photo, updatedAt: at });
    }
    await this._apply({
      layout: data.layout || this.layout, layoutUpdatedAt: at,
      importedIds: [...new Set([...(data.importedIds || []), ...this.importedIds])],
      tombstones: [...this.tombstones, ...this.bottles.filter(b => !keep.has(b.id)).map(b => ({ id: b.id, at }))],
      bottles,
    });
    await this._changed();
  }
}

export const store = new Store();
