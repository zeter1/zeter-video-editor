use std::{
    fmt,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

use editor_core::JobId;

use crate::{
    AI_WORKER_PROTOCOL_VERSION, AiError, AnalysisRequest, AnalysisResult, WorkerHello,
    WorkerRequest, WorkerResponse,
};

pub trait WorkerTransport {
    fn hello(&mut self) -> Result<WorkerHello, AiError>;
    fn analyze(&mut self, request: &AnalysisRequest) -> Result<AnalysisResult, AiError>;
    fn cancel(&mut self, job_id: JobId) -> Result<(), AiError>;
}

pub struct WorkerClient<T> {
    transport: T,
}

impl<T> fmt::Debug for WorkerClient<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WorkerClient")
            .field("protocol_version", &AI_WORKER_PROTOCOL_VERSION)
            .finish_non_exhaustive()
    }
}

impl<T: WorkerTransport> WorkerClient<T> {
    pub fn connect(mut transport: T) -> Result<Self, AiError> {
        let hello = transport.hello()?;
        if hello.protocol_version != AI_WORKER_PROTOCOL_VERSION {
            return Err(AiError::ProtocolMismatch {
                expected: AI_WORKER_PROTOCOL_VERSION,
                actual: hello.protocol_version,
            });
        }
        Ok(Self { transport })
    }

    pub fn analyze(&mut self, request: &AnalysisRequest) -> Result<AnalysisResult, AiError> {
        self.transport.analyze(request)
    }

    pub fn cancel(&mut self, job_id: JobId) -> Result<(), AiError> {
        self.transport.cancel(job_id)
    }
}

pub trait WorkerFactory {
    type Transport: WorkerTransport;

    fn spawn(&mut self) -> Result<Self::Transport, AiError>;
}

pub struct WorkerSupervisor<F: WorkerFactory> {
    factory: F,
    client: Option<WorkerClient<F::Transport>>,
}

impl<F: WorkerFactory> WorkerSupervisor<F> {
    pub fn new(factory: F) -> Self {
        Self {
            factory,
            client: None,
        }
    }

    pub fn analyze(&mut self, request: &AnalysisRequest) -> Result<AnalysisResult, AiError> {
        if self.client.is_none() {
            let transport = self.factory.spawn()?;
            self.client = Some(WorkerClient::connect(transport)?);
        }

        let result = self
            .client
            .as_mut()
            .expect("client initialized")
            .analyze(request);
        if matches!(
            result,
            Err(AiError::WorkerCrashed(_))
                | Err(AiError::WorkerUnavailable(_))
                | Err(AiError::ProtocolIo(_))
                | Err(AiError::ProtocolJson(_))
        ) {
            self.client = None;
        }
        result
    }

    pub fn cancel(&mut self, job_id: JobId) -> Result<(), AiError> {
        let Some(client) = self.client.as_mut() else {
            return Ok(());
        };
        let result = client.cancel(job_id);
        if result.is_err() {
            self.client = None;
        }
        result
    }

    pub fn invalidate_worker(&mut self) {
        self.client = None;
    }
}

#[derive(Debug, Clone)]
pub struct ProcessWorkerFactory {
    executable: PathBuf,
}

impl ProcessWorkerFactory {
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
        }
    }

    pub fn executable(&self) -> &Path {
        &self.executable
    }
}

impl WorkerFactory for ProcessWorkerFactory {
    type Transport = ChildWorkerTransport;

    fn spawn(&mut self) -> Result<Self::Transport, AiError> {
        ChildWorkerTransport::spawn(&self.executable)
    }
}

pub struct ChildWorkerTransport {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl ChildWorkerTransport {
    pub fn spawn(executable: &Path) -> Result<Self, AiError> {
        let mut child = Command::new(executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| AiError::WorkerUnavailable(error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AiError::WorkerUnavailable("worker stdin is unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AiError::WorkerUnavailable("worker stdout is unavailable".into()))?;

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    fn request(&mut self, request: &WorkerRequest) -> Result<WorkerResponse, AiError> {
        serde_json::to_writer(&mut self.stdin, request)
            .map_err(|error| AiError::ProtocolJson(error.to_string()))?;
        self.stdin
            .write_all(b"\n")
            .map_err(|error| AiError::ProtocolIo(error.to_string()))?;
        self.stdin
            .flush()
            .map_err(|error| AiError::ProtocolIo(error.to_string()))?;

        let mut line = String::new();
        let read = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| AiError::ProtocolIo(error.to_string()))?;
        if read == 0 {
            let status = self.child.try_wait().ok().flatten();
            return Err(AiError::WorkerCrashed(format!(
                "worker closed stdout{}",
                status
                    .map(|value| format!(" with status {value}"))
                    .unwrap_or_default()
            )));
        }
        serde_json::from_str(line.trim_end())
            .map_err(|error| AiError::ProtocolJson(error.to_string()))
    }
}

impl WorkerTransport for ChildWorkerTransport {
    fn hello(&mut self) -> Result<WorkerHello, AiError> {
        match self.request(&WorkerRequest::Hello {
            protocol_version: AI_WORKER_PROTOCOL_VERSION,
        })? {
            WorkerResponse::Hello {
                protocol_version,
                worker_build,
            } => Ok(WorkerHello {
                protocol_version,
                worker_build,
            }),
            WorkerResponse::Error { code, message } => {
                Err(AiError::WorkerUnavailable(format!("{code}: {message}")))
            }
            other => Err(AiError::WorkerUnavailable(format!(
                "unexpected hello response: {other:?}"
            ))),
        }
    }

    fn analyze(&mut self, request: &AnalysisRequest) -> Result<AnalysisResult, AiError> {
        match self.request(&WorkerRequest::Analyze(request.clone()))? {
            WorkerResponse::Analysis(result) => Ok(result),
            WorkerResponse::Error { code, message } => {
                Err(AiError::WorkerUnavailable(format!("{code}: {message}")))
            }
            other => Err(AiError::WorkerUnavailable(format!(
                "unexpected analysis response: {other:?}"
            ))),
        }
    }

    fn cancel(&mut self, job_id: JobId) -> Result<(), AiError> {
        match self.request(&WorkerRequest::Cancel { job_id })? {
            WorkerResponse::Cancelled { job_id: cancelled } if cancelled == job_id => Ok(()),
            WorkerResponse::Error { code, message } => {
                Err(AiError::WorkerUnavailable(format!("{code}: {message}")))
            }
            other => Err(AiError::WorkerUnavailable(format!(
                "unexpected cancellation response: {other:?}"
            ))),
        }
    }
}

impl Drop for ChildWorkerTransport {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
