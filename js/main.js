// VIBIO · Main loop, input handling and startup.
// Plain script (not a module) so index.html also works opened straight from disk; files share globals and load in order.
'use strict';

/* ---------- camera moves per section ---------- */
// build: the camera sinks low and creeps in (horizon drops, view tightens) as the tension rises
// drop: it snaps back up and wide on the downbeat · break: up high, with a slow drifting sway
// fever: a gentle side-to-side tilt, one way and back every 2 bars
// Zoom is about the middle of the hit line, so the receptors stay where they are; laneFromX undoes it for touch.
const cam = { z: 1, y: 0, r: 0, k: 1 }; // zoom · horizon offset (px, + = lower camera) · roll (rad) · zoom as drawn
function camUpdate(info, t, dt, live) {
  let z = 1, y = 0, r = 0, rate = 1.4;
  if (live) {
    const s = info.s;
    if (s === 'build') { const p = clamp((t / BAR - 4) / 8, 0, 1); z = 1 + .09 * p * p; y = H * .05 * p * p; }
    else if (s === 'drop' || s === 'drop2') { y = -H * .02; rate = 5; } // fast: the snap out is the hit
    else if (s === 'break') { y = -H * .05; r = Math.sin(t * .3 + 1) * .012; rate = .7; }
    r += feverT * .022 * Math.sin(t * Math.PI / BAR);
  }
  const k = Math.min(1, dt * rate);
  cam.z += (z - cam.z) * k; cam.y += (y - cam.y) * k; cam.r += (r - cam.r) * Math.min(1, dt * 2);
  cam.k = cam.z * (1 + Math.abs(cam.r) * 1.3); // a little extra zoom while rolled, so no corner is left unpainted
}

/* ---------- build-up tension ---------- */
// Through the build the world winds up: colour drains toward grey, the sky dims, the road narrows a
// little and light cycles race past faster and thicker. On the drop it all snaps back at once.
function buildProg(t) { // 0 → 1 across the current run of build bars (imported songs have their own sections)
  const b = Math.floor(t / BAR); let s = b, e = b;
  for (let i = 0; i < 64 && s > 0 && sectionOf(s - 1) === 'build'; i++) s--;
  for (let i = 0; i < 64 && e < BARS - 1 && sectionOf(e + 1) === 'build'; i++) e++;
  return clamp((t / BAR - s) / (e + 1 - s), 0, 1);
}
let roadK = 1;
const grey = c => { const l = c[0] * .3 + c[1] * .59 + c[2] * .11; return [l, l, l]; };

