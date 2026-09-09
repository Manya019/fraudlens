import { useMemo } from 'react'
import { Transaction, FraudRing } from '../lib/api'

interface SinkLeaderboardProps {
  transactions: Transaction[]
  rings: FraudRing[]
}

interface SinkEntry {
  account: string
  inDegree: number
  totalVolume: number
  lastSeen: number
  associatedAttack: string
}

function fmtAmount(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function timeAgo(ts: number): string {
  const diff = (Date.now() / 1000) - ts
  if (diff < 10) return 'just now'
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function SinkLeaderboard({ transactions, rings }: SinkLeaderboardProps) {
  // Compute top sinks from transactions
  const topSinks = useMemo<SinkEntry[]>(() => {
    const map = new Map<string, SinkEntry>()

    for (const tx of transactions) {
      if (!tx.status || tx.status === 'CLEARED') continue
      const dest = tx.nameDest
      const existing = map.get(dest) ?? {
        account: dest,
        inDegree: 0,
        totalVolume: 0,
        lastSeen: 0,
        associatedAttack: tx.attack_type || 'ANOMALOUS',
      }
      map.set(dest, {
        account: dest,
        inDegree: existing.inDegree + 1,
        totalVolume: existing.totalVolume + tx.amount,
        lastSeen: Math.max(existing.lastSeen, tx.timestamp),
        associatedAttack: tx.attack_type || existing.associatedAttack,
      })
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, 15)
  }, [transactions])

  const maxVolume = topSinks.length > 0 ? topSinks[0].totalVolume : 1

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-canvas p-8 max-w-6xl mx-auto space-y-8">
      {/* ── Page Header ────────────────────────────────────── */}
      <div className="border-b border-zinc-800 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-mono text-zinc-100 mb-1">
              Top Destination Sinks &amp; Mule Concentration
            </h2>
            <p className="text-xs text-zinc-400">
              Ranked destination accounts exhibiting high in-degree bursts and rapid monetary funneling.
            </p>
          </div>
          <span className="text-xs font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-sm">
            {topSinks.length} active sinks monitored
          </span>
        </div>
      </div>

      {/* ── Sinks Table ────────────────────────────────────── */}
      <div className="border border-zinc-800 rounded-sm overflow-hidden bg-zinc-950/40">
        <div className="grid grid-cols-[60px_1.5fr_120px_1.5fr_100px] gap-4 px-5 py-3 bg-zinc-900/60 border-b border-zinc-800 text-xs font-mono uppercase tracking-wider text-zinc-500">
          <span>Rank</span>
          <span>Destination Node</span>
          <span>In-Degree</span>
          <span>Total Funnelled (USD)</span>
          <span className="text-right">Last Seen</span>
        </div>

        {topSinks.length === 0 ? (
          <div className="p-12 text-center text-xs text-zinc-500 font-mono">
            No suspicious destination sinks identified yet. High-risk transactions will appear here in real-time.
          </div>
        ) : (
          topSinks.map((sink, idx) => {
            const volPct = Math.min(100, (sink.totalVolume / maxVolume) * 100)
            return (
              <div
                key={sink.account}
                className="grid grid-cols-[60px_1.5fr_120px_1.5fr_100px] gap-4 px-5 py-4 border-b border-zinc-800/40 last:border-0 items-center hover:bg-zinc-900/30 transition-colors"
              >
                {/* Rank Badge */}
                <span className={`mono-num text-sm font-bold ${
                  idx === 0 ? 'text-red-400' : idx === 1 ? 'text-orange-400' : idx === 2 ? 'text-yellow-400' : 'text-zinc-500'
                }`}>
                  #{idx + 1}
                </span>

                {/* Account details */}
                <div className="flex flex-col min-w-0">
                  <span className="mono-num text-sm font-semibold text-zinc-200 truncate">
                    {sink.account}
                  </span>
                  <span className="text-2xs font-mono text-zinc-500 mt-0.5">
                    Modality: {sink.associatedAttack.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Inbound count */}
                <div className="flex items-center gap-1.5">
                  <span className="mono-num text-sm font-semibold text-zinc-200">
                    {sink.inDegree}
                  </span>
                  <span className="text-xs text-zinc-500">txs</span>
                </div>

                {/* Volume Progress Bar */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs mono-num">
                    <span className="font-bold text-zinc-100">{fmtAmount(sink.totalVolume)}</span>
                    <span className="text-zinc-500">{volPct.toFixed(0)}% max</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-900 rounded-none overflow-hidden border border-zinc-800">
                    <div
                      className="h-full bg-red-500/80 transition-all duration-500"
                      style={{ width: `${volPct}%` }}
                    />
                  </div>
                </div>

                {/* Last active */}
                <span className="mono-num text-xs text-zinc-400 text-right">
                  {timeAgo(sink.lastSeen)}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* ── Associated DBSCAN Syndicates ────────────────────── */}
      {rings.length > 0 && (
        <div className="border-t border-zinc-800 pt-6">
          <h3 className="text-sm font-bold font-mono text-zinc-200 uppercase tracking-wider mb-4">
            Connected Syndicates &amp; Mule Rings ({rings.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rings.map(ring => (
              <div key={ring.ring_id} className="p-4 rounded-sm border border-zinc-800 bg-zinc-950/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-bold text-zinc-100">
                    Syndicate #{ring.cluster_label} ({ring.ring_id.slice(0, 8)})
                  </span>
                  <span className="text-2xs font-mono text-red-400 bg-red-950/40 border border-red-900/40 px-2 py-0.5 rounded-sm">
                    Jaccard {ring.jaccard_overlap.toFixed(2)}
                  </span>
                </div>
                <div className="text-xs text-zinc-400 space-y-1 font-mono">
                  <div>Accounts: <strong className="text-zinc-200">{ring.n_members}</strong></div>
                  <div>Sinks Targeted: <strong className="text-zinc-200">{ring.sinks.join(', ') || '—'}</strong></div>
                  <div>Total Volume: <strong className="text-zinc-200">{fmtAmount(ring.total_volume)}</strong></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
