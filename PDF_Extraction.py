"""
PDF_Extraction.py — Generic, document-agnostic TOC extractor.

Usage:
    python PDF_Extraction.py                        # uses PDF_PATH constant below
    python PDF_Extraction.py "C:\\path\\to\\doc.pdf" # CLI override

Output:
    - Console: per-page signal table, parsed TOC entries, debug dump
    - PDF_Extraction_report.json: full structured results (UTF-8)
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

# ── Windows console UTF-8 safety ──────────────────────────────────────────────
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# ── PDF path ───────────────────────────────────────────────────────────────────
PDF_PATH = r"Data\NU_strategic_plan_2020-2024.pdf"

# ── Tunable constants ──────────────────────────────────────────────────────────
TOC_SEARCH_PAGES     = 15   # how many pages from the front to scan
TOC_MIN_NUMBER_LINES = 5    # minimum number-bearing lines to qualify as TOC
MIN_LEADER_RUN       = 3    # minimum run length to count as a dot-leader
MONOTONIC_MIN        = 0.6  # minimum monotonic ratio for a page to qualify

# Arabic + English keywords that identify a TOC page header
TOC_KEYWORDS: list[str] = [
    "المحتويات",
    "الفهرس",
    "جدول المحتويات",
    "قائمة المحتويات",
    "فهرس",
    "الموضوع",
    "الصفحة",
    "رقم الصفحة",
    "contents",
    "table of contents",
    "index",
]

LEADER_CHARS = set(".·•‧ـ–—-°⋅")

# Punctuation stripped for orientation scoring only (not from stored headings)
_ORIENT_PUNCT = ".,;:!?()[]{}\"'-–—•·،؛؟"

# Arabic Unicode block ranges for arabic_ratio
_ARABIC_ALPHA_RE = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")


# ── normalize() ───────────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[ً-ٰٟـ]", "", text)
    text = re.sub(r"[أإآ]", "ا", text)
    text = re.sub(r"ى", "ي", text)
    text = re.sub(r"ة", "ه", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.lower()
    return text


def norm_keywords() -> list[str]:
    base = [normalize(k) for k in TOC_KEYWORDS]
    # Match reversed (visual-order) Arabic too — some PDFs store glyphs that way
    return base + [k[::-1] for k in base]


# ── leader stripping ───────────────────────────────────────────────────────────

_LEADER_RE = re.compile(r"[.·•‧ـ–—\-°⋅]{" + str(MIN_LEADER_RUN) + r",}")


def strip_leaders(text: str) -> str:
    return _LEADER_RE.sub(" ", text).strip()


# ── EDIT 1: bounded, side-safe number extraction ──────────────────────────────

def is_page_number(n: int) -> bool:
    """Valid page number: positive, sane magnitude, not a 4-digit year."""
    return 1 <= n <= 9999 and not (1900 <= n <= 2100)


def extract_leading_int(text: str) -> int | None:
    m = re.match(r"\s*(\d+)\b", text)
    return int(m.group(1)) if m else None


def extract_trailing_int(text: str) -> int | None:
    m = re.search(r"\b(\d+)\s*$", text)
    return int(m.group(1)) if m else None


def page_int_candidate(text: str) -> int | None:
    """
    Extract a valid page number from one line of text.
    Priority order:
      1. Bare integer (entire stripped text is a number) — table cells.
      2. Trailing integer — dot-leader lines (avoids grabbing section numbers
         like 2.1 from the front of the line).
    Never falls back to leading int.
    """
    cleaned = strip_leaders(text).strip()
    # bare integer?
    if re.fullmatch(r"\d+", cleaned):
        n = int(cleaned)
        return n if is_page_number(n) else None
    # trailing integer
    t = extract_trailing_int(cleaned)
    if t is not None and is_page_number(t):
        return t
    return None


def all_line_ints(lines_text: list[str]) -> list[int | None]:
    return [page_int_candidate(t) for t in lines_text]


def count_leader_lines(lines_text: list[str]) -> int:
    return sum(1 for t in lines_text if _LEADER_RE.search(t))


def monotonic_ratio(ints: list[int | None]) -> float:
    valid = [x for x in ints if x is not None]
    if len(valid) < 2:
        return 0.0
    pairs = list(zip(valid, valid[1:]))
    return sum(1 for a, b in pairs if b >= a) / len(pairs)


# ── per-page feature extraction ────────────────────────────────────────────────

def _reconstruct_arabic_line(rawdict_spans: list[dict]) -> str:
    """Sort chars by x_center ascending → logical Arabic reading order (Fix 2).

    Visual-order Arabic PDFs store glyphs left-to-right in the content stream.
    Sorting by x ascending reverses this back to logical (right-to-left) order.
    """
    char_pairs = []
    for span in rawdict_spans:
        for ch in span.get("chars", []):
            c = ch.get("c", "")
            if not c:
                continue
            bbox = ch.get("bbox", (0, 0, 0, 0))
            x_center = (bbox[0] + bbox[2]) / 2
            char_pairs.append((x_center, c))
    if not char_pairs:
        return ""
    char_pairs.sort(key=lambda p: p[0])
    return "".join(c for _, c in char_pairs).strip()


def page_lines(page) -> list[dict]:
    raw = page.get_text("rawdict", flags=0)
    lines = []
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            # Stream-order text (chars in PDF storage order — wrong for visual Arabic)
            stream_text = "".join(
                "".join(ch.get("c", "") for ch in sp.get("chars", []))
                for sp in spans
            )
            if not stream_text.strip():
                continue
            # Arabic lines: reconstruct from per-char x positions (Fix 2)
            if arabic_ratio(stream_text) >= 0.4:
                text = _reconstruct_arabic_line(spans)
            else:
                text = stream_text
            if not text.strip():
                continue
            bbox = line.get("bbox", (0, 0, 0, 0))
            lines.append({
                "text": text,
                "bbox": bbox,
                "spans": [
                    {
                        "text":  "".join(ch.get("c", "") for ch in s.get("chars", [])),
                        "bbox":  s.get("bbox", (0, 0, 0, 0)),
                        "size":  s.get("size", 0),
                        "font":  s.get("font", ""),
                        "flags": s.get("flags", 0),
                    }
                    for s in spans
                ],
            })
    lines.sort(key=lambda l: l["bbox"][1])
    return lines


# ── EDIT 4: scoring uses page_int_candidate + year filter ─────────────────────

def score_page(lines: list[dict], n_pages: int, norm_kws: list[str]) -> dict:
    texts = [l["text"] for l in lines]
    full_text_norm = normalize(" ".join(texts))

    keyword_hit = any(kw in full_text_norm for kw in norm_kws)

    # Use is_page_number-bounded candidates; year-filter replaces the old n_pages cap
    number_lines_valid = all_line_ints(texts)
    number_line_count = sum(1 for x in number_lines_valid if x is not None)
    dot_leader_count = count_leader_lines(texts)
    mon_ratio = monotonic_ratio(number_lines_valid)

    # Monotonicity is the dominant discriminator: count × monotonic²
    # A stats table has volume but not monotonic climb; a keyword multiplies, not adds
    score = number_line_count * (mon_ratio ** 2)
    if keyword_hit:
        score *= 1.5
    if dot_leader_count >= MIN_LEADER_RUN:
        score += dot_leader_count * 0.5

    qualifies = (
        number_line_count >= TOC_MIN_NUMBER_LINES
        and mon_ratio >= MONOTONIC_MIN
    )

    return {
        "keyword_hit":        keyword_hit,
        "number_line_count":  number_line_count,
        "dot_leader_count":   dot_leader_count,
        "monotonic_ratio":    round(mon_ratio, 3),
        "score":              round(score, 2),
        "qualifies":          qualifies,
    }


# ── TOC page detection ─────────────────────────────────────────────────────────

def find_toc_pages(doc, n_pages: int, norm_kws: list[str]) -> tuple[list[int], list[dict]]:
    limit = min(TOC_SEARCH_PAGES, n_pages)
    page_signals = []

    for i in range(limit):
        lines = page_lines(doc[i])
        sig = score_page(lines, n_pages, norm_kws)
        sig["page_1based"] = i + 1
        sig["lines"] = lines
        page_signals.append(sig)

    qualifying = [s for s in page_signals if s["qualifies"]]
    if not qualifying:
        qualifying = sorted(page_signals, key=lambda s: s["score"], reverse=True)[:1]

    qualifying.sort(key=lambda s: s["score"], reverse=True)
    best = qualifying[0]
    chosen = [best["page_1based"] - 1]

    best_idx_0 = best["page_1based"] - 1
    for offset in (1, 2):
        next_i = best_idx_0 + offset
        if next_i >= limit:
            break
        sig = page_signals[next_i]
        if sig["qualifies"] and sig["number_line_count"] >= TOC_MIN_NUMBER_LINES:
            chosen.append(next_i)
        else:
            break

    return chosen, page_signals


# ── EDIT 3: Arabic orientation helpers ────────────────────────────────────────

def arabic_ratio(s: str) -> float:
    """Fraction of alphabetic chars that are Arabic."""
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if _ARABIC_ALPHA_RE.match(c)) / len(letters)


def ar_orient_score(s: str) -> int:
    """
    Score how 'logically ordered' an Arabic string is.
    Logical Arabic starts words with alef (ا/أ/إ/آ) and contains the definite
    article ال; visual/reversed Arabic shows the mirror لا and few alef-initial tokens.
    Punctuation is stripped both ends per token so a leading/trailing . or ، doesn't
    block the alef-initial check — stripping is local, it never alters the heading text.
    """
    score = 0
    for tok in s.split():
        t = tok.strip(_ORIENT_PUNCT)
        if not t:
            continue
        if t[0] in "اأإآ" and t != "ال":
            score += 1
        score += t.count("ال")
    return score


def maybe_fix_rtl(text: str) -> tuple[str, bool]:
    """
    Return (corrected_text, was_reversed).
    If Arabic chars < 40% → leave untouched (Latin/English).
    If reversing the string scores higher on ar_orient_score → return reversed form.
    """
    if arabic_ratio(text) < 0.4:
        return text, False
    if ar_orient_score(text[::-1]) > ar_orient_score(text):
        return text[::-1], True
    return text, False


# ── EDIT 2: column-band + y-row pairing on native text ────────────────────────

def detect_rtl_side(lines: list[dict]) -> str:
    page_w_samples = []
    for line in lines:
        for sp in line["spans"]:
            if sp["text"].strip().isdigit():
                page_w_samples.append(sp["bbox"][0])
    if not page_w_samples:
        return "right"
    avg_x0 = sum(page_w_samples) / len(page_w_samples)
    all_x1 = [sp["bbox"][2] for line in lines for sp in line["spans"]]
    page_width = max(all_x1) if all_x1 else 600
    return "left" if avg_x0 < page_width * 0.35 else "right"


def _collect_num_spans(lines: list[dict]) -> list[dict]:
    """Collect every span that is a bare valid page number, with its bbox."""
    spans = []
    for line in lines:
        for sp in line["spans"]:
            t = sp["text"].strip()
            if re.fullmatch(r"\d+", t) and is_page_number(int(t)):
                spans.append({"num": int(t), "bbox": sp["bbox"],
                               "y_center": (sp["bbox"][1] + sp["bbox"][3]) / 2})
    return spans


def _find_number_column(num_spans: list[dict], page_width: float
                        ) -> tuple[float, float, str] | None:
    """
    Returns (x_lo, x_hi, side) if the integer spans cluster in one narrow band,
    else None (no column — use leader fallback).
    """
    if len(num_spans) < TOC_MIN_NUMBER_LINES:
        return None
    xs = [sp["bbox"][0] for sp in num_spans]
    x_lo, x_hi = min(xs), max(xs)
    band_width = x_hi - x_lo
    # Narrow band = columns; wide spread = numbers scattered across a stats grid
    if band_width > page_width * 0.25:
        return None
    center = (x_lo + x_hi) / 2
    side = "left" if center < page_width * 0.35 else "right"
    return x_lo, x_hi, side


def _find_table_bbox(page, x_lo: float, x_hi: float):
    """
    Return (x0, y0, x1, y1) outer bbox of the TOC table via find_tables(), or None.
    Only the outer bbox is reliable — cell geometry from find_tables() is not used.
    """
    try:
        tables = list(page.find_tables())
    except Exception:
        return None
    if not tables:
        return None
    col_center = (x_lo + x_hi) / 2
    for t in tables:
        bb = getattr(t, "bbox", None)
        if bb is not None and bb[0] <= col_center <= bb[2]:
            return tuple(bb)
    bb = getattr(tables[0], "bbox", None)
    return tuple(bb) if bb is not None else None


def parse_toc_pages(
    doc,
    chosen_idx_list: list[int],
) -> tuple[list[dict], list[dict], str]:
    """
    Main TOC extraction. Returns (entries, skipped, number_side).
    Uses column-band + y-row pairing (table path) or trailing-int (leader path).
    Heading text is native fitz get_text("dict"), corrected for orientation.
    """
    norm_kws = norm_keywords()
    all_entries: list[dict] = []
    all_skipped: list[dict] = []
    number_side = "right"

    for page_idx in chosen_idx_list:
        page = doc[page_idx]
        lines = page_lines(page)

        # Page geometry
        rect = page.rect
        page_width = rect.width if rect.width > 0 else 600.0

        # Collect all bare-integer spans
        num_spans = _collect_num_spans(lines)

        col = _find_number_column(num_spans, page_width)

        if col is not None:
            # ── TABLE PATH ────────────────────────────────────────────────────
            x_lo, x_hi, side = col
            number_side = side

            # Table outer bbox first — used to filter band_spans and heading_lines.
            table_bbox = _find_table_bbox(page, x_lo, x_hi)

            # Spans in the number column band, clipped to the table y-range
            # so page footer/header numbers don't become false row anchors.
            band_spans_all = sorted(
                [ns for ns in num_spans if x_lo - 5 <= ns["bbox"][0] <= x_hi + 5],
                key=lambda ns: ns["y_center"],
            )
            if table_bbox:
                t_y0 = table_bbox[1]
                t_y1 = table_bbox[3]
                band_spans = [ns for ns in band_spans_all
                              if t_y0 <= ns["y_center"] <= t_y1]
            elif band_spans_all:
                band_spans = band_spans_all
                t_y0 = band_spans[0]["y_center"] - 5.0
                t_y1 = band_spans[-1]["y_center"] + 5.0
            else:
                band_spans = band_spans_all
                t_y0 = 0.0
                t_y1 = float("inf")

            # Heading lines: anything outside the number column band,
            # clipped to the table y-range to exclude page headers/footers
            heading_lines = []
            for line in lines:
                txt = line["text"].strip()
                if re.fullmatch(r"\d+", txt) and is_page_number(int(txt)):
                    continue
                lx0 = line["bbox"][0]
                lx1 = line["bbox"][2]
                if lx0 >= x_lo - 5 and lx1 <= x_hi + 5:
                    continue
                ly_center = (line["bbox"][1] + line["bbox"][3]) / 2.0
                if ly_center < t_y0 or ly_center > t_y1:
                    continue
                heading_lines.append(line)

            for i, ns in enumerate(band_spans):
                # Row boundary: midpoints between consecutive anchors.
                # First/last anchors clamp to table y-extent (not 0/inf).
                if i == 0:
                    y_lo = t_y0
                else:
                    y_lo = (band_spans[i - 1]["y_center"] + ns["y_center"]) / 2.0

                if i == len(band_spans) - 1:
                    y_hi = t_y1
                else:
                    y_hi = (ns["y_center"] + band_spans[i + 1]["y_center"]) / 2.0

                page_num = ns["num"]

                paired = [
                    hl for hl in heading_lines
                    if y_lo <= (hl["bbox"][1] + hl["bbox"][3]) / 2.0 <= y_hi
                ]

                if not paired:
                    all_skipped.append({
                        "raw_line": str(page_num),
                        "norm_line": str(page_num),
                        "reason": "unpaired number — no heading in y-band",
                    })
                    continue

                # Join heading fragments in y order
                paired.sort(key=lambda l: l["bbox"][1])
                heading_raw = " ".join(l["text"].strip() for l in paired).strip()
                heading_raw = strip_leaders(heading_raw).strip()

                if not heading_raw:
                    all_skipped.append({
                        "raw_line": str(page_num),
                        "norm_line": str(page_num),
                        "reason": "empty heading after stripping",
                    })
                    continue

                # Stub filter: drop pure punctuation; flag low-alpha entries for human review.
                alpha_count = sum(1 for c in heading_raw if c.isalpha())
                if alpha_count < 2:
                    all_skipped.append({
                        "raw_line": heading_raw,
                        "norm_line": normalize(heading_raw),
                        "reason": "punctuation-only heading",
                    })
                    continue
                stub = alpha_count < 5

                # Skip header/title rows
                heading_norm = normalize(heading_raw)
                if any(kw in heading_norm for kw in norm_kws):
                    all_skipped.append({
                        "raw_line": heading_raw,
                        "norm_line": heading_norm,
                        "reason": "header/keyword row",
                    })
                    continue

                heading, was_reversed = maybe_fix_rtl(heading_raw)
                x0 = paired[0]["bbox"][0]

                all_entries.append({
                    "heading":      heading,
                    "heading_raw":  heading_raw,
                    "heading_norm": normalize(heading),
                    "was_reversed": was_reversed,
                    "page_number":  page_num,
                    "x0":           round(x0, 1),
                    "raw_line":     heading_raw,
                    "source":       "table",
                    "flagged":      stub,
                })

        else:
            # ── LEADER PATH (Cairo / no column) ───────────────────────────────
            side = detect_rtl_side(lines)
            number_side = side

            for line in lines:
                raw = line["text"]
                page_num = page_int_candidate(raw)
                if page_num is None:
                    all_skipped.append({
                        "raw_line": raw,
                        "norm_line": normalize(raw),
                        "reason": "no valid trailing page number",
                    })
                    continue

                # Strip the trailing number and any leaders to get heading
                cleaned = strip_leaders(raw)
                heading_raw = re.sub(r"\s*\b" + str(page_num) + r"\b\s*$", "", cleaned).strip()
                heading_raw = strip_leaders(heading_raw).strip()

                if not heading_raw:
                    all_skipped.append({
                        "raw_line": raw,
                        "norm_line": normalize(raw),
                        "reason": "empty heading after stripping number",
                    })
                    continue

                # Skip punctuation-only headings
                if sum(1 for c in heading_raw if c.isalpha()) < 2:
                    all_skipped.append({
                        "raw_line": heading_raw,
                        "norm_line": normalize(heading_raw),
                        "reason": "punctuation-only heading",
                    })
                    continue

                heading_norm = normalize(heading_raw)
                if any(kw in heading_norm for kw in norm_kws):
                    all_skipped.append({
                        "raw_line": raw,
                        "norm_line": heading_norm,
                        "reason": "header/keyword row",
                    })
                    continue

                heading, was_reversed = maybe_fix_rtl(heading_raw)
                x0 = line["bbox"][0]

                all_entries.append({
                    "heading":      heading,
                    "heading_raw":  heading_raw,
                    "heading_norm": normalize(heading),
                    "was_reversed": was_reversed,
                    "page_number":  page_num,
                    "x0":           round(x0, 1),
                    "raw_line":     raw,
                    "source":       "leader",
                    "flagged":      False,
                })

    # Deduplicate by (heading_norm, page_number) — y-tolerance can yield duplicates
    seen: set[tuple[str, int]] = set()
    deduped = []
    for e in all_entries:
        key = (e["heading_norm"], e["page_number"])
        if key not in seen:
            seen.add(key)
            deduped.append(e)
    all_entries = deduped

    # Sort by page number, then assign levels and validate monotonicity
    all_entries.sort(key=lambda e: e["page_number"])
    all_entries = assign_levels(all_entries)

    prev_page = 0
    for e in all_entries:
        if e["page_number"] < prev_page:
            e["flagged"] = True
        else:
            prev_page = e["page_number"]

    return all_entries, all_skipped, number_side


def assign_levels(entries: list[dict]) -> list[dict]:
    if not entries:
        return entries
    x0_vals = sorted(set(round(e["x0"] / 10) * 10 for e in entries))
    x0_rank = {v: i + 1 for i, v in enumerate(x0_vals)}
    for e in entries:
        bucketed = round(e["x0"] / 10) * 10
        e["level"] = x0_rank.get(bucketed, 1)
    return entries


# ── EDIT 5: output / report ────────────────────────────────────────────────────

def print_separator(char: str = "─", width: int = 90) -> None:
    print(char * width)


def print_section(title: str) -> None:
    print()
    print_separator("═")
    print(f"  {title}")
    print_separator("═")


def print_entries_table(entries: list[dict]) -> None:
    print_section(f"EXTRACTED TOC ENTRIES  ({len(entries)} total)")
    header = f"{'#':>3}  {'Page':>4}  {'Lvl':>3}  {'Flg':>3}  {'Rev':>3}  {'Src':>6}  Heading"
    print(header)
    print_separator("-", 88)
    for i, e in enumerate(entries, 1):
        flag = "⚠" if e.get("flagged") else " "
        rev  = "←" if e.get("was_reversed") else " "
        src  = e.get("source", "?")[:6]
        heading = e["heading"][:60]
        print(f"{i:>3}  {e['page_number']:>4}  {e.get('level', '?'):>3}  "
              f"{flag:>3}  {rev:>3}  {src:>6}  {heading}")


def print_signal_table(page_signals: list[dict], chosen_set_1based: set[int]) -> None:
    print_section("TOC PAGE DETECTION — per-page signals")
    header = (f"{'Page':>5}  {'KW':>3}  {'#Lines':>6}  {'Leaders':>7}  "
              f"{'Monotonic':>9}  {'Score':>6}  {'Qualifies':>9}  {'Chosen':>6}")
    print(header)
    print_separator("-", len(header) + 2)
    for sig in page_signals:
        is_chosen = sig["page_1based"] in chosen_set_1based
        print(
            f"{sig['page_1based']:>5}  "
            f"{'YES' if sig['keyword_hit'] else 'no':>3}  "
            f"{sig['number_line_count']:>6}  "
            f"{sig['dot_leader_count']:>7}  "
            f"{sig['monotonic_ratio']:>9.3f}  "
            f"{sig['score']:>6.2f}  "
            f"{'YES' if sig['qualifies'] else 'no':>9}  "
            f"{'<<<' if is_chosen else '':>6}"
        )


def print_debug_dump(entries: list[dict], skipped: list[dict]) -> None:
    print_section("DEBUG DUMP — extracted entries detail")
    for e in entries:
        rev_tag = " [REVERSED→fixed]" if e.get("was_reversed") else ""
        print(f"  pg={e['page_number']:>4}  src={e.get('source','?'):>6}  "
              f"lvl={e.get('level','?')}  flag={'⚠' if e.get('flagged') else ' '}")
        print(f"    raw    : {e['heading_raw'][:70]}")
        print(f"    heading: {e['heading'][:70]}{rev_tag}")
        print_separator("-", 60)
    if skipped:
        print_section(f"SKIPPED LINES ({len(skipped)} total)")
        for s in skipped[:40]:
            print(f"  [{s['reason']}]  {s['raw_line'][:60]}")
        if len(skipped) > 40:
            print(f"  ... and {len(skipped) - 40} more (see JSON report)")


# ── Main ───────────────────────────────────────────────────────────────────────

def main(pdf_path: str) -> None:
    path = Path(pdf_path)
    if not path.exists():
        print(f"ERROR: file not found: {path}")
        sys.exit(1)

    print(f"\nPDF_Extraction.py — TOC extractor")
    print(f"PDF : {path}")

    try:
        import fitz  # noqa: PLC0415
    except ImportError:
        print("ERROR: PyMuPDF not installed. Run: pip install pymupdf")
        sys.exit(1)

    doc = fitz.open(str(path))
    n_pages = len(doc)
    print(f"Pages: {n_pages}")

    page_labels_info = None
    try:
        labels = doc.get_page_labels()
        if labels:
            page_labels_info = str(labels)[:200]
            print(f"Page labels: {page_labels_info}")
    except Exception:
        pass

    norm_kws = norm_keywords()

    # ── Locate TOC pages ───────────────────────────────────────────────────────
    chosen_0, page_signals = find_toc_pages(doc, n_pages, norm_kws)
    chosen_set_1based = {i + 1 for i in chosen_0}
    chosen_1based = [i + 1 for i in chosen_0]

    print_signal_table(page_signals, chosen_set_1based)

    if not chosen_0:
        print("\nNo TOC page found.")
        sys.exit(0)

    print(f"\nChosen TOC page(s): {chosen_1based}")

    # ── Parse TOC ─────────────────────────────────────────────────────────────
    entries, skipped, number_side = parse_toc_pages(doc, chosen_0)
    print(f"Detected number side: {number_side.upper()}")

    # ── Validate ───────────────────────────────────────────────────────────────
    n_flagged = sum(1 for e in entries if e.get("flagged"))
    final_ints = [e["page_number"] for e in entries]
    final_mon = monotonic_ratio(final_ints)
    n_reversed = sum(1 for e in entries if e.get("was_reversed"))

    # ── Print results ──────────────────────────────────────────────────────────
    print_entries_table(entries)
    print_debug_dump(entries, skipped)

    # ── Summary ────────────────────────────────────────────────────────────────
    print_section("SUMMARY")
    print(f"  TOC page(s)      : {chosen_1based}")
    print(f"  Entries extracted: {len(entries)}")
    print(f"  Skipped lines    : {len(skipped)}")
    print(f"  Monotonic ratio  : {final_mon:.3f}")
    print(f"  Anomalies flagged: {n_flagged}")
    print(f"  Headings reversed: {n_reversed}")
    verdict = "SUFFICIENT" if len(entries) >= 5 and final_mon >= 0.6 else "NEEDS REVIEW"
    print(f"  Verdict          : {verdict}")
    print()

    # ── Write JSON report ──────────────────────────────────────────────────────
    report_path = Path(__file__).parent / "PDF_Extraction_report.json"
    report = {
        "pdf_path":         str(path),
        "n_pages":          n_pages,
        "page_labels":      page_labels_info,
        "toc_pages_1based": chosen_1based,
        "number_side":      number_side,
        "settings": {
            "TOC_SEARCH_PAGES":     TOC_SEARCH_PAGES,
            "TOC_MIN_NUMBER_LINES": TOC_MIN_NUMBER_LINES,
            "MIN_LEADER_RUN":       MIN_LEADER_RUN,
            "MONOTONIC_MIN":        MONOTONIC_MIN,
        },
        "per_page_signals": [
            {
                "page":              s["page_1based"],
                "keyword_hit":       s["keyword_hit"],
                "number_line_count": s["number_line_count"],
                "dot_leader_count":  s["dot_leader_count"],
                "monotonic_ratio":   s["monotonic_ratio"],
                "score":             s["score"],
                "qualifies":         s["qualifies"],
                "chosen":            s["page_1based"] in chosen_set_1based,
            }
            for s in page_signals
        ],
        "toc_entries": [
            {
                "heading":      e["heading"],
                "heading_raw":  e["heading_raw"],
                "heading_norm": e["heading_norm"],
                "was_reversed": e.get("was_reversed", False),
                "page_number":  e["page_number"],
                "level":        e.get("level"),
                "source":       e.get("source"),
                "raw_line":     e["raw_line"],
                "flagged":      e.get("flagged", False),
            }
            for e in entries
        ],
        "skipped_lines": skipped,
        "summary": {
            "entries_found":    len(entries),
            "skipped_lines":    len(skipped),
            "monotonic_ratio":  round(final_mon, 3),
            "anomalies":        n_flagged,
            "headings_reversed": n_reversed,
            "verdict":          verdict,
        },
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"Report written → {report_path}")


if __name__ == "__main__":
    pdf_arg = sys.argv[1] if len(sys.argv) > 1 else PDF_PATH
    main(pdf_arg)
