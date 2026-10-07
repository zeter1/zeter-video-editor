import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const DESKTOP = path.join(REPO, "apps", "desktop");
const TARGET = path.join(REPO, "target");
const E2E_ROOT = path.join(TARGET, "task19-e2e");
const RUNTIME = path.join(E2E_ROOT, "runtime");
const FIXTURES = path.join(E2E_ROOT, "fixtures");
const STATE = path.join(E2E_ROOT, "state.json");
const PROJECT_TEMPLATE = path.join(REPO, "tests", "fixtures", "projects", "task19-base.vcut");

function exec(command: string, args: string[], cwd = REPO): void {
  const isCmdShim = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const executable = isCmdShim ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs = isCmdShim ? ["/d", "/s", "/c", command, ...args] : args;

  execFileSync(executable, executableArgs, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate E2E CDP port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForCdp(port: number, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Tauri E2E app exited before WebView2 became debuggable (code ${child.exitCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // WebView2 is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("timed out waiting for Tauri WebView2 CDP endpoint");
}


function clipFixture(
  id: string,
  kind: "Video" | "Audio" | "Image" | "Text",
  mediaId: string | null,
  sourceOut: number,
  timelineStart: number,
  timelineEnd: number,
  text: string | null = null,
) {
  return {
    id,
    kind,
    media_id: mediaId,
    source_in: 0,
    source_out: sourceOut,
    timeline_start: timelineStart,
    timeline_end: timelineEnd,
    transform: {
      position_x: 0,
      position_y: 0,
      scale_x: 1,
      scale_y: 1,
      rotation_degrees: 0,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    color: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      saturation: 1,
      temperature: 0,
      tint: 0,
    },
    audio: {
      volume: 1,
      gain_db: 0,
      muted: false,
      fade_in: 0,
      fade_out: 0,
    },
    speed: 1,
    transition: null,
    text:
      text === null
        ? null
        : {
            text,
            style: {
              font_family: "Arial",
              font_size: 52,
              weight: 700,
              alignment: "Center",
              color: "#FFFFFF",
              stroke_color: "#000000",
              stroke_width: 2,
              shadow: true,
              background: null,
              opacity: 1,
            },
          },
  };
}

function createWorkflowProject(mediaDir: string, outputPath: string): void {
  const document = JSON.parse(readFileSync(PROJECT_TEMPLATE, "utf8")) as {
    revision: number;
    project: {
      name: string;
      media: unknown[];
      sequences: Array<{
        tracks: Array<{ name: string; clips: unknown[] }>;
        subtitle_segments: Array<{ start: number; end: number; text: string }>;
      }>;
    };
  };

  const videoPath = path.join(mediaDir, "synthetic-1080p.mp4");
  const audioPath = path.join(mediaDir, "synthetic-audio.wav");
  const imagePath = path.join(mediaDir, "synthetic-image.png");
  const videoMediaId = "44444444-4444-4444-8444-444444444441";
  const audioMediaId = "44444444-4444-4444-8444-444444444442";
  const imageMediaId = "44444444-4444-4444-8444-444444444443";

  document.revision = 0;
  document.project.name = "Task 19 Workflow";
  document.project.media = [
    {
      id: videoMediaId,
      absolute_path: videoPath,
      project_relative_path: path.basename(videoPath),
      file_size: statSync(videoPath).size,
      duration: 6_000_000,
      width: 1920,
      height: 1080,
    },
    {
      id: audioMediaId,
      absolute_path: audioPath,
      project_relative_path: path.basename(audioPath),
      file_size: statSync(audioPath).size,
      duration: 6_000_000,
      width: null,
      height: null,
    },
    {
      id: imageMediaId,
      absolute_path: imagePath,
      project_relative_path: path.basename(imagePath),
      file_size: statSync(imagePath).size,
      duration: null,
      width: 1280,
      height: 720,
    },
  ];

  const sequence = document.project.sequences[0];
  const track = (name: string) => {
    const found = sequence.tracks.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`missing Task 19 fixture track: ${name}`);
    return found;
  };

  track("Video").clips = [
    clipFixture(
      "55555555-5555-4555-8555-555555555551",
      "Video",
      videoMediaId,
      4_000_000,
      0,
      4_000_000,
    ),
  ];
  track("Overlay").clips = [
    clipFixture(
      "55555555-5555-4555-8555-555555555552",
      "Image",
      imageMediaId,
      2_000_000,
      1_000_000,
      3_000_000,
    ),
  ];
  track("Audio").clips = [
    clipFixture(
      "55555555-5555-4555-8555-555555555553",
      "Audio",
      audioMediaId,
      4_000_000,
      0,
      4_000_000,
    ),
  ];
  track("Text").clips = [
    clipFixture(
      "55555555-5555-4555-8555-555555555554",
      "Text",
      null,
      2_000_000,
      500_000,
      2_500_000,
      "Task 19 title",
    ),
  ];
  sequence.subtitle_segments = [
    {
      start: 750_000,
      end: 1_750_000,
      text: "Task 19 subtitle",
    },
  ];

  writeFileSync(outputPath, JSON.stringify(document, null, 2));
}

export default async function globalSetup(): Promise<void> {
  const ffmpegDir = process.env.ZETER_TEST_FFMPEG_DIR;
  if (!ffmpegDir) {
    throw new Error("ZETER_TEST_FFMPEG_DIR must point at the explicit managed FFmpeg fixture directory");
  }

  const ffmpeg = path.join(ffmpegDir, "ffmpeg.exe");
  const ffprobe = path.join(ffmpegDir, "ffprobe.exe");
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) {
    throw new Error("ZETER_TEST_FFMPEG_DIR must contain ffmpeg.exe and ffprobe.exe");
  }

  rmSync(E2E_ROOT, { recursive: true, force: true });
  mkdirSync(RUNTIME, { recursive: true });
  mkdirSync(FIXTURES, { recursive: true });

  exec("cargo.exe", [
    "build",
    "-p",
    "zeter-ai-worker",
    "--bin",
    "zeter-ai-worker",
    "--bin",
    "zeter-ai-fixture-worker",
  ]);

  const targetTriple = "x86_64-pc-windows-msvc";
  const worker = path.join(TARGET, targetTriple, "debug", "zeter-ai-worker.exe");
  const fixtureWorker = path.join(
    TARGET,
    targetTriple,
    "debug",
    "zeter-ai-fixture-worker.exe",
  );
  if (!existsSync(worker) || !existsSync(fixtureWorker)) {
    throw new Error("Task 19 expected AI worker binaries were not produced");
  }

  copyFileSync(ffmpeg, path.join(RUNTIME, "ffmpeg.exe"));
  copyFileSync(ffprobe, path.join(RUNTIME, "ffprobe.exe"));
  copyFileSync(fixtureWorker, path.join(RUNTIME, "whisper-cli.exe"));
  copyFileSync(worker, path.join(RUNTIME, "zeter-ai-worker.exe"));

  const mediaDir = path.join(FIXTURES, "media");
  exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(REPO, "tests", "fixtures", "media", "generate-synthetic.ps1"),
      "-RuntimeDir",
      ffmpegDir,
      "-OutputDir",
      mediaDir,
    ],
    REPO,
  );

  const importProjectPath = path.join(FIXTURES, "task19-import.vcut");
  const workflowProjectPath = path.join(FIXTURES, "task19-workflow.vcut");
  const recoveryProjectPath = path.join(FIXTURES, "task19-recovery.vcut");
  copyFileSync(PROJECT_TEMPLATE, importProjectPath);
  copyFileSync(PROJECT_TEMPLATE, recoveryProjectPath);
  createWorkflowProject(mediaDir, workflowProjectPath);

  const port = await freePort();
  const webviewDataDir = path.join(E2E_ROOT, "webview-data");
  const e2eConfig = path.join(E2E_ROOT, "tauri.e2e.conf.json");
  writeFileSync(
    e2eConfig,
    JSON.stringify(
      {
        app: {
          windows: [
            {
              label: "main",
              title: "Zeter Video Editor",
              width: 1440,
              height: 900,
              minWidth: 1100,
              minHeight: 700,
              resizable: true,
              dataDirectory: webviewDataDir,
              additionalBrowserArgs:
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection " +
                "--autoplay-policy=no-user-gesture-required " +
                `--remote-debugging-port=${port}`,
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  exec(
    "npm.cmd",
    [
      "run",
      "tauri",
      "--",
      "build",
      "--debug",
      "--no-bundle",
      "--config",
      e2eConfig,
    ],
    DESKTOP,
  );

  const app = path.join(TARGET, targetTriple, "debug", "zeter-desktop-tauri.exe");
  if (!existsSync(app)) {
    throw new Error("Task 19 expected Tauri E2E debug binary was not produced");
  }

  const child = spawn(app, [], {
    cwd: path.dirname(app),
    env: {
      ...process.env,
      ZETER_MANAGED_RUNTIME_DIR: RUNTIME,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 32_000) stderr = stderr.slice(-32_000);
  });
  child.on("exit", () => {
    if (stderr) {
      writeFileSync(path.join(E2E_ROOT, "app-stderr.log"), stderr);
    }
  });

  writeFileSync(
    STATE,
    JSON.stringify(
      {
        pid: child.pid,
        port,
        app,
        runtimeDir: RUNTIME,
        fixtureWorker,
        projectPath: importProjectPath,
        importProjectPath,
        workflowProjectPath,
        recoveryProjectPath,
        mediaDir,
      },
      null,
      2,
    ),
  );

  await waitForCdp(port, child);
}
