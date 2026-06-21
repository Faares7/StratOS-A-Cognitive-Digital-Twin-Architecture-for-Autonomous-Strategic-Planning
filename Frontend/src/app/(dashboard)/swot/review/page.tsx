"use client";

import { Header } from "@/components/layout/Header";
import { SwotConsolidationReview } from "@/components/dashboard/SwotConsolidationDialog";

export default function SwotReviewPage() {
  return (
    <div className="flex min-h-full flex-col">
      <Header
        title="Strategic SWOT — Review"
        subtitle="Curate the consolidated SWOT the rest of the architecture will use"
      />
      <div className="p-6">
        <SwotConsolidationReview />
      </div>
    </div>
  );
}
