// VIBIO · Game state, title preview, start/finish, results, calibration, judging.
// Plain script (not a module) so index.html also works opened straight from disk; files share globals and load in order.
'use strict';

/* =========================================================
   GAME STATE
   ========================================================= */
const WIN = { perfect: .045, great: .09, good: .135 };
const LEAD_IN = 3.6, FLY = 1.6, K = 3.6, BASE_LOOK = 1.55; // lead-in = camera fly-in (FLY s) + count-in
let speed = 1; try { speed = Math.min(2, Math.max(.6, +localStorage.getItem('vibio.speed') || 1)); } catch (e) { }
let LOOK = BASE_LOOK / speed; // seconds a note is visible before the hit line
function setSpeed(dv) {
  speed = Math.min(2, Math.max(.6, Math.round((speed + dv) * 10) / 10)); LOOK = BASE_LOOK / speed;
  try { localStorage.setItem('vibio.speed', String(speed)); } catch (e) { }
  refreshTitle();
}
const LC = [[0, 234, 255], [40, 140, 255], [255, 160, 40], [255, 72, 36]];
const KEYLBL = ['D', 'F', 'J', 'K'];
const KEYMAP = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const DIFFS = ['EASY', 'NORMAL', 'HARD'];
let diffIdx = 1;
// Daily challenge: ?daily=2026-11-15&track=blackice&diff=HARD (Pixo picks them from the date, the
// same for every player). The title screen locks that track and difficulty; speed and timing
// offset stay yours. Results still count for your own bests.
const DAILY = (() => {
  const q = new URLSearchParams(location.search), day = q.get('daily');
  const song = SONGS.findIndex(s => !s.custom && s.id === q.get('track')), diff = DIFFS.indexOf(q.get('diff'));
  return /^\d{4}-\d{2}-\d{2}$/.test(day || '') && song >= 0 && diff >= 0 ? { day, song, diff } : null;
})();
let state = 'title';
let startTime = 0, latency = 0, evIdx = 0, lastEnd = 0;
let notes = [], laneNotes = [[], [], [], []], lanePtr = [0, 0, 0, 0], activeHold = [null, null, null, null];
let held = [false, false, false, false], pressFx = [0, 0, 0, 0], flashFx = [0, 0, 0, 0];
let resolved = 0, score = 0, combo = 0, maxCombo = 0, accSum = 0, judgeable = 0, counts = { p: 0, g: 0, o: 0, m: 0 };
let judgeText = null, particles = [], rings = [], cycles = [], lastBar = -99, dropFlash = 0, shake = 0;
let chords = [], allHits = [], resAvgMs = 0;
let fever = false, feverT = 0, banner = null, hitLog = [], punch = 0, dropBoost = 0, flare = 0, powerFx = 0, palT = 0;
let userOffset = 0; try { userOffset = +localStorage.getItem('vibio.offset') || 0; } catch (e) { }
const CYAN = [0, 215, 255], ORANGE = [255, 140, 40], WHITE = [255, 255, 255];
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
let P = CYAN.slice(), S = ORANGE.slice(); // world palette (primary / secondary), swaps in drop 2
const evLag = e => clamp((performance.now() - e.timeStamp) / 1000, 0, .1);

