"""
simulator.py — PaySim-based transaction generator.

Generates a continuous stream of financial transactions, 85% normal and 15% suspicious.
Each transaction follows the PaySim schema with additional metadata.
"""

import asyncio
import random
import string
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import AsyncGenerator, Optional


class TxType(str, Enum):
    PAYMENT = "PAYMENT"
    TRANSFER = "TRANSFER"
    CASH_OUT = "CASH_OUT"
    CASH_IN = "CASH_IN"
    DEBIT = "DEBIT"


class AttackType(str, Enum):
    NORMAL = "NORMAL"
    LARGE_TRANSFER = "LARGE_TRANSFER"
    VELOCITY_SURGE = "VELOCITY_SURGE"
    FAN_IN_BURST = "FAN_IN_BURST"
    ZERO_DAY = "ZERO_DAY"
    STRUCTURING = "STRUCTURING"


# Account name pool
_ACCOUNT_POOL: list[str] = []
_MERCHANT_POOL: list[str] = []

def _gen_account_name(prefix: str) -> str:
    suffix = "".join(random.choices(string.digits, k=9))
    return f"{prefix}{suffix}"

def _init_pools(n_accounts: int = 200, n_merchants: int = 80) -> None:
    global _ACCOUNT_POOL, _MERCHANT_POOL
    random.seed(42)
    _ACCOUNT_POOL = [_gen_account_name("C") for _ in range(n_accounts)]
    _MERCHANT_POOL = [_gen_account_name("M") for _ in range(n_merchants)]
    random.seed()  # Re-randomize after seeding

_init_pools()

# Simulated step counter (PaySim uses "step" as hour in simulation)
_sim_step = 0
_evaluated_count = 0
_intercepted_count = 0
_active_sinks: set[str] = set()


@dataclass
class Transaction:
    tx_id: str
    step: int
    type: str
    amount: float
    nameOrig: str
    oldbalanceOrg: float
    newbalanceOrig: float
    nameDest: str
    oldbalanceDest: float
    newbalanceDest: float
    timestamp: float
    attack_type: str = AttackType.NORMAL
    is_suspicious: bool = False
    # Scored fields (filled by engine)
    p_k: Optional[float] = None
    b_k: Optional[float] = None
    a_k: Optional[float] = None
    g_k: Optional[float] = None
    R_k: Optional[float] = None
    status: Optional[str] = None
    shap_drivers: Optional[list] = None
    account_snapshot: Optional[dict] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def _make_account_state(base: float) -> tuple[float, float]:
    """Returns (old_balance, new_balance) for a transaction of `amount`."""
    return base, max(0.0, base - base * random.uniform(0.1, 0.9))


def _random_amount_normal() -> float:
    """Log-normal distribution mimicking PaySim normal transactions."""
    return round(random.lognormvariate(6.5, 1.2), 2)


def _random_amount_large() -> float:
    """Large suspicious transfer amount."""
    return round(random.uniform(200_000, 1_000_000), 2)


def _random_amount_structured() -> float:
    """Micro-structuring below reporting threshold ($9,000–$9,999)."""
    return round(random.uniform(8_500, 9_990), 2)


def _build_normal_tx(step: int) -> Transaction:
    tx_type = random.choices(
        [TxType.PAYMENT, TxType.TRANSFER, TxType.CASH_OUT, TxType.CASH_IN, TxType.DEBIT],
        weights=[40, 25, 15, 10, 10],
    )[0]

    orig = random.choice(_ACCOUNT_POOL)
    if tx_type in (TxType.PAYMENT, TxType.DEBIT):
        dest = random.choice(_MERCHANT_POOL)
    else:
        dest = random.choice([a for a in _ACCOUNT_POOL if a != orig])

    amount = _random_amount_normal()
    old_orig = round(random.uniform(amount * 1.1, amount * 10), 2)
    new_orig = round(old_orig - amount, 2)
    old_dest = round(random.uniform(0, 50_000), 2)
    new_dest = round(old_dest + amount, 2)

    return Transaction(
        tx_id=str(uuid.uuid4())[:8].upper(),
        step=step,
        type=tx_type.value,
        amount=amount,
        nameOrig=orig,
        oldbalanceOrg=old_orig,
        newbalanceOrig=new_orig,
        nameDest=dest,
        oldbalanceDest=old_dest,
        newbalanceDest=new_dest,
        timestamp=time.time(),
        attack_type=AttackType.NORMAL,
        is_suspicious=False,
    )


def _build_large_transfer_tx(step: int) -> Transaction:
    """Sudden large TRANSFER draining orig balance."""
    orig = random.choice(_ACCOUNT_POOL)
    dest = random.choice([a for a in _ACCOUNT_POOL if a != orig])
    amount = _random_amount_large()
    old_orig = round(amount * random.uniform(1.0, 1.05), 2)
    new_orig = 0.0  # Near-complete drain
    old_dest = round(random.uniform(0, 5_000), 2)
    new_dest = round(old_dest + amount, 2)
    _active_sinks.add(dest)
    return Transaction(
        tx_id=str(uuid.uuid4())[:8].upper(),
        step=step,
        type=TxType.TRANSFER.value,
        amount=amount,
        nameOrig=orig,
        oldbalanceOrg=old_orig,
        newbalanceOrig=new_orig,
        nameDest=dest,
        oldbalanceDest=old_dest,
        newbalanceDest=new_dest,
        timestamp=time.time(),
        attack_type=AttackType.LARGE_TRANSFER,
        is_suspicious=True,
    )


