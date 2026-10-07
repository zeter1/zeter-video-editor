import type { AppErrorDto } from "../generated/ipc";

export type RecoveryAction =
  | "cpu-export"
  | "relink-media"
  | "install-model"
  | "save-elsewhere";

export interface RecoveryChoice {
  action: RecoveryAction;
  label: string;
}

export function recoveryChoices(error: AppErrorDto): RecoveryChoice[] {
  if (error.category === "Media" && error.code === "encoder_init") {
    return [{ action: "cpu-export", label: "Retry with CPU encoding" }];
  }
  if (error.category === "Project" && error.code === "missing_media") {
    return [{ action: "relink-media", label: "Relink media" }];
  }
  if (error.category === "AiModel" && error.code === "model_unavailable") {
    return [{ action: "install-model", label: "Install model" }];
  }
  if (error.category === "Filesystem" && error.code === "save_failed") {
    return [{ action: "save-elsewhere", label: "Save elsewhere" }];
  }
  return [];
}
