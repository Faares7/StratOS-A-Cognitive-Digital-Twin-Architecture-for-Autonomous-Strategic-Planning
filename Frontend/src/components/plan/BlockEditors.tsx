"use client";

import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useContext } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold, Italic, Link2, Plus, ArrowUp, ArrowDown, Trash2,
  List, Table, Image as ImageIcon, AlignLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ParagraphBlock, ListBlock, TableBlock, ImageBlock, Block, RichText,
} from "@/types/plan-document";
import type { EditorApi } from "./EditorApi";
import { EditCtx } from "./EditorApi";
import { ActiveEditorCtx } from "./ActiveEditorCtx";

// ── Helpers ────────────────────────────────────────────────────────────────────

export function humanProv() {
  return { kind: "human" as const, editedAt: new Date().toISOString() };
}

export function rtToText(rt: RichText): string {
  if (!rt) return "";
  if (rt.type === "text") return rt.text ?? "";
  if (rt.type === "bulletList") {
    return (rt.content ?? [])
      .map(item => { const t = rtToText(item); return t ? `• ${t}` : ""; })
      .filter(Boolean)
      .join("\n");
  }
  if (rt.type === "orderedList") {
    return (rt.content ?? [])
      .map((item, i) => { const t = rtToText(item); return t ? `${i + 1}. ${t}` : ""; })
      .filter(Boolean)
      .join("\n");
  }
  return (rt.content ?? []).map(rtToText).join("");
}

export function textToRT(t: string): RichText {
  return { type: "text", text: t };
}

// ── Edit toolbar (move up / move down / delete) ────────────────────────────────

interface EditToolbarProps {
  blockId: string;
  editorApi: EditorApi;
  chapterId: string;
  subId: string | null;
}

export function EditToolbar({ blockId, editorApi, chapterId, subId }: EditToolbarProps) {
  return (
    <div className="edit-toolbar absolute -top-0.5 end-0 z-30 hidden group-hover:flex items-center gap-0.5 rounded-md border border-slate-700 bg-[#1a2030]/95 p-0.5 shadow-lg backdrop-blur-sm">
      <button
        title="Move up"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); editorApi.moveBlock(chapterId, subId, blockId, "up"); }}
        className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
      >
        <ArrowUp className="h-3 w-3" />
      </button>
      <button
        title="Move down"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); editorApi.moveBlock(chapterId, subId, blockId, "down"); }}
        className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
      >
        <ArrowDown className="h-3 w-3" />
      </button>
      <div className="h-3 w-px bg-slate-600" />
      <button
        title="Delete block"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); editorApi.deleteBlock(chapterId, subId, blockId); }}
        className="flex h-5 w-5 items-center justify-center rounded text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Add block affordance ───────────────────────────────────────────────────────

const BLOCK_KINDS: Array<{ kind: Block["type"]; Icon: React.ComponentType<{ className?: string }>; label: string }> = [
  { kind: "paragraph", Icon: AlignLeft, label: "Paragraph" },
  { kind: "list",      Icon: List,      label: "List"      },
  { kind: "table",     Icon: Table,     label: "Table"     },
  { kind: "image",     Icon: ImageIcon, label: "Image"     },
];

interface AddBlockProps {
  editorApi: EditorApi;
  chapterId: string;
  subId: string | null;
  afterBlockId?: string;
  atStart?: boolean;
}

