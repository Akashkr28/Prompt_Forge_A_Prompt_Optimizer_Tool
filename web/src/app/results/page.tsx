import { ScreenHeader } from "@/components/ui/screen-header";
import { ResultsView } from "@/components/results-view";

export const metadata = { title: "Results & Analysis — PromptForge" };

/** `/results` — defaults to the most recent session (mirrors the mockup's "Last Run" framing). */
export default function ResultsPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="Analysis · Latest run"
        title="Results & Analysis"
        sub="Score improvement curve, prompt diff, and per-dimension evaluation breakdown."
      />
      <ResultsView />
    </>
  );
}
