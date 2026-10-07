use std::path::{Path, PathBuf};

use ai_engine::{HighlightCandidate, SilenceRange, TranscriptResult};
use editor_core::{
    ClipId, ClipKind, Crop, DomainError, EditCommand, EditRequest, Editor, MediaRef, Project,
    ProjectRevision, RequestId, Sequence, SequenceId, SubtitleSegment, TimeUs, TimelineRange,
    Track, TrackId,
};
use job_system::{JobKind, JobSnapshot, JobState};

use crate::{
    contracts::{CommandResultDto, ProjectSnapshotDto},
    error::AppError,
};

pub struct ProjectService {
    editor: Option<Editor>,
    project_path: Option<PathBuf>,
}

impl ProjectService {
    pub fn empty() -> Self {
        Self {
            editor: None,
            project_path: None,
        }
    }

    pub fn from_project(project: Project, revision: ProjectRevision) -> Result<Self, AppError> {
        Ok(Self {
            editor: Some(Editor::from_revision(project, revision)?),
            project_path: None,
        })
    }

    pub fn open(&mut self, path: &Path) -> Result<ProjectSnapshotDto, AppError> {
        let loaded = project_io::load(path)?;
        self.editor = Some(Editor::from_revision(loaded.project, loaded.revision)?);
        self.project_path = Some(path.to_path_buf());
        self.snapshot()
    }

    pub fn save(&mut self, path: &Path) -> Result<ProjectSnapshotDto, AppError> {
        let snapshot = self.snapshot()?;
        project_io::save_atomic(path, &snapshot.project, snapshot.revision)?;
        self.project_path = Some(path.to_path_buf());
        Ok(snapshot)
    }

    pub fn current_path(&self) -> Option<&Path> {
        self.project_path.as_deref()
    }

    pub fn snapshot(&self) -> Result<ProjectSnapshotDto, AppError> {
        let editor = self.editor.as_ref().ok_or(AppError::NoProject)?;
        Ok(ProjectSnapshotDto {
            revision: editor.revision(),
            project: editor.project().clone(),
        })
    }

    pub fn execute_edit_command(
        &mut self,
        request: EditRequest,
    ) -> Result<CommandResultDto, AppError> {
        Ok(self.editor_mut()?.execute(request)?.into())
    }

    pub fn undo(&mut self, request_id: RequestId) -> Result<CommandResultDto, AppError> {
        Ok(self.editor_mut()?.undo(request_id)?.into())
    }

    pub fn redo(&mut self, request_id: RequestId) -> Result<CommandResultDto, AppError> {
        Ok(self.editor_mut()?.redo(request_id)?.into())
    }

    pub fn import_media(
        &mut self,
        request_id: RequestId,
        expected_revision: ProjectRevision,
        media: MediaRef,
    ) -> Result<CommandResultDto, AppError> {
        self.execute_edit_command(EditRequest {
            request_id,
            expected_revision,
            command: EditCommand::ImportMedia { media },
        })
    }

    pub fn execute_job_result(
        &mut self,
        job: &JobSnapshot,
        request_id: RequestId,
        command: EditCommand,
    ) -> Result<CommandResultDto, AppError> {
        if job.state != JobState::Completed {
            return Err(AppError::InvalidJobState { state: job.state });
        }

        self.execute_edit_command(EditRequest {
            request_id,
            expected_revision: job.context.source_revision,
            command,
        })
    }

    pub fn apply_silence_result(
        &mut self,
        job: &JobSnapshot,
        request_id: RequestId,
        ranges: &[SilenceRange],
    ) -> Result<CommandResultDto, AppError> {
        if job.kind != JobKind::SilenceAnalysis {
            return Err(AppError::InvalidAnalysisJobKind { actual: job.kind });
        }

        self.execute_job_result(
            job,
            request_id,
            EditCommand::ApplySilenceRemoval {
                sequence_id: job.context.sequence_id,
                ranges: ranges
                    .iter()
                    .map(|range| TimelineRange {
                        start: range.start,
                        end: range.end,
                    })
                    .collect(),
            },
        )
    }

    pub fn create_short_from_candidate(
        &mut self,
        source_sequence_id: SequenceId,
        candidate: &HighlightCandidate,
        request_id: RequestId,
        crop: Crop,
    ) -> Result<CommandResultDto, AppError> {
        let snapshot = self.snapshot()?;
        if snapshot.revision != candidate.source_revision {
            return Err(AppError::StaleRevision {
                expected: candidate.source_revision,
                actual: snapshot.revision,
            });
        }

        let source = snapshot
            .project
            .sequences
            .iter()
            .find(|sequence| sequence.id == source_sequence_id)
            .ok_or(DomainError::EntityNotFound { entity: "sequence" })?;
        let short = build_short_sequence(source, candidate, crop)?;

        self.execute_edit_command(EditRequest {
            request_id,
            expected_revision: candidate.source_revision,
            command: EditCommand::AddSequence {
                sequence: short,
                index: None,
            },
        })
    }

