import { db, requestPersistence } from './db.js';
import { store, DEFAULT_REPO } from './store.js';
import { Cellar3D } from './cellar3d.js';
import { researchBottle, estimateMarketValue, prepareImage, MODEL } from './ai.js';
import {
  TYPES, TYPE_LABEL, TYPE_COLOR, DEFAULT_LAYOUT, uid, esc, eur,
  bottleTitle, vintageLabel, bottleValue, drinkStatus, slotLabel,
} from './model.js';

const $ = sel => document.querySelector(sel);
const state = { apiKey: '', selectedId: null, placement: null };
// Les données viennent du magasin (copie locale + dépôt GitHub)
Object.defineProperty(state, 'bottles', { get: () => store.bottles });
Object.defineProperty(state, 'layout', { get: () => store.layout });
let cellar;

// ================= Démarrage =================
async function init() {
  requestPersistence();
  state.apiKey = (await db.getSetting('apiKey')) || '';
  store.onStatus(renderSync);
  await store.init(structuredClone(DEFAULT_LAYOUT));
  let lastLayout = JSON.stringify(store.layout);
  store.onData(() => {
    // Changements reçus de l'autre appareil
    if (state.placement) return;
    const lay = JSON.stringify(store.layout);
    if (lay !== lastLayout) { lastLayout = lay; cellar.build(store.layout, store.bottles); renderNav(); }
    else refreshScene();
    if (state.selectedId && !store.bottles.some(b => b.id === state.selectedId)) closeSheet();
    checkImports();
  });

  cellar = new Cellar3D($('#scene'), {
    onBottleClick: id => openSheet(id),
    onSlotClick: slot => handleSlot(slot),
    onEmptyClick: () => { if (!state.placement) closeSheet(); },
  });
  await document.fonts.ready.catch(() => {});
  cellar.build(state.layout, state.bottles);
  renderNav();
  renderHeader();
  bindTopbar();
  setTimeout(() => $('#loading').classList.add('done'), 250);
  await checkImports();
  if (!inCellar().length && !state.imports.length) showWelcome();
  let lastSync = Date.now();
  const resync = () => {
    if (Date.now() - lastSync < 15000) return;
    lastSync = Date.now();
    store.sync().then(checkImports);
  };
  window.addEventListener('focus', resync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  window.addEventListener('online', () => { lastSync = 0; resync(); });
}

function renderSync(status, msg) {
  const el = $('#sync');
  if (!el) return;
  const icon = { local: '⌂', sync: '⟳', ok: '☁', error: '⚠' }[status] || '';
  el.textContent = icon;
  el.title = msg;
  el.className = 'sync sync-' + status;
  if (status === 'error') toast(msg, true, 7000);
}

// ================= Fiches préparées (dossier import/ du dépôt de données) =================
state.imports = [];

async function checkImports() {
  state.imports = await store.listImports().catch(() => []);
  const b = $('#btn-import');
  const n = state.imports.length;
  b.classList.toggle('hidden', !n);
  b.textContent = `📥 ${n} fiche${n > 1 ? 's' : ''} à ajouter`;
}

async function markImported(id) {
  await store.markImported(id);
  await checkImports();
}

function openImports() {
  if (state.imports.length === 1) return openImportEntry(state.imports[0]);
  const m = modal({
    title: 'Fiches à ajouter',
    body: `<div class="list">${state.imports.map(e => `
      <div class="list-item" data-id="${esc(e.importId)}"><span class="dot" style="background:${TYPE_COLOR[e.fiche.type] || '#777'}"></span>
        <div class="grow"><div>${esc(bottleTitle(e.fiche))} ${esc(e.fiche.millesime || '')}</div><small>${esc(e.fiche.appellation || '')}${e.fiche.quantite > 1 ? ` · ${e.fiche.quantite} bouteilles` : ''}</small></div>
        <button class="btn small ghost" data-skip="${esc(e.importId)}">Ignorer</button></div>`).join('')}</div>`,
  });
  m.el.addEventListener('click', async ev => {
    const skip = ev.target.closest('[data-skip]');
    if (skip) {
      ev.stopPropagation();
      await markImported(skip.dataset.skip);
      m.close(); if (state.imports.length) openImports();
      return;
    }
    const it = ev.target.closest('.list-item'); if (!it) return;
    const e = state.imports.find(x => x.importId === it.dataset.id);
    m.close(); if (e) openImportEntry(e);
  });
}

async function openImportEntry(e) {
  let photo = null;
  if (e.photo) {
    try {
      const blob = await store.importPhoto(e.photo);
      if (blob) photo = (await prepareImage(blob)).photo;
    } catch { toast('Photo introuvable dans le dossier import.', true); }
  }
  openForm({ mode: 'add', photo, prefill: e.fiche, importId: e.importId });
}

const inCellar = () => state.bottles.filter(b => b.status !== 'bue');

function renderHeader() {
  const list = inCellar();
  const total = list.reduce((s, b) => s + bottleValue(b), 0);
  $('#brand-sub').textContent = `${list.length} bouteille${list.length > 1 ? 's' : ''} · ${eur(total)}`;
}

function renderNav() {
  const nav = $('#racks-nav');
  nav.innerHTML = `<button class="chip" data-view="all">Vue d'ensemble</button>` +
    state.layout.racks.map(r => `<button class="chip" data-rack="${esc(r.id)}">${esc(r.name)}</button>`).join('');
  nav.onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.dataset.view) cellar.resetView(); else cellar.focusRack(b.dataset.rack);
  };
}

