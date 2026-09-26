/**
 * Video Stream Tab — embedded in the MusicBots page.
 * Controls video streaming: source input, quality preset, start/stop,
 * live WebRTC preview, and viewer management.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { VideoPlayer } from './VideoPlayer';
import { useSongs } from '@/hooks/use-music-library';
import {
  useVideoStreamStatus,
  useStartVideoStream,
  useStopVideoStream,
  useSetStreamSource,
  useKickVideoViewer,
  useQueueVideo,
  useDequeueVideo,
  useSkipVideo,
} from '@/hooks/use-music-bots';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { settingsApi, type StreamPreset, type StreamDefaults } from '@/api/settings.api';
import type { VideoQueueItem } from '@/api/music.api';
import type { SongInfo } from '@ts6/common';
import { fileBasename } from '@/lib/utils';

// Mirrors the server's own preset table, used until the real one arrives (and
// for anyone who can't read the settings endpoint, which is admin-only).
const FALLBACK_PRESETS: StreamPreset[] = [
  { name: '480p', label: '480p', width: 854, height: 480, framerate: 30, bitrate: '1500k' },
  { name: '720p', label: '720p', width: 1280, height: 720, framerate: 60, bitrate: '4000k' },
  { name: '1080p', label: '1080p', width: 1920, height: 1080, framerate: 60, bitrate: '6000k' },
];

const FALLBACK_DEFAULTS: StreamDefaults = { preset: '1080p', framerate: 60, bitrate: '6000k', volume: 10 };

const FPS_OPTIONS = [24, 30, 60];

interface VideoStreamTabProps {
  botId: number;
  botStatus: string;
  serverConfigId: number;
}

export function VideoStreamTab({ botId, botStatus, serverConfigId }: VideoStreamTabProps) {
  const [sourceUrl, setSourceUrl] = useState('');

  // Starts from whatever an admin configured under Settings -> Streaming, so
  // this form and !stream agree, and stays on the shipped values if that
  // endpoint isn't readable for this user.
  const { data: configured } = useQuery({
    queryKey: ['stream-defaults'],
    queryFn: settingsApi.getStreamDefaults,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const presets = configured?.presets ?? FALLBACK_PRESETS;
  const [quality, setQuality] = useState<StreamDefaults | null>(null);
  const active: StreamDefaults = quality ?? (configured
    ? { preset: configured.preset, framerate: configured.framerate, bitrate: configured.bitrate, volume: configured.volume }
    : FALLBACK_DEFAULTS);

  // A preset carries its frame rate and bitrate with it; both stay editable.
  const pickPreset = (p: StreamPreset) =>
    setQuality({ ...active, preset: p.name, framerate: p.framerate, bitrate: p.bitrate });

  const { data: videoLibrary } = useSongs(serverConfigId, 'video');

  const { data: streamStatus } = useVideoStreamStatus(botId);
  const startStream = useStartVideoStream();
  const stopStream = useStopVideoStream();
  const setSource = useSetStreamSource();
  const kickViewer = useKickVideoViewer();
  const queueVideo = useQueueVideo();
  const dequeueVideo = useDequeueVideo();
  const skipVideo = useSkipVideo();

  const isStreaming = streamStatus?.streaming ?? false;
  const queue: VideoQueueItem[] = streamStatus?.queue ?? [];
  const nowPlaying: VideoQueueItem | null = streamStatus?.nowPlaying ?? null;
  const isBotConnected = botStatus === 'connected' || botStatus === 'playing' || botStatus === 'paused';

  const handleStart = () => {
    if (!sourceUrl.trim()) return;
    startStream.mutate({
      botId,
      source: sourceUrl.trim(),
      preset: active.preset,
      framerate: active.framerate,
      bitrate: active.bitrate.trim(),
    });
  };

  const handleStop = () => {
    stopStream.mutate(botId);
  };

  // Two deliberately separate actions: cutting the current video off for
  // everyone watching is not the same decision as lining one up behind it.
  // In chat, !stream does the second; here you choose.
  const handleChangeSource = () => {
    if (!sourceUrl.trim()) return;
    setSource.mutate({ botId, source: sourceUrl.trim() }, { onSuccess: () => setSourceUrl('') });
  };

  const handleQueue = () => {
    if (!sourceUrl.trim()) return;
    queueVideo.mutate(
      { botId, source: sourceUrl.trim(), title: sourceUrl.trim() },
      { onSuccess: () => setSourceUrl('') },
    );
  };

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      {/* Stream Controls */}
      <Card className="card-hero">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Video Stream</CardTitle>
            {isStreaming && (
              <Badge variant="destructive" className="gap-1">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                LIVE
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isBotConnected && (
            <p className="text-sm text-muted-foreground">
              Bot must be connected to start video streaming.
            </p>
          )}

          {isBotConnected && (
            <>
              <div className="space-y-2">
                <Label>Source URL</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://youtube.com/watch?v=... or direct video URL"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    disabled={startStream.isPending}
                  />
                  {isStreaming ? (
                    <>
                      <Button
                        onClick={handleQueue}
                        disabled={!sourceUrl.trim() || queueVideo.isPending}
                        variant="outline"
                        className="shrink-0"
                        title="Play it after the current video"
                      >
                        Queue
                      </Button>
                      <Button
                        onClick={handleChangeSource}
                        disabled={!sourceUrl.trim() || setSource.isPending}
                        variant="outline"
                        className="shrink-0"
                        title="Switch the running stream over right now"
                      >
                        Switch now
                      </Button>
                    </>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  YouTube, direct video URLs (MP4, HLS), or local file paths
                </p>
                {videoLibrary && videoLibrary.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <Label className="text-xs text-muted-foreground shrink-0">Or pick from the library:</Label>
                    <Select
                      value=""
                      onValueChange={(name) => setSourceUrl(name)}
                      disabled={startStream.isPending}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Choose an uploaded video..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(videoLibrary as SongInfo[]).map((song) => (
                          <SelectItem key={song.id} value={fileBasename(song.filePath)}>{song.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {!isStreaming && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Quality Preset</Label>
                    <div className="flex gap-2">
                      {presets.map((p) => (
                        <Button
                          key={p.name}
                          variant={active.preset === p.name ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => pickPreset(p)}
                          title={`${p.width}x${p.height}, ${p.framerate} FPS, ${p.bitrate}`}
                        >
                          {p.name}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Frame Rate (FPS)</Label>
                    <div className="flex gap-2">
                      {FPS_OPTIONS.map((fps) => (
                        <Button
                          key={fps}
                          variant={active.framerate === fps ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setQuality({ ...active, framerate: fps })}
                        >
                          {fps} FPS
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Video Bitrate</Label>
                    <Input
                      value={active.bitrate}
                      onChange={(e) => setQuality({ ...active, bitrate: e.target.value })}
                      placeholder="e.g. 1500k, 4000k, 6000k"
                    />
                    <p className="text-xs text-muted-foreground">
                      Higher needs more upload bandwidth and CPU. Examples: 1500k, 4000k, 6000k, 8000k
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                {!isStreaming ? (
                  <Button
                    onClick={handleStart}
                    disabled={!sourceUrl.trim() || startStream.isPending}
                  >
                    {startStream.isPending ? 'Starting...' : 'Start Stream'}
                  </Button>
                ) : (
                  <Button
                    onClick={handleStop}
                    variant="destructive"
                    disabled={stopStream.isPending}
                  >
                    {stopStream.isPending ? 'Stopping...' : 'Stop Stream'}
                  </Button>
                )}
              </div>

              {(startStream.isError || stopStream.isError || setSource.isError) && (
                <p className="text-sm text-red-500">
                  {(startStream.error as any)?.message ||
                    (stopStream.error as any)?.message ||
                    (setSource.error as any)?.message}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Queue */}
      {isStreaming && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Up Next</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => skipVideo.mutate(botId)}
                disabled={skipVideo.isPending}
                title={queue.length > 0 ? 'Play the next video now' : 'Nothing queued - this stops the stream'}
              >
                Skip
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline gap-2">
              <Badge variant="secondary" className="shrink-0">Now</Badge>
              <span className="text-sm truncate" title={nowPlaying?.title}>
                {nowPlaying?.title ?? streamStatus?.source ?? 'unknown'}
              </span>
            </div>

            {queue.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing queued. Paste a URL above and choose <strong>Queue</strong> to line one up —
                <code className="mx-1 text-[11px]">!stream &lt;url&gt;</code> in chat does the same
                while a stream is running.
              </p>
            ) : (
              <ul className="space-y-1">
                {queue.map((item, i) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {i + 2}.
                    </span>
                    <span className="flex-1 truncate" title={item.title}>{item.title}</span>
                    {item.requestedBy && (
                      <span className="shrink-0 text-xs text-muted-foreground">{item.requestedBy}</span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 h-7 px-2 text-xs"
                      onClick={() => dequeueVideo.mutate({ botId, itemId: item.id })}
                      disabled={dequeueVideo.isPending}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Live Preview */}
      {isBotConnected && (
        <Card className="card-hero">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Live Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <VideoPlayer botId={botId} streaming={isStreaming} />
            {isStreaming && streamStatus && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>Preset: <strong>{streamStatus.preset}</strong></span>
                <span>FPS: <strong>{streamStatus.framerate}</strong></span>
                <span>Bitrate: <strong>{streamStatus.bitrate}</strong></span>
                <span title="Set under Settings -> Streaming; viewers can still turn their own player up">
                  Volume: <strong>{streamStatus.volume}%</strong>
                </span>
                {streamStatus.source && (
                  <span className="truncate max-w-xs">
                    Source: <strong>{streamStatus.source}</strong>
                  </span>
                )}
                {streamStatus.startedAt && (
                  <span>
                    Uptime: <strong>{formatDuration(Date.now() - streamStatus.startedAt)}</strong>
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Viewers */}
      {isStreaming && streamStatus && (
        <Card className="card-hero">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Viewers ({streamStatus.viewerCount})
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {streamStatus.viewers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No viewers connected</p>
            ) : (
              <div className="space-y-2">
                {streamStatus.viewers.map((viewer: any) => {
                  const duration = Math.floor((Date.now() - viewer.joinedAt) / 1000);
                  const mins = Math.floor(duration / 60);
                  const secs = duration % 60;
                  return (
                    <div
                      key={viewer.clid}
                      className="flex items-center justify-between py-1.5 px-3 rounded-sm bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          viewer.iceState === 'connected' ? 'bg-green-500' : 'bg-yellow-500'
                        }`} />
                        <span className="text-sm">Client #{viewer.clid}</span>
                        <span className="text-xs text-muted-foreground">
                          {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-red-500 hover:text-red-400"
                        onClick={() => kickViewer.mutate({ botId, clid: viewer.clid })}
                      >
                        Kick
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
