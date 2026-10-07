use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, EditCommand, EditRequest, Marker,
    MediaId, MediaRef, Project, ProjectId, ProjectRevision, ProjectSettings, RequestId, Sequence,
    SequenceId, SubtitleStyle, TimeUs, Track, TrackId, TrackKind, Transform,
};
use job_system::{JobFailure, JobKind, JobSpec, JobState};
use media_engine::{MediaProbe, VideoProbe};

use crate::{
    app::{JobService, ProjectService},
    error::AppError,
};

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

fn project_fixture() -> (Project, SequenceId) {
    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    (
        Project {
            id: ProjectId::new(),
            name: "Export fixture".into(),
            settings: ProjectSettings::default(),
            media: vec![MediaRef {
                id: media_id,
                absolute_path: "C:/fixture/source.mp4".into(),
                project_relative_path: None,
                file_size: 123,
                duration: Some(time(2_000_000)),
                width: Some(1920),
                height: Some(1080),
            }],
            sequences: vec![Sequence {
                id: sequence_id,
                name: "Main".into(),
                width: 1920,
                height: 1080,
                fps: 30.0,
                tracks: vec![Track {
                    id: TrackId::new(),
                    name: "Video".into(),
                    kind: TrackKind::Video,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![Clip {
                        id: ClipId::new(),
                        kind: ClipKind::Video,
                        media_id: Some(media_id),
                        source_in: time(0),
                        source_out: time(2_000_000),
                        timeline_start: time(0),
                        timeline_end: time(2_000_000),
                        transform: Transform::default(),
                        color: ColorAdjustments::default(),
                        audio: AudioState::default(),
                        speed: 1.0,
                        transition: None,
                        text: None,
                    }],
                }],
                subtitle_segments: Vec::new(),
                subtitle_style: SubtitleStyle::default(),
                markers: Vec::new(),
            }],
        },
        sequence_id,
    )
}

#[test]
fn export_capture_uses_the_authoritative_project_revision_and_immutable_render_snapshot() {
    let (project, sequence_id) = project_fixture();
    let service = ProjectService::from_project(project, ProjectRevision::new(7)).unwrap();

    let snapshot = service.render_snapshot(sequence_id).unwrap();

    assert_eq!(snapshot.revision, ProjectRevision::new(7));
    assert_eq!(snapshot.sequence_id, sequence_id);
    assert_eq!(snapshot.clips.len(), 1);
    assert_eq!(snapshot.media.len(), 1);
}

#[test]
fn export_job_cancellation_token_is_shared_and_cancelled_terminal_state_ignores_late_runner_failure()
 {
    let (project, sequence_id) = project_fixture();
    let jobs = JobService::new();
    let job_id = jobs
        .start_job(JobSpec {
            kind: JobKind::Export,
            request_id: RequestId::new(),
            project_id: project.id,
            sequence_id,
            source_revision: ProjectRevision::new(0),
            cancellable: true,
        })
        .unwrap();

    let cancellation = jobs.cancellation_token(job_id).unwrap();
    assert!(!cancellation.is_cancelled());

    jobs.cancel_job(job_id).unwrap();
    assert!(cancellation.is_cancelled());
    assert_eq!(
        jobs.get_job_state(job_id).unwrap().state,
        JobState::Cancelled
    );

    jobs.mark_failed(
        job_id,
        JobFailure {
            code: "cancelled".into(),
            stage: "export".into(),
            retryable: false,
            safe_message: "Export was cancelled.".into(),
            technical_detail: "fixture runner observed cancellation".into(),
        },
    )
    .unwrap();

    assert_eq!(
        jobs.get_job_state(job_id).unwrap().state,
        JobState::Cancelled
    );
}

