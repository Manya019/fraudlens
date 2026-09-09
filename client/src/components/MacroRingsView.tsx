import { useEffect, useRef, useState } from 'react'
import { FraudRing, fetchMacroRings } from '../lib/api'

function fmtAmount(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function RingRow({ ring }: { ring: FraudRing }) {
  return (
    <div className={`border-b border-zinc-800/50 px-5 py-4 ${ring.flagged ? 'bg-red-950/10' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span className="mono-num text-sm font-semibold text-zinc-200">{ring.ring_id}</span>
            {ring.flagged && (
              <span className="text-2xs font-mono font-semibold text-red-400 border border-red-900/40 px-1.5 py-0.5 rounded-sm bg-red-950/30 tracking-widest">
                ⚠ FLAGGED — &gt;25% growth
              </span>
            )}
            {ring.is_persistent && !ring.flagged && (
              <span className="text-2xs font-mono font-semibold text-orange-400 border border-orange-900/40 px-1.5 py-0.5 rounded-sm tracking-widest">
                PERSISTENT
              </span>
            )}
          </div>

          {/* Attack types */}
          <div className="flex gap-1.5 flex-wrap">
            {ring.attack_types.map(t => (
              <span key={t} className="text-2xs font-mono text-zinc-500 border border-zinc-800 px-1.5 py-0.5 rounded-sm uppercase tracking-wide bg-zinc-900/40">
                {t.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>

        {/* Volume + growth */}
        <div className="text-right shrink-0">
          <div className="mono-num text-base font-bold text-red-400">{fmtAmount(ring.total_volume)}</div>
          {ring.growth_rate > 0 && (
            <div className={`mono-num text-xs font-semibold ${ring.flagged ? 'text-red-400' : 'text-orange-400'}`}>
              +{ring.growth_pct.toFixed(1)}% vol. growth
            </div>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-0 border border-zinc-800 rounded-sm overflow-hidden mb-3">
        {[
          { label: 'Members', value: ring.n_members.toString() },
          { label: 'Transactions', value: ring.tx_count.toString() },
          { label: 'Duration', value: `${ring.duration_minutes.toFixed(0)}m` },
          { label: 'Sinks', value: ring.sinks.length.toString() },
        ].map(({ label, value }, i) => (
          <div key={label} className={`px-3 py-2 flex flex-col gap-0.5 ${i < 3 ? 'border-r border-zinc-800' : ''}`}>
            <span className="label-xs">{label}</span>
            <span className="mono-num text-sm font-semibold text-zinc-200">{value}</span>
          </div>
        ))}
      </div>

      {/* Jaccard overlap meter */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="label-xs">Counterparty Jaccard Overlap</span>
          <span className="mono-num text-xs text-zinc-400">{(ring.jaccard_overlap * 100).toFixed(0)}%</span>
        </div>
        <div className="w-full h-1.5 bg-zinc-800/60">
          <div
            className="h-full transition-all duration-700"
            style={{
              width: `${ring.jaccard_overlap * 100}%`,
              background: ring.jaccard_overlap > 0.5 ? '#ef4444' : ring.jaccard_overlap > 0.25 ? '#f97316' : '#6366f1',
            }}
          />
        </div>
        {ring.is_persistent && (
          <p className="text-2xs text-zinc-600">
            Persistent ring: consistent membership overlap across 24h window. Possible mule coordination.
          </p>
        )}
      </div>

      {/* Sink accounts */}
      {ring.sinks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-800/40">
          <span className="label-xs block mb-1.5">Destination Sinks</span>
          <div className="flex flex-wrap gap-1">
            {ring.sinks.map(s => (
              <span key={s} className="mono-num text-2xs px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-sm">
                {s.slice(0, 12)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function MacroRingsView() {
  const [data, setData] = useState<{
    rings: FraudRing[]
    ring_count: number
    buffer_size: number
    stats: { evaluated: number; intercepted: number; active_sinks: number }
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true)
    try {
      const d = await fetchMacroRings()
      setData(d)
    } catch (_) {}
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(() => load(), 15_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const flagged = data?.rings.filter(r => r.flagged).length ?? 0
  const totalVolume = data?.rings.reduce((s, r) => s + r.total_volume, 0) ?? 0

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Section header */}
      <div className="sticky top-0 z-10 bg-canvas border-b border-zinc-800/60">
        {/* Stats row */}
        <div className="flex items-stretch border-b border-zinc-800/40 bg-zinc-950/30">
          {[
            { label: 'Active Rings', value: data?.ring_count ?? 0 },
            { label: 'Flagged (>25%)', value: flagged },
            { label: 'Events in Window', value: data?.buffer_size ?? 0 },
            { label: 'Total Volume', value: fmtAmount(totalVolume) },
          ].map(({ label, value }) => (
            <div key={label} className="ribbon-stat py-2.5">
              <span className="ribbon-stat-value">{value}</span>
              <span className="ribbon-stat-label">{label}</span>
            </div>
          ))}
          <div className="ml-auto flex items-center px-4">
            <button
              onClick={() => load(true)}
              className="action-btn text-xs"
            >
              {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* DBSCAN params */}
        <div className="flex items-center gap-3 px-5 py-2">
          <span className="label-xs">DBSCAN</span>
          <span className="mono-num text-2xs text-zinc-600">ε=0.45</span>
          <span className="text-zinc-800">·</span>
          <span className="mono-num text-2xs text-zinc-600">MinPts=5</span>
          <span className="text-zinc-800">·</span>
          <span className="mono-num text-2xs text-zinc-600">24h sliding window</span>
          <span className="text-zinc-800">·</span>
          <span className="mono-num text-2xs text-zinc-600">auto-refresh 15s</span>
        </div>
      </div>

      {/* Ring list */}
      {loading ? (
        <div className="flex flex-col gap-0">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="shimmer h-40 border-b border-zinc-800/40" />
          ))}
        </div>
      ) : !data || data.rings.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 px-5">
          <span className="text-3xl font-mono text-zinc-800">⬡</span>
          <div className="text-center">
            <p className="text-sm text-zinc-500">No Active Mule Rings</p>
            <p className="text-xs text-zinc-600 mt-1 max-w-xs leading-relaxed">
              DBSCAN clustering requires ≥{5} high-risk events (R_k ≥ 0.55) in the 24h window.
              Inject test events or wait for suspicious activity to accumulate.
            </p>
          </div>
        </div>
      ) : (
        data.rings.map(ring => <RingRow key={ring.ring_id} ring={ring} />)
      )}
    </div>
  )
}