function bindTopbar() {
  $('#btn-add').onclick = () => openAddFlow();
  $('#btn-dashboard').onclick = () => openDashboard();
  $('#btn-import').onclick = () => openImports();
  $('#btn-settings').onclick = () => openSettings();
  $('#placement-cancel').onclick = () => endPlacement(true);
  const input = $('#search'), results = $('#search-results');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.classList.add('hidden'); cellar.setHighlight(null); return; }
    const words = q.split(/\s+/);
    const found = inCellar().filter(b => {
      const hay = [b.producteur, b.cuvee, b.appellation, b.region, b.pays, b.millesime, b.cepages, TYPE_LABEL[b.type]].join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    });
    cellar.setHighlight(found.map(b => b.id));
    results.innerHTML = found.length ? found.slice(0, 30).map(b => `
      <div class="search-item" data-id="${b.id}"><span class="dot" style="background:${TYPE_COLOR[b.type] || '#777'}"></span>
      <div>${esc(bottleTitle(b))} ${esc(b.millesime || '')}<small>${esc(slotLabel(state.layout, b))}</small></div></div>`).join('')
      : `<div class="empty" style="padding:10px">Aucune bouteille trouvée</div>`;
    results.classList.remove('hidden');
  });
  results.onclick = e => {
    const it = e.target.closest('.search-item'); if (!it) return;
    results.classList.add('hidden');
    openSheet(it.dataset.id, true);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); input.blur(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.target.matches('input, textarea, select')) return;
    if ($('#modal-root').children.length) return;
    if (state.placement) endPlacement(true); else closeSheet();
  });
}

function showWelcome() {
  const w = document.createElement('div');
  w.className = 'welcome';
  w.innerHTML = `<h3>Bienvenue dans votre cave</h3>
    <p>Photographiez une bouteille : l'IA l'identifie, puis vous choisissez sa place dans les casiers.
    ${state.apiKey ? '' : "Commencez par renseigner votre clé API Anthropic dans les Réglages."}</p>
    <button class="btn gold">＋ Ajouter ma première bouteille</button>`;
  w.querySelector('button').onclick = () => { w.remove(); openAddFlow(); };
  document.body.appendChild(w);
  $('#btn-add').addEventListener('click', () => w.remove(), { once: true });
}

