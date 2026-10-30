import asyncio
import copy
import unittest
from jiggy.reporting import Reporter, preview_collection, validate_reporting_message


def view():
    return {'kind':'view','id':'matters','title':'Matters','summary':'Review supplied work','sections':[{'blocks':[{'kind':'collection','id':'items','title':'Items','columns':[{'key':'name','label':'Name','type':'text'}],'rows':[{'id':'one','cells':{'name':'Matter'},'details':[{'kind':'report','text':''}]}]}]}]}


class Views(unittest.IsolatedAsyncioTestCase):
    def test_closed_snapshot_and_semantic_limits(self):
        original=view()
        snapshot=validate_reporting_message(original)
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
            with self.assertRaises(TypeError):validate_reporting_message(v)
        for path in ['/etc/file','a//b','a/.jig/x','a\\b','a/./b','../secret']:
            with self.assertRaises(TypeError):validate_reporting_message({'kind':'view','id':'x','title':'X','summary':'X','sections':[{'blocks':[{'kind':'report','text':'','references':[{'kind':'artifact','attachment':'out','path':path}]}]}]})

    async def test_unwired_handle_lifecycle(self):
        updates=Reporter(None)
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
    def test_shared_exact_item_boundary_and_json_zero(self):
        from jiggy.reporting import _canonical
        value = {'kind':'view','id':'numbers','title':'Numbers','summary':'Check canonical byte accounting','sections':[{'blocks':[
            {'kind':'collection','id':'records','title':'Records',
             'columns':[{'key':'text','label':'Text','type':'text'}],
             'rows':[{'id':str(index),'cells':{'text':'x'*4096}} for index in range(128)]},
        ]}]}
        rows = value['sections'][0]['blocks'][0]['rows']
        excess = len(_canonical(value)) - 524288
        for row in rows:
            removed = min(excess, len(row['cells']['text']))
            row['cells']['text'] = row['cells']['text'][removed:]
            excess -= removed
        self.assertEqual(excess, 0)
        self.assertEqual(len(_canonical(value)), 524288)
        validate_reporting_message(value)
        rows[0]['cells']['text'] += 'x'
        with self.assertRaises(TypeError): validate_reporting_message(value)
        for number in [1e20,-1e20,2**53,float('nan'),float('inf'),-float('inf')]:
            invalid = {'kind':'view','id':'x','title':'X','summary':'X','sections':[{'blocks':[{'kind':'facts','items':[{'label':'N','value':number}]}]}]}
            with self.assertRaises(TypeError):validate_reporting_message(invalid)
        self.assertEqual(_canonical([-0.0,1.0,1e-7,1e-6,1.2345e-6,5e-324]),b'[0,1,1e-7,0.000001,0.0000012345,5e-324]')

class MaterialViews(unittest.TestCase):
    def collection(self, size):
        return {'kind': 'collection', 'id': 'images', 'title': 'Photos',
            'columns': [{'key': 'name', 'label': 'Name', 'type': 'text'}, {'key': 'image', 'label': 'Image', 'type': 'reference'}],
            'presentation': {'kind': 'gallery', 'media': 'image', 'title': 'name', 'alt': 'name'},
            'rows': [{'id': str(index), 'cells': {'name': 'Photo '+str(index), 'image': {'kind': 'input-artifact', 'attachment': 'photos', 'path': str(index)+'.jpg'}},
                'details': [{'kind':'report','text':'A caption','format':'plain'}, {'kind':'facts','items':[{'label':'Index','value':index}]}]} for index in range(size)]}

    def snapshot(self, collection):
        return {'kind':'view','id':'photos','title':'Photos','summary':'Browse supplied originals',
            'target':{'definitionId':'photos','instanceKey':'family','subjectKey':'family'},
            'sections':[{'blocks':[collection]}]}

    def test_thousand_gallery_rows_own_details_and_input_references(self):
        original = self.snapshot(self.collection(1000))
        accepted = validate_reporting_message(original)
        rows = accepted['sections'][0]['blocks'][0]['rows']
        self.assertEqual(len(rows),1000)
        self.assertEqual(len(rows[999]['details']),2)
        original['target']['instanceKey'] = 'mutated'
        original['sections'][0]['blocks'][0]['rows'][0]['cells']['name']='Changed'
        self.assertEqual(rows[0]['cells']['name'],'Photo 0')
        self.assertEqual(accepted['target']['instanceKey'],'family')
        invalid = self.collection(1)
        invalid['rows'][0]['cells']['image']={'kind':'call','operationId':'not-an-image'}
        with self.assertRaises(TypeError): validate_reporting_message(self.snapshot(invalid))

    def test_content_and_literal_formats_preserve_their_meaning(self):
        value = self.snapshot(self.collection(0))
        value['sections'][0]['blocks'] = [
            {'kind':'report','text':'  + added\n  - removed\n','format':'diff'},
            {'kind':'content','title':'Original image','reference':{'kind':'input-artifact','attachment':'photos','path':'original.png'}},
        ]
        self.assertEqual(validate_reporting_message(value)['sections'][0]['blocks'],value['sections'][0]['blocks'])
        for change in [
            lambda item:item.update(format='html'),
            lambda item:item.update(extra=True),
        ]:
            invalid=copy.deepcopy(value); change(invalid['sections'][0]['blocks'][0])
            with self.assertRaises(TypeError):validate_reporting_message(invalid)
        invalid=copy.deepcopy(value)
        invalid['sections'][0]['blocks'][1]['reference']={'kind':'call','operationId':'work'}
        with self.assertRaises(TypeError):validate_reporting_message(invalid)

    def test_collection_preview_keeps_whole_rows_and_discloses_totals(self):
        original=self.collection(2000); original['total']=3000
        complete={'kind':'artifact','attachment':'all','path':'photos.json'}
        preview=preview_collection(original,limit=15,complete=complete)
        self.assertEqual((preview['shown'],preview['total'],preview['omitted']),(15,3000,2985))
        self.assertEqual(preview['complete'],complete)
        self.assertEqual(preview['collection']['total'],3000)
        self.assertEqual(preview['collection']['rows'][14],original['rows'][14])
        self.assertEqual(len(original['rows']),2000)
        validate_reporting_message(self.snapshot(preview['collection']))

    def test_collection_preview_uses_byte_budget_without_clipping_values(self):
        original=self.collection(1000)
        for row in original['rows']:row['cells']['name']='x'*4096
        preview=preview_collection(original)
        self.assertGreater(preview['shown'],0)
        self.assertLess(preview['shown'],1000)
        self.assertEqual(len(preview['collection']['rows'][0]['cells']['name']),4096)
        validate_reporting_message(self.snapshot(preview['collection']))
