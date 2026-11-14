"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { BRAND_BARS, BRAND_BAR_WIDTH } from "@/components/Brand";

// Motion for the landing intro. When it plays: lib/intro.ts (inline in <head>).
//
// One canvas draws the environment (light, dust, waves, rings); the four brand
// bars are DOM elements (transforms and opacity only) with colour ghosts, a
// sheen and a soft reflection. Four overlapping acts, just under 6 seconds:
//
//   I    entering    0 - 1.2   the camera pushes forward through deep dust;
//                              light beams, breathing glows, two sonar pulses
//   II   sound       0.5 - 2.3 wave layers cross the viewport in both
//                              directions with leading sparks; dust rides them;
//                              then every wave bends toward the centre
//   III  formation   2.2 - 4.0 the waves collapse into a point of light, dust
//                              spirals into orbit, the bars arrive one by one
//                              (rise, turn in from depth, drop, slide in), crouch
//                              together and strike: the impact
//   IV   hand-off    4.0 - 5.85 a halo tightens round the mark; the bars fly to
//                              the nav logo in a staggered formation, the halo
//                              trailing; a wavefront sweeps out and opens the page
//
// Any key, click, touch or wheel fast-forwards to the hand-off.

const VIEW = 18;
const TAU = Math.PI * 2;
const BG = "#0b0c0e";

// Timeline, in seconds.
const T = {
  waves: 0.5,
  converge: 1.6,
  focal: 2.2,
  // Bar entrances, by bar index (left to right): tallest first.
  bars: [3.15, 2.7, 2.45, 2.95],
  crouch: 3.55,
  impact: 3.8,
  halo: 4.05,
  flight: 4.4,
  flightDur: 1.2,
  open: 4.7,
  openDur: 1.0,
  release: 4.55,
  end: 5.85,
};
// Sonar pulses in the opening: start times, and how long each one travels.
const PULSES = [0.25, 0.95];
const PULSE_DUR = 1.5;

