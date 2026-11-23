'use strict';
// Thumb Index — 辞書の小口をパラパラめくる索引。
// 速さ優先: ページ送りで変えるのは見出しの文字列と、事前描画したテクスチャの transform だけ。
(() => {
const D = window.THUMB_INDEX;
const $ = s => document.querySelector(s);
if (!D || !D.titles || !D.titles.length) {
  document.body.insertAdjacentHTML('beforeend',
    '<p class="missing">pages.js がありません — <code>node build-index.mjs</code> を実行してください</p>');
  return;
}

// ---------------------------------------------------------------- data
const titles = D.titles, N = titles.length;
const keys = D.keys || titles.map(t => t.toLowerCase());
const secLabel = D.sections.map(s => s[0]), secStart = D.sections.map(s => s[1]), S = secLabel.length;
const secEnd = k => (k + 1 < S ? secStart[k + 1] : N);
const secOf = new Int16Array(N);
for (let k = 0; k < S; k++) for (let i = secStart[k]; i < secEnd(k); i++) secOf[i] = k;
const URLS = titles.map(t =>
  `https://scrapbox.io/${encodeURIComponent(D.project)}/${encodeURIComponent(t.replace(/ /g, '_'))}`);

// ---------------------------------------------------------------- state
const KEY = 'thumb-index';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { saved = {}; }
const opt = {
  dark: saved.dark ?? true,
  newTab: saved.newTab ?? false,
  accel: saved.accel ?? true,
  invert: saved.invert ?? false,
  step: [2, 4, 6, 10].includes(saved.step) ? saved.step : 4,
};
let cur = -1, curSec = -1, twoNow = -1;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ ...opt, title: titles[cur] })); } catch { /* private mode */ }
}
let saveT = 0;
const scheduleSave = () => { clearTimeout(saveT); saveT = setTimeout(save, 500); };

// ---------------------------------------------------------------- elements
const stage = $('#stage'), deskC = $('#desk'), topC = $('#top'), foreC = $('#fore');
const topFace = $('#top-face'), foreFace = $('#fore-face');
const page = $('#page'), paperC = $('#paper'), bodyWrap = $('#bodywrap'), bodyC = $('#body');
const tab = $('#tab'), tabLabel = $('#tab-label'), head = $('#head'), pno = $('#pno'), word = $('#word');
const rule = $('#rule'), link = $('#link'), grainC = $('#grain');
const menuBtn = $('#menu-btn'), menu = $('#menu'), typedEl = $('#typed');

// ---------------------------------------------------------------- noise
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
// 256x256 の周期ノイズ (紙の地合い用)。画素ごとの参照だけで済むので速い。
const TILE = (() => {
  const T = 256, t = new Float32Array(T * T), R = mulberry32(99);
  for (const [p, w] of [[8, 0.5], [32, 0.3], [128, 0.2]]) {
    const g = new Float32Array(p * p).map(() => R()), c = T / p;
    for (let y = 0; y < T; y++) {
      const fy = y / c, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = y0 * p, r1 = ((y0 + 1) % p) * p;
      for (let x = 0; x < T; x++) {
        const fx = x / c, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % p;
        const a = g[r0 + x0], b = g[r0 + x1], cc = g[r1 + x0], d = g[r1 + x1];
        t[y * T + x] += w * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy);
      }
    }
  }
  return t;
})();
const tile = (x, y) => TILE[(x & 255) | ((y & 255) << 8)];

// ---------------------------------------------------------------- look
const PAL = {
  dark: {
    paper: [236, 227, 207], edge: [205, 194, 170], top: [222, 212, 190], cloth: [92, 24, 30],
    desk: [[30, 19, 12], [72, 46, 28]], ink: [28, 24, 20], grain: 0.10,
  },
  light: {
    paper: [247, 242, 231], edge: [221, 212, 193], top: [234, 227, 211], cloth: [120, 33, 40],
    desk: [[146, 106, 70], [198, 160, 114]], ink: [28, 24, 20], grain: 0.07,
  },
};
const pal = () => (opt.dark ? PAL.dark : PAL.light);
const K = 0.36;   // 斜め上から見下ろす角度: 高さ 1 が画面上で (1, K) ずれる
const V = 8;      // 本文 (ぼかした組版) のバリエーション数
let G = {}, SC = 1, SANS = 'sans-serif';