/* ---------- main loop ---------- */
let lastNow = performance.now();
function frame(now) {
  requestAnimationFrame(frame); // schedule first: one bad frame must never stop the loop
  qMonitor(now);
  try { render(now); } catch (e) {
    console.error(e); // reset canvas state so the next frame starts clean
    g.setTransform(DPR, 0, 0, DPR, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0;
  }
}
function render(now) {
  const dt = clamp((now - lastNow) / 1000, 0, .05); lastNow = now; frameDt = dt;
  if (!(W > 0 && H > 0)) { schedule(); return; } // hidden / zero-size viewport: keep audio going, skip drawing
  const live = state === 'play' || state === 'pause';
  const t = live || (state === 'title' && preview) ? songTime() : now / 1000; // title visuals pulse with the preview
  if (state === 'play') update(t, dt);
  if (state === 'calib') calTick();
  const info = live ? sectionInfo(t) : { inten: .6, kickOn: true, bar: Math.floor(t / BAR), s: 'title' };
  const phase = (((t / SPB) % 1) + 1) % 1;
  const pulse = info.kickOn ? Math.exp(-phase * 6) : .25 * Math.exp(-phase * 3);
  // section events
  if (info.bar !== lastBar) {
    lastBar = info.bar;
    if (live && SONG.drops.includes(info.bar)) { dropFlash = 1; shake = 10; punch = 1; dropBoost = 1; flare = 1; if (TH().lightning) strike(); }
    else if (TH().lightning && Math.random() < (info.s === 'drop' || info.s === 'drop2' ? .45 : info.s === 'title' ? .3 : .12)) strike();
    if (info.s === 'drop' || info.s === 'drop2') { spawnCycle(t); if (Math.random() < .6) spawnCycle(t); }
    else if (info.s === 'title' || info.s === 'build' || Math.random() < .4) spawnCycle(t);
  }
  // wave energy: calm in intro/outro, sways in the breakdown, rolls hard in the drops
  const bar = t / BAR;
  const tgt = !live ? .55 : ({ drop: 1, drop2: 1.3, break: .25, build: bar >= 10 ? .3 : 0, outro: bar < 54 ? .4 : 0 }[info.s] || 0);
  wave.amp += (tgt - wave.amp) * Math.min(1, dt * 1.1);
  wave.phase = t * WAVE_W;
  wave.a = wave.amp * (1 + .12 * pulse);
  // camera pitch: horizon rises and dips as the hills pass under you
  // fly-in: 1 = camera high above at song start, eases to 0 over FLY seconds
  const flyK = live ? clamp(1 - (t + LEAD_IN) / FLY, 0, 1) : 0, fly = flyK * flyK * (3 - 2 * flyK);
  tension = live && info.s === 'build' ? Math.pow(buildProg(t), 1.6) : 0; // grows mostly late; drops to 0 on the downbeat
  roadK += ((1 - .08 * tension) - roadK) * Math.min(1, dt * 10);
  roadW = roadW0 * roadK; laneW = roadW / 4;
  camUpdate(info, t, dt, live);
  setHorizon(wave.amp * H * .03 * Math.cos(wave.phase + .6) - fly * H * .3 + cam.y);
  bikeUpdate(dt, state === 'play' || state === 'pause', t);
  // fever / drop / palette envelopes
  feverT += ((fever && state === 'play' ? 1 : 0) - feverT) * Math.min(1, dt * 3);
  palT += ((live && info.s === 'drop2' ? 1 : 0) - palT) * Math.min(1, dt * .8);
  const pal = SONG.pal; P = mix(pal[0], pal[2], palT); S = mix(pal[1], pal[3], palT);
  if (tension > 0) { P = mix(P, grey(P), tension * .7); S = mix(S, grey(S), tension * .7); } // lane colours stay: notes must read
  const heatT = state === 'play' || state === 'pause' ? clamp(combo / 60, 0, 1) : 0; // warms up over 60 hits, cools fast on a miss
  heat += (heatT - heat) * Math.min(1, dt * (heatT < heat ? 4 : 1.5));
  punch = Math.max(0, punch - dt * 1.8); dropBoost = Math.max(0, dropBoost - dt * .6);
  flare = Math.max(0, flare - dt * 1.2); powerFx = Math.max(0, powerFx - dt * 1.5);
  if (state === 'play' && feverT > .3 && Math.random() < feverT * .4) spawnStreak(t);
  if (state === 'play' && tension > .05) { if (Math.random() < tension * dt * 4) spawnCycle(t); if (Math.random() < tension * tension * .22) spawnStreak(t); }
  g.save();
  if (shake > .1) { g.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake); shake *= Math.pow(.02, dt); }
  if (punch > 0) { const z = 1 + .07 * punch * punch; g.translate(cx, horY); g.scale(z, z); g.translate(-cx, -horY); }
  if (fly > 0) { const z = 1 + fly * .45; g.translate(cx, H * .55); g.rotate(fly * .14); g.scale(z, z); g.translate(-cx, -H * .55); }
  g.save(); // the camera moves the world, not the HUD
  if (cam.k !== 1 || cam.r) { g.translate(cx, hitY); g.rotate(cam.r); g.scale(cam.k, cam.k); g.translate(-cx, -hitY); }
  drawSky(t, pulse, info.inten);
  if (tension > .01) { g.fillStyle = `rgba(0,0,0,${tension * .45})`; g.fillRect(-W, -H, W * 3, horY + H); } // the sky dims
  drawFloor(t, pulse, info.inten);
  drawWeather(live, info.inten);
  drawRoad(t, pulse, info.inten, live);
  if (live) { drawNotes(t); }
  // trail ignites as the music begins (title/results: always lit)
  drawBike(t, pulse, live ? clamp((t + .25) / .6, 0, 1) : 1, fly);
  drawReceptors();
  drawFx(dt);
  g.restore();
  if (live) drawHUD(t);
  g.restore();
  bloom(.75 + feverT * .3 + dropBoost * .35 + flare * .2);
  g.save();
  if (powerFx > 0) { g.fillStyle = `rgba(255,30,50,${powerFx * .22})`; g.fillRect(0, 0, W, H); }
  if (fly > 0) { g.fillStyle = `rgba(0,0,0,${fly * .85})`; g.fillRect(0, 0, W, H); } // fade up from black
  if (dropFlash > 0) { g.fillStyle = `rgba(160,240,255,${dropFlash * .35})`; g.fillRect(-20, -20, W + 40, H + 40); dropFlash = Math.max(0, dropFlash - dt * 2.2); }
  // vignette + scanlines
  const vg = g.createRadialGradient(cx, H * .55, Math.min(W, H) * .3, cx, H * .55, Math.max(W, H) * .8);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  drawFps();
  g.restore();
  schedule();
  if (state === 'editor') edRender();
}

