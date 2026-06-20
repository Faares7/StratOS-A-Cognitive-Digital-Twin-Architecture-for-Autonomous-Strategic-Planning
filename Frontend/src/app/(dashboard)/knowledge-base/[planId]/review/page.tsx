"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
  Pencil,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import type { PlanSection, StructuredRow } from "@/app/api/knowledge-base/[planId]/sections/route";

// ── PDF viewer ────────────────────────────────────────────────────────────────
// Dynamic import so SSR never tries to load pdfjs
import dynamic from "next/dynamic";
const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false, loading: () => (
  <div className="flex h-full items-center justify-center text-slate-600 text-sm">
    Loading PDF viewer…
  </div>
) });

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanMeta {
  plan_id: string;
  title: string | null;
  period_label: string | null;
  extraction_status: string;
  signed_url: string | null;
}

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: PlanSection["status"] }) {
  const cls = {
    auto:     "bg-amber-500/10 text-amber-400 border-amber-500/20",
    edited:   "bg-violet-500/10 text-violet-400 border-violet-500/20",
    verified: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  }[status] ?? "bg-slate-500/10 text-slate-400 border-slate-500/20";

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls)}>
      {status}
    </span>
  );
}

// ── Structured-content grid (SWOT / gap) ──────────────────────────────────────

const SWOT_TYPE_OPTIONS = ["strength", "weakness", "opportunity", "threat", "gap"];