// ================= Utilitaires UI =================
function toast(msg, error = false, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (error ? ' error' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function modal({ title, body, foot = '', wide = false, onClose }) {
  const root = $('#modal-root');
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${title}</h2><button class="btn icon ghost" data-close aria-label="Fermer">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { el.remove(); onClose && onClose(); };
  el.addEventListener('mousedown', e => { if (e.target === el) close(); });
  el.querySelector('[data-close]').onclick = close;
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  root.appendChild(el);
  return { el, close, q: s => el.querySelector(s) };
}

// Affiche une photo (locale ou stockée sur GitHub) dans un <img> dès qu'elle est disponible.
async function fillPhoto(img, b, fallbackHTML) {
  const url = await store.photoURL(b);
  if (!img.isConnected) return;
  if (url) img.src = url;
  else if (fallbackHTML) img.outerHTML = fallbackHTML;
}

const saveBottle = b => store.saveBottle(b);

function refreshScene() {
  cellar.setBottles(state.bottles);
  cellar.select(state.selectedId);
  renderHeader();
}

const occupiedSet = (exceptId = null) => new Set(inCellar().filter(b => b.id !== exceptId).map(b => `${b.rackId}:${b.row}:${b.col}`));

// ================= Fiche bouteille =================
function openSheet(id, focus = false) {
  const b = state.bottles.find(x => x.id === id);
  if (!b) return;
  state.selectedId = id;
  cellar.select(id);
  if (focus) cellar.focusBottle(id);
  const sheet = $('#sheet');
  sheet.innerHTML = renderSheet(b);
  const heroImg = sheet.querySelector('.sheet-hero img');
  if (heroImg) fillPhoto(heroImg, b, '<div class="placeholder">❦</div>');
  sheet.classList.remove('hidden');
  sheet.scrollTop = 0;
  sheet.querySelector('.sheet-close').onclick = closeSheet;
  sheet.querySelector('[data-act=edit]').onclick = () => openForm({ bottle: b, mode: 'edit' });
  sheet.querySelector('[data-act=move]').onclick = () => moveBottle(b);
  sheet.querySelector('[data-act=focus]').onclick = () => cellar.focusBottle(b.id);
  sheet.querySelector('[data-act=value]').onclick = e => refreshValue(b, e.currentTarget);
  sheet.querySelector('[data-act=drunk]').onclick = () => markDrunk(b);
  sheet.querySelector('[data-act=delete]').onclick = () => deleteBottle(b);
}

function closeSheet() {
  state.selectedId = null;
  cellar && cellar.select(null);
  $('#sheet').classList.add('hidden');
}

function renderSheet(b) {
  const status = drinkStatus(b);
  const img = !!b.photo;
  const gain = Number(b.prixAchat) > 0 && Number(b.valeurEstimee) > 0 ? (b.valeurEstimee - b.prixAchat) / b.prixAchat : null;
  const p = (label, v) => v ? `<dt>${label}</dt><dd>${esc(v)}</dd>` : '';
  const text = (title, v, icon = '') => v ? `<div class="section"><h3>${icon} ${title}</h3><p>${esc(v)}</p></div>` : '';
  return `
  <button class="btn icon sheet-close" aria-label="Fermer">✕</button>
  <div class="sheet-hero">${img ? `<img alt="">` : '<div class="placeholder">❦</div>'}</div>
  <div class="sheet-body">
    <div class="eyebrow">${esc(TYPE_LABEL[b.type] || 'Bouteille')}${b.status === 'bue' ? ' · dégustée' : ''}</div>
    <h2>${esc(bottleTitle(b))}</h2>
    <div class="subtitle">${esc([b.appellation, vintageLabel(b)].filter(Boolean).join(' · '))}</div>
    <div class="badges">
      ${b.region ? `<span class="badge">${esc(b.region)}</span>` : ''}
      ${b.classement ? `<span class="badge">${esc(b.classement)}</span>` : ''}
      <span class="badge status-${status.key}">${esc(status.label)}</span>
    </div>

    <div class="section"><h3>Caractéristiques</h3><dl class="kv">
      ${p('Domaine / Maison', b.producteur)}${p('Cuvée', b.cuvee)}${p('Appellation', b.appellation)}
      ${p('Millésime', b.millesime)}${p('Région', [b.region, b.pays].filter(Boolean).join(', '))}
      ${p('Cépages', b.cepages)}${p('Volume', b.volumeCl ? b.volumeCl + ' cl' : '')}${p('Degré', b.degre ? b.degre + ' % vol.' : '')}
      ${p('Service', b.servir)}${p('Emplacement', b.status === 'bue' ? 'Dégustée le ' + new Date(b.consumedAt).toLocaleDateString('fr-FR') : slotLabel(state.layout, b))}
    </dl></div>

    ${text('Histoire', b.histoire)}
    ${text('Œnologie', b.oenologie)}
    ${text('Dégustation', b.degustation)}
    ${b.accords && b.accords.length ? `<div class="section"><h3>Accords mets & vins</h3><div class="pairings">${b.accords.map(a => `<span>${esc(a)}</span>`).join('')}</div></div>` : ''}

    <div class="section"><h3>Garde</h3>
      ${renderTimeline(b)}
      ${b.garde ? `<p style="margin-top:8px">${esc(b.garde)}</p>` : ''}
      ${b.apogee ? `<p class="hint" style="margin-top:4px">Apogée : ${esc(b.apogee)}</p>` : ''}
    </div>

    <div class="section"><h3>Valeur</h3>
      <div class="value-grid">
        <div><small>Achat</small><strong>${eur(b.prixAchat)}</strong></div>
        <div><small>Estimée</small><strong>${eur(b.valeurEstimee)}</strong></div>
        <div><small>Évolution</small><strong class="${gain == null ? '' : gain >= 0 ? 'up' : 'down'}">${gain == null ? '—' : (gain >= 0 ? '+' : '') + (gain * 100).toFixed(0) + ' %'}</strong></div>
      </div>
      ${renderSpark(b)}
      ${b.valeurCommentaire ? `<p class="hint" style="margin-top:8px">${esc(b.valeurCommentaire)}</p>` : ''}
      ${b.valeurSources && b.valeurSources.length ? `<div class="sources">Sources : ${b.valeurSources.slice(0, 4).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.titre || s.url)}</a>`).join(' · ')}</div>` : ''}
      ${b.dateAchat ? `<p class="hint" style="margin-top:6px">Achetée le ${new Date(b.dateAchat).toLocaleDateString('fr-FR')}</p>` : ''}
    </div>

    ${text('Notes personnelles', b.notesPerso)}

    <div class="sheet-actions">
      <button class="btn" data-act="edit">Modifier</button>
      ${b.status !== 'bue' ? '<button class="btn" data-act="move">Déplacer</button><button class="btn ghost" data-act="focus">Voir dans la cave</button>' : '<span data-act="move"></span><span data-act="focus"></span>'}
      <button class="btn" data-act="value">↻ Actualiser la valeur</button>
      ${b.status !== 'bue' ? '<button class="btn" data-act="drunk">🍷 Dégustée</button>' : '<span data-act="drunk"></span>'}
      <button class="btn danger" data-act="delete">Supprimer</button>
    </div>
  </div>`;
}

function renderTimeline(b) {
  const from = Number(b.boireDe), until = Number(b.boireJusqua);
  if (!from && !until) return '<p class="hint">Période de dégustation non renseignée.</p>';
  const now = new Date().getFullYear();
  const lo = Math.min(from || until, now) - 2, hi = Math.max(until || from, now) + 2;
  const pct = y => ((y - lo) / (hi - lo)) * 100;
  const a = pct(from || lo), z = pct(until || hi);
  return `<div class="timeline"><div class="track"></div><div class="window" style="left:${a}%;width:${Math.max(z - a, 1)}%"></div>
    <div class="now" data-y="${now}" style="left:${pct(now)}%"></div></div>
    <div class="timeline-labels"><span>${lo}</span><span>${from ? 'de ' + from : ''} ${until ? 'à ' + until : ''}</span><span>${hi}</span></div>`;
}

function renderSpark(b) {
  const pts = [];
  if (Number(b.prixAchat) > 0) pts.push({ t: new Date(b.dateAchat || b.createdAt).getTime(), v: Number(b.prixAchat) });
  for (const h of b.valeurHistorique || []) pts.push({ t: new Date(h.date).getTime(), v: Number(h.valeur) });
  if (pts.length < 2) return '';
  pts.sort((x, y) => x.t - y.t);
  const W = 380, H = 70, pad = 6;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const vs = pts.map(p => p.v), vmin = Math.min(...vs), vmax = Math.max(...vs);
  const x = t => pad + ((t - t0) / Math.max(t1 - t0, 1)) * (W - pad * 2);
  const y = v => H - pad - ((v - vmin) / Math.max(vmax - vmin, 1)) * (H - pad * 2);
  const line = pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Évolution de la valeur">
    <polyline points="${pad},${H - pad} ${line} ${W - pad},${H - pad}" fill="rgba(214,178,110,.12)" stroke="none"/>
    <polyline points="${line}" fill="none" stroke="#d6b26e" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${pts.map(p => `<circle cx="${x(p.t)}" cy="${y(p.v)}" r="3" fill="#d6b26e"><title>${new Date(p.t).toLocaleDateString('fr-FR')} : ${eur(p.v)}</title></circle>`).join('')}
  </svg>`;
}

