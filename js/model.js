// Constantes et fonctions utilitaires partagées.
export const TYPES = ['rouge', 'blanc', 'rosé', 'champagne', 'effervescent', 'liquoreux', 'spiritueux', 'autre'];
export const TYPE_LABEL = {
  rouge: 'Vin rouge', blanc: 'Vin blanc', 'rosé': 'Vin rosé', champagne: 'Champagne',
  effervescent: 'Effervescent', liquoreux: 'Liquoreux / moelleux', spiritueux: 'Spiritueux', autre: 'Autre',
};
export const TYPE_COLOR = {
  rouge: '#8e1b2c', blanc: '#d8c27a', 'rosé': '#e59aa0', champagne: '#c9a24a',
  effervescent: '#b9b38c', liquoreux: '#c48a1c', spiritueux: '#9a5a26', autre: '#777',
};

export const DEFAULT_LAYOUT = {
  racks: [
    { id: 'A', name: 'Casier A — Bordeaux', kind: 'casier', rows: 10, cols: 8 },
    { id: 'B', name: 'Casier B — Bourgogne & Rhône', kind: 'casier', rows: 10, cols: 8 },
    { id: 'C', name: 'Casier C — Champagnes', kind: 'casier', rows: 6, cols: 6 },
    { id: 'D', name: 'Étagère D — Spiritueux', kind: 'etagere', rows: 3, cols: 6 },
  ],
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const eur = n => (n == null || n === '' || isNaN(n)) ? '—'
  : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n);

export function bottleTitle(b) {
  const main = [b.producteur, b.cuvee].filter(Boolean).join(' — ') || b.appellation || 'Bouteille sans nom';
  return main;
}
export function vintageLabel(b) {
  return b.millesime ? String(b.millesime) : (b.type === 'spiritueux' ? '' : 'Non millésimé');
}

export function bottleValue(b) {
  const v = Number(b.valeurEstimee);
  if (v > 0) return v;
  const p = Number(b.prixAchat);
  return p > 0 ? p : 0;
}

export function drinkStatus(b, year = new Date().getFullYear()) {
  const from = Number(b.boireDe) || 0, until = Number(b.boireJusqua) || 0;
  if (!from && !until) return { key: 'inconnu', label: 'Garde non renseignée' };
  if (until && year > until) return { key: 'passe', label: 'Apogée probablement dépassée' };
  if (from && year < from) return { key: 'attendre', label: `À attendre (dès ${from})` };
  if (until && year >= until - 1) return { key: 'urgent', label: `À boire rapidement (avant ${until})` };
  return { key: 'pret', label: 'Prêt à boire' };
}

export function bottleShape(b) {
  if (b.type === 'champagne' || b.type === 'effervescent') return 'champagne';
  if (b.type === 'spiritueux') return 'spirit';
  const r = (b.region || '').toLowerCase();
  if (/bourgogne|burgundy|rh[oô]ne|loire|beaujolais|jura|savoie|languedoc|provence/.test(r)) return 'bourgogne';
  if (/alsace|mosel|allemagne|germany/.test(r)) return 'flute';
  return 'bordeaux';
}

export function slotLabel(layout, b) {
  const rack = layout.racks.find(r => r.id === b.rackId);
  if (!rack) return 'Hors casier';
  return `${rack.name} · rangée ${b.row + 1}, position ${b.col + 1}`;
}
