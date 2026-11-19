from pathlib import Path
import hashlib
import argparse
import json
parser=argparse.ArgumentParser(description='Generate pinned Unicode 15.1 NFC tables and conformance vectors')
parser.add_argument('data_directory',type=Path)
base=parser.parse_args().data_directory
expected={
 'UnicodeData.txt':'2fc713e6a31a87c4850a37fe2caffa4218180fadb5de86b43a143ddb4581fb86',
 'DerivedNormalizationProps.txt':'8875dccee2bc1a7c1fe568a3b502a9e78c9e0495afd96b6568b4294d0ed1f7e1',
 'NormalizationTest.txt':'871238e37e3be0696ec2bd0891119a041b052da1a84485eda05a5438724b223e',
}
for name,digest in expected.items():
 if hashlib.sha256((base/name).read_bytes()).hexdigest()!=digest: raise ValueError('Unicode source identity changed: '+name)
root=Path(__file__).resolve().parent.parent

ccc={}; decomp={}; excluded=set()
for line in (base/'UnicodeData.txt').read_text().splitlines():
 f=line.split(';'); cp=int(f[0],16)
 if int(f[3]): ccc[cp]=int(f[3])
 if f[5] and not f[5].startswith('<'): decomp[cp]=[int(v,16) for v in f[5].split()]
for line in (base/'DerivedNormalizationProps.txt').read_text().splitlines():
 fields=line.split('#')[0].strip().split(';')
 if len(fields)<2 or fields[1].strip()!='Full_Composition_Exclusion': continue
 bounds=fields[0].strip().split('..'); excluded.update(range(int(bounds[0],16),int(bounds[-1],16)+1))
composition={a*0x110000+b:cp for cp,parts in decomp.items() if len(parts)==2 and cp not in excluded for a,b in [parts]}
s='// Generated from Unicode 15.1.0 UnicodeData.txt and DerivedNormalizationProps.txt.\n// Unicode License v3; see THIRD_PARTY_NOTICES.\n'
for name in ['UnicodeData.txt','DerivedNormalizationProps.txt']:
 s+='// '+name+' SHA-256 '+hashlib.sha256((base/name).read_bytes()).hexdigest()+'\n'

def encode_table(table):
    rows = [json.dumps(row, separators=(',', ':')) for row in table.items()]
    return ',\n'.join(','.join(rows[i:i + 8]) for i in range(0, len(rows), 8))

s += """// Keep the data in strings so declaration workers compile fewer JS literals.
type NormalizationTables = {
  readonly classes: ReadonlyMap<number, number>
  readonly decompositions: ReadonlyMap<number, readonly number[]>
  readonly compositions: ReadonlyMap<number, number>
}

const Table = Map
const parse = JSON.parse
let tables: NormalizationTables | undefined

export function unicodeNormalizationTables15_1(): NormalizationTables {
  tables ??= {
"""
for name, table in [('classes', ccc), ('decompositions', decomp), ('compositions', composition)]:
    s += f'    {name}: new Table(\n      parse(`[\n{encode_table(table)}\n]`),\n    ),\n'
s += '  }\n  return tables\n}\n'
Path(root/'packages/jig/src/package/normalization-data-15.1.ts').write_text(s)
rows=[]
for line in (base/'NormalizationTest.txt').read_text().splitlines():
 line=line.split('#')[0].strip()
 if line and not line.startswith('@'): rows.append(';'.join(line.split(';')[:5]))
Path(root/'packages/jig/test/fixtures/normalization-15.1.txt').write_text('# Unicode 15.1.0 NormalizationTest.txt vectors; Unicode License v3.\n# Source SHA-256 871238e37e3be0696ec2bd0891119a041b052da1a84485eda05a5438724b223e\n'+'\n'.join(rows)+'\n')
print(len(rows),len(ccc),len(decomp),len(composition))
