// API client — all communication with FastAPI backend

const BASE = ''  // proxied via Vite dev server

export interface Transaction {
  tx_id: string
  step: number
  type: string
  amount: number
  nameOrig: string
  oldbalanceOrg: number
  newbalanceOrig: number
  nameDest: string
  oldbalanceDest: number
  newbalanceDest: number
  timestamp: number
  attack_type: string
  is_suspicious: boolean
  p_k: number | null
  b_k: number | null
  a_k: number | null
  g_k: number | null
  R_k: number | null
  status: string | null
  shap_drivers: ShapDriver[] | null
  account_snapshot: AccountSnapshot | null
  latency_ms: number
}

export interface ShapDriver {
  feature: string
  raw_value: number
  contribution: number
}

export interface AccountSnapshot {
  account_id: string
  n_transactions: number
  mean_amount: number
  std_amount: number
  cadence_ewma_s: number
  n_known_counterparties: number
  known_counterparties_sample: string[]
  last_balance: number
  total_volume: number
}

export interface FraudRing {
  ring_id: string
  cluster_label: number
  members: string[]
  n_members: number
  sinks: string[]
  total_volume: number
  growth_rate: number
  growth_pct: number
  jaccard_overlap: number
  tx_count: number
  duration_minutes: number
  attack_types: string[]
  is_persistent: boolean
  flagged: boolean
}

export interface MacroRingsResponse {
  rings: FraudRing[]
  ring_count: number
  buffer_size: number
  stats: {
    evaluated: number
    intercepted: number
    active_sinks: number
  }
}

export interface HealthResponse {
  status: string
  engine_ready: boolean
  profiles_tracked: number
  transactions_processed: number
  transactions_intercepted: number
  active_sinks: number
  avg_latency_ms: number
  active_rings: number
}

export async function fetchTransactions(limit = 50): Promise<Transaction[]> {
  const r = await fetch(`${BASE}/api/transactions?limit=${limit}`)
  const data = await r.json()
  return data.transactions
}

export async function fetchTransaction(txId: string): Promise<Transaction> {
  const r = await fetch(`${BASE}/api/transaction/${txId}`)
  if (!r.ok) throw new Error(`Transaction ${txId} not found`)
  return r.json()
}

export async function fetchMacroRings(): Promise<MacroRingsResponse> {
  const r = await fetch(`${BASE}/api/macro-rings`)
  return r.json()
}

export async function fetchHealth(): Promise<HealthResponse> {
  const r = await fetch(`${BASE}/api/health`)
  return r.json()
}

export async function injectAttack(): Promise<{ tx_id: string; amount: number; attack_type: string }> {
  const r = await fetch(`${BASE}/api/inject-attack`, { method: 'POST' })
  return r.json()
}

export function createEventSource(): EventSource {
  return new EventSource(`${BASE}/ws/stream`)
}
