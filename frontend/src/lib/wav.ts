// Reads a WAV header in the browser for early feedback before upload.
// Mirrors backend/app/audio.py; the inference service re-checks the stored
// bytes and is the authority.

export const MAX_RECORDING_BYTES = 2 * 1024 * 1024;
const EXPECTED_RATE = 16000;
const EXPECTED_SECONDS = 10;
const TOLERANCE_SECONDS = 0.05;

export type WavInfo = {
  sampleRateHz: number;
  channels: number;
  durationSeconds: number;
};

export type WavCheck = { ok: true; info: WavInfo } | { ok: false; message: string };

export async function checkWav(file: File): Promise<WavCheck> {
  if (file.size > MAX_RECORDING_BYTES) {
    return { ok: false, message: "File is larger than 2 MiB." };
  }
  const buf = new DataView(await file.arrayBuffer());
  const tag = (o: number) =>
    String.fromCharCode(buf.getUint8(o), buf.getUint8(o + 1), buf.getUint8(o + 2), buf.getUint8(o + 3));
  if (buf.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    return { ok: false, message: "File is not a WAV recording." };
  }

  let fmt: { format: number; channels: number; rate: number; block: number; bits: number } | null = null;
  let dataLength: number | null = null;
  let pos = 12;
  while (pos + 8 <= buf.byteLength) {
    const id = tag(pos);
    const size = buf.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= buf.byteLength) {
      let format = buf.getUint16(body, true);
      if (format === 0xfffe && size >= 40) format = buf.getUint16(body + 24, true);
      fmt = {
        format,
        channels: buf.getUint16(body + 2, true),
        rate: buf.getUint32(body + 4, true),
        block: buf.getUint16(body + 12, true),
        bits: buf.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataLength = Math.min(size, buf.byteLength - body);
      break;
    }
    pos = body + size + (size % 2);
  }

  if (!fmt || dataLength === null || fmt.block === 0) {
    return { ok: false, message: "WAV file is missing its format or data section." };
  }
  const supported =
    (fmt.format === 1 && [16, 24, 32].includes(fmt.bits)) || (fmt.format === 3 && fmt.bits === 32);
  if (!supported) return { ok: false, message: "WAV must be 16/24/32-bit PCM or 32-bit float." };
  if (fmt.rate !== EXPECTED_RATE) {
    return { ok: false, message: `Sample rate must be 16 kHz (this file is ${fmt.rate} Hz).` };
  }
  if (fmt.channels !== 1) {
    return { ok: false, message: `Recording must be mono (this file has ${fmt.channels} channels).` };
  }
  const durationSeconds = Math.floor(dataLength / fmt.block) / fmt.rate;
  if (Math.abs(durationSeconds - EXPECTED_SECONDS) > TOLERANCE_SECONDS) {
    return {
      ok: false,
      message: `Recording must be 10 seconds long (this file is ${durationSeconds.toFixed(2)} s).`,
    };
  }
  return { ok: true, info: { sampleRateHz: fmt.rate, channels: fmt.channels, durationSeconds } };
}
