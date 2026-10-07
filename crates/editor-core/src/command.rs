use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AudioState, Clip, ClipId, ColorAdjustments, Marker, MediaId, MediaRef, RequestId, Sequence,
    SequenceId, SubtitleSegment, SubtitleStyle, TextStyle, TimeUs, TimelineRange, Track, TrackId,
    Transform, Transition,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProjectRevision(u64);

impl ProjectRevision {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }

    pub(crate) fn next(self) -> Option<Self> {
        self.0.checked_add(1).map(Self)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EditCommand {
    ImportMedia {
        media: MediaRef,
    },
    AddSequence {
        sequence: Sequence,
        index: Option<usize>,
    },
    AddClip {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip: Clip,
    },
    DeleteClip {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
    },
    MoveClip {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        timeline_start: TimeUs,
    },
    TrimClip {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        source_in: TimeUs,
        source_out: TimeUs,
        timeline_start: TimeUs,
        timeline_end: TimeUs,
    },
    SplitClip {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        split_at: TimeUs,
        right_clip_id: ClipId,
    },
    DuplicateClip {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        duplicate_id: ClipId,
        timeline_start: TimeUs,
    },
    RippleDelete {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
    },
    ApplySilenceRemoval {
        sequence_id: SequenceId,
        ranges: Vec<TimelineRange>,
    },
    AddTrack {
        sequence_id: SequenceId,
        track: Track,
        index: Option<usize>,
    },
    RemoveTrack {
        sequence_id: SequenceId,
        track_id: TrackId,
    },
    ReorderTrack {
        sequence_id: SequenceId,
        track_id: TrackId,
        new_index: usize,
    },
    SetTrackMute {
        sequence_id: SequenceId,
        track_id: TrackId,
        muted: bool,
    },
    SetTrackLock {
        sequence_id: SequenceId,
        track_id: TrackId,
        locked: bool,
    },
    SetTrackHidden {
        sequence_id: SequenceId,
        track_id: TrackId,
        hidden: bool,
    },
    SetVolume {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        volume: f32,
    },
    NormalizeAudio {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        gain_db: f32,
    },
    SetAudioState {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        audio: AudioState,
    },
    SetTransform {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        transform: Transform,
    },
    SetColor {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        color: ColorAdjustments,
    },
    SetSpeed {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        speed: f64,
    },
    AddTransition {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        transition: Transition,
    },
    AddText {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        timeline_start: TimeUs,
        timeline_end: TimeUs,
        text: String,
        style: TextStyle,
    },
    SetTextStyle {
        sequence_id: SequenceId,
        track_id: TrackId,
        clip_id: ClipId,
        style: TextStyle,
    },
    AddSubtitleSegments {
        sequence_id: SequenceId,
        segments: Vec<SubtitleSegment>,
    },
    SetSubtitleSegments {
        sequence_id: SequenceId,
        segments: Vec<SubtitleSegment>,
    },
    SetSubtitleStyle {
        sequence_id: SequenceId,
        style: SubtitleStyle,
    },
    AddMarker {
        sequence_id: SequenceId,
        marker: Marker,
    },
    RemoveMarker {
        sequence_id: SequenceId,
        marker_id: Uuid,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EditRequest {
    pub request_id: RequestId,
    pub expected_revision: ProjectRevision,
    pub command: EditCommand,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChangedEntity {
    Media(MediaId),
    Sequence(SequenceId),
    Track(TrackId),
    Clip(ClipId),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandResult {
    pub request_id: RequestId,
    pub revision: ProjectRevision,
    pub changed_entities: Vec<ChangedEntity>,
}
