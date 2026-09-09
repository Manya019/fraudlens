"""
models.py — Multi-tier fraud scoring engine.

Provides:
  - Supervised fraud likelihood p_k (calibrated RandomForest surrogate)
  - Unsupervised anomaly score a_k (IsolationForest)
  - Fan-in metric g_k
  - Calibrated Risk Fusion: R_k via logistic combination
"""

import math
import time
from collections import defaultdict, deque
from typing import Optional

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler


# ─── Feature extraction ───────────────────────────────────────────────────────

TX_TYPE_MAP = {
    "PAYMENT": 0,
    "TRANSFER": 1,
    "CASH_OUT": 2,
    "CASH_IN": 3,
    "DEBIT": 4,
}

def extract_features(tx_dict: dict) -> np.ndarray:
    """
    Extracts a 9-dimensional feature vector from a transaction dict.
    Features: [type_enc, amount, oldbalanceOrg, newbalanceOrig,
               oldbalanceDest, newbalanceDest, balance_diff_orig,
               balance_diff_dest, error_orig]
    """
    t = TX_TYPE_MAP.get(tx_dict.get("type", "PAYMENT"), 0)
    amt = float(tx_dict.get("amount", 0))
    ob_o = float(tx_dict.get("oldbalanceOrg", 0))
    nb_o = float(tx_dict.get("newbalanceOrig", 0))
    ob_d = float(tx_dict.get("oldbalanceDest", 0))
    nb_d = float(tx_dict.get("newbalanceDest", 0))
    diff_orig = ob_o - nb_o - amt      # Should be 0 for legitimate
    diff_dest = nb_d - ob_d - amt      # Should be 0 for legitimate
    drain = amt / max(ob_o, 1.0)       # Fraction of balance transferred

    return np.array([t, amt, ob_o, nb_o, ob_d, nb_d, diff_orig, diff_dest, drain],
                    dtype=np.float64)


# ─── Synthetic training data generation ───────────────────────────────────────

def _generate_synthetic_data(n_samples: int = 8000, fraud_ratio: float = 0.15):
    """
    Generate synthetic PaySim-like training data for model initialization.
    Returns (X, y) where y=1 means fraudulent.
    """
    rng = np.random.default_rng(42)
    n_fraud = int(n_samples * fraud_ratio)
    n_legit = n_samples - n_fraud

    rows = []
    labels = []

    # Legitimate transactions
    for _ in range(n_legit):
        t = rng.choice([0, 1, 2, 3, 4], p=[0.40, 0.25, 0.15, 0.10, 0.10])
        amt = float(rng.lognormal(6.5, 1.2))
        ob_o = amt * rng.uniform(1.1, 10.0)
        nb_o = max(0.0, ob_o - amt)
        ob_d = float(rng.uniform(0, 50_000))
        nb_d = ob_d + amt
        diff_orig = ob_o - nb_o - amt + rng.normal(0, 0.01)
        diff_dest = nb_d - ob_d - amt + rng.normal(0, 0.01)
        drain = amt / max(ob_o, 1.0)
        rows.append([t, amt, ob_o, nb_o, ob_d, nb_d, diff_orig, diff_dest, drain])
        labels.append(0)

    # Fraudulent transactions
    for _ in range(n_fraud):
        t = rng.choice([1, 2], p=[0.6, 0.4])  # TRANSFER or CASH_OUT
        amt = float(rng.uniform(100_000, 1_000_000))
        ob_o = amt * rng.uniform(1.0, 1.05)
        nb_o = 0.0  # Near-drain
        ob_d = float(rng.uniform(0, 5_000))
        nb_d = ob_d + amt
        diff_orig = ob_o - nb_o - amt + rng.normal(0, 0.01)
        diff_dest = nb_d - ob_d - amt + rng.normal(0, 0.01)
        drain = 1.0
        rows.append([t, amt, ob_o, nb_o, ob_d, nb_d, diff_orig, diff_dest, drain])
        labels.append(1)

    X = np.array(rows, dtype=np.float64)
    y = np.array(labels, dtype=np.int32)
    idx = rng.permutation(len(y))
    return X[idx], y[idx]


# ─── Model container ──────────────────────────────────────────────────────────

