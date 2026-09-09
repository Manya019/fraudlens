import { useState, useMemo, useEffect, useRef } from 'react'
import { Header } from './components/NavBar'
import { IncidentLedger } from './components/TransactionTable'
import { InspectionDrawer } from './components/InspectionDrawer'
import { MacroRingsView } from './components/MacroRingsView'
import { SinkLeaderboard } from './components/SinkLeaderboard'
import { useTransactionStream } from './hooks/useTransactionStream'
import { Transaction, FraudRing, fetchMacroRings } from './lib/api'

export default function App() {
  const { transactions, stats, paused, togglePause } = useTransactionStream()
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null)
  const [activeTab, setActiveTab] = useState<'feed' | 'sinks' | 'rings'>('feed')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [rings, setRings] = useState<FraudRing[]>([])
  const ringsRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Compute telemetry ribbon values from transaction stream
  const telemetry = useMemo(() => {
    const flagged = transactions.filter(
      tx => tx.status === 'HOLD' || tx.status === 'REVIEW'
    )
    const totalInterceptedVolume = flagged.reduce((s, tx) => s + tx.amount, 0)
    const compromisedAccounts = new Set(
      flagged.map(tx => tx.nameOrig)
    ).size
    const activeSinks = new Set(
      flagged.map(tx => tx.nameDest)
    ).size

    return { totalInterceptedVolume, compromisedAccounts, activeSinks }
  }, [transactions])

  // Automatically select the first high-risk tx if none selected yet
  useEffect(() => {
    if (!selectedTx && transactions.length > 0) {
      const highRisk = transactions.find(t => t.status === 'HOLD' || t.status === 'REVIEW')
      if (highRisk) {
        setSelectedTx(highRisk)
      } else {
        setSelectedTx(transactions[0])
      }
    }
  }, [transactions, selectedTx])

  // Periodically fetch rings for leaderboard
  useEffect(() => {
    const load = () =>
      fetchMacroRings()
        .then(d => setRings(d.rings))
        .catch(() => {})
    load()
    ringsRef.current = setInterval(load, 20_000)
    return () => { if (ringsRef.current) clearInterval(ringsRef.current) }
  }, [])

  // Estimate sim step from evaluated count (1 event ~2s)
  const simStep = Math.min(744, Math.floor(stats.evaluated * 2 / 360))

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden text-zinc-100 antialiased">
      {/* ── Header Ribbon & Navigation ───────────────────────── */}
      <Header
        evaluated={stats.evaluated}
        intercepted={stats.intercepted}
        activeSinks={telemetry.activeSinks}
        totalInterceptedVolume={telemetry.totalInterceptedVolume}
        compromisedAccounts={telemetry.compromisedAccounts}
        simStep={simStep}
        connected={stats.connected}
        paused={paused}
        onTogglePause={togglePause}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* ── Main Workstation ─────────────────────────────────── */}
      <main className="flex flex-1 overflow-hidden">
        {activeTab === 'feed' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left Pane: Public Incident Ledger (58%) */}
            <div className="w-[58%] flex flex-col border-r border-zinc-800 overflow-hidden bg-canvas">
              {paused && (
                <div className="px-5 py-2 bg-yellow-950/30 border-b border-yellow-900/40 text-xs font-mono text-yellow-400 flex items-center gap-2">
                  <span>⏸</span>
                  <span>Simulation stream paused — buffering live PaySim incoming events</span>
                </div>
              )}
              <div className="flex-1 overflow-hidden">
                <IncidentLedger
                  transactions={transactions}
                  selectedId={selectedTx?.tx_id ?? null}
                  onSelect={tx => setSelectedTx(tx)}
                  searchQuery={searchQuery}
                  activeFilter={activeFilter}
                />
              </div>
            </div>

            {/* Right Pane: Forensic Investigation Drawer (42%) */}
            <div className="w-[42%] flex flex-col overflow-hidden bg-zinc-950/20">
              <div className="flex-1 overflow-hidden">
                <InspectionDrawer
                  txId={selectedTx?.tx_id ?? null}
                  cachedTx={selectedTx}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sinks' && (
          <div className="flex-1 overflow-hidden bg-canvas">
            <SinkLeaderboard
              transactions={transactions}
              rings={rings}
            />
          </div>
        )}

        {activeTab === 'rings' && (
          <div className="flex-1 overflow-hidden bg-canvas">
            <MacroRingsView />
          </div>
        )}
      </main>
    </div>
  )
}
