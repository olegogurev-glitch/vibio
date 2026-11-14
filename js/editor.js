// VIBIO · Your music: audio analysis, beat detection, auto-chart, IndexedDB storage, chart editor.
// Plain script (not a module) so index.html also works opened straight from disk; files share globals and load in order.
'use strict';

/* =========================================================
   YOUR MUSIC — import audio, find the beat, auto-chart, edit, store
   ========================================================= */
const PALS = [ // [primary, secondary, primary in drop 2, secondary in drop 2]
  [[0, 215, 255], [255, 140, 40], [255, 140, 40], [0, 215, 255]],
  [[170, 90, 255], [0, 215, 255], [255, 45, 85], [170, 90, 255]],
  [[40, 255, 170], [255, 60, 170], [255, 60, 170], [40, 255, 170]],
  [[255, 200, 60], [60, 140, 255], [255, 80, 60], [255, 200, 60]],
];
const palFor = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALS[h % PALS.length]; };
const HOP = 512; // analysis frame = 512 samples (~11.6 ms at 44.1 kHz)

function mixdown(buf) {
  const n = buf.length, out = new Float32Array(n), k = 1 / buf.numberOfChannels;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] * k; }
  return out;
}
function frameEnergy(x) {
  const n = Math.floor(x.length / HOP), e = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; const o = f * HOP; for (let i = 0; i < HOP; i++) { const v = x[o + i]; s += v * v; } e[f] = s / HOP; }
  return e;
}
function flux(e) { // onset strength: rise in log-energy, minus its local average
  const n = e.length, o = new Float32Array(n), out = new Float32Array(n), w = 20;
  for (let i = 1; i < n; i++) o[i] = Math.max(0, Math.log(e[i] + 1e-9) - Math.log(e[i - 1] + 1e-9));
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += o[i]; if (i >= 2 * w) acc -= o[i - 2 * w]; const c = i - w; if (c >= 0) out[c] = Math.max(0, o[c] - acc / (2 * w)); }
  return out;
}
async function bandEnergy(buf, type, freq) { // render a filtered copy offline, return its frame energy
  const oc = new OfflineAudioContext(1, buf.length, buf.sampleRate);
  const s = oc.createBufferSource(), f = oc.createBiquadFilter(); s.buffer = buf; f.type = type; f.frequency.value = freq;
  s.connect(f); f.connect(oc.destination); s.start();
  return frameEnergy((await oc.startRendering()).getChannelData(0));
}
async function analyzeAudio(buf, full) {
  const fps = buf.sampleRate / HOP, mono = mixdown(buf), an = { fps, dur: buf.duration, en: frameEnergy(mono) };
  const step = Math.floor(buf.sampleRate / 100), pk = new Float32Array(Math.ceil(mono.length / step)); // waveform peaks, 10 ms
  for (let i = 0; i < pk.length; i++) { let m = 0; const o = i * step, e = Math.min(mono.length, o + step); for (let j = o; j < e; j++) { const v = Math.abs(mono[j]); if (v > m) m = v; } pk[i] = m; }
  an.peaks = pk;
  if (full) { // onsets: full band + kick band + hat band
    an.onset = flux(an.en);
    an.onL = flux(await bandEnergy(buf, 'lowpass', 150));
    an.onH = flux(await bandEnergy(buf, 'highpass', 5000));
  }
  return an;
}
function foldScore(o, P, bins = 64) { // fold onsets at period P: a sharp peak = beats line up all song long
  const h = new Float32Array(bins);
  for (let i = 0; i < o.length; i++) h[((i / P) % 1 * bins) | 0] += o[i];
  let m = 0, mi = 0, tot = 0;
  for (let b = 0; b < bins; b++) { tot += h[b]; if (h[b] > m) { m = h[b]; mi = b; } }
  const a = h[(mi + bins - 1) % bins], c = h[(mi + 1) % bins], den = a - 2 * m + c, frac = den ? .5 * (a - c) / den : 0;
  return { score: m / (tot || 1), phase: (((mi + .5 + frac) / bins) % 1 + 1) % 1 };
}
function detectBeat(an) {
  const fps = an.fps, o = an.onset.map((v, i) => v + 1.5 * an.onL[i]);
  // coarse tempo: autocorrelation of the onset curve, nudged toward typical dance tempos
  const N = Math.min(o.length, Math.floor(fps * 120)), ac = [];
  const lo = Math.floor(fps * 60 / 200), hi = Math.ceil(fps * 60 / 60);
  for (let L = lo; L <= hi * 2 + 2; L++) { let s = 0; for (let i = 0; i + L < N; i++) s += o[i] * o[i + L]; ac[L] = s / (N - L); }
  let best = 0, bestL = lo;
  for (let L = lo; L <= hi; L++) {
    const bpm = 60 * fps / L, prior = Math.exp(-.5 * (Math.log2(bpm / 128) / .55) ** 2);
    const s = (ac[L] + .5 * (ac[2 * L] || 0)) * prior;
    if (s > best) { best = s; bestL = L; }
  }
  const coarse = 60 * fps / bestL;
  // fine tempo + phase: the period whose fold over the whole song is sharpest
  let fine = { score: -1 };
  for (let bpm = coarse - 2.5; bpm <= coarse + 2.5; bpm += .01) { const r = foldScore(o, 60 * fps / bpm); if (r.score > fine.score) fine = { ...r, bpm }; }
  let bpm = fine.bpm; const ri = Math.round(bpm);
  if (Math.abs(bpm - ri) < .06) { bpm = ri; fine = { ...foldScore(o, 60 * fps / bpm), bpm }; } // producers use whole-number tempos
  const spb = 60 / bpm, offset = fine.phase * spb;
  // downbeat: which of the 4 beats carries the most kick attacks
  let db = 0, dbS = -1;
  for (let k = 0; k < 4; k++) { let s = 0; for (let t = offset + k * spb; t < an.dur; t += 4 * spb) s += an.onL[Math.round(t * fps)] || 0; if (s > dbS) { dbS = s; db = k; } }
  return { bpm: Math.round(bpm * 100) / 100, offset: offset + db * spb };
}
function songSections(an, bpm, offset) { // per-bar loudness -> break / build / drop, used for visuals
  const bar = 240 / bpm, fps = an.fps, bars = Math.max(1, Math.ceil((an.dur - offset) / bar)), e = [];
  for (let b = 0; b < bars; b++) {
    const f0 = Math.max(0, Math.floor((offset + b * bar) * fps)), f1 = Math.min(an.en.length, Math.floor((offset + (b + 1) * bar) * fps));
    let s = 0; for (let f = f0; f < f1; f++) s += an.en[f]; e.push(f1 > f0 ? Math.sqrt(s / (f1 - f0)) : 0);
  }
  const srt = [...e].sort((a, b) => a - b), q = p => srt[Math.min(srt.length - 1, Math.floor(p * srt.length))];
  const lo = q(.1), hi = q(.9);
  let cat = e.map(v => { const x = (v - lo) / (hi - lo || 1); return x < .35 ? 'break' : x < .7 ? 'build' : 'drop'; });
  cat = cat.map((c, i) => [cat[i - 1] || c, c, cat[i + 1] || c].sort()[1]); // median of 3 (break < build < drop)
  const sections = cat.map((c, i) => c === 'drop' && i > bars * .55 ? 'drop2' : c);
  const isD = s => s === 'drop' || s === 'drop2', drops = [];
  sections.forEach((s, i) => { if (i > 0 && isD(s) && !isD(sections[i - 1])) drops.push(i); });
  const previewBar = Math.max(0, Math.min(drops.length ? drops[0] : e.indexOf(Math.max(...e)), bars - 8));
  return { bars, sections, drops, previewBar };
}
// density: 0 sparse · 1 normal · 2 dense (allows 16ths)
const DENS = [{ step: .5, ratio: 1.25, floor: .6 }, { step: .5, ratio: 1.05, floor: .45 }, { step: .25, ratio: .95, floor: .3 }];
function autoChart(an, bpm, offset, dens = 1) { // notes on strong onsets: kick-ish -> D/F, hat-ish -> J/K
  const D = DENS[dens], spb = 60 / bpm, fps = an.fps, n = Math.floor((an.dur - offset) / spb / D.step);
  const peak = (arr, t) => { const f = Math.round(t * fps); let m = 0; for (let k = f - 2; k <= f + 2; k++) m = Math.max(m, arr[k] || 0); return m; };
  const slots = [];
  for (let i = 0; i < n; i++) {
    const beat = i * D.step, t = offset + beat * spb, L = peak(an.onL, t), Hh = peak(an.onH, t), F = peak(an.onset, t);
    const w = beat % 1 === 0 ? 1.15 : beat % .5 === 0 ? .8 : .7; // favour on-beat, then 8ths, then 16ths
    slots.push({ beat, L, H: Hh, v: Math.max(L * 1.2, Hh, F) * w });
  }
  const vs = slots.map(s => s.v).sort((a, b) => a - b), floor = vs[Math.floor(vs.length * D.floor)] || 0;
  const out = []; let lowL = 1, highL = 3, last = -9;
  slots.forEach((s, k) => {
    let m = 0, c = 0; for (let j = Math.max(0, k - 8); j <= Math.min(slots.length - 1, k + 8); j++) { m += slots[j].v; c++; }
    const beat = s.beat;
    if (s.v < floor || s.v < m / c * D.ratio || beat - last < D.step) return;
    const lane = s.L * 1.2 >= s.H ? (lowL = lowL ? 0 : 1) : (highL = highL === 2 ? 3 : 2);
    out.push({ beat, lane, dur: 0 }); last = beat;
  });
  const endBeat = (an.dur - offset) / spb - 1; // never hold past the end of the audio
  for (let k = 0; k < out.length; k++) { // sparse passages: a note before ≥2 quiet beats becomes a long note
    const gap = (out[k + 1] ? out[k + 1].beat : Math.min(out[k].beat + 4, endBeat)) - out[k].beat;
    if (gap >= 2) out[k].dur = Math.min(4, gap - .5);
  }
  return out;
}
function makeCustomSong(rec, buf, an) {
  return { id: rec.id, title: rec.title, genre: 'YOUR TRACK', bpm: rec.bpm, offset: rec.offset, notes: rec.notes, created: rec.created,
    custom: true, buffer: buf, blob: rec.audio, an, pal: palFor(rec.title), ...songSections(an, rec.bpm, rec.offset) };
}

