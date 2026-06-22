"""
OCR Agent — Arabic PDF Strategic Plan Extractor & Section Classifier.
Uses Google Document AI Layout Parser (hybrid with pypdfium2 fallback).

Entry points:
  compile_and_run(pdf_path)        → extract from PDF (calls Document AI)
  parse_extracted_md(md_content)   → classify a pre-extracted .md file (no API)
"""
import io
import os
import re
import time
import uuid
import warnings

warnings.filterwarnings("ignore")


# ── Arabic normalization ───────────────────────────────────────────────────────

def _norm(text: str) -> str:
    """
    Normalize Arabic text for robust keyword matching:
      - Unify alef variants (أ إ آ ٱ → ا)
      - Unify ya/alef-maqsura (ى → ي)
      - Strip tashkeel (harakat) and tatweel
    """
    text = re.sub(r'[أإآٱ]', 'ا', text)
    text = text.replace('ى', 'ي')
    text = re.sub(r'[ً-ٟـ]', '', text)
    return text


# GCP credentials must be set before importing the client library
_GCP_CREDS = os.getenv("GCP_CREDENTIALS_PATH", "d:/OCR/gcp-credentials-new.json")
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _GCP_CREDS

PROJECT_ID         = os.getenv("GCP_PROJECT_ID", "caregiver-tutoring-assistant")
LOCATION           = "us"
FALLBACK_THRESHOLD = 150


NOISE_EXACT = {
    "Nile University", "جامعة النيل", "QAU", "a QAU", "وحدة ضمان الجودة",
    "(TCS Qty A", "(TCS Quty A", "し", "",
}
NOISE_CONTAINS = [
    "وحدة ضمان الجودة- كلية تكنولوجيا",
    "وحدة ضمان الجودة - كلية تكنولوجيا",
    "وحدة ضمان الجودة- كلية تكنولوجيا المعلومات",
]
_PAGE_NUM_RE = re.compile(r"^\d{1,3}$")

# ── Section classification rules ───────────────────────────────────────────────
# Tuple: (section_key, section_type, arabic_title, [keyword_patterns])
# Pages are assigned to the FIRST matching rule — order matters.
# All keywords are pre-normalized via _norm() at import time.
# Cover is NOT listed here: page 1 is always cover (see _classify_page).

