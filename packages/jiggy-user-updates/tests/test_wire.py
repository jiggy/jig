import asyncio
import json
import os
import pathlib
import sys
import time
import unittest

from jiggy.user_updates import USER_UPDATES_CONTRACT


class WireTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_sdk_retains_failure_after_abnormal_close_ack(self):
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(pathlib.Path(__file__).with_name("wire_fixture.py")),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=dict(os.environ),
        )
        async def send(value):
            process.stdin.write((json.dumps(value) + "\n").encode())
            await process.stdin.drain()
        async def read():
            return json.loads(await asyncio.wait_for(process.stdout.readline(), 5))
        try:
            await send({"jsonrpc": "2.0", "id": "host:1", "method": "flow/run", "params": {
                "protocol": "run/0", "input": {}, "settings": {}, "attachments": {},
                "scratch": "/tmp/run", "deadlineUnixMs": int(time.time() * 1000) + 10000,
                "channels": {"updates": {"endpoint": "updates:1", "direction": "send",
                    "delivery": "direct", "contract": dict(USER_UPDATES_CONTRACT)}},
            }})
            original = await read()
            self.assertEqual(original["method"], "channel/send")
            closing = await read()
            self.assertEqual(closing["method"], "channel/close")
            self.assertEqual(closing["params"]["error"], "LAGGED")
            await send({"jsonrpc": "2.0", "id": closing["id"], "result": None})
            # Wait without cancelling the original SDK operation or stdout read.
            pending = asyncio.create_task(read())
            await asyncio.sleep(0.05)
            self.assertFalse(pending.done())
            await send({"jsonrpc": "2.0", "id": original["id"], "error": {
                "code": -32000, "message": "RESOURCE_EXHAUSTED", "data": {"code": "RESOURCE_EXHAUSTED"}}})
            final = await pending
            self.assertEqual(final["result"], {"outcome": "publisher-failed", "output": "RESOURCE_EXHAUSTED"})
            process.stdin.close()
            self.assertEqual(await asyncio.wait_for(process.wait(), 5), 0)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
