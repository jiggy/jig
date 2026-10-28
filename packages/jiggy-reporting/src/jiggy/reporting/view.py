"""Portable, closed, bounded read-only view snapshots."""
from __future__ import annotations

import math
import re
from typing import Any, Literal, Required, TypedDict


class Reference(TypedDict, total=False):
    kind: Required[Literal['record', 'call', 'artifact', 'input-artifact']]
    viewId: str
    collectionId: str
    rowId: str
    operationId: str
    attachment: str
    path: str


class ViewTarget(TypedDict, total=False):
    definitionId: Required[str]
    instanceKey: Required[str]
    subjectKey: str


class ViewOptions(TypedDict, total=False):
    title: Required[str]
    landing: Literal[True]
    operationId: str
    target: ViewTarget


class ViewSnapshot(TypedDict, total=False):
    title: str
    summary: Required[str]
    sections: Required[list[dict[str, Any]]]


def record(value: Any, fields: set[str] | None = None) -> dict[str, Any]:
    if type(value) is not dict or any(
        type(key) is not str or (fields is not None and key not in fields) for key in value
    ):
        raise TypeError('Unknown or non-object reporting message fields')
    return value


def text(value: Any, maximum: int, single: bool = False, minimum: int = 1) -> str:
    if type(value) is not str or not minimum <= len(value) <= maximum:
        raise TypeError('Reporting message text exceeds its length limit')
    try:
        value.encode('utf-8')
    except UnicodeEncodeError as error:
        raise TypeError('Reporting message text must contain Unicode scalars') from error
    if single and any(char in value for char in '\r\n\u2028\u2029'):
        raise TypeError('Reporting message text must fit one logical line')
    return value


def count(value: Any) -> int:
    if (type(value) not in (int, float) or not math.isfinite(value)
            or not 0 <= value <= 9007199254740991 or value != int(value)):
        raise TypeError('Reporting message count must be a safe nonnegative integer')
    return int(value)


def operation(value: Any) -> str:
    normalized = text(value, 128, True)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]*', normalized):
        raise TypeError('Invalid operation ID')
    return normalized


def array(value: Any, maximum: int, minimum: int = 0) -> list[Any]:
    if type(value) is not list or not minimum <= len(value) <= maximum:
        raise TypeError('Reporting message array exceeds its limits')
    return value


def target(value: Any) -> dict[str, str]:
    value = record(value, {'definitionId', 'instanceKey', 'subjectKey'})
    return {
        'definitionId': text(value.get('definitionId'), 64, True),
        'instanceKey': text(value.get('instanceKey'), 64, True),
        **({'subjectKey': text(value['subjectKey'], 64, True)} if 'subjectKey' in value else {}),
    }


def reference(value: Any) -> dict[str, Any]:
    value = record(value, {'kind', 'viewId', 'collectionId', 'rowId', 'operationId', 'attachment', 'path'})
    kind = value.get('kind')
    if kind == 'record':
        record(value, {'kind', 'viewId', 'collectionId', 'rowId'})
        return {'kind': kind, **{
            key: text(value.get(key), 64, True) for key in ('viewId', 'collectionId', 'rowId')
        }}
    if kind == 'call':
        record(value, {'kind', 'operationId'})
        return {'kind': kind, 'operationId': operation(value.get('operationId'))}
    if kind in ('artifact', 'input-artifact'):
        record(value, {'kind', 'attachment', 'path'})
        attachment = text(value.get('attachment'), 64, True)
        path = text(value.get('path'), 512, True)
        parts = path.split('/')
        if (not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', attachment)
                or len(path.encode('utf-8')) > 512 or len(parts) > 16
                or any(part in ('', '.', '..', '.jig') for part in parts)
                or '\\' in path or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in path)):
            raise TypeError('Invalid artifact reference')
        return {'kind': kind, 'attachment': attachment, 'path': path}
    raise TypeError('Unknown reference kind')


def cell(value: Any) -> Any:
    if value is None or type(value) is bool:
        return value
    if type(value) is str:
        return text(value, 4096, minimum=0)
    if type(value) is int and abs(value) <= 9007199254740991:
        return value
    if type(value) is float and math.isfinite(value) and (
        not value.is_integer() or abs(value) <= 9007199254740991
    ):
        return int(value) if value.is_integer() else value
    return reference(value)


def presentation(value: Any, columns: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, str]:
    value = record(value, {'kind', 'media', 'title', 'alt', 'description'})
    if value.get('kind') == 'table':
        record(value, {'kind'})
        return {'kind': 'table'}
    if value.get('kind') != 'gallery':
        raise TypeError('Unknown collection presentation')
    types = {column['key']: column['type'] for column in columns}
    media = text(value.get('media'), 64, True)
    if types.get(media) != 'reference':
        raise TypeError('Gallery media requires a reference column')
    result = {'kind': 'gallery', 'media': media}
    for name in ('title', 'alt', 'description'):
        if name in value:
            key = text(value[name], 64, True)
            if types.get(key) != 'text':
                raise TypeError('Gallery text roles require text columns')
            result[name] = key
    for row in rows:
        item = row['cells'][media]
        if item is not None and item['kind'] not in ('artifact', 'input-artifact'):
            raise TypeError('Gallery media requires an artifact reference')
    return result


