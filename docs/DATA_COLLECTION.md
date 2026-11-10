# Data Collection Protocol: Own Machine Recordings (goal 4)

> Status: proposed, 2026-11-08. Nothing has been recorded yet. Tools: `ml/own_data.py` (ingest and evaluate).

## Why
- Public data has reached its limit:
  - On a fresh gearbox recording setup the app model ranks anomalies at only AUC 0.66 (EXP-020).
  - No public bearing audio set is large enough to confirm bearing results (Dataset Register, goal 3 audit).
- Recordings of the machines the app will actually monitor are the only way to:
  1. measure real false-alarm and detection rates;
  2. confirm or improve bearing performance;
  3. get the timestamped series that Phase 5 (alerts over time) lacks;
  4. test the original hypothesis with *measured* temperature, humidity and operating context (ADR-004).

## What results from this data can and cannot show
- **Can show:** false alarms and detection on *these* machines, microphones and sites, and whether context explains normal variation on them.
- **Cannot show:** performance on other machine types, sites or microphones; exact fault diagnosis; remaining useful life (CLAUDE.md rule 7).

## Equipment
| Item | Requirement | Why |
|---|---|---|
| Microphone | One fixed device per machine. Measurement or USB mic preferred; a smartphone is acceptable if the model, app, gain and orientation never change. Turn off automatic gain, noise suppression and "voice" modes. | Changing the device changes the sound more than many faults do. |
| Mount | A fixed position and distance, marked on the machine (tape or a bracket). Record `mic_position_id` and `distance_cm`. | Placement is a major source of false alarms. |
| Thermometer / hygrometer | A logger near the machine, read at each recording. | Needed for the context hypothesis (ADR-004). |
| Operating readout | Speed (rpm or krpm), load or voltage from the machine's display or a tachometer, if available. | Context for each recording. |

## Recording format
- WAV, mono preferred, 16-bit or float. Any sample rate: the ingest tool converts to 16 kHz mono and cuts non-overlapping 10-second clips. Shorter recordings are rejected.
- At least 10 seconds per recording; 10–30 seconds is ideal. One recording is one continuous capture.
- Keep the original files unchanged in `data/raw/own/` (git-ignored). Never edit, trim or denoise them.
- No speech: start recording after people stop talking and avoid conversations nearby. If speech is captured, delete that recording. Audio is never logged or committed.

## How much to record
| Stage | Per machine | Purpose |
|---|---|---|
| Baseline | At least 30 normal recordings over at least 3 sessions on different days, across the machine's normal operating range | The app's baseline (minimum 10, recommended 30; ADR-011) |
| Monitoring | Regular normal recordings, for example 1 per day for at least 3 weeks, with timestamps | False-alarm rate over time; Phase 5 alert data |
| Faults | Every recording where a fault is *confirmed*, ideally at least 10 per fault type | Detection rate |

A first claim needs at least 2 machines of the same type, each with at least 20 monitoring recordings after its baseline, and at least 10 confirmed fault recordings in total. Below that, results are reported as case studies only.

## Getting fault recordings safely
Never create a dangerous fault on a production machine. Acceptable sources:
1. **Maintenance windows:** record before a scheduled replacement of a part judged worn, then inspect the removed part and label from that inspection.
2. **A bench rig with sacrificial parts:** for example, a bearing with a known seeded defect, or an unbalance weight on a coupling, installed by someone qualified.
3. **Historical incidents:** recordings made before a fault that maintenance records later confirmed.

Labels need evidence. `label` is `normal`, `fault` or `unknown`. A `fault` needs `fault_type` and `fault_evidence` (for example "outer race spall seen on removal, work order 1234"). When in doubt, use `unknown`: unknown recordings are kept but excluded from the detection rate.

## Metadata (one row per recording)
Use `configs/own_metadata_template.csv`. Columns:

| Column | Required | Example |
|---|---|---|
| `recording_id` | yes | `pump3-2026-11-10-a` |
| `file` | yes | `pump3/2026-11-10_0900.wav` (relative to `data/raw/own/`) |
| `machine_id` | yes | `pump3` |
| `machine_type` | yes | `bearing` or `gearbox` (the modelled types) |
| `session_id` | yes | `2026-11-10-morning` |
| `recorded_at` | yes | `2026-11-10T09:00:00+05:30` (ISO 8601, with time zone) |
| `label` | yes | `normal`, `fault` or `unknown` |
| `fault_type` | for faults | `outer_race` |
| `fault_evidence` | for faults | `inspection on removal, WO-1234` |
| `mic_device` | yes | `UMIK-1 #7023` |
| `mic_position_id` | yes | `P1` |
| `distance_cm` | yes | `20` |
| `speed`, `speed_unit` | if known | `1450`, `rpm` |
| `load`, `load_unit` | if known | `60`, `%` |
| `temperature_c` | if measured | `31.5` |
| `humidity_pct` | if measured | `58` |
| `background_noise` | yes | `low`, `medium` or `high` |
| `notes` | no | free text, no personal data |

Never fill a context value from memory or a weather site: leave it blank if it was not measured (CLAUDE.md rule 4).

## Evaluation protocol (fixed before any recording is scored)
`uv run python -m ml.own_data --config configs/own_data.json --stage evaluate` does the following for each machine:
1. Orders that machine's recordings by `recorded_at`.
2. Uses its **first 10 normal recordings** in time as the baseline, the same as the app. The first clip of each recording stands in for one app recording. It also reports results with 30 baselines when enough recordings exist.
3. Sets the threshold with the shipped bundle's leave-one-out rule (`sonovate-ast-head` 0.3.1, spread 1.5).
4. Scores every *later* recording with the shipped model. Each later recording is scored by its first clip, so one recording counts once.
5. Reports:
   - false-alarm rate on later normal recordings;
   - detection rate on fault recordings;
   - AUC;
   - the ADR-009 over-time alert (2 of the last 3) on the time-ordered sequence.

The split is by time, which is how the app is used, so a baseline never contains audio recorded after the recordings it is compared with. Nothing is tuned on this data until enough recordings exist to hold some out. Any tuning must be pre-registered in `EXPERIMENT_LOG.md` first.

## Privacy and safety
- Get permission from the site owner before recording, and tell people nearby.
- Do not record speech, people or identifying notes. Machine IDs should be internal codes.
- Raw audio stays in git-ignored `data/raw/own/` and is never committed or shared without approval.
- Follow site safety rules: no recording inside guards or near moving parts without lock-out and a qualified person.
