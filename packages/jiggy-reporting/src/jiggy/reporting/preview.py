"""Explicit, bounded collection previews which preserve complete row values."""
from __future__ import annotations

from typing import Any
from .view import array, count, record, reference


def preview_collection(
    value: dict[str, Any], *, limit: int = 1024, complete: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Select whole rows and disclose every record outside the returned subset."""
    from . import _canonical, validate_reporting_message
    value = record(value, {'kind', 'id', 'title', 'columns', 'rows', 'total', 'presentation'})
    rows = array(value.get('rows'), 9007199254740991)
    if type(limit) is not int or not 0 <= limit <= 1024:
        raise TypeError('Collection preview limit must be an integer from zero to 1024')
    total = count(value['total']) if 'total' in value else len(rows)
    if total < len(rows):
        raise TypeError('Collection total is less than supplied rows')
    supplied = reference(complete) if complete is not None else None
    if supplied is not None and supplied['kind'] not in ('artifact', 'input-artifact'):
        raise TypeError('Complete collection reference must name an artifact')
    # Reserve room for ordinary surrounding view identity and summary fields.
    columns = array(value.get('columns'), 8, 1)
    def selected(count_: int) -> dict[str, Any]:
        candidate = {**value, 'rows': rows[:count_], 'total': total}
        wrapper = {'kind': 'view', 'id': 'preview', 'title': 'Preview', 'summary': 'Collection preview', 'sections': [{'blocks': [candidate]}]}
        return record(validate_reporting_message(wrapper)['sections'][0]['blocks'][0])
    selected(0)
    low, high = 0, min(len(rows), limit, 1024, 8192 // len(columns))
    while low < high:
        middle = (low + high + 1) // 2
        try:
            accepted = selected(middle)
            fits = len(_canonical(accepted)) <= 524288 - 8192
        except TypeError as error:
            # Invalid selected data remains an error, rather than hidden clipping.
            if 'Encoded reporting message' not in str(error):
                raise
            fits = False
        if fits:
            low = middle
        else:
            high = middle - 1
    collection = selected(low)
    return {
        'collection': collection, 'shown': low, 'total': total,
        'omitted': total - low, **({'complete': supplied} if supplied is not None else {}),
    }
