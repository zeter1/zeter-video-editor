import type { Sequence } from "../generated/ipc";

interface TimelinePanelProps {
  sequence: Sequence | null;
  zoom: number;
}

export function TimelinePanel({ sequence, zoom }: TimelinePanelProps) {
  return (
    <section className="timeline-panel panel" role="region" aria-label="Timeline" data-testid="timeline-panel">
      <div className="panel-heading">
        <span>Timeline</span>
        <span className="panel-meta">{Math.round(zoom * 100)}%</span>
      </div>
      <div className="timeline-ruler" aria-hidden="true">
        <span>00:00</span><span>00:05</span><span>00:10</span><span>00:15</span>
      </div>
      <div className="track-stack">
        {sequence?.tracks.length ? (
          sequence.tracks.map((track) => (
            <div className="track-row" key={track.id}>
              <div className="track-label">{track.name}</div>
              <div className="track-lane">
                {track.clips.map((clip) => (
                  <div className="clip-block" key={clip.id}>
                    {clip.kind}
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-timeline">
            <span className="empty-copy">Timeline tracks will appear here.</span>
          </div>
        )}
      </div>
    </section>
  );
}