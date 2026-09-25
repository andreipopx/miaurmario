// Synthesises the soundtrack (music bed + UI sound effects) as WAV files in public/audio.
// No samples, no dependencies: everything is oscillators, noise and one-pole filters,
// so the output is deterministic and royalty-free.
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;
const FPS = 30;
const out = path.resolve(import.meta.dirname, '../public/audio');
fs.mkdirSync(out, { recursive: true });

// ---------- helpers ----------
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const TAU = Math.PI * 2;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function writeWav(name, data, gain = 1) {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const norm = peak > 0 ? (0.89 / peak) * gain : 1;
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * norm)) * 32767), 44 + i * 2));
  fs.writeFileSync(path.join(out, `${name}.wav`), b);
}

/** Adds `fn(t, i)` into `dst` starting at `at` seconds for `dur` seconds. */
function add(dst, at, dur, fn) {
  const s = Math.floor(at * SR);
  const n = Math.floor(dur * SR);
  for (let i = 0; i < n && s + i < dst.length; i++) if (s + i >= 0) dst[s + i] += fn(i / SR, i);
}

const lowpass = (cut) => {
  let y = 0;
  const a = 1 - Math.exp((-TAU * cut) / SR);
  return (x) => (y += a * (x - y));
};

// ---------- instruments ----------
const kick = (dst, at, g = 1) =>
  add(dst, at, 0.4, (t) => {
    const f = 45 + 110 * Math.exp(-t / 0.03);
    return g * Math.sin(TAU * (45 * t + (110 * 0.03) * (1 - Math.exp(-t / 0.03)))) * Math.exp(-t / 0.13) * (f > 0 ? 1 : 0);
  });

const clap = (dst, at, g = 1) => {
  const lp = lowpass(3500);
  add(dst, at, 0.25, (t) => {
    const bursts = [0, 0.011, 0.022].reduce((s, o) => s + (t >= o ? Math.exp(-(t - o) / (o === 0.022 ? 0.07 : 0.006)) : 0), 0);
    const n = rand();
    return g * (n - lp(n)) * bursts * 0.8;
  });
};

const hat = (dst, at, g = 1, open = false) => {
  const lp = lowpass(7000);
  add(dst, at, open ? 0.2 : 0.06, (t) => {
    const n = rand();
    return g * (n - lp(n)) * Math.exp(-t / (open ? 0.07 : 0.018));
  });
};

const bass = (dst, at, note, dur, g = 1) => {
  const f = midi(note);
  const lp = lowpass(420);
  add(dst, at, dur, (t) => {
    const saw = 2 * ((f * t) % 1) - 1;
    const env = Math.min(1, t / 0.005) * Math.exp(-t / 0.22) * Math.min(1, (dur - t) / 0.02);
    return g * (lp(saw) * 1.6 + 0.5 * Math.sin(TAU * f * t)) * env;
  });
};

/** Soft FM bell / marimba pluck. */
const pluck = (dst, at, note, g = 1, decay = 0.28) => {
  const f = midi(note);
  add(dst, at, decay * 5, (t) => {
    const idx = 1.6 * Math.exp(-t / 0.06);
    return g * Math.sin(TAU * f * t + idx * Math.sin(TAU * 2 * f * t)) * Math.min(1, t / 0.002) * Math.exp(-t / decay);
  });
};

const pad = (dst, at, notes, dur, g = 1) => {
  const lp = lowpass(1400);
  add(dst, at, dur, (t) => {
    let s = 0;
    for (const n of notes) for (const d of [-0.12, 0.12]) s += 2 * ((midi(n + d) * t) % 1) - 1;
    const env = Math.min(1, t / 0.4) * Math.min(1, (dur - t) / 0.4);
    return (g * lp(s / notes.length) * env) / 2;
  });
};

const riser = (dst, at, dur, g = 1) => {
  let y = 0;
  add(dst, at, dur, (t) => {
    const p = t / dur;
    const a = 1 - Math.exp((-TAU * (300 + 7000 * p * p)) / SR);
    y += a * (rand() - y);
    return g * y * p * p;
  });
};

