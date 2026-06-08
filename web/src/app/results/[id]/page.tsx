"use client";

import { useParams } from "next/navigation";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ResultsView } from "@/components/results-view";

/** `/results/[id]` — a specific session's results, linked from the History table's "View" action. */
export default function SessionResultsPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  return (
    <>
      <ScreenHeader
        eyebrow={`Analysis · Session #${params.id}`}
        title="Results & Analysis"
        sub="Score improvement curve, prompt diff, and per-dimension evaluation breakdown."
      />
      <ResultsView sessionId={Number.isFinite(id) ? id : undefined} />
    </>
  );
}
