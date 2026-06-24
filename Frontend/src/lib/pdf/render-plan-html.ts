/**
 * Converts a PlanDocument into a complete, self-contained HTML string that
 * Playwright can load directly via page.setContent().
 *
 * Layout contract (must match the values used in the API route):
 *   A4 height   = 297 mm  = 1122.52 px @ 96 dpi
 *   top margin  = 1.0 in  =   96.00 px  ← 0.70in header band + 0.30in gap
 *   bot margin  = 0.6 in  =   57.60 px  ← page numbers + safety buffer
 *   content H   =  968.92 px            ← A4_CONTENT_H
 *
 * Two-pass strategy for accurate TOC numbers
 * ------------------------------------------
 * Pass 1  renderPlanHtml(doc, {})              → load → measure DOM
 * Pass 2  renderPlanHtml(doc, measuredNumbers) → load → page.pdf()
 *
 * DOM structure used by the measurement script in the API route:
 *   .pdf-block.pdf-fixed-page   [data-section-id]   → exactly 1 PDF page
 *   .pdf-block.pdf-content-block                    → variable pages
 *     [data-section-id] inside                      → sub-page position
 */

import type {
  PlanDocument, PlanMeta, Chapter, Subchapter,
  Block, ParagraphBlock, ListBlock, TableBlock, ImageBlock, RichText,
} from '@/types/plan-document'

// ── Layout constants ──────────────────────────────────────────────────────────

/** A4 printable content height in CSS px (96 px/in, margins subtracted). */
export const A4_CONTENT_H = (297 / 25.4) * 96 - 1.0 * 96 - 0.6 * 96
// = 1122.52 − 96.0 − 57.6 = 968.92 px

// ── Tiny HTML helpers ─────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pad2(n: number) { return String(n).padStart(2, '0') }

// ── ProseMirror JSON → HTML ───────────────────────────────────────────────────

function richToHtml(node: RichText | null | undefined): string {
  if (!node) return ''
  if (node.type === 'doc')
    return (node.content ?? []).map(richToHtml).join('')
  if (node.type === 'paragraph') {
    const inner = (node.content ?? []).map(richToHtml).join('')
    return `<p style="margin:0 0 0.5rem">${inner || '&nbsp;'}</p>`
  }
  if (node.type === 'bulletList') {
    const items = (node.content ?? []).map(richToHtml).join('')
    return `<ul style="list-style-type:disc;padding-left:1.25rem;margin:0.25rem 0 0.25rem">${items}</ul>`
  }
  if (node.type === 'listItem') {
    const inner = (node.content ?? []).map(richToHtml).join('')
    return `<li style="margin-bottom:0.3rem;line-height:1.5">${inner}</li>`
  }
  if (node.type === 'text') {
    let t = esc(node.text ?? '')
    for (const m of node.marks ?? []) {
      if (m.type === 'bold')   t = `<strong>${t}</strong>`
      if (m.type === 'italic') t = `<em>${t}</em>`
    }
    return t
  }
  return (node.content ?? []).map(richToHtml).join('')
}

// ── Block renderers ───────────────────────────────────────────────────────────

