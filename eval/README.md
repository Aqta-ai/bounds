# Evaluating the Gemma contextual-PHI layer

`run_eval.py` measures the shipped Gemma layer, not a stand-in: it reads the system prompt
out of `src/workers/gemma.worker.ts` at run time and applies the parser's rules (six
categories, confidence floor, span verbatim in the input). `dataset.jsonl` is synthetic and
labelled: 36 positive passages across the six categories, including French and German, and
12 negatives that carry only structured identifiers or clinical words that are not about a
person. No real documents, ever.

Results land in `results/<date>-<backend>.{json,md}` with the hardware recorded. A result
is only ever claimed for the hardware named in its file.

What the first run found (5 Sep 2026, Apple M2 Pro, Ollama, `gemma4:e2b`): the model finds the
spans (recall 0.97 over 39 gold spans) but the shipped parser was discarding most of them, because
the prompt asks for `"type": "HEALTH_DATA"` and the model usually writes the category id there
instead, or numbers the rule (`gemma:4`). The parser now accepts those shapes and nothing else;
`src/__tests__/gemmaParse.test.ts` pins them. Precision is 0.78: the model flags medication and
procedure words in passages that are not about a person (a pharmacy stock list), which the
prompt does not currently forbid. Both numbers are in `results/`.

```bash
# local, any machine with Ollama and gemma4:e2b
python3 eval/run_eval.py --backend "Apple M-series, Ollama"

# NVIDIA GPU (Google Colab T4): open eval/colab_gemma_eval.ipynb and run all cells
```
