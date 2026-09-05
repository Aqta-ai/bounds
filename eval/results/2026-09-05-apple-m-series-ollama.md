# Gemma contextual-PHI evaluation, 2026-09-05

Backend: **Apple M-series, Ollama** · model `gemma4:e2b` · hardware: {'platform': 'macOS-26.5.2-arm64-arm-64bit', 'python': '3.12.8', 'cpu': 'Apple M2 Pro', 'gpu': 'none detected (no nvidia-smi)'}
Items 48 · gold spans 39 · negatives 12 · confidence floor 0.75

Span-level scoring: a prediction matches a gold span when one contains the other after normalisation, whatever label the model gave it. Category correctness is reported separately because the app redacts the span and shows the label as metadata.

| Gold category | Gold spans | Found | Missed | Recall | Label correct |
|---|---|---|---|---|---|
| inline_diagnosis | 6 | 6 | 0 | 1.00 | 1.00 |
| medication_mention | 8 | 8 | 0 | 1.00 | 1.00 |
| treatment_procedure | 7 | 7 | 0 | 1.00 | 1.00 |
| indirect_health_context | 6 | 5 | 1 | 0.83 | 1.00 |
| sensitive_social | 6 | 6 | 0 | 1.00 | 0.67 |
| genetic_reference | 6 | 6 | 0 | 1.00 | 1.00 |

| Overall | TP | FP | FN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| all spans | 38 | 11 | 1 | 0.78 | 0.97 | 0.86 |

False positives: 2 on positive passages, 9 on the 12 negative passages. Labels the model emitted: {'inline_diagnosis': 6, 'indirect_health_context': 7, 'medication_mention': 12, 'treatment_procedure': 13, 'sensitive_social': 4, 'genetic_reference': 7}. Malformed responses: 0. Latency p50 1.7s, p90 3.3s per passage.

Synthetic passages only; no real documents. The prompt is read from `src/workers/gemma.worker.ts` and the acceptance rules mirror `src/workers/gemmaParse.ts`, so this measures the shipped layer.
