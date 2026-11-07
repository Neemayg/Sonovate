"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  downloadRecordingAudio,
  listMachineHistory,
  type ContextReading,
  type HistoryEntry,
} from "@/lib/api";
import {
  formatHz,
  frequencyProfile,
  logBands,
  loudness,
  peakEnvelope,
  type Envelope,
  type Loudness,
} from "@/lib/audioFeatures";
import { MODEL_INPUTS, type MachineType } from "@/lib/modelInputs";

// Listen to an analysed recording next to one of the same machine's baseline
// recordings. Both play in sync and the A/B buttons switch between them at the
// same position, so a person can hear what changed. The loudness figures and
// the frequency profile are measured from the two files in the browser; they
// are not what the model uses and a difference is not a diagnosis.

type Key = "a" | "b";
type Track = {
  buffer: AudioBuffer;
  envelope: Envelope;
  loud: Loudness;
  profile: number[];
};

const BARS = 120;
const BANDS = logBands(36, 60, 7800);
const MAX_BOOST = 4; // never amplify a quiet file more than ~12 dB when matching loudness

function contextKey(readings: ContextReading[], type: MachineType): string {
  return MODEL_INPUTS[type]
    .map(
      (input) =>
        readings.find((r) => r.name === input.name && r.unit === input.unit)
          ?.value,
    )
    .map((v) => (v === undefined ? "" : String(v)))
    .join("|");
}

function contextLabel(readings: ContextReading[], type: MachineType): string {
  return MODEL_INPUTS[type]
    .map((input) => {
      const r = readings.find(
        (c) => c.name === input.name && c.unit === input.unit,
      );
      return r ? `${r.value} ${r.unit}` : null;
    })
    .filter(Boolean)
    .join(", ");
}

async function decode(
  context: AudioContext,
  storagePath: string,
): Promise<Track> {
  const blob = await downloadRecordingAudio(storagePath);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  const samples = buffer.getChannelData(0);
  return {
    buffer,
    envelope: peakEnvelope(samples, BARS),
    loud: loudness(samples),
    profile: frequencyProfile(samples, buffer.sampleRate, BANDS),
  };
}

const fmtDb = (v: number) =>
  Number.isFinite(v) ? `${v.toFixed(1)} dBFS` : "silent";

type Props = {
  machineId: string;
  machineType: MachineType;
  recording: {
    storage_path: string;
    original_filename: string | null;
    context_readings: ContextReading[];
  };
};

