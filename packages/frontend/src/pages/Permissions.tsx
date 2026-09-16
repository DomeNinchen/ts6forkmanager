import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi } from '@/api/permissions.api';
import { useServerStore } from '@/stores/server.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import {
  Lock, Search, ChevronRight, ChevronDown, Shield, Users, Hash, User, UserCog, Save,
  X, Check, Minus, Plus, Columns3,
} from 'lucide-react';
import { toast } from 'sonner';

// Permission categories based on TS3 naming convention
const PERM_CATEGORIES: Record<string, string> = {
  b_virtualserver: 'Virtual Server',
  b_serverinstance: 'Server Instance',
  b_serverquery: 'Server Query',
  b_channel: 'Channel',
  b_client: 'Client',
  b_group: 'Group',
  b_ft: 'File Transfer',
  i_channel: 'Channel (Values)',
  i_group: 'Group (Values)',
  i_client: 'Client (Values)',
  i_ft: 'File Transfer (Values)',
  i_max: 'Limits',
  i_needed: 'Needed Powers',
};

function getCategoryKey(permsid: string): string {
  // Match longest prefix first
  const prefixes = Object.keys(PERM_CATEGORIES).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (permsid.startsWith(prefix)) return prefix;
  }
  return 'other';
}

type PermLayer = 'server-group' | 'channel-group' | 'channel' | 'client' | 'channel-client';

interface PermDef {
  permid: number;
  permsid: string;
  permdesc: string;
}

interface PermValue {
  permsid: string;
  permvalue: number;
  permnegated: number;
  permskip: number;
}

interface PendingChange {
  permsid: string;
  permvalue: number;
  permnegated: number;
  permskip: number;
  action: 'set' | 'remove';
}

const LAYERS: { key: PermLayer; label: string; icon: React.ElementType }[] = [
  { key: 'server-group', label: 'Server Groups', icon: Shield },
  { key: 'channel-group', label: 'Channel Groups', icon: Users },
  { key: 'channel', label: 'Channel', icon: Hash },
  { key: 'client', label: 'Client', icon: User },
  { key: 'channel-client', label: 'Client in Channel', icon: UserCog },
];

// Entity keys are strings everywhere on this page. For the 4 "flat list"
// layers it's just the numeric id as a string; for channel-client (no
// server-wide list command exists - you must already know the pair) it's
// "{cid}:{cldbid}".
function fetchPerms(layer: PermLayer, c: number, s: number, key: string) {
  if (layer === 'channel-client') {
    const [cid, cldbid] = key.split(':').map(Number);
    return permissionsApi.channelClientPerms(c, s, cid, cldbid);
  }
  const id = Number(key);
  switch (layer) {
    case 'server-group': return permissionsApi.serverGroupPerms(c, s, id);
    case 'channel-group': return permissionsApi.channelGroupPerms(c, s, id);
    case 'channel': return permissionsApi.channelPerms(c, s, id);
    case 'client': return permissionsApi.clientPerms(c, s, id);
  }
}

function applyPermSet(layer: PermLayer, c: number, s: number, key: string, ch: PendingChange) {
  if (layer === 'channel-client') {
    const [cid, cldbid] = key.split(':').map(Number);
    // channelclientaddperm only takes permsid/permvalue - no negate/skip
    return permissionsApi.addChannelClientPerm(c, s, cid, cldbid, { permsid: ch.permsid, permvalue: ch.permvalue });
  }
  const id = Number(key);
  const data = { permsid: ch.permsid, permvalue: ch.permvalue, permnegated: ch.permnegated, permskip: ch.permskip };
  switch (layer) {
    case 'server-group': return permissionsApi.addServerGroupPerm(c, s, id, data);
    case 'channel-group': return permissionsApi.addChannelGroupPerm(c, s, id, data);
    case 'channel': return permissionsApi.addChannelPerm(c, s, id, data);
    case 'client': return permissionsApi.addClientPerm(c, s, id, data);
  }
}

function applyPermRemove(layer: PermLayer, c: number, s: number, key: string, permsid: string) {
  if (layer === 'channel-client') {
    const [cid, cldbid] = key.split(':').map(Number);
    return permissionsApi.delChannelClientPerm(c, s, cid, cldbid, { permsid });
  }
  const id = Number(key);
  switch (layer) {
    case 'server-group': return permissionsApi.delServerGroupPerm(c, s, id, { permsid });
    case 'channel-group': return permissionsApi.delChannelGroupPerm(c, s, id, { permsid });
    case 'channel': return permissionsApi.delChannelPerm(c, s, id, { permsid });
    case 'client': return permissionsApi.delClientPerm(c, s, id, { permsid });
  }
}

