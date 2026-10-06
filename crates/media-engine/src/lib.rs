pub mod cache_key;
pub mod capabilities;
pub mod error;
pub mod preview_cache;
pub mod probe;
pub mod process;
pub mod proxy;
pub mod runtime;
pub mod thumbnail;
pub mod waveform;

pub use capabilities::{detect_capabilities, EncoderCapabilities, MediaCapabilities};
pub use error::MediaError;
pub use probe::{probe_media, AudioProbe, MediaProbe, VideoProbe};
pub use runtime::ManagedRuntime;

#[cfg(test)]
mod task7_tests;
#[cfg(test)]
mod task8_tests;
