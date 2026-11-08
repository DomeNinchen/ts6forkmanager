/**
 * TS6 Stream Signaling — handles stream protocol commands.
 *
 * Outgoing: setupstream, respondjoinstreamrequest, streamsignaling, stopstream, removeclientfromstream
 * Incoming: notifystreamstarted, notifystreamstopped, notifyjoinstreamrequest,
 *           notifyrespondjoinstreamrequest, notifystreamsignaling,
 *           notifystreamclientjoined, notifystreamclientleft, notifystreaminfo
 */

import { EventEmitter } from 'events';
import type { Ts3Client } from '../tslib/client.js';
import { buildCommand } from '../tslib/commands.js';
import { isDebugEnabled } from '../../utils/debug-flags.js';

/** Logs one line when the "Stream Signaling Debug" flag is on (Settings -> Debug). */
export function logStreamSignaling(message: string): void {
  if (isDebugEnabled('streamSignaling')) console.log(`[StreamSignaling] ${message}`);
}

// IP addresses in ICE candidates are personal data, so the debug log only keeps type, protocol and port.
const MASKED_IP = 'x.x.x.x';

/** "srflx udp x.x.x.x:51234" for one ICE candidate (with or without the "a=" prefix). */
export function summarizeCandidate(candidate: string | undefined): string {
  if (!candidate) return 'empty candidate';
  // candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> ...
  const f = candidate.trim().replace(/^a=/, '').split(/\s+/);
  const typ = f.indexOf('typ');
  if (typ !== 6 || f.length < 8) return `unparsed candidate (${candidate.length} chars)`;
  return `${f[7]} ${f[2].toLowerCase()} ${MASKED_IP}:${f[5]}`;
}

/** What the sidecar did with a viewer's answer, from its /peer/answer response. */
export function describeAnswerResult(res: { applied?: boolean; reason?: string }): string {
  if (res.applied === true) return 'answer applied to the sidecar';
  if (res.applied === false) return `answer ignored by the sidecar: ${res.reason || 'no reason given'}`;
  return 'answer passed to the sidecar (it is too old to say whether it was applied)';
}

/** The sidecar's own words from a failed call ("Sidecar /peer/ice: 500 <reason>"), with any IP address masked. */
export function sidecarRefusalReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    .replace(/^Sidecar \S+: \d+ /, '')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, MASKED_IP)
    .replace(/[0-9a-f]*:[0-9a-f]*:[0-9a-f:.]*/gi, MASKED_IP)
    .trim();
}

/** "SDP 2345 chars, 3 candidates (host 2, srflx 1)" without any address from the SDP. */
export function summarizeSdp(sdp: string | undefined): string {
  if (!sdp) return 'no SDP';
  const types = new Map<string, number>();
  const lines = sdp.split(/\r?\n/).filter((l) => l.startsWith('a=candidate:'));
  for (const l of lines) {
    const type = summarizeCandidate(l).split(' ')[0];
    types.set(type, (types.get(type) ?? 0) + 1);
  }
  const byType = [...types].map(([t, n]) => `${t} ${n}`).join(', ');
  const media = summarizeMedia(sdp);
  return `SDP ${sdp.length} chars, ${lines.length} candidates${byType ? ` (${byType})` : ''}${media ? `; ${media}` : ''}`;
}

/** Per m= section: "video VP8/96 sendonly; audio opus/111 sendonly" ("rejected" for port 0). No addresses. */
export function summarizeMedia(sdp: string): string {
  return sdp.split(/\r?\nm=/).slice(1).map((section) => {
    const lines = section.split(/\r?\n/);
    const [kind, port] = lines[0].split(' ');
    if (port === '0') return `${kind} rejected`;
    const codecs = lines
      .filter((l) => l.startsWith('a=rtpmap:'))
      .map((l) => { const m = /^a=rtpmap:(\d+) ([^/\s]+)/.exec(l); return m ? `${m[2]}/${m[1]}` : '?'; });
    const dir = lines.find((l) => /^a=(sendonly|recvonly|sendrecv|inactive)$/.test(l))?.slice(2) ?? 'no direction';
    return `${kind} ${codecs.join(',') || 'no codec'} ${dir}`;
  }).join('; ');
}