#[test]
fn recovery_choice_opens_newer_authoritative_state_without_silently_overwriting_canonical_save() {
    let dir = tempfile::tempdir().unwrap();
    let canonical = dir.path().join("project.vcut");
    let (project, sequence_id) = project_fixture();
    project_io::save_atomic(&canonical, &project, ProjectRevision::new(0)).unwrap();
    let canonical_before = std::fs::read(&canonical).unwrap();

    let mut live = ProjectService::empty();
    live.open(&canonical).unwrap();
    live.execute_edit_command(EditRequest {
        request_id: RequestId::new(),
        expected_revision: ProjectRevision::new(0),
        command: EditCommand::AddMarker {
            sequence_id,
            marker: Marker {
                id: uuid::Uuid::new_v4(),
                time: time(500_000),
                label: "confirmed before crash".into(),
            },
        },
    })
    .unwrap();

    let recovery = live
        .write_recovery_snapshot(dir.path(), 1_700_000_000_000)
        .unwrap();
    assert_eq!(recovery.revision, ProjectRevision::new(1));
    assert_eq!(std::fs::read(&canonical).unwrap(), canonical_before);

    let mut restarted = ProjectService::empty();
    let canonical_snapshot = restarted.open(&canonical).unwrap();
    assert_eq!(canonical_snapshot.revision, ProjectRevision::new(0));

    let candidates = restarted.recovery_candidates(dir.path()).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].revision, ProjectRevision::new(1));

    let recovered = restarted
        .open_recovery(&canonical, &candidates[0].path)
        .unwrap();
    assert_eq!(recovered.revision, ProjectRevision::new(1));
    assert_eq!(recovered.project.sequences[0].markers.len(), 1);
    assert_eq!(std::fs::read(&canonical).unwrap(), canonical_before);
    assert_eq!(restarted.current_path(), Some(canonical.as_path()));

    restarted.save(&canonical).unwrap();
    assert_ne!(std::fs::read(&canonical).unwrap(), canonical_before);
    assert_eq!(
        project_io::load(&canonical).unwrap().revision,
        ProjectRevision::new(1)
    );
}

#[test]
fn project_open_rejects_same_size_media_when_probed_identity_changed_without_installing_state() {
    let dir = tempfile::tempdir().unwrap();
    let media_path = dir.path().join("source.mp4");
    std::fs::write(&media_path, b"same-size-fixture").unwrap();

    let (mut project, _) = project_fixture();
    project.media[0].absolute_path = media_path.to_string_lossy().into_owned();
    project.media[0].project_relative_path = None;
    project.media[0].file_size = std::fs::metadata(&media_path).unwrap().len();
    project.media[0].duration = Some(time(2_000_000));
    project.media[0].width = Some(1920);
    project.media[0].height = Some(1080);

    let project_path = dir.path().join("identity-mismatch.vcut");
    project_io::save_atomic(&project_path, &project, ProjectRevision::new(4)).unwrap();

    let mut service = ProjectService::empty();
    let error = service
        .open_validated(&project_path, |_| {
            Ok(MediaProbe {
                format_name: Some("mov,mp4".into()),
                duration_seconds: Some(2.0),
                bit_rate: None,
                video: Some(VideoProbe {
                    codec_name: Some("h264".into()),
                    width: 1280,
                    height: 720,
                    frame_rate: Some(30.0),
                    bit_rate: None,
                }),
                audio_streams: Vec::new(),
            })
        })
        .unwrap_err();

    assert!(matches!(error, AppError::MediaIdentityMismatch { .. }));
    assert!(matches!(service.snapshot(), Err(AppError::NoProject)));
}

#[test]
fn project_open_can_fall_back_to_matching_relative_media_after_absolute_identity_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let absolute_path = dir.path().join("old-location.mp4");
    let relative_dir = dir.path().join("media");
    let relative_path = relative_dir.join("source.mp4");
    std::fs::create_dir_all(&relative_dir).unwrap();
    std::fs::write(&absolute_path, b"same-size-fixture").unwrap();
    std::fs::write(&relative_path, b"same-size-fixture").unwrap();

    let (mut project, _) = project_fixture();
    project.media[0].absolute_path = absolute_path.to_string_lossy().into_owned();
    project.media[0].project_relative_path = Some("media/source.mp4".into());
    project.media[0].file_size = std::fs::metadata(&absolute_path).unwrap().len();
    project.media[0].duration = Some(time(2_000_000));
    project.media[0].width = Some(1920);
    project.media[0].height = Some(1080);

    let project_path = dir.path().join("relative-fallback.vcut");
    project_io::save_atomic(&project_path, &project, ProjectRevision::new(5)).unwrap();

    let mut service = ProjectService::empty();
    let opened = service
        .open_validated(&project_path, |candidate| {
            let (width, height) = if candidate == absolute_path {
                (1280, 720)
            } else {
                (1920, 1080)
            };
            Ok(MediaProbe {
                format_name: Some("mov,mp4".into()),
                duration_seconds: Some(2.0),
                bit_rate: None,
                video: Some(VideoProbe {
                    codec_name: Some("h264".into()),
                    width,
                    height,
                    frame_rate: Some(30.0),
                    bit_rate: None,
                }),
                audio_streams: Vec::new(),
            })
        })
        .unwrap();

    assert_eq!(opened.revision, ProjectRevision::new(5));
    assert_eq!(
        std::path::PathBuf::from(&opened.project.media[0].absolute_path),
        relative_path
    );
}