SECTION_RULES = [
    # ── Static ────────────────────────────────────────────────────────────────
    ("approval_date",       "static",  "تاريخ اعتماد الخطة",
     ["تاريخ اعتماد"]),
    ("dean_message",        "static",  "كلمة العميد",
     ["كلمة الاستاذ الدكتور", "كلمة عميد"]),
    ("prep_team",           "static",  "فريق إعداد الخطة",
     ["فريق اعداد وتحديث الخطة"]),
    ("table_of_contents",   "static",  "قائمة المحتويات",
     ["| الموضوع |", "الموضوع الصفحة", "فهرس المحتويات"]),
    # "التخطيط الاستراتيجي" intentionally excluded — it appears inside SWOT
    # methodology text (page 29) and would steal those pages.
    ("introduction",        "static",  "مقدمة الخطة",
     ["مقدمة الخطة"]),
    ("college_overview",    "static",  "نبذة عن الكلية والبيانات الوصفية",
     ["نبذة عن كلية", "البيانات الوصفية", "انشئت جامعة النيل",
      "الطلاب المقيدين"]),
    # "الهيكل التنظيمي" alone appears as a criterion name in SWOT/gap tables;
    # "الهيكل التنظيمي للكلية" is the exact phrase used on the org-chart page.
    ("org_structure",       "static",  "الهيكل التنظيمي",
     ["الهيكل التنظيمي للكلية"]),
    # "الموارد المالية" alone appears as a criterion name in SWOT/gap tables;
    # the longer form "الموارد المالية والبنية" is specific to the resources section.
    ("financial_resources", "static",  "الموارد المالية والبنية الأساسية",
     ["الموارد المالية والبنية"]),
    ("excellence_features", "static",  "سمات التميز",
     ["سمات التميز"]),
    ("planning_philosophy", "static",  "الإطار الفكري للخطة",
     ["الاطار الفكري", "فلسفة الكلية في التخطيط",
      "منهجية اعداد الخطة", "خطوات اعداد الخطة"]),
    ("risk_assessment",     "static",  "تقييم المخاطر",
     ["تقييم المخاطر"]),
    # "الرؤية والرسالة" (short) appears as a criterion row in SWOT/gap tables;
    # use longer/unique phrases only.
    ("vision_mission",      "static",  "الرؤية والرسالة والقيم",
     ["رؤية ورسالة الكلية", "القيم الحاكمة",
      "منهجية اعداد الرؤية"]),
    ("guiding_policies",    "static",  "السياسات المرشدة",
     ["السياسات المرشدة", "السياسات العامة للكلية",
      "سياسات الكلية في مجالات التدريس"]),

    # ── Dynamic ───────────────────────────────────────────────────────────────
    # gap_analysis BEFORE swot_analysis: gap tables share "عوامل القوة/الضعف"
    # column headers with SWOT, but "مقترحات التحسين" is unique to gap tables.
    ("gap_analysis",        "dynamic", "تحليل الفجوة",
     ["تحليل الفجوة", "الفجوة بين", "مقترحات التحسين", "المستوي الراهن"]),
    ("swot_analysis",       "dynamic", "التحليل البيئي (SWOT)",
     ["تحليل الرباعي", "تحليل SWOT", "التحليل البيئي",
      "عوامل القوة", "عوامل الضعف",
      "نقاط القوة", "نقاط الضعف",
      "البيئة الداخلية", "البيئة الخارجية",
      "PESTEL", "بيستل"]),
    # "الخطة التنفيذية" / "خطة تنفيذية" appear in the risk-assessment section text
    # and the introduction; use the unique table-column keywords only.
    # "الانشطة التنفيذية" appears in the introduction summary — removed.
    ("implementation_plan", "dynamic", "الخطة التنفيذية",
     ["مسئول التنفيذ", "مؤشرات المتابعة"]),
    # "الغايات والاهداف" / "الاهداف الاستراتيجية" appear in the introduction
    # text when it summarises the plan; keep only the longer section heading.
    ("strategic_goals",     "dynamic", "الغايات والأهداف الإستراتيجية",
     ["الغايات الاستراتيجية"]),
]

# Pre-compute normalized keywords once at import time.
_NORM_RULES: list[tuple[str, str, str, list[str]]] = [
    (key, stype, title, [_norm(p) for p in patterns])
    for key, stype, title, patterns in SECTION_RULES
]


def _classify_page(text: str, page_num: int = 0) -> tuple[str, str, str]:
    """Return (section_key, section_type, title_ar).

    Page 1 is always the cover regardless of text content.
    Both text and keywords are normalized so Arabic variant characters don't
    cause false misses.
    """
    if page_num == 1:
        return "cover", "static", "صفحة الغلاف"
    n = _norm(text)
    for key, stype, title, patterns in _NORM_RULES:
        for pat in patterns:
            if pat in n:
                return key, stype, title
    return "unknown", "unknown", ""


# ── Noise filter ───────────────────────────────────────────────────────────────

def _is_noise(text: str) -> bool:
    t = text.strip()
    if not t or t in NOISE_EXACT:
        return True
    if _PAGE_NUM_RE.match(t):
        return True
    return any(p in t for p in NOISE_CONTAINS)


# ── PDF helpers ────────────────────────────────────────────────────────────────

def _extract_page_as_pdf(src_path: str, page_idx: int) -> bytes:
    import pypdfium2 as pdfium
    src = pdfium.PdfDocument(src_path)
    new_doc = pdfium.PdfDocument.new()
    new_doc.import_pages(src, pages=[page_idx])
    buf = io.BytesIO()
    new_doc.save(buf)
    return buf.getvalue()


def _pdfium_text(src_path: str, page_idx: int) -> str:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(src_path)
    page = doc[page_idx]
    textpage = page.get_textpage()
    raw = textpage.get_text_range().strip()
    if not raw:
        return ""
    cleaned = [ln.strip() for ln in raw.splitlines()
               if ln.strip() and not _is_noise(ln.strip())]
    return "\n".join(cleaned)


# ── Document AI block → Markdown ───────────────────────────────────────────────

def _cell_text(cell) -> str:
    parts = []
    for blk in cell.blocks:
        t = blk.text_block.text.strip()
        if t:
            parts.append(t)
    return " ".join(parts).replace("\n", " ").replace("|", "\\|")


