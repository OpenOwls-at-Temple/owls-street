"""Where the Owl Speaks model lives, and whether this deployment can reach it.

Kept separate from src/chat.py deliberately. The serverless app needs to answer "can this
deployment do chat at all?" on its status endpoint, and importing the agent to find out
would pull pandas and the Alpaca client into every cold start that never chats.

Read through these helpers rather than caching module-level constants: the tests override
the environment per case, and a serverless import happens well before any given request.
"""
import os

DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "llama3.1"

# Hosts that only resolve to the machine running the process. A container or a laptop has
# an Ollama here; a serverless function never does.
_LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]", "0.0.0.0")


def ollama_base_url() -> str:
    return (os.environ.get("OLLAMA_BASE_URL") or DEFAULT_OLLAMA_BASE_URL).rstrip("/")


def ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL") or DEFAULT_OLLAMA_MODEL


def ollama_is_local(base_url=None) -> bool:
    """True when the configured endpoint is a loopback address."""
    url = base_url if base_url is not None else ollama_base_url()
    return any(host in url for host in _LOOPBACK_HOSTS)
