"""Create an original offline book and its exact extracted render inputs."""

import struct
import sys
import zipfile
import zlib
from pathlib import Path
from random import Random


def png():
    width, height = 160, 240
    pixels = Random(24601).randbytes(width * height * 3)
    rows = b"".join(b"\0" + pixels[i : i + 3 * width] for i in range(0, len(pixels), 3 * width))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def page(title, body):
    return f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en"><head><title>{title}</title></head><body>{body}</body></html>'


source = Path(sys.argv[1])
source.mkdir()
entries = {
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml': '''<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>''',
    'EPUB/package.opf': '''<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="en">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:example:jig-epub-trial</dc:identifier>
    <dc:title>Clock Room</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
    <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest>
    <spine><itemref idref="chapter"/></spine></package>''',
    'EPUB/nav.xhtml': page('Contents', '<nav epub:type="toc"><h1>Contents</h1><ol><li><a href="chapter.xhtml">Clock Room</a></li></ol></nav>'),
    'EPUB/chapter.xhtml': page('Clock Room', '<h1>Clock Room</h1><p>A blue clock keeps time.</p><img src="cover.png" width="320" alt="Synthetic cover"/>'),
    'EPUB/cover.png': png(),
}
with zipfile.ZipFile(source / 'book.epub', 'w') as book:
    for name, value in entries.items():
        book.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), value)
with zipfile.ZipFile(source / 'book.epub') as book:
    for filename in ('chapter.xhtml', 'cover.png'):
        (source / filename).write_bytes(book.read('EPUB/' + filename))
