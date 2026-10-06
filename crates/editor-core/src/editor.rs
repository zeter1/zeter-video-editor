use crate::history::{History, HistoryAction, HistoryEntry, find_track_mut};
use crate::{
    AudioState, ChangedEntity, Clip, ClipKind, ColorAdjustments, CommandResult, DomainError,
    EditCommand, EditRequest, Project, ProjectRevision, RequestId, SequenceId, TextState, TimeUs,
    TrackId, Transform,
};

pub struct Editor {
    project: Project,
    revision: ProjectRevision,
    history: History,
}

impl Editor {
    pub fn new(project: Project) -> Result<Self, DomainError> {
        project.validate()?;
        Ok(Self {
            project,
            revision: ProjectRevision::new(0),
            history: History::default(),
        })
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn revision(&self) -> ProjectRevision {
        self.revision
    }

    pub fn execute(&mut self, request: EditRequest) -> Result<CommandResult, DomainError> {
        if request.expected_revision != self.revision {
            return Err(DomainError::StaleRevision {
                expected: request.expected_revision,
                actual: self.revision,
            });
        }
        let next_revision = self.revision.next().ok_or(DomainError::RevisionOverflow)?;

        let entry = self.apply_command(&request.command)?;
        if let Err(error) = self.project.validate() {
            entry.undo.apply(&mut self.project)?;
            return Err(error);
        }

        let changed_entities = entry.changed_entities.clone();
        self.history.record(entry);
        self.revision = next_revision;

        Ok(CommandResult {
            request_id: request.request_id,
            revision: self.revision,
            changed_entities,
        })
    }

    pub fn undo(&mut self, request_id: RequestId) -> Result<CommandResult, DomainError> {
        let next_revision = self.revision.next().ok_or(DomainError::RevisionOverflow)?;
        let entry = self
            .history
            .take_undo()
            .ok_or(DomainError::HistoryEmpty { direction: "undo" })?;

        if let Err(error) = entry.undo.apply(&mut self.project) {
            self.history.restore_undo(entry);
            return Err(error);
        }
        if let Err(error) = self.project.validate() {
            let _ = entry.redo.apply(&mut self.project);
            self.history.restore_undo(entry);
            return Err(error);
        }

        let changed_entities = entry.changed_entities.clone();
        self.history.push_redo(entry);
        self.revision = next_revision;
        Ok(CommandResult {
            request_id,
            revision: self.revision,
            changed_entities,
        })
    }

    pub fn redo(&mut self, request_id: RequestId) -> Result<CommandResult, DomainError> {
        let next_revision = self.revision.next().ok_or(DomainError::RevisionOverflow)?;
        let entry = self
            .history
            .take_redo()
            .ok_or(DomainError::HistoryEmpty { direction: "redo" })?;

        if let Err(error) = entry.redo.apply(&mut self.project) {
            self.history.restore_redo(entry);
            return Err(error);
        }
        if let Err(error) = self.project.validate() {
            let _ = entry.undo.apply(&mut self.project);
            self.history.restore_redo(entry);
            return Err(error);
        }

        let changed_entities = entry.changed_entities.clone();
        self.history.restore_undo(entry);
        self.revision = next_revision;
        Ok(CommandResult {
            request_id,
            revision: self.revision,
            changed_entities,
        })
    }

    fn apply_command(&mut self, command: &EditCommand) -> Result<HistoryEntry, DomainError> {
        match command {
            EditCommand::AddClip {
                sequence_id,
                track_id,
                clip,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                clips.push(clip.clone());
                Ok(vec![
                    ChangedEntity::Track(*track_id),
                    ChangedEntity::Clip(clip.id),
                ])
            }),
            EditCommand::DeleteClip {
                sequence_id,
                track_id,
                clip_id,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                let index = clip_index(clips, *clip_id)?;
                clips.remove(index);
                Ok(vec![
                    ChangedEntity::Track(*track_id),
                    ChangedEntity::Clip(*clip_id),
                ])
            }),
            EditCommand::MoveClip {
                sequence_id,
                track_id,
                clip_id,
                timeline_start,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                let clip = find_clip_mut(clips, *clip_id)?;
                let duration = clip.timeline_end.checked_sub(clip.timeline_start)?;
                clip.timeline_start = *timeline_start;
                clip.timeline_end = timeline_start.checked_add(duration)?;
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::TrimClip {
                sequence_id,
                track_id,
                clip_id,
                source_in,
                source_out,
                timeline_start,
                timeline_end,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                let clip = find_clip_mut(clips, *clip_id)?;
                clip.source_in = *source_in;
                clip.source_out = *source_out;
                clip.timeline_start = *timeline_start;
                clip.timeline_end = *timeline_end;
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::SplitClip {
                sequence_id,
                track_id,
                clip_id,
                split_at,
                right_clip_id,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                let index = clip_index(clips, *clip_id)?;
                let original = clips[index].clone();
                if *split_at <= original.timeline_start || *split_at >= original.timeline_end {
                    return Err(DomainError::InvalidEdit {
                        reason: "split point must be inside clip timeline range",
                    });
                }
                let timeline_offset = split_at.checked_sub(original.timeline_start)?;
                let source_split = original.source_in.checked_add(timeline_offset)?;
                if source_split >= original.source_out {
                    return Err(DomainError::InvalidEdit {
                        reason: "split point exceeds clip source range",
                    });
                }

                clips[index].timeline_end = *split_at;
                clips[index].source_out = source_split;

                let mut right = original;
                right.id = *right_clip_id;
                right.timeline_start = *split_at;
                right.source_in = source_split;
                clips.insert(index + 1, right);

                Ok(vec![
                    ChangedEntity::Clip(*clip_id),
                    ChangedEntity::Clip(*right_clip_id),
                ])
            }),
            EditCommand::DuplicateClip {
                sequence_id,
                track_id,
                clip_id,
                duplicate_id,
                timeline_start,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                let original = clips
                    .iter()
                    .find(|clip| clip.id == *clip_id)
                    .cloned()
                    .ok_or(DomainError::EntityNotFound { entity: "clip" })?;
                let duration = original.timeline_end.checked_sub(original.timeline_start)?;
                let mut duplicate = original;
                duplicate.id = *duplicate_id;
                duplicate.timeline_start = *timeline_start;
                duplicate.timeline_end = timeline_start.checked_add(duration)?;
                clips.push(duplicate);
                Ok(vec![ChangedEntity::Clip(*duplicate_id)])
            }),
            EditCommand::RippleDelete {
                sequence_id,
                track_id,
                clip_id,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                let index = clip_index(clips, *clip_id)?;
                let deleted = clips.remove(index);
                let duration = deleted.timeline_end.checked_sub(deleted.timeline_start)?;
                let mut changed = vec![ChangedEntity::Clip(*clip_id)];
                for clip in clips.iter_mut() {
                    if clip.timeline_start >= deleted.timeline_end {
                        clip.timeline_start = clip.timeline_start.checked_sub(duration)?;
                        clip.timeline_end = clip.timeline_end.checked_sub(duration)?;
                        changed.push(ChangedEntity::Clip(clip.id));
                    }
                }
                Ok(changed)
            }),
            EditCommand::SetVolume {
                sequence_id,
                track_id,
                clip_id,
                volume,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                find_clip_mut(clips, *clip_id)?.audio.volume = *volume;
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::NormalizeAudio {
                sequence_id,
                track_id,
                clip_id,
                gain_db,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                find_clip_mut(clips, *clip_id)?.audio.gain_db = *gain_db;
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::SetTransform {
                sequence_id,
                track_id,
                clip_id,
                transform,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                find_clip_mut(clips, *clip_id)?.transform = *transform;
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::SetColor {
                sequence_id,
                track_id,
                clip_id,
                color,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                find_clip_mut(clips, *clip_id)?.color = *color;
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::SetSpeed {
                sequence_id,
                track_id,
                clip_id,
                speed,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                find_clip_mut(clips, *clip_id)?.speed = *speed;
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::AddTransition {
                sequence_id,
                track_id,
                clip_id,
                transition,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                find_clip_mut(clips, *clip_id)?.transition = Some(*transition);
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::AddText {
                sequence_id,
                track_id,
                clip_id,
                timeline_start,
                timeline_end,
                text,
                style,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                let duration = timeline_end.checked_sub(*timeline_start)?;
                clips.push(Clip {
                    id: *clip_id,
                    kind: ClipKind::Text,
                    media_id: None,
                    source_in: TimeUs::new(0)?,
                    source_out: duration,
                    timeline_start: *timeline_start,
                    timeline_end: *timeline_end,
                    transform: Transform::default(),
                    color: ColorAdjustments::default(),
                    audio: AudioState::default(),
                    speed: 1.0,
                    transition: None,
                    text: Some(TextState {
                        text: text.clone(),
                        style: style.clone(),
                    }),
                });
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::SetTextStyle {
                sequence_id,
                track_id,
                clip_id,
                style,
            } => self.mutate_track_clips(*sequence_id, *track_id, |clips| {
                let clip = find_clip_mut(clips, *clip_id)?;
                let text = clip.text.as_mut().ok_or(DomainError::InvalidEdit {
                    reason: "text style can only be set on a text clip",
                })?;
                text.style = style.clone();
                Ok(vec![ChangedEntity::Clip(*clip_id)])
            }),
            EditCommand::AddTrack {
                sequence_id,
                track,
                index,
            } => self.mutate_sequence_tracks(*sequence_id, |tracks| {
                let insert_at = index.unwrap_or(tracks.len());
                if insert_at > tracks.len() {
                    return Err(DomainError::InvalidEdit {
                        reason: "track insertion index is out of range",
                    });
                }
                tracks.insert(insert_at, track.clone());
                Ok(vec![ChangedEntity::Track(track.id)])
            }),
            EditCommand::RemoveTrack {
                sequence_id,
                track_id,
            } => self.mutate_sequence_tracks(*sequence_id, |tracks| {
                let index = tracks
                    .iter()
                    .position(|track| track.id == *track_id)
                    .ok_or(DomainError::EntityNotFound { entity: "track" })?;
                if tracks[index].locked {
                    return Err(DomainError::TrackLocked {
                        track_id: *track_id,
                    });
                }
                tracks.remove(index);
                Ok(vec![ChangedEntity::Track(*track_id)])
            }),
            EditCommand::ReorderTrack {
                sequence_id,
                track_id,
                new_index,
            } => self.mutate_sequence_tracks(*sequence_id, |tracks| {
                let index = tracks
                    .iter()
                    .position(|track| track.id == *track_id)
                    .ok_or(DomainError::EntityNotFound { entity: "track" })?;
                if tracks[index].locked {
                    return Err(DomainError::TrackLocked {
                        track_id: *track_id,
                    });
                }
                if *new_index >= tracks.len() {
                    return Err(DomainError::InvalidEdit {
                        reason: "track reorder index is out of range",
                    });
                }
                let track = tracks.remove(index);
                tracks.insert(*new_index, track);
                Ok(vec![ChangedEntity::Track(*track_id)])
            }),
            EditCommand::SetTrackMute {
                sequence_id,
                track_id,
                muted,
            } => self.mutate_sequence_tracks(*sequence_id, |tracks| {
                find_track_in_slice_mut(tracks, *track_id)?.muted = *muted;
                Ok(vec![ChangedEntity::Track(*track_id)])
            }),
            EditCommand::SetTrackLock {
                sequence_id,
                track_id,
                locked,
            } => self.mutate_sequence_tracks(*sequence_id, |tracks| {
                find_track_in_slice_mut(tracks, *track_id)?.locked = *locked;
                Ok(vec![ChangedEntity::Track(*track_id)])
            }),
            EditCommand::SetTrackHidden {
                sequence_id,
                track_id,
                hidden,
            } => self.mutate_sequence_tracks(*sequence_id, |tracks| {
                find_track_in_slice_mut(tracks, *track_id)?.hidden = *hidden;
                Ok(vec![ChangedEntity::Track(*track_id)])
            }),
            EditCommand::AddSubtitleSegments {
                sequence_id,
                segments,
            } => self.mutate_sequence_subtitles(*sequence_id, |subtitle_segments| {
                subtitle_segments.extend(segments.clone());
                Ok(vec![ChangedEntity::Sequence(*sequence_id)])
            }),
            EditCommand::AddMarker {
                sequence_id,
                marker,
            } => self.mutate_sequence_markers(*sequence_id, |markers| {
                markers.push(marker.clone());
                Ok(vec![ChangedEntity::Sequence(*sequence_id)])
            }),
            EditCommand::RemoveMarker {
                sequence_id,
                marker_id,
            } => self.mutate_sequence_markers(*sequence_id, |markers| {
                let index = markers
                    .iter()
                    .position(|marker| marker.id == *marker_id)
                    .ok_or(DomainError::EntityNotFound { entity: "marker" })?;
                markers.remove(index);
                Ok(vec![ChangedEntity::Sequence(*sequence_id)])
            }),
        }
    }

    fn mutate_track_clips<F>(
        &mut self,
        sequence_id: SequenceId,
        track_id: TrackId,
        mutate: F,
    ) -> Result<HistoryEntry, DomainError>
    where
        F: FnOnce(&mut Vec<Clip>) -> Result<Vec<ChangedEntity>, DomainError>,
    {
        let track = find_track_mut(&mut self.project, sequence_id, track_id)?;
        if track.locked {
            return Err(DomainError::TrackLocked { track_id });
        }
        let before = track.clips.clone();
        let changed_entities = mutate(&mut track.clips)?;
        let after = track.clips.clone();

        Ok(HistoryEntry {
            undo: HistoryAction::TrackClips {
                sequence_id,
                track_id,
                clips: before,
            },
            redo: HistoryAction::TrackClips {
                sequence_id,
                track_id,
                clips: after,
            },
            changed_entities,
        })
    }

    fn mutate_sequence_tracks<F>(
        &mut self,
        sequence_id: SequenceId,
        mutate: F,
    ) -> Result<HistoryEntry, DomainError>
    where
        F: FnOnce(&mut Vec<crate::Track>) -> Result<Vec<ChangedEntity>, DomainError>,
    {
        let sequence = find_sequence_mut(&mut self.project, sequence_id)?;
        let before = sequence.tracks.clone();
        let changed_entities = mutate(&mut sequence.tracks)?;
        let after = sequence.tracks.clone();
        Ok(HistoryEntry {
            undo: HistoryAction::SequenceTracks {
                sequence_id,
                tracks: before,
            },
            redo: HistoryAction::SequenceTracks {
                sequence_id,
                tracks: after,
            },
            changed_entities,
        })
    }

    fn mutate_sequence_subtitles<F>(
        &mut self,
        sequence_id: SequenceId,
        mutate: F,
    ) -> Result<HistoryEntry, DomainError>
    where
        F: FnOnce(&mut Vec<crate::SubtitleSegment>) -> Result<Vec<ChangedEntity>, DomainError>,
    {
        let sequence = find_sequence_mut(&mut self.project, sequence_id)?;
        let before = sequence.subtitle_segments.clone();
        let changed_entities = mutate(&mut sequence.subtitle_segments)?;
        let after = sequence.subtitle_segments.clone();
        Ok(HistoryEntry {
            undo: HistoryAction::SequenceSubtitles {
                sequence_id,
                subtitle_segments: before,
            },
            redo: HistoryAction::SequenceSubtitles {
                sequence_id,
                subtitle_segments: after,
            },
            changed_entities,
        })
    }

    fn mutate_sequence_markers<F>(
        &mut self,
        sequence_id: SequenceId,
        mutate: F,
    ) -> Result<HistoryEntry, DomainError>
    where
        F: FnOnce(&mut Vec<crate::Marker>) -> Result<Vec<ChangedEntity>, DomainError>,
    {
        let sequence = find_sequence_mut(&mut self.project, sequence_id)?;
        let before = sequence.markers.clone();
        let changed_entities = mutate(&mut sequence.markers)?;
        let after = sequence.markers.clone();
        Ok(HistoryEntry {
            undo: HistoryAction::SequenceMarkers {
                sequence_id,
                markers: before,
            },
            redo: HistoryAction::SequenceMarkers {
                sequence_id,
                markers: after,
            },
            changed_entities,
        })
    }
}

fn find_sequence_mut(
    project: &mut Project,
    sequence_id: SequenceId,
) -> Result<&mut crate::Sequence, DomainError> {
    project
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or(DomainError::EntityNotFound { entity: "sequence" })
}

fn find_track_in_slice_mut(
    tracks: &mut [crate::Track],
    track_id: TrackId,
) -> Result<&mut crate::Track, DomainError> {
    tracks
        .iter_mut()
        .find(|track| track.id == track_id)
        .ok_or(DomainError::EntityNotFound { entity: "track" })
}

fn clip_index(clips: &[Clip], clip_id: crate::ClipId) -> Result<usize, DomainError> {
    clips
        .iter()
        .position(|clip| clip.id == clip_id)
        .ok_or(DomainError::EntityNotFound { entity: "clip" })
}

fn find_clip_mut(clips: &mut [Clip], clip_id: crate::ClipId) -> Result<&mut Clip, DomainError> {
    clips
        .iter_mut()
        .find(|clip| clip.id == clip_id)
        .ok_or(DomainError::EntityNotFound { entity: "clip" })
}

#[cfg(test)]
mod tests {
    use crate::{
        AudioState, Clip, ClipId, ClipKind, ColorAdjustments, DomainError, EditCommand,
        EditRequest, Editor, MediaId, MediaRef, Project, ProjectId, ProjectRevision,
        ProjectSettings, RequestId, Sequence, SequenceId, TimeUs, Track, TrackId, TrackKind,
        Transform,
    };

    fn time(value: i64) -> TimeUs {
        TimeUs::new(value).expect("test time")
    }

    fn fixture() -> (Project, SequenceId, TrackId, ClipId, MediaId) {
        let media_id = MediaId::new();
        let sequence_id = SequenceId::new();
        let track_id = TrackId::new();
        let clip_id = ClipId::new();
        let project = Project {
            id: ProjectId::new(),
            name: "Editor fixture".into(),
            settings: ProjectSettings::default(),
            media: vec![MediaRef {
                id: media_id,
                absolute_path: "C:/media/source.mp4".into(),
                project_relative_path: None,
                file_size: 10,
                duration: Some(time(30_000_000)),
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
                    name: "Video 1".into(),
                    kind: TrackKind::Video,
                    muted: false,
                    locked: false,
                    hidden: false,
                    clips: vec![
                        clip(clip_id, media_id, 0, 5_000_000, 0, 5_000_000),
                        clip(
                            ClipId::new(),
                            media_id,
                            5_000_000,
                            10_000_000,
                            8_000_000,
                            13_000_000,
                        ),
                    ],
                }],
                subtitle_segments: Vec::new(),
                markers: Vec::new(),
            }],
        };
        (project, sequence_id, track_id, clip_id, media_id)
    }

    fn clip(
        id: ClipId,
        media_id: MediaId,
        source_in: i64,
        source_out: i64,
        timeline_start: i64,
        timeline_end: i64,
    ) -> Clip {
        Clip {
            id,
            kind: ClipKind::Video,
            media_id: Some(media_id),
            source_in: time(source_in),
            source_out: time(source_out),
            timeline_start: time(timeline_start),
            timeline_end: time(timeline_end),
            transform: Transform::default(),
            color: ColorAdjustments::default(),
            audio: AudioState::default(),
            speed: 1.0,
            transition: None,
            text: None,
        }
    }

    fn request(revision: u64, command: EditCommand) -> EditRequest {
        EditRequest {
            request_id: RequestId::new(),
            expected_revision: ProjectRevision::new(revision),
            command,
        }
    }

    #[test]
    fn successful_command_undo_and_redo_each_increment_revision_once() {
        let (project, sequence_id, track_id, clip_id, _) = fixture();
        let mut editor = Editor::new(project).expect("valid project");

        let result = editor
            .execute(request(
                0,
                EditCommand::MoveClip {
                    sequence_id,
                    track_id,
                    clip_id,
                    timeline_start: time(2_000_000),
                },
            ))
            .expect("move should succeed");
        assert_eq!(result.revision, ProjectRevision::new(1));

        let undo = editor.undo(RequestId::new()).expect("undo should succeed");
        assert_eq!(undo.revision, ProjectRevision::new(2));

        let redo = editor.redo(RequestId::new()).expect("redo should succeed");
        assert_eq!(redo.revision, ProjectRevision::new(3));
    }

    #[test]
    fn stale_or_rejected_commands_do_not_advance_revision() {
        let (project, sequence_id, track_id, clip_id, _) = fixture();
        let mut editor = Editor::new(project).expect("valid project");

        let error = editor
            .execute(request(
                9,
                EditCommand::MoveClip {
                    sequence_id,
                    track_id,
                    clip_id,
                    timeline_start: time(1),
                },
            ))
            .expect_err("stale revision must fail");

        assert_eq!(
            error,
            DomainError::StaleRevision {
                expected: ProjectRevision::new(9),
                actual: ProjectRevision::new(0),
            }
        );
        assert_eq!(editor.revision(), ProjectRevision::new(0));
    }

    #[test]
    fn split_trim_move_and_duplicate_preserve_source_media_identity() {
        let (project, sequence_id, track_id, clip_id, media_id) = fixture();
        let mut editor = Editor::new(project).expect("valid project");
        let right_id = ClipId::new();

        editor
            .execute(request(
                0,
                EditCommand::SplitClip {
                    sequence_id,
                    track_id,
                    clip_id,
                    split_at: time(2_000_000),
                    right_clip_id: right_id,
                },
            ))
            .expect("split");
        editor
            .execute(request(
                1,
                EditCommand::TrimClip {
                    sequence_id,
                    track_id,
                    clip_id: right_id,
                    source_in: time(2_500_000),
                    source_out: time(5_000_000),
                    timeline_start: time(2_500_000),
                    timeline_end: time(5_000_000),
                },
            ))
            .expect("trim");
        editor
            .execute(request(
                2,
                EditCommand::MoveClip {
                    sequence_id,
                    track_id,
                    clip_id: right_id,
                    timeline_start: time(6_123_456),
                },
            ))
            .expect("move");
        let duplicate_id = ClipId::new();
        editor
            .execute(request(
                3,
                EditCommand::DuplicateClip {
                    sequence_id,
                    track_id,
                    clip_id: right_id,
                    duplicate_id,
                    timeline_start: time(12_345_678),
                },
            ))
            .expect("duplicate");

        let track = &editor.project().sequences[0].tracks[0];
        let left = track.clips.iter().find(|clip| clip.id == clip_id).unwrap();
        let right = track.clips.iter().find(|clip| clip.id == right_id).unwrap();
        let duplicate = track
            .clips
            .iter()
            .find(|clip| clip.id == duplicate_id)
            .unwrap();

        assert_eq!(left.media_id, Some(media_id));
        assert_eq!(right.media_id, Some(media_id));
        assert_eq!(duplicate.media_id, Some(media_id));
        assert_eq!(left.source_out, time(2_000_000));
        assert_eq!(right.source_in, time(2_500_000));
        assert_eq!(right.timeline_start, time(6_123_456));
        assert_eq!(duplicate.timeline_start, time(12_345_678));
        assert_eq!(duplicate.source_in, right.source_in);
        assert_eq!(duplicate.source_out, right.source_out);
    }

    #[test]
    fn ripple_delete_removes_clip_and_shifts_only_later_clips_by_deleted_duration() {
        let (project, sequence_id, track_id, clip_id, _) = fixture();
        let later_id = project.sequences[0].tracks[0].clips[1].id;
        let mut editor = Editor::new(project).expect("valid project");

        editor
            .execute(request(
                0,
                EditCommand::RippleDelete {
                    sequence_id,
                    track_id,
                    clip_id,
                },
            ))
            .expect("ripple delete");

        let track = &editor.project().sequences[0].tracks[0];
        assert!(track.clips.iter().all(|clip| clip.id != clip_id));
        let later = track.clips.iter().find(|clip| clip.id == later_id).unwrap();
        assert_eq!(later.timeline_start, time(3_000_000));
        assert_eq!(later.timeline_end, time(8_000_000));
    }

    #[test]
    fn speed_text_style_and_markers_are_authoritative_undoable_state() {
        let (project, sequence_id, track_id, clip_id, _) = fixture();
        let mut editor = Editor::new(project).expect("valid project");

        editor
            .execute(request(
                0,
                EditCommand::SetSpeed {
                    sequence_id,
                    track_id,
                    clip_id,
                    speed: 1.5,
                },
            ))
            .expect("speed");
        assert_eq!(editor.project().sequences[0].tracks[0].clips[0].speed, 1.5);

        let text_id = ClipId::new();
        editor
            .execute(request(
                1,
                EditCommand::AddText {
                    sequence_id,
                    track_id,
                    clip_id: text_id,
                    timeline_start: time(6_000_000),
                    timeline_end: time(7_000_000),
                    text: "Title".into(),
                    style: crate::TextStyle::default(),
                },
            ))
            .expect("add text");
        let mut style = crate::TextStyle::default();
        style.font_size = 72.0;
        editor
            .execute(request(
                2,
                EditCommand::SetTextStyle {
                    sequence_id,
                    track_id,
                    clip_id: text_id,
                    style: style.clone(),
                },
            ))
            .expect("set style");
        let text_clip = editor.project().sequences[0].tracks[0]
            .clips
            .iter()
            .find(|clip| clip.id == text_id)
            .unwrap();
        assert_eq!(text_clip.text.as_ref().unwrap().style, style);

        let marker = crate::Marker {
            id: uuid::Uuid::new_v4(),
            time: time(2_000_000),
            label: "Hook".into(),
        };
        editor
            .execute(request(
                3,
                EditCommand::AddMarker {
                    sequence_id,
                    marker: marker.clone(),
                },
            ))
            .expect("add marker");
        assert_eq!(editor.project().sequences[0].markers, vec![marker.clone()]);

        editor
            .execute(request(
                4,
                EditCommand::RemoveMarker {
                    sequence_id,
                    marker_id: marker.id,
                },
            ))
            .expect("remove marker");
        assert!(editor.project().sequences[0].markers.is_empty());

        editor.undo(RequestId::new()).expect("undo marker removal");
        assert_eq!(editor.project().sequences[0].markers, vec![marker]);
    }

    #[test]
    fn locked_track_rejects_mutation_without_changing_project_or_revision() {
        let (mut project, sequence_id, track_id, clip_id, _) = fixture();
        project.sequences[0].tracks[0].locked = true;
        let before = project.clone();
        let mut editor = Editor::new(project).expect("valid project");

        let error = editor
            .execute(request(
                0,
                EditCommand::DeleteClip {
                    sequence_id,
                    track_id,
                    clip_id,
                },
            ))
            .expect_err("locked track must reject edits");

        assert_eq!(error, DomainError::TrackLocked { track_id });
        assert_eq!(editor.project(), &before);
        assert_eq!(editor.revision(), ProjectRevision::new(0));
    }
}
