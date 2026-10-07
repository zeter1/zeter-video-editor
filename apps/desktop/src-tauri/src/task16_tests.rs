use ai_engine::{HighlightCandidate, SilenceRange, initial_vertical_crop};
use editor_core::{
    AudioState, Clip, ClipId, ClipKind, ColorAdjustments, Crop, EditCommand, EditRequest, MediaId,
    MediaRef, Project, ProjectId, ProjectRevision, ProjectSettings, RequestId, Sequence,
    SequenceId, SubtitleStyle, TimeUs, Track, TrackId, TrackKind, Transform,
};

use job_system::{JobKind, JobSpec};

use crate::app::{job_service::JobService, project_service::ProjectService};

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

fn fixture() -> (Project, SequenceId) {
    let media_id = MediaId::new();
    let sequence_id = SequenceId::new();
    (
        Project {
            id: ProjectId::new(),
            name: "Short fixture".into(),
            settings: ProjectSettings::default(),
            media: vec![MediaRef {
                id: media_id,
                absolute_path: "C:/fixture/source.mp4".into(),
                project_relative_path: None,
                file_size: 100,
                duration: Some(time(60_000_000)),
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
                        source_out: time(60_000_000),
                        timeline_start: time(0),
                        timeline_end: time(60_000_000),
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

fn candidate(revision: ProjectRevision) -> HighlightCandidate {
    HighlightCandidate {
        start: time(10_000_000),
        end: time(20_000_000),
        score: 0.9,
        reasons: vec!["strong speech density".into()],
        source_revision: revision,
    }
}

#[test]
fn stale_highlight_candidate_cannot_create_short_on_newer_project() {
    let (project, source_sequence_id) = fixture();
    let mut service = ProjectService::from_project(project, ProjectRevision::new(0)).unwrap();

    service
        .execute_edit_command(EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(0),
            command: EditCommand::AddMarker {
                sequence_id: source_sequence_id,
                marker: editor_core::Marker {
                    id: uuid::Uuid::new_v4(),
                    time: time(5_000_000),
                    label: "new edit".into(),
                },
            },
        })
        .unwrap();

    let error = service
        .create_short_from_candidate(
            source_sequence_id,
            &candidate(ProjectRevision::new(0)),
            RequestId::new(),
            Crop::default(),
        )
        .unwrap_err();

    assert!(matches!(
        error,
        crate::error::AppError::StaleRevision { .. }
    ));
    assert_eq!(service.snapshot().unwrap().project.sequences.len(), 1);
}

#[test]
fn accepted_highlight_creates_1080x1920_sequence_and_reframe_stays_editable() {
    let (project, source_sequence_id) = fixture();
    let mut service = ProjectService::from_project(project, ProjectRevision::new(0)).unwrap();
    let crop = initial_vertical_crop(1920, 1080, None).unwrap();

    let result = service
        .create_short_from_candidate(
            source_sequence_id,
            &candidate(ProjectRevision::new(0)),
            RequestId::new(),
            crop,
        )
        .unwrap();

    let snapshot = service.snapshot().unwrap();
    let short_id = match result.changed_entities.as_slice() {
        [editor_core::ChangedEntity::Sequence(id)] => *id,
        changed => panic!("unexpected changed entities: {changed:?}"),
    };
    let short = snapshot
        .project
        .sequences
        .iter()
        .find(|sequence| sequence.id == short_id)
        .unwrap();
    assert_eq!((short.width, short.height), (1080, 1920));
    assert_eq!(short.tracks[0].clips.len(), 1);
    let clip = &short.tracks[0].clips[0];
    assert_eq!(clip.timeline_start, time(0));
    assert_eq!(clip.timeline_end, time(10_000_000));
    assert_eq!(clip.source_in, time(10_000_000));
    assert_eq!(clip.source_out, time(20_000_000));
    assert_eq!(clip.transform.crop, crop);

    let mut manual = clip.transform;
    manual.crop.left = 0.25;
    service
        .execute_edit_command(EditRequest {
            request_id: RequestId::new(),
            expected_revision: snapshot.revision,
            command: EditCommand::SetTransform {
                sequence_id: short_id,
                track_id: short.tracks[0].id,
                clip_id: clip.id,
                transform: manual,
            },
        })
        .unwrap();

    let updated = service.snapshot().unwrap();
    let short = updated
        .project
        .sequences
        .iter()
        .find(|sequence| sequence.id == short_id)
        .unwrap();
    assert_eq!(short.tracks[0].clips[0].transform.crop.left, 0.25);
}

#[test]
fn completed_silence_analysis_applies_through_editor_and_is_undoable() {
    let (project, source_sequence_id) = fixture();
    let project_id = project.id;
    let mut service = ProjectService::from_project(project, ProjectRevision::new(0)).unwrap();
    let jobs = JobService::new();

    let job_id = jobs
        .start_job(JobSpec {
            kind: JobKind::SilenceAnalysis,
            request_id: RequestId::new(),
            project_id,
            sequence_id: source_sequence_id,
            source_revision: ProjectRevision::new(0),
            cancellable: true,
        })
        .unwrap();
    jobs.mark_completed(job_id).unwrap();
    let job = jobs.get_job_state(job_id).unwrap();

    let applied = service
        .apply_silence_result(
            &job,
            RequestId::new(),
            &[SilenceRange {
                start: time(2_000_000),
                end: time(4_000_000),
            }],
        )
        .unwrap();

    assert_eq!(applied.revision, ProjectRevision::new(1));
    assert_eq!(
        service.snapshot().unwrap().project.sequences[0].tracks[0]
            .clips
            .len(),
        2
    );

    service.undo(RequestId::new()).unwrap();
    let restored = service.snapshot().unwrap();
    assert_eq!(restored.revision, ProjectRevision::new(2));
    assert_eq!(restored.project.sequences[0].tracks[0].clips.len(), 1);
    assert_eq!(
        restored.project.sequences[0].tracks[0].clips[0].timeline_end,
        time(60_000_000)
    );
}

#[test]
fn completed_silence_result_is_reviewable_before_explicit_apply() {
    let (project, source_sequence_id) = fixture();
    let project_id = project.id;
    let jobs = JobService::new();
    let service = ProjectService::from_project(project, ProjectRevision::new(0)).unwrap();

    let job_id = jobs
        .start_job(JobSpec {
            kind: JobKind::SilenceAnalysis,
            request_id: RequestId::new(),
            project_id,
            sequence_id: source_sequence_id,
            source_revision: ProjectRevision::new(0),
            cancellable: false,
        })
        .unwrap();
    let ranges = vec![SilenceRange {
        start: time(2_000_000),
        end: time(4_000_000),
    }];

    jobs.complete_silence(job_id, ranges.clone()).unwrap();

    assert_eq!(jobs.silence_result(job_id).unwrap(), Some(ranges));
    assert_eq!(
        jobs.get_job_state(job_id).unwrap().state,
        job_system::JobState::Completed
    );
    assert_eq!(
        service.snapshot().unwrap().project.sequences[0].tracks[0].clips[0].timeline_end,
        time(60_000_000),
    );
}
