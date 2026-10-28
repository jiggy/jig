import copy
import json
import unittest
from jiggy.reporting import (
    create_display_bundle, decode_display_bundle, encode_display_bundle, validate_display_bundle,
)


def view(instance='family', identity='photos'):
    return {'kind':'view','id':identity,'title':'Photos','summary':'An application-selected edition',
        'target':{'definitionId':'photos','instanceKey':instance,'subjectKey':instance},
        'sections':[{'blocks':[{'kind':'content','reference':{'kind':'artifact','attachment':'all','path':'contact-sheet.svg'}}]}]}


def bundle():
    return create_display_bundle({'generation':'epoch-1','heads':[]}, {
        'requestId':'publication-1','edition':'Family collection',
        'views':[{'view':view(),'completeness':'complete','domainRevision':'domain-7'}],
        'requiredEvidence':[{'kind':'artifact','attachment':'all','path':'contact-sheet.svg'}],
    })


class BundleTests(unittest.TestCase):
    def test_canonical_bundle_roundtrip_and_owned_values(self):
        value=bundle()
        encoded=encode_display_bundle(value)
        self.assertTrue(encoded.endswith('\n'))
        self.assertEqual(decode_display_bundle(encoded.encode()),value)
        parsed=json.loads(encoded)
        parsed['views'][0]['view']['title']='Changed'
        self.assertNotEqual(validate_display_bundle(parsed),value)
        self.assertEqual(value['views'][0]['expectedRevision'],None)

    def test_context_preserves_tombstone_conditions_without_author_tokens(self):
        context={'generation':'epoch-1','heads':[{'definitionId':'photos','instanceKey':'family','revision':'epoch-1:7','retained':False}]}
        result=create_display_bundle(context,{'requestId':'next','edition':'Next','views':[{'view':view(),'completeness':'partial'}]})
        self.assertEqual(result['views'][0]['expectedRevision'],'epoch-1:7')
        context['heads'][0]['revision']='changed'
        self.assertEqual(result['views'][0]['expectedRevision'],'epoch-1:7')
        with self.assertRaises(TypeError):create_display_bundle(context,{'requestId':'next','edition':'Next','views':[{'view':view(),'expectedRevision':None,'completeness':'complete'}]})

    def test_two_instances_of_one_definition_remain_distinct(self):
        value=create_display_bundle({'generation':'epoch-1','heads':[]},{'requestId':'albums','edition':'Two albums','views':[
            {'view':view('family','family-photos'),'completeness':'complete'},
            {'view':view('spring','spring-photos'),'completeness':'complete'},
        ]})
        self.assertEqual([item['view']['target']['instanceKey'] for item in value['views']],['family','spring'])
        self.assertEqual([item['view']['target']['definitionId'] for item in value['views']],['photos','photos'])

    def test_bundle_fields_targets_and_ids_are_closed_and_unique(self):
        for change in [
            lambda value:value.update(extra=True),
            lambda value:value.update(kind='run'),
            lambda value:value['views'][0].pop('expectedRevision'),
            lambda value:value['views'][0].update(completeness='unknown'),
            lambda value:value['views'].append(copy.deepcopy(value['views'][0])),
            lambda value:value['views'][0]['view'].pop('target'),
            lambda value:value['views'][0]['view']['target'].update(runId='forged'),
            lambda value:value.update(requiredEvidence=[{'kind':'artifact','attachment':'all','path':'../escape'}]),
        ]:
            value=bundle();change(value)
            with self.assertRaises(TypeError):validate_display_bundle(value)

    def test_invalid_utf8_unknown_values_and_oversized_capture_reject(self):
        for encoded in [b'\xff',b'[]',b'null',b'{}',b'{' ,b' '*(4*1024*1024+2)]:
            with self.assertRaises(TypeError):decode_display_bundle(encoded)
