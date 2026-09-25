// === Music / Voice Bot Types ===

export type VoiceBotStatus = 'stopped' | 'starting' | 'connected' | 'playing' | 'paused' | 'error';

export interface MusicBotSummary {
  id: number;
  name: string;
  serverConfigId: number;
  serverConfig?: { id: number; name: string; host: string };
  nickname: string;
  serverPassword: string | null;
  defaultChannel: string | null;
  channelPassword: string | null;
  voicePort: number;
  volume: number;
  autoStart: boolean;
  descriptionTemplate: string | null;
  hasAvatar: boolean;
  status: VoiceBotStatus;
  nowPlaying: QueueItemInfo | null;
  createdAt: string;
}

export interface MusicBotDetail extends MusicBotSummary {
  updatedAt: string;
  playbackProgress: { position: number; duration: number } | null;
}

export interface CreateMusicBotRequest {
  name: string;
  serverConfigId: number;
  nickname?: string;
  serverPassword?: string;
  defaultChannel?: string;
  channelPassword?: string;
  voicePort?: number;
  volume?: number;
  autoStart?: boolean;
  descriptionTemplate?: string;
}

export interface UpdateMusicBotRequest {
  name?: string;
  nickname?: string;
  serverPassword?: string;
  defaultChannel?: string;
  channelPassword?: string;
  voicePort?: number;
  volume?: number;
  autoStart?: boolean;
  descriptionTemplate?: string;
}

// === Song Types ===

export interface SongInfo {
  id: number;
  title: string;
  artist: string | null;
  duration: number | null;
  filePath: string;
  source: 'local' | 'youtube' | 'url';
  sourceUrl: string | null;
  fileSize: number | null;
  mediaType: 'audio' | 'video';
  serverConfigId: number;
  createdAt: string;
}

export interface QueueItemInfo {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
  source: string;
  streamUrl?: string;
}

export type RepeatMode = 'off' | 'track' | 'queue';

export interface PlaybackState {
  status: VoiceBotStatus;
  nowPlaying: QueueItemInfo | null;
  position: number;
  duration: number;
  volume: number;
  queue: QueueItemInfo[];
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  isStreaming?: boolean;
}

// === Playlist Types ===

export interface PlaylistSummary {
  id: number;
  name: string;
  musicBotId: number | null;
  songCount: number;
  createdAt: string;
}

export interface PlaylistDetail extends PlaylistSummary {
  songs: (SongInfo & { position: number })[];
}

// === YouTube Types ===

export interface YouTubeSearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

// === Radio Station Types ===

export interface RadioStationInfo {
  id: number;
  name: string;
  url: string;
  genre: string | null;
  imageUrl: string | null;
  serverConfigId: number;
}

export interface RadioPreset {
  name: string;
  url: string;
  genre: string;
}

export interface YouTubeUrlInfo {
  type: 'video' | 'playlist';
  items: YouTubeSearchResult[];
}

// === Video Streaming Types ===

export type VideoStreamPresetKey = '480p' | '720p' | '1080p';

export interface VideoStreamPreset {
  label: string;
  width: number;
  height: number;
  bitrate: string;
  framerate: number;
}

export interface VideoStreamStatus {
  streaming: boolean;
  streamId: string | null;
  source: string | null;
  preset: string;
  startedAt: number | null;
  viewerCount: number;
  viewers: VideoViewerInfo[];
  sidecar: { videoPort: number; audioPort: number } | null;
}

export interface VideoViewerInfo {
  clid: number;
  joinedAt: number;
  iceState: string;
}

export interface StartVideoStreamRequest {
  source: string;
  preset?: VideoStreamPresetKey;
}

export interface SetVideoSourceRequest {
  source: string;
}

// === Chat Command Permissions (DomeNinchen/ts6forkmanager#184) ===

/**
 * Every "!command" the MusicBot chat handler recognizes and can individually
 * restrict, by its canonical name - aliases that dispatch to the same
 * handler (e.g. !skip/!next) share one entry here and one permission row on
 * the backend (see COMMAND_ALIASES in voice/music-command-handler.ts). This
 * list is the single source of truth for the permissions UI; keep it in
 * sync with MUSIC_COMMANDS there when a command is added or removed.
 */
export const RESTRICTABLE_COMMANDS: { command: string; label: string }[] = [
  { command: 'play', label: '!play' },
  { command: 'stop', label: '!stop' },
  { command: 'pause', label: '!pause' },
  { command: 'skip', label: '!skip / !next' },
  { command: 'prev', label: '!prev' },
  { command: 'vol', label: '!vol / !volume' },
  { command: 'np', label: '!np / !nowplaying' },
  { command: 'queue', label: '!queue / !add' },
  { command: 'radio', label: '!radio' },
  { command: 'stream', label: '!stream' },
  { command: 'streamqueue', label: '!streamqueue' },
  { command: 'streamskip', label: '!streamskip' },
  { command: 'stopstream', label: '!stopstream' },
  { command: 'viewers', label: '!viewers' },
];

export interface BotCommandPermissionInfo {
  id: number;
  serverConfigId: number;
  command: string;
  allowedGroupIds: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommandPermissionsResponse {
  permissions: BotCommandPermissionInfo[];
  adminGroupIds: string[];
}
