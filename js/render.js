// VIBIO · Rendering: projection and hills, level themes, sky/floor/road, notes, light cycle, effects, HUD.
// Plain script (not a module) so index.html also works opened straight from disk; files share globals and load in order.
'use strict';

/* =========================================================
   RENDERING
   ========================================================= */
// opaque canvas: every frame paints all of it, and the compositor can skip blending it with the page
const cv = $('c'), g = cv.getContext('2d', { alpha: false });
// bloom chain: progressively downsampled copies of the frame, added back on top
const mkCanvas = () => { const c = document.createElement('canvas'); return { c, x: c.getContext('2d') }; };
const BL = [2, 4, 8, 16].map(f => Object.assign(mkCanvas(), { f }));
const BC = mkCanvas(); // the three blur levels summed at 1/4 size, so only one full-screen draw goes back on the frame
function bloom(k) {
  let src = cv;
  for (const b of BL) {
    b.x.globalCompositeOperation = 'copy'; b.x.drawImage(src, 0, 0, b.c.width, b.c.height); src = b.c;
    if (b.f === 2) { b.x.globalCompositeOperation = 'multiply'; b.x.drawImage(b.c, 0, 0); } // square it: keeps highlights, drops darks
  }
  // weights .35 / .45 / .6, divided by their sum (1.4) so the 1/4-size sum can't clip; the 1.4 goes back on below
  const x = BC.x, w = BC.c.width, h = BC.c.height;
  x.globalCompositeOperation = 'copy'; x.globalAlpha = .25; x.drawImage(BL[1].c, 0, 0);
  x.globalCompositeOperation = 'lighter'; x.globalAlpha = .45 / 1.4; x.drawImage(BL[2].c, 0, 0, w, h);
  x.globalAlpha = .6 / 1.4; x.drawImage(BL[3].c, 0, 0, w, h);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'lighter'; g.imageSmoothingEnabled = true;
  for (let a = k * 1.4; a > .004; a -= 1) { g.globalAlpha = Math.min(1, a); g.drawImage(BC.c, 0, 0, cv.width, cv.height); }
  g.restore();
}

// ---- adaptive resolution ----
// Weak phones can't fill a 2× canvas with this much glow at full frame rate. When frames keep getting
// dropped, the canvas steps down to a lower resolution (the browser scales it up to fill the screen).
// A step is kept only if it actually cut the dropped frames; it is remembered per device, and after a
// few days the game tries one step finer again. ?gfx=0..4 forces a step, ?fps shows a frame counter.
const QSTEP = [1, .8, .66, .54, .44], QKEY = 'vibio.gfx';
const QS = new URLSearchParams(location.search), QFORCE = QS.has('gfx') ? clamp(+QS.get('gfx') | 0, 0, QSTEP.length - 1) : null;
let qLvl = 0;
if (QFORCE !== null) qLvl = QFORCE;
else try {
  const q = JSON.parse(localStorage.getItem(QKEY));
  if (q) { qLvl = clamp(q.lvl | 0, 0, QSTEP.length - 1); if (qLvl && Date.now() - q.at > 3 * 864e5) { qLvl--; saveQ(); } }
} catch (e) { }
function saveQ() { try { localStorage.setItem(QKEY, JSON.stringify({ lvl: qLvl, at: Date.now() })); } catch (e) { } }
const lite = () => qLvl >= 2; // lower steps also thin out the weather
const QM = { last: 0, t0: 0, n: 0, late: 0, hold: 0, st: '', prev: null, locked: QFORCE !== null, fps: QS.has('fps'), fn: 0, ft: 0, shown: 0 };
function qMonitor(now) {
  const ms = now - QM.last; QM.last = now;
  if (QM.fps) { QM.fn++; if (now - QM.ft > 500) { QM.shown = QM.fn * 1000 / (now - QM.ft); QM.fn = 0; QM.ft = now; } }
  if (QM.locked || document.hidden) return;
  // judge only steady play/menu frames: skip a second after any screen change or resolution change
  if (state !== QM.st) { QM.st = state; QM.hold = now + 1000; }
  if (now < QM.hold || !(state === 'title' || state === 'play' || state === 'results')) { QM.t0 = now; QM.n = QM.late = 0; return; }
  if (ms > 150) return; // a tab switch or one long stall, not a steady load
  QM.n++; if (ms > 21) QM.late++; // under ~48 fps at 60 Hz, or a missed frame at 90/120 Hz
  if (now - QM.t0 < 3000) return;
  const ratio = QM.late / QM.n; QM.t0 = now; QM.n = QM.late = 0;
  if (ratio > .06) { // more than ~1 in 16 frames dropped: visible stutter
    if (QM.prev !== null && ratio > QM.prev * .6) { qSet(qLvl - 1); QM.locked = true; saveQ(); return; } // that step didn't help: the cost is elsewhere
    const before = DPR; qSet(qLvl + 1);
    if (DPR < before) QM.prev = ratio; else QM.locked = true; // already at the lowest useful step
  } else if (QM.prev !== null) { QM.prev = null; saveQ(); } // the lower step fixed it: keep it
}
function qSet(l) { qLvl = clamp(l, 0, QSTEP.length - 1); resize(); QM.hold = performance.now() + 1000; }
function drawFps() {
  if (!QM.fps) return;
  g.font = '700 11px monospace'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = '#9f9';
  g.fillText(`${QM.shown.toFixed(0)} fps · gfx ${qLvl} · ${DPR.toFixed(2)}x`, 8 + SAFE.l, H - 6 - SAFE.b);
}

// ---- glowing text ----
// shadowBlur is one of the slowest things a phone's canvas can do, so each glowing label is drawn once
// into a small canvas and reused while its text stays the same (score / combo change only on a hit)
const TXT = new Map();
if (document.fonts) document.fonts.addEventListener('loadingdone', () => TXT.clear()); // redraw in Orbitron once it arrives
function textSprite(txt, font, fill, shadow, blur, core, align, base) {
  const key = `${txt}|${font}|${fill}|${shadow}|${blur}|${core}|${align}|${base}`;
  let s = TXT.get(key); if (s) return s;
  if (TXT.size > 96) TXT.clear();
  g.font = font;
  const tw = g.measureText(txt).width, size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)[1]);
  const pad = Math.ceil(blur * 1.6 / DPR + 3); // shadowBlur is in canvas pixels, not CSS pixels
  const w = Math.ceil(tw + pad * 2), h = Math.ceil(size * 1.5 + pad * 2);
  const c = document.createElement('canvas'), x = c.getContext('2d');
  c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR); x.setTransform(DPR, 0, 0, DPR, 0, 0);
  const ax = align === 'center' ? w / 2 : align === 'right' ? w - pad : pad, ay = base === 'top' ? pad + size * .15 : h / 2;
  x.font = font; x.textAlign = align; x.textBaseline = base;
  x.shadowColor = shadow; x.shadowBlur = blur; x.fillStyle = fill; x.fillText(txt, ax, ay);
  x.shadowBlur = 0; if (core > 0) { x.fillStyle = `rgba(255,255,255,${core})`; x.fillText(txt, ax, ay); }
  s = { c, w, h, ax, ay }; TXT.set(key, s); return s;
}
function drawText(txt, x, y, font, fill, shadow, blur, core = 0, a = 1, align = 'center', base = 'middle') {
  if (a <= 0) return;
  const s = textSprite(txt, font, fill, shadow, blur, core, align, base);
  g.globalAlpha = Math.min(1, a); g.drawImage(s.c, x - s.ax, y - s.ay, s.w, s.h); g.globalAlpha = 1;
}

