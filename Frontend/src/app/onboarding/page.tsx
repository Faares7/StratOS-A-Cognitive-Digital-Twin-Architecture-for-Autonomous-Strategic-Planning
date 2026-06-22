"use client";

import React, { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Chrome,
  ExternalLink,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

// Constants

const STEP_LABELS = ["Context", "Integrations", "Profiling", "Upload"] as const;

const DEFAULT_PRIORITIES = [
  "Updating curriculum for market alignment",
  "Expanding postgraduate enrollment",
  "Boosting tech entrepreneurship & startups",
  "Faculty retention & capacity building",
  "Establishing international partnerships / Dual degrees",
];

const DEFAULT_PROGRAMS = [
  "Computer Science",
  "Artificial Intelligence",
  "Biomedical Informatics",
  "Professional / Big Data Diplomas",
];

const DEFAULT_RESEARCH = [
  "Bioinformatics & Medical Informatics",
  "Visual & Distributed Computing",
  "Text Mining & Artificial Intelligence",
  "Information Security",
];

// Types

interface ChecklistState {
  options: string[];
  selected: Set<string>;
}

function initChecklist(defaults: string[]): ChecklistState {
  return { options: defaults, selected: new Set(defaults) };
}

// Brand

function StratOSMark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 40 40" fill="none" className="h-8 w-8">
        <circle cx="20" cy="20" r="19" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="13" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="7" stroke="#c0392b" strokeWidth="2" />
        <circle cx="20" cy="20" r="3" fill="#c0392b" />
        <line x1="28" y1="12" x2="22" y2="18" stroke="#c0392b" strokeWidth="2.5" strokeLinecap="round" />
        <polygon points="32,8 28,12 32,16" fill="#c0392b" />
      </svg>
      <span className="text-xl font-bold tracking-tight text-slate-100">
        Strat<span className="text-red-500">OS</span>
      </span>
    </div>
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// Stepper

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-start">
      {STEP_LABELS.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-200",
                i < current
                  ? "border-[#b8922f] bg-[#b8922f] text-[#070911]"
                  : i === current
                  ? "border-[#b8922f] bg-[#b8922f]/10 text-[#b8922f]"
                  : "border-white/[0.09] bg-transparent text-[#2b2f45]"
              )}
            >
              {i < current ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={cn(
                "text-[10px] font-medium",
                i === current
                  ? "text-[#b8922f]"
                  : i < current
                  ? "text-[#8d97b8]"
                  : "text-[#2b2f45]"
              )}
            >
              {label}
            </span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div
              className={cn(
                "mx-3 mt-3.5 h-[2px] flex-1 rounded-full transition-all duration-500",
                i < current ? "bg-[#b8922f]" : "bg-white/[0.08]"
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// TextInput

function TextInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-lg border border-white/[0.09] bg-[#070911]",
          "px-3.5 py-2.5 text-[13px] text-[#e0e4ef] placeholder-[#2b2f45]",
          "outline-none transition-colors duration-150",
          "focus:border-[#b8922f]/40 focus:ring-1 focus:ring-[#b8922f]/15"
        )}
      />
    </div>
  );
}

// Step 1

function Step1Context({
  faculty,
  setFaculty,
  period,
  setPeriod,
}: {
  faculty: string;
  setFaculty: (v: string) => void;
  period: string;
  setPeriod: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Basic Structural Context</h2>
        <p className="mt-1 text-sm text-slate-500">
          Configure the planning scope and horizon for this workspace.
        </p>
      </div>
      <div className="space-y-4">
        <TextInput label="Faculty / Department" placeholder="e.g., ITCS" value={faculty} onChange={setFaculty} />
        <TextInput label="Strategic Period" placeholder="e.g., 2024-2027" value={period} onChange={setPeriod} />
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <p className="text-[12px] text-[#505672]">
          <span className="font-semibold text-[#8d97b8]">University:</span>{" "}
          Nile University — pre-configured for this single-tenant workspace.
        </p>
      </div>
    </div>
  );
}

// Step 2

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

