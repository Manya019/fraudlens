import { useEffect, useRef, useState, useCallback } from 'react'
import { Transaction, createEventSource, fetchTransactions } from '../lib/api'

const MAX_TRANSACTIONS = 200

interface StreamStats {
  evaluated: number
  intercepted: number
  activeSinks: number
  latencyMs: number
  connected: boolean
}

export function useTransactionStream() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [stats, setStats] = useState<StreamStats>({
    evaluated: 0,
    intercepted: 0,
    activeSinks: 0,
    latencyMs: 0,
    connected: false,
  })
  const [paused, setPaused] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const pausedRef = useRef(false)
  const pendingRef = useRef<Transaction[]>([])

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
    }

    const es = createEventSource()
    esRef.current = es

    es.onopen = () => {
      setStats(s => ({ ...s, connected: true }))
    }

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'heartbeat' || msg.type === 'connected') return

        if (msg.type === 'transaction') {
          const tx: Transaction = msg.data

          if (pausedRef.current) {
            pendingRef.current.push(tx)
            return
          }

          setTransactions(prev => {
            const next = [tx, ...prev].slice(0, MAX_TRANSACTIONS)
            return next
          })

          // Update stats
          setStats(s => {
            const evaluated = s.evaluated + 1
            const intercepted = s.intercepted + (
              tx.status === 'HOLD' || tx.status === 'REVIEW' ? 1 : 0
            )
            const latencyMs = tx.latency_ms ?? s.latencyMs
            return {
              ...s,
              evaluated,
              intercepted,
              latencyMs: Math.round(latencyMs * 10) / 10,
            }
          })
        }
      } catch (_) {
        // Ignore parse errors
      }
    }

    es.onerror = () => {
      setStats(s => ({ ...s, connected: false }))
      // Reconnect after 3s
      setTimeout(() => {
        if (esRef.current === es) {
          connect()
        }
      }, 3000)
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchTransactions(50)
      .then(txs => setTransactions(txs.reverse()))
      .catch(() => {})

    connect()

    return () => {
      esRef.current?.close()
    }
  }, [connect])

  const togglePause = useCallback(() => {
    setPaused(prev => {
      const next = !prev
      pausedRef.current = next
      if (!next) {
        // Flush pending transactions
        const pending = pendingRef.current.splice(0)
        if (pending.length > 0) {
          setTransactions(prev => {
            const combined = [...pending.reverse(), ...prev].slice(0, MAX_TRANSACTIONS)
            return combined
          })
        }
      }
      return next
    })
  }, [])

  // Track active sinks from transactions
  useEffect(() => {
    const sinks = new Set(
      transactions
        .filter(tx => tx.status === 'HOLD' || tx.status === 'REVIEW')
        .map(tx => tx.nameDest)
    )
    setStats(s => ({ ...s, activeSinks: sinks.size }))
  }, [transactions])

  return { transactions, stats, paused, togglePause }
}
