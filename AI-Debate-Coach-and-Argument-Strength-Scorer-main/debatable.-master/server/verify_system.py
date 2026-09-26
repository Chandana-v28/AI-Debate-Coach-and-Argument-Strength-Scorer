#!/usr/bin/env python
"""Verification script for the multi-provider API system."""

from api_manager import APIKeyManager, APICallHandler

api_mgr = APIKeyManager()
handler = APICallHandler(api_mgr)
status = api_mgr.get_status()
health = api_mgr.validate_providers()

print("=== MULTI-API KEY SYSTEM VERIFICATION ===")
print("[OK] API Manager initialized")
print(f"[OK] Groq clients loaded: {status['groq_clients_count']}")
print(f"[OK] OpenAI clients loaded: {status['openai_clients_count']}")
print()
print("Provider health:")
for provider, info in health.items():
    state = "healthy" if info.get("healthy") else "unhealthy"
    print(f"  - {provider}: {state}")
    if info.get("error"):
        print(f"      {info['error']}")
print()

if status["groq_clients_count"] > 0 or status["openai_clients_count"] > 0:
    print("Multi-API system is configured.")
    if health.get("groq", {}).get("healthy") and health.get("openai", {}).get("healthy"):
        print("Both Groq and OpenAI are working.")
    elif health.get("groq", {}).get("healthy") or health.get("openai", {}).get("healthy"):
        print("At least one provider is working; failover is active.")
    else:
        print("Warning: keys are set but provider health checks failed.")
        print("Update server/.env with valid API keys.")
else:
    print("Warning: no API keys configured.")
    print("Set GROQ_API_KEY and/or OPENAI_API_KEY in server/.env")
