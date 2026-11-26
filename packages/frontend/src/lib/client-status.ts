type Flag = string | number | boolean | null | undefined;

/** A TeamSpeak 0/1 flag: WebQuery sends "0"/"1" strings, and "0" is truthy in JavaScript. */
const on = (v: Flag) => Number(v) === 1;

/** The Clients page status: away first, then microphone or speakers muted, else active. */
export function clientStatus(c: { client_away?: Flag; client_input_muted?: Flag; client_output_muted?: Flag }): 'away' | 'muted' | 'active' {
  if (on(c.client_away)) return 'away';
  if (on(c.client_input_muted) || on(c.client_output_muted)) return 'muted';
  return 'active';
}