function StructuredGrid({
  rows,
  onChange,
  readonly,
}: {
  rows: StructuredRow[];
  onChange: (next: StructuredRow[]) => void;
  readonly: boolean;
}) {
  function addRow() {
    onChange([...rows, { criterion: `item_${rows.length + 1}`, type: "strength", text: "" }]);
  }
  function deleteRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function update<K extends keyof StructuredRow>(i: number, key: K, val: StructuredRow[K]) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[130px_110px_1fr] gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-1">
        <span>Criterion</span><span>Type</span><span>Text</span>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[130px_110px_1fr_28px] gap-1 items-start">
          <input
            className="rounded border border-white/10 bg-[#080a14] px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500/40 disabled:opacity-50"
            value={row.criterion}
            disabled={readonly}
            onChange={(e) => update(i, "criterion", e.target.value)}
          />
          <select
            className="rounded border border-white/10 bg-[#080a14] px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500/40 disabled:opacity-50"
            value={row.type}
            disabled={readonly}
            onChange={(e) => update(i, "type", e.target.value)}
          >
            {SWOT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <textarea
            className="rounded border border-white/10 bg-[#080a14] px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500/40 resize-y min-h-[56px] disabled:opacity-50"
            value={row.text}
            disabled={readonly}
            onChange={(e) => update(i, "text", e.target.value)}
          />
          {!readonly && (
            <button
              onClick={() => deleteRow(i)}
              className="mt-1 flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:text-rose-400 transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {!readonly && (
        <button
          onClick={addRow}
          className="mt-1 flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400 transition"
        >
          <Plus className="h-3.5 w-3.5" /> Add row
        </button>
      )}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

const STRUCTURED_KEYS = new Set(["swot_analysis", "gap_analysis"]);

function SectionCard({
  section,
  isAdmin,
  onScrollPdf,
  onSaved,
}: {
  section: PlanSection;
  isAdmin: boolean;
  onScrollPdf: (page: number | null) => void;
  onSaved: (updated: Partial<PlanSection>) => void;
}) {
  const [expanded,     setExpanded]     = useState(false);
  const [headingText,  setHeadingText]  = useState(section.heading_text ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [content,      setContent]      = useState(section.content ?? "");
  const [struct,       setStruct]       = useState<StructuredRow[]>(
    (section.structured_content as StructuredRow[] | null) ?? [],
  );
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState<string | null>(null);
  const isStructured = STRUCTURED_KEYS.has(section.canonical_key);

  const headingDirty = headingText !== (section.heading_text ?? "");
  const bodyDirty = isStructured
    ? JSON.stringify(struct) !== JSON.stringify(section.structured_content ?? [])
    : content !== (section.content ?? "");
  const isDirty = headingDirty || bodyDirty;

  async function save(newStatus?: "edited" | "verified") {
    setSaving(true);
    setSaveErr(null);
    try {
      const patch: Record<string, unknown> = {};
      if (headingDirty) patch.heading_text = headingText;
      if (isStructured) patch.structured_content = struct;
      else patch.content = content;
      if (newStatus) patch.status = newStatus;
      else if (isDirty && section.status === "auto") patch.status = "edited";

      const res = await fetch(
        `/api/knowledge-base/${section.plan_id}/sections/${section.section_id}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Save failed");
      }
      onSaved({ ...patch, status: (patch.status as PlanSection["status"]) ?? section.status });
      setEditingTitle(false);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        section.has_tables
          ? "border-amber-500/20 bg-amber-500/3"
          : "border-white/5 bg-[#0d1117]",
      )}
    >
      {/* Header */}
      <div
        className="flex w-full items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("input,button")) return;
          setExpanded((v) => !v);
          if (!expanded && section.page_start) onScrollPdf(section.page_start);
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isAdmin && editingTitle ? (
              <input
                autoFocus
                className="text-sm font-medium bg-transparent border-b border-cyan-500/50 text-slate-200 outline-none w-full"
                value={headingText}
                dir="rtl"
                onChange={(e) => setHeadingText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setHeadingText(section.heading_text ?? ""); setEditingTitle(false); } }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-sm font-medium text-slate-200 truncate">
                {headingText || section.canonical_key}
              </span>
            )}
            {isAdmin && !editingTitle && (
              <button
                onClick={(e) => { e.stopPropagation(); setEditingTitle(true); if (!expanded) setExpanded(true); }}
                className="text-slate-600 hover:text-cyan-400 transition shrink-0"
                title="Edit heading"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            <StatusChip status={section.status} />
            {section.flagged && (
              <span className="flex items-center gap-1 text-[10px] text-rose-400">
                <AlertCircle className="h-3 w-3" /> verify heading
              </span>
            )}
            {section.has_tables && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400">
                <TriangleAlert className="h-3 w-3" /> needs review
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5">
            {section.canonical_key}
            {section.page_start ? ` · p.${section.page_start}–${section.page_end ?? "?"}` : ""}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        )}
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-white/5 px-4 pb-4 pt-3 space-y-3">
          {isStructured ? (
            <StructuredGrid
              rows={struct}
              onChange={setStruct}
              readonly={!isAdmin}
            />
          ) : (
            <textarea
              className="w-full rounded-lg border border-white/10 bg-[#080a14] px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500/40 resize-y min-h-[120px] disabled:opacity-60"
              value={content}
              disabled={!isAdmin}
              onChange={(e) => setContent(e.target.value)}
              dir="rtl"
            />
          )}

          {saveErr && (
            <p className="text-xs text-rose-400">{saveErr}</p>
          )}

          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-xs"
                disabled={saving || !isDirty}
                onClick={() => save()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                disabled={saving}
                onClick={() => save("verified")}
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const params   = useParams<{ planId: string }>();
  const router   = useRouter();
  const { isAdmin } = useRole();

  const [plan,      setPlan]      = useState<PlanMeta | null>(null);
  const [sections,  setSections]  = useState<PlanSection[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [pdfPage,   setPdfPage]   = useState<number>(1);
  const [deleting,  setDeleting]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [planRes, secRes] = await Promise.all([
        fetch(`/api/knowledge-base/${params.planId}`),
        fetch(`/api/knowledge-base/${params.planId}/sections`),
      ]);
      if (!planRes.ok) throw new Error(`Plan HTTP ${planRes.status}`);
      if (!secRes.ok)  throw new Error(`Sections HTTP ${secRes.status}`);
      setPlan(await planRes.json() as PlanMeta);
      setSections(await secRes.json() as PlanSection[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [params.planId]);

  useEffect(() => { void load(); }, [load]);

  function handleSaved(sectionId: string, patch: Partial<PlanSection>) {
    setSections((prev) =>
      prev.map((s) => (s.section_id === sectionId ? { ...s, ...patch } : s)),
    );
  }

  async function handleDelete() {
    if (!confirm("Delete this plan and all its extracted sections? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/knowledge-base/${params.planId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      router.push("/knowledge-base");
    } catch {
      setDeleting(false);
      alert("Failed to delete plan. Please try again.");
    }
  }

  const subtitle = plan
    ? `${plan.title ?? "Untitled plan"}${plan.period_label ? ` · ${plan.period_label}` : ""}`
    : "Loading…";

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between pr-4">
        <Header title="Review / Edit Plan" subtitle={subtitle} />
        {isAdmin && plan && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 shrink-0"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete plan
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {error && (
        <div className="m-6 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs text-rose-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && plan && (
        <div className="flex flex-1 gap-0 overflow-hidden" style={{ height: "calc(100vh - 120px)" }}>
          {/* LEFT — PDF viewer (proxied through Next.js to avoid CORS with private bucket) */}
          <div className="relative flex-1 border-r border-white/5 overflow-hidden">
            <PdfViewer
              url={`/api/knowledge-base/${params.planId}/pdf`}
              targetPage={pdfPage}
            />
          </div>

          {/* RIGHT — Section editor */}
          <div className="w-[480px] shrink-0 overflow-y-auto px-4 py-4 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">
              {sections.length} sections · click to expand and edit
            </p>
            {sections.map((sec) => (
              <SectionCard
                key={sec.section_id}
                section={sec}
                isAdmin={isAdmin}
                onScrollPdf={(page) => page && setPdfPage(page)}
                onSaved={(patch) => handleSaved(sec.section_id, patch)}
              />
            ))}
            {sections.length === 0 && (
              <p className="text-center text-xs text-slate-600 py-8">
                {plan.extraction_status === "pending" || plan.extraction_status === "extracting"
                  ? "Extraction in progress…"
                  : "No sections found. Extraction may have failed."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
