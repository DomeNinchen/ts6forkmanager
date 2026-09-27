import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getBotTemplates } from '@/data/bot-templates';

export type PlaceholderTabKey = 'event' | 'time' | 'var' | 'temp' | 'exec' | 'filter' | 'functions' | 'templates';

const ALL_TABS: PlaceholderTabKey[] = ['event', 'time', 'var', 'temp', 'exec', 'filter', 'functions', 'templates'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Tiny helper: one placeholder row                                  */
/* ------------------------------------------------------------------ */
function P({ code, desc, example }: { code: string; desc: string; example?: string }) {
  return (
    <div className="py-1.5 grid grid-cols-[1fr_1.4fr_1.6fr] gap-2 items-start text-xs border-b border-border/40 last:border-0">
      <code className="text-[11px] font-mono text-emerald-400 break-all">{code}</code>
      <span className="text-muted-foreground">{desc}</span>
      {example ? (
        <code className="text-[10px] font-mono text-muted-foreground/70 bg-muted/40 rounded-sm px-1.5 py-0.5 break-all">{example}</code>
      ) : <span />}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 mb-1.5 first:mt-0"><Badge variant="outline" className="text-[10px]">{children}</Badge></div>;
}

function getTabLabels(t: TFunction): Record<PlaceholderTabKey, string> {
  return {
    event: t('components.placeholderReference.tabs.event'),
    time: t('components.placeholderReference.tabs.time'),
    var: t('components.placeholderReference.tabs.var'),
    temp: t('components.placeholderReference.tabs.temp'),
    exec: t('components.placeholderReference.tabs.exec'),
    filter: t('components.placeholderReference.tabs.filter'),
    functions: t('components.placeholderReference.tabs.functions'),
    templates: t('components.placeholderReference.tabs.templates'),
  };
}

/* ------------------------------------------------------------------ */
/*  Content only - reused both standalone (full reference) and        */
/*  embedded in the Bot Flow editor's popup text editor (reduced set) */
/* ------------------------------------------------------------------ */
export function PlaceholderReferenceContent({ tabs = ALL_TABS }: { tabs?: PlaceholderTabKey[] }) {
  const { t } = useTranslation();
  const botTemplates = useMemo(() => getBotTemplates(t), [t]);
  const templatesWithHints = botTemplates.filter((tpl) => tpl.variablesHint && tpl.variablesHint.length > 0);
  const tabLabels = getTabLabels(t);
  const pr = (key: string) => t(`components.placeholderReference.${key}`);

  return (
    <Tabs defaultValue={tabs[0]}>
      <TabsList className="h-8 mb-3 flex-wrap h-auto">
        {tabs.map((key) => (
          <TabsTrigger key={key} value={key} className="text-xs px-2.5 h-6">{tabLabels[key]}</TabsTrigger>
        ))}
      </TabsList>

      <ScrollArea className="h-[58vh]">
        {/* ========== EVENT ========== */}
        {tabs.includes('event') && (
        <TabsContent value="event" className="mt-0 pr-3">
          <p className="text-xs text-muted-foreground mb-2">
            {pr('event.intro')}
          </p>

          <SectionHeader>{pr('event.h1')}</SectionHeader>
          <P code="{{event.clid}}" desc={pr('event.clid.desc')} example={pr('event.clid.example')} />
          <P code="{{event.client_nickname}}" desc={pr('event.clientNickname.desc')} example={pr('event.clientNickname.example')} />
          <P code="{{event.client_database_id}}" desc={pr('event.clientDatabaseId.desc')} example={pr('event.clientDatabaseId.example')} />
          <P code="{{event.client_unique_identifier}}" desc={pr('event.clientUid.desc')} example={pr('event.clientUid.example')} />
          <P code="{{event.client_type}}" desc={pr('event.clientType.desc')} example={pr('event.clientType.example')} />
          <P code="{{event.client_servergroups}}" desc={pr('event.clientServergroups.desc')} example={pr('event.clientServergroups.example')} />
          <P code="{{event.connection_client_ip}}" desc={pr('event.connectionClientIp.desc')} example={pr('event.connectionClientIp.example')} />
          <P code="{{event.cid}}" desc={pr('event.cidJoined.desc')} example={pr('event.cidJoined.example')} />

          <SectionHeader>{pr('event.h2')}</SectionHeader>
          <P code="{{event.clid}}" desc={pr('event.clidDisc.desc')} />
          <P code="{{event.cfid}}" desc={pr('event.cfidDisc.desc')} />
          <P code="{{event.reasonid}}" desc={pr('event.reasonidDisc.desc')} example={pr('event.reasonidDisc.example')} />
          <P code="{{event.reasonmsg}}" desc={pr('event.reasonmsg.desc')} example={pr('event.reasonmsg.example')} />

          <SectionHeader>{pr('event.h3')}</SectionHeader>
          <P code="{{event.clid}}" desc={pr('event.clidMoved.desc')} />
          <P code="{{event.ctid}}" desc={pr('event.ctid.desc')} example={pr('event.ctid.example')} />
          <P code="{{event.cfid}}" desc={pr('event.cfidMoved.desc')} />
          <P code="{{event.reasonid}}" desc={pr('event.reasonidMoved.desc')} />

          <SectionHeader>{pr('event.h4')}</SectionHeader>
          <P code="{{event.clid}}" desc={pr('event.clidMsg.desc')} />
          <P code="{{event.client_nickname}}" desc={pr('event.clientNicknameMsg.desc')} />
          <P code="{{event.msg}}" desc={pr('event.msg.desc')} example={pr('event.msg.example')} />
          <P code="{{event.targetmode}}" desc={pr('event.targetmode.desc')} />

          <SectionHeader>{pr('event.h5')}</SectionHeader>
          <P code="{{event.command_name}}" desc={pr('event.commandName.desc')} example={pr('event.commandName.example')} />
          <P code="{{event.command_args}}" desc={pr('event.commandArgs.desc')} example={pr('event.commandArgs.example')} />
          <P code="{{event.clid}}" desc={pr('event.clidCmd.desc')} />
          <P code="{{event.client_nickname}}" desc={pr('event.clientNicknameCmd.desc')} />

          <SectionHeader>{pr('event.h6')}</SectionHeader>
          <P code="{{event.cid}}" desc={pr('event.cidChannel.desc')} />
          <P code="{{event.invokerid}}" desc={pr('event.invokerid.desc')} />
          <P code="{{event.invokername}}" desc={pr('event.invokername.desc')} />

          <SectionHeader>{pr('event.h7')}</SectionHeader>
          <P code="{{event.webhook_path}}" desc={pr('event.webhookPath.desc')} example="/my-hook" />
          <P code="{{event.webhook_method}}" desc={pr('event.webhookMethod.desc')} example={pr('event.webhookMethod.example')} />
          <P code="{{event.webhook_body}}" desc={pr('event.webhookBody.desc')} />
          <P code="{{event.webhook_body.field}}" desc={pr('event.webhookBodyField.desc')} example={pr('event.webhookBodyField.example')} />
          <P code="{{event.webhook_query}}" desc={pr('event.webhookQuery.desc')} />
        </TabsContent>
        )}

        {/* ========== TIME ========== */}
        {tabs.includes('time') && (
        <TabsContent value="time" className="mt-0 pr-3">
          <p className="text-xs text-muted-foreground mb-2">
            {pr('time.intro')}
          </p>
          <P code="{{time.time}}" desc={pr('time.time.desc')} example={pr('time.time.example')} />
          <P code="{{time.date}}" desc={pr('time.date.desc')} example={pr('time.date.example')} />
          <P code="{{time.hours}}" desc={pr('time.hours.desc')} example={pr('time.hours.example')} />
          <P code="{{time.minutes}}" desc={pr('time.minutes.desc')} />
          <P code="{{time.seconds}}" desc={pr('time.seconds.desc')} />
          <P code="{{time.day}}" desc={pr('time.day.desc')} />
          <P code="{{time.month}}" desc={pr('time.month.desc')} example={pr('time.month.example')} />
          <P code="{{time.year}}" desc={pr('time.year.desc')} example="2026" />
          <P code="{{time.dayOfWeek}}" desc={pr('time.dayOfWeek.desc')} example={pr('time.dayOfWeek.example')} />
          <P code="{{time.timestamp}}" desc={pr('time.timestamp.desc')} example="1739462400" />
        </TabsContent>
        )}

        {/* ========== VARIABLES ========== */}
        {tabs.includes('var') && (
        <TabsContent value="var" className="mt-0 pr-3">
          <p className="text-xs text-muted-foreground mb-2">
            <Trans i18nKey="components.placeholderReference.var.intro">
              Persistent variables stored in the database. Survive restarts. Scoped per flow.
              Set via the <strong>Set Variable</strong> action node.
            </Trans>
          </p>
          <P code={'{{var.name}}'} desc={pr('var.name.desc')} example={pr('var.name.example')} />

          <SectionHeader>{pr('var.h1')}</SectionHeader>
          <div className="text-xs text-muted-foreground space-y-1 mt-1">
            <p><Trans i18nKey="components.placeholderReference.var.actionSet"><strong>Set</strong> &mdash; Set a variable to a fixed value or template</Trans></p>
            <p><Trans i18nKey="components.placeholderReference.var.actionIncrement"><strong>Increment</strong> &mdash; Add a number to the current value</Trans></p>
            <p><Trans i18nKey="components.placeholderReference.var.actionAppend"><strong>Append</strong> &mdash; Append text to the current value</Trans></p>
          </div>

          <SectionHeader>{pr('var.h2')}</SectionHeader>
          <div className="text-xs text-muted-foreground space-y-1 mt-1">
            <p><Trans i18nKey="components.placeholderReference.var.example1">Visit counter: Increment <code className="text-emerald-400">visit_count</code> by 1 on each join</Trans></p>
            <p><Trans i18nKey="components.placeholderReference.var.example2">Last seen: Set <code className="text-emerald-400">{'lastseen_{{event.client_database_id}}'}</code> to <code className="text-emerald-400">{'{{time.timestamp}}'}</code></Trans></p>
            <p><Trans i18nKey="components.placeholderReference.var.example3">Online time tracking: Increment <code className="text-emerald-400">{'onlinetime_{{event.clid}}'}</code></Trans></p>
          </div>
        </TabsContent>
        )}

        {/* ========== TEMP ========== */}
        {tabs.includes('temp') && (
        <TabsContent value="temp" className="mt-0 pr-3">
          <p className="text-xs text-muted-foreground mb-2">
            {pr('temp.intro')}
          </p>

          <SectionHeader>{pr('temp.h1')}</SectionHeader>
          <P code="{{temp.lastCreatedChannelId}}" desc={pr('temp.lastCreatedChannelId.desc')} example={pr('temp.lastCreatedChannelId.example')} />
          <P code="{{temp.lastResult}}" desc={pr('temp.lastResult.desc')} />
          <P code="{{temp.afkMovedCount}}" desc={pr('temp.afkMovedCount.desc')} example={pr('temp.afkMovedCount.example')} />
          <P code="{{temp.idleKickedCount}}" desc={pr('temp.idleKickedCount.desc')} />
          <P code="{{temp.pokedCount}}" desc={pr('temp.pokedCount.desc')} />
          <P code="{{temp.rankPromotedCount}}" desc={pr('temp.rankPromotedCount.desc')} />
          <P code="{{temp.tempChannelsDeleted}}" desc={pr('temp.tempChannelsDeleted.desc')} />

          <SectionHeader>{pr('temp.h2')}</SectionHeader>
          <p className="text-xs text-muted-foreground mb-1">
            <Trans i18nKey="components.placeholderReference.temp.storeAsIntro">
              WebQuery and HTTP Request actions have a "Store As" field. The FULL result list is saved as a temp variable — even a single-row command like clientinfo or serverinfo, so access it with an explicit <code className="text-emerald-400">.0.</code> for "the first (only) row".
            </Trans>
          </p>
          <P code={'{{temp.server.0.virtualserver_clientsonline}}'} desc={pr('temp.serverOnline.desc')} example={pr('temp.serverOnline.example')} />
          <P code={'{{temp.server.0.virtualserver_uptime}}'} desc={pr('temp.serverUptime.desc')} example={pr('temp.serverUptime.example')} />
          <P code={'{{temp.client.0.client_nickname}}'} desc={pr('temp.clientNickname.desc')} />

          <SectionHeader>{pr('temp.h3')}</SectionHeader>
          <p className="text-xs text-muted-foreground mb-1">
            {pr('temp.loopIntro')}
          </p>
          <P code={'{{temp.client}}'} desc={pr('temp.loopItem.desc')} />
          <P code={'{{temp.client.client_nickname}}'} desc={pr('temp.loopField.desc')} />
          <P code={'{{temp.client_index}}'} desc={pr('temp.loopIndex.desc')} />
        </TabsContent>
        )}

        {/* ========== EXEC ========== */}
        {tabs.includes('exec') && (
        <TabsContent value="exec" className="mt-0 pr-3">
          <p className="text-xs text-muted-foreground mb-2">
            {pr('exec.intro')}
          </p>
          <P code="{{exec.flowId}}" desc={pr('exec.flowId.desc')} />
          <P code="{{exec.executionId}}" desc={pr('exec.executionId.desc')} />
          <P code="{{exec.configId}}" desc={pr('exec.configId.desc')} />
          <P code="{{exec.sid}}" desc={pr('exec.sid.desc')} />
          <P code="{{exec.triggerType}}" desc={pr('exec.triggerType.desc')} example={pr('exec.triggerType.example')} />
        </TabsContent>
        )}

        {/* ========== FILTER ========== */}
        {tabs.includes('filter') && (
        <TabsContent value="filter" className="mt-0 pr-3">
          <p className="text-xs text-muted-foreground mb-2">
            <Trans i18nKey="components.placeholderReference.filter.intro">
              Filters transform values. Apply with pipe syntax: <code className="text-emerald-400">{'{{value|filter}}'}</code>
            </Trans>
          </p>
          <P code="uptime" desc={pr('filter.uptime.desc')} example='{{temp.server.virtualserver_uptime|uptime}} → "5d 3h 42m"' />
          <P code="round" desc={pr('filter.round.desc')} example='{{temp.value|round}} → "42"' />
          <P code="floor" desc={pr('filter.floor.desc')} example='{{temp.value|floor}} → "41"' />
        </TabsContent>
        )}

        {/* ========== FUNCTIONS ========== */}
        {tabs.includes('functions') && (
        <TabsContent value="functions" className="mt-0 pr-3">
          <p className="text-xs text-muted-foreground mb-2">
            <Trans i18nKey="components.placeholderReference.functions.intro">
              Functions for use in <strong>Condition</strong> node expressions. Return 0 or 1 (false/true).
            </Trans>
          </p>
          <P code="contains(str, sub)" desc={pr('functions.contains.desc')} example="contains(event.client_nickname, 'Bot')" />
          <P code="startsWith(str, prefix)" desc={pr('functions.startsWith.desc')} example="startsWith(event.client_nickname, 'Admin')" />
          <P code="endsWith(str, suffix)" desc={pr('functions.endsWith.desc')} example="endsWith(event.client_nickname, 'Bot')" />
          <P code="lower(str)" desc={pr('functions.lower.desc')} example="contains(lower(event.client_nickname), 'bot')" />
          <P code="upper(str)" desc={pr('functions.upper.desc')} />
          <P code="length(str)" desc={pr('functions.length.desc')} example="length(event.msg) > 100" />
          <P code="split(str, sep, idx)" desc={pr('functions.split.desc')} example="split(event.command_args, ' ', 0)" />
          <P code="hasGroup(csv, id)" desc={pr('functions.hasGroup.desc')} example="hasGroup(event.client_servergroups, '6')" />
          <P code="count(value)" desc={pr('functions.count.desc')} example="count(temp.ownership) > 0" />

          <SectionHeader>{pr('functions.h1')}</SectionHeader>
          <div className="text-xs text-muted-foreground space-y-1 mt-1">
            <p><code className="text-emerald-400">event.client_type == 0</code> &mdash; {pr('functions.condition1')}</p>
            <p><code className="text-emerald-400">{"hasGroup(event.client_servergroups, '7')"}</code> &mdash; {pr('functions.condition2')}</p>
            <p><code className="text-emerald-400">time.hours {'>='} 22 or time.hours {'<'} 6</code> &mdash; {pr('functions.condition3')}</p>
            <p><code className="text-emerald-400">event.ctid == 42</code> &mdash; {pr('functions.condition4')}</p>
            <p><code className="text-emerald-400">temp.vpn.security.vpn == 1</code> &mdash; {pr('functions.condition5')}</p>
          </div>
        </TabsContent>
        )}

        {/* ========== TEMPLATES ========== */}
        {tabs.includes('templates') && (
        <TabsContent value="templates" className="mt-0 pr-3">
          <p className="text-xs text-muted-foreground mb-2">
            {pr('templates.intro')}
          </p>
          {templatesWithHints.map((tpl) => (
            <div key={tpl.name}>
              <SectionHeader>{tpl.name}</SectionHeader>
              {tpl.variablesHint!.map((hint) => {
                const [code, ...descParts] = hint.split(' - ');
                return <P key={hint} code={code} desc={descParts.join(' - ')} />;
              })}
            </div>
          ))}
        </TabsContent>
        )}
      </ScrollArea>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */
/*  Standalone dialog - the main "?" help button in the editor toolbar */
/* ------------------------------------------------------------------ */
export function PlaceholderReference({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl grid-rows-none! block! p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-2">
          <DialogTitle className="text-base">{t('components.placeholderReference.dialogTitle')}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            <Trans i18nKey="components.placeholderReference.dialogIntro">
              Use <code className="text-emerald-400">{'{{placeholder}}'}</code> in any text field. Values are resolved at runtime.
            </Trans>
          </p>
        </DialogHeader>
        <div className="px-5 pb-5">
          <PlaceholderReferenceContent />
        </div>
      </DialogContent>
    </Dialog>
  );
}
