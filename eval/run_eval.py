#!/usr/bin/env python3
"""Evaluate the Bounds Gemma contextual-PHI layer against a labelled synthetic set.

Runs the SAME system prompt the app uses (read from src/workers/gemma.worker.ts, so the two
cannot drift) against an Ollama endpoint, applies the same parser rules (JSON array, six
categories, confidence floor, span must appear verbatim in the input), and scores span-level
precision and recall per category. Writes eval/results/<date>-<slug>.json and .md with the
hardware it ran on. Nothing is claimed for hardware it has not run on.

  python3 eval/run_eval.py --backend "Apple M-series, Ollama" [--model gemma4:e2b] [--url http://localhost:11434]
"""
import argparse, datetime, json, os, platform, re, subprocess, sys, time, urllib.request, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATS = ["inline_diagnosis","medication_mention","treatment_procedure","indirect_health_context","sensitive_social","genetic_reference"]

def load_prompt():
    src = open(os.path.join(ROOT, "src/workers/gemma.worker.ts"), encoding="utf-8").read()
    floor = re.search(r"HEALTHCARE_CONFIDENCE_FLOOR\s*=\s*([0-9.]+)", open(os.path.join(ROOT, "src/workers/gemmaParse.ts"), encoding="utf-8").read()).group(1)
    m = re.search(r"const SYSTEM_PROMPT = `(.*?)`\n", src, re.S)
    if not m: sys.exit("SYSTEM_PROMPT not found in gemma.worker.ts")
    return m.group(1).replace("${HEALTHCARE_CONFIDENCE_FLOOR}", floor), float(floor)

def norm(s):
    s = unicodedata.normalize("NFKC", s).lower()
    return re.sub(r"[^\w]+", "", s, flags=re.U)

