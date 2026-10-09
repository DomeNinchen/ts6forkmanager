import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { messagesApi } from '@/api/bans.api';
import { useServerStore } from '@/stores/server.store';
import { DataTable, type DataTableFeatures } from '@/components/shared/DataTable';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Mail, Plus, Trash2, Eye } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

export default function Messages() {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['messages', c, s], queryFn: () => messagesApi.list(c!, s!), enabled: !!c && !!s });
  const deleteMutation = useMutation({ mutationFn: (msgid: number) => messagesApi.delete(c!, s!, msgid), onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', c, s] }) });
  const sendMutation = useMutation({ mutationFn: (data: any) => messagesApi.send(c!, s!, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages', c, s] }); toast.success(t('pages.messages.sent')); } });

  const [showCompose, setShowCompose] = useState(false);
  const [showView, setShowView] = useState<any>(null);
  const [toCluid, setToCluid] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // The list rows carry no text (messagelist leaves it out), so it is fetched with messageget when a message is opened.
  const openedQuery = useQuery({
    queryKey: ['message', c, s, showView?.msgid],
    queryFn: () => messagesApi.get(c!, s!, showView.msgid),
    enabled: !!c && !!s && !!showView,
  });
  const opened = Array.isArray(openedQuery.data) ? openedQuery.data[0] : undefined;

  const messages = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const columns: ColumnDef<DataTableFeatures, any>[] = useMemo(() => [
    // TeamSpeak names the sender by unique ID only; the backend adds the nickname where the client database knows it.
    { id: 'sender', accessorFn: (m: any) => m.senderName || m.cluid, header: t('pages.messages.from'), cell: ({ row }) => (
      row.original.senderName
        ? <span className="font-medium" title={row.original.cluid}>{row.original.senderName}</span>
        : <span className="block max-w-[18rem] truncate font-mono text-xs text-muted-foreground" title={row.original.cluid}>{row.original.cluid || '-'}</span>
    )},
    { accessorKey: 'subject', header: t('pages.messages.subject') },
    { accessorKey: 'timestamp', header: t('pages.messages.date'), cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{timeAgo(getValue() as number)}</span> },
    // flag_read arrives as the text "0" or "1", and "0" is truthy.
    { accessorKey: 'flag_read', header: t('common.status'), cell: ({ getValue }) => {
      const read = Number(getValue()) === 1;
      return (
        <span className={`text-xs px-1.5 py-0.5 rounded-sm ${read ? 'bg-muted text-muted-foreground' : 'bg-primary/20 text-primary font-medium'}`}>
          {read ? t('pages.messages.read') : t('pages.messages.unread')}
        </span>
      );
    }},
    {
      id: 'actions', header: '',
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowView(row.original)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => {
            deleteMutation.mutate(row.original.msgid, { onSuccess: () => toast.success(t('pages.messages.deleted')) });
          }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [deleteMutation, t]);

  if (!c || !s) return <EmptyState icon={Mail} title={t('pages.noServerSelected')} />;
  if (isLoading) return <PageLoader />;

  const handleSend = () => {
    sendMutation.mutate({ cluid: toCluid, subject, message: body }, {
      onSuccess: () => { setShowCompose(false); setToCluid(''); setSubject(''); setBody(''); },
      onError: () => toast.error(t('pages.messages.sendFailed')),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('pages.messages.title')}</h1>
        <Button size="sm" onClick={() => setShowCompose(true)}><Plus className="h-4 w-4 mr-1" /> {t('pages.messages.compose')}</Button>
      </div>

      <p className="text-sm text-muted-foreground max-w-3xl">{t('pages.messages.hint')}</p>

      <DataTable columns={columns} data={messages} searchKey="subject" searchPlaceholder={t('pages.messages.searchPlaceholder')} />

      {/* View Message Dialog */}
      <Dialog open={!!showView} onOpenChange={() => setShowView(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{showView?.subject || t('pages.messages.message')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>{t('pages.messages.from')}: {showView?.senderName
                  ? <span className="text-foreground font-medium">{showView.senderName}</span>
                  : <span className="text-foreground font-mono break-all">{showView?.cluid}</span>}
                </span>
                <span className="text-border">|</span>
                <span className="shrink-0">{showView?.timestamp && timeAgo(showView.timestamp)}</span>
              </div>
              {showView?.senderName && <div className="font-mono break-all">{showView.cluid}</div>}
            </div>
            <div className="rounded-md bg-muted/30 border border-border p-3 text-sm min-h-[100px] whitespace-pre-wrap break-words">
              {openedQuery.isLoading
                ? <span className="text-muted-foreground">{t('common.loading')}</span>
                : opened
                  ? (opened.message || t('pages.messages.noContent'))
                  : <span className="text-destructive">{t('pages.messages.loadFailed')}</span>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowView(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compose Dialog */}
      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.messages.composeTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">{t('pages.messages.recipientUid')}</Label><Input value={toCluid} onChange={(e) => setToCluid(e.target.value)} placeholder={t('pages.messages.recipientUidPlaceholder')} /></div>
            <div><Label className="text-xs">{t('pages.messages.subject')}</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('pages.messages.subjectPlaceholder')} /></div>
            <div><Label className="text-xs">{t('pages.messages.message')}</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('pages.messages.bodyPlaceholder')} rows={5} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompose(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSend} disabled={!toCluid || !subject}>{t('pages.messages.send')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
