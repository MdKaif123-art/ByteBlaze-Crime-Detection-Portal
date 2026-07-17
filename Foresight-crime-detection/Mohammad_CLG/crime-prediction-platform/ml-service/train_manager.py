import sys
import json
import logging
import numpy as np
import pandas as pd
from pathlib import Path
from config import FIR_DATASET_PATH, MAX_ARIMA_AREAS, DATA_DIR, MODEL_DIR
from pipeline.preprocessing import CrimeDataPreprocessor
from pipeline.feature_engineering import FeatureEngineer
from pipeline.clustering import HotspotDetector
from pipeline.risk_scoring import RiskScoringEngine
from pipeline.prediction import CrimePredictor
from pipeline.data_enrichment import DataEnricher
from pipeline.count_forecasting import CountForecaster
from pipeline.evaluation import time_split_backtest, report_to_json

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("train_manager")


def force_train():
    print("🚀 Starting Automated ML Training Sequence...", flush=True)

    preprocessor = CrimeDataPreprocessor()
    feature_engine = FeatureEngineer()
    clustering_model = HotspotDetector()
    risk_engine = RiskScoringEngine()
    predictor_model = CrimePredictor()
    district_forecaster = CountForecaster(level="district_name")

    # ─── 1. Load Data ───
    print(f"\n[1/7] Loading 50,000 Records from dataset...", flush=True)
    df = preprocessor.load_fir_dataset(nrows=50000)
    print(f"      ✅ Loaded {len(df)} records.", flush=True)

    # ─── 2. Preprocess ───
    print("\n[2/7] Preprocessing (Geocoding, Severity, Time Features)...", flush=True)
    processed_df = preprocessor.preprocess(df)
    valid_coords = ((processed_df["latitude"] != 0) & (processed_df["longitude"] != 0)).sum()
    print(f"      ✅ Done. Valid coordinates: {valid_coords}/{len(processed_df)}", flush=True)

    # ─── 3. Data Enrichment ───
    print("\n[3/7] Adding Environmental Enrichment...", flush=True)
    try:
        enricher = DataEnricher()
        processed_df = enricher.add_demographics(processed_df)
        processed_df = enricher.add_historical_weather(processed_df)
        print("      ✅ Enrichment complete.", flush=True)
    except Exception as e:
        print(f"      ⚠️  Skipped (non-critical): {e}", flush=True)

    # ─── 4. Feature Engineering ───
    print("\n[4/7] Engineering Feature Matrix...", flush=True)
    featured_df = feature_engine.engineer_features(processed_df)
    print(f"      ✅ Feature shape: {featured_df.shape}", flush=True)

    # ─── 5. DBSCAN Clustering ───
    print("\n[5/7] Running DBSCAN Hotspot Detection...", flush=True)
    clustered_df = clustering_model.fit_predict(featured_df)
    clusters_summary = clustering_model.generate_clusters_summary(clustered_df)
    n_clusters = len(clusters_summary) if clusters_summary is not None and not clusters_summary.empty else 0
    print(f"      ✅ Detected {n_clusters} spatial clusters.", flush=True)

    # ─── 6. Risk Scoring ───
    print("\n[6/7] Calculating Multivariable Risk Scores...", flush=True)
    if n_clusters > 0:
        scored_clusters = risk_engine.calculate_cluster_risk(clusters_summary)
        critical = (scored_clusters["risk_level"] == "CRITICAL").sum() if "risk_level" in scored_clusters.columns else 0
        high = (scored_clusters["risk_level"] == "HIGH").sum() if "risk_level" in scored_clusters.columns else 0
        print(f"      ✅ {critical} CRITICAL, {high} HIGH risk hotspots.", flush=True)
    else:
        scored_clusters = pd.DataFrame()
        print("      ⚠️  No clusters to score (will use district-level analysis).", flush=True)

    # ─── 7. ARIMA Time-Series (ALL grid cells) ───
    print(f"\n[7/7] Training ARIMA Models on ALL grid cells...", flush=True)
    ts_data = feature_engine.get_timeseries_data(featured_df, freq="D", area_col="grid_cell")
    total_areas = len(ts_data)
    print(f"      📊 {total_areas} grid areas to train. This will take 3-5 hours...", flush=True)

    predictor_model.fit(ts_data, verbose=True)
    
    # Calculate accuracy metrics
    metrics = predictor_model.calculate_metrics(ts_data)
    print(f"\n      📈 Model Accuracy Metrics:", flush=True)
    print(f"         • Mean Absolute Error (MAE): {metrics.get('overall_mae', 'N/A')}", flush=True)
    print(f"         • Root Mean Square Error (RMSE): {metrics.get('overall_rmse', 'N/A')}", flush=True)
    print(f"         • Mean Absolute Percentage Error (MAPE): {metrics.get('overall_mape', 'N/A')}%", flush=True)
    
    predictor_model.save_models()
    print(f"      ✅ Trained ARIMA for {len(predictor_model.models)} grid cells.", flush=True)

    # ─── 7b. District-level count forecasting + evaluation ───
    print("\n[7b] Training District-Level Count Forecaster (Poisson + lags)...", flush=True)
    district_forecaster.fit(processed_df, min_history_days=60, max_areas=300)
    district_art = district_forecaster.forecast(processed_df, horizon_days=7)
    district_payload = {
        "level": district_art.level,
        "horizon_days": district_art.horizon_days,
        "model_type": district_art.model_type,
        "feature_names": district_art.feature_names,
        "forecasts": district_art.forecasts,
    }
    with open(MODEL_DIR / "district_forecasts.json", "w") as f:
        json.dump(district_payload, f)
    print(f"      ✅ Saved district forecasts for {len(district_art.forecasts)} districts.", flush=True)

    report = time_split_backtest(processed_df, level="district_name", horizon_days=7, min_history_days=60, max_areas=30)
    with open(MODEL_DIR / "evaluation_report.json", "w") as f:
        json.dump(report_to_json(report), f, indent=2)
    print("      📊 Saved evaluation_report.json (time-split backtest).", flush=True)

    # ─── 8. Generate Area Intelligence Report ───
    print("\n[BONUS] Generating Area Intelligence Report...", flush=True)
    area_intel = generate_area_intelligence(featured_df)
    intel_path = DATA_DIR / "area_intelligence.json"
    with open(intel_path, "w") as f:
        json.dump(area_intel, f, indent=2, default=str)
    print(f"      ✅ Saved intelligence for {len(area_intel)} districts to {intel_path}", flush=True)

    # ─── Save processed data ───
    output_path = DATA_DIR / "processed_crimes.csv"
    featured_df.to_csv(output_path, index=False)
    print(f"\n      💾 Saved processed data to {output_path}", flush=True)

    if n_clusters > 0:
        clusters_path = DATA_DIR / "scored_clusters.csv"
        scored_clusters.to_csv(clusters_path, index=False)
        print(f"      💾 Saved clusters to {clusters_path}", flush=True)

    print("\n" + "=" * 60, flush=True)
    print("🎯 TRAINING COMPLETE! All AI Models are LOCKED and LOADED.", flush=True)
    print("=" * 60, flush=True)


