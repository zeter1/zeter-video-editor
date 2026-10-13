import { useEffect, useId, useState, type KeyboardEvent } from "react";

import { formatTimecode, parseTimecode } from "./timecode";

interface TimecodeInputProps {
  fps: number;
  timeUs: number;
  onSeek: (timeUs: number) => void;
  maxTimeUs: number;
  disabled?: boolean;
}

/** Enter commits a frame-accurate seek; Escape or blur abandons draft edits. */
export function TimecodeInput({ fps, timeUs, onSeek, maxTimeUs, disabled = false }: TimecodeInputProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(() => formatTimecode(timeUs, fps));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(formatTimecode(timeUs, fps));
  }, [editing, fps, timeUs]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      setInvalid(false);
      setEditing(false);
      event.currentTarget.blur();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const parsed = parseTimecode(draft, fps);
      if (parsed === null || parsed > maxTimeUs) {
        setInvalid(true);
        return;
      }
      setDraft(formatTimecode(parsed, fps));
      setInvalid(false);
      setEditing(false);
      onSeek(parsed);
      event.currentTarget.blur();
    }
  }

  return (
    <div className="timeline-timecode-entry">
      <label htmlFor={inputId}>Таймкод</label>
      <input
        id={inputId}
        type="text"
        disabled={disabled}
        aria-label="Таймкод"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${inputId}-error` : undefined}
        title="ЧЧ:ММ:СС:КК — без пропуска кадров (non-drop-frame)"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onFocus={(event) => {
          setEditing(true);
          setInvalid(false);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setInvalid(false);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setEditing(false);
          setInvalid(false);
        }}
      />
      {invalid ? (
        <span id={`${inputId}-error`} className="timeline-timecode-error" role="alert">
          ЧЧ:ММ:СС:КК; номер кадра меньше FPS, время в пределах шкалы
        </span>
      ) : null}
    </div>
  );
}