def _compact_docai_rows(rows: list[list[str]], ncols: int) -> list[list[str]]:
    """
    Compact Document AI body rows before serialising to Markdown.

    Document AI represents long table cells as several consecutive rows where
    only one (or a subset of non-label) columns carries content.  This function:
      - Drops fully-empty rows (blank separators).
      - Merges single-column continuation rows into the corresponding column of
        the preceding row.
      - Merges multi-column rows where the label/last column is empty into the
        preceding row (original behaviour for left-overflow patterns).
    """
    result: list[list[str]] = []
    for row in rows:
        r = (list(row) + [""] * ncols)[:ncols]
        if not any(c.strip() for c in r):           # all-empty → drop
            continue
        nonempty   = [(i, c) for i, c in enumerate(r) if c.strip()]
        last_empty = not r[-1].strip()
        has_other  = any(c.strip() for c in r[:-1])
        if result and len(nonempty) == 1:            # single-column → continuation
            col, val = nonempty[0]
            prev = list(result[-1])
            prev[col] = (prev[col] + " " + val.strip()).strip() if prev[col] else val.strip()
            result[-1] = prev
        elif result and last_empty and has_other:    # multi-column left-overflow
            prev   = result[-1]
            merged = [
                (prev[i] + " " + r[i]).strip() if r[i].strip() and prev[i].strip()
                else r[i].strip() or prev[i]
                for i in range(ncols)
            ]
            result[-1] = merged
        else:
            result.append(r)
    return result


def _table_to_md(tbl) -> str:
    header_rows = list(tbl.header_rows)
    body_rows   = list(tbl.body_rows)
    all_rows    = header_rows + body_rows
    if not all_rows:
        return ""
    rows  = [[_cell_text(c) for c in row.cells] for row in all_rows]
    ncols = max(len(r) for r in rows)
    if ncols == 0:
        return ""
    rows = [r + [""] * (ncols - len(r)) for r in rows]

    # Compact body rows only (header rows are never continuation rows)
    n_hdr = len(header_rows)
    body  = _compact_docai_rows(rows[n_hdr:], ncols)
    rows  = rows[:n_hdr] + body
    if not rows:
        return ""

    lines = [
        "| " + " | ".join(rows[0])        + " |",
        "| " + " | ".join(["---"] * ncols) + " |",
    ]
    for r in rows[1:]:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def _block_to_md(blk) -> str:
    tb  = blk.text_block
    tbl = blk.table_block
    lb  = blk.list_block

    if tbl.body_rows or tbl.header_rows:
        return _table_to_md(tbl)

    if lb.list_entries:
        items = []
        for entry in lb.list_entries:
            t = entry.text_block.text.strip() if entry.text_block else ""
            if t:
                items.append(f"- {t}")
        return "\n".join(items)

    text = tb.text.strip()
    if not text or _is_noise(text):
        return ""
    btype = (tb.type_ or "").lower()
    if btype == "header":
        return ""
    if btype in ("heading-1", "title"):
        return f"# {text}"
    if btype == "heading-2":
        return f"## {text}"
    if btype == "heading-3":
        return f"### {text}"
    if btype in ("heading-4", "heading-5", "heading-6"):
        return f"#### {text}"
    return text


# ── Document AI page processing ────────────────────────────────────────────────

def _process_page_docai(client, proc_name: str, page_pdf: bytes) -> tuple[str, bool]:
    from google.cloud import documentai_v1 as documentai
    req = documentai.ProcessRequest(
        name=proc_name,
        raw_document=documentai.RawDocument(content=page_pdf, mime_type="application/pdf"),
    )
    result = client.process_document(request=req)
    doc = result.document
    if not doc.document_layout or not doc.document_layout.blocks:
        return "", False

    parts     = []
    has_table = False
    for blk in doc.document_layout.blocks:
        if blk.table_block.body_rows or blk.table_block.header_rows:
            has_table = True
        md = _block_to_md(blk)
        if md:
            parts.append(md)
    return "\n\n".join(parts), has_table


def _get_or_create_processor(client, parent: str) -> str:
    existing     = list(client.list_processors(parent=parent))
    layout_procs = [p for p in existing if p.type_ == "LAYOUT_PARSER_PROCESSOR"]
    if layout_procs:
        return layout_procs[0].name
    from google.cloud import documentai_v1 as documentai
    proc = client.create_processor(
        parent=parent,
        processor=documentai.Processor(
            display_name="stratos-layout-parser",
            type_="LAYOUT_PARSER_PROCESSOR",
        ),
    )
    return proc.name