def generate_area_intelligence(df):
    """
    For each district, compute:
      - Top crime types + percentage
      - Peak crime hours (timing)
      - Repeat probability (based on frequency density)
      - Lat/Lon center
      - Seasonal pattern
    """
    intel = {}

    for district, group in df.groupby("district_name"):
        if not district or district.strip() == "":
            continue

        total_crimes = len(group)

        # ── Crime Types + Percentage ──
        crime_counts = group["crime_type"].value_counts()
        top_crimes = []
        for crime_type, count in crime_counts.head(5).items():
            top_crimes.append({
                "type": str(crime_type),
                "count": int(count),
                "percentage": round(100 * count / total_crimes, 1)
            })

        # ── Peak Crime Hours ──
        if "hour" in group.columns:
            hour_counts = group["hour"].value_counts().sort_index()
            peak_hour = int(hour_counts.idxmax())
            # Find top 3 peak hours
            top_hours = hour_counts.nlargest(3).index.tolist()
        else:
            peak_hour = 0
            top_hours = []

        # ── Peak Day of Week ──
        if "day_of_week" in group.columns:
            dow_map = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday",
                       4: "Friday", 5: "Saturday", 6: "Sunday"}
            peak_dow = int(group["day_of_week"].value_counts().idxmax())
            peak_day_name = dow_map.get(peak_dow, "Unknown")
        else:
            peak_day_name = "Unknown"

        # ── Repeat Probability ──
        # Based on crime density: how many crimes per day on average
        if "timestamp" in group.columns:
            date_range = (group["timestamp"].max() - group["timestamp"].min()).days
            if date_range > 0:
                crimes_per_day = total_crimes / date_range
                # Scale to 0-100 percentage (cap at 95%)
                repeat_prob = min(95.0, round(crimes_per_day * 10, 1))
            else:
                repeat_prob = 50.0
        else:
            repeat_prob = 50.0

        # ── Lat/Lon Center ──
        valid = group[(group["latitude"] != 0) & (group["longitude"] != 0)]
        if len(valid) > 0:
            center_lat = round(float(valid["latitude"].mean()), 6)
            center_lon = round(float(valid["longitude"].mean()), 6)
        else:
            center_lat = 0.0
            center_lon = 0.0

        # ── Seasonal Pattern ──
        if "season" in group.columns:
            season_counts = group["season"].value_counts()
            peak_season = str(season_counts.idxmax())
        else:
            peak_season = "Unknown"

        # ── Severity Stats ──
        avg_severity = round(float(group["severity"].mean()), 2) if "severity" in group.columns else 5.0

        intel[str(district)] = {
            "district": str(district),
            "total_crimes": int(total_crimes),
            "center": {"lat": center_lat, "lng": center_lon},
            "top_crime_types": top_crimes,
            "peak_crime_hour": peak_hour,
            "top_3_peak_hours": [int(h) for h in top_hours],
            "peak_day": peak_day_name,
            "repeat_probability_pct": repeat_prob,
            "peak_season": peak_season,
            "avg_severity": avg_severity,
            "crime_timing_summary": f"Highest crime rate at {peak_hour}:00 hrs on {peak_day_name}s during {peak_season}"
        }

    return intel


if __name__ == "__main__":
    force_train()
