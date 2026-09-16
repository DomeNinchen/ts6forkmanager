import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import {
  Lock, Search, ChevronRight, ChevronDown, Shield, Users, Hash, User, UserCog, Save,
  X, Check, Minus, Plus, Columns3, Upload, FileText, Layers,
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

// How permoverview labels each row's source. The id fields differ per tier:
// channel groups report the CHANNEL in id1 and the group in id2, and
// channel-client reports channel then client. That was read off a real
// server's responses rather than assumed - permfind, by contrast, reports
// channel groups with id1=0, so the two commands genuinely disagree there.
//
// `rank` is the tier number from TeamSpeak's own permission documentation,
// the copy shipped alongside the server itself (doc/server/permissiondoc.txt),
// which is the authority here: a higher tier overwrites a lower one. Be aware
// that documentation found online sometimes states a different, incompatible
// order (client highest, channel-client third) - that order is wrong, and an
// earlier version of this file shipped it before the bundled docs settled it.
const OVERVIEW_TIER_OF: Record<number, { rank: number; key: PermLayer; label: string }> = {
  0: { rank: 1, key: 'server-group', label: 'Server Group' },
  1: { rank: 2, key: 'client', label: 'Client' },
  2: { rank: 3, key: 'channel', label: 'Channel' },
  3: { rank: 4, key: 'channel-group', label: 'Channel Group' },
  4: { rank: 5, key: 'channel-client', label: 'Client in Channel' },
};

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

  // Compare mode: curated row set (starts at "power" permissions, grown via
  // Add Perm), file-loaded read-only comparison columns (Add Target), and
  // the currently-pinned reference cell for the relative color scheme.
  const [permLabelMode, setPermLabelMode] = useState<'simple' | 'advanced'>('advanced');
  const [comparePermIds, setComparePermIds] = useState<Set<string> | null>(null);
  const [showAddPerm, setShowAddPerm] = useState(false);
  const [addPermSearch, setAddPermSearch] = useState('');
  const [addPermCat, setAddPermCat] = useState('all');
  const [fileTargets, setFileTargets] = useState<{ id: string; name: string; permissions: Map<string, PermValue> }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [colorPivot, setColorPivot] = useState<{ colKey: string; permsid: string } | null>(null);

  // Find Permission: a reverse lookup (pick a permission, see everywhere it's
  // assigned across all 5 tiers). Sits alongside the tier tabs rather than
  // being one of them - it replaces the whole select/edit layout while active.
  // The tier tabs edit permissions; Find and Overview replace that whole
  // layout with their own, so they're modes rather than a sixth/seventh tier.
  const [mode, setMode] = useState<'edit' | 'find' | 'overview'>('edit');
  const findMode = mode === 'find';
  const overviewMode = mode === 'overview';
  const setFindMode = (on: boolean) => setMode(on ? 'find' : 'edit');
  const [findPermsid, setFindPermsid] = useState('');
  const [findSearch, setFindSearch] = useState('');
  // Permission Overview: one client, in one channel, with every tier that
  // contributes to each of their permissions.
  const [ovClient, setOvClient] = useState<string>('');
  const [ovChannel, setOvChannel] = useState<string>('');
  const [ovSearch, setOvSearch] = useState('');
  // Set only immediately before a layer change that a result click triggers,
  // so the layer-reset effect below can select the jumped-to entity instead of
  // clearing the selection it just made.
  const jumpRef = useRef<{ layer: PermLayer; key: string; ccName?: { channelName: string; clientName: string } } | null>(null);

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

  // Fetch entity lists for selectors. Find mode needs all of them at once, to
  // turn the bare ids permfind returns back into real names.
  const { data: serverGroups } = useQuery({
    queryKey: ['server-groups', c, s],
    queryFn: () => permissionsApi.serverGroups(c!, s!),
    enabled: !!c && !!s && (layer === 'server-group' || findMode || overviewMode),
  });
  const { data: channelGroups } = useQuery({
    queryKey: ['channel-groups', c, s],
    queryFn: () => permissionsApi.channelGroups(c!, s!),
    enabled: !!c && !!s && (layer === 'channel-group' || findMode || overviewMode),
  });
  const { data: channels } = useQuery({
    queryKey: ['channels-for-perms', c, s],
    queryFn: () => permissionsApi.channels(c!, s!),
    enabled: !!c && !!s && (layer === 'channel' || layer === 'channel-client' || findMode || overviewMode),
  });
  const { data: clients } = useQuery({
    queryKey: ['clients-for-perms', c, s],
    queryFn: () => permissionsApi.clients(c!, s!),
    enabled: !!c && !!s && (layer === 'client' || layer === 'channel-client' || findMode || overviewMode),
  });
  const { data: offlineClients } = useQuery({
    queryKey: ['clients-db-for-perms', c, s],
    queryFn: () => permissionsApi.clientsDatabase(c!, s!),
    // Always in find/overview mode - a permission can sit on a client who
    // isn't online, and an overview is just as valid for an offline client.
    enabled: !!c && !!s && (((layer === 'client' || layer === 'channel-client') && showOffline) || findMode || overviewMode),
  });

  // Fetch current entity permissions
  const { data: entityPerms, isLoading: loadingPerms } = useQuery({
    queryKey: ['entity-perms', c, s, layer, entityKey],
    queryFn: () => (c && s && entityKey ? fetchPerms(layer, c, s, entityKey) : []),
    enabled: !!c && !!s && !!entityKey,
  });

  // Reset entity when layer changes - unless the change came from clicking a
  // Find Permission result, in which case select what was clicked instead.
  useEffect(() => {
    const jump = jumpRef.current;
    jumpRef.current = null;
    setChanges(new Map());
    setCompareChanges(new Map());
    setCompareMode(false);
    setCcChannel('');
    setComparePermIds(null);
    setFileTargets([]);
    setColorPivot(null);
    if (jump && jump.layer === layer) {
      setSelectedIds(new Set([jump.key]));
      setCcNames(jump.ccName ? new Map([[jump.key, jump.ccName]]) : new Map());
    } else {
      setSelectedIds(new Set());
      setCcNames(new Map());
    }
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

  // Entering Compare starts with every permission shown (narrow down via
  // Add/Remove Perm), and clears any pinned color reference from a prior visit.
  useEffect(() => {
    if (compareMode) {
      setComparePermIds(new Set(allPerms.map((p) => p.permsid)));
      setColorPivot(null);
    } else {
      setFileTargets([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  // Build permid → permname lookup (entity perms only return numeric permid)
  const permIdToName = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of allPerms) {
      map.set(p.permid, p.permsid);
    }
    return map;
  }, [allPerms]);

  // Find Permission: permfind only reports WHERE a permission is assigned
  // ({t, id1, id2, p}) and never its value, so each hit's value is fetched
  // separately below - reusing the exact query keys the editor itself uses, so
  // a hit you then open is already cached. The t → tier mapping below was
  // confirmed live against a real server rather than assumed from symmetry:
  // channel groups carry their id in id2, with id1 always 0, unlike every
  // other tier.
  const { data: findRaw, isFetching: findFetching } = useQuery({
    queryKey: ['perm-find', c, s, findPermsid],
    queryFn: () => permissionsApi.find(c!, s!, findPermsid),
    enabled: !!c && !!s && !!findPermsid && findMode,
  });

  const findHits = useMemo(() => {
    if (!Array.isArray(findRaw)) return [] as { layer: PermLayer; key: string }[];
    const hits = findRaw
      .map((r: any) => {
        const id1 = String(Number(r.id1));
        const id2 = String(Number(r.id2));
        switch (Number(r.t)) {
          case 0: return { layer: 'server-group' as PermLayer, key: id1 };
          case 1: return { layer: 'client' as PermLayer, key: id1 };
          case 2: return { layer: 'channel' as PermLayer, key: id1 };
          case 3: return { layer: 'channel-group' as PermLayer, key: id2 };
          case 4: return { layer: 'channel-client' as PermLayer, key: `${id1}:${id2}` };
          default: return null;
        }
      })
      .filter((h): h is { layer: PermLayer; key: string } => h !== null);
    const order = LAYERS.map((l) => l.key);
    return hits.sort(
      (a, b) => order.indexOf(a.layer) - order.indexOf(b.layer) || Number(a.key.split(':')[0]) - Number(b.key.split(':')[0]),
    );
  }, [findRaw]);

  const findValueQueries = useQueries({
    queries: findMode
      ? findHits.map((h) => ({
          queryKey: ['entity-perms', c, s, h.layer, h.key],
          queryFn: () => fetchPerms(h.layer, c!, s!, h.key),
          enabled: !!c && !!s,
        }))
      : [],
  });

  // Permission Overview: every tier that contributes to this client's
  // permissions in this channel. Rows carry the value (v/n/s), and the same
  // permission appears once per contributing tier - confirmed live by setting
  // a permission a server group already granted directly on the client too
  // and watching the overview return both rows.
  const { data: overviewRaw, isFetching: overviewFetching } = useQuery({
    queryKey: ['perm-overview', c, s, ovClient, ovChannel],
    queryFn: () => permissionsApi.overview(c!, s!, Number(ovClient), Number(ovChannel)),
    enabled: !!c && !!s && !!ovClient && !!ovChannel && overviewMode,
  });

  const overviewRows = useMemo(() => {
    if (!Array.isArray(overviewRaw)) return [];
    return (overviewRaw as any[]).map((r) => ({
      tier: OVERVIEW_TIER_OF[Number(r.t)] ?? null,
      id1: String(Number(r.id1)),
      id2: String(Number(r.id2)),
      permsid: permIdToName.get(Number(r.p)) ?? `permid_${r.p}`,
      permvalue: Number(r.v) || 0,
      permnegated: Number(r.n) || 0,
      permskip: Number(r.s) || 0,
    })).filter((r) => r.tier !== null);
  }, [overviewRaw, permIdToName]);

  // Group by permission, then work out which source actually applies, per
  // doc/server/permissiondoc.txt shipped with the server:
  //  - within one tier (a client in several server groups, say) the highest
  //    value wins, except that negated entries take over and the LOWEST of
  //    those wins - that's how a restrictive "Sticky"-style group claws a
  //    permission back from a group that grants it;
  //  - across tiers the highest tier wins;
  //  - except that a skip flag on a server group (1) or client (2) entry
  //    shields it from being altered by the channel (3) and channel group (4)
  //    layers. Tier 5 still overrides it - the docs only name 3 and 4.
  // Every source stays visible in the UI regardless, so the result can be
  // checked by eye rather than taken on trust.
  const overviewResolved = useMemo(() => {
    const byPerm = new Map<string, typeof overviewRows>();
    for (const r of overviewRows) {
      if (!byPerm.has(r.permsid)) byPerm.set(r.permsid, []);
      byPerm.get(r.permsid)!.push(r);
    }
    const pickWithinTier = (list: typeof overviewRows) => {
      const negated = list.filter((r) => r.permnegated);
      const pool = negated.length ? negated : list;
      return pool.reduce((best, r) =>
        negated.length ? (r.permvalue < best.permvalue ? r : best) : (r.permvalue > best.permvalue ? r : best));
    };
    return [...byPerm.entries()].map(([permsid, sources]) => {
      const perTier = new Map<number, typeof overviewRows[number]>();
      for (const rank of new Set(sources.map((r) => r.tier!.rank))) {
        perTier.set(rank, pickWithinTier(sources.filter((r) => r.tier!.rank === rank)));
      }
      const shielded = [1, 2].some((t) => perTier.get(t)?.permskip);
      const ranks = [...perTier.keys()].filter((t) => !(shielded && (t === 3 || t === 4)));
      const winner = perTier.get(Math.max(...ranks))!;
      return { permsid, sources, winner, shielded };
    }).sort((a, b) => a.permsid.localeCompare(b.permsid));
  }, [overviewRows]);

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
  // Every comparison column, live entities plus file-loaded read-only ones
  const allCompareCols = useMemo(() => [...selectedIds, ...fileTargets.map((t) => t.id)], [selectedIds, fileTargets]);
  const isFileTargetCol = useCallback((colKey: string) => fileTargets.some((t) => t.id === colKey), [fileTargets]);

  // Single source of truth for "what value does this cell currently show" -
  // a pending edit, then live server data, then a file target's own data.
  // A pending removal resolves to null, same as never having been set.
  const getCellValue = useCallback((colKey: string, permsid: string): PermValue | null => {
    const fileTarget = fileTargets.find((t) => t.id === colKey);
    if (fileTarget) return fileTarget.permissions.get(permsid) ?? null;
    const pending = compareChanges.get(colKey)?.get(permsid);
    if (pending) return pending.action === 'remove' ? null : pending;
    return compareData.get(colKey)?.get(permsid) ?? null;
  }, [fileTargets, compareChanges, compareData]);

  const permSignature = useCallback((permsid: string, key: string): string => {
    const v = getCellValue(key, permsid);
    return v ? `${v.permvalue}:${v.permnegated}:${v.permskip}` : 'unset';
  }, [getCellValue]);

  const permDiffers = useCallback((permsid: string): boolean => {
    const sigs = allCompareCols.map((key) => permSignature(permsid, key));
    return new Set(sigs).size > 1;
  }, [allCompareCols, permSignature]);

  const isSetForAny = useCallback((permsid: string): boolean => {
    return allCompareCols.some((key) => getCellValue(key, permsid) !== null);
  }, [allCompareCols, getCellValue]);

  const getCompareEffectiveValue = useCallback((key: string, permsid: string): PendingChange | null => {
    const v = getCellValue(key, permsid);
    return v ? { ...v, action: 'set' } : null;
  }, [getCellValue]);

  // Click a cell to pin it as the reference; every other cell in that same
  // permission row then colors relative to it (blue = pivot itself,
  // teal = lower, lime = same, red = higher, pink = no value).
  const cellColorClass = useCallback((colKey: string, permsid: string): string => {
    if (!colorPivot || colorPivot.permsid !== permsid) return '';
    if (colorPivot.colKey === colKey) return 'bg-blue-500/15 ring-1 ring-inset ring-blue-500';
    const v = getCellValue(colKey, permsid);
    if (!v) return 'bg-pink-500/10';
    const pivotV = getCellValue(colorPivot.colKey, permsid);
    if (!pivotV) return '';
    if (v.permvalue < pivotV.permvalue) return 'bg-teal-500/10';
    if (v.permvalue > pivotV.permvalue) return 'bg-red-500/10';
    return 'bg-lime-500/10';
  }, [colorPivot, getCellValue]);

  // With 3 or fewer entities compared, every row auto-colors by rank
  // instead of needing a click: highest = red, lowest = green, tied or
  // in-between = yellow, unset = pink. Replaces the pivot scheme entirely
  // while active (manual pivot-clicking still updates colorPivot, it's
  // just not read) - with more than 3 entities there's no clean single
  // "highest/lowest" per row across that many columns, so the manual
  // pivot-relative scheme takes over instead.
  const autoRankMode = compareMode && selectedIds.size <= 3;
  const autoRankColorClass = useCallback((colKey: string, permsid: string): string => {
    const v = getCellValue(colKey, permsid);
    if (!v) return 'bg-pink-500/10';
    const values = allCompareCols
      .map((k) => getCellValue(k, permsid)?.permvalue)
      .filter((n): n is number => n !== undefined && n !== null);
    if (values.length < 2) return '';
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max === min) return 'bg-yellow-500/10';
    if (v.permvalue === max) return 'bg-red-500/10';
    if (v.permvalue === min) return 'bg-green-500/10';
    return 'bg-yellow-500/10';
  }, [allCompareCols, getCellValue]);

  const toggleComparePerm = useCallback((permsid: string) => {
    setComparePermIds((prev) => {
      const next = new Set(prev ?? []);
      next.has(permsid) ? next.delete(permsid) : next.add(permsid);
      return next;
    });
  }, []);

  // Add/Remove Perm dialog: category tabs + search narrow down which perms
  // are offered, "Select all" acts on exactly that narrowed-down set.
  const addPermCatKeys = useMemo(() => {
    const present = new Set(allPerms.map((p) => getCategoryKey(p.permsid)));
    return Object.keys(PERM_CATEGORIES).filter((k) => present.has(k));
  }, [allPerms]);
  const addPermVisible = useMemo(() => {
    let list = allPerms;
    if (addPermCat !== 'all') list = list.filter((p) => getCategoryKey(p.permsid) === addPermCat);
    if (addPermSearch) {
      const q = addPermSearch.toLowerCase();
      list = list.filter((p) => p.permsid.toLowerCase().includes(q) || p.permdesc.toLowerCase().includes(q));
    }
    return list;
  }, [allPerms, addPermCat, addPermSearch]);
  const allVisibleSelected = addPermVisible.length > 0 && addPermVisible.every((p) => comparePermIds?.has(p.permsid));
  const toggleSelectAllVisible = useCallback(() => {
    setComparePermIds((prev) => {
      const next = new Set(prev ?? []);
      const allSelected = addPermVisible.length > 0 && addPermVisible.every((p) => next.has(p.permsid));
      if (allSelected) addPermVisible.forEach((p) => next.delete(p.permsid));
      else addPermVisible.forEach((p) => next.add(p.permsid));
      return next;
    });
  }, [addPermVisible]);

  const handleLoadFileTarget = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (payload.format !== 'ts6manager-group-export' || !Array.isArray(payload.groups)) {
        toast.error('Not a valid group export file');
        return;
      }
      const loaded = payload.groups.map((g: any, i: number) => ({
        id: `file:${file.name}:${i}:${Date.now()}`,
        name: g.name,
        permissions: new Map<string, PermValue>(
          (g.permissions || []).map((p: any) => [p.permsid, {
            permsid: p.permsid, permvalue: Number(p.permvalue) || 0,
            permnegated: Number(p.permnegated) || 0, permskip: Number(p.permskip) || 0,
          }]),
        ),
      }));
      setFileTargets((prev) => [...prev, ...loaded]);
      toast.success(`Loaded ${loaded.length} group(s) from file`);
    } catch {
      toast.error('Failed to read file - check it is a valid export');
    }
  }, []);

  const removeFileTarget = useCallback((id: string) => {
    setFileTargets((prev) => prev.filter((t) => t.id !== id));
  }, []);

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
      // Curated row set (started from "power" permissions, grown via Add
      // Perm) rather than the full list - matches how the reference tool's
      // own Compare view works, instead of "everything, filter it down".
      if (comparePermIds) filtered = filtered.filter((p) => comparePermIds.has(p.permsid));
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
  }, [allPerms, search, showModifiedOnly, showDifferingOnly, compareMode, comparePermIds, currentPerms, changes, isSetForAny, permDiffers]);

  // Advanced shows the raw technical permsid (e.g. b_virtualserver_create);
  // Simple shows TeamSpeak's own human-readable permdesc instead where one
  // exists - the mechanical "Needed Powers" permissions have none, so those
  // fall back to the permsid either way. The tooltip always surfaces
  // whichever of the two isn't the current main label.
  const permLabel = useCallback((p: { permsid: string; permdesc: string }): string => {
    if (permLabelMode === 'simple' && p.permdesc) return p.permdesc;
    return p.permsid;
  }, [permLabelMode]);
  const permTooltip = useCallback((p: { permsid: string; permdesc: string }): string => {
    if (permLabelMode === 'simple' && p.permdesc) return p.permsid;
    return p.permdesc || p.permsid;
  }, [permLabelMode]);

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

  // Overview picks its own client list rather than reusing `entities`, which
  // is scoped to whichever tier tab is active behind the overlay.
  const overviewClients = (() => {
    const online = (Array.isArray(clients) ? clients : [])
      .filter((cl: any) => String(cl.client_type) === '0')
      .map((cl: any) => ({ id: String(cl.client_database_id), name: cl.client_nickname, online: true }));
    const onlineIds = new Set(online.map((o) => o.id));
    const offline = (Array.isArray(offlineClients) ? offlineClients : [])
      .filter((cl: any) => !onlineIds.has(String(cl.cldbid)))
      .map((cl: any) => ({ id: String(cl.cldbid), name: cl.client_nickname || `Client #${cl.cldbid}`, online: false }));
    return [...online, ...offline]
      .sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1))
      .filter((cl) => !entitySearch || cl.name.toLowerCase().includes(entitySearch.toLowerCase()));
  })();

  const entityName = (key: string): string => {
    if (layer === 'channel-client') {
      const info = ccNames.get(key);
      return info ? `${info.clientName} @ ${info.channelName}` : key;
    }
    return entities.find((e: any) => e.id === key)?.name || key;
  };

  // Find Permission needs names for every tier at once, not just the current
  // one, so it can't reuse entityName above (which is scoped to `layer`).
  const channelNameOf = (cid: string) =>
    (Array.isArray(channels) ? channels : []).find((ch: any) => String(ch.cid) === cid)?.channel_name || `Channel #${cid}`;
  const clientNameOf = (cldbid: string) =>
    (Array.isArray(clients) ? clients : []).find((cl: any) => String(cl.client_database_id) === cldbid)?.client_nickname
    || (Array.isArray(offlineClients) ? offlineClients : []).find((cl: any) => String(cl.cldbid) === cldbid)?.client_nickname
    || `Client #${cldbid}`;

  const findHitName = (hit: { layer: PermLayer; key: string }): string => {
    switch (hit.layer) {
      case 'server-group':
        return (Array.isArray(serverGroups) ? serverGroups : []).find((g: any) => String(g.sgid) === hit.key)?.name || `Server Group #${hit.key}`;
      case 'channel-group':
        return (Array.isArray(channelGroups) ? channelGroups : []).find((g: any) => String(g.cgid) === hit.key)?.name || `Channel Group #${hit.key}`;
      case 'channel':
        return channelNameOf(hit.key);
      case 'client':
        return clientNameOf(hit.key);
      case 'channel-client': {
        const [cid, cldbid] = hit.key.split(':');
        return `${clientNameOf(cldbid)} @ ${channelNameOf(cid)}`;
      }
    }
  };

  const overviewSourceName = (row: { tier: { key: PermLayer } | null; id1: string; id2: string }): string => {
    switch (row.tier?.key) {
      case 'server-group':
        return (Array.isArray(serverGroups) ? serverGroups : []).find((g: any) => String(g.sgid) === row.id1)?.name || `#${row.id1}`;
      case 'channel-group': {
        const name = (Array.isArray(channelGroups) ? channelGroups : []).find((g: any) => String(g.cgid) === row.id2)?.name || `#${row.id2}`;
        return `${name} in ${channelNameOf(row.id1)}`;
      }
      case 'channel':
        return channelNameOf(row.id1);
      case 'client':
        return clientNameOf(row.id1);
      case 'channel-client':
        return `${clientNameOf(row.id2)} @ ${channelNameOf(row.id1)}`;
      default:
        return `#${row.id1}`;
    }
  };

  const findValueAt = (i: number): PermValue | null => {
    const raw = findValueQueries[i]?.data;
    if (!Array.isArray(raw)) return null;
    for (const p of raw as any[]) {
      const name = p.permsid || p.permname || permIdToName.get(Number(p.permid));
      if (name === findPermsid) {
        return {
          permsid: findPermsid,
          permvalue: Number(p.permvalue) || 0,
          permnegated: Number(p.permnegated) || 0,
          permskip: Number(p.permskip) || 0,
        };
      }
    }
    return null;
  };

  // Open a result in the editor. Setting the layer normally wipes the
  // selection via the reset effect, so hand the target over through jumpRef
  // for it to apply instead - except when the layer isn't changing at all, in
  // which case that effect never runs and the selection is set directly.
  const jumpToHit = (hit: { layer: PermLayer; key: string }) => {
    const ccName = hit.layer === 'channel-client'
      ? (() => {
          const [cid, cldbid] = hit.key.split(':');
          return { channelName: channelNameOf(cid), clientName: clientNameOf(cldbid) };
        })()
      : undefined;
    setFindMode(false);
    if (hit.layer !== layer) {
      jumpRef.current = { layer: hit.layer, key: hit.key, ccName };
      setLayer(hit.layer);
    } else {
      setSelectedIds(new Set([hit.key]));
      if (ccName) setCcNames((prev) => new Map(prev).set(hit.key, ccName));
      setChanges(new Map());
      setCompareChanges(new Map());
    }
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
            onClick={() => { setLayer(key); setFindMode(false); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              layer === key && !findMode
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <div className="w-px bg-border/50 my-1 mx-1" />
        <button
          onClick={() => setMode('find')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            findMode
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Search className="h-3.5 w-3.5" />
          Find Permission
        </button>
        <button
          onClick={() => setMode('overview')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            overviewMode
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          Permission Overview
        </button>
      </div>

      {overviewMode ? (
        <div className="grid grid-cols-12 gap-4">
          {/* Client picker */}
          <Card className="card-hero col-span-3">
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Select Client
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={entitySearch}
                  onChange={(e) => setEntitySearch(e.target.value)}
                  placeholder="Search clients..."
                  className="h-7 pl-7 text-xs"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <div className="p-2 space-y-0.5">
                  {overviewClients.map((cl) => (
                    <button
                      key={cl.id}
                      onClick={() => setOvClient(cl.id)}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2',
                        ovClient === cl.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50',
                      )}
                    >
                      <span
                        className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', cl.online ? 'bg-emerald-500' : 'bg-zinc-500')}
                        title={cl.online ? 'Online' : 'Offline'}
                      />
                      <span className="truncate flex-1">{cl.name}</span>
                      <span className="text-[10px] font-mono-data text-muted-foreground">#{cl.id}</span>
                    </button>
                  ))}
                  {overviewClients.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No clients found</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Resolved permissions */}
          <Card className="card-hero col-span-9">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Permission Overview
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={ovChannel} onValueChange={setOvChannel}>
                    <SelectTrigger className="h-8 text-xs w-56"><SelectValue placeholder="Choose a channel..." /></SelectTrigger>
                    <SelectContent>
                      {(Array.isArray(channels) ? channels : []).map((ch: any) => (
                        <SelectItem key={ch.cid} value={String(ch.cid)}>{ch.channel_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="relative w-56">
                    <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={ovSearch}
                      onChange={(e) => setOvSearch(e.target.value)}
                      placeholder="Search permissions..."
                      className="pl-7 h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                Every permission this client actually has in the chosen channel, and which layer each one comes from. Where
                several layers grant the same permission, the winning one is highlighted, following the tier order in
                TeamSpeak's own permission documentation: client-in-channel beats channel group, beats channel, beats
                client, beats server group - with a Skip flag on a server group or client entry shielding it from the
                channel and channel group layers. The other sources stay listed so the result can always be checked by eye.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {!ovClient || !ovChannel ? (
                  <div className="flex items-center justify-center h-[400px]">
                    <p className="text-sm text-muted-foreground">
                      {!ovClient ? 'Select a client from the left panel' : 'Choose a channel to see their permissions in it'}
                    </p>
                  </div>
                ) : overviewFetching ? (
                  <div className="flex items-center justify-center h-[400px]"><PageLoader /></div>
                ) : overviewResolved.length === 0 ? (
                  <div className="flex items-center justify-center h-[400px]">
                    <p className="text-sm text-muted-foreground">No permissions apply to this client in this channel</p>
                  </div>
                ) : (
                  <div className="px-3 pb-3">
                    <div className="grid grid-cols-12 gap-2 px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                      <div className="col-span-6">Permission</div>
                      <div className="col-span-4">Comes From</div>
                      <div className="col-span-2 text-center">Value</div>
                    </div>
                    {overviewResolved
                      .filter((row) => {
                        if (!ovSearch) return true;
                        const q = ovSearch.toLowerCase();
                        const def = allPerms.find((p) => p.permsid === row.permsid);
                        return row.permsid.toLowerCase().includes(q) || (def?.permdesc.toLowerCase().includes(q) ?? false);
                      })
                      .map((row) => {
                        const def = allPerms.find((p) => p.permsid === row.permsid)
                          ?? { permsid: row.permsid, permdesc: '', permid: 0 };
                        const isBoolean = row.permsid.startsWith('b_');
                        const contested = row.sources.length > 1;
                        return (
                          <div key={row.permsid} className="grid grid-cols-12 gap-2 px-2 py-1.5 rounded-sm text-xs items-start border-t border-border/30">
                            <div className="col-span-6 truncate" title={permTooltip(def)}>
                              <span className={cn('text-[11px]', permLabelMode === 'advanced' && 'font-mono-data')}>
                                {permLabel(def)}
                              </span>
                            </div>
                            <div className="col-span-4 space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{row.winner.tier!.label}</Badge>
                                <span className="truncate text-muted-foreground">{overviewSourceName(row.winner)}</span>
                              </div>
                              {contested && row.sources.filter((sc) => sc !== row.winner).map((sc, i) => (
                                <div key={i} className="flex items-center gap-1.5 opacity-50 line-through">
                                  <span className="text-[9px] text-muted-foreground">{sc.tier!.label}</span>
                                  <span className="truncate text-muted-foreground text-[10px]">{overviewSourceName(sc)}</span>
                                  <span className="font-mono-data text-[10px] text-muted-foreground">{sc.permvalue}</span>
                                </div>
                              ))}
                            </div>
                            <div className="col-span-2 flex items-center justify-center gap-1">
                              {isBoolean && row.winner.permvalue === 1 ? (
                                <Check className={cn('h-3.5 w-3.5', row.winner.permnegated ? 'text-destructive' : 'text-primary')} />
                              ) : (
                                <span className={cn('font-mono-data', row.winner.permnegated && 'text-destructive')}>
                                  {row.winner.permvalue}
                                </span>
                              )}
                              {row.winner.permnegated ? <sup className="text-destructive text-[9px]">N</sup> : null}
                              {row.winner.permskip ? <sup className="text-amber-400 text-[9px]">S</sup> : null}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      ) : findMode ? (
        <div className="grid grid-cols-12 gap-4">
          {/* Permission picker */}
          <Card className="card-hero col-span-3">
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Select Permission
              </CardTitle>
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={findSearch}
                  onChange={(e) => setFindSearch(e.target.value)}
                  placeholder="Search permissions..."
                  className="h-7 pl-7 text-xs"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <div className="p-2 space-y-0.5">
                  {allPerms
                    .filter((p) => {
                      if (!findSearch) return true;
                      const q = findSearch.toLowerCase();
                      return p.permsid.toLowerCase().includes(q) || p.permdesc.toLowerCase().includes(q);
                    })
                    .slice(0, 300)
                    .map((p) => (
                      <button
                        key={p.permsid}
                        onClick={() => setFindPermsid(p.permsid)}
                        title={permTooltip(p)}
                        className={cn(
                          'w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors truncate',
                          findPermsid === p.permsid ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50',
                          permLabelMode === 'advanced' && 'font-mono-data',
                        )}
                      >
                        {permLabel(p)}
                      </button>
                    ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Results */}
          <Card className="card-hero col-span-9">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {findPermsid
                  ? `Assignments of ${permLabel(allPerms.find((p) => p.permsid === findPermsid) ?? { permsid: findPermsid, permdesc: '' })}`
                  : 'Find Permission'}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground pt-1">
                Pick a permission on the left to see every place it's actually assigned, across all five tiers. Click a
                result to open it in the editor. TeamSpeak's own lookup only reports where a permission is set, not to
                what - each value below is read back per entity afterwards.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {!findPermsid ? (
                  <div className="flex items-center justify-center h-[400px]">
                    <p className="text-sm text-muted-foreground">Select a permission from the left panel</p>
                  </div>
                ) : findFetching ? (
                  <div className="flex items-center justify-center h-[400px]"><PageLoader /></div>
                ) : findHits.length === 0 ? (
                  <div className="flex items-center justify-center h-[400px]">
                    <p className="text-sm text-muted-foreground">This permission isn't assigned anywhere on this server</p>
                  </div>
                ) : (
                  <div className="px-3 pb-3">
                    <div className="grid grid-cols-12 gap-2 px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                      <div className="col-span-3">Tier</div>
                      <div className="col-span-6">Assigned To</div>
                      <div className="col-span-3 text-center">Value</div>
                    </div>
                    {findHits.map((hit, i) => {
                      const tier = LAYERS.find((l) => l.key === hit.layer)!;
                      const TierIcon = tier.icon;
                      const val = findValueAt(i);
                      const loading = findValueQueries[i]?.isLoading;
                      const isBoolean = findPermsid.startsWith('b_');
                      return (
                        <button
                          key={`${hit.layer}:${hit.key}`}
                          onClick={() => jumpToHit(hit)}
                          className="grid grid-cols-12 gap-2 px-2 py-1.5 rounded-sm text-xs items-center w-full text-left hover:bg-muted/50 transition-colors group"
                          title="Open in editor"
                        >
                          <div className="col-span-3 flex items-center gap-1.5 text-muted-foreground">
                            <TierIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{tier.label}</span>
                          </div>
                          <div className="col-span-6 flex items-center gap-1.5 truncate">
                            <span className="truncate">{findHitName(hit)}</span>
                            <span className="text-[10px] font-mono-data text-muted-foreground shrink-0">#{hit.key}</span>
                          </div>
                          <div className="col-span-3 flex items-center justify-center gap-1">
                            {loading ? (
                              <span className="text-muted-foreground">…</span>
                            ) : !val ? (
                              <span className="text-muted-foreground">–</span>
                            ) : isBoolean ? (
                              <Check className={cn('h-3.5 w-3.5', val.permnegated ? 'text-destructive' : 'text-primary')} />
                            ) : (
                              <span className={cn('font-mono-data', val.permnegated && 'text-destructive')}>
                                {val.permvalue}
                                {val.permskip ? <sup className="text-amber-400 ml-0.5">S</sup> : null}
                              </span>
                            )}
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      ) : (
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
                  <div className="flex items-center gap-1 p-0.5 bg-muted/30 rounded-md w-fit" title="Advanced shows the raw permission name, Simple shows TeamSpeak's own plain-language description">
                    <button
                      onClick={() => setPermLabelMode('advanced')}
                      className={cn(
                        'px-2 py-1 rounded-sm text-xs font-medium transition-colors',
                        permLabelMode === 'advanced' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      Advanced
                    </button>
                    <button
                      onClick={() => setPermLabelMode('simple')}
                      className={cn(
                        'px-2 py-1 rounded-sm text-xs font-medium transition-colors',
                        permLabelMode === 'simple' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      Simple
                    </button>
                  </div>
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
                  {compareMode && (
                    <>
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowAddPerm(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add/Remove Perm
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-3.5 w-3.5 mr-1" /> Add Target
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLoadFileTarget(f); e.target.value = ''; }}
                      />
                    </>
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
                {autoRankMode
                  ? 'All permissions are shown by default ("Add/Remove Perm" to narrow down, the × on a row to drop it) - edit a cell to change just that one entity. With 3 or fewer entities, each row colors by rank automatically: red = highest, yellow = tied/middle, green = lowest, pink = unset.'
                  : 'All permissions are shown by default ("Add/Remove Perm" to narrow down, the × on a row to drop it) - edit a cell to change just that one entity. Click a cell to pin it as the reference; the rest of that row colors relative to it (teal = lower, lime = same, red = higher, pink = unset).'}
                {' '}"Add Target" loads a previously-exported group file as a read-only extra column. Use Bulk Apply instead to push the same value to all selected entities at once.
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
                                {allCompareCols.map((key) => {
                                  const isFile = isFileTargetCol(key);
                                  const name = isFile ? (fileTargets.find((t) => t.id === key)?.name ?? key) : entityName(key);
                                  return (
                                    <th
                                      key={key}
                                      className="px-2 py-1 text-center font-normal truncate max-w-[120px]"
                                      title={name}
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        {isFile && <FileText className="h-3 w-3 text-muted-foreground shrink-0" />}
                                        {name}
                                        {isFile && (
                                          <button onClick={() => removeFileTarget(key)} title="Remove this file target">
                                            <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                                          </button>
                                        )}
                                      </span>
                                    </th>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {perms.map((perm) => {
                                const isBoolean = perm.permsid.startsWith('b_');
                                const differs = permDiffers(perm.permsid);
                                return (
                                  <tr key={perm.permsid} className={cn('border-t border-border/30 group', differs && 'bg-amber-500/5')}>
                                    <td className="px-2 py-1 sticky left-0 bg-card truncate" title={permTooltip(perm)}>
                                      <span className="inline-flex items-center gap-1">
                                        <span className={cn('text-[11px]', permLabelMode === 'advanced' && 'font-mono-data')}>{permLabel(perm)}</span>
                                        <button
                                          onClick={() => toggleComparePerm(perm.permsid)}
                                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                                          title="Remove from comparison"
                                        >
                                          <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                                        </button>
                                      </span>
                                    </td>
                                    {allCompareCols.map((key) => {
                                      const isFile = isFileTargetCol(key);
                                      const effective = getCompareEffectiveValue(key, perm.permsid);
                                      const isSet = effective !== null;
                                      const isChanged = !isFile && (compareChanges.get(key)?.has(perm.permsid) ?? false);
                                      const pivotCls = autoRankMode ? autoRankColorClass(key, perm.permsid) : cellColorClass(key, perm.permsid);
                                      const setPivotHere = () => setColorPivot({ colKey: key, permsid: perm.permsid });
                                      return (
                                        <td
                                          key={key}
                                          onClick={isFile ? () => setColorPivot(isSet ? { colKey: key, permsid: perm.permsid } : null) : undefined}
                                          className={cn('px-1 py-1 text-center', isFile && 'cursor-pointer', isChanged && 'bg-primary/5', pivotCls)}
                                        >
                                          {isFile ? (
                                            !effective ? (
                                              <span className="text-muted-foreground">–</span>
                                            ) : isBoolean ? (
                                              <Check className={cn('h-3 w-3 inline', effective.permnegated ? 'text-destructive' : 'text-primary')} />
                                            ) : (
                                              <span className={cn('font-mono-data', effective.permnegated && 'text-destructive')}>
                                                {effective.permvalue}
                                                {effective.permskip ? <sup className="text-amber-400 ml-0.5">S</sup> : null}
                                              </span>
                                            )
                                          ) : isBoolean ? (
                                            <button
                                              onClick={() => {
                                                setPivotHere();
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
                                                onFocus={setPivotHere}
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
                                                      setPivotHere();
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
                                                      setPivotHere();
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
                                <div className="col-span-5 truncate" title={permTooltip(perm)}>
                                  <span className={cn('text-[11px]', permLabelMode === 'advanced' && 'font-mono-data')}>{permLabel(perm)}</span>
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
      )}

      <Dialog open={showAddPerm} onOpenChange={setShowAddPerm}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Add/Remove Perm</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={addPermSearch}
              onChange={(e) => setAddPermSearch(e.target.value)}
              placeholder="Search permissions..."
              className="pl-8 h-9"
              autoFocus
            />
          </div>
          <Tabs value={addPermCat} onValueChange={setAddPermCat}>
            <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
              <TabsTrigger value="all" className="text-xs data-[state=active]:bg-muted">All</TabsTrigger>
              {addPermCatKeys.map((cat) => (
                <TabsTrigger key={cat} value={cat} className="text-xs data-[state=active]:bg-muted">
                  {PERM_CATEGORIES[cat] || cat}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center justify-between px-0.5">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAllVisible} />
              Select all ({addPermVisible.length})
            </label>
            <span className="text-[11px] text-muted-foreground font-mono-data">{comparePermIds?.size ?? 0} shown in comparison</span>
          </div>
          <ScrollArea className="h-[340px]">
            <div className="space-y-0.5 pr-2">
              {addPermVisible.map((p) => {
                const added = comparePermIds?.has(p.permsid) ?? false;
                return (
                  <div
                    key={p.permsid}
                    onClick={() => toggleComparePerm(p.permsid)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition-colors',
                      added ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50',
                    )}
                    title={permTooltip(p)}
                  >
                    <Checkbox checked={added} onCheckedChange={() => toggleComparePerm(p.permsid)} onClick={(e) => e.stopPropagation()} />
                    <span className={cn('truncate', permLabelMode === 'advanced' && 'font-mono-data')}>{permLabel(p)}</span>
                  </div>
                );
              })}
              {addPermVisible.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No permissions match your search</p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={() => setShowAddPerm(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
