export interface HighlightCandidateView {
  start: number;
  end: number;
  score: number;
  reasons: string[];
  source_revision: number;
}

interface HighlightsPanelProps {
  candidates: HighlightCandidateView[];
  onAnalyze: () => void;
  onCreateShort: (candidate: HighlightCandidateView) => void;
}

export function HighlightsPanel({
  candidates,
  onAnalyze,
  onCreateShort,
}: HighlightsPanelProps) {
  return (
    <section className="ai-review-panel" aria-label="Highlights">
      <button type="button" onClick={onAnalyze}>
        Analyze highlights
      </button>
      {candidates.length === 0 ? (
        <p className="empty-copy">No highlight candidates yet.</p>
      ) : (
        <div className="highlight-candidates">
          {candidates.map((candidate, index) => (
            <article key={String(candidate.start) + "-" + String(candidate.end) + "-" + String(index)}>
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
