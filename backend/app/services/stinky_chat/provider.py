"""Streaming chat-completions client for OpenAI-compatible providers.

Talks to the provider resolved for the user (``AIService`` from
``app.services.ai_access``) and yields ``ProviderEvent``s:

* ``content``   - a piece of the visible answer (safe to stream to the user),
* ``reasoning`` - a piece of ``reasoning_content`` (DeepSeek thinking mode);
  NEVER forwarded to the client, only used as a keep-alive signal,
* ``final``     - the assembled assistant message (content, reasoning,
  tool_calls, usage, finish_reason).

Usage (1 request + provider-reported tokens) is recorded through the
AIService's usage sink after every call, even if the stream breaks midway.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx

from app.config import get_settings
from app.services.ai_service import AIService

logger = logging.getLogger(__name__)


class ProviderError(RuntimeError):
    """The provider call failed (HTTP error, network error, malformed stream)."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str

    def to_message(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": "function",
            "function": {"name": self.name, "arguments": self.arguments},
        }


@dataclass
class CompletionResult:
    content: str = ""
    reasoning: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass
class ProviderEvent:
    kind: Literal["content", "reasoning", "final"]
    text: str = ""
    result: CompletionResult | None = None


def _make_client(**kwargs: Any) -> httpx.AsyncClient:
    """Factory for the HTTP client (tests swap it to inject a mock transport)."""
    return httpx.AsyncClient(**kwargs)


def is_deepseek(base_url: str) -> bool:
    host = (urlsplit(base_url).hostname or "").lower()
    return host == "api.deepseek.com" or host.endswith(".deepseek.com")


def build_request_body(
    ai: AIService,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    tool_choice: str | None,
    max_tokens: int,
) -> dict[str, Any]:
    settings = get_settings()
    body: dict[str, Any] = {
        "model": ai.config.text_model,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": max_tokens,
    }
    if tools:
        body["tools"] = tools
        if tool_choice:
            body["tool_choice"] = tool_choice
    if settings.stinky_chat_reasoning_effort and is_deepseek(ai.config.base_url):
        body["reasoning_effort"] = settings.stinky_chat_reasoning_effort
    return body


def _delta_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):  # content parts
        return "".join(p.get("text", "") for p in value if isinstance(p, dict))
    return ""


class StreamAccumulator:
    """Folds streamed chunks into a CompletionResult (content, reasoning, tool calls, usage)."""

    def __init__(self) -> None:
        self.result = CompletionResult()
        self._calls: dict[int, dict[str, str]] = {}

    def feed(self, chunk: dict[str, Any]) -> list[ProviderEvent]:
        events: list[ProviderEvent] = []
        usage = chunk.get("usage")
        if isinstance(usage, dict):
            self.result.prompt_tokens = int(usage.get("prompt_tokens") or 0)
            self.result.completion_tokens = int(usage.get("completion_tokens") or 0)
            total = usage.get("total_tokens")
            if not self.result.completion_tokens and isinstance(total, int):
                self.result.completion_tokens = max(total - self.result.prompt_tokens, 0)
        for choice in chunk.get("choices") or []:
            if not isinstance(choice, dict):
                continue
            delta = choice.get("delta") or {}
            reasoning = _delta_text(delta.get("reasoning_content"))
            if reasoning:
                self.result.reasoning += reasoning
                events.append(ProviderEvent("reasoning", reasoning))
            content = _delta_text(delta.get("content"))
            if content:
                self.result.content += content
                events.append(ProviderEvent("content", content))
            for tc in delta.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                try:
                    idx = int(tc.get("index", len(self._calls)))
                except (TypeError, ValueError):
                    idx = len(self._calls)
                slot = self._calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                if tc.get("id"):
                    slot["id"] = str(tc["id"])
                fn = tc.get("function") or {}
                if isinstance(fn.get("name"), str):
                    slot["name"] += fn["name"]
                if isinstance(fn.get("arguments"), str):
                    slot["arguments"] += fn["arguments"]
            if choice.get("finish_reason"):
                self.result.finish_reason = choice["finish_reason"]
        return events

    def finish(self) -> CompletionResult:
        calls: list[ToolCall] = []
        for i, idx in enumerate(sorted(self._calls)):
            slot = self._calls[idx]
            if not slot["name"]:
                continue
            calls.append(
                ToolCall(
                    id=slot["id"] or f"call_{i}",
                    name=slot["name"],
                    arguments=slot["arguments"],
                )
            )
        self.result.tool_calls = calls
        return self.result


async def stream_completion(
    ai: AIService,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | None = None,
    max_tokens: int | None = None,
) -> AsyncIterator[ProviderEvent]:
    """Stream one chat completion. Raises ProviderError on failure."""
    settings = get_settings()
    if not ai.config.text_model:
        raise ProviderError("No text model configured")
    body = build_request_body(
        ai, messages, tools, tool_choice, max_tokens or settings.stinky_chat_max_tokens
    )
    url = f"{ai.base_url}/chat/completions"
    timeout = httpx.Timeout(connect=10.0, read=float(ai.timeout), write=30.0, pool=10.0)
    acc = StreamAccumulator()
    recorded = False

    async def record() -> None:
        nonlocal recorded
        if recorded:
            return
        recorded = True
        await ai._record_usage(
            {
                "usage": {
                    "prompt_tokens": acc.result.prompt_tokens,
                    "completion_tokens": acc.result.completion_tokens,
                }
            }
        )

    try:
        async with _make_client(
            timeout=timeout, follow_redirects=ai.config.follow_redirects
        ) as client:
            async with client.stream("POST", url, headers=ai._get_headers(), json=body) as resp:
                if resp.status_code >= 400:
                    raw = (await resp.aread())[:500]
                    logger.warning(
                        "Stinky chat provider HTTP %s: %s",
                        resp.status_code,
                        raw.decode("utf-8", "replace"),
                    )
                    raise ProviderError(
                        f"Provider returned HTTP {resp.status_code}",
                        status_code=resp.status_code,
                    )
                async for raw_line in resp.aiter_lines():
                    line = raw_line.strip()
                    if not line.startswith("data:"):
                        continue  # blank lines, ": keep-alive" comments, event: lines
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                    except json.JSONDecodeError:
                        logger.debug("Skipping malformed stream chunk")
                        continue
                    if not isinstance(chunk, dict):
                        continue
                    if chunk.get("error"):
                        raise ProviderError("Provider reported an error mid-stream")
                    for event in acc.feed(chunk):
                        yield event
    except httpx.HTTPError as e:
        await record()
        raise ProviderError(f"Provider request failed: {type(e).__name__}") from None
    except ProviderError:
        await record()
        raise
    await record()
    yield ProviderEvent("final", result=acc.finish())
