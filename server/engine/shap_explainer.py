"""
shap_explainer.py — Local Tree-SHAP feature attribution.

Computes top-4 SHAP contributions for any transaction with R_k >= 0.65.
Falls back to permutation-based approximation if SHAP library fails.
"""

import numpy as np

try:
    import shap as _shap
    _SHAP_AVAILABLE = True
except ImportError:
    _SHAP_AVAILABLE = False

from engine.models import extract_features, FraudScoringEngine


class ShapExplainer:
    """
    Wraps SHAP TreeExplainer over the calibrated RF surrogate.
    """

    def __init__(self):
        self._explainer = None
        self._engine: FraudScoringEngine = None
        self._initialized = False

    def initialize(self, engine: FraudScoringEngine) -> None:
        self._engine = engine
        if _SHAP_AVAILABLE:
            try:
                # Extract the underlying RF from the calibrated wrapper
                # CalibratedClassifierCV stores estimators in .calibrated_classifiers_
                base_model = engine.get_supervised_model()
                # Use the first fold's estimator
                inner_rf = base_model.calibrated_classifiers_[0].estimator
                self._explainer = _shap.TreeExplainer(inner_rf)
                print("[ShapExplainer] TreeExplainer initialized.")
            except Exception as e:
                print(f"[ShapExplainer] TreeExplainer failed ({e}), using surrogate.")
                self._explainer = None
        self._initialized = True

    def explain(self, tx_dict: dict) -> list[dict]:
        """
        Returns top-4 SHAP feature contributions as a list of dicts:
        [{ "feature": str, "value": float, "contribution": float }, ...]
        Positive contribution → increases fraud risk.
        """
        feat = extract_features(tx_dict).reshape(1, -1)
        feat_names = self._engine.get_feature_names()
        feat_scaled = self._engine.get_scaler_sup().transform(feat)
        feat_values = feat[0]

        if self._explainer is not None and _SHAP_AVAILABLE:
            try:
                shap_values = self._explainer.shap_values(feat_scaled)
                # For binary classifier: shap_values[1] is class=fraud
                if isinstance(shap_values, list) and len(shap_values) == 2:
                    contribs = shap_values[1][0]
                else:
                    contribs = shap_values[0]
            except Exception:
                contribs = self._fallback_contributions(feat_scaled, feat_values)
        else:
            contribs = self._fallback_contributions(feat_scaled, feat_values)

        # Rank by |contribution| and take top 4
        ranked = sorted(
            enumerate(contribs),
            key=lambda x: abs(x[1]),
            reverse=True,
        )[:4]

        return [
            {
                "feature": feat_names[i],
                "raw_value": round(float(feat_values[i]), 4),
                "contribution": round(float(contribs[i]), 4),
            }
            for i, _ in ranked
        ]

    def _fallback_contributions(
        self, feat_scaled: np.ndarray, feat_values: np.ndarray
    ) -> np.ndarray:
        """
        Fast surrogate attribution: coefficient * feature for a linear approximation.
        Uses the supervised model's feature importances scaled by the feature value.
        """
        try:
            model = self._engine.get_supervised_model()
            # Get importances from the first calibrated estimator's inner RF
            inner_rf = model.calibrated_classifiers_[0].estimator
            importances = inner_rf.feature_importances_
            # Scale by normalized feature values (signed)
            contribs = importances * feat_scaled[0]
        except Exception:
            contribs = np.zeros(len(feat_values))
        return contribs
