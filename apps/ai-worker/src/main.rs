mod protocol;
mod runtime;
mod silence;
mod transcription;

fn main() {
    if let Err(error) = runtime::run_stdio() {
        eprintln!("AI worker terminated: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod task14_tests;
#[cfg(test)]
mod task15_integration_tests;
#[cfg(test)]
mod task16_runtime_tests;
