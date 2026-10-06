import { useEffect, useRef, useState } from "react";

import type { Sequence, SubtitleSegment } from "../generated/ipc";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";
import { SUBTITLE_PRESETS } from "./presets";

interface SubtitlePanelProps {
  sequence: Sequence;
  onSeek: (timeUs: number) => void;
  onCommit: EditCommit;
}

export function SubtitlePanel({ sequence, onSeek, onCommit }: SubtitlePanelProps) {
  const [segments, setSegments] = useState<SubtitleSegment[]>(sequence.subtitle_segments);
  const lastSubmitted = useRef<string | null>(null);

  useEffect(() => {
    setSegments(sequence.subtitle_segments);
    lastSubmitted.current = null;
  }, [sequence]);

  function replaceText(index: number, text: string): void {
    setSegments((current) =>
      current.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, text } : segment,
      ),
    );
  }

  async function commitSegments(): Promise<void> {
    const fingerprint = JSON.stringify(segments);
    if (lastSubmitted.current === fingerprint) {
      return;
    }
    lastSubmitted.current = fingerprint;

    const accepted = await requestEditCommit(onCommit, {
      SetSubtitleSegments: {
        sequence_id: sequence.id,
        segments,
      },
    });

    if (!accepted) {
      setSegments(sequence.subtitle_segments);
      lastSubmitted.current = null;
    }
  }

  return (
    <fieldset className="inspector-section subtitle-panel">
      <legend>Subtitles</legend>
      <div className="subtitle-presets" aria-label="Subtitle presets">
        {Object.values(SUBTITLE_PRESETS).map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() =>
              void requestEditCommit(onCommit, {
                SetSubtitleStyle: {
                  sequence_id: sequence.id,
                  style: preset.style,
                },
              })
            }
          >
            {preset.label}
          </button>
        ))}
      </div>

      {segments.length === 0 ? (
        <p className="empty-copy">No subtitle segments yet.</p>
      ) : (
        <div className="subtitle-list">
          {segments.map((segment, index) => (
            <div className="subtitle-row" key={`${segment.start}-${segment.end}-${index}`}>
              <button
                type="button"
                className="subtitle-time"
                aria-label={`Seek subtitle at ${(segment.start / 1_000_000).toFixed(2)}s`}
                onClick={() => onSeek(segment.start)}
              >
                {(segment.start / 1_000_000).toFixed(2)}s
              </button>
              <input
                aria-label={`Subtitle ${index + 1} text`}
                value={segment.text}
                onChange={(event) => replaceText(index, event.target.value)}
                onBlur={() => void commitSegments()}
              />
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