class FraudScoringEngine:
    """
    Orchestrates all scoring components and the risk fusion formula.

    R_k = sigmoid(β₀ + β₁·logit(p_k) + β₂·b_k + β₃·a_k + β₄·g_k)
    β = [−0.40, 0.30, 0.20, 0.10]  (β₀ is the intercept)
    """

    # Fusion weights
    BETA_0 = -0.40   # intercept (bias toward non-fraud)
    BETA_1 = 0.30    # supervised weight
    BETA_2 = 0.20    # behavioral weight
    BETA_3 = 0.20    # anomaly weight
    BETA_4 = 0.10    # fan-in weight

    # Fan-in tracking: dest → deque of timestamps
    _fan_in_window_s = 3600  # 1-hour window

    def __init__(self):
        self._supervised: Optional[CalibratedClassifierCV] = None
        self._scaler_sup: Optional[StandardScaler] = None
        self._isolation_forest: Optional[IsolationForest] = None
        self._scaler_if: Optional[StandardScaler] = None
        self._fan_in: dict[str, deque] = defaultdict(deque)
        self._initialized = False

    def initialize(self) -> None:
        """Train models on synthetic data. Called once at server startup."""
        print("[FraudScoringEngine] Generating synthetic training data...")
        X, y = _generate_synthetic_data(8000)

        # ── Supervised: calibrated RandomForest ──
        print("[FraudScoringEngine] Training supervised model...")
        self._scaler_sup = StandardScaler()
        X_scaled = self._scaler_sup.fit_transform(X)
        rf = RandomForestClassifier(
            n_estimators=100,
            max_depth=8,
            min_samples_leaf=5,
            random_state=42,
            n_jobs=-1,
        )
        self._supervised = CalibratedClassifierCV(rf, cv=3, method="sigmoid")
        self._supervised.fit(X_scaled, y)

        # ── Unsupervised: IsolationForest on legit data only ──
        print("[FraudScoringEngine] Training IsolationForest...")
        X_legit = X[y == 0]
        self._scaler_if = StandardScaler()
        X_legit_scaled = self._scaler_if.fit_transform(X_legit)
        self._isolation_forest = IsolationForest(
            n_estimators=100,
            contamination=0.05,
            random_state=42,
            n_jobs=-1,
        )
        self._isolation_forest.fit(X_legit_scaled)

        self._initialized = True
        print("[FraudScoringEngine] Models ready.")

    def _logit(self, p: float) -> float:
        p = max(1e-6, min(1 - 1e-6, p))
        return math.log(p / (1 - p))

    def _sigmoid(self, x: float) -> float:
        return 1.0 / (1.0 + math.exp(-x))

    def score_supervised(self, tx_dict: dict) -> float:
        """Returns p_k ∈ [0,1]."""
        feat = extract_features(tx_dict).reshape(1, -1)
        feat_scaled = self._scaler_sup.transform(feat)
        proba = self._supervised.predict_proba(feat_scaled)[0]
        # proba[1] = P(fraud)
        return float(proba[1])

    def score_anomaly(self, tx_dict: dict) -> float:
        """Returns a_k ∈ [0,1]. Higher = more anomalous."""
        feat = extract_features(tx_dict).reshape(1, -1)
        feat_scaled = self._scaler_if.transform(feat)
        # decision_function returns negative for anomalies
        raw = self._isolation_forest.decision_function(feat_scaled)[0]
        # Map to [0,1]: lower decision score = higher anomaly
        # Typical range is [-0.5, 0.5]
        a_k = self._sigmoid(-raw * 4)
        return float(np.clip(a_k, 0.0, 1.0))

    def score_fan_in(self, dest: str) -> float:
        """Returns g_k = min(1.0, deg_in(d_k, Δt) / 10)."""
        now = time.time()
        dq = self._fan_in[dest]
        # Trim old events
        while dq and now - dq[0] > self._fan_in_window_s:
            dq.popleft()
        # Record this incoming transaction
        dq.append(now)
        deg_in = len(dq)
        return min(1.0, deg_in / 10.0)

    def fuse(self, p_k: float, b_k: float, a_k: float, g_k: float) -> float:
        """
        R_k = sigmoid(β₀ + β₁·logit(p_k) + β₂·b_k + β₃·a_k + β₄·g_k)
        """
        logit_p = self._logit(p_k)
        linear = (
            self.BETA_0
            + self.BETA_1 * logit_p
            + self.BETA_2 * b_k
            + self.BETA_3 * a_k
            + self.BETA_4 * g_k
        )
        return self._sigmoid(linear)

    def score_transaction(self, tx_dict: dict, b_k: float) -> dict:
        """Full scoring pipeline. Returns dict with p_k, a_k, g_k, R_k."""
        if not self._initialized:
            raise RuntimeError("Engine not initialized. Call initialize() first.")

        p_k = self.score_supervised(tx_dict)
        a_k = self.score_anomaly(tx_dict)
        g_k = self.score_fan_in(tx_dict.get("nameDest", ""))
        R_k = self.fuse(p_k, b_k, a_k, g_k)

        return {
            "p_k": round(p_k, 4),
            "b_k": round(b_k, 4),
            "a_k": round(a_k, 4),
            "g_k": round(g_k, 4),
            "R_k": round(R_k, 4),
        }

    def get_feature_names(self) -> list[str]:
        return [
            "tx_type", "amount", "old_balance_orig", "new_balance_orig",
            "old_balance_dest", "new_balance_dest",
            "balance_err_orig", "balance_err_dest", "drain_ratio"
        ]

    def get_supervised_model(self):
        return self._supervised

    def get_scaler_sup(self):
        return self._scaler_sup


def action_tier(R_k: float) -> str:
    """Map fused risk score to operational action tier."""
    if R_k >= 0.85:
        return "HOLD"
    elif R_k >= 0.65:
        return "REVIEW"
    elif R_k >= 0.45:
        return "MFA"
    else:
        return "CLEARED"
