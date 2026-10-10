import { useEffect, useRef, useState } from "react";

import type { Clip, SequenceId, TextStyle, TrackId } from "../generated/ipc";
import {
  requestEditCommit,
  type EditCommit,
} from "../editing/commit";

interface TextInspectorProps {
  sequenceId: SequenceId;
  trackId: TrackId;
  clip: Clip;
  onCommit: EditCommit;
}

export function TextInspector({
  sequenceId,
  trackId,
  clip,
  onCommit,
}: TextInspectorProps) {
  const [draft, setDraft] = useState<TextStyle | null>(clip.text?.style ?? null);
  const lastSubmitted = useRef<string | null>(
    JSON.stringify(clip.text?.style ?? null),
  );

  useEffect(() => {
    const authoritative = clip.text?.style ?? null;
    setDraft(authoritative);
    lastSubmitted.current = JSON.stringify(authoritative);
  }, [clip]);

  if (!draft || !clip.text) {
    return null;
  }

  function update(patch: Partial<TextStyle>): TextStyle | null {
    if (!draft) {
      return null;
    }
    const next: TextStyle = { ...draft, ...patch };
    setDraft(next);
    return next;
  }

  async function commit(style: TextStyle | null = draft): Promise<void> {
    if (!style) {
      return;
    }
    const fingerprint = JSON.stringify(style);
    if (lastSubmitted.current === fingerprint) {
      return;
    }
    lastSubmitted.current = fingerprint;

    const accepted = await requestEditCommit(onCommit, {
      SetTextStyle: {
        sequence_id: sequenceId,
        track_id: trackId,
        clip_id: clip.id,
        style,
      },
    });

    if (!accepted) {
      const authoritative = clip.text?.style ?? null;
      setDraft(authoritative);
      lastSubmitted.current = JSON.stringify(authoritative);
    }
  }

  return (
    <fieldset className="inspector-section">
      <legend>Текст</legend>
      <label>
        Шрифт
        <input
          aria-label="Шрифт"
          value={draft.font_family}
          onChange={(event) => update({ font_family: event.target.value })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Размер
        <input
          aria-label="Размер текста"
          type="number"
          min="8"
          max="300"
          value={draft.font_size}
          onChange={(event) => update({ font_size: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Толщина шрифта
        <input
          aria-label="Толщина шрифта"
          type="number"
          min="100"
          max="900"
          step="100"
          value={draft.weight}
          onChange={(event) => update({ weight: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Выравнивание
        <select
          aria-label="Выравнивание текста"
          value={draft.alignment}
          onChange={(event) =>
            void commit(
              update({ alignment: event.target.value as TextStyle["alignment"] }),
            )
          }
        >
          <option value="Left">Слева</option>
          <option value="Center">По центру</option>
          <option value="Right">Справа</option>
        </select>
      </label>
      <label>
        Цвет
        <input
          aria-label="Цвет текста"
          type="color"
          value={draft.color}
          onChange={(event) => update({ color: event.target.value.toUpperCase() })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Цвет обводки
        <input
          aria-label="Цвет обводки"
          type="color"
          value={draft.stroke_color}
          onChange={(event) => update({ stroke_color: event.target.value.toUpperCase() })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Обводка
        <input
          aria-label="Толщина обводки"
          type="number"
          min="0"
          max="20"
          step="0.5"
          value={draft.stroke_width}
          onChange={(event) => update({ stroke_width: Number(event.target.value) })}
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Тень
        <input
          aria-label="Тень текста"
          type="checkbox"
          checked={draft.shadow}
          onChange={(event) => void commit(update({ shadow: event.target.checked }))}
        />
      </label>
      <label>
        Фон
        <input
          aria-label="Фон текста"
          placeholder="Нет или #RRGGBBAA"
          value={draft.background ?? ""}
          onChange={(event) =>
            update({
              background:
                event.target.value.trim().length === 0
                  ? null
                  : event.target.value.toUpperCase(),
            })
          }
          onBlur={() => void commit()}
        />
      </label>
      <label>
        Непрозрачность
        <input
          aria-label="Непрозрачность текста"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={draft.opacity}
          onChange={(event) => update({ opacity: Number(event.target.value) })}
          onPointerUp={() => void commit()}
          onBlur={() => void commit()}
        />
      </label>
    </fieldset>
  );
}
