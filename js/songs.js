// VIBIO · Song data (GRIDRUNNER, BLACK ICE, OBSIDIAN), arrangements and note-chart building.
// Plain script (not a module) so index.html also works opened straight from disk; files share globals and load in order.
'use strict';

/* =========================================================
   SONGS — synthesized in-browser. Each song is data; buildSong() turns the
   selected one into scheduled audio events (EV) and a note chart (CHART).
   Shared form (bars): intro 0-3 · build 4-11 · drop 12-27 · break 28-35 · drop2 36-51 · outro 52-55
   ========================================================= */
let BARS = 56; // built-in songs share a 56-bar form; imported songs set their own length
const secOf = b => b < 4 ? 'intro' : b < 12 ? 'build' : b < 28 ? 'drop' : b < 36 ? 'break' : b < 52 ? 'drop2' : 'outro';
const SONGS = [
  {
    id: 'gridrunner', title: 'GRIDRUNNER', genre: 'SYNTHWAVE', bpm: 128,
    // world palette: [primary, secondary, primary in drop 2, secondary in drop 2]
    pal: [[0, 215, 255], [255, 140, 40], [255, 140, 40], [0, 215, 255]],
    CH: [ // Am - F - C - G
      { root: 45, pad: [57, 60, 64], lane: 0 },
      { root: 41, pad: [53, 57, 60], lane: 1 },
      { root: 48, pad: [55, 60, 64], lane: 2 },
      { root: 43, pad: [55, 59, 62], lane: 3 },
    ],
    // melody phrases, 4 bars each: [beat, durationBeats, midi]
    PA: [[0,.5,76],[.5,.5,74],[1,.5,72],[1.5,.5,74],[2,1.5,76],[3.5,.5,72],
         [4,.5,72],[4.5,.5,69],[5,.5,72],[5.5,.5,74],[6,2,77],
         [8,.5,76],[8.5,.5,74],[9,.5,72],[9.5,.5,76],[10,1.5,79],[11.5,.5,76],
         [12,.5,74],[12.5,.5,71],[13,.5,74],[13.5,.5,76],[14,2,74]],
    PB: [[0,.5,81],[.5,.5,79],[1,.5,76],[1.5,.5,79],[2,1.5,81],[3.5,.5,79],
         [4,.5,77],[4.5,.5,76],[5,.5,72],[5.5,.5,76],[6,2,77],
         [8,.5,79],[8.5,.5,76],[9,.5,72],[9.5,.5,76],[10,1,79],[11,1,76],
         [12,.5,74],[12.5,.5,76],[13,.5,74],[13.5,.5,71],[14,2,69]],
    BRK: [[76, 72], [77, 72], [79, 76], [74, 71]], // breakdown: two long notes per chord
    laneSplit: [71, 74, 77],                        // pitch → lane thresholds
    lead: 'lead', padCut: 1400, bassSteps: 8, arpIn: ['build', 'break', 'drop2'],
    buildLanes: (b, L) => b < 10 ? [L, (L + 2) % 4, (L + 1) % 4, (L + 3) % 4] : b === 10 ? [1, 2, 1, 2, 0, 3, 0, 3] : [0, 1, 2, 3, 3, 2, 1, 0],
    end: { pad: [57, 60, 64, 69], sub: 33, lanes: [1, 2] },
  },
  {
    id: 'blackice', title: 'BLACK ICE', genre: 'DARKSYNTH', bpm: 140,
    pal: [[170, 90, 255], [0, 215, 255], [255, 45, 85], [170, 90, 255]],
    CH: [ // Dm - Bb - Gm - A
      { root: 38, pad: [62, 65, 69], lane: 0 },
      { root: 34, pad: [58, 62, 65], lane: 1 },
      { root: 43, pad: [55, 58, 62], lane: 2 },
      { root: 45, pad: [57, 61, 64], lane: 3 },
    ],
    // syncopated hook (dotted-eighth pushes) and its answer
    PA: [[0,.75,74],[.75,.75,72],[1.5,.5,69],[2,.5,74],[2.5,1.5,77],
         [4,.75,74],[4.75,.75,70],[5.5,.5,65],[6,2,70],
         [8,.75,67],[8.75,.75,70],[9.5,.5,74],[10,.5,72],[10.5,1.5,70],
         [12,.5,69],[12.5,.5,73],[13,.5,76],[13.5,.5,73],[14,2,69]],
    PB: [[0,.5,69],[.5,.5,72],[1,.5,74],[1.5,.5,72],[2,1,69],[3,.5,65],[3.5,.5,67],
         [4,.75,65],[4.75,.75,62],[5.5,.5,65],[6,1.5,70],[7.5,.5,69],
         [8,.5,67],[8.5,.5,70],[9,.5,74],[9.5,.5,70],[10,.5,67],[10.5,.5,62],[11,1,67],
         [12,.75,64],[12.75,.75,69],[13.5,.5,73],[14,2,74]],
    BRK: [[69, 65], [70, 65], [67, 70], [69, 73]],
    laneSplit: [67, 70, 73],
    lead: 'pluck', padCut: 900, bassSteps: 16, arpIn: ['intro', 'build', 'break', 'drop', 'drop2'],
    buildLanes: (b, L) => b < 8 ? [L, (L + 1) % 4, (L + 2) % 4, (L + 1) % 4] : b < 10 ? [0, 1, 2, 3, 2, 1, 0, 1] : b === 10 ? [0, 3, 1, 2, 0, 3, 1, 2] : [3, 2, 1, 0, 3, 2, 1, 0],
    end: { pad: [62, 65, 69, 74], sub: 26, lanes: [0, 3] },
  },
  {
    id: 'obsidian', title: 'OBSIDIAN', genre: 'CHIPTUNE METAL', bpm: 160, theme: 'dark',
    pal: [[255, 30, 70], [255, 90, 40], [255, 130, 30], [255, 30, 70]], // crimson world, fire-orange in drop 2
    CH: [ // Em - C - D - B (harmonic minor: the major B pulls hard back to Em)
      { root: 40, pad: [52, 55, 59], lane: 0 },
      { root: 36, pad: [48, 52, 55], lane: 1 },
      { root: 38, pad: [50, 54, 57], lane: 2 },
      { root: 35, pad: [47, 51, 54], lane: 3 },
    ],
    PA: [[0,.5,71],[.5,.5,74],[1,.5,76],[1.5,.5,74],[2,1,71],[3,.5,67],[3.5,.5,69],
         [4,1,72],[5,.5,71],[5.5,.5,72],[6,.5,69],[6.5,.5,67],[7,1,64],
         [8,.5,66],[8.5,.5,69],[9,.5,74],[9.5,.5,72],[10,1,74],[11,.5,76],[11.5,.5,78],
         [12,2,75],[14,2,71]],
    PB: [[0,.5,76],[.5,.5,79],[1,.5,78],[1.5,.5,76],[2,1.5,79],[3.5,.5,78],
         [4,.5,76],[4.5,.5,72],[5,.5,76],[5.5,.5,79],[6,2,76],
         [8,.5,78],[8.5,.5,74],[9,.5,78],[9.5,.5,81],[10,1,78],[11,1,74],
         [12,.5,75],[12.5,.5,78],[13,.5,83],[13.5,.5,78],[14,2,76]],
    BRK: [[71, 67], [72, 67], [74, 69], [75, 71]],
    laneSplit: [69, 73, 77],
    lead: 'shred', padCut: 700, bassSteps: 8, arpIn: ['intro', 'break'],
    buildLanes: (b, L) => b < 8 ? [L, (L + 2) % 4, L, (L + 2) % 4] : b < 10 ? [0, 1, 2, 3, 0, 1, 2, 3] : b === 10 ? [0, 3, 0, 3, 1, 2, 1, 2] : [0, 1, 2, 3, 3, 2, 1, 0],
    end: { pad: [52, 55, 59, 64], sub: 28, lanes: [0, 3] },
  },
];
let songIdx = 0, SONG = SONGS[0], BPM = SONG.bpm, SPB = 60 / BPM, BAR = SPB * 4;
const pitchLane = m => { const s = SONG.laneSplit; return m <= s[0] ? 0 : m <= s[1] ? 1 : m <= s[2] ? 2 : 3; };

