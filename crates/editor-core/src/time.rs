use serde::{Deserialize, Serialize};

use crate::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TimeUs(i64);

impl TimeUs {
    pub fn new(value: i64) -> Result<Self, DomainError> {
        if value < 0 {
            return Err(DomainError::NegativeTime { value });
        }

        Ok(Self(value))
    }

    pub fn get(self) -> i64 {
        self.0
    }

    pub fn checked_add(self, rhs: Self) -> Result<Self, DomainError> {
        self.0
            .checked_add(rhs.0)
            .ok_or(DomainError::TimeOverflow)
            .and_then(Self::new)
    }

    pub fn checked_sub(self, rhs: Self) -> Result<Self, DomainError> {
        self.0
            .checked_sub(rhs.0)
            .ok_or(DomainError::TimeOverflow)
            .and_then(Self::new)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_rejects_negative_duration() {
        assert!(TimeUs::new(-1).is_err());
    }

    #[test]
    fn time_checked_add_and_subtract_preserve_non_negative_values() {
        let two = TimeUs::new(2).expect("valid time");
        let three = TimeUs::new(3).expect("valid time");
        let five = TimeUs::new(5).expect("valid time");

        assert_eq!(two.checked_add(three).expect("2 + 3"), five);
        assert_eq!(five.checked_sub(three).expect("5 - 3"), two);
    }

    #[test]
    fn time_checked_math_rejects_overflow_and_negative_results() {
        let max = TimeUs::new(i64::MAX).expect("valid time");
        let one = TimeUs::new(1).expect("valid time");
        let zero = TimeUs::new(0).expect("valid time");

        assert!(max.checked_add(one).is_err());
        assert!(zero.checked_sub(one).is_err());
    }
}