export default function Permissions() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const qc = useQueryClient();

  const [layer, setLayer] = useState<PermLayer>('server-group');
  const supportsNegateSkip = layer !== 'channel-client';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const entityKey = selectedIds.size === 1 ? [...selectedIds][0] : null;
  const bulkMode = selectedIds.size > 1;
  const [compareMode, setCompareMode] = useState(false);
  const [showDifferingOnly, setShowDifferingOnly] = useState(false);
  const [compareChanges, setCompareChanges] = useState<Map<string, Map<string, PendingChange>>>(new Map());
  const [search, setSearch] = useState('');
  const [showModifiedOnly, setShowModifiedOnly] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [entitySearch, setEntitySearch] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Map<string, PendingChange>>(new Map());

  // channel-client only: which channel is currently picked in the "add a
  // pair" form, and display names for pairs already added to selectedIds
  const [ccChannel, setCcChannel] = useState('');
  const [ccNames, setCcNames] = useState<Map<string, { channelName: string; clientName: string }>>(new Map());

  const toggleEntitySelect = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setChanges(new Map());
    setCompareChanges(new Map());
  }, []);

  // Fetch all permission definitions
  const { data: permDefs, isLoading: loadingDefs } = useQuery({
    queryKey: ['perm-defs', c, s],
    queryFn: () => permissionsApi.list(c!, s!),
    enabled: !!c && !!s,
  });

  // Fetch entity lists for selectors
  const { data: serverGroups } = useQuery({
    queryKey: ['server-groups', c, s],
    queryFn: () => permissionsApi.serverGroups(c!, s!),
    enabled: !!c && !!s && layer === 'server-group',
  });
  const { data: channelGroups } = useQuery({
    queryKey: ['channel-groups', c, s],
    queryFn: () => permissionsApi.channelGroups(c!, s!),
    enabled: !!c && !!s && layer === 'channel-group',
  });
  const { data: channels } = useQuery({
    queryKey: ['channels-for-perms', c, s],
    queryFn: () => permissionsApi.channels(c!, s!),
    enabled: !!c && !!s && (layer === 'channel' || layer === 'channel-client'),
  });
  const { data: clients } = useQuery({
    queryKey: ['clients-for-perms', c, s],
    queryFn: () => permissionsApi.clients(c!, s!),
    enabled: !!c && !!s && (layer === 'client' || layer === 'channel-client'),
  });
  const { data: offlineClients } = useQuery({
    queryKey: ['clients-db-for-perms', c, s],
    queryFn: () => permissionsApi.clientsDatabase(c!, s!),
    enabled: !!c && !!s && (layer === 'client' || layer === 'channel-client') && showOffline,
  });

  // Fetch current entity permissions
  const { data: entityPerms, isLoading: loadingPerms } = useQuery({
    queryKey: ['entity-perms', c, s, layer, entityKey],
    queryFn: () => (c && s && entityKey ? fetchPerms(layer, c, s, entityKey) : []),
    enabled: !!c && !!s && !!entityKey,
  });

  // Reset entity when layer changes
  useEffect(() => {
    setSelectedIds(new Set());
    setChanges(new Map());
    setCompareChanges(new Map());
    setCompareMode(false);
    setCcChannel('');
    setCcNames(new Map());
  }, [layer]);
  // Compare only makes sense with 2+ selected - drop out of it otherwise
  useEffect(() => { if (!bulkMode) setCompareMode(false); }, [bulkMode]);
  // "Only show set" has no toggle in plain Bulk Apply (currentPerms is
  // always empty there, so its filter would silently blank the whole list
  // with no visible control to undo it) - reset it whenever that mode is
  // entered, so a stale checked state from Compare or single-entity view
  // can't carry over invisibly.
  useEffect(() => { if (bulkMode && !compareMode) setShowModifiedOnly(false); }, [bulkMode, compareMode]);

  // Fetch each selected entity's permissions in Compare mode (shares its
  // query key with the single-entity fetch above, so switching between
  // Compare and a single selection reuses the cache instead of refetching)
  const compareQueries = useQueries({
    queries: compareMode
      ? [...selectedIds].map((key) => ({
          queryKey: ['entity-perms', c, s, layer, key],
          queryFn: () => fetchPerms(layer, c!, s!, key),
          enabled: !!c && !!s,
        }))
      : [],
  });
  const compareLoading = compareMode && compareQueries.some((q) => q.isLoading);

  // Parse permission definitions into categorized structure
  // TS WebQuery returns { permid, permname, permdesc } — NOT permsid
  const allPerms: PermDef[] = useMemo(() => {
    if (!permDefs || !Array.isArray(permDefs)) return [];
    return permDefs.map((p: any) => ({
      permid: Number(p.permid),
      permsid: p.permname || p.permsid || `permid_${p.permid}`,
      permdesc: p.permdesc || '',
    }));
  }, [permDefs]);

  // Build permid → permname lookup (entity perms only return numeric permid)
  const permIdToName = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of allPerms) {
      map.set(p.permid, p.permsid);
    }
    return map;
  }, [allPerms]);

  // Compare mode: each selected entity's permissions as its own map
  const compareData = useMemo(() => {
    const map = new Map<string, Map<string, PermValue>>();
    if (!compareMode) return map;
    [...selectedIds].forEach((key, i) => {
      const raw = compareQueries[i]?.data;
      const inner = new Map<string, PermValue>();
      if (Array.isArray(raw)) {
        for (const p of raw as any[]) {
          const name = p.permsid || p.permname || permIdToName.get(Number(p.permid)) || `permid_${p.permid}`;
          inner.set(name, {
            permsid: name,
            permvalue: Number(p.permvalue) || 0,
            permnegated: Number(p.permnegated) || 0,
            permskip: Number(p.permskip) || 0,
          });
        }
      }
      map.set(key, inner);
    });
    return map;
  }, [compareMode, selectedIds, compareQueries, permIdToName]);

  // Compare signatures fold in any not-yet-saved edit too, so "differs" and
  // "only show set" react live while you're editing, not just to the server.
  const permSignature = useCallback((permsid: string, key: string): string => {
    const pending = compareChanges.get(key)?.get(permsid);
    if (pending) return pending.action === 'remove' ? 'unset' : `${pending.permvalue}:${pending.permnegated}:${pending.permskip}`;
    const v = compareData.get(key)?.get(permsid);
    return v ? `${v.permvalue}:${v.permnegated}:${v.permskip}` : 'unset';
  }, [compareData, compareChanges]);

  const permDiffers = useCallback((permsid: string): boolean => {
    const sigs = [...selectedIds].map((key) => permSignature(permsid, key));
    return new Set(sigs).size > 1;
  }, [selectedIds, permSignature]);

  const isSetForAny = useCallback((permsid: string): boolean => {
    return [...selectedIds].some((key) => {
      const pending = compareChanges.get(key)?.get(permsid);
      if (pending) return pending.action !== 'remove';
      return compareData.get(key)?.has(permsid) ?? false;
    });
  }, [selectedIds, compareData, compareChanges]);

  const getCompareEffectiveValue = useCallback((key: string, permsid: string): PendingChange | null => {
    const pending = compareChanges.get(key)?.get(permsid);
    if (pending) return pending;
    const current = compareData.get(key)?.get(permsid);
    if (current) return { ...current, action: 'set' };
    return null;
  }, [compareChanges, compareData]);

  const setComparePermValue = useCallback((key: string, permsid: string, value: number, negated: number, skip: number) => {
    setCompareChanges((prev) => {
      const next = new Map(prev);
      const inner = new Map(next.get(key) ?? new Map());
      inner.set(permsid, { permsid, permvalue: value, permnegated: negated, permskip: skip, action: 'set' });
      next.set(key, inner);
      return next;
    });
  }, []);

  const removeComparePerm = useCallback((key: string, permsid: string) => {
    setCompareChanges((prev) => {
      const next = new Map(prev);
      const inner = new Map(next.get(key) ?? new Map());
      if (compareData.get(key)?.has(permsid)) {
        inner.set(permsid, { permsid, permvalue: 0, permnegated: 0, permskip: 0, action: 'remove' });
      } else {
        inner.delete(permsid);
      }
      if (inner.size === 0) next.delete(key); else next.set(key, inner);
      return next;
    });
  }, [compareData]);

  // Current perm values as map (keyed by permname/permsid)
  const currentPerms = useMemo(() => {
    const map = new Map<string, PermValue>();
    if (!entityPerms || !Array.isArray(entityPerms)) return map;
    for (const p of entityPerms) {
      // Entity perms may have permsid, permname, or only numeric permid
      const name = p.permsid || p.permname || permIdToName.get(Number(p.permid)) || `permid_${p.permid}`;
      map.set(name, {
        permsid: name,
        permvalue: Number(p.permvalue) || 0,
        permnegated: Number(p.permnegated) || 0,
        permskip: Number(p.permskip) || 0,
      });
    }
    return map;
  }, [entityPerms, permIdToName]);

  // Categorize permissions
  const categories = useMemo(() => {
    const catMap = new Map<string, PermDef[]>();
    let filtered = search
      ? allPerms.filter((p) => p.permsid.toLowerCase().includes(search.toLowerCase()) || p.permdesc.toLowerCase().includes(search.toLowerCase()))
      : allPerms;

    if (compareMode) {
      if (showModifiedOnly) filtered = filtered.filter((p) => isSetForAny(p.permsid));
      if (showDifferingOnly) filtered = filtered.filter((p) => permDiffers(p.permsid));
    } else if (showModifiedOnly) {
      // "Set" (has an explicit value on this entity) OR mid-edit (a pending
      // local change of any kind) - keeps a permission visible while it's
      // being removed instead of yanking it out from under the user.
      filtered = filtered.filter((p) => currentPerms.has(p.permsid) || changes.has(p.permsid));
    }

    for (const perm of filtered) {
      const cat = getCategoryKey(perm.permsid);
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(perm);
    }
    return catMap;
  }, [allPerms, search, showModifiedOnly, showDifferingOnly, compareMode, currentPerms, changes, isSetForAny, permDiffers]);

  const toggleCat = useCallback((cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const getEffectiveValue = useCallback((permsid: string): PendingChange | null => {
    if (changes.has(permsid)) return changes.get(permsid)!;
    const current = currentPerms.get(permsid);
    if (current) return { ...current, action: 'set' };
    return null;
  }, [changes, currentPerms]);

  const setPermValue = useCallback((permsid: string, value: number, negated: number, skip: number) => {
    setChanges((prev) => {
      const next = new Map(prev);
      next.set(permsid, { permsid, permvalue: value, permnegated: negated, permskip: skip, action: 'set' });
      return next;
    });
  }, []);

  const removePerm = useCallback((permsid: string) => {
    setChanges((prev) => {
      const next = new Map(prev);
      if (currentPerms.has(permsid)) {
        next.set(permsid, { permsid, permvalue: 0, permnegated: 0, permskip: 0, action: 'remove' });
      } else {
        next.delete(permsid);
      }
      return next;
    });
  }, [currentPerms]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!c || !s || selectedIds.size === 0) return;
      const toSet = [...changes.values()].filter((ch) => ch.action === 'set');
      const toRemove = [...changes.values()].filter((ch) => ch.action === 'remove');

      for (const key of selectedIds) {
        for (const ch of toSet) await applyPermSet(layer, c, s, key, ch);
        for (const ch of toRemove) await applyPermRemove(layer, c, s, key, ch.permsid);
      }
    },
    onSuccess: () => {
      toast.success(bulkMode ? `Permissions applied to ${selectedIds.size} entities` : 'Permissions saved');
      setChanges(new Map());
      qc.invalidateQueries({ queryKey: ['entity-perms', c, s, layer] });
    },
    onError: () => toast.error('Failed to save permissions'),
  });

  const compareSaveMutation = useMutation({
    mutationFn: async () => {
      if (!c || !s) return;
      for (const [key, entChanges] of compareChanges) {
        for (const ch of entChanges.values()) {
          if (ch.action === 'set') await applyPermSet(layer, c, s, key, ch);
          else await applyPermRemove(layer, c, s, key, ch.permsid);
        }
      }
    },
    onSuccess: () => {
      const n = [...compareChanges.values()].reduce((sum, m) => sum + m.size, 0);
      const entCount = compareChanges.size;
      toast.success(`${n} change(s) saved across ${entCount} entit${entCount === 1 ? 'y' : 'ies'}`);
      setCompareChanges(new Map());
      qc.invalidateQueries({ queryKey: ['entity-perms', c, s, layer] });
    },
    onError: () => toast.error('Failed to save permissions'),
  });

  if (!c || !s) return <EmptyState icon={Lock} title="No server selected" />;
  if (loadingDefs) return <PageLoader />;

  const entities = (() => {
    switch (layer) {
      case 'server-group':
        return (Array.isArray(serverGroups) ? serverGroups : []).map((g: any) => ({
          id: String(g.sgid), name: g.name, type: Number(g.type),
        }));
      case 'channel-group':
        return (Array.isArray(channelGroups) ? channelGroups : []).map((g: any) => ({
          id: String(g.cgid), name: g.name, type: Number(g.type),
        }));
      case 'channel':
        return (Array.isArray(channels) ? channels : []).map((ch: any) => ({
          id: String(ch.cid), name: ch.channel_name, type: 0,
        }));
      case 'client':
      case 'channel-client': {
        const online = (Array.isArray(clients) ? clients : [])
          .filter((cl: any) => String(cl.client_type) === '0')
          .map((cl: any) => ({
            id: String(cl.client_database_id), name: cl.client_nickname, type: 0, online: true,
          }));
        if (!showOffline) return online;
        // clientdblist has no client_type - a stray ServerQuery login could
        // theoretically show up here too, but that's a cosmetic edge case.
        const onlineIds = new Set(online.map((o) => o.id));
        const offline = (Array.isArray(offlineClients) ? offlineClients : [])
          .filter((cl: any) => !onlineIds.has(String(cl.cldbid)))
          .map((cl: any) => ({
            id: String(cl.cldbid), name: cl.client_nickname || `Client #${cl.cldbid}`, type: 0, online: false,
          }));
        return [...online, ...offline].sort((a, b) =>
          a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1);
      }
      default: return [];
    }
  })().filter((ent: any) =>
    (layer !== 'client' && layer !== 'channel-client') || !entitySearch || ent.name.toLowerCase().includes(entitySearch.toLowerCase()));

  const entityName = (key: string): string => {
    if (layer === 'channel-client') {
      const info = ccNames.get(key);
      return info ? `${info.clientName} @ ${info.channelName}` : key;
    }
    return entities.find((e: any) => e.id === key)?.name || key;
  };

  const addChannelClientPair = (clientId: string, clientName: string) => {
    if (!ccChannel) return;
    const key = `${ccChannel}:${clientId}`;
    const channelName = (Array.isArray(channels) ? channels : []).find((ch: any) => String(ch.cid) === ccChannel)?.channel_name || ccChannel;
    setSelectedIds((prev) => new Set(prev).add(key));
    setCcNames((prev) => new Map(prev).set(key, { channelName, clientName }));
    setChanges(new Map());
    setCompareChanges(new Map());
  };

  const removeChannelClientPair = (key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setCcNames((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setChanges(new Map());
    setCompareChanges(new Map());
  };

  const activeChangeCount = compareMode
    ? [...compareChanges.values()].reduce((sum, m) => sum + m.size, 0)
    : changes.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Permissions</h1>
        <div className="flex items-center gap-2">
          {bulkMode && (
            <Badge variant="secondary" className="font-mono-data">{selectedIds.size} entities selected</Badge>
          )}
          {activeChangeCount > 0 && (
            <>
              <Badge variant="secondary" className="font-mono-data">{activeChangeCount} change(s)</Badge>
              <Button variant="outline" size="sm" onClick={() => (compareMode ? setCompareChanges(new Map()) : setChanges(new Map()))}>
                <X className="h-3.5 w-3.5 mr-1" /> Discard
              </Button>
              <Button
                size="sm"
                onClick={() => (compareMode ? compareSaveMutation.mutate() : saveMutation.mutate())}
                disabled={compareMode ? compareSaveMutation.isPending : saveMutation.isPending}
              >
                <Save className="h-3.5 w-3.5 mr-1" /> {compareMode ? 'Save' : bulkMode ? `Apply to ${selectedIds.size}` : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Layer Tabs */}
      <div className="flex gap-1 p-1 bg-muted/30 rounded-lg w-fit">
        {LAYERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setLayer(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              layer === key
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Entity Selector */}
        <Card className="card-hero col-span-3">
          {layer === 'channel-client' ? (
            <>
              <CardHeader className="pb-2 space-y-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Add Client in Channel
                </CardTitle>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Channel</Label>
                  <Select value={ccChannel} onValueChange={setCcChannel}>
                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="Choose a channel..." /></SelectTrigger>
                    <SelectContent>
                      {(Array.isArray(channels) ? channels : []).map((ch: any) => (
                        <SelectItem key={ch.cid} value={String(ch.cid)}>{ch.channel_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}
                    placeholder="Search clients..."
                    className="h-7 pl-7 text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Switch id="show-offline-clients-cc" checked={showOffline} onCheckedChange={setShowOffline} />
                  <Label htmlFor="show-offline-clients-cc" className="text-xs text-muted-foreground cursor-pointer">Show offline clients</Label>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[260px]">
                  <div className="p-2 space-y-0.5">
                    {entities.map((ent: any) => (
                      <button
                        key={ent.id}
                        disabled={!ccChannel}
                        onClick={() => addChannelClientPair(ent.id, ent.name)}
                        className="w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2 text-foreground hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={!ccChannel ? 'Choose a channel first' : `Add ${ent.name}`}
                      >
                        {showOffline && (
                          <span
                            className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', ent.online ? 'bg-emerald-500' : 'bg-zinc-500')}
                            title={ent.online ? 'Online' : 'Offline'}
                          />
                        )}
                        <span className="truncate flex-1">{ent.name}</span>
                        <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                    {entities.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">No clients found</p>
                    )}
                  </div>
                </ScrollArea>
                <div className="border-t border-border/50 p-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-0.5 mb-1">
                    Added ({selectedIds.size})
                  </p>
                  <ScrollArea className="h-[150px]">
                    <div className="space-y-0.5">
                      {[...selectedIds].map((key) => (
                        <div key={key} className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-muted/30">
                          <span className="truncate flex-1">{entityName(key)}</span>
                          <button onClick={() => removeChannelClientPair(key)}>
                            <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>
                      ))}
                      {selectedIds.size === 0 && (
                        <p className="text-[11px] text-muted-foreground text-center py-2">
                          Pick a channel, then click a client to add it.
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="pb-2 space-y-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Select {LAYERS.find((l) => l.key === layer)?.label.replace(/s$/, '')}
                </CardTitle>
                {layer === 'client' && (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={entitySearch}
                        onChange={(e) => setEntitySearch(e.target.value)}
                        placeholder="Search clients..."
                        className="h-7 pl-7 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Switch id="show-offline-clients" checked={showOffline} onCheckedChange={setShowOffline} />
                      <Label htmlFor="show-offline-clients" className="text-xs text-muted-foreground cursor-pointer">Show offline clients</Label>
                    </div>
                  </>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  <div className="p-2 space-y-0.5">
                    {entities.map((ent: any) => (
                      <div
                        key={ent.id}
                        className={cn(
                          'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2 cursor-pointer',
                          selectedIds.has(ent.id)
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-muted/50',
                        )}
                        onClick={() => { setSelectedIds(new Set([ent.id])); setChanges(new Map()); setCompareChanges(new Map()); }}
                      >
                        <Checkbox
                          checked={selectedIds.has(ent.id)}
                          onCheckedChange={() => toggleEntitySelect(ent.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Select for bulk edit"
                        />
                        <span className="truncate flex items-center gap-1.5 flex-1">
                          {layer === 'client' && showOffline && (
                            <span
                              className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', ent.online ? 'bg-emerald-500' : 'bg-zinc-500')}
                              title={ent.online ? 'Online' : 'Offline'}
                            />
                          )}
                          {ent.name}
                        </span>
                        <span className="text-[10px] font-mono-data text-muted-foreground ml-1">#{ent.id}</span>
                      </div>
                    ))}
                    {entities.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">No entities found</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </>
          )}
        </Card>

        {/* Permission Editor */}
        <Card className="card-hero col-span-9">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {bulkMode ? (
                  <div className="flex items-center gap-1 p-0.5 bg-muted/30 rounded-md w-fit normal-case">
                    <button
                      onClick={() => setCompareMode(false)}
                      className={cn(
                        'px-2 py-1 rounded-sm text-xs font-medium transition-colors',
                        !compareMode ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      Bulk Apply
                    </button>
                    <button
                      onClick={() => { setCompareMode(true); setChanges(new Map()); }}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded-sm text-xs font-medium transition-colors',
                        compareMode ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Columns3 className="h-3 w-3" /> Compare
                    </button>
                  </div>
                ) : entityKey ? 'Permissions' : 'Select an entity'}
              </CardTitle>
              {(entityKey || bulkMode) && (
                <div className="flex items-center gap-3">
                  {(!bulkMode || compareMode) && (
                    <div className="flex items-center gap-1.5">
                      <Switch id="show-modified-only" checked={showModifiedOnly} onCheckedChange={setShowModifiedOnly} />
                      <Label htmlFor="show-modified-only" className="text-xs text-muted-foreground cursor-pointer">Only show set</Label>
                    </div>
                  )}
                  {compareMode && (
                    <div className="flex items-center gap-1.5">
                      <Switch id="show-differing-only" checked={showDifferingOnly} onCheckedChange={setShowDifferingOnly} />
                      <Label htmlFor="show-differing-only" className="text-xs text-muted-foreground cursor-pointer">Only show differing</Label>
                    </div>
                  )}
                  <div className="relative w-64">
                    <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search permissions..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-7 h-8 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
            {bulkMode && !compareMode && (
              <p className="text-[11px] text-muted-foreground pt-1">
                Set values here to apply them to all {selectedIds.size} selected entities - current per-entity values aren't shown while multiple are selected.
              </p>
            )}
            {compareMode && (
              <p className="text-[11px] text-muted-foreground pt-1">
                Shows each selected entity's current permission values side by side - edit a cell to change just that one entity, independent of the others. Use Bulk Apply instead to push the same value to all of them at once.
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
              {!entityKey && !bulkMode ? (
                <div className="flex items-center justify-center h-[400px]">
                  <p className="text-sm text-muted-foreground">Select an entity from the left panel</p>
                </div>
              ) : (compareMode ? compareLoading : loadingPerms) ? (
                <div className="flex items-center justify-center h-[400px]">
                  <PageLoader />
                </div>
              ) : (
                <div className="px-3 pb-3">
                  {[...categories.entries()].map(([catKey, perms]) => (
                    <div key={catKey} className="mb-1">
                      <button
                        onClick={() => toggleCat(catKey)}
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-sm"
                      >
                        {expandedCats.has(catKey) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {PERM_CATEGORIES[catKey] || catKey}
                        <Badge variant="secondary" className="text-[9px] h-4 ml-1">{perms.length}</Badge>
                      </button>
                      {expandedCats.has(catKey) && compareMode ? (
                        <div className="ml-4 border-l border-border/50 pl-2 overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                <th className="text-left px-2 py-1 sticky left-0 bg-card font-normal">Permission</th>
                                {[...selectedIds].map((key) => (
                                  <th
                                    key={key}
                                    className="px-2 py-1 text-center font-normal truncate max-w-[120px]"
                                    title={entityName(key)}
                                  >
                                    {entityName(key)}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {perms.map((perm) => {
                                const isBoolean = perm.permsid.startsWith('b_');
                                const differs = permDiffers(perm.permsid);
                                return (
                                  <tr key={perm.permsid} className={cn('border-t border-border/30', differs && 'bg-amber-500/5')}>
                                    <td className="px-2 py-1 sticky left-0 bg-card truncate" title={perm.permdesc || perm.permsid}>
                                      <span className="font-mono-data text-[11px]">{perm.permsid}</span>
                                    </td>
                                    {[...selectedIds].map((key) => {
                                      const effective = getCompareEffectiveValue(key, perm.permsid);
                                      const isSet = effective !== null && effective.action !== 'remove';
                                      const isChanged = compareChanges.get(key)?.has(perm.permsid) ?? false;
                                      return (
                                        <td key={key} className={cn('px-1 py-1 text-center', isChanged && 'bg-primary/5')}>
                                          {isBoolean ? (
                                            <button
                                              onClick={() => {
                                                if (isSet) removeComparePerm(key, perm.permsid);
                                                else setComparePermValue(key, perm.permsid, 1, 0, 0);
                                              }}
                                              className={cn(
                                                'h-5 w-5 rounded-sm border inline-flex items-center justify-center transition-colors',
                                                isSet
                                                  ? 'bg-primary border-primary text-primary-foreground'
                                                  : 'border-border hover:border-primary/50',
                                              )}
                                            >
                                              {isSet && <Check className="h-3 w-3" />}
                                            </button>
                                          ) : (
                                            <div className="inline-flex items-center gap-0.5">
                                              <Input
                                                type="number"
                                                className="h-6 w-16 text-xs text-center font-mono-data px-1"
                                                value={effective?.permvalue ?? ''}
                                                placeholder="—"
                                                onChange={(e) => {
                                                  const val = parseInt(e.target.value);
                                                  if (!isNaN(val)) {
                                                    setComparePermValue(key, perm.permsid, val, effective?.permnegated || 0, effective?.permskip || 0);
                                                  } else if (e.target.value === '') {
                                                    removeComparePerm(key, perm.permsid);
                                                  }
                                                }}
                                              />
                                              {supportsNegateSkip && (
                                                <>
                                                  <button
                                                    onClick={() => {
                                                      if (!isSet) return;
                                                      const newSkip = (effective?.permskip || 0) ? 0 : 1;
                                                      setComparePermValue(key, perm.permsid, effective?.permvalue || 0, effective?.permnegated || 0, newSkip);
                                                    }}
                                                    className={cn(
                                                      'h-4 w-4 rounded-sm border flex items-center justify-center text-[9px]',
                                                      isSet && effective?.permskip
                                                        ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                                                        : 'border-border/50 text-muted-foreground/40',
                                                    )}
                                                    title="Skip"
                                                  >S</button>
                                                  <button
                                                    onClick={() => {
                                                      if (!isSet) return;
                                                      const newNeg = (effective?.permnegated || 0) ? 0 : 1;
                                                      setComparePermValue(key, perm.permsid, effective?.permvalue || 0, newNeg, effective?.permskip || 0);
                                                    }}
                                                    className={cn(
                                                      'h-4 w-4 rounded-sm border flex items-center justify-center text-[9px]',
                                                      isSet && effective?.permnegated
                                                        ? 'bg-destructive/20 border-destructive text-destructive'
                                                        : 'border-border/50 text-muted-foreground/40',
                                                    )}
                                                    title="Negate"
                                                  >N</button>
                                                </>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : expandedCats.has(catKey) && (
                        <div className="ml-4 border-l border-border/50 pl-2">
                          {/* Header */}
                          <div className="grid grid-cols-12 gap-2 px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                            <div className="col-span-5">Permission</div>
                            <div className="col-span-2 text-center">Value</div>
                            <div className="col-span-1 text-center">Skip</div>
                            <div className="col-span-1 text-center">Negate</div>
                            <div className="col-span-3"></div>
                          </div>
                          {perms.map((perm) => {
                            const effective = getEffectiveValue(perm.permsid);
                            const isSet = effective !== null && effective.action !== 'remove';
                            const isChanged = changes.has(perm.permsid);
                            const isBoolean = perm.permsid.startsWith('b_');

                            return (
                              <div
                                key={perm.permsid}
                                className={cn(
                                  'grid grid-cols-12 gap-2 px-2 py-1 rounded-sm text-xs items-center group',
                                  isChanged && 'bg-primary/5',
                                  isSet ? 'text-foreground' : 'text-muted-foreground',
                                )}
                              >
                                <div className="col-span-5 truncate" title={perm.permdesc || perm.permsid}>
                                  <span className="font-mono-data text-[11px]">{perm.permsid}</span>
                                </div>
                                <div className="col-span-2 flex justify-center">
                                  {isBoolean ? (
                                    <button
                                      onClick={() => {
                                        if (isSet) removePerm(perm.permsid);
                                        else setPermValue(perm.permsid, 1, 0, 0);
                                      }}
                                      className={cn(
                                        'h-5 w-5 rounded-sm border flex items-center justify-center transition-colors',
                                        isSet
                                          ? 'bg-primary border-primary text-primary-foreground'
                                          : 'border-border hover:border-primary/50',
                                      )}
                                    >
                                      {isSet && <Check className="h-3 w-3" />}
                                    </button>
                                  ) : (
                                    <Input
                                      type="number"
                                      className="h-6 w-20 text-xs text-center font-mono-data px-1"
                                      value={effective?.permvalue ?? ''}
                                      placeholder="—"
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) {
                                          setPermValue(perm.permsid, val, effective?.permnegated || 0, effective?.permskip || 0);
                                        } else if (e.target.value === '') {
                                          removePerm(perm.permsid);
                                        }
                                      }}
                                    />
                                  )}
                                </div>
                                <div className="col-span-1 flex justify-center">
                                  {!isBoolean && supportsNegateSkip && (
                                    <button
                                      onClick={() => {
                                        if (!isSet) return;
                                        const newSkip = (effective?.permskip || 0) ? 0 : 1;
                                        setPermValue(perm.permsid, effective?.permvalue || 0, effective?.permnegated || 0, newSkip);
                                      }}
                                      className={cn(
                                        'h-4 w-4 rounded-sm border flex items-center justify-center text-[9px] transition-colors',
                                        isSet && effective?.permskip
                                          ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                                          : 'border-border/50',
                                      )}
                                      title="Skip"
                                    >
                                      {isSet && effective?.permskip ? 'S' : ''}
                                    </button>
                                  )}
                                </div>
                                <div className="col-span-1 flex justify-center">
                                  {!isBoolean && supportsNegateSkip && (
                                    <button
                                      onClick={() => {
                                        if (!isSet) return;
                                        const newNeg = (effective?.permnegated || 0) ? 0 : 1;
                                        setPermValue(perm.permsid, effective?.permvalue || 0, newNeg, effective?.permskip || 0);
                                      }}
                                      className={cn(
                                        'h-4 w-4 rounded-sm border flex items-center justify-center text-[9px] transition-colors',
                                        isSet && effective?.permnegated
                                          ? 'bg-destructive/20 border-destructive text-destructive'
                                          : 'border-border/50',
                                      )}
                                      title="Negate"
                                    >
                                      {isSet && effective?.permnegated ? 'N' : ''}
                                    </button>
                                  )}
                                </div>
                                <div className="col-span-3 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {isSet && (
                                    <button
                                      onClick={() => removePerm(perm.permsid)}
                                      className="p-0.5 rounded-sm hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                      title="Remove permission"
                                    >
                                      <Minus className="h-3 w-3" />
                                    </button>
                                  )}
                                  {isChanged && (
                                    <span className="text-[9px] text-primary font-mono-data">modified</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                  {categories.size === 0 && (
                    <div className="flex items-center justify-center h-[300px]">
                      <p className="text-sm text-muted-foreground">
                        {compareMode
                          ? showDifferingOnly
                            ? 'No permissions differ across the selected entities'
                            : showModifiedOnly
                              ? 'No permissions are set on any selected entity'
                              : 'No permissions match your search'
                          : showModifiedOnly
                            ? 'No permissions are set on this entity'
                            : 'No permissions match your search'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
