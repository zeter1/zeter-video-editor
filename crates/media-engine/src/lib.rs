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
pub mod waveform;

pub use capabilities::{detect_capabilities, EncoderCapabilities, MediaCapabilities};
pub use encoder::{select_encoder, EncoderKind, EncoderSelection};
pub use error::MediaError;
pub use export::{ExportJob, ExportReceipt, ExportRunner, ManagedExportRunner};
pub use probe::{probe_media, AudioProbe, MediaProbe, VideoProbe};
pub use render_plan::{ExportContainer, ExportQuality, ExportSettings, RenderPlan, VideoCodec};
pub use runtime::ManagedRuntime;

#[cfg(test)]
mod task7_tests;
#[cfg(test)]
mod task8_tests;
#[cfg(test)]
mod task9_tests;
