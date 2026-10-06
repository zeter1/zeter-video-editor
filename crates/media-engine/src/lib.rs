#![forbid(unsafe_code)]

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

pub use cache_key::{CacheKey, CacheRange, PreviewQuality};
pub use capabilities::{detect_capabilities, parse_encoder_list, CodecSupport, MediaCapabilities};
pub use error::MediaError;
pub use preview_cache::{
    cache_metadata_path, lookup_cache_artifact, lookup_preview_cache, record_cache_artifact,
};
pub use probe::{
    build_ffprobe_args, parse_ffprobe_json, probe_media, AudioStreamProbe, MediaProbe,
    VideoStreamProbe,
};
pub use process::{run_process, ProcessOutput};
pub use proxy::{build_proxy_args, generate_proxy, ProxyArtifact};
pub use runtime::ManagedRuntime;
pub use thumbnail::{build_thumbnail_args, generate_thumbnail};
pub use waveform::{build_waveform_args, generate_waveform};
