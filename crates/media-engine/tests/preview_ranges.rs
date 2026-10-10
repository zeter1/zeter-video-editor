use std::collections::HashSet;

use editor_core::{
    ClipId, ClipKind, ColorAdjustments, MediaId, MediaRef, ProjectId, ProjectRevision, RenderAudio,
    RenderClip, RenderSnapshot, RenderSubtitle, RenderText, RenderTransition, SequenceId,
    SubtitleStyle, TextStyle, TimeUs, TrackId, Transform, TransitionKind,
};
use media_engine::{MediaError, PreviewDecodeCapabilities, PreviewMode, PreviewRangePlan};

fn t(value: i64) -> TimeUs {
    TimeUs::new(value).expect("non-negative test time")
}

fn snapshot() -> RenderSnapshot {
    RenderSnapshot {
        project_id: ProjectId::new(),
        sequence_id: SequenceId::new(),
        revision: ProjectRevision::new(42),
        width: 1920,
        height: 1080,
        fps: 30.0,
        media: vec![],
        clips: vec![],
        texts: vec![],
        subtitles: vec![],
        subtitle_style: SubtitleStyle::default(),
        audio: vec![],
        transitions: vec![],
    }
}

fn clip(kind: ClipKind, media_id: Option<MediaId>, start: i64, end: i64) -> RenderClip {
    RenderClip {
        clip_id: ClipId::new(),
        track_id: TrackId::new(),
        track_index: 0,
        clip_index: 0,
        kind,
        media_id,
        source_in: t(0),
        source_out: t(10_000_000),
        timeline_start: t(start),
        timeline_end: t(end),
        transform: Transform::default(),
        color: ColorAdjustments::default(),
        speed: 1.0,
        track_hidden: false,
    }
}

fn add(s: &mut RenderSnapshot, kind: ClipKind, start: i64, end: i64) -> RenderClip {
    let media_id = MediaId::new();
    if kind != ClipKind::Text {
        s.media.push(MediaRef {
            id: media_id,
            absolute_path: "C:/secret/should-not-appear.mp4".into(),
            project_relative_path: None,
            file_size: 10,
            duration: None,
            width: Some(1920),
            height: Some(1080),
        });
    }
    let c = clip(
        kind,
        (kind != ClipKind::Text).then_some(media_id),
        start,
        end,
    );
    s.audio.push(RenderAudio {
        clip_id: c.clip_id,
        volume: 1.0,
        gain_db: 0.0,
        muted: false,
        fade_in: t(0),
        fade_out: t(0),
    });
    s.clips.push(c.clone());
    c
}

fn caps(ids: &[MediaId]) -> PreviewDecodeCapabilities {
    PreviewDecodeCapabilities {
        direct_playback_media_ids: ids.iter().copied().collect::<HashSet<_>>(),
    }
}

fn compile(s: &RenderSnapshot, ids: &[MediaId]) -> PreviewRangePlan {
    PreviewRangePlan::compile(s, &caps(ids)).expect("valid snapshot")
}

fn ranges(p: &PreviewRangePlan) -> Vec<(i64, i64, PreviewMode)> {
    p.ranges
        .iter()
        .map(|r| (r.start.get(), r.end.get(), r.mode.clone()))
        .collect()
}

#[test]
fn empty_plan_retains_identity_and_revision() {
    let s = snapshot();
    let before = s.clone();
    let p = compile(&s, &[]);
    assert_eq!(p.project_id, s.project_id);
    assert_eq!(p.sequence_id, s.sequence_id);
    assert_eq!(p.revision, s.revision);
    assert!(p.ranges.is_empty());
    assert_eq!(s, before);
}

#[test]
fn overlap_of_two_videos_is_composite_only_during_overlap() {
    let mut s = snapshot();
    let a = add(&mut s, ClipKind::Video, 0, 4);
    let b = add(&mut s, ClipKind::Video, 2, 6);
    let p = compile(&s, &[a.media_id.unwrap(), b.media_id.unwrap()]);
    assert_eq!(
        ranges(&p),
        vec![
            (
                0,
                2,
                PreviewMode::Direct {
                    media_id: a.media_id.unwrap(),
                    clip_id: a.clip_id
                }
            ),
            (2, 4, PreviewMode::Composite),
            (
                4,
                6,
                PreviewMode::Direct {
                    media_id: b.media_id.unwrap(),
                    clip_id: b.clip_id
                }
            )
        ]
    );
}

#[test]
fn image_is_still_alone_but_composite_over_video_or_with_transform() {
    let mut s = snapshot();
    let image = add(&mut s, ClipKind::Image, 0, 5);
    let p = compile(&s, &[]);
    assert_eq!(
        ranges(&p),
        vec![(
            0,
            5,
            PreviewMode::Still {
                media_id: image.media_id.unwrap(),
                clip_id: image.clip_id
            }
        )]
    );
    let v = add(&mut s, ClipKind::Video, 1, 3);
    let p = compile(&s, &[v.media_id.unwrap()]);
    assert_eq!(p.ranges[1].mode, PreviewMode::Composite);
    s.clips.pop();
    s.audio.pop();
    s.clips[0].transform.opacity = 0.5;
    assert_eq!(
        ranges(&compile(&s, &[])),
        vec![(0, 5, PreviewMode::Composite)]
    );
}

