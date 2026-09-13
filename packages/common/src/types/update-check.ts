// Update-check types — shared between backend (produces these) and frontend
// (consumes them, plus knows its own current version at build time via
// vite.config.ts's __APP_VERSION__ define, since the backend has no way to
// ask the frontend what it's currently serving).

export interface ComponentVersionStatus {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
}

export interface UpdateCheckResult {
  backend: ComponentVersionStatus;
  sidecar: ComponentVersionStatus;
  frontendLatest: string | null;
  checkedAt: string | null;
}
