//! Pure, read-only preview execution classification for an immutable RenderSnapshot.
//!
//! This is intentionally a planner, NOT a rendered preview, proxy cache, or WebView2
//! codec probe. Direct playback is permitted only for explicitly supported media IDs.
use std::collections::{BTreeSet, HashMap, HashSet};

use editor_core::{
    ClipId, ClipKind, ColorAdjustments, MediaId, ProjectId, ProjectRevision, RenderAudio,
    RenderClip, RenderSnapshot, SequenceId, TimeUs, Transform,
};

use crate::MediaError;

/// Positive evidence from a separate validated decoder capability probe.
/// Absent IDs are *not* considered directly playable.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PreviewDecodeCapabilities {
    pub direct_playback_media_ids: HashSet<MediaId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewRangePlan {
    pub project_id: ProjectId,
    pub sequence_id: SequenceId,
    pub revision: ProjectRevision,
    pub ranges: Vec<PreviewRange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewRange {
    pub start: TimeUs,
    pub end: TimeUs,
    pub mode: PreviewMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreviewMode {
    Direct { media_id: MediaId, clip_id: ClipId },
    Proxy { media_id: MediaId, clip_id: ClipId },
    Composite,
    Still { media_id: MediaId, clip_id: ClipId },
    Gap,
}

fn invalid(reason: &'static str) -> MediaError {
    MediaError::InvalidPreviewSnapshot { reason }
}

fn active(start: TimeUs, end: TimeUs, at: TimeUs) -> bool {
    start <= at && at < end
}

fn simple_transform(transform: &Transform) -> bool {
    *transform == Transform::default()
}

fn simple_color(color: &ColorAdjustments) -> bool {
    *color == ColorAdjustments::default()
}

fn simple_video_audio(audio: &RenderAudio) -> bool {
    !audio.muted
        && audio.volume == 1.0
        && audio.gain_db == 0.0
        && audio.fade_in.get() == 0
        && audio.fade_out.get() == 0
}

/// Validate even hidden clips; never silently treat a broken media reference as a gap.
fn validate(snapshot: &RenderSnapshot) -> Result<HashMap<ClipId, &RenderAudio>, MediaError> {
    let mut media = HashMap::new();
    for source in &snapshot.media {
        if let Some(previous) = media.insert(source.id, source) {
            if previous != source {
                return Err(invalid("conflicting duplicate media IDs"));
            }
        }
    }

    let mut clips = HashMap::new();
    for clip in &snapshot.clips {
        if clips.insert(clip.clip_id, clip).is_some() {
            return Err(invalid("duplicate clip IDs"));
        }
        if clip.source_in >= clip.source_out {
            return Err(invalid("invalid clip source span"));
        }
        if clip.timeline_start > clip.timeline_end {
            return Err(invalid("invalid clip timeline span"));
        }
        if !clip.speed.is_finite() || clip.speed <= 0.0 {
            return Err(invalid("invalid clip speed"));
        }
        let needs_media = matches!(
            clip.kind,
            ClipKind::Video | ClipKind::Audio | ClipKind::Image
        );
        if needs_media && clip.media_id.is_none() {
            return Err(invalid("media-backed clip has no media ID"));
        }
        if let Some(id) = clip.media_id {
            if !media.contains_key(&id) {
                return Err(MediaError::MissingRenderSource { media_id: id });
            }
        }
    }

    let mut audio = HashMap::new();
    for state in &snapshot.audio {
        if !clips.contains_key(&state.clip_id) {
            return Err(invalid("orphan audio state"));
        }
        if audio.insert(state.clip_id, state).is_some() {
            return Err(invalid("duplicate audio state"));
        }
        if !state.volume.is_finite() || state.volume < 0.0 || !state.gain_db.is_finite() {
            return Err(invalid("invalid audio settings"));
        }
    }
    for clip in &snapshot.clips {
        if !audio.contains_key(&clip.clip_id) {
            return Err(invalid("missing clip audio state"));
        }
    }

    let mut text_ids = HashSet::new();
    for text in &snapshot.texts {
        let owner = clips.get(&text.clip_id).ok_or(invalid("orphan text"))?;
        if !text_ids.insert(text.clip_id) {
            return Err(invalid("duplicate text state"));
        }
        if text.timeline_start > text.timeline_end
            || text.timeline_start < owner.timeline_start
            || text.timeline_end > owner.timeline_end
        {
            return Err(invalid("text span outside owner clip"));
        }
    }
    for subtitle in &snapshot.subtitles {
        if subtitle.start >= subtitle.end {
            return Err(invalid("invalid subtitle span"));
        }
    }
    let mut transition_ids = HashSet::new();
    for transition in &snapshot.transitions {
        if !clips.contains_key(&transition.clip_id) {
            return Err(invalid("orphan transition"));
        }
        if !transition_ids.insert(transition.clip_id) {
            return Err(invalid("duplicate transition"));
        }
    }
    Ok(audio)
}

fn mode_at(
    snapshot: &RenderSnapshot,
    at: TimeUs,
    audio: &HashMap<ClipId, &RenderAudio>,
    capabilities: &PreviewDecodeCapabilities,
) -> PreviewMode {
    if snapshot
        .texts
        .iter()
        .any(|text| active(text.timeline_start, text.timeline_end, at))
        || snapshot
            .subtitles
            .iter()
            .any(|sub| active(sub.start, sub.end, at))
    {
        return PreviewMode::Composite;
    }
    if snapshot.transitions.iter().any(|transition| {
        snapshot.clips.iter().any(|clip| {
            clip.clip_id == transition.clip_id
                && active(
                    clip.timeline_start,
                    TimeUs::new(
                        clip.timeline_start
                            .get()
                            .saturating_add(transition.duration.get())
                            .min(clip.timeline_end.get()),
                    )
                    .expect("bounded nonnegative transition time"),
                    at,
                )
        })
    }) {
        return PreviewMode::Composite;
    }

    let mut visible: Option<&RenderClip> = None;
    for clip in snapshot
        .clips
        .iter()
        .filter(|clip| active(clip.timeline_start, clip.timeline_end, at))
    {
        let state = audio[&clip.clip_id];
        match clip.kind {
            ClipKind::Audio => {
                if !state.muted {
                    return PreviewMode::Composite;
                }
            }
            ClipKind::Video if clip.track_hidden => {
                if !state.muted {
                    // Hiding a video does not mute its potential embedded audio.
                    return PreviewMode::Composite;
                }
            }
            ClipKind::Video | ClipKind::Image if !clip.track_hidden => {
                if visible.is_some()
                    || !simple_transform(&clip.transform)
                    || !simple_color(&clip.color)
                    || clip.speed != 1.0
                {
                    return PreviewMode::Composite;
                }
                if clip.kind == ClipKind::Video && !simple_video_audio(state) {
                    return PreviewMode::Composite;
                }
                visible = Some(clip);
            }
            _ => {}
        }
    }

    match visible {
        Some(clip) => {
            // All visible video/images were validated to carry a media identity.
            let media_id = clip.media_id.expect("validated media-backed clip");
            match clip.kind {
                ClipKind::Image => PreviewMode::Still {
                    media_id,
                    clip_id: clip.clip_id,
                },
                ClipKind::Video if capabilities.direct_playback_media_ids.contains(&media_id) => {
                    PreviewMode::Direct {
                        media_id,
                        clip_id: clip.clip_id,
                    }
                }
                ClipKind::Video => PreviewMode::Proxy {
                    media_id,
                    clip_id: clip.clip_id,
                },
                _ => PreviewMode::Gap,
            }
        }
        None => PreviewMode::Gap,
    }
}

impl PreviewRangePlan {
    /// Deterministically partition timeline time into half-open ranges without I/O.
    pub fn compile(
        snapshot: &RenderSnapshot,
        decode_capabilities: &PreviewDecodeCapabilities,
    ) -> Result<Self, MediaError> {
        let audio = validate(snapshot)?;
        let duration = snapshot
            .clips
            .iter()
            .map(|clip| clip.timeline_end.get())
            .chain(snapshot.subtitles.iter().map(|sub| sub.end.get()))
            .max()
            .unwrap_or(0);
        let mut plan = Self {
            project_id: snapshot.project_id,
            sequence_id: snapshot.sequence_id,
            revision: snapshot.revision,
            ranges: Vec::new(),
        };
        if duration == 0 {
            return Ok(plan);
        }
        let mut boundaries = BTreeSet::from([0_i64, duration]);
        let mut add = |value: i64| {
            boundaries.insert(value.min(duration));
        };
        for clip in &snapshot.clips {
            if clip.timeline_start == clip.timeline_end {
                continue;
            }
            add(clip.timeline_start.get());
            add(clip.timeline_end.get());
        }
        for text in &snapshot.texts {
            add(text.timeline_start.get());
            add(text.timeline_end.get());
        }
        for sub in &snapshot.subtitles {
            add(sub.start.get());
            add(sub.end.get());
        }
        for transition in &snapshot.transitions {
            // validate() guaranteed a matching clip, so this lookup cannot be orphaned.
            let clip = snapshot
                .clips
                .iter()
                .find(|c| c.clip_id == transition.clip_id)
                .expect("validated transition owner");
            if clip.timeline_start == clip.timeline_end {
                continue;
            }
            add(clip.timeline_start.get());
            add(clip
                .timeline_start
                .get()
                .saturating_add(transition.duration.get())
                .min(clip.timeline_end.get()));
        }

        let points: Vec<_> = boundaries.into_iter().collect();
        for pair in points.windows(2) {
            let (start, end) = (pair[0], pair[1]);
            if start == end {
                continue;
            }
            let start = TimeUs::new(start).expect("validated nonnegative boundary");
            let end = TimeUs::new(end).expect("validated nonnegative boundary");
            plan.ranges.push(PreviewRange {
                start,
                end,
                mode: mode_at(snapshot, start, &audio, decode_capabilities),
            });
        }
        Ok(plan)
    }
}