#[test]
fn opening_gaps_and_touching_clips_preserve_half_open_boundaries() {
    let mut s = snapshot();
    let a = add(&mut s, ClipKind::Video, 2, 4);
    let b = add(&mut s, ClipKind::Video, 4, 5);
    let plan = compile(&s, &[a.media_id.unwrap(), b.media_id.unwrap()]);
    assert_eq!(
        ranges(&plan)
            .iter()
            .map(|(a, b, _)| (*a, *b))
            .collect::<Vec<_>>(),
        vec![(0, 2), (2, 4), (4, 5)]
    );
    assert_eq!(plan.ranges[0].mode, PreviewMode::Gap);
    assert!(plan.ranges.iter().all(|r| r.start < r.end));
}

#[test]
fn subtitle_and_text_only_are_composite_and_split_video() {
    let mut s = snapshot();
    let v = add(&mut s, ClipKind::Video, 0, 10);
    s.subtitles.push(RenderSubtitle {
        start: t(2),
        end: t(4),
        text: "hello".into(),
    });
    let text = add(&mut s, ClipKind::Text, 6, 8);
    s.texts.push(RenderText {
        clip_id: text.clip_id,
        timeline_start: t(6),
        timeline_end: t(8),
        text: "text".into(),
        style: TextStyle::default(),
        transform: Transform::default(),
    });
    let p = compile(&s, &[v.media_id.unwrap()]);
    assert_eq!(
        p.ranges.iter().map(|r| r.mode.clone()).collect::<Vec<_>>(),
        vec![
            PreviewMode::Direct {
                media_id: v.media_id.unwrap(),
                clip_id: v.clip_id
            },
            PreviewMode::Composite,
            PreviewMode::Direct {
                media_id: v.media_id.unwrap(),
                clip_id: v.clip_id
            },
            PreviewMode::Composite,
            PreviewMode::Direct {
                media_id: v.media_id.unwrap(),
                clip_id: v.clip_id
            },
        ]
    );
    let mut only = snapshot();
    only.subtitles.push(RenderSubtitle {
        start: t(3),
        end: t(4),
        text: "solo".into(),
    });
    assert_eq!(
        ranges(&compile(&only, &[])),
        vec![(0, 3, PreviewMode::Gap), (3, 4, PreviewMode::Composite)]
    );
}

#[test]
fn independent_audio_and_hidden_video_are_not_gaps() {
    let mut s = snapshot();
    let a = add(&mut s, ClipKind::Audio, 1, 3);
    assert_eq!(
        ranges(&compile(&s, &[])),
        vec![(0, 1, PreviewMode::Gap), (1, 3, PreviewMode::Composite)]
    );
    s.audio[0].muted = true;
    assert_eq!(
        ranges(&compile(&s, &[])),
        vec![(0, 1, PreviewMode::Gap), (1, 3, PreviewMode::Gap)]
    );
    let mut hidden = snapshot();
    let v = add(&mut hidden, ClipKind::Video, 0, 3);
    hidden.clips[0].track_hidden = true;
    assert_eq!(
        ranges(&compile(&hidden, &[v.media_id.unwrap()])),
        vec![(0, 3, PreviewMode::Composite)]
    );
    hidden.audio[0].muted = true;
    assert_eq!(
        ranges(&compile(&hidden, &[v.media_id.unwrap()])),
        vec![(0, 3, PreviewMode::Gap)]
    );
    assert_eq!(a.kind, ClipKind::Audio);
}

#[test]
fn independent_audio_requires_mix_but_normal_video_audio_is_direct() {
    let mut s = snapshot();
    let v = add(&mut s, ClipKind::Video, 0, 5);
    assert_eq!(
        ranges(&compile(&s, &[v.media_id.unwrap()]))[0].2,
        PreviewMode::Direct {
            media_id: v.media_id.unwrap(),
            clip_id: v.clip_id
        }
    );
    let _a = add(&mut s, ClipKind::Audio, 1, 3);
    let p = compile(&s, &[v.media_id.unwrap()]);
    assert_eq!(p.ranges[1].mode, PreviewMode::Composite);
    s.audio[1].muted = true;
    assert_eq!(
        compile(&s, &[v.media_id.unwrap()]).ranges[1].mode,
        PreviewMode::Direct {
            media_id: v.media_id.unwrap(),
            clip_id: v.clip_id
        }
    );
    s.audio[0].gain_db = 3.0;
    assert_eq!(
        compile(&s, &[v.media_id.unwrap()]).ranges[1].mode,
        PreviewMode::Composite
    );
}

