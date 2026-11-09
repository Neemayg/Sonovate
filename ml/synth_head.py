"""EXP-030: condition head trained with synthetic data (docs/EXPERIMENT_LOG.md).

Stages:
  generate  make S1 (nuisance normals) and S2 (pseudo-faults) from MIMII DG train/adaptation clips and
            encode them with the shipped bundle's 4-layer AST (layer-4 frequency pooling)
  train     train H-real / H-aug / H-oe / H-both (seeds 0-2) and score them on the real development set
  confirm   seed-0 model of the carried candidate vs the shipped bundle on real held-out data

Synthetic audio is used only for training. Every reported accuracy is on real recordings.

Usage: python -m ml.synth_head --config configs/synth_head.json --stage generate
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ml.attribute_head import Head, condition_labels
from ml.baseline import git_commit, load_rows
from ml.export_ast_head import apply_head, head_arrays
from ml.localise import PatchEncoder, pooled_features
from ml.metrics import auc
from ml.patch_scores import dcase22_bearing_groups, due_dev_groups, due_eval_groups, read_clip
from ml.pretrained import log
from ml.synthetic import nuisance, pseudo_fault

TRAIN_ROLES = ("train", "adaptation")
CANDIDATES = {"H-real": (False, False), "H-aug": (True, False), "H-oe": (False, True), "H-both": (True, True)}


def out_dir(config: dict) -> Path:
    path = Path(config["output"])
    path.mkdir(parents=True, exist_ok=True)
    return path


def real_rows_and_features(config: dict) -> tuple[list[dict], np.ndarray]:
    data = json.loads(Path(config["mimii_dg_config"]).read_text())
    by_path = {r["path"]: r for r in load_rows(data)}
    cached = np.load(config["real_features"])
    rows = [by_path[p] for p in cached["paths"]]
    return rows, cached["freq"][:, config["freq_index"]].astype(np.float32)


# --- generate ---------------------------------------------------------------------------------------

def run_generate(config: dict) -> None:
    data = json.loads(Path(config["mimii_dg_config"]).read_text())
    rows = sorted((r for r in load_rows(data) if r["role"] in TRAIN_ROLES), key=lambda r: r["path"])
    encoder = PatchEncoder(Path(config["bundle_dir"]), config["device"])
    s1, s2, s1_kinds, s2_kinds, real_check = [], [], [], [], []
    batch_s1, batch_s2 = [], []

    def flush() -> None:
        if batch_s1:
            s1.append(pooled_features(encoder.tokens(batch_s1)))
            s2.append(pooled_features(encoder.tokens(batch_s2)))
            batch_s1.clear()
            batch_s2.clear()

    for i, r in enumerate(rows):
        clip = read_clip(Path(data["raw_root"]) / r["path"])
        a, kinds = nuisance(clip, np.random.default_rng(i))
        b, kind = pseudo_fault(clip, np.random.default_rng(1_000_000 + i))
        batch_s1.append(a)
        batch_s2.append(b)
        s1_kinds.append("+".join(kinds))
        s2_kinds.append(kind)
        if i < 16:
            real_check.append(clip)
        if len(batch_s1) == config["batch_size"]:
            flush()
        if i % 500 == 0:
            log(f"generate {i}/{len(rows)}")
    flush()
    real_feat = pooled_features(encoder.tokens(real_check[:8]))
    np.savez(out_dir(config) / "synthetic_features.npz", paths=np.array([r["path"] for r in rows]),
             s1=np.concatenate(s1).astype(np.float32), s2=np.concatenate(s2).astype(np.float32),
             s1_kinds=np.array(s1_kinds), s2_kinds=np.array(s2_kinds), real_check=real_feat.astype(np.float32))
    (out_dir(config) / "generate_summary.json").write_text(json.dumps({
        "commit": git_commit(), "clips": len(rows), "s1_kinds": Counter(k for ks in s1_kinds for k in ks.split("+")),
        "s2_kinds": Counter(s2_kinds)}, indent=2))
    log("generate done")


# --- training -----------------------------------------------------------------------------------------

def train(x_real: np.ndarray, y_real: np.ndarray, x_s1: np.ndarray | None, y_s1: np.ndarray | None,
          x_s2: np.ndarray | None, settings: dict, seed: int, oe_weight: float) -> Head:
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    classes = int(y_real.max()) + 1
    model = Head(x_real.shape[1], settings["hidden"], settings["dim"], classes, settings["scale"], settings["margin"])
    opt = torch.optim.AdamW(model.parameters(), lr=settings["lr"], weight_decay=settings["weight_decay"])
    counts = np.bincount(y_real, minlength=classes)
    loss_fn = nn.CrossEntropyLoss(weight=torch.from_numpy((counts.max() / np.maximum(counts, 1)) ** 0.5).float())
    xr, yr = torch.from_numpy(x_real), torch.from_numpy(y_real).long()
    x1 = torch.from_numpy(x_s1) if x_s1 is not None else None
    y1 = torch.from_numpy(y_s1).long() if y_s1 is not None else None
    x2 = torch.from_numpy(x_s2) if x_s2 is not None else None
    bs = settings["batch_size"]
    for _ in range(settings["epochs"]):
        model.train()
        order = rng.permutation(len(xr))
        for start in range(0, len(order), bs):
            idx = torch.from_numpy(order[start : start + bs])
            if len(idx) < 2:
                continue
            xb, yb = xr[idx], yr[idx]
            if x1 is not None:
                j = torch.from_numpy(rng.integers(0, len(x1), len(idx)))
                xb, yb = torch.cat([xb, x1[j]]), torch.cat([yb, y1[j]])
            loss = loss_fn(model.logits(xb, yb), yb)
            if x2 is not None:
                k = torch.from_numpy(rng.integers(0, len(x2), len(idx)))
                log_p = torch.log_softmax(model.logits(x2[k]), dim=1)
                loss = loss + oe_weight * (-log_p.mean(dim=1)).mean()  # cross-entropy to uniform (outlier exposure)
            opt.zero_grad()
            loss.backward()
            opt.step()
    model.eval()
    return model


# --- scoring (own-baseline simulation, product scoring per machine type) -------------------------------

def frozen_embed(arrays: dict, features: np.ndarray) -> np.ndarray:
    z = (features - arrays["feature_mean"]) / arrays["feature_std"]
    return (z / np.linalg.norm(z, axis=1, keepdims=True)).astype(np.float32)


def _dist(e: np.ndarray) -> np.ndarray:
    return np.clip(1.0 - e @ e.T, 1e-9, 2.0)


def _pair(d: np.ndarray, queries: np.ndarray, base: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    q = d[np.ix_(queries, base)].min(axis=1)
    bb = d[np.ix_(base, base)].copy()
    np.fill_diagonal(bb, np.inf)
    return q, bb.min(axis=1)


def _z(q: np.ndarray, loo: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lq, ll = np.log(q), np.log(loo)
    mu, sd = ll.mean(), max(ll.std(), 1e-9)
    return (lq - mu) / sd, (ll - mu) / sd


def simulate(head_e: np.ndarray, frozen_e: np.ndarray, n_normal: int, fusion: bool, sim: dict) -> dict:
    rng = np.random.default_rng(sim["seed"])
    hd, fd = _dist(head_e), _dist(frozen_e)
    anomalies = np.arange(n_normal, len(head_e))
    aucs, fprs, recalls = [], [], []
    for _ in range(sim["repeats"]):
        order = rng.permutation(n_normal)
        base, rest = order[: sim["size"]], order[sim["size"]:]
        queries = np.concatenate([rest, anomalies])
        hq, hl = _pair(hd, queries, base)
        if fusion:
            (zq, zl), (fq, fl) = _z(hq, hl), _z(*_pair(fd, queries, base))
            q, loo = zq + fq, zl + fl
        else:
            q, loo = np.log(hq), np.log(hl)
        threshold = loo.mean() + sim["spread"] * loo.std()
        nq, aq = q[: len(rest)], q[len(rest):]
        aucs.append(auc(nq, aq))
        fprs.append(float((nq > threshold).mean()))
        recalls.append(float((aq > threshold).mean()))
    return {"auc": float(np.mean(aucs)), "fpr": float(np.mean(fprs)), "recall": float(np.mean(recalls))}


def evaluate(arrays: dict, groups: dict[str, tuple[np.ndarray, int]], sim: dict) -> dict:
    """groups: key -> (raw features normals-then-anomalies, n_normal). Product scoring per machine type."""
    per = {}
    for key, (feats, n_normal) in groups.items():
        fusion = key.startswith("bearing/")
        per[key] = simulate(apply_head(arrays, feats), frozen_embed(arrays, feats), n_normal, fusion, sim)
    summary = {}
    for machine in ("bearing", "gearbox", "all"):
        keys = [k for k in per if machine == "all" or k.startswith(machine + "/")]
        if keys:
            summary[machine] = {m: float(np.mean([per[k][m] for k in keys])) for m in ("auc", "fpr", "recall")} | {
                "max_fpr": float(max(per[k]["fpr"] for k in keys))}
    return {"per_group": per, "summary": summary}


def dev_groups_from_cache(rows: list[dict], feats: np.ndarray) -> dict[str, tuple[np.ndarray, int]]:
    groups: dict[str, dict[str, list[int]]] = {}
    for i, r in enumerate(rows):
        if r["role"] == "test":
            groups.setdefault(f"{r['machine']}/{r['section']}/{r['domain']}", {"normal": [], "anomaly": []})[r["label"]].append(i)
    return {k: (feats[g["normal"] + g["anomaly"]], len(g["normal"])) for k, g in sorted(groups.items())}


def shipped_arrays(config: dict) -> dict:
    with np.load(Path(config["bundle_dir"]) / "head.npz", allow_pickle=False) as data:
        return {k: data[k] for k in data.files}


def prepare(config: dict) -> dict:
    rows, feats = real_rows_and_features(config)
    labels, classes = condition_labels(rows)
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in rows])
    mu, sd = feats[train_mask].mean(0), feats[train_mask].std(0) + 1e-6
    syn = np.load(out_dir(config) / "synthetic_features.npz")
    index = {r["path"]: i for i, r in enumerate(rows)}
    src = np.array([index[p] for p in syn["paths"]])
    return {"rows": rows, "feats": feats, "labels": labels, "train_mask": train_mask, "mu": mu, "sd": sd,
            "s1": syn["s1"], "s1_labels": labels[src], "s2": syn["s2"], "classes": classes}


def fit(p: dict, candidate: str, seed: int, config: dict) -> dict:
    use_s1, use_s2 = CANDIDATES[candidate]
    z = lambda x: ((x - p["mu"]) / p["sd"]).astype(np.float32)  # noqa: E731
    model = train(z(p["feats"][p["train_mask"]]), p["labels"][p["train_mask"]],
                  z(p["s1"]) if use_s1 else None, p["s1_labels"] if use_s1 else None,
                  z(p["s2"]) if use_s2 else None, config["head"], seed, config["oe_weight"])
    return head_arrays(model, p["mu"], p["sd"])


def run_train(config: dict) -> dict:
    p = prepare(config)
    dev = dev_groups_from_cache(p["rows"], p["feats"])
    sim = config["simulation"]
    results = {"shipped": evaluate(shipped_arrays(config), dev, sim)}
    log(f"shipped: {results['shipped']['summary']['all']}")
    for candidate in CANDIDATES:
        for seed in config["seeds"]:
            name = f"{candidate}/seed{seed}"
            results[name] = evaluate(fit(p, candidate, seed, config), dev, sim)
            log(f"{name}: {results[name]['summary']}")
    means = {c: {m: float(np.mean([results[f"{c}/seed{s}"]["summary"][m]["auc"] for s in config["seeds"]]))
                 for m in ("all", "bearing", "gearbox")} for c in CANDIDATES}
    synth = [c for c in CANDIDATES if c != "H-real"]
    best = max(synth, key=lambda c: means[c]["all"])
    fpr_ok = all(results[f"{best}/seed{s}"]["summary"]["all"]["fpr"] <= 0.10
                 and results[f"{best}/seed{s}"]["summary"]["all"]["max_fpr"] <= 0.20 for s in config["seeds"])
    carried = means[best]["all"] - means["H-real"]["all"] >= 0.010 and fpr_ok
    report = {"experiment": "EXP-030 train", "commit": git_commit(), "results": results, "mean_auc_over_seeds": means,
              "selection": {"best": best, "gain_vs_H_real": means[best]["all"] - means["H-real"]["all"],
                            "fpr_ok": fpr_ok, "carried": carried}}
    (out_dir(config) / "train.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-030 train (commit {report['commit']})", "",
             "mean own10 AUC over seeds (all / bearing fusion / gearbox head):"]
    lines.append(f"  shipped 0.4.0  {results['shipped']['summary']['all']['auc']:.3f} / "
                 f"{results['shipped']['summary']['bearing']['auc']:.3f} / {results['shipped']['summary']['gearbox']['auc']:.3f}")
    for c, m in means.items():
        lines.append(f"  {c:12s}  {m['all']:.3f} / {m['bearing']:.3f} / {m['gearbox']:.3f}")
    lines += ["", "per seed: AUC | FPR | max FPR | recall (all)"]
    for name, r in results.items():
        a = r["summary"]["all"]
        lines.append(f"  {name:16s} {a['auc']:.3f} {a['fpr']:.3f} {a['max_fpr']:.3f} {a['recall']:.3f}")
    lines.append(f"\nselection: {json.dumps(report['selection'])}")
    (out_dir(config) / "TRAIN_SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


# --- confirmation on real held-out data ------------------------------------------------------------------

def encode_groups(encoder: PatchEncoder, groups: dict, batch: int) -> dict[str, tuple[np.ndarray, int]]:
    out = {}
    for key, clips in groups.items():
        paths = clips["normal"] + clips["anomaly"]
        feats = [pooled_features(encoder.tokens([read_clip(q) for q in paths[i : i + batch]])) for i in range(0, len(paths), batch)]
        out[key] = (np.concatenate(feats), len(clips["normal"]))
        log(f"encoded {key}")
    return out


def run_confirm(config: dict) -> dict:
    sel = json.loads((out_dir(config) / "train.json").read_text())["selection"]
    if not sel["carried"]:
        raise SystemExit("EXP-030: no candidate carried forward; confirmation does not run (pre-registered).")
    p = prepare(config)
    candidate = fit(p, sel["best"], 0, config)
    np.savez(out_dir(config) / "candidate_head.npz", **candidate)
    shipped = shipped_arrays(config)
    encoder = PatchEncoder(Path(config["bundle_dir"]), config["device"])
    sets = {"due_eval_gearbox": due_eval_groups(config), "due_dev_gearbox": due_dev_groups(config),
            "dcase22_eval_bearing": dcase22_bearing_groups(config)}
    sim = config["simulation"]
    results = {}
    for name, groups in sets.items():
        feats = encode_groups(encoder, groups, config["batch_size"])
        results[name] = {"shipped": evaluate(shipped, feats, sim), "candidate": evaluate(candidate, feats, sim)}

    def check(name: str, machine: str) -> dict:
        s, c = results[name]["shipped"], results[name]["candidate"]
        wins = sum(c["per_group"][k]["auc"] > s["per_group"][k]["auc"] for k in c["per_group"])
        cs, ss = c["summary"][machine], s["summary"][machine]
        return {"gain": cs["auc"] - ss["auc"], "wins": wins,
                "pass": cs["auc"] >= ss["auc"] + 0.010 and wins >= 4 and cs["fpr"] <= 0.10 and cs["max_fpr"] <= 0.20}

    gear = check("due_eval_gearbox", "gearbox")
    gear_dev_gain = results["due_dev_gearbox"]["candidate"]["summary"]["gearbox"]["auc"] - results["due_dev_gearbox"]["shipped"]["summary"]["gearbox"]["auc"]
    gear["pass"] = gear["pass"] and gear_dev_gain >= 0
    bear = check("dcase22_eval_bearing", "bearing")
    adopt = (gear["pass"] and bear["gain"] >= -0.005) or (bear["pass"] and gear["gain"] >= -0.005)
    report = {"experiment": "EXP-030 confirm", "commit": git_commit(), "candidate": sel["best"], "results": results,
              "decision": {"gearbox": gear, "gearbox_dev_gain": gear_dev_gain, "bearing": bear, "adopt": adopt}}
    (out_dir(config) / "confirm.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-030 confirm (commit {report['commit']}), candidate {sel['best']} seed 0 vs shipped 0.4.0"]
    for name, r in results.items():
        machine = "bearing" if "bearing" in name else "gearbox"
        for who in ("shipped", "candidate"):
            a = r[who]["summary"][machine]
            lines.append(f"  {name:22s} {who:9s} AUC {a['auc']:.3f} FPR {a['fpr']:.3f} (max {a['max_fpr']:.3f}) recall {a['recall']:.3f}")
    lines.append(f"\ndecision: {json.dumps(report['decision'])}")
    (out_dir(config) / "CONFIRM_SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def run_gearbox_aug(config: dict) -> dict:
    """EXP-031: H-aug (seed 0) for gearboxes vs the shipped head, on real MIMII DUE gearbox data."""
    p = prepare(config)
    candidate = fit(p, "H-aug", 0, config)
    out = Path("artifacts/EXP-031")
    out.mkdir(parents=True, exist_ok=True)
    np.savez(out / "gearbox_head.npz", **candidate)
    shipped = shipped_arrays(config)
    encoder = PatchEncoder(Path(config["bundle_dir"]), config["device"])
    sim = config["simulation"]
    results = {}
    for name, groups in (("due_eval_gearbox", due_eval_groups(config)), ("due_dev_gearbox", due_dev_groups(config))):
        feats = encode_groups(encoder, groups, config["batch_size"])
        results[name] = {"shipped": evaluate(shipped, feats, sim), "candidate": evaluate(candidate, feats, sim)}
    ev = results["due_eval_gearbox"]
    wins = sum(ev["candidate"]["per_group"][k]["auc"] > ev["shipped"]["per_group"][k]["auc"] for k in ev["candidate"]["per_group"])
    c, s = ev["candidate"]["summary"]["gearbox"], ev["shipped"]["summary"]["gearbox"]
    dev_gain = results["due_dev_gearbox"]["candidate"]["summary"]["gearbox"]["auc"] - results["due_dev_gearbox"]["shipped"]["summary"]["gearbox"]["auc"]
    adopt = bool(c["auc"] >= s["auc"] + 0.010 and wins >= 4 and c["fpr"] <= 0.10 and c["max_fpr"] <= 0.20 and dev_gain >= 0)
    report = {"experiment": "EXP-031", "commit": git_commit(), "results": results,
              "decision": {"gain": c["auc"] - s["auc"], "wins": wins, "due_dev_gain": dev_gain, "adopt_for_gearbox": adopt}}
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-031 (commit {report['commit']}): H-aug seed 0 vs shipped head, gearbox"]
    for name, r in results.items():
        for who in ("shipped", "candidate"):
            a = r[who]["summary"]["gearbox"]
            lines.append(f"  {name:18s} {who:9s} AUC {a['auc']:.3f} FPR {a['fpr']:.3f} (max {a['max_fpr']:.3f}) recall {a['recall']:.3f}")
        lines.append("    per section-domain AUC (shipped -> candidate): " + ", ".join(
            f"{k.split('/', 1)[1]} {r['shipped']['per_group'][k]['auc']:.3f}->{r['candidate']['per_group'][k]['auc']:.3f}"
            for k in r["candidate"]["per_group"]))
    lines.append(f"\ndecision: {json.dumps(report['decision'])}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--stage", required=True, choices=["generate", "train", "confirm", "gearbox_aug"])
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    {"generate": run_generate, "train": run_train, "confirm": run_confirm, "gearbox_aug": run_gearbox_aug}[args.stage](config)


if __name__ == "__main__":
    main()
