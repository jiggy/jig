"""Portable, closed, bounded read-only view snapshots."""
from __future__ import annotations
import math
import re
from typing import Any, Literal, Required, TypedDict

class Reference(TypedDict, total=False):
    kind: Required[Literal['record', 'call', 'artifact']]
    viewId: str
    collectionId: str
    rowId: str
    operationId: str
    attachment: str
    path: str

class ViewOptions(TypedDict, total=False):
    title: Required[str]
    landing: Literal[True]
    operationId: str

class ViewSnapshot(TypedDict, total=False):
    title: str
    summary: Required[str]
    sections: Required[list[dict[str, Any]]]


def record(value: Any, fields: set[str] | None = None) -> dict[str, Any]:
    if type(value) is not dict or any(type(k) is not str or (fields is not None and k not in fields) for k in value):
        raise TypeError('Unknown or non-object user update fields')
    return value


def text(value: Any, maximum: int, single: bool = False, minimum: int = 1) -> str:
    if type(value) is not str or not minimum <= len(value) <= maximum:
        raise TypeError('User update text exceeds its length limit')
    try:
        value.encode('utf-8')
    except UnicodeEncodeError as error:
        raise TypeError('User update text must contain Unicode scalars') from error
    if single and any(c in value for c in '\r\n\u2028\u2029'):
        raise TypeError('User update text must fit one logical line')
    return value


def count(value: Any) -> int:
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 9007199254740991 or value != int(value):
        raise TypeError('User update count must be a safe nonnegative integer')
    return int(value)


def operation(value: Any) -> str:
    normalized = text(value, 128, True)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]*', normalized):
        raise TypeError('Invalid operation ID')
    return normalized


def array(value: Any, maximum: int, minimum: int = 0) -> list[Any]:
    if type(value) is not list or not minimum <= len(value) <= maximum:
        raise TypeError('User update array exceeds its limits')
    return value


def reference(value: Any) -> dict[str, Any]:
    r = record(value, {'kind','viewId','collectionId','rowId','operationId','attachment','path'})
    kind = r.get('kind')
    if kind == 'record':
        record(r, {'kind','viewId','collectionId','rowId'})
        return {'kind':kind, **{k:text(r.get(k),64,True) for k in ('viewId','collectionId','rowId')}}
    if kind == 'call':
        record(r, {'kind','operationId'})
        return {'kind':kind,'operationId':operation(r.get('operationId'))}
    if kind == 'artifact':
        record(r, {'kind','attachment','path'})
        attachment,path = text(r.get('attachment'),64,True),text(r.get('path'),512,True)
        parts=path.split('/')
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',attachment) or len(path.encode('utf-8'))>512 or len(parts)>16 or any(p in ('','.','..','.jig') for p in parts) or '\\' in path or any(ord(c)<32 or 127<=ord(c)<=159 for c in path):
            raise TypeError('Invalid output artifact reference')
        return {'kind':kind,'attachment':attachment,'path':path}
    raise TypeError('Unknown reference kind')


def cell(value: Any) -> Any:
    if value is None or type(value) is bool:
        return value
    if type(value) is str:
        return text(value,4096,minimum=0)
    if type(value) is int and abs(value)<=9007199254740991: return value
    if type(value) is float and math.isfinite(value) and (not value.is_integer() or abs(value)<=9007199254740991):
        return int(value) if value.is_integer() else value
    return reference(value)


def block(value: Any, budget: dict[str,Any], detail: bool = False) -> dict[str,Any]:
    budget['blocks']+=1
    if budget['blocks']>32:
        raise TypeError('View block limit exceeded')
    b=record(value,{'kind','text','references','items','label','completed','total','unit','id','title','columns','rows'})
    kind=b.get('kind')
    if kind=='report':
        record(b,{'kind','text','references'})
        return {'kind':kind,'text':text(b.get('text'),4096,minimum=0),**({'references':[reference(r) for r in array(b['references'],8)]} if 'references' in b else {})}
    if kind=='facts':
        record(b,{'kind','items'})
        items=[]
        for item in array(b.get('items'),32):
            f=record(item,{'label','value'})
            if 'value' not in f: raise TypeError('Missing fact value')
            items.append({'label':text(f.get('label'),128,True),'value':cell(f['value'])})
        return {'kind':kind,'items':items}
    if kind=='progress':
        record(b,{'kind','label','completed','total','unit'})
        p={'kind':kind,'label':text(b.get('label'),128,True),'completed':count(b.get('completed'))}
        if 'total' in b:
            p['total']=count(b['total'])
            if p['completed']>p['total']: raise TypeError('Completed count exceeds total')
        if 'unit' in b: p['unit']=text(b['unit'],32,True)
        return p
    if kind!='collection' or detail: raise TypeError('Unknown or nested collection block')
    record(b,{'kind','id','title','columns','rows','total'})
    id=text(b.get('id'),64,True)
    if id in budget['collections']: raise TypeError('Duplicate collection ID')
    budget['collections'].add(id)
    columns=[]
    keys=set()
    for item in array(b.get('columns'),8,1):
        c=record(item,{'key','label','type'})
        key=text(c.get('key'),64,True)
        if key in keys or c.get('type') not in ('text','number','boolean','reference'): raise TypeError('Invalid or duplicate column')
        keys.add(key)
        columns.append({'key':key,'label':text(c.get('label'),128,True),'type':c['type']})
    rows=[]
    ids=set()
    for item in array(b.get('rows'),128):
        r=record(item,{'id','cells','details'})
        row_id=text(r.get('id'),64,True)
        if row_id in ids: raise TypeError('Duplicate row ID')
        ids.add(row_id)
        budget['rows']+=1
        budget['cells']+=len(columns)
        if budget['rows']>128 or budget['cells']>1024: raise TypeError('View row or cell limit exceeded')
        values=record(r.get('cells'))
        if set(values)!=keys: raise TypeError('Row must contain exactly its column keys')
        cells={k:cell(v) for k,v in values.items()}
        for c in columns:
            v=cells[c['key']]
            matches={'text':type(v) is str,'number':type(v) in (int,float),'boolean':type(v) is bool,'reference':type(v) is dict}
            if v is not None and not matches[c['type']]: raise TypeError('Cell does not match column type')
        rows.append({'id':row_id,'cells':cells,**({'details':[block(d,budget,True) for d in array(r['details'],8)]} if 'details' in r else {})})
    result={'kind':kind,'id':id,'title':text(b.get('title'),128,True),'columns':columns,'rows':rows}
    if 'total' in b:
        result['total']=count(b['total'])
        if result['total']<len(rows): raise TypeError('Collection total is less than supplied rows')
    return result


def validate_view(value: Any) -> dict[str,Any]:
    v=record(value,{'kind','id','title','summary','landing','operationId','sections'})
    if v.get('kind')!='view' or ('landing' in v and v['landing'] is not True): raise TypeError('Invalid view kind or landing hint')
    result: dict[str, Any] = {'kind':'view','id':text(v.get('id'),64,True),'title':text(v.get('title'),128,True),'summary':text(v.get('summary'),1024)}
    if 'landing' in v: result['landing']=True
    if 'operationId' in v: result['operationId']=operation(v['operationId'])
    budget={'blocks':0,'rows':0,'cells':0,'collections':set()}
    sections=[]
    for item in array(v.get('sections'),8):
        s=record(item,{'title','blocks'})
        sections.append({**({'title':text(s['title'],128,True)} if 'title' in s else {}),'blocks':[block(b,budget) for b in array(s.get('blocks'),32)]})
    result['sections']=sections
    return result
