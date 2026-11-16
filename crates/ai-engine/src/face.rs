use editor_core::Crop;
use serde::{Deserialize, Serialize};

use crate::AiError;

const VERTICAL_ASPECT: f32 = 9.0 / 16.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FaceBounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

pub trait FaceLocator {
    fn locate_primary_face(
        &self,
        frame_width: u32,
        frame_height: u32,
    ) -> Result<Option<FaceBounds>, AiError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct CenterCropFaceLocator;

impl FaceLocator for CenterCropFaceLocator {
    fn locate_primary_face(
        &self,
        _frame_width: u32,
        _frame_height: u32,
    ) -> Result<Option<FaceBounds>, AiError> {
        Ok(None)
    }
}

pub struct CapabilityGatedFaceLocator<L> {
    enabled: bool,
    platform: L,
}

impl<L> CapabilityGatedFaceLocator<L> {
    pub fn new(enabled: bool, platform: L) -> Self {
        Self { enabled, platform }
    }
}

impl<L: FaceLocator> FaceLocator for CapabilityGatedFaceLocator<L> {
    fn locate_primary_face(
        &self,
        frame_width: u32,
        frame_height: u32,
    ) -> Result<Option<FaceBounds>, AiError> {
        if self.enabled {
            self.platform.locate_primary_face(frame_width, frame_height)
        } else {
            Ok(None)
        }
    }
}

pub fn initial_vertical_crop(
    source_width: u32,
    source_height: u32,
    face: Option<FaceBounds>,
) -> Result<Crop, AiError> {
    if source_width == 0 || source_height == 0 {
        return Err(AiError::InvalidAnalysisOutput(
            "source dimensions must be non-zero".into(),
        ));
    }
    if let Some(face) = face {
        validate_face(face)?;
    }

    let source_aspect = source_width as f32 / source_height as f32;
    if (source_aspect - VERTICAL_ASPECT).abs() < f32::EPSILON {
        return Ok(Crop::default());
    }

    if source_aspect > VERTICAL_ASPECT {
        let visible_width = (VERTICAL_ASPECT / source_aspect).clamp(0.0, 1.0);
        let center_x = face
            .map(|bounds| bounds.x + bounds.width / 2.0)
            .unwrap_or(0.5);
        let left = (center_x - visible_width / 2.0).clamp(0.0, 1.0 - visible_width);
        let right = (1.0 - left - visible_width).max(0.0);
        Ok(Crop {
            left,
            top: 0.0,
            right,
            bottom: 0.0,
        })
    } else {
        let visible_height = (source_aspect / VERTICAL_ASPECT).clamp(0.0, 1.0);
        let center_y = face
            .map(|bounds| bounds.y + bounds.height / 2.0)
            .unwrap_or(0.5);
        let top = (center_y - visible_height / 2.0).clamp(0.0, 1.0 - visible_height);
        let bottom = (1.0 - top - visible_height).max(0.0);
        Ok(Crop {
            left: 0.0,
            top,
            right: 0.0,
            bottom,
        })
    }
}

fn validate_face(face: FaceBounds) -> Result<(), AiError> {
    let values = [face.x, face.y, face.width, face.height];
    if values.iter().any(|value| !value.is_finite())
        || face.x < 0.0
        || face.y < 0.0
        || face.width <= 0.0
        || face.height <= 0.0
        || face.x + face.width > 1.0
        || face.y + face.height > 1.0
    {
        return Err(AiError::InvalidAnalysisOutput(
            "face bounds must be finite normalized coordinates inside the frame".into(),
        ));
    }
    Ok(())
}

// Bundled BSD-2-Clause SeetaFace frontal cascade: see model/THIRD_PARTY_NOTICE.md.
const FACE_MODEL: &[u8] = include_bytes!("../model/seeta_fd_frontal_v1.0.bin");

/// Choose a deterministic single focus in scenes containing several people.
/// Prefer the largest detected face; tie-break toward the frame center, then
/// toward the left/top. Empty/invalid model outputs are never treated as faces.
pub fn select_primary_face(faces: &[FaceBounds]) -> Option<FaceBounds> {
    faces
        .iter()
        .copied()
        .filter(|face| validate_face(*face).is_ok())
        .max_by(|a, b| {
            let area_a = a.width * a.height;
            let area_b = b.width * b.height;
            let distance = |face: &FaceBounds| {
                let dx = face.x + face.width / 2.0 - 0.5;
                let dy = face.y + face.height / 2.0 - 0.5;
                dx * dx + dy * dy
            };
            area_a
                .total_cmp(&area_b)
                .then_with(|| distance(b).total_cmp(&distance(a)))
                .then_with(|| b.x.total_cmp(&a.x))
                .then_with(|| b.y.total_cmp(&a.y))
        })
}

/// Analyze a bounded grayscale source frame entirely on CPU. No account,
/// cloud inference, storage or per-person identity data are involved.
pub fn locate_primary_face_in_grayscale(
    grayscale: &[u8],
    width: u32,
    height: u32,
) -> Result<Option<FaceBounds>, AiError> {
    if width < 20
        || height < 20
        || width > 640
        || height > 640
        || (width as usize).checked_mul(height as usize) != Some(grayscale.len())
    {
        return Err(AiError::InvalidAnalysisOutput(
            "grayscale face detection input must be a complete frame <=640x640".into(),
        ));
    }
    let model = rustface::read_model(FACE_MODEL)
        .map_err(|_| AiError::WorkerUnavailable("embedded face detector is invalid".into()))?;
    let mut detector = rustface::create_detector_with_model(model);
    detector.set_min_face_size(20);
    detector.set_score_thresh(2.0);
    detector.set_pyramid_scale_factor(0.8);
    detector.set_slide_window_step(4, 4);
    let image = rustface::ImageData::new(grayscale, width, height);
    let faces: Vec<FaceBounds> = detector
        .detect(&image)
        .iter()
        .filter_map(|face| {
            let rect = face.bbox();
            let left = rect.x().max(0) as u32;
            let top = rect.y().max(0) as u32;
            let right =
                (i64::from(rect.x()) + i64::from(rect.width())).clamp(0, i64::from(width)) as u32;
            let bottom =
                (i64::from(rect.y()) + i64::from(rect.height())).clamp(0, i64::from(height)) as u32;
            if right <= left || bottom <= top {
                return None;
            }
            Some(FaceBounds {
                x: left as f32 / width as f32,
                y: top as f32 / height as f32,
                width: (right - left) as f32 / width as f32,
                height: (bottom - top) as f32 / height as f32,
            })
        })
        .collect();
    Ok(select_primary_face(&faces))
}

#[cfg(test)]
mod local_face_tests {
    use super::*;

