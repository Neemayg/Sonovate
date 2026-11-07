// Plain measurements of decoded audio for the listen-and-compare panel:
// a peak envelope for drawing, loudness (RMS and peak, dBFS) and an average
// frequency profile. These describe the files themselves. They are not model
// inputs or outputs, and a difference between two files is not a diagnosis.

export type Envelope = number[]; // 0..1 per slice, scaled to the file's own loudest slice

export function peakEnvelope(samples: Float32Array, bars: number): Envelope {
  const size = Math.max(1, Math.floor(samples.length / bars));
  const peaks: number[] = [];
  let loudest = 0;
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    const end = Math.min(samples.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > loudest) loudest = peak;
  }
  return peaks.map((p) => (loudest > 0 ? p / loudest : 0));
}

export type Loudness = { rms: number; rmsDb: number; peakDb: number };

const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export function loudness(samples: Float32Array): Loudness {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
  return { rms, rmsDb: toDb(rms), peakDb: toDb(peak) };
}

// In-place iterative radix-2 FFT on real/imaginary arrays of length 2^k.
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export type Band = { low: number; high: number; centre: number };

/** Log-spaced bands from `minHz` to `maxHz`. */
export function logBands(count: number, minHz: number, maxHz: number): Band[] {
  const bands: Band[] = [];
  const ratio = Math.pow(maxHz / minHz, 1 / count);
  for (let i = 0; i < count; i++) {
    const low = minHz * Math.pow(ratio, i);
    const high = low * ratio;
    bands.push({ low, high, centre: Math.sqrt(low * high) });
  }
  return bands;
}

/**
 * Average power per band over the whole file (Hann-windowed frames of
 * `frameSize` samples, no overlap), in dB relative to full scale. Bands with
 * no FFT bin in them take the nearest bin.
 */
export function frequencyProfile(
  samples: Float32Array,
  sampleRate: number,
  bands: Band[],
  frameSize = 1024,
): number[] {
  const half = frameSize / 2;
  const power = new Float64Array(half);
  const window = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++)
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  let frames = 0;
  for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
    for (let i = 0; i < frameSize; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < half; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  const binHz = sampleRate / frameSize;
  const norm = frames > 0 ? frames * (frameSize / 2) ** 2 : 1;
  return bands.map((band) => {
    let lo = Math.max(1, Math.ceil(band.low / binHz));
    let hi = Math.min(half - 1, Math.floor(band.high / binHz));
    if (hi < lo)
      lo = hi = Math.min(
        half - 1,
        Math.max(1, Math.round(band.centre / binHz)),
      );
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += power[k];
    const mean = sum / (hi - lo + 1) / norm;
    return mean > 0 ? 10 * Math.log10(mean) : -120;
  });
}

export function formatHz(hz: number): string {
  return hz >= 1000
    ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz`
    : `${Math.round(hz)} Hz`;
}
