# ByteBlaze-Crime-Detection-Portal

Monorepo for AJ Hackathon projects: Foresight crime-detection stack, React dashboard, and patrol-officer web app.

## Run locally

From this folder (after `npm install` in each app you use):

- `npm run dev:foresight-react-dashboard` — React dashboard
- `npm run dev:patrol-officer-web` — Patrol officer web

Python/ML services live under `Foresight-crime-detection/`; see each subproject’s README or `requirements` where present.

## Security Enhancements
To ensure sensitive law enforcement data remains secure and compliant, we are implementing the following security measures:
- **Role-Based Access Control (RBAC):** Strict permission levels so that only authorized personnel (e.g., admins vs. patrol officers) can access specific sensitive intelligence and crime data.
- **Data Encryption:** End-to-end encryption for all data in transit (TLS/SSL) and at rest (AES-256), specifically leveraging Firebase Security Rules to restrict unauthorized database reads/writes.
- **Audit Logging:** Comprehensive tracking of all user actions on the dashboard (who accessed what data and when) to maintain a secure audit trail and prevent internal misuse.
- **PII Anonymization:** Automatically anonymizing Personally Identifiable Information in reports to comply with data privacy regulations (such as GDPR / DPDP Act) while still allowing location-based hotspot analysis.
- **Multi-Factor Authentication (MFA):** Requiring secondary authentication for any critical dashboard access.

## Monetization Strategy (Revenue Model)
Foresight is designed with a sustainable B2G (Business-to-Government) and B2B approach:
1. **Government & Law Enforcement Licensing (B2G):** Subscription-based licensing for municipal corporations, smart city initiatives, and police departments. Pricing can be tiered based on the size of the jurisdiction and the number of active officer accounts.
2. **API Access for Enterprises (B2B):** Charging private security firms, real estate platforms, and insurance companies for API access to our crime analytics and hotspot data (which they use for risk assessment and property valuation).
3. **Custom Deployment & Training Fees:** Charging one-time setup, integration, and training fees to adapt the platform to specific legacy systems used by different state police forces.
4. **White-Labeling:** Offering a white-labeled version of the dashboard and patrol officer web app for private security agencies or international municipalities to brand as their own.
