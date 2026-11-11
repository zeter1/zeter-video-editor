import { invoke } from "@tauri-apps/api/core";

export interface AudioLoudness {
  integrated_lufs: number;
  true_peak_dbfs: number;
}

export async function loadAudioLoudness(
  projectId: string,
  sequenceId: string,
  trackId: string,
  clipId: string,
): Promise<AudioLoudness> {
  return invoke<AudioLoudness>("analyze_audio_loudness", {
    projectId,
    sequenceId,
    trackId,
    clipId,
  });
}

/**
 * Normalize to -16 LUFS without exceeding -1.5 dBTP.
 * Preserve the volume multiplier and replace only the existing gain_db.
 * This is a static gain, not a compressor: very dynamic clips may peak-limit
 * before reaching -16 LUFS, which is intentionally reported in the UI.
 */
export function suggestedNormalizationGain(
  measurement: AudioLoudness,
  volume: number,
): number | null {
  if (
    !Number.isFinite(measurement.integrated_lufs) ||
    !Number.isFinite(measurement.true_peak_dbfs) ||
    !Number.isFinite(volume) ||
    volume <= 0
  ) return null;
  const volumeDb = 20 * Math.log10(volume);
  const toTarget = -16 - measurement.integrated_lufs - volumeDb;
  const toPeak = -1.5 - measurement.true_peak_dbfs - volumeDb;
  const db = Math.max(-30, Math.min(24, toTarget, toPeak));
  return Math.round(db * 10) / 10;
}