# ── Table helpers (cross-page) ─────────────────────────────────────────────────

_MD_TABLE_BLOCK_RE = re.compile(
    r"(?m)^(\|[^\n]+\|\n\|(?:[ \t]*[-:]+[ \t]*\|)+\n(?:\|[^\n]*\|\n?)*)"
)


def _compact_md_table(block: str) -> str:
    """
    Compact a single Markdown table string.
    Drops all-empty rows; merges continuation rows (last column empty,
    other columns have content) into the preceding row.
    """
    lines = block.strip().splitlines()
    if len(lines) < 2 or "---" not in lines[1]:
        return block

    header, sep, body_lines = lines[0], lines[1], lines[2:]

    def _parse(line: str) -> list[str]:
        return [c.strip() for c in line.replace("\\|", "\x00").split("|")[1:-1]]

    def _fmt(cells: list[str]) -> str:
        return "| " + " | ".join(c.replace("\x00", "\\|") for c in cells) + " |"

    ncols = len(_parse(header))
    if ncols == 0:
        return block

    compacted: list[list[str]] = []
    for line in body_lines:
        if not line.strip().startswith("|"):
            continue
        cells = (_parse(line) + [""] * ncols)[:ncols]
        if not any(c for c in cells):           # all-empty → drop
            continue
        nonempty   = [(i, c) for i, c in enumerate(cells) if c]
        last_empty = not cells[-1]
        has_other  = any(cells[:-1])
        if compacted and len(nonempty) == 1:    # single-column → continuation
            col, val = nonempty[0]
            prev = list(compacted[-1])
            prev[col] = (prev[col] + " " + val).strip() if prev[col] else val
            compacted[-1] = prev
        elif compacted and last_empty and has_other:  # multi-column left-overflow
            prev   = compacted[-1]
            merged = [
                (prev[i] + " " + cells[i]).strip() if cells[i] and prev[i]
                else cells[i] or prev[i]
                for i in range(ncols)
            ]
            compacted[-1] = merged
        else:
            compacted.append(cells)

    if not compacted:
        return block
    return "\n".join([header, sep] + [_fmt(r) for r in compacted])


def _compact_section_tables(content: str) -> str:
    """Apply _compact_md_table to every Markdown table in a section's content."""
    return _MD_TABLE_BLOCK_RE.sub(lambda m: _compact_md_table(m.group(0)), content)


_NOISE_ONLY_RE = re.compile(r"^[•·\-–—\s]*$")  # * so empty strings also match


def _merge_adjacent_table(prev: str, nxt: str) -> str:
    """
    Join two consecutive same-section page contents.
    When `prev` ends with a Markdown table row and `nxt` begins with a
    fresh table (header + separator), strip the duplicate header/separator
    from `nxt` so they render as one continuous table.
    """
    # Strip trailing --- separators (page-boundary artefacts in .md files)
    prev_core = re.sub(r"\n*\n---+\s*$", "", prev.rstrip()).rstrip()
    nxt_core  = nxt.strip()

    prev_lines = prev_core.splitlines()
    # Remove trailing noise lines (lone bullet •, dash, blank) that pages
    # sometimes end with after a table — they would block adjacency detection
    while prev_lines and _NOISE_ONLY_RE.match(prev_lines[-1]):
        prev_lines.pop()
    prev_trimmed = "\n".join(prev_lines).rstrip()

    nxt_lines  = nxt_core.splitlines()

    if not prev_lines or not nxt_lines:
        return prev + "\n\n" + nxt

    # prev must end with a table data row
    if not prev_lines[-1].strip().startswith("|"):
        return prev_trimmed + "\n\n" + nxt_core

    # Locate where table starts in nxt (may be preceded by heading text)
    tbl_start = next(
        (i for i, ln in enumerate(nxt_lines) if ln.strip().startswith("|")), None
    )
    if tbl_start is None:
        return prev_trimmed + "\n\n" + nxt_core

    # Is it a fresh table? (header row followed by separator)
    if tbl_start + 1 >= len(nxt_lines):
        return prev_trimmed + "\n\n" + nxt_core
    sep_line = nxt_lines[tbl_start + 1].strip()
    if not (sep_line.startswith("|") and "---" in sep_line):
        # Not a fresh table — just join from table start
        prefix = "\n".join(nxt_lines[:tbl_start]).strip()
        body   = "\n".join(nxt_lines[tbl_start:])
        return prev_trimmed + ("\n\n" + prefix if prefix else "") + "\n" + body

    # Fresh table: skip header + separator rows
    prefix     = "\n".join(nxt_lines[:tbl_start]).strip()
    body_lines = nxt_lines[tbl_start + 2:]
    # Strip trailing noise (blank lines, •, ---) so the next merge can detect
    # table-adjacency without being fooled by page-end OCR artefacts
    while body_lines and _NOISE_ONLY_RE.match(body_lines[-1]):
        body_lines.pop()

    parts = [prev_trimmed]
    if prefix:
        parts.append("\n\n" + prefix)
    if body_lines:
        parts.append("\n" + "\n".join(body_lines))
    return "".join(parts)


