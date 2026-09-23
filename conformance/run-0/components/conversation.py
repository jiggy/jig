"""Finite adaptive analysis and dataset roles, using only the public SDK."""

import asyncio
import re

from jiggy.flow import handle


NAME = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
REQUEST = "https://example.org/dataset-analysis/sample-request"
REPLY = "https://example.org/dataset-analysis/sample-celsius"


def name(value):
    if not isinstance(value, str) or NAME.fullmatch(value) is None:
        raise TypeError("invalid sample")
    return value


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def reading(value):
    if not isinstance(value, dict) or set(value) != {"sample", "celsius"} or not number(value["celsius"]):
        raise TypeError("invalid reading")
    return {"sample": name(value["sample"]), "celsius": value["celsius"]}


async def run(context):
    value = context.input
    role = value["role"]
    if role not in ("analysis", "dataset"):
        raise TypeError("invalid role")
    requests, replies = context.channels["requests"], context.channels["replies"]
    if (requests.delivery != "direct" or replies.delivery != "direct"
            or requests.contract["id"] != REQUEST or replies.contract["id"] != REPLY):
        raise TypeError("two named direct channels required")
    incoming, outgoing = (replies, requests) if role == "analysis" else (requests, replies)
    if incoming.direction != "receive" or outgoing.direction != "send" or incoming.start_sequence != 1:
        raise TypeError("beginning receiver and sender required")
    iterator = aiter(incoming)
    try:
        samples = value["samples"]
        if not isinstance(samples, list) or not 1 <= len(samples) <= 128:
            raise TypeError("one to 128 samples required")
        if role == "dataset":
            samples = list(map(reading, samples))
            if (len({item["sample"] for item in samples}) != len(samples)
                    or any(left["celsius"] > right["celsius"] for left, right in zip(samples, samples[1:]))):
                raise TypeError("unique monotone samples required")
            served = []
            while True:
                request = await anext(iterator, None)
                if request is None:
                    break
                if not isinstance(request, dict) or set(request) != {"sample"}:
                    raise TypeError("invalid request")
                sample = name(request["sample"])
                selected = next((item for item in samples if item["sample"] == sample), None)
                if selected is None or sample in served or len(served) == 8:
                    raise TypeError("unexpected, duplicate, or excessive request")
                served.append(sample)
                if value.get("mode") == "early-eof":
                    break
                reply_sample = ("unknown" if value.get("mode") == "unexpected" else
                                served[0] if value.get("mode") == "duplicate" and len(served) > 1 else sample)
                await outgoing.send({"sample": reply_sample, "celsius": selected["celsius"]})
            return {"outcome": "done", "output": {"served": served}}
        samples = list(map(name, samples))
        if len(set(samples)) != len(samples) or not number(value["threshold"]):
            raise TypeError("unique sample IDs and threshold required")
        observations = []
        lower, upper = 0, len(samples)
        crossing = None
        while lower < upper:
            if len(observations) == 8:
                raise RuntimeError("query budget exhausted")
            index = (lower + upper) // 2
            sample = samples[index]
            await outgoing.send({"sample": sample})
            response = await anext(iterator, None)
            if response is None:
                raise RuntimeError("reply stream ended with an outstanding request")
            item = reading(response)
            if item["sample"] != sample or any(old["sample"] == item["sample"] for old in observations):
                raise RuntimeError("unexpected or duplicate reply")
            observations.append(item)
            if item["celsius"] >= value["threshold"]:
                crossing = {**item, "index": index}
                upper = index
            else:
                lower = index + 1
        await outgoing.close()
        if await anext(iterator, None) is not None:
            raise RuntimeError("unsolicited trailing reply")
        return {"outcome": "done", "output": {
            "threshold": value["threshold"], "crossing": crossing, "observations": observations,
        }}
    finally:
        settled = await asyncio.gather(incoming.aclose(), outgoing.close(), return_exceptions=True)
        for result in settled:
            if isinstance(result, BaseException):
                raise result


handle(run)
