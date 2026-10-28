import asyncio
import json
import os
import pathlib
import sys
import time
import unittest

from jiggy.reporting import REPORTING_CONTRACT


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
                    "delivery": "direct", "contract": dict(REPORTING_CONTRACT)}},
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


    async def observe_publication(self, mode):
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(pathlib.Path(__file__).with_name('wire_fixture.py')),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=dict(os.environ), limit=1024*1024,
        )
        async def send(value):
            process.stdin.write((json.dumps(value)+'\n').encode())
            await process.stdin.drain()
        messages, observed, acknowledged, pending = [], -1, -1, None
        async def confirm():
            nonlocal acknowledged, pending
            if pending is not None and observed > acknowledged:
                acknowledged = observed
                await send({'jsonrpc':'2.0','id':pending,'result':{
                    'item':{'sequence':observed+1,'value':{'kind':'notice','text':str(observed)}}}})
                pending = None
        channels = {'updates':{'endpoint':'updates:1','direction':'send','delivery':'direct','contract':dict(REPORTING_CONTRACT)}}
        if mode == 'traffic':
            channels['confirm']={'endpoint':'confirm:1','direction':'receive','delivery':'direct','startSequence':1,'contract':dict(REPORTING_CONTRACT)}
        try:
            await send({'jsonrpc':'2.0','id':'host:1','method':'flow/run','params':{
                'protocol':'run/0','input':{'mode':mode},'settings':{},'attachments':{},
                'scratch':'/unused-reporting-scratch','deadlineUnixMs':int(time.time()*1000)+12000,'channels':channels,
            }})
            while True:
                line = await asyncio.wait_for(process.stdout.readline(),15)
                self.assertTrue(line,'Public SDK exited before final result')
                frame = json.loads(line)
                if frame.get('method') == 'channel/send':
                    value = frame['params']['value']; messages.append(value)
                    await send({'jsonrpc':'2.0','id':frame['id'],'result':None})
                    if mode == 'traffic' and value['kind'] == 'view':
                        observed = int(value['summary']); await confirm()
                elif frame.get('method') == 'channel/next':
                    self.assertIsNone(pending)
                    pending = frame['id']; await confirm()
                elif frame.get('method') == 'channel/release':
                    await send({'jsonrpc':'2.0','id':frame['id'],'result':{'status':'released'}})
                elif frame.get('method') == 'channel/close':
                    await send({'jsonrpc':'2.0','id':frame['id'],'result':None})
                elif frame.get('id') == 'host:1':
                    self.assertEqual(frame.get('result',{}).get('outcome'),'checked',frame)
                    process.stdin.close()
                    self.assertEqual(await asyncio.wait_for(process.wait(),5),0)
                    return messages
                else:
                    self.fail('Unexpected protocol frame: '+str(frame))
        finally:
            if process.returncode is None:
                process.kill(); await process.wait()

    async def test_rotating_view_snapshots_coalesce_within_each_epoch(self):
        messages=await self.observe_publication('coalesce')
        self.assertEqual([item['kind'] for item in messages],['view','view','view','notice','view','retire-view'])
        self.assertEqual([item['summary'] for item in messages[:3]],['999']*3)
        self.assertEqual(messages[4]['summary'],'After boundary')

    async def test_public_sdk_publishes_beyond_previous_source_traffic_limit(self):
        messages=await self.observe_publication('traffic')
        self.assertEqual(len(messages),11)
        self.assertGreater(sum(len(json.dumps(item,separators=(',',':')).encode()) for item in messages),4*1024*1024)
        self.assertEqual(messages[-1]['summary'],'10')