// ---- browser storage (IndexedDB: audio files are too big for localStorage) ----
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise(res => {
      try {
        const r = indexedDB.open('vibio', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'id' });
        r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  },
  async tx(mode, fn) {
    const db = await this.open(); if (!db) return null;
    return new Promise(res => { try { const t = db.transaction('songs', mode), q = fn(t.objectStore('songs')); t.oncomplete = () => res(q ? q.result : true); t.onerror = () => res(null); } catch (e) { res(null); } });
  },
  all() { return this.tx('readonly', s => s.getAll()).then(r => r || []); },
  put(rec) { return this.tx('readwrite', s => { s.put(rec); }); },
  del(id) { return this.tx('readwrite', s => { s.delete(id); }); },
};
async function loadCustomSongs() {
  const recs = await DB.all(); if (!recs.length) return;
  if (!A.ctx) A.init();
  for (const r of recs.sort((a, b) => a.created - b.created)) {
    try { const buf = await A.ctx.decodeAudioData(await r.audio.arrayBuffer()); SONGS.push(makeCustomSong(r, buf, await analyzeAudio(buf, false))); }
    catch (e) { console.warn('could not load', r.title, e); }
  }
}
let toastT = 0;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); }

async function importFile(file) {
  if (!file || state !== 'title') return;
  stopPreview(); state = 'busy'; show('busy'); $('busyMsg').textContent = 'LOADING AUDIO…';
  const step = msg => { $('busyMsg').textContent = msg; return new Promise(r => setTimeout(r, 30)); };
  try {
    if (!A.ctx) A.init(); A.ctx.resume();
    const buf = await A.ctx.decodeAudioData(await file.arrayBuffer());
    await step('FINDING THE BEAT…');
    const an = await analyzeAudio(buf, true), beat = detectBeat(an);
    await step('CHARTING…');
    const notes = autoChart(an, beat.bpm, beat.offset);
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().toUpperCase().slice(0, 24) || 'MY TRACK';
    openEditor({ id: null, title, bpm: beat.bpm, offset: beat.offset, notes, buffer: buf, an, blob: file }, -1);
    toast(`${beat.bpm} BPM · ${notes.length} NOTES AUTO-CHARTED · SPACE TO LISTEN, SAVE WHEN HAPPY`);
  } catch (e) {
    console.error(e); state = 'title'; show('title'); toast('COULD NOT READ THAT AUDIO FILE');
  }
}
$('importBtn').onclick = () => $('fileIn').click();
$('fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; importFile(f); };
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) importFile(f); });

