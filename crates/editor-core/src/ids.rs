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
