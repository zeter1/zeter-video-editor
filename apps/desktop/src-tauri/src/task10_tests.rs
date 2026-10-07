use std::fs;

use editor_core::{
    EditCommand, EditRequest, MediaId, MediaRef, Project, ProjectId, ProjectRevision,
    ProjectSettings, RequestId, Sequence, SequenceId, SubtitleStyle, TextStyle, TimeUs, Track,
    TrackId, TrackKind,
};
use job_system::{JobKind, JobSpec};
use tempfile::tempdir;

use crate::{
    app::{job_service::JobService, project_service::ProjectService},
    contracts::write_typescript_contract,
};

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).expect("fixture time")
}

fn fixture_project() -> (Project, SequenceId, TrackId) {
    let sequence_id = SequenceId::new();
    let track_id = TrackId::new();
    (
        Project {
            id: ProjectId::new(),
            name: "IPC fixture".into(),
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

fn add_text_request(
    revision: ProjectRevision,
    sequence_id: SequenceId,
    track_id: TrackId,
    text: &str,
) -> EditRequest {
    EditRequest {
        request_id: RequestId::new(),
        expected_revision: revision,
        command: EditCommand::AddText {
            sequence_id,
            track_id,
            clip_id: editor_core::ClipId::new(),
            timeline_start: time(0),
            timeline_end: time(1_000_000),
            text: text.into(),
            style: TextStyle::default(),
        },
    }
}

#[test]
fn project_open_preserves_saved_revision_and_stale_errors_are_typed() {
    let (project, sequence_id, track_id) = fixture_project();
    let dir = tempdir().unwrap();
    let path = dir.path().join("fixture.vcut");
    project_io::save_atomic(&path, &project, ProjectRevision::new(8)).unwrap();

    let mut service = ProjectService::empty();
    let opened = service.open(&path).expect("open project");

    assert_eq!(opened.revision, ProjectRevision::new(8));
    assert_eq!(opened.project, project);

    let result = service
        .execute_edit_command(add_text_request(
            ProjectRevision::new(8),
            sequence_id,
            track_id,
            "authoritative",
        ))
        .expect("edit through editor");
    assert_eq!(result.revision, ProjectRevision::new(9));

    let stale = service
        .execute_edit_command(add_text_request(
            ProjectRevision::new(8),
            sequence_id,
            track_id,
            "stale",
        ))
        .unwrap_err()
        .to_dto(Some(RequestId::new()), None);
    assert_eq!(stale.code, "stale_revision");
    assert!(!stale.retryable);
}

#[test]
fn import_media_is_an_editor_command_and_is_undoable() {
    let (project, _, _) = fixture_project();
    let mut service =
        ProjectService::from_project(project, ProjectRevision::new(3)).expect("service");

    let media = MediaRef {
        id: MediaId::new(),
        absolute_path: r"D:\media\take.mp4".into(),
        project_relative_path: None,
        file_size: 1234,
        duration: Some(time(2_000_000)),
        width: Some(1920),
        height: Some(1080),
    };

    let imported = service
        .import_media(RequestId::new(), ProjectRevision::new(3), media.clone())
        .expect("import media");
    assert_eq!(imported.revision, ProjectRevision::new(4));
    assert_eq!(service.snapshot().unwrap().project.media, vec![media]);

    let undone = service.undo(RequestId::new()).expect("undo import");
    assert_eq!(undone.revision, ProjectRevision::new(5));
    assert!(service.snapshot().unwrap().project.media.is_empty());
}

#[test]
fn completed_job_never_mutates_timeline_and_stale_result_revalidates_through_editor() {
    let (project, sequence_id, track_id) = fixture_project();
    let project_id = project.id;
    let mut projects =
        ProjectService::from_project(project, ProjectRevision::new(0)).expect("service");
    let jobs = JobService::new();

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

    projects
        .execute_edit_command(add_text_request(
            ProjectRevision::new(0),
            sequence_id,
            track_id,
            "newer edit",
        ))
        .unwrap();
    let before_completion = projects.snapshot().unwrap();

    jobs.mark_completed(job_id).unwrap();
    assert_eq!(projects.snapshot().unwrap(), before_completion);

    let job = jobs.get_job_state(job_id).unwrap();
    let stale = projects
        .execute_job_result(
            &job,
            RequestId::new(),
            EditCommand::AddText {
                sequence_id,
                track_id,
                clip_id: editor_core::ClipId::new(),
                timeline_start: time(1_000_000),
                timeline_end: time(2_000_000),
                text: "stale AI result".into(),
                style: TextStyle::default(),
            },
        )
        .unwrap_err()
        .to_dto(None, Some(job_id));

    assert_eq!(stale.code, "stale_revision");
    assert_eq!(
        projects.snapshot().unwrap().revision,
        ProjectRevision::new(1)
    );
}

#[test]
fn generated_typescript_contract_matches_committed_file_byte_for_byte() {
    let dir = tempdir().unwrap();
    let generated = dir.path().join("ipc.ts");

    write_typescript_contract(&generated).expect("generate contract");
    let expected =
        fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/generated/ipc.ts"))
            .expect("committed contract");

    assert_eq!(fs::read(generated).unwrap(), expected);
}

#[test]
fn project_dirty_state_tracks_the_last_successful_save_revision() {
    let (project, sequence_id, track_id) = fixture_project();
    let dir = tempdir().unwrap();
    let path = dir.path().join("dirty-state.vcut");
    project_io::save_atomic(&path, &project, ProjectRevision::new(4)).unwrap();

    let mut service = ProjectService::empty();
    service.open(&path).expect("open fixture");
    assert!(!service.is_dirty());

    service
        .execute_edit_command(add_text_request(
            ProjectRevision::new(4),
            sequence_id,
            track_id,
            "dirty",
        ))
        .expect("edit project");
    assert!(service.is_dirty());

    service.save(&path).expect("save edited project");
    assert!(!service.is_dirty());

    service.undo(RequestId::new()).expect("undo after save");
    assert!(service.is_dirty());
}