let W, H, DPR, cx, horY, hitY, roadW, laneW, dBottom, roadW0 = 0; // roadW0: full width; the build narrows roadW a little
// phones: notch / Dynamic Island / home bar insets (from the #safe probe, which is padded with env(safe-area-inset-*))
const SAFE = { t: 0, r: 0, b: 0, l: 0 };
const TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
const SAFE_CSS = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)';
const insets = el => { const cs = el.ownerDocument.defaultView.getComputedStyle(el); return [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(v => parseFloat(v) || 0); };
function readSafe() {
  let [t, r, b, l] = insets($('safe'));
  // inside an iframe (e.g. a game portal) env() reads 0, so take the host page's insets where they overlap the frame
  try {
    const fe = window.frameElement;
    if (fe) {
      const pd = parent.document; let pr = pd.getElementById('vibio-safe');
      if (!pr) { pr = pd.createElement('div'); pr.id = 'vibio-safe'; pr.style.cssText = SAFE_CSS; pd.body.appendChild(pr); }
      const [pt, prr, pb, pl] = insets(pr), fr = fe.getBoundingClientRect();
      t = Math.max(t, pt - fr.top); b = Math.max(b, pb - (parent.innerHeight - fr.bottom));
      l = Math.max(l, pl - fr.left); r = Math.max(r, prr - (parent.innerWidth - fr.right));
    }
  } catch (e) { /* cross-origin parent: keep our own values */ }
  Object.assign(SAFE, { t, r, b, l });
  const st = document.documentElement.style; // the CSS uses these instead of env() so menus get the same insets
  st.setProperty('--st', t + 'px'); st.setProperty('--sr', r + 'px'); st.setProperty('--sb', b + 'px'); st.setProperty('--sl', l + 'px');
}
function resize() {
  DPR = Math.max(.6, Math.min(2, window.devicePixelRatio || 1) * QSTEP[qLvl]); W = innerWidth; H = innerHeight; readSafe();
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  BL.forEach(b => { b.c.width = Math.max(1, Math.ceil(W / b.f)); b.c.height = Math.max(1, Math.ceil(H / b.f)); });
  BC.c.width = BL[1].c.width; BC.c.height = BL[1].c.height;
  TXT.clear(); // glow-text sprites are drawn at the canvas resolution
  // on touch screens the hit line sits higher, clear of the home bar and the bottom edge where thumbs can't reach comfortably
  const usable = H - SAFE.b;
  cx = W / 2; hitY = TOUCH ? usable * (H > W ? .74 : .78) : H * .84;
  roadW0 = roadW = Math.min(W * (TOUCH && H > W ? .92 : .78), H * .7, 620); laneW = roadW / 4; // wider lanes for thumbs on phones
  setHorizon(0);
}
function setHorizon(bob) {
  horY = H * .33 + bob;
  const sB = (H + 10 - horY) / (hitY - horY); dBottom = (1 / sB - 1) / K;
}
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 250)); resize();

// ---- the wave: rolling hills fixed to the ground, zero at the hit line ----
// WAVE_UP = hill height, WAVE_SIDE = sideways sway (0 = off). One crest reaches the player every 2 bars.
// WAVE_UP .13 keeps the road ahead fully visible even at peak (drop2 ×1.3, kick pulse ×1.12): no note is ever hidden.
const WAVE_UP = .13, WAVE_SIDE = 0;
// WAVE_W: one crest every 2 bars of the current song. WAVE_K is fixed: the hill shape was tuned for note visibility at this value.
let WAVE_W = Math.PI * 2 / (BAR * 2); const WAVE_K = 2.6;
const wave = { amp: 0, a: 0, phase: 0 };
function off(d) { if (!WAVE_SIDE || wave.a < .002 || d <= 0) return 0; return WAVE_SIDE * wave.a * roadW * Math.sin(wave.phase + d * WAVE_K) * d / (1 + .25 * d); }
function lift(d) { // screen-space bump: 0 at the hit line and at the horizon, peaks mid-distance
  if (wave.a < .002 || d <= 0) return 0;
  const s = 1 / (1 + K * d);
  return wave.a * WAVE_UP * (hitY - horY) * 34.72 * s * s * s * (1 - s) * (1 - s) * Math.sin(wave.phase + d * WAVE_K);
}
function proj(X, d) { const s = 1 / (1 + K * d); return [cx + (X + off(d)) * s, horY + (hitY - horY) * s - lift(d), s]; }
const laneX = l => -roadW / 2 + laneW * (l + .5);
const yAt = d => horY + (hitY - horY) / (1 + K * d) - lift(d);
// depth samples spaced evenly on screen (linear in perspective scale)
function dSpan(d0, d1, n) {
  if (wave.a < .002) n = 1;
  const s0 = 1 / (1 + K * d0), s1 = 1 / (1 + K * d1), out = [];
  for (let i = 0; i <= n; i++) { const s = s0 + (s1 - s0) * i / n; out.push((1 / s - 1) / K); }
  return out;
}
// far ground never rises above nearer ground on screen (a crest hides what's behind it instead of overlapping)
const path = (X, ds) => { let m = Infinity; return ds.map(d => { const p = proj(X, d); if (p[1] > m) p[1] = m; else m = p[1]; return p; }); };
function tracePts(pts, move = true) { if (move) g.moveTo(pts[0][0], pts[0][1]); else g.lineTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); }
function fillBand(a, b) { g.beginPath(); tracePts(a); tracePts(b.slice().reverse(), false); g.closePath(); g.fill(); }
function glowPath(pts, c, w, a) {
  g.beginPath(); tracePts(pts);
  g.strokeStyle = rgba(c, a * .07); g.lineWidth = w * 7; g.stroke();
  g.strokeStyle = rgba(c, a * .2); g.lineWidth = w * 3; g.stroke();
  g.strokeStyle = rgba(c, a); g.lineWidth = w; g.stroke();
  g.strokeStyle = `rgba(255,255,255,${a * .55})`; g.lineWidth = Math.max(.6, w * .35); g.stroke();
}

