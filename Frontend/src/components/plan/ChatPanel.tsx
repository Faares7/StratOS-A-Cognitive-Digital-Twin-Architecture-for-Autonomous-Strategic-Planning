"use client";

import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import {
  Send, Plus, Copy, Check, MessageSquare, ImagePlus, X,
} from "lucide-react";
import type { PlanDocument, Provenance, Block } from "@/types/plan-document";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectedBlockInfo {
  blockId:    string;
  chapterId:  string;        // needed for editorApi.updateBlock
  subId:      string | null; // null = chapter intro
  heading:    string;
  blockType:  Block["type"];
  rawContent: string;        // blockToText output — what the LLM actually reads
  provenance: Provenance | null;
}

export interface ChatPanelHandle {
  injectText: (text: string) => void;
}

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id:              string;
  role:            ChatRole;
  text:            string;
  image?:          string;   // base64 data URL of an attached image (user messages)
  isDraft?:        boolean;
  // set when this message is a draft tied to a specific block
  targetBlockId?:  string;
  targetChapterId?: string;
  targetSubId?:    string | null;
  originalType?:   Block["type"];
}

/** Called by the editor page when the user clicks "Apply to document". */
export type ApplyDraftFn = (
  text:           string,
  targetBlockId:  string,
  targetChapterId: string,
  targetSubId:    string | null,
  originalType:   Block["type"]
) => void;

interface ChatPanelProps {
  selectedBlock:  SelectedBlockInfo | null;
  doc:            PlanDocument;
  onApplyDraft?:  ApplyDraftFn;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Per-document chat persistence (localStorage) ────────────────────────────────

const DEFAULT_WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "Hi! I'm your plan editing assistant.\n\nSelect any section in the document to see its sources, then ask me to explain, rewrite, or expand it. Use **+** to reference specific sections.",
};

const CHAT_STORAGE_KEY = (docId: string) => `stratos-plan-chat-${docId}`;

/**
 * Read an image file and downscale it to a bounded JPEG data URL.
 * Keeps base64 small enough for localStorage (~5 MB origin cap) and trims the
 * token cost of sending it to Gemini. Max edge 1024px, JPEG quality 0.8.
 */
