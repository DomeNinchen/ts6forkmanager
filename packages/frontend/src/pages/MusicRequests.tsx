import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { MusicBotSummary } from '@ts6/common';
import { musicRequestsApi } from '@/api/music-requests.api';
import { useMusicBots, usePlayUrl } from '@/hooks/use-music-bots';
import { useServerStore } from '@/stores/server.store';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Music, ExternalLink, Clock, Play, Plus, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { getDateFnsLocale } from '@/lib/date-fns-locale';

// The same states the play-url route accepts.
const CONNECTED = ['connected', 'playing', 'paused'];

export default function MusicRequests() {
    const { t } = useTranslation();
    const { selectedConfigId: c } = useServerStore();

    const { data: requests = [], isLoading } = useQuery({
        queryKey: ['music-requests', c],
        queryFn: () => musicRequestsApi.list(c!),
        enabled: !!c,
    });
    const { data: bots } = useMusicBots();
    const playUrl = usePlayUrl();
    const [chosenBotId, setChosenBotId] = useState<number | null>(null);

    const connectedBots = ((bots ?? []) as MusicBotSummary[])
        .filter((b) => b.serverConfigId === c && CONNECTED.includes(b.status));
    // Falls back to the first connected bot when nothing (or a bot that has since disconnected) is chosen.
    const botId = connectedBots.find((b) => b.id === chosenBotId)?.id ?? connectedBots[0]?.id ?? null;
    const pending = playUrl.isPending ? playUrl.variables : null;

    const play = (url: string, mode: 'now' | 'queue') => {
        if (!botId) return;
        playUrl.mutate({ botId, url, mode }, {
            onSuccess: (res) => toast.success(
                res?.queued ? t('pages.musicBots.botsTab.addedToQueuePosition', { position: res.position }) : t('pages.musicBots.botsTab.playingUrl'),
            ),
            onError: () => toast.error(t(mode === 'queue' ? 'pages.musicBots.botsTab.queueUrlFailed' : 'pages.musicBots.botsTab.playUrlFailed')),
        });
    };

    if (!c) return <EmptyState icon={Music} title={t('pages.noServerSelected')} />;
    if (isLoading) return <PageLoader />;

    return (
        <div className="space-y-4 max-w-5xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        <Music className="w-5 h-5 text-primary" /> {t('nav.items.musicRequestHistory')}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        <Trans i18nKey="pages.musicRequests.description">
                            The last 25 songs requested on this server, via <code className="text-xs bg-muted px-1 rounded-sm text-primary">!play</code> or here in the web interface.
                        </Trans>
                    </p>
                </div>
                {connectedBots.length > 0 ? (
                    <Select value={botId ? String(botId) : ''} onValueChange={(v) => setChosenBotId(parseInt(v))}>
                        <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder={t('pages.musicRequests.botPlaceholder')} /></SelectTrigger>
                        <SelectContent>
                            {connectedBots.map((b) => (
                                <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <p className="text-xs text-muted-foreground">{t('pages.musicRequests.noConnectedBot')}</p>
                )}
            </div>

            <div className="card-hero h-[600px] overflow-hidden border border-border rounded-lg bg-card shadow-xs relative">
                {requests.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <EmptyState
                            icon={Music}
                            title={t('pages.musicRequests.noneYetTitle')}
                            description={t('pages.musicRequests.noneYetDescription')}
                        />
                    </div>
                ) : (
                    <ScrollArea className="h-full">
                        <div className="p-4 grid grid-cols-1 gap-3">
                            {requests.map((req) => {
                                const loading = pending?.url === req.url ? (pending.mode ?? 'now') : null;
                                return (
                                <div
                                    key={req.id}
                                    className={cn(
                                        "flex flex-wrap items-center gap-4 p-4 rounded-xl",
                                        "bg-muted/30 border border-border/50 shadow-xs",
                                        "hover:bg-muted/50 hover:border-border hover:shadow-md",
                                        "transition-all duration-200 group"
                                    )}
                                >
                                    {/* Icon or Thumbnail Placeholder */}
                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20 group-hover:bg-primary/20 transition-colors">
                                        <Music className="w-4 h-4 text-primary" />
                                    </div>

                                    {/* Content Details */}
                                    <div className="flex-1 basis-48 min-w-0">
                                        <p className="font-medium text-[15px] truncate group-hover:text-primary transition-colors" title={req.title}>
                                            {req.title}
                                        </p>
                                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground/80">
                                            <span className="flex items-center gap-1.5 font-mono-data">
                                                <Clock className="w-3.5 h-3.5" />
                                                {t('pages.musicRequests.requested', { time: formatDistanceToNow(new Date(req.requestedAt), { addSuffix: true, locale: getDateFnsLocale() }) })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Actions - wrap onto their own line on narrow screens */}
                                    <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                                        <Button variant="default" size="sm" className="h-7 text-xs px-2"
                                            disabled={!botId || !!pending}
                                            onClick={() => play(req.url, 'now')}
                                            title={t('pages.musicBots.playSongDialog.playNowHint')}
                                        >
                                            {loading === 'now' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                                            {loading === 'now' ? t('pages.musicBots.playSongDialog.loading') : t('pages.musicBots.playSongDialog.play')}
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-7 text-xs px-2"
                                            disabled={!botId || !!pending}
                                            onClick={() => play(req.url, 'queue')}
                                            title={t('pages.musicBots.playSongDialog.queueAfterHint')}
                                        >
                                            {loading === 'queue' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                                            {loading === 'queue' ? t('pages.musicBots.playSongDialog.loading') : t('pages.musicBots.playSongDialog.queue')}
                                        </Button>
                                        <a
                                            href={req.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title={t('pages.musicRequests.openLink')}
                                            aria-label={t('pages.musicRequests.openLink')}
                                            className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-primary/20 hover:text-primary transition-all"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </a>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