function renderBlock(b: Block): string {
  switch (b.type) {

    case 'paragraph':
      return `<div style="margin-bottom:1rem;font-family:Georgia,'Times New Roman',serif;font-size:1rem;line-height:1.75;color:#334155;break-inside:avoid;page-break-inside:avoid;">
        ${richToHtml((b as ParagraphBlock).content)}
      </div>`

    case 'list': {
      const lb = b as ListBlock
      const tag = lb.ordered ? 'ol' : 'ul'
      const lstyle = lb.ordered ? 'decimal' : 'disc'
      const items = lb.items
        .map(item => `<li style="margin-bottom:0.4rem">${richToHtml(item)}</li>`)
        .join('')
      return `<${tag} style="list-style-type:${lstyle};padding-left:1.5rem;margin:0 0 1rem">
        ${items}
      </${tag}>`
    }

    case 'table': {
      const tb = b as TableBlock
      const colCount = tb.header?.length ?? tb.rows[0]?.length ?? 1

      // First column is always a short label (pillar name, category). Give it
      // the minimum it needs; spread the rest equally across the other columns.
      const firstColPct  = colCount >= 5 ? 14 : colCount >= 3 ? 18 : 50
      const otherColPct  = ((100 - firstColPct) / Math.max(colCount - 1, 1)).toFixed(1)
      const colgroup = `<colgroup>
        ${Array.from({ length: colCount }, (_, i) =>
          i === 0
            ? `<col style="width:${firstColPct}%">`
            : `<col style="width:${otherColPct}%">`
        ).join('')}
      </colgroup>`

      const thead = tb.header
        ? `<thead style="background:#1e293b">
            <tr>${tb.header.map(h =>
              `<th style="padding:.6rem .9rem;text-align:start;font-weight:600;color:#fff;
                          border:1px solid rgba(184,146,47,.3);
                          font-family:Georgia,serif;font-size:.875rem;
                          word-break:break-word;overflow-wrap:anywhere">${esc(h)}</th>`
            ).join('')}</tr>
           </thead>`
        : ''
      const tbody = tb.rows.map((row, ri) => {
        const rowBg = ri % 2 === 1 ? 'background:rgba(184,146,47,.04)' : ''
        const cells = row.map(cell =>
          `<td style="padding:.6rem .9rem;border:1px solid rgba(184,146,47,.15);${rowBg};
                      font-family:Georgia,serif;font-size:.875rem;color:#334155;
                      vertical-align:top;word-break:break-word;overflow-wrap:anywhere">
            ${richToHtml(cell)}
           </td>`
        ).join('')
        return `<tr>${cells}</tr>`
      }).join('')
      const caption = tb.caption
        ? `<p style="margin:.5rem 0 0;text-align:center;font-size:.75rem;font-style:italic;color:#78716c">${esc(tb.caption)}</p>`
        : ''
      return `<div style="margin:1.5rem 0;break-inside:avoid;page-break-inside:avoid;">
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;
                      border:1px solid rgba(184,146,47,.3)">${colgroup}${thead}<tbody>${tbody}</tbody></table>
      </div>${caption}`
    }

    case 'image': {
      const ib = b as ImageBlock
      const maxW = ib.width === 'half' ? 'max-width:50%' : 'max-width:100%'
      const figCap = ib.caption
        ? `<figcaption style="margin-top:.5rem;text-align:center;font-size:.75rem;font-style:italic;color:#78716c">${esc(ib.caption)}</figcaption>`
        : ''
      return `<figure style="margin:1.5rem auto;${maxW}">
        <img src="${esc(ib.url)}" alt="${esc(ib.alt)}"
             style="width:100%;height:auto;border-radius:.5rem;display:block">
        ${figCap}
      </figure>`
    }
  }
}

function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join('')
}

// ── Page sections ─────────────────────────────────────────────────────────────

function coverPage(meta: PlanMeta): string {
  const logo = meta.orgLogoUrl
    ? `<img src="${esc(meta.orgLogoUrl)}" alt="${esc(meta.orgName)}"
            style="width:26rem;max-width:88%;height:auto;object-fit:contain">`
    : `<div style="width:6rem;height:6rem;background:linear-gradient(135deg,#1e293b,#0f172a);
                   border-radius:.75rem;display:flex;align-items:center;justify-content:center;
                   color:#fff;font-size:2rem;font-weight:700;border:2px solid #b8922f">
         ${esc(meta.orgName.charAt(0).toUpperCase())}
       </div>`

  const period = meta.periodLabel
    ? `<p style="margin:0;font-family:Georgia,serif;font-size:1.75rem;color:#b8922f;
                 font-weight:600;letter-spacing:.05em">${esc(meta.periodLabel)}</p>`
    : ''

  return `
<div class="pdf-block pdf-fixed-page" id="cover-page">
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
              height:100%;padding:2rem;position:relative;overflow:hidden">
    <div style="position:absolute;top:2rem;left:3rem;font-size:5rem;color:#b8922f;
                opacity:.05;font-family:Georgia,serif">◆</div>
    <div style="position:absolute;bottom:4rem;right:3rem;font-size:5rem;color:#b8922f;
                opacity:.05;font-family:Georgia,serif">◆</div>
    <div style="max-width:36rem;text-align:center;display:flex;flex-direction:column;
                gap:3rem;align-items:center;position:relative;z-index:1">
      <div style="display:flex;flex-direction:column;align-items:center;gap:1.25rem">
        ${logo}
      </div>
      <div style="display:flex;flex-direction:column;gap:1rem;align-items:center">
        <h1 style="margin:0;font-family:Georgia,serif;font-size:3.5rem;font-weight:700;
                   color:#0f172a;line-height:1.1">${esc(meta.title)}</h1>
        ${period}
      </div>
      <div style="display:flex;align-items:center;gap:1rem;width:100%;justify-content:center">
        <div style="height:2px;width:4rem;background:linear-gradient(to right,#b8922f,rgba(184,146,47,0))"></div>
        <span style="font-size:1.5rem;color:#b8922f">◆</span>
        <div style="height:2px;width:4rem;background:linear-gradient(to left,#b8922f,rgba(184,146,47,0))"></div>
      </div>
    </div>
  </div>
</div>`
}

