import { useSyncExternalStore } from "react";

import type {
  ChangedEntity,
  CommandResultDto,
  ProjectSnapshotDto,
} from "../generated/ipc";

export type ProjectSyncStatus = "empty" | "synced" | "refresh-required" | "resync-required" | "error";

export interface CommandResultOutcome {
  kind: "refresh-required" | "resync-required";
  pendingRevision: number;
  expectedRevision?: number;
  receivedRevision?: number;
}

export interface ProjectStoreState {
  snapshot: ProjectSnapshotDto | null;
  revision: number | null;
  pendingRevision: number | null;
  lastChangedEntities: ChangedEntity[];
  syncStatus: ProjectSyncStatus;
  errorMessage: string | null;
}

type Listener = () => void;

const initialState = (): ProjectStoreState => ({
  snapshot: null,
  revision: null,
  pendingRevision: null,
  lastChangedEntities: [],
  syncStatus: "empty",
  errorMessage: null,
});

export class ProjectStore {
  private state: ProjectStoreState = initialState();
  private readonly listeners = new Set<Listener>();

  getState = (): ProjectStoreState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  applySnapshot(snapshot: ProjectSnapshotDto): void {
    this.state = {
      snapshot,
      revision: snapshot.revision,
      pendingRevision: null,
      lastChangedEntities: [],
      syncStatus: "synced",
      errorMessage: null,
    };
    this.emit();
  }

  applyCommandResult(result: CommandResultDto): CommandResultOutcome {
    const currentRevision = this.state.revision;
    const expectedRevision = currentRevision === null ? 0 : currentRevision + 1;

    if (currentRevision === null || result.revision !== expectedRevision) {
      this.state = {
        ...this.state,
        pendingRevision: result.revision,
        lastChangedEntities: result.changed_entities,
        syncStatus: "resync-required",
        errorMessage: null,
      };
      this.emit();
      return {
        kind: "resync-required",
        pendingRevision: result.revision,
        expectedRevision,
        receivedRevision: result.revision,
      };
    }

    // CommandResultDto intentionally carries invalidation IDs, not entity values.
    // Keep the last authoritative snapshot unchanged until Rust supplies a fresh snapshot.
    this.state = {
      ...this.state,
      pendingRevision: result.revision,
      lastChangedEntities: result.changed_entities,
      syncStatus: "refresh-required",
      errorMessage: null,
    };
    this.emit();

    return {
      kind: "refresh-required",
      pendingRevision: result.revision,
    };
  }

  clear(): void {
    this.state = initialState();
    this.emit();
  }

  setError(message: string): void {
    this.state = {
      ...this.state,
      syncStatus: "error",
      errorMessage: message,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createProjectStore(): ProjectStore {
  return new ProjectStore();
}

export const projectStore = createProjectStore();

export function useProjectStore(store: ProjectStore = projectStore): ProjectStoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}