const HANDLED_NOTIFIES = new Set([
  'notifystreamstarted', 'notifystreamstopped', 'notifystreamsignaling', 'notifyjoinstreamrequest',
  'notifyrespondjoinstreamrequest', 'notifystreamclientjoined', 'notifystreamclientleft', 'notifystreaminfo',
]);

export interface ActiveStream {
  id: string;
  clid: number;
  name: string;
  type: number;
  access: number;
  mode: number;
  bitrate: number;
  viewerLimit: number;
  audio: boolean;
  startedAt: number;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice_candidate' | 'reconnect' | 'stream_started' | 'stream_stopped' | 'join_response' | 'unknown';
  streamId?: string;
  clid?: number;
  sdp?: string;
  sdpMid?: string;
  sdpMlineIndex?: number;
  candidate?: string;
  isReconnect?: boolean;
  raw: string;
  stream?: ActiveStream;
}

export class StreamSignaling extends EventEmitter {
  private client: Ts3Client;
  private activeStreams: Map<string, ActiveStream> = new Map();
  private readonly onCommand = (parsed: any) => this.handleCommand(parsed);
  // shortcut: answers carry no command name and the bot sends other commands too, so a refusal is
  // only shown next to the stream commands of the last 2 s; add return_code matching if that is not enough.
  private recentSent: Array<{ name: string; at: number }> = [];
  /**
   * The server answers every command with `error id=... msg=...`; a refusal other than the
   * fatal ones (password, ban, server full) was invisible before, so a rejected
   * respondjoinstreamrequest left the viewer waiting with nothing in any log.
   */
  private readonly onServerError = (params: Record<string, string>) => {
    if (!params || params.id === undefined || params.id === '0') return;
    const extra = ['extra_msg', 'failed_permid', 'return_code']
      .filter((k) => params[k])
      .map((k) => ` ${k}=${params[k]}`)
      .join('');
    const now = Date.now();
    const recent = this.recentSent.filter((s) => now - s.at <= 2000).map((s) => `${s.name} ${now - s.at} ms ago`);
    const context = recent.length ? ` (stream commands sent in the last 2 s: ${recent.join(', ')})` : '';
    logStreamSignaling(`<- error id=${params.id} msg=${params.msg ?? ''}${extra}${context}`);
  };

  constructor(client: Ts3Client) {
    super();
    this.client = client;
    this.client.on('command', this.onCommand);
    this.client.on('ts3error', this.onServerError);
  }

  private send(name: string, params: Record<string, string>): void {
    const now = Date.now();
    this.recentSent = this.recentSent.filter((s) => now - s.at <= 2000).concat({ name, at: now });
    this.client.sendCommand(buildCommand(name, params));
  }

  /**
   * Detach from the TS client and drop all listeners. Without this, every
   * stream start on the same connection left one more instance answering
   * each viewer's join request (n offers for one viewer, so its answer
   * met a different sidecar peer and the video stayed black).
   */
  dispose(): void {
    this.client.removeListener('command', this.onCommand);
    this.client.removeListener('ts3error', this.onServerError);
    this.removeAllListeners();
  }

  getActiveStreams(): Map<string, ActiveStream> {
    return new Map(this.activeStreams);
  }

  private handleCommand(parsed: any): void {
    const name = String(parsed?.name ?? '');
    // These two get a more detailed line from their own handler.
    if (name.startsWith('notify') && name.includes('stream')
      && name !== 'notifystreamsignaling' && name !== 'notifyrespondjoinstreamrequest') {
      const p = parsed.params ?? {};
      logStreamSignaling(`<- ${name} clid=${p.clid ?? '-'} id=${p.id ?? p.stream_id ?? '-'}${HANDLED_NOTIFIES.has(name) ? '' : ' (not handled)'}`);
    }
    switch (name) {
      case 'notifystreamstarted':
        this.handleStreamStarted(parsed);
        break;
      case 'notifystreamstopped':
        this.handleStreamStopped(parsed);
        break;
      case 'notifystreamsignaling':
        this.handleStreamSignaling(parsed);
        break;
      case 'notifyjoinstreamrequest':
        this.emit('joinStreamRequest', parsed.params);
        break;
      case 'notifyrespondjoinstreamrequest':
        this.handleJoinStreamResponse(parsed);
        break;
      case 'notifystreamclientjoined':
        this.emit('streamClientJoined', parsed.params);
        break;
      case 'notifystreamclientleft':
        this.emit('streamClientLeft', parsed.params);
        break;
      case 'notifystreaminfo':
        this.handleStreamInfo(parsed);
        break;
    }
  }

