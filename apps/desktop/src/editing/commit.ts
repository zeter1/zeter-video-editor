import type { EditCommand } from "../generated/ipc";

export type EditCommit = (
  command: EditCommand,
) => boolean | void | Promise<boolean | void>;

export async function requestEditCommit(
  onCommit: EditCommit,
  command: EditCommand,
): Promise<boolean> {
  try {
    return (await onCommit(command)) !== false;
  } catch {
    return false;
  }
}