const EV = [], CHART = [];
const at = (beat, fn) => EV.push({ t: beat * SPB, fn });
// easy: kept on EASY · hard: only on HARD (NORMAL = everything not hard)
const note = (beat, lane, dur = 0, easy = true, hard = false) => CHART.push({ beat, lane, dur, easy, hard });

function buildSong() {
  EV.length = 0; CHART.length = 0;
  const so = SONG, dark = so.id === 'blackice', lead = (T, m, d, v) => A[so.lead](T, m, d, v);
  for (let b = 0; b < BARS; b++) {
    const B = b * 4, c = so.CH[b % 4], s = secOf(b);
    const drop = s === 'drop' || s === 'drop2';
    if (so.id === 'obsidian') metalBar(b, B, c, s, drop); else {
    // pads
    const padV = { intro: .5, build: .4, drop: .22, break: .55, drop2: .22, outro: .5 }[s];
    if (b < 54) at(B, T => A.pad(T, c.pad, BAR, padV, so.padCut));
    if (b === 54) at(B, T => A.pad(T, so.end.pad, BAR * 2, .55, so.padCut));
    // drums
    const kickOn = s === 'build' || drop || (s === 'outro' && b < 54);
    if (kickOn) for (let i = 0; i < 4; i++) at(B + i, T => A.kick(T));
    if (b === 54) at(B, T => { A.kick(T); A.crash(T); });
    if (drop || (s === 'build' && b >= 8 && b < 10)) { at(B + 1, T => A.clap(T)); at(B + 3, T => A.clap(T)); }
    if (dark && drop) { at(B + 3.75, T => A.snare(T, .12)); if (b % 2) at(B + 2.75, T => A.snare(T, .09)); } // ghost snares
    if (b === 10) for (let i = 0; i < 8; i++) at(B + i * .5, T => A.snare(T, .2 + i * .03));
    if (b === 11) for (let i = 0; i < 16; i++) at(B + i * .25, T => A.snare(T, .3 + i * .025));
    if (b === 10 || b === 34) at(B, T => A.riser(T, BAR * 2));
    if (b === 12 || b === 36 || b === 52) at(B, T => A.crash(T));
    if (drop) for (let i = 0; i < 16; i++) at(B + i * .25, T => A.hat(T, i % 4 === 2 ? .2 : i % 2 ? .07 : .04, dark && i % 4 === 2));
    else if (s === 'build' || (s === 'outro' && b < 54) || (s === 'intro' && b >= 2)) for (let i = 0; i < 4; i++) at(B + i + .5, T => A.hat(T, .13));
    // bass
    const quarter = dark ? 8 : 4;
    if (s === 'build' || (s === 'outro' && b < 54)) for (let i = 0; i < quarter; i++) at(B + i * 4 / quarter, T => A.bass(T, c.root, SPB * 2 / quarter, .42));
    if (drop) {
      const n = so.bassSteps, oct = n === 16 ? [0, 0, 12, 0] : [0, 0, 0, 0, 0, 0, 0, 12];
      for (let i = 0; i < n; i++) {
        const m = c.root + oct[i % oct.length], v = n === 16 ? (i % 4 === 0 ? .3 : .44) : (i % 2 ? .5 : .36);
        at(B + i * 4 / n, T => A.bass(T, m, SPB * 4 / n * .9, v));
      }
    }
    if (s === 'break') at(B, T => A.sub(T, c.root, BAR));
    if (b === 54) at(B, T => A.sub(T, so.end.sub, BAR * 2));
    // arp
    if (so.arpIn.includes(s)) {
      for (let i = 0; i < 16; i++) {
        const m = dark ? c.pad[[0, 2, 1, 2][i % 4]] + 12 + (i >= 8 ? 12 : 0) : c.pad[i % 3] + 12 + (i % 6 >= 3 ? 12 : 0);
        const cut = s === 'build' ? 450 + ((b - 4 + i / 16) / 8) * 3600 : s === 'intro' ? 600 + b * 250 : s === 'break' ? 1700 : s === 'drop' ? 2200 : 2600;
        const v = drop ? .05 : .09;
        at(B + i * .25, T => A.arp(T, m, cut, v));
      }
    }
    } // end synthwave/darksynth arrangement
    // ---- chart for non-melody sections ----
    const L = c.lane;
    if (s === 'intro' || b === 28 || b === 29) note(B, L, 3);
    if (s === 'build' || (s === 'outro' && b < 54)) {
      const lanes = s === 'outro' ? so.buildLanes(4, L) : so.buildLanes(b, L), step = 4 / lanes.length;
      lanes.forEach((l, i) => note(B + i * step, l, 0, step === 1 ? i % 2 === 0 : (i * step) % 1 === 0));
    }
    if (b >= 30 && b < 36) so.BRK[b % 4].forEach((m, i) => {
      at(B + i * 2, T => lead(T, m, SPB * 1.9, .15));
      note(B + i * 2, pitchLane(m), 1.5);
    });
    if (b === 54) so.end.lanes.forEach(l => note(B, l, 3.5));
  }
  // melodies
  const phrase = (startBar, ph, doubles) => ph.forEach(([bt, d, m], idx) => {
    const beat = startBar * 4 + bt;
    at(beat, T => lead(T, m, d * SPB * .92));
    note(beat, pitchLane(m), d >= 1 ? d - .25 : 0, d >= 1 || bt % 1 === 0);
    if (doubles && idx === 0) note(beat, (pitchLane(m) + 2) % 4, 0, false);
  });
  for (let p = 0; p < 4; p++) phrase(12 + p * 4, p % 2 ? so.PB : so.PA, false);
  for (let p = 0; p < 4; p++) phrase(36 + p * 4, p % 2 ? so.PB : so.PA, true);
  // ---- HARD-only notes, placed only where they can't clash with the NORMAL chart ----
  const busy = (beat, lane, pad = .4) => CHART.some(n => n.lane === lane && beat < n.beat + n.dur + pad && beat + pad > n.beat);
  const startsNear = (beat, w) => CHART.some(n => Math.abs(n.beat - beat) < w);
  const hard = (beat, lanes) => { for (const l of lanes) if (!busy(beat, l)) { note(beat, l, 0, false, true); return; } };
  // phrase endings: a 16th-note trill on two other lanes while the closing long note is held
  for (const start of [12, 16, 20, 24, 36, 40, 44, 48]) {
    const end = CHART.find(n => !n.hard && n.dur > 0 && Math.abs(n.beat - (start * 4 + 14)) < .01); if (!end) continue;
    const others = [0, 1, 2, 3].filter(l => l !== end.lane), a = others[0], z = others[2];
    [14.5, 14.75, 15, 15.25].forEach((o, i) => { const l = i % 2 ? z : a; if (!busy(start * 4 + o, l, .25)) note(start * 4 + o, l, 0, false, true); });
  }
  for (let b = 4; b < 52; b++) {
    const B = b * 4, L = so.CH[b % 4].lane, s = secOf(b), order = [L, (L + 2) % 4, (L + 1) % 4, (L + 3) % 4];
    if (s === 'build' && b < 10) for (let i = 0; i < 4; i++) hard(B + i + .5, [(L + 3) % 4, (L + 1) % 4]); // off-beats
    if (s === 'drop' || s === 'drop2') {
      for (let i = 0; i < 8; i++) { const bt = B + i * .5; if (!startsNear(bt, .2)) hard(bt, order); } // fill melody gaps with 8ths
      const head = CHART.find(n => !n.hard && Math.abs(n.beat - B) < .01); // downbeat chord
      if (head && !CHART.some(n => n !== head && Math.abs(n.beat - B) < .01)) hard(B, [(head.lane + 2) % 4, (head.lane + 1) % 4]);
    }
    if (b >= 30 && b < 36) { hard(B + 1, order.slice(2)); hard(B + 3, order.slice(2)); } // breakdown counter-taps
  }
  EV.sort((a, b) => a.t - b.t);
}
SONGS.forEach(s => s.drops = [12, 36]); // bars where the drop "punch" fires
// imported songs carry their own section map (from loudness analysis)
const sectionOf = b => SONG.custom ? (SONG.sections[b] || 'outro') : secOf(b);
// make SONG current: timing globals + note chart (+ audio events for synthesized songs)
function applySong() {
  BPM = SONG.bpm; SPB = 60 / BPM; BAR = SPB * 4; WAVE_W = Math.PI * 2 / (BAR * 2);
  BARS = SONG.custom ? SONG.bars : 56;
  if (SONG.custom) {
    EV.length = 0; CHART.length = 0;
    for (const n of SONG.notes) CHART.push({ beat: n.beat, lane: n.lane, dur: n.dur, easy: n.dur > 0 || n.beat % 1 === 0 });
  } else buildSong();
}
// OBSIDIAN: one bar of the chiptune-metal arrangement (same 56-bar form as the others)
function metalBar(b, B, c, s, drop) {
  // dark choir pad
  const padV = { intro: .45, build: .3, drop: .14, break: .5, drop2: .14, outro: .4 }[s];
  if (b < 54) at(B, T => A.pad(T, c.pad, BAR, padV, 700));
  if (b === 54) at(B, T => A.pad(T, [52, 55, 59, 64], BAR * 2, .5, 700));
  // drums
  if (drop) {
    for (let i = 0; i < 16; i++) at(B + i * .25, T => A.kickTight(T, i % 4 === 0 ? .95 : .62)); // double bass
    at(B + 1, T => A.snareBig(T, .75)); at(B + 3, T => A.snareBig(T, .75));
    for (let i = 0; i < 8; i++) at(B + i * .5, T => A.hat(T, i % 2 ? .1 : .15, i % 2 === 1));
    if (b % 2 === 0) at(B, T => A.crash(T));
  }
  if (s === 'build' || (s === 'outro' && b < 54)) {
    for (let i = 0; i < 4; i++) at(B + i, T => A.kick(T, .9));
    if (b >= 6) { at(B + 1, T => A.snareBig(T, .6)); at(B + 3, T => A.snareBig(T, .6)); }
    for (let i = 0; i < 8; i++) at(B + i * .5, T => A.hat(T, .1));
  }
  if (b === 10) for (let i = 0; i < 8; i++) at(B + i * .5, T => A.snareBig(T, .3 + i * .04));
  if (b === 11) for (let i = 0; i < 16; i++) { at(B + i * .25, T => A.snareBig(T, .35 + i * .03)); at(B + i * .25, T => A.kickTight(T, .5)); }
  if (b === 10 || b === 34) at(B, T => A.riser(T, BAR * 2));
  if (b === 12 || b === 36 || b === 52) at(B, T => A.crash(T));
  if (b === 54) at(B, T => { A.kick(T); A.crash(T); A.chug(T, 40, BAR * 2, .5, true); });
  // guitars: gallop (8th + two 16ths) in the drops, open chord on each downbeat
  if (drop) for (let i = 0; i < 4; i++) {
    if (i === 0) at(B, T => A.chug(T, c.root, SPB * .9, .5, true));
    else at(B + i, T => A.chug(T, c.root, SPB * .22, .48));
    at(B + i + .5, T => A.chug(T, c.root, SPB * .2, .4)); at(B + i + .75, T => A.chug(T, c.root, SPB * .2, .4));
  }
  if (s === 'build' && b >= 8) for (let i = 0; i < 8; i++) at(B + i * .5, T => A.chug(T, c.root, SPB * .3, .3 + (b - 8) * .06));
  if (s === 'outro' && b < 54) at(B, T => A.chug(T, c.root, BAR * .9, .45, true));
  // bass follows the guitar roots
  if (drop || (s === 'build' && b >= 8) || (s === 'outro' && b < 54)) for (let i = 0; i < 8; i++) at(B + i * .5, T => A.bass(T, c.root - 12, SPB * .42, i % 2 ? .3 : .42));
  if (s === 'break') at(B, T => A.sub(T, c.root - 12, BAR));
  if (b === 54) at(B, T => A.sub(T, 28, BAR * 2));
  // clean chip arpeggio: intro, breakdown, and a toll on the intro downbeats
  if (s === 'intro' || s === 'break') for (let i = 0; i < 16; i++) {
    const m = c.pad[[0, 1, 2, 1][i % 4]] + 12 + (i >= 8 ? 12 : 0);
    at(B + i * .25, T => A.arp(T, m, s === 'intro' ? 700 + b * 220 : 1500, .08));
  }
  if (s === 'intro') at(B, T => A.click(T, true, .18));
}
function setSong(i) {
  songIdx = (i + SONGS.length) % SONGS.length; SONG = SONGS[songIdx];
  applySong();
  try { localStorage.setItem('vibio.song', SONG.id); } catch (e) { }
}
const fmtLen = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
