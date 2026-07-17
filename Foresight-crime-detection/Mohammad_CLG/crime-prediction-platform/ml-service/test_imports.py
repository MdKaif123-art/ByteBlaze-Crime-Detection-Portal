"""Quick import test for all pipeline modules."""
import sys
results = []

tests = [
    ("config (DATA_DIR, MODEL_DIR)", "from config import DATA_DIR, MODEL_DIR"),
    ("pipeline.preprocessing", "from pipeline.preprocessing import CrimeDataPreprocessor"),
    ("pipeline.feature_engineering", "from pipeline.feature_engineering import FeatureEngineer"),
    ("pipeline.clustering", "from pipeline.clustering import HotspotDetector"),
    ("pipeline.risk_scoring", "from pipeline.risk_scoring import RiskScoringEngine"),
    ("pipeline.prediction", "from pipeline.prediction import CrimePredictor"),
    ("pipeline.count_forecasting", "from pipeline.count_forecasting import CountForecaster"),
    ("pipeline.evaluation", "from pipeline.evaluation import time_split_backtest"),
    ("pipeline.llm_dispatcher", "from pipeline.llm_dispatcher import LLMDispatcher"),
    ("pipeline.patrol_routing", "from pipeline.patrol_routing import PatrolOptimizer"),
    ("pipeline.vector_tracking", "from pipeline.vector_tracking import VectorTracker"),
    ("utils.geo_utils", "from utils.geo_utils import haversine_distance, lat_lon_to_grid"),
]

for name, stmt in tests:
    try:
        exec(stmt)
        results.append(f"PASS: {name}")
    except Exception as e:
        results.append(f"FAIL: {name} -> {e}")

# Test LLM dispatcher consistency
try:
    d = LLMDispatcher()
    r1 = d.generate_briefing({"risk_score": 10, "district_name": "Test", "season": "Summer"})
    r2 = d.generate_briefing({"risk_score": 90, "district_name": "Test", "season": "Summer"})
    assert isinstance(r1, dict), f"Low-score return should be dict, got {type(r1)}"
    assert isinstance(r2, dict), f"High-score return should be dict, got {type(r2)}"
    assert "ai_briefing" in r1, "Low-score dict missing 'ai_briefing'"
    assert "ai_briefing" in r2, "High-score dict missing 'ai_briefing'"
    results.append("PASS: LLM dispatcher return type consistency")
except Exception as e:
    results.append(f"FAIL: LLM dispatcher consistency -> {e}")

# Test risk scoring with edge cases
try:
    import pandas as pd
    engine = RiskScoringEngine()
    # Empty df
    empty = pd.DataFrame()
    r = engine.calculate_cluster_risk(empty)
    assert r.empty, "Empty input should return empty"
    # Single cluster
    single = pd.DataFrame({"cluster_id": [0], "crime_count": [5], "avg_severity": [3.0], "max_severity": [5.0]})
    r = engine.calculate_cluster_risk(single)
    assert "risk_score" in r.columns
    results.append("PASS: Risk scoring edge cases")
except Exception as e:
    results.append(f"FAIL: Risk scoring edge cases -> {e}")

with open("result.txt", "w") as f:
    f.write("\n".join(results) + "\n")
    f.write(f"\n{'='*40}\n")
    f.write(f"Total: {sum(1 for r in results if r.startswith('PASS'))}/{len(results)} passed\n")
