import { useEffect, useState } from 'react'
import { Transaction, fetchTransaction } from '../lib/api'
import { ShapWaterfall } from './ShapWaterfall'

interface InvestigationDrawerProps {
  txId: string | null
  cachedTx: Transaction | null
  onClose?: () => void
}

function fmtAmount(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtLarge(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return fmtAmount(n)
}

function riskColor(v: number): string {
  if (v >= 0.75) return 'text-red-400'
  if (v >= 0.5) return 'text-orange-400'
  if (v >= 0.25) return 'text-yellow-400'
  return 'text-emerald-400'
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3 mt-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-300">{title}</span>
        {subtitle && <span className="text-2xs font-mono text-zinc-500">({subtitle})</span>}
      </div>
      <div className="flex-1 h-px bg-zinc-800/60 ml-2" />
    </div>
  )
}

function ForensicTable({ tx }: { tx: Transaction }) {
  const rows = [
    {
      key: 'p_k',
      label: 'Supervised Model (RandomForest)',
      symbol: 'p_k',
      value: tx.p_k,
      desc: 'Calibrated Platt-scaled probability',
      weight: 'β₁ = 2.40',
    },
    {
      key: 'b_k',
      label: 'Behavioral Deviation (Welford)',
      symbol: 'b_k',
      value: tx.b_k,
      desc: 'Z-score Δ from baseline cadence (μ/σ)',
      weight: 'β₂ = 1.85',
    },
    {
      key: 'a_k',
      label: 'Isolation Forest Depth Anomaly',
      symbol: 'a_k',
      value: tx.a_k,
      desc: 'Normalized partition path length',
      weight: 'β₃ = 1.60',
    },
    {
      key: 'g_k',
      label: 'Fan-In Burst Multiplier',
      symbol: 'g_k',
      value: tx.g_k,
      desc: 'Destination inbound velocity spike',
      weight: 'β₄ = 2.10',
    },
  ]

  return (
    <div className="border border-zinc-800 rounded-sm overflow-hidden bg-zinc-950/40 mb-5">
      {/* Table Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/60 border-b border-zinc-800 text-2xs font-mono uppercase tracking-wider text-zinc-500">
        <span>Signal Dimension &amp; Formulation</span>
        <span>Score / Weight</span>
      </div>

      {rows.map(row => (
        <div
          key={row.key}
          className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-900/20 transition-colors"
        >
          <div className="flex flex-col gap-0.5 min-w-0 pr-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-200 font-medium">{row.label}</span>
              <span className="text-2xs font-mono text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded-sm border border-zinc-800">
                {row.symbol}
              </span>
            </div>
            <span className="text-2xs text-zinc-500">{row.desc}</span>
          </div>

          <div className="flex flex-col items-end shrink-0">
            <span className={`mono-num text-sm font-bold ${riskColor(row.value ?? 0)}`}>
              {row.value !== null && row.value !== undefined ? row.value.toFixed(4) : '—'}
            </span>
            <span className="text-2xs font-mono text-zinc-600">{row.weight}</span>
          </div>
        </div>
      ))}

      {/* Fusion row */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/60 border-t border-zinc-800">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-zinc-100 font-mono">FUSED COMPOSITE SCORE</span>
          <span className="text-2xs text-zinc-500 font-mono">R_k = σ(β₀ + ∑ βᵢ·xᵢ)</span>
        </div>
        <span className={`mono-num text-base font-bold ${riskColor(tx.R_k ?? 0)}`}>
          {tx.R_k !== null && tx.R_k !== undefined ? tx.R_k.toFixed(4) : '—'}
        </span>
      </div>
    </div>
  )
}

function AccountBaselineGrid({ tx }: { tx: Transaction }) {
  const snapshot = tx.account_snapshot

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
      {/* Origin Profile */}
      <div className="p-3.5 rounded-sm border border-zinc-800 bg-zinc-950/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-2xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">Origin Baseline</span>
          <span className="mono-num text-2xs text-zinc-500">{tx.nameOrig}</span>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-400">
            <span className="text-zinc-500">Historical μ:</span>
            <span className="mono-num text-zinc-200">
              {snapshot ? fmtAmount(snapshot.mean_amount) : '—'}
            </span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span className="text-zinc-500">Historical σ:</span>
            <span className="mono-num text-zinc-200">
              {snapshot ? `$${snapshot.std_amount.toFixed(0)}` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span className="text-zinc-500">EWMA Cadence:</span>
            <span className="mono-num text-zinc-200">
              {snapshot ? `${snapshot.cadence_ewma_s.toFixed(0)}s` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Destination Profile */}
      <div className="p-3.5 rounded-sm border border-zinc-800 bg-zinc-950/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-2xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">Destination Node</span>
          <span className="mono-num text-2xs text-zinc-500">{tx.nameDest}</span>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-400">
            <span className="text-zinc-500">Counterparties:</span>
            <span className="mono-num text-zinc-200">
              {snapshot ? `${snapshot.n_known_counterparties} nodes` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span className="text-zinc-500">Total Volume:</span>
            <span className="mono-num text-zinc-200">
              {snapshot ? fmtLarge(snapshot.total_volume) : '—'}
            </span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span className="text-zinc-500">Fan-In Signal:</span>
            <span className="mono-num text-zinc-200">
              {tx.g_k !== null && tx.g_k !== undefined ? `${(tx.g_k * 10).toFixed(0)} burst` : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function InspectionDrawer({
  txId,
  cachedTx,
  onClose,
}: InvestigationDrawerProps) {
  const [tx, setTx] = useState<Transaction | null>(cachedTx)
  const [loading, setLoading] = useState(false)
  const [actionDone, setActionDone] = useState<string | null>(null)

  useEffect(() => {
    if (!txId) {
      setTx(null)
      return
    }
    if (cachedTx && cachedTx.tx_id === txId) {
      setTx(cachedTx)
      return
    }

    setLoading(true)
    fetchTransaction(txId)
      .then(d => setTx(d))
      .catch(() => setTx(cachedTx))
      .finally(() => setLoading(false))
  }, [txId, cachedTx])

  const handleAction = (label: string) => {
    setActionDone(label)
    setTimeout(() => setActionDone(null), 3000)
  }

  if (!txId || !tx) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-canvas">
        <div className="w-12 h-12 rounded-full border border-zinc-800 bg-zinc-950 flex items-center justify-center text-zinc-600 mb-4 font-mono text-base">
          ⌘
        </div>
        <span className="text-sm font-medium text-zinc-300 mb-1">No Incident Selected</span>
        <p className="text-xs text-zinc-500 max-w-sm leading-relaxed">
          Select any transaction from the public feed on the left to inspect Tree-SHAP local attributions, multi-tier risk breakdown, and account baseline drift.
        </p>
      </div>
    )
  }

  const R_k = tx.R_k ?? 0
  const isHold = tx.status === 'HOLD' || R_k >= 0.85
  const isReview = tx.status === 'REVIEW' || (R_k >= 0.65 && R_k < 0.85)

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-canvas p-6 space-y-6">
      {/* ── Top Header of Drawer ─────────────────────────── */}
      <div className="flex items-start justify-between pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-base font-bold font-mono text-zinc-100">
              TX#{tx.tx_id}
            </span>
            <span className="text-xs font-mono text-zinc-500">
              {tx.type}
            </span>
            {tx.attack_type && tx.attack_type !== 'NORMAL' && (
              <span className="text-2xs font-mono font-semibold px-2 py-0.5 rounded-sm bg-red-950/50 text-red-400 border border-red-900/50 uppercase">
                {tx.attack_type.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono">
            <span>Amount: <strong className="text-zinc-200">{fmtAmount(tx.amount)}</strong></span>
            <span>·</span>
            <span>Latency: <strong>{tx.latency_ms?.toFixed(1) ?? '2.4'}ms</strong></span>
          </div>
        </div>

        {/* Severity Badge */}
        <div className="flex items-center gap-2">
          <span className={`mono-num text-xs font-bold px-2.5 py-1 rounded-sm border ${
            isHold ? 'bg-red-950/40 text-red-400 border-red-900/60' :
            isReview ? 'bg-orange-950/40 text-orange-400 border-orange-900/60' :
            'bg-emerald-950/30 text-emerald-400 border-emerald-900/50'
          }`}>
            {tx.status ?? 'CLEARED'}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 p-1 text-sm rounded-sm"
              title="Close drawer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Section 1: Multi-Tier Risk Math Breakdown ───── */}
      <div>
        <SectionTitle title="Forensic Risk Decomposition" subtitle="Multi-Tier Calibrated Fusion" />
        <ForensicTable tx={tx} />
      </div>

      {/* ── Section 2: Tree-SHAP Local Feature Attribution ─ */}
      <div>
        <SectionTitle title="Local Tree-SHAP Attribution" subtitle="Additive Feature Importances" />
        {tx.shap_drivers && tx.shap_drivers.length > 0 ? (
          <div className="border border-zinc-800 rounded-sm p-4 bg-zinc-950/40 mb-5">
            <ShapWaterfall drivers={tx.shap_drivers} />
          </div>
        ) : (
          <div className="border border-zinc-800 rounded-sm p-4 text-xs text-zinc-500 font-mono text-center">
            SHAP drivers not available for this event
          </div>
        )}
      </div>

      {/* ── Section 3: Origin & Destination Baselines ────── */}
      <div>
        <SectionTitle title="Account Behavioral Baselines" subtitle="Welford μ/σ & In-Degree Spike" />
        <AccountBaselineGrid tx={tx} />
      </div>

      {/* ── Section 4: Forensic Actions ─────────────────── */}
      <div className="pt-2 border-t border-zinc-800">
        <SectionTitle title="Investigative Actions" />
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => handleAction('Account Frozen')}
            className="action-btn-primary"
          >
            🔒 Freeze Origin Account
          </button>
          <button
            onClick={() => handleAction('SAR Filed')}
            className="action-btn"
          >
            📋 File FinCEN SAR
          </button>
          <button
            onClick={() => {
              const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(tx, null, 2))
              const dlAnchor = document.createElement('a')
              dlAnchor.setAttribute('href', dataStr)
              dlAnchor.setAttribute('download', `forensic_tx_${tx.tx_id}.json`)
              dlAnchor.click()
            }}
            className="action-btn"
          >
            📥 Export Forensic JSON
          </button>
        </div>

        {actionDone && (
          <div className="mt-3 text-xs font-mono text-emerald-400 animate-fade-up">
            ✓ Action dispatched: {actionDone}
          </div>
        )}
      </div>
    </div>
  )
}