// Pixo (pixoarcade.com) runs the game in a frame and puts runs on its leaderboards: tell it when a
// song on a built-in track starts and when it ends. Imported songs never count. Does nothing when
// the game runs on its own.
const pixoBoard = () => (DAILY ? 'daily' : SONG.id + '-' + DIFFS[diffIdx].toLowerCase());
function pixoRun(type, data) {
  if (window.parent === window || SONG.custom) return;
  const day = DAILY && type === 'run-start' ? { day: DAILY.day } : {};
  try { window.parent.postMessage({ pixo: type, board: pixoBoard(), ...day, ...data }, location.origin); } catch (e) { }
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// best scores per song + difficulty (GRIDRUNNER keeps its original key)
const bestKey = d => 'vibio.best.' + (SONG.id === 'gridrunner' ? '' : SONG.id + '.') + d;
function loadBest(d) { try { return JSON.parse(localStorage.getItem(bestKey(d))) || null; } catch (e) { return null; } }
function saveBest(d, v) { try { localStorage.setItem(bestKey(d), JSON.stringify(v)); } catch (e) { } }
function refreshTitle() {
  if (DAILY) { if (songIdx !== DAILY.song) setSong(DAILY.song); diffIdx = DAILY.diff; } // the challenge is fixed
  const d = DIFFS[diffIdx], dc = { EASY: '#5dffb0', NORMAL: '#ffa028', HARD: '#ff4d6a' }[d];
  $('diffName').textContent = d; $('diffName').style.color = dc; $('diffName').style.textShadow = `0 0 10px ${dc}`;
  $('tNum').textContent = DAILY ? `DAILY CHALLENGE · ${DAILY.day}` : `TRACK ${String(songIdx + 1).padStart(2, '0')} / ${String(SONGS.length).padStart(2, '0')}`;
  $('tNum').classList.toggle('daily', !!DAILY);
  for (const id of ['tPrev', 'tNext', 'dPrev', 'dNext', 'importBtn', 'tDots']) $(id).style.visibility = DAILY ? 'hidden' : '';
  $('tName').textContent = SONG.title;
  $('tInfo').textContent = `${SONG.genre} · ${+SONG.bpm.toFixed(2)} BPM · ${fmtLen(SONG.custom ? SONG.buffer.duration : BARS * BAR)}`;
  $('editBtn').style.display = $('delBtn').style.display = SONG.custom && !DAILY ? '' : 'none';
  $('tDots').innerHTML = SONGS.map((s, i) => `<i class="${i === songIdx ? 'on' : ''}"></i>`).join('');
  const b = loadBest(d); $('best').textContent = b ? `BEST ${b.score.toLocaleString()} · ${b.grade} · ${b.acc}%` : 'BEST —';
  $('offVal').textContent = fmtOff(userOffset);
  $('speedName').textContent = 'SPEED ' + speed.toFixed(1) + '×';
}
const $ = id => document.getElementById(id);
function show(id) { ['title', 'pause', 'results', 'calib', 'busy', 'editor', 'padSetup'].forEach(s => $(s).classList.toggle('hidden', s !== id)); $('pauseBtn').style.display = id ? 'none' : 'block'; }

/* ---------- title preview: loops the first 8 bars of the drop ---------- */
let preview = null, pvFromIdx = 0;
function startPreview() {
  if (state !== 'title') return;
  if (!A.ctx) A.init();
  A.ctx.resume(); A.newRun();
  const now = A.ctx.currentTime;
  A.bus.gain.setValueAtTime(0, now); A.bus.gain.linearRampToValueAtTime(.45, now + 1.2);
  latency = (A.ctx.baseLatency || 0) + (A.ctx.outputLatency || 0);
  const pb = SONG.custom ? SONG.previewBar : 12;
  preview = { fromT: pb * BAR, toT: (pb + 8) * BAR };
  startTime = now + .1 - preview.fromT;
  if (SONG.custom) { // imported audio: loop 8 bars from its first drop
    const ls = SONG.offset + preview.fromT, le = Math.min(SONG.buffer.duration, ls + 8 * BAR);
    pvFromIdx = evIdx = 0; A.playBuffer(SONG.buffer, now + .1, ls, [ls, le]); return;
  }
  pvFromIdx = EV.findIndex(e => e.t >= preview.fromT - 1e-6);
  evIdx = pvFromIdx;
}
function stopPreview() { if (preview && A.bus) { A.fadeOut(.3); A.stopBuffer(400); } preview = null; }
function changeTrack(dir) {
  if (DAILY) return; // the daily challenge fixes the track
  setSong(songIdx + dir); refreshTitle();
  const box = $('tBox'); box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');
  startPreview();
}
function wake() { if (state === 'title' && !preview) startPreview(); } // first gesture unlocks audio
addEventListener('pointerdown', wake); addEventListener('keydown', wake);

let testing = null; // { from: song time } while test-playing from the editor
function startGame() {
  if (!testing && SONG.custom && !SONG.notes.length) { openEditor(SONG, songIdx); return; } // nothing to play yet
  preview = null;
  if (!A.ctx) A.init();
  A.ctx.resume();
  A.newRun();
  latency = (A.ctx.baseLatency || 0) + (A.ctx.outputLatency || 0);
  const diff = testing ? 'NORMAL' : DIFFS[diffIdx];
  const src = CHART.filter(n => diff === 'EASY' ? n.easy : diff === 'NORMAL' ? !n.hard : true).map(n => ({ t: n.beat * SPB, endT: (n.beat + n.dur) * SPB, lane: n.lane, hold: n.dur > 0 }))
    .filter(n => !testing || n.t >= testing.from - .01)
    .sort((a, b) => a.t - b.t || a.lane - b.lane);
  const busy = [-9, -9, -9, -9];
  notes = []; laneNotes = [[], [], [], []];
  for (const n of src) { if (n.t < busy[n.lane] + .09) continue; busy[n.lane] = n.endT; notes.push(n); laneNotes[n.lane].push(n); }
  lastEnd = Math.max(...notes.map(n => n.endT));
  chords = []; // notes struck together (notes are sorted by time)
  for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length && notes[j].t - notes[i].t < .002; j++) chords.push({ a: notes[i], b: notes[j] });
  judgeable = notes.reduce((s, n) => s + (n.hold ? 2 : 1), 0);
  lanePtr = [0, 0, 0, 0]; activeHold = [null, null, null, null]; held = [false, false, false, false];
  resolved = 0; score = 0; combo = 0; maxCombo = 0; accSum = 0; counts = { p: 0, g: 0, o: 0, m: 0 };
  judgeText = null; particles = []; rings = []; cycles = []; lastBar = -99;
  fever = false; feverT = 0; banner = null; hitLog = []; allHits = []; punch = dropBoost = flare = powerFx = palT = 0;
  if (document.activeElement) document.activeElement.blur(); // so SPACE can't re-trigger a hidden button
  evIdx = 0; startTime = A.ctx.currentTime + (testing ? 1.5 - testing.from : LEAD_IN);
  if (!testing) A.whoosh(false); // camera swoops down
  if (SONG.custom) A.playBuffer(SONG.buffer, startTime - SONG.offset); // audio position 0 = song time -offset
  state = 'play'; show(null);
  if (!testing) pixoRun('run-start');
}
const songTime = () => A.ctx.currentTime - startTime - latency - userOffset / 1000;