// 卓上ランプ (ダーク) / 窓明かり (ライト)
function lightAt(x, y) {
  if (opt.dark) {
    const m = Math.max(G.W, G.H), dx = (x - G.W * 0.6) / m, dy = (y + G.H * 0.3) / m;
    return 0.34 + 0.76 * Math.exp(-(dx * dx + dy * dy) * 2.2);
  }
  return 1.0 - 0.06 * (x / G.W) - 0.06 * (y / G.H);
}

// ---------------------------------------------------------------- layout
function computeLayout() {
  const W = innerWidth, H = innerHeight, g = { W, H };
  g.band = clamp(W * 0.15, 40, 280);            // 本 1 冊ぶんの小口の見かけの幅
  g.ppp = g.band / N;                            // 1 ページあたり
  g.shadow = clamp(W * 0.018, 8, 34);
  g.boardEdge = clamp(W * 0.004, 2, 7);          // 表紙の厚み (側面)
  g.board = clamp(W * 0.014, 6, 24);             // 表紙のチリ
  g.boardPx = g.shadow + g.boardEdge + g.board;
  g.shadowT = g.shadow * 0.7;
  g.boardEdgeT = Math.max(1, g.boardEdge * K * 1.6);
  g.boardPxT = g.shadowT + g.boardEdgeT + g.board;
  g.P = Math.round(clamp(W * 0.03, 10, 56) + g.boardEdge + g.board + g.band);     // 開いたページの左端
  g.Q = Math.round(clamp(H * 0.035, 10, 40) + g.boardEdgeT + g.board + g.band * K); // 上端
  g.pageW = W - g.P; g.pageH = H - g.Q;
  g.foreW = g.boardPx + g.band + 2;
  g.foreH = H + g.foreW * K + 4;
  g.topW = W - g.P + g.boardPx + g.band + 4;
  g.topH = g.boardPxT + g.band * K + 2;
  g.tabW = clamp(W * 0.03, 18, 50);
  g.rowsTop = g.Q + clamp(H * 0.02, 6, 24);
  g.rowH = (H - clamp(H * 0.03, 8, 30) - g.rowsTop) / S;
  g.rowY = Array.from({ length: S }, (_, k) => g.rowsTop + k * g.rowH);
  const padR = clamp(W * 0.035, 12, 70);
  g.headL = g.tabW + clamp(W * 0.025, 10, 48);
  g.headTop = clamp(H * 0.02, 6, 26);
  g.headH = clamp(H * 0.24, 70, 280);
  g.headW = g.pageW - g.headL - padR;
  g.pnoFs = clamp(H * 0.026, 11, 22);
  g.pnoW = g.pnoFs * (N >= 1000 ? 2.6 : 2.0);
  g.wordW = g.headW - g.pnoW - g.pnoFs * 0.8;
  g.maxFs = g.headH * 0.8;
  g.ruleY = g.headTop + g.headH + 3;
  g.bodyL = g.headL; g.bodyT = g.ruleY + clamp(H * 0.025, 8, 26);
  g.bodyW = g.headW + padR * 0.5; g.bodyH = Math.max(10, g.pageH - g.bodyT);
  g.bodyFs = clamp(H * 0.03, 10, 26);
  g.X = Math.max(g.P, g.Q / K) + 40;
  return g;
}
function setBox(el, l, t, w, h) {
  el.style.left = l + 'px'; el.style.top = t + 'px';
  if (w != null) el.style.width = w + 'px';
  if (h != null) el.style.height = h + 'px';
}
function applyLayout() {
  const g = G;
  setBox(page, g.P, g.Q);
  setBox(tab, 0, 0, g.tabW, g.rowH);
  tab.style.fontSize = Math.min(g.rowH * 0.62, g.tabW * 0.72) + 'px';
  setBox(head, g.headL, g.headTop, g.headW, g.headH);
  pno.style.fontSize = g.pnoFs + 'px'; pno.style.width = g.pnoW + 'px'; pno.style.marginRight = g.pnoFs * 0.8 + 'px';
  setBox(rule, g.headL, g.ruleY, g.headW);
  setBox(bodyWrap, g.bodyL, g.bodyT, g.bodyW, g.bodyH);
  // 小口 (左面) と天 (上面) の境目は、ページの角 (P,Q) を通る傾き K の直線
  const yFar = g.Q - g.X * K;
  foreFace.style.clipPath = `polygon(${g.P}px ${g.Q}px,${g.P - g.X}px ${yFar}px,${g.P - g.X}px ${g.H + 10}px,${g.P}px ${g.H + 10}px)`;
  topFace.style.clipPath = `polygon(${g.P}px ${g.Q}px,${g.P - g.X}px ${yFar}px,${g.W + 10}px ${yFar}px,${g.W + 10}px ${g.Q}px)`;
  const p = pal().paper, L = lightAt(g.P + g.tabW / 2, g.H * 0.55);
  document.documentElement.style.setProperty('--tablabel', `rgb(${p.map(v => Math.min(255, v * L) | 0).join(',')})`);
}
let FS = new Float32Array(0), TWO = new Uint8Array(0);
function measureTitles() {
  const c = document.createElement('canvas').getContext('2d');
  c.font = `700 100px ${getComputedStyle(word).fontFamily}`;
  FS = new Float32Array(N); TWO = new Uint8Array(N);
  const max1 = G.maxFs, max2 = G.headH * 0.45;
  for (let i = 0; i < N; i++) {
    const fit1 = G.wordW * 100 / (c.measureText(titles[i]).width || 1) * 0.97;
    if (fit1 >= Math.min(max1, max2 * 0.92)) FS[i] = Math.min(max1, fit1);
    else { FS[i] = Math.min(max2, fit1 * 2 * 0.82); TWO[i] = 1; }
  }
}