# ── Section grouping ───────────────────────────────────────────────────────────

def _group_into_sections(page_results: list[dict]) -> list[dict]:
    """Merge consecutive pages with the same section_key into one block."""
    if not page_results:
        return []

    sections = []
    first    = page_results[0]
    current  = {
        "section_key":  first["section_key"],
        "section_type": first["section_type"],
        "title_ar":     first["title_ar"],
        "page_start":   first["page_num"],
        "page_end":     first["page_num"],
        "content":      first["text"],
    }

    for page in page_results[1:]:
        if page["section_key"] == current["section_key"]:
            current["page_end"] = page["page_num"]
            if page["text"]:
                current["content"] = _merge_adjacent_table(
                    current["content"], page["text"]
                )
        else:
            sections.append(current)
            current = {
                "section_key":  page["section_key"],
                "section_type": page["section_type"],
                "title_ar":     page["title_ar"],
                "page_start":   page["page_num"],
                "page_end":     page["page_num"],
                "content":      page["text"],
            }

    sections.append(current)
    # Compact continuation rows in every section's table content
    for sec in sections:
        sec["content"] = _compact_section_tables(sec["content"])
    return sections


# ── Unknown-page resolution ────────────────────────────────────────────────────

def _resolve_unknown_pages(page_results: list[dict]) -> list[dict]:
    """
    Second pass to fix 'unknown' page classifications:

    1. Sandwich rule  — unknown between two identical known sections → inherit.
    2. Table rule     — unknown after a dynamic section with table content → inherit.
    3. Forward rule   — any remaining unknown inherits the previous known section
                        (handles chapter-divider pages and sub-header pages).
    """
    if not page_results:
        return page_results

    result = [dict(p) for p in page_results]
    n = len(result)

    def _inherit(i: int, src: dict) -> None:
        result[i]["section_key"]  = src["section_key"]
        result[i]["section_type"] = src["section_type"]
        result[i]["title_ar"]     = src["title_ar"]

    # Pass 1: sandwich
    for i in range(1, n - 1):
        if result[i]["section_key"] == "unknown":
            prev_key = result[i - 1]["section_key"]
            next_key = result[i + 1]["section_key"]
            if prev_key != "unknown" and prev_key == next_key:
                _inherit(i, result[i - 1])

    # Pass 2: table continuation
    for i in range(1, n):
        if result[i]["section_key"] == "unknown":
            prev = result[i - 1]
            if prev["section_key"] == "unknown":
                continue
            if prev["section_type"] == "dynamic" and result[i]["text"].count("|") >= 4:
                _inherit(i, prev)

    # Pass 3: forward inherit
    for i in range(1, n):
        if result[i]["section_key"] == "unknown":
            prev = result[i - 1]
            if prev["section_key"] != "unknown":
                _inherit(i, prev)

    return result


# ── pypdfium2-only extraction (no Document AI) ─────────────────────────────────