// scenery
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const STARS = Array.from({ length: 110 }, () => ({ x: rnd(), y: rnd() * .95, r: rnd() < .15 ? 2 : 1, b: .3 + rnd() * .7, sp: .5 + rnd() * 2, ph: rnd() * 6 }));
function ridge(n, rough) { const a = []; let v = .4; for (let i = 0; i <= n; i++) { v += (rnd() - .5) * rough; v = clamp(v, .05, 1); const edge = Math.abs(i / n - .5) * 2; a.push(v * (.25 + edge * .85)); } return a; }
const MT_FAR = ridge(70, .5), MT_NEAR = ridge(46, .7);
function spikes(n) { const a = []; for (let i = 0; i <= n; i++) { const edge = Math.abs(i / n - .5) * 2; a.push((i % 2 ? .35 + rnd() * .65 : rnd() * .2) * (.2 + edge * .95)); } return a; }
const MT_SPIKE = spikes(40); // obsidian shards for the dark level
function peaks(n) { const a = []; for (let i = 0; i <= n; i++) { const edge = Math.abs(i / n - .5) * 2; a.push((i % 2 ? .55 + rnd() * .45 : .12 + rnd() * .25) * (.18 + edge * .9)); } return a; }
const MT_PEAKS = peaks(22); // arctic range: broad peaks, snow-capped when drawn
function dunes(n) { const a = [], p1 = rnd() * 6, p2 = rnd() * 6; for (let i = 0; i <= n; i++) { const x = i / n, edge = Math.abs(x - .5) * 2; a.push((.45 + .3 * Math.sin(x * 9 + p1) + .2 * Math.sin(x * 23 + p2)) * (.2 + edge * .85)); } return a; }
const MT_DUNES = dunes(60); // seabed: smooth sand ridges
// kelp: stalks rooted on the horizon toward the screen edges (the road's vanishing point stays clear)
const KELP = Array.from({ length: 16 }, (_, i) => { const side = i % 2 ? 1 : -1; return { x: .5 + side * (.14 + rnd() * .36), h: .25 + rnd() * .5, ph: rnd() * 6, w: .8 + rnd() * .8 }; });
// city skyline: blocks that rise toward the edges; windows come from a hash so they stay put
const CITY = (() => { const a = []; let x = 0; while (x < 1) { const w = .018 + rnd() * .04, edge = Math.abs(x + w / 2 - .5) * 2; a.push({ x, w, h: (.15 + rnd() * .85) * (.12 + edge * .95), ant: rnd() < .18, seed: rnd() * 1000 }); x += w + rnd() * .006; } return a; })();
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
// level themes: everything the world draws that isn't the song palette
// ridge: near skyline shape · weather: particles · extras: sun / rays / aurora / lightning
const THEMES = {
  neon: { sky: ['#010208', '#030a1b', '#0b2442'], floor: ['#061426', '#01050c', '#000'], star: [150, 215, 255], stars: 1, mtnFill: '#02060e', road: 'rgba(0,4,12,.88)' },
  dark: { sky: ['#000000', '#070103', '#26040a'], floor: ['#170306', '#040001', '#000'], star: [255, 150, 140], stars: .35, mtnFill: '#050002', road: 'rgba(7,0,2,.9)', ridge: 'spikes', lightning: true, weather: 'embers' },
  ocean: { sky: ['#00222e', '#00141f', '#003a48'], floor: ['#00303c', '#000d14', '#000'], star: [120, 255, 230], stars: .3, mtnFill: '#00121a', road: 'rgba(0,10,16,.88)', ridge: 'reef', rays: true, weather: 'bubbles' },
  dusk: { sky: ['#0c0322', '#3a0f4a', '#a8325e'], floor: ['#2a0a2c', '#09020e', '#000'], star: [255, 210, 235], stars: .45, mtnFill: '#10041a', road: 'rgba(12,2,16,.9)', ridge: 'city', sun: true, weather: 'petals' },
  arctic: { sky: ['#000308', '#02101f', '#0a3040'], floor: ['#0b2232', '#020810', '#000'], star: [210, 240, 255], stars: 1.1, mtnFill: '#030b16', road: 'rgba(2,8,16,.88)', ridge: 'peaks', aurora: true, weather: 'snow' },
};
const TH = () => THEMES[SONG.theme] || THEMES.neon;
// lightning + weather particles
let bolt = null, embers = [], frameDt = 0;
function strike() {
  const x0 = W * (.15 + Math.random() * .7), pts = [[x0, -10]]; let x = x0;
  for (let y = 0; y < horY * .92; y += horY / 12) { x += (Math.random() - .5) * W * .06; pts.push([x, y + horY / 12]); }
  const fork = pts.slice(4, 8).map(([px, py], i) => [px + (i + 1) * W * .02 * (Math.random() < .5 ? -1 : 1), py + i * 4]);
  bolt = { pts, fork, life: 1 };
}
function drawStorm() {
  if (!bolt) return;
  bolt.life -= frameDt * 3.2; if (bolt.life <= 0) { bolt = null; return; }
  const a = bolt.life * (.55 + .45 * Math.random()); // flicker
  g.fillStyle = `rgba(255,210,220,${a * .16})`; g.fillRect(0, 0, W, horY); // sky flash
  g.globalCompositeOperation = 'lighter';
  glowPath(bolt.pts, mix(WHITE, P, .35), 2.2, a); glowPath(bolt.fork, mix(WHITE, P, .5), 1.2, a * .7);
  g.globalCompositeOperation = 'source-over';
}
// weather particles per theme: embers / bubbles rise from the bottom, petals / snow fall from the top
// drawn in batches: every particle with the same colour and one of 8 alpha steps goes into one path
let weatherKind = null;
const ALV = 8, lvPaths = (n = ALV) => Array.from({ length: n + 1 }, () => new Path2D());
function fillLevels(paths, col, k) { const n = paths.length - 1; for (let i = 1; i <= n; i++) { g.fillStyle = rgba(col, i / n * k); g.fill(paths[i]); } }
function drawWeather(live, inten) {
  const kind = TH().weather;
  if (kind !== weatherKind) { embers.length = 0; weatherKind = kind; }
  if (!kind) return;
  const rise = kind === 'embers' || kind === 'bubbles', thin = lite() ? .5 : 1;
  const perSec = { embers: live ? 10 + 25 * inten : 14, bubbles: live ? 6 + 14 * inten : 9, petals: live ? 5 + 9 * inten : 7, snow: live ? 18 + 30 * inten : 24 }[kind] * thin;
  const cap = { embers: 220, bubbles: 120, petals: 90, snow: 260 }[kind] * thin;
  const rate = perSec * frameDt, n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
  for (let i = 0; i < n && embers.length < cap; i++) {
    const p = { x: Math.random() * W, y: rise ? H + 6 : -6, life: 1, ph: Math.random() * 6 };
    if (kind === 'embers') Object.assign(p, { vx: (Math.random() - .5) * 24, vy: -(40 + Math.random() * 90), r: 1.4 + Math.random() * 2 });
    if (kind === 'bubbles') Object.assign(p, { vx: 0, vy: -(30 + Math.random() * 70), r: 1.5 + Math.random() * 4 });
    if (kind === 'petals') Object.assign(p, { x: Math.random() * W * 1.2 - W * .1, vx: 14 + Math.random() * 26, vy: 28 + Math.random() * 40, r: 2.5 + Math.random() * 2.5, spin: (Math.random() - .5) * 5 });
    if (kind === 'snow') Object.assign(p, { vx: -6 - Math.random() * 10, vy: 22 + Math.random() * 46, r: 1 + Math.random() * 2 });
    if (kind === 'embers') p.hue = Math.min(2, (p.r - 1.4) * 1.5 | 0); // 3 shades: bigger embers burn yellower
    embers.push(p);
  }
  const fade = rise ? .22 : .12;
  // embers: 3 shades × (halo, core); everything else: one colour × (main, extra)
  const A1 = kind === 'embers' ? [lvPaths(), lvPaths(), lvPaths()] : [lvPaths()], A2 = kind === 'embers' ? [lvPaths(), lvPaths(), lvPaths()] : [lvPaths()];
  let keep = 0;
  for (const e of embers) {
    e.life -= frameDt * fade; e.ph += frameDt * 2;
    e.x += (e.vx + Math.sin(e.ph) * (kind === 'bubbles' ? 18 : 12)) * frameDt; e.y += e.vy * frameDt;
    if (!(e.life > 0 && e.y > -10 && e.y < H + 10)) continue;
    embers[keep++] = e;
    const lv = Math.ceil(Math.max(0, Math.min(1, e.life * 2)) * ALV); if (!lv) continue;
    if (kind === 'embers') {
      A1[e.hue][lv].rect(e.x - e.r, e.y - e.r, e.r * 3, e.r * 3); A2[e.hue][lv].rect(e.x, e.y, e.r, e.r);
    } else if (kind === 'bubbles') {
      A1[0][lv].moveTo(e.x + e.r, e.y); A1[0][lv].arc(e.x, e.y, e.r, 0, 7); A2[0][lv].rect(e.x - e.r * .45, e.y - e.r * .45, 1.2, 1.2);
    } else if (kind === 'petals') { // tumbling: spin plus a squash that flips the petal over
      const rot = e.ph * e.spin * .5, rx = e.r * 1.4;
      A1[0][lv].moveTo(e.x + rx * Math.cos(rot), e.y + rx * Math.sin(rot));
      A1[0][lv].ellipse(e.x, e.y, rx, e.r * Math.abs(.45 + .4 * Math.sin(e.ph * 1.7)), rot, 0, Math.PI * 2);
    } else {
      A1[0][lv].rect(e.x - e.r, e.y - e.r, e.r * 3, e.r * 3); A2[0][lv].rect(e.x, e.y, e.r, e.r);
    }
  }
  embers.length = keep;
  g.globalCompositeOperation = 'lighter';
  if (kind === 'embers') for (let h = 0; h < 3; h++) { const gb = 145 + h * 25; fillLevels(A1[h], [255, gb, 40], .22); fillLevels(A2[h], [255, gb + 40, 90], .9); }
  else if (kind === 'bubbles') {
    g.lineWidth = 1; const c = mix(S, WHITE, .5);
    for (let i = 1; i <= ALV; i++) { g.strokeStyle = rgba(c, i / ALV * .45); g.stroke(A1[0][i]); }
    fillLevels(A2[0], WHITE, .5);
  } else if (kind === 'petals') fillLevels(A1[0], mix(P, WHITE, .45), .55);
  else { fillLevels(A1[0], [200, 225, 255], .15); fillLevels(A2[0], [235, 245, 255], .85); }
  g.globalCompositeOperation = 'source-over';
}
// ocean: slow god rays slanting down from the surface
function drawRays(t, pulse, inten) {
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const x = W * (.08 + i * .17) + Math.sin(t * .23 + i * 1.7) * W * .05, w = W * (.03 + .025 * Math.sin(i * 2.3 + 1) ** 2);
    const lean = W * .12, a = (.05 + .035 * Math.sin(t * .4 + i * 2.1) ** 2) * (1 + .5 * pulse * inten);
    const gr = g.createLinearGradient(0, 0, 0, horY);
    gr.addColorStop(0, rgba(mix(P, WHITE, .6), a)); gr.addColorStop(1, rgba(P, 0));
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - w / 2, 0); g.lineTo(x + w / 2, 0); g.lineTo(x + w * 1.6 + lean, horY); g.lineTo(x - w * 1.6 + lean, horY); g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}
// dusk: a big striped sun sinking into the horizon
function drawSun(t, pulse, inten) {
  const R = Math.min(W * .22, horY * .62), y0 = horY - R * .42;
  g.save(); g.beginPath(); g.rect(0, 0, W, horY); g.clip();
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(cx, y0, R * .6, cx, y0, R * 2.1);
  halo.addColorStop(0, rgba(P, .22 + .1 * pulse * inten)); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.fillRect(cx - R * 2.2, y0 - R * 2.2, R * 4.4, R * 4.4);
  g.globalCompositeOperation = 'source-over';
  g.beginPath(); g.arc(cx, y0, R, 0, 7); g.clip();
  const sg = g.createLinearGradient(0, y0 - R, 0, y0 + R);
  sg.addColorStop(0, rgba(mix(S, WHITE, .1), .62)); sg.addColorStop(.55, rgba(mix(S, P, .5), .62)); sg.addColorStop(1, rgba(P, .62));
  g.fillStyle = sg;
  // solid top half, then bands that get thinner as the gaps between them grow; the bands scroll down slowly
  g.fillRect(cx - R, y0 - R, R * 2, R);
  const scroll = (t * .25) % 1;
  for (let k = 0; k < 9; k++) {
    const f = (k + scroll) / 9, yb = y0 + f * R, gap = 1.5 + f * R * .09;
    g.fillRect(cx - R, yb, R * 2, R / 9 - gap);
  }
  g.restore();
}
// arctic: aurora curtains rippling across the sky
function drawAurora(t, pulse, inten) {
  g.globalCompositeOperation = 'lighter';
  const n = Math.ceil(W / 12);
  for (let r = 0; r < 3; r++) {
    const col = r === 1 ? S : mix(P, S, r * .25), base = horY * (.3 + r * .13), amp = horY * (.06 + r * .02);
    const bot = [], top = [];
    for (let i = 0; i <= n; i++) {
      const x = i / n * W, u = x / W;
      const y = base + Math.sin(u * 5.5 + t * .22 + r * 2) * amp + Math.sin(u * 13 - t * .4 + r) * amp * .35;
      const h = horY * (.14 + .1 * Math.sin(u * 8 + t * .3 + r * 1.3) ** 2) * (1 - r * .15);
      bot.push([x, y]); top.push([x, y - h]);
    }
    const ymin = Math.min(...top.map(p => p[1])), ymax = Math.max(...bot.map(p => p[1]));
    const a = (.3 - r * .06) * (.75 + .25 * Math.sin(t * .5 + r * 2)) * (1 + .35 * pulse * inten);
    const gr = g.createLinearGradient(0, ymin, 0, ymax);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(.6, rgba(col, a * .5)); gr.addColorStop(1, rgba(col, a));
    g.fillStyle = gr; fillBand(bot, top);
    // curtain folds: vertical rays of uneven height that drift along the ribbon
    g.strokeStyle = gr; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = bot[i], k = .5 + .5 * Math.sin(i * 1.7 + t * 1.3 + r) * Math.sin(i * .43 - t * .7);
      g.moveTo(x, y); g.lineTo(x, y - (y - top[i][1]) * (.6 + k * .9));
    }
    g.stroke();
    glowPath(bot, col, 1, a * 1.1);
  }
  g.globalCompositeOperation = 'source-over';
}