// ---------------------------------------------------------------- textures
function sizeCanvas(cv, cssW, cssH, s) {
  cv.width = Math.max(1, Math.ceil(cssW * s)); cv.height = Math.max(1, Math.ceil(cssH * s));
  cv.style.width = cv.width / s + 'px'; cv.style.height = cv.height / s + 'px';
  return cv.getContext('2d');
}
const CAN_FILTER = 'filter' in CanvasRenderingContext2D.prototype;
// 被写界深度: y0 (css px) より下を少しずつぼかす
function dof(cv, s, y0, y1, maxR) {
  if (!CAN_FILTER) return;
  const src = document.createElement('canvas');
  src.width = cv.width; src.height = cv.height; src.getContext('2d').drawImage(cv, 0, 0);
  const c = cv.getContext('2d'), w = cv.width, strip = Math.max(6, Math.round(10 * s));
  for (let y = Math.floor(y0 * s); y < cv.height; y += strip) {
    const t = Math.min(1, (y / s - y0) / (y1 - y0)), r = maxR * s * t * t;
    if (r < 0.3) continue;
    const m = Math.ceil(r * 3) + 1, sy = Math.max(0, y - m), sh = Math.min(cv.height, y + strip + m) - sy;
    c.save(); c.beginPath(); c.rect(0, y, w, strip); c.clip(); c.clearRect(0, y, w, strip);
    c.filter = `blur(${r.toFixed(2)}px)`; c.drawImage(src, 0, sy, w, sh, 0, sy, w, sh); c.restore();
  }
}
const put = (d, o, r, g, b, a = 255) => { d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a; };

