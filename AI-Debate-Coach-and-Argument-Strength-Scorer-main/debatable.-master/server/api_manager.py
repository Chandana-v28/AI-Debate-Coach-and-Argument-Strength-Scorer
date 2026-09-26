import os
import random
import logging
from pathlib import Path
from typing import Optional, List, Literal
from groq import Groq
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
dotenv_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=dotenv_path)

DEFAULT_GROQ_CHAT_MODEL = os.getenv("GROQ_CHAT_MODEL", "llama-3.3-70b-versatile")
DEFAULT_OPENAI_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
DEFAULT_OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")

try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    logger.warning("OpenAI package not installed. Install with: pip install openai")


class APIKeyManager:
    """Manages multiple API keys with failover capability"""

    def __init__(self):
        self.groq_clients = []
        self.openai_clients = []
        self.current_groq_index = 0
        self.current_openai_index = 0
        self.provider_health = {}
        self.load_api_keys()

    def load_api_keys(self):
        """Load API keys from environment variables"""
        groq_keys = self._load_multiple_keys("GROQ_API_KEY")
        for key in groq_keys:
            if key:
                try:
                    self.groq_clients.append(Groq(api_key=key))
                    logger.info(f"Loaded Groq API key (total: {len(self.groq_clients)})")
                except Exception as e:
                    logger.warning(f"Failed to initialize Groq client: {e}")

        if OPENAI_AVAILABLE:
            openai_keys = self._load_multiple_keys("OPENAI_API_KEY")
            if not openai_keys:
                openai_keys = self._load_multiple_keys("OPEN_API_KEY")
            for key in openai_keys:
                if key:
                    try:
                        client_kwargs = {"api_key": key}
                        if DEFAULT_OPENAI_BASE_URL:
                            client_kwargs["base_url"] = DEFAULT_OPENAI_BASE_URL
                        self.openai_clients.append(OpenAI(**client_kwargs))
                        logger.info(f"Loaded OpenAI API key (total: {len(self.openai_clients)})")
                    except Exception as e:
                        logger.warning(f"Failed to initialize OpenAI client: {e}")
        else:
            logger.warning("OpenAI library not available. Install with: pip install openai")

        if not self.groq_clients and not self.openai_clients:
            logger.warning("No API keys found. Running in mock mode.")
        else:
            if self.groq_clients:
                logger.info(f"Groq: {len(self.groq_clients)} key(s) ready")
            if self.openai_clients:
                logger.info(f"OpenAI: {len(self.openai_clients)} key(s) ready")

    def _load_multiple_keys(self, env_var: str) -> List[str]:
        """
        Load multiple API keys from environment variables.
        Supports:
        - GROQ_API_KEY=key1 (single key)
        - GROQ_API_KEY_1=key1, GROQ_API_KEY_2=key2, etc. (numbered keys)
        - GROQ_API_KEYS="key1,key2,key3" (comma-separated)
        """
        keys = []

        single_key = os.getenv(env_var)
        if single_key:
            keys.append(single_key)

        i = 1
        while True:
            numbered_key = os.getenv(f"{env_var}_{i}")
            if not numbered_key:
                break
            keys.append(numbered_key)
            i += 1

        comma_keys = os.getenv(f"{env_var}S")
        if comma_keys:
            keys.extend([k.strip() for k in comma_keys.split(",") if k.strip()])

        return list(dict.fromkeys(keys))

    def get_groq_client(self, use_random: bool = False) -> Optional[Groq]:
        if not self.groq_clients:
            return None

        if use_random:
            client = random.choice(self.groq_clients)
        else:
            client = self.groq_clients[self.current_groq_index]
            self.current_groq_index = (self.current_groq_index + 1) % len(self.groq_clients)

        return client

    def get_openai_client(self, use_random: bool = False) -> Optional["OpenAI"]:
        if not self.openai_clients:
            return None

        if use_random:
            client = random.choice(self.openai_clients)
        else:
            client = self.openai_clients[self.current_openai_index]
            self.current_openai_index = (self.current_openai_index + 1) % len(self.openai_clients)

        return client

    def get_all_groq_clients(self) -> List[Groq]:
        return self.groq_clients

    def get_all_openai_clients(self) -> List["OpenAI"]:
        return self.openai_clients

    def has_groq_keys(self) -> bool:
        return len(self.groq_clients) > 0

    def has_openai_keys(self) -> bool:
        return len(self.openai_clients) > 0

    def has_any_keys(self) -> bool:
        return self.has_groq_keys() or self.has_openai_keys()

    def get_status(self) -> dict:
        return {
            "groq_clients_count": len(self.groq_clients),
            "openai_clients_count": len(self.openai_clients),
            "anthropic_keys_count": len(self._load_multiple_keys("ANTHROPIC_API_KEY")),
            "current_groq_index": self.current_groq_index,
            "current_openai_index": self.current_openai_index,
            "groq_chat_model": DEFAULT_GROQ_CHAT_MODEL,
            "openai_chat_model": DEFAULT_OPENAI_CHAT_MODEL,
            "openai_base_url": DEFAULT_OPENAI_BASE_URL or "https://api.openai.com/v1",
            "provider_health": self.provider_health,
        }

    def validate_providers(self) -> dict:
        """Run a lightweight health check for each configured provider."""
        health = {}
        probe = [{"role": "user", "content": "Reply with OK only."}]

        if self.has_groq_keys():
            try:
                client = self.get_all_groq_clients()[0]
                client.chat.completions.create(
                    model=DEFAULT_GROQ_CHAT_MODEL,
                    messages=probe,
                    max_tokens=10,
                )
                health["groq"] = {"configured": True, "healthy": True}
            except Exception as e:
                health["groq"] = {"configured": True, "healthy": False, "error": str(e)[:200]}
        else:
            health["groq"] = {"configured": False, "healthy": False}

        if self.has_openai_keys():
            try:
                client = self.get_all_openai_clients()[0]
                client.chat.completions.create(
                    model=DEFAULT_OPENAI_CHAT_MODEL,
                    messages=probe,
                    max_tokens=10,
                )
                health["openai"] = {"configured": True, "healthy": True}
            except Exception as e:
                error_msg = str(e)
                if "invalid_api_key" in error_msg or "Incorrect API key" in error_msg:
                    error_msg = (
                        "Invalid OpenAI API key. Use a key from https://platform.openai.com "
                        "(starts with sk-)."
                    )
                health["openai"] = {"configured": True, "healthy": False, "error": error_msg[:200]}
        else:
            health["openai"] = {"configured": False, "healthy": False}

        self.provider_health = health
        return health


