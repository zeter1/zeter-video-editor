import { useEffect, useMemo, useState } from "react";
import type { Clip } from "../generated/ipc";
import { ipcClient, type IpcClient } from "../ipc/client";

interface WaveformOverlayProps {
  clip: Clip;
  projectId: string | null;
  loadWaveform?: IpcClient["getAudioWaveform"];
}

const WAVEFORM_BUCKETS = 512;

export function WaveformOverlay({
  clip, projectId, loadWaveform = ipcClient.getAudioWaveform,
}: WaveformOverlayProps) {
  const [amplitudes, setAmplitudes] = useState<number[]>([]);
  const mediaId = clip.media_id;
  const start = clip.source_in;
  const end = clip.source_out;
  useEffect(() => {
    let active = true;
    setAmplitudes([]);
    if (projectId && mediaId && end > start) {
      void loadWaveform(projectId, mediaId, start, end, WAVEFORM_BUCKETS)
        .then((data) => {
          if (active) setAmplitudes(data.length === WAVEFORM_BUCKETS ? data : []);
        })
        .catch(() => {
          // Missing/undecodable audio leaves a usable clip, never fake peaks.
          if (active) setAmplitudes([]);
        });
    }
    return () => { active = false; };
  }, [projectId, mediaId, start, end, loadWaveform]);

  const bars = useMemo(() =>
    amplitudes.map((value, index) => {
      const height = Math.min(17, Math.max(0, Number.isFinite(value) ? value * 17 : 0));
      return <line key={index} x1={index + 0.5} x2={index + 0.5}
        y1={20 - height} y2={20 + height} />;
    }), [amplitudes]);

  if (!bars.length) return null;
  return <svg className="timeline-audio-waveform" aria-hidden="true"
    data-testid={`waveform-${clip.id}`} viewBox={`0 0 ${WAVEFORM_BUCKETS} 40`}
    preserveAspectRatio="none">{bars}</svg>;
}
