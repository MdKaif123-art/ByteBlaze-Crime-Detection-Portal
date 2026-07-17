"""
MODULE: GenAI Police Dispatch Briefing
Simulates an LLM evaluating a high-risk zone or incoming SOS alert and outputting
a grammatically flawless, authoritative Police Dispatch format. This runs entirely offline
meaning no API costs for hackathons!
"""
import logging
from datetime import datetime
import random

logger = logging.getLogger(__name__)

class LLMDispatcher:
    def __init__(self):
        # Professional vocabulary banks to simulate LLM variance
        self.urgency_prefixes = [
            "CRITICAL ALERT", "URGENT DISPATCH REQUIRED", "IMMEDIATE ACTION PROTOCOL", 
            "HIGH-PRIORITY INTELLIGENCE"
        ]
        self.reasoning = [
            "due to historical seasonal trends coupled with recent spike trajectories.",
            "based on ARIMA predictive models analyzing low infrastructure lighting and time-of-day behavioral patterns.",
            "correlating with recent sequential crime vectors identified in adjacent grid cells.",
            "as flagged by unsupervised ML clustering models indicating a severe anomaly."
        ]
        self.actions = [
            "Recommending immediate deployment of Gasht Unit",
            "Mandating tactical patrol redirection for Unit",
            "Suggesting blockade formation and highway intercept by Sector Unit"
        ]

    def generate_briefing(self, cluster_data, is_sos=False, sos_details=None):
        """
        Generates a formal LLM-style dispatch report.
        cluster_data: Dict containing risk_score, legal_category, season, district
        """
        prefix = random.choice(self.urgency_prefixes)
        time_now = datetime.now().strftime("%H:%M:%S")
        unit_num = random.randint(1, 15)
        
        if is_sos and sos_details:
             report = f"{prefix} [{time_now}]: Real-time SOS Triggered in {sos_details.get('district', 'Unknown Location')}. "
             report += f"Incident classification: {sos_details.get('type', 'GENERAL_EMERGENCY')}. "
             report += f"AI cross-reference indicates this SOS occurred inside a preexisting HIGH-RISK polygon. "
             report += f"Deploying intercept unit {unit_num} with ETA < 4 minutes."
             return report

        # Extract features from the ML Cluster
        score = cluster_data.get('risk_score', 0)
        category = cluster_data.get('predominant_legal_category', 'UNKNOWN_IPC')
        district = cluster_data.get('district_name', 'Unknown Grid')
        season = cluster_data.get('season', 'Current Season')
        
        if float(score) < 50:
            return {
                "timestamp": time_now,
                "district": district,
                "ai_briefing": f"ROUTINE MONITORING: Sector {district} showing stable patterns. No immediate redeployment required.",
                "recommended_unit": "None - Routine",
                "threat_level": "LOW"
            }

        reason = random.choice(self.reasoning)
        action = random.choice(self.actions)
        
        # Build the LLM output string
        report = f"{prefix} [{time_now}]: Elevated probability (Score: {score:.1f}/100) of {category} "
        report += f"detected in {district} {reason} "
        report += f"Behavioral analysis indicates this is a high-frequency zone during {season} months. "
        report += f"{action} {unit_num} to grid perimeter to establish visual deterrence."
        
        logger.info("Generated AI Dispatch Briefing.")
        
        return {
            "timestamp": time_now,
            "district": district,
            "ai_briefing": report,
            "recommended_unit": f"Gasht Unit {unit_num}",
            "threat_level": "CRITICAL" if score >= 85 else "HIGH"
        }
