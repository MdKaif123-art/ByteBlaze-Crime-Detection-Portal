"""
MODULE 8: Patrol Optimization
Generates optimal patrol routes prioritizing high-risk zones.
Simplification: Uses straight-line distance instead of road networks to prioritize
risk coverage while minimizing total distance using a greedy approach (approximating TSP).
"""
import logging
import math
import networkx as nx
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).parent.parent))
from utils.geo_utils import haversine_distance

logger = logging.getLogger(__name__)

class PatrolOptimizer:
    """Optimizes patrol routing through high-risk crime zones."""

    def __init__(self):
        pass

    def optimized_route(self, start_lat, start_lon, clusters, max_zones=5, target_season=None):
        """
        Calculates an optimal seasonal route visiting `max_zones` top risk clusters.
        If target_season is provided, prioritizes hotspots detected mostly during that season.
        clusters: list of dicts with 'centroid_lat', 'centroid_lng', 'risk_score', 'cluster_id', 'season'
        Returns: Directed order of coordinates and total distance.
        """
        if not clusters:
            return {"route": [], "total_distance_km": 0, "coverage_score": 0}

        # Handle Seasonal Behavourial Priority
        filtered_clusters = clusters
        if target_season:
            # Heavily prioritize clusters that peak in the requested season
            filtered_clusters = []
            for c in clusters:
                if c.get("season") == target_season:
                    # Bump risk score for seasonal matches
                    c["runtime_risk_score"] = c.get("risk_score", 0) * 1.5 
                else:
                    c["runtime_risk_score"] = c.get("risk_score", 0)
                filtered_clusters.append(c)
        else:
            for c in clusters: c["runtime_risk_score"] = c.get("risk_score", 0)

        # Filter and sort by runtime risk
        high_risk = sorted(filtered_clusters, key=lambda x: x.get('runtime_risk_score', 0), reverse=True)[:max_zones]
        
        # Greedy TSP / Nearest Neighbor Approach, weighted by risk
        current_loc = (start_lat, start_lon)
        route = [{
            "id": "START_STATION",
            "lat": start_lat,
            "lon": start_lon,
            "type": "station"
        }]
        
        unvisited = list(high_risk)
        total_dist = 0
        coverage_score = 0
        
        while unvisited:
            best_node = None
            best_score = -float('inf')
            best_dist = 0
            
            for node in unvisited:
                dist = haversine_distance(current_loc[0], current_loc[1], node['centroid_lat'], node['centroid_lng'])
                
                # Prevent division by zero
                # Score = Risk - Distance Penalty
                # Very simple heuristic: High Risk / Distance
                heuristic_score = node.get('runtime_risk_score', 1) / (dist + 0.001)
                
                if heuristic_score > best_score:
                    best_score = heuristic_score
                    best_node = node
                    best_dist = dist
                    
            # Move to best node
            route.append({
                "id": f"CLUSTER_{best_node['cluster_id']}",
                "lat": best_node['centroid_lat'],
                "lon": best_node['centroid_lng'],
                "risk_level": best_node.get('risk_level', 'UNKNOWN'),
                "type": "hotspot"
            })
            coverage_score += best_node.get('risk_score', 0)
            total_dist += best_dist
            current_loc = (best_node['centroid_lat'], best_node['centroid_lng'])
            unvisited.remove(best_node)
            
        # Return to start station
        dist_home = haversine_distance(current_loc[0], current_loc[1], start_lat, start_lon)
        total_dist += dist_home
        route.append({
            "id": "RETURN_STATION",
            "lat": start_lat,
            "lon": start_lon,
            "type": "station"
        })
        
        logger.info(f"Generated route via {len(high_risk)} zones, dist={total_dist:.1f}km")
        
        return {
            "route": route,
            "total_distance_km": round(total_dist, 2),
            "coverage_score": round(coverage_score, 1)
        }

# ── Standalone execution ──
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    optimizer = PatrolOptimizer()
    
    clusters = [
        {"cluster_id": 1, "centroid_lat": 12.97, "centroid_lng": 77.59, "risk_score": 90, "risk_level": "CRITICAL"},
        {"cluster_id": 2, "centroid_lat": 12.98, "centroid_lng": 77.58, "risk_score": 75, "risk_level": "HIGH"},
        {"cluster_id": 3, "centroid_lat": 12.95, "centroid_lng": 77.61, "risk_score": 45, "risk_level": "MEDIUM"}
    ]
    
    # Start at random station in Bangalore
    route_info = optimizer.optimized_route(12.96, 77.58, clusters)
    print("\n=== OPTIMIZED PATROL ROUTE ===")
    for idx, stop in enumerate(route_info["route"]):
        print(f"{idx}. {stop['id']} ({stop['type']})")
    print(f"Total Distance: {route_info['total_distance_km']} km")