function sectionInfo(t) {
  const bar = Math.floor(t / BAR), s = bar < 0 ? 'intro' : bar >= BARS ? 'outro' : sectionOf(bar);
  let inten = { intro: .3, build: .35 + .55 * clamp((t / BAR - 4) / 8, 0, 1), drop: 1, break: .4, drop2: 1, outro: .45 }[s];
  const kickOn = s === 'build' || s === 'drop' || s === 'drop2' || (s === 'outro' && bar < 54);
  return { bar, s, inten, kickOn };
}

function glowLine(x1, y1, x2, y2, c, w, a) {
  g.strokeStyle = rgba(c, a * .07); g.lineWidth = w * 7; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = rgba(c, a * .2); g.lineWidth = w * 3; g.stroke();
  g.strokeStyle = rgba(c, a); g.lineWidth = w; g.stroke();
  g.strokeStyle = `rgba(255,255,255,${a * .55})`; g.lineWidth = Math.max(.6, w * .35); g.stroke();
}
function poly(pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }

function drawSky(t, pulse, inten) {
  const sky = g.createLinearGradient(0, 0, 0, horY);
  const th = TH();
  sky.addColorStop(0, th.sky[0]); sky.addColorStop(.65, th.sky[1]); sky.addColorStop(1, th.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, W, horY + 1);
  const fl = g.createLinearGradient(0, horY, 0, H);
  fl.addColorStop(0, th.floor[0]); fl.addColorStop(.22, th.floor[1]); fl.addColorStop(1, th.floor[2]);
  g.fillStyle = fl; g.fillRect(0, horY, W, H - horY);
  g.globalCompositeOperation = 'lighter';
  const sp = lvPaths(16); // stars batched by brightness step (fine steps: they twinkle slowly)
  for (const s of STARS) { const a = (.25 + .6 * Math.sin(t * s.sp + s.ph) ** 2) * s.b; sp[Math.max(1, Math.round(a * 16))].rect(s.x * W, s.y * horY * .9, s.r, s.r); }
  fillLevels(sp, th.star, th.stars);
  // horizon bloom
  g.save(); g.translate(cx, horY); g.scale(1, .32);
  const R = W * .65, hg = g.createRadialGradient(0, 0, 0, 0, 0, R);
  hg.addColorStop(0, rgba(S, .3 + .2 * pulse * inten + flare * .5)); hg.addColorStop(.25, rgba(P, .13 + .1 * pulse * inten + flare * .2)); hg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hg; g.fillRect(-R, -R, R * 2, R * 2); g.restore();
  if (th.rays) drawRays(t, pulse, inten);
  if (th.aurora) drawAurora(t, pulse, inten);
  if (th.sun) drawSun(t, pulse, inten);
  drawStorm(); // lightning sits behind the spectrum and mountains
  // spectrum skyline
  const bins = 48, bw = W / 2 / bins;
  let fd = null; if (A.analyser && state !== 'title') { A.analyser.getByteFrequencyData(A.freqData); fd = A.freqData; }
  for (let i = 0; i < bins; i++) {
    const v = fd ? fd[Math.floor(2 + i * 1.6)] / 255 : (.25 + .2 * Math.sin(t * 2 + i * .5) * Math.sin(t * .7 + i * .13)) * .6;
    const h = v * v * horY * .42 * (.4 + inten * .6);
    const col = i < bins / 2 ? P : S;
    g.fillStyle = rgba(col, .18 + v * .25);
    g.fillRect(cx + i * bw + 1, horY - h, bw - 2, h); g.fillRect(cx - (i + 1) * bw + 1, horY - h, bw - 2, h);
  }
  g.globalCompositeOperation = 'source-over';
  // mountains
  const mtn = (arr, hScale, col, a) => {
    const step = W / (arr.length - 1), pts = arr.map((v, i) => [i * step, horY - v * hScale]);
    g.beginPath(); g.moveTo(0, horY); pts.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(W, horY); g.closePath();
    g.fillStyle = th.mtnFill; g.fill();
    g.globalCompositeOperation = 'lighter';
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.strokeStyle = rgba(col, a * .25); g.lineWidth = 5; g.stroke(); g.strokeStyle = rgba(col, a); g.lineWidth = 1.2; g.stroke();
    g.globalCompositeOperation = 'source-over';
    return pts;
  };
  const nearA = .6 + .3 * pulse * inten;
  if (th.ridge === 'reef') { // swaying kelp behind smooth sand dunes
    mtn(MT_FAR, horY * .14, S, .3);
    g.globalCompositeOperation = 'lighter';
    for (const k of KELP) {
      const pts = [], h = k.h * horY * .5;
      for (let j = 0; j <= 10; j++) { const f = j / 10; pts.push([k.x * W + Math.sin(t * .9 + k.ph + f * 2.4) * f * W * .018, horY - f * h]); }
      glowPath(pts, P, k.w, .3 + .2 * pulse * inten);
    }
    g.globalCompositeOperation = 'source-over';
    mtn(MT_DUNES, horY * .09, P, nearA);
  } else if (th.ridge === 'city') { // skyline with lit windows that flicker a little on the beat
    mtn(MT_FAR, horY * .16, S, .35);
    const hs = horY * .34, tops = [];
    g.fillStyle = th.mtnFill;
    for (const b of CITY) {
      const x = b.x * W, w = b.w * W, y = horY - b.h * hs;
      g.fillRect(x, y, w, horY - y + 1); tops.push([x, y], [x + w, y]);
      if (b.ant) { g.fillRect(x + w * .45, y - hs * .08, Math.max(1, w * .1), hs * .08); }
    }
    g.globalCompositeOperation = 'lighter';
    g.beginPath(); tracePts(tops); g.strokeStyle = rgba(P, nearA * .25); g.lineWidth = 5; g.stroke(); g.strokeStyle = rgba(P, nearA); g.lineWidth = 1.2; g.stroke();
    const beat = Math.floor(t / SPB), win = [lvPaths(), lvPaths()], beacons = new Path2D(); // windows batched by colour and brightness step
    for (const b of CITY) {
      const x = b.x * W, w = b.w * W, y = horY - b.h * hs, cols = Math.floor((w - 4) / 6), rows = Math.floor((horY - y - 6) / 7);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const hv = hash(b.seed + i, j); if (hv > .32) continue;
        const flick = hash(b.seed + i * 7 + beat, j) < .06 ? .25 : 1;
        win[hv < .1 ? 0 : 1][Math.max(1, Math.round((.28 + hv) * flick * ALV))].rect(x + 3 + i * 6, y + 5 + j * 7, 2.5, 3);
      }
      if (b.ant) beacons.rect(x + w * .45, y - hs * .08 - 2, Math.max(2, w * .1), 2);
    }
    fillLevels(win[0], P, 1); fillLevels(win[1], S, 1);
    g.fillStyle = rgba(P, .5 + .5 * pulse); g.fill(beacons);
    g.globalCompositeOperation = 'source-over';
  } else if (th.ridge === 'peaks') { // snow-capped range
    mtn(MT_FAR, horY * .2, S, .4);
    const pts = mtn(MT_PEAKS, horY * .32, P, nearA);
    g.fillStyle = 'rgba(205,228,245,.5)';
    for (let i = 1; i < pts.length - 1; i += 2) {
      const [px, py] = pts[i], [lx, ly] = pts[i - 1], [rx, ry] = pts[i + 1];
      if (horY - py < horY * .05) continue; // only real peaks get snow
      const at = (qx, qy, k) => [px + (qx - px) * k, py + (qy - py) * k], R = at(rx, ry, .38), L = at(lx, ly, .38);
      // ragged snow line: down each slope, then a zigzag back across
      g.beginPath(); g.moveTo(px, py); g.lineTo(R[0], R[1]);
      g.lineTo((R[0] * 2 + px) / 3, (R[1] * 2 + py) / 3 + (horY - py) * .06); g.lineTo(px, R[1] * .5 + L[1] * .5 - (horY - py) * .02);
      g.lineTo((L[0] * 2 + px) / 3, (L[1] * 2 + py) / 3 + (horY - py) * .07); g.lineTo(L[0], L[1]); g.closePath(); g.fill();
    }
  } else {
    mtn(MT_FAR, horY * .2, S, .45);
    if (th.ridge === 'spikes') mtn(MT_SPIKE, horY * .3, P, .65 + .35 * pulse * inten);
    else mtn(MT_NEAR, horY * .13, P, nearA);
  }
  g.globalCompositeOperation = 'lighter';
  glowLine(0, horY, W, horY, mix(S, WHITE, .35 + flare * .5), 1.3 * (1 + flare * 2.5), Math.min(1, .7 + .3 * pulse * inten + flare));
  if (flare > .01) { // anamorphic lens streak on the horizon
    g.save(); g.translate(cx, horY); g.scale(1, .035);
    const R2 = W * .7, lg = g.createRadialGradient(0, 0, 0, 0, 0, R2);
    lg.addColorStop(0, `rgba(255,255,255,${flare})`); lg.addColorStop(.3, rgba(S, flare * .6)); lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(-R2, -R2, R2 * 2, R2 * 2); g.restore();
  }
  g.globalCompositeOperation = 'source-over';
}