function renderDesk() {
  const s = 0.4, ctx = sizeCanvas(deskC, G.W, G.H, s), w = deskC.width, h = deskC.height;
  deskC.style.width = deskC.style.height = '100%';
  const img = ctx.createImageData(w, h), d = img.data, [c1, c2] = pal().desk;
  for (let y = 0; y < h; y++) {
    const Y = y / s;
    for (let x = 0; x < w; x++) {
      const X = x / s, n = fbm(X * 0.0025, Y * 0.012, 3);
      const ring = 0.5 + 0.5 * Math.sin(Y * 0.045 + n * 11), fib = vnoise(X * 0.02, Y * 0.5);
      const t = clamp(0.55 * ring * ring + 0.25 * fib + 0.3 * (n - 0.3), 0, 1), L = lightAt(X, Y);
      put(d, (y * w + x) * 4, (c1[0] + (c2[0] - c1[0]) * t) * L, (c1[1] + (c2[1] - c1[1]) * t) * L, (c1[2] + (c2[2] - c1[2]) * t) * L);
    }
  }
  ctx.putImageData(img, 0, 0);
}

// 左の小口: x = 紙の束の深さ (ページ番号), y = ページの縦位置。索引の黒い爪 (段差印刷) もここに刷る。
// 表示時は skewY + translateX で現在ページの位置をページ端に合わせる。
function renderFore() {
  const s = SC, g = G, ctx = sizeCanvas(foreC, g.foreW, g.foreH, s), w = foreC.width, h = foreC.height;
  const mk = document.createElement('canvas'); mk.width = w; mk.height = h;
  const mc = mk.getContext('2d'); mc.scale(s, s);
  mc.fillStyle = '#fff'; mc.textAlign = 'center'; mc.textBaseline = 'middle';
  mc.font = `700 ${g.rowH * 0.6}px ${SANS}`;
  for (let k = 0; k < S; k++) {
    const bw = (secEnd(k) - secStart[k]) * g.ppp;
    if (bw >= g.rowH * 1.1) mc.fillText(secLabel[k], g.boardPx + (secStart[k] + secEnd(k)) / 2 * g.ppp, g.rowY[k] + g.rowH / 2);
  }
  const md = mc.getImageData(0, 0, w, h).data;
  const img = ctx.createImageData(w, h), d = img.data, P = pal();
  const [er, eg, eb] = P.edge, [cr, cg, cb] = P.cloth, [ir, ig, ib] = P.ink, R = mulberry32(5);
  const y0 = Math.max(0, Math.floor(g.Q * s) - 1);
  const Ly = new Float32Array(h);
  for (let y = y0; y < h; y++) Ly[y] = lightAt(g.P - g.band * 0.4, y / s);
  for (let x = 0; x < w; x++) {
    const X = x / s;
    let kind, shade = 1, top = 0, bot = 0;
    if (X < g.shadow) kind = 0;
    else if (X < g.shadow + g.boardEdge) kind = 1;
    else if (X < g.boardPx) kind = 2;
    else {
      kind = 3;
      const k = secOf[Math.min(N - 1, Math.floor((X - g.boardPx) / g.ppp))], r = R();
      const col = 0.9 + 0.1 * R() - (r < 0.05 ? 0.08 : 0) + (r > 0.98 ? 0.05 : 0);
      shade = 0.8 * col * (0.8 + 0.2 * Math.min(1, (X - g.boardPx) / (g.band * 0.7)));
      top = (g.rowY[k] + (R() - 0.5) * 0.9) * s; bot = (g.rowY[k] + g.rowH + (R() - 0.5) * 0.9) * s;
    }
    for (let y = y0; y < h; y++) {
      const o = (y * w + x) * 4, L = Ly[y];
      if (kind === 0) { const a = X / g.shadow; put(d, o, 0, 0, 0, 150 * a * a); continue; }
      if (kind < 3) {
        const f = (kind === 1 ? 0.55 : 0.9) * L * (0.93 + 0.07 * ((x + y) & 1) + 0.05 * (tile(x, y) - 0.5));
        put(d, o, cr * f, cg * f, cb * f); continue;
      }
      const t = tile(x * 7, y), f = shade * L * (0.97 + 0.06 * t);
      let r = er * f, gg = eg * f, b = eb * f;
      const cov = Math.max(0, Math.min(1, y + 1 - top, bot - y));
      if (cov > 0) {
        const a = cov * (0.9 + 0.06 * (t - 0.5)) * (1 - md[o + 3] / 255 * 0.92), fi = L * (0.9 + 0.2 * t);
        r += (ir * fi - r) * a; gg += (ig * fi - gg) * a; b += (ib * fi - b) * a;
      }
      put(d, o, r, gg, b);
    }
  }
  ctx.putImageData(img, 0, 0);
  dof(foreC, s, g.Q + g.H * 0.25, g.H, 0.9);
}

