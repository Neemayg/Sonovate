// Converts any recording the browser can decode (MP3, M4A/AAC, OGG/Opus, other WAVs, and the
// audio track of MP4/MOV/WebM videos) into the model's input format: 16 kHz, mono, 16-bit PCM
// WAV, at most 60 s (ADR-012). Everything happens on the device; only the converted WAV is
// uploaded, so the original video or audio file never leaves the browser.
//
// Stereo is mixed down by the browser (average of the channels) and resampled by an
// OfflineAudioContext. The inference service re-validates the uploaded WAV as before.

import { checkWav, type WavInfo } from "./wav";

export const TARGET_RATE = 16_000;
export const MIN_SECONDS = 10;
export const MAX_SECONDS = 60;
// Decoding happens in memory; very large files are refused rather than freezing the tab.
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

export type Prepared = { file: File; info: WavInfo; note: string | null };

/** 16-bit PCM mono WAV bytes for float samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const out = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(out);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return out;
}

function describe(file: File): string {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toUpperCase() : "";
  return ext || file.type || "the original file";
}

/**
 * Returns the file ready for upload: unchanged if it already meets the input contract,
 * otherwise converted. Throws an Error with a user-facing message if it cannot be used.
 */
export async function prepareRecording(file: File): Promise<Prepared> {
  const direct = await checkWav(file);
  if (direct.ok) return { file, info: direct.info, note: null };
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("This file is too large to convert in the browser (over 200 MB). Trim it to about a minute first.");
  }

  let decoded: AudioBuffer;
  const context = new AudioContext();
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(
      "This file's audio could not be read. Use a WAV, MP3 or M4A recording, or an MP4/MOV video with sound.",
    );
  } finally {
    void context.close();
  }
  if (decoded.duration < MIN_SECONDS - 0.05) {
    throw new Error(`The recording is ${decoded.duration.toFixed(1)} s long; at least ${MIN_SECONDS} s are needed.`);
  }

  const seconds = Math.min(decoded.duration, MAX_SECONDS);
  const frames = Math.floor(seconds * TARGET_RATE);
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, 0, seconds);
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  if (peak === 0) throw new Error("The recording is silent, so it cannot be analysed.");

  const base = file.name.replace(/\.[^.]+$/, "") || "recording";
  const wavFile = new File([encodeWav(samples, TARGET_RATE)], `${base}.wav`, { type: "audio/wav" });
  const info: WavInfo = { sampleRateHz: TARGET_RATE, channels: 1, durationSeconds: frames / TARGET_RATE };
  const trimmed = decoded.duration > MAX_SECONDS + 0.05;
  const note =
    `Converted from ${describe(file)} (${decoded.duration.toFixed(1)} s, ${decoded.numberOfChannels} channel` +
    `${decoded.numberOfChannels === 1 ? "" : "s"}) to a 16 kHz mono WAV` +
    `${trimmed ? `; the first ${MAX_SECONDS} s are used` : ""}. Only the converted audio is uploaded.`;
  return { file: wavFile, info, note };
}