function tocPage(doc: PlanDocument, pageNumbers: Record<string, number>): string {
  const title = doc.language === 'ar' ? 'المحتويات' : 'Table of Contents'

  const entries = doc.chapters.map(ch => {
    const chPg = pageNumbers[ch.id] ?? '—'
    const chRow = `
      <div style="display:flex;align-items:baseline;gap:1rem;margin-bottom:.75rem">
        <span style="font-family:Georgia,serif;font-size:1.25rem;font-weight:700;color:#b8922f;
                     flex-shrink:0;min-width:2.5rem">${pad2(ch.number)}</span>
        <span style="flex:1;font-family:Georgia,serif;font-size:1.1rem;font-weight:700;color:#0f172a;
                     border-bottom:1px dotted #94918a;padding-bottom:2px">${esc(ch.title)}</span>
        <span style="font-family:Georgia,serif;font-size:1rem;font-weight:600;color:#334155;
                     flex-shrink:0;padding-left:.5rem">${chPg}</span>
      </div>`

    const subRows = ch.sections.map((sub, idx) => {
      const subPg = pageNumbers[sub.id] ?? '—'
      return `
        <div style="display:flex;align-items:baseline;gap:1rem;margin-bottom:.5rem;padding-left:3.5rem">
          <span style="font-family:Georgia,serif;font-size:.9rem;color:#78716c;
                       flex-shrink:0;min-width:2.5rem">${ch.number}.${idx + 1}</span>
          <span style="flex:1;font-family:Georgia,serif;font-size:.9rem;color:#334155;
                       border-bottom:1px dotted #c8c5bc;padding-bottom:2px">${esc(sub.heading)}</span>
          <span style="font-family:Georgia,serif;font-size:.875rem;color:#78716c;
                       flex-shrink:0;padding-left:.5rem">${subPg}</span>
        </div>`
    }).join('')

    return chRow + subRows + '<div style="height:.5rem"></div>'
  }).join('')

  return `
<div class="pdf-block pdf-fixed-page" id="toc-page">
  <div style="padding:2.5rem 0.85in;height:100%;overflow:hidden;position:relative">
    <div style="position:absolute;top:0;right:0;width:10rem;height:10rem;
                border-right:2px solid #b8922f;border-top:2px solid #b8922f;opacity:.1"></div>
    <div style="position:absolute;bottom:0;left:0;width:10rem;height:10rem;
                border-left:2px solid #b8922f;border-bottom:2px solid #b8922f;opacity:.1"></div>
    <div style="margin-bottom:2.5rem;padding-bottom:1.5rem;border-bottom:2px solid #b8922f">
      <div style="display:flex;align-items:center;gap:1rem">
        <div style="height:6px;width:3rem;background:linear-gradient(to right,#1e293b,#b8922f)"></div>
        <h2 style="margin:0;font-family:Georgia,serif;font-size:2.5rem;font-weight:700;
                   color:#0f172a">${title}</h2>
      </div>
    </div>
    <div>${entries}</div>
  </div>
</div>`
}

