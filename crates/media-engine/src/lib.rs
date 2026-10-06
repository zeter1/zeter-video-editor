#![forbid(unsafe_code)]

pub mod capabilities;
pub mod error;
pub mod probe;
pub mod process;
pub mod runtime;

pub use capabilities::{detect_capabilities, parse_encoder_list, CodecSupport, MediaCapabilities};
pub use error::MediaError;
pub use probe::{
    build_ffprobe_args, parse_ffprobe_json, probe_media, AudioStreamProbe, MediaProbe,
    VideoStreamProbe,
};
pub use process::{run_process, ProcessOutput};
pub use runtime::ManagedRuntime;
