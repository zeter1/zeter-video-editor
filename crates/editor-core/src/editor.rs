use crate::command::{
    ChangedEntity, CommandResult, EditCommand, EditRequest, ProjectRevision,
};
use crate::history::HistoryEntry;
use crate::ids::{ClipId, RequestId, SequenceId, TrackId};
use crate::model::{Clip, ClipKind, Project, Sequence};
use crate::time::TimeUs;
use crate::DomainError;

#[derive(Debug, Clone)]
pub struct Editor {
    project: Project,
    revision: ProjectRevision,
    undo_stack: Vec<HistoryEntry>,
    redo_stack: Vec<HistoryEntry>,
}

impl Editor {
    pub fn new(project: Project) -> Result<Self, DomainError> {
        project.validate()?;
        Ok(Self {
            project,
            revision: ProjectRevision::ZERO,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        })
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn revision(&self) -> ProjectRevision {
        self.revision
    }

    pub fn find_clip(&self, clip_id: ClipId) -> Option<&Clip> {
        self.project
            .sequences
            .iter()
            .flat_map(|sequence| sequence.tracks.iter())
            .flat_map(|track| track.clips.iter())
            .find(|clip| clip.id == clip_id)
    }

    pub fn execute(&mut self, request: EditRequest) -> Result<CommandResult, DomainError> {
        if request.expected_revision != self.revision {
            return Err(DomainError::StaleRevision {
                expected: request.expected_revision,
                actual: self.revision,
            });
        }

        let sequence_id = command_sequence_id(&self.project, &request.command)?;
        let before = sequence_by_id(&self.project, sequence_id)?.clone();

        let mut candidate = self.project.clone();
        let changed_entities = apply_command(&mut candidate, &request.command)?;
        candidate.validate()?;
        let after = sequence_by_id(&candidate, sequence_id)?.clone();

        let revision = next_revision(self.revision)?;
        self.project = candidate;
        self.revision = revision;
        self.undo_stack.push(HistoryEntry {
            sequence_id,
            before,
            after,
            changed_entities: changed_entities.clone(),
        });
        self.redo_stack.clear();

        Ok(CommandResult {
            request_id: request.request_id,
            revision,
            changed_entities,
        })
    }

    pub fn undo(&mut self, request_id: RequestId) -> Result<CommandResult, DomainError> {
        let entry = self
            .undo_stack
            .last()
            .cloned()
            .ok_or(DomainError::NothingToUndo)?;

        let mut candidate = self.project.clone();
        replace_sequence(&mut candidate, entry.sequence_id, entry.before.clone())?;
        candidate.validate()?;
        let revision = next_revision(self.revision)?;

        self.project = candidate;
        self.revision = revision;
        self.undo_stack.pop();
        self.redo_stack.push(entry.clone());

        Ok(CommandResult {
            request_id,
            revision,
            changed_entities: entry.changed_entities,
        })
    }

    pub fn redo(&mut self, request_id: RequestId) -> Result<CommandResult, DomainError> {
        let entry = self
            .redo_stack
            .last()
            .cloned()
            .ok_or(DomainError::NothingToRedo)?;

        let mut candidate = self.project.clone();
        replace_sequence(&mut candidate, entry.sequence_id, entry.after.clone())?;
        candidate.validate()?;
        let revision = next_revision(self.revision)?;

        self.project = candidate;
        self.revision = revision;
        self.redo_stack.pop();
        self.undo_stack.push(entry.clone());

        Ok(CommandResult {
            request_id,
            revision,
            changed_entities: entry.changed_entities,
        })
    }
}

fn next_revision(current: ProjectRevision) -> Result<ProjectRevision, DomainError> {
    current
        .get()
        .checked_add(1)
        .map(ProjectRevision::new)
        .ok_or(DomainError::RevisionOverflow)
}

fn sequence_by_id(project: &Project, sequence_id: SequenceId) -> Result<&Sequence, DomainError> {
    project
        .sequences
        .iter()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or(DomainError::SequenceNotFound(sequence_id))
}

fn replace_sequence(
    project: &mut Project,
    sequence_id: SequenceId,
    replacement: Sequence,
) -> Result<(), DomainError> {
    let sequence = project
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or(DomainError::SequenceNotFound(sequence_id))?;
    *sequence = replacement;
    Ok(())
}

fn sequence_index(project: &Project, sequence_id: SequenceId) -> Result<usize, DomainError> {
    project
        .sequences
        .iter()
        .position(|sequence| sequence.id == sequence_id)
        .ok_or(DomainError::SequenceNotFound(sequence_id))
}

fn track_location(project: &Project, track_id: TrackId) -> Result<(usize, usize), DomainError> {
    for (sequence_index, sequence) in project.sequences.iter().enumerate() {
        if let Some(track_index) = sequence.tracks.iter().position(|track| track.id == track_id) {
            return Ok((sequence_index, track_index));
        }
    }
    Err(DomainError::TrackNotFound(track_id))
}

fn clip_location(project: &Project, clip_id: ClipId) -> Result<(usize, usize, usize), DomainError> {
    for (sequence_index, sequence) in project.sequences.iter().enumerate() {
        for (track_index, track) in sequence.tracks.iter().enumerate() {
            if let Some(clip_index) = track.clips.iter().position(|clip| clip.id == clip_id) {
                return Ok((sequence_index, track_index, clip_index));
            }
        }
    }
    Err(DomainError::ClipNotFound(clip_id))
}

fn command_sequence_id(project: &Project, command: &EditCommand) -> Result<SequenceId, DomainError> {
    match command {
        EditCommand::AddClip { sequence_id, .. }
        | EditCommand::AddTrack { sequence_id, .. }
        | EditCommand::ReorderTrack { sequence_id, .. }
        | EditCommand::AddText { sequence_id, .. }
        | EditCommand::AddMarker { sequence_id, .. }
        | EditCommand::RemoveMarker { sequence_id, .. } => {
            sequence_by_id(project, *sequence_id)?;
            Ok(*sequence_id)
        }
        EditCommand::RemoveTrack { track_id }
        | EditCommand::SetTrackMute { track_id, .. }
        | EditCommand::SetTrackLock { track_id, .. }
        | EditCommand::SetTrackHidden { track_id, .. } => {
            let (sequence_index, _) = track_location(project, *track_id)?;
            Ok(project.sequences[sequence_index].id)
        }
        EditCommand::DeleteClip { clip_id }
        | EditCommand::MoveClip { clip_id, .. }
        | EditCommand::TrimClip { clip_id, .. }
        | EditCommand::SplitClip { clip_id, .. }
        | EditCommand::DuplicateClip { clip_id, .. }
        | EditCommand::RippleDelete { clip_id }
        | EditCommand::SetVolume { clip_id, .. }
        | EditCommand::NormalizeAudio { clip_id, .. }
        | EditCommand::SetTransform { clip_id, .. }
        | EditCommand::SetColor { clip_id, .. }
        | EditCommand::SetSpeed { clip_id, .. }
        | EditCommand::AddTransition { clip_id, .. }
        | EditCommand::SetTextStyle { clip_id, .. }
        | EditCommand::AddSubtitleSegments { clip_id, .. } => {
            let (sequence_index, _, _) = clip_location(project, *clip_id)?;
            Ok(project.sequences[sequence_index].id)
        }
    }
}

fn ensure_track_unlocked(project: &Project, sequence_index: usize, track_index: usize) -> Result<(), DomainError> {
    let track = &project.sequences[sequence_index].tracks[track_index];
    if track.locked {
        return Err(DomainError::TrackLocked(track.id));
    }
    Ok(())
}

fn changed(sequence_id: SequenceId, track_id: Option<TrackId>, clip_id: Option<ClipId>) -> Vec<ChangedEntity> {
    let mut entities = vec![ChangedEntity::Sequence(sequence_id)];
    if let Some(track_id) = track_id {
        entities.push(ChangedEntity::Track(track_id));
    }
    if let Some(clip_id) = clip_id {
        entities.push(ChangedEntity::Clip(clip_id));
    }
    entities
}

fn apply_command(project: &mut Project, command: &EditCommand) -> Result<Vec<ChangedEntity>, DomainError> {
    match command {
        EditCommand::AddClip { sequence_id, track_id, clip } => {
            let sequence_index = sequence_index(project, *sequence_id)?;
            let track_index = project.sequences[sequence_index]
                .tracks
                .iter()
                .position(|track| track.id == *track_id)
                .ok_or(DomainError::TrackNotFound(*track_id))?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            project.sequences[sequence_index].tracks[track_index].clips.push(clip.clone());
            Ok(changed(*sequence_id, Some(*track_id), Some(clip.id)))
        }
        EditCommand::DeleteClip { clip_id } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            project.sequences[sequence_index].tracks[track_index].clips.remove(clip_index);
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::MoveClip { clip_id, timeline_start } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            let clip = &mut project.sequences[sequence_index].tracks[track_index].clips[clip_index];
            let duration = clip.timeline_end.checked_sub(clip.timeline_start)?;
            clip.timeline_start = *timeline_start;
            clip.timeline_end = timeline_start.checked_add(duration)?;
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::TrimClip {
            clip_id,
            source_in,
            source_out,
            timeline_start,
            timeline_end,
        } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            let clip = &mut project.sequences[sequence_index].tracks[track_index].clips[clip_index];
            clip.source_in = *source_in;
            clip.source_out = *source_out;
            clip.timeline_start = *timeline_start;
            clip.timeline_end = *timeline_end;
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::SplitClip { clip_id, at, right_clip_id } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            let original = project.sequences[sequence_index].tracks[track_index].clips[clip_index].clone();

            if *at <= original.timeline_start || *at >= original.timeline_end {
                return Err(DomainError::InvalidSplitPoint(*clip_id));
            }

            let timeline_span = original.timeline_end.get() - original.timeline_start.get();
            let timeline_offset = at.get() - original.timeline_start.get();
            let source_span = original.source_out.get() - original.source_in.get();
            let source_offset = ((source_span as i128 * timeline_offset as i128) / timeline_span as i128) as i64;
            if source_offset <= 0 || source_offset >= source_span {
                return Err(DomainError::InvalidSplitPoint(*clip_id));
            }
            let source_split_raw = original
                .source_in
                .get()
                .checked_add(source_offset)
                .ok_or(DomainError::TimeOverflow)?;
            let source_split = TimeUs::new(source_split_raw)?;

            let mut left = original.clone();
            left.timeline_end = *at;
            left.source_out = source_split;

            let mut right = original;
            right.id = *right_clip_id;
            right.timeline_start = *at;
            right.source_in = source_split;

            let clips = &mut project.sequences[sequence_index].tracks[track_index].clips;
            clips[clip_index] = left;
            clips.insert(clip_index + 1, right);

            let mut entities = changed(sequence_id, Some(track_id), Some(*clip_id));
            entities.push(ChangedEntity::Clip(*right_clip_id));
            Ok(entities)
        }
        EditCommand::DuplicateClip { clip_id, new_clip_id, timeline_start } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            let original = project.sequences[sequence_index].tracks[track_index].clips[clip_index].clone();
            let duration = original.timeline_end.checked_sub(original.timeline_start)?;
            let mut copy = original;
            copy.id = *new_clip_id;
            copy.timeline_start = *timeline_start;
            copy.timeline_end = timeline_start.checked_add(duration)?;
            project.sequences[sequence_index].tracks[track_index]
                .clips
                .insert(clip_index + 1, copy);
            let mut entities = changed(sequence_id, Some(track_id), Some(*clip_id));
            entities.push(ChangedEntity::Clip(*new_clip_id));
            Ok(entities)
        }
        EditCommand::RippleDelete { clip_id } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            let removed = project.sequences[sequence_index].tracks[track_index].clips.remove(clip_index);
            let gap = removed.timeline_end.checked_sub(removed.timeline_start)?;
            for clip in &mut project.sequences[sequence_index].tracks[track_index].clips {
                if clip.timeline_start >= removed.timeline_end {
                    clip.timeline_start = clip.timeline_start.checked_sub(gap)?;
                    clip.timeline_end = clip.timeline_end.checked_sub(gap)?;
                }
            }
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::AddTrack { sequence_id, track } => {
            let sequence_index = sequence_index(project, *sequence_id)?;
            project.sequences[sequence_index].tracks.push(track.clone());
            Ok(changed(*sequence_id, Some(track.id), None))
        }
        EditCommand::RemoveTrack { track_id } => {
            let (sequence_index, track_index) = track_location(project, *track_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            project.sequences[sequence_index].tracks.remove(track_index);
            Ok(changed(sequence_id, Some(*track_id), None))
        }
        EditCommand::ReorderTrack { sequence_id, track_id, new_index } => {
            let sequence_index = sequence_index(project, *sequence_id)?;
            let tracks = &mut project.sequences[sequence_index].tracks;
            let current_index = tracks
                .iter()
                .position(|track| track.id == *track_id)
                .ok_or(DomainError::TrackNotFound(*track_id))?;
            if *new_index >= tracks.len() {
                return Err(DomainError::InvalidTrackIndex {
                    sequence_id: *sequence_id,
                    index: *new_index,
                });
            }
            let track = tracks.remove(current_index);
            tracks.insert(*new_index, track);
            Ok(changed(*sequence_id, Some(*track_id), None))
        }
        EditCommand::SetTrackMute { track_id, muted } => {
            let (sequence_index, track_index) = track_location(project, *track_id)?;
            let sequence_id = project.sequences[sequence_index].id;
            project.sequences[sequence_index].tracks[track_index].muted = *muted;
            Ok(changed(sequence_id, Some(*track_id), None))
        }
        EditCommand::SetTrackLock { track_id, locked } => {
            let (sequence_index, track_index) = track_location(project, *track_id)?;
            let sequence_id = project.sequences[sequence_index].id;
            project.sequences[sequence_index].tracks[track_index].locked = *locked;
            Ok(changed(sequence_id, Some(*track_id), None))
        }
        EditCommand::SetTrackHidden { track_id, hidden } => {
            let (sequence_index, track_index) = track_location(project, *track_id)?;
            let sequence_id = project.sequences[sequence_index].id;
            project.sequences[sequence_index].tracks[track_index].hidden = *hidden;
            Ok(changed(sequence_id, Some(*track_id), None))
        }
        EditCommand::SetVolume { clip_id, gain_db } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            project.sequences[sequence_index].tracks[track_index].clips[clip_index].audio.gain_db = *gain_db;
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::NormalizeAudio { clip_id, normalize } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            project.sequences[sequence_index].tracks[track_index].clips[clip_index].audio.normalize = *normalize;
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::SetTransform { clip_id, transform } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            project.sequences[sequence_index].tracks[track_index].clips[clip_index].transform = *transform;
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::SetColor { clip_id, color } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            project.sequences[sequence_index].tracks[track_index].clips[clip_index].color = *color;
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::SetSpeed { clip_id, speed } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            project.sequences[sequence_index].tracks[track_index].clips[clip_index].speed = *speed;
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::AddTransition { clip_id, transition } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            project.sequences[sequence_index].tracks[track_index].clips[clip_index].transition = *transition;
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::AddText { sequence_id, track_id, clip } => {
            if clip.kind != ClipKind::Text {
                return Err(DomainError::WrongClipKind(clip.id));
            }
            let sequence_index = sequence_index(project, *sequence_id)?;
            let track_index = project.sequences[sequence_index]
                .tracks
                .iter()
                .position(|track| track.id == *track_id)
                .ok_or(DomainError::TrackNotFound(*track_id))?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            project.sequences[sequence_index].tracks[track_index].clips.push(clip.clone());
            Ok(changed(*sequence_id, Some(*track_id), Some(clip.id)))
        }
        EditCommand::SetTextStyle { clip_id, style } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            let clip = &mut project.sequences[sequence_index].tracks[track_index].clips[clip_index];
            if clip.kind != ClipKind::Text {
                return Err(DomainError::WrongClipKind(*clip_id));
            }
            clip.text_style = Some(style.clone());
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::AddSubtitleSegments { clip_id, segments } => {
            let (sequence_index, track_index, clip_index) = clip_location(project, *clip_id)?;
            ensure_track_unlocked(project, sequence_index, track_index)?;
            let sequence_id = project.sequences[sequence_index].id;
            let track_id = project.sequences[sequence_index].tracks[track_index].id;
            project.sequences[sequence_index].tracks[track_index].clips[clip_index]
                .subtitles
                .extend(segments.clone());
            Ok(changed(sequence_id, Some(track_id), Some(*clip_id)))
        }
        EditCommand::AddMarker { sequence_id, marker } => {
            let sequence_index = sequence_index(project, *sequence_id)?;
            project.sequences[sequence_index].markers.push(marker.clone());
            Ok(changed(*sequence_id, None, None))
        }
        EditCommand::RemoveMarker { sequence_id, at } => {
            let sequence_index = sequence_index(project, *sequence_id)?;
            let marker_index = project.sequences[sequence_index]
                .markers
                .iter()
                .position(|marker| marker.at == *at)
                .ok_or(DomainError::MarkerNotFound {
                    sequence_id: *sequence_id,
                    at: *at,
                })?;
            project.sequences[sequence_index].markers.remove(marker_index);
            Ok(changed(*sequence_id, None, None))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{ChangedEntity, EditCommand, EditRequest, ProjectRevision};
    use crate::ids::{ClipId, MediaId, ProjectId, RequestId, SequenceId, TrackId};
    use crate::media::MediaRef;
    use crate::model::{
        AudioState, Clip, ClipKind, ColorAdjustments, Project, ProjectSettings, Sequence, Track,
        TrackKind, Transform,
    };
    use crate::time::TimeUs;
    use crate::DomainError;
    use std::path::PathBuf;

    fn t(value: i64) -> TimeUs { TimeUs::new(value).unwrap() }

    fn fixture() -> (Project, SequenceId, TrackId, ClipId, ClipId, MediaId) {
        let media_id = MediaId::new();
        let sequence_id = SequenceId::new();
        let track_id = TrackId::new();
        let first = ClipId::new();
        let second = ClipId::new();
        let clip = |id, source_in, source_out, timeline_start, timeline_end| Clip {
            id,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: t(source_in),
            source_out: t(source_out),
            timeline_start: t(timeline_start),
            timeline_end: t(timeline_end),
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
        (
            Project {
                id: ProjectId::new(),
                name: "Command fixture".into(),
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
                        clips: vec![
                            clip(first, 0, 4_000_000, 0, 4_000_000),
                            clip(second, 5_000_000, 9_000_000, 5_000_000, 9_000_000),
                        ],
                    }],
                    markers: vec![],
                }],
            },
            sequence_id,
            track_id,
            first,
            second,
            media_id,
        )
    }

    fn request(revision: u64, command: EditCommand) -> EditRequest {
        EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(revision),
            command,
        }
    }

    #[test]
    fn successful_command_increments_revision_exactly_once() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        let result = editor.execute(request(
            0,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(1_000_000) },
        )).unwrap();

        assert_eq!(result.revision, ProjectRevision::new(1));
        assert_eq!(editor.revision(), ProjectRevision::new(1));
        assert!(result.changed_entities.contains(&ChangedEntity::Clip(first)));
    }

    #[test]
    fn rejected_command_does_not_increment_revision() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        let error = editor.execute(request(
            0,
            EditCommand::SetSpeed { clip_id: first, speed: 0.0 },
        )).unwrap_err();

        assert!(matches!(error, DomainError::InvalidClipProperties(id) if id == first));
        assert_eq!(editor.revision(), ProjectRevision::new(0));
    }

    #[test]
    fn stale_revision_is_typed_and_does_not_mutate() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        let error = editor.execute(request(
            9,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(2_000_000) },
        )).unwrap_err();

        assert_eq!(
            error,
            DomainError::StaleRevision {
                expected: ProjectRevision::new(9),
                actual: ProjectRevision::new(0),
            }
        );
        assert_eq!(editor.revision(), ProjectRevision::new(0));
        assert_eq!(editor.find_clip(first).unwrap().timeline_start, t(0));
    }

    #[test]
    fn move_is_exact_and_does_not_apply_snapping() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(
            0,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(1_234_567) },
        )).unwrap();

        let clip = editor.find_clip(first).unwrap();
        assert_eq!(clip.timeline_start, t(1_234_567));
        assert_eq!(clip.timeline_end, t(5_234_567));
    }

    #[test]
    fn trim_updates_explicit_source_and_timeline_ranges() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(0, EditCommand::TrimClip {
            clip_id: first,
            source_in: t(500_000),
            source_out: t(3_500_000),
            timeline_start: t(500_000),
            timeline_end: t(3_500_000),
        })).unwrap();

        let clip = editor.find_clip(first).unwrap();
        assert_eq!((clip.source_in, clip.source_out), (t(500_000), t(3_500_000)));
        assert_eq!((clip.timeline_start, clip.timeline_end), (t(500_000), t(3_500_000)));
    }

    #[test]
    fn split_preserves_source_mapping_and_uses_supplied_right_id() {
        let (project, _, _, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();
        let right = ClipId::new();

        editor.execute(request(0, EditCommand::SplitClip {
            clip_id: first,
            at: t(1_500_000),
            right_clip_id: right,
        })).unwrap();

        let left = editor.find_clip(first).unwrap();
        let right_clip = editor.find_clip(right).unwrap();
        assert_eq!((left.timeline_start, left.timeline_end), (t(0), t(1_500_000)));
        assert_eq!((left.source_in, left.source_out), (t(0), t(1_500_000)));
        assert_eq!((right_clip.timeline_start, right_clip.timeline_end), (t(1_500_000), t(4_000_000)));
        assert_eq!((right_clip.source_in, right_clip.source_out), (t(1_500_000), t(4_000_000)));
    }

    #[test]
    fn duplicate_copies_edit_state_but_uses_new_identity_and_position() {
        let (project, _, _, first, _, media_id) = fixture();
        let mut editor = Editor::new(project).unwrap();
        let duplicate = ClipId::new();

        editor.execute(request(0, EditCommand::DuplicateClip {
            clip_id: first,
            new_clip_id: duplicate,
            timeline_start: t(10_000_000),
        })).unwrap();

        let original = editor.find_clip(first).unwrap();
        let copy = editor.find_clip(duplicate).unwrap();
        assert_eq!(copy.id, duplicate);
        assert_eq!(copy.media_id, Some(media_id));
        assert_eq!((copy.source_in, copy.source_out), (original.source_in, original.source_out));
        assert_eq!((copy.timeline_start, copy.timeline_end), (t(10_000_000), t(14_000_000)));
        assert_eq!(copy.transform, original.transform);
        assert_eq!(copy.audio, original.audio);
    }

    #[test]
    fn ripple_delete_closes_later_gap_on_same_track() {
        let (project, _, _, first, second, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(0, EditCommand::RippleDelete { clip_id: first })).unwrap();

        assert!(editor.find_clip(first).is_none());
        let later = editor.find_clip(second).unwrap();
        assert_eq!((later.timeline_start, later.timeline_end), (t(1_000_000), t(5_000_000)));
    }

    #[test]
    fn locked_track_rejects_clip_mutation() {
        let (project, _, track_id, first, _, _) = fixture();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(0, EditCommand::SetTrackLock { track_id, locked: true })).unwrap();
        let error = editor.execute(request(
            1,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(1_000_000) },
        )).unwrap_err();

        assert_eq!(error, DomainError::TrackLocked(track_id));
        assert_eq!(editor.revision(), ProjectRevision::new(1));
    }

    #[test]
    fn editing_never_changes_media_reference_metadata() {
        let (project, _, _, first, _, media_id) = fixture();
        let original_media = project.media[0].clone();
        let mut editor = Editor::new(project).unwrap();

        editor.execute(request(
            0,
            EditCommand::MoveClip { clip_id: first, timeline_start: t(2_000_000) },
        )).unwrap();

        assert_eq!(editor.project().media[0], original_media);
        assert_eq!(editor.find_clip(first).unwrap().media_id, Some(media_id));
    }
}
