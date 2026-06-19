/**
 * POST /api/plan-generation/export-pdf
 *
 * Body: PlanDocument (JSON)
 * Returns: application/pdf  (attachment)
 *
 * Two-pass rendering for accurate TOC page numbers
 * ─────────────────────────────────────────────────
 * Pass 1 – load HTML, measure where each chapter / section lands in the DOM.
 *          The DOM is structured so fixed-height pages (cover, TOC, chapter
 *          covers) each take exactly A4_CONTENT_H px and content blocks flow
 *          continuously.  Dividing offsets by A4_CONTENT_H gives the PDF page.
 *
 * Pass 2 – rebuild the HTML with the measured page numbers injected into the
 *          TOC, then call page.pdf() to produce the final file.
 *
 * Running header  → Playwright headerTemplate (org logo + org name)
 * Page numbers    → Playwright footerTemplate (<span class="pageNumber">)
 * Creamy BG       → @page { background-color } + printBackground:true
 *
 * Setup (one-time, run from Frontend/):
 *   npm install -D playwright
 *   npx playwright install chromium
 */

import { NextRequest, NextResponse } from 'next/server'
import { chromium } from 'playwright'
import type { PlanDocument, ImageBlock } from '@/types/plan-document'
import { renderPlanHtml, A4_CONTENT_H } from '@/lib/pdf/render-plan-html'

// ── Image URL → Base64 data URI ───────────────────────────────────────────────
//
// Playwright's setContent() renders a standalone HTML string with no base URL.
// Relative paths (/logo.png) and even some absolute URLs fail to load in the
// headerTemplate's isolated context.  Embedding everything as data URIs is the
// only strictly reliable approach.

async function urlToDataUri(url: string, baseUrl: string): Promise<string> {
  if (!url || url.startsWith('data:')) return url
  try {
    const fetchUrl = url.startsWith('/') ? `${baseUrl}${url}` : url
    const res = await fetch(fetchUrl)
    if (!res.ok) return url
    const buf = await res.arrayBuffer()
    const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/png'
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return url // silent fallback — broken image is better than a 500
  }
}

async function resolveDocImages(
  doc: PlanDocument,
  baseUrl: string,
): Promise<PlanDocument> {
  const d = structuredClone(doc)

  if (d.meta.orgLogoUrl)
    d.meta.orgLogoUrl = await urlToDataUri(d.meta.orgLogoUrl, baseUrl)

  d.meta.partnerLogoUrls = await Promise.all(
    d.meta.partnerLogoUrls.map(u => urlToDataUri(u, baseUrl)),
  )

  for (const ch of d.chapters) {
    for (const b of ch.intro ?? [])
      if (b.type === 'image')
        (b as ImageBlock).url = await urlToDataUri((b as ImageBlock).url, baseUrl)
    for (const sub of ch.sections)
      for (const b of sub.blocks)
        if (b.type === 'image')
          (b as ImageBlock).url = await urlToDataUri((b as ImageBlock).url, baseUrl)
  }

  return d
}

// ── Template builders ─────────────────────────────────────────────────────────
//
// Playwright headerTemplate / footerTemplate run in an isolated DOM context:
//   • No CSS inheritance from the main document
//   • font-size defaults to 0 — every text element MUST set font-size explicitly
//   • rem/em units are unreliable — use px throughout
//   • <img> tags are unreliable in the template context — use CSS background-image
//     on a sized <div> instead; that renders consistently with data URIs

// top margin is 1.35in = 129.6px — keep in sync with margin.top in page.pdf() below
// and with A4_CONTENT_H in render-plan-html.ts

