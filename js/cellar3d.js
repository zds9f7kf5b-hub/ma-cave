// Scène 3D de la cave : pièce voûtée en pierre, casiers en bois, bouteilles interactives.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bottleShape } from './model.js';

const CELL = 0.125;        // taille d'une alvéole de casier (m)
const SHELF_W = 0.14;      // largeur d'une place sur étagère
const SHELF_H = 0.38;      // hauteur d'un niveau d'étagère
const DEPTH = 0.38;        // profondeur des meubles
const FRAME = 0.028;       // épaisseur des montants
const PLINTH = 0.09;       // socle
const BOARD = 0.012;       // épaisseur des planches intérieures

// ---------- Textures procédurales ----------
function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function stoneTexture({ base = [96, 86, 74], mortar = '#26201b', rows = 9, seed = 7, size = 1024 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const r = rand(seed);
  g.fillStyle = mortar; g.fillRect(0, 0, size, size);
  const rh = size / rows;
  for (let y = 0; y < rows; y++) {
    let x = -r() * 120;
    while (x < size) {
      const w = 90 + r() * 170;
      const v = (r() - 0.5) * 46;
      g.fillStyle = `rgb(${base[0] + v | 0},${base[1] + v * 0.9 | 0},${base[2] + v * 0.8 | 0})`;
      const pad = 5 + r() * 3;
      g.beginPath();
      g.roundRect(x + pad, y * rh + pad, w - pad * 2, rh - pad * 2, 10 + r() * 10);
      g.fill();
      x += w;
    }
  }
  // Grain
  const img = g.getImageData(0, 0, size, size); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function woodTexture({ base = [92, 58, 34], seed = 3 } = {}) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
  const g = c.getContext('2d'); const r = rand(seed);
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 90; i++) {
    const x = r() * 256, v = (r() - 0.5) * 50;
    g.strokeStyle = `rgba(${base[0] + v | 0},${base[1] + v * 0.8 | 0},${base[2] + v * 0.6 | 0},0.55)`;
    g.lineWidth = 1 + r() * 3;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 32) g.lineTo(x + Math.sin(y / 90 + i) * 6 * r(), y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plaqueTexture(text) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, '#d9b46a'); grad.addColorStop(0.5, '#a9823c'); grad.addColorStop(1, '#7a5a26');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 160);
  g.strokeStyle = 'rgba(40,25,5,.6)'; g.lineWidth = 6; g.strokeRect(10, 10, 1004, 140);
  g.fillStyle = '#2b1a07';
  g.font = '600 64px "Cormorant Garamond", Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 84, 960);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Bouteilles ----------
const PROFILES = {
  bordeaux: { len: 0.30, r: 0.037, pts: (r, n) => [[0, 0], [r * .9, 0], [r, .006], [r, .2], [r * .93, .214], [n * 1.5, .236], [n, .252], [n, .29], [n * 1.12, .292], [n * 1.12, .30], [0, .30]] },
  bourgogne: { len: 0.30, r: 0.040, pts: (r, n) => [[0, 0], [r * .9, 0], [r, .006], [r, .15], [r * .9, .19], [r * .62, .225], [n * 1.15, .26], [n, .272], [n, .29], [n * 1.12, .292], [n * 1.12, .30], [0, .30]] },
  champagne: { len: 0.30, r: 0.045, pts: (r, n) => [[0, 0], [r * .9, 0], [r, .008], [r, .15], [r * .88, .19], [r * .55, .23], [n * 1.2, .262], [n * 1.1, .285], [n * 1.3, .288], [n * 1.3, .30], [0, .30]] },
  flute: { len: 0.34, r: 0.034, pts: (r, n) => [[0, 0], [r * .9, 0], [r, .006], [r, .17], [r * .8, .22], [n * 1.3, .28], [n, .295], [n, .33], [n * 1.1, .332], [n * 1.1, .34], [0, .34]] },
  spirit: { len: 0.29, r: 0.042, pts: (r, n) => [[0, 0], [r * .95, 0], [r, .006], [r, .2], [r * .96, .212], [n * 1.6, .225], [n * 1.2, .236], [n * 1.2, .27], [n * 1.5, .272], [n * 1.5, .29], [0, .29]] },
};
const NECK_R = 0.0145;

