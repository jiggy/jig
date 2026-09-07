import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location("pypi_release", Path(__file__).with_name("pypi-release.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.files = {"flowmd_sdk-0.1.0a1-py3-none-any.whl": b"wheel", "flowmd_sdk-0.1.0a1.tar.gz": b"source"}
        self.receipt = dict(package="flowmd-sdk", version="0.1.0a1", commit="abc", candidate=True,
                            files={name: hashlib.sha256(data).hexdigest() for name, data in self.files.items()})

    def download(self, names):
        def get(url):
            if url.endswith('/json'):
                return json.dumps(dict(info=dict(name="flowmd-sdk", version="0.1.0a1"), urls=[
                    dict(filename=n, digests=dict(sha256=self.receipt['files'][n]),
                         url='https://files.pythonhosted.org/'+n) for n in names])).encode()
            return self.files[url.rsplit('/',1)[1]]
        return get

    def test_new_version_and_non_404_failure(self):
        for code in [404, 403, 500]:
            def get(url): raise urllib.error.HTTPError(url,code,'error',{},None)
            if code==404: self.assertEqual(module.missing(self.receipt,get),sorted(self.files))
            else:
                with self.assertRaises(urllib.error.HTTPError): module.missing(self.receipt,get)

    def test_partial_retry_uploads_only_missing_and_complete_retry_uploads_nothing(self):
        wheel=next(iter(self.files))
        self.assertEqual(module.missing(self.receipt,self.download([wheel])),["flowmd_sdk-0.1.0a1.tar.gz"])
        self.assertEqual(module.missing(self.receipt,self.download(self.files)),[])

    def test_changed_registry_bytes_fail_even_with_matching_metadata(self):
        get=self.download(self.files)
        def corrupt(url): return get(url) if url.endswith('/json') else b'changed'
        with self.assertRaisesRegex(ValueError,'downloaded registry'): module.missing(self.receipt,corrupt)

    def test_conflicting_metadata_fails_before_download(self):
        get=self.download(self.files)
        def corrupt(url):
            data=json.loads(get(url));data['urls'][0]['digests']['sha256']='bad';return json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError,'immutable'): module.missing(self.receipt,corrupt)

    def test_candidate_tampering_revision_and_inventory(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            for n,b in self.files.items(): (directory/n).write_bytes(b)
            (directory/'SUCCESS.json').write_text(json.dumps(self.receipt))
            self.assertEqual(module.candidate(directory,'abc'),self.receipt)
            with self.assertRaises(ValueError): module.candidate(directory,'other')
            (directory/'extra').touch()
            with self.assertRaises(ValueError): module.candidate(directory,'abc')
            (directory/'extra').unlink();(directory/next(iter(self.files))).write_bytes(b'changed')
            with self.assertRaises(ValueError): module.candidate(directory,'abc')

    def test_prepare_stages_only_missing_and_verify_waits_for_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=root/'candidate';directory.mkdir()
            for name,data in self.files.items(): (directory/name).write_bytes(data)
            (directory/'SUCCESS.json').write_text(json.dumps(self.receipt))
            missing_name='flowmd_sdk-0.1.0a1.tar.gz'
            args=['release','prepare',str(directory),'abc','--output',str(root/'pending'),'--github-output',str(root/'outputs')]
            with patch('sys.argv',args), patch.object(module,'missing',return_value=[missing_name]): module.main()
            self.assertEqual([p.name for p in (root/'pending').iterdir()],[missing_name])
            self.assertIn('pending=true', (root/'outputs').read_text())
            self.assertIn('new_version=false', (root/'outputs').read_text())
            with patch('sys.argv',['release','verify',str(directory),'abc']), patch.object(module,'missing',side_effect=[[missing_name],[]]), patch.object(module.time,'sleep') as delay:
                module.main();delay.assert_called_once_with(5)

    def test_verify_never_accepts_registry_absence(self):
        with patch('sys.argv',['release','verify','.','abc']), patch.object(module,'candidate',return_value=self.receipt), patch.object(module,'missing',return_value=list(self.files)), patch.object(module.time,'sleep'):
            with self.assertRaises(module.RegistryPending): module.main()

if __name__=='__main__': unittest.main()