export function ListenCompare({ machineId, machineType, recording }: Props) {
  const [baselines, setBaselines] = useState<HistoryEntry[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [tracks, setTracks] = useState<{ a: Track | null; b: Track | null }>({
    a: null,
    b: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<Key>("a");
  const [loop, setLoop] = useState(true);
  const [matchLoudness, setMatchLoudness] = useState(true);
  const [position, setPosition] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainsRef = useRef<Partial<Record<Key, GainNode>>>({});
  const startedAtRef = useRef(0);
  const frameRef = useRef(0);
  // Settings read inside audio callbacks, mirrored from state.
  const settingsRef = useRef({ active, loop, matchLoudness });
  const tracksRef = useRef(tracks);
  useEffect(() => {
    settingsRef.current = { active, loop, matchLoudness };
    tracksRef.current = tracks;
  }, [active, loop, matchLoudness, tracks]);

  const context = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  // Baselines of this machine, with the one recorded at the same setting first.
  useEffect(() => {
    let cancelled = false;
    listMachineHistory(machineId)
      .then((entries) => {
        if (cancelled) return;
        const target = contextKey(recording.context_readings, machineType);
        const list = entries
          .filter((e) => e.kind === "baseline")
          .sort((x, y) => {
            const sx =
              contextKey(x.context_readings, machineType) === target ? 0 : 1;
            const sy =
              contextKey(y.context_readings, machineType) === target ? 0 : 1;
            return sx - sy || x.created_at.localeCompare(y.created_at);
          });
        setBaselines(list);
        if (list.length > 0) setSelected(list[0].id);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [machineId, machineType, recording.context_readings]);

  const stop = useCallback(() => {
    for (const s of sourcesRef.current) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    sourcesRef.current = [];
    gainsRef.current = {};
    cancelAnimationFrame(frameRef.current);
    setPlaying(false);
  }, []);

  // The analysed recording.
  useEffect(() => {
    let cancelled = false;
    decode(context(), recording.storage_path)
      .then((t) => !cancelled && setTracks((cur) => ({ ...cur, a: t })))
      .catch(
        () =>
          !cancelled &&
          setError("This recording could not be loaded for listening."),
      );
    return () => {
      cancelled = true;
    };
  }, [context, recording.storage_path]);

  // The chosen baseline; switching it stops playback.
  const baseline = baselines?.find((b) => b.id === selected) ?? null;
  useEffect(() => {
    if (!baseline) return;
    let cancelled = false;
    decode(context(), baseline.storage_path)
      .then((t) => !cancelled && setTracks((cur) => ({ ...cur, b: t })))
      .catch(
        () =>
          !cancelled &&
          setError("The baseline recording could not be loaded for listening."),
      );
    return () => {
      cancelled = true;
    };
  }, [baseline, context]);

  useEffect(
    () => () => {
      stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [stop],
  );

  const gainFor = useCallback((key: Key): number => {
    const { a, b } = tracksRef.current;
    const t = key === "a" ? a : b;
    if (
      !settingsRef.current.matchLoudness ||
      !a ||
      !b ||
      !t ||
      t.loud.rms === 0
    )
      return 1;
    // Bring both to the quieter file's level, so nothing clips.
    const target = Math.min(a.loud.rms, b.loud.rms);
    return Math.min(MAX_BOOST, target / t.loud.rms);
  }, []);

  const applyGains = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    (["a", "b"] as Key[]).forEach((key) => {
      const g = gainsRef.current[key];
      if (g)
        g.gain.setTargetAtTime(
          settingsRef.current.active === key ? gainFor(key) : 0,
          ctx.currentTime,
          0.012,
        );
    });
  }, [gainFor]);

  const duration = tracks.a?.buffer.duration ?? 10;

  const play = useCallback(
    (offset: number) => {
      const { a, b } = tracksRef.current;
      if (!a || !b) return;
      const ctx = context();
      void ctx.resume();
      stop();
      const start = offset >= a.buffer.duration ? 0 : offset;
      const longest = a.buffer.duration >= b.buffer.duration ? "a" : "b";
      (["a", "b"] as Key[]).forEach((key) => {
        const track = key === "a" ? a : b;
        const src = ctx.createBufferSource();
        src.buffer = track.buffer;
        src.loop = settingsRef.current.loop;
        const gain = ctx.createGain();
        gain.gain.value = settingsRef.current.active === key ? gainFor(key) : 0;
        src.connect(gain).connect(ctx.destination);
        src.start(0, start % track.buffer.duration);
        if (key === longest) {
          src.onended = () => {
            stop();
            setPosition(0);
          };
        }
        sourcesRef.current.push(src);
        gainsRef.current[key] = gain;
      });
      startedAtRef.current = ctx.currentTime - start;
      setPlaying(true);
      const tick = () => {
        let pos = ctx.currentTime - startedAtRef.current;
        if (settingsRef.current.loop) pos %= a.buffer.duration;
        setPosition(Math.min(pos, a.buffer.duration));
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    },
    [context, gainFor, stop],
  );

  const ready = Boolean(tracks.a && tracks.b);

  const seek = (seconds: number) => {
    const s = Math.max(0, Math.min(duration, seconds));
    setPosition(s);
    if (playing) play(s);
  };

  const choose = (key: Key) => {
    settingsRef.current.active = key;
    setActive(key);
    applyGains();
  };

  const toggleLoop = (value: boolean) => {
    settingsRef.current.loop = value;
    setLoop(value);
    sourcesRef.current.forEach((s) => (s.loop = value));
  };

  const toggleMatch = (value: boolean) => {
    settingsRef.current.matchLoudness = value;
    setMatchLoudness(value);
    applyGains();
  };

  // Profile comparison: overall level difference, then the band where the
  // shapes differ most once that overall difference is taken out.
  const comparison = useMemo(() => {
    const { a, b } = tracks;
    if (!a || !b) return null;
    const diffs = a.profile.map((v, i) => v - b.profile[i]);
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    let idx = 0;
    diffs.forEach((d, i) => {
      if (Math.abs(d - mean) > Math.abs(diffs[idx] - mean)) idx = i;
    });
    const all = [...a.profile, ...b.profile];
    return {
      levelDiff: a.loud.rmsDb - b.loud.rmsDb,
      band: BANDS[idx],
      bandDiff: diffs[idx] - mean,
      min: Math.floor(Math.min(...all) / 10) * 10,
      max: Math.ceil(Math.max(...all) / 10) * 10,
    };
  }, [tracks]);

  if (error) return <p className="empty small">{error}</p>;
  if (baselines && baselines.length === 0) {
    return (
      <p className="empty small">
        This machine has no baseline recordings to compare with.
      </p>
    );
  }

  const targetKey = contextKey(recording.context_readings, machineType);
  const name = recording.original_filename ?? "This recording";

  const rows: { key: Key; title: string; sub: string; track: Track | null }[] =
    [
      { key: "a", title: "A · This recording", sub: name, track: tracks.a },
      {
        key: "b",
        title: "B · Baseline",
        sub: baseline
          ? (baseline.original_filename ?? "Baseline recording")
          : "…",
        track: tracks.b,
      },
    ];

  return (
    <div className="lc">
      <div className="lc-bar">
        <button
          type="button"
          className="lc-play"
          onClick={() => (playing ? stop() : play(position))}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>
        <div
          className="lc-ab"
          role="group"
          aria-label="Which recording you hear"
        >
          {(["a", "b"] as Key[]).map((key) => (
            <button
              key={key}
              type="button"
              className={active === key ? "is-on" : undefined}
              aria-pressed={active === key}
              onClick={() => choose(key)}
            >
              {key === "a" ? "A · This recording" : "B · Baseline"}
            </button>
          ))}
        </div>
        <span className="lc-time num" aria-live="off">
          {position.toFixed(1)} / {duration.toFixed(1)} s
        </span>
      </div>

      <div className="lc-options">
        <label className="lc-select">
          <span>Compare with</span>
          <select
            value={selected}
            onChange={(e) => {
              stop();
              setTracks((cur) => ({ ...cur, b: null }));
              setSelected(e.target.value);
            }}
            disabled={!baselines}
          >
            {(baselines ?? []).map((b) => {
              const ctx = contextLabel(b.context_readings, machineType);
              const same =
                targetKey !== "" &&
                contextKey(b.context_readings, machineType) === targetKey;
              return (
                <option key={b.id} value={b.id}>
                  {b.original_filename ?? "Baseline"}
                  {ctx ? ` · ${ctx}` : ""}
                  {same ? " · same setting" : ""}
                </option>
              );
            })}
          </select>
        </label>
        <label className="lc-check">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => toggleLoop(e.target.checked)}
          />{" "}
          Loop
        </label>
        <label className="lc-check">
          <input
            type="checkbox"
            checked={matchLoudness}
            onChange={(e) => toggleMatch(e.target.checked)}
          />{" "}
          Match loudness
        </label>
      </div>

      <div className="lc-rows">
        {rows.map(({ key, title, sub, track }) => (
          <div
            key={key}
            className={`lc-row${active === key ? " is-active" : ""}`}
          >
            <div className="lc-row-head">
              <button
                type="button"
                className="lc-row-pick"
                onClick={() => choose(key)}
                aria-pressed={active === key}
              >
                {title}
              </button>
              <span className="muted small lc-row-sub">{sub}</span>
              {track && (
                <span className="muted small num lc-row-loud">
                  RMS {fmtDb(track.loud.rmsDb)} · peak{" "}
                  {fmtDb(track.loud.peakDb)}
                </span>
              )}
            </div>
            <div
              className="lc-wave"
              aria-hidden="true"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - r.left) / r.width) * duration);
              }}
            >
              {track ? (
                <svg viewBox={`0 0 ${BARS * 4} 100`} preserveAspectRatio="none">
                  {track.envelope.map((p, i) => {
                    const h = Math.max(1.5, p * 94);
                    const played = i / BARS < position / duration;
                    return (
                      <rect
                        key={i}
                        x={i * 4 + 0.8}
                        y={50 - h / 2}
                        width={2.4}
                        height={h}
                        rx={1}
                        className={played ? "is-played" : undefined}
                      />
                    );
                  })}
                </svg>
              ) : (
                <div
                  className="skeleton"
                  role="status"
                  aria-label="Loading audio"
                />
              )}
              <span
                className="lc-head"
                style={
                  { "--x": `${(position / duration) * 100}%` } as CSSProperties
                }
              />
            </div>
          </div>
        ))}
      </div>
      <label className="lc-scrub">
        <span className="visually-hidden">Playback position in seconds</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={position}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!ready}
        />
      </label>

      {comparison && tracks.a && tracks.b && (
        <figure className="lc-profile">
          <figcaption>
            <strong>Average frequency profile</strong>
            <span className="lc-legend">
              <span className="lc-key is-a" /> A · this recording{" "}
              <span className="lc-key is-b" /> B · baseline
            </span>
          </figcaption>
          <ProfileChart
            a={tracks.a.profile}
            b={tracks.b.profile}
            min={comparison.min}
            max={comparison.max}
          />
          <p className="small">
            Overall, this recording is{" "}
            <strong className="num">
              {Math.abs(comparison.levelDiff).toFixed(1)} dB{" "}
              {comparison.levelDiff >= 0 ? "louder" : "quieter"}
            </strong>{" "}
            than this baseline. Apart from loudness, the shapes differ most
            around{" "}
            <strong className="num">{formatHz(comparison.band.centre)}</strong>,
            where this recording has{" "}
            <strong className="num">
              {Math.abs(comparison.bandDiff).toFixed(1)} dB{" "}
              {comparison.bandDiff >= 0 ? "more" : "less"}
            </strong>{" "}
            energy.
          </p>
          <p className="small muted">
            Measured from the two files in your browser. The model does not use
            these figures, and one baseline is a single example of normal sound:
            a difference here is a reason to listen closely, not a diagnosis.
          </p>
        </figure>
      )}
    </div>
  );
}

