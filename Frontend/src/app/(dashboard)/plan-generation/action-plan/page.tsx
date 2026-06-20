'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Printer, RotateCcw, Globe, Plus,
  ChevronDown, ChevronRight, ArrowUp, ArrowDown, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChatPanel } from '@/components/plan/ChatPanel'
import type { ChatPanelHandle } from '@/components/plan/ChatPanel'
import { Template } from '@/templates/plan/action-plan/Template'
import type { ActionPlanApi } from '@/templates/plan/action-plan/Template'
import { makeSampleActionPlan, makeBlankActionPlan } from '@/templates/plan/action-plan/sample'
import type {
  ActionPlanDocument, ActionPlanMeta, ActivityRow,
} from '@/types/action-plan-document'
import type { PlanDocument } from '@/types/plan-document'

// ── Storage ────────────────────────────────────────────────────────────────────

const STORAGE_KEY  = (lang: string) => `stratos-action-plan-draft-${lang}`
const STRAT_KEY    = (lang: string) => `stratos-plan-draft-v2-${lang}`

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }
function blankRow(): ActivityRow { return { id: uid(), activities: '', indicators: '', completed: '', inProgress: '', reasons: '', date: '' } }
function blankGroup()            { return { id: uid(), objective: '', rows: [blankRow()] } }
function blankSection(n: number) { return { id: uid(), goalNumber: n, goalTitle: '', objectives: [blankGroup()] } }

// Inherit logo from the strategic plan draft if the action plan has none
function inheritLogo(doc: ActionPlanDocument): ActionPlanDocument {
  if (doc.meta.orgLogoUrl) return doc
  try {
    for (const l of ['en', 'ar']) {
      const raw = localStorage.getItem(STRAT_KEY(l))
      if (!raw) continue
      const parsed = JSON.parse(raw) as PlanDocument
      if (parsed?.meta?.orgLogoUrl) {
        return { ...doc, meta: { ...doc.meta, orgLogoUrl: parsed.meta.orgLogoUrl } }
      }
    }
  } catch { /* ignore */ }
  return doc
}

function loadDoc(lang: 'en' | 'ar'): ActionPlanDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(lang))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActionPlanDocument
    if (parsed?.meta?.title && Array.isArray(parsed.sections)) return parsed
  } catch { /* ignore */ }
  return null
}

// ── Outline panel ─────────────────────────────────────────────────────────────

