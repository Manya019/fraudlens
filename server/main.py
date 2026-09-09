"""
main.py — FraudLens Adaptive FastAPI application.

Endpoints:
  GET  /api/health
  GET  /api/transactions
  GET  /api/transaction/{tx_id}
  GET  /api/macro-rings
  POST /api/inject-attack
  GET  /ws/stream  (Server-Sent Events)
"""

import asyncio
import json
import time
from collections import deque
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from engine.cluster import HighRiskEvent, RingDetector
from engine.models import FraudScoringEngine, action_tier
from engine.profiler import AccountProfiler
from engine.shap_explainer import ShapExplainer
from simulator import Transaction, build_zero_day_tx, get_stats, increment_intercepted, transaction_stream

# ─── Global State ─────────────────────────────────────────────────────────────

scoring_engine = FraudScoringEngine()
profiler = AccountProfiler()
shap_explainer = ShapExplainer()
ring_detector = RingDetector()

# Rolling transaction store (last 500)
_tx_store: deque[dict] = deque(maxlen=500)
# Index for fast lookup
_tx_index: dict[str, dict] = {}

# SSE subscriber queues
_sse_subscribers: list[asyncio.Queue] = []

# Inject queue for zero-day attacks
_inject_queue: asyncio.Queue = asyncio.Queue()

# Latency tracking
_latency_ms_buffer: deque[float] = deque(maxlen=50)


# ─── Startup ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize models and start background transaction processor."""
    print("[FraudLens] Initializing scoring engine (this may take ~10s)...")
    # Run model training in thread pool to not block event loop
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, scoring_engine.initialize)
    shap_explainer.initialize(scoring_engine)
    print("[FraudLens] Engine ready. Starting transaction stream...")

    # Start background processor
    task = asyncio.create_task(run_transaction_processor())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="FraudLens Adaptive", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Transaction processor ────────────────────────────────────────────────────

async def score_and_store(tx: Transaction) -> dict:
    """Score a transaction through the full pipeline and persist it."""
    t_start = time.perf_counter()

    tx_dict = tx.to_dict()

    # 1. Behavioral deviation from account profiler
    b_k, profile = profiler.compute_behavioral_deviation(
        account_id=tx.nameOrig,
        amount=tx.amount,
        dest=tx.nameDest,
        current_time=tx.timestamp,
        new_balance=tx.newbalanceOrig,
    )

    # 2. Multi-tier scoring
    scores = scoring_engine.score_transaction(tx_dict, b_k)
    R_k = scores["R_k"]

    # 3. Action tier
    status = action_tier(R_k)

    # 4. SHAP explanations (only for high-risk)
    shap_drivers = None
    if R_k >= 0.65:
        try:
            shap_drivers = shap_explainer.explain(tx_dict)
        except Exception as e:
            print(f"[SHAP] Error: {e}")

    # 5. Account snapshot
    account_snapshot = profile.to_snapshot()

    # 6. Fan-in ring detection ingest
    if R_k >= 0.55:
        ring_detector.ingest(HighRiskEvent(
            tx_id=tx.tx_id,
            orig=tx.nameOrig,
            dest=tx.nameDest,
            amount=tx.amount,
            R_k=R_k,
            attack_type=tx.attack_type,
            timestamp=tx.timestamp,
            type=tx.type,
            b_k=scores["b_k"],
            g_k=scores["g_k"],
        ))
        ring_detector.maybe_run_clustering()

    # 7. Track interceptions
    if status in ("HOLD", "REVIEW"):
        increment_intercepted()

    # Latency
    latency_ms = (time.perf_counter() - t_start) * 1000
    _latency_ms_buffer.append(latency_ms)

    # Build enriched record
    enriched = {
        **tx_dict,
        **scores,
        "status": status,
        "shap_drivers": shap_drivers,
        "account_snapshot": account_snapshot,
        "latency_ms": round(latency_ms, 2),
    }

    # Store
    _tx_store.appendleft(enriched)
    _tx_index[tx.tx_id] = enriched

    return enriched


