// VIBIO · Song data (GRIDRUNNER, BLACK ICE, OBSIDIAN, DEEP CURRENT, PEACH SODA, AURORA), arrangements and note-chart building.
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
    end: { pad: [52, 55, 59, 64], sub: 28, lanes: [0, 3] }, arrange: metalBar,
  },
  {
    id: 'deepcurrent', title: 'DEEP CURRENT', genre: 'LIQUID DNB', bpm: 172, theme: 'ocean',
    pal: [[0, 255, 200], [255, 110, 140], [90, 140, 255], [0, 255, 190]], // aqua + coral, deep blue in drop 2
    CH: [ // Fm9 - Dbmaj7 - Eb(add9) - C7 (the major C7 leans back into Fm)
      { root: 41, pad: [56, 60, 63, 67], lane: 1 },
      { root: 37, pad: [56, 60, 61, 65], lane: 3 },
      { root: 39, pad: [55, 58, 63, 65], lane: 2 },
      { root: 36, pad: [55, 58, 60, 64], lane: 0 },
    ],
    // lyrical, mostly 8ths and longer: at 172 BPM the breakbeat carries the speed
    PA: [[0,1,72],[1,.5,75],[1.5,.5,77],[2,1.5,79],[3.5,.5,77],
         [4,.5,77],[4.5,.5,75],[5,1,72],[6,2,77],
         [8,.5,75],[8.5,.5,77],[9,.5,79],[9.5,.5,80],[10,1.5,79],[11.5,.5,75],
         [12,.5,72],[12.5,.5,76],[13,.5,79],[13.5,.5,76],[14,2,72]],
    PB: [[0,.5,80],[.5,.5,79],[1,.5,77],[1.5,.5,75],[2,1,77],[3,1,72],
         [4,.75,73],[4.75,.75,72],[5.5,.5,68],[6,2,72],
         [8,.5,70],[8.5,.5,72],[9,.5,75],[9.5,.5,79],[10,1,77],[11,1,75],
         [12,.5,79],[12.5,.5,76],[13,.5,72],[13.5,.5,70],[14,2,67]],
    BRK: [[72, 68], [73, 68], [70, 75], [72, 76]],
    laneSplit: [70, 73, 77],
    lead: 'aqua', arrange: dnbBar,
    buildLanes: (b, L) => b < 8 ? [L, (L + 2) % 4] : b < 10 ? [L, (L + 1) % 4, (L + 2) % 4, (L + 3) % 4] : b === 10 ? [0, 1, 2, 3, 3, 2, 1, 0] : [3, 1, 2, 0, 3, 1, 2, 0],
    end: { pad: [56, 60, 63, 65, 68], sub: 29, lanes: [1, 2] },
  },
  {
    id: 'peachsoda', title: 'PEACH SODA', genre: 'FUTURE FUNK', bpm: 118, theme: 'dusk',
    pal: [[255, 70, 160], [255, 190, 70], [150, 100, 255], [255, 110, 170]], // hot pink + gold, violet in drop 2
    CH: [ // Bbmaj7 - C7 - Am7 - Dm7 (IV-V-iii-vi, the city-pop "royal road")
      { root: 46, pad: [58, 62, 65, 69], lane: 2 },
      { root: 48, pad: [58, 60, 64, 67], lane: 0 },
      { root: 45, pad: [57, 60, 64, 67], lane: 3 },
      { root: 50, pad: [57, 60, 62, 65], lane: 1 },
    ],
    // syncopated hook: pushes on the "and", answered by a higher run
    PA: [[0,.5,77],[.5,.5,76],[1,.5,74],[1.5,1,69],[2.5,.5,72],[3,1,74],
         [4,.5,76],[4.5,.5,79],[5,.5,76],[5.5,.5,72],[6,1.5,70],[7.5,.5,72],
         [8,.5,76],[8.5,.5,77],[9,.5,79],[9.5,.5,81],[10,1,79],[11,.5,76],[11.5,.5,74],
         [12,1,72],[13,.5,74],[13.5,.5,69],[14,2,74]],
    PB: [[0,.75,81],[.75,.75,79],[1.5,.5,77],[2,.5,74],[2.5,1.5,77],
         [4,.5,76],[4.5,.5,72],[5,.5,70],[5.5,.5,72],[6,2,76],
         [8,.75,72],[8.75,.75,76],[9.5,.5,79],[10,.5,76],[10.5,1.5,81],
         [12,.5,79],[12.5,.5,77],[13,.5,76],[13.5,.5,74],[14,2,77]],
    BRK: [[74, 70], [76, 72], [76, 72], [74, 77]],
    laneSplit: [72, 75, 78],
    lead: 'funk', arrange: funkBar,
    buildLanes: (b, L) => b < 8 ? [L, (L + 1) % 4, L, (L + 3) % 4] : b < 10 ? [L, (L + 2) % 4, (L + 1) % 4, (L + 2) % 4, L, (L + 3) % 4, (L + 1) % 4, (L + 3) % 4] : b === 10 ? [0, 0, 3, 3, 1, 1, 2, 2] : [0, 1, 2, 3, 0, 1, 2, 3],
    end: { pad: [53, 57, 60, 64, 69], sub: 29, lanes: [0, 3] },
  },
  {
    id: 'aurora', title: 'AURORA', genre: 'UPLIFTING TRANCE', bpm: 138, theme: 'arctic',
    pal: [[60, 255, 170], [170, 110, 255], [120, 220, 255], [255, 100, 210]], // aurora green + violet, ice + magenta in drop 2
    CH: [ // Bm - Em - G - A (i-iv-VI-VII: climbs every bar)
      { root: 47, pad: [59, 62, 66, 71], lane: 0 },
      { root: 40, pad: [59, 64, 67, 71], lane: 2 },
      { root: 43, pad: [59, 62, 67, 71], lane: 3 },
      { root: 45, pad: [57, 61, 64, 69], lane: 1 },
    ],
    // anthem: long notes, leaps up to the top of the phrase
    PA: [[0,1,78],[1,.5,74],[1.5,.5,76],[2,1,78],[3,1,81],
         [4,1.5,79],[5.5,.5,78],[6,1,76],[7,1,71],
         [8,.5,74],[8.5,.5,76],[9,1,79],[10,.5,78],[10.5,.5,79],[11,1,83],
         [12,1,81],[13,1,76],[14,2,73]],
    PB: [[0,.5,78],[.5,.5,81],[1,1,83],[2,.5,81],[2.5,.5,78],[3,1,74],
         [4,.5,76],[4.5,.5,79],[5,1,83],[6,1.5,81],[7.5,.5,79],
         [8,1,78],[9,.5,79],[9.5,.5,81],[10,1,83],[11,.5,81],[11.5,.5,79],
         [12,.5,81],[12.5,.5,78],[13,1,76],[14,2,76]],
    BRK: [[74, 71], [76, 71], [74, 79], [73, 76]],
    laneSplit: [73, 77, 80],
    lead: 'supersaw', arrange: tranceBar,
    buildLanes: (b, L) => b < 8 ? [L, (L + 3) % 4, (L + 1) % 4, (L + 2) % 4] : b < 10 ? [L, L, (L + 2) % 4, (L + 2) % 4, (L + 1) % 4, (L + 1) % 4, (L + 3) % 4, (L + 3) % 4] : b === 10 ? [0, 1, 2, 3, 2, 1, 0, 1] : [3, 2, 1, 0, 1, 2, 3, 2],
    end: { pad: [59, 62, 66, 71, 74], sub: 35, lanes: [0, 3] },
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
    if (so.arrange) so.arrange(b, B, c, s, drop, so); else {
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
// shared by the arrangements below: snare roll into the drop, risers, crashes on the section changes
function rollsAndRisers(b, B, snare) {
  if (b === 10) for (let i = 0; i < 8; i++) at(B + i * .5, T => snare(T, .2 + i * .03));
  if (b === 11) for (let i = 0; i < 16; i++) at(B + i * .25, T => snare(T, .28 + i * .025));
  if (b === 10 || b === 34) at(B, T => A.riser(T, BAR * 2));
  if (b === 12 || b === 36 || b === 52) at(B, T => A.crash(T));
}
// DEEP CURRENT: liquid drum & bass — two-step breakbeat, reese bass, electric piano, bubble plinks
function dnbBar(b, B, c, s, drop, so) {
  const outro = s === 'outro' && b < 54;
  // warm pad underneath everything, electric piano on top
  const padV = { intro: .34, build: .26, drop: .12, break: .4, drop2: .14, outro: .3 }[s];
  if (b < 54) at(B, T => A.pad(T, c.pad, BAR, padV, 1000));
  if (s === 'intro' || s === 'build' || s === 'break' || outro) at(B, T => A.keys(T, c.pad, BAR * .95, s === 'build' ? .1 : .14));
  if (drop) { at(B, T => A.keys(T, c.pad, SPB * 1.4, .09)); at(B + 2.5, T => A.keys(T, c.pad, SPB * 1.2, .07)); } // syncopated comps
  if (b === 54) at(B, T => { A.keys(T, so.end.pad, BAR * 2, .16); A.pad(T, so.end.pad, BAR * 2, .4, 1000); A.crash(T); A.kick(T); A.sub(T, so.end.sub, BAR * 2); });
  // drums
  const twoStep = drop || (s === 'build' && b >= 8 && b < 10);
  if (twoStep) {
    at(B, T => A.kick(T, .9)); at(B + 2.5, T => A.kick(T, .8));
    if (s === 'drop2' && b % 2) at(B + 1.5, T => A.kick(T, .55));
    at(B + 1, T => { A.snareBig(T, .5); A.snare(T, .25); }); at(B + 3, T => { A.snareBig(T, .5); A.snare(T, .25); });
    at(B + 1.75, T => A.snare(T, .07)); at(B + 3.25, T => A.snare(T, .06)); if (b % 2) at(B + 3.75, T => A.snare(T, .09)); // ghost notes
    for (let i = 0; i < 16; i++) at(B + i * .25, T => A.hat(T, i % 2 ? .035 : .08, s === 'drop2' && i % 4 === 2));
    if (drop && b % 4 === 0) at(B, T => A.crash(T));
  } else if ((s === 'build' && b < 8) || outro || (s === 'break' && b >= 32)) { // half-time groove
    at(B, T => A.kick(T, .75)); if (s !== 'break') at(B + 2, T => A.snareBig(T, .45));
    for (let i = 0; i < 8; i++) at(B + i * .5, T => A.hat(T, i % 2 ? .05 : .03));
  }
  if (s === 'intro' && b >= 2) for (let i = 0; i < 16; i++) at(B + i * .25, T => A.hat(T, .015 + (i % 4 === 2 ? .02 : 0)));
  rollsAndRisers(b, B, (T, v) => A.snareBig(T, v * .8));
  // bass: reese in the drops, sub in the build and breakdown
  if (drop) {
    at(B, T => A.reese(T, c.root, SPB * 2.4, .36)); at(B + 2.5, T => A.reese(T, c.root, SPB * .9, .34));
    at(B + 3.5, T => A.reese(T, c.root + 12, SPB * .45, .3));
  }
  if ((s === 'build' && b >= 8) || s === 'break' || outro) at(B, T => A.sub(T, c.root, BAR));
  // bubble plinks: arpeggiated chord tones in the intro and breakdown, sparkle in drop 2
  if (s === 'intro' || s === 'break' || s === 'drop2') {
    const steps = s === 'drop2' ? [1, 3, 6] : [0, 1, 2, 3, 4, 5, 6, 7];
    steps.forEach(i => { const m = c.pad[[0, 2, 1, 3, 2, 0, 3, 1][i]] + 24; at(B + i * .5, T => A.plink(T, m, s === 'drop2' ? .05 : .07)); });
  }
}
// PEACH SODA: future funk — four-on-the-floor, slap bass octaves, chopped chord stabs, vinyl crackle
function funkBar(b, B, c, s, drop, so) {
  const outro = s === 'outro' && b < 54;
  if (s === 'intro' || s === 'break') at(B, T => A.crackle(T, BAR));
  // chord stabs: filtered open in the intro/build, full in the drops
  const cut = s === 'intro' ? 500 + b * 250 : s === 'build' ? 900 + (b - 4) * 450 : s === 'break' ? 1200 + Math.max(0, b - 32) * 700 : 3000;
  const stabAt = drop ? [.5, 1.5, 2.25, 3.5] : s === 'break' && b < 32 ? [] : [0, .75, 2, 2.75];
  stabAt.forEach(o => at(B + o, T => A.stab(T, c.pad, SPB * (drop ? .32 : .45), drop ? .11 : .09, cut)));
  if (s === 'break' || s === 'intro') at(B, T => A.keys(T, c.pad, BAR * .95, s === 'break' ? .13 : .07));
  if (s === 'drop2') at(B, T => A.pad(T, c.pad.map(m => m + 12), BAR, .1, 3000)); // disco strings
  if (b === 54) at(B, T => { A.keys(T, so.end.pad, BAR * 2, .15); A.stab(T, so.end.pad, BAR * 1.5, .12, 2400); A.crash(T); A.kick(T); A.sub(T, so.end.sub, BAR * 2); });
  // drums
  const full = drop || (s === 'build' && b >= 6) || outro;
  if (full || s === 'build' || (s === 'intro' && b >= 2)) for (let i = 0; i < 4; i++) at(B + i, T => A.kick(T, s === 'intro' ? .45 : .9));
  if (full) {
    at(B + 1, T => A.clap(T)); at(B + 3, T => A.clap(T));
    for (let i = 0; i < 4; i++) at(B + i + .5, T => A.hat(T, .12, true));
    if (drop) for (let i = 0; i < 16; i++) if (i % 2) at(B + i * .25, T => A.hat(T, .045));
  } else if (s === 'build') for (let i = 0; i < 4; i++) at(B + i + .5, T => A.hat(T, .09));
  if (s === 'break') { at(B + 1, T => A.snap(T)); at(B + 3, T => A.snap(T)); if (b >= 32) { at(B, T => A.kick(T, .55)); at(B + 2, T => A.kick(T, .55)); } }
  if (drop && b % 8 === 0) at(B, T => A.crash(T));
  rollsAndRisers(b, B, (T, v) => A.snare(T, v));
  // slap bass: octave pops in the drops, straight eighths in the late build and outro
  if (drop) {
    const riff = b % 2 ? [[0, 0, .45], [.75, 12, .2], [1.25, 0, .2], [1.5, 12, .2], [2, 0, .45], [2.75, 7, .2], [3, 12, .25], [3.5, 10, .25]]
                       : [[0, 0, .45], [.75, 12, .2], [1.5, 0, .2], [2, 12, .2], [2.5, 0, .35], [3, 0, .2], [3.25, 12, .2], [3.75, 7, .2]];
    riff.forEach(([o, iv, d]) => at(B + o, T => A.slap(T, c.root + iv, SPB * d * 1.6, o % 1 ? .34 : .44)));
  }
  if ((s === 'build' && b >= 8) || outro) for (let i = 0; i < 8; i++) at(B + i * .5, T => A.slap(T, c.root + (i % 2 ? 12 : 0), SPB * .3, .34));
  if (s === 'break') at(B, T => A.sub(T, c.root - 12, BAR));
}
// AURORA: uplifting trance — rolling offbeat bass, 16th-gated supersaw chords, pluck arpeggios, long breakdown
function tranceBar(b, B, c, s, drop, so) {
  const outro = s === 'outro' && b < 54;
  const padV = { intro: .45, build: .32, drop: .1, break: .52, drop2: .12, outro: .4 }[s];
  if (b < 54) at(B, T => A.pad(T, c.pad, BAR, padV, s === 'break' ? 2200 : 1600));
  if (b === 54) at(B, T => { A.pad(T, so.end.pad, BAR * 2, .5, 2000); A.supersaw(T, so.end.pad[3], BAR * 1.8, .1); A.crash(T); A.kick(T); A.sub(T, so.end.sub, BAR * 2); });
  // drums: four on the floor, second build at the end of the breakdown
  const fourFloor = s === 'build' || drop || outro || (s === 'break' && b >= 34);
  if (fourFloor) for (let i = 0; i < 4; i++) at(B + i, T => A.kick(T));
  if (drop || (s === 'build' && b >= 8)) { at(B + 1, T => A.clap(T)); at(B + 3, T => A.clap(T)); }
  if (drop || s === 'build' || outro) for (let i = 0; i < 4; i++) at(B + i + .5, T => A.hat(T, drop ? .14 : .1, drop));
  if (drop) for (let i = 0; i < 16; i++) if (i % 2) at(B + i * .25, T => A.hat(T, .04));
  if (drop && b % 8 === 0) at(B, T => A.crash(T));
  rollsAndRisers(b, B, (T, v) => A.snare(T, v));
  if (b === 34) for (let i = 0; i < 8; i++) at(B + i * .5, T => A.snare(T, .18 + i * .03));
  if (b === 35) for (let i = 0; i < 16; i++) at(B + i * .25, T => A.snare(T, .26 + i * .025));
  // bass: offbeat in the early build, rolling 16ths (kick - bass bass bass) from the late build on
  const rolling = drop || (s === 'build' && b >= 8);
  if (rolling) for (let i = 0; i < 4; i++) [.25, .5, .75].forEach(o => at(B + i + o, T => A.bass(T, c.root, SPB * .2, o === .5 ? .4 : .32)));
  else if ((s === 'build' && b < 8) || outro) for (let i = 0; i < 4; i++) at(B + i + .5, T => A.bass(T, c.root, SPB * .4, .38));
  if (s === 'break') at(B, T => A.sub(T, c.root - 12, BAR));
  // trance gate: a chopped supersaw chord on a 16th pattern
  if (drop) {
    const gate = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1];
    gate.forEach((on, i) => { if (on) at(B + i * .25, T => A.gate(T, c.pad, SPB * .2, i % 4 === 0 ? .075 : .055)); });
  }
  // pluck arpeggio: intro, build (filter opening) and the back half of the breakdown
  if (s === 'intro' || s === 'build' || (s === 'break' && b >= 32)) for (let i = 0; i < 16; i++) {
    const m = c.pad[[0, 1, 2, 3, 2, 1, 2, 3][i % 8]] + 12;
    const v = s === 'build' ? .04 + (b - 4) * .005 : .05;
    at(B + i * .25, T => A.pluck(T, m, SPB * .18, v));
  }
}
function setSong(i) {
  songIdx = (i + SONGS.length) % SONGS.length; SONG = SONGS[songIdx];
  applySong();
  try { localStorage.setItem('vibio.song', SONG.id); } catch (e) { }
}
const fmtLen = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