function schedule() {
  if (!A.ctx) return;
  const now = A.ctx.currentTime, horizon = now + .3;
  if (state === 'title' && preview) { // seamless loop: when the window is used up, shift time back by its length
    for (let guard = 0; guard < 4; guard++) {
      while (evIdx < EV.length && EV[evIdx].t < preview.toT && startTime + EV[evIdx].t < horizon) { const e = EV[evIdx++]; e.fn(Math.max(now, startTime + e.t)); }
      if (startTime + preview.toT < horizon) { startTime += preview.toT - preview.fromT; evIdx = pvFromIdx; } else break;
    }
    return;
  }
  if (state !== 'play') return;
  while (evIdx < EV.length && startTime + EV[evIdx].t < horizon) { const e = EV[evIdx++]; e.fn(Math.max(now, startTime + e.t)); }
}
setInterval(schedule, 25);

function pause() { if (state !== 'play') return; state = 'pause'; A.ctx.suspend(); show('pause'); }
function resume() { if (state !== 'pause') return; A.ctx.resume(); state = 'play'; show(null); }
function quit() {
  if (testing) { testing = null; if (A.bus) A.fadeOut(.2); if (A.ctx.state === 'suspended') A.ctx.resume(); backToEditor(); return; }
  if (A.bus) A.fadeOut(.3); if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume(); state = 'title'; refreshTitle(); show('title'); startPreview(); }