function OutlinePanel({ doc, api }: { doc: ActionPlanDocument; api: ActionPlanApi }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(doc.sections.map(s => s.id)))

  const toggle   = (id: string) => setOpenIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const totalActivities = doc.sections.reduce((t, s) => t + s.objectives.reduce((u, g) => u + g.rows.length, 0), 0)

  return (
    <aside className="flex w-56 shrink-0 flex-col border-e border-white/5 bg-[#0b0e1a] overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Structure</span>
        <span className="text-[10px] text-slate-600">{doc.sections.length} goals</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {doc.sections.map((section, sIdx) => (
          <div key={section.id}>
            <div className="group/sec flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-white/5 transition-colors">
              <button onClick={() => toggle(section.id)} className="shrink-0 text-slate-600 hover:text-slate-300 transition-colors">
                {openIds.has(section.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <span className="shrink-0 text-[10px] font-bold text-slate-600">{String(sIdx + 1).padStart(2, '0')}</span>
              <button
                onClick={() => scrollTo(section.id)}
                className="flex-1 text-start text-xs font-semibold text-slate-300 hover:text-slate-100 transition-colors"
                title={`Goal ${section.goalNumber}`}
              >
                Goal {section.goalNumber}
                {section.goalTitle && (
                  <span className="block truncate text-[10px] font-normal text-slate-500">{section.goalTitle}</span>
                )}
              </button>
              <div className="hidden group-hover/sec:flex items-center gap-0.5 shrink-0">
                <button disabled={sIdx === 0} onClick={() => api.moveSection(section.id, 'up')} title="Move up" className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 transition-colors"><ArrowUp className="h-2.5 w-2.5" /></button>
                <button disabled={sIdx === doc.sections.length - 1} onClick={() => api.moveSection(section.id, 'down')} title="Move down" className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 transition-colors"><ArrowDown className="h-2.5 w-2.5" /></button>
                <button disabled={doc.sections.length <= 1} onClick={() => { if (confirm('Delete this goal table?')) api.deleteSection(section.id) }} title="Delete" className="flex h-4 w-4 items-center justify-center rounded text-rose-400/60 hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-20 transition-colors"><Trash2 className="h-2.5 w-2.5" /></button>
              </div>
            </div>

            {openIds.has(section.id) && (
              <div>
                {section.objectives.map((g, gIdx) => (
                  <div key={g.id} className="flex items-center gap-1.5 py-1 ps-7 rounded-md hover:bg-white/5 transition-colors cursor-pointer" onClick={() => scrollTo(g.id)}>
                    <span className="shrink-0 text-[10px] text-slate-600 w-5">{sIdx + 1}.{gIdx + 1}</span>
                    <span className="flex-1 truncate text-xs text-slate-500 hover:text-slate-300 transition-colors" title={g.objective}>
                      {g.objective || <em className="opacity-40">Objective</em>}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-700">{g.rows.length}</span>
                  </div>
                ))}
                <button
                  onClick={() => api.addObjectiveGroup(section.id)}
                  className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-3 py-1 ps-9 text-xs text-slate-600 hover:bg-white/5 hover:text-slate-400 transition-colors"
                >
                  <Plus className="h-3 w-3" /> Add objective
                </button>
              </div>
            )}
          </div>
        ))}

        <button
          onClick={() => api.addSection()}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-slate-600 hover:border-white/20 hover:text-slate-400 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add goal
        </button>
      </div>

      <div className="border-t border-white/5 px-3 py-2 text-[10px] text-slate-600">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full bg-[#b8922f] transition-all" style={{ width: `${Math.min(100, doc.sections.length * 10)}%` }} />
          </div>
          <span>{totalActivities} activities</span>
        </div>
      </div>
    </aside>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ActionPlanPage() {
  const router = useRouter()
  const [lang, setLang] = useState<'en' | 'ar'>('en')
  const [doc,  setDoc]  = useState<ActionPlanDocument>(() => makeSampleActionPlan('en'))
  const [exportMode, setExportMode] = useState(false)

  const chatPanelRef = useRef<ChatPanelHandle>(null)
  const canvasRef    = useRef<HTMLDivElement>(null)
  const docRef       = useRef(doc)
  useEffect(() => { docRef.current = doc }, [doc])
  const [selectionBubble, setSelectionBubble] = useState<{ x: number; y: number; prompt: string } | null>(null)

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let initLang: 'en' | 'ar' = 'en'
    let initKind: 'blank' | 'sample' | 'recent' = 'sample'

    try {
      const raw = sessionStorage.getItem('action-plan-init')
      if (raw) {
        sessionStorage.removeItem('action-plan-init')
        const init = JSON.parse(raw) as { kind: 'blank' | 'sample' | 'recent'; lang?: 'en' | 'ar' }
        initKind = init.kind
        if (init.lang) initLang = init.lang
      }
    } catch { /* ignore */ }

    setLang(initLang)

    if (initKind === 'recent') {
      const saved = loadDoc(initLang)
      if (saved) { setDoc(inheritLogo(saved)); return }
    }
    if (initKind === 'blank') {
      setDoc(inheritLogo(makeBlankActionPlan(initLang))); return
    }

    // 'sample' or no sessionStorage — try localStorage first
    const saved = loadDoc(initLang)
    if (saved) { setDoc(inheritLogo(saved)); return }
    setDoc(inheritLogo(makeSampleActionPlan(initLang)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Auto-save ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY(doc.language), JSON.stringify({ ...doc, updatedAt: new Date().toISOString() })) } catch { /* quota */ }
    }, 500)
    return () => clearTimeout(t)
  }, [doc])

  useEffect(() => {
    document.body.classList.add('plan-editor-open')
    return () => document.body.classList.remove('plan-editor-open')
  }, [])

  // ── Language switch ─────────────────────────────────────────────────────────
  const switchLang = useCallback((l: 'en' | 'ar') => {
    if (l === lang) return
    // Save current doc
    try { localStorage.setItem(STORAGE_KEY(lang), JSON.stringify({ ...docRef.current, updatedAt: new Date().toISOString() })) } catch { /* quota */ }
    // Load other lang
    const saved = loadDoc(l)
    const next  = saved ?? inheritLogo(makeSampleActionPlan(l))
    setLang(l)
    setDoc(inheritLogo(next))
    setSelectionBubble(null)
  }, [lang])

  // ── Reset ───────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (!confirm('Reset to sample document? Edits will be lost.')) return
    localStorage.removeItem(STORAGE_KEY(lang))
    setDoc(inheritLogo(makeSampleActionPlan(lang)))
    setSelectionBubble(null)
  }, [lang])

  // ── Export PDF ──────────────────────────────────────────────────────────────
  const handleExportPdf = useCallback(() => setExportMode(true), [])

  useEffect(() => {
    if (!exportMode) return
    const t = setTimeout(() => {
      const planEl = document.querySelector('.plan-doc') as HTMLElement | null
      if (!planEl) { setExportMode(false); return }

      const planHtml   = planEl.outerHTML
      const styleLinks = Array.from(
        document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')
      ).map(el => el.outerHTML).join('\n')

      setExportMode(false)
      const d   = docRef.current
      const win = window.open('', '_blank')
      if (!win) { alert('Popup blocked — please allow popups for this site and try again.'); return }

      win.document.open()
      win.document.write(`<!DOCTYPE html>
<html lang="${d.language}" dir="${d.dir}">
<head>
<meta charset="UTF-8">
<title>${d.meta.title}</title>
${styleLinks}
</head>
<body>
${planHtml}
<style>
@page { size: A4; margin: 1.35in 0 0.45in 0; }
html, body { height: auto !important; overflow: visible !important; background: #f5f4ef !important; }
.h-screen,.h-full,.overflow-hidden,.overflow-y-auto { height: auto !important; overflow: visible !important; }
.no-print,.plan-running-header { display: none !important; }
.print-page { min-height: 0 !important; }
</style>
<script>window.PagedConfig = { auto: false };<\/script>
<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"><\/script>
<script>
(function () {
  if (typeof Paged === 'undefined') { setTimeout(window.print.bind(window), 200); return; }
  var printed = false;
  function doPrint() { if (printed) return; printed = true; setTimeout(window.print.bind(window), 300); }
  class AfterRender extends Paged.Handler { afterRendered() { doPrint(); } }
  Paged.registerHandlers(AfterRender);
  new Paged.Previewer().preview(document.body, [], document.body).catch(function () { doPrint(); });
  setTimeout(doPrint, 15000);
})();
<\/script>
</body>
</html>`)
      win.document.close()
    }, 150)
    return () => clearTimeout(t)
  }, [exportMode])

  // ── Selection → chat bubble ──────────────────────────────────────────────────
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      let selectedText = '', x = e.clientX, y = e.clientY

      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const range = sel.getRangeAt(0)
        if (canvas.contains(range.commonAncestorContainer)) {
          const t = sel.toString().trim()
          if (t.length >= 3) {
            selectedText = t
            const rect = range.getBoundingClientRect()
            x = rect.left + rect.width / 2
            y = rect.bottom
          }
        }
      }
      if (!selectedText) {
        const el = document.activeElement
        if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && canvas.contains(el)) {
          const s = el.selectionStart ?? 0, e2 = el.selectionEnd ?? 0
          if (e2 > s) { const t = el.value.slice(s, e2).trim(); if (t.length >= 3) { selectedText = t; x = e.clientX; y = e.clientY } }
        }
      }
      if (!selectedText) { setSelectionBubble(null); return }
      const snippet = selectedText.length > 300 ? selectedText.slice(0, 300) + '…' : selectedText
      setSelectionBubble({ x, y, prompt: `"${snippet}"\n\nCan you explain or rewrite this content?` })
    }
    const onSelChange = () => {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) return
      const el = document.activeElement
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && canvasRef.current?.contains(el)) {
        if ((el.selectionEnd ?? 0) > (el.selectionStart ?? 0)) return
      }
      setSelectionBubble(null)
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', onSelChange)
    return () => { document.removeEventListener('mouseup', onMouseUp); document.removeEventListener('selectionchange', onSelChange) }
  }, [])

  // ── CRUD api ────────────────────────────────────────────────────────────────
  const api: ActionPlanApi = useMemo(() => ({
    updateMeta: (patch: Partial<ActionPlanMeta>) =>
      setDoc(d => ({ ...d, meta: { ...d.meta, ...patch } })),

    updateSectionTitle: (sId, title) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => s.id === sId ? { ...s, goalTitle: title } : s) })),

    addSection: () =>
      setDoc(d => ({ ...d, sections: [...d.sections, blankSection(d.sections.length + 1)] })),

    deleteSection: (sId) =>
      setDoc(d => ({ ...d, sections: d.sections.filter(s => s.id !== sId).map((s, i) => ({ ...s, goalNumber: i + 1 })) })),

    moveSection: (sId, dir) =>
      setDoc(d => {
        const arr = [...d.sections]
        const i = arr.findIndex(s => s.id === sId), j = dir === 'up' ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= arr.length) return d
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
        return { ...d, sections: arr.map((s, k) => ({ ...s, goalNumber: k + 1 })) }
      }),

    addObjectiveGroup: (sId) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => s.id === sId ? { ...s, objectives: [...s.objectives, blankGroup()] } : s) })),

    deleteObjectiveGroup: (sId, gId) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => s.id === sId ? { ...s, objectives: s.objectives.filter(g => g.id !== gId) } : s) })),

    moveGroup: (sId, gId, dir) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => {
        if (s.id !== sId) return s
        const arr = [...s.objectives]
        const i = arr.findIndex(g => g.id === gId), j = dir === 'up' ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= arr.length) return s
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
        return { ...s, objectives: arr }
      }) })),

    updateObjective: (sId, gId, text) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => s.id !== sId ? s : { ...s, objectives: s.objectives.map(g => g.id === gId ? { ...g, objective: text } : g) }) })),

    addRow: (sId, gId) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => s.id !== sId ? s : { ...s, objectives: s.objectives.map(g => g.id === gId ? { ...g, rows: [...g.rows, blankRow()] } : g) }) })),

    deleteRow: (sId, gId, rId) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => s.id !== sId ? s : { ...s, objectives: s.objectives.map(g => g.id !== gId ? g : { ...g, rows: g.rows.filter(r => r.id !== rId) }) }) })),

    moveRow: (sId, gId, rId, dir) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => s.id !== sId ? s : { ...s, objectives: s.objectives.map(g => {
        if (g.id !== gId) return g
        const arr = [...g.rows]
        const i = arr.findIndex(r => r.id === rId), j = dir === 'up' ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= arr.length) return g
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
        return { ...g, rows: arr }
      }) }) })),

    updateRow: (sId, gId, rId, field, value) =>
      setDoc(d => ({ ...d, sections: d.sections.map(s => s.id !== sId ? s : { ...s, objectives: s.objectives.map(g => g.id !== gId ? g : { ...g, rows: g.rows.map(r => r.id === rId ? { ...r, [field]: value } : r) }) }) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  // ChatPanel stub doc (maps sections → chapters)
  const chatDoc = useMemo<PlanDocument>(() => ({
    id:         doc.id,
    orgId:      '',
    meta:       { title: doc.meta.title, orgName: doc.meta.orgName, orgLogoUrl: doc.meta.orgLogoUrl ?? null, periodLabel: doc.meta.subtitle, partnerLogoUrls: doc.meta.partnerLogoUrls ?? [] },
    templateId: 'action-plan',
    language:   doc.language as 'en' | 'ar',
    dir:        doc.dir as 'ltr' | 'rtl',
    docStatus:  'draft',
    createdAt:  doc.createdAt,
    updatedAt:  doc.updatedAt,
    chapters:   doc.sections.map((s, i) => ({
      id:          s.id,
      number:      i + 1,
      title:       `Goal ${s.goalNumber}${s.goalTitle ? `: ${s.goalTitle}` : ''}`,
      canonicalKey: null,
      userAdded:   true,
      sections:    s.objectives.map((g, j) => ({
        id:          g.id,
        canonicalKey: null,
        heading:     g.objective || `Objective ${j + 1}`,
        order:       j,
        status:      'auto' as const,
        generation:  'complete' as const,
        userAdded:   true,
        blocks:      [],
      })),
    })),
  } as PlanDocument), [doc])

  // ── Export mode ──────────────────────────────────────────────────────────────
  if (exportMode) return <Template doc={doc} mode="print" />

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Top bar ── */}
        <div className="no-print flex shrink-0 items-center justify-between border-b border-white/5 bg-[#0b0e1a] px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push('/plan-generation')}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="text-xs">Plans</span>
            </button>

            <div className="h-3.5 w-px bg-white/10" />

            <span className="text-xs font-semibold text-slate-300 truncate max-w-[220px]">
              {doc.meta.title}
            </span>

            {/* Language toggle */}
            <div className="flex items-center gap-0.5 rounded-md border border-white/5 bg-[#080a14] p-0.5">
              <Globe className="ms-1 h-3 w-3 text-slate-500" />
              {(['en', 'ar'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => switchLang(l)}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                    lang === l ? 'bg-cyan-500/10 text-cyan-300' : 'text-slate-500 hover:text-slate-300',
                  )}
                >
                  {l === 'en' ? 'EN' : 'AR'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleReset} className="gap-1.5 text-xs text-slate-400">
              <RotateCcw className="h-3 w-3" /> Reset
            </Button>
            <Button size="sm" onClick={handleExportPdf} className="gap-1.5 bg-[#b8922f] text-xs font-semibold text-[#0b1220] hover:bg-[#c9a340]">
              <Printer className="h-3 w-3" /> Export PDF
            </Button>
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="no-print flex shrink-0 items-center gap-2 border-b border-white/5 bg-[#0d1020] px-3 py-1.5">
          <button
            onClick={() => api.addSection()}
            className="flex h-6 items-center gap-1.5 rounded px-2 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add Goal Table
          </button>
          <div className="mx-1 h-4 w-px bg-white/10" />
          <span className="text-[10px] text-slate-600">
            {doc.sections.length} goals · {doc.sections.reduce((t, s) => t + s.objectives.length, 0)} objectives · {doc.sections.reduce((t, s) => t + s.objectives.reduce((u, g) => u + g.rows.length, 0), 0)} activities
          </span>
          <span className="ms-auto text-[10px] italic text-slate-700">Auto-saved</span>
        </div>

        {/* ── 3-zone layout ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left — Outline */}
          <div className="no-print shrink-0">
            <OutlinePanel doc={doc} api={api} />
          </div>

          {/* Center — Canvas */}
          <div ref={canvasRef} className="flex-1 overflow-y-auto bg-[#f5f4ef]">
            <Template doc={doc} mode="edit" api={api} />
          </div>

          {/* Right — Chat */}
          <div className="no-print shrink-0 h-full">
            <ChatPanel ref={chatPanelRef} selectedBlock={null} doc={chatDoc} />
          </div>

        </div>
      </div>

      {/* Selection → chat bubble */}
      {selectionBubble && (
        <button
          onMouseDown={e => {
            e.preventDefault()
            chatPanelRef.current?.injectText(selectionBubble.prompt)
            window.getSelection()?.removeAllRanges()
            setSelectionBubble(null)
          }}
          className="no-print fixed z-[9999] -translate-x-1/2 rounded-full border border-cyan-500/40 bg-[#0b0e1a] px-3 py-1.5 text-[11px] font-medium text-cyan-400 shadow-xl hover:bg-cyan-500/10 transition-colors"
          style={{ left: selectionBubble.x, top: selectionBubble.y + 6 }}
        >
          Send to chat ↗
        </button>
      )}
    </>
  )
}
