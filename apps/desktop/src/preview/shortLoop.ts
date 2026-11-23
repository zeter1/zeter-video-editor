/** Transient transport instruction; not a project command, media asset or persisted range. */
export interface PreviewLoopRange {
  start: number;
  end: number;
  requestId: number;
}

export function validPreviewLoopRange(range: PreviewLoopRange | null, playableEndUs: number): boolean {
  return !!range && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) &&
    Number.isSafeInteger(range.requestId) && range.requestId > 0 &&
    range.start >= 0 && range.start < range.end &&
    range.end <= playableEndUs;
}

/** [In, Out) ensures Out never becomes a frame of the next edit. */
export function shouldRestartPreviewLoop(
  range: PreviewLoopRange | null, nextUs: number, playableEndUs: number,
): boolean {
  return validPreviewLoopRange(range, playableEndUs) &&
    Number.isFinite(nextUs) && nextUs >= range!.end;
}