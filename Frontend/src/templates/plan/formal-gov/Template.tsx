'use client'

import React, { useContext, useEffect, useRef, useState } from 'react'
import { CheckCheck, Pencil, Check, Upload } from 'lucide-react'
import type {
  PlanDocument, Chapter, Subchapter, Block,
  ParagraphBlock, ListBlock, TableBlock, ImageBlock, RichText,
  Provenance,
} from '@/types/plan-document'
import { EditCtx } from '@/components/plan/EditorApi'
import type { EditorApi } from '@/components/plan/EditorApi'
import {
  EditToolbar, AddBlockAffordance,
  ParagraphEditor, ListEditor, TableEditor, ImageEditor,
} from '@/components/plan/BlockEditors'

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface TemplateProps {
  doc: PlanDocument
  mode?: 'view' | 'edit' | 'print'
  onSelectBlock?: (blockId: string) => void
  pageNumbers?: Record<string, number>
  editorApi?: EditorApi
  marginPreset?: 'narrow' | 'normal'
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function chapterRolledStatus(ch: Chapter): 'auto' | 'edited' | 'verified' {
  const all = ch.sections
  if (all.length === 0) return 'auto'
  if (all.every(s => s.status === 'verified')) return 'verified'
  if (all.some(s => s.status === 'edited')) return 'edited'
  return 'auto'
}

function padNum(n: number) { return String(n).padStart(2, '0') }

// ─── Source badge (provenance) ─────────────────────────────────────────────────

function deriveSectionProvenance(blocks: Block[]): Provenance | null {
  const provs = blocks.map(b => b.provenance).filter(Boolean)
  if (provs.length === 0) return null
  const kinds = Array.from(new Set(provs.map(p => p.kind)))
  if (kinds.length === 1) return provs[0]
  return { kind: 'mixed', sources: provs as (Provenance & { kind: 'agent_signal' | 'reference_plan' | 'human' })[] }
}

function provenanceLabel(prov: Provenance): { label: string; detail: string; color: string } {
  if (prov.kind === 'agent_signal') {
    return {
      label: `Agent · ${prov.agent}`,
      detail: prov.finding.length > 120 ? prov.finding.slice(0, 120) + '…' : prov.finding,
      color: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
    }
  }
  if (prov.kind === 'reference_plan') {
    return {
      label: 'Reference plan',
      detail: `"${prov.planTitle}" — ${prov.sectionHeading}${prov.page ? `, p. ${prov.page}` : ''}`,
      color: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    }
  }
  if (prov.kind === 'human') {
    return {
      label: 'Human edit',
      detail: `Edited ${new Date(prov.editedAt).toLocaleDateString()}`,
      color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    }
  }
  // mixed
  const src = prov.sources
  const kinds = Array.from(new Set(src.map(s => s.kind)))
  return {
    label: 'Mixed sources',
    detail: kinds.join(' · '),
    color: 'bg-violet-500/10 text-violet-700 border-violet-500/20',
  }
}

function SourceBadge({ blocks }: { blocks: Block[] }) {
  const [open, setOpen] = useState(false)
  const prov = deriveSectionProvenance(blocks)
  if (!prov) return null

  const { label, detail, color } = provenanceLabel(prov)

  return (
    <span className="relative inline-flex items-center" style={{ verticalAlign: 'middle' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-opacity opacity-0 group-hover/sub:opacity-100 ${color}`}
        style={{ lineHeight: 1.4 }}
        title={detail}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
        {label}
      </button>
      {open && (
        <span
          className="absolute start-0 top-6 z-50 min-w-[16rem] max-w-[22rem] rounded-lg border border-white/10 bg-[#1a2030] p-3 text-[11px] leading-relaxed text-slate-300 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <span className={`mb-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color}`}>{label}</span>
          <br />
          {detail}
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false) }}
            className="mt-2 block text-[10px] text-slate-500 hover:text-slate-300"
          >
            Close
          </button>
        </span>
      )}
    </span>
  )
}

// ─── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: 'auto' | 'edited' | 'verified' }) {
  const cls = {
    auto:     'bg-slate-200 text-slate-600',
    edited:   'bg-amber-100 text-amber-700',
    verified: 'bg-emerald-100 text-emerald-700',
  }[status]
  return (
    <span className={`status-chip inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  )
}

// ─── RichText renderer ─────────────────────────────────────────────────────────

function RT({ node, print, compact }: { node: RichText; print?: boolean; compact?: boolean }): React.ReactElement | null {
  if (!node) return null
  if (node.type === 'doc') {
    return <>{node.content?.map((c, i) => <RT key={i} node={c} print={print} compact={compact} />)}</>
  }
  if (node.type === 'paragraph') {
    return (
      <p className={compact ? 'leading-snug' : 'mb-3 last:mb-0'}>
        {node.content?.map((c, i) => <RT key={i} node={c} print={print} compact={compact} />)}
      </p>
    )
  }
  if (node.type === 'text') {
    let el: React.ReactNode = node.text ?? ''
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold')   el = <strong>{el}</strong>
      if (mark.type === 'italic') el = <em>{el}</em>
      if (mark.type === 'link' && !print) {
        const href = (mark.attrs?.href as string) ?? '#'
        el = <a href={href} target="_blank" rel="noreferrer" className="underline text-plan-accent">{el}</a>
      }
    }
    return <>{el}</>
  }
  if (node.type === 'bulletList') {
    return (
      <ul className="list-disc list-outside space-y-0.5 ps-4 text-plan-body">
        {node.content?.map((c, i) => <RT key={i} node={c} print={print} compact />)}
      </ul>
    )
  }
  if (node.type === 'orderedList') {
    return (
      <ol className="list-decimal list-outside space-y-0.5 ps-4 text-plan-body">
        {node.content?.map((c, i) => <RT key={i} node={c} print={print} compact />)}
      </ol>
    )
  }
  if (node.type === 'listItem') {
    return (
      <li className="leading-snug">
        {node.content?.map((c, i) => <RT key={i} node={c} print={print} compact />)}
      </li>
    )
  }
  return <>{node.content?.map((c, i) => <RT key={i} node={c} print={print} compact={compact} />)}</>
}

// ─── BlockWrap — view/edit/print affordances ───────────────────────────────────

function BlockWrap({
  id, mode, onSelectBlock, children,
}: {
  id: string
  mode: 'view' | 'edit' | 'print'
  onSelectBlock?: (id: string) => void
  children: React.ReactNode
}) {
  const { editorApi, chapterId, subId } = useContext(EditCtx)
  const interactive = mode !== 'print' && !!onSelectBlock

  if (mode === 'edit' && editorApi) {
    return (
      <div
        data-block-id={id}
        onClick={interactive ? () => onSelectBlock!(id) : undefined}
        className="relative group rounded"
      >
        <EditToolbar blockId={id} editorApi={editorApi} chapterId={chapterId} subId={subId} />
        {children}
      </div>
    )
  }

  return (
    <div
      data-block-id={id}
      onClick={interactive ? () => onSelectBlock!(id) : undefined}
      className={interactive ? 'block-hover-ring cursor-pointer rounded transition hover:ring-2 hover:ring-plan-accent/30' : ''}
    >
      {children}
    </div>
  )
}

// ─── Block renderers ───────────────────────────────────────────────────────────

function PBlock({ block, mode, onSelectBlock }: { block: ParagraphBlock; mode: 'view' | 'edit' | 'print'; onSelectBlock?: (id: string) => void }) {
  const { editorApi, chapterId, subId } = useContext(EditCtx)

  return (
    <BlockWrap id={block.id} mode={mode} onSelectBlock={onSelectBlock}>
      {mode === 'edit' && editorApi ? (
        <ParagraphEditor
          block={block}
          onUpdate={(next) => editorApi.updateBlock(chapterId, subId, block.id, next)}
        />
      ) : (
        <div className="text-plan-body leading-relaxed">
          <RT node={block.content} print={mode === 'print'} />
        </div>
      )}
    </BlockWrap>
  )
}

function LBlock({ block, mode, onSelectBlock }: { block: ListBlock; mode: 'view' | 'edit' | 'print'; onSelectBlock?: (id: string) => void }) {
  const { editorApi, chapterId, subId } = useContext(EditCtx)
  const Tag = block.ordered ? 'ol' : 'ul'

  return (
    <BlockWrap id={block.id} mode={mode} onSelectBlock={onSelectBlock}>
      {mode === 'edit' && editorApi ? (
        <ListEditor
          block={block}
          onUpdate={(next) => editorApi.updateBlock(chapterId, subId, block.id, next)}
        />
      ) : (
        <Tag className={`${block.ordered ? 'list-decimal' : 'list-disc'} list-inside space-y-2 text-plan-body`}>
          {block.items.map((item, i) => (
            <li key={i}><RT node={item} print={mode === 'print'} /></li>
          ))}
        </Tag>
      )}
    </BlockWrap>
  )
}

function TBlock({ block, mode, onSelectBlock }: { block: TableBlock; mode: 'view' | 'edit' | 'print'; onSelectBlock?: (id: string) => void }) {
  const { editorApi, chapterId, subId } = useContext(EditCtx)

  return (
    <BlockWrap id={block.id} mode={mode} onSelectBlock={onSelectBlock}>
      {mode === 'edit' && editorApi ? (
        <TableEditor
          block={block}
          onUpdate={(next) => editorApi.updateBlock(chapterId, subId, block.id, next)}
        />
      ) : (
        <>
          <div className="my-4 overflow-x-auto rounded-lg border border-plan-accent/30">
            <table className="w-full text-xs" style={{ tableLayout: 'fixed', minWidth: '36rem', wordBreak: 'break-word' }}>
              {block.header && (
                <thead style={{ background: 'var(--plan-navy)' }}>
                  <tr>
                    {block.header.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-start font-semibold text-white" style={{ whiteSpace: 'normal' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-plan-accent/20 last:border-b-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-plan-body align-top" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        <RT node={cell} print={mode === 'print'} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && (
            <p className="mt-1 text-center text-xs italic text-plan-muted-fg">{block.caption}</p>
          )}
        </>
      )}
    </BlockWrap>
  )
}

function IBlock({ block, mode, onSelectBlock }: { block: ImageBlock; mode: 'view' | 'edit' | 'print'; onSelectBlock?: (id: string) => void }) {
  const { editorApi, chapterId, subId } = useContext(EditCtx)

  return (
    <BlockWrap id={block.id} mode={mode} onSelectBlock={onSelectBlock}>
      {mode === 'edit' && editorApi ? (
        <ImageEditor
          block={block}
          onUpdate={(next) => editorApi.updateBlock(chapterId, subId, block.id, next)}
        />
      ) : (
        <figure
          className={`my-6 ${block.width === 'half' ? 'mx-auto max-w-sm' : 'w-full'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.alt} className="h-auto w-full rounded-lg" />
          {block.caption && (
            <figcaption className="mt-2 text-center text-xs italic text-plan-muted-fg">{block.caption}</figcaption>
          )}
        </figure>
      )}
    </BlockWrap>
  )
}

// ─── Block list (with add-block affordances in edit mode) ──────────────────────

function Blocks({ blocks, mode, onSelectBlock }: {
  blocks: Block[]
  mode: 'view' | 'edit' | 'print'
  onSelectBlock?: (id: string) => void
}) {
  const { editorApi, chapterId, subId } = useContext(EditCtx)

  const renderBlock = (b: Block) => {
    switch (b.type) {
      case 'paragraph': return <PBlock key={b.id} block={b} mode={mode} onSelectBlock={onSelectBlock} />
      case 'list':      return <LBlock key={b.id} block={b} mode={mode} onSelectBlock={onSelectBlock} />
      case 'table':     return <TBlock key={b.id} block={b} mode={mode} onSelectBlock={onSelectBlock} />
      case 'image':     return <IBlock key={b.id} block={b} mode={mode} onSelectBlock={onSelectBlock} />
    }
  }

  if (mode === 'edit' && editorApi) {
    return (
      <div className="space-y-1">
        <AddBlockAffordance editorApi={editorApi} chapterId={chapterId} subId={subId} atStart />
        {blocks.map((b) => (
          <React.Fragment key={b.id}>
            <div className="py-1">{renderBlock(b)}</div>
            <AddBlockAffordance editorApi={editorApi} chapterId={chapterId} subId={subId} afterBlockId={b.id} />
          </React.Fragment>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {blocks.map(renderBlock)}
    </div>
  )
}

// ─── Running header ────────────────────────────────────────────────────────────

function RunningHeader({
  meta, mode, marginPreset,
}: {
  meta: PlanDocument['meta']
  mode: 'view' | 'edit' | 'print'
  marginPreset?: 'narrow' | 'normal'
}) {
  const { editorApi } = useContext(EditCtx)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(meta.orgName)

  const padX = marginPreset === 'narrow' ? '0.5in' : '0.85in'
  const isPrint = mode === 'print'
  const canEdit = mode === 'edit' && !!editorApi

  const commitName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== meta.orgName) editorApi?.updateMeta({ orgName: trimmed })
    else setNameDraft(meta.orgName)
    setEditingName(false)
  }

  return (
    <div
      className="plan-running-header"
      style={{
        position: isPrint ? 'fixed' : 'sticky',
        top: 0,
        ...(isPrint ? { insetInlineStart: 0, insetInlineEnd: 0 } : {}),
        height: '0.65in', zIndex: 50,
        background: 'var(--plan-bg)',
        borderBottom: '1px solid rgba(184,146,47,0.35)',
        display: 'flex', alignItems: 'center',
      }}
    >
      <div style={{
        direction: 'ltr', maxWidth: '8.5in', margin: '0 auto',
        width: '100%', height: '100%', position: 'relative',
      }}>
        {/* Text layer: spans full width so justify-content:center = true page center */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {canEdit && editingName ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameDraft(meta.orgName); setEditingName(false); } }}
                style={{
                  background: 'transparent', border: 'none',
                  borderBottom: '1px solid var(--plan-accent)', outline: 'none',
                  color: 'var(--plan-accent)', fontFamily: 'Georgia,serif',
                  fontSize: '1rem', fontWeight: 600, textAlign: 'center', minWidth: '8rem',
                }}
              />
              <button onClick={commitName} style={{ color: 'var(--plan-accent)', opacity: 0.7 }}>
                <Check style={{ width: '0.875rem', height: '0.875rem' }} />
              </button>
            </div>
          ) : (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: canEdit ? 'text' : 'default' }}
              onDoubleClick={() => { if (canEdit) { setNameDraft(meta.orgName); setEditingName(true); } }}
              title={canEdit ? 'Double-click to edit' : undefined}
            >
              <span style={{ color: 'var(--plan-accent)', fontFamily: 'Georgia,serif', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4, textAlign: 'center' }}>
                {meta.orgName}
              </span>
              {canEdit && <Pencil style={{ width: '0.625rem', height: '0.625rem', color: 'var(--plan-accent)', opacity: 0.4, flexShrink: 0 }} />}
            </div>
          )}
        </div>

        {/* Left: Org logo — pinned to far left */}
        <div style={{ position: 'absolute', left: padX, top: 0, height: '100%', display: 'flex', alignItems: 'center' }}>
          {meta.orgLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.orgLogoUrl} alt={meta.orgName} style={{ height: '2.5rem', width: 'auto', maxWidth: '14rem', objectFit: 'contain' }} />
          )}
        </div>

        {/* Right: Partner logos — pinned to far right */}
        <div style={{ position: 'absolute', right: padX, top: 0, height: '100%', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {meta.partnerLogoUrls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt={`Partner ${i + 1}`} style={{ height: '2.5rem', width: 'auto', objectFit: 'contain' }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Cover page ────────────────────────────────────────────────────────────────

function CoverPage({ meta, mode }: { meta: PlanDocument['meta']; mode: 'view' | 'edit' | 'print' }) {
  const { editorApi } = useContext(EditCtx)
  const canEdit = mode === 'edit' && !!editorApi

  const [editingTitle,  setEditingTitle]  = useState(false)
  const [titleDraft,    setTitleDraft]    = useState(meta.title)
  const [editingPeriod, setEditingPeriod] = useState(false)
  const [periodDraft,   setPeriodDraft]   = useState(meta.periodLabel)
  const logoFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTitleDraft(meta.title) },       [meta.title])
  useEffect(() => { setPeriodDraft(meta.periodLabel) }, [meta.periodLabel])

  const commitTitle = () => {
    const t = titleDraft.trim()
    if (t) editorApi?.updateMeta({ title: t })
    else setTitleDraft(meta.title)
    setEditingTitle(false)
  }

  const commitPeriod = () => {
    editorApi?.updateMeta({ periodLabel: periodDraft.trim() })
    setEditingPeriod(false)
  }

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => editorApi?.updateMeta({ orgLogoUrl: reader.result as string })
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="print-page no-page-number" style={{ minHeight: '100vh', background: '#f5f4ef', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', paddingTop: mode === 'print' ? 0 : '0.65in' }}>
      <div style={{ position: 'absolute', top: 32, insetInlineStart: 48, fontSize: '5rem', color: 'var(--plan-accent)', opacity: 0.05, fontFamily: 'Georgia,serif' }}>◆</div>
      <div style={{ position: 'absolute', bottom: 64, insetInlineEnd: 48, fontSize: '5rem', color: 'var(--plan-accent)', opacity: 0.05, fontFamily: 'Georgia,serif' }}>◆</div>
      <div style={{ maxWidth: '36rem', textAlign: 'center', position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '3rem', alignItems: 'center' }}>

        {/* Logo — click to upload in edit mode */}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          {meta.orgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.orgLogoUrl} alt={meta.orgName} style={{ width: '26rem', maxWidth: '88%', height: 'auto', objectFit: 'contain' }} />
          ) : (
            <div style={{ width: '6rem', height: '6rem', background: 'linear-gradient(135deg,#1e293b,#0f172a)', borderRadius: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '2rem', fontWeight: 700, border: '2px solid var(--plan-accent)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
              {(meta.orgName || '?').charAt(0).toUpperCase()}
            </div>
          )}
          {canEdit && (
            <>
              <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
              <button
                onClick={() => logoFileRef.current?.click()}
                title="Upload logo"
                style={{
                  position: 'absolute', bottom: -8, insetInlineEnd: -8,
                  background: 'var(--plan-accent)', border: 'none', borderRadius: '50%',
                  width: '1.75rem', height: '1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                }}
              >
                <Upload style={{ width: '0.75rem', height: '0.75rem', color: '#0b0e1a' }} />
              </button>
            </>
          )}
        </div>

        {/* Title + period */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', width: '100%' }}>
          {canEdit && editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitleDraft(meta.title); setEditingTitle(false); } }}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: '2px solid var(--plan-accent)', outline: 'none',
                fontFamily: 'Georgia,serif', fontSize: '3.5rem', fontWeight: 700,
                color: 'var(--plan-heading)', lineHeight: 1.1,
                textAlign: 'center', width: '100%',
              }}
            />
          ) : (
            <h1
              onClick={() => { if (canEdit) { setTitleDraft(meta.title); setEditingTitle(true); } }}
              title={canEdit ? 'Click to edit title' : undefined}
              style={{
                margin: 0, fontFamily: 'Georgia,serif', fontSize: '3.5rem', fontWeight: 700,
                color: 'var(--plan-heading)', lineHeight: 1.1,
                cursor: canEdit ? 'text' : 'default',
                outline: canEdit ? '2px solid transparent' : undefined,
                borderRadius: canEdit ? '4px' : undefined,
                padding: canEdit ? '0 4px' : undefined,
                transition: 'outline-color 0.15s',
              }}
              onMouseEnter={e => { if (canEdit) (e.currentTarget as HTMLElement).style.outlineColor = 'rgba(184,146,47,0.35)'; }}
              onMouseLeave={e => { if (canEdit) (e.currentTarget as HTMLElement).style.outlineColor = 'transparent'; }}
            >
              {meta.title}
            </h1>
          )}

          {canEdit && editingPeriod ? (
            <input
              autoFocus
              value={periodDraft}
              onChange={e => setPeriodDraft(e.target.value)}
              onBlur={commitPeriod}
              onKeyDown={e => { if (e.key === 'Enter') commitPeriod(); if (e.key === 'Escape') { setPeriodDraft(meta.periodLabel); setEditingPeriod(false); } }}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: '1px solid var(--plan-accent)', outline: 'none',
                fontFamily: 'Georgia,serif', fontSize: '1.75rem', fontWeight: 600,
                color: 'var(--plan-accent)', letterSpacing: '0.05em',
                textAlign: 'center', width: '100%',
              }}
            />
          ) : (
            <p
              onClick={() => { if (canEdit) { setPeriodDraft(meta.periodLabel); setEditingPeriod(true); } }}
              title={canEdit ? 'Click to edit period / subtitle' : undefined}
              style={{
                margin: 0, fontFamily: 'Georgia,serif', fontSize: '1.75rem',
                color: 'var(--plan-accent)', fontWeight: 600, letterSpacing: '0.05em',
                cursor: canEdit ? 'text' : 'default',
                borderRadius: canEdit ? '4px' : undefined,
                padding: canEdit ? '0 4px' : undefined,
                outline: canEdit ? '2px solid transparent' : undefined,
                transition: 'outline-color 0.15s',
              }}
              onMouseEnter={e => { if (canEdit) (e.currentTarget as HTMLElement).style.outlineColor = 'rgba(184,146,47,0.35)'; }}
              onMouseLeave={e => { if (canEdit) (e.currentTarget as HTMLElement).style.outlineColor = 'transparent'; }}
            >
              {meta.periodLabel || (canEdit ? <span style={{ opacity: 0.35 }}>Click to add period / subtitle</span> : null)}
            </p>
          )}
        </div>

        {meta.approvalDate && (
          <p style={{ margin: 0, fontFamily: 'Georgia,serif', fontSize: '0.9rem', color: 'var(--plan-muted-fg)', letterSpacing: '0.04em' }}>
            Approved: {meta.approvalDate}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', justifyContent: 'center' }}>
          <div style={{ height: '2px', width: '4rem', background: 'linear-gradient(to right,var(--plan-accent),transparent)' }} />
          <span style={{ fontSize: '1.5rem', color: 'var(--plan-accent)' }}>◆</span>
          <div style={{ height: '2px', width: '4rem', background: 'linear-gradient(to left,var(--plan-accent),transparent)' }} />
        </div>

      </div>
    </div>
  )
}

// ─── TOC page ──────────────────────────────────────────────────────────────────

function TocPage({ chapters, pageNumbers, lang, mode }: {
  chapters: Chapter[]
  pageNumbers: Record<string, number>
  lang: 'en' | 'ar'
  mode: 'view' | 'edit' | 'print'
}) {
  return (
    <div className="print-page no-page-number" style={{ minHeight: '100vh', background: '#f5f4ef', padding: mode === 'print' ? '0 1in 1in' : '1.5in 1in 1in', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, insetInlineEnd: 0, width: '10rem', height: '10rem', borderInlineEnd: '2px solid var(--plan-accent)', borderTop: '2px solid var(--plan-accent)', opacity: 0.1 }} />
      <div style={{ position: 'absolute', bottom: 0, insetInlineStart: 0, width: '10rem', height: '10rem', borderInlineStart: '2px solid var(--plan-accent)', borderBottom: '2px solid var(--plan-accent)', opacity: 0.1 }} />
      <div style={{ position: 'relative', zIndex: 10 }}>
        <div style={{ marginBottom: '3rem', paddingBottom: '1.5rem', borderBottom: '2px solid var(--plan-accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ height: '6px', width: '3rem', background: 'linear-gradient(to right,var(--plan-navy),var(--plan-accent))' }} />
            <h2 style={{ margin: 0, fontFamily: 'Georgia,serif', fontSize: '2.5rem', fontWeight: 700, color: 'var(--plan-heading)' }}>{lang === 'ar' ? 'المحتويات' : 'Table of Contents'}</h2>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Preface is intentionally excluded from the TOC (still rendered in the body & export) */}
          {/* Numbered chapters */}
          {chapters.map(ch => (
            <div key={ch.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
                <span style={{ fontFamily: 'Georgia,serif', fontSize: '1.25rem', fontWeight: 700, color: 'var(--plan-accent)', flexShrink: 0, minWidth: '2.5rem' }}>{padNum(ch.number)}</span>
                <span style={{ flex: 1, fontFamily: 'Georgia,serif', fontSize: '1.1rem', fontWeight: 700, color: 'var(--plan-heading)', borderBottom: '1px dotted #94918a', paddingBottom: '2px' }}>{ch.title}</span>
                <a href={`#${ch.id}`} className="toc-pg" style={{ fontFamily: 'Georgia,serif', fontSize: '1rem', fontWeight: 600, color: 'var(--plan-body)', flexShrink: 0, paddingInlineStart: '0.5rem', textDecoration: 'none' }}>
                  <span>{pageNumbers[ch.id] ?? '—'}</span>
                </a>
              </div>
              {ch.sections.map((sub, idx) => (
                <div key={sub.id} style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginTop: '0.5rem', paddingInlineStart: '3.5rem' }}>
                  <span style={{ fontFamily: 'Georgia,serif', fontSize: '0.9rem', color: 'var(--plan-muted-fg)', flexShrink: 0, minWidth: '2.5rem' }}>{ch.number}.{idx + 1}</span>
                  <span style={{ flex: 1, fontFamily: 'Georgia,serif', fontSize: '0.9rem', color: 'var(--plan-body)', borderBottom: '1px dotted #c8c5bc', paddingBottom: '2px' }}>{sub.heading}</span>
                  <a href={`#${sub.id}`} className="toc-pg" style={{ fontFamily: 'Georgia,serif', fontSize: '0.875rem', color: 'var(--plan-muted-fg)', flexShrink: 0, paddingInlineStart: '0.5rem', textDecoration: 'none' }}>
                    <span>{pageNumbers[sub.id] ?? '—'}</span>
                  </a>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Preface section renderer (no chapter number, dean card, alignment) ────────

function PrefaceSection({
  sub, mode, onSelectBlock,
}: {
  sub: Subchapter
  mode: 'view' | 'edit' | 'print'
  onSelectBlock?: (id: string) => void
}) {
  const { editorApi } = useContext(EditCtx)
  const [align, setAlign] = React.useState<'left' | 'center' | 'right'>(
    (sub.textAlign as 'left' | 'center' | 'right') ?? 'left'
  )
  const isDeanMsg = sub.canonicalKey === 'dean_message'

  if (isDeanMsg) {
    return (
      <div id={sub.id} style={{ marginBottom: '3.5rem' }}>
        {/* Alignment toggle — edit mode only */}
        {mode === 'edit' && (
          <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.75rem', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }}>
            {(['left', 'center', 'right'] as const).map(a => (
              <button
                key={a}
                onClick={() => setAlign(a)}
                title={`Align ${a}`}
                style={{
                  padding: '0.2rem 0.55rem', fontSize: '0.65rem', borderRadius: 4,
                  border: '1px solid var(--plan-accent)',
                  background: align === a ? 'var(--plan-accent)' : 'transparent',
                  color: align === a ? '#0b0e1a' : 'var(--plan-accent)',
                  cursor: 'pointer', fontWeight: 700, letterSpacing: '0.03em',
                }}
              >
                {a === 'left' ? '← L' : a === 'center' ? '↔ C' : 'R →'}
              </button>
            ))}
          </div>
        )}

        {/* Letter heading */}
        <div style={{ textAlign: align, marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0, fontFamily: 'Georgia,serif', fontSize: '1.65rem', fontWeight: 700, color: 'var(--plan-heading)', display: 'inline-block' }}>
            {sub.heading}
          </h2>
          <div style={{ height: '3px', width: '3.5rem', background: 'var(--plan-accent)', marginTop: '0.4rem', marginLeft: align === 'center' ? 'auto' : undefined, marginRight: align === 'center' ? 'auto' : undefined, marginInlineStart: align === 'right' ? 'auto' : undefined }} />
        </div>

        {/* Letter body — aligned, with max-width in center mode */}
        <div style={{ textAlign: align, maxWidth: align === 'center' ? '44rem' : '100%', margin: align === 'center' ? '0 auto' : undefined }}>
          <EditCtx.Provider value={{ editorApi, chapterId: 'preface', subId: sub.id }}>
            <Blocks blocks={sub.blocks} mode={mode} onSelectBlock={onSelectBlock} />
          </EditCtx.Provider>
        </div>
      </div>
    )
  }

  // Prep team / Introduction: plain heading, no chapter number
  return (
    <EditCtx.Provider value={{ editorApi, chapterId: 'preface', subId: sub.id }}>
      <div id={sub.id} style={{ marginBottom: '2.5rem' }}>
        <div className="group/sub" style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontFamily: 'Georgia,serif', fontSize: '1.4rem', fontWeight: 600, color: 'var(--plan-heading)' }}>
            {sub.heading}
          </h3>
          {mode !== 'print' && sub.needsReview && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              background: 'rgba(245,158,11,0.12)', color: '#b45309',
              border: '1px solid rgba(245,158,11,0.35)', borderRadius: '9999px',
              padding: '0.15rem 0.6rem', fontSize: '0.7rem', fontWeight: 600,
            }}>
              ⚠ Needs review
            </span>
          )}
          {mode !== 'print' && sub.blocks.length > 0 && <SourceBadge blocks={sub.blocks} />}
        </div>
        <div style={{ height: '1px', background: 'linear-gradient(to right,var(--plan-accent),transparent)', marginBottom: '1.5rem' }} />
        <Blocks blocks={sub.blocks} mode={mode} onSelectBlock={onSelectBlock} />
      </div>
    </EditCtx.Provider>
  )
}


// ─── Chapter cover ─────────────────────────────────────────────────────────────

function ChapterCover({ chapter, rolledStatus, mode }: { chapter: Chapter; rolledStatus: 'auto' | 'edited' | 'verified'; mode: 'view' | 'edit' | 'print' }) {
  return (
    <div className="print-page chapter-page no-page-number" style={{ minHeight: '100vh', background: '#f5f4ef', position: 'relative', overflow: 'hidden', paddingTop: mode === 'print' ? 0 : '1.5in', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 0, insetInlineEnd: 0, width: '12rem', height: '12rem', borderInlineEnd: '4px solid var(--plan-accent)', borderTop: '4px solid var(--plan-accent)', opacity: 0.12 }} />
      <div style={{ position: 'absolute', bottom: 0, insetInlineStart: 0, width: '12rem', height: '12rem', borderInlineStart: '4px solid var(--plan-accent)', borderBottom: '4px solid var(--plan-accent)', opacity: 0.12 }} />
      <div style={{ position: 'relative', zIndex: 10, width: '78%', alignSelf: 'flex-start' }}>
        <div style={{ background: 'linear-gradient(135deg,#1e293b,#0f172a)', borderStartStartRadius: 0, borderEndStartRadius: 0, borderStartEndRadius: '1.75rem', borderEndEndRadius: '1.75rem', padding: '4rem 3.5rem', borderInlineStart: '6px solid var(--plan-accent)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, insetInlineEnd: 0, fontSize: '5rem', color: 'var(--plan-accent)', opacity: 0.05, fontFamily: 'Georgia,serif', lineHeight: 1 }}>◆</div>
          <div style={{ position: 'absolute', bottom: 0, insetInlineStart: 0, fontSize: '5rem', color: 'var(--plan-accent)', opacity: 0.05, fontFamily: 'Georgia,serif', lineHeight: 1 }}>◆</div>
          <div style={{ position: 'absolute', top: 0, insetInlineStart: 0, insetInlineEnd: 0, height: '3px', background: 'linear-gradient(to right,var(--plan-accent),transparent)' }} />
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <span style={{ fontFamily: 'Georgia,serif', fontSize: '5rem', fontWeight: 700, color: 'white', opacity: 0.95, lineHeight: 1 }}>{padNum(chapter.number)}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ height: '2px', width: '3rem', background: 'var(--plan-accent)' }} />
              <span style={{ color: 'var(--plan-accent)', fontSize: '1rem' }}>◆</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <h2 style={{ margin: 0, fontFamily: 'Georgia,serif', fontSize: '2.5rem', fontWeight: 700, color: 'white', lineHeight: 1.15 }}>
                {chapter.title.split(' ').slice(0, Math.ceil(chapter.title.split(' ').length / 2)).join(' ')}
              </h2>
              {chapter.title.split(' ').length > 1 && (
                <h3 style={{ margin: 0, fontFamily: 'Georgia,serif', fontSize: '2rem', fontWeight: 700, color: 'var(--plan-accent)', lineHeight: 1.15 }}>
                  {chapter.title.split(' ').slice(Math.ceil(chapter.title.split(' ').length / 2)).join(' ')}
                </h3>
              )}
            </div>
          </div>
        </div>
        {mode !== 'print' && (
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-start', paddingInlineStart: '0.5rem' }}>
            <StatusChip status={rolledStatus} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Subchapter section ────────────────────────────────────────────────────────

function SubchapterSection({ chapter, sub, idx, mode, onSelectBlock }: {
  chapter: Chapter
  sub: Subchapter
  idx: number
  mode: 'view' | 'edit' | 'print'
  onSelectBlock?: (id: string) => void
}) {
  const { editorApi } = useContext(EditCtx)
  const displayNum = `${chapter.number}.${idx + 1}`

  return (
    <EditCtx.Provider value={{ editorApi, chapterId: chapter.id, subId: sub.id }}>
      <div id={sub.id} style={{ marginBottom: '2.5rem' }}>
        {/* Subchapter heading */}
        <div className="group/sub" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, flexWrap: 'wrap' }}>
            <div style={{ height: '6px', width: '2rem', background: 'linear-gradient(to right,var(--plan-navy),var(--plan-accent))', flexShrink: 0 }} />
            <h3 style={{ margin: 0, fontFamily: 'Georgia,serif', fontSize: '1.5rem', fontWeight: 600, color: 'var(--plan-heading)' }}>
              <span style={{ color: 'var(--plan-accent)', marginInlineEnd: '0.5rem' }}>{displayNum}</span>
              {sub.heading}
            </h3>
            {mode !== 'print' && sub.needsReview && (
              <span
                title="This section contains content that may need updating before publication"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                  background: 'rgba(245,158,11,0.12)', color: '#b45309',
                  border: '1px solid rgba(245,158,11,0.35)', borderRadius: '9999px',
                  padding: '0.15rem 0.6rem', fontSize: '0.7rem', fontWeight: 600,
                  letterSpacing: '0.03em', flexShrink: 0,
                }}
              >
                ⚠ Needs review
              </span>
            )}
            {mode !== 'print' && sub.blocks.length > 0 && (
              <SourceBadge blocks={sub.blocks} />
            )}
          </div>
          {mode !== 'print' && <StatusChip status={sub.status} />}
        </div>
        <div style={{ height: '1px', background: 'linear-gradient(to right,var(--plan-accent),transparent)', marginBottom: '1.5rem' }} />

        {/* Blocks — always render Blocks in edit mode so AddBlockAffordance is always present */}
        {mode === 'edit'
          ? <Blocks blocks={sub.blocks} mode={mode} onSelectBlock={onSelectBlock} />
          : sub.blocks.length > 0
            ? <Blocks blocks={sub.blocks} mode={mode} onSelectBlock={onSelectBlock} />
            : (sub.generation === 'pending' || sub.generation === 'streaming') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[100, 80, 90].map((w, i) => (
                  <div key={i} className="skeleton" style={{ height: '1rem', width: `${w}%`, borderRadius: '4px' }} />
                ))}
              </div>
            )
        }

        {/* Approve button — edit mode only */}
        {mode === 'edit' && editorApi && sub.status !== 'verified' && (
          <button
            className="block-approve-btn mt-3 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20"
            onClick={(e) => { e.stopPropagation(); editorApi.approveSubchapter(chapter.id, sub.id); }}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Approve this section
          </button>
        )}
      </div>
    </EditCtx.Provider>
  )
}

// ─── Chapter content page ──────────────────────────────────────────────────────

function ChapterContent({ chapter, mode, onSelectBlock, marginPreset }: {
  chapter: Chapter
  mode: 'view' | 'edit' | 'print'
  onSelectBlock?: (id: string) => void
  marginPreset?: 'narrow' | 'normal'
}) {
  const { editorApi } = useContext(EditCtx)
  const padX = marginPreset === 'narrow' ? '0.5in' : '0.85in'

  return (
    <div style={{ maxWidth: '8.5in', margin: '0 auto', padding: `${mode === 'print' ? 0 : '0.65in'} ${padX} 0.8in` }}>
      {chapter.intro && chapter.intro.length > 0 && (
        <EditCtx.Provider value={{ editorApi, chapterId: chapter.id, subId: null }}>
          <div style={{ marginBottom: '2rem' }}>
            <Blocks blocks={chapter.intro} mode={mode} onSelectBlock={onSelectBlock} />
          </div>
        </EditCtx.Provider>
      )}
      {chapter.sections.map((sub, idx) => (
        <SubchapterSection key={sub.id} chapter={chapter} sub={sub} idx={idx} mode={mode} onSelectBlock={onSelectBlock} />
      ))}
    </div>
  )
}

// ─── Main Template ─────────────────────────────────────────────────────────────

export function Template({ doc, mode = 'view', onSelectBlock, pageNumbers = {}, editorApi, marginPreset = 'normal' }: TemplateProps) {
  const padX = marginPreset === 'narrow' ? '0.5in' : '0.85in'

  return (
    <EditCtx.Provider value={{ editorApi: editorApi ?? null, chapterId: '', subId: null }}>
      {doc.dir === 'rtl' && (
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');`}</style>
      )}
      <style>{`
        .plan-doc, .plan-doc * {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .plan-doc { font-size: 0.875rem; }
        @media print {
          @page { margin: 0; size: A4; }
          html, body { background: #f0ede5 !important; margin: 0 !important; overflow: visible !important; }
          .plan-running-header { height: 0.65in !important; }
          .plan-doc a { color: inherit !important; text-decoration: none !important; }
          .plan-doc table { font-size: 6.5pt !important; }
          .plan-doc th, .plan-doc td { padding: 3px 5px !important; }
        }
      `}</style>

      <div
        className="plan-doc"
        dir={doc.dir}
        style={{
          background: 'var(--plan-bg)',
          fontFamily: doc.dir === 'rtl' ? "'Cairo','Amiri',Georgia,serif" : "Georgia,'Times New Roman',serif",
        }}
      >
        <RunningHeader meta={doc.meta} mode={mode} marginPreset={marginPreset} />
        <CoverPage meta={doc.meta} mode={mode} />
        <TocPage
          chapters={doc.chapters}
          pageNumbers={pageNumbers}
          lang={doc.language}
          mode={mode}
        />

        {/* Preface sections — no chapter cover, no chapter number */}
        {doc.preface && doc.preface.length > 0 && (
          <div className="print-page" style={{ background: '#f5f4ef', minHeight: '100vh' }}>
            <div style={{ maxWidth: '8.5in', margin: '0 auto', padding: `${mode === 'print' ? '0.6in' : '0.65in'} ${padX} 0.8in` }}>
              {doc.preface.map(sub => (
                <PrefaceSection key={sub.id} sub={sub} mode={mode} onSelectBlock={onSelectBlock} />
              ))}
            </div>
          </div>
        )}

        {/* Numbered chapters */}
        {doc.chapters.map(ch => (
          <div key={ch.id} id={ch.id}>
            <ChapterCover chapter={ch} rolledStatus={chapterRolledStatus(ch)} mode={mode} />
            <div className="print-page" style={{ background: '#f5f4ef', minHeight: '100vh' }}>
              <ChapterContent chapter={ch} mode={mode} onSelectBlock={onSelectBlock} marginPreset={marginPreset} />
            </div>
          </div>
        ))}
      </div>
    </EditCtx.Provider>
  )
}
