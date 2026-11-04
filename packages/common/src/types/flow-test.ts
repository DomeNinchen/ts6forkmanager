// The answer of a flow test (POST /api/bots/:botId/test): what the flow would do
// with a sample event, without changing anything. Data only - the editor turns
// it into sentences in the user's language.

/** One {{...}} placeholder as it was resolved. `empty`: it resolved to nothing. */
export interface FlowTestPlaceholder {
  expression: string;
  value: string;
  empty: boolean;
}

export type FlowTestEffect =
  /** A ServerQuery command that would change something; not sent. `names` maps a clid in `params` to the nickname a read in this test saw. */
  | { kind: 'write'; command: string; params: Record<string, unknown>; names?: Record<string, string> }
  /** A read-only ServerQuery command the test really ran. */
  | { kind: 'read'; command: string; params: Record<string, unknown>; rows: number }
  /** An HTTP request (HTTP Request or Webhook action); never sent. `blocked`: the URL check refuses it. */
  | { kind: 'http'; method: string; url: string; headers: Record<string, string>; body?: string; blocked?: string }
  /** A music/voice bot action; not carried out. */
  | { kind: 'voice'; action: string; params: Record<string, string> }
  | { kind: 'variable'; name: string; from: string; to: string }
  /** A Delay; the test does not wait. */
  | { kind: 'delay'; ms: number }
  /** Something the test left out or capped. */
  | { kind: 'note'; code: FlowTestNote };

export type FlowTestNote =
  | 'animationManagedByEngine' // Animated Channel runs on its own timer, not in a flow run
  | 'rankCheckCapped' // the test asked for at most FLOW_TEST_RANK_CHECK_MAX clients' clientinfo
  | 'responseUnknown'; // an HTTP answer a later node may need was not fetched

export interface FlowTestStep {
  nodeId: string;
  nodeType: string;
  label: string;
  /** Handle this node continued on: 'true'/'false' (condition), 'error' (failed action with an error branch). */
  branch?: string;
  /** Loop iteration (0-based) of the innermost loop this step ran in. */
  iteration?: number;
  placeholders: FlowTestPlaceholder[];
  effects: FlowTestEffect[];
  logs: { level: string; message: string }[];
  /** The condition expression could not be evaluated (it then counts as false). */
  conditionError?: string;
  /** The action failed. */
  error?: string;
}

export interface FlowTestReport {
  /** 'notTriggered': the sample event would not start this trigger (see `mismatch`), nothing ran. */
  status: 'completed' | 'failed' | 'notTriggered';
  error?: string;
  /** 'readLimit': more than FLOW_TEST_MAX_READS reads; 'nodeVisits': the flow hit the node-visit limit. */
  errorCode?: 'readLimit' | 'nodeVisits';
  triggerNodeId: string;
  triggerType: string;
  /** Why the trigger would not fire: a filter key with expected/actual, or 'listener'/'command' for chat commands. */
  mismatch?: { key: string; expected: string; actual: string | null } | 'listener' | 'command';
  /** The event data the flow saw, after the trigger's own enrichment (command args, webhook fields). */
  eventData: Record<string, string>;
  steps: FlowTestStep[];
  /** Flow variables the run would change, with their stored value before. */
  variables: { name: string; before: string; after: string }[];
  /** temp.* values at the end; `simulated`: set from a write or request the test did not carry out. */
  temp: { name: string; value: string; simulated: boolean }[];
  reads: number;
}

export const FLOW_TEST_MAX_READS = 50;
export const FLOW_TEST_RANK_CHECK_MAX = 20;
/** Largest unsaved flow a test request may carry, in bytes of JSON. */
export const FLOW_TEST_MAX_FLOW_BYTES = 512 * 1024;
/** What a channel created in a test is called in later nodes. */
export const FLOW_TEST_SIMULATED_ID = '(simulated)';
