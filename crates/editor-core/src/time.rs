use crate::DomainError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TimeUs(i64);

impl TimeUs {
    pub const ZERO: Self = Self(0);

    pub fn new(value: i64) -> Result<Self, DomainError> {
        if value < 0 {
            return Err(DomainError::NegativeTime(value));
        }
        Ok(Self(value))
    }

    pub fn get(self) -> i64 {
        self.0
    }

    pub fn checked_add(self, other: Self) -> Result<Self, DomainError> {
        let value = self.0.checked_add(other.0).ok_or(DomainError::TimeOverflow)?;
        Self::new(value)
    }

    pub fn checked_sub(self, other: Self) -> Result<Self, DomainError> {
        let value = self.0.checked_sub(other.0).ok_or(DomainError::TimeOverflow)?;
        Self::new(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_rejects_negative_duration() {
        let error = TimeUs::new(-1).expect_err("negative time must be rejected");
        assert_eq!(error.to_string(), "time value must be non-negative: -1");
    }
}
