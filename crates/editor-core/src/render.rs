#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{EditCommand, EditRequest, ProjectRevision};
    use crate::editor::Editor;
    use crate::ids::{ClipId, MediaId, ProjectId, RequestId, SequenceId, TrackId};
    use crate::media::MediaRef;
    use crate::model::{
        AudioState, Clip, ClipKind, ColorAdjustments, Project, ProjectSettings, Sequence,
        SubtitleSegment, TextAlignment, TextStyle, Track, TrackKind, Transform, Transition,
        TransitionKind,
    };
    use crate::time::TimeUs;
    use std::path::PathBuf;

    fn t(value: i64) -> TimeUs { TimeUs::new(value).unwrap() }

    fn fixture() -> (Project, SequenceId, ClipId) {
        let media_id = MediaId::new();
        let sequence_id = SequenceId::new();
        let video_id = ClipId::new();
        let text_id = ClipId::new();
        let text_style = TextStyle {
            font_family: "Inter".into(),
            font_size: 52.0,
            font_weight: 700,
            alignment: TextAlignment::Center,
            color: "#ffffff".into(),
            stroke_color: Some("#000000".into()),
            shadow: true,
            background_color: Some("#202020".into()),
            opacity: 0.9,
        };

        (
            Project {
                id: ProjectId::new(),
                name: "Render fixture".into(),
                settings: ProjectSettings::default(),
                media: vec![MediaRef {
                    id: media_id,
                    absolute_path: PathBuf::from("C:/media/source.mp4"),
                    project_relative_path: Some(PathBuf::from("media/source.mp4")),
                    size_bytes: 42,
                    duration: t(20_000_000),
                    width: Some(1920),
                    height: Some(1080),
                }],
                sequences: vec![Sequence {
                    id: sequence_id,
                    name: "Main".into(),
                    width: 1920,
                    height: 1080,
                    fps: 29.97,
                    tracks: vec![
                        Track {
                            id: TrackId::new(),
                            kind: TrackKind::Video,
                            muted: false,
                            locked: false,
                            hidden: false,
                            clips: vec![Clip {
                                id: video_id,
                                kind: ClipKind::Video,
                                media_id: Some(media_id),
                                source_in: t(1_000_000),
                                source_out: t(5_000_000),
                                timeline_start: t(2_000_000),
                                timeline_end: t(6_000_000),
                                transform: Transform {
                                    position_x: 12.0,
                                    position_y: -8.0,
                                    scale_x: 1.1,
                                    scale_y: 0.9,
                                    rotation_deg: 4.0,
                                    crop_left: 0.1,
                                    crop_top: 0.2,
                                    crop_right: 0.05,
                                    crop_bottom: 0.0,
                                },
                                color: ColorAdjustments {
                                    exposure: 0.25,
                                    contrast: 0.1,
                                    highlights: -0.2,
                                    shadows: 0.15,
                                    saturation: 0.8,
                                    temperature: 0.05,
                                    tint: -0.03,
                                },
                                audio: AudioState {
                                    gain_db: -2.5,
                                    muted: false,
                                    fade_in: t(100_000),
                                    fade_out: t(200_000),
                                    normalize: true,
                                },
                                speed: 1.25,
                                opacity: 0.8,
                                transition: Some(Transition {
                                    kind: TransitionKind::CrossDissolve,
                                    duration: t(250_000),
                                }),
                                text: None,
                                text_style: None,
                                subtitles: vec![],
                            }],
                        },
                        Track {
                            id: TrackId::new(),
                            kind: TrackKind::Text,
                            muted: false,
                            locked: false,
                            hidden: false,
                            clips: vec![Clip {
                                id: text_id,
                                kind: ClipKind::Text,
                                media_id: None,
                                source_in: t(0),
                                source_out: t(2_000_000),
                                timeline_start: t(3_000_000),
                                timeline_end: t(5_000_000),
                                transform: Transform::default(),
                                color: ColorAdjustments::default(),
                                audio: AudioState::default(),
                                speed: 1.0,
                                opacity: 1.0,
                                transition: None,
                                text: Some("Title".into()),
                                text_style: Some(text_style),
                                subtitles: vec![SubtitleSegment {
                                    start: t(3_000_000),
                                    end: t(4_000_000),
                                    text: "Subtitle".into(),
                                }],
                            }],
                        },
                    ],
                    markers: vec![],
                }],
            },
            sequence_id,
            video_id,
        )
    }

    #[test]
    fn snapshot_preserves_normalized_render_semantics() {
        let (project, sequence_id, video_id) = fixture();
        let snapshot = RenderSnapshot::from_sequence(
            &project,
            sequence_id,
            ProjectRevision::new(7),
        ).unwrap();

        assert_eq!(snapshot.sequence_id, sequence_id);
        assert_eq!(snapshot.revision, ProjectRevision::new(7));
        assert_eq!((snapshot.width, snapshot.height), (1920, 1080));
        assert_eq!(snapshot.fps, 29.97);
        assert_eq!(snapshot.media, project.media);

        let video = snapshot.tracks.iter()
            .flat_map(|track| track.clips.iter())
            .find(|clip| clip.id == video_id)
            .unwrap();
        let source = &project.sequences[0].tracks[0].clips[0];

        assert_eq!((video.source_in, video.source_out), (source.source_in, source.source_out));
        assert_eq!((video.timeline_start, video.timeline_end), (source.timeline_start, source.timeline_end));
        assert_eq!(video.transform, source.transform);
        assert_eq!(video.color, source.color);
        assert_eq!(video.opacity, source.opacity);
        assert_eq!(video.speed, source.speed);
        assert_eq!(video.audio.gain_db, source.audio.gain_db);
        assert_eq!((video.audio.fade_in, video.audio.fade_out), (source.audio.fade_in, source.audio.fade_out));
        assert_eq!(video.transition.as_ref().unwrap().duration, t(250_000));

        let text = snapshot.tracks[1].clips.first().unwrap();
        assert_eq!(text.text.as_ref().unwrap().content, "Title");
        assert_eq!(text.text.as_ref().unwrap().style.as_ref().unwrap().font_size, 52.0);
        assert_eq!(text.subtitles[0].text, "Subtitle");
        assert_eq!((text.subtitles[0].start, text.subtitles[0].end), (t(3_000_000), t(4_000_000)));
    }

    #[test]
    fn snapshot_is_immutable_after_later_project_edits() {
        let (project, sequence_id, video_id) = fixture();
        let mut editor = Editor::new(project).unwrap();
        let snapshot = RenderSnapshot::from_sequence(
            editor.project(),
            sequence_id,
            editor.revision(),
        ).unwrap();

        editor.execute(EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(0),
            command: EditCommand::MoveClip {
                clip_id: video_id,
                timeline_start: t(9_000_000),
            },
        }).unwrap();

        let frozen = snapshot.tracks.iter()
            .flat_map(|track| track.clips.iter())
            .find(|clip| clip.id == video_id)
            .unwrap();

        assert_eq!(snapshot.revision, ProjectRevision::new(0));
        assert_eq!(frozen.timeline_start, t(2_000_000));
        assert_eq!(editor.find_clip(video_id).unwrap().timeline_start, t(9_000_000));
    }
}
