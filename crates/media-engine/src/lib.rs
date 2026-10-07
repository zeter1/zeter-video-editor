pub mod cache_key;
pub mod capabilities;
pub mod encoder;
pub mod error;
pub mod export;
pub mod preview_cache;
pub mod probe;
pub mod process;
pub mod proxy;
pub mod render_plan;
pub mod runtime;
pub mod thumbnail;
pub mod transcription_audio;
pub mod waveform;

pub use capabilities::{EncoderCapabilities, MediaCapabilities, detect_capabilities};
pub use encoder::{EncoderKind, EncoderSelection, select_encoder};
pub use error::MediaError;
pub use export::{ExportJob, ExportReceipt, ExportRunner, ManagedExportRunner};
pub use probe::{AudioProbe, MediaProbe, VideoProbe, probe_media};
pub use render_plan::{ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec};
pub use runtime::ManagedRuntime;

#[cfg(test)]
mod task15_tests;
#[cfg(test)]
mod task7_tests;
#[cfg(test)]
mod task8_tests;
#[cfg(test)]
mod task9_tests;