/* ---------- input ---------- */
addEventListener('keydown', e => {
  if (state === 'play') {
    const l = KEYMAP[e.code];
    if (l !== undefined) { e.preventDefault(); if (!e.repeat) press(l, evLag(e)); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') pause();
  } else if (state === 'pause') {
    if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); resume(); }
    if (e.code === 'KeyQ') quit();
  } else if (state === 'title') {
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); startGame(); }
    if (e.code === 'ArrowLeft') changeTrack(-1);
    if (e.code === 'ArrowRight') changeTrack(1);
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); diffIdx = clamp(diffIdx + (e.code === 'ArrowUp' ? 1 : -1), 0, DIFFS.length - 1); refreshTitle(); }
    if (e.code === 'Minus') setSpeed(-.1);
    if (e.code === 'Equal') setSpeed(.1);
  } else if (state === 'editor') {
    edKeyDown(e);
  } else if (state === 'calib') {
    if (e.code === 'Escape') calExit(false);
    else if (e.code === 'Space' || KEYMAP[e.code] !== undefined) { e.preventDefault(); if (!e.repeat) calTap(evLag(e)); }
  } else if (state === 'results') {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') { e.preventDefault(); startGame(); }
    if (e.code === 'Escape') quit();
  }
});
addEventListener('keyup', e => {
  if (state === 'editor') return edKeyUp(e);
  const l = KEYMAP[e.code]; if (l !== undefined && state === 'play') release(l);
});
const touchLane = {};
const laneFromX = x => clamp(Math.floor((cx + (x - cx) / cam.k - (cx - roadW / 2)) / laneW), 0, 3); // undo the camera zoom
cv.addEventListener('touchstart', e => { e.preventDefault(); if (state !== 'play') return; for (const tc of e.changedTouches) { const l = laneFromX(tc.clientX); touchLane[tc.identifier] = l; press(l, evLag(e)); } }, { passive: false });
const tEnd = e => { e.preventDefault(); for (const tc of e.changedTouches) { const l = touchLane[tc.identifier]; if (l !== undefined) { delete touchLane[tc.identifier]; if (state === 'play') release(l); } } };
cv.addEventListener('touchend', tEnd, { passive: false }); cv.addEventListener('touchcancel', tEnd, { passive: false });
cv.addEventListener('mousedown', e => { if (state === 'play') { const l = laneFromX(e.clientX); cv._ml = l; press(l); } });
addEventListener('mouseup', () => { if (cv._ml !== undefined) { if (state === 'play') release(cv._ml); cv._ml = undefined; } });
addEventListener('blur', () => { for (let l = 0; l < 4; l++) if (held[l]) release(l); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); if (state === 'title') stopPreview(); } });

$('startBtn').onclick = startGame; $('retryBtn').onclick = startGame;
$('menuBtn').onclick = quit; $('quitBtn').onclick = quit; $('resumeBtn').onclick = resume; $('pauseBtn').onclick = pause;
$('dPrev').onclick = () => { diffIdx = (diffIdx + DIFFS.length - 1) % DIFFS.length; refreshTitle(); };
$('dNext').onclick = () => { diffIdx = (diffIdx + 1) % DIFFS.length; refreshTitle(); };
$('tPrev').onclick = () => changeTrack(-1); $('tNext').onclick = () => changeTrack(1);
$('sPrev').onclick = () => setSpeed(-.1); $('sNext').onclick = () => setSpeed(.1);
$('rApply').onclick = () => {
  userOffset = clamp(userOffset + resAvgMs, -300, 300);
  try { localStorage.setItem('vibio.offset', String(userOffset)); } catch (e) { }
  $('rApply').textContent = 'OFFSET NOW ' + fmtOff(userOffset) + ' ✓'; $('rApply').disabled = true;
};
$('calBtn').onclick = () => startCalib(false); $('calAgain').onclick = () => startCalib(true);
$('calSave').onclick = () => calExit(true); $('calBack').onclick = () => calExit(false);
$('offMinus').onclick = () => calNudge(-5); $('offPlus').onclick = () => calNudge(5);
$('calib').addEventListener('pointerdown', e => { if (!e.target.closest('button')) calTap(evLag(e)); });

let savedId = null; try { savedId = localStorage.getItem('vibio.song'); } catch (e) { }
setSong(Math.max(0, SONGS.findIndex(s => s.id === savedId))); refreshTitle(); show('title');
loadCustomSongs().then(() => { // imported songs arrive asynchronously (decode + analysis)
  const i = SONGS.findIndex(s => s.id === savedId);
  if (!DAILY && state === 'title' && i >= 0 && SONGS[i].custom) { setSong(i); if (preview) startPreview(); }
  if (state === 'title') refreshTitle();
});
requestAnimationFrame(frame);
