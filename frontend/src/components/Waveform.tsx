"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { downloadRecordingAudio } from "@/lib/api";

const BARS = 160;

type Envelope = { peaks: number[]; seconds: number };

// Peak amplitude per time slice, scaled so the loudest slice fills the
// height. Drawn from the stored file itself; nothing is synthesised.
function envelope(buffer: AudioBuffer): Envelope {
  const samples = buffer.getChannelData(0);
  const size = Math.max(1, Math.floor(samples.length / BARS));
  const peaks: number[] = [];
  let loudest = 0;
  for (let b = 0; b < BARS; b++) {
    let peak = 0;
    const end = Math.min(samples.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > loudest) loudest = peak;
  }
  return { peaks: peaks.map((p) => (loudest > 0 ? p / loudest : 0)), seconds: buffer.duration };
}

export function Waveform({ storagePath, label }: { storagePath: string; label: string }) {
  const [shape, setShape] = useState<Envelope | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const blob = await downloadRecordingAudio(storagePath);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
        const context = new AudioContext();
        try {
          const buffer = await context.decodeAudioData(await blob.arrayBuffer());
          if (!cancelled) setShape(envelope(buffer));
        } finally {
          void context.close();
        }
      } catch {
        if (!cancelled) setError("The waveform could not be drawn for this file.");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [storagePath]);

  const seconds = shape?.seconds ?? 10;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `${(f * seconds).toFixed(f === 0 ? 0 : 1)} s`);

  return (
    <figure className="waveform">
      <div className="waveform-frame">
        {shape ? (
          <svg
            viewBox={`0 0 ${BARS * 4} 100`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Waveform of ${label}, amplitude scaled to the loudest moment`}
          >
            {shape.peaks.map((p, i) => {
              const h = Math.max(1.5, p * 96);
              return (
                <rect
                  key={i}
                  x={i * 4 + 0.8}
                  y={50 - h / 2}
                  width={2.4}
                  height={h}
                  rx={1}
                  style={{ animationDelay: `${i * 2.5}ms` } as CSSProperties}
                />
              );
            })}
          </svg>
        ) : error ? (
          <p className="empty small" style={{ padding: "0 0.75rem" }}>
            {error}
          </p>
        ) : (
          <div className="skeleton" role="status" aria-label="Loading waveform" />
        )}
      </div>
      {shape && (
        <div className="axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
      {audioUrl && (
        <audio controls preload="metadata" src={audioUrl} aria-label={`Play ${label}`}>
          Your browser cannot play this recording.
        </audio>
      )}
    </figure>
  );
}
