'use client'

import React, { useRef, useEffect, useState } from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil, Check } from 'lucide-react'
import type {
  ActionPlanDocument, ActionPlanMeta, ActivityRow,
} from '@/types/action-plan-document'

// ── Constants ──────────────────────────────────────────────────────────────────

const TABLE_HEADER_BG = '#bdd7ee'
const CELL_BORDER     = '1px solid #888'

const AR_ORDINALS: Record<number, string> = {
  1: 'الأولى', 2: 'الثانية', 3: 'الثالثة', 4: 'الرابعة',  5: 'الخامسة',
  6: 'السادسة', 7: 'السابعة', 8: 'الثامنة', 9: 'التاسعة', 10: 'العاشرة',
}

const COLUMNS_AR = ['الأهداف','الأنشطة التنفيذية','مؤشرات المتابعة','تم انجازه','جاري انجازه','أسباب عدم الإنجاز والإجراءات التصحيحية','التاريخ']
const COLUMNS_EN = ['Objectives','Executive Activities','Follow-up Indicators','Completed','In Progress','Reasons & Corrective Actions','Date']

function goalLabel(n: number, lang: 'en' | 'ar') {
  return lang === 'ar' ? `الغاية ${AR_ORDINALS[n] ?? n}` : `Goal ${n}`
}

// ── Api interface ──────────────────────────────────────────────────────────────

export interface ActionPlanApi {
  updateMeta(patch: Partial<ActionPlanMeta>): void
  updateSectionTitle(sectionId: string, title: string): void
  addSection(): void
  deleteSection(sectionId: string): void
  moveSection(sectionId: string, dir: 'up' | 'down'): void
  addObjectiveGroup(sectionId: string): void
  deleteObjectiveGroup(sectionId: string, groupId: string): void
  moveGroup(sectionId: string, groupId: string, dir: 'up' | 'down'): void
  updateObjective(sectionId: string, groupId: string, text: string): void
  addRow(sectionId: string, groupId: string): void
  deleteRow(sectionId: string, groupId: string, rowId: string): void
  moveRow(sectionId: string, groupId: string, rowId: string, dir: 'up' | 'down'): void
  updateRow(sectionId: string, groupId: string, rowId: string, field: keyof ActivityRow, value: string): void
}

export interface TemplateProps {
  doc:   ActionPlanDocument
  mode?: 'view' | 'edit' | 'print'
  api?:  ActionPlanApi
}

// ── Auto-resize textarea cell ─────────────────────────────────────────────────

