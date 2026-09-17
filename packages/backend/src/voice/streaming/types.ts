/**
 * Video streaming types and quality presets
 */

export interface VideoStreamPreset {
  label: string;
  width: number;
  height: number;
  bitrate: string;
  framerate: number;
}

export const STREAM_PRESETS: Record<string, VideoStreamPreset> = {
  '480p': { label: '480p', width: 854, height: 480, bitrate: '1500k', framerate: 30 },
  '720p': { label: '720p', width: 1280, height: 720, bitrate: '4000k', framerate: 60 },
  '1080p': { label: '1080p', width: 1920, height: 1080, bitrate: '6000k', framerate: 60 },
};

export const DEFAULT_PRESET = '1080p';

/**
 * One entry in a bot's video stream queue.
 *
 * The source is kept as a URL and only downloaded when its turn comes, so
 * queueing ten videos doesn't fetch ten files up front - and so a link that
 * has gone stale fails at the point where it can simply be skipped.
 */
export interface VideoQueueItem {
  id: string;
  /** What ffmpeg gets pointed at: a URL, or a local file. */
  source: string;
  /** What people see - the URL or the search terms as they were typed. */
  title: string;
  /** Who asked for it; absent when it was queued from the web interface. */
  requestedBy?: string;
}

export interface VideoViewerInfo {
  clid: number;
  joinedAt: number;
  iceState: string;
}

export interface VideoStreamStatus {
  streaming: boolean;
  streamId: string | null;
  source: string | null;
  preset: string;
  framerate: number;
  bitrate: string;
  /** Percent the source's audio is scaled by on the way out. */
  volume: number;
  startedAt: number | null;
  viewerCount: number;
  viewers: VideoViewerInfo[];
  nowPlaying: VideoQueueItem | null;
  queue: VideoQueueItem[];
  sidecar: { videoPort: number; audioPort: number } | null;
}
