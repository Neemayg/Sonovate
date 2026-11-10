# Analysing a recording (audio or video)

`ml/analyze.py` runs the shipped model (`sonovate-ast-head` 0.4.0: ADR-010/011, with bearings scored by the head + frozen fusion, proposed ADR-013) on one recording
against a machine's baseline recordings, outside the web app. It is the reference for what the app
will show per recording.

```bash
uv run python -m ml.analyze --machine-type gearbox --recording check.mp4 --baseline baselines/ --out report.json --plot report.png
```

- `--recording`: WAV, FLAC, MP3, M4A/AAC, OGG/Opus, or a video (MP4, MOV, MKV, WebM, AVI); a video's
  first audio track is used. Decoding uses the ffmpeg bundled with `imageio-ffmpeg`.
- `--baseline`: files or folders recorded while the machine ran normally, at least 10 windows of 10 s
  in total (30 recommended, ADR-011).
- Everything is converted to 16 kHz mono and cut into consecutive 10 s windows. A trailing part
  shorter than 10 s is not analysed; the report says how many seconds were left out.

## What the report contains

Per 10 s window:

| Field | Meaning |
|---|---|
| `decision` | `above_threshold` or `below_threshold` this machine's baseline threshold |
| `score`, `log_score`, `threshold` | nearest-baseline cosine distance and the per-machine threshold (mean + 1.5 std of baseline leave-one-out log distances) |
| `distance_from_threshold_sd` | how far the log score is above (+) or below (−) the threshold, in baseline standard deviations |
| `peak_time_s`, `peak_band_hz`, `peaks_above_3sd` | where the spectrogram differs most from the baseline (time in the recording, mel band) |
| `time_curve`, `frequency_profile`, `map_sd` | the spectrogram-difference view: per 50 ms, per mel bin, and a 32-band × 100-step map, in baseline standard deviations |

`summary` gives the number of windows analysed and above threshold, the most unusual window, and,
for recordings of 30 s or more, a **recording-level decision** (`recording_decision`): the mean of the
window log scores against mean + 1.0 × std (30–59 s) or mean + 0.75 × std (60 s or more) of the
baseline leave-one-out log scores. On fresh gearbox data this kept false alarms at about 8–9% while
catching 33% (30 s) and 42% (60 s) of anomalies, against 25% for a single 10 s clip (EXP-026; proposed
as ADR-012). **Record at least 60 s per check.**
`--plot` saves a spectrogram, the difference map and the time curve (windows above threshold in red).

## How to read it

- **The decision comes from the model; the map does not decide anything.** The map shows how the
  spectrogram differs from the baseline. On synthetic events added to normal clips it found the time
  of 0.5 s tones about 90% of the time (and their band about 90%), but only about 70% of 20 ms clicks
  (EXP-023, EXP-024). On real recordings it also reacts to operating-condition changes, such as a
  tone whose pitch follows motor voltage, so a peak is **not** a fault location.
- Scores are uncalibrated anomaly scores, **not failure probabilities**.
- **No remaining-life or time-to-failure estimate is given.** The datasets contain independent clips of
  induced faults, not machines recorded until failure, so no such model can be trained or checked.
- Detection is limited: on fresh gearbox data the model catches a minority of anomalies at about 9%
  false alarms (EXP-020, EXP-022). Below threshold does not mean healthy.
