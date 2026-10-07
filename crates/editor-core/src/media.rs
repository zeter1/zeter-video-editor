use serde::{Deserialize, Serialize};

use crate::{MediaId, TimeUs};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaRef {
    pub id: MediaId,
    pub absolute_path: String,
    pub project_relative_path: Option<String>,
    pub file_size: u64,
    pub duration: Option<TimeUs>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_reference_keeps_external_source_identity() {
        let media = MediaRef {
            id: MediaId::new(),
            absolute_path: "D:/footage/take-01.mp4".into(),
            project_relative_path: Some("footage/take-01.mp4".into()),
            file_size: 1_048_576,
            duration: Some(TimeUs::new(5_000_000).expect("valid duration")),
            width: Some(1920),
            height: Some(1080),
        };

        assert_eq!(media.absolute_path, "D:/footage/take-01.mp4");
        assert_eq!(media.file_size, 1_048_576);
    }
}
