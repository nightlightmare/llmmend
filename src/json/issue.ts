/**
 * A record of one thing Extraction or Repair did to get from the Reply to the value.
 * Closed union: adding a code is a minor release (ADR 0002).
 */
export type Issue =
  | { code: 'stripped_wrapper'; detail: string }
  | { code: 'trailing_comma'; at: number }
  | { code: 'single_quotes'; at: number }
  | { code: 'unquoted_key'; at: number }
  | { code: 'python_literal'; at: number }
  | { code: 'non_finite_number'; at: number }
  | { code: 'unescaped_control_char'; at: number }
  | { code: 'comment_removed'; at: number }
  | { code: 'truncated_closed'; closed: string }

/** Why `extractJson` found no usable value. */
export type ExtractError =
  | 'not_found'
  | 'unparseable'
  | 'truncated'
  | 'schema_mismatch'
  | 'max_depth'
