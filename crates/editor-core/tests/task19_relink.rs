use editor_core::{
    EditCommand, EditRequest, Editor, MediaId, MediaRef, Project, ProjectId, ProjectRevision,
    ProjectSettings, RequestId,
};

#[test]
fn relink_media_is_one_undoable_revision_preserving_media_identity() {
    let media_id = MediaId::new();
    let original = MediaRef {
        id: media_id,
        absolute_path: r"C:\missing\old.mp4".into(),
        project_relative_path: Some("old.mp4".into()),
        file_size: 10,
        duration: None,
        width: Some(1280),
        height: Some(720),
    };
    let replacement = MediaRef {
        id: media_id,
        absolute_path: r"D:\media\replacement.mp4".into(),
        project_relative_path: Some("replacement.mp4".into()),
        file_size: 20,
        duration: None,
        width: Some(1920),
        height: Some(1080),
    };
    let project = Project {
        id: ProjectId::new(),
        name: "Relink".into(),
        settings: ProjectSettings::default(),
        media: vec![original.clone()],
        sequences: Vec::new(),
    };
    let mut editor = Editor::new(project).unwrap();

    let result = editor
        .execute(EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(0),
            command: EditCommand::RelinkMedia {
                media_id,
                media: replacement.clone(),
            },
        })
        .unwrap();

    assert_eq!(result.revision, ProjectRevision::new(1));
    assert_eq!(editor.project().media, vec![replacement]);
    assert_eq!(editor.project().media[0].id, media_id);

    let undo = editor.undo(RequestId::new()).unwrap();
    assert_eq!(undo.revision, ProjectRevision::new(2));
    assert_eq!(editor.project().media, vec![original]);
}
