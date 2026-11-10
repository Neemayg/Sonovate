"""LoRA fine-tuning of the 4-layer AST with the condition head, end to end (EXP-019).

The 4-layer AST from the AudioSet checkpoint stays frozen; low-rank adapters (LoRA) are
added to the query, key and value projections of every layer. The layer-4 frequency
pooling (12 x 768) feeds the EXP-014 head architecture, and adapters plus head are trained
to classify machine, section and condition on MIMII DG `train`/`adaptation` clips only
(`validation` monitors accuracy). After training, every clip is embedded (128 values) and
scored with the EXP-013 protocols. Scores are anomaly scores, not probabilities.

Usage: python -m ml.lora_ast --config configs/lora_ast.json --stage features
       python -m ml.lora_ast --config configs/lora_ast.json --stage train
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ml.ast_layers import AST_FREQ_PATCHES, AST_TIME_PATCHES, evaluate_candidate
from ml.attribute_head import TRAIN_ROLES, Head, condition_labels
from ml.audio import load_clip
from ml.baseline import git_commit, load_rows
from ml.fusion import prepare_features
from ml.pretrained import log


class LoRALinear(nn.Module):
    """Frozen linear layer plus a trainable low-rank update B @ A, scaled by alpha / rank. B starts at zero."""

    def __init__(self, base: nn.Linear, rank: int, alpha: float) -> None:
        super().__init__()
        self.base = base
        for p in self.base.parameters():
            p.requires_grad_(False)
        self.a = nn.Parameter(torch.randn(rank, base.in_features) / math.sqrt(base.in_features))
        self.b = nn.Parameter(torch.zeros(base.out_features, rank))
        self.scale = alpha / rank

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.base(x) + (x @ self.a.T @ self.b.T) * self.scale


def add_lora(model: nn.Module, targets: tuple[str, ...], rank: int, alpha: float) -> int:
    """Replace every nn.Linear whose attribute name is in `targets`; returns how many were wrapped."""
    for p in model.parameters():
        p.requires_grad_(False)
    wrapped = 0
    for module in list(model.modules()):
        for name, child in list(module.named_children()):
            if name in targets and isinstance(child, nn.Linear):
                setattr(module, name, LoRALinear(child, rank, alpha))
                wrapped += 1
    return wrapped


class LoraAstHead(nn.Module):
    def __init__(self, ast: nn.Module, head: Head, mu: np.ndarray, sd: np.ndarray) -> None:
        super().__init__()
        self.ast, self.head = ast, head
        self.register_buffer("mu", torch.from_numpy(mu).float())
        self.register_buffer("sd", torch.from_numpy(sd).float())

    def features(self, fbank: torch.Tensor) -> torch.Tensor:
        tokens = self.ast(input_values=fbank, output_hidden_states=True).hidden_states[-1][:, 2:]
        b, _, d = tokens.shape
        pooled = tokens.reshape(b, AST_FREQ_PATCHES, AST_TIME_PATCHES, d).mean(dim=2).reshape(b, -1)
        return (pooled - self.mu) / self.sd

    def logits(self, fbank: torch.Tensor, labels: torch.Tensor | None = None) -> torch.Tensor:
        return self.head.logits(self.features(fbank), labels)

    def embed(self, fbank: torch.Tensor) -> torch.Tensor:
        return self.head.embed(self.features(fbank))


def fbank_path(config: dict) -> Path:
    return Path(config["output"]) / "fbank.npy"


def run_features(config: dict) -> None:
    """AST filterbank inputs for every clip, once (float16, about 1.9 GB)."""
    from transformers import ASTFeatureExtractor

    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"]]
    extractor = ASTFeatureExtractor.from_pretrained(config["model_id"])
    rate, frames = data["audio"]["sample_rate"], data["audio"]["sample_rate"] * data["audio"]["clip_seconds"]
    Path(config["output"]).mkdir(parents=True, exist_ok=True)
    out = np.lib.format.open_memmap(fbank_path(config), mode="w+", dtype=np.float16, shape=(len(rows), 1024, 128))
    for start in range(0, len(rows), 64):
        chunk = rows[start : start + 64]
        waves = [load_clip(Path(data["raw_root"]) / r["path"], rate, frames) for r in chunk]
        out[start : start + len(chunk)] = extractor(waves, sampling_rate=rate, return_tensors="np")["input_values"]
        if start % 1280 == 0:
            log(f"features {start + len(chunk)}/{len(rows)}")
    out.flush()
    np.save(Path(config["output"]) / "fbank_paths.npy", np.array([r["path"] for r in rows]))
    log("saved")


@torch.no_grad()
def embed_all(model: LoraAstHead, fbank: np.ndarray, device: str, batch: int) -> np.ndarray:
    model.eval()
    out = []
    for start in range(0, len(fbank), batch):
        x = torch.from_numpy(np.asarray(fbank[start : start + batch], dtype=np.float32)).to(device)
        out.append(model.embed(x).cpu().numpy())
    return np.concatenate(out)


def run_train(config: dict) -> dict:
    from transformers import ASTModel

    head_config = json.loads(Path(config["head_config"]).read_text())
    head_config["features"] = json.loads(Path(head_config["features_config"]).read_text())
    rows, frozen, _, labels = prepare_features(head_config)
    paths = list(np.load(Path(config["output"]) / "fbank_paths.npy"))
    if paths != [r["path"] for r in rows]:
        raise ValueError("filterbank cache order does not match the feature cache")
    fbank = np.load(fbank_path(config), mmap_mode="r")
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in rows])
    val_idx = np.flatnonzero(np.array([r["role"] == "validation" for r in rows]) & (labels >= 0))
    mu, sd = frozen[train_mask].mean(0), frozen[train_mask].std(0) + 1e-6

    seed, device, t = config["seed"], config["device"], config["training"]
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    ast = ASTModel.from_pretrained(config["model_id"], use_safetensors=True, num_hidden_layers=config["layers"])
    wrapped = add_lora(ast, tuple(config["lora"]["targets"]), config["lora"]["rank"], config["lora"]["alpha"])
    h = head_config["head"]
    classes = int(labels[train_mask].max()) + 1
    head = Head(AST_FREQ_PATCHES * 768, h["hidden"], h["dim"], classes, h["scale"], h["margin"])
    model = LoraAstHead(ast, head, mu, sd).to(device)
    lora_params = [p for n, p in model.named_parameters() if p.requires_grad and n.startswith("ast.")]
    optimizer = torch.optim.AdamW([{"params": lora_params, "lr": t["lr_lora"]},
                                   {"params": model.head.parameters(), "lr": t["lr_head"]}],
                                  weight_decay=t["weight_decay"])
    train_idx = np.flatnonzero(train_mask)
    counts = np.bincount(labels[train_idx], minlength=classes)
    loss_fn = nn.CrossEntropyLoss(weight=torch.from_numpy((counts.max() / np.maximum(counts, 1)) ** 0.5).float().to(device))
    log(f"LoRA wrapped {wrapped} projections; trainable LoRA params {sum(p.numel() for p in lora_params)}")

    history, per_epoch = [], {}
    for epoch in range(1, t["epochs"] + 1):
        model.train()
        started = time.time()
        order = rng.permutation(train_idx)
        for start in range(0, len(order) - 1, t["batch_size"]):
            idx = np.sort(order[start : start + t["batch_size"]])
            x = torch.from_numpy(np.asarray(fbank[idx], dtype=np.float32)).to(device)
            y = torch.from_numpy(labels[idx]).long().to(device)
            loss = loss_fn(model.logits(x, y), y)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            correct = 0
            for start in range(0, len(val_idx), t["batch_size"]):
                idx = val_idx[start : start + t["batch_size"]]
                x = torch.from_numpy(np.asarray(fbank[idx], dtype=np.float32)).to(device)
                correct += int((model.logits(x).argmax(1).cpu().numpy() == labels[idx]).sum())
        entry = {"epoch": epoch, "loss": float(loss.detach()), "val_accuracy": correct / len(val_idx),
                 "minutes": (time.time() - started) / 60}
        history.append(entry)
        log(f"epoch {epoch}: loss {entry['loss']:.3f}, val acc {entry['val_accuracy']:.3f}, {entry['minutes']:.1f} min")
        if epoch in t["evaluate_epochs"]:
            embedded = embed_all(model, fbank, device, t["batch_size"] * 2)
            result = evaluate_candidate(rows, embedded, head_config["features"])
            own = result["own10"]["sections"]
            result["bearing_own10_auc"] = float(np.mean([v["auc"] for k, v in own.items() if k.startswith("bearing")]))
            result["gearbox_own10_auc"] = float(np.mean([v["auc"] for k, v in own.items() if k.startswith("gearbox")]))
            per_epoch[str(epoch)] = result
            log(f"epoch {epoch}: own10 {result['own10']['mean_auc']:.3f} (bearing {result['bearing_own10_auc']:.3f}, "
                f"gearbox {result['gearbox_own10_auc']:.3f}), full {result['full']['mean_auc']:.3f}")
            torch.save({k: v for k, v in model.state_dict().items() if ".a" in k[-2:] or ".b" in k[-2:] or k.startswith("head.")},
                       Path(config["output"]) / f"trainable_epoch{epoch}.pt")

    final = per_epoch[str(t["epochs"])]
    ref = config["references"]
    decision = {
        "overall_gain": final["own10"]["mean_auc"] - ref["head_overall"],
        "bearing_gain": final["bearing_own10_auc"] - ref["best_bearing"],
        "gearbox_gain": final["gearbox_own10_auc"] - ref["head_gearbox"],
    }
    decision.update({k.replace("_gain", "_adopt"): v >= config["min_gain"] for k, v in list(decision.items())})
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config,
              "history": history, "per_epoch": per_epoch, "decision": decision}
    out = Path(config["output"])
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [f"{config['experiment']} (commit {report['git_commit'][:7]}), seed {seed}", ""]
    lines += [f"epoch {e['epoch']}: loss {e['loss']:.3f}, val acc {e['val_accuracy']:.3f}, {e['minutes']:.1f} min" for e in history]
    lines.append("")
    for ep, r in per_epoch.items():
        lines.append(f"epoch {ep}: own10 {r['own10']['mean_auc']:.3f} (bearing {r['bearing_own10_auc']:.3f}, "
                     f"gearbox {r['gearbox_own10_auc']:.3f}); FPR {r['own10']['mean_fpr']:.3f}, recall {r['own10']['mean_recall']:.3f}; "
                     f"full {r['full']['mean_auc']:.3f}")
    lines += ["", f"Per section-domain own10 AUC, final epoch {t['epochs']}:"]
    lines += [f"  {k:<20}{v['auc']:.3f}" for k, v in final["own10"]["sections"].items()]
    lines += ["", f"References: head overall {ref['head_overall']}, best bearing {ref['best_bearing']}, head gearbox {ref['head_gearbox']}",
              "Decision (final epoch, rule >= %s): " % config["min_gain"]
              + ", ".join(f"{k} {v:+.3f}" if isinstance(v, float) else f"{k} {v}" for k, v in decision.items())]
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["features", "train"], required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    if args.stage == "features":
        run_features(config)
    else:
        run_train(config)
        print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