async function refreshValue(b, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle;width:14px;height:14px"></span> Recherche des prix…';
  try {
    const r = await estimateMarketValue(state.apiKey, b);
    const nb = { ...b, valeurEstimee: Math.round(Number(r.valeur) * 100) / 100, valeurCommentaire: r.commentaire || '', valeurSources: r.sources || [],
      valeurHistorique: [...(b.valeurHistorique || []), { date: new Date().toISOString(), valeur: Number(r.valeur), min: r.min, max: r.max, source: 'IA + recherche web' }] };
    await saveBottle(nb);
    renderHeader();
    if (state.selectedId === b.id) openSheet(b.id);
    toast(`Valeur actualisée : ${eur(nb.valeurEstimee)}`);
  } catch (e) {
    toast(e.message, true, 6000);
    btn.disabled = false; btn.textContent = '↻ Actualiser la valeur';
  }
}

async function markDrunk(b) {
  if (!confirm(`Marquer « ${bottleTitle(b)} » comme dégustée ? Elle quittera la cave mais restera dans votre historique.`)) return;
  await saveBottle({ ...b, status: 'bue', consumedAt: new Date().toISOString(), rackId: null });
  closeSheet(); refreshScene();
  toast('Santé ! Bouteille ajoutée à l’historique des dégustations.');
}

async function deleteBottle(b) {
  if (!confirm(`Supprimer définitivement « ${bottleTitle(b)} » et sa photo ? Cette action est irréversible.`)) return;
  await store.deleteBottle(b.id);
  closeSheet(); refreshScene();
  toast('Bouteille supprimée.');
}

// ================= Placement dans la cave 3D =================
function startPlacement({ count = 1, exceptId = null, label, onPlace }) {
  closeSheet();
  state.placement = { remaining: count, total: count, exceptId, label, onPlace };
  cellar.setPlacementMode(true, occupiedSet(exceptId));
  updatePlacementBanner();
  $('#placement-banner').classList.remove('hidden');
  if (!occupiedSet(exceptId).size) cellar.resetView();
}

function updatePlacementBanner() {
  const p = state.placement;
  const n = p.total > 1 ? ` (${p.total - p.remaining + 1}/${p.total})` : '';
  $('#placement-text').textContent = `${p.label}${n} : cliquez sur un emplacement libre`;
}

async function handleSlot(slot) {
  const p = state.placement; if (!p) return;
  await p.onPlace(slot);
  p.remaining--;
  refreshScene();
  if (p.remaining <= 0) endPlacement(false);
  else { cellar.setPlacementMode(true, occupiedSet(p.exceptId)); updatePlacementBanner(); }
}

function endPlacement(cancelled) {
  const p = state.placement; if (!p) return;
  state.placement = null;
  cellar.setPlacementMode(false);
  $('#placement-banner').classList.add('hidden');
  if (cancelled && p.total > 1 && p.remaining < p.total) toast(`${p.total - p.remaining} bouteille(s) placée(s).`);
  else if (cancelled) toast('Placement annulé.');
  if (p.lastId && !cancelled) openSheet(p.lastId);
}

function moveBottle(b) {
  startPlacement({
    label: `Déplacer « ${bottleTitle(b)} »`, exceptId: b.id,
    onPlace: async slot => {
      const cur = state.bottles.find(x => x.id === b.id);
      await saveBottle({ ...cur, ...slot });
      state.placement.lastId = b.id;
    },
  });
}