function drawFloor(t, pulse, inten) {
  g.globalCompositeOperation = 'lighter';
  const vg = g.createLinearGradient(0, horY, 0, H);
  vg.addColorStop(0, rgba(P, 0)); vg.addColorStop(.35, rgba(P, .16 + .12 * pulse * inten + feverT * .1)); vg.addColorStop(1, rgba(P, .4 + .2 * pulse * inten + feverT * .15));
  g.strokeStyle = vg; g.lineWidth = 1;
  g.beginPath();
  // the hill height and crest clipping depend only on depth, so work them out once for all 52 grid lines
  const fds = dSpan(dBottom, 60, 20), fs = [], fy = [], fo = [];
  let m = Infinity;
  for (const d of fds) { const s = 1 / (1 + K * d); let y = horY + (hitY - horY) * s - lift(d); if (y > m) y = m; else m = y; fs.push(s); fy.push(y); fo.push(off(d)); }
  for (let k = 1; k <= 26; k++) for (let side = -1; side <= 1; side += 2) {
    const X = side * (roadW / 2 + k * laneW * 1.15);
    g.moveTo(cx + (X + fo[0]) * fs[0], fy[0]);
    for (let i = 1; i < fs.length; i++) g.lineTo(cx + (X + fo[i]) * fs[i], fy[i]);
  }
  g.stroke();
  // horizontal lines on the beat
  const b0 = Math.floor((t + dBottom * LOOK) / SPB), b1 = Math.ceil((t + 5 * LOOK) / SPB);
  for (let b = b0; b <= b1; b++) {
    const d = (b * SPB - t) / LOOK; if (d < dBottom) continue;
    const y = yAt(d), s = 1 / (1 + K * d), isBar = ((b % 4) + 4) % 4 === 0;
    const a = Math.min(1, s * 1.4) * (isBar ? .5 : .22) * (.6 + .4 * inten);
    g.strokeStyle = rgba(P, a); g.lineWidth = isBar ? 1.5 : 1;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  // light cycles
  for (const c of cycles) {
    const head = c.d0 - (t - c.t0) * c.v, tail = head + (c.len || .9);
    if (head < dBottom - .1) { c.dead = true; continue; }
    const pts = path(c.X, dSpan(Math.max(head, dBottom), tail, 8));
    const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
    const gr = g.createLinearGradient(x1, y1, x2, y2); gr.addColorStop(0, rgba(c.col, .95)); gr.addColorStop(1, rgba(c.col, 0));
    g.strokeStyle = gr; g.lineWidth = 6 / (1 + K * Math.max(head, 0)); g.beginPath(); tracePts(pts); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.8)'; g.beginPath(); tracePts(pts.slice(0, Math.max(2, pts.length >> 2))); g.stroke();
    g.fillStyle = rgba(c.col, .35); g.beginPath(); g.arc(x1, y1, 10 / (1 + K * Math.max(head, 0)), 0, 7); g.fill();
  }
  cycles = cycles.filter(c => !c.dead);
  g.globalCompositeOperation = 'source-over';
}
function spawnCycle(t) {
  const side = Math.random() < .5 ? -1 : 1, k = 1 + Math.floor(Math.random() * 7);
  cycles.push({ X: side * (roadW / 2 + k * laneW * 1.15), d0: 5, t0: t, v: (2.2 + Math.random() * 1.5) * (1 + tension * 1.2), col: (side < 0 ? P : S).slice() }); // faster as the build winds up
}
function spawnStreak(t) { // fever: fast short light streaks rushing past
  const side = Math.random() < .5 ? -1 : 1;
  cycles.push({ X: side * (roadW / 2 + (.3 + Math.random() * 6) * laneW), d0: 2.6, t0: t, v: 5 + Math.random() * 3, len: .15 + Math.random() * .2, col: LC[Math.floor(Math.random() * 4)] });
}

function drawRoad(t, pulse, inten, live) {
  const half = roadW / 2, ds = dSpan(dBottom, 60, 28);
  const Lp = path(-half, ds), Rp = path(half, ds);
  g.fillStyle = TH().road; fillBand(Lp, Rp);
  g.globalCompositeOperation = 'lighter';
  if (feverT > .01) { // energised road surface
    const fg = g.createLinearGradient(0, H, 0, horY);
    fg.addColorStop(0, rgba(P, .14 * feverT * (.6 + .4 * pulse))); fg.addColorStop(1, rgba(P, 0));
    g.fillStyle = fg; fillBand(Lp, Rp);
  }
  // lane press glow
  const gds = dSpan(dBottom, .9, 14);
  for (let l = 0; l < 4; l++) {
    const p = pressFx[l]; if (p < .01) continue;
    const xl = -half + laneW * l, lp = path(xl, gds), rp = path(xl + laneW, gds);
    const gr = g.createLinearGradient(0, lp[0][1], 0, lp[lp.length - 1][1]); gr.addColorStop(0, rgba(LC[l], .32 * p)); gr.addColorStop(1, rgba(LC[l], 0));
    g.fillStyle = gr; fillBand(lp, rp);
  }
  // beat lines on the road
  const b0 = Math.floor((t + dBottom * LOOK) / SPB), b1 = Math.ceil((t + 5 * LOOK) / SPB);
  for (let b = b0; b <= b1; b++) {
    const d = (b * SPB - t) / LOOK; if (d < dBottom) continue;
    const [x1, y] = proj(-half, d), [x2] = proj(half, d), s = 1 / (1 + K * d), isBar = ((b % 4) + 4) % 4 === 0;
    g.strokeStyle = rgba(P, Math.min(1, s * 1.3) * (isBar ? .45 : .16) * (.5 + .5 * inten)); g.lineWidth = isBar ? 2 * s + .5 : 1;
    g.beginPath(); g.moveTo(x1, y); g.lineTo(x2, y); g.stroke();
  }
  // lane dividers + edges
  for (let i = 1; i < 4; i++) {
    g.strokeStyle = rgba(mix(P, WHITE, i === 2 ? .4 : 0), (i === 2 ? .35 : .2) + heat * .2 + feverT * .35 * (.5 + .5 * pulse)); g.lineWidth = 1 + feverT;
    g.beginPath(); tracePts(path(-half + laneW * i, ds)); g.stroke();
  }
  const edgeA = Math.min(1, .65 + .35 * pulse * inten + heat * .15 + feverT * .3 + dropBoost * .4);
  const ew = 2.4 * (1 + feverT * .5 + dropBoost * 1.3), hot = Math.min(1, feverT * pulse * .55 + dropBoost * .5);
  glowPath(Lp, mix(P, WHITE, hot), ew, edgeA);
  glowPath(Rp, mix(S, WHITE, hot), ew, edgeA);
  // hit line
  const [hx1] = proj(-half, 0), [hx2] = proj(half, 0);
  // the hit line heats up with the combo: ice blue, through the track colour, to white-hot
  const hc = heat < .5 ? mix([170, 240, 255], mix(S, WHITE, .25), heat * 2) : mix(mix(S, WHITE, .25), [255, 250, 235], (heat - .5) * 2);
  glowLine(hx1 - 8, hitY, hx2 + 8, hitY, hc, 2 + heat * 1.6 * (.7 + .3 * pulse), .85 + .15 * pulse);
  g.globalCompositeOperation = 'source-over';
  drawLaneWaves();
}

