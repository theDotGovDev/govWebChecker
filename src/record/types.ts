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

export interface Observation {
  schema: string;
  run_id: string;
  target_id: string;
  host: string;
  url: string;
  dimension: string;
  checked_at: string;
  outcome: Outcome;
  status_code?: number;
  redirect_chain: string[];
  latency: Latency;
  skip_reason?: string;
  method: Method;
}
