import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { musicRequestsApi } from '@/api/music-requests.api';
import { musicBotsApi } from '@/api/music.api';
import {
  useMusicBots, useCreateMusicBot, useUpdateMusicBot, useDeleteMusicBot,
  useStartMusicBot, useStopMusicBot, useMusicBotState,
  usePlaySong, usePlayUrl, usePausePlayback, useResumePlayback, useStopPlayback,
  useSkipTrack, usePreviousTrack, useSeek, useSetVolume,
  useEnqueue, useLoadPlaylist, useRemoveFromQueue, useClearQueue,
  useSetShuffle, useSetRepeat,
  usePlayFromQueue, useMoveQueueItem,
  useDescriptionPlaceholders, useUploadBotAvatar, useDeleteBotAvatar,
  useVideoStreamStatus, useStartVideoStream, useSetStreamSource, useQueueVideo,
} from '@/hooks/use-music-bots';
import { useSongs, useUploadSong, useDeleteSong, useYouTubeSearch, useYouTubeDownload, useYouTubeInfo, useYouTubeDownloadBatch, useScanMusicLibrary } from '@/hooks/use-music-library';
import { useRadioStations, useRadioPresets, useCreateRadioStation, useDeleteRadioStation, usePlayRadio } from '@/hooks/use-radio-stations';
import { usePlaylists, usePlaylist, useCreatePlaylist, useDeletePlaylist, useAddSongToPlaylist, useRemoveSongFromPlaylist } from '@/hooks/use-playlists';
import { useServers } from '@/hooks/use-servers';
import { useServerStore } from '@/stores/server.store';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Music, Plus, Trash2, Play, Pause, SkipForward, SkipBack, Square,
  Volume2, VolumeX, Upload, Search, Download, ListMusic, Shuffle,
  Repeat, Repeat1, Power, PowerOff, RefreshCw, Pencil, X, Loader2,
  Film, FileAudio, Link, GripVertical, Music2, Radio, Clock,
  Video, ArrowUp, ArrowDown, ArrowUpDown, ImageIcon, UserRound, ShieldCheck,
} from 'lucide-react';
import { VideoStreamTab } from '@/components/video/VideoStreamTab';
import { toast } from 'sonner';
import { BotConnectionNotice, botFailureKindText } from '@/components/bots/BotConnectionNotice';
import { formatBytes, fileBasename } from '@/lib/utils';
import { settingsApi } from '@/api/settings.api';
import { RESTRICTABLE_COMMANDS, OPEN_BY_DEFAULT_COMMANDS } from '@ts6/common';
import type { MusicBotSummary, PlaybackState, SongInfo, PlaylistSummary, PlaylistDetail, YouTubeSearchResult, RadioStationInfo, RadioPreset, BotCommandPermissionInfo } from '@ts6/common';
import { Checkbox } from '@/components/ui/checkbox';
import { groupsApi } from '@/api/groups.api';
import {
  useCommandPermissions, useSetCommandPermission, useClearCommandPermission, useSetAdminGroups,
} from '@/hooks/use-command-permissions';
import { useTranslation } from 'react-i18next';

// ─── Helper ──────────────────────────────────────────────────────────────────

// Extensions that are only ever video (unlike e.g. .webm, which the backend
// treats as audio by default when uploaded - see media-dirs.ts), used to
// auto-pick the mediaType an upload is tagged with.
const VIDEO_ONLY_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m4v'];