def _run_pdfium_only(pdf_path: str) -> tuple[list[dict], dict]:
    """Extract all pages using pypdfium2 only. Returns (page_results, stats)."""
    import pypdfium2 as pdfium
    pdf_doc      = pdfium.PdfDocument(pdf_path)
    total        = len(pdf_doc)
    stats        = {"docai": 0, "hybrid": 0, "fallback": 0, "empty": 0}
    page_results = []

    for i in range(total):
        page_num = i + 1
        try:
            final_text = _pdfium_text(pdf_path, i)
            if final_text:
                stats["fallback"] += 1
            else:
                stats["empty"] += 1
        except Exception as exc:
            print(f"[ocr-agent] pdfium page {page_num} error: {exc}")
            final_text = ""
            stats["empty"] += 1

        section_key, section_type, title_ar = _classify_page(final_text, page_num)
        page_results.append({
            "page_num":     page_num,
            "section_key":  section_key,
            "section_type": section_type,
            "title_ar":     title_ar,
            "text":         final_text,
        })
        print(f"  Page {page_num:3d}/{total}  [{section_type:7s}] {section_key}")

    page_results = _resolve_unknown_pages(page_results)
    return page_results, stats


# ── Markdown-file parser (test / dev mode — no API costs) ─────────────────────

_PAGE_MARKER_RE = re.compile(r"<!--\s*Page\s*(\d+)\s*-->", re.IGNORECASE)


def parse_extracted_md(md_content: str, filename: str = "extracted.md") -> dict:
    """
    Parse a pre-extracted markdown file.

    Accepts two formats:
      1. Files with <!-- Page N --> markers (produced by extract_pdf.py / compile_and_run).
      2. Continuous markdown with --- section dividers (no page markers).
         YAML frontmatter (--- ... ---) is stripped before splitting.

    Classifies each chunk with the same rules as compile_and_run(), then groups
    into sections.  No PDF, no Document AI, no pypdfium2 — purely text processing.

    Returns the same dict shape as compile_and_run() with mode='md_parse'.
    """
    upload_id = str(uuid.uuid4())

    parts = _PAGE_MARKER_RE.split(md_content)
    # parts = [pre_text, "N", page_text, "N", page_text, ...]

    # Fallback: no <!-- Page N --> markers — split by --- dividers instead
    if len(parts) <= 1:
        body = md_content.strip()
        # Strip YAML frontmatter (--- ... ---)
        if body.startswith('---'):
            end_fm = body.find('\n---', 3)
            if end_fm != -1:
                body = body[end_fm + 4:].lstrip('\n')
        chunks = [c.strip() for c in re.split(r'\n\s*---+\s*\n', body) if c.strip()]
        parts = ['']  # placeholder for pre_text
        for idx, chunk in enumerate(chunks, start=1):
            parts.append(str(idx))
            parts.append(chunk)
        print(f"[ocr-agent] No page markers found — split into {len(chunks)} chunks by --- dividers")

    page_results: list[dict] = []
    total = 0
    i = 1
    while i + 1 < len(parts):
        page_num  = int(parts[i])
        page_text = parts[i + 1].strip()
        total     = max(total, page_num)

        section_key, section_type, title_ar = _classify_page(page_text, page_num)
        page_results.append({
            "page_num":     page_num,
            "section_key":  section_key,
            "section_type": section_type,
            "title_ar":     title_ar,
            "text":         page_text,
        })
        print(f"  Page {page_num:3d}/{total}  [{section_type:7s}] {section_key}")
        i += 2

    page_results.sort(key=lambda p: p["page_num"])
    page_results = _resolve_unknown_pages(page_results)
    sections     = _group_into_sections(page_results)

    nonempty = sum(1 for p in page_results if p["text"])
    stats = {"docai": 0, "hybrid": 0, "fallback": nonempty, "empty": total - nonempty}

    raw_content_md = "\n\n---\n\n".join(
        f"<!-- Page {p['page_num']} -->\n{p['text']}"
        for p in page_results
    )

    print(f"[ocr-agent] MD parse done — {len(sections)} sections from {total} pages")
    return {
        "upload_id":      upload_id,
        "filename":       filename,
        "sections":       sections,
        "total_pages":    total,
        "mode":           "md_parse",
        "stats":          stats,
        "raw_content_md": raw_content_md,
    }


# ── Main entry point ───────────────────────────────────────────────────────────

