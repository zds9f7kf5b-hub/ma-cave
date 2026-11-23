// Intelligence artificielle : reconnaissance d'étiquette (vision) et estimation de valeur (recherche web).
// Utilise le SDK officiel Anthropic, chargé à la demande depuis un CDN.
const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@0.136.0';
export const MODEL = 'claude-opus-5-5';

let clientPromise = null;
let clientKey = null;

async function getClient(apiKey) {
  if (!apiKey) throw new Error('Clé API Anthropic manquante : ajoutez-la dans les Réglages (⚙).');
  if (!clientPromise || clientKey !== apiKey) {
    clientKey = apiKey;
    clientPromise = import(SDK_URL).then(m => new m.default({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 }));
  }
  return clientPromise;
}

// Paramètres communs : bascule automatique côté serveur si le modèle refuse une requête.
const BASE = { model: MODEL, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

// Appel avec repli serveur ; si l'API refuse ces options (400), on réessaie avec un appel standard.
async function create(client, params) {
  try {
    return await client.beta.messages.create({ ...BASE, ...params });
  } catch (e) {
    if (e && e.status === 400) {
      console.warn('[Ma Cave] Appel avec repli refusé, nouvel essai standard :', e.message);
      return await client.messages.create({ model: MODEL, ...params });
    }
    throw e;
  }
}

function friendlyError(err) {
  console.error('[Ma Cave] Erreur IA :', err);
  const s = err && err.status;
  if (s === 401) return new Error('Clé API invalide. Vérifiez-la dans les Réglages.');
  if (s === 403) return new Error("Accès refusé par l'API (droits du compte ou de la clé).");
  if (s === 429) return new Error("Limite d'utilisation de l'API atteinte, réessayez dans un instant.");
  if (s === 529 || s >= 500) return new Error("Le service d'IA est momentanément surchargé, réessayez.");
  if (s === 400) return new Error('Requête refusée : ' + (err.error?.error?.message || err.message));
  return err instanceof Error ? err : new Error(String(err));
}

function textOf(res) {
  if (res.stop_reason === 'refusal') throw new Error("L'IA n'a pas pu traiter cette demande.");
  if (res.stop_reason === 'max_tokens') throw new Error("Réponse de l'IA incomplète, réessayez.");
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

const str = d => ({ type: 'string', description: d });
const int = d => ({ type: 'integer', description: d });
const num = d => ({ type: 'number', description: d });

const IDENTIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    identifie: { type: 'boolean', description: "true si la photo montre bien une bouteille identifiable" },
    confiance: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
    type: { type: 'string', enum: ['rouge', 'blanc', 'rosé', 'champagne', 'effervescent', 'liquoreux', 'spiritueux', 'autre'] },
    producteur: str('Domaine, château ou maison'),
    cuvee: str('Nom de la cuvée (vide si aucune)'),
    appellation: str('Appellation (AOC/AOP/IGP…) ou dénomination du spiritueux'),
    millesime: int('Millésime, 0 si non millésimé ou illisible'),
    region: str('Région viticole (ex. Bordeaux, Bourgogne, Champagne, Cognac…)'),
    pays: str('Pays'),
    cepages: str('Cépages et proportions si connus'),
    volumeCl: num('Volume en centilitres (75 par défaut)'),
    degre: num("Degré d'alcool en % vol., 0 si inconnu"),
    classement: str('Classement éventuel (Grand Cru Classé, Premier Cru…)'),
    histoire: str('Histoire du domaine/de la maison et de la cuvée, 4 à 6 phrases'),
    oenologie: str('Terroir, vinification, élevage : 3 à 5 phrases'),
    degustation: str('Notes de dégustation attendues : robe, nez, bouche'),
    accords: { type: 'array', items: { type: 'string' }, description: '4 à 6 accords mets-vins précis' },
    servir: str('Température de service et carafage conseillés'),
    garde: str('Potentiel de garde, en une phrase'),
    boireDe: int('Année de début de la période optimale de dégustation'),
    boireJusqua: int('Année de fin de la période optimale de dégustation'),
    apogee: str('Période d\'apogée, ex. "2028-2035"'),
    valeurEstimee: num('Valeur de marché estimée actuelle en euros pour cette bouteille, 0 si impossible'),
    remarques: str("Ce qui est incertain ou déduit plutôt que lu sur l'étiquette"),
  },
};
IDENTIFY_SCHEMA.required = Object.keys(IDENTIFY_SCHEMA.properties);

