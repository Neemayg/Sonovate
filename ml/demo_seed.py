"""Seed clearly labelled demo machines into a LOCAL Sonovate stack from MIMII DG test clips.

For people without their own recordings: real public machine audio (MIMII DG, CC-BY-4.0,
attribution required) goes through the real app. Each demo machine gets normal clips as its
baseline recordings, then a mix of normal and anomalous test recordings, uploaded the way
the frontend does, and analysed by the real inference service.

Honesty rules:
* clips come from the MIMII DG `test` role, which no model was trained on;
* clips are drawn at random with a fixed seed before any result is seen (no cherry-picking);
* the original file names are kept, so the true label (normal_/anomaly_) is visible next to
  the app's verdict, including misses and false alarms;
* machines are named "Demo · ..." and their notes cite the dataset;
* no recording time is invented (recorded_at stays empty).

Refuses to run against anything but a loopback Supabase URL. Credentials come from the
environment (DEMO_EMAIL, DEMO_PASSWORD); for the local stack use the seeded test user.

Usage: SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... DEMO_EMAIL=... DEMO_PASSWORD=... \
       python -m ml.demo_seed --config configs/demo_seed.json
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import numpy as np

from ml.baseline import Row, load_rows

LOOPBACK = {"127.0.0.1", "localhost", "::1"}


def select_clips(rows: list[Row], machine: str, section: str, domain: str, baselines: int,
                 normal_tests: int, anomaly_tests: int, seed: int) -> dict[str, list[Row]]:
    """Fixed-seed random choice from one section-domain of the test role; baseline and test clips never overlap."""
    pool = [r for r in rows if r["role"] == "test" and (r["machine"], r["section"], r["domain"]) == (machine, section, domain)]
    normal = sorted((r for r in pool if r["label"] == "normal"), key=lambda r: r["path"])
    anomaly = sorted((r for r in pool if r["label"] == "anomaly"), key=lambda r: r["path"])
    if len(normal) < baselines + normal_tests or len(anomaly) < anomaly_tests:
        raise ValueError(f"{machine}/{section}/{domain}: not enough clips")
    rng = np.random.default_rng(seed)
    n = [normal[i] for i in rng.permutation(len(normal))]
    a = [anomaly[i] for i in rng.permutation(len(anomaly))]
    return {"baseline": n[:baselines], "normal_test": n[baselines : baselines + normal_tests], "anomaly_test": a[:anomaly_tests]}


class Client:
    def __init__(self, supabase_url: str, key: str, backend_url: str) -> None:
        host = urllib.parse.urlparse(supabase_url).hostname
        if host not in LOOPBACK:
            raise SystemExit(f"refusing to seed demo data into a non-local Supabase ({host})")
        self.url, self.key, self.backend = supabase_url.rstrip("/"), key, backend_url.rstrip("/")
        self.token = self.user_id = ""

    def call(self, method: str, url: str, body: bytes | None = None, headers: dict | None = None) -> tuple[int, dict | list | None]:
        request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read()
            return error.code, {"retry_after": error.headers.get("Retry-After"), **(json.loads(raw) if raw else {})}

    def auth_headers(self, extra: dict | None = None) -> dict:
        return {"apikey": self.key, "Authorization": f"Bearer {self.token}", **(extra or {})}

    def sign_in(self, email: str, password: str) -> None:
        status, body = self.call("POST", f"{self.url}/auth/v1/token?grant_type=password",
                                 json.dumps({"email": email, "password": password}).encode(),
                                 {"apikey": self.key, "Content-Type": "application/json"})
        if status != 200:
            raise SystemExit(f"sign-in failed ({status})")
        self.token, self.user_id = body["access_token"], body["user"]["id"]

    def rest(self, method: str, path: str, payload: dict | None = None, prefer: str = "") -> list | dict | None:
        headers = self.auth_headers({"Content-Type": "application/json", **({"Prefer": prefer} if prefer else {})})
        status, body = self.call(method, f"{self.url}/rest/v1/{path}", json.dumps(payload).encode() if payload else None, headers)
        if status >= 300:
            raise RuntimeError(f"{method} {path}: {status} {body}")
        return body

    def upload(self, machine_id: str, wav: Path, kind: str) -> str:
        rid = str(uuid.uuid4())
        storage_path = f"{self.user_id}/{machine_id}/{rid}.wav"
        data = wav.read_bytes()
        self.rest("POST", "recordings", {"id": rid, "machine_id": machine_id, "kind": kind, "storage_path": storage_path,
                                         "original_filename": wav.name, "size_bytes": len(data), "duration_seconds": 10.0,
                                         "sample_rate_hz": 16000, "channels": 1})
        status, body = self.call("POST", f"{self.url}/storage/v1/object/recordings/{storage_path}", data,
                                 self.auth_headers({"Content-Type": "audio/wav"}))
        if status >= 300:
            raise RuntimeError(f"upload {wav.name}: {status} {body}")
        return rid

    def analyse(self, recording_id: str) -> dict:
        while True:
            status, body = self.call("POST", f"{self.backend}/v1/analyses", json.dumps({"recording_id": recording_id}).encode(),
                                     {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
            if status == 429 or (status == 503 and body and body.get("error", {}).get("code") == "model_busy"):
                time.sleep(float(body.get("retry_after") or 5))
                continue
            if status != 200:
                raise RuntimeError(f"analysis failed: {status} {body}")
            return body["prediction"]


def run(config: dict) -> dict:
    client = Client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_PUBLISHABLE_KEY"], config["backend_url"])
    client.sign_in(os.environ["DEMO_EMAIL"], os.environ["DEMO_PASSWORD"])
    data = json.loads(Path(config["data_config"]).read_text())
    rows = load_rows(data)
    raw_root = Path(data["raw_root"])
    existing = {m["name"] for m in client.rest("GET", "machines?select=name")}
    report = {}
    for spec in config["machines"]:
        if spec["name"] in existing:
            print(f"skip: '{spec['name']}' already exists (delete it in the app to re-seed)")
            continue
        clips = select_clips(rows, spec["machine"], spec["section"], spec["domain"], config["baselines"],
                             config["normal_tests"], config["anomaly_tests"], config["seed"])
        machine = client.rest("POST", "machines", {"name": spec["name"], "machine_type": spec["machine"],
                                                   "location": "Demo data", "notes": config["notes"]},
                              prefer="return=representation")[0]
        for r in clips["baseline"]:
            client.upload(machine["id"], raw_root / r["path"], "baseline")
        # Normal test recordings first, then anomalous ones: a simulated fault starting part-way.
        results = []
        for r in clips["normal_test"] + clips["anomaly_test"]:
            rid = client.upload(machine["id"], raw_root / r["path"], "analysis")
            p = client.analyse(rid)
            results.append({"file": Path(r["path"]).name, "truth": r["label"], "decision": p["decision"],
                            "log_score": p["log_score"], "threshold": p["threshold"], "model": f"{p['model']['name']} {p['model']['version']}"})
            print(f"  {spec['name'][:40]:<40} {results[-1]['file'][:52]:<52} truth {r['label']:<8} -> {p['decision']}")
        flagged_normal = sum(x["truth"] == "normal" and x["decision"] == "above_threshold" for x in results)
        caught = sum(x["truth"] == "anomaly" and x["decision"] == "above_threshold" for x in results)
        report[spec["name"]] = {"machine_id": machine["id"], "results": results,
                                "normal_flagged": f"{flagged_normal}/{config['normal_tests']}",
                                "anomalies_caught": f"{caught}/{config['anomaly_tests']}"}
        print(f"{spec['name']}: anomalies caught {caught}/{config['anomaly_tests']}, "
              f"normal recordings flagged {flagged_normal}/{config['normal_tests']}")
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "demo_results.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    run(json.loads(args.config.read_text()))


if __name__ == "__main__":
    main()