def call_ollama(url, model, system, chunk, timeout=180):
    body = {"model": model, "messages": [{"role":"system","content":system},{"role":"user","content":chunk}],
            "stream": False, "think": False, "options": {"temperature": 0.1, "num_predict": 2048}, "format": "json"}
    req = urllib.request.Request(f"{url}/api/chat", data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.load(r)
    return (d.get("message") or {}).get("content") or d.get("response") or ""

def parse(raw, source, floor):
    """Mirror of parseAndValidate in src/workers/gemmaParse.ts: JSON array only; type must be
    HEALTH_DATA or one of the six category ids; confidence >= floor; ruleId 'gemma:<category id>',
    with a 1-6 index or the type field resolving it; reason non-empty; text (trimmed) must appear
    verbatim in the source after NFC normalisation."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I); cleaned = re.sub(r"\s*```\s*$", "", cleaned, flags=re.I).strip()
    try: obj = json.loads(cleaned)
    except Exception: return [], "malformed"
    if not isinstance(obj, list): return [], "not-a-list"
    src = unicodedata.normalize("NFC", source); out = []
    for it in obj:
        if not isinstance(it, dict): continue
        text = it.get("text"); text = text.strip() if isinstance(text, str) else ""
        typ = it.get("type"); conf = it.get("confidence"); rid = it.get("ruleId"); reason = it.get("reason")
        if not text or not (typ == "HEALTH_DATA" or typ in CATS) or not isinstance(conf, (int, float)) or conf < floor: continue
        if not isinstance(rid, str) or not rid.startswith("gemma:") or not isinstance(reason, str) or not reason: continue
        suffix = rid[len("gemma:"):].strip().lower()
        if suffix in CATS: cat = suffix
        elif suffix in ("1","2","3","4","5","6"): cat = CATS[int(suffix)-1]
        elif typ in CATS: cat = typ
        else: continue
        if unicodedata.normalize("NFC", text) not in src: continue
        out.append({"text": text, "category": cat, "confidence": float(conf)})
    return out, "ok"

def hardware():
    info = {"platform": platform.platform(), "python": platform.python_version()}
    try: info["cpu"] = subprocess.check_output(["sysctl","-n","machdep.cpu.brand_string"], text=True).strip()
    except Exception: pass
    try: info["gpu"] = subprocess.check_output(["nvidia-smi","--query-gpu=name,memory.total","--format=csv,noheader"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception: info["gpu"] = "none detected (no nvidia-smi)"
    return info

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--backend", required=True, help='label for the hardware, e.g. "NVIDIA T4, Google Colab, Ollama"')
    ap.add_argument("--model", default="gemma4:e2b"); ap.add_argument("--url", default="http://localhost:11434"); ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    system, floor = load_prompt()
    items = [json.loads(l) for l in open(os.path.join(ROOT, "eval/dataset.jsonl"), encoding="utf-8")]
    if a.limit: items = items[:a.limit]
    found = {c:0 for c in CATS}; missed = {c:0 for c in CATS}; cat_ok = {c:0 for c in CATS}; fp_pos = 0; neg_fp = 0; malformed = 0; lat = []; rows = []; label_counts = {}
    for it in items:
        t0 = time.time()
        try: raw = call_ollama(a.url, a.model, system, it["text"])
        except Exception as e: raw = ""; print("call failed:", e, file=sys.stderr)
        lat.append(time.time()-t0)
        preds, status = parse(raw, it["text"], floor)
        if status != "ok": malformed += 1
        for p in preds: label_counts[p["category"]] = label_counts.get(p["category"], 0) + 1
        gold = [(norm(s["text"]), s["category"]) for s in it["spans"]]
        matched = set(); row_fp = 0
        for p in preds:
            pn = norm(p["text"]); hit = None
            for gi,(gn,gc) in enumerate(gold):
                if gi in matched: continue
                if pn == gn or pn in gn or gn in pn: hit = gi; break
            if hit is None:
                if it["cat"] == "negative": neg_fp += 1
                else: fp_pos += 1
                row_fp += 1
            else:
                matched.add(hit); found[gold[hit][1]] += 1
                if p["category"] == gold[hit][1]: cat_ok[gold[hit][1]] += 1
        for gi,(gn,gc) in enumerate(gold):
            if gi not in matched: missed[gc] += 1
        rows.append({"id": it["id"], "gold": [s["text"] for s in it["spans"]], "pred": [(p["text"], p["category"], p["confidence"]) for p in preds], "status": status, "latency_s": round(lat[-1],2), "raw": raw[:2000]})
        print(f"{it['id']:28s} gold={len(gold)} pred={len(preds)} fp={row_fp} {status} {lat[-1]:.1f}s", flush=True)
    per = {}
    for c in CATS:
        n = found[c] + missed[c]
        per[c] = {"gold": n, "found": found[c], "missed": missed[c], "recall": (found[c]/n if n else None), "category_correct": (cat_ok[c]/found[c] if found[c] else None)}
    TP = sum(found.values()); FN = sum(missed.values()); FP = fp_pos + neg_fp
    overall = {"tp":TP,"fp":FP,"fn":FN,"precision": TP/(TP+FP) if TP+FP else None, "recall": TP/(TP+FN) if TP+FN else None}
    overall["f1"] = (2*overall["precision"]*overall["recall"]/(overall["precision"]+overall["recall"])) if overall["precision"] and overall["recall"] else None
    overall["category_correct"] = sum(cat_ok.values())/TP if TP else None
    lat_sorted = sorted(lat); p50 = lat_sorted[len(lat)//2]; p90 = lat_sorted[min(len(lat)-1, max(0, -(-len(lat)*9//10)-1))]
    result = {"procedure":"bounds-gemma-eval/v1","date": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "backend": a.backend, "hardware": hardware(),
              "model": a.model, "confidence_floor": floor, "items": len(items), "gold_spans": TP+FN, "negatives": sum(1 for i in items if i["cat"]=="negative"),
              "false_positives_on_positives": fp_pos, "false_positives_on_negatives": neg_fp, "malformed_responses": malformed, "labels_emitted": label_counts,
              "latency_s": {"p50": round(p50,2), "p90": round(p90,2)}, "overall": overall, "per_category": per, "rows": rows}
    slug = re.sub(r"[^a-z0-9]+","-", a.backend.lower()).strip("-")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    out = os.path.join(ROOT, "eval/results", f"{stamp}-{slug}")
    json.dump(result, open(out+".json","w"), indent=2, ensure_ascii=False)
    fmt = lambda v: "n/a" if v is None else f"{v:.2f}"
    md = [f"# Gemma contextual-PHI evaluation, {stamp}", "", f"Backend: **{a.backend}** · model `{a.model}` · hardware: {result['hardware']}", f"Items {len(items)} · gold spans {TP+FN} · negatives {result['negatives']} · confidence floor {floor}", "",
          "Span-level scoring: a prediction matches a gold span when one contains the other after normalisation, whatever label the model gave it. Category correctness is reported separately because the app redacts the span and shows the label as metadata.", "",
          "| Gold category | Gold spans | Found | Missed | Recall | Label correct |", "|---|---|---|---|---|---|"]
    for c in CATS: md.append(f"| {c} | {per[c]['gold']} | {per[c]['found']} | {per[c]['missed']} | {fmt(per[c]['recall'])} | {fmt(per[c]['category_correct'])} |")
    md += ["", f"| Overall | TP | FP | FN | Precision | Recall | F1 |", "|---|---|---|---|---|---|---|", f"| all spans | {TP} | {FP} | {FN} | {fmt(overall['precision'])} | {fmt(overall['recall'])} | {fmt(overall['f1'])} |", "",
           f"False positives: {fp_pos} on positive passages, {neg_fp} on the {result['negatives']} negative passages. Labels the model emitted: {label_counts}. Malformed responses: {malformed}. Latency p50 {p50:.1f}s, p90 {p90:.1f}s per passage.", "",
           "Synthetic passages only; no real documents. The prompt is read from `src/workers/gemma.worker.ts` and the acceptance rules mirror `src/workers/gemmaParse.ts`, so this measures the shipped layer."]
    open(out+".md","w").write("\n".join(md)+"\n")
    print("\n".join(md[6:]))
    print("wrote", out+".{json,md}")

if __name__ == "__main__": main()
