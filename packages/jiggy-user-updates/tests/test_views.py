import asyncio
import copy
import unittest
from jiggy.user_updates import UserUpdates, validate_user_update


def view():
    return {'kind':'view','id':'matters','title':'Matters','summary':'Review supplied work','sections':[{'blocks':[{'kind':'collection','id':'items','title':'Items','columns':[{'key':'name','label':'Name','type':'text'}],'rows':[{'id':'one','cells':{'name':'Matter'},'details':[{'kind':'report','text':''}]}]}]}]}


class Views(unittest.IsolatedAsyncioTestCase):
    def test_closed_snapshot_and_semantic_limits(self):
        original=view()
        snapshot=validate_user_update(original)
        original['sections'][0]['blocks'][0]['rows'][0]['cells']['name']='Changed'
        self.assertIn('Matter',str(snapshot))
        for transform in [
            lambda v:v.update(id='a\nb'),
            lambda v:v.update(landing=False),
            lambda v:v['sections'][0]['blocks'][0].update(total=0),
            lambda v:v['sections'][0]['blocks'][0]['rows'][0]['cells'].update(extra=True),
            lambda v:v['sections'][0]['blocks'][0]['rows'][0]['cells'].update(name=True),
            lambda v:v['sections'][0]['blocks'][0]['rows'].append(v['sections'][0]['blocks'][0]['rows'][0]),
            lambda v:v['sections'].append(v['sections'][0]),
            lambda v:v.update(sections=[{'blocks':[{'kind':'report','text':''}]*33}]),
        ]:
            v=view();transform(v)
            with self.assertRaises(TypeError):validate_user_update(v)
        for path in ['/etc/file','a//b','a/.jig/x','a\\b','a/./b','../secret']:
            with self.assertRaises(TypeError):validate_user_update({'kind':'view','id':'x','title':'X','summary':'X','sections':[{'blocks':[{'kind':'report','text':'','references':[{'kind':'artifact','attachment':'out','path':path}]}]}]})

    async def test_unwired_handle_lifecycle(self):
        updates=UserUpdates(None)
        handle=updates.view('jobs',{'title':'Jobs'})
        handle.update({'summary':'Valid','sections':[]})
        with self.assertRaises(TypeError):handle.update({'summary':'','sections':[]})
        handle.retire();handle.retire()
        with self.assertRaises(RuntimeError):handle.update({'summary':'Late','sections':[]})
        with self.assertRaises(RuntimeError):updates.view('jobs',{'title':'Reused'})
        await updates._finish()
        handle.retire()
        with self.assertRaises(RuntimeError):updates.view('new',{'title':'Late'})

class NumericBoundary(unittest.TestCase):
    def test_shared_exact_32_kib_boundary_and_json_zero(self):
        from jiggy.user_updates import _canonical
        value = {'kind':'view','id':'numbers','title':'Numbers','summary':'Check canonical byte accounting','sections':[{'blocks':[
            {'kind':'facts','items':[{'label':'N'+str(i),'value':1e-7} for i in range(32)]},
            *[{'kind':'report','text':'x'*(4096 if i<7 else 2809)} for i in range(8)],
        ]}]}
        self.assertEqual(len(_canonical(value)),32768)
        validate_user_update(value)
        value['sections'][0]['blocks'][8]['text'] += 'x'
        with self.assertRaises(TypeError):validate_user_update(value)
        for number in [1e20,-1e20,2**53,float('nan'),float('inf'),-float('inf')]:
            invalid = {'kind':'view','id':'x','title':'X','summary':'X','sections':[{'blocks':[{'kind':'facts','items':[{'label':'N','value':number}]}]}]}
            with self.assertRaises(TypeError):validate_user_update(invalid)
        self.assertEqual(_canonical([-0.0,1.0,1e-7,1e-6,1.2345e-6,5e-324]),b'[0,1,1e-7,0.000001,0.0000012345,5e-324]')