const IDENTIFY_SYSTEM = `Tu es un sommelier et expert en vins et spiritueux de haut niveau, qui aide un collectionneur à tenir l'inventaire de sa cave.
On te montre la photo d'une bouteille (étiquette, contre-étiquette ou bouteille entière).
Lis attentivement l'étiquette et identifie précisément la bouteille. Complète avec tes connaissances les informations absentes de l'étiquette
(cépages, histoire, garde…) seulement quand elles sont fiables pour ce domaine et cette cuvée ; sinon laisse le champ vide (ou 0 pour les nombres)
et signale-le dans "remarques". Ne confonds pas le second vin et le grand vin d'un château. Rédige en français, avec un style élégant et précis.
Nous sommes en ${new Date().getFullYear()} : calcule la période de dégustation en conséquence.`;

/** Identifie une bouteille à partir d'une photo (base64 JPEG). */
export async function identifyBottle(apiKey, base64, mediaType = 'image/jpeg') {
  const client = await getClient(apiKey);
  try {
    const res = await create(client, {
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: IDENTIFY_SCHEMA } },
      system: IDENTIFY_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Identifie cette bouteille et remplis sa fiche complète.' },
        ],
      }],
    });
    return JSON.parse(textOf(res));
  } catch (e) { throw friendlyError(e); }
}

// ---- Recherche complète et autonome : photo et/ou nom → identification + recherche web + fiche remplie ----
const FIELD_GUIDE = Object.entries(IDENTIFY_SCHEMA.properties)
  .map(([k, v]) => `- "${k}" (${v.type === 'array' ? 'liste de textes' : v.type === 'string' ? (v.enum ? 'un parmi : ' + v.enum.join(', ') : 'texte') : v.type === 'boolean' ? 'booléen' : 'nombre'}) : ${v.description || ''}`)
  .join('\n');

const RESEARCH_SYSTEM = `${IDENTIFY_SYSTEM}

Tu disposes d'un outil de recherche web : utilise-le systématiquement, sans rien demander à l'utilisateur, pour :
1. confirmer l'identité exacte de la bouteille (domaine, cuvée, millésime) ;
2. trouver la fiche technique officielle (site du domaine, cavistes, guides) : cépages et proportions, degré, terroir, élevage ;
3. trouver les notes de dégustation, le potentiel de garde et la période d'apogée de ce millésime ;
4. trouver le prix de marché actuel en euros (cavistes en ligne, Wine-Searcher, iDealwine, résultats d'enchères).
Fais plusieurs recherches si nécessaire. Remplis TOUS les champs possibles ; ne laisse vide que ce qui est réellement introuvable.

Termine ta réponse par un unique bloc \`\`\`json contenant un objet avec exactement ces clés :
${FIELD_GUIDE}
- "valeurCommentaire" (texte) : 1 à 2 phrases sur le marché et la fourchette de prix observée
- "sources" (liste d'objets {"titre": texte, "url": texte}) : les pages les plus utiles consultées`;

function extractJSON(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.map(m => m[1]).reverse();
  const a = text.indexOf('{'), z = text.lastIndexOf('}');
  if (a >= 0 && z > a) candidates.push(text.slice(a, z + 1));
  for (const c of candidates) { try { return JSON.parse(c); } catch { /* suivant */ } }
  throw new Error("La réponse de l'IA n'a pas pu être lue, réessayez.");
}

function normalize(r) {
  const out = { ...r };
  for (const k of ['millesime', 'boireDe', 'boireJusqua']) out[k] = parseInt(out[k]) || 0;
  for (const k of ['volumeCl', 'degre', 'valeurEstimee']) out[k] = Number(String(out[k] ?? '').replace(',', '.')) || 0;
  if (!Array.isArray(out.accords)) out.accords = out.accords ? String(out.accords).split(/\n|;/).map(s => s.trim()).filter(Boolean) : [];
  if (!Array.isArray(out.sources)) out.sources = [];
  out.identifie = out.identifie !== false;
  return out;
}

/**
 * Recherche autonome : à partir d'une photo (base64) et/ou d'un texte indicatif, l'IA identifie la bouteille,
 * effectue elle-même ses recherches sur le web et renvoie la fiche complète.
 * onStep(message) est appelé à chaque recherche web pour afficher la progression.
 */