async def run_transaction_processor() -> None:
    """Background task: consume transaction stream, score, broadcast via SSE."""
    async for tx in transaction_stream(_inject_queue):
        try:
            enriched = await score_and_store(tx)
            # Broadcast to all SSE subscribers
            event_data = json.dumps({"type": "transaction", "data": enriched})
            dead_subs = []
            for q in _sse_subscribers:
                try:
                    q.put_nowait(event_data)
                except asyncio.QueueFull:
                    dead_subs.append(q)
            for q in dead_subs:
                _sse_subscribers.remove(q)
        except Exception as e:
            print(f"[Processor] Error: {e}")


# ─── SSE Endpoint ─────────────────────────────────────────────────────────────

async def sse_event_generator(queue: asyncio.Queue) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted events from the subscriber queue."""
    # Send initial heartbeat
    yield "data: {\"type\":\"connected\"}\n\n"
    try:
        while True:
            try:
                # Wait up to 15s, then send heartbeat
                data = await asyncio.wait_for(queue.get(), timeout=15.0)
                yield f"data: {data}\n\n"
            except asyncio.TimeoutError:
                yield "data: {\"type\":\"heartbeat\"}\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        if queue in _sse_subscribers:
            _sse_subscribers.remove(queue)


@app.get("/ws/stream")
async def stream_transactions():
    """SSE endpoint for real-time transaction events."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    _sse_subscribers.append(queue)
    return StreamingResponse(
        sse_event_generator(queue),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ─── REST Endpoints ───────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    stats = get_stats()
    avg_latency = (
        sum(_latency_ms_buffer) / len(_latency_ms_buffer)
        if _latency_ms_buffer else 0.0
    )
    return {
        "status": "ok",
        "engine_ready": scoring_engine._initialized,
        "profiles_tracked": profiler.profile_count(),
        "transactions_processed": stats["evaluated"],
        "transactions_intercepted": stats["intercepted"],
        "active_sinks": stats["active_sinks"],
        "avg_latency_ms": round(avg_latency, 2),
        "active_rings": ring_detector.ring_count(),
        "sse_subscribers": len(_sse_subscribers),
    }


@app.get("/api/transactions")
async def get_transactions(limit: int = 50):
    """Returns the trailing N processed transactions."""
    return {"transactions": list(_tx_store)[:limit]}


@app.get("/api/transaction/{tx_id}")
async def get_transaction(tx_id: str):
    """Full dossier for a specific transaction."""
    tx = _tx_index.get(tx_id)
    if not tx:
        raise HTTPException(status_code=404, detail=f"Transaction {tx_id} not found")
    return tx


@app.get("/api/macro-rings")
async def get_macro_rings():
    """Returns current active DBSCAN clusters and growth metadata."""
    rings = ring_detector.get_rings()
    stats = get_stats()
    return {
        "rings": rings,
        "ring_count": len(rings),
        "buffer_size": len(ring_detector._buffer),
        "stats": stats,
    }


@app.post("/api/inject-attack")
async def inject_attack():
    """Inject an immediate zero-day attack transaction."""
    tx = build_zero_day_tx()
    await _inject_queue.put(tx)
    return {
        "status": "injected",
        "tx_id": tx.tx_id,
        "amount": tx.amount,
        "attack_type": tx.attack_type,
        "message": "Zero-day attack transaction queued for immediate processing",
    }


@app.get("/api/stats")
async def get_live_stats():
    """Live telemetry stats for the UI ticker."""
    stats = get_stats()
    avg_latency = (
        sum(_latency_ms_buffer) / len(_latency_ms_buffer)
        if _latency_ms_buffer else 0.0
    )
    return {
        **stats,
        "avg_latency_ms": round(avg_latency, 2),
    }
