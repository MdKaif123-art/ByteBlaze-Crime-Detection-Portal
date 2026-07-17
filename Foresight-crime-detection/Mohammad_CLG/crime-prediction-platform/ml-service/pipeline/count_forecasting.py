"""
Count forecasting for sparse crime data.

Why this exists:
- Grid-cell daily counts are extremely sparse → classical SARIMA often collapses to a naive forecast.
- District / station aggregation yields denser series.
- Poisson regression is a natural choice for non-negative integer counts with many zeros.

This module builds a supervised learning dataset from daily counts with lag + calendar features
and trains a PoissonRegressor per area (district / unit / cluster).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.linear_model import PoissonRegressor

logger = logging.getLogger(__name__)


SUPPORTED_LEVELS = {"district_name", "unit_name", "cluster_id", "grid_cell"}


@dataclass
class ForecastArtifacts:
    level: str
    horizon_days: int
    forecasts: Dict[str, List[dict]]
    model_type: str
    feature_names: List[str]


def _safe_str_area(v) -> str:
    if v is None:
        return "unknown"
    if isinstance(v, float) and np.isnan(v):
        return "unknown"
    return str(v).strip() if str(v).strip() else "unknown"


def _calendar_features(dates: pd.DatetimeIndex) -> pd.DataFrame:
    df = pd.DataFrame(index=dates)
    df["dow"] = dates.dayofweek.astype(int)
    df["month"] = dates.month.astype(int)
    df["is_weekend"] = (df["dow"] >= 5).astype(int)
    # simple "season" proxy, consistent with config.SEASONS mapping used elsewhere
    df["season_winter"] = dates.month.isin([12, 1, 2]).astype(int)
    df["season_summer"] = dates.month.isin([3, 4, 5]).astype(int)
    df["season_monsoon"] = dates.month.isin([6, 7, 8, 9]).astype(int)
    df["season_post_monsoon"] = dates.month.isin([10, 11]).astype(int)
    return df


def _make_supervised(ts: pd.Series) -> Tuple[pd.DataFrame, pd.Series]:
    """
    ts: daily count series with DatetimeIndex (daily frequency preferred)
    """
    ts = ts.sort_index()
    idx = ts.index
    X = _calendar_features(pd.DatetimeIndex(idx))
    X["lag_1"] = ts.shift(1).fillna(0).astype(float)
    X["lag_7"] = ts.shift(7).fillna(0).astype(float)
    X["roll7_mean"] = ts.shift(1).rolling(7, min_periods=1).mean().fillna(0).astype(float)
    X["roll28_mean"] = ts.shift(1).rolling(28, min_periods=1).mean().fillna(0).astype(float)
    X["trend_7"] = (ts.shift(1) - ts.shift(8)).fillna(0).astype(float)
    y = ts.astype(float)

    # Drop the very first row to avoid degenerate all-zeros feature row in tiny series
    # (still safe for longer series).
    if len(X) > 1:
        X = X.iloc[1:]
        y = y.iloc[1:]
    return X, y


class CountForecaster:
    def __init__(self, level: str = "district_name"):
        if level not in SUPPORTED_LEVELS:
            raise ValueError(f"Unsupported level={level}. Supported: {sorted(SUPPORTED_LEVELS)}")
        self.level = level
        self.models: Dict[str, PoissonRegressor] = {}
        self.feature_names: List[str] = []

    def _aggregate_daily_counts(self, df: pd.DataFrame) -> Dict[str, pd.Series]:
        if "timestamp" not in df.columns:
            raise ValueError("DataFrame must contain 'timestamp'")
        if self.level not in df.columns:
            raise ValueError(f"DataFrame must contain '{self.level}' for level={self.level}")

        d = df.copy()
        d["date"] = pd.to_datetime(d["timestamp"]).dt.floor("D")
        d[self.level] = d[self.level].apply(_safe_str_area)
        grouped = d.groupby([self.level, "date"]).size().rename("crime_count").reset_index()

        series_by_area: Dict[str, pd.Series] = {}
        for area_id, g in grouped.groupby(self.level):
            s = g.set_index("date")["crime_count"].sort_index()
            # ensure continuous daily index
            s = s.asfreq("D", fill_value=0)
            series_by_area[_safe_str_area(area_id)] = s
        return series_by_area

    def fit(self, df: pd.DataFrame, min_history_days: int = 60, max_areas: Optional[int] = None) -> None:
        """
        Fit one Poisson model per area, using lag + calendar features.
        """
        series_by_area = self._aggregate_daily_counts(df)

        # prioritize active areas if max_areas is set
        areas = list(series_by_area.items())
        areas.sort(key=lambda kv: float(kv[1].sum()), reverse=True)
        if max_areas is not None:
            areas = areas[:max_areas]

        fitted = 0
        skipped = 0
        for area_id, s in areas:
            if len(s) < min_history_days:
                skipped += 1
                continue
            X, y = _make_supervised(s)
            if len(X) < 30:
                skipped += 1
                continue
            model = PoissonRegressor(alpha=0.1, max_iter=2000)
            model.fit(X.values, y.values)
            self.models[area_id] = model
            self.feature_names = list(X.columns)
            fitted += 1

        logger.info(
            f"CountForecaster fitted {fitted} {self.level} models (skipped {skipped})."
        )

    def forecast(self, df: pd.DataFrame, horizon_days: int = 7) -> ForecastArtifacts:
        """
        Produce next `horizon_days` forecasts for all fitted areas.
        """
        series_by_area = self._aggregate_daily_counts(df)
        forecasts: Dict[str, List[dict]] = {}

        for area_id, model in self.models.items():
            s = series_by_area.get(area_id)
            if s is None or len(s) == 0:
                continue

            last_date = pd.to_datetime(s.index.max())
            future_dates = pd.date_range(start=last_date + pd.Timedelta(days=1), periods=horizon_days, freq="D")

            # iterative forecasting: feed predicted counts into lags/rolls
            hist = s.copy().astype(float)
            preds: List[dict] = []
            for dt in future_dates:
                X_dt, _ = _make_supervised(hist.reindex(hist.index.union([dt]), fill_value=0))
                # pick the last row (corresponding to dt)
                x_last = X_dt.iloc[-1:][self.feature_names].values
                y_hat = float(model.predict(x_last)[0])
                y_hat = max(0.0, y_hat)
                y_int = int(round(y_hat))
                preds.append({"date": str(pd.to_datetime(dt).date()), "predicted_count": y_int})
                hist.loc[dt] = y_int

            forecasts[area_id] = preds

        return ForecastArtifacts(
            level=self.level,
            horizon_days=horizon_days,
            forecasts=forecasts,
            model_type="poisson_regression_lagged",
            feature_names=self.feature_names,
        )