const crash = (dst, at, g = 1) => {
  const lp = lowpass(5000);
  add(dst, at, 2.5, (t) => {
    const n = rand();
    return g * (n - lp(n) * 0.7) * Math.exp(-t / 0.7);
  });
};

// ---------- music ----------
// 120 BPM, one bar = 2 s = 60 video frames. The first groove downbeat lands on frame 86,
// when Stinky pops in on the brand reveal (Brand scene starts at frame 82 in Root.tsx).
const TOTAL_FRAMES = 888;
const DROP = 86 / FPS;
const BEAT = 0.5;
const BAR = 4 * BEAT;
const music = buf(TOTAL_FRAMES / FPS + 0.1);

// C – G – Am – F (I–V–vi–IV); root, then chord tones for the arpeggio.
const PROG = [
  { root: 36, tones: [60, 64, 67, 72] },
  { root: 43, tones: [59, 62, 67, 71] },
  { root: 45, tones: [57, 60, 64, 69] },
  { root: 41, tones: [57, 60, 65, 69] },
];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];

// Intro (hook): pad + a nervous plucked motif + riser into the drop.
pad(music, 0, [48, 55, 60, 64], DROP, 0.5);
[72, 71, 72, 74, 72, 71, 67].forEach((n, i) => pluck(music, 0.13 + i * 0.25, n, 0.35, 0.18));
for (let b = 0; b < 4; b++) clap(music, DROP - BAR + b * BEAT + BEAT, 0.25 + b * 0.08);
riser(music, DROP - 1.4, 1.4, 0.35);

const GROOVE_BARS = 12;
for (let bar = 0; bar < GROOVE_BARS; bar++) {
  const t0 = DROP + bar * BAR;
  const ch = PROG[bar % 4];
  for (let beat = 0; beat < 4; beat++) {
    const t = t0 + beat * BEAT;
    kick(music, t, 0.9);
    if (beat % 2 === 1) clap(music, t, 0.5);
    hat(music, t + BEAT / 2, 0.22, true);
    hat(music, t, 0.12);
    if (bar >= 4) {
      hat(music, t + BEAT / 4, 0.08);
      hat(music, t + (3 * BEAT) / 4, 0.08);
    }
  }
  for (let e = 0; e < 8; e++) {
    const t = t0 + e * (BEAT / 2);
    bass(music, t, ch.root + (e % 4 === 3 ? 12 : 0), BEAT / 2 - 0.02, 0.55);
    pluck(music, t, ch.tones[ARP[e]] + 12, 0.22);
  }
  pad(music, t0, ch.tones.slice(0, 3), BAR, 0.18);
  if (bar % 4 === 0) crash(music, t0, bar === 0 ? 0.35 : 0.18);
}
// Ending: one big C chord on frame 806 that rings out to the last frame.
const END = DROP + GROOVE_BARS * BAR;
kick(music, END, 1);
crash(music, END, 0.4);
bass(music, END, 36, 2.3, 0.6);
[60, 64, 67, 72, 76].forEach((n, i) => pluck(music, END + i * 0.04, n + 12, 0.35, 0.9));
pad(music, END, [48, 55, 60, 64], TOTAL_FRAMES / FPS - END, 0.35);
// Soft limiter: normalise, then tanh drive, so the bed sounds loud on phone speakers.
{
  let peak = 0;
  for (const v of music) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < music.length; i++) music[i] = Math.tanh((2.2 * music[i]) / peak) / Math.tanh(2.2);
}
// Short fade-out on the very end.
const fadeN = Math.floor(0.25 * SR);
for (let i = 0; i < fadeN; i++) music[music.length - 1 - i] *= i / fadeN;
writeWav('music', music, 0.9);

// ---------- sound effects ----------
const sfx = (name, sec, fn) => {
  const b = buf(sec);
  fn(b);
  writeWav(name, b);
};

