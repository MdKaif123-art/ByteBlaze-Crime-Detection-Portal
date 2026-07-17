from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from pipeline.count_forecasting import CountForecaster

logger = logging.getLogger(__name__)


@dataclass
class EvaluationReport:
    level: str
    horizon_days: int
    areas_evaluated: int
    mae: float
    rmse: float
    mape: Optional[float]
    baseline_last_mae: float
    baseline_last_rmse: float
    baseline_last_mape: Optional[float]
    baseline_ma7_mae: float
    baseline_ma7_rmse: float
    baseline_ma7_mape: Optional[float]


def _mape(y_true: np.ndarray, y_pred: np.ndarray) -> Optional[float]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = y_true > 0
    if mask.sum() == 0:
        return None
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100.0)


def _mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    return float(np.mean(np.abs(y_true - y_pred)))


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def time_split_backtest(
    df: pd.DataFrame,
    level: str = "district_name",
    horizon_days: int = 7,
    min_history_days: int = 60,
    max_areas: int = 30,
) -> EvaluationReport:
    """
    Proper time-split evaluation:
      - choose top `max_areas` active areas at the level
      - for each: train on history excluding the last `horizon_days`
      - forecast next `horizon_days`
      - compare with two baselines (last, MA7)
    """
    f = CountForecaster(level=level)
    series_by_area = f._aggregate_daily_counts(df)

    candidates = []
    for area_id, s in series_by_area.items():
        if len(s) < (min_history_days + horizon_days):
            continue
        candidates.append((area_id, float(s.sum()), s))
    candidates.sort(key=lambda x: x[1], reverse=True)
    chosen = candidates[:max_areas]

    y_true_all: List[float] = []
    y_pred_all: List[float] = []
    y_last_all: List[float] = []
    y_ma7_all: List[float] = []

    for area_id, _, s in chosen:
        train_s = s.iloc[: -horizon_days]
        test_s = s.iloc[-horizon_days:]

        # Fit model on train data only by reconstructing event-level rows (keeps dependencies minimal).
        tmp = pd.DataFrame({level: area_id, "timestamp": train_s.index})
        tmp = tmp.loc[tmp.index.repeat(train_s.values)].reset_index(drop=True)

        model = CountForecaster(level=level)
        model.fit(tmp, min_history_days=min_history_days, max_areas=None)
        art = model.forecast(tmp, horizon_days=horizon_days)
        preds = art.forecasts.get(area_id)
        if not preds:
            continue

        y_true = test_s.values.astype(float)
        y_pred = np.array([p["predicted_count"] for p in preds], dtype=float)

        last = float(train_s.iloc[-1])
        y_last = np.full(horizon_days, last, dtype=float)
        ma7 = float(train_s.rolling(7, min_periods=1).mean().iloc[-1])
        y_ma7 = np.full(horizon_days, ma7, dtype=float)

        y_true_all.extend(y_true.tolist())
        y_pred_all.extend(y_pred.tolist())
        y_last_all.extend(y_last.tolist())
        y_ma7_all.extend(y_ma7.tolist())

    y_true_np = np.asarray(y_true_all, dtype=float)
    y_pred_np = np.asarray(y_pred_all, dtype=float)
    y_last_np = np.asarray(y_last_all, dtype=float)
    y_ma7_np = np.asarray(y_ma7_all, dtype=float)

    if len(y_true_np) == 0:
        return EvaluationReport(
            level=level,
            horizon_days=horizon_days,
            areas_evaluated=0,
            mae=float("nan"),
            rmse=float("nan"),
            mape=None,
            baseline_last_mae=float("nan"),
            baseline_last_rmse=float("nan"),
            baseline_last_mape=None,
            baseline_ma7_mae=float("nan"),
            baseline_ma7_rmse=float("nan"),
            baseline_ma7_mape=None,
        )

    return EvaluationReport(
        level=level,
        horizon_days=horizon_days,
        areas_evaluated=len(chosen),
        mae=_mae(y_true_np, y_pred_np),
        rmse=_rmse(y_true_np, y_pred_np),
        mape=_mape(y_true_np, y_pred_np),
        baseline_last_mae=_mae(y_true_np, y_last_np),
        baseline_last_rmse=_rmse(y_true_np, y_last_np),
        baseline_last_mape=_mape(y_true_np, y_last_np),
        baseline_ma7_mae=_mae(y_true_np, y_ma7_np),
        baseline_ma7_rmse=_rmse(y_true_np, y_ma7_np),
        baseline_ma7_mape=_mape(y_true_np, y_ma7_np),
    )


def report_to_json(report: EvaluationReport) -> dict:
    d = asdict(report)
    for k, v in d.items():
        if isinstance(v, float) and np.isnan(v):
            d[k] = None
    return d

