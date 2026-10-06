use serde::{Deserialize, Serialize};

use crate::{
    ClipId, ClipKind, ColorAdjustments, DomainError, MediaId, MediaRef, Project, ProjectId,
    ProjectRevision,
    SequenceId, TextStyle, TimeUs, TrackId, Transform, TransitionKind,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderSnapshot {
    pub project_id: ProjectId,
    pub sequence_id: SequenceId,
    pub revision: ProjectRevision,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub media: Vec<MediaRef>,
    pub clips: Vec<RenderClip>,
    pub texts: Vec<RenderText>,
    pub subtitles: Vec<RenderSubtitle>,
    pub audio: Vec<RenderAudio>,
    pub transitions: Vec<RenderTransition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderClip {
    pub clip_id: ClipId,
    pub track_id: TrackId,
    pub track_index: usize,
    pub clip_index: usize,
    pub kind: ClipKind,
    pub media_id: Option<MediaId>,
    pub source_in: TimeUs,
    pub source_out: TimeUs,
    pub timeline_start: TimeUs,
    pub timeline_end: TimeUs,
    pub transform: Transform,
    pub color: ColorAdjustments,
    pub speed: f64,
    pub track_hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderText {
    pub clip_id: ClipId,
    pub timeline_start: TimeUs,
    pub timeline_end: TimeUs,
    pub text: String,
    pub style: TextStyle,
    pub transform: Transform,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderSubtitle {
    pub start: TimeUs,
    pub end: TimeUs,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderAudio {
    pub clip_id: ClipId,
    pub volume: f32,
    pub gain_db: f32,
    pub muted: bool,
    pub fade_in: TimeUs,
    pub fade_out: TimeUs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderTransition {
    pub clip_id: ClipId,
    pub kind: TransitionKind,
    pub duration: TimeUs,
}

impl RenderSnapshot {
    pub fn from_sequence(
        project: &Project,
        sequence_id: SequenceId,
        revision: ProjectRevision,
    ) -> Result<Self, DomainError> {
        project.validate()?;
        let sequence = project
            .sequences
            .iter()
            .find(|sequence| sequence.id == sequence_id)
            .ok_or(DomainError::EntityNotFound { entity: "sequence" })?;

        let media = project
            .media
            .iter()
            .filter(|media| {
                sequence
                    .tracks
                    .iter()
                    .flat_map(|track| track.clips.iter())
                    .any(|clip| clip.media_id == Some(media.id))
            })
            .cloned()
            .collect();

        let mut clips = Vec::new();
        let mut texts = Vec::new();
        let mut audio = Vec::new();
        let mut transitions = Vec::new();

        for (track_index, track) in sequence.tracks.iter().enumerate() {
            for (clip_index, clip) in track.clips.iter().enumerate() {
                clips.push(RenderClip {
                    clip_id: clip.id,
                    track_id: track.id,
                    track_index,
                    clip_index,
                    kind: clip.kind,
                    media_id: clip.media_id,
                    source_in: clip.source_in,
                    source_out: clip.source_out,
                    timeline_start: clip.timeline_start,
                    timeline_end: clip.timeline_end,
                    transform: clip.transform,
                    color: clip.color,
                    speed: clip.speed,
                    track_hidden: track.hidden,
                });

                audio.push(RenderAudio {
                    clip_id: clip.id,
                    volume: clip.audio.volume,
                    gain_db: clip.audio.gain_db,
                    muted: clip.audio.muted || track.muted,
                    fade_in: clip.audio.fade_in,
                    fade_out: clip.audio.fade_out,
                });

                if let Some(text) = &clip.text {
                    texts.push(RenderText {
                        clip_id: clip.id,
                        timeline_start: clip.timeline_start,
                        timeline_end: clip.timeline_end,
                        text: text.text.clone(),
                        style: text.style.clone(),
                        transform: clip.transform,
                    });
                }

                if let Some(transition) = clip.transition {
                    transitions.push(RenderTransition {
                        clip_id: clip.id,
                        kind: transition.kind,
                        duration: transition.duration,
                    });
                }
            }
        }

        let subtitles = sequence
            .subtitle_segments
            .iter()
            .map(|segment| RenderSubtitle {
                start: segment.start,
                end: segment.end,
                text: segment.text.clone(),
            })
            .collect();

        Ok(Self {
            project_id: project.id,
            sequence_id,
            revision,
            width: sequence.width,
            height: sequence.height,
            fps: sequence.fps,
            media,
            clips,
            texts,
            subtitles,
            audio,
            transitions,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        AudioState, Clip, ClipId, ClipKind, ColorAdjustments, Crop, MediaId, MediaRef, Project,
        ProjectId, ProjectRevision, ProjectSettings, RenderSnapshot, Sequence, SequenceId,
        SubtitleSegment, TextState, TextStyle, TimeUs, Track, TrackId, TrackKind, Transform,
        Transition, TransitionKind,
    };

    fn time(value: i64) -> TimeUs {
        TimeUs::new(value).expect("test time")
    }

    fn fixture() -> (Project, SequenceId, ClipId) {
        let media_id = MediaId::new();
        let sequence_id = SequenceId::new();
        let clip_id = ClipId::new();
        let video = Clip {
            id: clip_id,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: time(1_000_000),
            source_out: time(6_000_000),
            timeline_start: time(2_000_000),
            timeline_end: time(7_000_000),
            transform: Transform {
                position_x: 0.25,
                position_y: -0.5,
                scale_x: 1.2,
                scale_y: 0.8,
                rotation_degrees: 12.0,
                opacity: 0.75,
                crop: Crop {
                    left: 0.1,
                    top: 0.2,
                    right: 0.3,
                    bottom: 0.4,
                },
            },
            color: ColorAdjustments {
                exposure: 0.1,
                contrast: 0.2,
                highlights: -0.1,
                shadows: 0.3,
                saturation: 1.1,
                temperature: 0.05,
                tint: -0.02,
            },
            audio: AudioState {
                volume: 0.8,
                gain_db: 2.5,
                muted: false,
                fade_in: time(250_000),
                fade_out: time(500_000),
            },
            speed: 1.5,
            transition: Some(Transition {
                kind: TransitionKind::CrossDissolve,
                duration: time(300_000),
            }),
            text: None,
        };
        let text_clip = Clip {
            id: ClipId::new(),
            kind: ClipKind::Text,
            media_id: None,
            source_in: time(0),
            source_out: time(2_000_000),
            timeline_start: time(3_000_000),
            timeline_end: time(5_000_000),
            transform: Transform::default(),
            color: ColorAdjustments::default(),
            audio: AudioState::default(),
            speed: 1.0,
            transition: None,
            text: Some(TextState {
                text: "Hello".into(),
                style: TextStyle::default(),
            }),
        };
        let project = Project {
            id: ProjectId::new(),
            name: "Render".into(),
            settings: ProjectSettings::default(),
            media: vec![MediaRef {
                id: media_id,
                absolute_path: "C:/media/source.mp4".into(),
                project_relative_path: None,
                file_size: 10,
                duration: Some(time(10_000_000)),
                width: Some(1920),
                height: Some(1080),
            }],
            sequences: vec![Sequence {
                id: sequence_id,
                name: "Main".into(),
                width: 1920,
                height: 1080,
                fps: 29.97,
                tracks: vec![Track {
                    id: TrackId::new(),
                    name: "Video 1".into(),
                    kind: TrackKind::Video,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![video, text_clip],
                }],
                subtitle_segments: vec![SubtitleSegment {
                    start: time(1_500_000),
                    end: time(2_500_000),
                    text: "Subtitle".into(),
                }],
                markers: Vec::new(),
            }],
        };
        (project, sequence_id, clip_id)
    }

    #[test]
    fn snapshot_preserves_render_semantics_exactly() {
        let (project, sequence_id, clip_id) = fixture();
        let snapshot =
            RenderSnapshot::from_sequence(&project, sequence_id, ProjectRevision::new(7)).unwrap();

        assert_eq!(snapshot.revision, ProjectRevision::new(7));
        assert_eq!(snapshot.width, 1920);
        assert_eq!(snapshot.height, 1080);
        assert_eq!(snapshot.fps, 29.97);

        let clip = snapshot
            .clips
            .iter()
            .find(|clip| clip.clip_id == clip_id)
            .unwrap();
        assert_eq!(clip.source_in, time(1_000_000));
        assert_eq!(clip.source_out, time(6_000_000));
        assert_eq!(clip.timeline_start, time(2_000_000));
        assert_eq!(clip.timeline_end, time(7_000_000));
        assert_eq!(clip.transform.opacity, 0.75);
        assert_eq!(clip.transform.crop.left, 0.1);
        assert_eq!(clip.color.saturation, 1.1);
        assert_eq!(clip.speed, 1.5);

        let audio = snapshot
            .audio
            .iter()
            .find(|audio| audio.clip_id == clip_id)
            .unwrap();
        assert_eq!(audio.volume, 0.8);
        assert_eq!(audio.gain_db, 2.5);
        assert_eq!(audio.fade_in, time(250_000));
        assert_eq!(audio.fade_out, time(500_000));

        let transition = snapshot
            .transitions
            .iter()
            .find(|transition| transition.clip_id == clip_id)
            .unwrap();
        assert_eq!(transition.kind, TransitionKind::CrossDissolve);
        assert_eq!(transition.duration, time(300_000));

        assert_eq!(snapshot.texts.len(), 1);
        assert_eq!(snapshot.texts[0].text, "Hello");
        assert_eq!(snapshot.texts[0].timeline_start, time(3_000_000));
        assert_eq!(snapshot.subtitles[0].text, "Subtitle");
        assert_eq!(snapshot.subtitles[0].start, time(1_500_000));
        assert_eq!(snapshot.subtitles[0].end, time(2_500_000));
    }

    #[test]
    fn snapshot_is_immutable_after_later_project_edits() {
        let (mut project, sequence_id, clip_id) = fixture();
        let snapshot =
            RenderSnapshot::from_sequence(&project, sequence_id, ProjectRevision::new(4)).unwrap();

        let source_before = snapshot
            .clips
            .iter()
            .find(|clip| clip.clip_id == clip_id)
            .unwrap()
            .source_in;
        project.sequences[0].tracks[0].clips[0].source_in = time(4_000_000);
        project.sequences[0].tracks[0].clips[0].transform.opacity = 0.1;
        project.sequences[0].subtitle_segments[0].text = "Changed".into();

        let snap_clip = snapshot
            .clips
            .iter()
            .find(|clip| clip.clip_id == clip_id)
            .unwrap();
        assert_eq!(snap_clip.source_in, source_before);
        assert_eq!(snap_clip.transform.opacity, 0.75);
        assert_eq!(snapshot.subtitles[0].text, "Subtitle");
    }
}