def _build_velocity_surge_tx(step: int, shared_orig: Optional[str] = None) -> Transaction:
    """Rapid repeated transfers from the same origin."""
    orig = shared_orig or random.choice(_ACCOUNT_POOL)
    dest = random.choice([a for a in _ACCOUNT_POOL if a != orig])
    amount = round(random.uniform(5_000, 30_000), 2)
    old_orig = round(random.uniform(amount * 2, amount * 5), 2)
    new_orig = round(old_orig - amount, 2)
    old_dest = round(random.uniform(0, 20_000), 2)
    new_dest = round(old_dest + amount, 2)
    return Transaction(
        tx_id=str(uuid.uuid4())[:8].upper(),
        step=step,
        type=TxType.TRANSFER.value,
        amount=amount,
        nameOrig=orig,
        oldbalanceOrg=old_orig,
        newbalanceOrig=new_orig,
        nameDest=dest,
        oldbalanceDest=old_dest,
        newbalanceDest=new_dest,
        timestamp=time.time(),
        attack_type=AttackType.VELOCITY_SURGE,
        is_suspicious=True,
    )


def _build_fan_in_burst_tx(step: int, shared_dest: Optional[str] = None) -> Transaction:
    """Many senders converging on one mule destination."""
    orig = random.choice(_ACCOUNT_POOL)
    dest = shared_dest or random.choice([a for a in _ACCOUNT_POOL if a != orig])
    amount = round(random.uniform(1_000, 15_000), 2)
    old_orig = round(random.uniform(amount * 1.1, amount * 3), 2)
    new_orig = round(old_orig - amount, 2)
    old_dest = round(random.uniform(10_000, 100_000), 2)
    new_dest = round(old_dest + amount, 2)
    _active_sinks.add(dest)
    return Transaction(
        tx_id=str(uuid.uuid4())[:8].upper(),
        step=step,
        type=TxType.CASH_OUT.value,
        amount=amount,
        nameOrig=orig,
        oldbalanceOrg=old_orig,
        newbalanceOrig=new_orig,
        nameDest=dest,
        oldbalanceDest=old_dest,
        newbalanceDest=new_dest,
        timestamp=time.time(),
        attack_type=AttackType.FAN_IN_BURST,
        is_suspicious=True,
    )


def _build_structuring_tx(step: int) -> Transaction:
    """Micro-structuring to avoid reporting thresholds."""
    orig = random.choice(_ACCOUNT_POOL)
    dest = random.choice([a for a in _ACCOUNT_POOL if a != orig])
    amount = _random_amount_structured()
    old_orig = round(random.uniform(50_000, 200_000), 2)
    new_orig = round(old_orig - amount, 2)
    old_dest = round(random.uniform(0, 10_000), 2)
    new_dest = round(old_dest + amount, 2)
    return Transaction(
        tx_id=str(uuid.uuid4())[:8].upper(),
        step=step,
        type=TxType.TRANSFER.value,
        amount=amount,
        nameOrig=orig,
        oldbalanceOrg=old_orig,
        newbalanceOrig=new_orig,
        nameDest=dest,
        oldbalanceDest=old_dest,
        newbalanceDest=new_dest,
        timestamp=time.time(),
        attack_type=AttackType.STRUCTURING,
        is_suspicious=True,
    )


def build_zero_day_tx() -> Transaction:
    """Immediate zero-day attack injection."""
    global _sim_step
    orig = random.choice(_ACCOUNT_POOL)
    dest = _gen_account_name("X")  # Novel unknown account
    amount = round(random.uniform(500_000, 999_999), 2)
    old_orig = round(amount * 1.01, 2)
    new_orig = 0.0
    return Transaction(
        tx_id="ZD-" + str(uuid.uuid4())[:6].upper(),
        step=_sim_step,
        type=TxType.TRANSFER.value,
        amount=amount,
        nameOrig=orig,
        oldbalanceOrg=old_orig,
        newbalanceOrig=new_orig,
        nameDest=dest,
        oldbalanceDest=0.0,
        newbalanceDest=amount,
        timestamp=time.time(),
        attack_type=AttackType.ZERO_DAY,
        is_suspicious=True,
    )


# Shared mule accounts for persistent ring simulation
_persistent_mule_dest: str = random.choice(_ACCOUNT_POOL)
_persistent_surge_orig: str = random.choice(_ACCOUNT_POOL)


async def transaction_stream(inject_queue: asyncio.Queue) -> AsyncGenerator[Transaction, None]:
    """
    Async generator yielding transactions at 1.5–2.5 second intervals.
    Checks inject_queue for immediate zero-day injections.
    """
    global _sim_step, _evaluated_count, _intercepted_count

    while True:
        # Check for injected zero-day attack
        try:
            injected = inject_queue.get_nowait()
            _sim_step += 1
            _evaluated_count += 1
            yield injected
            continue
        except asyncio.QueueEmpty:
            pass

        # Normal cadence
        delay = random.uniform(1.5, 2.5)
        await asyncio.sleep(delay)

        _sim_step += 1
        roll = random.random()

        if roll < 0.85:
            tx = _build_normal_tx(_sim_step)
        elif roll < 0.88:
            tx = _build_large_transfer_tx(_sim_step)
        elif roll < 0.92:
            tx = _build_velocity_surge_tx(_sim_step, _persistent_surge_orig)
        elif roll < 0.96:
            tx = _build_fan_in_burst_tx(_sim_step, _persistent_mule_dest)
        else:
            tx = _build_structuring_tx(_sim_step)

        _evaluated_count += 1
        yield tx


def get_stats() -> dict:
    return {
        "evaluated": _evaluated_count,
        "intercepted": _intercepted_count,
        "active_sinks": len(_active_sinks),
    }


def increment_intercepted():
    global _intercepted_count
    _intercepted_count += 1
