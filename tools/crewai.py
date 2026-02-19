"""
TextWeb CrewAI Tool Integration

Wraps TextWeb as CrewAI-compatible tools for multi-agent workflows.

Usage:
    from textweb_crewai import TextWebBrowseTool, TextWebClickTool, TextWebTypeTool

    researcher = Agent(
        role="Web Researcher",
        tools=[TextWebBrowseTool(), TextWebClickTool(), TextWebTypeTool()],
        ...
    )

Requires:
    pip install crewai requests
    textweb --serve 3000
"""

import requests
from typing import Type, Optional

try:
    from crewai_tools import BaseTool
    from pydantic import BaseModel, Field
except ImportError:
    raise ImportError("Install crewai-tools: pip install crewai-tools")


DEFAULT_BASE_URL = "http://localhost:3000"

# Shared session for connection reuse
_session = requests.Session()


def _call(endpoint: str, data: dict = None, method: str = "POST", base_url: str = DEFAULT_BASE_URL) -> str:
    url = f"{base_url.rstrip('/')}{endpoint}"
    if method == "GET":
        resp = _session.get(url, timeout=30)
    else:
        resp = _session.post(url, json=data or {}, timeout=30)
    resp.raise_for_status()
    result = resp.json()

    view = result.get("view", "")
    elements = result.get("elements", {})
    meta = result.get("meta", {})

    refs = "\n".join(
        f"[{ref}] {el.get('semantic', '?')}: {el.get('text', '(no text)')}"
        for ref, el in elements.items()
    )
    return f"URL: {meta.get('url', 'unknown')}\nTitle: {meta.get('title', 'unknown')}\n\n{view}\n\nInteractive elements:\n{refs}"


# ─── Tool Schemas ─────────────────────────────────────────────────────────────

class NavigateSchema(BaseModel):
    url: str = Field(description="URL to navigate to")

class ClickSchema(BaseModel):
    ref: int = Field(description="Element [ref] number to click")

class TypeSchema(BaseModel):
    ref: int = Field(description="Element [ref] number of the input")
    text: str = Field(description="Text to type")

class SelectSchema(BaseModel):
    ref: int = Field(description="Element [ref] number of the dropdown")
    value: str = Field(description="Option to select")

class ScrollSchema(BaseModel):
    direction: str = Field(description="up, down, or top")


# ─── CrewAI Tools ─────────────────────────────────────────────────────────────

class TextWebBrowseTool(BaseTool):
    name: str = "textweb_navigate"
    description: str = "Navigate to a URL and see it as a text grid. Interactive elements are marked with [ref] numbers for clicking/typing. ~500x smaller than screenshots, no vision model needed."
    args_schema: Type[BaseModel] = NavigateSchema

    def _run(self, url: str) -> str:
        return _call("/navigate", {"url": url})


class TextWebClickTool(BaseTool):
    name: str = "textweb_click"
    description: str = "Click an interactive element by its [ref] number from the text grid."
    args_schema: Type[BaseModel] = ClickSchema

    def _run(self, ref: int) -> str:
        return _call("/click", {"ref": ref})


class TextWebTypeTool(BaseTool):
    name: str = "textweb_type"
    description: str = "Type text into an input field by its [ref] number."
    args_schema: Type[BaseModel] = TypeSchema

    def _run(self, ref: int, text: str) -> str:
        return _call("/type", {"ref": ref, "text": text})


class TextWebSelectTool(BaseTool):
    name: str = "textweb_select"
    description: str = "Select a dropdown option by [ref] number."
    args_schema: Type[BaseModel] = SelectSchema

    def _run(self, ref: int, value: str) -> str:
        return _call("/select", {"ref": ref, "value": value})


class TextWebScrollTool(BaseTool):
    name: str = "textweb_scroll"
    description: str = "Scroll the page up, down, or to top."
    args_schema: Type[BaseModel] = ScrollSchema

    def _run(self, direction: str) -> str:
        return _call("/scroll", {"direction": direction})


class TextWebSnapshotTool(BaseTool):
    name: str = "textweb_snapshot"
    description: str = "Re-render the current page as text without navigating."

    def _run(self) -> str:
        return _call("/snapshot", method="GET")
