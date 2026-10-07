use std::path::{Path, PathBuf};

use ai_engine::{HighlightCandidate, SilenceRange, TranscriptResult};
use editor_core::{
    ClipId, ClipKind, Crop, DomainError, EditCommand, EditRequest, Editor, MediaRef, Project,
    ProjectRevision, RenderSnapshot, RequestId, Sequence, SequenceId, SubtitleSegment, TimeUs,
    TimelineRange, Track, TrackId,
};
use job_system::{JobKind, JobSnapshot, JobState};
use media_engine::MediaProbe;
use project_io::{RecoveryCandidate, RecoverySnapshot};

use crate::{
    contracts::{CommandResultDto, ProjectSnapshotDto},
    error::AppError,
    update::SaveState,
};

pub struct ProjectService {
    editor: Option<Editor>,
    project_path: Option<PathBuf>,
    saved_revision: Option<ProjectRevision>,
    save_state: SaveState,
}

impl ProjectService {
    pub fn empty() -> Self {
        Self {
            editor: None,
            project_path: None,
            saved_revision: None,
            save_state: SaveState::Idle,
        }
    }

    pub fn from_project(project: Project, revision: ProjectRevision) -> Result<Self, AppError> {
        Ok(Self {
            editor: Some(Editor::from_revision(project, revision)?),
            project_path: None,
            saved_revision: Some(revision),
            save_state: SaveState::Idle,
        })
    }

    pub fn open(&mut self, path: &Path) -> Result<ProjectSnapshotDto, AppError> {
        let loaded = project_io::load(path)?;
        self.install_loaded_project(path, loaded.project, loaded.revision)
    }

    pub fn open_validated<F>(
        &mut self,
        path: &Path,
        mut probe: F,
    ) -> Result<ProjectSnapshotDto, AppError>
    where
        F: FnMut(&Path) -> Result<MediaProbe, AppError>,
    {
        let mut loaded = project_io::load(path)?;
        let project_dir = path.parent().unwrap_or_else(|| Path::new("."));
        validate_project_media(&mut loaded.project, project_dir, &mut probe)?;
        self.install_loaded_project(path, loaded.project, loaded.revision)
    }

    pub fn open_with_relink<F>(
        &mut self,
        path: &Path,
        replacement_path: &Path,
        mut probe: F,
    ) -> Result<ProjectSnapshotDto, AppError>
    where
        F: FnMut(&Path) -> Result<MediaProbe, AppError>,
    {
        let mut loaded = project_io::load(path)?;
        let project_dir = path.parent().unwrap_or_else(|| Path::new("."));
        let mut relink = None;

        for media in &mut loaded.project.media {
            match validate_media_reference(media, project_dir, &mut probe) {
                Ok(resolved) => {
                    media.absolute_path = resolved.to_string_lossy().into_owned();
                }
                Err(
                    error
                    @ (AppError::MissingMedia { .. } | AppError::MediaIdentityMismatch { .. }),
                ) if relink.is_none() => {
                    let resolved =
                        validate_explicit_replacement(media, replacement_path, &mut probe)
                            .map_err(|replacement_error| match replacement_error {
                                AppError::MissingMedia { .. }
                                | AppError::MediaIdentityMismatch { .. } => replacement_error,
                                _ => error,
                            })?;
                    let mut replacement = media.clone();
                    replacement.absolute_path = resolved.to_string_lossy().into_owned();
                    replacement.project_relative_path = resolved
                        .strip_prefix(project_dir)
                        .ok()
                        .map(|relative| relative.to_string_lossy().into_owned());
                    relink = Some((media.id, replacement));
                }
                Err(error) => return Err(error),
            }
        }

        let Some((media_id, media)) = relink else {
            return self.install_loaded_project(path, loaded.project, loaded.revision);
        };

        let saved_revision = loaded.revision;
        let mut editor = Editor::from_revision(loaded.project, saved_revision)?;
        editor.execute(EditRequest {
            request_id: RequestId::new(),
            expected_revision: saved_revision,
            command: EditCommand::RelinkMedia { media_id, media },
        })?;
        self.editor = Some(editor);
        self.project_path = Some(path.to_path_buf());
        self.saved_revision = Some(saved_revision);
        self.save_state = SaveState::Idle;
        self.snapshot()
    }

