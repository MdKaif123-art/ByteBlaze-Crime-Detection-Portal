"""
MODULE 3: Feature Engineering Pipeline
Generates ML-ready features from preprocessed crime data:
  - Crime frequency per location (grid-based)
  - Time-based aggregations (hourly/daily trends)
  - Severity-weighted crime scores
  - Rolling averages (7-day, 30-day)
  - Spatial density features
"""
import logging
import numpy as np
import pandas as pd
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).parent.parent))
from config import GRID_SIZE_KM
from utils.geo_utils import lat_lon_to_grid

logger = logging.getLogger(__name__)


class FeatureEngineer:
    """Generates engineered features for crime prediction models."""

    def __init__(self, grid_size_km=GRID_SIZE_KM):
        self.grid_size_km = grid_size_km

    def engineer_features(self, df):
        """
        Full feature engineering pipeline.
        """
        logger.info(f"Starting feature engineering on {len(df)} records...")

        # 1. Grid-based location features
        df = self._add_grid_features(df)

        # 2. Crime frequency per grid cell
        df = self._add_frequency_features(df)

        # 3. Time-based aggregations
        df = self._add_time_aggregations(df)

        # 4. Severity-weighted crime scores
        df = self._add_severity_scores(df)

        # 5. Rolling averages
        df = self._add_rolling_averages(df)

        # 6. Spatial density
        df = self._add_spatial_density(df)

        # 7. Interaction features
        df = self._add_interaction_features(df)

        logger.info(f"Feature engineering complete. Shape: {df.shape}")
        return df

    def _add_grid_features(self, df):
        """Assign each crime to a spatial grid cell."""
        valid_mask = (df["latitude"] != 0) & (df["longitude"] != 0)
        df.loc[valid_mask, "grid_cell"] = df.loc[valid_mask].apply(
            lambda r: lat_lon_to_grid(r["latitude"], r["longitude"], self.grid_size_km),
            axis=1
        )
        df["grid_cell"] = df["grid_cell"].fillna("unknown")
        logger.info(f"Assigned crimes to {df['grid_cell'].nunique()} grid cells")
        return df

    def _add_frequency_features(self, df):
        """Calculate crime frequency per grid cell and district."""
        # Per grid cell
        grid_freq = df.groupby("grid_cell").size().reset_index(name="grid_crime_count")
        df = df.merge(grid_freq, on="grid_cell", how="left")

        # Per district
        dist_freq = df.groupby("district_name").size().reset_index(name="district_crime_count")
        df = df.merge(dist_freq, on="district_name", how="left")

        # Per crime type
        type_freq = df.groupby("crime_type").size().reset_index(name="crime_type_count")
        df = df.merge(type_freq, on="crime_type", how="left")

        # Per grid + crime type
        grid_type_freq = df.groupby(["grid_cell", "crime_type"]).size().reset_index(name="grid_type_count")
        df = df.merge(grid_type_freq, on=["grid_cell", "crime_type"], how="left")

        logger.info("Added frequency features: grid_crime_count, district_crime_count, crime_type_count")
        return df

    def _add_time_aggregations(self, df):
        """Calculate time-based crime aggregations."""
        df = df.sort_values("timestamp").copy()

        # Hourly crime count
        df["date_hour"] = df["timestamp"].dt.floor("H")
        hourly = df.groupby("date_hour").size().reset_index(name="hourly_crime_count")
        df = df.merge(hourly, on="date_hour", how="left")

        # Daily crime count
        df["date"] = df["timestamp"].dt.date
        daily = df.groupby("date").size().reset_index(name="daily_crime_count")
        df["date"] = pd.to_datetime(df["date"])
        daily["date"] = pd.to_datetime(daily["date"])
        df = df.merge(daily, on="date", how="left")

        # Day-of-week crime pattern per grid
        dow_pattern = df.groupby(["grid_cell", "day_of_week"]).size().reset_index(name="dow_grid_count")
        df = df.merge(dow_pattern, on=["grid_cell", "day_of_week"], how="left")

        # Hour-of-day crime pattern per grid
        hour_pattern = df.groupby(["grid_cell", "hour"]).size().reset_index(name="hour_grid_count")
        df = df.merge(hour_pattern, on=["grid_cell", "hour"], how="left")

        logger.info("Added time aggregations: hourly, daily, dow, hour patterns")
        return df

    def _add_severity_scores(self, df):
        """Calculate severity-weighted crime scores per location."""
        # Grid-level severity score
        grid_severity = df.groupby("grid_cell").agg(
            total_severity=("severity", "sum"),
            mean_severity=("severity", "mean"),
            max_severity=("severity", "max"),
            severity_weighted_count=("severity", lambda x: (x * x.index.map(lambda i: 1)).sum()),
        ).reset_index()

        df = df.merge(grid_severity, on="grid_cell", how="left", suffixes=("", "_grid"))

        # District-level severity
        dist_severity = df.groupby("district_name").agg(
            district_mean_severity=("severity", "mean"),
            district_max_severity=("severity", "max"),
        ).reset_index()
        df = df.merge(dist_severity, on="district_name", how="left")

        logger.info("Added severity-weighted scores per grid and district")
        return df

    def _add_rolling_averages(self, df):
        """Calculate rolling averages for crime counts."""
        df = df.sort_values("timestamp").copy()

        # Create daily time series per grid
        daily_grid = df.groupby(["date", "grid_cell"]).agg(
            daily_count=("crime_id", "count"),
            daily_avg_severity=("severity", "mean"),
        ).reset_index()

        # Sort and compute rolling averages
        daily_grid = daily_grid.sort_values(["grid_cell", "date"])

        for window, name in [(7, "7d"), (30, "30d")]:
            daily_grid[f"rolling_count_{name}"] = (
                daily_grid.groupby("grid_cell")["daily_count"]
                .transform(lambda x: x.rolling(window, min_periods=1).mean())
            )
            daily_grid[f"rolling_severity_{name}"] = (
                daily_grid.groupby("grid_cell")["daily_avg_severity"]
                .transform(lambda x: x.rolling(window, min_periods=1).mean())
            )

        # Merge back — use latest rolling values per grid
        latest_rolling = daily_grid.groupby("grid_cell").last().reset_index()
        rolling_cols = [c for c in latest_rolling.columns if "rolling" in c]
        df = df.merge(
            latest_rolling[["grid_cell"] + rolling_cols],
            on="grid_cell",
            how="left"
        )

        logger.info("Added rolling averages: 7-day and 30-day")
        return df

    def _add_spatial_density(self, df):
        """Calculate spatial crime density features."""
        valid = df[(df["latitude"] != 0) & (df["longitude"] != 0)].copy()

        if len(valid) == 0:
            df["spatial_density"] = 0
            return df

        # Grid-level density (crimes per grid cell area)
        grid_area_sq_km = self.grid_size_km ** 2
        grid_density = valid.groupby("grid_cell").agg(
            crime_count_density=("crime_id", "count"),
        ).reset_index()
        grid_density["spatial_density"] = grid_density["crime_count_density"] / grid_area_sq_km
        df = df.merge(
            grid_density[["grid_cell", "spatial_density"]],
            on="grid_cell",
            how="left"
        )
        df["spatial_density"] = df["spatial_density"].fillna(0)

        logger.info("Added spatial density features")
        return df

    def _add_interaction_features(self, df):
        """Create interaction features between key variables."""
        # Severity × Frequency interaction
        df["severity_freq_interaction"] = df["severity"] * df.get("grid_crime_count", 1)

        # Night + High severity
        df["night_severity"] = df.get("is_night", 0) * df["severity"]

        # Weekend + Crime frequency
        df["weekend_frequency"] = df.get("is_weekend", 0) * df.get("grid_crime_count", 1)

        logger.info("Added interaction features")
        return df

    def get_timeseries_data(self, df, freq="D", area_col="grid_cell"):
        """
        Aggregate crimes into time-series format for prediction.
        Returns: dict of {area_id: DataFrame with date index and count column}
        """
        ts_data = {}
        df_sorted = df.sort_values("timestamp")

        for area_id, group in df_sorted.groupby(area_col):
            ts = group.set_index("timestamp").resample(freq).agg(
                crime_count=("crime_id", "count"),
                avg_severity=("severity", "mean"),
                max_severity=("severity", "max"),
            ).fillna(0)

            if len(ts) >= 7:  # Need at least a week of data
                ts_data[area_id] = ts

        logger.info(f"Generated time series for {len(ts_data)} areas")
        return ts_data

    def get_feature_matrix(self, df):
        """
        Extract a feature matrix suitable for ML models.
        Returns features DataFrame and column names.
        """
        feature_cols = [
            "latitude", "longitude", "severity", "hour", "day_of_week",
            "is_weekend", "is_night", "crime_type_encoded",
            "grid_crime_count", "district_crime_count",
            "daily_crime_count", "hourly_crime_count",
            "total_severity", "mean_severity",
            "severity_freq_interaction", "night_severity",
            "spatial_density",
        ]

        available = [c for c in feature_cols if c in df.columns]
        X = df[available].fillna(0)

        logger.info(f"Feature matrix shape: {X.shape}, features: {available}")
        return X, available


# ── Standalone execution ──
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    from preprocessing import CrimeDataPreprocessor

    # Load and preprocess
    preprocessor = CrimeDataPreprocessor()
    df = preprocessor.load_fir_dataset(nrows=10000)
    df = preprocessor.preprocess(df)

    # Engineer features
    engineer = FeatureEngineer()
    df = engineer.engineer_features(df)

    print(f"\n=== FEATURE SUMMARY ===")
    print(f"Shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    print(f"\nSample features:\n{df[['grid_cell', 'grid_crime_count', 'severity', 'hour', 'spatial_density']].head(10)}")

    # Save
    output_path = Path(__file__).parent.parent / "data" / "featured_crimes.csv"
    df.to_csv(output_path, index=False)
    print(f"\nSaved to: {output_path}")
