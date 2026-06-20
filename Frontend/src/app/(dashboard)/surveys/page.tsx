"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession, signIn, signOut } from "next-auth/react";
import { useRole } from "@/hooks/useRole";
import {
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  Copy,
  Check,
  ClipboardList,
  CheckCircle2,
  Unlink,
  Link2,
  ExternalLink,
  Upload,
  ArrowRight,
  FileText,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type WorkspaceState = "disconnected" | "connected";
type Phase = "idle" | "generating" | "editing" | "publishing" | "published";
type TemplateData = Record<string, string[]>;

type AnswerType =
  | "scale-1-5"
  | "strongly-agree-disagree"
  | "open-ended";

interface Question {
  id: string;
  text: string;
  answerType: AnswerType;
  pillar?: string;
}

// ── Answer type config ─────────────────────────────────────────────────────────

const ANSWER_TYPES: { value: AnswerType; label: string; preview: string }[] = [
  { value: "scale-1-5",               label: "1–5 Scale",                preview: "① ② ③ ④ ⑤" },
  { value: "strongly-agree-disagree", label: "Strongly Agree – Disagree", preview: "SA  A  N  D  SD" },
  { value: "open-ended",              label: "Open Ended",                preview: "Free text response" },
];

const answerTypePreview: Record<AnswerType, string> = Object.fromEntries(
  ANSWER_TYPES.map((t) => [t.value, t.preview])
) as Record<AnswerType, string>;

const VALID_ANSWER_TYPE_SET = new Set<string>(ANSWER_TYPES.map((t) => t.value));
const normalizeAnswerType = (t: string): AnswerType =>
  VALID_ANSWER_TYPE_SET.has(t) ? (t as AnswerType) : "open-ended";

// ── Template key → display label ──────────────────────────────────────────────

const formatTemplateKey = (key: string): string =>
  key.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// ── Google "G" icon (inline SVG) ───────────────────────────────────────────────

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ── Section label ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
      {children}
    </p>
  );
}

// ── 1. Google Workspace Card ───────────────────────────────────────────────────

