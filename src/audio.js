// Engine sound, synthesised with Web Audio so it follows the throttle in real time.
// Layers: low rumble, filtered roar with combustion flutter, hiss, and supersonic crackle.
// One-shots: igniter clicks + ignition whump on light-up, a chuff on shutdown.
// The AudioContext is only created from a user gesture (the ignite click), so no autoplay.

const PREF_KEY = 'aphel:sound';

function readPref() {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the toggle still works for this visit */
  }
}

// Loopable noise: render a little extra and crossfade it into the start so the loop has no click.
function loopBuffer(ctx, seconds, fill) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const fade = Math.floor(rate * 0.05);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(len + fade);
    fill(raw);
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = raw[i];
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = raw[i] * k + raw[len + i] * (1 - k);
    }
  }
  return buf;
}

const white = (d) => {
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
};

const brown = (d) => {
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
};

// Sparse, spiky bursts: the "tearing" crackle you hear near a rocket plume.
function crackle(rate) {
  return (d) => {
    d.fill(0);
    let i = 0;
    while (i < d.length) {
      i += Math.floor((-Math.log(1 - Math.random()) / 140) * rate);
      const len = 12 + Math.floor(Math.random() * 60);
      const amp = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < len && i + j < d.length; j++) {
        d[i + j] += amp * (Math.random() * 2 - 1) * Math.exp(-j / (len * 0.35));
      }
    }
  };
}

export function createEngineAudio() {
  let enabled = readPref();
  let ctx = null;
  let n = null; // node graph
  let curK = 0; // latest throttle from the frame loop
  let appliedK = -1; // throttle last written to the graph
  let quietSince = 0;

  function build() {
    const c = ctx;
    const gain = (v) => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type, freq, q) => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const loop = (buffer, offset = 0) => {
      const s = c.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.start(0, offset);
      return s;
    };

    const buffers = {
      white: loopBuffer(c, 2, white),
      brown: loopBuffer(c, 4, brown),
      crackle: loopBuffer(c, 3, crackle(c.sampleRate)),
    };

    const master = gain(enabled ? 0.85 : 0);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const analyser = c.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(comp);
    comp.connect(c.destination);
    comp.connect(analyser);

    const rumbleLP = filter('lowpass', 85, 0.9);
    const rumble = gain(0);
    loop(buffers.brown, 1.3).connect(rumbleLP).connect(rumble).connect(master);

    const roarLP = filter('lowpass', 180, 0.6);
    const roar = gain(0);
    loop(buffers.brown).connect(roarLP).connect(roar).connect(master);

    // Combustion flutter: two detuned LFOs wobble the roar level.
    const flutter = gain(0);
    for (const f of [8.7, 13.3]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(flutter);
      o.start();
    }
    flutter.connect(roar.gain);

    const hissBP = filter('bandpass', 2600, 0.7);
    const hiss = gain(0);
    loop(buffers.white).connect(hissBP).connect(hiss).connect(master);

    const crackHP = filter('highpass', 700, 0.7);
    const crack = gain(0);
    loop(buffers.crackle).connect(crackHP).connect(crack).connect(master);

    n = { buffers, master, analyser, rumble, roarLP, roar, flutter, hiss, crack, gain, filter };
  }

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC({ latencyHint: 'interactive' });
    build();
    return true;
  }

  function wake() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
    quietSince = 0;
  }

  // Short filtered noise burst.
  function burst(at, dur, peak, type, freq) {
    const s = ctx.createBufferSource();
    s.buffer = n.buffers.white;
    const f = n.filter(type, freq, 0.8);
    const g = n.gain(0);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f).connect(g).connect(n.master);
    s.start(at, Math.random() * 1.5);
    s.stop(at + dur + 0.05);
    return f;
  }

  function playIgnition() {
    const t = ctx.currentTime + 0.01;
    // Igniter: three dry clicks while the visuals sputter.
    [0, 0.07, 0.16].forEach((d, i) => burst(t + d, 0.05, 0.45 - i * 0.08, 'highpass', 1800));

    // Light-up whump: a noise burst whose filter falls as the flame settles.
    const f = burst(t + 0.12, 1.25, 0.95, 'lowpass', 2600);
    f.frequency.setValueAtTime(2600, t + 0.12);
    f.frequency.exponentialRampToValueAtTime(160, t + 1.1);

    // Body thump you feel more than hear.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.65);
    const og = n.gain(0);
    og.gain.setValueAtTime(0.0001, t + 0.12);
    og.gain.exponentialRampToValueAtTime(0.85, t + 0.135);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    o.connect(og).connect(n.master);
    o.start(t + 0.12);
    o.stop(t + 0.9);
  }

  function playShutdown() {
    const t = ctx.currentTime + 0.01;
    const f = burst(t, 0.45, 0.35, 'lowpass', 900);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.4);
  }

  function pause() {
    if (ctx && ctx.state === 'running') ctx.suspend();
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) pause();
    else if (curK > 0 && enabled) wake();
  });

  return {
    get enabled() {
      return enabled;
    },

    // Call from a user gesture (the toggle click).
    setEnabled(on) {
      enabled = on;
      writePref(on);
      if (on && curK > 0 && ensure()) wake();
      if (n) n.master.gain.setTargetAtTime(on ? 0.85 : 0, ctx.currentTime, 0.08);
    },

    // Call from a user gesture (the ignite click or button).
    ignite() {
      if (!enabled || !ensure()) return;
      wake();
      playIgnition();
    },

    shutdown() {
      if (!enabled || !ctx || ctx.state !== 'running') return;
      playShutdown();
    },

    // Every frame with the engine throttle, 0..1.
    update(k, now) {
      curK = k;
      if (!n || ctx.state !== 'running') {
        appliedK = -1; // re-apply everything once the context is running again
        return;
      }
      if (k <= 0) {
        if (!quietSince) quietSince = now;
        else if (now - quietSince > 2000) pause(); // nothing to hear: let the CPU rest
      } else {
        quietSince = 0;
      }
      if (Math.abs(k - appliedK) < 0.004) return;
      appliedK = k;
      const t = ctx.currentTime;
      const tc = 0.05;
      n.rumble.gain.setTargetAtTime(1.3 * k, t, tc);
      n.roar.gain.setTargetAtTime(0.42 * Math.pow(k, 1.1), t, tc);
      n.roarLP.frequency.setTargetAtTime(160 + 1100 * k, t, tc);
      n.flutter.gain.setTargetAtTime(0.1 * k, t, tc);
      n.hiss.gain.setTargetAtTime(0.07 * k * k, t, tc);
      n.crack.gain.setTargetAtTime(0.55 * Math.pow(k, 1.6), t, tc);
    },

    // QA: current output level (RMS, 0..1).
    level() {
      if (!n) return 0;
      const a = new Float32Array(n.analyser.fftSize);
      n.analyser.getFloatTimeDomainData(a);
      let s = 0;
      let peak = 0;
      for (const v of a) {
        s += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      return { rms: Math.sqrt(s / a.length), peak, state: ctx.state };
    },
  };
}