/* ---------- chart editor ---------- */
const ed = { song: null, buf: null, an: null, secs: null, srcIdx: -1, pos: 0, playing: false, rec: false, t0: 0, sched: 0,
  view: -1, ppb: 70, snap: 2, sel: null, drag: null, hover: null, seeking: null, undo: [], dirty: false, held: {} };
const edc = $('edc'), eg = edc.getContext('2d');
let EW = 0, EH = 0; const RULER = 30, GUT = 44;
function edResize() { const r = edc.getBoundingClientRect(); EW = r.width; EH = r.height; edc.width = Math.max(1, EW * DPR); edc.height = Math.max(1, EH * DPR); eg.setTransform(DPR, 0, 0, DPR, 0, 0); }
addEventListener('resize', () => { if (state === 'editor') edResize(); });
const edSpb = () => 60 / ed.song.bpm;
const posToBeat = p => (p - ed.song.offset) / edSpb();
const beatToPos = b => ed.song.offset + b * edSpb();
const bx = b => GUT + (b - ed.view) * ed.ppb, xb = x => (x - GUT) / ed.ppb + ed.view;
const rowH = () => (EH - RULER) / 4;
const laneAtY = y => y < RULER ? -1 : clamp(Math.floor((y - RULER) / rowH()), 0, 3);
const snapB = b => Math.round(b * ed.snap) / ed.snap;
const fmtTime = s => Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');