function readAndDownscaleImage(file: File, maxEdge = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("no canvas ctx")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function loadChat(docId: string): ChatMessage[] {
  if (!docId || typeof window === "undefined") return [DEFAULT_WELCOME];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY(docId));
    if (raw) {
      const parsed = JSON.parse(raw) as ChatMessage[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch { /* ignore */ }
  return [DEFAULT_WELCOME];
}

function describeProvenance(prov: Provenance): string {
  if (prov.kind === "human") {
    return `Human edit on ${new Date(prov.editedAt).toLocaleDateString()}`;
  }
  if (prov.kind === "agent_signal") {
    const finding = prov.finding.length > 100 ? prov.finding.slice(0, 100) + "…" : prov.finding;
    return `${prov.agent} agent signal — ${finding}`;
  }
  if (prov.kind === "reference_plan") {
    return `Reference plan: "${prov.planTitle}", section: ${prov.sectionHeading}`;
  }
  if (prov.kind === "mixed") {
    return `Multiple sources: ${prov.sources.map(s => s.kind).join(", ")}`;
  }
  return "AI-generated from strategic signals";
}

async function callChatApi(
  message:       string,
  blockHeading:  string | null,
  blockContent:  string | null,   // actual serialised text of the selected block
  provenanceDesc: string | null,
  docTitle:      string,
  orgName:       string,
  history:       { role: ChatRole; content: string }[],
  image:         string | null,   // base64 data URL of an attached image
): Promise<string> {
  const res = await fetch("/api/plan-generation/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, blockHeading, blockContent, provenanceDesc, docTitle, orgName, history, image }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Chat error");
  return data.reply as string;
}

// ── Main component ─────────────────────────────────────────────────────────────

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({ selectedBlock, doc, onApplyDraft }, ref) {
  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_WELCOME]);
  const loadedDocIdRef = useRef<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [width, setWidth] = useState(340);
  const [pendingImage, setPendingImage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const prevBlockIdRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    injectText(text: string) {
      setInput(prev => (prev ? prev + "\n\n" + text : text));
      setTimeout(() => {
        inputRef.current?.focus();
        if (inputRef.current) {
          inputRef.current.scrollTop = inputRef.current.scrollHeight;
        }
      }, 50);
    },
  }), []);

  // No auto-resize — textarea stays fixed height to avoid layout reflow.

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load this document's persisted chat when the document changes
  useEffect(() => {
    const docId = doc.id;
    if (!docId || loadedDocIdRef.current === docId) return;
    loadedDocIdRef.current = docId;
    setMessages(loadChat(docId));
  }, [doc.id]);

  // Persist chat to localStorage whenever it changes, keyed by document id.
  // Skip the bare default so a not-yet-loaded panel can't clobber saved history.
  useEffect(() => {
    const docId = loadedDocIdRef.current;
    if (!docId) return;
    if (messages.length === 1 && messages[0].id === "welcome") return;
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY(docId), JSON.stringify(messages));
    } catch { /* ignore */ }
  }, [messages]);

  // Track block changes (used for mockResponse context only)
  useEffect(() => {
    if (!selectedBlock) return;
    prevBlockIdRef.current = selectedBlock.blockId;
  }, [selectedBlock]);

  // Close mention dropdown on outside click
  useEffect(() => {
    if (!mentionOpen) return;
    const handler = (e: MouseEvent) => {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        setMentionOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mentionOpen]);

  // Draggable panel width
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - ev.clientX;
      const next = Math.max(260, Math.min(560, dragRef.current.startWidth + delta));
      setWidth(next);
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [width]);

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";   // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    try {
      const dataUrl = await readAndDownscaleImage(file);
      setPendingImage(dataUrl);
    } catch {
      /* ignore unreadable image */
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    const image = pendingImage;
    if ((!text && !image) || loading) return;

    const uMsg: ChatMessage = { id: uid(), role: "user", text, image: image ?? undefined };
    setMessages(prev => [...prev, uMsg]);
    setInput("");
    setPendingImage(null);
    setLoading(true);

    try {
      const provenanceDesc = selectedBlock?.provenance
        ? describeProvenance(selectedBlock.provenance)
        : null;

      // Prior turns (excluding the welcome banner), capped to the last 20 to
      // bound token cost. `messages` here is the state before the new user turn.
      const history = messages
        .filter(m => m.id !== "welcome")
        .slice(-20)
        .map(m => ({ role: m.role, content: m.text }));

      const reply = await callChatApi(
        text || "(see attached image)",
        selectedBlock?.heading ?? null,
        selectedBlock?.rawContent ?? null,   // actual block text — the LLM reads this
        provenanceDesc,
        doc.meta.title,
        doc.meta.orgName,
        history,
        image,
      );

      const lower = text.toLowerCase();
      const isDraft =
        lower.includes("rewrite") || lower.includes("revise") ||
        lower.includes("formal")  || lower.includes("shorten") ||
        lower.includes("bullet")  || lower.includes("expand")  ||
        lower.includes("draft")   || lower.includes("summarise") ||
        lower.includes("summarize");

      setMessages(prev => [...prev, {
        id:              uid(),
        role:            "assistant",
        text:            reply,
        isDraft,
        // Bind this draft to the block that was selected at send time
        targetBlockId:   selectedBlock?.blockId,
        targetChapterId: selectedBlock?.chapterId,
        targetSubId:     selectedBlock?.subId,
        originalType:    selectedBlock?.blockType,
      }]);
    } catch {
      setMessages(prev => [
        ...prev,
        { id: uid(), role: "assistant", text: "Sorry, the assistant is temporarily unavailable. Please try again in a moment." },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleCopy = (id: string, text: string) => {
    const clean = text.replace(/\*\*/g, "").replace(/\[Draft\] /, "").replace(/\*Click.*\*$/, "").trim();
    navigator.clipboard.writeText(clean).catch(() => null);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const insertMention = (label: string) => {
    setInput(prev => prev + (prev.endsWith(" ") || prev === "" ? "" : " ") + `@${label} `);
    setMentionOpen(false);
    inputRef.current?.focus();
  };

  // Simple markdown: **bold**, newlines → <br>
  const renderText = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return (
        <span key={i}>
          {part.split("\n").map((line, j, arr) => (
            <React.Fragment key={j}>
              {line}
              {j < arr.length - 1 && <br />}
            </React.Fragment>
          ))}
        </span>
      );
    });
  };

  return (
    <aside
      className="plan-chat-panel relative flex h-full flex-col overflow-hidden border-s border-white/5 bg-[#0b0e1a]"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        className="absolute start-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyan-500/20 transition-colors z-10"
        onMouseDown={handleDragStart}
      />

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <MessageSquare className="h-3.5 w-3.5 text-cyan-400" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Plan Assistant
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-[#1e2535] px-3 py-2 text-xs text-slate-200 leading-relaxed">
                  {msg.image && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={msg.image}
                      alt="attachment"
                      className="mb-1.5 max-h-48 w-full rounded-md object-contain"
                    />
                  )}
                  {msg.text}
                </div>
              </div>
            );
          }

          // assistant
          return (
            <div key={msg.id} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                  <MessageSquare className="h-2.5 w-2.5 text-white" />
                </div>
                <div className="flex-1 rounded-lg rounded-tl-sm bg-[#131825] p-3 text-[12px] leading-relaxed text-slate-300">
                  {renderText(msg.text)}
                </div>
              </div>
              {msg.isDraft && (
                <div className="ms-7 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => handleCopy(msg.id, msg.text)}
                    className="flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 hover:border-white/20 hover:text-slate-200 transition-colors"
                  >
                    {copiedId === msg.id ? (
                      <><Check className="h-2.5 w-2.5 text-emerald-400" /> Copied</>
                    ) : (
                      <><Copy className="h-2.5 w-2.5" /> Copy</>
                    )}
                  </button>
                  {onApplyDraft && msg.targetBlockId && msg.targetChapterId !== undefined && (
                    <button
                      onClick={() => onApplyDraft(
                        msg.text,
                        msg.targetBlockId!,
                        msg.targetChapterId!,
                        msg.targetSubId ?? null,
                        msg.originalType ?? "paragraph",
                      )}
                      className="flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-400 hover:border-cyan-500/50 hover:bg-cyan-500/20 transition-colors"
                      title="Replace the selected block with this draft"
                    >
                      <Check className="h-2.5 w-2.5" /> Apply to document
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <MessageSquare className="h-2.5 w-2.5 text-white" />
            </div>
            <div className="rounded-lg rounded-tl-sm bg-[#131825] px-3 py-3 flex gap-1 items-center">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-cyan-400"
                  style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-white/5 p-3">
        {/* Pending image preview */}
        {pendingImage && (
          <div className="mb-2 inline-flex items-start gap-1 rounded-lg border border-white/10 bg-[#131825] p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingImage} alt="attachment preview" className="max-h-20 rounded object-contain" />
            <button
              onClick={() => setPendingImage(null)}
              className="flex h-4 w-4 items-center justify-center rounded-full bg-black/50 text-slate-300 hover:bg-black/70 hover:text-white transition-colors"
              title="Remove image"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border border-white/10 bg-[#131825] p-2 focus-within:border-cyan-500/30 transition-colors">
          {/* Hidden file input for image attachment */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePickImage}
          />

          {/* Attach image */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors"
            title="Attach an image"
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>

          {/* @ mention trigger */}
          <div className="relative" ref={mentionRef}>
            <button
              onClick={() => setMentionOpen(v => !v)}
              className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors"
              title="Reference a section"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            {mentionOpen && (
              <div className="absolute bottom-8 start-0 z-50 min-w-[220px] max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[#1a2030] p-1 shadow-xl">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                  Reference section
                </div>
                {doc.chapters.map((ch) => (
                  <React.Fragment key={ch.id}>
                    <button
                      onClick={() => insertMention(`Chapter ${ch.number}: ${ch.title}`)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-white/5 transition-colors"
                    >
                      <span className="shrink-0 text-[#b8922f] font-bold">{String(ch.number).padStart(2, "0")}</span>
                      <span className="truncate">{ch.title}</span>
                    </button>
                    {ch.sections.map((sub, idx) => (
                      <button
                        key={sub.id}
                        onClick={() => insertMention(`${ch.number}.${idx + 1}: ${sub.heading}`)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 ps-7 text-left text-xs text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors"
                      >
                        <span className="shrink-0">{ch.number}.{idx + 1}</span>
                        <span className="truncate">{sub.heading}</span>
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask me to explain, rewrite, or expand…"
            rows={3}
            className="flex-1 resize-none bg-transparent text-xs text-slate-200 placeholder-slate-600 outline-none leading-relaxed overflow-y-auto"
          />

          <button
            onClick={handleSend}
            disabled={(!input.trim() && !pendingImage) || loading}
            className="flex h-6 w-6 items-center justify-center rounded bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[9px] text-slate-700">
          Shift+Enter for new line · Enter to send
        </p>
      </div>
    </aside>
  );
});
