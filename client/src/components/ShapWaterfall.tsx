import { ShapDriver } from '../lib/api'

interface ShapWaterfallProps {
  drivers: ShapDriver[]
}

const FEATURE_LABELS: Record<string, string> = {
  tx_type: 'Tx Type (enc)',
  amount: 'Amount Z-score',
  old_balance_orig: 'Orig Balance (old)',
  new_balance_orig: 'Orig Balance (new)',
  old_balance_dest: 'Dest Balance (old)',
  new_balance_dest: 'Dest Balance (new)',
  balance_err_orig: 'Balance Error (orig)',
  balance_err_dest: 'Balance Error (dest)',
  drain_ratio: 'Drain Ratio',
}

function formatRawValue(feature: string, value: number): string {
  if (feature === 'tx_type') {
    return ['PAYMENT', 'TRANSFER', 'CASH_OUT', 'CASH_IN', 'DEBIT'][Math.round(value)] ?? value.toFixed(1)
  }
  if (feature === 'drain_ratio') return `${(value * 100).toFixed(1)}%`
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`
  return value.toFixed(4)
}

export function ShapWaterfall({ drivers }: ShapWaterfallProps) {
  if (!drivers || drivers.length === 0) {
    return (
      <p className="text-xs text-zinc-600 py-1">
        SHAP attribution computed for R_k ≥ 0.65 only.
      </p>
    )
  }

  const maxAbs = Math.max(...drivers.map(d => Math.abs(d.contribution)), 0.001)

  return (
    <div className="flex flex-col gap-0">
      {drivers.map((d, i) => {
        const pct = (Math.abs(d.contribution) / maxAbs) * 100
        const isPos = d.contribution >= 0
        const label = FEATURE_LABELS[d.feature] ?? d.feature

        return (
          <div key={i} className="py-2.5 border-b border-zinc-800/40 last:border-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-zinc-400 font-medium">{label}</span>
              <div className="flex items-center gap-3">
                <span className="text-2xs font-mono text-zinc-600">
                  val: {formatRawValue(d.feature, d.raw_value)}
                </span>
                <span className={`mono-num text-xs font-semibold ${isPos ? 'text-red-400' : 'text-emerald-400'}`}>
                  {isPos ? '+' : ''}{d.contribution.toFixed(4)}
                </span>
              </div>
            </div>

            {/* Diverging bar */}
            <div className="flex items-center h-3 gap-0">
              {/* Negative side */}
              <div className="flex-1 flex justify-end h-3">
                {!isPos && (
                  <div
                    className="score-bar-neg"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
              {/* Center spine */}
              <div className="w-px h-3 bg-zinc-700 shrink-0 mx-0.5" />
              {/* Positive side */}
              <div className="flex-1 h-3">
                {isPos && (
                  <div
                    className="score-bar-pos"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
            </div>
          </div>
        )
      })}

      <div className="flex items-center gap-6 pt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-2 bg-red-400/70" />
          <span className="text-2xs text-zinc-600 mono-num">Increases fraud risk</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-2 bg-emerald-400/70" />
          <span className="text-2xs text-zinc-600 mono-num">Reduces fraud risk</span>
        </div>
      </div>
    </div>
  )
}