def compile_and_run(pdf_path: str) -> dict:
    """
    Extract and classify sections from an Arabic strategic plan PDF.

    Extraction priority:
      1. Google Document AI Layout Parser (primary — structured layout + table support)
      2. pypdfium2 text layer (fallback, no API required)

    Returns:
      {
        "upload_id":   str (UUID),
        "filename":    str,
        "sections":    [{ section_key, section_type, title_ar, content,
                          page_start, page_end }, ...],
        "total_pages": int,
        "mode":        "docai+pdfium" | "pdfium_only",
        "stats":       { "docai": int, "hybrid": int, "fallback": int, "empty": int }
      }
    """
    import pypdfium2 as pdfium

    upload_id = str(uuid.uuid4())
    filename  = os.path.basename(pdf_path)

    pdf_doc = pdfium.PdfDocument(pdf_path)
    total   = len(pdf_doc)
    print(f"[ocr-agent] Processing {filename} — {total} pages")

    # ── 1. Try Document AI (primary) ─────────────────────────────────────────
    docai_available = False
    client = proc_name = None
    try:
        from google.cloud import documentai_v1 as documentai
        from google.api_core.client_options import ClientOptions
        opts      = ClientOptions(api_endpoint=f"{LOCATION}-documentai.googleapis.com")
        client    = documentai.DocumentProcessorServiceClient(client_options=opts)
        parent    = client.common_location_path(PROJECT_ID, LOCATION)
        proc_name = _get_or_create_processor(client, parent)
        docai_available = True
        print(f"[ocr-agent] Document AI ready — processor: {proc_name}")
    except Exception as exc:
        print(f"[ocr-agent] Document AI unavailable ({exc.__class__.__name__}: {exc})")
        print("[ocr-agent] Falling back to pypdfium2-only mode")

    # ── 2. Extract pages ──────────────────────────────────────────────────────
    if not docai_available:
        page_results, stats = _run_pdfium_only(pdf_path)
        mode = "pdfium_only"
    else:
        stats        = {"docai": 0, "hybrid": 0, "fallback": 0, "empty": 0}
        page_results = []
        mode         = "docai+pdfium"

        for i in range(total):
            page_num   = i + 1
            final_text = ""
            try:
                page_pdf              = _extract_page_as_pdf(pdf_path, i)
                docai_text, has_table = _process_page_docai(client, proc_name, page_pdf)
                docai_chars           = len(docai_text.strip())
                if (has_table and docai_chars > 0) or docai_chars >= FALLBACK_THRESHOLD:
                    final_text = docai_text
                    stats["docai"] += 1
                else:
                    pdfium_raw   = _pdfium_text(pdf_path, i)
                    pdfium_chars = len(pdfium_raw)
                    if pdfium_chars > max(docai_chars * 2, docai_chars + 200):
                        headings = "\n".join(
                            ln for ln in docai_text.splitlines() if ln.startswith("#")
                        )
                        final_text = (headings + "\n\n" + pdfium_raw) if headings else pdfium_raw
                        stats["hybrid" if headings else "fallback"] += 1
                    elif docai_chars > 0:
                        final_text = docai_text
                        stats["docai"] += 1
                    elif pdfium_raw:
                        final_text = pdfium_raw
                        stats["fallback"] += 1
                    else:
                        stats["empty"] += 1
            except Exception as exc:
                print(f"[ocr-agent] Page {page_num} DocAI error: {exc}")
                try:
                    final_text = _pdfium_text(pdf_path, i)
                    stats["fallback"] += 1
                except Exception:
                    stats["empty"] += 1

            section_key, section_type, title_ar = _classify_page(final_text, page_num)
            page_results.append({
                "page_num":     page_num,
                "section_key":  section_key,
                "section_type": section_type,
                "title_ar":     title_ar,
                "text":         final_text,
            })
            print(f"  Page {page_num:3d}/{total}  [{section_type:7s}] {section_key}")
            if page_num % 10 == 0:
                time.sleep(1)

        page_results = _resolve_unknown_pages(page_results)

    sections = _group_into_sections(page_results)
    print(f"[ocr-agent] Done — {len(sections)} sections identified (mode: {mode})")

    raw_content_md = "\n\n---\n\n".join(
        f"<!-- Page {p['page_num']} -->\n{p['text']}"
        for p in page_results
    )

    return {
        "upload_id":      upload_id,
        "filename":       filename,
        "sections":       sections,
        "total_pages":    total,
        "mode":           mode,
        "stats":          stats,
        "raw_content_md": raw_content_md,
    }
