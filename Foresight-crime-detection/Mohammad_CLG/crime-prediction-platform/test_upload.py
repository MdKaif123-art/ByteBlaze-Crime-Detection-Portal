import requests

try:
    with open('ml-service/data/uploaded_fir.csv', 'rb') as f:
        files = {'file': f}
        r = requests.post('http://localhost:3000/api/v1/upload-data', files=files)
        print("STATUS:", r.status_code)
        print("TEXT:", r.text)
except Exception as e:
    print("ERROR:", e)
