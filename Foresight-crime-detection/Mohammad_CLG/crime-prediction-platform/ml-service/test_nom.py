import requests
import json

try:
    headers = {'User-Agent': 'ForesightApp/1.0'}
    resp = requests.get('https://nominatim.openstreetmap.org/reverse?lat=12.898&lon=78.9795&format=json', headers=headers)
    with open('nom.json', 'w', encoding='utf-8') as f:
        json.dump(resp.json(), f, indent=2)
except Exception as e:
    print(f"Error: {e}")
