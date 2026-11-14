// VIBIO · Gamepad: lanes (default L2 / left stick down / right stick down / R2), per-controller remapping,
// menu buttons, rumble (Chrome-style vibrationActuator, Firefox-style hapticActuators fallback).
// Plain script (not a module) so index.html also works opened straight from disk; files share globals and load in order.
'use strict';

// Standard mapping: buttons 0 A · 1 B · 6 L2 · 7 R2 · 9 Start · 10 L3 · 11 R3 · 12-15 D-pad ↑↓←→ ; axes 1 left-Y · 3 right-Y
const PAD = { idx: null, id: '', active: false, binds: null, prev: [false, false, false, false], btn: {}, rumble: true, lastBuzz: 0 };
try { PAD.rumble = localStorage.getItem('vibio.rumble') !== '0'; } catch (e) { }
// a binding is a button {t:'b', i} or an axis direction {t:'a', i, dir, rest}; stick lanes also accept the stick click (alt)
const DEFAULT_BINDS = [{ t: 'b', i: 6 }, { t: 'a', i: 1, dir: 1, rest: 0, alt: 10 }, { t: 'a', i: 3, dir: 1, rest: 0, alt: 11 }, { t: 'b', i: 7 }];
const STD_NAMES = {
  b: { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'SEL', 9: 'STA', 10: 'L3', 11: 'R3', 12: '↑', 13: '↓', 14: '←', 15: '→' },
  a: { '0-': 'L←', '0+': 'L→', '1-': 'L↑', '1+': 'L↓', '2-': 'R←', '2+': 'R→', '3-': 'R↑', '3+': 'R↓' },
};
const bindName = (bd, std) => bd.t === 'b' ? (std && STD_NAMES.b[bd.i]) || 'B' + bd.i
  : (std && STD_NAMES.a[bd.i + (bd.dir > 0 ? '+' : '-')]) || 'A' + bd.i + (bd.dir > 0 ? '+' : '−');
let padLabels = ['L2', 'L↓', 'R↓', 'R2'];
let inputMode = 'keys'; // last device used: decides the lane labels and whether to rumble
addEventListener('keydown', () => { inputMode = 'keys'; }, true);
addEventListener('pointerdown', () => { inputMode = 'keys'; }, true);
const laneLabels = () => inputMode === 'pad' ? padLabels : KEYLBL;
const curPad = () => { const p = navigator.getGamepads ? navigator.getGamepads() : []; return PAD.idx != null ? p[PAD.idx] : null; };