function chapterCover(ch: Chapter): string {
  const words = ch.title.split(' ')
  const half  = Math.ceil(words.length / 2)
  const line1 = esc(words.slice(0, half).join(' '))
  const line2 = words.length > 1 ? esc(words.slice(half).join(' ')) : ''

  return `
<div class="pdf-block pdf-fixed-page pdf-chapter-cover"
     id="${esc(ch.id)}" data-section-id="${esc(ch.id)}">
  <div style="height:100%;display:flex;flex-direction:column;align-items:flex-start;
              justify-content:center;position:relative;overflow:hidden">
    <div style="position:absolute;top:0;right:0;width:12rem;height:12rem;
                border-right:4px solid #b8922f;border-top:4px solid #b8922f;opacity:.12"></div>
    <div style="position:absolute;bottom:0;left:0;width:12rem;height:12rem;
                border-left:4px solid #b8922f;border-bottom:4px solid #b8922f;opacity:.12"></div>
    <div style="position:relative;z-index:1;width:78%;align-self:flex-start">
      <div style="background:linear-gradient(135deg,#1e293b,#0f172a);
                  border-radius:0 1.75rem 1.75rem 0;padding:4rem 3.5rem;
                  border-left:6px solid #b8922f;box-shadow:0 20px 60px rgba(0,0,0,.25);
                  position:relative;overflow:hidden">
        <div style="position:absolute;top:0;right:0;font-size:5rem;color:#b8922f;
                    opacity:.05;font-family:Georgia,serif;line-height:1">◆</div>
        <div style="position:absolute;top:0;left:0;right:0;height:3px;
                    background:linear-gradient(to right,#b8922f,transparent)"></div>
        <div style="display:flex;flex-direction:column;gap:1.5rem;position:relative;z-index:2">
          <span style="font-family:Georgia,serif;font-size:5rem;font-weight:700;
                       color:#fff;line-height:1">${pad2(ch.number)}</span>
          <div style="display:flex;align-items:center;gap:.5rem">
            <div style="height:2px;width:3rem;background:#b8922f"></div>
            <span style="color:#b8922f;font-size:1rem">◆</span>
          </div>
          <div>
            <h2 style="margin:0 0 .25rem;font-family:Georgia,serif;font-size:2.5rem;
                       font-weight:700;color:#fff;line-height:1.15">${line1}</h2>
            ${line2 ? `<h3 style="margin:0;font-family:Georgia,serif;font-size:2rem;
                                  font-weight:700;color:#b8922f;line-height:1.15">${line2}</h3>` : ''}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`
}

function subchapterSection(sub: Subchapter, chNum: number, idx: number): string {
  // Keep the heading + divider glued to the first block so a page break can
  // never leave a heading stranded at the bottom of a page. The remaining
  // blocks flow normally.
  const [firstBlock, ...restBlocks] = sub.blocks
  const heading = `
  <div style="margin-bottom:1.5rem;display:flex;align-items:baseline;gap:1rem">
    <div style="height:6px;width:2rem;flex-shrink:0;margin-top:.5rem;
                background:linear-gradient(to right,#1e293b,#b8922f)"></div>
    <h3 style="margin:0;font-family:Georgia,serif;font-size:1.5rem;
               font-weight:600;color:#0f172a">
      <span style="color:#b8922f;margin-right:.5rem">${chNum}.${idx + 1}</span>${esc(sub.heading)}
    </h3>
  </div>
  <div style="height:1px;background:linear-gradient(to right,#b8922f,transparent);
              margin-bottom:1.5rem"></div>`

  return `
<div id="${esc(sub.id)}" data-section-id="${esc(sub.id)}"
     style="margin-bottom:2.5rem">
  <div class="keep-together">
    ${heading}
    ${firstBlock ? renderBlock(firstBlock) : ''}
  </div>
  ${restBlocks.length ? renderBlocks(restBlocks) : ''}
</div>`
}

function prefaceSection(sub: Subchapter): string {
  const align = sub.textAlign ?? 'start'
  return `
<div id="${esc(sub.id)}" style="margin-bottom:2.5rem;text-align:${align}">
  <div style="margin-bottom:1.25rem">
    <h3 style="margin:0;font-family:Georgia,serif;font-size:1.4rem;font-weight:600;color:#0f172a">${esc(sub.heading)}</h3>
  </div>
  <div style="height:1px;background:linear-gradient(to right,#b8922f,transparent);margin-bottom:1.5rem"></div>
  ${renderBlocks(sub.blocks)}
</div>`
}

