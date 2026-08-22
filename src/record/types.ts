export type Outcome =
  | 'success'
  | 'http_error'
  | 'timeout'
  | 'connection_failure'
  | 'dns_failure'
  | 'tls_failure'
  | 'blocked'
  | 'skipped';

export interface Latency {
  samples: number;
  median_ms?: number;
  min_ms?: number;
  max_ms?: number;
}

export interface Method {
  vantage: string;
  timeout_ms: number;
  sample_count: number;
  tool_version: string;
  source: 'self_run';
}

export type Tier = 'hot' | 'broad';

export type ResolutionStatus =
  | 'address'
  | 'mail_only'
  | 'no_service'
  | 'nxdomain'
  | 'resolver_error';

export interface RecordedResolution {
  status: ResolutionStatus;
  apex: boolean;
  www: boolean;
  /** Raw resolver codes. Absent when an address was found — nothing to explain. */
  codes?: string[];
}

/**
 * Whether a public website appears to exist at this domain.
 *
 * The one judgement in the record, which is why it is fenced off in its own field
 * with the version of the rule that produced it. `outcome` stays a statement
 * about the protocol (FR-117); this is a reading of those facts, and a reading
 * can be wrong in a way an observation cannot.
 *
 * Derivable from stored facts alone, so a better rule recomputes it over every
 * row already collected without re-checking a single target (FR-119).
 */
export interface Presence {
  state: 'website' | 'no_website' | 'undetermined';
  rule: string;
}

export interface Observation {
  schema: string;
  run_id: string;
  target_id: string;
  host: string;
  url: string;
  dimension: string;
  checked_at: string;
  /**
   * The backend address this check was sent to, when it could be established.
   *
   * Present so the shared-hosting spacing guarantee is provable by a reader from
   * the record alone rather than taken on trust (Principle V, FR-141). Optional
   * because resolution can fail, and because rows written before this field
   * existed stay valid — the record is append-only and never rewritten.
   */
  address?: string;
  /** Which tier produced this observation (FR-108). */
  tier?: Tier;
  /** The cycle it belongs to, so coverage is assertable per cycle. */
  cycle?: string;
  /** Which slice covered it. */
  slice?: number;
  /** The rule that turned a bare domain into the URL requested (FR-129). */
  url_rule?: string;
  /** What DNS said the domain publishes — evidence, not inference (FR-120). */
  resolution?: RecordedResolution;
  /** The reading of whether a website exists, with its rule version (FR-118). */
  presence?: Presence;
  outcome: Outcome;
  status_code?: number;
  redirect_chain: string[];
  latency: Latency;
  skip_reason?: string;
  method: Method;
}
