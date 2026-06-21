"""
Stage 3 smoke test — run after wiring refine_section into generator.py.

Usage (from repo root, with GOOGLE_APPLICATION_CREDENTIALS set):
    python -m chief_editor.smoke_test

Automated checks:
  (a) Every block in the generated plan has a non-None provenance.
  (c) Goal objective text was NOT rewritten (exact-string match against DB).
  (d) Per-job token usage stayed below the ceiling.

Manual check:
  (b) Faithfulness spot-check — printed to stdout for human review.
      For each agent section, shows source finding vs. block content.
"""
from __future__ import annotations

import json
import sys

from chief_editor import adapters
from chief_editor import llm as _llm
from chief_editor.generator import generate_plan
from chief_editor.storage import get_plan

JOB_ID = "smoke-test-01"
failures: list[str] = []
warnings: list[str] = []


# ── Helpers ────────────────────────────────────────────────────────────────────

def _extract_text_nodes(node: dict, collector: set[str]) -> None:
    """Recursively collect all leaf text values from a ProseMirror doc."""
    if not isinstance(node, dict):
        return
    if node.get("type") == "text" and node.get("text"):
        collector.add(node["text"].strip())
    for child in node.get("content") or []:
        _extract_text_nodes(child, collector)


def _iter_blocks(doc: dict):
    for sub in doc.get("preface", []):
        yield from sub.get("blocks", [])
    for ch in doc.get("chapters", []):
        for sub in ch.get("sections", []):
            yield from sub.get("blocks", [])


def _doc_from_row(row: dict) -> dict:
    """Return the document dict — handles both jsonb (auto-parsed) and text."""
    raw = row.get("document") or {}
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


# ── Generate ───────────────────────────────────────────────────────────────────

print("=== Chief Editor smoke test ===\n")
print("Generating plan (use_llm=True)…")
try:
    plan_id = generate_plan(use_llm=True, job_id=JOB_ID)
    print(f"  plan_id: {plan_id}\n")
except Exception as exc:
    print(f"FATAL: generate_plan raised: {exc}")
    sys.exit(1)

conn = adapters.get_conn()
row  = get_plan(conn, plan_id)
if not row:
    print("FATAL: plan not found in DB after generation")
    sys.exit(1)

doc = _doc_from_row(row)


# ── (a) Provenance check ───────────────────────────────────────────────────────

print("Check (a): every block has non-None provenance…")
missing_prov = [
    block.get("id", "<no-id>")
    for block in _iter_blocks(doc)
    if not block.get("provenance")
]
if missing_prov:
    failures.append(f"(a) {len(missing_prov)} block(s) with no provenance: {missing_prov[:5]}")
    print(f"  FAIL — {len(missing_prov)} blocks missing provenance")
else:
    print(f"  PASS")


# ── (b) Faithfulness spot-check (stdout for human review) ─────────────────────

AGENT_SECTIONS = {"swot_analysis", "gap_analysis", "strategic_goals", "implementation_plan"}

print("\nCheck (b): faithfulness spot-check (human review)…")
print("  For each agent section: source finding vs. first two editorially-phrased blocks.\n")

for ch in doc.get("chapters", []):
    for sub in ch.get("sections", []):
        key = sub.get("canonicalKey", "")
        if key not in AGENT_SECTIONS:
            continue
        shown = 0
        print(f"  ── {sub.get('heading', key)} ──")
        for block in sub.get("blocks", []):
            prov = block.get("provenance") or {}
            ev   = (prov.get("evidence") or {}) if isinstance(prov, dict) else {}
            if not ev.get("editoriallyPhrased"):
                continue
            finding = (prov.get("finding") or "")[:120]
            text_nodes: set[str] = set()
            _extract_text_nodes(block.get("content") or {}, text_nodes)
            block_text = " | ".join(list(text_nodes)[:3])[:200]
            print(f"    block {block.get('id', '?')}")
            print(f"      source : {finding!r}")
            print(f"      draft  : {block_text!r}")
            print()
            shown += 1
            if shown >= 2:
                break
        if shown == 0:
            print("    (no editorially-phrased blocks — deterministic fallback used)\n")


# ── (c) Objectives not rewritten ──────────────────────────────────────────────

print("Check (c): objective text was NOT rewritten…")

goals_run = adapters.fetch_goals_run_id(conn)
goals_db  = adapters.fetch_goals(conn, goals_run) if goals_run else []
goal_ids  = [g["goal_id"] for g in goals_db]
objs_db   = adapters.fetch_objectives(conn, goal_ids) if goal_ids else []
obj_texts = [obj["text"].strip() for obj in objs_db if obj.get("text")]

if not obj_texts:
    warnings.append("(c) No objectives in DB — skipping rewrite check")
    print("  SKIP — no objectives in DB")
else:
    goals_text_nodes: set[str] = set()
    for ch in doc.get("chapters", []):
        for sub in ch.get("sections", []):
            if sub.get("canonicalKey") != "strategic_goals":
                continue
            for block in sub.get("blocks", []):
                _extract_text_nodes(block.get("content") or {}, goals_text_nodes)

    rewritten: list[str] = []
    for orig in obj_texts:
        # The objective text must appear verbatim as at least one text node.
        if not any(orig == found or orig in found for found in goals_text_nodes):
            rewritten.append(orig[:90])

    if rewritten:
        failures.append(
            f"(c) {len(rewritten)} objective(s) missing or rewritten:\n"
            + "\n".join(f"    {t!r}" for t in rewritten[:3])
        )
        print(f"  FAIL — {len(rewritten)} / {len(obj_texts)} objective(s) missing or rewritten")
    else:
        print(f"  PASS — all {len(obj_texts)} objective(s) found verbatim")


# ── (d) Token ceiling ─────────────────────────────────────────────────────────

print("\nCheck (d): per-job token usage under ceiling…")
used    = _llm._job_tokens.get(JOB_ID, 0.0)
ceiling = _llm._TOKEN_CEILING
print(f"  tokens used (word-proxy): {used:,.0f} / {ceiling:,}")

if used > ceiling:
    failures.append(f"(d) Token ceiling breached: {used:.0f} > {ceiling}")
    print("  FAIL")
elif used == 0.0:
    warnings.append("(d) Zero tokens recorded — LLM calls may not have fired")
    print("  WARN — zero tokens (LLM may not have run)")
else:
    print("  PASS")


# ── Summary ────────────────────────────────────────────────────────────────────

print("\n=== Summary ===")
for w in warnings:
    print(f"  WARN  {w}")
if failures:
    for f in failures:
        print(f"  FAIL  {f}")
    print(f"\n{len(failures)} automated check(s) failed.")
    sys.exit(1)
else:
    print("  All automated checks passed.")
    print("  Review the (b) faithfulness output above manually.")
