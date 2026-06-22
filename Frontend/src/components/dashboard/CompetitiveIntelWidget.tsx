"use client";

import React from "react";
import Link from "next/link";
import { GraduationCap, ArrowRight } from "lucide-react";
import type { ResearchIntelligence } from "@/types";

export function CompetitiveIntelWidget({ data }: { data: ResearchIntelligence | null }) {
  const nu        = data?.nile_university;
  const notRanked = !nu || nu.publications === 0;

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.07] bg-[#0f1422]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">
            Competitive Intel
          </h3>
          <p className="text-[11px] text-[#505672]">Egyptian university rankings by H-Index</p>
        </div>
        <GraduationCap className="h-4 w-4 text-[#2b2f45]" />
      </div>

      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#505672]">
              University Rank
            </p>
            <p className="mt-0.5 text-[26px] font-bold leading-none tracking-[-0.03em] text-[#b8922f]">
              {notRanked ? "—" : `#${nu?.rank}`}
            </p>
          </div>
          <p className="text-[11px] text-[#2b2f45]">
            {data?.competitors.length ?? 0} universities
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Top H-Index",    value: notRanked ? 0 : nu?.h_index ?? 0 },
            { label: "Avg Citations",  value: notRanked ? 0 : nu?.total_citations ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-[#171e30] px-3 py-2 text-center">
              <p className="text-[18px] font-bold tabular-nums leading-none text-[#e0e4ef]">
                {stat.value.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[10px] text-[#505672]">{stat.label}</p>
            </div>
          ))}
        </div>

        {notRanked && (
          <p className="mt-3 text-center text-[10px] text-[#2b2f45]">
            Connect your research data source to populate rankings.
          </p>
        )}
      </div>

      <div className="border-t border-white/[0.06] px-4 py-2.5">
        <Link
          href="/research"
          className="flex items-center gap-1 text-[12px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
        >
          View full analysis
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