    pub fn apply_transcript_result(
        &mut self,
        job: &JobSnapshot,
        request_id: RequestId,
        transcript: &TranscriptResult,
    ) -> Result<CommandResultDto, AppError> {
        if job.kind != JobKind::Transcription {
            return Err(AppError::InvalidAnalysisJobKind { actual: job.kind });
        }

        if transcript.provenance.source_revision != job.context.source_revision {
            return Err(AppError::AnalysisRevisionMismatch {
                job_revision: job.context.source_revision,
                result_revision: transcript.provenance.source_revision,
            });
        }

        self.execute_job_result(
            job,
            request_id,
            EditCommand::AddSubtitleSegments {
                sequence_id: job.context.sequence_id,
                segments: transcript.subtitle_segments(),
            },
        )
    }

    fn editor_mut(&mut self) -> Result<&mut Editor, AppError> {
        self.editor.as_mut().ok_or(AppError::NoProject)
    }
}

fn build_short_sequence(
    source: &Sequence,
    candidate: &HighlightCandidate,
    crop: Crop,
) -> Result<Sequence, AppError> {
    if candidate.end <= candidate.start {
        return Err(DomainError::InvalidEdit {
            reason: "highlight candidate must have positive duration",
        }
        .into());
    }

    let mut tracks = Vec::with_capacity(source.tracks.len());
    for source_track in &source.tracks {
        let mut clips = Vec::new();
        for source_clip in &source_track.clips {
            let overlap_start = source_clip.timeline_start.max(candidate.start);
            let overlap_end = source_clip.timeline_end.min(candidate.end);
            if overlap_end <= overlap_start {
                continue;
            }

            let source_start_delta = overlap_start.checked_sub(source_clip.timeline_start)?;
            let source_end_delta = overlap_end.checked_sub(source_clip.timeline_start)?;
            let mut clip = source_clip.clone();
            clip.id = ClipId::new();
            clip.timeline_start = overlap_start.checked_sub(candidate.start)?;
            clip.timeline_end = overlap_end.checked_sub(candidate.start)?;
            clip.source_in = source_clip
                .source_in
                .checked_add(scale_timeline_delta(source_start_delta, source_clip.speed)?)?;
            clip.source_out = source_clip
                .source_in
                .checked_add(scale_timeline_delta(source_end_delta, source_clip.speed)?)?;
            if clip.source_out > source_clip.source_out {
                clip.source_out = source_clip.source_out;
            }
            if matches!(clip.kind, ClipKind::Video | ClipKind::Image) {
                clip.transform.crop = crop;
            }
            clips.push(clip);
        }

        tracks.push(Track {
            id: TrackId::new(),
            name: source_track.name.clone(),
            kind: source_track.kind,
            muted: source_track.muted,
            locked: false,
            hidden: source_track.hidden,
            clips,
        });
    }

    let subtitle_segments = source
        .subtitle_segments
        .iter()
        .filter_map(|segment| trim_subtitle(segment, candidate.start, candidate.end))
        .collect();

    Ok(Sequence {
        id: SequenceId::new(),
        name: format!("{} Short", source.name),
        width: 1080,
        height: 1920,
        fps: source.fps,
        tracks,
        subtitle_segments,
        subtitle_style: source.subtitle_style.clone(),
        markers: Vec::new(),
    })
}

fn trim_subtitle(
    segment: &SubtitleSegment,
    range_start: TimeUs,
    range_end: TimeUs,
) -> Option<SubtitleSegment> {
    let start = segment.start.max(range_start);
    let end = segment.end.min(range_end);
    if end <= start {
        return None;
    }
    Some(SubtitleSegment {
        start: start.checked_sub(range_start).ok()?,
        end: end.checked_sub(range_start).ok()?,
        text: segment.text.clone(),
    })
}

fn scale_timeline_delta(delta: TimeUs, speed: f64) -> Result<TimeUs, DomainError> {
    let scaled = (delta.get() as f64) * speed;
    if !scaled.is_finite() || scaled < 0.0 || scaled > i64::MAX as f64 {
        return Err(DomainError::TimeOverflow);
    }
    TimeUs::new(scaled.round() as i64)
}

impl From<editor_core::CommandResult> for CommandResultDto {
    fn from(result: editor_core::CommandResult) -> Self {
        Self {
            request_id: result.request_id,
            revision: result.revision,
            changed_entities: result.changed_entities,
        }
    }
}
