export interface TranscriptSegmentView {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResultView {
  language: string;
  segments: TranscriptSegmentView[];
  provenance: {
    model_id: string;
    model_version: string;
    backend: string;
    media_identity: string;
    source_revision: number;
  };
}

interface TranscriptionPanelProps {
  result: TranscriptResultView | null;
  running: boolean;
  onStart: () => void;
  onApply: (result: TranscriptResultView) => void;
}

function languageLabel(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized === "en") return "English";
  if (normalized === "ru") return "Russian";
  return normalized.length > 0 ? normalized.toUpperCase() : "Unknown";
}

export function TranscriptionPanel({
  result,
  running,
  onStart,
  onApply,
}: TranscriptionPanelProps) {
  const preview = result?.segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");

  return (
    <section className="transcription-panel" aria-label="Automatic subtitles">
      <div className="transcription-actions">
        <button type="button" disabled={running} onClick={onStart}>
          {running ? "Generating…" : "Generate subtitles"}
        </button>
      </div>

      {result ? (
        <div className="transcription-review">
          <div className="transcription-summary">
            {languageLabel(result.language)} · {result.segments.length} segments
          </div>
          <p className="transcription-preview">{preview}</p>
          <button type="button" onClick={() => onApply(result)}>
            Apply subtitles
          </button>
        </div>
      ) : (
        <p className="empty-copy">
          Generate a local transcript, review it, then apply it as editable subtitles.
        </p>
      )}
    </section>
  );
}
