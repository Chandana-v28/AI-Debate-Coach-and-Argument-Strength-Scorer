import requests
import json

print("Testing Auth Endpoints...")
print("=" * 50)

# Test 1: Register
print("\n1. Testing Registration:")
data = {'username': 'testuser456', 'email': 'test456@example.com', 'password': 'password123'}
try:
    response = requests.post('http://localhost:8000/auth/register', json=data)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")

# Test 2: Register with alternate domains
print("\n2. Testing Registration with alternate domains:")
for alt_email in ['testuser456@yahoo.com', 'testuser456@duckduckgo.com', 'testuser456@startup.io']:
    local_part = alt_email.split('@')[0]
    data = {'username': f'testuser_{local_part}', 'email': alt_email, 'password': 'password123'}
    try:
        response = requests.post('http://localhost:8000/auth/register', json=data)
        print(f"Registering {alt_email} => Status: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error registering {alt_email}: {e}")

# Test 3: Login
print("\n3. Testing Login:")
data = {'username': 'testuser456', 'password': 'password123'}
try:
    response = requests.post('http://localhost:8000/auth/login', json=data)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")

# Test 4: Check DB
print("\n4. Checking Database:")
import sqlite3
conn = sqlite3.connect('debate_app.db')
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in cur.fetchall()]
print(f"Tables: {tables}")
conn.close()
