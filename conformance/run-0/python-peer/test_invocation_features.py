"""Independent exact digest evidence for bounded invocation catalog fixtures.

This is not a Python package inspector or a general RFC 8785 implementation.
Structural catalog rejection is covered by the public machine-schema tests;
Jig's parser separately checks JSON/0, descriptor closure and qualification.
"""

import hashlib
import json
from pathlib import Path
import unittest


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures/invocation-features.json"


def canonical_fixture(value):
    # These fixtures have ASCII object keys, strings, booleans and objects.
    # Consequently sorted stdlib JSON with literal Unicode is JCS-equivalent;
    # no number serialization or UTF-16 key ordering inference is involved.
    if isinstance(value, dict):
        if not all(isinstance(key, str) and key.isascii() for key in value):
            raise ValueError("digest fixture keys must be ASCII")
        for item in value.values():
            canonical_fixture(item)
    elif not isinstance(value, (str, bool)):
        raise ValueError("digest fixture contains an unsupported JSON kind")
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode("utf-8")


class InvocationFeatureIdentityTests(unittest.TestCase):
    def test_exact_catalog_digests_match_shared_vectors(self):
        fixtures = json.loads(FIXTURE.read_text(encoding="utf-8"))["valid"]
        observed = set()
        for fixture in fixtures:
            with self.subTest(name=fixture["name"]):
                wrapper = {"descriptor": fixture["descriptor"], "channelContracts": {}}
                digest = "sha256:" + hashlib.sha256(
                    b"FLOW-Invocation-Contract/0\0" + canonical_fixture(wrapper)
                ).hexdigest()
                self.assertEqual(digest, fixture["digest"])
                observed.add(digest)
        self.assertEqual(len(observed), len(fixtures),
                         "omission, empty catalog and changed descriptions have distinct identities")

    def test_vector_encoder_does_not_claim_general_canonicalization(self):
        for value in ({"non-ascii-🔎": "value"}, {"number": 1.2}, {"array": []}):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    canonical_fixture(value)


if __name__ == "__main__":
    unittest.main()