    pub fn save(&mut self, path: &Path) -> Result<ProjectSnapshotDto, AppError> {
        let snapshot = self.snapshot()?;
        self.save_state = SaveState::Saving;
        match project_io::save_atomic(path, &snapshot.project, snapshot.revision) {
            Ok(_) => {
                self.project_path = Some(path.to_path_buf());
                self.saved_revision = Some(snapshot.revision);
                self.save_state = SaveState::Idle;
                Ok(snapshot)
            }
            Err(error) => {
                self.save_state = SaveState::Failed;
                Err(error.into())
            }
        }
    }

    pub fn current_path(&self) -> Option<&Path> {
        self.project_path.as_deref()
    }

    pub fn is_dirty(&self) -> bool {
        match (self.editor.as_ref(), self.saved_revision.as_ref()) {
            (Some(editor), Some(saved_revision)) => editor.revision() != *saved_revision,
            (Some(_), None) => true,
            (None, _) => false,
        }
    }

    pub fn save_state(&self) -> SaveState {
        self.save_state
    }

    pub fn snapshot(&self) -> Result<ProjectSnapshotDto, AppError> {
        let editor = self.editor.as_ref().ok_or(AppError::NoProject)?;
        Ok(ProjectSnapshotDto {
            revision: editor.revision(),
            project: editor.project().clone(),
        })
    }

    pub fn write_recovery_snapshot(
        &self,
        project_dir: &Path,
        now_ms: u64,
    ) -> Result<RecoverySnapshot, AppError> {
        let editor = self.editor.as_ref().ok_or(AppError::NoProject)?;
        Ok(project_io::write_recovery(
            project_dir,
            editor.project(),
            editor.revision(),
            now_ms,
        )?)
    }

    pub fn recovery_candidates(
        &self,
        project_dir: &Path,
    ) -> Result<Vec<RecoveryCandidate>, AppError> {
        let editor = self.editor.as_ref().ok_or(AppError::NoProject)?;
        let project_id = editor.project().id;
        let candidates = project_io::find_recovery_candidates(project_dir, editor.revision())?;

        let mut matching = Vec::new();
        for candidate in candidates {
            let loaded = project_io::load(&candidate.path)?;
            if loaded.project.id == project_id {
                matching.push(candidate);
            }
        }
        Ok(matching)
    }

    pub fn open_recovery(
        &mut self,
        canonical_path: &Path,
        recovery_path: &Path,
    ) -> Result<ProjectSnapshotDto, AppError> {
        let canonical_project_id = self
            .editor
            .as_ref()
            .ok_or(AppError::NoProject)?
            .project()
            .id;
        let loaded = project_io::load(recovery_path)?;
        if loaded.project.id != canonical_project_id {
            return Err(DomainError::InvalidEdit {
                reason: "recovery snapshot belongs to a different project",
            }
            .into());
        }

        self.editor = Some(Editor::from_revision(loaded.project, loaded.revision)?);
        self.project_path = Some(canonical_path.to_path_buf());
        self.save_state = SaveState::Idle;
        self.snapshot()
    }