def block(value: Any, budget: dict[str, Any], detail: bool = False) -> dict[str, Any]:
    key = 'detailBlocks' if detail else 'blocks'
    budget[key] += 1
    if budget[key] > (8192 if detail else 32):
        raise TypeError('View block limit exceeded')
    value = record(value, {
        'kind', 'text', 'format', 'reference', 'references', 'items', 'label', 'completed',
        'total', 'unit', 'id', 'title', 'columns', 'rows', 'presentation',
    })
    kind = value.get('kind')
    if kind == 'report':
        record(value, {'kind', 'text', 'references', 'format'})
        result = {'kind': kind, 'text': text(value.get('text'), 4096, minimum=0)}
        if 'format' in value:
            if value['format'] not in ('plain', 'code', 'diff'):
                raise TypeError('Unknown report format')
            result['format'] = value['format']
        if 'references' in value:
            result['references'] = [reference(item) for item in array(value['references'], 8)]
        return result
    if kind == 'content':
        record(value, {'kind', 'reference', 'title'})
        item = reference(value.get('reference'))
        if item['kind'] not in ('artifact', 'input-artifact'):
            raise TypeError('Content requires an artifact reference')
        return {'kind': kind, 'reference': item, **(
            {'title': text(value['title'], 128, True)} if 'title' in value else {}
        )}
    if kind == 'facts':
        record(value, {'kind', 'items'})
        items = []
        for item in array(value.get('items'), 32):
            fact = record(item, {'label', 'value'})
            if 'value' not in fact:
                raise TypeError('Missing fact value')
            items.append({'label': text(fact.get('label'), 128, True), 'value': cell(fact['value'])})
        return {'kind': kind, 'items': items}
    if kind == 'progress':
        record(value, {'kind', 'label', 'completed', 'total', 'unit'})
        result = {'kind': kind, 'label': text(value.get('label'), 128, True), 'completed': count(value.get('completed'))}
        if 'total' in value:
            result['total'] = count(value['total'])
            if result['completed'] > result['total']:
                raise TypeError('Completed count exceeds total')
        if 'unit' in value:
            result['unit'] = text(value['unit'], 32, True)
        return result
    if kind != 'collection' or detail:
        raise TypeError('Unknown or nested collection block')
    record(value, {'kind', 'id', 'title', 'columns', 'rows', 'total', 'presentation'})
    identity = text(value.get('id'), 64, True)
    if identity in budget['collections']:
        raise TypeError('Duplicate collection ID')
    budget['collections'].add(identity)
    columns, keys = [], set()
    for item in array(value.get('columns'), 8, 1):
        column = record(item, {'key', 'label', 'type'})
        key = text(column.get('key'), 64, True)
        if key in keys or column.get('type') not in ('text', 'number', 'boolean', 'reference'):
            raise TypeError('Invalid or duplicate column')
        keys.add(key)
        columns.append({'key': key, 'label': text(column.get('label'), 128, True), 'type': column['type']})
    rows, identities = [], set()
    for item in array(value.get('rows'), 1024):
        row = record(item, {'id', 'cells', 'details'})
        row_id = text(row.get('id'), 64, True)
        if row_id in identities:
            raise TypeError('Duplicate row ID')
        identities.add(row_id)
        budget['rows'] += 1
        budget['cells'] += len(columns)
        if budget['rows'] > 1024 or budget['cells'] > 8192:
            raise TypeError('View row or cell limit exceeded')
        values = record(row.get('cells'))
        if set(values) != keys:
            raise TypeError('Row must contain exactly its column keys')
        cells = {key: cell(item) for key, item in values.items()}
        for column in columns:
            item = cells[column['key']]
            matches = {
                'text': type(item) is str,
                'number': type(item) in (int, float),
                'boolean': type(item) is bool,
                'reference': type(item) is dict,
            }
            if item is not None and not matches[column['type']]:
                raise TypeError('Cell does not match column type')
        rows.append({'id': row_id, 'cells': cells, **(
            {'details': [block(item, budget, True) for item in array(row['details'], 8)]}
            if 'details' in row else {}
        )})
    result = {'kind': kind, 'id': identity, 'title': text(value.get('title'), 128, True), 'columns': columns, 'rows': rows}
    if 'total' in value:
        result['total'] = count(value['total'])
        if result['total'] < len(rows):
            raise TypeError('Collection total is less than supplied rows')
    if 'presentation' in value:
        result['presentation'] = presentation(value['presentation'], columns, rows)
    return result


def validate_view(value: Any) -> dict[str, Any]:
    value = record(value, {'kind', 'id', 'title', 'summary', 'landing', 'operationId', 'sections', 'target'})
    if value.get('kind') != 'view' or ('landing' in value and value['landing'] is not True):
        raise TypeError('Invalid view kind or landing hint')
    result: dict[str, Any] = {
        'kind': 'view', 'id': text(value.get('id'), 64, True),
        'title': text(value.get('title'), 128, True), 'summary': text(value.get('summary'), 1024),
    }
    if 'landing' in value:
        result['landing'] = True
    if 'operationId' in value:
        result['operationId'] = operation(value['operationId'])
    if 'target' in value:
        result['target'] = target(value['target'])
    budget = {'blocks': 0, 'detailBlocks': 0, 'rows': 0, 'cells': 0, 'collections': set()}
    sections = []
    for item in array(value.get('sections'), 32):
        section = record(item, {'title', 'blocks'})
        sections.append({
            **({'title': text(section['title'], 128, True)} if 'title' in section else {}),
            'blocks': [block(item, budget) for item in array(section.get('blocks'), 32)],
        })
    result['sections'] = sections
    return result
