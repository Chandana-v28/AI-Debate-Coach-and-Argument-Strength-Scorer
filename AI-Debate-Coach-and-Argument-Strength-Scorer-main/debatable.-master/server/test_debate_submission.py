import requests
import json
from main import create_token
import io

# Create a token for a test user
token = create_token('testuser')
print(f'Token: {token[:50]}...')

# Create a simple audio file for testing
# We'll send a minimal wav file
audio_data = b'\xff\xfb' + b'\x00' * 100  # Fake MP3 header

print('\n=== Submitting Debate ===')
files = {
    'audio': ('test.webm', audio_data, 'audio/webm'),
}
data = {
    'topic': 'Test Debate Topic'
}
headers = {
    'Authorization': f'Bearer {token}'
}

response = requests.post(
    'http://localhost:8000/debate/full',
    files=files,
    data=data,
    headers=headers
)

print(f'Status: {response.status_code}')
if response.ok:
    result = response.json()
    print(f'Response: {json.dumps({k: v[:50] if isinstance(v, str) else v for k, v in result.items()}, indent=2)}')
    print('\nNow checking history...')
    
    # Get the history
    hist_response = requests.get(
        'http://localhost:8000/history',
        headers=headers
    )
    print(f'History Status: {hist_response.status_code}')
    if hist_response.ok:
        debates = hist_response.json()
        print(f'Total debates: {len(debates)}')
        if debates:
            print(f'Latest debate: {json.dumps({k: debates[0][k][:30] if isinstance(debates[0][k], str) else debates[0][k] for k in ["id", "topic", "created_at"]}, indent=2)}')
else:
    print(f'Error: {response.text}')
