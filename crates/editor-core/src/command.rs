use crate::ids::{ClipId, RequestId, SequenceId, TrackId};
use crate::model::{
    Clip, ColorAdjustments, Marker, SubtitleSegment, TextStyle, Track, Transform, Transition,
};
use crate::time::TimeUs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectRevision(u64);

impl ProjectRevision {
    pub const ZERO: Self = Self(0);

    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }

    pub(crate) fn next(self) -> Self {
        Self(self.0.checked_add(1).expect("project revision overflow"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ChangedEntity {
    Sequence(SequenceId),
    Track(TrackId),
    Clip(ClipId),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EditCommand {
    AddClip {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip: Clip,
    },
    DeleteClip {
        clip_id: ClipId,
    },
    MoveClip {
        clip_id: ClipId,
        timeline_start: TimeUs,
    },
    TrimClip {
        clip_id: ClipId,
        source_in: TimeUs,
        source_out: TimeUs,
        timeline_start: TimeUs,
        timeline_end: TimeUs,
    },
    SplitClip {
        clip_id: ClipId,
        at: TimeUs,
        right_clip_id: ClipId,
    },
    DuplicateClip {
        clip_id: ClipId,
        new_clip_id: ClipId,
        timeline_start: TimeUs,
    },
    RippleDelete {
        clip_id: ClipId,
    },
    AddTrack {
        sequence_id: SequenceId,
        track: Track,
    },
    RemoveTrack {
        track_id: TrackId,
    },
    ReorderTrack {
        sequence_id: SequenceId,
        track_id: TrackId,
        new_index: usize,
    },
    SetTrackMute {
        track_id: TrackId,
        muted: bool,
    },
    SetTrackLock {
        track_id: TrackId,
        locked: bool,
    },
    SetTrackHidden {
        track_id: TrackId,
        hidden: bool,
    },
    SetVolume {
        clip_id: ClipId,
        gain_db: f32,
    },
    NormalizeAudio {
        clip_id: ClipId,
        normalize: bool,
    },
    SetTransform {
        clip_id: ClipId,
        transform: Transform,
    },
    SetColor {
        clip_id: ClipId,
        color: ColorAdjustments,
    },
    SetSpeed {
        clip_id: ClipId,
        speed: f64,
    },
    AddTransition {
        clip_id: ClipId,
        transition: Option<Transition>,
    },
    AddText {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip: Clip,
    },
    SetTextStyle {
        clip_id: ClipId,
        style: TextStyle,
    },
    AddSubtitleSegments {
        clip_id: ClipId,
        segments: Vec<SubtitleSegment>,
    },
    AddMarker {
        sequence_id: SequenceId,
        marker: Marker,
    },
    RemoveMarker {
        sequence_id: SequenceId,
        at: TimeUs,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EditRequest {
    pub request_id: RequestId,
    pub expected_revision: ProjectRevision,
    pub command: EditCommand,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandResult {
    pub request_id: RequestId,
    pub revision: ProjectRevision,
    pub changed_entities: Vec<ChangedEntity>,
}

#[cfg(test)]
mod tests {
    use crate::command::{EditCommand, EditRequest, ProjectRevision};
    use crate::editor::Editor;
    use crate::ids::{ClipId, MediaId, ProjectId, RequestId, SequenceId, TrackId};
    use crate::media::MediaRef;
    use crate::model::{
        AudioState, Clip, ClipKind, ColorAdjustments, Marker, Project, ProjectSettings, Sequence,
        TextAlignment, TextStyle, Track, TrackKind, Transform, Transition, TransitionKind,
    };
    use crate::time::TimeUs;
    use std::path::PathBuf;

    fn t(value: i64) -> TimeUs { TimeUs::new(value).unwrap() }

    fn fixture() -> (Project, SequenceId, TrackId, ClipId, MediaId) {
        let media_id = MediaId::new();
        let sequence_id = SequenceId::new();
        let track_id = TrackId::new();
        let clip_id = ClipId::new();
        (
            Project {
                id: ProjectId::new(),
                name: "Command surface".into(),
                settings: ProjectSettings::default(),
                media: vec![MediaRef {
                    id: media_id,
                    absolute_path: PathBuf::from("C:/media/source.mp4"),
                    project_relative_path: None,
                    size_bytes: 1000,
                    duration: t(20_000_000),
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
                        id: track_id,
                        kind: TrackKind::Video,
                        muted: false,
                        locked: false,
                        hidden: false,
                        clips: vec![Clip {
                            id: clip_id,
                            kind: ClipKind::Video,
                            media_id: Some(media_id),
                            source_in: t(0),
                            source_out: t(4_000_000),
                            timeline_start: t(0),
                            timeline_end: t(4_000_000),
                            transform: Transform::default(),
                            color: ColorAdjustments::default(),
                            audio: AudioState::default(),
                            speed: 1.0,
                            opacity: 1.0,
                            transition: None,
                            text: None,
                            text_style: None,
                            subtitles: vec![],
                        }],
                    }],
                    markers: vec![],
                }],
            },
            sequence_id,
            track_id,
            clip_id,
            media_id,
        )
    }

    fn run(editor: &mut Editor, revision: u64, command: EditCommand) {
        editor.execute(EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(revision),
            command,
        }).unwrap();
    }

    #[test]
    fn track_commands_add_reorder_toggle_and_remove_tracks() {
        let (project, sequence_id, track_id, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();
        let audio_track = Track {
            id: TrackId::new(),
            kind: TrackKind::Audio,
            muted: false,
            locked: false,
            hidden: false,
            clips: vec![],
        };

        run(&mut editor, 0, EditCommand::AddTrack { sequence_id, track: audio_track.clone() });
        run(&mut editor, 1, EditCommand::ReorderTrack { sequence_id, track_id: audio_track.id, new_index: 0 });
        run(&mut editor, 2, EditCommand::SetTrackMute { track_id, muted: true });
        run(&mut editor, 3, EditCommand::SetTrackHidden { track_id, hidden: true });

        let sequence = &editor.project().sequences[0];
        assert_eq!(sequence.tracks[0].id, audio_track.id);
        let video = sequence.tracks.iter().find(|track| track.id == track_id).unwrap();
        assert!(video.muted);
        assert!(video.hidden);

        run(&mut editor, 4, EditCommand::RemoveTrack { track_id: audio_track.id });
        assert_eq!(editor.project().sequences[0].tracks.len(), 1);
    }

    #[test]
    fn clip_property_commands_update_audio_transform_color_speed_and_transition() {
        let (project, _, _, clip_id, _) = fixture();
        let mut editor = Editor::new(project).unwrap();
        let transform = Transform { position_x: 12.0, ..Transform::default() };
        let color = ColorAdjustments { exposure: 0.25, ..ColorAdjustments::default() };
        let transition = Transition { kind: TransitionKind::CrossDissolve, duration: t(250_000) };

        run(&mut editor, 0, EditCommand::SetVolume { clip_id, gain_db: -3.0 });
        run(&mut editor, 1, EditCommand::NormalizeAudio { clip_id, normalize: true });
        run(&mut editor, 2, EditCommand::SetTransform { clip_id, transform });
        run(&mut editor, 3, EditCommand::SetColor { clip_id, color });
        run(&mut editor, 4, EditCommand::SetSpeed { clip_id, speed: 1.5 });
        run(&mut editor, 5, EditCommand::AddTransition { clip_id, transition: Some(transition) });

        let clip = editor.find_clip(clip_id).unwrap();
        assert_eq!(clip.audio.gain_db, -3.0);
        assert!(clip.audio.normalize);
        assert_eq!(clip.transform, transform);
        assert_eq!(clip.color, color);
        assert_eq!(clip.speed, 1.5);
        assert_eq!(clip.transition, Some(transition));
    }

    #[test]
    fn add_delete_text_style_subtitles_and_markers_are_normal_project_state() {
        let (project, sequence_id, track_id, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();
        let text_id = ClipId::new();
        let text_clip = Clip {
            id: text_id,
            kind: ClipKind::Text,
            media_id: None,
            source_in: t(0),
            source_out: t(2_000_000),
            timeline_start: t(1_000_000),
            timeline_end: t(3_000_000),
            transform: Transform::default(),
            color: ColorAdjustments::default(),
            audio: AudioState::default(),
            speed: 1.0,
            opacity: 1.0,
            transition: None,
            text: Some("Title".into()),
            text_style: None,
            subtitles: vec![],
        };
        let style = TextStyle {
            font_family: "Arial".into(),
            font_size: 48.0,
            font_weight: 700,
            alignment: TextAlignment::Center,
            color: "#ffffff".into(),
            stroke_color: Some("#000000".into()),
            shadow: true,
            background_color: None,
            opacity: 1.0,
        };
        let marker = Marker { at: t(1_500_000), label: "Hook".into() };

        run(&mut editor, 0, EditCommand::AddText { sequence_id, track_id, clip: text_clip });
        run(&mut editor, 1, EditCommand::SetTextStyle { clip_id: text_id, style: style.clone() });
        run(&mut editor, 2, EditCommand::AddSubtitleSegments {
            clip_id: text_id,
            segments: vec![crate::model::SubtitleSegment { start: t(1_000_000), end: t(1_500_000), text: "Hello".into() }],
        });
        run(&mut editor, 3, EditCommand::AddMarker { sequence_id, marker: marker.clone() });

        let clip = editor.find_clip(text_id).unwrap();
        assert_eq!(clip.text.as_deref(), Some("Title"));
        assert_eq!(clip.text_style.as_ref(), Some(&style));
        assert_eq!(clip.subtitles.len(), 1);
        assert_eq!(editor.project().sequences[0].markers, vec![marker.clone()]);

        run(&mut editor, 4, EditCommand::RemoveMarker { sequence_id, at: marker.at });
        run(&mut editor, 5, EditCommand::DeleteClip { clip_id: text_id });
        assert!(editor.find_clip(text_id).is_none());
        assert!(editor.project().sequences[0].markers.is_empty());
    }

    #[test]
    fn add_clip_inserts_media_clip_without_mutating_source_media() {
        let (project, sequence_id, track_id, _, media_id) = fixture();
        let source = project.media[0].clone();
        let mut editor = Editor::new(project).unwrap();
        let clip_id = ClipId::new();
        let clip = Clip {
            id: clip_id,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: t(2_000_000),
            source_out: t(3_000_000),
            timeline_start: t(5_000_000),
            timeline_end: t(6_000_000),
            transform: Transform::default(),
            color: ColorAdjustments::default(),
            audio: AudioState::default(),
            speed: 1.0,
            opacity: 1.0,
            transition: None,
            text: None,
            text_style: None,
            subtitles: vec![],
        };

        run(&mut editor, 0, EditCommand::AddClip { sequence_id, track_id, clip });
        assert!(editor.find_clip(clip_id).is_some());
        assert_eq!(editor.project().media[0], source);
    }
}