function noteQuad(l, d, td, inset) {
  const xl = -roadW / 2 + laneW * l + laneW * inset, xr = xl + laneW * (1 - 2 * inset);
  const a = proj(xl, d), b = proj(xr, d), c = proj(xr, d + td), e = proj(xl, d + td);
  return [[a[0], a[1]], [b[0], b[1]], [c[0], c[1]], [e[0], e[1]]];
}
function drawTap(l, d, col, alpha, boost = 0) {
  const s = 1 / (1 + K * Math.max(d, -.2)), q = noteQuad(l, d, .045, .07);
  g.globalCompositeOperation = 'lighter';
  g.lineJoin = 'round';
  poly(q); g.strokeStyle = rgba(col, .16 * alpha); g.lineWidth = 16 * s; g.stroke();
  g.strokeStyle = rgba(col, .35 * alpha); g.lineWidth = 6 * s; g.stroke();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = rgba(col.map(v => v * .35), .95 * alpha); g.fill();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = rgba(col, alpha); g.lineWidth = 2.2 * s + .6; g.stroke();
  const mY = (q[0][1] + q[3][1]) / 2, mxl = (q[0][0] + q[3][0]) / 2, mxr = (q[1][0] + q[2][0]) / 2, pad = (mxr - mxl) * .16;
  g.strokeStyle = `rgba(255,255,255,${(.85 + boost) * alpha})`; g.lineWidth = 2.4 * s + .5;
  g.beginPath(); g.moveTo(mxl + pad, mY); g.lineTo(mxr - pad, mY); g.stroke();
  g.globalCompositeOperation = 'source-over';
}
function drawHold(n, t, d0, d1, col, alpha) {
  const l = n.lane, inset = .27, ds = dSpan(d0, d1, 12);
  const lp = path(-roadW / 2 + laneW * (l + inset), ds), rp = path(-roadW / 2 + laneW * (l + 1 - inset), ds);
  g.globalCompositeOperation = 'lighter';
  const gr = g.createLinearGradient(0, lp[0][1], 0, lp[lp.length - 1][1] - .01);
  gr.addColorStop(0, rgba(col, (n.holding ? .45 : .26) * alpha)); gr.addColorStop(1, rgba(col, .06 * alpha));
  g.fillStyle = gr; fillBand(lp, rp);
  glowPath(lp, col, 1.6, .85 * alpha);
  glowPath(rp, col, 1.6, .85 * alpha);
  // energy chevrons flowing toward the player
  const sp = .16, off = (t * 1.4) % sp;
  for (let d = d0 + sp - off; d < d1 - .02; d += sp) {
    const s = 1 / (1 + K * d), [a] = proj(-roadW / 2 + laneW * (l + inset), d), [b] = proj(-roadW / 2 + laneW * (l + 1 - inset), d), y = yAt(d);
    g.strokeStyle = rgba(col, .6 * alpha * Math.min(1, s * 2)); g.lineWidth = 1.5 * s + .4;
    g.beginPath(); g.moveTo(a + 3 * s, y); g.lineTo((a + b) / 2, y + 6 * s); g.lineTo(b - 3 * s, y); g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  drawTap(l, d1, col, alpha * .8);
}

// a held note burns away at the hit line: hot plate + flickering flame tongues
function drawBurn(l, t) {
  const c = LC[l], hot = mix(c, WHITE, .55), fl = .78 + .22 * Math.sin(t * 43 + l * 2);
  const q = noteQuad(l, -.012, .03, .04);
  g.globalCompositeOperation = 'lighter';
  poly(q); g.fillStyle = rgba(c, .5 * fl); g.fill();
  g.strokeStyle = rgba(hot, fl); g.lineWidth = 3; g.stroke();
  const [x, y] = proj(laneX(l), 0), w = laneW * .78, fh = Math.min(80, H * .09);
  const fg = g.createLinearGradient(0, y, 0, y - fh);
  fg.addColorStop(0, rgba(hot, .6 * fl)); fg.addColorStop(.5, rgba(c, .25 * fl)); fg.addColorStop(1, rgba(c, 0));
  g.fillStyle = fg; g.beginPath(); g.moveTo(x - w / 2, y);
  for (let i = 0; i <= 8; i++) {
    const xx = x - w / 2 + w * i / 8, hh = fh * (i % 2 ? 1 : .45) * (.55 + .45 * Math.sin(t * 27 + i * 1.9 + l)) * (1 - Math.abs(i / 8 - .5) * .9);
    g.lineTo(xx, y - hh);
  }
  g.lineTo(x + w / 2, y); g.closePath(); g.fill();
  g.globalCompositeOperation = 'source-over';
}
function drawNotes(t) {
  const dMax = 1.25;
  // occlusion: notes behind a hill crest fade out until they come over the top
  const occ = []; let m = Infinity;
  for (let i = 0; i <= 70; i++) { m = Math.min(m, yAt(i * .02)); occ.push(m); }
  const vis = d => { if (d <= 0 || d >= 1.4) return 1; const over = yAt(d) - occ[Math.floor(d / .02)]; return clamp(1 - (over - 1) / 10, 0, 1); };
  // chord connectors: a light bar joining notes you hit together (drawn under the notes)
  g.globalCompositeOperation = 'lighter';
  for (const c of chords) {
    if (c.a.judged || c.b.judged) continue;
    const d = (c.a.t - t) / LOOK; if (d > dMax || d < dBottom) continue;
    const a = clamp((dMax - d) / .3, 0, 1) * vis(d), s = 1 / (1 + K * Math.max(d, 0));
    const x0 = laneX(Math.min(c.a.lane, c.b.lane)), x1 = laneX(Math.max(c.a.lane, c.b.lane)), pts = [];
    for (let i = 0; i <= 8; i++) pts.push(proj(x0 + (x1 - x0) * i / 8, d + .0225));
    glowPath(pts, [235, 245, 255], 2.2 * s + .5, .6 * a);
  }
  g.globalCompositeOperation = 'source-over';
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.done) continue;
    const d0 = (n.t - t) / LOOK, d1 = (n.endT - t) / LOOK;
    if (d0 > dMax + .1) continue;
    if ((n.hold ? d1 : d0) < dBottom) continue;
    if (!n.hold && n.judged && !n.missed) continue;
    const fade = clamp((dMax - d0) / .3, 0, 1) * (n.holding ? 1 : vis(d0));
    if (fade <= 0 && !n.hold) continue;
    const dead = n.missed || n.broken, col = dead ? [80, 90, 110] : LC[n.lane], alpha = fade * (dead ? .45 : 1);
    if (n.hold) {
      const start = n.holding ? 0 : d0;
      if (Math.min(d1, dMax) > start) drawHold(n, t, start, Math.min(d1, dMax), col, alpha);
      if (!n.holding && !(n.judged && !dead)) drawTap(n.lane, d0, col, alpha);
      if (n.holding) drawBurn(n.lane, t);
    } else drawTap(n.lane, d0, col, alpha);
  }
}