function loadBinds(gp) {
  PAD.id = gp.id; let b = null;
  try { b = JSON.parse(localStorage.getItem('vibio.pad.' + gp.id)); } catch (e) { }
  PAD.binds = Array.isArray(b) && b.length === 4 ? b : DEFAULT_BINDS;
  padLabels = PAD.binds.map(bd => bindName(bd, gp.mapping === 'standard'));
}
// is this binding held? (hysteresis so a trigger or stick resting near the threshold can't chatter)
function bindDown(gp, bd, was) {
  if (bd.t === 'b') { const b = gp.buttons[bd.i], v = b ? Math.max(b.value || 0, b.pressed ? 1 : 0) : 0; return was ? v > .25 : v > .45; }
  const v = ((gp.axes[bd.i] || 0) - bd.rest) * bd.dir, alt = bd.alt != null && gp.buttons[bd.alt] && gp.buttons[bd.alt].pressed;
  return (was ? v > .35 : v > .6) || !!alt;
}
function laneDown(l, lag) {
  if (state === 'play') press(l, lag);
  else if (state === 'calib') calTap(lag);
  else if (state === 'editor' && ed.playing && ed.rec) ed.held[l] = edNowBeat(lag);
}
function laneUp(l, lag) {
  if (state === 'play') release(l);
  else if (state === 'editor' && ed.held[l] !== undefined) edKeyUp({ code: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'][l], timeStamp: performance.now() - lag * 1000 });
}
// gamepad presses may not count as a user gesture for audio: make sure sound is unlocked before starting
async function padStart(fn) {
  if (!A.ctx) A.init();
  try { await Promise.race([A.ctx.resume(), new Promise(r => setTimeout(r, 150))]); } catch (e) { }
  if (A.ctx.state !== 'running') return toast('CLICK OR PRESS ANY KEY ONCE TO ENABLE SOUND');
  fn();
}
function menuButton(i) {
  const A_ = i === 0, B_ = i === 1, ST = i === 9;
  if (state === 'title') {
    if (A_ || ST) padStart(startGame);
    else if (i === 14 || i === 15) changeTrack(i === 14 ? -1 : 1);
    else if (i === 12 || i === 13) { diffIdx = clamp(diffIdx + (i === 12 ? 1 : -1), 0, DIFFS.length - 1); refreshTitle(); }
  }
  else if (state === 'play') { if (ST) pause(); }
  else if (state === 'pause') { if (A_ || ST) resume(); else if (B_) quit(); }
  else if (state === 'results') { if (A_ || ST) padStart(startGame); else if (B_) quit(); }
  else if (state === 'calib') { if (B_) calExit(false); else if (ST) calExit(true); }
  else if (state === 'editor') { if (ST) edPlay(!ed.playing); }
}
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = PAD.idx != null ? pads[PAD.idx] : null;
  if (!gp || !gp.connected) {
    gp = [...pads].find(p => p && p.connected);
    if (!gp) { if (PAD.active) padGone(); return; }
    PAD.idx = gp.index;
  }
  if (gp.id !== PAD.id || !PAD.binds) { loadBinds(gp); refreshPadUI(); } // a different controller: its own lanes + capabilities
  if (!PAD.active) { PAD.active = true; refreshPadUI(); }
  if (state === 'padsetup') return psPoll(gp);
  // gp.timestamp = when this state was sampled: judge from that, not from when we happened to poll
  const lag = clamp((performance.now() - gp.timestamp) / 1000, 0, .1);
  for (let l = 0; l < 4; l++) {
    const down = bindDown(gp, PAD.binds[l], PAD.prev[l]);
    if (down !== PAD.prev[l]) { PAD.prev[l] = down; inputMode = 'pad'; if (down) laneDown(l, lag); else laneUp(l, lag); }
  }
  if (gp.mapping !== 'standard') return; // menu buttons only where the layout is known
  for (const i of [0, 1, 9, 12, 13, 14, 15]) {
    const p = !!(gp.buttons[i] && gp.buttons[i].pressed);
    if (p && !PAD.btn[i]) { inputMode = 'pad'; menuButton(i); }
    PAD.btn[i] = p;
  }
}
function padGone() {
  PAD.active = false; PAD.idx = null; PAD.id = '';
  for (let l = 0; l < 4; l++) if (PAD.prev[l]) { PAD.prev[l] = false; laneUp(l, 0); }
  if (state === 'play') pause();
  if (state === 'padsetup') psExit(false);
  inputMode = 'keys'; refreshPadUI();
}
setInterval(pollPad, 4);
addEventListener('gamepadconnected', e => {
  PAD.idx = e.gamepad.index; PAD.active = true; loadBinds(e.gamepad); refreshPadUI();
  toast(e.gamepad.mapping === 'standard' ? 'CONTROLLER CONNECTED · ' + padLabels.join(' · ') : 'CONTROLLER CONNECTED · USE CONTROLLER SETUP TO MAP THE LANES');
});
addEventListener('gamepaddisconnected', e => { if (PAD.idx === e.gamepad.index) { padGone(); toast('CONTROLLER DISCONNECTED'); } });

// ---- controller setup: press the input you want for each lane ----
let ps = null; // { step, base, wait, binds, std }
const snapPad = gp => ({ b: gp.buttons.map(b => Math.max(b.value || 0, b.pressed ? 1 : 0)), a: gp.axes.slice() });
function psStart() {
  const gp = curPad(); if (!gp) return toast('CONNECT A CONTROLLER FIRST');
  stopPreview(); ps = { step: 0, base: snapPad(gp), wait: false, binds: [], std: gp.mapping === 'standard' };
  state = 'padsetup'; show('padSetup'); psDraw();
}
function psPoll(gp) {
  const cur = snapPad(gp);
  if (ps.wait) { // everything back at rest before listening for the next lane
    const calm = cur.b.every((v, i) => v < .3 || ps.base.b[i] > .3) && cur.a.every((v, i) => Math.abs(v - ps.base.a[i]) < .3);
    if (calm) { ps.wait = false; ps.base = cur; } return;
  }
  if (ps.step >= 4) return;
  let bd = null;
  for (let i = 0; i < cur.b.length && !bd; i++) if (cur.b[i] > .6 && ps.base.b[i] < .3) bd = { t: 'b', i };
  for (let i = 0; i < cur.a.length && !bd; i++) { const d = cur.a[i] - ps.base.a[i]; if (Math.abs(d) > .6) bd = { t: 'a', i, dir: Math.sign(d), rest: ps.base.a[i] }; }
  if (!bd) return;
  ps.binds[ps.step++] = bd; ps.wait = true; inputMode = 'pad'; rumble('perfect'); psDraw();
}
function psDraw() {
  $('psLanes').innerHTML = [0, 1, 2, 3].map(l => {
    const bd = ps.binds[l], c = LC[l];
    return `<div class="${l === ps.step ? 'cur' : ''}" style="border-color:${rgba(c, .8)};color:${rgba(c, 1)}"><b>${bd ? bindName(bd, ps.std) : '…'}</b><span>${KEYLBL[l]}</span></div>`;
  }).join('');
  $('psMsg').textContent = ps.step < 4 ? `PRESS AND RELEASE THE INPUT FOR LANE ${ps.step + 1}  (KEYBOARD ${KEYLBL[ps.step]})` : 'ALL SET · PRESS DONE TO SAVE';
}
function psExit(save) {
  if (save && ps && ps.step === 4) {
    try { localStorage.setItem('vibio.pad.' + PAD.id, JSON.stringify(ps.binds)); } catch (e) { }
    const gp = curPad(); if (gp) { PAD.binds = ps.binds; padLabels = ps.binds.map(bd => bindName(bd, ps.std)); }
    toast('CONTROLLER LANES: ' + padLabels.join(' · '));
  }
  ps = null; PAD.prev = [false, false, false, false]; state = 'title'; refreshTitle(); refreshPadUI(); show('title'); startPreview();
}
$('psDone').onclick = () => psExit(true);
$('psRedo').onclick = () => { const gp = curPad(); if (gp) { ps = { step: 0, base: snapPad(gp), wait: false, binds: [], std: gp.mapping === 'standard' }; psDraw(); } };
$('psReset').onclick = () => { try { localStorage.removeItem('vibio.pad.' + PAD.id); } catch (e) { } const gp = curPad(); if (gp) loadBinds(gp); ps = null; psExit(false); toast('CONTROLLER LANES RESET TO DEFAULT'); };
addEventListener('keydown', e => { if (state === 'padsetup' && e.code === 'Escape') psExit(false); });

// ---- rumble ----
const RUMBLE = {
  perfect: { duration: 40, strongMagnitude: 0, weakMagnitude: .6 },     // crisp tick
  good: { duration: 60, strongMagnitude: .22, weakMagnitude: .28 },     // softer, duller bump (GREAT / GOOD)
  miss: { duration: 170, strongMagnitude: .8, weakMagnitude: .1 },      // heavy thud
  hold: { duration: 130, strongMagnitude: .05, weakMagnitude: .2 },     // steady buzz while a long note is held
  holdEnd: { duration: 110, strongMagnitude: .35, weakMagnitude: .75 }, // release burst
};
// Chrome/Edge/Safari: vibrationActuator.playEffect · Firefox (when it exposes actuators): hapticActuators[0].pulse
const canRumble = gp => !!(gp && ((gp.vibrationActuator && gp.vibrationActuator.playEffect) || (gp.hapticActuators && gp.hapticActuators.length && gp.hapticActuators[0].pulse)));
function rumble(kind) {
  if (!PAD.rumble || inputMode !== 'pad') return;
  const gp = curPad(); if (!gp) return;
  const fx = RUMBLE[kind], act = gp.vibrationActuator;
  try {
    let p = null;
    if (act && act.playEffect) p = act.playEffect('dual-rumble', { startDelay: 0, ...fx });
    else if (gp.hapticActuators && gp.hapticActuators[0] && gp.hapticActuators[0].pulse) p = gp.hapticActuators[0].pulse(Math.max(fx.strongMagnitude, fx.weakMagnitude), fx.duration);
    if (p && p.catch) p.catch(() => { });
  } catch (e) { }
}
function holdBuzz() { // called every frame while a long note is held; re-issued before the last buzz runs out
  const now = performance.now(); if (now - PAD.lastBuzz < 100) return;
  PAD.lastBuzz = now; rumble('hold');
}

// ---- title UI ----
function refreshPadUI() {
  const on = PAD.active, gp = curPad();
  ['padInfo', 'rumbleBtn', 'padSetupBtn'].forEach(id => $(id).style.display = on ? '' : 'none');
  if (!on) return;
  $('padInfo').textContent = '🎮 ' + padLabels.join(' · ') + (gp && gp.mapping === 'standard' ? '  ·  A PLAY · D-PAD TRACK / DIFFICULTY · START PAUSE' : '');
  $('rumbleBtn').textContent = canRumble(gp) ? 'VIBRATION ' + (PAD.rumble ? 'ON' : 'OFF') : 'VIBRATION N/A IN THIS BROWSER';
  $('rumbleBtn').disabled = !canRumble(gp);
}
$('rumbleBtn').onclick = () => {
  PAD.rumble = !PAD.rumble; try { localStorage.setItem('vibio.rumble', PAD.rumble ? '1' : '0'); } catch (e) { }
  refreshPadUI(); if (PAD.rumble) { inputMode = 'pad'; rumble('perfect'); }
};
$('padSetupBtn').onclick = psStart;
refreshPadUI();
