"""
profiler.py — In-memory dynamic account profile cache.

Tracks per-account running statistics using Welford's online algorithm
for numerically stable mean/variance, EWMA for transaction cadence,
and a bounded set of known counterparties.
"""

import math
import time
from dataclasses import dataclass, field
from typing import Optional


# EWMA smoothing factor for cadence (λ)
_EWMA_ALPHA = 0.3
# Maximum known counterparties to track per account
_MAX_COUNTERPARTIES = 50
# Minimum transactions before deviation is meaningful
_MIN_TX_FOR_DEVIATION = 3


@dataclass
class AccountProfile:
    account_id: str
    # Welford online mean/variance
    n: int = 0
    mean: float = 0.0       # μ_k
    M2: float = 0.0         # Running sum of squared deviations
    # EWMA inter-arrival cadence (seconds between txs)
    last_tx_time: Optional[float] = None
    cadence_ewma: float = 0.0   # λ_k (lower = faster = more suspicious)
    # Known counterparty set D_k
    known_counterparties: set = field(default_factory=set)
    # Balance tracking
    last_balance: float = 0.0
    # Total volume
    total_volume: float = 0.0

    @property
    def std(self) -> float:
        """σ_k — sample standard deviation."""
        if self.n < 2:
            return 0.0
        return math.sqrt(self.M2 / (self.n - 1))

    def update(self, amount: float, dest: str, current_time: float, new_balance: float) -> None:
        """Update profile with a new transaction using Welford's algorithm."""
        # Welford update for mean and variance
        self.n += 1
        delta = amount - self.mean
        self.mean += delta / self.n
        delta2 = amount - self.mean
        self.M2 += delta * delta2

        # EWMA cadence update
        if self.last_tx_time is not None:
            inter_arrival = current_time - self.last_tx_time
            if self.cadence_ewma == 0.0:
                self.cadence_ewma = inter_arrival
            else:
                self.cadence_ewma = (
                    _EWMA_ALPHA * inter_arrival + (1 - _EWMA_ALPHA) * self.cadence_ewma
                )
        self.last_tx_time = current_time

        # Track known counterparties (bounded)
        if len(self.known_counterparties) < _MAX_COUNTERPARTIES:
            self.known_counterparties.add(dest)

        self.last_balance = new_balance
        self.total_volume += amount

    def to_snapshot(self) -> dict:
        return {
            "account_id": self.account_id,
            "n_transactions": self.n,
            "mean_amount": round(self.mean, 2),
            "std_amount": round(self.std, 2),
            "cadence_ewma_s": round(self.cadence_ewma, 2),
            "n_known_counterparties": len(self.known_counterparties),
            "known_counterparties_sample": list(self.known_counterparties)[:8],
            "last_balance": round(self.last_balance, 2),
            "total_volume": round(self.total_volume, 2),
        }


class AccountProfiler:
    """
    Maintains in-memory account profiles and computes behavioral deviation b_k.
    """

    def __init__(self):
        self._profiles: dict[str, AccountProfile] = {}

    def get_or_create(self, account_id: str) -> AccountProfile:
        if account_id not in self._profiles:
            self._profiles[account_id] = AccountProfile(account_id=account_id)
        return self._profiles[account_id]

    def compute_behavioral_deviation(
        self,
        account_id: str,
        amount: float,
        dest: str,
        current_time: float,
        new_balance: float,
    ) -> tuple[float, AccountProfile]:
        """
        Computes b_k ∈ [0,1] as a composite behavioral deviation score.

        Components:
        - amount_z: Z-score of amount vs profile mean/std (normalized)
        - cadence_z: Deviation from expected inter-arrival time
        - novelty: Whether destination is a new counterparty (1 or 0)
        - drain_ratio: (old_balance - new_balance) / old_balance if large

        Returns (b_k, updated_profile).
        """
        profile = self.get_or_create(account_id)

        # --- Amount Z-score ---
        if profile.n >= _MIN_TX_FOR_DEVIATION and profile.std > 0:
            z_amount = abs(amount - profile.mean) / profile.std
            # Sigmoid-normalize: high z-score → closer to 1
            amount_deviation = 1 / (1 + math.exp(-0.5 * (z_amount - 3)))
        elif profile.n >= 1 and profile.mean > 0:
            # Simple ratio deviation before we have good stats
            ratio = amount / profile.mean
            amount_deviation = min(1.0, max(0.0, (ratio - 1) / 9))
        else:
            amount_deviation = 0.1  # No history, slight uncertainty

        # --- Cadence deviation ---
        if profile.cadence_ewma > 0 and profile.last_tx_time is not None:
            inter_arrival = current_time - profile.last_tx_time
            cadence_ratio = profile.cadence_ewma / max(inter_arrival, 0.1)
            cadence_deviation = min(1.0, max(0.0, (cadence_ratio - 1) / 10))
        else:
            cadence_deviation = 0.0

        # --- Counterparty novelty ---
        novelty = 0.0 if dest in profile.known_counterparties else 0.3

        # --- Drain ratio ---
        if profile.last_balance > 0:
            drain = amount / profile.last_balance
            drain_deviation = min(1.0, max(0.0, drain * 0.8))
        else:
            drain_deviation = 0.0

        # Weighted composite
        b_k = min(1.0, (
            0.40 * amount_deviation
            + 0.25 * cadence_deviation
            + 0.20 * novelty
            + 0.15 * drain_deviation
        ))

        # Update profile AFTER computing deviation (so first tx gets baseline)
        profile.update(amount, dest, current_time, new_balance)

        return b_k, profile

    def get_profile(self, account_id: str) -> Optional[AccountProfile]:
        return self._profiles.get(account_id)

    def profile_count(self) -> int:
        return len(self._profiles)
