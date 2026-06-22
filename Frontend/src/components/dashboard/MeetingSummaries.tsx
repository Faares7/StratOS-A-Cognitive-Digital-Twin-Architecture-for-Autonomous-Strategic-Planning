"use client";

import React from "react";
import Link from "next/link";
import { FileText, ArrowRight } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Meeting } from "@/types";

const TYPE_BADGE: Record<string, string> = {
  "Board Meeting":    "bg-violet-500/10 text-violet-400",
  Department:         "bg-blue-500/10 text-blue-400",
  Committee:          "bg-orange-500/10 text-orange-400",
  "1:1":             "bg-[#505672]/15 text-[#8d97b8]",
  "Research Council": "bg-[#0ea0c0]/10 text-[#0ea0c0]",
};

export function MeetingSummaries({ meetings }: { meetings: Meeting[] }) {
  const newCount = meetings.filter(
    (m) => Date.now() - new Date(m.date).getTime() < 7 * 24 * 3600_000
  ).length;

  return (
    <div className="flex flex-col rounded-xl border border-white/[0.07] bg-[#0f1422]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#e0e4ef]">
            Meeting Summaries
          </h3>
          <p className="text-[11px] text-[#505672]">AI-extracted insights</p>
        </div>
        {newCount > 0 && (
          <span className="flex items-center gap-1 rounded bg-[#1aad74]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1aad74]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1aad74]" />
            {newCount} New
          </span>
        )}
      </div>

      <div className="flex flex-col divide-y divide-white/[0.05]">
        {meetings.slice(0, 3).map((meeting) => (
          <Link
            key={meeting.id}
            href={`/meetings/${meeting.id}`}
            className="group flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[#171e30]"
          >
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#171e30]">
              <FileText className="h-3.5 w-3.5 text-[#505672]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[#8d97b8] group-hover:text-[#e0e4ef] transition-colors duration-150">
                {meeting.title}
              </p>
              <p className="text-[11px] text-[#505672]">{formatRelativeTime(meeting.date)}</p>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-[#505672]">
                <span className="flex items-center gap-1">
                  <span className="h-1 w-1 rounded-full bg-[#1aad74]" />
                  {meeting.key_decisions.length} key points
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1 w-1 rounded-full bg-[#c07824]" />
                  {meeting.action_items.length} actions
                </span>
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                TYPE_BADGE[meeting.type] ?? "bg-white/5 text-[#505672]"
              )}
            >
              {meeting.type}
            </span>
          </Link>
        ))}
      </div>

      <div className="border-t border-white/[0.06] px-4 py-2.5">
        <Link
          href="/meetings"
          className="flex items-center gap-1 text-[12px] text-[#b8922f] transition-colors duration-150 hover:text-[#c9a84c]"
        >
          View all meetings
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
