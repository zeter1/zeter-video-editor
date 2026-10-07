use ai_engine::{AnalysisParameters, TranscriptProvenance, TranscriptResult, TranscriptSegment};
use editor_core::{
    EditCommand, EditRequest, Project, ProjectId, ProjectRevision, ProjectSettings, RequestId,
    Sequence, SequenceId, SubtitleStyle, TextStyle, TimeUs, Track, TrackId, TrackKind,
};
use job_system::{JobKind, JobSpec};
use tempfile::tempdir;

use crate::app::{job_service::JobService, project_service::ProjectService};

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

fn fixture_project() -> (Project, SequenceId, TrackId) {
    let sequence_id = SequenceId::new();
    let track_id = TrackId::new();
    (
        Project {
            id: ProjectId::new(),
            name: "Transcription fixture".into(),
            settings: ProjectSettings::default(),
            media: Vec::new(),
            sequences: vec![Sequence {
                id: sequence_id,
                name: "Main".into(),
                width: 1920,
                height: 1080,
                fps: 30.0,
                tracks: vec![Track {
                    id: track_id,
                    name: "Text".into(),
                    kind: TrackKind::Text,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: Vec::new(),
                }],
                subtitle_segments: Vec::new(),
                subtitle_style: SubtitleStyle::default(),
                markers: Vec::new(),
            }],
        },
        sequence_id,
        track_id,
    )
}

fn transcript(revision: ProjectRevision) -> TranscriptResult {
    TranscriptResult {
        language: "en".into(),
        segments: vec![TranscriptSegment {
            start: time(0),
            end: time(1_000_000),
            text: "hello".into(),
        }],
        provenance: TranscriptProvenance {
            model_id: "whisper-base".into(),
            model_version: "1.0.0".into(),
            backend: "whisper.cpp".into(),
            media_identity: "fixture-media".into(),
            source_revision: revision,
            parameters: AnalysisParameters::default(),
        },
    }
}

#[test]
fn completed_transcript_is_reviewable_but_stale_apply_cannot_mutate_newer_timeline() {
    let (project, sequence_id, track_id) = fixture_project();
    let project_id = project.id;
    let jobs = JobService::new();
    let mut projects = ProjectService::from_project(project, ProjectRevision::new(0)).unwrap();

    let job_id = jobs
        .start_job(JobSpec {
            kind: JobKind::Transcription,
            request_id: RequestId::new(),
            project_id,
            sequence_id,
            source_revision: ProjectRevision::new(0),
            cancellable: true,
        })
        .unwrap();

    jobs.complete_transcription(job_id, transcript(ProjectRevision::new(0)))
        .unwrap();
    let review = jobs
        .transcription_result(job_id)
        .unwrap()
        .expect("reviewable transcript");
    assert_eq!(review.segments[0].text, "hello");
    assert!(
        projects.snapshot().unwrap().project.sequences[0]
            .subtitle_segments
            .is_empty()
    );

    projects
        .execute_edit_command(EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(0),
            command: EditCommand::AddText {
                sequence_id,
                track_id,
                clip_id: editor_core::ClipId::new(),
                timeline_start: time(0),
                timeline_end: time(1_000_000),
                text: "newer edit".into(),
                style: TextStyle::default(),
            },
        })
        .unwrap();

    let job = jobs.get_job_state(job_id).unwrap();
    assert!(
        projects
            .apply_transcript_result(&job, RequestId::new(), &review)
            .is_err()
    );
    assert!(
        projects.snapshot().unwrap().project.sequences[0]
            .subtitle_segments
            .is_empty()
    );
}

#[test]
fn applied_transcript_survives_analysis_cache_deletion_as_normal_project_state() {
    let (project, sequence_id, _) = fixture_project();
    let project_id = project.id;
    let jobs = JobService::new();
    let mut projects = ProjectService::from_project(project, ProjectRevision::new(0)).unwrap();

    let job_id = jobs
        .start_job(JobSpec {
            kind: JobKind::Transcription,
            request_id: RequestId::new(),
            project_id,
            sequence_id,
            source_revision: ProjectRevision::new(0),
            cancellable: true,
        })
        .unwrap();
    jobs.complete_transcription(job_id, transcript(ProjectRevision::new(0)))
        .unwrap();
    let job = jobs.get_job_state(job_id).unwrap();
    let review = jobs.transcription_result(job_id).unwrap().unwrap();

    projects
        .apply_transcript_result(&job, RequestId::new(), &review)
        .unwrap();

    let dir = tempdir().unwrap();
    let project_path = dir.path().join("project.vcut");
    let snapshot = projects.snapshot().unwrap();
    project_io::save_atomic(&project_path, &snapshot.project, snapshot.revision).unwrap();
    let cache = project_io::cache_root(dir.path(), project_id);
    std::fs::create_dir_all(cache.join("ai")).unwrap();
    std::fs::write(cache.join("ai/transcript.json"), b"disposable review cache").unwrap();
    project_io::remove_project_cache(dir.path(), project_id).unwrap();

    let loaded = project_io::load(&project_path).unwrap();
    assert_eq!(
        loaded.project.sequences[0].subtitle_segments[0].text,
        "hello"
    );
}

#[test]
fn transcript_apply_rejects_completed_non_transcription_job() {
    let (project, sequence_id, _) = fixture_project();
    let project_id = project.id;
    let jobs = JobService::new();
    let mut projects = ProjectService::from_project(project, ProjectRevision::new(0)).unwrap();

    let job_id = jobs
        .start_job(JobSpec {
            kind: JobKind::HighlightAnalysis,
            request_id: RequestId::new(),
            project_id,
            sequence_id,
            source_revision: ProjectRevision::new(0),
            cancellable: true,
        })
        .unwrap();
    jobs.mark_completed(job_id).unwrap();
    let job = jobs.get_job_state(job_id).unwrap();

    let error = projects
        .apply_transcript_result(&job, RequestId::new(), &transcript(ProjectRevision::new(0)))
        .unwrap_err();

    assert!(matches!(
        error,
        crate::error::AppError::InvalidAnalysisJobKind {
            actual: JobKind::HighlightAnalysis
        }
    ));
    assert!(
        projects.snapshot().unwrap().project.sequences[0]
            .subtitle_segments
            .is_empty()
    );
}
