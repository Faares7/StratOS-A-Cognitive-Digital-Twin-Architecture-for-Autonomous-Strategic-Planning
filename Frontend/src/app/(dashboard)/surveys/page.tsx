"use client";

import React, { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
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

type AnswerType =
  | "scale-1-5"
  | "strongly-agree-disagree"
  | "open-ended";

interface Question {
  id: string;
  text: string;
  answerType: AnswerType;
}

// ── Answer type config ─────────────────────────────────────────────────────────

const ANSWER_TYPES: { value: AnswerType; label: string; preview: string }[] = [
  { value: "scale-1-5",              label: "1–5 Scale",               preview: "① ② ③ ④ ⑤" },
  { value: "strongly-agree-disagree",label: "Strongly Agree – Disagree", preview: "SA  A  N  D  SD" },
  { value: "open-ended",             label: "Open Ended",              preview: "Free text response" },
];

const answerTypePreview: Record<AnswerType, string> = Object.fromEntries(
  ANSWER_TYPES.map((t) => [t.value, t.preview])
) as Record<AnswerType, string>;

const VALID_ANSWER_TYPE_SET = new Set<string>(ANSWER_TYPES.map((t) => t.value));
const normalizeAnswerType = (t: string): AnswerType =>
  VALID_ANSWER_TYPE_SET.has(t) ? (t as AnswerType) : "open-ended";

const AUDIENCE_LABELS: Record<string, string> = {
  "all-undergraduates": "All Undergraduates",
  "all-postgraduates": "All Postgraduates",
};

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
}: {
  state: WorkspaceState;
  onToggle: () => void;
  isLoading?: boolean;
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
        <Button
          variant="outline"
          onClick={onToggle}
          className="gap-2 border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-slate-100"
        >
          <Link2 className="h-3.5 w-3.5" />
          Connect Google Workspace
        </Button>
      ) : (
        <div className="flex items-center gap-3">
          <Badge variant="live" className="gap-1.5 px-3 py-1 text-xs font-medium">
            <span className="text-base leading-none">✅</span>
            Google Forms Linked
          </Badge>
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 text-xs text-slate-600 transition-colors hover:text-slate-400"
          >
            <Unlink className="h-3 w-3" />
            Disconnect
          </button>
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
}: ConfigPanelProps) {
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
        <div className="flex gap-2">
          <Select value={audience} onValueChange={setAudience}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-undergraduates">All Undergraduates</SelectItem>
              <SelectItem value="all-postgraduates">All Postgraduates</SelectItem>
              {customAudience.trim() && (
                <SelectItem value="custom">{customAudience}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <button
            onClick={() => setShowCustomAudience(!showCustomAudience)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Audience
          </button>
        </div>
        {showCustomAudience && (
          <Input
            autoFocus
            placeholder="e.g., MBA students, Year 3 Engineering..."
            value={customAudience}
            onChange={(e) => setCustomAudience(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customAudience.trim()) {
                setAudience("custom");
                setShowCustomAudience(false);
              }
              if (e.key === "Escape") setShowCustomAudience(false);
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

      {/* Specific Instructions */}
      <div className="space-y-2">
        <SectionLabel>Specific Instructions</SectionLabel>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g., Focus specifically on the quality of the new AI labs and the availability of teaching assistants."
          rows={5}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 transition-colors focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
        />
      </div>

      <Button onClick={onGenerate} disabled={isGenerating} className="mt-auto w-full gap-2 font-semibold">
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Drafting Survey…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Generate Survey Draft
          </>
        )}
      </Button>
    </div>
  );
}

// ── 3 & 4. Editor / Loading / Success Panel ────────────────────────────────────

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
  copied: boolean;
  formUrl: string;
  publishError: string | null;
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
  copied,
  formUrl,
  publishError,
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
              Configure your survey parameters and click{" "}
              <span className="text-slate-500">Generate Survey Draft</span> to
              produce AI-drafted questions ready for your review.
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
        <p className="text-[10px] text-slate-600">Edit wording and answer type per question</p>
      </div>

      {/* Question list */}
      <div className="space-y-3">
        {questions.map((q, idx) => (
          <div
            key={q.id}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-2.5"
          >
            {/* Question text row */}
            <div className="flex items-start gap-2.5">
              <span className="mt-2 w-5 shrink-0 text-right text-[11px] font-bold text-slate-600">
                {idx + 1}
              </span>
              <textarea
                value={q.text}
                onChange={(e) => onUpdateQuestion(q.id, e.target.value)}
                rows={2}
                placeholder="Enter your question here…"
                className="flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 transition-colors focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
              />
              <button
                onClick={() => onDeleteQuestion(q.id)}
                title="Delete question"
                className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Answer type row */}
            <div className="ml-7 flex items-center gap-2.5">
              <span className="shrink-0 text-[10px] font-medium text-slate-500">
                Answer type
              </span>
              <Select
                value={q.answerType}
                onValueChange={(v) => onUpdateAnswerType(q.id, v as AnswerType)}
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
          </div>
        ))}
      </div>

      {/* Add question */}
      <button
        onClick={onAddQuestion}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:border-cyan-500/25 hover:text-cyan-400"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Question
      </button>

      {/* Publish */}
      <div className="border-t border-white/5 pt-4 space-y-3">
        {publishError && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
            <span className="font-semibold">Publish failed: </span>{publishError}
          </div>
        )}
        <Button
          onClick={onPublish}
          disabled={workspace === "disconnected" || isPublishing || questions.length === 0}
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

export default function SurveysPage() {
  const { data: session, status } = useSession();
  const workspace: WorkspaceState = session ? "connected" : "disconnected";

  const [phase, setPhase] = useState<Phase>("idle");
  const [audience, setAudience] = useState("all-undergraduates");
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

  const getAudienceLabel = () =>
    audience === "custom"
      ? customAudience || "Custom Audience"
      : AUDIENCE_LABELS[audience] ?? audience;

  const handleGenerate = async () => {
    setPhase("generating");
    setGenerateError(null);

    try {
      const runRes = await fetch(`${BACKEND}/api/agents/survey/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: getAudienceLabel(),
          min_questions: minQ,
          max_questions: maxQ,
          instructions,
          current_weaknesses: [],
        }),
      });

      if (!runRes.ok) throw new Error(`Backend error ${runRes.status} — is the API server running?`);
      const { job_id } = await runRes.json();

      const poll = async (): Promise<void> => {
        const jobRes = await fetch(`${BACKEND}/api/jobs/${job_id}`);
        const job = await jobRes.json();

        if (job.status === "complete") {
          const qs: Question[] = (
            job.result.questions as { text: string; answer_type: string }[]
          ).map((q, i) => ({
            id: `${Date.now()}-${i}`,
            text: q.text,
            answerType: normalizeAnswerType(q.answer_type),
          }));
          setQuestions(qs);
          setPhase("editing");
        } else if (job.status === "failed") {
          setGenerateError(job.error ?? "Survey generation failed.");
          setPhase("idle");
        } else {
          await new Promise((r) => setTimeout(r, 1500));
          await poll();
        }
      };

      await new Promise((r) => setTimeout(r, 1500));
      await poll();
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Unknown error during generation."
      );
      setPhase("idle");
    }
  };

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
      if (!res.ok) throw new Error(data.error ?? "Publish failed.");

      setFormUrl(data.formUrl);
      setPhase("published");
    } catch (err) {
      setPublishError(
        err instanceof Error ? err.message : "Failed to publish survey."
      );
      setPhase("editing");
    }
  };

  const handleCopyLink = async () => {
    if (formUrl) {
      await navigator.clipboard.writeText(formUrl).catch(() => {});
    }
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
              setAudience={setAudience}
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
              copied={copied}
              formUrl={formUrl}
              publishError={publishError}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