function finish() {
  if (testing) { testing = null; A.fadeOut(.6); fever = false; backToEditor(); return; }
  state = 'results'; A.fadeOut(2.5); fever = false;
  const acc = judgeable ? accSum / judgeable * 100 : 0, accR = Math.round(acc * 10) / 10;
  const grade = acc >= 95 ? 'S' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : acc >= 70 ? 'C' : 'D';
  score = Math.round(score);
  $('rDiff').textContent = DIFFS[diffIdx] + (DAILY ? ' · DAILY' : ''); $('rSong').textContent = SONG.title;
  animateResults({ score, p: counts.p, g: counts.g, o: counts.o, m: counts.m, acc: accR, mc: maxCombo }, grade);
  drawHist(allHits);
  const best = loadBest(DIFFS[diffIdx]), isBest = !best || score > best.score;
  if (isBest) saveBest(DIFFS[diffIdx], { score, grade, acc: accR });
  pixoRun('run-end', { score, detail: { acc: accR, grade, combo: maxCombo } });
  $('rBest').style.display = isBest ? 'block' : 'none';
  show('results');
}

/* ---------- results presentation ---------- */
function animateResults(v, grade) {
  const gEl = $('rGrade'); gEl.classList.remove('stamp'); gEl.style.opacity = 0; gEl.textContent = grade;
  const fields = [['rScore', v.score, x => Math.round(x).toLocaleString()], ['rP', v.p], ['rG', v.g], ['rO', v.o], ['rM', v.m], ['rA', v.acc, x => x.toFixed(1) + '%'], ['rC', v.mc]];
  const t0 = performance.now(), dur = 1300;
  const step = now => {
    if (state !== 'results') return;
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    for (const [id, val, f] of fields) $(id).textContent = (f || (x => Math.round(x)))(val * e);
    if (k < 1) requestAnimationFrame(step);
    else { void gEl.offsetWidth; gEl.style.opacity = ''; gEl.classList.add('stamp'); A.stamp(); shake = 8; }
  };
  requestAnimationFrame(step);
}
function drawHist(hits) {
  const c = $('hist'), dpr = Math.min(2, devicePixelRatio || 1), w = 320, h = 96, x = c.getContext('2d');
  c.width = w * dpr; c.height = h * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const N = 27, bins = new Array(N).fill(0), base = h - 16, bw = w / N;
  for (const d of hits) bins[clamp(Math.floor((d + WIN.good) / (2 * WIN.good) * N), 0, N - 1)]++;
  const mx = Math.max(1, ...bins);
  x.fillStyle = 'rgba(0,234,255,.15)'; x.fillRect(0, base, w, 1);
  bins.forEach((v, i) => {
    const ad = Math.abs(-WIN.good + (i + .5) * (2 * WIN.good / N));
    const col = ad <= WIN.perfect ? [0, 234, 255] : ad <= WIN.great ? [60, 150, 255] : [255, 160, 40];
    const bh = v / mx * (base - 8);
    x.shadowColor = rgba(col, .8); x.shadowBlur = 8; x.fillStyle = rgba(col, .85); x.fillRect(i * bw + 1, base - bh, bw - 2, bh);
  });
  x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(w / 2 - .5, 2, 1, base - 2);
  const avg = hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : 0;
  resAvgMs = Math.round(avg * 1000);
  if (hits.length) { // average marker
    const ax = w / 2 + clamp(avg / WIN.good, -1, 1) * w / 2;
    x.fillStyle = '#ffb24a'; x.beginPath(); x.moveTo(ax, base + 2); x.lineTo(ax - 5, base + 9); x.lineTo(ax + 5, base + 9); x.fill();
  }
  x.font = '500 9px Orbitron, sans-serif'; x.fillStyle = 'rgba(140,200,230,.6)'; x.textBaseline = 'bottom';
  x.textAlign = 'left'; x.fillText('EARLY', 0, h); x.textAlign = 'right'; x.fillText('LATE', w, h);
  const off = Math.abs(resAvgMs) >= 10 && hits.length >= 20;
  const verdict = hits.length < 20 ? '' : ' · ' + (!off ? 'RIGHT ON THE BEAT' : resAvgMs > 0 ? 'YOU HIT A LITTLE LATE' : 'YOU HIT A LITTLE EARLY');
  $('rAvg').textContent = hits.length ? `AVERAGE ${fmtOff(resAvgMs)}${verdict}` : '';
  const btn = $('rApply'); btn.disabled = false; btn.style.display = off ? '' : 'none';
  btn.textContent = `ADJUST TIMING OFFSET BY ${fmtOff(resAvgMs)}`;
}

