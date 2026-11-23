# Ma Cave — double numérique 3D de ma cave à vin

Application personnelle : la cave en 3D (voûte en pierre, casiers, bouteilles cliquables),
ajout de bouteilles par photo avec reconnaissance par IA (Claude), fiche détaillée, valeur de marché
et tableau de bord.

## Lancer l'application

Aucune installation nécessaire (pas de Node ni de Python) :

- double-cliquer sur **`Lancer Ma Cave.cmd`**, ou
- dans PowerShell : `powershell -ExecutionPolicy Bypass -File serve.ps1`

puis ouvrir http://localhost:8080/ (une connexion Internet est nécessaire pour charger Three.js, les polices et le SDK Anthropic).

## Première utilisation

1. **⚙ Réglages** → coller votre clé API Anthropic (créée sur console.anthropic.com).
   Elle reste stockée dans ce navigateur uniquement.
2. **⚙ Réglages → Agencement** : reproduire vos vrais meubles (nom, casier couché / étagère debout,
   nombre de rangées et de positions).
3. **＋ Ajouter** → photographier/importer l'étiquette → l'IA remplit la fiche → vérifier →
   **Choisir l'emplacement** → cliquer sur une alvéole libre dans la cave 3D.

## Fonctionnalités

- Cave 3D navigable (glisser pour tourner, molette/pincer pour zoomer, raccourcis par meuble).
- Reconnaissance d'étiquette : domaine, cuvée, appellation, millésime, région, cépages, degré,
  histoire, œnologie, dégustation, accords mets-vins, période de garde, valeur estimée.
- Fiche bouteille : photo, caractéristiques, frise de garde, prix d'achat, valeur estimée, plus-value,
  courbe d'évolution de la valeur.
- **↻ Actualiser la valeur** : l'IA cherche les prix actuels sur le web (sources affichées) et
  ajoute un point à l'historique.
- Déplacer, modifier, marquer comme dégustée (historique conservé), supprimer.
- Tableau de bord : nombre, valeur totale, plus-value, répartitions par catégorie, région,
  appellation, millésime, meuble ; bouteilles à boire en priorité ; les plus précieuses.
- Recherche instantanée (les bouteilles non concernées sont masquées dans la 3D).
- Sauvegarde / restauration JSON (photos incluses).

## Données

Tout est stocké localement dans le navigateur (IndexedDB, stockage persistant demandé).
Les données sont propres à chaque navigateur : **exportez régulièrement une sauvegarde**
(Réglages → Exporter).

## Structure

| Fichier | Rôle |
|---|---|
| `index.html`, `css/style.css` | Interface |
| `js/main.js` | Logique de l'application (fiche, ajout, placement, tableau de bord, réglages) |
| `js/cellar3d.js` | Scène 3D (Three.js) |
| `js/ai.js` | Appels à Claude (`claude-opus-5-5`) : vision + recherche web |
| `js/db.js` | Stockage IndexedDB, sauvegarde |
| `js/model.js` | Constantes et utilitaires |
| `serve.ps1` | Mini-serveur web local |
