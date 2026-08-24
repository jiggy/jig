from __future__ import annotations

import math
import unittest

from flowmd_sdk._json import Json1Error, encode_json1, parse_json1


class Json1Tests(unittest.TestCase):
    def test_normalizes_binary64_integral_values(self) -> None:
        self.assertEqual(parse_json1(b"[1,1.0,-0,1e0]"), [1, 1, 0, 1])

    def test_rejects_duplicate_members(self) -> None:
        with self.assertRaises(Json1Error):
            parse_json1(b'{"value":1,"value":2}')

    def test_rejects_unsafe_integral_result(self) -> None:
        with self.assertRaises(Json1Error):
            parse_json1(b"9007199254740993")

    def test_rejects_lone_surrogate(self) -> None:
        with self.assertRaises(Json1Error):
            parse_json1(b'"\\ud800"')

    def test_rejects_non_finite_python_number(self) -> None:
        with self.assertRaises(Json1Error):
            encode_json1({"value": math.inf})

    def test_encodes_utf8_without_ascii_escaping(self) -> None:
        self.assertEqual(encode_json1({"value": "caf\N{LATIN SMALL LETTER E WITH ACUTE}"}), b'{"value":"caf\xc3\xa9"}')


if __name__ == "__main__":
    unittest.main()