/* ---------- calibration ---------- */
let cal = null;
const fmtOff = v => (v > 0 ? '+' : '') + v + ' ms';
function startCalib(again) {
  if (document.activeElement) document.activeElement.blur();
  preview = null;
  if (!A.ctx) A.init();
  A.ctx.resume(); A.newRun();
  latency = (A.ctx.baseLatency || 0) + (A.ctx.outputLatency || 0);
  const t0 = A.ctx.currentTime + 1.2, clicks = [];
  for (let i = 0; i < 24; i++) { const t = t0 + i * SPB; clicks.push(t); A.click(t, i % 4 === 0); }
  cal = { clicks, taps: [], prev: again && cal ? cal.prev : userOffset, done: false };
  state = 'calib'; show('calib');
  $('calInfo').textContent = 'LISTEN · TAP ON EVERY CLICK'; $('calVal').textContent = fmtOff(userOffset); $('calCount').textContent = '0 TAPS';
}
function calTap(lag) {
  if (!cal || cal.done) return;
  const tc = A.ctx.currentTime - lag - latency;
  let best = Infinity; for (const c of cal.clicks) { const d = tc - c; if (Math.abs(d) < Math.abs(best)) best = d; }
  if (Math.abs(best) > SPB * .45) return;
  cal.taps.push(best);
  const use = cal.taps.slice(2); // first taps are warm-up
  if (use.length >= 2) { const s = use.slice().sort((a, b) => a - b); userOffset = Math.round(s[s.length >> 1] * 1000); }
  const el = $('calVal'); el.textContent = fmtOff(userOffset); el.classList.remove('tapflash'); void el.offsetWidth; el.classList.add('tapflash');
  $('calCount').textContent = cal.taps.length + ' TAPS';
}
function calTick() {
  if (cal && !cal.done && A.ctx.currentTime > cal.clicks[cal.clicks.length - 1] + .6) {
    cal.done = true; $('calInfo').textContent = cal.taps.length >= 6 ? 'DONE · SAVE OR GO AGAIN' : 'TOO FEW TAPS · GO AGAIN';
  }
}
function calNudge(dv) { userOffset = clamp(userOffset + dv, -300, 300); $('calVal').textContent = fmtOff(userOffset); }
function calExit(save) {
  if (save) { try { localStorage.setItem('vibio.offset', String(userOffset)); } catch (e) { } }
  else if (cal) userOffset = cal.prev;
  if (A.bus) A.fadeOut(.2);
  cal = null; state = 'title'; refreshTitle(); show('title'); startPreview();
}