// 上の天: y = 紙の束の深さ, x = ページの横位置。左端は小口との境 (斜めの直線)。
function renderTop() {
  const s = SC, g = G, ctx = sizeCanvas(topC, g.topW, g.topH, s), w = topC.width, h = topC.height;
  const img = ctx.createImageData(w, h), d = img.data, P = pal();
  const [er, eg, eb] = P.top, [cr, cg, cb] = P.cloth, R = mulberry32(11), pppT = g.ppp * K;
  const xs0 = g.P - g.boardPx - N / 2 * g.ppp, yL = g.Q - g.band * K * 0.5;
  const Lx = new Float32Array(w);
  for (let x = 0; x < w; x++) Lx[x] = lightAt(xs0 + x / s, yL);
  for (let y = 0; y < h; y++) {
    const Y = y / s, rr = R(), rowc = 0.92 + 0.09 * R() - (rr < 0.05 ? 0.07 : 0);
    const kind = Y < g.shadowT ? 0 : Y < g.shadowT + g.boardEdgeT ? 1 : Y < g.boardPxT ? 2 : 3;
    const j = kind === 3 ? Math.min(N - 1, Math.floor((Y - g.boardPxT) / pppT)) : 0;
    const ao = kind === 3 ? 0.82 + 0.18 * Math.min(1, (Y - g.boardPxT) / (g.band * K * 0.7)) : 1;
    const xStart = g.boardPx + j * g.ppp;
    for (let x = 0; x < w; x++) {
      const X = x / s, o = (y * w + x) * 4, outL = X < g.shadow;
      if (kind === 0 || outL) {
        const ax = outL ? (X / g.shadow) ** 2 : 1, ay = kind === 0 ? (Y / g.shadowT) ** 2 : 1;
        put(d, o, 0, 0, 0, 150 * ax * ay); continue;
      }
      if (kind < 3) {
        const side = X < g.shadow + g.boardEdge;
        const f = (side ? 0.55 : kind === 1 ? 0.7 : 0.92) * Lx[x] * (0.93 + 0.07 * ((x + y) & 1) + 0.05 * (tile(x, y) - 0.5));
        put(d, o, cr * f, cg * f, cb * f); continue;
      }
      if (X < xStart) { d[o + 3] = 0; continue; }
      const f = 0.92 * Lx[x] * rowc * ao * (0.97 + 0.05 * tile(x, y * 5));
      put(d, o, er * f, eg * f, eb * f);
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderPaper() {
  const s = Math.min(SC, 1.5), g = G, ctx = sizeCanvas(paperC, g.pageW, g.pageH, s), w = paperC.width, h = paperC.height;
  const img = ctx.createImageData(w, h), d = img.data, [pr, pg, pb] = pal().paper, R = mulberry32(7);
  const gx0 = g.W * 0.9;
  for (let y = 0; y < h; y++) {
    const Y = y / s, sy = g.Q + Y;
    for (let x = 0; x < w; x++) {
      const X = x / s, sx = g.P + X;
      let L = lightAt(sx, sy) * (1 + 0.05 * (tile(x, y) - 0.5) + 0.04 * (tile((x >> 2) + 101, (y >> 2) + 57) - 0.5) + 0.02 * (R() - 0.5));
      if (sx > gx0) { const q = (sx - gx0) / (g.W - gx0); L *= 1 - 0.14 * q * q; }   // のど側へ湾曲
      if (X < 1.5 || Y < 1.2) L *= 1.06;                                               // 断ちのハイライト
      put(d, (y * w + x) * 4, pr * L, pg * L, pb * L);
    }
  }
  ctx.putImageData(img, 0, 0);
}

// 本文はピントの外: ぼかした組版を V 通り描いておき、ページごとに切り替える
function renderBody() {
  const g = G, bs = 0.5, cw = Math.ceil(g.bodyW * bs), chv = Math.ceil(g.bodyH * bs);
  bodyC.width = cw; bodyC.height = chv * V;
  bodyC.style.width = cw / bs + 'px'; bodyC.style.height = chv * V / bs + 'px';
  g.bodyStride = chv / bs;
  const bc = bodyC.getContext('2d');
  const tmp = document.createElement('canvas'); tmp.width = cw; tmp.height = chv;
  const tc = tmp.getContext('2d');
  const fs = g.bodyFs, lh = fs * 1.75, w = g.bodyW, h = g.bodyH;
  const cols = w > 560 ? 2 : 1, gap = fs * 1.8, colW = (w - gap * (cols - 1)) / cols;
  const [ir, ig, ib] = pal().ink, ink = a => `rgba(${ir},${ig},${ib},${a})`;
  for (let v = 0; v < V; v++) {
    const R = mulberry32(1234 + v * 77);
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(0, 0, cw, chv); tc.setTransform(bs, 0, 0, bs, 0, 0);
    tc.fillStyle = ink(0.05);                                   // 裏写り
    for (let c = 0; c < cols; c++) {
      for (let y = lh * 0.7; y < h; y += lh) {
        let x = c * (colW + gap) + R() * fs;
        const end = c * (colW + gap) + colW * (0.3 + 0.7 * R());
        while (x < end) { const ww = fs * (0.6 + R() * 3); tc.fillRect(x, y, Math.min(ww, end - x), fs * 0.5); x += ww + fs * 0.3; }
      }
    }
    for (let c = 0; c < cols; c++) {
      const cx = c * (colW + gap);
      let y = lh * 0.15, li = 1, nl = R() < 0.6 ? 1 + (R() * 3 | 0) : 0;   // 前ページからの続きで始まることも
      while (y < h) {
        if (li >= nl) { li = 0; nl = 1 + (R() * 4 | 0); }
        const last = li === nl - 1, end = cx + (last ? colW * (0.2 + 0.75 * R()) : colW);
        let x = cx + (li === 0 ? 0 : fs);
        const glyphs = (gx, x1, a, hgt) => {                     // 1 文字ずつ刷る (ぼかすと本文の灰色の行になる)
          const yy = y + (lh - hgt) / 2;
          while (gx < x1) {
            const cwid = fs * (R() < 0.15 ? 0.55 : 0.86);
            tc.fillStyle = ink(a * (0.6 + 0.4 * R()));
            tc.fillRect(gx, yy + (R() - 0.5) * fs * 0.06, Math.min(cwid, x1 - gx), hgt * (0.8 + 0.2 * R()));
            gx += cwid + fs * 0.12 + (R() < 0.08 ? fs * 0.7 : 0);
          }
        };
        if (li === 0) { const bw = fs * (1.6 + R() * 3.4); glyphs(x, x + bw, 0.95, fs * 0.82); x += bw + fs * 0.8; }  // 見出し語 (太字)
        glyphs(x, end, 0.55, fs * 0.72);
        y += lh; li++;
      }
    }
    if (cols === 2) { tc.fillStyle = ink(0.3); tc.fillRect(colW + gap / 2 - 0.5, 0, 1, h); }
    const strip = Math.max(4, Math.round(lh * bs / 2));
    for (let y = 0; y < chv; y += strip) {
      const t = y / chv, r = (0.8 + 2.4 * t * t) * fs / 14 * bs;
      const m = Math.ceil(r * 3) + 1, sy = Math.max(0, y - m), sh = Math.min(chv, y + strip + m) - sy;
      bc.save(); bc.beginPath(); bc.rect(0, v * chv + y, cw, strip); bc.clip();
      if (CAN_FILTER) bc.filter = `blur(${r.toFixed(2)}px)`;
      bc.drawImage(tmp, 0, sy, cw, sh, 0, v * chv + sy, cw, sh); bc.restore();
    }
  }
}

function renderGrain() {
  const ctx = sizeCanvas(grainC, G.W, G.H, 1), img = ctx.createImageData(grainC.width, grainC.height);
  grainC.style.width = grainC.style.height = '100%';
  const d = img.data, R = mulberry32(3), amp = pal().grain * 255;
  for (let o = 0; o < d.length; o += 4) { const v = R() + R() - 1, c = v > 0 ? 255 : 0; put(d, o, c, c, c, Math.abs(v) * amp); }
  ctx.putImageData(img, 0, 0);
}

function rebuild() {
  SC = Math.min(devicePixelRatio || 1, 2);
  SANS = getComputedStyle(document.documentElement).getPropertyValue('--sans') || 'sans-serif';
  G = computeLayout();
  applyLayout();
  measureTitles();
  renderDesk(); renderTop(); renderFore(); renderPaper(); renderBody(); renderGrain();
  const i = cur < 0 ? 0 : cur;
  cur = -1; curSec = -1; twoNow = -1;
  show(i);
}

// ---------------------------------------------------------------- page change (ここだけが毎回走る)
function show(i) {
  i = clamp(i | 0, 0, N - 1);
  if (i === cur) return;
  cur = i;
  word.textContent = titles[i];
  word.style.fontSize = FS[i] + 'px';
  if (TWO[i] !== twoNow) { twoNow = TWO[i]; word.className = twoNow ? 'two' : ''; }
  pno.textContent = i + 1;
  link.href = URLS[i];
  const k = secOf[i];
  if (k !== curSec) {
    curSec = k;
    tab.style.transform = `translate3d(0,${G.rowY[k] - G.Q}px,0)`;
    tabLabel.textContent = secLabel[k];
  }
  const x0 = G.boardPx + i * G.ppp;
  foreC.style.transform = `matrix(1,${K},0,1,${G.P - x0},${-x0 * K})`;
  topC.style.transform = `translate3d(${G.P - x0}px,${G.Q - G.boardPxT - i * G.ppp * K}px,0)`;
  bodyC.style.transform = `translate3d(0,${-((i * 5) % V) * G.bodyStride}px,0)`;
  scheduleSave();
}
function openCur(forceNewTab) {
  save();
  if (forceNewTab || opt.newTab) window.open(URLS[cur], '_blank', 'noopener');
  else location.href = URLS[cur];
}

// 小口の y → ページ: 爪 (見出し) の段に当て、段の中の位置で見出し内のページを選ぶ
function absIndex(y) {
  const t = (y - G.rowsTop) / G.rowH, k = clamp(Math.floor(t), 0, S - 1), f = clamp(t - k, 0, 0.9999);
  return secStart[k] + Math.floor(f * (secEnd(k) - secStart[k]));
}

// ---------------------------------------------------------------- input
let drag = null, suppressClick = false;
function capture(id) { try { stage.setPointerCapture(id); } catch { /* already gone */ } stage.classList.add('dragging'); }
stage.addEventListener('pointerdown', e => {
  if (e.button !== 0 || drag) return;
  suppressClick = false;
  const abs = e.clientX < G.P;
  drag = { id: e.pointerId, abs, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, lt: e.timeStamp, moved: abs, pos: cur };
  if (abs) { e.preventDefault(); capture(e.pointerId); show(absIndex(e.clientY)); }
});
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.abs) { show(absIndex(e.clientY)); return; }
  if (!drag.moved) {
    if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 5) return;
    drag.moved = true; capture(drag.id);
  }
  const dt = Math.max(1, e.timeStamp - drag.lt);
  let dpx = (e.clientX - drag.lx) + (e.clientY - drag.ly);
  if (opt.invert) dpx = -dpx;
  const gain = opt.accel ? 1 + Math.min(10, Math.max(0, Math.abs(dpx) / dt - 0.35) * 5) : 1;
  drag.pos = clamp(drag.pos + dpx * gain / opt.step, 0, N - 1);
  drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = e.timeStamp;
  show(Math.round(drag.pos));
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
  drag = null; stage.classList.remove('dragging'); save();
}
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
stage.addEventListener('lostpointercapture', endDrag);
addEventListener('click', e => {
  if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
}, true);
link.addEventListener('dragstart', e => e.preventDefault());