function openEditor(s, srcIdx) {
  stopPreview();
  ed.song = { id: s.id, title: s.title, bpm: s.bpm, offset: s.offset, notes: s.notes.map(n => ({ ...n })), audio: s.blob, created: s.created };
  ed.buf = s.buffer; ed.an = s.an; ed.srcIdx = srcIdx; ed.pos = 0; ed.view = -1; ed.sel = null; ed.undo = []; ed.dirty = !s.id;
  ed.playing = false; ed.rec = false; ed.held = {};
  $('edTitle').value = s.title; edRetime(); syncEd();
  state = 'editor'; show('editor'); requestAnimationFrame(edResize);
}
function backToEditor() { state = 'editor'; show('editor'); requestAnimationFrame(edResize); }
function edRetime() { ed.secs = songSections(ed.an, ed.song.bpm, ed.song.offset); }
function syncEd() {
  $('edBpm').value = ed.song.bpm; $('edOff').value = Math.round(ed.song.offset * 1000); $('edSnap').value = ed.snap;
  $('edRec').classList.toggle('on', ed.rec); $('edPlay').textContent = ed.playing ? '❚❚ PAUSE' : '▶ PLAY';
}
function edPushUndo() { ed.undo.push(JSON.stringify(ed.song.notes)); if (ed.undo.length > 80) ed.undo.shift(); ed.dirty = true; }
function edUndo() { if (!ed.undo.length) return toast('NOTHING TO UNDO'); ed.song.notes = JSON.parse(ed.undo.pop()); ed.sel = null; ed.drag = null; }
function edPlace(n) { // add/keep a note, clearing whatever it overlaps in its lane
  const end = n.beat + Math.max(n.dur, .01);
  ed.song.notes = ed.song.notes.filter(o => o === n || o.lane !== n.lane || o.beat + Math.max(o.dur, .01) <= n.beat || o.beat >= end);
  if (!ed.song.notes.includes(n)) ed.song.notes.push(n);
  ed.dirty = true;
}
function edPlay(on) {
  if (!ed.buf) return;
  if (on && !ed.playing) {
    if (!A.ctx) A.init(); A.ctx.resume(); A.newRun();
    latency = (A.ctx.baseLatency || 0) + (A.ctx.outputLatency || 0);
    const pos = clamp(ed.pos, 0, Math.max(0, ed.buf.duration - .05)), when = A.ctx.currentTime + .06;
    A.playBuffer(ed.buf, when, pos); ed.t0 = when - pos; ed.sched = pos; ed.playing = true;
    if (ed.rec) edPushUndo(); // one undo step per recorded take
  } else if (!on && ed.playing) { ed.playing = false; ed.held = {}; A.fadeOut(.04); A.stopBuffer(); }
  syncEd();
}
function edSeek(pos) { const was = ed.playing; if (was) edPlay(false); ed.pos = clamp(pos, 0, ed.buf.duration); if (was) edPlay(true); }
function edSchedule() { // metronome + note ticks, scheduled slightly ahead
  const ahead = A.ctx.currentTime - ed.t0 + .2, from = ed.sched; if (ahead <= from) return; ed.sched = ahead;
  if ($('edMetro').checked) for (let b = Math.max(0, Math.ceil(posToBeat(from))); beatToPos(b) < ahead; b++) A.click(ed.t0 + beatToPos(b), b % 4 === 0, .22);
  if ($('edTicks').checked) for (const n of ed.song.notes) { const p = beatToPos(n.beat); if (p >= from && p < ahead) A.tick(ed.t0 + p, n.lane); }
}
const edNowBeat = lag => posToBeat(A.ctx.currentTime - lag - latency - userOffset / 1000 - ed.t0);
function edNoteAt(x, y) {
  const lane = laneAtY(y); if (lane < 0) return null;
  let hit = null;
  for (const n of ed.song.notes) { if (n.lane !== lane) continue; const x0 = bx(n.beat), x1 = Math.max(bx(n.beat + n.dur), x0 + 12); if (x >= x0 - 3 && x <= x1 + 3) hit = n; }
  return hit;
}

