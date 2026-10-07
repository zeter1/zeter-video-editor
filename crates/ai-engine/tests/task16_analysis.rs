use ai_engine::{
    FaceBounds, HighlightParams, HighlightSignal, SilenceParams, detect_silence,
    initial_vertical_crop, rank_highlights,
};
use editor_core::{ProjectRevision, TimeUs};

fn time(value: i64) -> TimeUs {
    TimeUs::new(value).unwrap()
}

#[test]
fn silence_detection_honors_threshold_minimum_duration_padding_and_boundaries() {
    let mut samples = vec![0.8_f32; 100];
    samples.extend(vec![0.01; 300]);
    samples.extend(vec![0.8; 100]);
    samples.extend(vec![0.01; 50]);
    samples.extend(vec![0.8; 50]);

    let ranges = detect_silence(
        &samples,
        SilenceParams {
            sample_rate_hz: 1_000,
            threshold: 0.05,
            minimum_duration: time(200_000),
            padding: time(50_000),
        },
    );

    assert_eq!(ranges.len(), 1);
    assert_eq!(ranges[0].start, time(50_000));
    assert_eq!(ranges[0].end, time(450_000));

    let edge = detect_silence(
        &[0.0; 100],
        SilenceParams {
            sample_rate_hz: 1_000,
            threshold: 0.01,
            minimum_duration: time(20_000),
            padding: time(50_000),
        },
    );
    assert_eq!(edge[0].start, time(0));
    assert_eq!(edge[0].end, time(100_000));
}

#[test]
fn highlight_ranking_is_deterministic_explainable_and_revision_bound() {
    let revision = ProjectRevision::new(9);
    let signals = vec![
        HighlightSignal {
            start: time(0),
            end: time(10_000_000),
            transcript_boundary: 0.9,
            speech_density: 0.8,
            pause_boundary: 0.9,
            loudness_change: 0.2,
            scene_change: 0.1,
            source_revision: revision,
        },
        HighlightSignal {
            start: time(20_000_000),
            end: time(30_000_000),
            transcript_boundary: 0.5,
            speech_density: 0.4,
            pause_boundary: 0.2,
            loudness_change: 0.8,
            scene_change: 0.7,
            source_revision: revision,
        },
    ];

    let first = rank_highlights(&signals, HighlightParams::default());
    let second = rank_highlights(&signals, HighlightParams::default());

    assert_eq!(first, second);
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].start, time(0));
    assert!(first[0].score > first[1].score);
    assert_eq!(first[0].source_revision, revision);
    assert!(
        first[0]
            .reasons
            .iter()
            .any(|reason| reason.contains("speech"))
    );
    assert!(
        first[0]
            .reasons
            .iter()
            .any(|reason| reason.contains("thought"))
    );
}

#[test]
fn face_reframe_seeds_crop_but_center_crop_is_always_available() {
    let centered = initial_vertical_crop(1920, 1080, None).expect("center fallback");
    assert!((centered.left - centered.right).abs() < 0.0001);
    assert_eq!(centered.top, 0.0);
    assert_eq!(centered.bottom, 0.0);

    let face = initial_vertical_crop(
        1920,
        1080,
        Some(FaceBounds {
            x: 0.70,
            y: 0.20,
            width: 0.15,
            height: 0.30,
        }),
    )
    .expect("face-aware seed");
    assert!(face.left > centered.left);
    assert!(face.right < centered.right);
    assert!((face.left + face.right) < 1.0);
}

#[test]
fn face_locator_is_called_only_when_capability_is_enabled() {
    use std::cell::Cell;

    use ai_engine::{CapabilityGatedFaceLocator, FaceLocator};

    struct TrackingLocator {
        calls: Cell<u32>,
    }

    impl FaceLocator for TrackingLocator {
        fn locate_primary_face(
            &self,
            _frame_width: u32,
            _frame_height: u32,
        ) -> Result<Option<FaceBounds>, ai_engine::AiError> {
            self.calls.set(self.calls.get() + 1);
            Ok(Some(FaceBounds {
                x: 0.6,
                y: 0.2,
                width: 0.2,
                height: 0.3,
            }))
        }
    }

    let disabled = TrackingLocator {
        calls: Cell::new(0),
    };
    let locator = CapabilityGatedFaceLocator::new(false, disabled);
    assert_eq!(locator.locate_primary_face(1920, 1080).unwrap(), None);

    let enabled = TrackingLocator {
        calls: Cell::new(0),
    };
    let locator = CapabilityGatedFaceLocator::new(true, enabled);
    assert!(locator.locate_primary_face(1920, 1080).unwrap().is_some());
}
