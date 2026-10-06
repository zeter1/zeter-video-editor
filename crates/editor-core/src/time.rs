#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_rejects_negative_duration() {
        let error = TimeUs::new(-1).expect_err("negative time must be rejected");
        assert_eq!(error.to_string(), "time value must be non-negative: -1");
    }
}