function edRender() {
  if (!ed.song) return;
  if (!EW) edResize();
  if (ed.playing) {
    ed.pos = A.ctx.currentTime - latency - ed.t0; edSchedule();
    if (ed.pos >= ed.buf.duration) { edPlay(false); ed.pos = ed.buf.duration; }
    const px = bx(posToBeat(ed.pos)); if (px > EW * .75 || px < GUT) ed.view = posToBeat(ed.pos) - (EW * .25 - GUT) / ed.ppb; // follow
  }
  const c = eg, rh = rowH();
  c.fillStyle = '#02050c'; c.fillRect(0, 0, EW, EH);
  for (let l = 0; l < 4; l++) { c.fillStyle = rgba(LC[l], l % 2 ? .03 : .055); c.fillRect(GUT, RULER + l * rh, EW - GUT, rh); }
  // waveform
  const pk = ed.an.peaks, mid = RULER + (EH - RULER) / 2, amp = (EH - RULER) * .46;
  c.fillStyle = 'rgba(120,200,255,.17)';
  for (let x = GUT; x < EW; x += 2) {
    const i0 = Math.floor(beatToPos(xb(x)) * 100), i1 = Math.floor(beatToPos(xb(x + 2)) * 100);
    if (i1 < 0 || i0 >= pk.length) continue;
    let m = 0; for (let k = Math.max(0, i0); k <= Math.min(pk.length - 1, Math.max(i0, i1)); k++) if (pk[k] > m) m = pk[k];
    const h = Math.min(1, m * 1.3) * amp; c.fillRect(x, mid - h, 2, h * 2);
  }
  // grid
  const b0 = Math.floor(xb(GUT)), b1 = Math.ceil(xb(EW));
  c.font = '500 10px Orbitron, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
  for (let b = b0; b <= b1; b++) for (let s = 0; s < ed.snap; s++) {
    const x = bx(b + s / ed.snap); if (x < GUT || ed.ppb / ed.snap < 4 && s) continue;
    const isBar = s === 0 && ((b % 4) + 4) % 4 === 0;
    c.fillStyle = isBar ? 'rgba(0,234,255,.5)' : s === 0 ? 'rgba(0,234,255,.2)' : 'rgba(0,234,255,.07)';
    c.fillRect(x, s ? RULER : RULER - (isBar ? 14 : 6), 1, EH);
    if (isBar && b >= 0 && ed.ppb * 4 > 34) { c.fillStyle = 'rgba(150,215,240,.85)'; c.fillText(String(b / 4 + 1), x + 3, 4); }
  }
  // section strip (from loudness): what the visuals will do
  const secCol = { break: [60, 90, 140], build: [40, 140, 255], drop: [255, 150, 40], drop2: [255, 60, 80] };
  for (let bar = Math.max(0, Math.floor(b0 / 4)); bar <= b1 / 4 && bar < ed.secs.bars; bar++) {
    const x0 = Math.max(GUT, bx(bar * 4)), x1 = bx(bar * 4 + 4); c.fillStyle = rgba(secCol[ed.secs.sections[bar]] || secCol.break, .7); c.fillRect(x0, RULER - 4, x1 - x0 - 1, 3);
  }
  // notes
  for (const n of ed.song.notes) {
    const x0 = bx(n.beat); if (x0 > EW) continue;
    const x1 = Math.max(bx(n.beat + n.dur), x0 + 12); if (x1 < GUT) continue;
    const y = RULER + n.lane * rh + rh * .2, h = rh * .6, col = LC[n.lane], sel = n === ed.sel;
    c.fillStyle = rgba(col, n.dur ? .3 : .85); c.fillRect(x0, y, x1 - x0, h);
    if (n.dur) { c.fillStyle = rgba(col, .95); c.fillRect(x0, y, 10, h); }
    c.strokeStyle = sel ? '#fff' : rgba(col, 1); c.lineWidth = sel ? 2 : 1; c.strokeRect(x0 + .5, y + .5, x1 - x0 - 1, h - 1);
  }
  // hover ghost: where a click would put a note
  if (ed.hover && !ed.drag && !ed.seeking) {
    const l = laneAtY(ed.hover.y);
    if (l >= 0 && ed.hover.x > GUT && !edNoteAt(ed.hover.x, ed.hover.y)) { const x = bx(snapB(xb(ed.hover.x))); c.strokeStyle = rgba(LC[l], .6); c.setLineDash([4, 3]); c.strokeRect(x + .5, RULER + l * rh + rh * .2 + .5, 11, rh * .6 - 1); c.setLineDash([]); }
  }
  // live recording: held keys draw a growing bar
  if (ed.playing && ed.rec) for (const l in ed.held) {
    const x0 = bx(snapB(ed.held[l])), x1 = bx(posToBeat(ed.pos)); c.fillStyle = rgba(LC[l], .5); c.fillRect(x0, RULER + l * rh + rh * .2, Math.max(4, x1 - x0), rh * .6);
  }
  // gutter + ruler line
  c.fillStyle = '#02050c'; c.fillRect(0, 0, GUT, EH); c.fillStyle = 'rgba(0,234,255,.3)'; c.fillRect(0, RULER, EW, 1);
  c.font = '700 12px Orbitron, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let l = 0; l < 4; l++) { c.fillStyle = rgba(LC[l], held[l] || ed.held[l] !== undefined ? 1 : .7); c.fillText(laneLabels()[l], GUT / 2, RULER + l * rh + rh / 2); }
  // playhead
  const px = bx(posToBeat(ed.pos));
  if (px >= GUT && px <= EW) {
    const pc = ed.rec ? '#ff3b4f' : '#ffb24a'; c.fillStyle = pc; c.fillRect(px - 1, 0, 2, EH);
    c.beginPath(); c.moveTo(px - 6, 0); c.lineTo(px + 6, 0); c.lineTo(px, 9); c.fill();
  }
  if (ed.rec) { c.strokeStyle = 'rgba(255,59,79,.6)'; c.lineWidth = 2; c.strokeRect(1, 1, EW - 2, EH - 2); }
  $('edInfo').textContent = `${fmtTime(Math.max(0, ed.pos))} / ${fmtTime(ed.buf.duration)} · BAR ${Math.floor(posToBeat(ed.pos) / 4) + 1} · ${ed.song.notes.length} NOTES${ed.dirty ? ' · UNSAVED' : ''}`;
}