#[test]
fn transitions_and_speed_switch_to_composite() {
    let mut s = snapshot();
    let v = add(&mut s, ClipKind::Video, 1, 5);
    s.transitions.push(RenderTransition {
        clip_id: v.clip_id,
        kind: TransitionKind::Fade,
        duration: t(2),
    });
    let p = compile(&s, &[v.media_id.unwrap()]);
    assert_eq!(
        ranges(&p),
        vec![
            (0, 1, PreviewMode::Gap),
            (1, 3, PreviewMode::Composite),
            (
                3,
                5,
                PreviewMode::Direct {
                    media_id: v.media_id.unwrap(),
                    clip_id: v.clip_id
                }
            ),
        ]
    );
    s.clips[0].speed = 1.5;
    assert_eq!(
        compile(&s, &[v.media_id.unwrap()])
            .ranges
            .last()
            .unwrap()
            .mode,
        PreviewMode::Composite
    );
}

#[test]
fn trims_are_not_recomputed_and_unknown_decoder_uses_proxy() {
    let mut s = snapshot();
    let v = add(&mut s, ClipKind::Video, 2, 6);
    s.clips[0].source_in = t(50);
    s.clips[0].source_out = t(55);
    let before = s.clone();
    assert_eq!(
        ranges(&compile(&s, &[])),
        vec![
            (0, 2, PreviewMode::Gap),
            (
                2,
                6,
                PreviewMode::Proxy {
                    media_id: v.media_id.unwrap(),
                    clip_id: v.clip_id
                }
            ),
        ]
    );
    assert_eq!(s, before);
}

#[test]
fn invalid_references_and_malformed_auxiliary_spans_are_rejected_without_paths() {
    let mut s = snapshot();
    s.clips.push(clip(ClipKind::Image, None, 0, 2));
    let e = PreviewRangePlan::compile(&s, &caps(&[])).unwrap_err();
    assert!(matches!(e, MediaError::InvalidPreviewSnapshot { .. }));
    assert!(!e.to_string().contains("C:/secret"));

    let mut unknown = snapshot();
    unknown
        .clips
        .push(clip(ClipKind::Audio, Some(MediaId::new()), 0, 2));
    assert!(matches!(
        PreviewRangePlan::compile(&unknown, &caps(&[])),
        Err(MediaError::MissingRenderSource { .. })
    ));

    let mut orphan = snapshot();
    orphan.texts.push(RenderText {
        clip_id: ClipId::new(),
        timeline_start: t(0),
        timeline_end: t(2),
        text: "orphan".into(),
        style: TextStyle::default(),
        transform: Transform::default(),
    });
    assert!(matches!(
        PreviewRangePlan::compile(&orphan, &caps(&[])),
        Err(MediaError::InvalidPreviewSnapshot { .. })
    ));

    let mut transition = snapshot();
    transition.transitions.push(RenderTransition {
        clip_id: ClipId::new(),
        kind: TransitionKind::Fade,
        duration: t(1),
    });
    assert!(PreviewRangePlan::compile(&transition, &caps(&[])).is_err());
}

#[test]
fn malformed_intervals_nan_speed_duplicate_ids_and_hidden_missing_media_fail() {
    let mut s = snapshot();
    let c = add(&mut s, ClipKind::Video, 0, 2);
    s.clips[0].speed = f64::NAN;
    assert!(PreviewRangePlan::compile(&s, &caps(&[])).is_err());
    s.clips[0].speed = 1.0;
    s.clips[0].timeline_start = t(3);
    assert!(PreviewRangePlan::compile(&s, &caps(&[])).is_err());
    s.clips[0].timeline_start = t(0);
    s.clips.push(c.clone());
    assert!(PreviewRangePlan::compile(&s, &caps(&[])).is_err());
    s.clips.pop();
    s.clips[0].track_hidden = true;
    s.clips[0].media_id = None;
    assert!(PreviewRangePlan::compile(&s, &caps(&[])).is_err());
}

#[test]
fn maximum_timestamp_and_zero_duration_never_emit_empty_ranges_or_overflow() {
    let mut s = snapshot();
    let c = add(&mut s, ClipKind::Video, i64::MAX - 2, i64::MAX);
    s.transitions.push(RenderTransition {
        clip_id: c.clip_id,
        kind: TransitionKind::Fade,
        duration: t(10),
    });
    let zero = add(&mut s, ClipKind::Video, 1, 1);
    let p = compile(&s, &[c.media_id.unwrap(), zero.media_id.unwrap()]);
    assert_eq!(p.ranges.last().unwrap().end, t(i64::MAX));
    assert!(p.ranges.iter().all(|r| r.start < r.end));
}

#[test]
fn logically_equal_clip_permutations_yield_same_plan() {
    let mut s = snapshot();
    let a = add(&mut s, ClipKind::Video, 0, 4);
    let b = add(&mut s, ClipKind::Video, 2, 6);
    let original = ranges(&compile(&s, &[a.media_id.unwrap(), b.media_id.unwrap()]));
    s.clips.reverse();
    s.audio.reverse();
    assert_eq!(
        original,
        ranges(&compile(&s, &[a.media_id.unwrap(), b.media_id.unwrap()]))
    );
}