// Bar centres in mark units, from the visual centre of the glyph (its bars
// span x = 1..15 of the 18-unit box).
const MIN_X = Math.min(...BRAND_BARS.map((b) => b.x));
const MAX_X = Math.max(...BRAND_BARS.map((b) => b.x + BRAND_BAR_WIDTH));
const GLYPH_CX = (MIN_X + MAX_X) / 2;
const VISUAL_OFFSET = (VIEW / 2 - GLYPH_CX) / VIEW;
const BAR_CX = BRAND_BARS.map((b) => (b.x + BRAND_BAR_WIDTH / 2 - GLYPH_CX) / VIEW);

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (a: number, b: number, v: number) => {
  const k = clamp((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const smoother = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);
// Underdamped spring 0 -> 1 (overshoots and rings down: a struck bar).
const spring = (tau: number, omega: number, zeta: number) => {
  if (tau <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * tau) * (Math.cos(wd * tau) + ((zeta * omega) / wd) * Math.sin(wd * tau));
};
// Critically damped approach 0 -> 1.
const settle = (tau: number, omega: number) => (tau <= 0 ? 0 : 1 - (1 + omega * tau) * Math.exp(-omega * tau));
// Decaying oscillation after an event, 0 before it.
const ring = (tau: number, decay: number, freq: number, phase = 0) =>
  tau <= 0 ? 0 : Math.exp(-decay * tau) * Math.sin(freq * tau + phase);

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // depth: 0.15 far .. 1 near
  lane: number; // wave it rides
  rides: boolean; // joins the waves
  captured: boolean; // spirals into the orbit and the halo
  orbit: number; // orbit radius, in mark sizes
  spin: number; // orbit direction and speed
  seed: number;
};

type IntroWindow = Window & { __sonovateIntro?: number };

const INTRO_CLASSES = ["intro-play", "intro-hold", "intro-reduced", "intro-landed"];
let pendingTeardown = 0;

function clearIntroClasses() {
  document.documentElement.classList.remove(...INTRO_CLASSES);
}

// Foreground and background wave layers. off/tilt place each line on screen
// before the convergence; dir is the travel direction of its leading spark.
type Wave = {
  off: number;
  tilt: number;
  lam: number;
  om: number;
  amp: number;
  dir: 1 | -1;
  t0: number;
  rgb: string;
  alpha: number;
  back: boolean;
};
const WAVES: Wave[] = [
  { off: -0.2, tilt: -0.07, lam: 0.13, om: 6.2, amp: 0.07, dir: 1, t0: 0.5, rgb: "255,138,92", alpha: 1, back: false },
  { off: 0.02, tilt: 0.0, lam: 0.09, om: 8.4, amp: 0.085, dir: -1, t0: 0.7, rgb: "255,122,74", alpha: 1, back: false },
  { off: 0.19, tilt: 0.06, lam: 0.18, om: 5.0, amp: 0.06, dir: 1, t0: 0.85, rgb: "224,83,28", alpha: 0.95, back: false },
  { off: 0.08, tilt: -0.03, lam: 0.066, om: 10.5, amp: 0.045, dir: -1, t0: 1.0, rgb: "255,176,143", alpha: 0.8, back: false },
  { off: -0.34, tilt: 0.04, lam: 0.24, om: 3.6, amp: 0.05, dir: -1, t0: 0.35, rgb: "224,83,28", alpha: 0.45, back: true },
  { off: 0.33, tilt: -0.05, lam: 0.21, om: 4.1, amp: 0.045, dir: 1, t0: 0.55, rgb: "255,122,74", alpha: 0.4, back: true },
  { off: -0.08, tilt: 0.02, lam: 0.3, om: 3.0, amp: 0.06, dir: 1, t0: 0.2, rgb: "224,83,28", alpha: 0.35, back: true },
];
const FRONT_PASSES: [number, number][] = [
  [12, 0.04],
  [5, 0.11],
  [1.4, 0.8],
];
const BACK_PASSES: [number, number][] = [
  [6, 0.05],
  [1, 0.5],
];

// Light beams falling through the dark (angle in radians from vertical).
const BEAMS = [
  { x: 0.22, angle: 0.32, width: 0.16, sway: 0.05, speed: 0.31, alpha: 0.12 },
  { x: 0.58, angle: -0.18, width: 0.24, sway: 0.04, speed: 0.23, alpha: 0.09 },
  { x: 0.86, angle: -0.42, width: 0.12, sway: 0.06, speed: 0.37, alpha: 0.1 },
];

// Glows that drift, breathe and finally gather at the centre.
const GLOWS = [
  { ox: -0.28, oy: -0.12, r: 0.55, rgb: "255,122,74", a: 0.09, sp: 0.21 },
  { ox: 0.3, oy: 0.16, r: 0.5, rgb: "224,83,28", a: 0.1, sp: 0.17 },
  { ox: 0.05, oy: 0.3, r: 0.42, rgb: "255,176,143", a: 0.05, sp: 0.27 },
];

// Particle depth layers, drawn as one batch each.
const DEPTHS = [
  { max: 0.38, size: 0.9, rgb: "224,83,28", alpha: 0.45 },
  { max: 0.65, size: 1.3, rgb: "255,122,74", alpha: 0.65 },
  { max: 0.86, size: 1.8, rgb: "255,150,110", alpha: 0.8 },
  { max: 1.01, size: 2.5, rgb: "255,190,160", alpha: 0.9 },
];

function barStyle(b: (typeof BRAND_BARS)[number]): CSSProperties {
  return {
    left: `${(b.x / VIEW) * 100}%`,
    top: `${(b.y / VIEW) * 100}%`,
    width: `${(BRAND_BAR_WIDTH / VIEW) * 100}%`,
    height: `${(b.h / VIEW) * 100}%`,
  };
}

export function IntroStage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const mark = markRef.current;
    if (pendingTeardown) {
      window.clearTimeout(pendingTeardown);
      pendingTeardown = 0;
    }
    if (!root || !canvas || !mark || !html.classList.contains("intro-play")) return;

    // This code now owns the failsafe.
    const w = window as IntroWindow;
    if (w.__sonovateIntro) window.clearTimeout(w.__sonovateIntro);
    w.__sonovateIntro = undefined;

    const reduced = html.classList.contains("intro-reduced");
    const ctx = reduced ? null : canvas.getContext("2d");
    let raf = 0;
    let done = false;
    let failsafe = 0;

    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(failsafe);
      removeListeners();
      clearIntroClasses();
    };

    // --- skip: fast-forward to the hand-off ------------------------------------
    let speed = 1;
    const skip = () => {
      speed = 4;
    };
    const skipEvents = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    skipEvents.forEach((type) => window.addEventListener(type, skip, { passive: true }));
    const removeListeners = () => {
      skipEvents.forEach((type) => window.removeEventListener(type, skip));
      window.removeEventListener("resize", resize);
    };

    // --- geometry -----------------------------------------------------------------
    let W = 0;
    let H = 0;
    let S = 0;
    let cx = 0;
    let cy = 0;
    let diag = 0;
    let dpr = 1;
    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      S = mark.offsetWidth || 120;
      cx = W / 2;
      cy = H / 2;
      diag = Math.hypot(W, H);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });

    const layer = (name: string) => [...mark.querySelectorAll<HTMLElement>(`.intro-${name} .intro-bar`)];
    const core = layer("core");
    const hi = layer("hi");
    const lo = layer("lo");
    const reflect = layer("reflect");
    const reflectLayer = mark.querySelector<HTMLElement>(".intro-reflect");
    const sheens = [...mark.querySelectorAll<HTMLElement>(".intro-sheen")];
    const bloom = mark.querySelector<HTMLElement>(".intro-bloom");

    root.classList.add("is-live");

    // --- reduced motion: the still mark, then a soft fade -------------------------
    if (reduced) {
      const start = performance.now();
      const frame = (now: number) => {
        const t = (now - start) / 1000;
        mark.style.opacity = String(smooth(0, 0.35, t));
        root.style.opacity = String(1 - smooth(1.0, 1.5, t));
        if (t >= 1.5) finish();
        else raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      failsafe = window.setTimeout(finish, 3000);
      return () => teardown();
    }

    // --- particles ----------------------------------------------------------------
    // Deterministic sequence so every load looks the same.
    let rs = 1337;
    const rand = () => {
      rs = (rs * 16807) % 2147483647;
      return (rs - 1) / 2147483646;
    };
    const frontLanes = WAVES.map((wv, i) => (wv.back ? -1 : i)).filter((i) => i >= 0);
    const count = Math.round(clamp((W * H) / 420, 700, 2800));
    const spawn = (p: Particle, nearCentre: boolean) => {
      // Dust that leaves the screen comes back near the centre (far away) and
      // streams outward again as the camera moves forward.
      const spread = nearCentre ? 0.18 + 0.25 * rand() : 1;
      p.x = cx + (rand() - 0.5) * W * 1.15 * spread;
      p.y = cy + (rand() - 0.5) * H * 1.15 * spread;
      p.vx = 0;
      p.vy = 0;
    };
    const particles: Particle[] = Array.from({ length: count }, (_, i) => {
      const p: Particle = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        z: 0.15 + 0.85 * rand() ** 1.8,
        lane: frontLanes[i % frontLanes.length],
        rides: rand() < 0.62,
        captured: rand() < 0.4,
        orbit: 0.85 + rand() ** 1.5 * 1.6,
        spin: (rand() < 0.82 ? 1 : -1) * (0.9 + rand() * 1.6),
        seed: rand() * TAU,
      };
      spawn(p, false);
      return p;
    });

    // Events that kick the dust: each bar landing locally, the impact everywhere.
    const kicks = [
      ...T.bars.map((bt, i) => ({ t: bt + 0.12, dx: BAR_CX[i], k: 0.35, fired: false })),
      { t: T.impact, dx: 0, k: 1, fired: false },
    ];

    // Nav logo the mark hands off to (measured as the flight begins).
    let target: { x: number; y: number; scale: number } | null = null;
    const measureTarget = () => {
      const svg = document.querySelector<SVGElement>(".landing .l-nav .brand svg");
      const r = svg?.getBoundingClientRect();
      if (!r || r.width === 0 || r.bottom < 0 || r.top > H) return null;
      return { x: r.left + r.width / 2 - cx, y: r.top + r.height / 2 - cy, scale: r.width / S };
    };

    // Flight path (screen offsets from the centre): dips, then sweeps up and
    // approaches the logo almost level.
    const flightPoint = (q: number) => {
      const x0 = S * VISUAL_OFFSET;
      const tx = target?.x ?? 0;
      const ty = target?.y ?? 0;
      const p1x = x0 + (tx - x0) * 0.04;
      const p1y = S * 0.55;
      const p2x = tx + Math.abs(tx - x0) * 0.28;
      const p2y = ty + S * 0.08;
      const u = 1 - q;
      return {
        x: u * u * u * x0 + 3 * u * u * q * p1x + 3 * u * q * q * p2x + q * q * q * tx,
        y: 3 * u * u * q * p1y + 3 * u * q * q * p2y + q * q * q * ty,
      };
    };
    const flightK = (t: number, lag = 0) => smoother(clamp((t - T.flight - lag) / T.flightDur));

    // Late start (slow network): begin with the mark formed, just before the halo.
    let t = performance.now() > 2400 ? T.halo - 0.2 : 0;
    let last = performance.now();
    let markScale = 1;
    let markX = 0;
    let markY = 0;
    let shakeX = 0;
    let shakeY = 0;
    let prevHx = NaN;
    let prevHy = NaN;

    // Each bar's own entrance. dx/dy/dz in px (mark-local), angles in degrees.
    const barState = (i: number, tau: number) => {
      const st = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 0, op: 0, blur: 0, away: 1 };
      if (tau <= 0) return st;
      if (i === 2) {
        // Rises out of the point of light, a shaft of light behind it.
        const e = settle(tau, 6);
        st.sy = spring(tau, 11, 0.33);
        st.sx = 1 + 0.6 * (1 - e);
        st.op = smooth(0, 0.12, tau);
        st.blur = 5 * (1 - e);
        st.away = 1 - e;
      } else if (i === 1) {
        // Turns in from depth, edge-on, from the left.
        const e = settle(tau, 5.5);
        st.ry = 92 * (1 - e);
        st.dz = -S * 3.2 * (1 - e);
        st.dx = -S * 0.9 * (1 - e);
        st.sy = 0.35 + 0.65 * spring(tau, 10, 0.4);
        st.op = smooth(0, 0.25, tau);
        st.blur = 8 * (1 - e);
        st.away = 1 - e;
      } else if (i === 3) {
        // Drops from above, tumbling forward, stretched by its speed.
        const e = settle(tau, 6.5);
        st.dy = -H * 0.65 * (1 - e);
        st.rx = -75 * (1 - e);
        st.sy = (1 + 0.9 * (1 - e) ** 2) * (0.85 + 0.15 * spring(tau, 14, 0.3));
        st.op = smooth(0, 0.18, tau);
        st.blur = 6 * (1 - e) ** 2;
        st.away = 1 - e;
      } else {
        // Slides in along the horizon as a short dash, then stands up.
        const e = settle(tau, 10);
        st.dx = -W * 0.42 * (1 - e);
        st.sx = 1 + 2.2 * (1 - e);
        st.sy = 0.12 + 0.88 * spring(tau - 0.14, 13, 0.34);
        st.rz = -8 * (1 - e);
        st.op = smooth(0, 0.15, tau);
        st.blur = 7 * (1 - e) ** 2;
        st.away = 1 - e;
      }
      return st;
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      t += dt * (t < T.flight ? speed : 1);

      if (t > T.flight && !target) target = measureTarget() ?? { x: 0, y: 0, scale: 0 };
      const hasTarget = !!target && target.scale > 0;
      const q = flightK(t);
      const pre = 1 - q;

      // Impact shake: a few pixels, gone in half a second.
      const ti = t - T.impact;
      shakeX = ring(ti, 9, 47) * S * 0.03;
      shakeY = ring(ti, 9, 39, 1.3) * S * 0.022;

      // ------------------------------------------------------------------ mark
      let scale = 0.92 + 0.08 * smooth(T.focal, T.impact, t);
      scale *= ti < 0 ? 1 - 0.05 * smooth(T.crouch, T.impact, t) : 1 + 0.06 * ring(ti, 4.5, 12);
      const formed = settle(t - (T.focal + 0.2), 2.6);
      const rotY = -14 * (1 - formed) - 22 * Math.sin(Math.PI * q);
      const rotX = 9 * (1 - formed) * pre;
      const rotZ = -5 * Math.sin(Math.PI * q);
      let x = S * VISUAL_OFFSET + shakeX;
      let y = shakeY;
      let markOpacity = 1;
      const qLast = flightK(t, 3 * 0.02);
      if (hasTarget && target) {
        const fp = flightPoint(q);
        x = fp.x + shakeX * pre;
        y = fp.y + shakeY * pre;
        scale = Math.exp(lerp(Math.log(scale), Math.log(target.scale), q ** 1.5));
        markOpacity = 1 - smooth(0.88, 1, qLast);
        // The nav logo takes over as the bars settle into it.
        if (qLast >= 0.92) html.classList.add("intro-landed");
      } else if (target) {
        // No nav logo in view: the mark swells and dissolves into the page.
        scale *= 1 + 0.9 * q;
        markOpacity = 1 - smooth(0.1, 0.8, q);
      }
      markScale = scale;
      markX = x;
      markY = y;
      mark.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) rotateZ(${rotZ.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      mark.style.opacity = markOpacity.toFixed(3);

      // Crouch, then strike: every bar together.
      const strike = ti < 0 ? 1 - 0.38 * smooth(T.crouch, T.impact, t) : 0.62 + 0.38 * spring(ti, 15, 0.26);
      const hit = ti > 0 ? Math.exp(-3.5 * ti) : 0;

      for (let i = 0; i < core.length; i++) {
        const tau = t - T.bars[i];
        const s = barState(i, tau);
        // Sympathetic ring-down: each landing shakes the bars already standing.
        let sym = 0;
        for (let j = 0; j < T.bars.length; j++) {
          if (j !== i && T.bars[j] > T.bars[i]) sym += 0.07 * ring(t - T.bars[j] - 0.15, 6, 26, i);
        }
        let sy = s.sy * (1 + sym) * strike;
        sy *= 1 + 0.015 * Math.sin(t * 17 + i * 1.7) * smooth(T.bars[i] + 0.6, T.bars[i] + 1, t) * pre;
        sy = Math.max(0.02, sy);

        // Staggered flight: bar i trails the mark a little, in local units.
        let fx = 0;
        let fy = 0;
        if (hasTarget && q > 0 && q < 1) {
          const a = flightPoint(q);
          const b = flightPoint(flightK(t, i * 0.02));
          fx = (b.x - a.x) / scale;
          fy = (b.y - a.y) / scale;
        }
        const base = `translate3d(${(s.dx + fx).toFixed(2)}px, ${(s.dy + fy).toFixed(2)}px, ${s.dz.toFixed(2)}px) rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg) rotateZ(${s.rz.toFixed(2)}deg) scale(${s.sx.toFixed(4)}, ${sy.toFixed(4)})`;
        const filter = s.blur > 0.2 ? `blur(${s.blur.toFixed(2)}px)` : "none";
        const c = core[i];
        c.style.transform = base;
        c.style.opacity = s.op.toFixed(3);
        c.style.filter = filter;

        // Colour ghosts split while the bar arrives and on the impact, then
        // resolve: a slight chromatic separation.
        const split = S * (0.1 * s.away + 0.035 * hit * Math.sin(26 * ti + i));
        const ghost = s.op * (0.75 * s.away + 0.6 * hit) * pre;
        for (const [els, sign] of [
          [hi, -1],
          [lo, 1],
        ] as const) {
          const g = els[i];
          g.style.transform = `translate3d(${(sign * split).toFixed(2)}px, 0, 0) ${base}`;
          g.style.opacity = ghost.toFixed(3);
          g.style.filter = filter;
        }
        const r = reflect[i];
        if (r) {
          r.style.transform = base;
          r.style.opacity = s.op.toFixed(3);
        }

        // Light sweeping up each bar: softly as it lands, brightly after the impact.
        const sh = sheens[i];
        if (sh) {
          const p1 = clamp((tau - 0.2) / 0.4);
          const p2 = clamp((t - (T.impact + 0.05 + i * 0.05)) / 0.45);
          const p = p2 > 0 ? p2 : p1;
          sh.style.opacity = p > 0 && p < 1 ? (p2 > 0 ? "1" : "0.6") : "0";
          sh.style.transform = `translate3d(0, ${(100 - 200 * p).toFixed(2)}%, 0)`;
        }
      }
      if (reflectLayer) reflectLayer.style.opacity = (0.22 * (1 - smooth(0, 0.3, q))).toFixed(3);

      if (bloom) {
        const standing = T.bars.reduce((sum, bt) => sum + smooth(bt, bt + 0.4, t), 0) / 4;
        const b =
          (0.18 * smooth(T.focal, T.focal + 0.5, t) + 0.32 * standing + 0.55 * hit + 0.12 * smooth(T.halo, T.flight, t)) *
          (1 - smooth(0.1, 0.6, q));
        const bs = 0.75 + 0.25 * standing + 0.35 * (ti > 0 ? 1 - Math.exp(-2.5 * ti) : 0) * (1 - 0.4 * smooth(T.halo, T.flight, t));
        bloom.style.opacity = b.toFixed(3);
        bloom.style.transform = `scale(${bs.toFixed(4)})`;
      }

      // ---------------------------------------------------------------- canvas
      if (ctx) drawCanvas(ctx, dt);

      // --------------------------------------------------------------- backdrop
      if (t > T.open) {
        const k = smoother(clamp((t - T.open) / T.openDur));
        const feather = Math.max(W, H) * 0.48;
        const iris = -feather + k * (diag / 2 + feather * 2);
        root.style.setProperty("--iris", `${iris.toFixed(1)}px`);
        root.style.setProperty("--feather", `${feather.toFixed(1)}px`);
        root.classList.add("is-opening");
      }
      if (t >= T.release) html.classList.remove("intro-hold");
      if (t >= T.end) finish();
      else raf = requestAnimationFrame(frame);
    };

    // --- canvas ------------------------------------------------------------------
    let conv = 0; // waves: 0 spread over the screen .. 1 gathered at the centre
    let collapse = 0; // 1 once the gathered bundle has collapsed into the point
    const waveY = (wv: Wave, x: number) => {
      const lam = wv.lam * W * lerp(1, 0.28, conv);
      const k = TAU / lam;
      const sigma = lerp(W * 0.9, S * 0.55, conv);
      const g = Math.exp(-(((x - cx) / sigma) ** 2));
      const env = lerp(0.55 + 0.45 * g, g, conv) * (1 - collapse);
      const base = cy + (wv.off * H + wv.tilt * (x - cx)) * (1 - smoother(conv));
      const a = lerp(wv.amp * H, S * 0.42 * (wv.back ? 0.5 : 1), conv);
      const ph = wv.dir * wv.om * (t - wv.t0);
      const c0 = wv.lam * 40;
      // Three partials and a slow beat along the line, so no two cycles match.
      const carrier =
        0.55 * Math.sin(k * x - ph) +
        0.28 * Math.sin(2.31 * k * x + 1.6 * ph + c0) +
        0.17 * Math.sin(4.13 * k * x - 2.7 * ph + c0 * 1.7);
      const beat = 0.5 + 0.5 * Math.sin(0.37 * k * x - 0.35 * ph + c0 * 0.6);
      const swell = 0.8 + 0.2 * Math.sin(t * 1.7 + c0);
      return base + a * env * swell * (0.35 + 0.65 * beat) * carrier * 1.25;
    };
    // How far each wave has travelled in (its leading spark), as a share of the width.
    const waveHead = (wv: Wave) => clamp((t - wv.t0) / (wv.back ? 1.5 : 1.0)) * 1.25;

    const drawCanvas = (c: CanvasRenderingContext2D, dt: number) => {
      const ti = t - T.impact;
      const hit = ti > 0 ? Math.exp(-2.6 * ti) : 0;
      const q = flightK(t);
      const opening = t > T.open ? smoother(clamp((t - T.open) / T.openDur)) : 0;
      conv = smooth(T.converge, T.focal + 0.15, t);
      collapse = smooth(T.focal, T.focal + 0.3, t);

      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalCompositeOperation = "source-over";
      c.fillStyle = BG;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = "lighter";

      // Drifting, breathing glows that gather at the centre.
      const gather = smooth(T.converge, T.focal + 0.5, t);
      const intro = smooth(0, 0.5, t);
      for (let i = 0; i < GLOWS.length; i++) {
        const gl = GLOWS[i];
        const breathe = 1 + 0.18 * Math.sin(t * 1.3 + i * 2.1);
        const gx = cx + lerp(gl.ox * W + Math.cos(t * gl.sp + i) * W * 0.08, 0, gather);
        const gy = cy + lerp(gl.oy * H + Math.sin(t * gl.sp * 1.3 + i) * H * 0.08, 0, gather);
        const gr = Math.max(W, H) * gl.r * breathe * lerp(1, 0.55, gather) * (1 + 0.5 * hit);
        const ga = gl.a * intro * (1 + 0.6 * gather + 1.2 * hit) * (1 - 0.5 * q);
        const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
        g.addColorStop(0, `rgba(${gl.rgb},${ga.toFixed(3)})`);
        g.addColorStop(1, `rgba(${gl.rgb},0)`);
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
      }

      // Volumetric beams: in early, swaying, gone as the formation starts.
      const beamA = smooth(0.05, 0.7, t) * (1 - smooth(T.converge + 0.2, T.focal + 0.4, t));
      if (beamA > 0.003) {
        for (let i = 0; i < BEAMS.length; i++) {
          const bm = BEAMS[i];
          const ang = bm.angle + Math.sin(t * bm.speed + i) * bm.sway;
          const bw = W * bm.width * (1 + 0.15 * Math.sin(t * 0.9 + i));
          c.save();
          c.translate(W * bm.x, -H * 0.15);
          c.rotate(ang);
          const g = c.createLinearGradient(-bw / 2, 0, bw / 2, 0);
          const a = bm.alpha * beamA;
          g.addColorStop(0, "rgba(255,122,74,0)");
          g.addColorStop(0.5, `rgba(255,140,96,${a.toFixed(3)})`);
          g.addColorStop(1, "rgba(255,122,74,0)");
          c.fillStyle = g;
          c.fillRect(-bw / 2, 0, bw, diag * 1.3);
          c.restore();
        }
      }

      // Camera: a slow forward drift with a slight roll, settling for the
      // formation; the impact shakes it.
      const settleCam = smooth(T.focal, T.impact, t);
      const zoom = 1 + 0.08 * smooth(0.2, T.focal, t) - 0.03 * settleCam;
      const roll = 0.03 * Math.sin(t * 0.33 + 0.6) * (1 - settleCam);
      const camX = Math.sin(t * 0.27) * W * 0.014 * (1 - settleCam) + shakeX;
      const camY = Math.cos(t * 0.21) * H * 0.012 * (1 - settleCam) + shakeY;
      const setCam = (depth: number) => {
        // depth < 1 moves less: parallax for the background layers.
        const z = 1 + (zoom - 1) * depth;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.translate(cx + camX * depth, cy + camY * depth);
        c.rotate(roll * depth);
        c.scale(z, z);
        c.translate(-cx, -cy);
      };

      // Slow sonar pulses from the centre (they also push the dust).
      const pulses = PULSES.map((p0) => t - p0);

      // Waves.
      c.lineCap = "round";
      c.lineJoin = "round";
      const wavesA = 1 - smooth(T.focal + 0.05, T.focal + 0.35, t);
      if (wavesA > 0.003) {
        const step = Math.max(4, W / 280);
        for (const back of [true, false]) {
          setCam(back ? 0.45 : 1);
          for (const wv of WAVES) {
            if (wv.back !== back) continue;
            const head = waveHead(wv);
            if (head <= 0) continue;
            const a0 = wv.alpha * wavesA * smooth(wv.t0, wv.t0 + 0.3, t);
            // Revealed span: from the entry edge to the leading spark.
            const from = wv.dir > 0 ? -step : W - head * W;
            const to = wv.dir > 0 ? head * W : W + step;
            const path = new Path2D();
            let first = true;
            for (let x = Math.max(-step, from); x <= Math.min(W + step, to); x += step) {
              const y = waveY(wv, x);
              if (first) path.moveTo(x, y);
              else path.lineTo(x, y);
              first = false;
            }
            const edge = lerp(0.1, 0.4, conv);
            for (const [width, a] of back ? BACK_PASSES : FRONT_PASSES) {
              const rgba = (k: number) => `rgba(${wv.rgb},${(a * a0 * k).toFixed(3)})`;
              const g = c.createLinearGradient(0, 0, W, 0);
              g.addColorStop(0, rgba(0));
              g.addColorStop(edge, rgba(1));
              g.addColorStop(1 - edge, rgba(1));
              g.addColorStop(1, rgba(0));
              c.lineWidth = width;
              c.strokeStyle = g;
              c.stroke(path);
            }
            // Leading spark while the wave is still crossing.
            if (head < 1.05 && !back) {
              const hx = wv.dir > 0 ? head * W : W - head * W;
              const hy = waveY(wv, hx);
              const hr = 26 + 16 * Math.sin(t * 9 + wv.om);
              const g = c.createRadialGradient(hx, hy, 0, hx, hy, hr);
              g.addColorStop(0, `rgba(255,220,200,${(0.55 * a0).toFixed(3)})`);
              g.addColorStop(0.25, `rgba(255,138,92,${(0.25 * a0).toFixed(3)})`);
              g.addColorStop(1, "rgba(255,122,74,0)");
              c.fillStyle = g;
              c.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
            }
          }
        }
      }

      setCam(1);

      for (const pt of pulses) {
        if (pt <= 0 || pt > PULSE_DUR) continue;
        const p = pt / PULSE_DUR;
        c.beginPath();
        c.arc(cx, cy, p * diag * 0.6, 0, TAU);
        c.lineWidth = 1 + 10 * (1 - p);
        c.strokeStyle = `rgba(255,122,74,${(0.07 * (1 - p) ** 1.5 * intro).toFixed(3)})`;
        c.stroke();
      }

      // The point of light the waves collapse into, and its horizontal scatter.
      const focal = smooth(T.converge + 0.2, T.focal + 0.15, t) * (1 - smooth(T.bars[2] + 0.1, T.bars[2] + 0.6, t));
      const flare = Math.max(focal * 0.9, 0.38 * hit) * (1 - smooth(0, 0.4, q));
      if (flare > 0.004) {
        const fr = S * (0.5 + 0.9 * focal) * (1 + 0.06 * Math.sin(t * 22));
        let g = c.createRadialGradient(cx, cy, 0, cx, cy, fr);
        g.addColorStop(0, `rgba(255,236,224,${(0.9 * focal).toFixed(3)})`);
        g.addColorStop(0.2, `rgba(255,150,105,${(0.5 * focal).toFixed(3)})`);
        g.addColorStop(1, "rgba(255,122,74,0)");
        c.fillStyle = g;
        c.fillRect(cx - fr, cy - fr, fr * 2, fr * 2);
        c.save();
        c.translate(cx, cy);
        c.scale(1, 0.028);
        const lr = W * 0.55;
        g = c.createRadialGradient(0, 0, 0, 0, 0, lr);
        g.addColorStop(0, `rgba(255,205,180,${(0.4 * flare).toFixed(3)})`);
        g.addColorStop(0.35, `rgba(255,122,74,${(0.14 * flare).toFixed(3)})`);
        g.addColorStop(1, "rgba(255,122,74,0)");
        c.fillStyle = g;
        c.fillRect(-lr, -lr, lr * 2, lr * 2);
        c.restore();
      }

      // Light that accompanies each bar's entrance.
      for (let i = 0; i < 4; i++) {
        const tau = t - T.bars[i];
        if (tau <= 0 || tau > 1.4) continue;
        const bx = cx + BAR_CX[i] * S * markScale;
        const a = Math.exp(-3.2 * tau) * smooth(0, 0.08, tau);
        if (i === 0) {
          // Light trail along the horizon behind the sliding dash.
          const e = settle(tau, 10);
          const head = bx - W * 0.42 * (1 - e);
          const len = W * 0.5 * (1 - e) + S * 0.4;
          const g = c.createLinearGradient(head - len, 0, head, 0);
          g.addColorStop(0, "rgba(255,122,74,0)");
          g.addColorStop(1, `rgba(255,190,160,${(0.55 * a).toFixed(3)})`);
          c.fillStyle = g;
          c.fillRect(head - len, cy - 1.5, len, 3);
        } else {
          // A vertical shaft through the bar's position.
          const len = H * (i === 2 ? 0.9 : 0.5);
          const g = c.createLinearGradient(0, cy - len / 2, 0, cy + len / 2);
          const peak = (i === 2 ? 0.5 : 0.28) * a;
          g.addColorStop(0, "rgba(255,122,74,0)");
          g.addColorStop(0.5, `rgba(255,200,175,${peak.toFixed(3)})`);
          g.addColorStop(1, "rgba(255,122,74,0)");
          c.fillStyle = g;
          const bw = (i === 2 ? 3 : 2) + 10 * a;
          c.fillRect(bx - bw / 2, cy - len / 2, bw, len);
        }
        // Local ripple ring.
        const p = tau / 1.1;
        if (p < 1) {
          c.beginPath();
          c.arc(bx, cy, S * 0.2 + (1 - (1 - p) ** 3) * S * 2.4, 0, TAU);
          c.lineWidth = 1 + 3 * (1 - p);
          c.strokeStyle = `rgba(255,138,92,${(0.3 * (1 - p) ** 2).toFixed(3)})`;
          c.stroke();
        }
      }

      // Impact: pressure rings, one of them carrying a frequency ripple.
      if (ti > 0) {
        for (let k = 0; k < 4; k++) {
          const p = (ti - k * 0.12) / 1.6;
          if (p <= 0 || p >= 1) continue;
          const e = 1 - (1 - p) ** 3;
          const R = S * 0.6 + e * diag * 0.62;
          const a = ((1 - p) ** 2 * 0.36) / (k + 1);
          c.beginPath();
          if (k === 1) {
            const n = 140;
            for (let j = 0; j <= n; j++) {
              const th = (j / n) * TAU;
              const rr = R + Math.sin(th * 18 + ti * 14) * S * 0.07 * (1 - p);
              const px = cx + Math.cos(th) * rr;
              const py = cy + Math.sin(th) * rr;
              if (j === 0) c.moveTo(px, py);
              else c.lineTo(px, py);
            }
          } else {
            c.arc(cx, cy, R, 0, TAU);
          }
          c.lineWidth = (1 - p) * 6 + 0.6;
          c.strokeStyle = `rgba(255,138,92,${a.toFixed(3)})`;
          c.stroke();
        }
      }

      // Dust.
      updateParticles(dt, pulses);
      const pa = smooth(0, 0.4, t) * (1 - 0.35 * opening);
      for (let b = 0; b < DEPTHS.length; b++) {
        const d = DEPTHS[b];
        const minZ = b === 0 ? 0 : DEPTHS[b - 1].max;
        const dots = new Path2D();
        const streaks = new Path2D();
        let hasStreak = false;
        for (const p of particles) {
          if (p.z < minZ || p.z >= d.max) continue;
          if (p.vx * p.vx + p.vy * p.vy > 900) {
            // Fast dust draws as a motion streak.
            streaks.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
            streaks.lineTo(p.x, p.y);
            hasStreak = true;
          } else {
            dots.rect(p.x - d.size / 2, p.y - d.size / 2, d.size, d.size);
          }
        }
        const a = clamp(d.alpha * pa);
        c.fillStyle = `rgba(${d.rgb},${a.toFixed(3)})`;
        c.fill(dots);
        if (hasStreak) {
          c.lineWidth = d.size * 0.8;
          c.strokeStyle = `rgba(${d.rgb},${a.toFixed(3)})`;
          c.stroke(streaks);
        }
      }

      // Hand-off: the glowing wavefront at the edge of the opening.
      if (opening > 0 && opening < 1) {
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const feather = Math.max(W, H) * 0.48;
        const R = -feather + opening * (diag / 2 + feather * 2) + feather * 0.35;
        const fadeIn = smooth(0.1, 0.3, opening);
        if (R > 0 && fadeIn > 0) {
          c.globalAlpha = fadeIn;
          c.beginPath();
          c.arc(cx, cy, R, 0, TAU);
          c.lineWidth = 2 + 26 * (1 - opening);
          c.strokeStyle = `rgba(255,138,92,${(0.1 * (1 - opening)).toFixed(3)})`;
          c.stroke();
          c.lineWidth = 1.5;
          c.strokeStyle = `rgba(255,200,175,${(0.18 * (1 - opening)).toFixed(3)})`;
          c.stroke();
          c.globalAlpha = 1;
        }
      }
    };

    const updateParticles = (dt: number, pulses: number[]) => {
      // Forward drift (dust streams out from the centre), fast at first.
      const dolly = 1.5 * (1 - smooth(0.1, 1.5, t)) + 0.05;
      const ridesW = smooth(T.waves, T.waves + 0.5, t) * (1 - smooth(T.converge + 0.3, T.focal, t));
      const vortex = smooth(T.focal - 0.3, T.focal + 0.5, t);
      const q = flightK(t);
      const halo = smooth(T.halo, T.flight, t) * (1 - smooth(0.6, 0.92, q));
      // The halo follows the flying mark.
      const hx = cx + markX - S * VISUAL_OFFSET * (1 - q);
      const hy = cy + markY;
      // How far the mark moved this frame: the halo is carried with it.
      const moveX = Number.isNaN(prevHx) ? 0 : hx - prevHx;
      const moveY = Number.isNaN(prevHy) ? 0 : hy - prevHy;
      prevHx = hx;
      prevHy = hy;
      const carry = smooth(T.halo, T.flight, t) * (1 - smooth(0.55, 0.95, q));
      const exitPush = t > T.open ? smoother(clamp((t - T.open) / T.openDur)) : 0;

      for (const k of kicks) {
        if (k.fired || t < k.t) continue;
        k.fired = true;
        const kx = cx + k.dx * S;
        for (const p of particles) {
          const dx = p.x - kx;
          const dy = p.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          const reach = k.k >= 1 ? 1 : Math.exp(-((d / (S * 3)) ** 2));
          const imp = (k.k >= 1 ? 320 + 900 * rand() : 380) * reach * (0.4 + p.z) * k.k;
          p.vx += (dx / d) * imp;
          p.vy += (dy / d) * imp;
        }
      }

      const damp = Math.exp(-2.2 * dt);
      for (const p of particles) {
        let ax = 0;
        let ay = 0;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.hypot(dx, dy) || 1;

        // Turbulence.
        const a = Math.sin(p.x * 0.0037 + t * 0.4) * 1.6 + Math.cos(p.y * 0.0049 - t * 0.31) * 1.6 + p.seed;
        ax += Math.cos(a) * 34 * p.z;
        ay += Math.sin(a) * 34 * p.z;

        // Forward drift: outward, faster for nearer dust (parallax).
        ax += dx * dolly * (0.4 + p.z) * 2.2;
        ay += dy * dolly * (0.4 + p.z) * 2.2;

        // Sonar pulses push dust as they pass.
        for (const pt of pulses) {
          if (pt <= 0 || pt > PULSE_DUR) continue;
          const R = (pt / PULSE_DUR) * diag * 0.6;
          const g = Math.exp(-(((d - R) / 60) ** 2));
          ax += (dx / d) * 260 * g * p.z;
          ay += (dy / d) * 260 * g * p.z;
        }

        // Waves: riders are drawn to their line and carried along it.
        if (p.rides && ridesW > 0) {
          const wv = WAVES[p.lane];
          const head = waveHead(wv) * W;
          const reached = wv.dir > 0 ? p.x < head : p.x > W - head;
          if (reached) {
            const off = waveY(wv, p.x) - p.y;
            const near = Math.exp(-((off / (H * 0.22)) ** 2));
            ay += clamp(off * 9, -500, 500) * ridesW * near;
            ax += wv.dir * (90 + 140 * p.z) * ridesW * near;
          }
        }

        // Formation: captured dust spirals into orbit round the point; the
        // rest is pushed back a little to clear space.
        if (vortex > 0 && halo < 1) {
          const w2 = vortex * (1 - halo);
          if (p.captured) {
            const radial = (p.orbit * S * 1.15 - d) * 6;
            ax += (dx / d) * radial * w2;
            ay += (dy / d) * radial * w2;
            const tang = p.spin * (140 + 220 / (0.6 + d / S)) * w2 * 3;
            ax += (-dy / d) * tang;
            ay += (dx / d) * tang;
          } else if (d < S * 4) {
            ax += (dx / d) * 120 * w2;
            ay += (dy / d) * 120 * w2;
          }
        }

        // Hand-off halo: a tighter ring round the mark, wherever it is.
        if (halo > 0 && p.captured) {
          const hdx = p.x - hx;
          const hdy = p.y - hy;
          const hd = Math.hypot(hdx, hdy) || 1;
          const radial = (S * markScale * (0.7 + 0.3 * p.orbit) - hd) * 26;
          ax += (hdx / hd) * radial * halo;
          ay += (hdy / hd) * radial * halo;
          const tang = p.spin * 380 * halo * (0.35 + 0.65 * markScale);
          ax += (-hdy / hd) * tang;
          ay += (hdx / hd) * tang;
        }

        // The opening wavefront carries the rest outward.
        if (exitPush > 0) {
          const g = 0.5 + exitPush;
          ax += (dx / d) * 700 * p.z * g;
          ay += (dy / d) * 700 * p.z * g;
        }

        p.vx = p.vx * damp + ax * dt;
        p.vy = p.vy * damp + ay * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.captured && carry > 0) {
          p.x += moveX * carry;
          p.y += moveY * carry;
        }

        // Recycle dust that leaves the screen while the field is still open.
        if (t < T.converge + 0.5 && (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30)) spawn(p, true);
      }
    };

    raf = requestAnimationFrame(frame);
    failsafe = window.setTimeout(finish, (T.end - t + 3) * 1000);

    function teardown() {
      cancelAnimationFrame(raf);
      window.clearTimeout(failsafe);
      removeListeners();
      // Unmounted mid-intro (navigated away): clear the classes, unless this
      // is React's development remount, which cancels this straight away.
      if (!done) pendingTeardown = window.setTimeout(clearIntroClasses, 0);
    }
    return () => teardown();
  }, []);

  return (
    <div ref={rootRef} className="intro" aria-hidden="true">
      <div className="intro-backdrop">
        <canvas ref={canvasRef} className="intro-canvas" />
      </div>
      <div className="intro-stage">
        <div ref={markRef} className="intro-mark">
          <span className="intro-bloom" />
          {(["reflect", "lo", "hi", "core"] as const).map((name) => (
            <span key={name} className={`intro-layer intro-${name}`}>
              {BRAND_BARS.map((b) => (
                <span key={b.x} className="intro-bar" style={barStyle(b)}>
                  {name === "core" && <span className="intro-sheen" />}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