// ---- editor input ----
edc.addEventListener('contextmenu', e => e.preventDefault());
edc.addEventListener('pointerdown', e => {
  const x = e.offsetX, y = e.offsetY; edc.setPointerCapture(e.pointerId);
  if (y < RULER) { ed.seeking = { resume: ed.playing }; edPlay(false); ed.pos = clamp(beatToPos(xb(x)), 0, ed.buf.duration); return; }
  if (x < GUT) return;
  const hit = edNoteAt(x, y);
  if (e.button === 2) { if (hit) { edPushUndo(); ed.song.notes = ed.song.notes.filter(n => n !== hit); if (ed.sel === hit) ed.sel = null; } return; }
  edPushUndo();
  if (hit) { ed.sel = hit; ed.drag = { mode: 'move', n: hit, grab: xb(x) - hit.beat }; }
  else { const n = { beat: Math.max(0, snapB(xb(x))), lane: laneAtY(y), dur: 0 }; edPlace(n); ed.sel = n; ed.drag = { mode: 'len', n }; }
});
edc.addEventListener('pointermove', e => {
  const x = e.offsetX, y = e.offsetY; ed.hover = { x, y };
  if (ed.seeking) { ed.pos = clamp(beatToPos(xb(x)), 0, ed.buf.duration); return; }
  const d = ed.drag; if (!d) return;
  if (d.mode === 'move') { d.n.beat = Math.max(0, snapB(xb(x) - d.grab)); const l = laneAtY(y); if (l >= 0) d.n.lane = l; }
  else { const b1 = snapB(xb(x)); d.n.dur = b1 - d.n.beat >= .5 ? b1 - d.n.beat : 0; }
});
const edUp = () => {
  if (ed.seeking) { const r = ed.seeking.resume; ed.seeking = null; if (r) edPlay(true); }
  if (ed.drag) { edPlace(ed.drag.n); ed.drag = null; }
};
edc.addEventListener('pointerup', edUp); edc.addEventListener('pointercancel', edUp);
edc.addEventListener('pointerleave', () => { ed.hover = null; });
edc.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { const b = xb(e.offsetX); ed.ppb = clamp(ed.ppb * Math.exp(-e.deltaY * .002), 10, 600); ed.view = b - (e.offsetX - GUT) / ed.ppb; }
  else ed.view += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / ed.ppb;
}, { passive: false });
function edKeyDown(e) {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') { if (e.code === 'Escape' || e.code === 'Enter') e.target.blur(); return; }
  const l = KEYMAP[e.code];
  if (l !== undefined) { e.preventDefault(); if (!e.repeat && ed.playing && ed.rec) ed.held[l] = edNowBeat(evLag(e)); return; }
  if (e.code === 'Space') { e.preventDefault(); edPlay(!ed.playing); }
  else if (e.code === 'KeyR') { ed.rec = !ed.rec; if (ed.rec && ed.playing) edPushUndo(); syncEd(); }
  else if ((e.code === 'Delete' || e.code === 'Backspace') && ed.sel) { e.preventDefault(); edPushUndo(); ed.song.notes = ed.song.notes.filter(n => n !== ed.sel); ed.sel = null; }
  else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); edUndo(); }
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault(); const dir = e.code === 'ArrowLeft' ? -1 : 1;
    edSeek(beatToPos(Math.round(posToBeat(ed.pos)) + dir * (e.shiftKey ? 4 : 1)));
  }
  else if (e.code === 'Home') edSeek(0);
  else if (e.code === 'Escape') edExit();
}
function edKeyUp(e) {
  const l = KEYMAP[e.code]; if (l === undefined || ed.held[l] === undefined) return;
  const b0 = ed.held[l], b1 = edNowBeat(evLag(e)); delete ed.held[l];
  const s = snapB(b0), e2 = snapB(b1), dur = b1 - b0 >= .45 && e2 - s >= .5 ? e2 - s : 0; // a real hold becomes a long note
  if (s >= 0) edPlace({ beat: s, lane: l, dur });
}

