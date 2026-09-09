"""
cluster.py — DBSCAN-based fraud ring detection over a 24-hour sliding window.

Detects:
  - Mule funnels (fan-in bursts converging to one sink)
  - Micro-structuring clusters (many near-threshold transactions)
  - Volumetric growth rings with >25% growth rate
"""

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler


# ─── Config ───────────────────────────────────────────────────────────────────
WINDOW_SECONDS = 86_400   # 24-hour simulation window
DBSCAN_EPS = 0.45
DBSCAN_MIN_SAMPLES = 5
GROWTH_THRESHOLD = 0.25   # 25% volumetric growth triggers flag


@dataclass
class FraudRing:
    ring_id: str
    cluster_label: int
    members: list[str]          # Account IDs involved
    sinks: list[str]            # Destination accounts
    total_volume: float
    prev_volume: float          # Previous snapshot for growth rate
    growth_rate: float          # (total - prev) / prev
    jaccard_overlap: float      # Counterparty set similarity
    tx_count: int
    first_seen: float
    last_seen: float
    attack_types: list[str]
    is_persistent: bool = False

    def to_dict(self) -> dict:
        return {
            "ring_id": str(self.ring_id),
            "cluster_label": int(self.cluster_label),
            "members": [str(m) for m in self.members[:10]],
            "n_members": int(len(self.members)),
            "sinks": [str(s) for s in self.sinks[:5]],
            "total_volume": float(round(float(self.total_volume), 2)),
            "growth_rate": float(round(float(self.growth_rate), 4)),
            "growth_pct": float(round(float(self.growth_rate) * 100, 1)),
            "jaccard_overlap": float(round(float(self.jaccard_overlap), 4)),
            "tx_count": int(self.tx_count),
            "duration_minutes": float(round(float(self.last_seen - self.first_seen) / 60, 1)),
            "attack_types": [str(a) for a in list(set(self.attack_types))[:4]],
            "is_persistent": bool(self.is_persistent),
            "flagged": bool(self.growth_rate > GROWTH_THRESHOLD),
        }


@dataclass
class HighRiskEvent:
    tx_id: str
    orig: str
    dest: str
    amount: float
    R_k: float
    attack_type: str
    timestamp: float
    type: str
    b_k: float = 0.0
    g_k: float = 0.0


class RingDetector:
    """
    Sliding-window DBSCAN ring detector.
    """

    def __init__(self):
        self._buffer: list[HighRiskEvent] = []
        self._rings: dict[str, FraudRing] = {}
        self._ring_volume_history: dict[str, list[float]] = defaultdict(list)
        self._last_cluster_run: float = 0.0
        self._cluster_interval_s = 30.0  # Re-cluster every 30s

    def ingest(self, event: HighRiskEvent) -> None:
        """Add a high-risk event to the sliding window buffer."""
        self._buffer.append(event)
        # Prune expired events
        cutoff = time.time() - WINDOW_SECONDS
        self._buffer = [e for e in self._buffer if e.timestamp >= cutoff]

    def maybe_run_clustering(self) -> bool:
        """Run DBSCAN if enough time has passed. Returns True if clustering ran."""
        now = time.time()
        if now - self._last_cluster_run < self._cluster_interval_s:
            return False
        if len(self._buffer) < DBSCAN_MIN_SAMPLES:
            return False
        self._run_clustering()
        self._last_cluster_run = now
        return True

    def _build_feature_matrix(self) -> np.ndarray:
        """
        Build feature matrix for DBSCAN.
        Features per event: [amount_log, R_k, b_k, g_k, type_enc]
        """
        type_map = {"PAYMENT": 0, "TRANSFER": 1, "CASH_OUT": 2, "CASH_IN": 3, "DEBIT": 4}
        rows = []
        for e in self._buffer:
            amt_log = np.log1p(e.amount) / 20.0
            type_enc = type_map.get(e.type, 1) / 4.0
            rows.append([
                amt_log,
                e.R_k,
                e.b_k,
                e.g_k,
                type_enc,
            ])
        return np.array(rows, dtype=np.float64)

    def _run_clustering(self) -> None:
        """Execute DBSCAN and update ring registry."""
        if len(self._buffer) < DBSCAN_MIN_SAMPLES:
            return

        X = self._build_feature_matrix()
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        db = DBSCAN(eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES, metric="euclidean")
        labels = db.fit_predict(X_scaled)

        # Group events by cluster
        clusters: dict[int, list[HighRiskEvent]] = defaultdict(list)
        for label, event in zip(labels, self._buffer):
            if label == -1:
                continue  # Noise
            clusters[label].append(event)

        # Build ring objects
        new_rings: dict[str, FraudRing] = {}

        for label, events in clusters.items():
            ring_id = f"RING-{label:03d}"
            origs = [e.orig for e in events]
            dests = [e.dest for e in events]
            total_vol = sum(e.amount for e in events)
            members = list(set(origs))
            sinks = list(set(dests))
            attack_types = [e.attack_type for e in events]

            # Compute Jaccard overlap with previous ring snapshot
            prev_ring = self._rings.get(ring_id)
            jaccard = 0.0
            prev_vol = 0.0
            if prev_ring:
                prev_members = set(prev_ring.members)
                curr_members = set(members)
                union = prev_members | curr_members
                inter = prev_members & curr_members
                jaccard = len(inter) / len(union) if union else 0.0
                prev_vol = prev_ring.total_volume

            # Growth rate
            growth_rate = (total_vol - prev_vol) / max(prev_vol, 1.0)

            ring = FraudRing(
                ring_id=ring_id,
                cluster_label=label,
                members=members,
                sinks=sinks,
                total_volume=total_vol,
                prev_volume=prev_vol,
                growth_rate=growth_rate,
                jaccard_overlap=jaccard,
                tx_count=len(events),
                first_seen=min(e.timestamp for e in events),
                last_seen=max(e.timestamp for e in events),
                attack_types=attack_types,
                is_persistent=jaccard > 0.5,
            )
            new_rings[ring_id] = ring

        self._rings = new_rings

    def get_rings(self) -> list[dict]:
        """Return all active rings as serializable dicts."""
        return [r.to_dict() for r in sorted(
            self._rings.values(),
            key=lambda r: r.total_volume,
            reverse=True,
        )]

    def ring_count(self) -> int:
        return len(self._rings)
