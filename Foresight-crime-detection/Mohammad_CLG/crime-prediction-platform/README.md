# AI-Powered Crime Prediction & Hotspot Mapping Platform

This complete platform ingests historical crime data, predicts hotspots using Unsupervised Machine Learning (DBSCAN), forecasts future crimes (ARIMA), and serves all data via an Express backend with WebSockets for real-time SOS alerts.

## Project Structure
- **/ml-service**: Python/FastAPI service hosting the data pipelines, AI models, and clustering algorithms.
- **/backend**: Node.js/Express service bridging the Machine Learning API to external frontends, managing direct Database models and WebSockets.

## Requirements
- Python 3.9+
- Node.js 18+
- MongoDB Instance (local or remote)

## Getting Started

### 1. Database Setup
Ensure that MongoDB is running locally on port 27017 or update the `MONGODB_URI` inside `backend/.env`.

### 2. Startup the ML Service
```powershell
cd ml-service
# (Optional) Create a virtual environment
pip install -r requirements.txt
python main.py
```
*The ML Service runs on http://localhost:8000*

### 3. Startup the Backend
```powershell
cd backend
npm install
# Seed the initial mock data
npm run seed
# Start the backend server
npm start
```
*The Backend API runs on http://localhost:3000*

## Triggering the Pipeline (Initial Setup)
Once both servers are running, the Machine Learning service needs to ingest and preprocess the FIR Dataset you provided, find coordinates, determine severity, and train the ARIMA prediction array.

You can trigger this by calling the frontend endpoint via curl or Postman:
```http
POST http://localhost:3000/api/v1/train
```

Once parsing and training complete within the background worker (which can take a few minutes for large datasets), endpoints like `/api/v1/hotspots` will automatically return categorized risk-zones!
