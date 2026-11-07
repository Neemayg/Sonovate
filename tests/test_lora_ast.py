"""LoRA wrapper tests."""

import torch
from torch import nn

from ml.lora_ast import LoRALinear, add_lora


class Block(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.query = nn.Linear(4, 4)
        self.other = nn.Linear(4, 4)


def test_lora_starts_as_the_base_layer_and_only_adapters_train():
    torch.manual_seed(0)
    model = nn.Sequential(Block(), Block())
    x = torch.randn(3, 4)
    before = model[0].query(x)

    wrapped = add_lora(model, ("query",), rank=2, alpha=4.0)

    assert wrapped == 2
    assert isinstance(model[0].query, LoRALinear) and isinstance(model[0].other, nn.Linear)
    assert torch.allclose(model[0].query(x), before)  # B starts at zero
    trainable = {n for n, p in model.named_parameters() if p.requires_grad}
    assert trainable == {"0.query.a", "0.query.b", "1.query.a", "1.query.b"}


def test_lora_update_changes_output():
    layer = LoRALinear(nn.Linear(4, 4), rank=2, alpha=2.0)
    with torch.no_grad():
        layer.b.fill_(0.5)
    x = torch.ones(1, 4)
    assert not torch.allclose(layer(x), layer.base(x))