// ================= Ajout d'une bouteille =================
function openAddFlow() {
  const m = modal({
    title: 'Ajouter une bouteille',
    body: `
      <label class="dropzone" id="dz">
        <input type="file" accept="image/*" capture="environment" hidden id="file">
        <div class="big">📷 Photographier ou importer l'étiquette</div>
        <p>Glissez une photo ici, ou cliquez pour ouvrir l'appareil photo / vos fichiers.</p>
        <p class="hint" style="margin-top:10px">${state.apiKey ? `L'IA (${MODEL}) identifie la bouteille, fait ses recherches sur le web et remplit toute la fiche.` : '⚠ Ajoutez votre clé API dans les Réglages pour activer la recherche automatique.'}</p>
      </label>
      <form id="byname" style="margin-top:18px">
        <label class="field"><span>… ou tapez simplement le nom du vin</span>
          <div style="display:flex;gap:8px"><input name="q" placeholder="ex. Château Talbot 2015, Krug Grande Cuvée…" autocomplete="off">
          <button class="btn gold" type="submit">🔍 Rechercher</button></div></label>
      </form>
      <div style="text-align:center;margin-top:16px"><button class="btn ghost small" id="manual">Saisir entièrement à la main</button></div>`,
  });
  m.q('#byname').onsubmit = e => {
    e.preventDefault();
    const q = e.target.elements.q.value.trim();
    if (!q) return toast('Tapez le nom du vin.', true);
    m.close();
    openForm({ mode: 'add', hint: q });
  };
  const dz = m.q('#dz'), file = m.q('#file');
  const go = async f => {
    if (!f) return;
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) return toast('Ce fichier n’est pas une image.', true);
    let img;
    try { img = await prepareImage(f); }
    catch { return toast("Impossible de lire cette image (format HEIC ? exportez-la en JPEG).", true, 6000); }
    m.close();
    openForm({ mode: 'add', photo: img.photo, aiBase64: img.base64 });
  };
  file.onchange = () => go(file.files[0]);
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); go(e.dataTransfer.files[0]); });
  m.q('#manual').onclick = () => { m.close(); openForm({ mode: 'add' }); };
}

const FIELDS = [
  ['§', 'Identité'],
  ['type', 'Catégorie', 'select'],
  ['producteur', 'Domaine / Château / Maison'],
  ['cuvee', 'Cuvée'],
  ['appellation', 'Appellation'],
  ['classement', 'Classement'],
  ['millesime', 'Millésime', 'number'],
  ['region', 'Région'],
  ['pays', 'Pays'],
  ['cepages', 'Cépages', 'text', true],
  ['volumeCl', 'Volume (cl)', 'number'],
  ['degre', 'Degré (% vol.)', 'number'],
  ['§', 'Dégustation & garde'],
  ['boireDe', 'À boire à partir de', 'number'],
  ['boireJusqua', "À boire jusqu'en", 'number'],
  ['apogee', 'Apogée'],
  ['servir', 'Service (température, carafe)'],
  ['garde', 'Potentiel de garde', 'text', true],
  ['degustation', 'Notes de dégustation', 'textarea', true],
  ['accords', 'Accords mets & vins (un par ligne)', 'textarea', true],
  ['histoire', 'Histoire', 'textarea', true],
  ['oenologie', 'Œnologie (terroir, vinification, élevage)', 'textarea', true],
  ['§', 'Achat & valeur'],
  ['prixAchat', "Prix d'achat unitaire (€)", 'number'],
  ['dateAchat', "Date d'achat", 'date'],
  ['valeurEstimee', 'Valeur estimée actuelle (€)', 'number'],
  ['quantite', 'Nombre de bouteilles identiques', 'number'],
  ['notesPerso', 'Notes personnelles', 'textarea', true],
];
const NUMERIC = new Set(['millesime', 'volumeCl', 'degre', 'boireDe', 'boireJusqua', 'prixAchat', 'valeurEstimee', 'quantite']);

function fieldHTML([key, label, kind = 'text', full], v, mode) {
  if (key === '§') return `<div class="form-section">${label}</div>`;
  if (key === 'quantite' && mode !== 'add') return '';
  const val = Array.isArray(v) ? v.join('\n') : (v ?? '');
  let input;
  if (kind === 'select') input = `<select name="${key}">${TYPES.map(t => `<option value="${t}" ${t === val ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select>`;
  else if (kind === 'textarea') input = `<textarea name="${key}">${esc(val)}</textarea>`;
  else input = `<input name="${key}" type="${kind}" ${kind === 'number' ? 'step="any" min="0"' : ''} value="${esc(val)}">`;
  return `<label class="field ${full ? 'full' : ''}"><span>${label}</span>${input}</label>`;
}

function openForm({ mode, bottle = null, photo = null, aiBase64 = null, hint = '', prefill = null, importId = null }) {
  const data = bottle ? { ...bottle } : { type: 'rouge', volumeCl: 75, quantite: 1, dateAchat: new Date().toISOString().slice(0, 10), ...(prefill || {}) };
  // currentPhoto : Blob (nouvelle photo), chemin GitHub (photo existante) ou null
  let currentPhoto = bottle ? bottle.photo : photo;
  const previewURL = currentPhoto instanceof Blob ? URL.createObjectURL(currentPhoto) : null;
  const hasPhoto = !!currentPhoto;

  const m = modal({
    title: mode === 'add' ? 'Fiche de la bouteille' : 'Modifier la bouteille',
    wide: false,
    body: `
      <div class="photo-row">
        <div class="photo-preview" id="pv">${hasPhoto ? `<img ${previewURL ? `src="${previewURL}"` : ''} alt="">` : '<div style="padding:40px 0;text-align:center;color:var(--faint)">Pas de photo</div>'}</div>
        <div style="flex:1;min-width:0">
          <div id="ai-box"></div>
          <p class="hint">L'IA identifie la bouteille, cherche elle-même les informations sur le web et remplit la fiche. Vérifiez, puis choisissez l'emplacement dans la cave.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
            <button type="button" class="btn small gold" id="auto">🔍 Rechercher et tout remplir</button>
            <label class="btn small ghost">${currentPhoto ? 'Changer la photo' : 'Ajouter une photo'}<input type="file" accept="image/*" hidden id="newphoto"></label>
          </div>
        </div>
      </div>
      <form id="bf" class="form-grid" style="margin-top:16px" autocomplete="off">
        ${FIELDS.map(f => fieldHTML(f, data[f[0]], mode)).join('')}
      </form>`,
    foot: `<button class="btn ghost" data-cancel>Annuler</button>
      <button class="btn gold" data-save>${mode === 'add' ? 'Choisir l’emplacement →' : 'Enregistrer'}</button>`,
    onClose: () => previewURL && URL.revokeObjectURL(previewURL),
  });
  const form = m.q('#bf');
  m.q('[data-cancel]').onclick = m.close;
  if (hasPhoto && !previewURL && bottle) fillPhoto(m.q('#pv img'), bottle);

  m.q('#newphoto').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const img = await prepareImage(f);
      currentPhoto = img.photo;
      m.q('#pv').innerHTML = `<img src="${URL.createObjectURL(img.photo)}" alt="">`;
      runAI(img.base64, hintFromForm());
    } catch { toast("Impossible de lire cette image.", true); }
  };

  const setField = (k, v) => {
    const el = form.elements[k]; if (!el) return;
    if (v == null || v === '' || v === 0) return;
    el.value = Array.isArray(v) ? v.join('\n') : v;
  };

  let aiExtra = {};
  let lastBase64 = aiBase64;
  let running = false;
  const hintFromForm = () => ['producteur', 'cuvee', 'appellation', 'millesime', 'region']
    .map(k => form.elements[k] && form.elements[k].value.trim()).filter(Boolean).join(', ');

  async function runAI(base64 = lastBase64, hint = '') {
    lastBase64 = base64;
    const box = m.q('#ai-box');
    if (!state.apiKey) {
      box.innerHTML = `<div class="ai-status error"><div>Aucune clé API Anthropic n'est enregistrée : la recherche automatique ne peut pas fonctionner.
        <div style="margin-top:8px"><button class="btn small gold" id="go-settings">Ajouter ma clé API</button></div></div></div>`;
      box.querySelector('#go-settings').onclick = () => {
        openSettings(() => { if (state.apiKey) runAI(base64, hint); });
      };
      return;
    }
    if (!base64 && !hint) return toast('Ajoutez une photo ou tapez au moins le nom du vin.', true);
    if (running) return;
    running = true;
    const started = Date.now();
    const steps = [];
    const draw = () => {
      box.innerHTML = `<div class="ai-status"><span class="spinner"></span><div style="min-width:0">
        <b>Le sommelier IA identifie la bouteille et fait ses recherches…</b>
        <div class="hint">${esc(steps[steps.length - 1] || (base64 ? 'Lecture de l’étiquette…' : 'Démarrage des recherches…'))}</div>
        <div class="hint">${Math.round((Date.now() - started) / 1000)} s · en général 1 à 2 minutes</div></div></div>`;
    };
    draw();
    const timer = setInterval(draw, 1000);
    try {
      const r = await researchBottle(state.apiKey, { base64, hint, onStep: s => { steps.push(s); draw(); } });
      if (!r.identifie) {
        box.innerHTML = `<div class="ai-status error">Bouteille non reconnue. ${esc(r.remarques || 'Essayez une photo plus nette de l’étiquette, ou tapez le nom du vin puis relancez.')}</div>`;
        return;
      }
      for (const k of Object.keys(r)) setField(k, r[k]);
      aiExtra = {
        aiConfiance: r.confiance, aiRemarques: r.remarques,
        valeurSources: r.sources || [], valeurCommentaire: r.valeurCommentaire || '',
      };
      const n = (r.sources || []).length;
      box.innerHTML = `<div class="ai-status ok">✓ <b>${esc([r.producteur, r.cuvee].filter(Boolean).join(' — '))} ${r.millesime || ''}</b>
        <span class="badge" style="margin-left:auto">confiance ${esc(r.confiance || '—')}</span></div>
        <p class="hint" style="margin:-6px 0 8px">Fiche remplie automatiquement${n ? ` à partir de ${n} source${n > 1 ? 's' : ''} web` : ''}. ${esc(r.remarques || '')}</p>`;
    } catch (e) {
      box.innerHTML = `<div class="ai-status error">${esc(e.message)}</div>`;
    } finally {
      clearInterval(timer);
      running = false;
    }
  }
  m.q('#auto').onclick = () => runAI(lastBase64, hintFromForm());
  if (aiBase64 || hint) runAI(aiBase64, hint);
  if (importId) {
    m.q('#ai-box').innerHTML = `<div class="ai-status ok">✓ Fiche préparée à partir de la fiche technique : vérifiez puis choisissez l'emplacement.</div>`;
    m.q('#auto').classList.add('hidden');
    aiExtra = { valeurSources: prefill.valeurSources || [], valeurCommentaire: prefill.valeurCommentaire || '' };
  }

  m.q('[data-save]').onclick = async () => {
    const fd = new FormData(form);
    const v = {};
    for (const [k, val] of fd.entries()) {
      if (NUMERIC.has(k)) v[k] = val === '' ? null : Number(String(val).replace(',', '.'));
      else if (k === 'accords') v[k] = String(val).split('\n').map(s => s.trim()).filter(Boolean);
      else v[k] = String(val).trim();
    }
    if (!v.producteur && !v.cuvee && !v.appellation) return toast('Indiquez au moins le domaine, la cuvée ou l’appellation.', true);

    if (mode === 'edit') {
      const nb = { ...bottle, ...v, photo: currentPhoto };
      if (v.valeurEstimee && v.valeurEstimee !== bottle.valeurEstimee) {
        nb.valeurHistorique = [...(bottle.valeurHistorique || []), { date: new Date().toISOString(), valeur: v.valeurEstimee, source: 'manuel' }];
      }
      await saveBottle(nb);
      m.close(); refreshScene(); openSheet(nb.id);
      toast('Fiche enregistrée.');
      return;
    }

    const qty = Math.max(1, Math.min(200, Math.round(v.quantite || 1)));
    delete v.quantite;
    const now = new Date().toISOString();
    const template = {
      ...v, ...aiExtra, photo: currentPhoto, status: 'cave',
      valeurHistorique: v.valeurEstimee ? [{ date: now, valeur: v.valeurEstimee, source: aiExtra.valeurSources && aiExtra.valeurSources.length ? 'IA + recherche web' : aiExtra.aiConfiance ? 'estimation IA initiale' : 'manuel' }] : [],
    };
    m.close();
    let importMarked = false;
    startPlacement({
      count: qty, label: `Placer « ${bottleTitle(template)} »`,
      onPlace: async slot => {
        const nb = { ...template, id: uid(), createdAt: new Date().toISOString(), ...slot };
        await saveBottle(nb);
        state.placement.lastId = nb.id;
        if (importId && !importMarked) { importMarked = true; await markImported(importId); }
      },
    });
  };
}

// ================= Tableau de bord =================
function groupBy(list, keyFn, valFn = () => 1) {
  const m = new Map();
  for (const b of list) { const k = keyFn(b) || 'Non renseigné'; m.set(k, (m.get(k) || 0) + valFn(b)); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function barsHTML(entries, fmt = n => n, color) {
  if (!entries.length) return '<div class="empty">Aucune donnée</div>';
  const max = Math.max(...entries.map(e => e[1]));
  return `<div class="bars">${entries.map(([k, n]) => `<div class="bar-row"><span class="name" title="${esc(k)}">${esc(k)}</span>
    <span class="track"><span class="fill" style="width:${(n / max) * 100}%;${color ? `background:${color(k)}` : ''}"></span></span><span class="num">${fmt(n)}</span></div>`).join('')}</div>`;
}

function bottleListItem(b, extra = '') {
  return `<div class="list-item" data-id="${b.id}"><span class="dot" style="background:${TYPE_COLOR[b.type] || '#777'}"></span>
    <div class="grow"><div>${esc(bottleTitle(b))} ${esc(b.millesime || '')}</div><small>${esc(extra || b.appellation || '')}</small></div></div>`;
}

function openDashboard() {
  const list = inCellar();
  const value = list.reduce((s, b) => s + bottleValue(b), 0);
  const cost = list.reduce((s, b) => s + (Number(b.prixAchat) || 0), 0);
  const valued = list.filter(b => Number(b.valeurEstimee) > 0 && Number(b.prixAchat) > 0);
  const vGain = valued.reduce((s, b) => s + (b.valeurEstimee - b.prixAchat), 0);
  const vCost = valued.reduce((s, b) => s + Number(b.prixAchat), 0);
  const capacity = state.layout.racks.reduce((s, r) => s + r.rows * r.cols, 0);
  const year = new Date().getFullYear();
  const ready = list.filter(b => ['pret', 'urgent'].includes(drinkStatus(b, year).key));
  const urgent = list.filter(b => ['urgent', 'passe'].includes(drinkStatus(b, year).key))
    .sort((a, b) => (a.boireJusqua || 9999) - (b.boireJusqua || 9999));
  const top = [...list].sort((a, b) => bottleValue(b) - bottleValue(a)).slice(0, 8);
  const drunk = state.bottles.filter(b => b.status === 'bue').sort((a, b) => (b.consumedAt || '').localeCompare(a.consumedAt || '')).slice(0, 8);

  const vintages = groupBy(list.filter(b => b.millesime), b => String(b.millesime)).sort((a, b) => a[0].localeCompare(b[0]));
  const vmax = Math.max(1, ...vintages.map(v => v[1]));

  const m = modal({
    title: 'Tableau de bord',
    wide: true,
    body: `
    <div class="kpis">
      <div class="kpi"><small>Bouteilles</small><div class="v">${list.length}</div><div class="s">${capacity ? Math.round((list.length / capacity) * 100) : 0} % de ${capacity} places</div></div>
      <div class="kpi"><small>Valeur estimée</small><div class="v">${eur(value)}</div><div class="s">moyenne ${eur(list.length ? value / list.length : 0)} / btl</div></div>
      <div class="kpi"><small>Prix d'achat total</small><div class="v">${eur(cost)}</div><div class="s">${list.filter(b => b.prixAchat).length} bouteilles renseignées</div></div>
      <div class="kpi"><small>Plus-value</small><div class="v ${vGain >= 0 ? 'up' : 'down'}">${valued.length ? (vGain >= 0 ? '+' : '') + eur(vGain) : '—'}</div><div class="s">${valued.length && vCost ? (vGain >= 0 ? '+' : '') + ((vGain / vCost) * 100).toFixed(1) + ' % sur ' + valued.length + ' btl' : 'achat + estimation requis'}</div></div>
      <div class="kpi"><small>Prêtes à boire</small><div class="v">${ready.length}</div><div class="s">${urgent.length} à boire rapidement</div></div>
    </div>
    <div class="dash-grid">
      <div class="card"><h3>Par catégorie</h3>${barsHTML(groupBy(list, b => TYPE_LABEL[b.type]), n => n, k => TYPE_COLOR[TYPES.find(t => TYPE_LABEL[t] === k)] || 'var(--gold)')}</div>
      <div class="card"><h3>Par région</h3>${barsHTML(groupBy(list, b => b.region).slice(0, 10))}</div>
      <div class="card"><h3>Par appellation</h3>${barsHTML(groupBy(list, b => b.appellation).slice(0, 10))}</div>
      <div class="card"><h3>Valeur par région</h3>${barsHTML(groupBy(list, b => b.region, bottleValue).slice(0, 10), eur)}</div>
      <div class="card" style="grid-column:1/-1"><h3>Par millésime</h3>
        ${vintages.length ? `<div class="vintages">${vintages.map(([y, n]) => `<div class="vintage" title="${y} : ${n} btl"><b>${n}</b><div class="col" style="height:${(n / vmax) * 100}%"></div><small>${y}</small></div>`).join('')}</div>` : '<div class="empty">Aucun millésime renseigné</div>'}
      </div>
      <div class="card"><h3>À boire en priorité</h3><div class="list">${urgent.length ? urgent.slice(0, 8).map(b => bottleListItem(b, drinkStatus(b).label)).join('') : '<div class="empty">Rien d’urgent : votre cave est sereine.</div>'}</div></div>
      <div class="card"><h3>Les plus précieuses</h3><div class="list">${top.length ? top.map(b => bottleListItem(b, eur(bottleValue(b)))).join('') : '<div class="empty">Aucune bouteille</div>'}</div></div>
      <div class="card"><h3>Par meuble</h3>${barsHTML(state.layout.racks.map(r => [r.name, list.filter(b => b.rackId === r.id).length]), n => n)}</div>
      <div class="card"><h3>Dernières dégustations</h3><div class="list">${drunk.length ? drunk.map(b => bottleListItem(b, 'le ' + new Date(b.consumedAt).toLocaleDateString('fr-FR'))).join('') : '<div class="empty">Aucune dégustation enregistrée</div>'}</div></div>
    </div>`,
  });
  m.el.addEventListener('click', e => {
    const it = e.target.closest('.list-item'); if (!it) return;
    const b = state.bottles.find(x => x.id === it.dataset.id);
    m.close(); openSheet(it.dataset.id, b && b.status !== 'bue');
  });
}

// ================= Réglages =================
function openSettings(onSaved) {
  const racks = structuredClone(state.layout.racks);
  const rowHTML = (r, i) => `<tr data-i="${i}">
    <td><input data-k="name" value="${esc(r.name)}"></td>
    <td><select data-k="kind"><option value="casier" ${r.kind === 'casier' ? 'selected' : ''}>Casier (bouteilles couchées)</option><option value="etagere" ${r.kind === 'etagere' ? 'selected' : ''}>Étagère (debout)</option></select></td>
    <td><input data-k="rows" type="number" min="1" max="30" value="${r.rows}"></td>
    <td><input data-k="cols" type="number" min="1" max="30" value="${r.cols}"></td>
    <td><button class="btn icon ghost" data-del="${i}" title="Supprimer ce meuble">✕</button></td></tr>`;

  const m = modal({
    title: 'Réglages',
    body: `
      <div class="settings-block"><h3>Synchronisation GitHub</h3>
        <p class="hint" style="margin-top:0">Votre cave est enregistrée dans un dépôt GitHub privé : elle est identique sur l'ordinateur et le téléphone. Saisissez le jeton une fois sur chaque appareil.</p>
        <div class="form-grid">
          <label class="field"><span>Compte GitHub</span><input id="gh-owner" value="${esc(store.cfg.owner || DEFAULT_REPO.owner)}" autocomplete="off"></label>
          <label class="field"><span>Dépôt de données (privé)</span><input id="gh-repo" value="${esc(store.cfg.repo || DEFAULT_REPO.repo)}" autocomplete="off"></label>
          <label class="field full"><span>Jeton d'accès (github_pat_…)</span><input id="gh-token" type="password" placeholder="Collez ici votre jeton GitHub" value="${esc(store.cfg.token)}" autocomplete="off"></label>
        </div>
        <p class="hint" id="gh-status">${esc(store.statusMsg)}</p>
      </div>
      <div class="settings-block"><h3>Intelligence artificielle (facultatif)</h3>
        <label class="field"><span>Clé API Anthropic</span><input id="apikey" type="password" placeholder="sk-ant-…" value="${esc(state.apiKey)}" autocomplete="off"></label>
        <p class="hint">Facultatif : reconnaissance des étiquettes et estimation des prix par ${MODEL}. La clé reste sur cet appareil.</p>
      </div>
      <div class="settings-block"><h3>Agencement de ma cave</h3>
        <p class="hint" style="margin-top:0">Reproduisez vos meubles réels : nombre de rangées (hauteur) et de positions par rangée (largeur). Les meubles sont disposés le long des murs, dans l'ordre de la liste.</p>
        <table class="racks-table"><thead><tr><th>Nom</th><th>Type</th><th>Rangées</th><th>Positions</th><th></th></tr></thead><tbody id="racks"></tbody></table>
        <button class="btn small" id="addrack" style="margin-top:8px">＋ Ajouter un meuble</button>
      </div>
      <div class="settings-block"><h3>Sauvegarde</h3>
        <p class="hint" style="margin-top:0">Avec la synchronisation GitHub, chaque modification est déjà sauvegardée (avec historique). Vous pouvez aussi exporter un fichier complet, photos comprises.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="export">Exporter la cave (.json)</button>
        <label class="btn">Restaurer une sauvegarde<input type="file" accept="application/json,.json" hidden id="import"></label></div>
      </div>`,
    foot: `<button class="btn ghost" data-cancel>Annuler</button><button class="btn gold" data-save>Enregistrer</button>`,
  });
  const tbody = m.q('#racks');
  const draw = () => { tbody.innerHTML = racks.map(rowHTML).join(''); };
  draw();
  tbody.addEventListener('input', e => {
    const tr = e.target.closest('tr'); const k = e.target.dataset.k; if (!tr || !k) return;
    racks[tr.dataset.i][k] = ['rows', 'cols'].includes(k) ? Math.max(1, Math.min(30, parseInt(e.target.value) || 1)) : e.target.value;
  });
  tbody.addEventListener('click', e => {
    const d = e.target.closest('[data-del]'); if (!d) return;
    const r = racks[d.dataset.del];
    const n = inCellar().filter(b => b.rackId === r.id).length;
    if (n) return toast(`Ce meuble contient ${n} bouteille(s) : déplacez-les d'abord.`, true);
    racks.splice(d.dataset.del, 1); draw();
  });
  m.q('#addrack').onclick = () => { racks.push({ id: 'R' + Date.now().toString(36), name: `Meuble ${racks.length + 1}`, kind: 'casier', rows: 8, cols: 6 }); draw(); };
  m.q('[data-cancel]').onclick = m.close;

  m.q('#export').onclick = async () => {
    const data = await store.exportBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ma-cave-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  m.q('#import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('Restaurer cette sauvegarde remplacera toute la cave actuelle. Continuer ?')) return;
    try {
      await store.importBackup(JSON.parse(await f.text()));
      m.close(); closeSheet(); cellar.build(state.layout, state.bottles); renderNav(); renderHeader();
      toast('Sauvegarde restaurée.');
    } catch (err) { toast(err.message || 'Restauration impossible.', true); }
  };

  m.q('[data-save]').onclick = async () => {
    if (!racks.length) return toast('La cave doit contenir au moins un meuble.', true);
    const orphans = inCellar().filter(b => {
      const r = racks.find(x => x.id === b.rackId);
      return !r || b.row >= r.rows || b.col >= r.cols;
    });
    if (orphans.length) return toast(`${orphans.length} bouteille(s) seraient hors des meubles redimensionnés : déplacez-les d'abord.`, true, 6000);
    const saveBtn = m.q('[data-save]');
    saveBtn.disabled = true; saveBtn.textContent = 'Connexion…';
    try {
      await store.setConfig({ owner: m.q('#gh-owner').value, repo: m.q('#gh-repo').value, token: m.q('#gh-token').value });
    } catch (err) {
      saveBtn.disabled = false; saveBtn.textContent = 'Enregistrer';
      m.q('#gh-status').textContent = err.message;
      return toast(err.message, true, 7000);
    }
    state.apiKey = m.q('#apikey').value.trim();
    await db.setSetting('apiKey', state.apiKey);
    if (JSON.stringify(racks) !== JSON.stringify(store.layout.racks)) await store.setLayout({ racks });
    m.close();
    if (typeof onSaved === 'function') { toast('Clé enregistrée.'); onSaved(); return; }
    closeSheet();
    cellar.build(state.layout, state.bottles); renderNav();
    toast('Réglages enregistrés.');
  };
}

init().catch(err => {
  console.error(err);
  $('#loading').innerHTML = `<div class="loading-mark">❦</div><div>Impossible d'ouvrir la cave : ${esc(err.message)}</div>`;
});