class APICallHandler:
    """Handles API calls with retry logic and cross-provider failover"""

    def __init__(self, api_manager: APIKeyManager):
        self.api_manager = api_manager

    def call_chat_with_fallback(
        self,
        messages: List[dict],
        max_retries: int = 3,
        temperature: float = 0.7,
        max_tokens: int = 1500,
        prefer_openai: bool = False,
        groq_model: Optional[str] = None,
        openai_model: Optional[str] = None,
    ):
        """
        Call chat completion with cross-provider failover.
        OpenAI is preferred for analysis tasks; Groq is preferred for fast generation.
        """
        groq_model = groq_model or DEFAULT_GROQ_CHAT_MODEL
        openai_model = openai_model or DEFAULT_OPENAI_CHAT_MODEL

        if prefer_openai:
            providers: List[Literal["openai", "groq"]] = ["openai", "groq"]
        else:
            providers = ["groq", "openai"]

        last_error = None

        for provider in providers:
            if provider == "openai":
                clients = self.api_manager.get_all_openai_clients()
                model = openai_model
                label = "OpenAI"
            else:
                clients = self.api_manager.get_all_groq_clients()
                model = groq_model
                label = "Groq"

            if not clients:
                continue

            for attempt in range(max_retries):
                for client_idx, client in enumerate(clients):
                    try:
                        logger.info(
                            f"Attempt {attempt + 1}/{max_retries}, "
                            f"using {label} client {client_idx} (model={model})"
                        )
                        response = client.chat.completions.create(
                            model=model,
                            messages=messages,
                            temperature=temperature,
                            max_tokens=max_tokens,
                        )
                        logger.info(f"{label} API call successful with client {client_idx}")
                        return response
                    except Exception as e:
                        last_error = e
                        logger.warning(f"{label} client {client_idx} failed: {str(e)}")
                        continue

        raise Exception(f"All chat API calls failed (Groq + OpenAI): {str(last_error)}")

    def call_groq_with_fallback(
        self,
        model: str,
        messages: List[dict],
        max_retries: int = 3,
        temperature: float = 0.7,
        max_tokens: int = 1500,
    ):
        """Backward-compatible wrapper: Groq first, OpenAI fallback."""
        return self.call_chat_with_fallback(
            messages=messages,
            max_retries=max_retries,
            temperature=temperature,
            max_tokens=max_tokens,
            prefer_openai=False,
            groq_model=model,
        )

    def call_openai_with_fallback(
        self,
        model: str,
        messages: List[dict],
        max_retries: int = 3,
        temperature: float = 0.7,
        max_tokens: int = 1500,
    ):
        """OpenAI first, Groq fallback."""
        return self.call_chat_with_fallback(
            messages=messages,
            max_retries=max_retries,
            temperature=temperature,
            max_tokens=max_tokens,
            prefer_openai=True,
            openai_model=model,
        )

    def call_whisper_with_fallback(
        self,
        audio_file,
        filename: str,
        file_extension: str,
        model: str = "whisper-large-v3",
        language: str = "en",
        max_retries: int = 3,
    ) -> str:
        """Call Groq or OpenAI Whisper API with cross-provider fallback."""
        import requests

        groq_clients = self.api_manager.get_all_groq_clients()

        if groq_clients:
            for attempt in range(max_retries):
                for client_idx, client in enumerate(groq_clients):
                    try:
                        api_key = client.api_key
                        audio_file.seek(0)

                        logger.info(
                            f"Attempt {attempt + 1}/{max_retries}, "
                            f"using Groq Whisper client {client_idx}"
                        )

                        response = requests.post(
                            "https://api.groq.com/openai/v1/audio/transcriptions",
                            headers={"Authorization": f"Bearer {api_key}"},
                            files={
                                "file": (
                                    filename or f"recording{file_extension}",
                                    audio_file,
                                    f"audio/{file_extension[1:]}",
                                )
                            },
                            data={"model": model, "language": language},
                        )

                        if not response.ok:
                            logger.warning(
                                f"Groq Whisper client {client_idx} failed: {response.text}"
                            )
                            continue

                        transcription = response.json()["text"].strip()
                        logger.info(f"Groq Whisper successful with client {client_idx}")
                        return transcription

                    except Exception as e:
                        logger.warning(f"Groq Whisper client {client_idx} failed: {str(e)}")
                        continue

            logger.warning("All Groq Whisper clients failed, attempting OpenAI fallback")

        openai_clients = self.api_manager.get_all_openai_clients()

        if not openai_clients:
            raise Exception("No API keys available for speech-to-text")

        for attempt in range(max_retries):
            for client_idx, client in enumerate(openai_clients):
                try:
                    logger.info(
                        f"Attempt {attempt + 1}/{max_retries}, "
                        f"using OpenAI Whisper client {client_idx}"
                    )

                    audio_file.seek(0)

                    transcription = client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file,
                        language=language,
                    )

                    logger.info(f"OpenAI Whisper successful with client {client_idx}")
                    return transcription.text.strip()

                except Exception as e:
                    logger.warning(f"OpenAI Whisper client {client_idx} failed: {str(e)}")
                    continue

        raise Exception("All speech-to-text API calls failed (Groq + OpenAI)")
