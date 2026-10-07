use std::io::Cursor;

use ai_engine::{AI_WORKER_PROTOCOL_VERSION, WorkerRequest, WorkerResponse};
use editor_core::{JobId, ProjectRevision};

use crate::runtime::run_session;

#[test]
fn malformed_or_cancelled_worker_session_can_be_restarted_without_project_state() {
    let authoritative_revision = ProjectRevision::new(11);

    let bad_input = format!(
        "{{\"Hello\":{{\"protocol_version\":{}}}}}\nnot-json\n",
        AI_WORKER_PROTOCOL_VERSION
    );
    let mut bad_output = Vec::new();
    assert!(run_session(Cursor::new(bad_input), &mut bad_output).is_err());
    assert_eq!(authoritative_revision, ProjectRevision::new(11));

    let job_id = JobId::new();
    let hello = serde_json::to_string(&WorkerRequest::Hello {
        protocol_version: AI_WORKER_PROTOCOL_VERSION,
    })
    .unwrap();
    let cancel = serde_json::to_string(&WorkerRequest::Cancel { job_id }).unwrap();
    let input = format!("{hello}\n{cancel}\n");
    let mut output = Vec::new();

    run_session(Cursor::new(input), &mut output).expect("fresh worker session should run");

    let responses: Vec<WorkerResponse> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(matches!(
        responses.as_slice(),
        [
            WorkerResponse::Hello { protocol_version, .. },
            WorkerResponse::Cancelled { job_id: cancelled }
        ] if *protocol_version == AI_WORKER_PROTOCOL_VERSION && *cancelled == job_id
    ));
    assert_eq!(authoritative_revision, ProjectRevision::new(11));
}