function Cell({
  value, onChange, mode, placeholder, bold, lang,
}: {
  value:        string
  onChange?:    (v: string) => void
  mode:         'view' | 'edit' | 'print'
  placeholder?: string
  bold?:        boolean
  lang:         'en' | 'ar'
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const font = lang === 'ar'
    ? "'Cairo', 'Amiri', Georgia, sans-serif"
    : "Georgia, 'Times New Roman', serif"

  const tdStyle: React.CSSProperties = {
    border:        CELL_BORDER,
    padding:       mode === 'edit' ? '2px 4px' : '6px 8px',
    verticalAlign: 'middle',
    textAlign:     lang === 'ar' ? 'center' : 'left',
    whiteSpace:    'pre-wrap',
    fontWeight:    bold ? 700 : 400,
    background:    'var(--plan-bg)',
    lineHeight:    1.5,
    color:         'var(--plan-body)',
    fontFamily:    font,
    fontSize:      mode === 'print' ? '9pt' : '11px',
  }

  if (mode === 'edit' && onChange) {
    return (
      <td style={tdStyle}>
        <textarea
          ref={ref}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={1}
          style={{
            resize:     'none',
            overflow:   'hidden',
            minHeight:  '1.8rem',
            width:      '100%',
            background: 'transparent',
            border:     'none',
            outline:    'none',
            fontFamily: font,
            fontSize:   'inherit',
            textAlign:  lang === 'ar' ? 'center' : 'left',
            direction:  lang === 'ar' ? 'rtl' : 'ltr',
            fontWeight: bold ? 700 : 400,
            color:      'var(--plan-body)',
          }}
        />
      </td>
    )
  }

  return <td style={tdStyle}>{value}</td>
}

// ── Small icon button (always renders, UI-only — always English) ──────────────

function IconBtn({ onClick, title, color = 'text-slate-400', children }: {
  onClick:  () => void
  title:    string
  color?:   string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={`no-print flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-white/10 ${color}`}
    >
      {children}
    </button>
  )
}

// ── Running header ────────────────────────────────────────────────────────────

function RunningHeader({ meta, mode, api, lang }: {
  meta: ActionPlanMeta
  mode: 'view' | 'edit' | 'print'
  api?: ActionPlanApi
  lang: 'en' | 'ar'
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft,   setNameDraft]   = useState(meta.orgName)
  const isPrint = mode === 'print'
  const canEdit = mode === 'edit' && !!api

  useEffect(() => { setNameDraft(meta.orgName) }, [meta.orgName])

  const commitName = () => {
    const t = nameDraft.trim()
    if (t !== meta.orgName) api?.updateMeta({ orgName: t })
    else setNameDraft(meta.orgName)
    setEditingName(false)
  }

  return (
    <div
      className="plan-running-header"
      style={{
        position:     isPrint ? 'fixed' : 'sticky',
        top:          0,
        ...(isPrint ? { insetInlineStart: 0, insetInlineEnd: 0 } : {}),
        height:       '1.35in',
        zIndex:       50,
        background:   'var(--plan-bg)',
        borderBottom: '1px solid rgba(184,146,47,0.35)',
        display:      'flex',
        alignItems:   'center',
      }}
    >
      <div style={{
        direction:      'ltr',
        maxWidth:       '9.5in',
        margin:         '0 auto',
        padding:        '0 0.75in',
        width:          '100%',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            '1.5rem',
      }}>
        {/* Logo — left */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          {meta.orgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.orgLogoUrl} alt={meta.orgName} style={{ height: '4.4rem', width: 'auto', maxWidth: '22rem', objectFit: 'contain' }} />
          ) : (
            <div style={{
              width: '3rem', height: '3rem',
              background: 'linear-gradient(135deg,#1e293b,#0f172a)',
              borderRadius: '0.5rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: '1.25rem', fontWeight: 700,
              border: '2px solid var(--plan-accent)',
              opacity: 0.55,
            }}>
              {meta.orgName ? meta.orgName.charAt(0).toUpperCase() : '◆'}
            </div>
          )}
          {(meta.partnerLogoUrls ?? []).map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt={`Partner ${i + 1}`} style={{ height: '3.6rem', width: 'auto', objectFit: 'contain' }} />
          ))}
        </div>

        {/* Org name — right, double-click to edit */}
        <div style={{ flex: 1, textAlign: 'right' }}>
          {canEdit && editingName ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitName()
                  if (e.key === 'Escape') { setNameDraft(meta.orgName); setEditingName(false) }
                }}
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                style={{
                  background: 'transparent', border: 'none',
                  borderBottom: '1px solid var(--plan-accent)',
                  outline: 'none', color: 'var(--plan-accent)',
                  fontFamily: lang === 'ar' ? "'Cairo',Georgia,sans-serif" : "Georgia,serif",
                  fontSize: '1rem', fontWeight: 600, textAlign: 'right', minWidth: '8rem',
                }}
              />
              <button onClick={commitName} style={{ color: 'var(--plan-accent)', opacity: 0.7 }}>
                <Check style={{ width: '0.875rem', height: '0.875rem' }} />
              </button>
            </div>
          ) : (
            <div
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', cursor: canEdit ? 'text' : 'default' }}
              onDoubleClick={() => { if (canEdit) { setNameDraft(meta.orgName); setEditingName(true) } }}
              title={canEdit ? 'Double-click to edit org name' : undefined}
            >
              <span style={{
                color: 'var(--plan-accent)',
                fontFamily: lang === 'ar' ? "'Cairo',Georgia,sans-serif" : "Georgia,serif",
                fontSize: '1rem', fontWeight: 600, lineHeight: 1.35,
                direction: lang === 'ar' ? 'rtl' : 'ltr',
              }}>
                {meta.orgName || (canEdit ? <em style={{ opacity: 0.4, fontSize: '0.85rem' }}>Organization name</em> : '')}
              </span>
              {canEdit && <Pencil style={{ width: '0.625rem', height: '0.625rem', color: 'var(--plan-accent)', opacity: 0.4 }} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Cover page ────────────────────────────────────────────────────────────────

function CoverPage({ meta, mode, api, lang }: {
  meta: ActionPlanMeta
  mode: 'view' | 'edit' | 'print'
  api?: ActionPlanApi
  lang: 'en' | 'ar'
}) {
  const isPrint = mode === 'print'
  const canEdit = mode === 'edit' && !!api
  const docFont = lang === 'ar' ? "'Cairo','Amiri',Georgia,sans-serif" : "Georgia,'Times New Roman',serif"

  return (
    <div
      className="print-page no-page-number"
      style={{
        minHeight:      '100vh',
        background:     'var(--plan-bg)',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        position:       'relative',
        overflow:       'hidden',
        paddingTop:     isPrint ? 0 : '1.35in',
      }}
    >
      <div style={{ position: 'absolute', top: 32, insetInlineStart: 48, fontSize: '5rem', color: 'var(--plan-accent)', opacity: 0.05, fontFamily: 'Georgia,serif' }}>◆</div>
      <div style={{ position: 'absolute', bottom: 64, insetInlineEnd: 48, fontSize: '5rem', color: 'var(--plan-accent)', opacity: 0.05, fontFamily: 'Georgia,serif' }}>◆</div>

      <div style={{ maxWidth: '36rem', textAlign: 'center', position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '3rem', alignItems: 'center' }}>
        {/* Logo */}
        {meta.orgLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.orgLogoUrl} alt={meta.orgName} style={{ width: '26rem', maxWidth: '88%', height: 'auto', objectFit: 'contain' }} />
        ) : (
          <div style={{ width: '6rem', height: '6rem', background: 'linear-gradient(135deg,#1e293b,#0f172a)', borderRadius: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '2rem', fontWeight: 700, border: '2px solid var(--plan-accent)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            {meta.orgName ? meta.orgName.charAt(0).toUpperCase() : '◆'}
          </div>
        )}

        {/* Title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
          {canEdit ? (
            <input
              value={meta.title}
              onChange={e => api!.updateMeta({ title: e.target.value })}
              dir={lang === 'ar' ? 'rtl' : 'ltr'}
              style={{ fontFamily: docFont, fontSize: '2.75rem', fontWeight: 700, color: 'var(--plan-heading)', textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '1px dashed var(--plan-accent)', outline: 'none', lineHeight: 1.2, width: '100%' }}
            />
          ) : (
            <h1 style={{ margin: 0, fontFamily: docFont, fontSize: '3.5rem', fontWeight: 700, color: 'var(--plan-heading)', lineHeight: 1.1 }}>
              {meta.title}
            </h1>
          )}
          {canEdit ? (
            <input
              value={meta.subtitle}
              onChange={e => api!.updateMeta({ subtitle: e.target.value })}
              dir={lang === 'ar' ? 'rtl' : 'ltr'}
              style={{ fontFamily: docFont, fontSize: '1.5rem', fontWeight: 600, color: 'var(--plan-accent)', textAlign: 'center', background: 'transparent', border: 'none', borderBottom: '1px dashed rgba(184,146,47,0.4)', outline: 'none', letterSpacing: '0.03em', width: '100%' }}
            />
          ) : (
            <p style={{ margin: 0, fontFamily: docFont, fontSize: '1.75rem', color: 'var(--plan-accent)', fontWeight: 600, letterSpacing: '0.05em' }}>
              {meta.subtitle}
            </p>
          )}
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', justifyContent: 'center' }}>
          <div style={{ height: '2px', width: '4rem', background: 'linear-gradient(to right,var(--plan-accent),transparent)' }} />
          <span style={{ fontSize: '1.5rem', color: 'var(--plan-accent)' }}>◆</span>
          <div style={{ height: '2px', width: '4rem', background: 'linear-gradient(to left,var(--plan-accent),transparent)' }} />
        </div>

        <p style={{ margin: 0, fontFamily: docFont, fontSize: '1.25rem', color: 'var(--plan-body)', fontWeight: 600, direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
          {meta.orgName}
        </p>
      </div>
    </div>
  )
}

// ── Section table ─────────────────────────────────────────────────────────────

function SectionTable({ section, mode, api, sectionIdx, totalSections, lang }: {
  section:       ActionPlanDocument['sections'][number]
  mode:          'view' | 'edit' | 'print'
  api?:          ActionPlanApi
  sectionIdx:    number
  totalSections: number
  lang:          'en' | 'ar'
}) {
  const isEdit  = mode === 'edit'
  const isPrint = mode === 'print'
  const columns = lang === 'ar' ? COLUMNS_AR : COLUMNS_EN
  const docFont = lang === 'ar' ? "'Cairo','Amiri',Georgia,sans-serif" : "Georgia,'Times New Roman',serif"

  return (
    <div id={section.id} className="mb-10" style={{ pageBreakInside: 'avoid' }}>
      {isEdit && api && (
        <div className="no-print mb-1 flex items-center gap-1 justify-end">
          {sectionIdx > 0 && <IconBtn onClick={() => api.moveSection(section.id, 'up')} title="Move up" color="text-slate-500"><ArrowUp className="h-3 w-3" /></IconBtn>}
          {sectionIdx < totalSections - 1 && <IconBtn onClick={() => api.moveSection(section.id, 'down')} title="Move down" color="text-slate-500"><ArrowDown className="h-3 w-3" /></IconBtn>}
          <IconBtn onClick={() => { if (confirm('Delete this table?')) api.deleteSection(section.id) }} title="Delete table" color="text-rose-400"><Trash2 className="h-3 w-3" /></IconBtn>
        </div>
      )}

      <table
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        style={{
          borderCollapse: 'collapse',
          width:          '100%',
          fontFamily:     docFont,
          fontSize:       isPrint ? '9pt' : '12px',
          tableLayout:    'fixed',
        }}
      >
        <colgroup>
          <col style={{ width: '14%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '10%' }} />
          {isEdit && <col style={{ width: '28px' }} />}
        </colgroup>

        <thead>
          {/* Goal banner */}
          <tr>
            <th
              colSpan={isEdit ? 8 : 7}
              style={{
                background: TABLE_HEADER_BG,
                border:     CELL_BORDER,
                padding:    '10px 16px',
                textAlign:  'center',
                fontSize:   isPrint ? '11pt' : '14px',
                fontWeight: 700,
                fontFamily: docFont,
                color:      'var(--plan-heading)',
              }}
            >
              {isEdit && api ? (
                <div className="flex items-center justify-center gap-2">
                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {goalLabel(section.goalNumber, lang)}
                  </span>
                  <textarea
                    value={section.goalTitle}
                    onChange={e => api.updateSectionTitle(section.id, e.target.value)}
                    rows={1}
                    placeholder="Goal title"
                    style={{ flex: 1, resize: 'none', background: 'transparent', border: 'none', borderBottom: '1px dashed #888', outline: 'none', fontFamily: docFont, fontSize: 'inherit', fontWeight: 700, textAlign: 'center', direction: lang === 'ar' ? 'rtl' : 'ltr', color: 'var(--plan-heading)' }}
                  />
                </div>
              ) : (
                <span style={{ color: 'var(--plan-heading)' }}>
                  {goalLabel(section.goalNumber, lang)}
                  {section.goalTitle ? ` — ${section.goalTitle}` : ''}
                </span>
              )}
            </th>
          </tr>

          {/* Column headers */}
          <tr>
            {columns.map(h => (
              <th key={h} style={{ background: TABLE_HEADER_BG, border: CELL_BORDER, padding: '6px 8px', textAlign: 'center', fontWeight: 600, fontSize: isPrint ? '8.5pt' : '11px', fontFamily: docFont, color: 'var(--plan-heading)' }}>
                {h}
              </th>
            ))}
            {isEdit && <th style={{ background: TABLE_HEADER_BG, border: CELL_BORDER }} />}
          </tr>
        </thead>

        <tbody>
          {section.objectives.map((group, gIdx) => (
            <React.Fragment key={group.id}>
              {group.rows.length === 0 ? (
                <tr>
                  <td style={{ border: CELL_BORDER, padding: isEdit ? '4px' : '6px 8px', verticalAlign: 'middle', textAlign: 'center', fontWeight: 600, background: 'var(--plan-muted)', fontFamily: docFont, color: 'var(--plan-body)' }}>
                    {isEdit && api ? (
                      <div className="flex flex-col gap-1">
                        <div className="no-print flex justify-end gap-0.5">
                          {gIdx > 0 && <IconBtn onClick={() => api.moveGroup(section.id, group.id, 'up')} title="Move up" color="text-slate-500"><ArrowUp className="h-2.5 w-2.5" /></IconBtn>}
                          {gIdx < section.objectives.length - 1 && <IconBtn onClick={() => api.moveGroup(section.id, group.id, 'down')} title="Move down" color="text-slate-500"><ArrowDown className="h-2.5 w-2.5" /></IconBtn>}
                          <IconBtn onClick={() => { if (confirm('Delete this objective?')) api.deleteObjectiveGroup(section.id, group.id) }} title="Delete" color="text-rose-400"><Trash2 className="h-2.5 w-2.5" /></IconBtn>
                        </div>
                        <textarea value={group.objective} onChange={e => api.updateObjective(section.id, group.id, e.target.value)} placeholder="Objective" rows={2} style={{ resize: 'none', background: 'transparent', border: 'none', outline: 'none', fontFamily: docFont, fontSize: 'inherit', fontWeight: 600, textAlign: 'center', direction: lang === 'ar' ? 'rtl' : 'ltr', width: '100%', color: 'var(--plan-body)' }} />
                      </div>
                    ) : group.objective}
                  </td>
                  <td colSpan={isEdit ? 7 : 6} style={{ border: CELL_BORDER, padding: '8px', textAlign: 'center', color: 'var(--plan-muted-fg)', fontFamily: docFont, fontSize: '11px', background: 'var(--plan-bg)' }}>
                    No activities — click &quot;Add Activity&quot; below
                  </td>
                </tr>
              ) : (
                group.rows.map((row, rIdx) => (
                  <tr key={row.id}>
                    {rIdx === 0 && (
                      <td
                        rowSpan={group.rows.length}
                        style={{ border: CELL_BORDER, padding: isEdit ? '4px' : '6px 8px', verticalAlign: 'middle', textAlign: 'center', whiteSpace: 'pre-wrap', fontWeight: 600, background: 'var(--plan-muted)', fontFamily: docFont, color: 'var(--plan-body)' }}
                      >
                        {isEdit && api ? (
                          <div className="flex flex-col gap-1">
                            <div className="no-print flex justify-end gap-0.5">
                              {gIdx > 0 && <IconBtn onClick={() => api.moveGroup(section.id, group.id, 'up')} title="Move up" color="text-slate-500"><ArrowUp className="h-2.5 w-2.5" /></IconBtn>}
                              {gIdx < section.objectives.length - 1 && <IconBtn onClick={() => api.moveGroup(section.id, group.id, 'down')} title="Move down" color="text-slate-500"><ArrowDown className="h-2.5 w-2.5" /></IconBtn>}
                              <IconBtn onClick={() => { if (confirm('Delete this objective and all its activities?')) api.deleteObjectiveGroup(section.id, group.id) }} title="Delete objective" color="text-rose-400"><Trash2 className="h-2.5 w-2.5" /></IconBtn>
                            </div>
                            <textarea value={group.objective} onChange={e => api.updateObjective(section.id, group.id, e.target.value)} placeholder="Objective" rows={3} style={{ resize: 'none', background: 'transparent', border: 'none', outline: 'none', fontFamily: docFont, fontSize: 'inherit', fontWeight: 600, textAlign: 'center', direction: lang === 'ar' ? 'rtl' : 'ltr', width: '100%', color: 'var(--plan-body)' }} />
                          </div>
                        ) : group.objective}
                      </td>
                    )}
                    <Cell value={row.activities} onChange={api ? v => api.updateRow(section.id, group.id, row.id, 'activities', v) : undefined} mode={mode} placeholder="Activity" lang={lang} />
                    <Cell value={row.indicators}  onChange={api ? v => api.updateRow(section.id, group.id, row.id, 'indicators', v) : undefined} mode={mode} placeholder="Indicator"  lang={lang} />
                    <Cell value={row.completed}   onChange={api ? v => api.updateRow(section.id, group.id, row.id, 'completed',  v) : undefined} mode={mode} placeholder="Completed"  lang={lang} />
                    <Cell value={row.inProgress}  onChange={api ? v => api.updateRow(section.id, group.id, row.id, 'inProgress', v) : undefined} mode={mode} placeholder="In Progress" lang={lang} />
                    <Cell value={row.reasons}     onChange={api ? v => api.updateRow(section.id, group.id, row.id, 'reasons',    v) : undefined} mode={mode} placeholder="Reasons"     lang={lang} />
                    <Cell value={row.date}        onChange={api ? v => api.updateRow(section.id, group.id, row.id, 'date',       v) : undefined} mode={mode} placeholder="Date"        lang={lang} />
                    {isEdit && api && (
                      <td style={{ border: CELL_BORDER, padding: '2px', verticalAlign: 'middle', background: 'var(--plan-bg)' }} className="no-print">
                        <div className="flex flex-col items-center gap-0.5">
                          {rIdx > 0 && <IconBtn onClick={() => api.moveRow(section.id, group.id, row.id, 'up')} title="Move up" color="text-slate-500"><ArrowUp className="h-2.5 w-2.5" /></IconBtn>}
                          {rIdx < group.rows.length - 1 && <IconBtn onClick={() => api.moveRow(section.id, group.id, row.id, 'down')} title="Move down" color="text-slate-500"><ArrowDown className="h-2.5 w-2.5" /></IconBtn>}
                          <IconBtn onClick={() => api.deleteRow(section.id, group.id, row.id)} title="Delete row" color="text-rose-400"><Trash2 className="h-2.5 w-2.5" /></IconBtn>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}

              {isEdit && api && (
                <tr className="no-print">
                  <td colSpan={8} style={{ border: 'none', padding: '2px 0 4px' }}>
                    <button
                      onClick={() => api.addRow(section.id, group.id)}
                      className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-[#bdd7ee]/20 hover:text-slate-700 transition-colors"
                    >
                      <Plus className="h-3 w-3" /> Add Activity
                    </button>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}

          {isEdit && api && (
            <tr className="no-print">
              <td colSpan={8} style={{ border: 'none', padding: '4px 0 2px' }}>
                <button
                  onClick={() => api.addObjectiveGroup(section.id)}
                  className="flex items-center gap-1 rounded-md border border-dashed border-[#bdd7ee] px-3 py-1 text-[11px] text-blue-600 hover:bg-[#bdd7ee]/20 transition-colors w-full justify-center"
                >
                  <Plus className="h-3 w-3" /> Add Objective
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Template ─────────────────────────────────────────────────────────────

export function Template({ doc, mode = 'view', api }: TemplateProps) {
  const isEdit  = mode === 'edit'
  const isPrint = mode === 'print'
  const lang    = doc.language as 'en' | 'ar'

  return (
    <div
      className="plan-doc"
      dir={doc.dir}
      style={{ background: 'var(--plan-bg)', minHeight: '100%' }}
    >
      {!isPrint && <RunningHeader meta={doc.meta} mode={mode} api={api} lang={lang} />}

      <CoverPage meta={doc.meta} mode={mode} api={api} lang={lang} />

      <div style={{ maxWidth: '9.5in', margin: '0 auto', padding: isPrint ? '0.5in 0.7in' : '3rem 2.5rem' }}>
        {doc.sections.map((section, idx) => (
          <SectionTable
            key={section.id}
            section={section}
            mode={mode}
            api={api}
            sectionIdx={idx}
            totalSections={doc.sections.length}
            lang={lang}
          />
        ))}

        {isEdit && api && (
          <button
            onClick={() => api.addSection()}
            className="no-print mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#bdd7ee] py-4 text-sm text-blue-600 hover:bg-[#bdd7ee]/20 transition-colors"
          >
            <Plus className="h-4 w-4" /> Add Goal Table
          </button>
        )}
      </div>
    </div>
  )
}