function chapterContent(ch: Chapter): string {
  const intro = ch.intro && ch.intro.length > 0
    ? `<div style="margin-bottom:2rem">${renderBlocks(ch.intro)}</div>`
    : ''
  const sections = ch.sections
    .map((sub, idx) => subchapterSection(sub, ch.number, idx))
    .join('')

  return `
<div class="pdf-block pdf-content-block">
  ${intro}${sections}
</div>`
}

// ── CSS ───────────────────────────────────────────────────────────────────────

function inlineCSS(isRtl: boolean): string {
  const H = A4_CONTENT_H
  return `
*,*::before,*::after {
  box-sizing:border-box;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
html,body {
  margin:0;padding:0;
  background:#f5f4ef;
  font-family:Georgia,'Times New Roman',serif;
  color:#334155;
  color-scheme:light;
}
strong { font-weight:700 }
em     { font-style:italic }
img    { max-width:100% }
table  { border-collapse:collapse }

/* ── Page-break behaviour for flowing content ──
   Every content unit gets break-inside:avoid so Chromium moves the whole
   element to the next page rather than shearing it mid-content.
   - p: covers standalone paragraphs AND richText <p> tags inside table cells
   - tr: row cannot be split (large tables fall back to breaking between rows)
   - li: list items stay whole
   - figure: images + captions stay together
   - div block wrappers get it inline (see renderBlock)
   thead repeats the header row on every page a table spans. */
tr, li, figure, p { break-inside:avoid; page-break-inside:avoid; }
thead              { display:table-header-group; }
.keep-together     { break-inside:avoid; page-break-inside:avoid; }

/* ── Fixed-page blocks (cover, TOC, chapter covers) ── */
.pdf-block {
  width:100%;
  background:#f5f4ef;
}
.pdf-fixed-page {
  height:${H}px;
  overflow:hidden;
}
/* ── Flowing content blocks (chapter bodies) ── */
.pdf-content-block {
  padding:1.25rem 0.45in 0.8in;
  max-width:8.5in;
  margin:0 auto;
}

${isRtl ? `
.pdf-content-block,
.pdf-content-block * {
  font-family:'Cairo','Amiri',Georgia,serif;
}` : ''}

/* ── @page: paint the full A4 canvas (paper + margin zones) ── */
@page {
  background-color:#f5f4ef;
}

/* ── Print media ── */
@media print {
  html,body { background:#f5f4ef !important; }

  /* Each fixed page becomes exactly one PDF page */
  .pdf-fixed-page {
    page-break-after:always;
    page-break-inside:avoid;
  }
  /* Chapter covers must also start on a fresh page (handles ch2+) */
  .pdf-chapter-cover {
    page-break-before:always;
  }
}
`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a self-contained HTML document for Playwright.
 *
 * @param doc          The plan document to render
 * @param pageNumbers  TOC mapping: sectionId → 1-based page number.
 *                     Pass {} for pass-1 (measurement); pass the measured
 *                     values for pass-2 (final PDF).
 */
export function renderPlanHtml(
  doc: PlanDocument,
  pageNumbers: Record<string, number> = {},
): string {
  const isRtl = doc.dir === 'rtl'
  const arabicFont = isRtl
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
       <link rel="stylesheet"
             href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap">`
    : ''

  const chapters = doc.chapters
    .map(ch => chapterCover(ch) + chapterContent(ch))
    .join('\n')

  // Preface sections (before chapter 1): rendered in the body, but NOT in the TOC.
  const prefaceHtml = doc.preface && doc.preface.length > 0
    ? `<div class="pdf-content-block">${doc.preface.map(prefaceSection).join('')}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="${esc(doc.language)}" dir="${esc(doc.dir)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${arabicFont}
<title>${esc(doc.meta.title)}</title>
<style>${inlineCSS(isRtl)}</style>
</head>
<body>
${coverPage(doc.meta)}
${tocPage(doc, pageNumbers)}
${prefaceHtml}
${chapters}
</body>
</html>`
}
