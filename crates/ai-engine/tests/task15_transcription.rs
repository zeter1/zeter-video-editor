use ai_engine::{AnalysisParameters, TranscriptProvenance, parse_whisper_cli_json};
use editor_core::ProjectRevision;

fn provenance() -> TranscriptProvenance {
    TranscriptProvenance {
        model_id: "whisper-base".into(),
        model_version: "1.0.0".into(),
        backend: "whisper.cpp".into(),
        media_identity: "media:size=42;duration_us=5000000".into(),
        source_revision: ProjectRevision::new(7),
        parameters: AnalysisParameters::default(),
    }
}

#[test]
fn whisper_segment_json_becomes_structured_transcript_with_microsecond_offsets() {
    let json = r#"{
      "result": { "language": "ru" },
      "transcription": [
        { "offsets": { "from": 0, "to": 850 }, "text": " Привет," },
        { "offsets": { "from": 850, "to": 2150 }, "text": " мир!" }
      ]
    }"#;

    let transcript = parse_whisper_cli_json(json, provenance()).expect("valid whisper JSON");

    assert_eq!(transcript.language, "ru");
    assert_eq!(transcript.segments.len(), 2);
    assert_eq!(transcript.segments[0].start.get(), 0);
    assert_eq!(transcript.segments[0].end.get(), 850_000);
    assert_eq!(transcript.segments[0].text, "Привет,");
    assert_eq!(transcript.segments[1].start.get(), 850_000);
    assert_eq!(transcript.segments[1].end.get(), 2_150_000);
    assert_eq!(transcript.segments[1].text, "мир!");
    assert_eq!(
        transcript.provenance.source_revision,
        ProjectRevision::new(7)
    );

    let subtitles = transcript.subtitle_segments();
    assert_eq!(subtitles.len(), 2);
    assert_eq!(subtitles[1].text, "мир!");
}

#[test]
fn invalid_whisper_segment_offsets_are_rejected_instead_of_silently_retimed() {
    let json = r#"{
      "result": { "language": "en" },
      "transcription": [
        { "offsets": { "from": 2000, "to": 1000 }, "text": "bad" }
      ]
    }"#;

    assert!(parse_whisper_cli_json(json, provenance()).is_err());
}
