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

            pub fn from_uuid(value: Uuid) -> Self {
                Self(value)
            }

            pub fn as_uuid(self) -> Uuid {
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

    #[test]
    fn ids_round_trip_through_serde() {
        let id = ProjectId::new();
        let encoded = serde_json::to_string(&id).expect("serialize project id");
        let decoded: ProjectId = serde_json::from_str(&encoded).expect("deserialize project id");
        assert_eq!(decoded, id);
    }
}
