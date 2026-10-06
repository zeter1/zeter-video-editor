use crate::command::ProjectRevision;
use crate::ids::{ClipId, MediaId, ProjectId, SequenceId, TrackId};
use crate::media::MediaRef;
use crate::model::{
    ClipKind, ColorAdjustments, Project, TextStyle, TrackKind, Transform, TransitionKind,
};
use crate::time::TimeUs;
use crate::DomainError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderSnapshot {
    pub project_id: ProjectId,
    pub sequence_id: SequenceId,
    pub revision: ProjectRevision,
    pub media: Vec<MediaRef>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub tracks: Vec<RenderTrack>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderTrack {
    pub id: TrackId,
    pub kind: TrackKind,
    pub muted: bool,
    pub hidden: bool,
    pub clips: Vec<RenderClip>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderClip {
    pub id: ClipId,
    pub kind: ClipKind,
    pub media_id: Option<MediaId>,
    pub source_in: TimeUs,
    pub source_out: TimeUs,
    pub timeline_start: TimeUs,
    pub timeline_end: TimeUs,
    pub transform: Transform,
    pub color: ColorAdjustments,
    pub speed: f64,
    pub opacity: f32,
    pub audio: RenderAudio,
    pub transition: Option<RenderTransition>,
    pub text: Option<RenderText>,
    pub subtitles: Vec<RenderSubtitle>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RenderAudio {
    pub gain_db: f32,
    pub muted: bool,
    pub fade_in: TimeUs,
    pub fade_out: TimeUs,
    pub normalize: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderTransition {
    pub kind: TransitionKind,
    pub duration: TimeUs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderText {
    pub content: String,
    pub style: Option<TextStyle>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderSubtitle {
    pub start: TimeUs,
    pub end: TimeUs,
    pub text: String,
}

impl RenderSnapshot {
    pub fn from_sequence(
        project: &Project,
        sequence_id: SequenceId,
        revision: ProjectRevision,
    ) -> Result<Self, DomainError> {
        let sequence = project
            .sequences
            .iter()
            .find(|sequence| sequence.id == sequence_id)
            .ok_or(DomainError::SequenceNotFound(sequence_id))?;

        let tracks = sequence
            .tracks
            .iter()
            .map(|track| RenderTrack {
                id: track.id,
                kind: track.kind,
                muted: track.muted,
                hidden: track.hidden,
                clips: track
                    .clips
                    .iter()
                    .map(|clip| RenderClip {
                        id: clip.id,
                        kind: clip.kind,
                        media_id: clip.media_id,
                        source_in: clip.source_in,
                        source_out: clip.source_out,
                        timeline_start: clip.timeline_start,
                        timeline_end: clip.timeline_end,
                        transform: clip.transform,
                        color: clip.color,
                        speed: clip.speed,
                        opacity: clip.opacity,
                        audio: RenderAudio {
                            gain_db: clip.audio.gain_db,
                            muted: clip.audio.muted,
                            fade_in: clip.audio.fade_in,
                            fade_out: clip.audio.fade_out,
                            normalize: clip.audio.normalize,
                        },
                        transition: clip.transition.map(|transition| RenderTransition {
                            kind: transition.kind,
                            duration: transition.duration,
                        }),
                        text: clip.text.as_ref().map(|content| RenderText {
                            content: content.clone(),
                            style: clip.text_style.clone(),
                        }),
                        subtitles: clip
                            .subtitles
                            .iter()
                            .map(|segment| RenderSubtitle {
                                start: segment.start,
                                end: segment.end,
                                text: segment.text.clone(),
                            })
                            .collect(),
                    })
                    .collect(),
            })
            .collect();

        Ok(Self {
            project_id: project.id,
            sequence_id,
            revision,
            media: project.media.clone(),
            width: sequence.width,
            height: sequence.height,
            fps: sequence.fps,
            tracks,
        })
    }
}

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
