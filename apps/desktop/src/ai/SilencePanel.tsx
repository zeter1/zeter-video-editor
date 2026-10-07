import { useState } from "react";

export interface SilenceRangeView {
  start: number;
  end: number;
}

export interface SilenceParametersView {
  threshold: number;
  minimumDurationMs: number;
  paddingMs: number;
}

interface SilencePanelProps {
  running: boolean;
  ranges: SilenceRangeView[];
  onAnalyze: (parameters: SilenceParametersView) => void;
  onApply: (ranges: SilenceRangeView[]) => void;
}

export function SilencePanel({
  running,
  ranges,
  onAnalyze,
  onApply,
}: SilencePanelProps) {
  const [parameters, setParameters] = useState<SilenceParametersView>({
    threshold: 0.05,
    minimumDurationMs: 200,
    paddingMs: 50,
  });
  const label =
    ranges.length === 1 ? "1 silence range" : String(ranges.length) + " silence ranges";

  function update(
    key: keyof SilenceParametersView,
    value: number,
    minimum: number,
  ): void {
    setParameters((current) => ({
      ...current,
      [key]: Number.isFinite(value) ? Math.max(minimum, value) : minimum,
    }));
  }

  return (
    <section className="ai-review-panel" aria-label="Silence removal">
      <div className="silence-parameters">
        <label>
          Silence threshold
          <input
            aria-label="Silence threshold"
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={parameters.threshold}
            onChange={(event) =>
              update("threshold", Math.min(1, Number(event.target.value)), 0)
            }
          />
        </label>
        <label>
          Minimum silence (ms)
          <input
            aria-label="Minimum silence (ms)"
            type="number"
            min="1"
            step="10"
            value={parameters.minimumDurationMs}
            onChange={(event) =>
              update("minimumDurationMs", Math.round(Number(event.target.value)), 1)
            }
          />
        </label>
        <label>
          Padding (ms)
          <input
            aria-label="Padding (ms)"
            type="number"
            min="0"
            step="10"
            value={parameters.paddingMs}
            onChange={(event) =>
              update("paddingMs", Math.round(Number(event.target.value)), 0)
            }
          />
        </label>
      </div>

      <button type="button" disabled={running} onClick={() => onAnalyze(parameters)}>
        {running ? "Analyzing…" : "Analyze silences"}
      </button>
      <p>{label}</p>
      {ranges.length > 0 ? (
        <button type="button" onClick={() => onApply(ranges)}>
          Apply silence removal
        </button>
      ) : null}
    </section>
  );
}
