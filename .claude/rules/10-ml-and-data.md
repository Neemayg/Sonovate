---
paths:
  - "ml/**"
  - "data_pipeline/**"
  - "notebooks/**"
  - "src/ml/**"
  - "src/data/**"
  - "tests/**"
---

# ML and data rules

- Preserve raw data; transformations must be reproducible and documented.
- Track sample rate, channels, duration, windowing, normalization, and feature settings.
- Split by the unit relevant to the claim; prevent session/machine/recording leakage.
- Fit scalers, feature selection, thresholds, and learned preprocessing on training/validation data only as appropriate; never fit on test data.
- Keep test data untouched until final evaluation.
- Record dataset version, split IDs, random seed, configuration, and model version.
- Report class imbalance and use metrics appropriate to anomaly detection.
- Do not treat anomaly scores as calibrated probabilities.
- Do not fabricate or infer missing environmental metadata.
- Keep notebook experiments reproducible; move stable reusable logic into modules.