let wheelAcc = 0;
stage.addEventListener('wheel', e => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 0.1 : 100;
  wheelAcc += (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) / unit;
  const n = Math.trunc(wheelAcc);
  if (n) { wheelAcc -= n; show(cur + n); }
}, { passive: false });

const coll = new Intl.Collator('ja', { numeric: true });
let typed = '', typedT = 0;
function typeKey(ch) {
  typed = ch === null ? typed.slice(0, -1) : typed + ch;
  clearTimeout(typedT);
  if (!typed) { typedEl.hidden = true; return; }
  typedEl.textContent = typed; typedEl.hidden = false;
  typedT = setTimeout(() => { typed = ''; typedEl.hidden = true; }, 1500);
  const q = typed.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!q) return;
  const i = keys.findIndex(k => coll.compare(k, q) >= 0);
  show(i < 0 ? N - 1 : i);
}
addEventListener('keydown', e => {
  if (!menu.hidden && menu.contains(document.activeElement)) { if (e.key === 'Escape') setMenu(false); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const k = secOf[Math.max(0, cur)];
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': show(cur + 1); break;
    case 'ArrowLeft': case 'ArrowUp': show(cur - 1); break;
    case 'PageDown': show(secEnd(k)); break;
    case 'PageUp': show(cur > secStart[k] ? secStart[k] : secStart[Math.max(0, k - 1)]); break;
    case 'Home': show(0); break;
    case 'End': show(N - 1); break;
    case 'Enter': openCur(e.shiftKey); break;
    case 'Escape': typed = ''; typedEl.hidden = true; setMenu(false); break;
    case 'Backspace': typeKey(null); break;
    default:
      if (e.key.length === 1 && /[\p{L}\p{N}\-.]/u.test(e.key)) typeKey(e.key);
      else return;
  }
  e.preventDefault();
});