export async function researchBottle(apiKey, { base64 = null, hint = '', onStep = () => {} } = {}) {
  const client = await getClient(apiKey);
  const content = [];
  if (base64) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } });
  content.push({
    type: 'text',
    text: (base64 ? 'Voici la photo de la bouteille. ' : '') +
      (hint ? `Indications connues : ${hint}. ` : '') +
      'Identifie-la, fais toutes les recherches nécessaires et remplis sa fiche complète.',
  });

  const params = {
    max_tokens: 32000,
    output_config: { effort: 'medium' },
    system: RESEARCH_SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
  };
  const run = async (messages, withFallback) => {
    const stream = withFallback
      ? client.beta.messages.stream({ ...BASE, ...params, messages })
      : client.messages.stream({ model: MODEL, ...params, messages });
    stream.on('contentBlock', block => {
      if (block.type === 'server_tool_use' && block.input && block.input.query) onStep(`Recherche : « ${block.input.query} »`);
      if (block.type === 'web_search_tool_result') onStep('Analyse des résultats…');
    });
    return stream.finalMessage();
  };

  try {
    let messages = [{ role: 'user', content }];
    let withFallback = true;
    let res;
    for (let i = 0; i < 5; i++) {
      try {
        res = await run(messages, withFallback);
      } catch (e) {
        if (e && e.status === 400 && withFallback) { withFallback = false; res = await run(messages, false); }
        else throw e;
      }
      if (res.stop_reason !== 'pause_turn') break;
      messages = [messages[0], { role: 'assistant', content: res.content }];
    }
    onStep('Rédaction de la fiche…');
    return normalize(extractJSON(textOf(res)));
  } catch (e) {
    // Si la recherche web est indisponible, on se rabat sur l'identification par la photo seule.
    if (base64 && e && e.status === 400) {
      console.warn('[Ma Cave] Recherche web indisponible, identification par la photo seule :', e.message);
      onStep('Recherche web indisponible : identification par la photo…');
      return normalize(await identifyBottle(apiKey, base64));
    }
    throw friendlyError(e);
  }
}

/** Estime la valeur de marché actuelle d'une bouteille grâce à la recherche web. */
export async function estimateMarketValue(apiKey, b) {
  const client = await getClient(apiKey);
  const desc = [
    b.producteur, b.cuvee, b.appellation, b.classement,
    b.millesime ? `millésime ${b.millesime}` : 'non millésimé',
    `${b.volumeCl || 75} cl`, b.region, b.pays,
  ].filter(Boolean).join(', ');
  const prompt = `Recherche la valeur de marché actuelle, en euros, de cette bouteille : ${desc}.
Consulte des sources de prix récentes (cavistes en ligne, cotes, résultats d'enchères, comparateurs comme Wine-Searcher, iDealwine…).
Ne retiens que ce vin exact (même cuvée, même millésime, même format). Donne un prix unitaire réaliste pour un particulier.
Termine ta réponse par un unique objet JSON, sans texte après, de la forme :
{"valeur": nombre, "min": nombre, "max": nombre, "commentaire": "1 à 2 phrases sur la tendance du marché", "sources": [{"titre": "…", "url": "…"}]}`;

  try {
    let messages = [{ role: 'user', content: prompt }];
    let res;
    for (let i = 0; i < 4; i++) {
      res = await create(client, {
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
        messages,
      });
      if (res.stop_reason !== 'pause_turn') break;
      messages = [messages[0], { role: 'assistant', content: res.content }];
    }
    const text = textOf(res);
    const start = text.lastIndexOf('{"valeur"') >= 0 ? text.lastIndexOf('{"valeur"') : text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error("L'IA n'a pas trouvé de prix fiable pour cette bouteille.");
    const data = JSON.parse(text.slice(start, end + 1));
    if (!(Number(data.valeur) > 0)) throw new Error("Aucun prix de marché fiable trouvé pour cette bouteille.");
    return data;
  } catch (e) { throw friendlyError(e); }
}

// ---- Préparation des images ----
export async function prepareImage(file) {
  const bmp = await createImageBitmap(file);
  const toJpeg = async max => {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.86));
  };
  const forAI = await toJpeg(1568);
  const forStore = await toJpeg(1000);
  const base64 = await new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.readAsDataURL(forAI);
  });
  return { base64, photo: forStore };
}