#[test]
fn explicit_relink_opens_missing_media_only_after_replacement_matches_saved_identity() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing.mp4");
    let replacement = dir.path().join("replacement.mp4");
    std::fs::write(&replacement, b"replacement-fixture").unwrap();

    let (mut project, _) = project_fixture();
    project.media[0].absolute_path = missing.to_string_lossy().into_owned();
    project.media[0].project_relative_path = None;
    project.media[0].file_size = std::fs::metadata(&replacement).unwrap().len();
    project.media[0].duration = Some(time(2_000_000));
    project.media[0].width = Some(1920);
    project.media[0].height = Some(1080);

    let project_path = dir.path().join("missing-media.vcut");
    project_io::save_atomic(&project_path, &project, ProjectRevision::new(6)).unwrap();

    let mut service = ProjectService::empty();
    let opened = service
        .open_with_relink(&project_path, &replacement, |_| {
            Ok(MediaProbe {
                format_name: Some("mov,mp4".into()),
                duration_seconds: Some(2.0),
                bit_rate: None,
                video: Some(VideoProbe {
                    codec_name: Some("h264".into()),
                    width: 1920,
                    height: 1080,
                    frame_rate: Some(30.0),
                    bit_rate: None,
                }),
                audio_streams: Vec::new(),
            })
        })
        .unwrap();

    assert_eq!(opened.revision, ProjectRevision::new(7));
    assert_eq!(
        std::path::PathBuf::from(&opened.project.media[0].absolute_path),
        replacement
    );

    let undo = service.undo(RequestId::new()).unwrap();
    assert_eq!(undo.revision, ProjectRevision::new(8));
    let undone = service.snapshot().unwrap();
    assert_eq!(
        std::path::PathBuf::from(&undone.project.media[0].absolute_path),
        missing
    );

    let redo = service.redo(RequestId::new()).unwrap();
    assert_eq!(redo.revision, ProjectRevision::new(9));
    let redone = service.snapshot().unwrap();
    assert_eq!(
        std::path::PathBuf::from(&redone.project.media[0].absolute_path),
        replacement
    );
}

#[test]
fn explicit_relink_rejects_wrong_replacement_and_keeps_project_unopened() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing.mp4");
    let replacement = dir.path().join("wrong.mp4");
    std::fs::write(&replacement, b"replacement-fixture").unwrap();

    let (mut project, _) = project_fixture();
    project.media[0].absolute_path = missing.to_string_lossy().into_owned();
    project.media[0].project_relative_path = None;
    project.media[0].file_size = std::fs::metadata(&replacement).unwrap().len();
    project.media[0].duration = Some(time(2_000_000));
    project.media[0].width = Some(1920);
    project.media[0].height = Some(1080);

    let project_path = dir.path().join("wrong-relink.vcut");
    project_io::save_atomic(&project_path, &project, ProjectRevision::new(6)).unwrap();

    let mut service = ProjectService::empty();
    let error = service
        .open_with_relink(&project_path, &replacement, |_| {
            Ok(MediaProbe {
                format_name: Some("mov,mp4".into()),
                duration_seconds: Some(2.0),
                bit_rate: None,
                video: Some(VideoProbe {
                    codec_name: Some("h264".into()),
                    width: 640,
                    height: 360,
                    frame_rate: Some(30.0),
                    bit_rate: None,
                }),
                audio_streams: Vec::new(),
            })
        })
        .unwrap_err();

    assert!(matches!(error, AppError::MediaIdentityMismatch { .. }));
    assert!(matches!(service.snapshot(), Err(AppError::NoProject)));
}
