"""Where the Owl Speaks model lives, and whether this deployment can reach it.

Two shapes are supported, both speaking the same native Ollama chat API:

* **A local or self-hosted Ollama** — the default, `http://localhost:11434`. Right for a
  laptop or a container on the same host, and unreachable from a serverless function.
* **Ollama Cloud** — set `OLLAMA_API_KEY` and requests go to `https://ollama.com` with a
  bearer token. This is what makes chat work on Vercel without exposing a machine of your
  own. Cloud model names differ from local ones (`mistral-large-3:675b`, not `llama3.1`), so the
  default model follows the endpoint.

`OLLAMA_BASE_URL` overrides the choice either way, for an Ollama-compatible endpoint hosted
somewhere else.

Kept separate from src/chat.py deliberately. The serverless app needs to answer "can this
deployment do chat at all?" on its status endpoint, and importing the agent to find out
would pull pandas and the Alpaca client into every cold start that never chats.

Read through these helpers rather than caching module-level constants: the tests override
the environment per case, and a serverless import happens well before any given request.
"""
import os

DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "llama3.1"

OLLAMA_CLOUD_BASE_URL = "https://ollama.com"
# Cloud models are a different catalogue from whatever is pulled locally, so the local
# default would 404. Overridable with OLLAMA_MODEL; see https://ollama.com/search for the
# current list.
#
# Chosen because Owl Speaks accepts pasted chart screenshots, and most of the cloud
# catalogue cannot read them: gpt-oss, glm-5.2 and deepseek-v4-pro all reject a request
# carrying `images` with a 400. Of the models that do accept images, this one answers a
# quantitative technical-analysis prompt as accurately as the alternatives and noticeably
# faster, which matters for an interactive chat.
DEFAULT_OLLAMA_CLOUD_MODEL = "mistral-large-3:675b"

# Hosts that only resolve to the machine running the process. A container or a laptop has
# an Ollama here; a serverless function never does.
_LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]", "0.0.0.0")


def ollama_api_key() -> str:
    """The Ollama Cloud API key, or an empty string. Created at ollama.com/settings/keys."""
    return (os.environ.get("OLLAMA_API_KEY") or "").strip()


def ollama_base_url() -> str:
    """An explicit OLLAMA_BASE_URL wins; otherwise a key implies the cloud endpoint."""
    explicit = (os.environ.get("OLLAMA_BASE_URL") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    if ollama_api_key():
        return OLLAMA_CLOUD_BASE_URL
    return DEFAULT_OLLAMA_BASE_URL


def ollama_model() -> str:
    explicit = (os.environ.get("OLLAMA_MODEL") or "").strip()
    if explicit:
        return explicit
    if ollama_base_url() == OLLAMA_CLOUD_BASE_URL:
        return DEFAULT_OLLAMA_CLOUD_MODEL
    return DEFAULT_OLLAMA_MODEL


def ollama_auth_headers() -> dict:
    """Bearer auth when a key is configured.

    Sent to whatever endpoint is in use, not just ollama.com: a self-hosted Ollama behind
    an authenticating proxy wants it too, and an endpoint that ignores it is unharmed.
    """
    key = ollama_api_key()
    return {"Authorization": f"Bearer {key}"} if key else {}


def ollama_is_local(base_url=None) -> bool:
    """True when the configured endpoint is a loopback address."""
    url = base_url if base_url is not None else ollama_base_url()
    return any(host in url for host in _LOOPBACK_HOSTS)
