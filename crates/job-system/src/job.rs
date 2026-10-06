#[cfg(test)]
mod tests {
    use super::*;
    use editor_core::command::ProjectRevision;
    use editor_core::ids::{ProjectId, RequestId, SequenceId};

    fn spec(kind: JobKind) -> JobSpec {
        JobSpec {
            kind,
            request_id: RequestId::new(),
            project_id: ProjectId::new(),
            sequence_id: Some(SequenceId::new()),
            source_revision: ProjectRevision::new(42),
            cancellable: true,
        }
    }

    #[test]
    fn context_preserves_ids_and_marks_stale_against_newer_revision() {
        let manager = JobManager::new();
        let job_id = manager.submit(spec(JobKind::HighlightAnalysis));
        let snapshot = manager.snapshot(job_id).unwrap();

        assert_eq!(snapshot.context.job_id, job_id);
        assert_eq!(snapshot.context.source_revision, ProjectRevision::new(42));
        assert!(!snapshot.context.is_stale(ProjectRevision::new(42)));
        assert!(snapshot.context.is_stale(ProjectRevision::new(43)));
    }
}