sfx('pop', 0.15, (b) =>
  add(b, 0, 0.15, (t) => Math.sin(TAU * (380 * t + 2400 * t * t)) * Math.min(1, t / 0.003) * Math.exp(-t / 0.035))
);
sfx('pop-high', 0.15, (b) =>
  add(b, 0, 0.15, (t) => Math.sin(TAU * (700 * t + 3600 * t * t)) * Math.min(1, t / 0.003) * Math.exp(-t / 0.03))
);
sfx('thud', 0.25, (b) => {
  const lp = lowpass(500);
  add(b, 0, 0.25, (t) => (0.7 * Math.sin(TAU * (70 + 60 * Math.exp(-t / 0.02)) * t) + lp(rand())) * Math.exp(-t / 0.06));
});
sfx('whoosh', 0.5, (b) => {
  let y = 0;
  add(b, 0, 0.5, (t) => {
    const p = t / 0.5;
    const a = 1 - Math.exp((-TAU * (500 + 5000 * Math.sin(Math.PI * p))) / SR);
    y += a * (rand() - y);
    return y * Math.sin(Math.PI * p) ** 2;
  });
});
sfx('shutter', 0.25, (b) => {
  for (const [at, d] of [[0, 0.012], [0.07, 0.02]]) {
    const lp = lowpass(2500);
    add(b, at, 0.08, (t) => {
      const n = rand();
      return ((n - lp(n)) * 0.8 + 0.4 * Math.sin(TAU * 1200 * t)) * Math.exp(-t / d);
    });
  }
});
sfx('tick', 0.06, (b) => add(b, 0, 0.06, (t) => Math.sin(TAU * 1900 * t) * Math.exp(-t / 0.012)));
sfx('key', 0.05, (b) => {
  const lp = lowpass(4000);
  add(b, 0, 0.05, (t) => {
    const n = rand();
    return (lp(n) * 0.9 + 0.3 * Math.sin(TAU * 2600 * t)) * Math.exp(-t / 0.008);
  });
});
sfx('chime', 1.4, (b) => [84, 88, 91, 96].forEach((n, i) => pluck(b, i * 0.06, n, 0.5, 0.35)));
sfx('success', 1.0, (b) => {
  pluck(b, 0, 79, 0.6, 0.2);
  pluck(b, 0.1, 84, 0.7, 0.4);
  pluck(b, 0.1, 88, 0.35, 0.4);
});
sfx('heart', 0.8, (b) => {
  add(b, 0, 0.15, (t) => Math.sin(TAU * (500 * t + 3000 * t * t)) * Math.exp(-t / 0.04));
  [91, 96, 100].forEach((n, i) => pluck(b, 0.05 + i * 0.05, n, 0.35, 0.25));
});
sfx('boing', 0.5, (b) =>
  add(b, 0, 0.5, (t) => {
    const f = 180 + 320 * (1 - Math.exp(-t / 0.08)) + 25 * Math.sin(TAU * 14 * t);
    return Math.sin(TAU * f * t) * Math.min(1, t / 0.01) * Math.exp(-t / 0.14);
  })
);
sfx('send', 0.3, (b) =>
  add(b, 0, 0.3, (t) => Math.sin(TAU * (600 * t + 1800 * t * t)) * Math.min(1, t / 0.004) * Math.exp(-t / 0.06))
);

// Purr: low noise, amplitude-modulated at ~26 Hz, in two slow "breaths" (matches the 2.6 s clip).
sfx('purr', 2.6, (b) => {
  const lp = lowpass(260);
  add(b, 0, 2.6, (t) => {
    const breath = Math.sin(Math.PI * ((t % 1.3) / 1.3)) ** 1.5;
    const am = 0.5 + 0.5 * Math.sin(TAU * 26 * t);
    return lp(rand()) * 3 * am * breath * Math.min(1, (2.6 - t) / 0.2);
  });
});
// Chomp: a crunchy click over a soft thump.
sfx('chomp', 0.2, (b) => {
  const lp = lowpass(1800);
  add(b, 0, 0.2, (t) => {
    const n = rand();
    return (lp(n) * 1.4 * Math.exp(-t / 0.025) + 0.6 * Math.sin(TAU * (160 - 300 * t) * t) * Math.exp(-t / 0.05));
  });
});

console.log('audio →', path.relative(process.cwd(), out));
