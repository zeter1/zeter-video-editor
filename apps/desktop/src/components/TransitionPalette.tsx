import type { Clip, TransitionKind } from "../generated/ipc";
import {
  APPROVED_TRANSITIONS, canEditTransition, TRANSITION_DESCRIPTIONS, TRANSITION_DRAG_MIME,
} from "../editing/transitions";

interface TransitionPaletteProps {
  selectedClip: Clip | null;
  selectedTrackLocked: boolean;
  onApply: (kind: TransitionKind) => void;
}

export function TransitionPalette({
  selectedClip, selectedTrackLocked, onApply,
}: TransitionPaletteProps) {
  const canApplySelected = canEditTransition(selectedClip, selectedTrackLocked);
  return (
    <section className="transition-palette" aria-label="Transitions presets">
      <p className="empty-copy">
        Перетащите переход на видео или изображение. Выберите клип, чтобы применить пресет кнопкой.
      </p>
      <div className="transition-preset-list">
        {APPROVED_TRANSITIONS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className="transition-preset"
            draggable
            aria-label={`Transition preset ${label}`}
            title={`${TRANSITION_DESCRIPTIONS[kind]}. Перетащите на клип или нажмите для выбранного клипа`}
            onDragStart={(event) => {
              event.dataTransfer.setData(TRANSITION_DRAG_MIME, kind);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => { if (canApplySelected) onApply(kind); }}
            aria-disabled={!canApplySelected}
          >
            <span className="transition-preset-glyph" aria-hidden="true">◧</span>
            <span><strong>{label}</strong><small>{TRANSITION_DESCRIPTIONS[kind]}</small></span>
          </button>
        ))}
      </div>
      {!canApplySelected ? (
        <p className="empty-copy">Для применения нажатием выберите разблокированный видео- или фотоклип.</p>
      ) : null}
    </section>
  );
}
