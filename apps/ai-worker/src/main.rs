mod protocol;
mod runtime;

fn main() {
    if let Err(error) = runtime::run_stdio() {
        eprintln!("AI worker terminated: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod task14_tests;
