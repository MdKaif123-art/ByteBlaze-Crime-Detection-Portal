"""
MODULE 6: Risk Scoring Engine
Calculates risk scores for locations using:
  Score = w1 * freq + w2 * severity + w3 * trend + w4 * time_factor
Categorizes risk into LOW, MEDIUM, HIGH, CRITICAL.
"""
import logging
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).parent.parent))
from config import RISK_WEIGHTS

logger = logging.getLogger(__name__)


class RiskScoringEngine:
    """Calculates composite risk scores representing imminent crime threat level."""

    def __init__(self, weights=None):
        self.weights = weights or RISK_WEIGHTS
        self.scaler = MinMaxScaler((0, 100)) # Scale scores to 0-100

    def calculate_cluster_risk(self, clusters_df, historical_recent_df=None):
        """
        Calculate risk score for each spatial cluster.
        historical_recent_df: Recent crime events to calculate 'recent_trend'
        """
        if clusters_df.empty:
            return clusters_df
            
        logger.info(f"Calculating risk scores for {len(clusters_df)} clusters...")
        df = clusters_df.copy()
        
        # 1. Frequency Component
        df["comp_freq"] = self._normalize(df["crime_count"])
        
        # 2. Severity Component
        df["comp_severity"] = self._normalize(df.get("avg_severity", pd.Series(5, index=df.index)) * df.get("max_severity", pd.Series(5, index=df.index)))
        
        # 3. Recent Trend Component (mocked if no recent data provided)
        # Ideally, calculate ratio of (last 7 days crimes) / (historical 7 days avg)
        if historical_recent_df is not None:
             df["comp_trend"] = self._calculate_trend(df, historical_recent_df)
        else:
            df["comp_trend"] = 50.0  # Neutral baseline
            
        # 4. Time Factor Component (environmental, like weekend/night propensity)
        # Mocked here - in production, derive from prediction models
        df["comp_time"] = 50.0 
        
        # Composite Score Calculation
        raw_score = (
            self.weights["crime_frequency"] * df["comp_freq"] +
            self.weights["severity_score"] * df["comp_severity"] +
            self.weights["recent_trend"] * df["comp_trend"] +
            self.weights["time_factor"] * df["comp_time"]
        )
        
        # Final scaling to 0-100
        df["risk_score"] = self.scaler.fit_transform(raw_score.values.reshape(-1,1)).flatten()
        
        # Categorize
        df["risk_level"] = df["risk_score"].apply(self._categorize_risk)
        
        logger.info("Risk scoring complete.")
        return df

    def _normalize(self, series):
        """Standard min-max normalization to 0-100."""
        # Handle empty, zero-variance, or all-NaN cases
        if len(series) == 0:
            return series
        series = series.fillna(0)
        s_min = series.min()
        s_max = series.max()
        if s_max == s_min:
            return pd.Series(50.0, index=series.index)
        return 100 * (series - s_min) / (s_max - s_min)

    def _calculate_trend(self, clusters_df, recent_df):
        """Calculate recent trend component for clusters."""
        # Simplified: higher recent volume = higher trend score
        recent_counts = recent_df.groupby("cluster_id").size()
        trend_series = clusters_df["cluster_id"].map(recent_counts).fillna(0)
        return self._normalize(trend_series)

    def _categorize_risk(self, score):
        """Convert 0-100 score to category."""
        if score >= 85:
            return "CRITICAL"
        elif score >= 65:
            return "HIGH"
        elif score >= 40:
            return "MEDIUM"
        else:
            return "LOW"


# ── Standalone execution ──
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    # Mock data
    clusters = pd.DataFrame({
        "cluster_id": [0, 1, 2],
        "crime_count": [10, 150, 50],
        "avg_severity": [3.0, 8.5, 5.0],
        "max_severity": [5.0, 10.0, 7.0]
    })
    
    engine = RiskScoringEngine()
    scored_clusters = engine.calculate_cluster_risk(clusters)
    
    print("\n=== RISK SCORES ===")
    print(scored_clusters[["cluster_id", "crime_count", "risk_score", "risk_level"]])