function logoBgDiv(dataUri: string, h: number, w: number, pos = 'left center'): string {
  const safe = dataUri.replace(/'/g, '%27')
  return `<div style="height:${h}px;width:${w}px;flex-shrink:0;background-image:url('${safe}');background-size:contain;background-repeat:no-repeat;background-position:${pos};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>`
}

function headerTemplate(doc: PlanDocument): string {
  const { meta } = doc

  // Text layer spans the full header width with justify-content:center so the
  // text sits at the mathematical page center, independent of logo widths.
  // Logos are pinned to left/right edges with position:absolute.

  const mainLogoDiv = meta.orgLogoUrl
    ? logoBgDiv(meta.orgLogoUrl, 96, 260, 'left center')
    : ''

  const partnerLogoDivs = meta.partnerLogoUrls
    .map(u => logoBgDiv(u, 96, 96, 'right center'))
    .join('')

  const orgName = meta.orgName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return `
<div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background-color:#f5f4ef;position:relative;width:100%;height:100%;border-bottom:1px solid rgba(184,146,47,0.35);overflow:hidden;font-size:0;">
  <div style="position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;padding:0 8px;">
    <span style="font-family:Georgia,'Times New Roman',serif;font-size:16px;font-weight:600;color:#b8922f;text-align:center;line-height:1.4;word-break:break-word;overflow-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${orgName}</span>
  </div>
  <div style="position:absolute;left:81.6px;top:0;height:100%;display:flex;align-items:center;">
    ${mainLogoDiv}
  </div>
  <div style="position:absolute;right:81.6px;top:0;height:100%;display:flex;align-items:center;gap:12px;">
    ${partnerLogoDivs}
  </div>
</div>`
}

function footerTemplate(): string {
  return `
<div style="
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
  background-color:#f5f4ef;
  width:100%;height:100%;
  display:flex;align-items:center;justify-content:center;
  margin:0;font-size:0;
">
  <span class="pageNumber" style="
    font-family:Georgia,'Times New Roman',serif;
    font-size:10pt;
    color:#334155;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  "></span>
</div>`
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── 1. Parse & validate ────────────────────────────────────────────────────
  let doc: PlanDocument
  try {
    doc = (await req.json()) as PlanDocument
    if (!doc?.chapters || !doc?.meta?.title) {
      return NextResponse.json({ error: 'Invalid PlanDocument body' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 })
  }

  // ── 2. Resolve all image URLs to Base64 data URIs ─────────────────────────
  // Must happen before any HTML rendering so both passes and the headerTemplate
  // all receive data URIs that Playwright can load without network access.
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`
  const resolvedDoc = await resolveDocImages(doc, baseUrl)

  // ── 3. Launch Chromium ─────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: true })

  try {
    const context = await browser.newContext({
      // A4 width at 96 dpi.  Height is arbitrary for screen layout.
      viewport: { width: 794, height: 1200 },
    })
    const page = await context.newPage()

    // Activate print-media CSS so @media print rules take effect during
    // DOM measurement (page-break rules, @page background, etc.)
    await page.emulateMedia({ media: 'print' })

    // ── 4. Pass 1: measure TOC page numbers ─────────────────────────────────
    const pass1Html = renderPlanHtml(resolvedDoc, {})

    await page.setContent(pass1Html, { waitUntil: 'networkidle' })

    // Wait for web-fonts (Cairo for RTL docs) to finish loading.
    await page.evaluate(() => document.fonts.ready)

    const pageNumbers: Record<string, number> = await page.evaluate(
      (contentH: number) => {
        const result: Record<string, number> = {}
        let currentPage = 1

        // The HTML is structured as a flat sequence of .pdf-block elements:
        //   .pdf-fixed-page   → exactly 1 PDF page  (cover, TOC, ch-covers)
        //   .pdf-content-block → variable pages      (chapter body)
        //
        // We walk them in DOM order and maintain a running page counter.
        document.querySelectorAll<HTMLElement>('.pdf-block').forEach(block => {

          if (block.classList.contains('pdf-fixed-page')) {
            // Fixed page: record its section ID and advance by 1 page.
            const id = block.dataset.sectionId
            if (id) result[id] = currentPage
            currentPage++

          } else if (block.classList.contains('pdf-content-block')) {
            // Content block: measure its rendered height and find sections
            // inside it by their relative offsetTop.
            const blockRect = block.getBoundingClientRect()
            const blockHeight = blockRect.height

            block.querySelectorAll<HTMLElement>('[data-section-id]').forEach(sec => {
              const secTop = sec.getBoundingClientRect().top - blockRect.top
              result[sec.dataset.sectionId!] =
                currentPage + Math.floor(secTop / contentH)
            })

            // Advance by however many full pages this block spans.
            const pagesSpanned = Math.ceil(blockHeight / contentH) || 1
            currentPage += pagesSpanned
          }
        })

        return result
      },
      A4_CONTENT_H,
    )

    // ── 5. Pass 2: render final PDF with real TOC numbers ───────────────────
    const pass2Html = renderPlanHtml(resolvedDoc, pageNumbers)

    await page.setContent(pass2Html, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplate(resolvedDoc),
      footerTemplate: footerTemplate(),
      margin: {
        top: '1.35in',    // ← must match A4_CONTENT_H derivation in render-plan-html.ts
        bottom: '0.45in', // ← must match A4_CONTENT_H derivation in render-plan-html.ts
        left: '0',
        right: '0',
      },
    })

    await context.close()

    // Sanitise filename: keep alphanumeric, spaces, hyphens, underscores, dots.
    const safeTitle = doc.meta.title.replace(/[^\w\s\-\.]/g, '_').trim() || 'plan'

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeTitle}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'no-store',
      },
    })

  } catch (err) {
    console.error('[export-pdf] generation failed:', err)
    return NextResponse.json(
      { error: 'PDF generation failed', detail: String(err) },
      { status: 500 },
    )
  } finally {
    await browser.close()
  }
}
