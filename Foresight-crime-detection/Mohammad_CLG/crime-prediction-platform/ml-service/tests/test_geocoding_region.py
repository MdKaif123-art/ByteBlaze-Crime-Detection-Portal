from pipeline.preprocessing import CrimeDataPreprocessor


def _build_df(district: str, unit: str):
    # Minimal schema needed by _geocode_zero_coordinates
    return {
        "district_name": [district],
        "unit_name": [unit],
        "latitude": [0.0],
        "longitude": [0.0],
    }


def test_geocoding_query_region_uses_district_state(monkeypatch):
    """
    Prevents regressions where geocoding always queries the wrong state.
    We don't call the network; we just assert the query string composed for OSM.
    """
    import pandas as pd

    p = CrimeDataPreprocessor()

    captured = {"query": None}

    class _FakeGeo:
        def geocode(self, query, timeout=5):
            captured["query"] = query
            return None

    p.geolocator = _FakeGeo()

    # Tamil Nadu district should include "Tamil Nadu, India"
    df = pd.DataFrame(_build_df("Chennai", "Some PS"))
    p._geocode_zero_coordinates(df)
    assert "Tamil Nadu, India" in captured["query"]

    # Karnataka district should include "Karnataka, India"
    df2 = pd.DataFrame(_build_df("Bengaluru City", "Some PS"))
    p._geocode_zero_coordinates(df2)
    assert "Karnataka, India" in captured["query"]

