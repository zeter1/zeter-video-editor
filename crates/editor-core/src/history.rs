use crate::{
    ChangedEntity, Clip, DomainError, Marker, MediaRef, Project, SequenceId, SubtitleSegment,
    SubtitleStyle, Track, TrackId,
};

#[derive(Debug, Clone)]
pub(crate) enum HistoryAction {
    ProjectMedia {
        media: Vec<MediaRef>,
    },
    TrackClips {
        sequence_id: SequenceId,
        track_id: TrackId,
        clips: Vec<Clip>,
    },
    SequenceTracks {
        sequence_id: SequenceId,
        tracks: Vec<Track>,
    },
    SequenceSubtitles {
        sequence_id: SequenceId,
        subtitle_segments: Vec<SubtitleSegment>,
    },
    SequenceSubtitleStyle {
        sequence_id: SequenceId,
        subtitle_style: SubtitleStyle,
    },
    SequenceMarkers {
        sequence_id: SequenceId,
        markers: Vec<Marker>,
    },
}

impl HistoryAction {
    pub(crate) fn apply(&self, project: &mut Project) -> Result<(), DomainError> {
        match self {
            Self::ProjectMedia { media } => {
                project.media = media.clone();
            }
            Self::TrackClips {
                sequence_id,
                track_id,
                clips,
            } => {
                let track = find_track_mut(project, *sequence_id, *track_id)?;
                track.clips = clips.clone();
            }
            Self::SequenceTracks {
                sequence_id,
                tracks,
            } => {
                let sequence = project
                    .sequences
                    .iter_mut()
                    .find(|sequence| sequence.id == *sequence_id)
                    .ok_or(DomainError::EntityNotFound { entity: "sequence" })?;
                sequence.tracks = tracks.clone();
            }
            Self::SequenceSubtitles {
                sequence_id,
                subtitle_segments,
            } => {
                let sequence = project
                    .sequences
                    .iter_mut()
                    .find(|sequence| sequence.id == *sequence_id)
                    .ok_or(DomainError::EntityNotFound { entity: "sequence" })?;
                sequence.subtitle_segments = subtitle_segments.clone();
            }
            Self::SequenceSubtitleStyle {
                sequence_id,
                subtitle_style,
            } => {
                let sequence = project
                    .sequences
                    .iter_mut()
                    .find(|sequence| sequence.id == *sequence_id)
                    .ok_or(DomainError::EntityNotFound { entity: "sequence" })?;
                sequence.subtitle_style = subtitle_style.clone();
            }
            Self::SequenceMarkers {
                sequence_id,
                markers,
            } => {
                let sequence = project
                    .sequences
                    .iter_mut()
                    .find(|sequence| sequence.id == *sequence_id)
                    .ok_or(DomainError::EntityNotFound { entity: "sequence" })?;
                sequence.markers = markers.clone();
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub(crate) struct HistoryEntry {
    pub(crate) undo: HistoryAction,
    pub(crate) redo: HistoryAction,
    pub(crate) changed_entities: Vec<ChangedEntity>,
}

#[derive(Debug, Default)]
pub(crate) struct History {
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
}

impl History {
    pub(crate) fn record(&mut self, entry: HistoryEntry) {
        self.undo.push(entry);
        self.redo.clear();
    }

    pub(crate) fn take_undo(&mut self) -> Option<HistoryEntry> {
        self.undo.pop()
    }

    pub(crate) fn restore_undo(&mut self, entry: HistoryEntry) {
        self.undo.push(entry);
    }

    pub(crate) fn push_redo(&mut self, entry: HistoryEntry) {
        self.redo.push(entry);
    }

    pub(crate) fn take_redo(&mut self) -> Option<HistoryEntry> {
        self.redo.pop()
    }

    pub(crate) fn restore_redo(&mut self, entry: HistoryEntry) {
        self.redo.push(entry);
    }
}

pub(crate) fn find_track_mut(
    project: &mut Project,
    sequence_id: SequenceId,
    track_id: TrackId,
) -> Result<&mut Track, DomainError> {
    project
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or(DomainError::EntityNotFound { entity: "sequence" })?
        .tracks
        .iter_mut()
        .find(|track| track.id == track_id)
        .ok_or(DomainError::EntityNotFound { entity: "track" })
}