  private handleStreamStarted(parsed: any): void {
    const p = parsed.params;
    const stream: ActiveStream = {
      id: p.id || '',
      clid: parseInt(p.clid) || 0,
      name: p.name || '',
      type: parseInt(p.type) || 0,
      access: parseInt(p.access) || 0,
      mode: parseInt(p.mode) || 0,
      bitrate: parseInt(p.bitrate) || 0,
      viewerLimit: parseInt(p.viewer_limit) || 0,
      audio: p.audio === '1',
      startedAt: Date.now(),
    };
    this.activeStreams.set(stream.id, stream);
    this.emit('streamStarted', stream);
    this.emit('signalingMessage', {
      type: 'stream_started',
      streamId: stream.id,
      clid: stream.clid,
      raw: JSON.stringify(parsed),
      stream,
    } as SignalingMessage);
  }

  private handleStreamStopped(parsed: any): void {
    const streamId = parsed.params.id || parsed.params.stream_id || '';
    const stream = this.activeStreams.get(streamId);
    this.activeStreams.delete(streamId);
    this.emit('streamStopped', { streamId, stream });
    this.emit('signalingMessage', {
      type: 'stream_stopped',
      streamId,
      clid: parseInt(parsed.params.clid) || stream?.clid,
      raw: JSON.stringify(parsed),
      stream,
    } as SignalingMessage);
  }

  private handleStreamSignaling(parsed: any): void {
    const p = parsed.params;
    const dataStr = p.json || p.data || '';
    const from = `clid=${p.clid ?? '-'} id=${p.id ?? p.stream_id ?? '-'}`;
    if (!dataStr) {
      logStreamSignaling(`<- streamsignaling ${from} with an empty payload (ignored)`);
      return;
    }

    try {
      const payload = JSON.parse(dataStr);
      const cmd = payload.cmd;
      const args = payload.args || {};
      if (isDebugEnabled('streamSignaling')) {
        let detail: string;
        if (cmd === 'offer' || cmd === 'reconnectOffer') detail = summarizeSdp(args.offer || args.sdp);
        else if (cmd === 'answer') detail = summarizeSdp(args.answer || args.sdp);
        else if (cmd === 'iceCandidate') detail = `${summarizeCandidate(args.sdp || args.candidate)} mid=${args.mid ?? args.sdp_mid ?? '-'} mLine=${args.mLine ?? args.sdp_mline_index ?? '-'}`;
        else if (cmd === 'reconnect') detail = '';
        else detail = `not handled (args: ${Object.keys(args).join(', ') || 'none'})`;
        logStreamSignaling(`<- streamsignaling ${from} cmd=${cmd ?? '(none)'}${detail ? ` ${detail}` : ''}`);
      }

      switch (cmd) {
        case 'offer':
        case 'reconnectOffer':
          this.emit('signalingMessage', {
            type: 'offer',
            sdp: args.offer || args.sdp,
            isReconnect: cmd === 'reconnectOffer',
            clid: parseInt(p.clid) || undefined,
            streamId: p.id || p.stream_id,
            raw: dataStr,
          } as SignalingMessage);
          break;
        case 'answer':
          this.emit('signalingMessage', {
            type: 'answer',
            sdp: args.answer || args.sdp,
            clid: parseInt(p.clid) || undefined,
            streamId: p.id || p.stream_id,
            raw: dataStr,
          } as SignalingMessage);
          break;
        case 'iceCandidate':
          this.emit('signalingMessage', {
            type: 'ice_candidate',
            candidate: args.sdp || args.candidate,
            sdpMid: args.mid || args.sdp_mid,
            sdpMlineIndex: args.mLine ?? args.sdp_mline_index,
            clid: parseInt(p.clid) || undefined,
            streamId: p.id || p.stream_id,
            raw: dataStr,
          } as SignalingMessage);
          break;
        case 'reconnect':
          this.emit('signalingMessage', {
            type: 'reconnect',
            isReconnect: true,
            clid: parseInt(p.clid) || undefined,
            streamId: p.id || p.stream_id,
            raw: dataStr,
          } as SignalingMessage);
          break;
      }
    } catch {
      console.warn(`[StreamSignaling] Failed to parse signaling JSON: ${dataStr.substring(0, 200)}`);
    }
  }