/* ---------- judging ---------- */
const mult = () => 1 + Math.min(3, Math.floor(combo / 12));
function comboUp() {
  combo++; maxCombo = Math.max(maxCombo, combo);
  if (!fever && mult() === 4) enterFever();
  else if (combo % 50 === 0) { A.whoosh(true); banner = { text: combo + ' COMBO', col: [0, 234, 255], t: performance.now() }; }
}
function enterFever() {
  fever = true; flare = Math.max(flare, .8); shake = Math.max(shake, 6); A.whoosh(true);
  banner = { text: 'FEVER ×4', col: [255, 170, 60], t: performance.now() };
  for (let l = 0; l < 4; l++) hitFx(l, 1);
}
function exitFever() { fever = false; powerFx = 1; shake = Math.max(shake, 12); A.powerDown(); }
function addJudge(kind, diff) {
  const map = { PERFECT: [300, 1, 'p', [120, 225, 245]], GREAT: [200, .7, 'g', [80, 170, 255]], GOOD: [100, .4, 'o', [255, 170, 60]], MISS: [0, 0, 'm', [255, 70, 60]] };
  const [pts, acc, key, col] = map[kind];
  counts[key]++; resolved++;
  if (kind === 'MISS') { if (fever) exitFever(); combo = 0; shake = Math.max(shake, 4); A.missDip(); }
  else { comboUp(); score += pts * mult(); accSum += acc; }
  const sub = diff !== undefined && kind !== 'PERFECT' ? (diff < 0 ? 'EARLY' : 'LATE') : '';
  judgeText = { text: kind, col, sub, t: performance.now() };
  rumble(kind === 'MISS' ? 'miss' : kind === 'PERFECT' ? 'perfect' : 'good');
  if (diff !== undefined) { hitLog.push({ d: diff, at: performance.now() }); if (hitLog.length > 30) hitLog.shift(); allHits.push(diff); }
}
function press(l, lag = 0) {
  if (held[l]) return;
  held[l] = true; pressFx[l] = 1; bike.target = laneX(l);
  const t = songTime() - lag, arr = laneNotes[l];
  for (let i = lanePtr[l]; i < arr.length; i++) {
    const n = arr[i];
    if (n.judged) continue;
    if (n.t - t > WIN.good) break;
    const ad = Math.abs(t - n.t);
    if (ad > WIN.good) continue;
    n.judged = true;
    addJudge(ad <= WIN.perfect ? 'PERFECT' : ad <= WIN.great ? 'GREAT' : 'GOOD', t - n.t);
    hitFx(l, ad <= WIN.perfect ? 1 : .6); bike.flash = 1;
    if (n.hold) { n.holding = true; activeHold[l] = n; A.holdOn(true); } else n.done = true;
    break;
  }
}
function release(l) {
  if (!held[l]) return;
  held[l] = false;
  const h = activeHold[l]; if (!h) return;
  const t = songTime();
  if (t >= h.endT - .16) completeHold(h); else breakHold(h);
}
function completeHold(h) {
  h.holding = false; h.done = true; activeHold[h.lane] = null;
  accSum += 1; resolved++; comboUp(); score += 150 * mult();
  hitFx(h.lane, 2); A.holdOn(activeHold.some(Boolean)); rumble('holdEnd');
  const [x, y] = proj(laneX(h.lane), 0); // release burst
  rings.push({ x, y, r: laneW * .45, life: 1.4, col: WHITE }, { x, y, r: laneW * .2, life: 1.2, col: LC[h.lane] });
}
function breakHold(h) { h.holding = false; h.broken = true; activeHold[h.lane] = null; A.holdOn(activeHold.some(Boolean)); addJudge('MISS'); }

function update(t, dt) {
  for (let l = 0; l < 4; l++) {
    const arr = laneNotes[l];
    for (let i = lanePtr[l]; i < arr.length; i++) {
      const n = arr[i];
      if (!n.judged && t - n.t > WIN.good) {
        n.judged = true; n.missed = true; addJudge('MISS');
        if (n.hold) { counts.m++; resolved++; }
      }
      if (n.t - t > WIN.good) break;
    }
    while (lanePtr[l] < arr.length && arr[lanePtr[l]].judged && !arr[lanePtr[l]].holding && t - arr[lanePtr[l]].endT > .6) lanePtr[l]++;
    const h = activeHold[l];
    if (h) {
      if (t >= h.endT) completeHold(h);
      else {
        score += dt * 90 * mult();
        const [x, y] = proj(laneX(l), 0); // embers
        for (let k = 0; k < 2; k++) spark(x + (Math.random() - .5) * laneW * .6, y, k ? mix(LC[l], WHITE, .5) : LC[l], .8, .7);
        flashFx[l] = Math.max(flashFx[l], .55);
        holdBuzz();
      }
    }
  }
  if (t > lastEnd + 2.2) finish();
}
