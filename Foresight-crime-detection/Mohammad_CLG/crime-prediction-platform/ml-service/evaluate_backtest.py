"""
Quick backtest for the forecasters.

Default: district-level Poisson regression with lag + calendar features.
Also reports two baselines:
  - last value
  - 7-day moving average

Designed to run on a sample (e.g. uploaded_fir.csv) and finish quickly.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from pipeline.preprocessing import CrimeDataPreprocessor
from pipeline.count_forecasting import CountForecaster


@dataclass
class BacktestResult:
    n_areas_evaluated: int
    horizon_days: int
    mae: float
    rmse: float
    mape: float | None
    baseline_mae: float
    baseline_rmse: float
    baseline_mape: float | None


def _mape(y_true: np.ndarray, y_pred: np.ndarray) -> float | None:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = y_true > 0
    if mask.sum() == 0:
        return None
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100.0)


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    return float(math.sqrt(np.mean((y_true - y_pred) ** 2)))


def _mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    return float(np.mean(np.abs(y_true - y_pred)))


def backtest_forecaster(
    df: pd.DataFrame,
    horizon_days: int = 7,
    min_history_days: int = 60,
    max_areas: int = 50,
) -> BacktestResult:
    """
    For each grid cell with enough history:
      - train on all but last `horizon_days`
      - forecast next `horizon_days`
      - compare with actual counts
      - compare with naive baseline: repeat last observed train value
    """

    # Build daily counts by district (default)
    forecaster = CountForecaster(level="district_name")
    series_by_area = forecaster._aggregate_daily_counts(df)  # internal helper is OK for evaluation

    candidates: list[tuple[str, pd.Series, float]] = []
    for area_id, s in series_by_area.items():
        if len(s) < (horizon_days + min_history_days):
            continue
        candidates.append((area_id, s, float(s.sum())))

    candidates.sort(key=lambda x: x[2], reverse=True)
    chosen = [(a, s) for a, s, _ in candidates[:max_areas]]

    all_true: list[float] = []
    all_pred: list[float] = []
    all_base: list[float] = []

    for area_id, s in chosen:
        train_s = s.iloc[: -horizon_days]
        test_s = s.iloc[-horizon_days:]

        # Fit Poisson on train only (wrap into a df to reuse implementation)
        tmp_df = pd.DataFrame(
            {
                "timestamp": train_s.index,
                "district_name": area_id,
            }
        )
        # expand rows by count (small per-district daily counts; fine for evaluation sample)
        tmp_df = tmp_df.loc[tmp_df.index.repeat(train_s.values)].reset_index(drop=True)

        model = CountForecaster(level="district_name")
        model.fit(tmp_df, min_history_days=min_history_days, max_areas=None)
        art = model.forecast(tmp_df, horizon_days=horizon_days)
        preds = art.forecasts.get(area_id)
        if not preds:
            continue

        y_true = test_s.values.astype(float)
        y_pred = np.array([p["predicted_count"] for p in preds], dtype=float)

        # Baseline 1: last observed train value repeated
        last_val = float(train_s.iloc[-1])
        y_last = np.full(shape=horizon_days, fill_value=last_val, dtype=float)

        # Baseline 2: 7-day moving average (of train, last available)
        ma7 = float(train_s.rolling(7, min_periods=1).mean().iloc[-1])
        y_ma7 = np.full(shape=horizon_days, fill_value=ma7, dtype=float)

        all_true.extend(y_true.tolist())
        all_pred.extend(y_pred.tolist())
        # Compare against best-of-baselines (we report both separately below as baseline_* = last value)
        # For now, store last-value baseline in baseline_* fields, and treat MA7 as an additional check.
        all_base.extend(y_last.tolist())

        # If MA7 beats last-value, it indicates smooth seasonality may dominate.
        # We incorporate it by tightening the baseline error (minimum of the two).
        # This makes it harder for the model to "look good" unless it truly adds signal.
        # (We do it on the concatenated lists for stability.)
        if _mae(y_true, y_ma7) < _mae(y_true, y_last):
            all_base[-horizon_days:] = y_ma7.tolist()

    y_true_np = np.asarray(all_true, dtype=float)
    y_pred_np = np.asarray(all_pred, dtype=float)
    y_base_np = np.asarray(all_base, dtype=float)

    if len(y_true_np) == 0:
        return BacktestResult(
            n_areas_evaluated=0,
            horizon_days=horizon_days,
            mae=float("nan"),
            rmse=float("nan"),
            mape=None,
            baseline_mae=float("nan"),
            baseline_rmse=float("nan"),
            baseline_mape=None,
        )

    return BacktestResult(
        n_areas_evaluated=len(set([a for a, _ in chosen])),
        horizon_days=horizon_days,
        mae=_mae(y_true_np, y_pred_np),
        rmse=_rmse(y_true_np, y_pred_np),
        mape=_mape(y_true_np, y_pred_np),
        baseline_mae=_mae(y_true_np, y_base_np),
        baseline_rmse=_rmse(y_true_np, y_base_np),
        baseline_mape=_mape(y_true_np, y_base_np),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="data/uploaded_fir.csv", help="Input CSV path")
    ap.add_argument("--nrows", type=int, default=50000, help="Rows to load")
    ap.add_argument("--horizon-days", type=int, default=7)
    ap.add_argument("--min-history-days", type=int, default=60)
    ap.add_argument("--max-areas", type=int, default=30)
    args = ap.parse_args()

    p = CrimeDataPreprocessor()
    df = p.load_fir_dataset(path=args.csv, nrows=args.nrows)
    df = p.preprocess(df)

    r = backtest_forecaster(
        df,
        horizon_days=args.horizon_days,
        min_history_days=args.min_history_days,
        max_areas=args.max_areas,
    )

    print("\n=== BACKTEST (time-based split) ===")
    print(f"areas_evaluated: {r.n_areas_evaluated}")
    print(f"horizon_days:     {r.horizon_days}")
    print("")
    print("Poisson regression (lag + calendar):")
    print(f"  MAE:  {r.mae:.3f}")
    print(f"  RMSE: {r.rmse:.3f}")
    print(f"  MAPE: {('N/A' if r.mape is None else f'{r.mape:.2f}%')}")
    print("")
    print("Baseline (best of: last value, 7-day moving average):")
    print(f"  MAE:  {r.baseline_mae:.3f}")
    print(f"  RMSE: {r.baseline_rmse:.3f}")
    print(f"  MAPE: {('N/A' if r.baseline_mape is None else f'{r.baseline_mape:.2f}%')}")


if __name__ == "__main__":
    main()