    pub fn render_snapshot(&self, sequence_id: SequenceId) -> Result<RenderSnapshot, AppError> {
        let editor = self.editor.as_ref().ok_or(AppError::NoProject)?;
        Ok(RenderSnapshot::from_sequence(
            editor.project(),
            sequence_id,
            editor.revision(),
        )?)
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

    fn install_loaded_project(
        &mut self,
        path: &Path,
        project: Project,
        revision: ProjectRevision,
    ) -> Result<ProjectSnapshotDto, AppError> {
        let editor = Editor::from_revision(project, revision)?;
        self.editor = Some(editor);
        self.project_path = Some(path.to_path_buf());
        self.saved_revision = Some(revision);
        self.save_state = SaveState::Idle;
        self.snapshot()
    }

    fn editor_mut(&mut self) -> Result<&mut Editor, AppError> {
        self.editor.as_mut().ok_or(AppError::NoProject)
    }
}

const MEDIA_DURATION_TOLERANCE_US: i64 = 10_000;

fn validate_project_media<F>(
    project: &mut Project,
    project_dir: &Path,
    probe: &mut F,
) -> Result<(), AppError>
where
    F: FnMut(&Path) -> Result<MediaProbe, AppError>,
{
    for media in &mut project.media {
        let resolved = validate_media_reference(media, project_dir, probe)?;
        media.absolute_path = resolved.to_string_lossy().into_owned();
    }
    Ok(())
}

fn validate_media_reference<F>(
    media: &MediaRef,
    project_dir: &Path,
    probe: &mut F,
) -> Result<PathBuf, AppError>
where
    F: FnMut(&Path) -> Result<MediaProbe, AppError>,
{
    let candidates = media_candidates(media, project_dir);
    let mut found_existing = false;
    let mut first_probe_error = None;

    for candidate in candidates {
        let Ok(metadata) = std::fs::metadata(&candidate) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        found_existing = true;

        if metadata.len() != media.file_size {
            continue;
        }

        let actual = match probe(&candidate) {
            Ok(actual) => actual,
            Err(error) => {
                if first_probe_error.is_none() {
                    first_probe_error = Some(error);
                }
                continue;
            }
        };
        if media_probe_matches(media, &actual) {
            return Ok(candidate);
        }
    }

    if !found_existing {
        return Err(AppError::MissingMedia { media_id: media.id });
    }

    if let Some(error) = first_probe_error {
        return Err(error);
    }

    Err(AppError::MediaIdentityMismatch {
        media_id: media.id,
        detail: "file size, probed duration, or video dimensions no longer match".into(),
    })
}

fn validate_explicit_replacement<F>(
    media: &MediaRef,
    replacement_path: &Path,
    probe: &mut F,
) -> Result<PathBuf, AppError>
where
    F: FnMut(&Path) -> Result<MediaProbe, AppError>,
{
    let metadata = std::fs::metadata(replacement_path)
        .map_err(|_| AppError::MissingMedia { media_id: media.id })?;
    if !metadata.is_file() || metadata.len() != media.file_size {
        return Err(AppError::MediaIdentityMismatch {
            media_id: media.id,
            detail: "replacement file size does not match saved media identity".into(),
        });
    }

    let actual = probe(replacement_path)?;
    if !media_probe_matches(media, &actual) {
        return Err(AppError::MediaIdentityMismatch {
            media_id: media.id,
            detail: "replacement duration or video dimensions do not match saved media identity"
                .into(),
        });
    }

    Ok(replacement_path.to_path_buf())
}

fn media_candidates(media: &MediaRef, project_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from(&media.absolute_path)];
    if let Some(relative) = &media.project_relative_path {
        let candidate = project_dir.join(relative);
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn media_probe_matches(expected: &MediaRef, actual: &MediaProbe) -> bool {
    if let Some(expected_duration) = expected.duration {
        let Some(actual_seconds) = actual.duration_seconds else {
            return false;
        };
        if !actual_seconds.is_finite() || actual_seconds < 0.0 {
            return false;
        }
        let actual_us = (actual_seconds * 1_000_000.0).round();
        if actual_us > i64::MAX as f64 {
            return false;
        }
        if (expected_duration.get() - actual_us as i64).abs() > MEDIA_DURATION_TOLERANCE_US {
            return false;
        }
    }

    match (expected.width, expected.height) {
        (Some(width), Some(height)) => actual
            .video
            .as_ref()
            .is_some_and(|video| video.width == width && video.height == height),
        (None, None) => true,
        _ => false,
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
