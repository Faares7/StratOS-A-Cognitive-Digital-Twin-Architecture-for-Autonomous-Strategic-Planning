"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Download, Play, Loader2, AlertCircle } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Header } from "@/components/layout/Header";
import { fetchResearchIntelligence } from "@/services/mockApi";
import { runAgentAndWait } from "@/services/agentApi";
import { useAgentResults } from "@/contexts/AgentResultsContext";
import type { ResearchIntelligence } from "@/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 12 distinct colours — enough for Nile U + up to 10 competitors
const COLORS = [
  "#22d3ee", "#f59e0b", "#f43f5e", "#10b981",
  "#a78bfa", "#fb923c", "#34d399", "#60a5fa",
  "#e879f9", "#facc15", "#4ade80", "#f87171",
];

function exportReportCsv(
  data: ResearchIntelligence,
  chartData: Record<string, number | string>[],
  allUniversities: string[],
  isLive: boolean,
) {
  const nu = data.nile_university;
  const rows: string[] = [];

  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const row = (...cols: (string | number)[]) => rows.push(cols.map(esc).join(","));

  row("RESEARCH INTELLIGENCE REPORT — Nile University");
  row("Generated", new Date().toLocaleString());
  row("Data Source", isLive ? "Live (OpenAlex)" : "Mock / Demo");
  rows.push("");

  row("--- NILE UNIVERSITY SUMMARY ---");
  row("Metric", "Value");
  row("Rank", nu.rank != null ? `#${nu.rank}` : "Not Ranked");
  row("Publications", nu.publications);
  row("H-Index", nu.h_index);
  row("Total Citations", nu.total_citations);
  rows.push("");

  row("--- COMPETITOR RANKINGS ---");
  row("Rank", "University", "Publications", "H-Index", "Total Citations");

  const all = [data.nile_university, ...data.competitors].sort(
    (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999)
  );
  all.forEach((u) => {
    row(u.rank != null ? `#${u.rank}` : "—", u.university_name, u.publications, u.h_index, u.total_citations);
  });
  rows.push("");

  row("--- HISTORICAL TREND ---");
  row("Year", ...allUniversities);
  chartData.forEach((entry) => {
    row(entry.year, ...allUniversities.map((name) => entry[name] ?? 0));
  });

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `research-intelligence-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResearchPage() {
  const { results, setResearch } = useAgentResults();
  const [mockData, setMockData]   = useState<ResearchIntelligence | null>(null);
  const [loading, setLoading]     = useState(true);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentError, setAgentError]     = useState<string | null>(null);

  // Prefer persisted live data from context; fall back to mock
  const data = results.research ?? mockData;
  const isLive = data?.data_source === "live";

  useEffect(() => {
    fetchResearchIntelligence().then(setMockData).finally(() => setLoading(false));
  }, []);

  const runBenchmark = useCallback(async () => {
    setAgentRunning(true);
    setAgentError(null);
    try {
      const result = await runAgentAndWait("benchmark", {
        intervalMs: 5_000,
        timeoutMs: 900_000, // 15 min — fetches 50+ universities
      }) as ResearchIntelligence;
      if (result) setResearch(result); // persist to global context → survives navigation
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Benchmark agent failed");
    } finally {
      setAgentRunning(false);
    }
  }, [setResearch]);

  const nu = data?.nile_university;
  const notRanked = !nu || nu.publications === 0;

  const years = [2019, 2020, 2021, 2022, 2023, 2024];

  const chartData = years.map((year) => {
    const entry: Record<string, number | string> = { year };

    // Competitors
    data?.competitors.forEach((c) => {
      const pt = c.h_index_history.find((h) => h.year === year);
      entry[c.university_name] = pt?.value ?? 0;
    });

    // ── BUG FIX: was hardcoded `entry["Nile University"] = 0` ──────────────
    const nuPt = data?.nile_university?.h_index_history?.find((h) => h.year === year);
    entry["Nile University"] = nuPt?.value ?? 0;

    return entry;
  });

  // Nile University is always the first line so it uses COLORS[0] (cyan)
  const allUniversities = [
    "Nile University",
    ...(data?.competitors.map((c) => c.university_name) ?? []),
  ];

  return (
    <div className="flex min-h-full flex-col">
      <Header
        title="Research Intelligence"
        subtitle="Performance comparison with top Egyptian universities"
      />

      <div className="flex flex-col gap-5 p-6">
        {/* Benchmark Agent trigger */}
        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-[#0d1117] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-200">OpenAlex Benchmark Scan</p>
            <p className="text-xs text-slate-500">
              Fetches live research metrics for all Egyptian universities · Results persist across pages
            </p>
          </div>
          <button
            onClick={runBenchmark}
            disabled={agentRunning}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-medium transition-all",
              agentRunning
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan-500/30 hover:text-slate-100 disabled:opacity-40"
            )}
          >
            {agentRunning ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running — this may take several minutes…
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                {isLive ? "Re-run Benchmark" : "Run Live Benchmark"}
              </>
            )}
          </button>
        </div>

        {agentError && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span><span className="font-semibold">Agent error: </span>{agentError}</span>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Nile University Rank", value: notRanked ? "#—" : nu?.rank != null ? `#${nu.rank}` : "#—", sub: `of ${data?.competitors.length ?? 0} universities` },
            { label: "Publications", value: (nu?.publications ?? 0).toLocaleString(), sub: "total papers" },
            { label: "H-Index", value: nu?.h_index ?? 0 },
            { label: "Total Citations", value: (nu?.total_citations ?? 0).toLocaleString() },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-white/5 bg-[#0d1117] p-4">
              <p className="text-xs text-slate-500">{kpi.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-100">{kpi.value}</p>
              {kpi.sub && <p className="text-[10px] text-slate-600">{kpi.sub}</p>}
            </div>
          ))}
        </div>

        {/* Legend bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-4 py-2.5 text-xs text-slate-400">
          <span>Comparing:</span>
          {allUniversities.map((name, i) => (
            <span
              key={name}
              className="flex items-center gap-1.5 rounded-full px-2 py-0.5"
              style={{
                background: `${COLORS[i % COLORS.length]}18`,
                border: `1px solid ${COLORS[i % COLORS.length]}40`,
                color: COLORS[i % COLORS.length],
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              {name}
            </span>
          ))}
          {isLive && (
            <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-400">
              Live — OpenAlex
            </span>
          )}
        </div>

        {/* Chart */}
        {loading ? (
          <div className="skeleton h-72 rounded-xl" />
        ) : (
          <div className="rounded-xl border border-white/5 bg-[#0d1117] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {isLive ? "Publications per Year" : "H-Index Growth Over Time"}
                </h3>
                <p className="text-xs text-slate-500">
                  {isLive
                    ? "Annual paper output — Nile University vs. Egyptian peers (OpenAlex)"
                    : "Comparing Nile University's H-Index improvement against top Egyptian universities"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                disabled={!data}
                onClick={() => data && exportReportCsv(data, chartData, allUniversities, isLive)}
              >
                <Download className="h-3.5 w-3.5" />
                Export Report
              </Button>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="year" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} width={55} />
                <Tooltip
                  contentStyle={{
                    background: "#111827",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "8px",
                    fontSize: "11px",
                  }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Legend wrapperStyle={{ fontSize: "11px", color: "#64748b" }} />
                {allUniversities.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={name === "Nile University" ? 2.5 : 1.5}
                    dot={{ fill: COLORS[i % COLORS.length], r: 3 }}
                    strokeDasharray={name === "Nile University" ? "5 3" : undefined}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>

            {notRanked && (
              <p className="mt-2 text-center text-xs text-slate-600">
                {isLive
                  ? "Nile University has no indexed publications in OpenAlex for this period."
                  : "Click \"Run Live Benchmark\" above to load Nile University's data from OpenAlex."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
