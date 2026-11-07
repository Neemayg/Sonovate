# Demo with public recordings

For showing how Sonovate works without your own machine audio. `ml/demo_seed.py` creates three clearly labelled demo machines in a **local** stack. Each gets 30 baseline recordings and 20 test recordings (10 normal, 10 anomalous), uploaded and analysed through the real app.

## Data and honesty rules
- **Source:** MIMII DG (Dohi et al., 2022; Zenodo 6529888), CC-BY-4.0. Commercial use is allowed with attribution, and each demo machine's notes carry the citation. The non-commercial sets (DCASE 2022 evaluation, MIMII DUE) are never used in demos.
- **Unseen clips only:** clips come from the MIMII DG `test` split, which no model was trained on.
- **No cherry-picking:**
  - Clips are drawn at random with seed 0, before any result is seen.
  - The three machines cover the model's range: a section where it works well, a typical one, and a hard one.
- **Visible truth:** original file names are kept (`normal_…` / `anomaly_…`), so the true label sits next to the app's verdict, misses and false alarms included.
- **No invented times:** recording times are left empty. Test recordings are uploaded normal first, then anomalous, to simulate a fault starting part-way; the machine notes say so.

## Run it (local stack only; the script refuses other hosts)
1. Start Supabase locally (`npx supabase@2.122.0 start`).
2. Start the backend with the bundles, and the frontend (see `backend/README.md`).
3. Seed the demo machines:

```bash
eval "$(npx supabase@2.122.0 status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY)=')"
SUPABASE_URL="$API_URL" SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" \
DEMO_EMAIL=tech@sonovate.test DEMO_PASSWORD=local-test-password-1 \
uv run python -m ml.demo_seed --config configs/demo_seed.json
```

The credentials are the seeded **local** test user (`supabase/seed.sql`). Set `backend_url` in `configs/demo_seed.json` to the backend's port. The demo makes 60 analyses, which is more than the default limit of 20 per 10 minutes. The script waits out the limit, or you can raise `SONOVATE_ANALYSES_PER_WINDOW` for a local backend. Re-running skips machines that already exist; delete them in the app to re-seed.

## Result of the first run (2026-11-08, bundle `sonovate-ast-head` 0.3.1)
| Demo machine | Anomalies flagged | Normal recordings flagged |
|---|---|---|
| Bearing A (bearing 02, new conditions) | 9 / 10 | 2 / 10 |
| Gearbox (gearbox 00, familiar conditions) | 3 / 10 | 0 / 10 |
| Bearing B (bearing 01, hard case) | 5 / 10 | 1 / 10 |

With 10 clips per group these numbers vary a lot between draws. The measured rates are in EXP-016, EXP-017 and EXP-020. On unfamiliar recording setups the model catches far fewer anomalies (EXP-020). Present the demo as a research prototype with low sensitivity, not as a fault detector.
