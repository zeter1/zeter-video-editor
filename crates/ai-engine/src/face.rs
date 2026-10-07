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