/* ---------- light cycle ---------- */
const bike = { X: 0, v: 0, target: 0, flash: 0, trail: [] };
const TRAIL_MS = 650;
function bikeUpdate(dt, live, t) {
  if (!live) bike.target = Math.sin(t * .6) * laneW * 1.1 + Math.sin(t * 1.7) * laneW * .3; // idle weave on menus
  const k = 220, c = 2 * Math.sqrt(k) * .9; // near-critically damped spring toward the last lane pressed
  bike.v += ((bike.target - bike.X) * k - bike.v * c) * dt; bike.X += bike.v * dt;
  bike.flash = Math.max(0, bike.flash - dt * 4);
  const now = performance.now();
  bike.trail.unshift({ X: bike.X, at: now });
  while (bike.trail.length > 2 && now - bike.trail[bike.trail.length - 1].at > TRAIL_MS) bike.trail.pop();
}
function rrect(x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function glowStroke(col, w, a) { // stroke current path: wide soft pass + crisp pass
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = rgba(col, a * .3); g.lineWidth = w * 3.5; g.stroke();
  g.strokeStyle = rgba(col, a); g.lineWidth = w; g.stroke();
  g.globalCompositeOperation = 'source-over';
}
// rides below the hit line, seen from a chase cam; trail is a light wall running back toward the camera
function drawBike(t, pulse, ignite, enter) {
  if (!(H > 0) || !(hitY > horY)) return; // zero-size viewport (e.g. hidden pane): nothing to draw
  const yB = hitY + (H - hitY) * .66, sB = (yB - horY) / (hitY - horY), dB = (1 / sB - 1) / K;
  const col = P, hot = mix(P, WHITE, .45 + feverT * .3 + bike.flash * .3), tail = S;
  const span = dBottom - .03 - dB;
  g.save(); g.translate(0, enter * H * .35);
  // trail wall
  if (bike.trail.length > 1 && ignite > 0) {
    const now = performance.now(), wallH = laneW * .26, tops = [], bots = [];
    for (const p of bike.trail) {
      const age = (now - p.at) / TRAIL_MS; if (age > ignite) break;
      const [x, y, s] = proj(p.X, dB + span * age);
      tops.push([x, y - wallH * s]); bots.push([x, y]);
    }
    if (tops.length > 1) {
      g.globalCompositeOperation = 'lighter';
      const gr = g.createLinearGradient(0, tops[0][1], 0, bots[0][1]);
      gr.addColorStop(0, rgba(col, .5 + feverT * .2)); gr.addColorStop(1, rgba(col, .1));
      g.fillStyle = gr; fillBand(tops, bots);
      glowPath(tops, hot, 2, .9);
      g.strokeStyle = rgba(col, .45); g.lineWidth = 1; g.beginPath(); tracePts(bots); g.stroke();
      g.globalCompositeOperation = 'source-over';
    }
  }
  // the bike
  const [bx, by0, s] = proj(bike.X, dB);
  const u = Math.min(laneW * s / 70, (H - hitY) / 66), by = by0 - pulse * 2.2 * u; // sized to fit under the hit line
  const lean = clamp(bike.v / (laneW * 20), -.4, .4);
  g.translate(bx, by); g.rotate(lean);
  g.globalCompositeOperation = 'lighter'; // ground glow
  g.save(); g.scale(1, .28);
  const gg = g.createRadialGradient(0, 0, 0, 0, 0, 34 * u); gg.addColorStop(0, rgba(col, .55 + bike.flash * .3)); gg.addColorStop(1, rgba(col, 0));
  g.fillStyle = gg; g.beginPath(); g.arc(0, 0, 34 * u, 0, 7); g.fill(); g.restore();
  g.globalCompositeOperation = 'source-over';
  // rear wheel, edge-on
  rrect(-6 * u, -24 * u, 12 * u, 24 * u, 6 * u); g.fillStyle = '#02060c'; g.fill(); glowStroke(hot, 1.6 * u, 1);
  g.beginPath(); g.moveTo(0, -20 * u); g.lineTo(0, -4 * u); glowStroke(col, 1.2 * u, .8);
  // body / canopy
  poly([[-16 * u, -15 * u], [-12 * u, -30 * u], [-5 * u, -36 * u], [5 * u, -36 * u], [12 * u, -30 * u], [16 * u, -15 * u], [9 * u, -8 * u], [-9 * u, -8 * u]]);
  g.fillStyle = 'rgba(2,6,14,.96)'; g.fill(); glowStroke(col, 1.5 * u, .95);
  // rider helmet
  g.beginPath(); g.ellipse(0, -39 * u, 6 * u, 5 * u, 0, 0, 7); g.fillStyle = '#02050b'; g.fill(); glowStroke(hot, 1.2 * u, .9);
  // light lines + tail light
  g.beginPath(); g.moveTo(-13 * u, -22 * u); g.lineTo(13 * u, -22 * u); glowStroke(hot, 1.4 * u, 1);
  g.beginPath(); g.moveTo(-11 * u, -29 * u); g.lineTo(-15 * u, -16 * u); g.moveTo(11 * u, -29 * u); g.lineTo(15 * u, -16 * u); glowStroke(col, 1 * u, .8);
  g.beginPath(); g.moveTo(-7 * u, -12 * u); g.lineTo(7 * u, -12 * u); glowStroke(tail, 2.4 * u, 1);
  g.restore();
}

function drawReceptors() {
  g.font = '700 11px Orbitron, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let l = 0; l < 4; l++) {
    const q = noteQuad(l, -.012, .024, .06), c = LC[l], p = pressFx[l];
    g.globalCompositeOperation = 'lighter';
    poly(q); g.fillStyle = rgba(c, .08 + heat * .12 + .35 * p); g.fill();
    g.strokeStyle = rgba(mix(c, WHITE, heat * .35), Math.min(1, .5 + heat * .25 + .5 * p)); g.lineWidth = 1.5 + heat; g.stroke();
    const f = flashFx[l];
    if (f > .01) { // vertical beam
      const xl = q[0][0], xr = q[1][0], top = hitY - H * .42 * f;
      const gr = g.createLinearGradient(0, hitY, 0, top); gr.addColorStop(0, rgba(c, .55 * f)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr; g.fillRect(xl, top, xr - xl, hitY - top);
    }
    g.globalCompositeOperation = 'source-over';
    if (inputMode !== 'touch') g.fillStyle = rgba(c, .5 + .5 * p), g.fillText(laneLabels()[l], (q[0][0] + q[1][0]) / 2, hitY + 1); // label inside the pad
  }
}

// hit feedback: PERFECT (and a finished hold) sends a shockwave racing up the lane; every hit breaks the
// note into glass chips that fly off up the road, shrinking as they go
// heat: 0..1, the hit line and lanes warm up as the combo grows · tension: 0..1 across the build (see main.js)
let laneWaves = [], chips = [], heat = 0, tension = 0;
function hitFx(l, power) {
  const [x, y, s] = proj(laneX(l), 0), c = LC[l];
  flashFx[l] = 1;
  rings.push({ x, y, r: laneW * .25, life: 1, col: c });
  for (let i = 0; i < 16 * power * (1 + feverT * .7); i++) spark(x + (Math.random() - .5) * laneW * .6, y, c, 1.4 * power, 1);
  if (power >= 1) laneWaves.push({ l, life: 1, col: c });
  const n = (lite() ? 4 : 7) + (power >= 1 ? 2 : 0);
  for (let i = 0; i < n; i++) {
    const side = (Math.random() - .5) * 2;
    chips.push({ x: x + side * laneW * .35, y: y - 2, vx: side * (90 + Math.random() * 160), vy: -(260 + Math.random() * 380) * (.7 + .3 * power), rot: Math.random() * 6, vr: (Math.random() - .5) * 16, sz: laneW * (.05 + Math.random() * .05), life: 1, col: Math.random() < .3 ? mix(c, WHITE, .6) : c });
  }
}
function drawLaneWaves() { // a bright band racing from the hit line up the lane
  if (!laneWaves.length) return;
  g.globalCompositeOperation = 'lighter';
  for (const w of laneWaves) {
    const k = 1 - w.life, d = k * k * .3 + k * 1.1, a = w.life * w.life; // fast off the line, easing as it goes
    const q = noteQuad(w.l, d, .035, 0), wk = noteQuad(w.l, Math.max(0, d - .3), Math.min(d, .3), 0); // thin front + a trail back to the line
    const gr = g.createLinearGradient(0, wk[0][1], 0, wk[3][1]); gr.addColorStop(0, rgba(w.col, 0)); gr.addColorStop(1, rgba(w.col, .22 * a));
    poly(wk); g.fillStyle = gr; g.fill();
    poly(q); g.fillStyle = rgba(mix(w.col, WHITE, .5), .9 * a); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}
function spark(x, y, col, pow, life) {
  const a = -Math.PI / 2 + (Math.random() - .5) * 2.2, v = (120 + Math.random() * 380) * pow;
  const c = Math.random() < .3 ? WHITE : col;
  particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, col: c, ck: c.join() });
}
function drawFx(dt) {
  g.globalCompositeOperation = 'lighter';
  // sparks batched per colour and alpha step: a few strokes instead of one per spark
  if (particles.length > 600) particles.splice(0, particles.length - 600);
  const groups = new Map(); let keep = 0;
  for (const p of particles) {
    p.life -= dt * 1.8; p.vy += 600 * dt; p.vx *= .97; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life <= 0) continue;
    particles[keep++] = p;
    let grp = groups.get(p.ck); if (!grp) groups.set(p.ck, grp = { col: p.col, lv: lvPaths() });
    const path = grp.lv[Math.ceil(p.life / p.max * ALV)];
    path.moveTo(p.x, p.y); path.lineTo(p.x - p.vx * .03, p.y - p.vy * .03);
  }
  particles.length = keep;
  g.lineWidth = 1.6;
  for (const grp of groups.values()) for (let i = 1; i <= ALV; i++) { g.strokeStyle = rgba(grp.col, i / ALV); g.stroke(grp.lv[i]); }
  for (const r of rings) {
    r.life -= dt * 2.6; r.r += dt * 260;
    g.strokeStyle = rgba(r.col, Math.max(0, r.life)); g.lineWidth = 2.5 * r.life + .5;
    g.beginPath(); g.ellipse(r.x, r.y, r.r, r.r * .3, 0, 0, 7); g.stroke();
  }
  rings = rings.filter(r => r.life > 0);
  let keep2 = 0;
  for (const w of laneWaves) { w.life -= dt * 2.6; if (w.life > 0) laneWaves[keep2++] = w; }
  laneWaves.length = keep2; keep2 = 0;
  for (const p of chips) {
    p.life -= dt * 2.4; if (p.life <= 0) continue;
    chips[keep2++] = p;
    p.vx *= .96; p.vy *= .965; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.sz *= 1 - dt * 1.6; // flying away up the road
    const c = Math.cos(p.rot) * p.sz, s = Math.sin(p.rot) * p.sz * .55;
    poly([[p.x + c, p.y + s], [p.x - s, p.y + c * .55], [p.x - c, p.y - s], [p.x + s, p.y - c * .55]]);
    g.fillStyle = rgba(p.col, .35 * p.life); g.fill();
    g.strokeStyle = rgba(mix(p.col, WHITE, .5), p.life); g.lineWidth = 1.2; g.stroke();
  }
  chips.length = keep2;
  g.globalCompositeOperation = 'source-over';
  for (let l = 0; l < 4; l++) { flashFx[l] = Math.max(0, flashFx[l] - dt * 4); if (!held[l]) pressFx[l] = Math.max(0, pressFx[l] - dt * 6); }
}