    fn face(x: f32, y: f32, width: f32, height: f32) -> FaceBounds {
        FaceBounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn no_face_and_invalid_faces_use_center_fallback() {
        assert_eq!(select_primary_face(&[]), None);
        assert_eq!(select_primary_face(&[face(f32::NAN, 0.1, 0.3, 0.3)]), None);
        let crop = initial_vertical_crop(1920, 1080, None).unwrap();
        assert!((crop.left - crop.right).abs() < 0.00001);
    }

    #[test]
    fn multiple_faces_choose_largest_then_nearest_center_then_left() {
        let small = face(0.0, 0.1, 0.15, 0.15);
        let large = face(0.7, 0.2, 0.28, 0.3);
        assert_eq!(select_primary_face(&[small, large]), Some(large));
        let far = face(0.1, 0.1, 0.2, 0.2);
        let near = face(0.4, 0.4, 0.2, 0.2);
        assert_eq!(select_primary_face(&[far, near]), Some(near));
        let left = face(0.2, 0.4, 0.2, 0.2);
        let right = face(0.6, 0.4, 0.2, 0.2);
        assert_eq!(select_primary_face(&[right, left]), Some(left));
    }

    #[test]
    fn frame_rejects_truncated_and_unbounded_data() {
        assert!(locate_primary_face_in_grayscale(&[], 512, 512).is_err());
        assert!(locate_primary_face_in_grayscale(&[], 100_000, 100_000).is_err());
    }

    #[test]
    fn blank_frame_has_no_false_face() {
        let blank = vec![127_u8; 320 * 240];
        assert_eq!(
            locate_primary_face_in_grayscale(&blank, 320, 240).unwrap(),
            None
        );
    }

    #[test]
    fn actual_public_domain_astronaut_face_is_detected() {
        // Public-domain NASA astronaut photo, scikit-image v0.25.2.
        let frame = include_bytes!("../tests/fixtures/astronaut-512.gray");
        let located = locate_primary_face_in_grayscale(frame, 512, 512).unwrap();
        println!("Face found on genuine source image: {located:?}");
        assert!(
            located.is_some(),
            "a real photographic face must be detected"
        );
    }
}
