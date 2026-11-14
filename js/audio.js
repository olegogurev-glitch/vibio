// VIBIO · Audio engine: per-run mix graph, synth voices, imported-audio playback.
// Plain script (not a module) so index.html also works opened straight from disk; files share globals and load in order.
'use strict';

/* =========================================================
   AUDIO ENGINE
   ========================================================= */
const A = {
  ctx: null, comp: null, analyser: null, noise: null, ir: null,
  bus: null, duck: null, rev: null, dly: null,
  init() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 4; this.comp.attack.value = .004; this.comp.release.value = .18;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = .78;
    this.comp.connect(this.analyser); this.analyser.connect(ctx.destination);
    const n = ctx.sampleRate * 2, nb = ctx.createBuffer(1, n, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    const len = ctx.sampleRate * 2.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.ir = ir;
    // distortion curve for the 8-bit "guitars": hard tanh clip with a little extra bite
    const cn = 2048, curve = new Float32Array(cn);
    for (let i = 0; i < cn; i++) { const x = i / (cn - 1) * 2 - 1; curve[i] = .85 * Math.tanh(10 * x) + .15 * Math.tanh(30 * x); }
    this.curve = curve;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
  },
  playBuffer(buf, when, from = 0, loop = null) { // imported audio; routed via the lead shelf so holds brighten it
    const s = this.ctx.createBufferSource(), now = this.ctx.currentTime; s.buffer = buf;
    if (loop) { s.loop = true; s.loopStart = loop[0]; s.loopEnd = loop[1]; }
    if (when < now) { from += now - when; when = now; }
    if (from >= buf.duration) return null;
    s.connect(this.leadBus); s.start(when, Math.max(0, from)); this.src = s; return s;
  },
  stopBuffer(ms = 120) { const s = this.src; this.src = null; if (s) setTimeout(() => { try { s.stop(); } catch (e) { } }, ms); },
  tick(t, lane) { // editor note tick
    const o = this.osc('triangle', [988, 1175, 1480, 1760][lane], t, t + .06), g = this.gain(0);
    g.gain.setValueAtTime(.3, t); g.gain.exponentialRampToValueAtTime(.001, t + .05); o.connect(g); g.connect(this.bus);
  },
  newRun() { // fresh graph per run so a restart can silence everything already scheduled
    if (this.src) { const s = this.src; this.src = null; setTimeout(() => { try { s.stop(); } catch (e) { } }, 450); }
    const ctx = this.ctx;
    if (this.bus) {
      const old = this.bus, om = this.muff, os = this.shimSrc;
      old.gain.cancelScheduledValues(ctx.currentTime); old.gain.setTargetAtTime(0, ctx.currentTime, .03);
      setTimeout(() => { old.disconnect(); om.disconnect(); try { os.stop(); } catch (e) { } }, 400);
    }
    // master lowpass ("muffle" on miss) -> compressor
    const muff = this.muff = this.filt('lowpass', 20000, .8); muff.connect(this.comp);
    const bus = this.bus = ctx.createGain(); bus.gain.value = .75; bus.connect(muff);
    // lead goes through a shelf that opens up while you hold a note
    const shelf = this.shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 2500; shelf.gain.value = 0;
    this.leadBus = this.gain(1); this.leadBus.connect(shelf); shelf.connect(bus);
    // hold shimmer: quiet airy noise layer, silent until a hold is active
    const sh = this.shimSrc = ctx.createBufferSource(); sh.buffer = this.noise; sh.loop = true;
    const shf = this.filt('bandpass', 7000, 3); this.shimmer = this.gain(0); sh.connect(shf); shf.connect(this.shimmer); this.shimmer.connect(bus); sh.start();
    const duck = this.duck = ctx.createGain(); duck.connect(bus);
    const conv = ctx.createConvolver(); conv.buffer = this.ir;
    const rev = this.rev = ctx.createGain(); const rOut = ctx.createGain(); rOut.gain.value = .32;
    rev.connect(conv); conv.connect(rOut); rOut.connect(bus);
    // guitar amp: drive -> cut the fizz and the mud -> bus
    const ws = ctx.createWaveShaper(); ws.curve = this.curve; ws.oversample = '4x';
    this.driveIn = this.gain(1); const ampHp = this.filt('highpass', 90, .7), ampLp = this.filt('lowpass', 4800, .7), ampOut = this.gain(.3);
    this.driveIn.connect(ws); ws.connect(ampHp); ampHp.connect(ampLp); ampLp.connect(ampOut); ampOut.connect(bus);
    const dly = this.dly = ctx.createGain(); const dl = ctx.createDelay(2); dl.delayTime.value = SPB * .75;
    const fb = ctx.createGain(); fb.gain.value = .36; const lp = ctx.createBiquadFilter(); lp.frequency.value = 2400;
    const dOut = ctx.createGain(); dOut.gain.value = .28;
    dly.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(dOut); dOut.connect(bus); dOut.connect(rev);
  },
  fadeOut(sec) { const g = this.bus.gain, t = this.ctx.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + sec); },
  mtof: m => 440 * Math.pow(2, (m - 69) / 12),
  osc(type, f, t, end, det = 0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.start(t); o.stop(end); return o; },
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; },
  filt(type, f, q = 1) { const x = this.ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; },
  kick(t, v = 1) {
    const o = this.osc('sine', 170, t, t + .45), g = this.gain(0);
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(42, t + .13);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .004); g.gain.exponentialRampToValueAtTime(.001, t + .42);
    o.connect(g); g.connect(this.bus);
    const dg = this.duck.gain; dg.setValueAtTime(1, t); dg.linearRampToValueAtTime(.3, t + .012); dg.linearRampToValueAtTime(1, t + .26);
  },
  nz(t, dur, type, f, q, v, sends = []) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const fl = this.filt(type, f, q), g = this.gain(0);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.bus); sends.forEach(x => g.connect(x));
    s.start(t, Math.random()); s.stop(t + dur + .05); return { s, fl, g };
  },
  clap(t) { this.nz(t, .2, 'bandpass', 1500, .9, .6, [this.rev]); this.nz(t + .012, .05, 'bandpass', 1100, 1, .4); },
  snare(t, v) { this.nz(t, .14, 'bandpass', 1800, .7, v, [this.rev]); },
  hat(t, v, open) { this.nz(t, open ? .2 : .045, 'highpass', open ? 6500 : 8000, .5, v); },
  crash(t) { this.nz(t, 2.2, 'highpass', 4500, .3, .3, [this.rev]); },
  riser(t, dur) {
    const { fl, g } = this.nz(t, dur + .1, 'bandpass', 300, 2, .001, [this.rev]);
    fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(9000, t + dur);
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(.35, t + dur * .97); g.gain.linearRampToValueAtTime(0, t + dur);
  },
  bass(t, m, dur, v) {
    const end = t + dur + .03, f = this.filt('lowpass', 1600, 6), g = this.gain(0), sub = this.gain(.45);
    f.frequency.setValueAtTime(1700, t); f.frequency.exponentialRampToValueAtTime(220, t + Math.min(dur, .3));
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .008); g.gain.setValueAtTime(v, t + dur * .8); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    this.osc('sawtooth', this.mtof(m), t, end).connect(f);
    this.osc('square', this.mtof(m - 12), t, end).connect(sub); sub.connect(f);
    f.connect(g); g.connect(this.duck);
  },
  sub(t, m, dur) {
    const g = this.gain(0); g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.4, t + .3); g.gain.setValueAtTime(.4, t + dur - .3); g.gain.linearRampToValueAtTime(.0001, t + dur);
    this.osc('sine', this.mtof(m), t, t + dur + .05).connect(g); g.connect(this.duck);
  },
  lead(t, m, dur, v = .2) {
    const rel = .14, end = t + dur + rel + .05, f = this.filt('lowpass', 5000, 3), g = this.gain(0);
    f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(1900, t + .25);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(v * .7, t + .15);
    g.gain.setValueAtTime(v * .7, t + Math.max(dur, .16)); g.gain.exponentialRampToValueAtTime(.0001, t + dur + rel);
    const oscs = [this.osc('sawtooth', this.mtof(m), t, end, -9), this.osc('sawtooth', this.mtof(m), t, end, 9)];
    const sq = this.osc('square', this.mtof(m - 12), t, end), sg = this.gain(.28); sq.connect(sg); sg.connect(f);
    oscs.forEach(o => o.connect(f));
    if (dur > .4) {
      const lfo = this.osc('sine', 5.6, t, end), lg = this.gain(0);
      lg.gain.setValueAtTime(0, t + .15); lg.gain.linearRampToValueAtTime(22, t + dur);
      lfo.connect(lg); oscs.forEach(o => lg.connect(o.detune));
    }
    const rs = this.gain(.3);
    f.connect(g); g.connect(this.leadBus); g.connect(this.dly); g.connect(rs); rs.connect(this.rev);
  },
  pluck(t, m, dur, v = .2) { // BLACK ICE lead: snappy square/saw with a fast filter snap, sustains for holds
    const rel = .1, end = t + dur + rel + .05, f = this.filt('lowpass', 7000, 6), g = this.gain(0);
    f.frequency.setValueAtTime(7500, t); f.frequency.exponentialRampToValueAtTime(1100, t + .18);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .005); g.gain.exponentialRampToValueAtTime(v * .5, t + .2);
    g.gain.setValueAtTime(v * .5, t + Math.max(dur, .21)); g.gain.exponentialRampToValueAtTime(.0001, t + dur + rel);
    this.osc('square', this.mtof(m), t, end, -12).connect(f); this.osc('sawtooth', this.mtof(m), t, end, 12).connect(f);
    const sp = this.gain(.18); this.osc('sine', this.mtof(m + 12), t, end).connect(sp); sp.connect(f);
    const rs = this.gain(.25);
    f.connect(g); g.connect(this.leadBus); g.connect(this.dly); g.connect(rs); rs.connect(this.rev);
  },
  pad(t, notes, dur, v, cut = 1400) {
    const f = this.filt('lowpass', cut, .7), g = this.gain(0), rs = this.gain(.6), end = t + dur + .75;
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + .5); g.gain.setValueAtTime(v, t + dur - .1); g.gain.linearRampToValueAtTime(.0001, t + dur + .65);
    const k = 1 / (notes.length * 3);
    notes.forEach(m => [-11, 0, 11].forEach(det => { const og = this.gain(k); this.osc('sawtooth', this.mtof(m), t, end, det).connect(og); og.connect(f); }));
    f.connect(g); g.connect(this.duck); g.connect(rs); rs.connect(this.rev);
  },
  arp(t, m, cut, v) {
    const f = this.filt('lowpass', cut, 4), g = this.gain(0);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + .14);
    this.osc('square', this.mtof(m), t, t + .16).connect(f); f.connect(g); g.connect(this.duck); g.connect(this.dly);
  },
  // ---- reactive layer ----
  missDip() {
    const f = this.muff.frequency, t = this.ctx.currentTime;
    f.cancelScheduledValues(t); f.setValueAtTime(Math.max(400, f.value), t);
    f.exponentialRampToValueAtTime(450, t + .025); f.exponentialRampToValueAtTime(20000, t + .55);
  },
  holdOn(on) {
    const t = this.ctx.currentTime;
    this.shelf.gain.setTargetAtTime(on ? 10 : 0, t, on ? .04 : .12);
    this.shimmer.gain.setTargetAtTime(on ? .05 : 0, t, .05);
  },
  whoosh(up) {
    const t = this.ctx.currentTime, a = up ? 400 : 7000, b = up ? 9000 : 180;
    const { fl, g } = this.nz(t, .7, 'bandpass', a, 3, .001, [this.rev]);
    fl.frequency.setValueAtTime(a, t); fl.frequency.exponentialRampToValueAtTime(b, t + .55);
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(.45, t + .4); g.gain.exponentialRampToValueAtTime(.001, t + .7);
  },
  powerDown() {
    const t = this.ctx.currentTime, o = this.osc('sawtooth', 520, t, t + .75), f = this.filt('lowpass', 3500, 5), g = this.gain(0);
    o.frequency.exponentialRampToValueAtTime(38, t + .65); f.frequency.exponentialRampToValueAtTime(160, t + .65);
    g.gain.setValueAtTime(.2, t); g.gain.exponentialRampToValueAtTime(.001, t + .7);
    o.connect(f); f.connect(g); g.connect(this.bus); this.whoosh(false);
  },
  // ---- OBSIDIAN voices ----
  chug(t, m, dur, v = .45, open = false) { // power chord (root, fifth, octave) into the amp; palm-muted unless open
    const end = t + dur + .07, f = this.filt('lowpass', open ? 3200 : 1600, 1.2), g = this.gain(0);
    if (!open) { f.frequency.setValueAtTime(1700, t); f.frequency.exponentialRampToValueAtTime(380, t + dur); }
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .004);
    g.gain.exponentialRampToValueAtTime(v * (open ? .55 : .12), t + dur); g.gain.linearRampToValueAtTime(0, t + dur + .05);
    [[m, 'sawtooth', -7], [m + 7, 'square', 5], [m + 12, 'sawtooth', 9]].forEach(([x, ty, d]) => this.osc(ty, this.mtof(x), t, end, d).connect(f));
    f.connect(g); g.connect(this.driveIn);
  },
  shred(t, m, dur, v = .13) { // distorted chip lead with vibrato on long notes
    const rel = .12, end = t + dur + rel + .05, pre = this.gain(.6), f = this.filt('lowpass', 3000, 2), lp = this.filt('lowpass', 5200, .7), g = this.gain(0);
    const ws = this.ctx.createWaveShaper(); ws.curve = this.curve;
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .01);
    g.gain.setValueAtTime(v, t + Math.max(dur, .02)); g.gain.exponentialRampToValueAtTime(.0001, t + dur + rel);
    const oscs = [this.osc('square', this.mtof(m), t, end, -6), this.osc('sawtooth', this.mtof(m), t, end, 6)];
    oscs.forEach(o => o.connect(pre)); pre.connect(f); f.connect(ws); ws.connect(lp); lp.connect(g);
    if (dur > .3) {
      const lfo = this.osc('sine', 6.2, t, end), lg = this.gain(0);
      lg.gain.setValueAtTime(0, t + .12); lg.gain.linearRampToValueAtTime(32, t + dur);
      lfo.connect(lg); oscs.forEach(o => lg.connect(o.detune));
    }
    const rs = this.gain(.25); g.connect(this.leadBus); g.connect(this.dly); g.connect(rs); rs.connect(this.rev);
  },
  kickTight(t, v = .8) { // short double-bass kick
    const o = this.osc('sine', 150, t, t + .16), g = this.gain(0);
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + .06);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .003); g.gain.exponentialRampToValueAtTime(.001, t + .14);
    o.connect(g); g.connect(this.bus); this.nz(t, .015, 'highpass', 3000, .5, v * .25);
  },
  snareBig(t, v = .7) { // noise crack + tonal body
    this.nz(t, .2, 'bandpass', 2200, .6, v, [this.rev]);
    const o = this.osc('triangle', 210, t, t + .13), g = this.gain(0);
    o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(150, t + .1);
    g.gain.setValueAtTime(v * .6, t); g.gain.exponentialRampToValueAtTime(.001, t + .11); o.connect(g); g.connect(this.bus);
  },
  stamp() { // grade lands: deep thump straight into the master (the song bus is fading out)
    const t = this.ctx.currentTime, o = this.osc('sine', 130, t, t + .5), g = this.gain(0);
    o.frequency.exponentialRampToValueAtTime(38, t + .3);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.7, t + .005); g.gain.exponentialRampToValueAtTime(.001, t + .45);
    o.connect(g); g.connect(this.comp);
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; const f = this.filt('highpass', 3000, .5), ng = this.gain(0);
    ng.gain.setValueAtTime(.25, t); ng.gain.exponentialRampToValueAtTime(.001, t + .25); s.connect(f); f.connect(ng); ng.connect(this.comp); s.start(t); s.stop(t + .3);
  },
  click(t, accent, v = .55) {
    const o = this.osc('sine', accent ? 1760 : 1320, t, t + .06), g = this.gain(0);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + .05); o.connect(g); g.connect(this.bus);
  },
};