// ---- toolbar ----
$('edTitle').oninput = e => { ed.song.title = e.target.value.toUpperCase(); ed.dirty = true; };
$('edBpm').onchange = e => { const v = +e.target.value; if (v >= 40 && v <= 260) { ed.song.bpm = v; edRetime(); ed.dirty = true; } syncEd(); };
$('edOff').onchange = e => { const v = +e.target.value / 1000; if (isFinite(v)) { ed.song.offset = clamp(v, 0, ed.buf.duration - 1); edRetime(); ed.dirty = true; } syncEd(); };
const edScaleTempo = k => { // keep notes at the same times when halving/doubling the tempo
  edPushUndo(); ed.song.bpm = Math.round(ed.song.bpm * k * 100) / 100;
  ed.song.notes.forEach(n => { n.beat *= k; n.dur *= k; }); edRetime(); syncEd();
};
$('edHalf').onclick = () => edScaleTempo(.5);
$('edDouble').onclick = () => edScaleTempo(2);
const edShiftBar = dir => { // move bar lines by one beat; notes stay where they are in time
  edPushUndo(); const spb = edSpb(); let off = ed.song.offset + dir * spb, k = dir;
  if (off < 0) { off += 4 * spb; k += 4; }
  ed.song.offset = off; ed.song.notes.forEach(n => n.beat -= k); ed.song.notes = ed.song.notes.filter(n => n.beat >= 0);
  edRetime(); syncEd();
};
$('edBarL').onclick = () => edShiftBar(-1);
$('edBarR').onclick = () => edShiftBar(1);
$('edSnap').onchange = e => { ed.snap = +e.target.value; e.target.blur(); };
async function edEnsureAnalysis(btn) {
  if (ed.an.onset) return;
  const t = btn.textContent; btn.textContent = 'ANALYZING…'; await new Promise(r => setTimeout(r, 20));
  const full = await analyzeAudio(ed.buf, true); ed.an = full; btn.textContent = t;
}
$('edDetect').onclick = async e => {
  await edEnsureAnalysis(e.target); const r = detectBeat(ed.an);
  edPushUndo(); ed.song.bpm = r.bpm; ed.song.offset = r.offset; edRetime(); syncEd(); toast(`DETECTED ${r.bpm} BPM`);
};
$('edAuto').onclick = async e => {
  if (ed.song.notes.length && !confirm('Replace the current chart with an auto-generated one? (Undo can bring it back.)')) return;
  await edEnsureAnalysis(e.target); edPushUndo();
  ed.song.notes = autoChart(ed.an, ed.song.bpm, ed.song.offset, +$('edDens').value); ed.sel = null; toast(`${ed.song.notes.length} NOTES GENERATED`);
};
$('edClear').onclick = () => { if (!ed.song.notes.length || !confirm('Remove all notes? (Undo can bring them back.)')) return; edPushUndo(); ed.song.notes = []; ed.sel = null; };
$('edUndo').onclick = edUndo;
$('edPlay').onclick = e => { e.target.blur(); edPlay(!ed.playing); };
$('edRec').onclick = e => { e.target.blur(); ed.rec = !ed.rec; if (ed.rec && ed.playing) edPushUndo(); syncEd(); };
$('edTest').onclick = e => {
  e.target.blur(); edPlay(false);
  if (!ed.song.notes.length) return toast('ADD SOME NOTES FIRST');
  const s = ed.song;
  SONG = makeCustomSong({ id: 'test', title: s.title || 'TEST', bpm: s.bpm, offset: s.offset, notes: s.notes, audio: s.audio }, ed.buf, ed.an);
  applySong(); testing = { from: Math.max(0, posToBeat(ed.pos)) * edSpb() };
  startGame();
};
$('edSave').onclick = async e => {
  e.target.blur(); const s = ed.song;
  if (!s.id) s.id = 'u' + Date.now().toString(36);
  s.title = (s.title || '').trim() || 'MY TRACK'; $('edTitle').value = s.title; s.created = s.created || Date.now();
  const rec = { id: s.id, title: s.title, bpm: s.bpm, offset: s.offset, notes: s.notes.slice().sort((a, b) => a.beat - b.beat || a.lane - b.lane), audio: s.audio, created: s.created };
  const song = makeCustomSong(rec, ed.buf, ed.an), i = SONGS.findIndex(x => x.id === s.id);
  if (i >= 0) SONGS[i] = song; else SONGS.push(song);
  ed.srcIdx = SONGS.indexOf(song); ed.dirty = false;
  toast(await DB.put(rec) ? 'SAVED ✓ IT IS IN TRACK SELECT' : 'SAVED FOR THIS SESSION ONLY (BROWSER STORAGE UNAVAILABLE HERE)');
};
function edExit() {
  if (ed.dirty && !confirm('Leave the editor? Unsaved changes will be lost.')) return;
  edPlay(false); state = 'title';
  setSong(ed.srcIdx >= 0 ? ed.srcIdx : Math.min(songIdx, SONGS.length - 1)); refreshTitle(); show('title'); startPreview();
}
$('edExit').onclick = edExit;
$('editBtn').onclick = () => { if (SONG.custom) openEditor(SONG, songIdx); };
$('delBtn').onclick = async () => {
  if (!SONG.custom || !confirm(`Delete "${SONG.title}" and its chart from this browser?`)) return;
  await DB.del(SONG.id); SONGS.splice(songIdx, 1); setSong(Math.max(0, songIdx - 1)); refreshTitle(); startPreview();
};