const GLASS = {
  rouge: 0x16240f, blanc: 0x8f9a3a, 'rosé': 0xf0a2a8, champagne: 0x0e1c0e, effervescent: 0x1b2b16,
  liquoreux: 0xc08a1e, spiritueux: 0xa8561c, autre: 0x252a30,
};
const CAPSULE = {
  rouge: 0x6d0f1a, blanc: 0xd6c189, 'rosé': 0xe9b9bd, champagne: 0xc9a24a, effervescent: 0xbfbfbf,
  liquoreux: 0xa67c00, spiritueux: 0x1d1d1d, autre: 0x555555,
};

export class Cellar3D {
  constructor(container, { onBottleClick, onSlotClick, onEmptyClick } = {}) {
    this.container = container;
    this.onBottleClick = onBottleClick;
    this.onSlotClick = onSlotClick;
    this.onEmptyClick = onEmptyClick;
    this.rackGroups = new Map();     // rackId -> { group, rack, dims }
    this.bottleGroups = new Map();   // bottleId -> group
    this.slotMarkers = [];
    this.hoverId = null; this.selectedId = null; this.highlight = null;
    this.camAnim = null;
    this._geoCache = new Map(); this._matCache = new Map();

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0907);
    this.scene.fog = new THREE.Fog(0x0d0907, 7, 16);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.05, 50);
    this._fitFov(container.clientWidth / container.clientHeight);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.35;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.addEventListener('start', () => { this.camAnim = null; });

    this.woodTex = woodTexture();
    this.woodMat = new THREE.MeshStandardMaterial({ map: this.woodTex, roughness: 0.78, metalness: 0 });
    this.woodDarkMat = new THREE.MeshStandardMaterial({ map: this.woodTex, color: 0x8a7060, roughness: 0.85 });

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._bindEvents();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this._tick());
  }

  // ---------- Construction ----------
  rackDims(rack) {
    if (rack.kind === 'etagere') {
      return { W: rack.cols * SHELF_W + FRAME * 2, H: PLINTH + rack.rows * SHELF_H + FRAME, D: DEPTH };
    }
    return { W: rack.cols * CELL + FRAME * 2, H: PLINTH + rack.rows * CELL + FRAME, D: DEPTH };
  }

  slotLocal(rack, dims, row, col) {
    if (rack.kind === 'etagere') {
      return new THREE.Vector3(-dims.W / 2 + FRAME + (col + 0.5) * SHELF_W, PLINTH + (rack.rows - 1 - row) * SHELF_H + BOARD, -dims.D / 2);
    }
    return new THREE.Vector3(-dims.W / 2 + FRAME + (col + 0.5) * CELL, PLINTH + (rack.rows - 1 - row + 0.5) * CELL, -dims.D / 2);
  }

  build(layout, bottles) {
    this.layout = layout;
    if (this.world) { this.scene.remove(this.world); this._dispose(this.world); }
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.rackGroups.clear(); this.bottleGroups.clear(); this.slotMarkers = [];

    const racks = layout.racks;
    const dims = racks.map(r => this.rackDims(r));
    const walls = { back: [], left: [], right: [] };
    const order = ['back', 'left', 'right'];
    racks.forEach((r, i) => walls[order[i % 3]].push(i));
    const GAP = 0.35;
    const runLen = k => walls[k].reduce((s, i) => s + dims[i].W, 0) + GAP * Math.max(0, walls[k].length - 1);
    const roomW = Math.max(4.4, runLen('back') + 1.6);
    const roomD = Math.max(5.2, Math.max(runLen('left'), runLen('right')) + 2.6);
    const maxH = Math.max(...dims.map(d => d.H), 1.5);
    const roomH = Math.max(2.6, maxH + 0.9);
    this.room = { W: roomW, D: roomD, H: roomH };

    this._buildRoom(roomW, roomD, roomH);

    const place = (wall, list) => {
      let cursor = -runLen(wall) / 2;
      for (const i of list) {
        const rack = racks[i], d = dims[i];
        const g = this._buildRack(rack, d);
        const along = cursor + d.W / 2;
        if (wall === 'back') { g.position.set(along, 0, -roomD / 2 + d.D + 0.02); }
        if (wall === 'left') { g.rotation.y = Math.PI / 2; g.position.set(-roomW / 2 + d.D + 0.02, 0, along - 0.4); }
        if (wall === 'right') { g.rotation.y = -Math.PI / 2; g.position.set(roomW / 2 - d.D - 0.02, 0, -(along) - 0.4); }
        this.world.add(g);
        this.rackGroups.set(rack.id, { group: g, rack, dims: d });
        this._addRackLight(g, d);
        cursor += d.W + GAP;
      }
    };
    place('back', walls.back); place('left', walls.left); place('right', walls.right);

    this.setBottles(bottles);
    this.resetView(false);
  }

  _buildRoom(W, D, H) {
    const wallTex = stoneTexture();
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 2.2, roughness: 0.95 });
    const mkWall = (w, h, rep) => {
      const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(w / 2.2, h / 2.2);
      const m = wallMat.clone(); m.map = t; m.bumpMap = t;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      mesh.receiveShadow = true; return mesh;
    };
    const back = mkWall(W, H); back.position.set(0, H / 2, -D / 2); this.world.add(back);
    const front = mkWall(W, H); front.position.set(0, H / 2, D / 2); front.rotation.y = Math.PI; this.world.add(front);
    const left = mkWall(D, H); left.position.set(-W / 2, H / 2, 0); left.rotation.y = Math.PI / 2; this.world.add(left);
    const right = mkWall(D, H); right.position.set(W / 2, H / 2, 0); right.rotation.y = -Math.PI / 2; this.world.add(right);

    const floorTex = stoneTexture({ base: [78, 62, 50], mortar: '#17120e', rows: 6, seed: 19 });
    floorTex.repeat.set(W / 1.6, D / 1.6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 1.5, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.world.add(floor);

    // Voûte en berceau
    const vaultTex = stoneTexture({ base: [104, 88, 70], seed: 31, rows: 14 });
    vaultTex.repeat.set(D / 2, 3);
    const vault = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, D, 32, 1, true, -Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ map: vaultTex, bumpMap: vaultTex, bumpScale: 1.5, roughness: 0.95, side: THREE.BackSide }));
    vault.rotation.x = -Math.PI / 2;
    vault.scale.set(1, 1, 0.35);
    vault.position.set(0, H, 0);
    this.world.add(vault);
    // Tympans (demi-ellipses) au-dessus des murs avant et arrière
    const tymp = new THREE.Shape();
    tymp.absellipse(0, 0, W / 2, (W / 2) * 0.35, 0, Math.PI, false);
    const tympGeo = new THREE.ShapeGeometry(tymp, 24);
    for (const [z, ry] of [[-D / 2, 0], [D / 2, Math.PI]]) {
      const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(1 / 2.2, 1 / 2.2);
      const m = new THREE.Mesh(tympGeo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
      m.position.set(0, H, z); m.rotation.y = ry; this.world.add(m);
    }

    // Lumières d'ambiance : lanterne centrale + chaleur générale
    this.world.add(new THREE.HemisphereLight(0xffd9a8, 0x1a0e06, 0.16));
    const lamp = new THREE.PointLight(0xffa850, 5, 0, 1.7);
    lamp.position.set(0, H - 0.35, 0);
    lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.002;
    this.world.add(lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd09a }));
    bulb.position.copy(lamp.position); this.world.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    cord.position.set(0, H - 0.05 + 0.0, 0); this.world.add(cord);

    // Tonneau décoratif
    const barrel = this._buildBarrel();
    barrel.position.set(W / 2 - 0.55, 0, D / 2 - 0.9);
    this.world.add(barrel);
  }

  _buildBarrel() {
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.27 + Math.sin(t * Math.PI) * 0.06, t * 0.85)); }
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), this.woodMat);
    body.castShadow = true; body.receiveShadow = true; g.add(body);
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.45 });
    for (const y of [0.1, 0.3, 0.55, 0.75]) {
      const t = y / 0.85; const r = 0.27 + Math.sin(t * Math.PI) * 0.06 + 0.004;
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 40), hoopMat);
      hoop.rotation.x = Math.PI / 2; hoop.position.y = y; g.add(hoop);
    }
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.27, 28), this.woodDarkMat);
    top.rotation.x = -Math.PI / 2; top.position.y = 0.85; g.add(top);
    return g;
  }

  _buildRack(rack, d) {
    const g = new THREE.Group(); g.userData.rackId = rack.id;
    const box = (w, h, dd, x, y, z, mat = this.woodMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
    };
    const { W, H, D } = d;
    // Montants extérieurs, dessus, socle, fond
    box(FRAME, H, D, -W / 2 + FRAME / 2, H / 2, -D / 2);
    box(FRAME, H, D, W / 2 - FRAME / 2, H / 2, -D / 2);
    box(W, FRAME, D, 0, H - FRAME / 2, -D / 2);
    box(W, PLINTH, D, 0, PLINTH / 2, -D / 2, this.woodDarkMat);
    box(W, H, 0.01, 0, H / 2, -D + 0.005, this.woodDarkMat);

    if (rack.kind === 'etagere') {
      for (let r = 1; r < rack.rows; r++) box(W - FRAME * 2, BOARD * 1.5, D, 0, PLINTH + r * SHELF_H, -D / 2);
    } else {
      const innerH = rack.rows * CELL, innerW = rack.cols * CELL;
      for (let c = 1; c < rack.cols; c++) box(BOARD, innerH, D * 0.92, -W / 2 + FRAME + c * CELL, PLINTH + innerH / 2, -D / 2);
      for (let r = 1; r < rack.rows; r++) box(innerW, BOARD, D * 0.92, 0, PLINTH + r * CELL, -D / 2);
    }

    // Plaque gravée
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.9, 0.9), Math.min(W * 0.9, 0.9) * 0.156),
      new THREE.MeshStandardMaterial({ map: plaqueTexture(rack.name), metalness: 0.55, roughness: 0.35 }));
    plaque.position.set(0, H + 0.09, -0.04);
    g.add(plaque);
    return g;
  }

  _addRackLight(g, d) {
    const spot = new THREE.SpotLight(0xffc382, 9, 0, Math.PI / 4.6, 0.75, 1.5);
    spot.position.set(0, d.H + 0.55, 0.75);
    spot.target.position.set(0, d.H * 0.5, -d.D / 2);
    g.add(spot); g.add(spot.target);
  }

  _geo(shape) {
    if (!this._geoCache.has(shape)) {
      const p = PROFILES[shape];
      const pts = p.pts(p.r, NECK_R).map(([x, y]) => new THREE.Vector2(x, y));
      const body = new THREE.LatheGeometry(pts, 28);
      const capH = shape === 'champagne' ? 0.085 : 0.06;
      const capR = (shape === 'champagne' ? NECK_R * 1.35 : shape === 'spirit' ? NECK_R * 1.55 : NECK_R * 1.15) + 0.0012;
      const cap = new THREE.CylinderGeometry(capR, capR * 1.05, capH, 20);
      cap.translate(0, p.len - capH / 2 + 0.001, 0);
      const label = new THREE.CylinderGeometry(p.r * 1.006, p.r * 1.006, shape === 'spirit' ? 0.11 : 0.085, 28, 1, true, Math.PI * 0.15, Math.PI * 1.7);
      label.translate(0, shape === 'spirit' ? 0.1 : 0.095, 0);
      this._geoCache.set(shape, { body, cap, label, len: p.len, r: p.r });
    }
    return this._geoCache.get(shape);
  }

  _mat(key, make) {
    if (!this._matCache.has(key)) this._matCache.set(key, make());
    return this._matCache.get(key);
  }

  _makeBottle(b) {
    const shape = bottleShape(b);
    const geo = this._geo(shape);
    const type = b.type in GLASS ? b.type : 'autre';
    const glass = this._mat('glass-' + type, () => new THREE.MeshPhysicalMaterial({
      color: GLASS[type], roughness: 0.12, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08,
      emissive: 0x000000,
    }));
    const cap = this._mat('cap-' + type, () => new THREE.MeshStandardMaterial({ color: CAPSULE[type], metalness: type === 'champagne' ? 0.85 : 0.4, roughness: 0.35 }));
    const label = this._mat('label', () => new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 }));

    const g = new THREE.Group();
    const inner = new THREE.Group();
    for (const [gg, m] of [[geo.body, glass], [geo.cap, cap], [geo.label, label]]) {
      const mesh = new THREE.Mesh(gg, m); mesh.castShadow = true; mesh.userData.bottleId = b.id; inner.add(mesh);
    }
    g.add(inner);
    g.userData = { bottleId: b.id, len: geo.len, offset: 0, target: 0 };
    return g;
  }

  setBottles(bottles) {
    for (const g of this.bottleGroups.values()) g.parent && g.parent.remove(g);
    this.bottleGroups.clear();
    for (const b of bottles) {
      if (b.status === 'bue') continue;
      const entry = this.rackGroups.get(b.rackId);
      if (!entry) continue;
      const { rack, dims, group } = entry;
      if (b.row >= rack.rows || b.col >= rack.cols) continue;
      const g = this._makeBottle(b);
      const p = this.slotLocal(rack, dims, b.row, b.col);
      if (rack.kind === 'etagere') {
        g.position.copy(p);
      } else {
        // Couchée, col vers l'avant, qui dépasse légèrement du casier
        g.children[0].rotation.x = Math.PI / 2;
        g.position.set(p.x, p.y, -g.userData.len + 0.025);
      }
      g.userData.base = g.position.z;
      group.add(g);
      this.bottleGroups.set(b.id, g);
    }
    this._applyHighlight();
  }

  // ---------- Mode placement ----------
  setPlacementMode(enabled, occupied = new Set(), filterRackId = null) {
    for (const m of this.slotMarkers) m.parent && m.parent.remove(m);
    this.slotMarkers = [];
    this.placement = enabled;
    if (!enabled) return;
    const geoC = new THREE.CircleGeometry(CELL * 0.42, 24);
    const mat = this._mat('slot', () => new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.35, depthWrite: false }));
    const matHover = this._mat('slot-hover', () => new THREE.MeshBasicMaterial({ color: 0xffe9b8, transparent: true, opacity: 0.9, depthWrite: false }));
    this._slotMat = mat; this._slotHoverMat = matHover;
    for (const { rack, dims, group } of this.rackGroups.values()) {
      if (filterRackId && rack.id !== filterRackId) continue;
      for (let r = 0; r < rack.rows; r++) for (let c = 0; c < rack.cols; c++) {
        if (occupied.has(`${rack.id}:${r}:${c}`)) continue;
        const p = this.slotLocal(rack, dims, r, c);
        const m = new THREE.Mesh(geoC, mat);
        m.position.set(p.x, rack.kind === 'etagere' ? p.y + 0.12 : p.y, 0.004);
        m.userData.slot = { rackId: rack.id, row: r, col: c };
        group.add(m); this.slotMarkers.push(m);
      }
    }
  }

  // ---------- Caméra ----------
  resetView(animate = true) {
    const { D, W } = this.room;
    const pos = new THREE.Vector3(0, 1.65, D / 2 - 0.7);
    const target = new THREE.Vector3(0, 0.95, -D / 4);
    this._moveCamera(pos, target, animate);
    this.controls.maxDistance = Math.max(W, D) * 1.1;
  }

  focusRack(rackId) {
    const e = this.rackGroups.get(rackId); if (!e) return;
    const { group, dims } = e;
    const center = new THREE.Vector3(0, dims.H / 2, -dims.D / 2).applyMatrix4(group.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
    const dist = Math.max(1.2, Math.max(dims.W * 0.75, dims.H) * 1.45);
    center.y += 0.06;
    const pos = center.clone().addScaledVector(normal, dist); pos.y = Math.min(dims.H / 2 + 0.25, this.room.H - 0.4);
    this._moveCamera(pos, center, true);
  }

  focusBottle(id) {
    const g = this.bottleGroups.get(id); if (!g) return;
    const rackGroup = g.parent;
    const wp = new THREE.Vector3(); g.getWorldPosition(wp);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rackGroup.quaternion);
    const target = wp.clone().addScaledVector(normal, g.userData.len * 0.9);
    const pos = target.clone().addScaledVector(normal, 0.75); pos.y += 0.12;
    this._moveCamera(pos, target, true);
  }

  _moveCamera(pos, target, animate) {
    if (!animate) {
      this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); return;
    }
    this.camAnim = { fromP: this.camera.position.clone(), fromT: this.controls.target.clone(), toP: pos, toT: target, t: 0 };
  }

  // ---------- Sélection / survol ----------
  select(id) { this.selectedId = id; }
  setHighlight(ids) { this.highlight = ids ? new Set(ids) : null; this._applyHighlight(); }
  _applyHighlight() {
    for (const [id, g] of this.bottleGroups) g.visible = !this.highlight || this.highlight.has(id);
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointermove', e => { this._setPointer(e); this._needHover = true; });
    el.addEventListener('pointerleave', () => { this.hoverId = null; this._hoverSlot = null; this._updateCursor(); });
    el.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
      if (moved > 6) return;
      this._setPointer(e);
      const hit = this._pick();
      if (hit && hit.slot) this.onSlotClick && this.onSlotClick(hit.slot);
      else if (hit && hit.bottleId) this.onBottleClick && this.onBottleClick(hit.bottleId);
      else this.onEmptyClick && this.onEmptyClick();
    });
    window.addEventListener('resize', () => this.resize());
  }

  _setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.placement) {
      const hits = this.raycaster.intersectObjects(this.slotMarkers, false);
      if (hits.length) return { slot: hits[0].object.userData.slot, object: hits[0].object };
      return null;
    }
    const targets = [];
    for (const g of this.bottleGroups.values()) if (g.visible) targets.push(g);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length) return { bottleId: hits[0].object.userData.bottleId };
    return null;
  }

  _updateCursor() {
    this.renderer.domElement.style.cursor = (this.hoverId || this._hoverSlot) ? 'pointer' : 'grab';
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this._fitFov(w / h);
    this.renderer.setSize(w, h);
  }

  // Sur écran étroit (téléphone en portrait), on garde un champ horizontal suffisant.
  _fitFov(aspect) {
    const minHFov = THREE.MathUtils.degToRad(72);
    const vFromH = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHFov / 2) / aspect));
    this.camera.fov = Math.min(100, Math.max(55, vFromH));
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
  }

  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this._needHover) {
      this._needHover = false;
      const hit = this._pick();
      this.hoverId = hit && hit.bottleId || null;
      if (this._hoverSlot && this._hoverSlot !== (hit && hit.object)) this._hoverSlot.material = this._slotMat;
      this._hoverSlot = hit && hit.slot ? hit.object : null;
      if (this._hoverSlot) this._hoverSlot.material = this._slotHoverMat;
      this._updateCursor();
    }
    // Tiroir : la bouteille survolée / sélectionnée glisse vers l'avant
    for (const [id, g] of this.bottleGroups) {
      const target = id === this.selectedId ? 0.11 : id === this.hoverId ? 0.04 : 0;
      g.userData.offset += (target - g.userData.offset) * Math.min(1, dt * 10);
      g.position.z = g.userData.base + g.userData.offset;
    }
    if (this.camAnim) {
      const a = this.camAnim; a.t = Math.min(1, a.t + dt / 0.9);
      const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(a.fromP, a.toP, k);
      this.controls.target.lerpVectors(a.fromT, a.toT, k);
      if (a.t >= 1) this.camAnim = null;
    }
    this.controls.update();
    // Garder la caméra dans la pièce
    if (this.room) {
      const p = this.camera.position, m = 0.15;
      p.x = THREE.MathUtils.clamp(p.x, -this.room.W / 2 + m, this.room.W / 2 - m);
      p.z = THREE.MathUtils.clamp(p.z, -this.room.D / 2 + m, this.room.D / 2 - m);
      p.y = THREE.MathUtils.clamp(p.y, 0.25, this.room.H - 0.1);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _dispose(obj) {
    obj.traverse(o => {
      if (o.geometry && ![...this._geoCache.values()].some(c => c.body === o.geometry || c.cap === o.geometry || c.label === o.geometry)) o.geometry.dispose();
    });
  }
}