// ---------------------------------------------------------------- menu
function setMenu(open) { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); }
menuBtn.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('pointerdown', e => {
  if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false);
}, true);
const applyTheme = () => document.documentElement.classList.toggle('dark', opt.dark);
const applyLinkTarget = () => { link.target = opt.newTab ? '_blank' : '_self'; };
function bind(sel, key, after) {
  const el = $(sel); el.checked = opt[key];
  el.addEventListener('change', () => { opt[key] = el.checked; save(); if (after) after(); });
}
bind('#opt-dark', 'dark', () => { applyTheme(); rebuild(); });
bind('#opt-newtab', 'newTab', applyLinkTarget);
bind('#opt-accel', 'accel');
bind('#opt-invert', 'invert');
const stepSel = $('#opt-step');
stepSel.value = String(opt.step);
stepSel.addEventListener('change', () => { opt.step = +stepSel.value; save(); });
$('#meta').innerHTML = '';
$('#meta').append(
  `${N} ページ / ${S} 見出し — 索引 ${new Date(D.built).toLocaleString('ja-JP')} 生成 — `,
  Object.assign(document.createElement('a'), { href: `https://scrapbox.io/${D.project}/`, textContent: `scrapbox.io/${D.project}`, target: '_blank', rel: 'noopener' }));

// ---------------------------------------------------------------- boot
applyTheme();
applyLinkTarget();
{
  let h = '';
  try { h = decodeURIComponent(location.hash.slice(1)); } catch { h = ''; }
  let i = h ? titles.indexOf(h) : -1;
  if (i < 0 && saved.title) i = titles.indexOf(saved.title);
  cur = i;
}
rebuild();
let rsT = 0;
addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(rebuild, 120); });
addEventListener('pagehide', save);
})();