function WorkspaceCard({
  state,
  onToggle,
  isLoading,
  readOnly,
}: {
  state: WorkspaceState;
  onToggle: () => void;
  isLoading?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/5 bg-[#0d1117] px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/5">
          <GoogleIcon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">Google Workspace</p>
          <p className="text-xs text-slate-500">Publish surveys directly to Google Forms</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking session…
        </div>
      ) : state === "disconnected" ? (
        readOnly ? null : (
          <Button
            variant="outline"
            onClick={onToggle}
            className="gap-2 border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-slate-100"
          >
            <Link2 className="h-3.5 w-3.5" />
            Connect Google Workspace
          </Button>
        )
      ) : (
        <div className="flex items-center gap-3">
          <Badge variant="live" className="gap-1.5 px-3 py-1 text-xs font-medium">
            <span className="text-base leading-none">✅</span>
            Google Forms Linked
          </Badge>
          {!readOnly && (
            <button
              onClick={onToggle}
              className="flex items-center gap-1.5 text-xs text-slate-600 transition-colors hover:text-slate-400"
            >
              <Unlink className="h-3 w-3" />
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── 2. Configuration Panel ─────────────────────────────────────────────────────

interface ConfigPanelProps {
  audience: string;
  setAudience: (v: string) => void;
  showCustomAudience: boolean;
  setShowCustomAudience: (v: boolean) => void;
  customAudience: string;
  setCustomAudience: (v: string) => void;
  minQ: number;
  setMinQ: (v: number) => void;
  maxQ: number;
  setMaxQ: (v: number) => void;
  instructions: string;
  setInstructions: (v: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  templateData: TemplateData;
  readOnly?: boolean;
}

function ConfigPanel({
  audience,
  setAudience,
  showCustomAudience,
  setShowCustomAudience,
  customAudience,
  setCustomAudience,
  minQ,
  setMinQ,
  maxQ,
  setMaxQ,
  instructions,
  setInstructions,
  onGenerate,
  isGenerating,
  templateData,
  readOnly,
}: ConfigPanelProps) {
  const templateKeys = Object.keys(templateData);

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-white/5 bg-[#0d1117] p-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Survey Configuration</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Define the parameters for your AI-generated survey.
        </p>
      </div>

      {/* Target Audience */}
      <div className="space-y-2">
        <SectionLabel>Target Audience</SectionLabel>
        <Select value={audience} onValueChange={setAudience}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select audience…" />
          </SelectTrigger>
          <SelectContent>
            {templateKeys.length > 0 ? (
              templateKeys.map((key) => (
                <SelectItem key={key} value={key}>
                  {formatTemplateKey(key)}
                </SelectItem>
              ))
            ) : (
              <>
                <SelectItem value="academic_programs">Academic Programs</SelectItem>
                <SelectItem value="faculty_satisfaction">Faculty Satisfaction</SelectItem>
              </>
            )}
            {customAudience.trim() && (
              <SelectItem value="custom">{customAudience}</SelectItem>
            )}
            <SelectItem value="__custom__">+ Add Custom Audience</SelectItem>
          </SelectContent>
        </Select>

        {(showCustomAudience || audience === "__custom__") && (
          <Input
            autoFocus
            placeholder="e.g., MBA students, Year 3 Engineering…"
            value={customAudience}
            onChange={(e) => setCustomAudience(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customAudience.trim()) {
                setAudience("custom");
                setShowCustomAudience(false);
              }
              if (e.key === "Escape") {
                setShowCustomAudience(false);
                if (audience === "__custom__") setAudience(templateKeys[0] ?? "academic_programs");
              }
            }}
            className="mt-1"
          />
        )}
      </div>

      {/* Question Range */}
      <div className="space-y-2">
        <SectionLabel>Question Range</SectionLabel>
        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[10px] text-slate-500">Min</span>
            <Input
              type="number"
              value={minQ}
              min={1}
              max={maxQ}
              onChange={(e) => setMinQ(Math.max(1, Number(e.target.value)))}
            />
          </div>
          <span className="mb-2.5 text-sm text-slate-600">—</span>
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[10px] text-slate-500">Max</span>
            <Input
              type="number"
              value={maxQ}
              min={minQ}
              onChange={(e) => setMaxQ(Math.max(minQ, Number(e.target.value)))}
            />
          </div>
        </div>
      </div>

      {/* Custom Prompt / Instructions */}
      <div className="space-y-2">
        <SectionLabel>Custom Prompt (optional)</SectionLabel>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g., Focus on the quality of the new AI labs and the availability of teaching assistants. Leave empty to load the standard template."
          rows={5}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 transition-colors focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
        />
      </div>

      <Button onClick={onGenerate} disabled={isGenerating || readOnly} className="mt-auto w-full gap-2 font-semibold">
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Drafting Survey…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Generate Survey via AI
          </>
        )}
      </Button>
    </div>
  );
}

// ── 3. Question Row (granular controls + inline tweak) ─────────────────────────

interface QuestionRowProps {
  q: Question;
  idx: number;
  onUpdate: (id: string, text: string) => void;
  onUpdateType: (id: string, type: AnswerType) => void;
  onDelete: (id: string) => void;
  onRegenerate: (id: string, instruction: string) => Promise<void>;
  readOnly?: boolean;
}

function QuestionRow({ q, idx, onUpdate, onUpdateType, onDelete, onRegenerate, readOnly }: QuestionRowProps) {
  const [tweakOpen, setTweakOpen] = useState(false);
  const [tweakInput, setTweakInput] = useState("");
  const [tweakLoading, setTweakLoading] = useState(false);

  const handleApply = async () => {
    if (!tweakInput.trim()) return;
    setTweakLoading(true);
    try {
      await onRegenerate(q.id, tweakInput);
      setTweakOpen(false);
      setTweakInput("");
    } finally {
      setTweakLoading(false);
    }
  };

  return (
    <div className="relative rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-2.5">
      {/* Per-row loading overlay */}
      {tweakLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/60 backdrop-blur-sm">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
        </div>
      )}

      {/* Question number + pillar badge + bilingual text area + action buttons */}
      <div className="flex items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-right text-[11px] font-bold text-slate-600">
          {idx + 1}
        </span>
        {q.pillar ? (
          <span className="mt-[7px] shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-cyan-500/15 text-cyan-400">
            {q.pillar}
          </span>
        ) : (
          <span className="mt-[7px] w-8 shrink-0" />
        )}
        <textarea
          value={q.text}
          onChange={(e) => !readOnly && onUpdate(q.id, e.target.value)}
          readOnly={readOnly}
          rows={3}
          placeholder="Enter your question here… (Arabic\nEnglish)"
          className={cn(
            "flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 transition-colors focus:outline-none",
            readOnly
              ? "cursor-default opacity-75"
              : "focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20"
          )}
          style={{ whiteSpace: "pre-wrap" }}
        />
        {!readOnly && (
          <div className="flex flex-col gap-1 mt-1">
            <button
              onClick={() => onDelete(q.id)}
              title="Delete question"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setTweakOpen((prev) => !prev)}
              title="Tweak with AI"
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                tweakOpen
                  ? "bg-cyan-500/15 text-cyan-400"
                  : "text-slate-600 hover:bg-cyan-500/10 hover:text-cyan-400"
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Answer type selector */}
      <div className="ml-[52px] flex items-center gap-2.5">
        <span className="shrink-0 text-[10px] font-medium text-slate-500">Type</span>
        <Select
          value={q.answerType}
          onValueChange={(v) => onUpdateType(q.id, v as AnswerType)}
          disabled={readOnly}
        >
          <SelectTrigger className="h-7 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANSWER_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="truncate font-mono text-[10px] text-slate-600">
          {answerTypePreview[q.answerType]}
        </span>
      </div>

      {/* Inline tweak row */}
      {tweakOpen && !readOnly && (
        <div className="ml-[52px] flex gap-2">
          <input
            autoFocus
            value={tweakInput}
            onChange={(e) => setTweakInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleApply(); }}
            placeholder="Tweak this question…"
            className="flex-1 rounded-lg border border-cyan-500/25 bg-white/5 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none"
          />
          <button
            onClick={handleApply}
            disabled={!tweakInput.trim() || tweakLoading}
            className="shrink-0 rounded-lg bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-400 transition-colors hover:bg-cyan-500/25 disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ── 4. Editor / Loading / Success Panel ───────────────────────────────────────

interface EditorPanelProps {
  phase: Phase;
  questions: Question[];
  workspace: WorkspaceState;
  onUpdateQuestion: (id: string, text: string) => void;
  onUpdateAnswerType: (id: string, type: AnswerType) => void;
  onDeleteQuestion: (id: string) => void;
  onAddQuestion: () => void;
  onPublish: () => void;
  onCopyLink: () => void;
  onRegenerateQuestion: (id: string, instruction: string) => Promise<void>;
  copied: boolean;
  formUrl: string;
  publishError: string | null;
  readOnly?: boolean;
}

function EditorPanel({
  phase,
  questions,
  workspace,
  onUpdateQuestion,
  onUpdateAnswerType,
  onDeleteQuestion,
  onAddQuestion,
  onPublish,
  onCopyLink,
  onRegenerateQuestion,
  copied,
  formUrl,
  publishError,
  readOnly,
}: EditorPanelProps) {
  // ── Idle ───────────────────────────────────────────────────────────────────
  if (phase === "idle") {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#0d1117]">
        <div className="flex flex-col items-center gap-3 px-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
            <ClipboardList className="h-7 w-7 text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-300">Human-in-the-Loop Editor</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Select an audience to instantly load bilingual template questions, or add a
              custom prompt and click{" "}
              <span className="text-slate-500">Generate Survey via AI</span> to draft new ones.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Generating ─────────────────────────────────────────────────────────────
  if (phase === "generating") {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-white/5 bg-[#0d1117] p-5">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
          <span className="text-sm font-semibold text-slate-300">
            AI is drafting your survey…
          </span>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="skeleton h-20 rounded-lg"
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Published ──────────────────────────────────────────────────────────────
  if (phase === "published") {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 animate-fade-in">
        <div className="flex max-w-sm flex-col items-center gap-5 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/15">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Survey Published Successfully</h3>
            <p className="mt-1.5 text-sm text-slate-500">
              Your survey is now live on Google Forms and ready to collect responses.
            </p>
          </div>
          <div className="w-full rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Survey Link
            </p>
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate font-mono text-sm text-cyan-400">
                {formUrl}
              </span>
              <button
                onClick={onCopyLink}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                  copied
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                )}
              >
                {copied ? (
                  <><Check className="h-3.5 w-3.5" />Copied!</>
                ) : (
                  <><Copy className="h-3.5 w-3.5" />Copy Link</>
                )}
              </button>
            </div>
          </div>
          <a
            href={formUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
          >
            <ExternalLink className="h-4 w-4" />
            Open Form
          </a>
        </div>
      </div>
    );
  }

  // ── Editing / Publishing ───────────────────────────────────────────────────
  const isPublishing = phase === "publishing";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/5 bg-[#0d1117] p-5 animate-fade-in">
      {/* Panel header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">Survey Draft</h3>
          <Badge variant="mock">{questions.length} questions</Badge>
        </div>
        <p className="text-[10px] text-slate-600">
          Edit wording, change type, or tweak any row with AI
        </p>
      </div>

      {/* Question list */}
      <div className="space-y-3">
        {questions.map((q, idx) => (
          <QuestionRow
            key={q.id}
            q={q}
            idx={idx}
            onUpdate={onUpdateQuestion}
            onUpdateType={onUpdateAnswerType}
            onDelete={onDeleteQuestion}
            onRegenerate={onRegenerateQuestion}
            readOnly={readOnly}
          />
        ))}
      </div>

      {/* Add question */}
      {!readOnly && (
        <button
          onClick={onAddQuestion}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:border-cyan-500/25 hover:text-cyan-400"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Question
        </button>
      )}

      {/* Publish */}
      <div className="border-t border-white/5 pt-4 space-y-3">
        {publishError && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
            <span className="font-semibold">Publish failed: </span>{publishError}
          </div>
        )}
        <Button
          onClick={onPublish}
          disabled={workspace === "disconnected" || isPublishing || questions.length === 0 || readOnly}
          className="w-full gap-2 bg-emerald-600 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {isPublishing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Publishing to Google Forms…
            </>
          ) : (
            <>
              <GoogleIcon className="h-4 w-4" />
              Publish to Google Forms
            </>
          )}
        </Button>
        {workspace === "disconnected" && !isPublishing && (
          <p className="mt-2 text-center text-xs text-slate-600">
            Connect Google Workspace above to enable publishing
          </p>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const BACKEND = "http://localhost:8000";


// ── CSV upload types ───────────────────────────────────────────────────────────

type CsvPhase = "idle" | "uploading" | "done" | "error";

interface CsvStats {
  total_responses: number;
  insights_extracted: number;
  strengths_found: number;
  weaknesses_found: number;
  message: string;
}

export default function SurveysPage() {
  const { data: session, status } = useSession();
  const { canMutate } = useRole();
  const workspace: WorkspaceState = session ? "connected" : "disconnected";

  // ── Template data ──────────────────────────────────────────────────────────
  const [templateData, setTemplateData] = useState<TemplateData>({});

  useEffect(() => {
    fetch(`${BACKEND}/api/survey/templates`)
      .then((r) => r.json())
      .then((data: TemplateData) => {
        setTemplateData(data);
        // Pre-select the first key so the dropdown has a valid default
        const firstKey = Object.keys(data)[0];
        if (firstKey) setAudience(firstKey);
      })
      .catch(() => {});
  }, []);

  // ── Survey state ───────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("idle");
  const [audience, setAudience] = useState("academic_programs");
  const [showCustomAudience, setShowCustomAudience] = useState(false);
  const [customAudience, setCustomAudience] = useState("");
  const [minQ, setMinQ] = useState(5);
  const [maxQ, setMaxQ] = useState(10);
  const [instructions, setInstructions] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [formUrl, setFormUrl] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── CSV upload state ───────────────────────────────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvPhase, setCsvPhase] = useState<CsvPhase>("idle");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvStats, setCsvStats] = useState<CsvStats | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // ── Reactive audience switch — instantly loads template questions ───────────
  const handleAudienceChange = (value: string) => {
    if (value === "__custom__") {
      setShowCustomAudience(true);
      return;
    }
    setAudience(value);
    if (value !== "custom" && templateData[value]) {
      const qs: Question[] = templateData[value].map((text, i) => ({
        id: `tmpl-${value}-${i}`,
        text,
        answerType: "strongly-agree-disagree" as AnswerType,
        pillar: `P${Math.floor(Math.random() * 7) + 1}`,
      }));
      setQuestions(qs);
      if (phase === "idle" || phase === "editing") setPhase("editing");
    }
  };

  const getAudienceLabel = () =>
    audience === "custom"
      ? customAudience || "Custom Audience"
      : formatTemplateKey(audience);

  // ── Generate via /api/survey/generate-full ─────────────────────────────────
  const handleGenerate = async () => {
    setPhase("generating");
    setGenerateError(null);

    try {
      const res = await fetch(`${BACKEND}/api/survey/generate-full`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience:     audience === "custom" ? (customAudience || "General audience") : formatTemplateKey(audience),
          audience_key: audience === "custom" ? "" : audience,
          custom_prompt: instructions,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `Backend error ${res.status}`);
      }

      type AiQuestion = { text: string; answer_type?: string; pillar?: string };
      const data = await res.json() as { questions: (AiQuestion | string)[]; source: string };
      const ts = Date.now();
      const qs: Question[] = data.questions.map((q, i) => {
        const isObj = typeof q === "object" && q !== null;
        return {
          id: `gen-${ts}-${i}`,
          text:       isObj ? (q as AiQuestion).text : String(q),
          answerType: (isObj ? (q as AiQuestion).answer_type : undefined) as AnswerType ?? "strongly-agree-disagree",
          pillar:     isObj ? (q as AiQuestion).pillar : undefined,
        };
      });
      setQuestions(qs);
      setPhase("editing");
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Unknown error during generation."
      );
      setPhase("idle");
    }
  };

  // ── Publish to Google Forms ────────────────────────────────────────────────
  const handlePublish = async () => {
    setPhase("publishing");
    setPublishError(null);

    try {
      const res = await fetch("/api/forms/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: questions.map((q) => ({ text: q.text, answerType: q.answerType })),
          title: `${getAudienceLabel()} Satisfaction Survey`,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Publish failed.");

      setFormUrl((data as { formUrl: string }).formUrl);
      setPhase("published");
    } catch (err) {
      setPublishError(
        err instanceof Error ? err.message : "Failed to publish survey."
      );
      setPhase("editing");
    }
  };

  const handleCopyLink = async () => {
    if (formUrl) await navigator.clipboard.writeText(formUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const updateQuestion = (id: string, text: string) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, text } : q)));

  const updateAnswerType = (id: string, answerType: AnswerType) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, answerType } : q)));

  const deleteQuestion = (id: string) =>
    setQuestions((prev) => prev.filter((q) => q.id !== id));

  const addQuestion = () =>
    setQuestions((prev) => [
      ...prev,
      { id: Date.now().toString(), text: "", answerType: "open-ended" },
    ]);

  // ── Inline AI question regeneration ───────────────────────────────────────
  const regenerateQuestion = async (id: string, instruction: string) => {
    const target = questions.find((q) => q.id === id);
    if (!target) return;

    const res = await fetch(`${BACKEND}/api/survey/regenerate-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_question: target.text,
        user_instruction: instruction,
      }),
    });

    if (!res.ok) throw new Error(`Regeneration failed (${res.status})`);
    const data = await res.json() as { question: string };
    if (data.question) {
      setQuestions((prev) =>
        prev.map((q) => (q.id === id ? { ...q, text: data.question } : q))
      );
    }
  };

  // ── CSV upload handler ─────────────────────────────────────────────────────
  const handleCsvUpload = async () => {
    if (!csvFile) return;
    setCsvPhase("uploading");
    setCsvError(null);

    const formData = new FormData();
    formData.append("file", csvFile);

    try {
      const res = await fetch(`${BACKEND}/api/survey/upload-csv`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { detail?: string }).detail ?? "Upload failed.");
      setCsvStats(data as CsvStats);
      setCsvPhase("done");
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setCsvPhase("error");
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <Header
        title="Survey Generation"
        subtitle="Configure and publish surveys to Google Forms"
      />

      <div className="flex flex-col gap-5 p-6">
        <WorkspaceCard
          state={workspace}
          isLoading={status === "loading"}
          readOnly={!canMutate}
          onToggle={() =>
            workspace === "connected"
              ? signOut({ redirect: false })
              : signIn("google")
          }
        />

        {generateError && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
            <span className="font-semibold">Generation failed: </span>
            {generateError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <ConfigPanel
              audience={audience}
              setAudience={handleAudienceChange}
              showCustomAudience={showCustomAudience}
              setShowCustomAudience={setShowCustomAudience}
              customAudience={customAudience}
              setCustomAudience={setCustomAudience}
              minQ={minQ}
              setMinQ={setMinQ}
              maxQ={maxQ}
              setMaxQ={setMaxQ}
              instructions={instructions}
              setInstructions={setInstructions}
              onGenerate={handleGenerate}
              isGenerating={phase === "generating"}
              templateData={templateData}
              readOnly={!canMutate}
            />
          </div>

          <div className="lg:col-span-3">
            <EditorPanel
              phase={phase}
              questions={questions}
              workspace={workspace}
              onUpdateQuestion={updateQuestion}
              onUpdateAnswerType={updateAnswerType}
              onDeleteQuestion={deleteQuestion}
              onAddQuestion={addQuestion}
              onPublish={handlePublish}
              onCopyLink={handleCopyLink}
              onRegenerateQuestion={regenerateQuestion}
              copied={copied}
              formUrl={formUrl}
              publishError={publishError}
              readOnly={!canMutate}
            />
          </div>
        </div>

        {/* ── CSV Upload Section — Editors and Admins only ─────────────────── */}
        {canMutate && <div className="rounded-xl border border-white/5 bg-[#0d1117] p-5 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
              <Upload className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">
                Upload Survey Responses (CSV)
              </p>
              <p className="text-xs text-slate-500">
                Import a Google Forms export to feed responses into the SWOT pipeline.
              </p>
            </div>
          </div>

          {/* ── Idle: file picker ── */}
          {(csvPhase === "idle" || csvPhase === "error") && (
            <div className="space-y-3">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setCsvFile(f); setCsvPhase("idle"); setCsvError(null); }
                }}
              />

              <button
                onClick={() => csvInputRef.current?.click()}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 text-left transition-all",
                  csvFile
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                )}
              >
                <FileText
                  className={cn(
                    "h-5 w-5 shrink-0",
                    csvFile ? "text-emerald-400" : "text-slate-500"
                  )}
                />
                {csvFile ? (
                  <div>
                    <p className="text-sm font-medium text-slate-200">{csvFile.name}</p>
                    <p className="text-xs text-slate-500">
                      {(csvFile.size / 1024).toFixed(1)} KB · CSV
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-slate-400">
                      Click to select a CSV file
                    </p>
                    <p className="text-xs text-slate-600">
                      Download from Google Forms → Responses → Export to Sheets → Download as CSV
                    </p>
                  </div>
                )}
              </button>

              {csvPhase === "error" && csvError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-400">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{csvError}</span>
                </div>
              )}

              <Button
                onClick={handleCsvUpload}
                disabled={!csvFile}
                className="w-full gap-2 font-semibold"
              >
                <Upload className="h-4 w-4" />
                Analyse Responses &amp; Push to SWOT
              </Button>
            </div>
          )}

          {/* ── Uploading / processing ── */}
          {csvPhase === "uploading" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-200">
                  Analysing {csvFile?.name ?? "responses"}…
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Running sentiment clustering via local LLM. This may take a few minutes.
                </p>
              </div>
              <div className="w-full max-w-sm space-y-2">
                {[80, 65, 72].map((w, i) => (
                  <div
                    key={i}
                    className="skeleton h-2.5 rounded-full"
                    style={{ width: `${w}%`, animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Success ── */}
          {csvPhase === "done" && csvStats && (
            <div className="flex flex-col items-center gap-5 py-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-100">✅ Analysis Complete!</p>
                <p className="mt-1 text-sm text-slate-400">{csvStats.message}</p>
              </div>

              <div className="flex gap-6">
                {[
                  { label: "Responses", value: csvStats.total_responses },
                  { label: "Insights",  value: csvStats.insights_extracted },
                  { label: "Strengths", value: csvStats.strengths_found },
                  { label: "Weaknesses",value: csvStats.weaknesses_found },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-lg font-bold text-slate-100">{value}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      {label}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Link
                  href="/swot"
                  className="flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
                >
                  View SWOT Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => {
                    setCsvPhase("idle");
                    setCsvFile(null);
                    setCsvStats(null);
                  }}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
                >
                  Upload Another
                </button>
              </div>
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