  private handleJoinStreamResponse(parsed: any): void {
    const p = parsed.params;
    const decision = parseInt(p.decision) || 0;
    logStreamSignaling(`<- notifyrespondjoinstreamrequest clid=${p.clid ?? '-'} id=${p.id ?? p.stream_id ?? '-'} decision=${decision} ${summarizeSdp(p.offer)}`);

    if (decision === 1 && p.offer) {
      this.emit('signalingMessage', {
        type: 'offer',
        sdp: p.offer,
        clid: parseInt(p.clid) || undefined,
        streamId: p.id || p.stream_id,
        raw: JSON.stringify(p),
      } as SignalingMessage);
    } else {
      this.emit('signalingMessage', {
        type: 'join_response',
        clid: parseInt(p.clid) || undefined,
        streamId: p.id || p.stream_id,
        raw: JSON.stringify(p),
      } as SignalingMessage);
    }
  }

  private handleStreamInfo(parsed: any): void {
    const p = parsed.params;
    if (!p.id) return;

    const stream: ActiveStream = {
      id: p.id,
      clid: parseInt(p.clid) || 0,
      name: p.name || '',
      type: parseInt(p.type) || 0,
      access: parseInt(p.accessibility) || parseInt(p.access) || 0,
      mode: parseInt(p.mode) || 0,
      bitrate: parseInt(p.bitrate) || 0,
      viewerLimit: parseInt(p.viewer_limit) || 0,
      audio: p.audio === '1',
      startedAt: Date.now(),
    };
    this.activeStreams.set(stream.id, stream);
    this.emit('streamStarted', stream);
  }

  // --- Outgoing commands ---

  sendSetupStream(params: {
    name?: string;
    type?: number;
    bitrate?: number;
    accessibility?: number;
    mode?: number;
    viewerLimit?: number;
    audio?: boolean;
  } = {}): void {
    this.send('setupstream', {
      name: params.name || 'Bot Stream',
      type: String(params.type ?? 3),
      bitrate: String(params.bitrate ?? 4608),
      accessibility: String(params.accessibility ?? 1),
      mode: String(params.mode ?? 1),
      viewer_limit: String(params.viewerLimit ?? 0),
      audio: params.audio === false ? '0' : '1',
    });
  }

  sendJoinResponse(viewerClid: number, streamId: string, accept: boolean = true, offerSdp?: string): void {
    logStreamSignaling(`-> respondjoinstreamrequest clid=${viewerClid} id=${streamId} decision=${accept ? 1 : 0} ${summarizeSdp(offerSdp)}`);
    this.send('respondjoinstreamrequest', {
      id: streamId,
      clid: String(viewerClid),
      msg: '',
      offer: offerSdp || '',
      decision: accept ? '1' : '0',
    });
  }

  sendSignaling(targetClid: number, data: { cmd: string; args: Record<string, any> }, streamId?: string): void {
    logStreamSignaling(`-> streamsignaling clid=${targetClid} id=${streamId || '-'} cmd=${data.cmd} (args: ${Object.keys(data.args).join(', ') || 'none'})`);
    this.send('streamsignaling', {
      id: streamId || '',
      clid: String(targetClid),
      json: JSON.stringify(data),
    });
  }

  sendStreamStop(streamId: string, reason: number = 1): void {
    this.send('stopstream', { id: streamId, reason: String(reason) });
  }

  sendRemoveClient(clid: number, streamId: string): void {
    this.send('removeclientfromstream', { id: streamId, clid: String(clid) });
  }
}
