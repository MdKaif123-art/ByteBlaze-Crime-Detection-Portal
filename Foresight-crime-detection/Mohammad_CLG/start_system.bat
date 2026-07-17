@echo off
echo Starting Crime Prediction Platform System...
echo Note: This script will open three separate command prompt windows for each service.

:: 1. Start ML Service (Python backend)
start "ML Service" cmd /k "cd /d C:\Users\gowth\Desktop\Mohammad_CLG\crime-prediction-platform\ml-service && echo Starting Python ML Service... && (pip install -r requirements.txt >nul 2>&1) && uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

:: 2. Start Node.js API Backend
start "Node Backend" cmd /k "cd /d C:\Users\gowth\Desktop\Mohammad_CLG\crime-prediction-platform\backend && echo Starting Node API Backend... && npm install && npm run dev"

:: 3. Start React Frontend Dashboard
start "React Frontend" cmd /k "cd /d C:\Users\gowth\Desktop\Mohammad_CLG\foresight-react-dashboard\foresight-react-dashboard && echo Starting React Frontend... && npm install && npm run dev"

echo All services are starting up in new windows.
echo - React Frontend will be available at http://localhost:5173
echo - Node Backend API is running at http://localhost:3000
echo - ML Engine is running at http://localhost:8000
