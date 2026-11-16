import { useEffect, useRef, useState } from "react";
import type { Clip, Sequence } from "../generated/ipc";
import type { IpcClient } from "../ipc/client";
import { HighlightsPanel, type HighlightCandidateView } from "./HighlightsPanel";
import { rankLocalHighlights } from "./highlightAnalysis";

interface HighlightsWorkspaceProps {
  client: IpcClient;
  projectId: string;
  revision: number;
  sequence: Sequence;
  clip: Clip;
  disabled: boolean;
  onPreview: (candidate: HighlightCandidateView) => void;
  onCreateShort: (candidate: HighlightCandidateView) => void;
}

/** Read-only FFmpeg waveform analysis; creation is a separate confirmed native edit. */
export function HighlightsWorkspace({
  client, projectId, revision, sequence, clip, disabled, onPreview, onCreateShort,
}: HighlightsWorkspaceProps) {
  const [candidates, setCandidates] = useState<HighlightCandidateView[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(false);
  const pending = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  async function analyze(): Promise<void> {
    if (disabled || pending.current || !clip.media_id ||
        clip.source_out <= clip.source_in) return;
    pending.current = true;
    setRunning(true);
    setError(null);
    setCandidates([]);
    setAnalyzed(false);
    try {
      const seconds = (clip.source_out - clip.source_in) / 1_000_000;
      // Native waveform IPC caps output at 1024 real audio peaks.
      const buckets = Math.min(1024, Math.max(32, Math.ceil(seconds * 2)));
      const peaks = await client.getAudioWaveform(
        projectId, clip.media_id, clip.source_in, clip.source_out, buckets,
      );
      if (!live.current) return;
      setCandidates(rankLocalHighlights(sequence, clip, peaks, revision));
      setAnalyzed(true);
    } catch {
      if (live.current) {
        // Silent footage can still contain real, previously authored subtitle
        // evidence. Never invent peaks; show that only text was considered.
        const textOnly = rankLocalHighlights(sequence, clip, Array(64).fill(0), revision);
        setCandidates(textOnly);
        setAnalyzed(true);
        setError(textOnly.length > 0
          ? "Аудио недоступно: кандидаты определены только по существующим субтитрам."
          : "Не удалось прочитать звуковую дорожку выбранного видео. Проверьте исходник.");
      }
    } finally {
      pending.current = false;
      if (live.current) setRunning(false);
    }
  }

  return (
    <HighlightsPanel
      candidates={candidates}
      analyzing={running}
      analyzed={analyzed}
      disabled={disabled}
      error={error}
      onAnalyze={() => void analyze()}
      onPreview={onPreview}
      onCreateShort={onCreateShort}
    />
  );
}