function formatTime(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

const statusColors: Record<string, string> = {
  stopped: 'bg-zinc-500',
  starting: 'bg-amber-500 animate-pulse',
  connected: 'bg-emerald-500',
  playing: 'bg-emerald-500 animate-pulse',
  paused: 'bg-amber-500',
  error: 'bg-red-500',
};

// ─── Bot Player Card ─────────────────────────────────────────────────────────

function BotPlayerCard({ bot, onEdit, onDelete, onPlay }: {
  bot: MusicBotSummary;
  onEdit: () => void;
  onDelete: () => void;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  const startBot = useStartMusicBot();
  const stopBot = useStopMusicBot();
  const { data: state } = useMusicBotState(
    bot.status !== 'stopped' ? bot.id : null,
  ) as { data: PlaybackState | undefined };

  const pausePlayback = usePausePlayback();
  const resumePlayback = useResumePlayback();
  const stopPlayback = useStopPlayback();
  const skipTrack = useSkipTrack();
  const previousTrack = usePreviousTrack();
  const setVolume = useSetVolume();
  const seekMut = useSeek();
  const shuffleMut = useSetShuffle();
  const repeatMut = useSetRepeat();

  // Widget token dialog
  const [showWidget, setShowWidget] = useState(false);
  const [widgetData, setWidgetData] = useState<{ token: string; jsonUrl: string; bbcodeUrl: string } | null>(null);

  // Local drag state so sliders don't snap back during interaction
  const [draggingSeek, setDraggingSeek] = useState<number | null>(null);
  const [draggingVolume, setDraggingVolume] = useState<number | null>(null);

  // "Running" = connected to the server, so the playback controls make sense.
  // A bot that is still connecting or waiting for its next automatic attempt
  // only gets a Stop (to cancel the retries).
  const isRunning = bot.status === 'connected' || bot.status === 'playing' || bot.status === 'paused';
  const connection = bot.connection ?? null;
  const isTrying = !isRunning && (bot.status === 'starting' || connection?.phase === 'connecting' || connection?.phase === 'retrying');
  const dotClass = connection
    ? (connection.phase === 'failed' ? 'bg-red-500' : 'bg-amber-500 animate-pulse')
    : (statusColors[bot.status] || 'bg-zinc-500');
  const isPlaying = state?.status === 'playing';
  const isPaused = state?.status === 'paused';
  const isStreaming = state?.isStreaming ?? false;

  return (
    <Card className="card-hero group hover:border-primary/30 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
            <CardTitle className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium">
              <span className="min-w-0 truncate">{bot.name}</span>
              <span className="shrink-0 text-muted-foreground">#{bot.id}</span>
            </CardTitle>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" title={t('pages.musicBots.botPlayerCard.playerWidget')}
              onClick={() => {
                musicBotsApi.playerWidgetToken(bot.id).then(setWidgetData);
                setShowWidget(true);
              }}
            >
              <Link className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] capitalize">
            {connection ? t(`pages.musicBots.botPlayerCard.connection.badge.${connection.phase}`) : bot.status}
          </Badge>
          <Badge variant="outline" className="text-[10px]">{bot.nickname}</Badge>
          {bot.serverConfig && (
            <Badge variant="secondary" className="text-[10px]">{bot.serverConfig.name}</Badge>
          )}
        </div>

        {/* Connecting, waiting for the next attempt, or done trying - and why */}
        {connection && <BotConnectionNotice connection={connection} />}

        {/* Play button when connected but idle */}
        {isRunning && !state?.nowPlaying && (
          <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={onPlay}>
            <Play className="h-3.5 w-3.5 mr-1.5" /> {t('pages.musicBots.botPlayerCard.playSongEllipsis')}
          </Button>
        )}

        {/* Now Playing */}
        {state?.nowPlaying && (
          <div className="rounded-md bg-muted/50 p-2.5 space-y-2">
            <div className="flex items-center gap-2 min-w-0">
              {isStreaming ? <Radio className="h-3.5 w-3.5 text-red-500 shrink-0" /> : <Music2 className="h-3.5 w-3.5 text-primary shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{state.nowPlaying.title}</p>
                {state.nowPlaying.artist && (
                  <p className="text-[10px] text-muted-foreground truncate">{state.nowPlaying.artist}</p>
                )}
              </div>
              {isStreaming && (
                <Badge variant="destructive" className="text-[9px] shrink-0 animate-pulse">{t('pages.musicBots.botPlayerCard.live')}</Badge>
              )}
            </div>
            {/* Progress bar (hidden for streams) */}
            {!isStreaming && (
              <div className="space-y-1">
                <Slider
                  value={[draggingSeek ?? state.position ?? 0]}
                  max={state.duration || 1}
                  step={1}
                  onValueChange={([val]) => setDraggingSeek(val)}
                  onValueCommit={([val]) => { seekMut.mutate({ botId: bot.id, seconds: val }); setDraggingSeek(null); }}
                  className="cursor-pointer"
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{formatTime(draggingSeek ?? state.position)}</span>
                  <span>{formatTime(state.duration)}</span>
                </div>
              </div>
            )}
            {/* Controls */}
            <div className="flex items-center justify-center gap-1">
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => shuffleMut.mutate({ botId: bot.id, enabled: !state.shuffle })}
              >
                <Shuffle className={`h-3.5 w-3.5 ${state.shuffle ? 'text-primary' : ''}`} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => previousTrack.mutate(bot.id)}
              >
                <SkipBack className="h-3.5 w-3.5" />
              </Button>
              {isPlaying ? (
                <Button variant="outline" size="icon" className="h-8 w-8"
                  onClick={() => pausePlayback.mutate(bot.id)}
                >
                  <Pause className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="outline" size="icon" className="h-8 w-8"
                  onClick={() => resumePlayback.mutate(bot.id)}
                >
                  <Play className="h-4 w-4 ml-0.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => skipTrack.mutate(bot.id)}
              >
                <SkipForward className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => {
                  const modes = ['off', 'track', 'queue'] as const;
                  const idx = modes.indexOf(state.repeat);
                  repeatMut.mutate({ botId: bot.id, mode: modes[(idx + 1) % 3] });
                }}
              >
                {state.repeat === 'track' ? (
                  <Repeat1 className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Repeat className={`h-3.5 w-3.5 ${state.repeat === 'queue' ? 'text-primary' : ''}`} />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Volume */}
        {isRunning && (
          <div className="flex items-center gap-2">
            <VolumeX className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Slider
              value={[draggingVolume ?? state?.volume ?? bot.volume]}
              max={100}
              step={1}
              onValueChange={([val]) => setDraggingVolume(val)}
              onValueCommit={([val]) => { setVolume.mutate({ botId: bot.id, volume: val }); setDraggingVolume(null); }}
              className="flex-1"
            />
            <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground w-7 text-right">{draggingVolume ?? state?.volume ?? bot.volume}%</span>
          </div>
        )}

        {/* Queue preview - only what's still upcoming, matching the
            {queue_length} count in the bot's own TeamSpeak description;
            state.queue itself is the full history+upcoming array. */}
        {state?.queue && state.queue.length > state.currentIndex + 1 && (() => {
          const upcoming = state.queue.slice(state.currentIndex + 1);
          return (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">{t('pages.musicBots.botPlayerCard.queueCount', { count: upcoming.length })}</p>
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {upcoming.slice(0, 5).map((item, i) => (
                  <div key={item.id} className="flex items-center gap-2 text-[10px] py-0.5">
                    <span className="text-muted-foreground w-4 text-right">{i + 1}</span>
                    <span className="truncate flex-1">{item.title}</span>
                    <span className="text-muted-foreground">{formatTime(item.duration)}</span>
                  </div>
                ))}
                {upcoming.length > 5 && (
                  <p className="text-[10px] text-muted-foreground text-center">{t('pages.musicBots.botPlayerCard.moreCount', { count: upcoming.length - 5 })}</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Start/Stop */}
        <div className="flex items-center gap-1.5 pt-1">
          {isRunning ? (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs flex-1"
                onClick={() => stopBot.mutate(bot.id, { onSuccess: () => toast.success(t('pages.musicBots.botPlayerCard.botStopped')) })}
                disabled={stopBot.isPending}
              >
                <PowerOff className="h-3 w-3 mr-1" /> {t('pages.musicBots.botPlayerCard.stop')}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs"
                onClick={onPlay}
              >
                <Music2 className="h-3 w-3 mr-1" /> {t('pages.musicBots.botPlayerCard.playEllipsis')}
              </Button>
              {state?.nowPlaying && (
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => stopPlayback.mutate(bot.id)}
                >
                  <Square className="h-3 w-3 mr-1" /> {t('pages.musicBots.botPlayerCard.stopAudio')}
                </Button>
              )}
            </>
          ) : isTrying ? (
            <Button variant="outline" size="sm" className="h-7 text-xs flex-1"
              onClick={() => stopBot.mutate(bot.id, { onSuccess: () => toast.success(t('pages.musicBots.botPlayerCard.botStopped')) })}
              disabled={stopBot.isPending}
            >
              <PowerOff className="h-3 w-3 mr-1" /> {t('pages.musicBots.botPlayerCard.stop')}
            </Button>
          ) : (
            <Button variant="default" size="sm" className="h-7 text-xs flex-1"
              onClick={() => startBot.mutate(bot.id, {
                onSuccess: () => toast.success(t('pages.musicBots.botPlayerCard.botStarted')),
                onError: (err: any) => {
                  // Say WHY: the backend passes on the server's own words, and a
                  // code for the kind of refusal. "Failed to start bot" alone helps nobody.
                  const data = err?.response?.data;
                  const description = [botFailureKindText(t, data?.code), data?.error ?? err?.message]
                    .filter(Boolean)
                    .join(' ');
                  toast.error(t('pages.musicBots.botPlayerCard.startFailed'), { description: description || undefined });
                },
              })}
              disabled={startBot.isPending}
            >
              <Power className="h-3 w-3 mr-1" /> {t('pages.musicBots.botPlayerCard.start')}
            </Button>
          )}
        </div>
      </CardContent>

      {/* Player Widget Dialog */}
      <Dialog open={showWidget} onOpenChange={setShowWidget}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('pages.musicBots.botPlayerCard.playerWidget')}</DialogTitle>
            <DialogDescription className="text-xs">
              {t('pages.musicBots.botPlayerCard.widgetDescription')}
            </DialogDescription>
          </DialogHeader>
          {widgetData && (
            <div className="space-y-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">{t('pages.musicBots.botPlayerCard.bbcodeUrlLabel')}</Label>
                <div className="flex gap-1.5 mt-1">
                  <Input readOnly className="h-7 text-[11px] font-mono-data" value={widgetData.bbcodeUrl} />
                  <Button variant="outline" size="sm" className="h-7 text-xs shrink-0"
                    onClick={() => { navigator.clipboard.writeText(widgetData.bbcodeUrl); toast.success(t('pages.musicBots.botPlayerCard.copied')); }}
                  >{t('pages.musicBots.botPlayerCard.copy')}</Button>
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{t('pages.musicBots.botPlayerCard.jsonUrlLabel')}</Label>
                <div className="flex gap-1.5 mt-1">
                  <Input readOnly className="h-7 text-[11px] font-mono-data" value={widgetData.jsonUrl} />
                  <Button variant="outline" size="sm" className="h-7 text-xs shrink-0"
                    onClick={() => { navigator.clipboard.writeText(widgetData.jsonUrl); toast.success(t('pages.musicBots.botPlayerCard.copied')); }}
                  >{t('pages.musicBots.botPlayerCard.copy')}</Button>
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">{t('pages.musicBots.botPlayerCard.tokenLabel')}</Label>
                <Input readOnly className="h-7 text-[11px] font-mono-data mt-1" value={widgetData.token} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Play Song Dialog ─────────────────────────────────────────────────────────

function PlaySongDialog({ botId, onClose, onPlaySong, onPlayUrl, onQueueUrl, onEnqueue, onLoadPlaylist }: {
  botId: number | null;
  onClose: () => void;
  onPlaySong: (songId: number) => void;
  onPlayUrl: (url: string) => void;
  onQueueUrl: (url: string) => void;
  onEnqueue: (songId: number) => void;
  onLoadPlaylist: (playlistId: number) => void;
}) {
  const { t } = useTranslation();
  const { selectedConfigId } = useServerStore();
  const { data: servers } = useServers();
  const [serverId, setServerId] = useState<number | null>(selectedConfigId);
  const configId = serverId || selectedConfigId;
  const { data: songs } = useSongs(configId, 'audio');
  const { data: playlists } = usePlaylists();
  const { data: history = [] } = useQuery({
    queryKey: ['music-requests', configId],
    queryFn: () => musicRequestsApi.list(configId!),
    enabled: !!configId,
  });
  const [tab, setTab] = useState<'songs' | 'playlists' | 'history'>('songs');
  const [filter, setFilter] = useState('');

  const serverList = Array.isArray(servers) ? servers : [];
  const songList = (Array.isArray(songs) ? songs : []) as SongInfo[];
  const playlistList = (Array.isArray(playlists) ? playlists : []) as PlaylistSummary[];

  const filtered = filter
    ? songList.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()) || (s.artist || '').toLowerCase().includes(filter.toLowerCase()))
    : songList;

  return (
    <Dialog open={botId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('pages.musicBots.playSongDialog.title')}</DialogTitle>
          <DialogDescription>{t('pages.musicBots.playSongDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-2">
          <Button variant={tab === 'songs' ? 'default' : 'outline'} size="sm" className="h-7 text-xs"
            onClick={() => setTab('songs')}
          >
            <FileAudio className="h-3 w-3 mr-1" /> {t('pages.musicBots.playSongDialog.tabSongs')}
          </Button>
          <Button variant={tab === 'playlists' ? 'default' : 'outline'} size="sm" className="h-7 text-xs"
            onClick={() => setTab('playlists')}
          >
            <ListMusic className="h-3 w-3 mr-1" /> {t('pages.musicBots.playSongDialog.tabPlaylists')}
          </Button>
          <Button variant={tab === 'history' ? 'default' : 'outline'} size="sm" className="h-7 text-xs"
            onClick={() => setTab('history')}
          >
            <Clock className="h-3 w-3 mr-1" /> {t('pages.musicBots.playSongDialog.tabHistory')}
          </Button>
          <div className="flex-1" />
          {tab === 'songs' && (
            <Select value={String(configId || '')} onValueChange={(v) => setServerId(parseInt(v))}>
              <SelectTrigger className="w-36 h-7 text-xs"><SelectValue placeholder={t('pages.musicBots.shared.serverPlaceholder')} /></SelectTrigger>
              <SelectContent>
                {serverList.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {tab === 'songs' && (
          <>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('pages.musicBots.shared.filterSongsPlaceholder')}
              className="h-8 text-xs"
            />
            <div className="flex-1 max-h-[400px] mt-2 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">{t('pages.musicBots.playSongDialog.noSongsFound')}</p>
              ) : filtered.map((song) => (
                <div key={song.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/30 transition-colors rounded-sm group">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{song.title}</p>
                    {song.artist && <p className="text-[10px] text-muted-foreground truncate">{song.artist}</p>}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(song.duration)}</span>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="default" size="sm" className="h-6 text-[10px] px-2"
                      onClick={() => onPlaySong(song.id)}
                    >
                      <Play className="h-3 w-3 mr-0.5" /> {t('pages.musicBots.playSongDialog.play')}
                    </Button>
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2"
                      onClick={() => onEnqueue(song.id)}
                    >
                      <Plus className="h-3 w-3 mr-0.5" /> {t('pages.musicBots.playSongDialog.queue')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'playlists' && (
          <div className="flex-1 max-h-[400px] overflow-y-auto">
            {playlistList.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">{t('pages.musicBots.playSongDialog.noPlaylists')}</p>
            ) : playlistList.map((pl) => (
              <div key={pl.id} className="flex items-center gap-2 py-2 px-2 hover:bg-muted/30 transition-colors rounded-sm group">
                <ListMusic className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{pl.name}</p>
                  <p className="text-[10px] text-muted-foreground">{t('pages.musicBots.shared.songsCount', { count: pl.songCount })}</p>
                </div>
                <Button variant="default" size="sm" className="h-6 text-[10px] px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onLoadPlaylist(pl.id)}
                >
                  <Play className="h-3 w-3 mr-0.5" /> {t('pages.musicBots.playSongDialog.loadAndPlay')}
                </Button>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div className="flex-1 max-h-[400px] overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">{t('pages.musicBots.playSongDialog.noHistory')}</p>
            ) : history.map((req: any) => (
              <div key={req.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/30 transition-colors rounded-sm group">
                <Music2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate" title={req.title}>{req.title}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="default" size="sm" className="h-6 text-[10px] px-2"
                    onClick={() => onPlayUrl(req.url)}
                    title={t('pages.musicBots.playSongDialog.playNowHint')}
                  >
                    <Play className="h-3 w-3 mr-0.5" /> {t('pages.musicBots.playSongDialog.play')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2"
                    onClick={() => onQueueUrl(req.url)}
                    title={t('pages.musicBots.playSongDialog.queueAfterHint')}
                  >
                    <Plus className="h-3 w-3 mr-0.5" /> {t('pages.musicBots.playSongDialog.queue')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>{t('pages.musicBots.playSongDialog.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Avatar Picker ───────────────────────────────────────────────────────────
// Shows the bot's current avatar (fetched as an authenticated blob - the route
// requires admin auth, so a plain <img src> can't be used), a freshly picked
// local file before it's uploaded, or a placeholder icon.

function AvatarPicker({ botId, hasAvatar, localFile, onPick, onRemove }: {
  botId: number | null;
  hasAvatar: boolean;
  localFile: File | null;
  onPick: (file: File | null) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const localUrl = localFile ? URL.createObjectURL(localFile) : null;

  useEffect(() => {
    if (localFile || !botId || !hasAvatar) { setRemoteUrl(null); return; }
    let revoke: string | null = null;
    musicBotsApi.avatarBlob(botId).then((blob) => {
      const url = URL.createObjectURL(blob);
      revoke = url;
      setRemoteUrl(url);
    }).catch(() => setRemoteUrl(null));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [botId, hasAvatar, localFile]);

  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  const previewUrl = localUrl || remoteUrl;

  return (
    <div className="flex items-center gap-3">
      <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center overflow-hidden border">
        {previewUrl ? (
          <img src={previewUrl} alt={t('pages.musicBots.avatarPicker.alt')} className="h-full w-full object-cover" />
        ) : (
          <UserRound className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <ImageIcon className="h-3.5 w-3.5 mr-1" /> {previewUrl ? t('pages.musicBots.avatarPicker.change') : t('pages.musicBots.avatarPicker.upload')}
          </Button>
          {previewUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { onRemove(); onPick(null); }}>
              <X className="h-3.5 w-3.5 mr-1" /> {t('pages.musicBots.avatarPicker.remove')}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{t('pages.musicBots.avatarPicker.sizeHint')}</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

// ─── Bots Tab ────────────────────────────────────────────────────────────────

function BotsTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useMusicBots();
  const { data: servers } = useServers();
  const { selectedConfigId } = useServerStore();
  const createBot = useCreateMusicBot();
  const updateBot = useUpdateMusicBot();
  const deleteBot = useDeleteMusicBot();
  const playSong = usePlaySong();
  const playUrl = usePlayUrl();
  const enqueueSong = useEnqueue();
  const loadPlaylist = useLoadPlaylist();
  const uploadAvatar = useUploadBotAvatar();
  const deleteAvatar = useDeleteBotAvatar();
  const { data: placeholders } = useDescriptionPlaceholders();

  const [showCreate, setShowCreate] = useState(false);
  const [editBot, setEditBot] = useState<MusicBotSummary | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showPlayDialog, setShowPlayDialog] = useState<number | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);

  // Create form
  const [form, setForm] = useState({
    name: '', serverConfigId: '', nickname: 'MusicBot', serverPassword: '', defaultChannel: '', channelPassword: '', voicePort: 9987, volume: 50, autoStart: false, descriptionTemplate: '',
    autoplayMode: 'none' as 'none' | 'song' | 'radio', autoplaySongId: '', autoplayRadioStationId: '',
  });

  const bots = Array.isArray(data) ? data : [];
  const serverList = Array.isArray(servers) ? servers : [];

  // Scoped to whichever server this bot belongs to (or is being created for),
  // for the autoplay song/station pickers below.
  const autoplayServerConfigId = editBot ? editBot.serverConfigId : (parseInt(form.serverConfigId) || null);
  const { data: autoplaySongs } = useSongs(autoplayServerConfigId);
  const { data: autoplayStations } = useRadioStations(autoplayServerConfigId);

  if (isLoading) return <PageLoader />;

  const handleCreate = () => {
    const configId = parseInt(form.serverConfigId);
    if (!configId) { toast.error(t('pages.musicBots.botsTab.selectServerError')); return; }
    createBot.mutate({
      name: form.name,
      serverConfigId: configId,
      nickname: form.nickname || 'MusicBot',
      serverPassword: form.serverPassword || undefined,
      defaultChannel: form.defaultChannel || undefined,
      channelPassword: form.channelPassword || undefined,
      voicePort: form.voicePort,
      volume: form.volume,
      autoStart: form.autoStart,
      descriptionTemplate: form.descriptionTemplate || undefined,
      autoplayMode: form.autoplayMode,
      autoplaySongId: form.autoplayMode === 'song' && form.autoplaySongId ? parseInt(form.autoplaySongId) : undefined,
      autoplayRadioStationId: form.autoplayMode === 'radio' && form.autoplayRadioStationId ? parseInt(form.autoplayRadioStationId) : undefined,
    }, {
      onSuccess: (result: { id: number }) => {
        toast.success(t('pages.musicBots.botsTab.botCreated'));
        if (avatarFile) {
          uploadAvatar.mutate({ id: result.id, file: avatarFile }, {
            onSuccess: (r: { warning?: string }) => { if (r?.warning) toast.warning(r.warning); },
          });
        }
        setShowCreate(false);
        resetForm();
      },
      onError: () => toast.error(t('pages.musicBots.botsTab.createFailed')),
    });
  };

  const handleUpdate = () => {
    if (!editBot) return;
    updateBot.mutate({ id: editBot.id, data: {
      name: form.name,
      nickname: form.nickname,
      serverPassword: form.serverPassword || undefined,
      defaultChannel: form.defaultChannel || undefined,
      channelPassword: form.channelPassword || undefined,
      voicePort: form.voicePort,
      volume: form.volume,
      autoStart: form.autoStart,
      descriptionTemplate: form.descriptionTemplate || undefined,
      autoplayMode: form.autoplayMode,
      autoplaySongId: form.autoplayMode === 'song' && form.autoplaySongId ? parseInt(form.autoplaySongId) : undefined,
      autoplayRadioStationId: form.autoplayMode === 'radio' && form.autoplayRadioStationId ? parseInt(form.autoplayRadioStationId) : undefined,
    }}, {
      onSuccess: () => {
        toast.success(t('pages.musicBots.botsTab.botUpdated'));
        if (avatarFile) {
          uploadAvatar.mutate({ id: editBot.id, file: avatarFile }, {
            onSuccess: (r: { warning?: string }) => { if (r?.warning) toast.warning(r.warning); },
          });
        }
        else if (avatarRemoved) deleteAvatar.mutate(editBot.id);
        setEditBot(null);
      },
      onError: () => toast.error(t('pages.musicBots.botsTab.updateFailed')),
    });
  };

  const resetForm = () => {
    setForm({
      name: '', serverConfigId: '', nickname: 'MusicBot', serverPassword: '', defaultChannel: '', channelPassword: '', voicePort: 9987, volume: 50, autoStart: false, descriptionTemplate: '',
      autoplayMode: 'none', autoplaySongId: '', autoplayRadioStationId: '',
    });
    setAvatarFile(null);
    setAvatarRemoved(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('pages.musicBots.botsTab.botsCount', { count: bots.length })}</p>
        <Button size="sm" onClick={() => { resetForm(); setShowCreate(true); }}>
          <Plus className="h-4 w-4 mr-1" /> {t('pages.musicBots.botsTab.newBot')}
        </Button>
      </div>

      {bots.length === 0 ? (
        <EmptyState icon={Music} title={t('pages.musicBots.botsTab.noBotsYetTitle')} description={t('pages.musicBots.botsTab.noBotsYetDescription')} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bots.map((bot: MusicBotSummary) => (
            <BotPlayerCard
              key={bot.id}
              bot={bot}
              onEdit={() => {
                setForm({
                  name: bot.name,
                  serverConfigId: String(bot.serverConfigId),
                  nickname: bot.nickname,
                  serverPassword: bot.serverPassword || '',
                  defaultChannel: bot.defaultChannel || '',
                  channelPassword: bot.channelPassword || '',
                  voicePort: bot.voicePort ?? 9987,
                  volume: bot.volume,
                  autoStart: bot.autoStart,
                  descriptionTemplate: bot.descriptionTemplate || '',
                  autoplayMode: bot.autoplayMode,
                  autoplaySongId: bot.autoplaySongId != null ? String(bot.autoplaySongId) : '',
                  autoplayRadioStationId: bot.autoplayRadioStationId != null ? String(bot.autoplayRadioStationId) : '',
                });
                setAvatarFile(null);
                setAvatarRemoved(false);
                setEditBot(bot);
              }}
              onDelete={() => setDeleteId(bot.id)}
              onPlay={() => setShowPlayDialog(bot.id)}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={showCreate || editBot !== null} onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditBot(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editBot ? t('pages.musicBots.botsTab.editBotTitle') : t('pages.musicBots.botsTab.newBotTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-xs text-amber-500">
                {t('pages.musicBots.botsTab.avatarBugNoticePrefix')}{' '}
                <a href="https://github.com/teamspeak/teamspeak6-server/issues/122" target="_blank" rel="noreferrer" className="underline">{t('pages.musicBots.botsTab.reportedUpstream')}</a>.
              </p>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">{t('pages.musicBots.botsTab.avatarLabel')}</Label>
              <AvatarPicker
                botId={editBot?.id ?? null}
                hasAvatar={!!editBot?.hasAvatar && !avatarRemoved}
                localFile={avatarFile}
                onPick={(file) => { setAvatarFile(file); if (file) setAvatarRemoved(false); }}
                onRemove={() => setAvatarRemoved(true)}
              />
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.shared.name')}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('pages.musicBots.botsTab.namePlaceholder')} />
            </div>
            {!editBot && (
              <div>
                <Label className="text-xs">{t('pages.musicBots.botsTab.serverLabel')}</Label>
                <Select value={form.serverConfigId} onValueChange={(v) => setForm({ ...form, serverConfigId: v })}>
                  <SelectTrigger><SelectValue placeholder={t('pages.musicBots.botsTab.selectServerPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {serverList.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.host})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">{t('pages.musicBots.botsTab.voicePortLabel')}</Label>
              <Input type="number" value={form.voicePort} onChange={(e) => setForm({ ...form, voicePort: parseInt(e.target.value) || 9987 })} placeholder="9987" />
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.botsTab.nicknameLabel')}</Label>
              <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="MusicBot" />
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.botsTab.serverPasswordLabel')}</Label>
              <Input type="password" value={form.serverPassword} onChange={(e) => setForm({ ...form, serverPassword: e.target.value })} placeholder={t('pages.musicBots.botsTab.leaveEmptyIfNone')} />
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.botsTab.defaultChannelLabel')}</Label>
              <Input value={form.defaultChannel} onChange={(e) => setForm({ ...form, defaultChannel: e.target.value })} placeholder={t('pages.musicBots.botsTab.defaultChannelPlaceholder')} />
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.botsTab.channelPasswordLabel')}</Label>
              <Input type="password" value={form.channelPassword} onChange={(e) => setForm({ ...form, channelPassword: e.target.value })} placeholder={t('pages.musicBots.botsTab.leaveEmptyIfNone')} />
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.botsTab.volumeLabel', { percent: form.volume })}</Label>
              <Slider value={[form.volume]} max={100} step={1} onValueChange={([v]) => setForm({ ...form, volume: v })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.autoStart} onCheckedChange={(v) => setForm({ ...form, autoStart: v })} />
              <Label className="text-xs">{t('pages.musicBots.botsTab.autoStartLabel')}</Label>
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.botsTab.autoplayLabel')}</Label>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                {t('pages.musicBots.botsTab.autoplayHint')}
              </p>
              <Select
                value={form.autoplayMode}
                onValueChange={(v: 'none' | 'song' | 'radio') => setForm({ ...form, autoplayMode: v, autoplaySongId: '', autoplayRadioStationId: '' })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('pages.musicBots.botsTab.autoplayOff')}</SelectItem>
                  <SelectItem value="song">{t('pages.musicBots.botsTab.autoplaySong')}</SelectItem>
                  <SelectItem value="radio">{t('pages.musicBots.botsTab.autoplayRadio')}</SelectItem>
                </SelectContent>
              </Select>
              {form.autoplayMode === 'song' && (
                <Select value={form.autoplaySongId} onValueChange={(v) => setForm({ ...form, autoplaySongId: v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder={t('pages.musicBots.botsTab.chooseSongPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {((autoplaySongs as SongInfo[] | undefined) ?? [])
                      .filter((s) => s.mediaType === 'audio')
                      .map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.title}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
              {form.autoplayMode === 'radio' && (
                <Select value={form.autoplayRadioStationId} onValueChange={(v) => setForm({ ...form, autoplayRadioStationId: v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder={t('pages.musicBots.botsTab.chooseStationPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {((autoplayStations as RadioStationInfo[] | undefined) ?? []).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.botsTab.descriptionTemplateLabel')}</Label>
              <Textarea
                value={form.descriptionTemplate}
                onChange={(e) => setForm({ ...form, descriptionTemplate: e.target.value })}
                placeholder={t('pages.musicBots.botsTab.descriptionTemplatePlaceholder')}
                rows={2}
                className="text-sm"
              />
              {Array.isArray(placeholders) && placeholders.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {placeholders.map((p) => (
                    <p key={p.key} className="text-[11px] text-muted-foreground">
                      <code className="bg-muted px-1 rounded">{`{${p.key}}`}</code> — {p.description}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditBot(null); }}>{t('pages.musicBots.shared.cancel')}</Button>
            <Button
              onClick={editBot ? handleUpdate : handleCreate}
              disabled={
                !form.name || (!editBot && !form.serverConfigId) || createBot.isPending || updateBot.isPending
                || (form.autoplayMode === 'song' && !form.autoplaySongId)
                || (form.autoplayMode === 'radio' && !form.autoplayRadioStationId)
              }
            >
              {editBot ? t('pages.musicBots.botsTab.save') : t('pages.musicBots.shared.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
        title={t('pages.musicBots.botsTab.deleteBotTitle')}
        description={t('pages.musicBots.botsTab.deleteBotDescription')}
        onConfirm={() => {
          if (deleteId) deleteBot.mutate(deleteId, { onSuccess: () => { toast.success(t('pages.musicBots.botsTab.botDeleted')); setDeleteId(null); } });
        }}
        destructive
      />

      {/* Play Song Dialog */}
      <PlaySongDialog
        botId={showPlayDialog}
        onClose={() => setShowPlayDialog(null)}
        onPlaySong={(songId) => {
          if (showPlayDialog) {
            playSong.mutate({ botId: showPlayDialog, songId }, {
              onSuccess: () => { toast.success(t('pages.musicBots.botsTab.playing')); setShowPlayDialog(null); },
              onError: () => toast.error(t('pages.musicBots.botsTab.playSongFailed')),
            });
          }
        }}
        onPlayUrl={(url) => {
          if (showPlayDialog) {
            playUrl.mutate({ botId: showPlayDialog, url, mode: 'now' }, {
              onSuccess: () => { toast.success(t('pages.musicBots.botsTab.playingUrl')); setShowPlayDialog(null); },
              onError: () => toast.error(t('pages.musicBots.botsTab.playUrlFailed')),
            });
          }
        }}
        onQueueUrl={(url) => {
          if (showPlayDialog) {
            playUrl.mutate({ botId: showPlayDialog, url, mode: 'queue' }, {
              // Queueing into silence starts playback instead, so say which
              // of the two actually happened rather than always claiming one.
              onSuccess: (res) => toast.success(
                res?.queued ? t('pages.musicBots.botsTab.addedToQueuePosition', { position: res.position }) : t('pages.musicBots.botsTab.playingUrl'),
              ),
              onError: () => toast.error(t('pages.musicBots.botsTab.queueUrlFailed')),
            });
          }
        }}
        onEnqueue={(songId) => {
          if (showPlayDialog) {
            enqueueSong.mutate({ botId: showPlayDialog, songId }, {
              onSuccess: () => toast.success(t('pages.musicBots.botsTab.addedToQueue')),
              onError: () => toast.error(t('pages.musicBots.botsTab.enqueueFailed')),
            });
          }
        }}
        onLoadPlaylist={(playlistId) => {
          if (showPlayDialog) {
            loadPlaylist.mutate({ botId: showPlayDialog, playlistId, clearFirst: true }, {
              onSuccess: () => { toast.success(t('pages.musicBots.botsTab.playlistLoaded')); setShowPlayDialog(null); },
              onError: () => toast.error(t('pages.musicBots.botsTab.loadPlaylistFailed')),
            });
          }
        }}
      />
    </div>
  );
}

// ─── Library Tab ─────────────────────────────────────────────────────────────

function LibraryTab() {
  const { t } = useTranslation();
  const { selectedConfigId } = useServerStore();
  const { data: servers } = useServers();
  const [libServerId, setLibServerId] = useState<number | null>(selectedConfigId);
  const configId = libServerId || selectedConfigId;

  const { data: songs, isLoading, isFetching } = useSongs(configId);
  const uploadSong = useUploadSong();
  const deleteSong = useDeleteSong();
  const scanLibrary = useScanMusicLibrary();
  const ytSearch = useYouTubeSearch();
  const ytDownload = useYouTubeDownload();

  const ytInfo = useYouTubeInfo();
  const ytBatchDownload = useYouTubeDownloadBatch();

  const { data: bots } = useMusicBots();
  const runningBots = (Array.isArray(bots) ? bots : []).filter(
    (b: MusicBotSummary) => b.status !== 'stopped' && b.status !== 'error'
  );
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null);
  // Auto-select first running bot
  useEffect(() => {
    if (!selectedBotId && runningBots.length > 0) {
      setSelectedBotId(runningBots[0].id);
    }
  }, [runningBots, selectedBotId]);

  const playSong = usePlaySong();
  const enqueueSong = useEnqueue();
  const { data: streamStatus } = useVideoStreamStatus(selectedBotId);
  const isStreaming = streamStatus?.streaming ?? false;
  // Same admin-configured quality defaults the Video tab's own Start button uses.
  const { data: streamDefaults } = useQuery({
    queryKey: ['stream-defaults'],
    queryFn: settingsApi.getStreamDefaults,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const startStream = useStartVideoStream();
  const setStreamSource = useSetStreamSource();
  const queueVideo = useQueueVideo();

  const handlePlaySong = (song: SongInfo) => {
    if (!selectedBotId) return;
    playSong.mutate({ botId: selectedBotId, songId: song.id }, {
      onSuccess: () => toast.success(t('pages.musicBots.libraryTab.playingTitle', { title: song.title })),
      onError: () => toast.error(t('pages.musicBots.botsTab.playSongFailed')),
    });
  };

  const handleEnqueueSong = (song: SongInfo) => {
    if (!selectedBotId) return;
    enqueueSong.mutate({ botId: selectedBotId, songId: song.id }, {
      onSuccess: () => toast.success(t('pages.musicBots.libraryTab.addedToQueueTitle', { title: song.title })),
      onError: () => toast.error(t('pages.musicBots.libraryTab.addToQueueFailed')),
    });
  };

  // "Stream" doubles as Play-now for video: switch the live source if one is
  // already running, otherwise start a fresh stream - mirrors the Video tab's
  // own Queue/Switch-now split.
  const handleStreamVideo = (song: SongInfo) => {
    if (!selectedBotId) return;
    const source = fileBasename(song.filePath);
    if (isStreaming) {
      setStreamSource.mutate({ botId: selectedBotId, source }, {
        onSuccess: () => toast.success(t('pages.musicBots.libraryTab.switchedStreamTo', { title: song.title })),
        onError: () => toast.error(t('pages.musicBots.libraryTab.switchStreamFailed')),
      });
    } else {
      startStream.mutate({
        botId: selectedBotId,
        source,
        preset: streamDefaults?.preset,
        framerate: streamDefaults?.framerate,
        bitrate: streamDefaults?.bitrate,
      }, {
        onSuccess: () => toast.success(t('pages.musicBots.libraryTab.streamingTitle', { title: song.title })),
        onError: () => toast.error(t('pages.musicBots.libraryTab.startStreamFailed')),
      });
    }
  };

  const handleQueueVideo = (song: SongInfo) => {
    if (!selectedBotId) return;
    queueVideo.mutate({ botId: selectedBotId, source: fileBasename(song.filePath), title: song.title }, {
      onSuccess: () => toast.success(t('pages.musicBots.libraryTab.addedToStreamQueue', { title: song.title })),
      onError: () => toast.error(t('pages.musicBots.libraryTab.addToStreamQueueFailed')),
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [ytResults, setYtResults] = useState<YouTubeSearchResult[]>([]);
  const [showYt, setShowYt] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'audio' | 'video'>('all');
  const [sortBy, setSortBy] = useState<'title' | 'type' | 'duration'>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [ytUrl, setYtUrl] = useState('');
  const [urlInfo, setUrlInfo] = useState<{ type: 'video' | 'playlist'; items: YouTubeSearchResult[] } | null>(null);
  const [selectedUrlIds, setSelectedUrlIds] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  const serverList = Array.isArray(servers) ? servers : [];
  const songList = (Array.isArray(songs) ? songs : []) as SongInfo[];
  const byType = typeFilter === 'all' ? songList : songList.filter((s) => s.mediaType === typeFilter);
  const filtered = filter
    ? byType.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()) || (s.artist || '').toLowerCase().includes(filter.toLowerCase()))
    : byType;
  const sorted = [...filtered].sort((a, b) => {
    let cmp: number;
    if (sortBy === 'duration') {
      cmp = (a.duration ?? 0) - (b.duration ?? 0);
    } else if (sortBy === 'type') {
      cmp = a.mediaType.localeCompare(b.mediaType) || a.title.localeCompare(b.title);
    } else {
      cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (column: 'title' | 'type' | 'duration') => {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !configId) return;
    Array.from(files).forEach((file) => {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const mediaType = VIDEO_ONLY_EXTENSIONS.includes(ext) ? 'video' : 'audio';
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', mediaType);
      uploadSong.mutate({ configId, formData }, {
        onSuccess: () => toast.success(t('pages.musicBots.libraryTab.uploadedFile', { name: file.name })),
        onError: () => toast.error(t('pages.musicBots.libraryTab.uploadFileFailed', { name: file.name })),
      });
    });
    e.target.value = '';
  };

  const handleYtSearch = () => {
    if (!searchQuery.trim() || !configId) return;
    ytSearch.mutate({ configId, query: searchQuery }, {
      onSuccess: (data: any) => {
        setYtResults(Array.isArray(data) ? data : data?.results || []);
        setShowYt(true);
      },
      onError: () => toast.error(t('pages.musicBots.libraryTab.youtubeSearchFailed')),
    });
  };

  const handleYtDownload = (url: string) => {
    if (!configId) return;
    ytDownload.mutate({ configId, url }, {
      onSuccess: () => toast.success(t('pages.musicBots.libraryTab.downloadStarted')),
      onError: () => toast.error(t('pages.musicBots.libraryTab.downloadFailed')),
    });
  };

  const sourceIcon = (source: string) => {
    switch (source) {
      case 'youtube': return <Film className="h-3 w-3" />;
      case 'url': return <Link className="h-3 w-3" />;
      default: return <FileAudio className="h-3 w-3" />;
    }
  };

  const handleLoadUrl = () => {
    if (!ytUrl.trim() || !configId) return;
    ytInfo.mutate({ configId, url: ytUrl }, {
      onSuccess: (data: any) => {
        setUrlInfo(data);
        if (data.type === 'playlist') {
          setSelectedUrlIds(new Set(data.items.map((i: any) => i.id)));
        }
      },
      onError: () => toast.error(t('pages.musicBots.libraryTab.loadUrlInfoFailed')),
    });
  };

  const handleBatchDownload = () => {
    if (!configId || !urlInfo) return;
    const ids = Array.from(selectedUrlIds);
    const urls = ids.map((id) => `https://youtube.com/watch?v=${id}`);
    setBatchProgress(t('pages.musicBots.libraryTab.downloadingProgress', { done: 0, total: urls.length }));
    ytBatchDownload.mutate({ configId, urls }, {
      onSuccess: (data: any) => {
        setBatchProgress(null);
        toast.success(t('pages.musicBots.libraryTab.downloadedCount', { done: data.downloaded, total: data.total }));
        if (data.errors?.length) toast.error(t('pages.musicBots.libraryTab.failedCount', { count: data.errors.length }));
        setUrlInfo(null);
        setYtUrl('');
      },
      onError: () => { setBatchProgress(null); toast.error(t('pages.musicBots.libraryTab.batchDownloadFailed')); },
    });
  };

  const toggleUrlSelect = (id: string) => {
    setSelectedUrlIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!configId) {
    return <EmptyState icon={Music} title={t('pages.musicBots.libraryTab.selectServerTitle')} description={t('pages.musicBots.libraryTab.selectServerDescription')} />;
  }

  const typeFilterLabels: Record<'all' | 'audio' | 'video', string> = {
    all: t('pages.musicBots.libraryTab.filterAll'),
    audio: t('pages.musicBots.libraryTab.filterAudio'),
    video: t('pages.musicBots.libraryTab.filterVideo'),
  };

  return (
    <div className="space-y-4">
      {/* Server selector + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={String(configId)} onValueChange={(v) => setLibServerId(parseInt(v))}>
          <SelectTrigger className="w-48"><SelectValue placeholder={t('pages.musicBots.shared.serverPlaceholder')} /></SelectTrigger>
          <SelectContent>
            {serverList.map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {(['all', 'audio', 'video'] as const).map((typeKey) => (
            <Button
              key={typeKey}
              variant={typeFilter === typeKey ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs capitalize"
              onClick={() => setTypeFilter(typeKey)}
            >
              {typeKey === 'audio' && <FileAudio className="h-3 w-3 mr-1" />}
              {typeKey === 'video' && <Video className="h-3 w-3 mr-1" />}
              {typeFilterLabels[typeKey]}
            </Button>
          ))}
        </div>

        <Separator orientation="vertical" className="h-6" />

        <Label className="text-xs text-muted-foreground">{t('pages.musicBots.shared.playOn')}</Label>
        <Select
          value={selectedBotId ? String(selectedBotId) : ''}
          onValueChange={(v) => setSelectedBotId(parseInt(v))}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={runningBots.length === 0 ? t('pages.musicBots.shared.noRunningBots') : t('pages.musicBots.shared.selectBotPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {runningBots.map((b: MusicBotSummary) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('pages.musicBots.shared.filterSongsPlaceholder')}
          className="w-48"
        />
        <input ref={fileInputRef} type="file" accept="audio/*,video/*" multiple hidden onChange={handleUpload} />
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadSong.isPending}>
          <Upload className="h-4 w-4 mr-1" /> {uploadSong.isPending ? t('pages.musicBots.libraryTab.uploading') : t('pages.musicBots.libraryTab.upload')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!configId || scanLibrary.isPending}
          onClick={() => {
            if (!configId) return;
            scanLibrary.mutate(configId, {
              onSuccess: (result) => {
                const parts: string[] = [];
                if (result.added > 0) parts.push(t('pages.musicBots.libraryTab.foundNewFiles', { count: result.added }));
                if (result.healed > 0) parts.push(t('pages.musicBots.libraryTab.fixedTitles', { count: result.healed }));
                toast.success(parts.length > 0 ? parts.join(', ') : t('pages.musicBots.libraryTab.noNewFilesFound'));
              },
              onError: () => toast.error(t('pages.musicBots.libraryTab.scanFailed')),
            });
          }}
          title={t('pages.musicBots.libraryTab.scanHint')}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${scanLibrary.isPending ? 'animate-spin' : ''}`} /> {scanLibrary.isPending ? t('pages.musicBots.libraryTab.scanning') : t('pages.musicBots.libraryTab.scanForNewFiles')}
        </Button>
      </div>

      {/* YouTube URL / Playlist Paste */}
      <Card className="card-hero border-dashed">
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Link className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoadUrl()}
                placeholder={t('pages.musicBots.libraryTab.pasteUrlPlaceholder')}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleLoadUrl} disabled={ytInfo.isPending || !ytUrl.trim()}>
              {ytInfo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4 mr-1" />}
              {t('pages.musicBots.libraryTab.load')}
            </Button>
            {urlInfo && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setUrlInfo(null); setYtUrl(''); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* URL Info Results */}
          {urlInfo && (
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Badge variant="secondary" className="text-xs">
                  {urlInfo.type === 'playlist' ? t('pages.musicBots.libraryTab.playlistVideosCount', { count: urlInfo.items.length }) : t('pages.musicBots.libraryTab.singleVideo')}
                </Badge>
                {urlInfo.type === 'playlist' && (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]"
                      onClick={() => setSelectedUrlIds(new Set(urlInfo.items.map((i) => i.id)))}
                    >
                      {t('pages.musicBots.libraryTab.selectAll')}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]"
                      onClick={() => setSelectedUrlIds(new Set())}
                    >
                      {t('pages.musicBots.libraryTab.deselectAll')}
                    </Button>
                    <Button variant="default" size="sm" className="h-7 text-xs"
                      onClick={handleBatchDownload}
                      disabled={selectedUrlIds.size === 0 || ytBatchDownload.isPending}
                    >
                      {ytBatchDownload.isPending ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> {batchProgress || t('pages.musicBots.libraryTab.downloading')}</>
                      ) : (
                        <><Download className="h-3 w-3 mr-1" /> {t('pages.musicBots.libraryTab.downloadSelectedCount', { count: selectedUrlIds.size })}</>
                      )}
                    </Button>
                  </div>
                )}
              </div>
              <ScrollArea className="max-h-60">
                {urlInfo.items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 px-2 py-1.5 rounded-sm transition-colors ${
                      urlInfo.type === 'playlist'
                        ? `cursor-pointer ${selectedUrlIds.has(item.id) ? 'bg-primary/10' : 'hover:bg-muted/50'}`
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => urlInfo.type === 'playlist' && toggleUrlSelect(item.id)}
                  >
                    {urlInfo.type === 'playlist' && (
                      <input
                        type="checkbox"
                        checked={selectedUrlIds.has(item.id)}
                        onChange={() => toggleUrlSelect(item.id)}
                        className="shrink-0 accent-primary"
                      />
                    )}
                    {item.thumbnail && (
                      <img src={item.thumbnail} alt="" className="h-8 w-12 rounded-sm object-cover shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground">{item.artist} - {formatTime(item.duration)}</p>
                    </div>
                    {urlInfo.type === 'video' && (
                      <Button variant="default" size="sm" className="h-7 text-xs shrink-0"
                        onClick={(e) => { e.stopPropagation(); handleYtDownload(`https://youtube.com/watch?v=${item.id}`); }}
                        disabled={ytDownload.isPending}
                      >
                        <Download className="h-3 w-3 mr-1" /> {t('pages.musicBots.libraryTab.download')}
                      </Button>
                    )}
                  </div>
                ))}
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      {/* YouTube Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleYtSearch()}
            placeholder={t('pages.musicBots.libraryTab.searchYoutubePlaceholder')}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleYtSearch} disabled={ytSearch.isPending || !searchQuery.trim()}>
          {ytSearch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4 mr-1" />}
          {t('pages.musicBots.libraryTab.search')}
        </Button>
      </div>

      {/* YouTube Results */}
      {showYt && ytResults.length > 0 && (
        <Card className="card-hero">
          <CardHeader className="py-2 px-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs">{t('pages.musicBots.libraryTab.youtubeResultsCount', { count: ytResults.length })}</CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowYt(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-60 overflow-y-auto">
              {ytResults.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors">
                  {r.thumbnail && (
                    <img src={r.thumbnail} alt="" className="h-10 w-14 rounded-sm object-cover shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{r.title}</p>
                    <p className="text-[10px] text-muted-foreground">{r.artist} - {formatTime(r.duration)}</p>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-xs shrink-0"
                    onClick={() => handleYtDownload(`https://youtube.com/watch?v=${r.id}`)}
                    disabled={ytDownload.isPending}
                  >
                    <Download className="h-3 w-3 mr-1" /> {t('pages.musicBots.libraryTab.download')}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {runningBots.length === 0 && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
          <p className="text-xs text-amber-500">{t('pages.musicBots.libraryTab.startBotToPlayHint')}</p>
        </div>
      )}

      {/* Song List */}
      {isLoading ? <PageLoader /> : filtered.length === 0 ? (
        <EmptyState icon={Music} title={t('pages.musicBots.libraryTab.noFilesYetTitle')} description={t('pages.musicBots.libraryTab.noFilesYetDescription')} />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] gap-2 px-3 py-2 bg-muted/50 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            <button
              type="button"
              className="flex items-center gap-1.5 text-left hover:text-foreground transition-colors"
              onClick={() => toggleSort('title')}
            >
              {t('pages.musicBots.shared.title')} <SortIcon active={sortBy === 'title'} dir={sortDir} />
              {isFetching && (
                <span className="flex items-center gap-1 normal-case font-normal text-muted-foreground/80">
                  <RefreshCw className="h-3 w-3 animate-spin" /> {t('pages.musicBots.libraryTab.refreshing')}
                </span>
              )}
            </button>
            <button
              type="button"
              className="w-14 flex items-center justify-center gap-1 hover:text-foreground transition-colors"
              onClick={() => toggleSort('type')}
            >
              {t('pages.musicBots.libraryTab.colType')} <SortIcon active={sortBy === 'type'} dir={sortDir} />
            </button>
            <button
              type="button"
              className="w-20 flex items-center justify-end gap-1 hover:text-foreground transition-colors"
              onClick={() => toggleSort('duration')}
            >
              {t('pages.musicBots.shared.duration')} <SortIcon active={sortBy === 'duration'} dir={sortDir} />
            </button>
            <span className="w-16 text-center">{t('pages.musicBots.shared.source')}</span>
            <span className="w-16 text-right">{t('pages.musicBots.libraryTab.colSize')}</span>
            <span className="w-20" />
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {sorted.map((song) => (
              <div key={song.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] gap-2 px-3 py-2 hover:bg-muted/30 transition-colors items-center border-t border-border/50">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{song.title}</p>
                  {song.artist && <p className="text-[10px] text-muted-foreground truncate">{song.artist}</p>}
                </div>
                <span className="w-14 flex justify-center">
                  <Badge variant="secondary" className="text-[9px] gap-1">
                    {song.mediaType === 'video' ? <Video className="h-3 w-3" /> : <FileAudio className="h-3 w-3" />}
                    {song.mediaType}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground w-20 text-right">{formatTime(song.duration)}</span>
                <span className="w-16 flex justify-center">
                  <Badge variant="outline" className="text-[9px] gap-1">{sourceIcon(song.source)} {song.source}</Badge>
                </span>
                <span className="text-xs text-muted-foreground w-16 text-right">{song.fileSize ? formatBytes(song.fileSize) : '-'}</span>
                <div className="w-20 flex justify-end items-center gap-0.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={!selectedBotId}
                        title={!selectedBotId ? t('pages.musicBots.libraryTab.noBotSelectedHint') : song.mediaType === 'video' ? t('pages.musicBots.libraryTab.streamOptions') : t('pages.musicBots.libraryTab.playOptions')}
                      >
                        {song.mediaType === 'video' ? <Video className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {song.mediaType === 'video' ? (
                        <>
                          <DropdownMenuItem onClick={() => handleStreamVideo(song)}>
                            <Video className="mr-2 h-3.5 w-3.5" /> {t('pages.musicBots.libraryTab.stream')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!isStreaming}
                            title={!isStreaming ? t('pages.musicBots.libraryTab.startStreamFirst') : undefined}
                            onClick={() => handleQueueVideo(song)}
                          >
                            <ListMusic className="mr-2 h-3.5 w-3.5" /> {t('pages.musicBots.libraryTab.addToStreamQueue')}
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          <DropdownMenuItem onClick={() => handlePlaySong(song)}>
                            <Play className="mr-2 h-3.5 w-3.5" /> {t('pages.musicBots.playSongDialog.play')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEnqueueSong(song)}>
                            <ListMusic className="mr-2 h-3.5 w-3.5" /> {t('pages.musicBots.libraryTab.addToQueue')}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => setDeleteId(song.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
        title={t('pages.musicBots.libraryTab.deleteFileTitle')}
        description={t('pages.musicBots.libraryTab.deleteFileDescription')}
        onConfirm={() => {
          if (deleteId && configId) deleteSong.mutate({ configId, songId: deleteId }, {
            onSuccess: () => { toast.success(t('pages.musicBots.libraryTab.songDeleted')); setDeleteId(null); },
          });
        }}
        destructive
      />
    </div>
  );
}

// ─── Playlists Tab ───────────────────────────────────────────────────────────

function PlaylistsTab() {
  const { t } = useTranslation();
  const { selectedConfigId } = useServerStore();
  const { data, isLoading } = usePlaylists();
  const createPlaylist = useCreatePlaylist();
  const deletePlaylist = useDeletePlaylist();
  const addSong = useAddSongToPlaylist();
  const removeSong = useRemoveSongFromPlaylist();

  const { data: songs } = useSongs(selectedConfigId, 'audio');

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showAddSong, setShowAddSong] = useState(false);
  const [songFilter, setSongFilter] = useState('');

  const { data: detail } = usePlaylist(selectedId) as { data: PlaylistDetail | undefined };

  const playlists = (Array.isArray(data) ? data : []) as PlaylistSummary[];
  const songList = (Array.isArray(songs) ? songs : []) as SongInfo[];
  const playlistSongIds = new Set((detail?.songs || []).map((s: any) => s.id));
  const availableSongs = songList.filter((s) => !playlistSongIds.has(s.id) && (!songFilter || s.title.toLowerCase().includes(songFilter.toLowerCase())));

  const handleCreate = () => {
    createPlaylist.mutate({ name: newName }, {
      onSuccess: () => { toast.success(t('pages.musicBots.playlistsTab.playlistCreated')); setShowCreate(false); setNewName(''); },
      onError: () => toast.error(t('pages.musicBots.playlistsTab.createPlaylistFailed')),
    });
  };

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('pages.musicBots.playlistsTab.playlistsCount', { count: playlists.length })}</p>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> {t('pages.musicBots.playlistsTab.newPlaylist')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Playlist list */}
        <div className="space-y-1.5">
          {playlists.length === 0 ? (
            <EmptyState icon={ListMusic} title={t('pages.musicBots.playlistsTab.noPlaylistsTitle')} description={t('pages.musicBots.playlistsTab.noPlaylistsDescription')} />
          ) : playlists.map((pl) => (
            <div
              key={pl.id}
              className={`flex items-center gap-2 p-2.5 rounded-md cursor-pointer transition-colors ${
                selectedId === pl.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'
              }`}
              onClick={() => setSelectedId(pl.id)}
            >
              <ListMusic className={`h-4 w-4 shrink-0 ${selectedId === pl.id ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{pl.name}</p>
                <p className="text-[10px] text-muted-foreground">{t('pages.musicBots.shared.songsCount', { count: pl.songCount })}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                onClick={(e) => { e.stopPropagation(); setDeleteId(pl.id); }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        {/* Playlist detail */}
        {selectedId && detail ? (
          <Card className="card-hero">
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{detail.name}</CardTitle>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAddSong(true)}>
                  <Plus className="h-3 w-3 mr-1" /> {t('pages.musicBots.playlistsTab.addSongs')}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {detail.songs.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">{t('pages.musicBots.playlistsTab.noSongsInPlaylist')}</div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto">
                  {detail.songs.map((song: any, i: number) => (
                    <div key={song.id} className="flex items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground w-5 text-right">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{song.title}</p>
                        {song.artist && <p className="text-[10px] text-muted-foreground truncate">{song.artist}</p>}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{formatTime(song.duration)}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => removeSong.mutate({ playlistId: selectedId, songId: song.id }, {
                          onSuccess: () => toast.success(t('pages.musicBots.playlistsTab.songRemoved')),
                        })}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center justify-center text-xs text-muted-foreground py-16">
            {t('pages.musicBots.playlistsTab.selectPlaylistHint')}
          </div>
        )}
      </div>

      {/* Create Playlist Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.musicBots.playlistsTab.newPlaylistTitle')}</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">{t('pages.musicBots.shared.name')}</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('pages.musicBots.playlistsTab.namePlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && newName && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('pages.musicBots.shared.cancel')}</Button>
            <Button onClick={handleCreate} disabled={!newName || createPlaylist.isPending}>{t('pages.musicBots.shared.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Song Dialog */}
      <Dialog open={showAddSong} onOpenChange={setShowAddSong}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('pages.musicBots.playlistsTab.addSongsToPlaylistTitle')}</DialogTitle></DialogHeader>
          <Input
            value={songFilter}
            onChange={(e) => setSongFilter(e.target.value)}
            placeholder={t('pages.musicBots.shared.filterSongsPlaceholder')}
          />
          <ScrollArea className="max-h-72">
            {availableSongs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">{t('pages.musicBots.playlistsTab.noSongsAvailable')}</p>
            ) : availableSongs.map((song) => (
              <div key={song.id} className="flex items-center gap-2 py-1.5 hover:bg-muted/30 transition-colors rounded-sm px-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs truncate">{song.title}</p>
                  {song.artist && <p className="text-[10px] text-muted-foreground truncate">{song.artist}</p>}
                </div>
                <Button variant="outline" size="sm" className="h-6 text-[10px] shrink-0"
                  onClick={() => {
                    if (selectedId) addSong.mutate({ playlistId: selectedId, songId: song.id }, {
                      onSuccess: () => toast.success(t('pages.musicBots.playlistsTab.songAdded')),
                    });
                  }}
                >
                  <Plus className="h-3 w-3 mr-0.5" /> {t('pages.musicBots.shared.add')}
                </Button>
              </div>
            ))}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddSong(false); setSongFilter(''); }}>{t('pages.musicBots.shared.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
        title={t('pages.musicBots.playlistsTab.deletePlaylistTitle')}
        description={t('pages.musicBots.playlistsTab.deletePlaylistDescription')}
        onConfirm={() => {
          if (deleteId) deletePlaylist.mutate(deleteId, {
            onSuccess: () => {
              toast.success(t('pages.musicBots.playlistsTab.playlistDeleted'));
              if (selectedId === deleteId) setSelectedId(null);
              setDeleteId(null);
            },
          });
        }}
        destructive
      />
    </div>
  );
}

// ─── Radio Tab ───────────────────────────────────────────────────────────────

function RadioTab() {
  const { t } = useTranslation();
  const { selectedConfigId } = useServerStore();
  const { data: servers } = useServers();
  const [serverId, setServerId] = useState<number | null>(selectedConfigId);
  const configId = serverId || selectedConfigId;

  const { data: stations, isLoading } = useRadioStations(configId);
  const { data: presets } = useRadioPresets(configId);
  const createStation = useCreateRadioStation();
  const deleteStation = useDeleteRadioStation();
  const playRadio = usePlayRadio();

  const { data: bots } = useMusicBots();
  const runningBots = (Array.isArray(bots) ? bots : []).filter(
    (b: MusicBotSummary) => b.status !== 'stopped' && b.status !== 'error'
  );

  const [selectedBotId, setSelectedBotId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', url: '', genre: '' });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const serverList = Array.isArray(servers) ? servers : [];
  const stationList = (Array.isArray(stations) ? stations : []) as RadioStationInfo[];
  const presetList = (Array.isArray(presets) ? presets : []) as RadioPreset[];

  // Auto-select first running bot
  useEffect(() => {
    if (!selectedBotId && runningBots.length > 0) {
      setSelectedBotId(runningBots[0].id);
    }
  }, [runningBots, selectedBotId]);

  const handleAddStation = () => {
    if (!configId || !addForm.name || !addForm.url) return;
    createStation.mutate({
      configId,
      data: { name: addForm.name, url: addForm.url, genre: addForm.genre || undefined },
    }, {
      onSuccess: () => { toast.success(t('pages.musicBots.radioTab.stationAdded')); setShowAdd(false); setAddForm({ name: '', url: '', genre: '' }); },
      onError: () => toast.error(t('pages.musicBots.radioTab.addStationFailed')),
    });
  };

  const handleAddPreset = (preset: RadioPreset) => {
    if (!configId) return;
    createStation.mutate({
      configId,
      data: { name: preset.name, url: preset.url, genre: preset.genre },
    }, {
      onSuccess: () => toast.success(t('pages.musicBots.radioTab.addedName', { name: preset.name })),
      onError: () => toast.error(t('pages.musicBots.radioTab.addFailedName', { name: preset.name })),
    });
  };

  const handlePlay = (stationId: number) => {
    if (!selectedBotId) {
      toast.error(t('pages.musicBots.radioTab.selectRunningBotFirst'));
      return;
    }
    playRadio.mutate({ botId: selectedBotId, stationId }, {
      onSuccess: () => toast.success(t('pages.musicBots.radioTab.playingRadio')),
      onError: () => toast.error(t('pages.musicBots.radioTab.playRadioFailed')),
    });
  };

  if (!configId) {
    return <EmptyState icon={Radio} title={t('pages.musicBots.radioTab.selectServerTitle')} description={t('pages.musicBots.radioTab.selectServerDescription')} />;
  }

  return (
    <div className="space-y-4">
      {/* Server + Bot selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={String(configId)} onValueChange={(v) => setServerId(parseInt(v))}>
          <SelectTrigger className="w-48"><SelectValue placeholder={t('pages.musicBots.shared.serverPlaceholder')} /></SelectTrigger>
          <SelectContent>
            {serverList.map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="h-6" />

        <Label className="text-xs text-muted-foreground">{t('pages.musicBots.shared.playOn')}</Label>
        <Select
          value={selectedBotId ? String(selectedBotId) : ''}
          onValueChange={(v) => setSelectedBotId(parseInt(v))}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder={runningBots.length === 0 ? t('pages.musicBots.shared.noRunningBots') : t('pages.musicBots.shared.selectBotPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {runningBots.map((b: MusicBotSummary) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={() => setShowPresets(true)}>
          <Radio className="h-4 w-4 mr-1" /> {t('pages.musicBots.radioTab.presets')}
        </Button>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> {t('pages.musicBots.radioTab.addStation')}
        </Button>
      </div>

      {runningBots.length === 0 && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
          <p className="text-xs text-amber-500">{t('pages.musicBots.radioTab.startBotToPlayHint')}</p>
        </div>
      )}

      {/* Station List */}
      {isLoading ? <PageLoader /> : stationList.length === 0 ? (
        <EmptyState icon={Radio} title={t('pages.musicBots.radioTab.noStationsTitle')} description={t('pages.musicBots.radioTab.noStationsDescription')} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {stationList.map((station) => (
            <Card key={station.id} className="card-hero group hover:border-primary/30 transition-colors">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Radio className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {station.name} <span className="text-muted-foreground font-normal">#{station.id}</span>
                  </p>
                  {station.genre && (
                    <Badge variant="outline" className="text-[9px] mt-0.5">{station.genre}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handlePlay(station.id)}
                    disabled={!selectedBotId || playRadio.isPending}
                  >
                    <Play className="h-4 w-4 ml-0.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setDeleteId(station.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Station Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pages.musicBots.radioTab.addStationTitle')}</DialogTitle>
            <DialogDescription>{t('pages.musicBots.radioTab.addStationDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('pages.musicBots.shared.name')}</Label>
              <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder={t('pages.musicBots.radioTab.stationNamePlaceholder')} />
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.radioTab.streamUrlLabel')}</Label>
              <Input value={addForm.url} onChange={(e) => setAddForm({ ...addForm, url: e.target.value })} placeholder={t('pages.musicBots.radioTab.streamUrlPlaceholder')} />
            </div>
            <div>
              <Label className="text-xs">{t('pages.musicBots.radioTab.genreLabel')}</Label>
              <Input value={addForm.genre} onChange={(e) => setAddForm({ ...addForm, genre: e.target.value })} placeholder={t('pages.musicBots.radioTab.genrePlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>{t('pages.musicBots.shared.cancel')}</Button>
            <Button onClick={handleAddStation} disabled={!addForm.name || !addForm.url || createStation.isPending}>
              {t('pages.musicBots.radioTab.addStation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Presets Dialog */}
      <Dialog open={showPresets} onOpenChange={setShowPresets}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col overflow-auto">
          <DialogHeader>
            <DialogTitle>{t('pages.musicBots.radioTab.presetsTitle')}</DialogTitle>
            <DialogDescription>{t('pages.musicBots.radioTab.presetsDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 max-h-[400px] overflow-y-auto">
            {presetList.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">{t('pages.musicBots.radioTab.noPresetsAvailable')}</p>
            ) : presetList.map((preset, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2 hover:bg-muted/50 transition-colors rounded-sm">
                <Radio className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{preset.name}</p>
                  <p className="text-[10px] text-muted-foreground">{preset.genre}</p>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs shrink-0"
                  onClick={() => handleAddPreset(preset)}
                  disabled={createStation.isPending}
                >
                  <Plus className="h-3 w-3 mr-1" /> {t('pages.musicBots.shared.add')}
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPresets(false)}>{t('pages.musicBots.shared.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
        title={t('pages.musicBots.radioTab.deleteStationTitle')}
        description={t('pages.musicBots.radioTab.deleteStationDescription')}
        onConfirm={() => {
          if (deleteId && configId) deleteStation.mutate({ configId, id: deleteId }, {
            onSuccess: () => { toast.success(t('pages.musicBots.radioTab.stationRemoved')); setDeleteId(null); },
          });
        }}
        destructive
      />
    </div>
  );
}

// ─── Video Streaming Tab ─────────────────────────────────────────────────────

function VideoTab() {
  const { t } = useTranslation();
  const { data } = useMusicBots();
  const bots = Array.isArray(data) ? data : [];
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null);

  // Auto-select first running bot
  const runningBots = bots.filter((b: MusicBotSummary) => b.status !== 'stopped' && b.status !== 'error');
  useEffect(() => {
    if (!selectedBotId && runningBots.length > 0) {
      setSelectedBotId(runningBots[0].id);
    }
  }, [runningBots, selectedBotId]);

  const selectedBot = bots.find((b: MusicBotSummary) => b.id === selectedBotId);

  return (
    <div className="space-y-4">
      {bots.length === 0 ? (
        <EmptyState icon={Video} title={t('pages.musicBots.videoTab.noBotsTitle')} description={t('pages.musicBots.videoTab.noBotsDescription')} />
      ) : (
        <>
          {/* Bot selector */}
          <div className="flex items-center gap-3">
            <Label className="shrink-0">{t('pages.musicBots.videoTab.selectBotLabel')}</Label>
            <Select
              value={selectedBotId ? String(selectedBotId) : ''}
              onValueChange={(v) => setSelectedBotId(parseInt(v))}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder={t('pages.musicBots.videoTab.chooseBotPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {bots.map((b: MusicBotSummary) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.name} — {b.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedBot ? (
            <VideoStreamTab botId={selectedBot.id} botStatus={selectedBot.status} serverConfigId={selectedBot.serverConfigId} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('pages.musicBots.videoTab.selectBotHint')}</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Queue Tab ───────────────────────────────────────────────────────────────

function QueueTab() {
  const { t } = useTranslation();
  const { data: bots } = useMusicBots();
  const [selectedBot, setSelectedBot] = useState<number | null>(null);
  const { data: state } = useMusicBotState(selectedBot);
  const removeFromQueue = useRemoveFromQueue();
  const clearQueue = useClearQueue();
  const playFromQueue = usePlayFromQueue();
  const moveQueueItem = useMoveQueueItem();

  const botList = Array.isArray(bots) ? bots : [];
  const queue: any[] = state?.queue ?? [];
  const currentIndex: number = state?.currentIndex ?? -1;

  // Auto-select first running bot
  useEffect(() => {
    if (!selectedBot && botList.length > 0) {
      const running = botList.find((b: any) => b.status !== 'stopped');
      setSelectedBot(running?.id ?? botList[0]?.id ?? null);
    }
  }, [botList, selectedBot]);

  return (
    <div className="space-y-4">
      {/* Bot selector */}
      <div className="flex items-center gap-3">
        <Label className="text-xs text-muted-foreground">{t('pages.musicBots.queueTab.botLabel')}</Label>
        <Select value={selectedBot ? String(selectedBot) : ''} onValueChange={(v) => setSelectedBot(parseInt(v))}>
          <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder={t('pages.musicBots.queueTab.selectBotPlaceholder')} /></SelectTrigger>
          <SelectContent>
            {botList.map((b: any) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {queue.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="secondary" className="text-[10px]">{t('pages.musicBots.queueTab.tracksCount', { count: queue.length })}</Badge>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => selectedBot && clearQueue.mutate(selectedBot)}>
              <Trash2 className="h-3 w-3 mr-1" /> {t('pages.musicBots.queueTab.clear')}
            </Button>
          </div>
        )}
      </div>

      {!selectedBot ? (
        <EmptyState icon={Music} title={t('pages.musicBots.queueTab.selectBotHint')} />
      ) : queue.length === 0 ? (
        <EmptyState icon={ListMusic} title={t('pages.musicBots.queueTab.queueEmpty')} />
      ) : (
        <Card className="card-hero">
          <CardContent className="p-0">
            {/* Header */}
            <div className="grid grid-cols-[2rem_minmax(0,1fr)_5rem_5rem_3rem_3rem] gap-2 px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border/50">
              <div>#</div>
              <div>{t('pages.musicBots.shared.title')}</div>
              <div className="text-right">{t('pages.musicBots.shared.duration')}</div>
              <div className="text-right">{t('pages.musicBots.shared.source')}</div>
              <div />
              <div />
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {queue.map((item: any, i: number) => {
                const isActive = i === currentIndex;
                return (
                  <div
                    key={`${item.id}-${i}`}
                    className={`grid grid-cols-[2rem_minmax(0,1fr)_5rem_5rem_3rem_3rem] gap-2 px-3 py-1.5 items-center group transition-colors ${isActive ? 'bg-primary/10' : 'hover:bg-muted/30'}`}
                  >
                    <div className="text-xs text-muted-foreground font-mono-data">
                      {isActive ? <Play className="h-3 w-3 text-primary" /> : i + 1}
                    </div>
                    <div className="min-w-0">
                      <button
                        className="text-xs truncate block text-left hover:text-primary transition-colors w-full"
                        onClick={() => selectedBot && playFromQueue.mutate({ botId: selectedBot, index: i })}
                        title={t('pages.musicBots.queueTab.clickToPlay')}
                      >
                        {item.title}
                      </button>
                      {item.artist && <p className="text-[10px] text-muted-foreground truncate">{item.artist}</p>}
                    </div>
                    <div className="text-[11px] text-muted-foreground text-right font-mono-data">
                      {item.duration ? formatTime(item.duration) : '—'}
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="text-[9px] h-4 px-1">{item.source}</Badge>
                    </div>
                    <div className="flex flex-col items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {i > 0 && (
                        <button
                          className="p-0.5 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground"
                          onClick={() => selectedBot && moveQueueItem.mutate({ botId: selectedBot, from: i, to: i - 1 })}
                          title={t('pages.musicBots.queueTab.moveUp')}
                        >
                          <GripVertical className="h-3 w-3 rotate-180" />
                        </button>
                      )}
                      {i < queue.length - 1 && (
                        <button
                          className="p-0.5 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground"
                          onClick={() => selectedBot && moveQueueItem.mutate({ botId: selectedBot, from: i, to: i + 1 })}
                          title={t('pages.musicBots.queueTab.moveDown')}
                        >
                          <GripVertical className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-0.5 rounded-sm hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        onClick={() => selectedBot && removeFromQueue.mutate({ botId: selectedBot, index: i })}
                        title={t('pages.musicBots.queueTab.removeFromQueue')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PermissionsTab() {
  const { t } = useTranslation();
  const { selectedConfigId } = useServerStore();
  const { data: servers } = useServers();
  const [serverId, setServerId] = useState<number | null>(selectedConfigId);
  const configId = serverId || selectedConfigId;
  const serverList = Array.isArray(servers) ? servers : [];

  // Music bots assume a single virtual server per TS instance throughout
  // this app (see the sid=1 comment in voice/voice-bot.ts) - group IDs here
  // follow the same assumption.
  const { data: groupsData } = useQuery({
    queryKey: ['server-groups-for-command-perms', configId],
    queryFn: () => groupsApi.serverGroups(configId!, 1),
    enabled: !!configId,
  });
  // Template/query groups can't be assigned to a real client (TeamSpeak
  // rejects them - see the same filter and note in ChannelGroups.tsx), so
  // they'd never actually match anyone here either.
  const groups = (Array.isArray(groupsData) ? groupsData : []).filter((g: any) => Number(g.type) === 1);

  const { data: permData, isLoading } = useCommandPermissions(configId);
  const setCommandPerm = useSetCommandPermission(configId);
  const clearCommandPerm = useClearCommandPermission(configId);
  const setAdminGroups = useSetAdminGroups(configId);

  const permByCommand = new Map<string, BotCommandPermissionInfo>(
    (permData?.permissions ?? []).map((p) => [p.command, p]),
  );
  const adminGroupIds = new Set(permData?.adminGroupIds ?? []);

  const [editingCommand, setEditingCommand] = useState<string | null>(null);
  const [editingSelected, setEditingSelected] = useState<Set<string>>(new Set());

  const groupName = (sgid: string) => groups.find((g: any) => String(g.sgid) === sgid)?.name || `#${sgid}`;

  const openEdit = (command: string) => {
    const current = permByCommand.get(command)?.allowedGroupIds || '';
    setEditingSelected(new Set(current.split(',').map((s) => s.trim()).filter(Boolean)));
    setEditingCommand(command);
  };

  const saveEdit = () => {
    if (!editingCommand) return;
    const ids = [...editingSelected];
    const mutation = ids.length === 0
      ? clearCommandPerm.mutateAsync(editingCommand)
      : setCommandPerm.mutateAsync({ command: editingCommand, allowedGroupIds: ids.join(',') });
    mutation.then(
      () => { toast.success(t('pages.musicBots.permissionsTab.permissionUpdated')); setEditingCommand(null); },
      () => toast.error(t('pages.musicBots.permissionsTab.permissionUpdateFailed')),
    );
  };

  const toggleAdminGroup = (sgid: string) => {
    const next = new Set(adminGroupIds);
    next.has(sgid) ? next.delete(sgid) : next.add(sgid);
    setAdminGroups.mutate([...next], { onError: () => toast.error(t('pages.musicBots.permissionsTab.adminGroupsUpdateFailed')) });
  };

  if (!configId) return <EmptyState icon={ShieldCheck} title={t('pages.noServerSelected')} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={String(configId)} onValueChange={(v) => setServerId(Number(v))}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {serverList.map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> {t('pages.musicBots.permissionsTab.adminBypassGroups')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {t('pages.musicBots.permissionsTab.adminBypassHint')}
          </p>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pages.musicBots.shared.noServerGroupsFound')}</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {groups.map((g: any) => (
                <label key={g.sgid} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={adminGroupIds.has(String(g.sgid))}
                    onCheckedChange={() => toggleAdminGroup(String(g.sgid))}
                  />
                  {g.name}
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{t('pages.musicBots.permissionsTab.chatCommandPermissions')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <PageLoader /> : (
            <div className="divide-y divide-border">
              {RESTRICTABLE_COMMANDS.map(({ command, label }) => {
                const perm = permByCommand.get(command);
                const ids = (perm?.allowedGroupIds || '').split(',').map((s) => s.trim()).filter(Boolean);
                return (
                  <div key={command} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-mono-data">{label}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ids.length === 0 ? (
                          OPEN_BY_DEFAULT_COMMANDS.has(command) ? (
                            <Badge variant="secondary" className="text-[10px]">{t('pages.musicBots.permissionsTab.everyone')}</Badge>
                          ) : (
                            <Badge variant="warning" className="text-[10px]">{t('pages.musicBots.permissionsTab.noGroupAssigned')}</Badge>
                          )
                        ) : (
                          ids.map((id) => (
                            <Badge key={id} variant="outline" className="text-[10px]">{groupName(id)}</Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openEdit(command)}>
                      <Pencil className="h-3 w-3 mr-1" /> {t('common.edit')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingCommand} onOpenChange={(open) => !open && setEditingCommand(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{RESTRICTABLE_COMMANDS.find((c) => c.command === editingCommand)?.label}</DialogTitle>
            <DialogDescription>
              {editingCommand && OPEN_BY_DEFAULT_COMMANDS.has(editingCommand)
                ? t('pages.musicBots.permissionsTab.openByDefaultHint')
                : t('pages.musicBots.permissionsTab.restrictedHint')}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[280px]">
            <div className="space-y-2 pr-2">
              {groups.map((g: any) => (
                <label key={g.sgid} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={editingSelected.has(String(g.sgid))}
                    onCheckedChange={() => {
                      setEditingSelected((prev) => {
                        const next = new Set(prev);
                        const id = String(g.sgid);
                        next.has(id) ? next.delete(id) : next.add(id);
                        return next;
                      });
                    }}
                  />
                  {g.name}
                </label>
              ))}
              {groups.length === 0 && <p className="text-sm text-muted-foreground">{t('pages.musicBots.shared.noServerGroupsFound')}</p>}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCommand(null)}>{t('pages.musicBots.shared.cancel')}</Button>
            <Button onClick={saveEdit} disabled={setCommandPerm.isPending || clearCommandPerm.isPending}>{t('pages.musicBots.botsTab.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MusicBots() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{t('pages.musicBots.title')}</h1>
        </div>
      </div>

      <Tabs defaultValue="bots" className="space-y-4">
        <TabsList>
          <TabsTrigger value="bots"><Music2 className="h-3.5 w-3.5 mr-1.5" /> {t('pages.musicBots.tabBots')}</TabsTrigger>
          <TabsTrigger value="queue"><ListMusic className="h-3.5 w-3.5 mr-1.5" /> {t('pages.musicBots.tabQueue')}</TabsTrigger>
          <TabsTrigger value="video"><Video className="h-3.5 w-3.5 mr-1.5" /> {t('pages.musicBots.tabVideo')}</TabsTrigger>
          <TabsTrigger value="library"><FileAudio className="h-3.5 w-3.5 mr-1.5" /> {t('pages.musicBots.tabLibrary')}</TabsTrigger>
          <TabsTrigger value="playlists"><ListMusic className="h-3.5 w-3.5 mr-1.5" /> {t('pages.musicBots.tabPlaylists')}</TabsTrigger>
          <TabsTrigger value="radio"><Radio className="h-3.5 w-3.5 mr-1.5" /> {t('pages.musicBots.tabRadio')}</TabsTrigger>
          <TabsTrigger value="permissions"><ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> {t('pages.musicBots.tabPermissions')}</TabsTrigger>
        </TabsList>

        <TabsContent value="bots"><BotsTab /></TabsContent>
        <TabsContent value="queue"><QueueTab /></TabsContent>
        <TabsContent value="video"><VideoTab /></TabsContent>
        <TabsContent value="library"><LibraryTab /></TabsContent>
        <TabsContent value="playlists"><PlaylistsTab /></TabsContent>
        <TabsContent value="radio"><RadioTab /></TabsContent>
        <TabsContent value="permissions"><PermissionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
