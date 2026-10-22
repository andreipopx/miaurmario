"""Stinky's «solo miau» voice: meows put together here, never by the model.

The point of the mode is the joke, so it must cost nothing: no tokens, no AI
plan, no latency. A seed makes the same look meow the same way every time it is
shown; without one each call is a fresh little speech.
"""

from __future__ import annotations

import random

SOUNDS = (
    "Miau",
    "Miau miau",
    "Miaaau",
    "Mrrp",
    "Mrrrau",
    "Prrr",
    "Prrrrr",
    "Mew",
    "Miu",
    "Ñam",
    "Mrau",
    "Miaaaaau",
)
ENDINGS = (".", ".", ".", "!", "?", "…", "~")
ASIDES = ("*ronronea*", "*se estira*", "*mueve la cola*", "*parpadea despacio*", "🐾")


def meows(seed: object | None = None, *, min_phrases: int = 1, max_phrases: int = 4) -> str:
    rng = random.Random(str(seed)) if seed is not None else random.Random()
    phrases = []
    for _ in range(rng.randint(min_phrases, max_phrases)):
        sound = rng.choice(SOUNDS)
        if rng.random() < 0.15:
            sound = f"{sound}, {rng.choice(SOUNDS).lower()}"
        phrases.append(sound + rng.choice(ENDINGS))
    if rng.random() < 0.3:
        phrases.insert(rng.randint(0, len(phrases)), rng.choice(ASIDES))
    return " ".join(phrases)
