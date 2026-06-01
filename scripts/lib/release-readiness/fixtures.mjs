export function buildPulseRecordingHandoffFixture(includeOutputReady) {
  const fixture = {
    schemaVersion: 1,
    requestId: "studio-recording-rec-smoke-1",
    sourceApp: "vaexcore-studio",
    sourceAppName: "vaexcore studio",
    targetApp: "vaexcore-pulse",
    requestedAt: "2026-05-06T12:00:00Z",
    recording: {
      sessionId: "rec_smoke",
      outputPath: "/tmp/rec_smoke.mkv",
      profileId: "profile_1080p",
      profileName: "1080p",
      captureMode: "display",
      captureDetail: "Main Display recorded as a source-backed display.",
      completionState: "completed",
      completionDetail:
        "FFmpeg stopped after a quit signal. Output passed recording verification.",
      verificationState: "verified",
      verificationDetail:
        "Recording file exists, is non-empty, and ffprobe metadata was read.",
      fileSizeBytes: 360093,
      durationMs: 2125,
      processStatus: "exit status: 0",
      stoppedAt: "2026-05-06T12:05:00Z",
    },
  };
  if (includeOutputReady) {
    fixture.outputReady = {
      ready: true,
      state: "ready",
      detail: "Scene output handoff is ready for Pulse intake.",
      activeSceneId: "scene-main",
      activeSceneName: "Main scene",
      programPreviewFrameReady: true,
      compositorRenderPlanReady: true,
      outputPreflightReady: true,
      mediaPipelineReady: true,
      blockers: [],
      warnings: [],
    };
  }
  return fixture;
}
