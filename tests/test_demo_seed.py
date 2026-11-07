"""Demo seeding: fixed-seed selection without overlap, and refusal of non-local targets."""

import pytest

from ml.demo_seed import Client, select_clips


def rows():
    out = []
    for label, n in (("normal", 50), ("anomaly", 50)):
        for i in range(n):
            out.append({"path": f"b/{label}_{i:04d}.wav", "machine": "bearing", "section": "02",
                        "domain": "target", "label": label, "role": "test"})
    out.append({"path": "b/train.wav", "machine": "bearing", "section": "02", "domain": "target",
                "label": "normal", "role": "train"})
    return out


def test_selection_is_reproducible_disjoint_and_test_role_only():
    a = select_clips(rows(), "bearing", "02", "target", 30, 10, 10, seed=0)
    b = select_clips(rows(), "bearing", "02", "target", 30, 10, 10, seed=0)
    assert a == b
    base = {r["path"] for r in a["baseline"]}
    tests = {r["path"] for r in a["normal_test"]}
    assert len(base) == 30 and len(tests) == 10 and not base & tests
    assert all(r["role"] == "test" for group in a.values() for r in group)
    assert all(r["label"] == "anomaly" for r in a["anomaly_test"])


def test_refuses_remote_supabase():
    with pytest.raises(SystemExit, match="non-local"):
        Client("https://abc.supabase.co", "key", "http://localhost:8010")