function Step2Integrations({
  googleConnected,
  setGoogleConnected,
  fathomReady,
  setFathomReady,
}: {
  googleConnected: boolean;
  setGoogleConnected: (v: boolean) => void;
  fathomReady: boolean;
  setFathomReady: (v: boolean) => void;
}) {
  const { data: session } = useSession();
  const [handoffState, setHandoffState] = React.useState<"idle" | "loading" | "done" | "error">("idle");

  // Auto-detect: if the user is already signed in (session has access token),
  // push it to FastAPI immediately so no extra click is needed.
  React.useEffect(() => {
    if (!session?.accessToken || googleConnected) return;
    setHandoffState("loading");
    fetch(`${API_BASE}/api/auth/google/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token:  session.accessToken,
        refresh_token: (session as Record<string, unknown>).refreshToken ?? null,
        email:         session.user?.email ?? null,
      }),
    })
      .then((r) => {
        if (r.ok) { setGoogleConnected(true); setHandoffState("done"); }
        else setHandoffState("error");
      })
      .catch(() => setHandoffState("error"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Tool Integrations</h2>
        <p className="mt-1 text-sm text-slate-500">
          Connect your workspace tools to unlock the full StratOS feature set.
        </p>
      </div>

      <div className="rounded-xl border border-white/5 bg-[#080a14] p-5">
        <div className="mb-4 flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
            <GoogleLogo className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-slate-100">Google Workspace</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Required for <span className="text-slate-400">Survey Generation</span> (Google Forms) and{" "}
              <span className="text-slate-400">Meetings</span> calendar sync.
              Authorized once at login — no second sign-in needed.
            </p>
          </div>
        </div>
        {googleConnected ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected as {session?.user?.email}
            </span>
          </div>
        ) : handoffState === "loading" ? (
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Registering credentials…
          </span>
        ) : handoffState === "error" ? (
          <span className="text-xs text-rose-400">
            Could not reach the API. Make sure the backend is running, then refresh.
          </span>
        ) : (
          <span className="text-xs text-slate-500">Waiting for session…</span>
        )}
      </div>

      <div className="rounded-xl border border-[#b8922f]/12 bg-[#b8922f]/[0.04] p-5">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#b8922f]/70">
          Meetings Agent Prerequisite
        </p>
        <h3 className="mb-2 text-base font-semibold text-slate-100">Automate Your Meeting Notes</h3>
        <p className="mb-5 text-xs leading-relaxed text-slate-500">
          The Meetings Agent processes clean transcript data to generate AI summaries, action items, and key decisions.
          Complete <span className="text-slate-300">both steps</span> below so your Google Meet and Zoom sessions
          record, transcribe, and sync into StratOS automatically.
        </p>

        {/* Step 1 — Install */}
        <div className="flex gap-3.5">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[#b8922f]/35 text-[11px] font-bold text-[#b8922f]">
            1
          </div>
          <div className="flex-1 pb-5">
            <p className="text-sm font-medium text-slate-200">Install the Fathom extension</p>
            <p className="mb-3 mt-0.5 text-xs leading-relaxed text-slate-500">
              Adds recording and transcription controls directly inside Google Meet and Zoom.
            </p>
            <a
              href="https://chromewebstore.google.com/detail/fathom-ai-note-taker-for/nhocmlminaplaendbabmoemehbpgdemn"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-[#b8922f]/25 bg-[#b8922f]/10 px-4 py-2 text-[13px] font-medium text-[#b8922f] transition-colors duration-150 hover:border-[#b8922f]/40 hover:bg-[#b8922f]/15"
            >
              <Chrome className="h-4 w-4" />
              Add Fathom to Chrome
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          </div>
        </div>

        {/* Step 2 — Sign in with the same account */}
        <div className="flex gap-3.5">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[#b8922f]/35 text-[11px] font-bold text-[#b8922f]">
            2
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-200">Sign in to Fathom</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Open the extension and sign in with the{" "}
              <span className="font-semibold text-slate-300">same Google account</span> you used for StratOS. Fathom
              matches meetings to your workspace by email — a different login means your transcripts won&apos;t appear
              here.
            </p>
          </div>
        </div>

        {/* Account-match warning */}
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-300/90">
            The accounts <span className="font-semibold">must match</span>. If you sign in to Fathom with a personal
            or different account, the Meetings Agent will receive nothing.
          </p>
        </div>

        {/* Confirmation */}
        <button
          onClick={() => setFathomReady(!fathomReady)}
          className="mt-4 flex w-full items-start gap-3 rounded-lg border border-white/[0.07] bg-[#070911] px-3.5 py-3 text-left transition-colors duration-150 hover:border-white/[0.10]"
        >
          <div
            className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-all",
              fathomReady ? "border-emerald-500 bg-emerald-500" : "border-white/20 bg-transparent"
            )}
          >
            {fathomReady && <Check className="h-2.5 w-2.5 text-[#080a14]" strokeWidth={3} />}
          </div>
          <span className={cn("text-xs leading-relaxed", fathomReady ? "text-slate-200" : "text-slate-500")}>
            I&apos;ve installed Fathom and signed in with the same Google account.
          </span>
        </button>
      </div>
    </div>
  );
}

// ChecklistGroup

function ChecklistGroup({
  title,
  description,
  state,
  onToggle,
  onAdd,
}: {
  title: string;
  description: string;
  state: ChecklistState;
  onToggle: (item: string) => void;
  onAdd: (item: string) => void;
}) {
  const [inputVal, setInputVal] = useState("");

  function handleAdd() {
    const trimmed = inputVal.trim();
    if (!trimmed || state.options.includes(trimmed)) return;
    onAdd(trimmed);
    setInputVal("");
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#070911] p-4">
      <p className="mb-0.5 text-sm font-semibold text-slate-100">{title}</p>
      <p className="mb-3 text-xs text-slate-500">{description}</p>
      <div className="space-y-1.5">
        {state.options.map((opt) => {
          const checked = state.selected.has(opt);
          return (
            <div
              key={opt}
              onClick={() => onToggle(opt)}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
            >
              <div
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-all",
                  checked ? "border-[#b8922f] bg-[#b8922f]" : "border-white/[0.12] bg-transparent"
                )}
              >
                {checked && <Check className="h-2.5 w-2.5 text-[#070911]" strokeWidth={3} />}
              </div>
              <span className={cn("text-xs leading-relaxed", checked ? "text-slate-200" : "text-slate-500")}>
                {opt}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-3">
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="Add new option..."
          className={cn(
            "flex-1 rounded-lg border border-white/[0.09] bg-[#0f1422] px-3 py-1.5",
            "text-[12px] text-[#8d97b8] placeholder-[#2b2f45] outline-none",
            "focus:border-[#b8922f]/35 focus:ring-1 focus:ring-[#b8922f]/12"
          )}
        />
        <button
          onClick={handleAdd}
          disabled={!inputVal.trim()}
          className="flex items-center gap-1 rounded-lg border border-white/[0.09] px-3 py-1.5 text-[11px] text-[#505672] transition-colors duration-150 hover:border-[#b8922f]/30 hover:text-[#b8922f] disabled:pointer-events-none disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}

// Step 3

function Step3Profiling({
  period,
  priorityState,
  setPriorityState,
  programState,
  setProgramState,
  researchState,
  setResearchState,
}: {
  period: string;
  priorityState: ChecklistState;
  setPriorityState: React.Dispatch<React.SetStateAction<ChecklistState>>;
  programState: ChecklistState;
  setProgramState: React.Dispatch<React.SetStateAction<ChecklistState>>;
  researchState: ChecklistState;
  setResearchState: React.Dispatch<React.SetStateAction<ChecklistState>>;
}) {
  function makeToggler(setter: React.Dispatch<React.SetStateAction<ChecklistState>>) {
    return (item: string) =>
      setter((prev) => {
        const next = new Set(prev.selected);
        if (next.has(item)) next.delete(item);
        else next.add(item);
        return { ...prev, selected: next };
      });
  }

  function makeAdder(setter: React.Dispatch<React.SetStateAction<ChecklistState>>) {
    return (item: string) =>
      setter((prev) => ({
        options: [...prev.options, item],
        selected: new Set(Array.from(prev.selected).concat(item)),
      }));
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Workspace Profiling</h2>
        <p className="mt-1 text-sm text-slate-500">
          Select what applies to your department. Use{" "}
          <span className="text-slate-400">+ Add</span> at the bottom of each list to append custom entries.
        </p>
      </div>
      <ChecklistGroup
        title={period.trim() ? `Strategic Priorities (${period.trim()})` : "Strategic Priorities"}
        description="Priorities driving your department's strategic plan."
        state={priorityState}
        onToggle={makeToggler(setPriorityState)}
        onAdd={makeAdder(setPriorityState)}
      />
      <ChecklistGroup
        title="Active Academic Programs"
        description="Programs currently offered within your faculty."
        state={programState}
        onToggle={makeToggler(setProgramState)}
        onAdd={makeAdder(setProgramState)}
      />
      <ChecklistGroup
        title="Active Research Focus"
        description="Research areas your faculty is actively publishing in."
        state={researchState}
        onToggle={makeToggler(setResearchState)}
        onAdd={makeAdder(setResearchState)}
      />
    </div>
  );
}

// Step 4

function Step4Upload({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) setFile(dropped);
    },
    [setFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) setFile(selected);
    },
    [setFile]
  );

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Knowledge Base Upload</h2>
        <p className="mt-1 text-sm text-slate-500">
          Upload your core strategic plan document. StratOS indexes it to ground AI-generated insights in your
          institution's actual goals and KPIs.
        </p>
      </div>

      {file ? (
        <div className="flex items-center gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-100">{file.name}</p>
            <p className="text-xs text-slate-500">{formatSize(file.size)} · Ready to index</p>
          </div>
          <button
            onClick={() => setFile(null)}
            className="shrink-0 rounded-lg p-1.5 text-slate-600 transition hover:bg-white/5 hover:text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-all",
            dragging
              ? "border-cyan-500/50 bg-cyan-500/5"
              : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
          )}
        >
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl transition-colors", dragging ? "bg-cyan-500/10" : "bg-white/5")}>
            <Upload className={cn("h-5 w-5 transition-colors", dragging ? "text-cyan-400" : "text-slate-500")} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-300">
              {dragging ? "Drop to upload" : "Upload your Strategic Plan PDF"}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">Drag and drop or click to browse · PDF, DOCX, PPTX</p>
          </div>
        </div>
      )}

      <input ref={inputRef} type="file" accept=".pdf,.docx,.pptx" className="hidden" onChange={handleFileChange} />

      <p className="text-center text-xs text-slate-600">
        You can also skip this step and upload later from Settings - Knowledge Base.
      </p>
    </div>
  );
}

// Page

export default function OnboardingPage() {
  const router = useRouter();
  const { update } = useSession();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [faculty, setFaculty] = useState("");
  const [period, setPeriod] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [fathomReady, setFathomReady] = useState(false);

  const [priorityState, setPriorityState] = useState<ChecklistState>(() => initChecklist(DEFAULT_PRIORITIES));
  const [programState, setProgramState] = useState<ChecklistState>(() => initChecklist(DEFAULT_PROGRAMS));
  const [researchState, setResearchState] = useState<ChecklistState>(() => initChecklist(DEFAULT_RESEARCH));

  const [file, setFile] = useState<File | null>(null);

  const canProceed = step !== 0 || (faculty.trim() !== "" && period.trim() !== "");

  function handleNext() {
    if (step < 3) setStep((s) => s + 1);
  }

  async function handleComplete() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faculty,
          strategicPeriod:    period,
          selectedPriorities: Array.from(priorityState.selected),
          selectedPrograms:   Array.from(programState.selected),
          selectedResearch:   Array.from(researchState.selected),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed to save");
      }
      // Update the JWT so middleware sees profilingDone = true on the next request
      await update({ profilingDone: true });
      router.push("/dashboard");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#070911] px-6 py-14">
      <div className="mb-10">
        <StratOSMark />
      </div>

      <div className="w-full max-w-[680px] space-y-6">
        <div>
          <p className="mb-4 text-xs font-medium text-slate-600">
            Step {step + 1} of {STEP_LABELS.length}
          </p>
          <Stepper current={step} />
        </div>

        <div key={step} className="animate-fade-in rounded-xl border border-white/[0.07] bg-[#0f1422] p-7">
          {step === 0 && (
            <Step1Context faculty={faculty} setFaculty={setFaculty} period={period} setPeriod={setPeriod} />
          )}
          {step === 1 && (
            <Step2Integrations
              googleConnected={googleConnected}
              setGoogleConnected={setGoogleConnected}
              fathomReady={fathomReady}
              setFathomReady={setFathomReady}
            />
          )}
          {step === 2 && (
            <Step3Profiling
              period={period}
              priorityState={priorityState}
              setPriorityState={setPriorityState}
              programState={programState}
              setProgramState={setProgramState}
              researchState={researchState}
              setResearchState={setResearchState}
            />
          )}
          {step === 3 && <Step4Upload file={file} setFile={setFile} />}
        </div>

        {submitError && (
          <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-2.5 text-xs text-rose-400">
            {submitError}
          </p>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || submitting}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.09] px-4 py-2.5 text-[13px] font-medium text-[#505672] transition-colors duration-150 hover:border-white/[0.14] hover:text-[#8d97b8] disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            {step === 3 && !submitting && (
              <button
                onClick={handleComplete}
                className="text-sm text-slate-600 transition-colors hover:text-slate-400"
              >
                Skip upload
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={handleNext}
                disabled={!canProceed}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
                  canProceed
                    ? "bg-[#b8922f] text-[#070911] hover:bg-[#c9a84c]"
                    : "cursor-not-allowed bg-white/[0.04] text-[#2b2f45]"
                )}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={submitting}
                className="flex items-center gap-2 rounded-xl bg-[#b8922f] px-5 py-2.5 text-sm font-semibold text-[#070911] transition-colors duration-150 hover:bg-[#c9a84c] disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Complete Setup
                    <Sparkles className="h-4 w-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
