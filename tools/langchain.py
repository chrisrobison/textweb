"""
TextWeb LangChain Tool Integration

Wraps the TextWeb HTTP API as LangChain tools for use in agents and chains.

Usage:
    from textweb_langchain import get_textweb_tools

    tools = get_textweb_tools()  # Returns list of LangChain tools
    agent = initialize_agent(tools, llm, agent="zero-shot-react-description")

Requires:
    pip install langchain requests
    textweb --serve 3000  (run the TextWeb server)
"""

import json
import requests
from typing import Optional

try:
    from langchain.tools import Tool, StructuredTool
    from langchain.pydantic_v1 import BaseModel, Field
except ImportError:
    raise ImportError("Install langchain: pip install langchain")


DEFAULT_BASE_URL = "http://localhost:3000"


class TextWebClient:
    """HTTP client for the TextWeb server."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()

    def _post(self, endpoint: str, data: dict) -> dict:
        resp = self.session.post(f"{self.base_url}{endpoint}", json=data, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _get(self, endpoint: str) -> dict:
        resp = self.session.get(f"{self.base_url}{endpoint}", timeout=30)
        resp.raise_for_status()
        return resp.json()

    def navigate(self, url: str) -> str:
        result = self._post("/navigate", {"url": url})
        return self._format(result)

    def click(self, ref: int) -> str:
        result = self._post("/click", {"ref": ref})
        return self._format(result)

    def type_text(self, ref: int, text: str) -> str:
        result = self._post("/type", {"ref": ref, "text": text})
        return self._format(result)

    def select(self, ref: int, value: str) -> str:
        result = self._post("/select", {"ref": ref, "value": value})
        return self._format(result)

    def scroll(self, direction: str = "down", amount: int = 1) -> str:
        result = self._post("/scroll", {"direction": direction, "amount": amount})
        return self._format(result)

    def snapshot(self) -> str:
        result = self._get("/snapshot")
        return self._format(result)

    def _format(self, result: dict) -> str:
        view = result.get("view", "")
        elements = result.get("elements", {})
        meta = result.get("meta", {})

        refs = "\n".join(
            f"[{ref}] {el.get('semantic', '?')}: {el.get('text', '(no text)')}"
            for ref, el in elements.items()
        )

        return f"URL: {meta.get('url', 'unknown')}\nTitle: {meta.get('title', 'unknown')}\nRefs: {meta.get('totalRefs', 0)}\n\n{view}\n\nInteractive elements:\n{refs}"


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class NavigateInput(BaseModel):
    url: str = Field(description="URL to navigate to")

class ClickInput(BaseModel):
    ref: int = Field(description="Element reference number to click")

class TypeInput(BaseModel):
    ref: int = Field(description="Element reference number of the input field")
    text: str = Field(description="Text to type into the field")

class SelectInput(BaseModel):
    ref: int = Field(description="Element reference number of the dropdown")
    value: str = Field(description="Option value or text to select")

class ScrollInput(BaseModel):
    direction: str = Field(description="Scroll direction: up, down, or top")
    amount: int = Field(default=1, description="Number of pages to scroll")


# ─── Tool Factory ─────────────────────────────────────────────────────────────

def get_textweb_tools(base_url: str = DEFAULT_BASE_URL) -> list:
    """
    Create LangChain tools for TextWeb browser interaction.

    Args:
        base_url: URL of the running TextWeb HTTP server (default: http://localhost:3000)

    Returns:
        List of LangChain StructuredTool instances
    """
    client = TextWebClient(base_url)

    return [
        StructuredTool.from_function(
            func=lambda url: client.navigate(url),
            name="textweb_navigate",
            description="Navigate to a URL and render it as a text grid. Interactive elements are marked with [ref] numbers. Returns ~2-5KB of text instead of a 1MB screenshot. No vision model needed.",
            args_schema=NavigateInput,
        ),
        StructuredTool.from_function(
            func=lambda ref: client.click(ref),
            name="textweb_click",
            description="Click an interactive element by its [ref] number from the text grid.",
            args_schema=ClickInput,
        ),
        StructuredTool.from_function(
            func=lambda ref, text: client.type_text(ref, text),
            name="textweb_type",
            description="Type text into an input field by its [ref] number. Replaces existing content.",
            args_schema=TypeInput,
        ),
        StructuredTool.from_function(
            func=lambda ref, value: client.select(ref, value),
            name="textweb_select",
            description="Select an option from a dropdown by its [ref] number.",
            args_schema=SelectInput,
        ),
        StructuredTool.from_function(
            func=lambda direction, amount=1: client.scroll(direction, amount),
            name="textweb_scroll",
            description="Scroll the page up/down/top. Returns updated text grid.",
            args_schema=ScrollInput,
        ),
        Tool(
            name="textweb_snapshot",
            func=lambda _="": client.snapshot(),
            description="Re-render the current page as text. Use after waiting for dynamic content to load.",
        ),
    ]


# ─── Quick Test ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"
    client = TextWebClient()
    print(client.navigate(url))
