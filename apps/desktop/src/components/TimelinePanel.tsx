import type { Sequence } from "../generated/ipc";
import type { IpcClient } from "../ipc/client";
import type { ProjectStore } from "../state/projectStore";
import type { TransientStore } from "../state/transientStore";
import { Timeline } from "../timeline/Timeline";

interface TimelinePanelProps {
  sequence: Sequence | null;
  projectStore: ProjectStore;
  transientStore: TransientStore;
  client: IpcClient;
}

export function TimelinePanel({
  sequence,
  projectStore,
  transientStore,
  client,
}: TimelinePanelProps) {
  return (
    <section
      className="timeline-panel panel"
      role="region"
      aria-label="Timeline"
      data-testid="timeline-panel"
    >
      <div className="panel-heading">
        <span>Timeline</span>
        <span className="panel-meta">
          {sequence ? `${sequence.tracks.length} tracks` : "No sequence"}
        </span>
      </div>
      {sequence ? (
        <Timeline
          sequence={sequence}
          projectStore={projectStore}
          transientStore={transientStore}
          executeEditCommand={client.executeEditCommand}
          reconcileCommandResult={client.reconcileCommandResult}
        />
      ) : (
        <div className="empty-timeline">
          <span className="empty-copy">Timeline tracks will appear here.</span>
        </div>
      )}
    </section>
  );
}