"""Fresh held-out gearbox test on MIMII DUE (EXP-020). Evaluation only (CC-BY-NC-SA-4.0).

Systems, all fixed before this data was downloaded:
* app: the shipped ADR-010 model, exactly: 4-layer AST layer-4 frequency pooling and the
  bundle's head.npz (sonovate-ast-head 0.3.0);
* lora: the EXP-019 gearbox candidate (LoRA AST + head, epoch 4, seed 0);
* frozen: layer-4 frequency pooling without a head (context);
* adr008: last-layer AST patch mean (the model before ADR-010; context).

Protocols: own-baseline (N = 10 and 30 baselines from the same section-domain's normal test
clips, 200 draws) with thresholds at spread 1.5 and 2.0; and full references (the section's
training clips). Plus leakage checks against MIMII DG. Scores are anomaly scores, not
probabilities.

Usage: python -m ml.fresh_gearbox_eval --config configs/fresh_gearbox_eval.json --stage embed
       python -m ml.fresh_gearbox_eval --config configs/fresh_gearbox_eval.json --stage evaluate
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from ml.ast_layers import freq_pool
from ml.attribute_head import TRAIN_ROLES, Head, condition_labels
from ml.baseline import Row, git_commit, load_rows
from ml.baseline_size import simulate_sizes, summarize
from ml.export_ast_head import apply_head
from ml.final_eval import mean_delta_interval
from ml.fusion import prepare_features
from ml.lora_ast import LoraAstHead, add_lora
from ml.metrics import auc, partial_auc
from ml.pretrained import domain_min_scores, log, normalize_rows

DUE_NAME = re.compile(r"section_(?P<section>\d{2})_(?P<domain>source|target)_(?P<split>train|test)_(?P<label>normal|anomaly)_(?P<index>\d{4})")
SYSTEMS = ("app", "lora", "frozen", "adr008")


def due_rows(root: Path) -> list[Row]:
    rows = []
    for path in sorted(root.rglob("*.wav")):
        match = DUE_NAME.match(path.name)
        if match is None:
            raise ValueError(f"unexpected file name: {path}")
        rows.append({"path": str(path.relative_to(root)), "machine": "gearbox", "section": match["section"],
                     "domain": match["domain"], "label": match["label"],
                     "role": "test" if match["split"] == "test" else "train"})
    return rows


def md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def cache_path(config: dict) -> Path:
    return Path(config["output"]) / "embeddings.npz"


def build_lora(config: dict, device: str) -> LoraAstHead:
    from transformers import ASTModel

    lora_config = json.loads(Path(config["lora_config"]).read_text())
    head_config = json.loads(Path(lora_config["head_config"]).read_text())
    head_config["features"] = json.loads(Path(head_config["features_config"]).read_text())
    rows, frozen, _, labels = prepare_features(head_config)
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in rows])
    mu, sd = frozen[train_mask].mean(0), frozen[train_mask].std(0) + 1e-6
    ast = ASTModel.from_pretrained(lora_config["model_id"], use_safetensors=True, num_hidden_layers=lora_config["layers"])
    add_lora(ast, tuple(lora_config["lora"]["targets"]), lora_config["lora"]["rank"], lora_config["lora"]["alpha"])
    h = head_config["head"]
    head = Head(12 * 768, h["hidden"], h["dim"], int(labels[train_mask].max()) + 1, h["scale"], h["margin"])
    model = LoraAstHead(ast, head, mu, sd)
    state = torch.load(config["lora_weights"], map_location="cpu", weights_only=True)
    missing, unexpected = model.load_state_dict(state, strict=False)
    trainable = {n for n, p in model.named_parameters() if p.requires_grad}
    if unexpected or (trainable - set(state)):
        raise RuntimeError(f"LoRA checkpoint mismatch: unexpected={unexpected}, missing trainable={trainable - set(state)}")
    return model.to(device).eval()


@torch.no_grad()
def run_embed(config: dict) -> None:
    from transformers import ASTFeatureExtractor, ASTModel

    root = Path(config["raw_root"])
    rows = due_rows(root)
    device, batch = config["device"], config["batch_size"]
    extractor = ASTFeatureExtractor.from_pretrained(config["model_id"])
    ast4 = ASTModel.from_pretrained(config["model_id"], use_safetensors=True, num_hidden_layers=4).to(device).eval()
    ast12 = ASTModel.from_pretrained(config["model_id"], use_safetensors=True).to(device).eval()
    lora = build_lora(config, device)
    with np.load(Path(config["bundle_dir"]) / "head.npz", allow_pickle=False) as data:
        head = {k: data[k] for k in data.files}

    out = {s: [] for s in SYSTEMS}
    formats = set()
    log(f"embedding {len(rows)} MIMII DUE gearbox clips")
    for start in range(0, len(rows), batch):
        chunk = rows[start : start + batch]
        waves = []
        for r in chunk:
            samples, rate = sf.read(root / r["path"], dtype="float32")
            formats.add((rate, samples.ndim, len(samples)))
            waves.append(samples)
        x = extractor(waves, sampling_rate=16_000, return_tensors="pt")["input_values"].to(device)
        frozen = freq_pool(ast4(input_values=x, output_hidden_states=True).hidden_states[-1][:, 2:].float().cpu().numpy())
        out["frozen"].append(frozen)
        out["app"].append(apply_head(head, frozen))
        out["lora"].append(lora.embed(x).float().cpu().numpy())
        out["adr008"].append(ast12(input_values=x).last_hidden_state[:, 2:].mean(dim=1).float().cpu().numpy())
        if start % (batch * 50) == 0:
            log(f"embedded {start + len(chunk)}/{len(rows)}")
    if formats != {(16_000, 1, 160_000)}:
        raise ValueError(f"unexpected audio formats: {sorted(formats)[:5]}")
    Path(config["output"]).mkdir(parents=True, exist_ok=True)
    np.savez(cache_path(config), paths=np.array([r["path"] for r in rows]),
             **{s: np.concatenate(v).astype(np.float32) for s, v in out.items()})
    log("saved")


def leakage_checks(config: dict, rows: list[Row], frozen: np.ndarray) -> dict:
    """Exact (MD5) and near-duplicate (frozen-feature cosine distance) overlap with MIMII DG."""
    data = json.loads(Path(config["mimii_dg_config"]).read_text())
    dg_rows = [r for r in load_rows(data) if r["machine"] in ("bearing", "gearbox")]
    dg_md5 = {r["md5"] for r in dg_rows}
    due_md5 = [md5(Path(config["raw_root"]) / r["path"]) for r in rows]
    exact = sum(h in dg_md5 for h in due_md5)
    duplicates_within = len(due_md5) - len(set(due_md5))

    dev = np.load(config["dev_features"])
    dg_index = {p: i for i, p in enumerate(dev["paths"])}
    dg_gear = normalize_rows(dev["freq"][[dg_index[r["path"]] for r in dg_rows if r["machine"] == "gearbox"], 0].astype(np.float32))
    test = [i for i, r in enumerate(rows) if r["role"] == "test"]
    due_test = normalize_rows(frozen[test])
    nearest_dg = (1.0 - due_test @ dg_gear.T).min(axis=1)
    within = 1.0 - due_test @ due_test.T
    np.fill_diagonal(within, np.inf)
    nearest_due = within.min(axis=1)
    return {"exact_md5_overlap_with_mimii_dg": int(exact), "duplicate_md5_within_due": int(duplicates_within),
            "nearest_mimii_dg_distance_min": float(nearest_dg.min()),
            "nearest_mimii_dg_distance_median": float(np.median(nearest_dg)),
            "nearest_due_distance_median": float(np.median(nearest_due)),
            "test_clips_closer_to_mimii_dg_than_1e-4": int((nearest_dg < 1e-4).sum())}


def run_evaluate(config: dict) -> dict:
    rows = due_rows(Path(config["raw_root"]))
    cached = np.load(cache_path(config))
    if list(cached["paths"]) != [r["path"] for r in rows]:
        raise ValueError("cached embeddings do not match the files on disk")
    vectors = {s: normalize_rows(cached[s]) for s in SYSTEMS}
    s = config["simulation"]
    spreads, sizes = s["spreads"], s["sizes"]

    counts, own, full, entries = {}, {}, {}, {x: [] for x in SYSTEMS if x != "app"}
    test = [i for i, r in enumerate(rows) if r["role"] == "test"]
    for key in sorted({(rows[i]["section"], rows[i]["domain"]) for i in test}):
        group = [i for i in test if (rows[i]["section"], rows[i]["domain"]) == key]
        normal_idx = [i for i in group if rows[i]["label"] == "normal"]
        anomaly_idx = [i for i in group if rows[i]["label"] == "anomaly"]
        name = f"gearbox/{key[0]}/{key[1]}"
        counts[name] = {"normal": len(normal_idx), "anomaly": len(anomaly_idx)}
        evaluation_normals = len(normal_idx) - sizes[-1]
        own[name] = {}
        for system in SYSTEMS:
            draws = simulate_sizes(vectors[system][normal_idx], vectors[system][anomaly_idx], sizes, evaluation_normals,
                                   spreads, s["repeats"], s["seed"], config["max_fpr"])
            own[name][system] = summarize(draws, spreads, spreads[-1])

    for section in sorted({rows[i]["section"] for i in test}):
        idx = [i for i, r in enumerate(rows) if r["section"] == section]
        refs = [i for i in idx if rows[i]["role"] == "train"]
        sec_test = [i for i in idx if rows[i]["role"] == "test"]
        anomaly = np.array([rows[i]["label"] == "anomaly" for i in sec_test])
        scores = {}
        for system in SYSTEMS:
            v = vectors[system]
            source = v[[i for i in refs if rows[i]["domain"] == "source"]]
            target = v[[i for i in refs if rows[i]["domain"] == "target"]]
            scores[system] = domain_min_scores(v[sec_test], source, target, 1)
        for domain in ("source", "target"):
            name = f"gearbox/{section}/{domain}"
            in_domain = np.array([rows[i]["domain"] == domain for i in sec_test])
            full[name] = {}
            for system in SYSTEMS:
                sc = scores[system]
                # Official DCASE domain AUC: in-domain normals vs all anomalies of the section.
                full[name][system] = {"auc": auc(sc[in_domain & ~anomaly], sc[anomaly]),
                                      "pauc": partial_auc(sc[in_domain & ~anomaly], sc[anomaly], config["max_fpr"])}
            for system in entries:
                new, old = scores[system], scores["app"]
                entries[system].append((new[in_domain & ~anomaly], new[anomaly], old[in_domain & ~anomaly], old[anomaly]))

    keys = list(own)

    def own_mean(system: str, size: int, metric: str, spread: float | None = None) -> float:
        if spread is None:
            return float(np.mean([own[k][system][str(size)][metric] for k in keys]))
        i = spreads.index(spread)
        return float(np.mean([own[k][system][str(size)]["curve"][i][metric] for k in keys]))

    summary = {system: {
        "own_auc": {str(n): own_mean(system, n, "auc") for n in sizes},
        "own_pauc": {str(n): own_mean(system, n, "pauc") for n in sizes},
        "own_fpr": {f"N{n}/s{sp}": own_mean(system, n, "fpr", sp) for n in sizes for sp in spreads},
        "own_recall": {f"N{n}/s{sp}": own_mean(system, n, "recall", sp) for n in sizes for sp in spreads},
        "max_section_fpr": {f"N{n}/s{sp}": float(max(own[k][system][str(n)]["curve"][spreads.index(sp)]["fpr"] for k in keys))
                            for n in sizes for sp in spreads},
        "full_auc": float(np.mean([full[k][system]["auc"] for k in keys])),
        "full_pauc": float(np.mean([full[k][system]["pauc"] for k in keys])),
    } for system in SYSTEMS}

    rule = config["rule"]
    n = str(rule["size"])
    wins = sum(own[k]["lora"][n]["auc"] > own[k]["app"][n]["auc"] for k in keys)
    delta = summary["lora"]["own_auc"][n] - summary["app"]["own_auc"][n]
    lora_better = bool(delta > 0 and wins >= rule["min_wins"])
    gearbox_model = "lora" if lora_better else "app"
    threshold_key = f"N{rule['size']}/s{rule['spread']}"
    threshold_confirmed = bool(summary[gearbox_model]["own_fpr"][threshold_key] <= rule["max_mean_fpr"]
                               and summary[gearbox_model]["max_section_fpr"][threshold_key] <= rule["max_section_fpr"])
    decisions = {
        "lora_vs_app": {"own_auc_delta": delta, "wins": int(wins), "of": len(keys), "better": lora_better,
                        "full_auc_delta": summary["lora"]["full_auc"] - summary["app"]["full_auc"],
                        "full_auc_delta_95": mean_delta_interval(entries["lora"], config["bootstrap"]["samples"],
                                                                 config["bootstrap"]["seed"])},
        "gearbox_model": gearbox_model,
        "threshold": {"model": gearbox_model, "setting": threshold_key, "confirmed": threshold_confirmed,
                      "mean_fpr": summary[gearbox_model]["own_fpr"][threshold_key],
                      "max_section_fpr": summary[gearbox_model]["max_section_fpr"][threshold_key],
                      "mean_recall": summary[gearbox_model]["own_recall"][threshold_key]},
    }
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config, "counts": counts,
              "leakage": leakage_checks(config, rows, cached["frozen"]), "own": own, "full": full,
              "summary": summary, "decisions": decisions}
    out = Path(config["output"])
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "SUMMARY.txt").write_text(format_summary(report) + "\n")
    return report


def format_summary(report: dict) -> str:
    s, own, cfg = report["summary"], report["own"], report["config"]
    sizes, spreads = cfg["simulation"]["sizes"], cfg["simulation"]["spreads"]
    lines = [f"{report['experiment']} fresh gearbox test, MIMII DUE (commit {report['git_commit'][:7]})", "",
             "Leakage: " + ", ".join(f"{k} {v:.4g}" if isinstance(v, float) else f"{k} {v}" for k, v in report["leakage"].items()),
             "Counts: " + ", ".join(f"{k} {v['normal']}n/{v['anomaly']}a" for k, v in report["counts"].items()), "",
             f"own AUC per section-domain at N={sizes[0]}: " + " / ".join(SYSTEMS)]
    for k in own:
        lines.append(f"  {k:<20}" + "".join(f"{own[k][x][str(sizes[0])]['auc']:>8.3f}" for x in SYSTEMS))
    lines += ["", f"{'system':<8}" + "".join(f"{'AUC N=' + str(n):>11}" for n in sizes) + f"{'full AUC':>10}"
              + "".join(f"{'FPR/rec N' + str(n) + ' s' + str(sp):>20}" for n in sizes for sp in spreads)]
    for x in SYSTEMS:
        v = s[x]
        lines.append(f"{x:<8}" + "".join(f"{v['own_auc'][str(n)]:>11.3f}" for n in sizes) + f"{v['full_auc']:>10.3f}"
                     + "".join(f"{v['own_fpr'][f'N{n}/s{sp}']:>11.3f}/{v['own_recall'][f'N{n}/s{sp}']:.3f}"
                               for n in sizes for sp in spreads))
    d = report["decisions"]
    lv, th = d["lora_vs_app"], d["threshold"]
    lo, hi = lv["full_auc_delta_95"]
    lines += ["", f"LoRA vs app (own AUC N={cfg['rule']['size']}): delta {lv['own_auc_delta']:+.3f}, wins {lv['wins']}/{lv['of']} -> "
              f"{'BETTER' if lv['better'] else 'NOT shown better'}; full AUC delta {lv['full_auc_delta']:+.3f} (95% {lo:+.3f} to {hi:+.3f})",
              f"Threshold {th['setting']} on {th['model']}: mean FPR {th['mean_fpr']:.3f}, max section FPR {th['max_section_fpr']:.3f}, "
              f"recall {th['mean_recall']:.3f} -> {'CONFIRMED' if th['confirmed'] else 'NOT confirmed'}",
              "Scores are anomaly scores, not probabilities."]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["embed", "evaluate"], required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    if args.stage == "embed":
        run_embed(config)
    else:
        run_evaluate(config)
        print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
