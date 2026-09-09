import { useMemo } from 'react'
import { Transaction } from '../lib/api'

interface IncidentLedgerProps {
  transactions: Transaction[]
  selectedId: string | null
  onSelect: (tx: Transaction) => void
  searchQuery: string
  activeFilter: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAmount(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(3)}M`
  if (n >= 1_000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `$${n.toFixed(2)}`
}

function timeAgo(ts: number): string {
  const diff = (Date.now() / 1000) - ts
  if (diff < 5) return 'just now'
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function riskClass(R_k: number | null): string {
  if (R_k === null || R_k === undefined) return 'risk-low'
  if (R_k >= 0.85) return 'risk-critical'
  if (R_k >= 0.65) return 'risk-high'
  if (R_k >= 0.45) return 'risk-medium'
  return 'risk-low'
}

function statusClass(status: string | null): string {
  switch (status) {
    case 'HOLD': return 'status-hold'
    case 'REVIEW': return 'status-review'
    case 'MFA': return 'status-mfa'
    case 'CLEARED': return 'status-cleared'
    default: return 'status-badge border-zinc-700 text-zinc-500'
  }
}

/**
 * Generate a plain-English investigative narrative from tx fields.
 */
function buildNarrative(tx: Transaction): string {
  const parts: string[] = []

  // Balance depletion
  if (tx.oldbalanceOrg > 0) {
    const depletion = ((tx.oldbalanceOrg - tx.newbalanceOrig) / tx.oldbalanceOrg) * 100
    if (depletion > 90) {
      parts.push(`Account balance depleted ${depletion.toFixed(1)}% in single outbound transfer.`)
    } else if (depletion > 50) {
      parts.push(`Account balance reduced by ${depletion.toFixed(0)}% in this transfer.`)
    }
  }

  // Fan-in burst
  if (tx.g_k !== null && tx.g_k > 0.3) {
    const estTransfers = Math.round(tx.g_k * 10)
    parts.push(`Destination node received ~${estTransfers} transfers in trailing window.`)
  }

  // Anomaly score
  if (tx.a_k !== null && tx.a_k > 0.7) {
    parts.push(`IsolationForest depth anomaly: extreme outlier in multidimensional space.`)
  }

  // Behavioral deviation
  if (tx.b_k !== null && tx.b_k > 0.6) {
    parts.push(`High deviation from account baseline profile (b_k: ${tx.b_k.toFixed(3)}).`)
  }

  // Attack type hints
  if (tx.attack_type === 'VELOCITY_SURGE') {
    parts.push('Velocity surge pattern: rapid sequential transfers from single origin.')
  } else if (tx.attack_type === 'STRUCTURING') {
    parts.push('Structuring detected: amount engineered below $10,000 regulatory reporting threshold.')
  } else if (tx.attack_type === 'ZERO_DAY') {
    parts.push('Zero-day attack vector: destination node has zero transaction history.')
  } else if (tx.attack_type === 'FAN_IN_BURST') {
    parts.push('Fan-in burst: multiple origin accounts funneling to single mule destination.')
  } else if (tx.attack_type === 'LARGE_TRANSFER') {
    parts.push(`Single large transfer: ${fmtAmount(tx.amount)} routed to low-history destination.`)
  }

  // Fallback
  if (parts.length === 0) {
    if (tx.status === 'CLEARED') {
      parts.push('Transaction within normal behavioral parameters.')
    } else {
      parts.push('Flagged for review based on composite risk assessment.')
    }
  }

  return parts.join(' ')
}

function IncidentRow({
  tx,
  isSelected,
  isNew,
  onSelect,
}: {
  tx: Transaction
  isSelected: boolean
  isNew: boolean
  onSelect: () => void
}) {
  const narrative = useMemo(() => buildNarrative(tx), [tx.tx_id])
  const isHighRisk = tx.status === 'HOLD' || tx.status === 'REVIEW'

  return (
    <div
      onClick={onSelect}
      className={`border-b border-zinc-800/60 px-5 py-4 cursor-pointer transition-colors duration-100 ${
        isSelected
          ? 'bg-zinc-900/80 border-l-4 border-l-zinc-300 pl-4'
          : 'hover:bg-zinc-900/40 bg-transparent'
      } ${isNew ? 'animate-fade-up' : ''}`}
    >
      {/* ── Top Header of Row: TX, Time, Type, Attack, Status ── */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* TX ID */}
          <span className="mono-num text-xs font-bold text-zinc-200">
            TX#{tx.tx_id}
          </span>

          {/* Timestamp */}
          <span className="text-zinc-500 text-xs mono-num">
            {timeAgo(tx.timestamp)}
          </span>

          {/* Modality chip */}
          <span className="modality-chip">
            {tx.type}
          </span>

          {/* Attack badge */}
          {tx.attack_type && tx.attack_type !== 'NORMAL' && (
            <span className="inline-flex items-center text-xs font-mono font-semibold px-2 py-0.5 rounded-sm bg-red-950/40 text-red-400 border border-red-900/50 tracking-wider uppercase">
              ⚠ {tx.attack_type.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {/* Right: R_k Score + Operational Status Badge */}
        <div className="flex items-center gap-2 shrink-0">
          {tx.R_k !== null && (
            <span className={riskClass(tx.R_k)}>
              R_k {tx.R_k.toFixed(3)}
            </span>
          )}
          <span className={statusClass(tx.status)}>
            {tx.status ?? '—'}
          </span>
        </div>
      </div>

      {/* ── Middle: Origin -> Destination & Amount ────────── */}
      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="mono-num text-sm text-zinc-300 font-medium truncate">
            {tx.nameOrig}
          </span>
          <span className="text-zinc-600 text-xs shrink-0">→</span>
          <span className="mono-num text-sm text-zinc-300 font-medium truncate">
            {tx.nameDest}
          </span>
        </div>

        <span className={`mono-num text-base font-bold tracking-tight shrink-0 ${
          tx.amount >= 100_000 ? 'text-red-400' :
          tx.amount >= 10_000 ? 'text-orange-400' : 'text-zinc-100'
        }`}>
          {fmtAmount(tx.amount)}
        </span>
      </div>

      {/* ── Bottom: Investigative Narrative (for notable events) ── */}
      {isHighRisk && (
        <div className="mt-2 px-3 py-1.5 rounded-sm bg-zinc-950/60 border border-zinc-800/80 text-xs text-zinc-400 leading-relaxed">
          {narrative}
        </div>
      )}
    </div>
  )
}

export function IncidentLedger({
  transactions,
  selectedId,
  onSelect,
  searchQuery,
  activeFilter,
}: IncidentLedgerProps) {
  // Apply filters
  const filtered = useMemo(() => {
    let list = transactions

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(tx =>
        tx.nameOrig.toLowerCase().includes(q) ||
        tx.nameDest.toLowerCase().includes(q) ||
        tx.tx_id.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q) ||
        (tx.attack_type && tx.attack_type.toLowerCase().includes(q))
      )
    }

    // Category filter
    switch (activeFilter) {
      case 'hold':
        return list.filter(tx => tx.status === 'HOLD' || (tx.R_k !== null && tx.R_k >= 0.85))
      case 'review':
        return list.filter(tx => tx.status === 'REVIEW' || tx.status === 'HOLD' || (tx.R_k !== null && tx.R_k >= 0.65))
      case 'transfer':
        return list.filter(tx => tx.type === 'TRANSFER')
      case 'cashout':
        return list.filter(tx => tx.type === 'CASH_OUT')
      default:
        return list
    }
  }, [transactions, searchQuery, activeFilter])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-canvas">
      {/* Feed Column Header */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-zinc-950/50 border-b border-zinc-800 text-xs font-mono uppercase tracking-wider text-zinc-500 shrink-0 select-none">
        <span>Incident Stream ({filtered.length} events)</span>
        <span>Amount (USD) &amp; Status</span>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/40">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <span className="text-zinc-600 text-sm font-mono mb-2">No matching transactions found</span>
            <span className="text-xs text-zinc-600">Try adjusting your active filter or search query</span>
          </div>
        ) : (
          filtered.map((tx, idx) => (
            <IncidentRow
              key={tx.tx_id}
              tx={tx}
              isSelected={tx.tx_id === selectedId}
              isNew={idx === 0}
              onSelect={() => onSelect(tx)}
            />
          ))
        )}
      </div>

      {/* Status bar */}
      <div className="px-5 py-2 border-t border-zinc-800/60 bg-zinc-950/80 flex items-center justify-between text-xs text-zinc-500 font-mono shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-blink" />
          <span>Real-time PaySim ingestion active</span>
        </div>
        <span>Click any row for SHAP &amp; forensic math</span>
      </div>
    </div>
  )
}
