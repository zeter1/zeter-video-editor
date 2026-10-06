pub mod capabilities;
pub mod error;
pub mod probe;
pub mod process;
pub mod runtime;

pub use capabilities::{detect_capabilities, EncoderCapabilities, MediaCapabilities};
pub use error::MediaError;
pub use probe::{probe_media, AudioProbe, MediaProbe, VideoProbe};
pub use runtime::ManagedRuntime;

#[cfg(test)]
mod task7_tests;
#[cfg(test)]
mod task8_tests;
