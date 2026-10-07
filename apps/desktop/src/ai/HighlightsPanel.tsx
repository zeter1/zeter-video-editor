import type { HighlightCandidate } from "../generated/ipc";

export type HighlightCandidateView = HighlightCandidate;

interface HighlightsPanelProps {
  candidates: HighlightCandidateView[];
  running?: boolean;
  onAnalyze: () => void;
  onCreateShort: (candidate: HighlightCandidateView) => void;
}

export function HighlightsPanel({
  candidates,
  running = false,
  onAnalyze,
  onCreateShort,
}: HighlightsPanelProps) {
  return (
    <section className="ai-review-panel" aria-label="Highlights">
      <button type="button" disabled={running} onClick={onAnalyze}>
        {running ? "Analyzing highlights…" : "Analyze highlights"}
      </button>
      {candidates.length === 0 ? (
        <p className="empty-copy">No highlight candidates yet.</p>
      ) : (
        <div className="highlight-candidates">
          {candidates.map((candidate, index) => (
            <article
              key={
                String(candidate.start) +
                "-" +
                String(candidate.end) +
                "-" +
                String(index)
              }
            >
              <strong>{Math.round(candidate.score * 100)}% score</strong>
              <ul>
                {candidate.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <button type="button" onClick={() => onCreateShort(candidate)}>
                Create Short
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