function ProfileChart({
  a,
  b,
  min,
  max,
}: {
  a: number[];
  b: number[];
  min: number;
  max: number;
}) {
  const W = 600;
  const H = 160;
  const pad = { l: 34, r: 8, t: 8, b: 22 };
  const x = (i: number) =>
    pad.l + (i / (BANDS.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) =>
    pad.t + (1 - (v - min) / Math.max(1, max - min)) * (H - pad.t - pad.b);
  const line = (vals: number[]) =>
    vals
      .map(
        (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
      )
      .join("");
  const ticksHz = [100, 250, 500, 1000, 2000, 4000];
  const xHz = (hz: number) => {
    const lo = Math.log(BANDS[0].centre);
    const hi = Math.log(BANDS[BANDS.length - 1].centre);
    return pad.l + ((Math.log(hz) - lo) / (hi - lo)) * (W - pad.l - pad.r);
  };
  const yTicks: number[] = [];
  for (let v = min; v <= max; v += 20) yTicks.push(v);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="lc-chart"
      role="img"
      aria-label="Average energy per frequency band for the two recordings, in decibels, low to high frequency"
    >
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(v)}
            y2={y(v)}
            className="lc-grid"
          />
          <text x={pad.l - 6} y={y(v) + 3} className="lc-tick" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {ticksHz.map((hz) => (
        <text
          key={hz}
          x={xHz(hz)}
          y={H - 6}
          className="lc-tick"
          textAnchor="middle"
        >
          {formatHz(hz)}
        </text>
      ))}
      <path d={line(b)} className="lc-line is-b" />
      <path d={line(a)} className="lc-line is-a" />
    </svg>
  );
}