function glowText(txt, x, y, font, col, a, blur = 18, core = .6) {
  const c = rgba(col, 1); drawText(txt, x, y, font, c, c, blur, core, a);
}
// HUD motion: the score rolls up instead of jumping, the multiplier punches when it steps up, banners slam in
const hud = { score: 0, scorePop: 0, mult: 1, multPop: 0 };
// score digits: one cached glow sprite per digit in fixed-width cells, so a rolling score never makes new sprites
function drawDigits(str, x, y, font, fill, shadow, blur, sc) {
  g.font = font; let adv = 0; for (let i = 0; i < 10; i++) adv = Math.max(adv, g.measureText(String(i)).width);
  g.save(); g.translate(x, y); g.scale(sc, sc);
  for (let i = 0; i < str.length; i++) { const s = textSprite(str[i], font, fill, shadow, blur, 0, 'center', 'top'); g.drawImage(s.c, adv * (i + .5) - s.ax, -s.ay, s.w, s.h); }
  g.restore();
}
function drawHUD(t) {
  const now = performance.now(), dt = frameDt;
  if (score < hud.score) hud.score = score; // new run
  if (score > hud.score) { const gap = score - hud.score; hud.score += Math.max(gap * Math.min(1, dt * 9), Math.min(gap, 400 * dt)); hud.scorePop = Math.min(1, hud.scorePop + gap / 2000); }
  hud.scorePop = Math.max(0, hud.scorePop - dt * 4); hud.multPop = Math.max(0, hud.multPop - dt * 2.5);
  // judgement
  if (judgeText) {
    const age = (performance.now() - judgeText.t) / 1000;
    if (age < .6) {
      const sc = 1 + .35 * Math.max(0, 1 - age / .09), a = age < .4 ? 1 : 1 - (age - .4) / .2;
      g.save(); g.translate(cx, hitY - (hitY - horY) * .2); g.scale(sc, sc);
      // judgement text: softer than other HUD glow so it doesn't flare under bloom
      glowText(judgeText.text, 0, 0, `900 ${Math.round(Math.min(34, W * .07))}px Orbitron, sans-serif`, judgeText.col, a * .62, 9, .12);
      if (judgeText.sub) glowText(judgeText.sub, 0, 28, '700 12px Orbitron, sans-serif', judgeText.sub === 'EARLY' ? [90, 180, 255] : [255, 130, 70], a * .65, 5, 0);
      g.restore();
    }
  }
  // combo
  const m = mult();
  if (m > hud.mult) hud.multPop = 1;
  hud.mult = m;
  if (combo >= 5) {
    const y = horY + (hitY - horY) * .3;
    glowText(String(combo), cx, y, `900 ${Math.round(Math.min(72, W * .14))}px Orbitron, sans-serif`, [0, 230, 255], .55, 24);
    glowText('COMBO', cx, y + Math.min(44, W * .085), '700 12px Orbitron, sans-serif', [255, 170, 60], .8, 10);
  }
  // score / acc / multiplier
  const hx = 20 + SAFE.l, hy = 18 + SAFE.t, rx = W - SAFE.r - 66;
  drawDigits(Math.round(hud.score).toString().padStart(7, '0'), hx, hy, '700 22px Orbitron, sans-serif', '#e8fdff', 'rgba(0,234,255,.8)', 12, 1 + .08 * hud.scorePop);
  g.font = '500 12px Orbitron, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = 'rgba(140,210,235,.85)';
  const acc = resolved ? accSum / resolved * 100 : 100;
  g.fillText(`ACC ${acc.toFixed(1)}%`, hx + 1, hy + 30);
  const mp = hud.multPop, ms = 1 + .7 * mp * mp; // the multiplier punches out when it steps up
  g.save(); g.translate(rx, hy + 11); g.scale(ms, ms);
  drawText('×' + m, 0, -11, '900 22px Orbitron, sans-serif', m > 1 ? '#ffb24a' : 'rgba(255,178,74,.4)', 'rgba(255,150,40,.9)', 12, 0, 1, 'right', 'top');
  g.restore();
  if (feverT > .05) glowText('FEVER', rx - 26, hy + 38, '900 14px Orbitron, sans-serif', [255, 190, 90], feverT * (.65 + .35 * Math.sin(performance.now() / 80)), 14);
  // progress
  const prog = clamp(t / lastEnd, 0, 1), px1 = cx - roadW / 2, pw = roadW;
  const py = 12 + SAFE.t;
  g.fillStyle = 'rgba(0,180,255,.15)'; g.fillRect(px1, py - 1, pw, 2);
  g.globalCompositeOperation = 'lighter';
  glowLine(px1, py, px1 + pw * prog, py, [0, 230, 255], 2, .9);
  g.globalCompositeOperation = 'source-over';
  // countdown
  if (t < 0) {
    const n = Math.ceil(-t / SPB);
    if (n <= 4) glowText(String(n), cx, horY + (hitY - horY) * .32, '900 64px Orbitron, sans-serif', [255, 170, 60], .9 * (1 - ((-t / SPB) % 1)), 26);
  }
  // banner (FEVER / combo milestones)
  if (banner) {
    const age = (performance.now() - banner.t) / 1000;
    if (age < 1.3) {
      // slam: drops in from 3× size, lands at .12 s with a jolt and a small bounce, then stretches out sideways
      let sx, sy, a;
      if (age < .12) { const k = age / .12; sx = sy = 3 - 2 * k * k; a = k; }
      else if (age < 1) { sx = sy = 1 - .1 * Math.sin(Math.PI * clamp((age - .12) / .2, 0, 1)) * Math.exp(-(age - .12) * 6); a = 1; }
      else { const k = (age - 1) / .3; sx = 1 + 1.4 * k * k; sy = 1 - .7 * k; a = 1 - k; }
      if (age >= .12 && !banner.hit) { banner.hit = true; shake = Math.max(shake, 5); }
      const by = horY + (hitY - horY) * .12;
      if (age >= .12 && age < .5) { // impact streaks either side
        const k = (age - .12) / .38, w = Math.min(W * .45, 360) * (.4 + .6 * k);
        g.globalCompositeOperation = 'lighter';
        glowLine(cx - w, by, cx - w * .45, by, banner.col, 2, 1 - k); glowLine(cx + w * .45, by, cx + w, by, banner.col, 2, 1 - k);
        g.globalCompositeOperation = 'source-over';
      }
      g.save(); g.translate(cx, by); g.scale(sx, sy);
      glowText(banner.text, 0, 0, `900 ${Math.round(Math.min(46, W * .085))}px Orbitron, sans-serif`, banner.col, a, 30);
      g.restore();
    } else banner = null;
  }
  // timing bar: where your recent hits landed (left = early, right = late)
  const tbW = Math.min(180, roadW * .5), tbY = H - 14 - SAFE.b, hw = tbW / 2;
  g.fillStyle = 'rgba(255,160,40,.3)'; g.fillRect(cx - hw, tbY - 1, tbW, 2);
  g.fillStyle = 'rgba(60,150,255,.55)'; g.fillRect(cx - hw * WIN.great / WIN.good, tbY - 1, tbW * WIN.great / WIN.good, 2);
  g.fillStyle = 'rgba(0,234,255,.9)'; g.fillRect(cx - hw * WIN.perfect / WIN.good, tbY - 1, tbW * WIN.perfect / WIN.good, 2);
  g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(cx - .5, tbY - 6, 1, 12);
  g.globalCompositeOperation = 'lighter';
  for (const h of hitLog) {
    const age = (now - h.at) / 1000; if (age > 4) continue;
    const ad = Math.abs(h.d), col = ad <= WIN.perfect ? [0, 234, 255] : ad <= WIN.great ? [60, 150, 255] : [255, 160, 40];
    g.fillStyle = rgba(col, 1 - age / 4); g.fillRect(cx + clamp(h.d / WIN.good, -1, 1) * hw - 1, tbY - 5, 2, 10);
  }
  g.globalCompositeOperation = 'source-over';
  g.font = '500 9px Orbitron, sans-serif'; g.fillStyle = 'rgba(140,200,230,.45)'; g.textBaseline = 'middle';
  g.textAlign = 'right'; g.fillText('EARLY', cx - hw - 8, tbY); g.textAlign = 'left'; g.fillText('LATE', cx + hw + 8, tbY);
}
