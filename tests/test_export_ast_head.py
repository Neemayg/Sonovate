"""The numpy head used by the bundle must match the torch head in eval mode."""

import numpy as np
import torch

from ml.attribute_head import Head
from ml.export_ast_head import apply_head, head_arrays


def test_numpy_head_matches_torch_eval_mode():
    torch.manual_seed(0)
    model = Head(dim_in=20, hidden=16, dim_out=8, classes=3, scale=16.0, margin=0.2)
    # Give batch norm non-trivial running statistics.
    model.train()
    with torch.no_grad():
        for _ in range(5):
            model.body(torch.randn(32, 20) * 3 + 1)
    model.eval()
    rng = np.random.default_rng(0)
    raw = rng.normal(size=(6, 20)).astype(np.float32) * 2 + 0.5
    mu, sd = raw.mean(0), raw.std(0) + 1e-6

    expected = model.embed(torch.from_numpy((raw - mu) / sd)).detach().numpy()
    got = apply_head(head_arrays(model, mu, sd), raw)

    np.testing.assert_allclose(got, expected, atol=1e-5)
    np.testing.assert_allclose(np.linalg.norm(got, axis=1), 1.0, atol=1e-6)
