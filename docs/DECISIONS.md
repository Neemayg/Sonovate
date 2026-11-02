# Architecture and Research Decisions (ADR Log)

Only record accepted decisions here. Proposed options belong in an issue or task note until approved.

## Decision template
### ADR-NNN — Short title
- **Status:** Proposed | Accepted | Superseded
- **Date:**
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences/trade-offs:**
- **Evidence:**

---

## ADR-000 — Project research scope
- **Status:** Accepted
- **Context:** The project aims to distinguish expected acoustic variation from potential abnormal machine behaviour under changing environmental/operating conditions.
- **Decision:** Start with industrial acoustic anomaly detection. Test environmental/operating context as a differentiator only when genuinely aligned metadata is available.
- **Consequences:** Audio-only baseline comes first. Context-aware claims require a fair comparative experiment.

## Pending decisions
- Primary machine family.
- Primary dataset and license.
- Evaluation generalization target and split unit.
- Model approach and feature representation.
- Application architecture and technology stack.
- Recording hardware and context-sensor strategy.
