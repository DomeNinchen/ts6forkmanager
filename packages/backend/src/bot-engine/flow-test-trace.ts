import { MASKED_VALUE, type FlowNode, type FlowTestEffect, type FlowTestReport, type FlowTestStep } from '@ts6/common';
import { isSecretField } from '../utils/change-log.js';
import { maskSecrets } from '../utils/mask-secrets.js';

/** Longest value a report repeats, so a big read result does not blow up the answer. */
const VALUE_MAX = 2000;

const cut = (s: string) => (s.length > VALUE_MAX ? `${s.slice(0, VALUE_MAX)}…` : s);

/** Thrown when a test needs more reads than FLOW_TEST_MAX_READS: ends the test, never taken as an action's own failure. */
export class FlowTestReadLimit extends Error {}

/**
 * What a flow test (FlowRunner.test) records while the flow runs on sample data: the
 * steps it took, and what it would have written. Its presence on an ExecutionContext
 * is what makes a run a test: variables go to `vars` instead of the database, logs to
 * the steps, writes and requests are only described.
 */
export class FlowTestTrace {
  readonly steps: FlowTestStep[] = [];
  /** The step of the node running now; effects and placeholders go there. */
  step?: FlowTestStep;
  /** Loop iteration the next step runs in. */
  iteration?: number;
  /** Flow variables as the run left them (only those it wrote). */
  readonly vars = new Map<string, string>();
  private varsBefore = new Map<string, string>();
  reads = 0;
  /** Set once the running action only described a write or a request: temp values it sets from then on are simulated. */
  simulating = false;
  private simulatedTemp = new Set<string>();
  /** clid -> nickname, from the client lists this test read. */
  private names = new Map<string, string>();

  begin(node: FlowNode): FlowTestStep {
    this.step = {
      nodeId: node.id, nodeType: node.type, label: node.data?.label ?? '',
      ...(this.iteration !== undefined && { iteration: this.iteration }),
      placeholders: [], effects: [], logs: [],
    };
    this.steps.push(this.step);
    return this.step;
  }

  effect(effect: FlowTestEffect): void {
    this.step?.effects.push(effect);
  }

  log(level: string, message: string): void {
    this.step?.logs.push({ level, message });
  }

  placeholder(expression: string, value: string): void {
    const field = expression.split('|')[0].trim().split('.').pop() ?? '';
    this.step?.placeholders.push({ expression, value: isSecretField(field) && value ? MASKED_VALUE : cut(value), empty: value === '' });
  }

  setVariable(name: string, previous: string, value: string): void {
    if (!this.varsBefore.has(name)) this.varsBefore.set(name, previous);
    this.vars.set(name, value);
    this.effect({ kind: 'variable', name, from: cut(previous), to: cut(value) });
  }

  tempSet(name: string): void {
    if (this.simulating) this.simulatedTemp.add(name);
    else this.simulatedTemp.delete(name);
  }

  learnNames(rows: unknown): void {
    if (!Array.isArray(rows)) return;
    for (const r of rows) if (r?.clid !== undefined && r.client_nickname) this.names.set(String(r.clid), String(r.client_nickname));
  }

  /** The nicknames of the clids in these parameters, if a read in this test saw them. */
  namesFor(params: Record<string, unknown>): Record<string, string> | undefined {
    const name = params.clid !== undefined ? this.names.get(String(params.clid)) : undefined;
    return name ? { [String(params.clid)]: name } : undefined;
  }

  fill(report: FlowTestReport, temps: Map<string, unknown>): FlowTestReport {
    report.variables = [...this.vars].map(([name, after]) => ({ name, before: cut(this.varsBefore.get(name) ?? ''), after: cut(after) }));
    report.temp = [...temps].filter(([, v]) => v !== undefined).map(([name, v]) => ({
      name,
      value: cut(typeof v === 'object' && v !== null ? JSON.stringify(maskSecrets(v)) : String(v)),
      simulated: this.simulatedTemp.has(name),
    }));
    report.reads = this.reads;
    return report;
  }
}

/** Header values that look like credentials, masked for the report. */
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) =>
    [k, v && (isSecretField(k) || /auth|cookie|key|token|secret|signature/i.test(k)) ? MASKED_VALUE : v]));
}
