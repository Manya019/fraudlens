import { useState, useEffect } from 'react'
import { injectAttack } from '../lib/api'

interface HeaderProps {
  evaluated: number
  intercepted: number
  activeSinks: number
  totalInterceptedVolume: number
  compromisedAccounts: number
  simStep: number
  connected: boolean
  paused: boolean
  onTogglePause: () => void
  searchQuery: string
  onSearchChange: (q: string) => void
  activeFilter: string
  onFilterChange: (f: string) => void
  activeTab: 'feed' | 'sinks' | 'rings'
  onTabChange: (t: 'feed' | 'sinks' | 'rings') => void
}

const FILTERS = [
  { id: 'all', label: 'All Incidents' },
  { id: 'hold', label: 'Critical Holds (R_k ≥ 0.85)' },
  { id: 'review', label: 'High Risk (R_k ≥ 0.65)' },
  { id: 'transfer', label: 'Transfer Modality' },
  { id: 'cashout', label: 'Cash-Out Modality' },
]

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function Header({
  evaluated,
  intercepted,
  activeSinks,
  totalInterceptedVolume,
  compromisedAccounts,
  simStep,
  connected,
  paused,
  onTogglePause,
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
  activeTab,
  onTabChange,
}: HeaderProps) {
  const [injecting, setInjecting] = useState(false)
  const [injectFeedback, setInjectFeedback] = useState<string | null>(null)

  const handleInject = async () => {
    if (injecting) return
    setInjecting(true)
    try {
      const r = await injectAttack()
      setInjectFeedback(`Injected: ${r.tx_id} · $${(r.amount / 1000).toFixed(0)}K zero-day`)
      setTimeout(() => setInjectFeedback(null), 5000)
    } catch (_) {}
    setInjecting(false)
  }

  // Keyboard shortcut for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.getElementById('ledger-search')?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <header className="border-b border-zinc-800 bg-canvas sticky top-0 z-50 select-none">
      {/* ── Top brand row ──────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-semibold tracking-tight text-zinc-100 font-mono">
              fraudlens.fyi
            </span>
            <span className="text-zinc-600 text-xs">—</span>
            <span className="text-zinc-400 text-xs hidden md:inline">
              Real-time Financial Fraud &amp; Mule Syndicate Ledger
            </span>
          </div>

          {/* Live simulation pill */}
          <div className={`flex items-center gap-2 px-2.5 py-1 rounded-sm border text-xs font-mono font-medium tracking-wider ${
            connected
              ? 'border-emerald-800/50 text-emerald-400 bg-emerald-950/20'
              : 'border-zinc-700 text-zinc-500 bg-zinc-900'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-blink' : 'bg-zinc-600'}`} />
            {connected
              ? `LIVE REPLAY · STEP ${simStep}/744`
              : 'CONNECTING…'}
          </div>
        </div>

        {/* Top Right Controls */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={onTogglePause}
            className={`action-btn ${paused ? 'border-yellow-700 text-yellow-400 bg-yellow-950/20' : ''}`}
          >
            {paused ? '▶ Resume Feed' : '⏸ Pause'}
          </button>
          <button
            onClick={handleInject}
            disabled={injecting}
            className="action-btn border-red-900/60 text-red-400 hover:border-red-700 hover:text-red-300 disabled:opacity-40"
          >
            ⚡ {injecting ? 'Injecting…' : 'Inject Attack'}
          </button>
        </div>
      </div>

      {/* ── Telemetry ribbon ───────────────────────────────── */}
      <div className="flex items-center overflow-x-auto border-b border-zinc-800/60 bg-zinc-950/40">
        <div className="ribbon-stat py-2.5">
          <span className="ribbon-stat-value">{fmt(totalInterceptedVolume)}</span>
          <span className="ribbon-stat-label">Volume Intercepted</span>
        </div>
        <div className="ribbon-stat py-2.5">
          <span className="ribbon-stat-value">{compromisedAccounts}</span>
          <span className="ribbon-stat-label">Compromised Accounts</span>
        </div>
        <div className="ribbon-stat py-2.5">
          <span className="ribbon-stat-value">{activeSinks}</span>
          <span className="ribbon-stat-label">Active Mule Sinks</span>
        </div>
        <div className="ribbon-stat py-2.5">
          <span className="ribbon-stat-value">{intercepted.toLocaleString()}</span>
          <span className="ribbon-stat-label">Flagged Incidents</span>
        </div>
        <div className="ribbon-stat py-2.5">
          <span className="ribbon-stat-value">{evaluated.toLocaleString()}</span>
          <span className="ribbon-stat-label">Total Evaluated</span>
        </div>
        <div className="ribbon-stat py-2.5">
          <span className="ribbon-stat-value text-emerald-400">&lt; 0.1%</span>
          <span className="ribbon-stat-label">False Friction</span>
        </div>

        {/* Injection Toast */}
        {injectFeedback && (
          <div className="ml-auto mr-4 flex items-center px-3 py-1 text-xs font-mono text-red-400 bg-red-950/30 border border-red-900/40 rounded-sm animate-fade-up">
            ⚡ {injectFeedback}
          </div>
        )}
      </div>

      {/* ── Search + Filter Chips + Primary View Tabs ─────── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between px-6 py-2 gap-3 bg-zinc-950/20">
        {/* Left: Search input */}
        <div className="flex items-center gap-2 flex-1 max-w-lg border border-zinc-800 rounded-sm px-3 py-1.5 bg-zinc-900/40 focus-within:border-zinc-600 transition-colors">
          <span className="text-zinc-500 text-sm shrink-0">⌕</span>
          <input
            id="ledger-search"
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search accounts, TX hash (e.g., C19830211), or status…"
            className="search-input text-xs"
          />
          <kbd className="shrink-0 px-1.5 py-0.5 text-xs font-mono text-zinc-500 border border-zinc-700/50 rounded-sm bg-zinc-900">
            ⌘K
          </kbd>
        </div>

        {/* Center/Right: Filter Chips */}
        {activeTab === 'feed' && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => onFilterChange(f.id)}
                className={`filter-chip ${activeFilter === f.id ? 'active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Primary View Switcher Tabs */}
        <div className="flex items-center border border-zinc-800 rounded-sm p-0.5 bg-zinc-900/60 shrink-0">
          <button
            onClick={() => onTabChange('feed')}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
              activeTab === 'feed' ? 'bg-zinc-100 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Public Incident Ledger
          </button>
          <button
            onClick={() => onTabChange('sinks')}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
              activeTab === 'sinks' ? 'bg-zinc-100 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Mule Sinks Leaderboard
          </button>
          <button
            onClick={() => onTabChange('rings')}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
              activeTab === 'rings' ? 'bg-zinc-100 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Coordinated Rings (DBSCAN)
          </button>
        </div>
      </div>
    </header>
  )
}