export function AddBlockAffordance({ editorApi, chapterId, subId, afterBlockId, atStart }: AddBlockProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div
      ref={ref}
      className="add-block-affordance relative flex items-center py-1 opacity-0 hover:opacity-100 transition-opacity group/add"
    >
      <div className="h-px flex-1 bg-[#b8922f]/20 group-hover/add:bg-[#b8922f]/40 transition-colors" />
      <button
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
        className="mx-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#b8922f]/40 bg-[#f5f4ef] text-[#b8922f] hover:bg-[#b8922f]/10 shadow-sm transition-colors"
      >
        <Plus className="h-3 w-3" />
      </button>
      <div className="h-px flex-1 bg-[#b8922f]/20 group-hover/add:bg-[#b8922f]/40 transition-colors" />

      {open && (
        <div className="absolute top-7 left-1/2 z-40 flex -translate-x-1/2 gap-1 rounded-lg border border-slate-700 bg-[#1a2030] p-1 shadow-xl">
          {BLOCK_KINDS.map(({ kind, Icon, label }) => (
            <button
              key={kind}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                editorApi.addBlock(chapterId, subId, kind, afterBlockId, atStart);
                setOpen(false);
              }}
              className="flex flex-col items-center gap-1 rounded-md px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Paragraph editor (TipTap) ──────────────────────────────────────────────────

interface ParagraphEditorProps {
  block: ParagraphBlock;
  onUpdate: (next: ParagraphBlock) => void;
}

function TbBtn({
  active, onMouseDown, title, children,
}: { active: boolean; onMouseDown: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(); }}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded text-xs transition-colors",
        active
          ? "bg-[#b8922f]/20 text-[#b8922f]"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

export function ParagraphEditor({ block, onUpdate }: ParagraphEditorProps) {
  const [focused, setFocused] = useState(false);
  const { setActiveEditor } = useContext(ActiveEditorCtx);
  const { chapterId, subId } = useContext(EditCtx);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          strike: false,
          underline: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          link: { openOnClick: false },
        }),
      ],
      content: block.content,
      onUpdate: ({ editor }) => {
        onUpdate({ ...block, content: editor.getJSON() as RichText, provenance: humanProv() });
      },
    },
    [block.id],
  );

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    if (editor) setActiveEditor(editor, chapterId, subId);
  }, [editor, setActiveEditor, chapterId, subId]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    // Small delay so toolbar button clicks don't deregister before they fire
    setTimeout(() => setActiveEditor(null), 150);
  }, [setActiveEditor]);

  if (!editor) return null;

  const isEmpty = editor.isEmpty;

  return (
    <div className="relative" onFocus={handleFocus} onBlur={handleBlur}>
      {/* Formatting toolbar — visible on focus */}
      <div
        className={cn(
          "mb-1.5 flex items-center gap-0.5 rounded border border-slate-700 bg-[#1a2030]/90 p-0.5 w-fit transition-opacity",
          focused ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <TbBtn active={editor.isActive("bold")} onMouseDown={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <Bold className="h-3 w-3" />
        </TbBtn>
        <TbBtn active={editor.isActive("italic")} onMouseDown={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <Italic className="h-3 w-3" />
        </TbBtn>
        <TbBtn active={editor.isActive("link")} onMouseDown={setLink} title="Link">
          <Link2 className="h-3 w-3" />
        </TbBtn>
      </div>
      <div className={cn("relative rounded transition-all", focused ? "ring-1 ring-[#b8922f]/40" : "hover:ring-1 hover:ring-[#b8922f]/20")}>
        {isEmpty && !focused && (
          <div
            className="pointer-events-none absolute top-0 start-0 select-none italic text-[#a09890]"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1rem", lineHeight: 1.75 }}
          >
            Click to write…
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ── List editor ────────────────────────────────────────────────────────────────

interface ListEditorProps {
  block: ListBlock;
  onUpdate: (next: ListBlock) => void;
}

export function ListEditor({ block, onUpdate }: ListEditorProps) {
  const texts = block.items.map(rtToText);

  const update = (items: RichText[], extra?: Partial<ListBlock>) =>
    onUpdate({ ...block, items, provenance: humanProv(), ...extra });

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-[#78716c]">Style:</span>
        {(["bullet", "numbered"] as const).map((v) => {
          const isOrdered = v === "numbered";
          const active = block.ordered === isOrdered;
          return (
            <button
              key={v}
              onMouseDown={(e) => { e.preventDefault(); update(block.items, { ordered: isOrdered }); }}
              className={cn(
                "text-xs px-2 py-0.5 rounded border transition-colors",
                active
                  ? "border-[#b8922f]/50 bg-[#b8922f]/10 text-[#b8922f]"
                  : "border-white/10 text-[#78716c] hover:border-white/20",
              )}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          );
        })}
      </div>

      {texts.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-right text-xs text-[#78716c]">
            {block.ordered ? `${i + 1}.` : "•"}
          </span>
          <input
            type="text"
            value={t}
            onChange={(e) => {
              const next = [...block.items];
              next[i] = textToRT(e.target.value);
              update(next);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 border-b border-white/10 bg-transparent py-0.5 px-1 text-sm text-[#334155] outline-none focus:border-[#b8922f]/50"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          />
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); update(block.items.filter((_, j) => j !== i)); }}
            className="shrink-0 text-rose-400/60 hover:text-rose-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}

      <button
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); update([...block.items, textToRT("")]); }}
        className="mt-1 flex w-full items-center gap-1 border-t border-[#b8922f]/10 pt-1 text-xs text-[#78716c] hover:text-[#334155] transition-colors"
      >
        <Plus className="h-3 w-3" /> Add item
      </button>
    </div>
  );
}

// ── Auto-sizing cell textarea ──────────────────────────────────────────────────

interface CellAreaProps {
  value: string;
  onChange: (v: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  placeholder: string;
  className?: string;
  style?: React.CSSProperties;
}

function CellArea({ value, onChange, onMouseDown, onClick, placeholder, className, style }: CellAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Runs after every render — keeps height == content height with no scrollbar.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={onMouseDown}
      onClick={onClick}
      rows={1}
      placeholder={placeholder}
      className={cn("w-full resize-none overflow-hidden bg-transparent outline-none", className)}
      style={{ fontFamily: "Georgia, 'Times New Roman', serif", display: "block", ...style }}
    />
  );
}

// ── Table editor ───────────────────────────────────────────────────────────────

interface TableEditorProps {
  block: TableBlock;
  onUpdate: (next: TableBlock) => void;
}

export function TableEditor({ block, onUpdate }: TableEditorProps) {
  const hasHeader = block.header !== null;
  const colCount = hasHeader ? block.header!.length : (block.rows[0]?.length ?? 1);

  const update = (patch: Partial<TableBlock>) =>
    onUpdate({ ...block, ...patch, provenance: humanProv() });

  const setCell = (ri: number, ci: number, val: string) => {
    const rows = block.rows.map((r) => [...r]);
    rows[ri][ci] = textToRT(val);
    update({ rows });
  };

  const setHeaderCell = (ci: number, val: string) => {
    const h = [...(block.header ?? [])];
    h[ci] = val;
    update({ header: h });
  };

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#78716c]">
        <button
          onClick={(e) => {
            e.stopPropagation();
            update({ header: hasHeader ? null : Array.from({ length: colCount }, () => "") });
          }}
          className={cn("rounded border px-2 py-0.5 transition-colors", hasHeader ? "border-[#b8922f]/50 bg-[#b8922f]/10 text-[#b8922f]" : "border-white/10 hover:border-white/20")}
        >
          {hasHeader ? "Header on" : "Header off"}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const newHeader = hasHeader ? [...block.header!, ""] : null;
            const newRows = block.rows.map((r) => [...r, textToRT("")]);
            update({ header: newHeader, rows: newRows });
          }}
          className="rounded border border-white/10 px-2 py-0.5 hover:border-white/20 transition-colors"
        >+ Col</button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            update({ rows: [...block.rows, Array.from({ length: colCount }, () => textToRT(""))] });
          }}
          className="rounded border border-white/10 px-2 py-0.5 hover:border-white/20 transition-colors"
        >+ Row</button>
      </div>

      {/* Table grid */}
      <div className="rounded-lg border border-[#b8922f]/30">
        <table className="w-full text-sm" style={{ tableLayout: "fixed", borderCollapse: "collapse" }}>
          <colgroup>
            {Array.from({ length: colCount }, (_, i) => {
              const firstPct = colCount >= 5 ? 14 : colCount >= 3 ? 18 : 50;
              const otherPct = ((100 - firstPct) / Math.max(colCount - 1, 1)).toFixed(1);
              return <col key={i} style={{ width: i === 0 ? `${firstPct}%` : `${otherPct}%` }} />;
            })}
          </colgroup>
          {hasHeader && (
            <thead style={{ background: "#1e293b" }}>
              <tr>
                {block.header!.map((h, ci) => (
                  <th key={ci} className="p-0 align-top" style={{ wordBreak: "break-word" }}>
                    <div className="flex items-start">
                      <CellArea
                        value={h}
                        onChange={(v) => setHeaderCell(ci, v)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="Header"
                        className={cn(
                          "flex-1 px-3 py-2.5 text-left font-semibold text-white focus:bg-white/5",
                          colCount > 5 ? "text-[10px]" : colCount > 3 ? "text-xs" : "text-sm",
                        )}
                      />
                      {colCount > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            update({
                              header: block.header!.filter((_, i) => i !== ci),
                              rows: block.rows.map((r) => r.filter((_, i) => i !== ci)),
                            });
                          }}
                          className="mt-2.5 pr-2 text-white/40 hover:text-white/70 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="w-6" />
              </tr>
            </thead>
          )}
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-[#b8922f]/20 last:border-b-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="p-0 align-top" style={{ wordBreak: "break-word" }}>
                    <CellArea
                      value={rtToText(cell)}
                      onChange={(v) => setCell(ri, ci, v)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Cell"
                      className="px-3 py-2.5 text-[#334155] focus:bg-[#b8922f]/5"
                      style={{ fontSize: colCount > 4 ? "11px" : "13px" }}
                    />
                  </td>
                ))}
                <td className="w-6 p-0 align-middle">
                  {block.rows.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        update({ rows: block.rows.filter((_, i) => i !== ri) });
                      }}
                      className="px-1 text-rose-400/60 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Caption */}
      <input
        type="text"
        value={block.caption ?? ""}
        onChange={(e) => update({ caption: e.target.value || undefined })}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        placeholder="Caption (optional)"
        className="w-full border-b border-white/10 bg-transparent py-0.5 text-center text-xs italic text-[#78716c] outline-none focus:border-[#b8922f]/50"
        style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
      />
    </div>
  );
}

// ── Image editor ───────────────────────────────────────────────────────────────

interface ImageEditorProps {
  block: ImageBlock;
  onUpdate: (next: ImageBlock) => void;
}

export function ImageEditor({ block, onUpdate }: ImageEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<ImageBlock>) =>
    onUpdate({ ...block, ...patch, provenance: humanProv() });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update({ url: reader.result as string, alt: file.name.replace(/\.[^.]+$/, "") });
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {/* Image preview / pick */}
      <div
        className={cn(
          "relative cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-[#b8922f]/30 transition-colors hover:border-[#b8922f]/60",
          block.width === "half" ? "mx-auto max-w-sm" : "w-full",
        )}
        onClick={() => fileRef.current?.click()}
      >
        {block.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.url} alt={block.alt} className="w-full h-auto" />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-[#78716c]">
            <ImageIcon className="mb-2 h-8 w-8 opacity-40" />
            <span className="text-sm">Click to upload image</span>
          </div>
        )}
        {block.url && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 opacity-0 transition-opacity hover:opacity-100">
            <span className="text-sm font-medium text-white">Change image</span>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {(["alt", "caption"] as const).map((field) => (
          <div key={field}>
            <label className="mb-0.5 block text-[#78716c] capitalize">{field === "alt" ? "Alt text" : "Caption"}</label>
            <input
              type="text"
              value={field === "alt" ? block.alt : (block.caption ?? "")}
              onChange={(e) => update({ [field]: e.target.value || (field === "caption" ? undefined : "") })}
              placeholder={field === "alt" ? "Describe the image" : "Optional caption"}
              className="w-full border-b border-white/10 bg-transparent py-0.5 text-[#334155] outline-none focus:border-[#b8922f]/50"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            />
          </div>
        ))}
      </div>

      {/* Width toggle */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[#78716c]">Width:</span>
        {(["full", "half"] as const).map((w) => (
          <button
            key={w}
            onMouseDown={(e) => { e.preventDefault(); update({ width: w }); }}
            className={cn(
              "rounded border px-2 py-0.5 capitalize transition-colors",
              block.width === w
                ? "border-[#b8922f]/50 bg-[#b8922f]/10 text-[#b8922f]"
                : "border-white/10 text-[#78716c] hover:border-white/20",
            )}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
