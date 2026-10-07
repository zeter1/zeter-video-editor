use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! define_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            pub fn get(self) -> Uuid {
                self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
    };
}

define_id!(ProjectId);
define_id!(SequenceId);
define_id!(TrackId);
define_id!(ClipId);
define_id!(MediaId);
define_id!(JobId);
define_id!(RequestId);

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Serialize, de::DeserializeOwned};

    fn assert_round_trip<T>(value: T)
    where
        T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
    {
        let encoded = serde_json::to_string(&value).expect("id should serialize");
        let decoded: T = serde_json::from_str(&encoded).expect("id should deserialize");

        assert_eq!(decoded, value);
    }

    #[test]
    fn ids_round_trip_through_serde() {
        assert_round_trip(ProjectId::new());
        assert_round_trip(SequenceId::new());
        assert_round_trip(TrackId::new());
        assert_round_trip(ClipId::new());
        assert_round_trip(MediaId::new());
        assert_round_trip(JobId::new());
        assert_round_trip(RequestId::new());
    }
}
