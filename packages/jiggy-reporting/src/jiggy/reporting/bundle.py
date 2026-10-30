"""Pure finite display publication values. These helpers grant no host authority."""
from __future__ import annotations

import json
from typing import Any, Literal, Required, TypedDict

from .view import Reference, array, identity as display_identity, record, reference, target, text


class DisplayPublicationHead(TypedDict):
    definitionId: str
    instanceKey: str
    revision: str
    retained: bool


class DisplayPublicationContext(TypedDict):
    generation: str
    heads: list[DisplayPublicationHead]


class DisplayPublicationView(TypedDict, total=False):
    view: Required[dict[str, Any]]
    expectedRevision: Required[str | None]
    completeness: Required[Literal['complete', 'partial']]
    domainRevision: str


class DisplayBundle(TypedDict, total=False):
    kind: Required[Literal['display-bundle']]
    requestId: Required[str]
    generation: Required[str]
    edition: Required[str]
    views: Required[list[DisplayPublicationView]]
    requiredEvidence: list[Reference]


def validate_display_bundle(value: Any) -> DisplayBundle:
    """Validate and own one bounded, explicitly selected application edition."""
    from . import _canonical, validate_reporting_message
    value = record(value, {'kind', 'requestId', 'generation', 'edition', 'views', 'requiredEvidence'})
    if value.get('kind') != 'display-bundle':
        raise TypeError('Unknown display bundle kind')
    identities: set[str] = set()
    targets: set[tuple[str, str]] = set()
    landing = False
    views: list[DisplayPublicationView] = []
    for item in array(value.get('views'), 32, 1):
        entry = record(item, {'view', 'expectedRevision', 'completeness', 'domainRevision'})
        view = validate_reporting_message(entry.get('view'))
        if view['kind'] != 'view':
            raise TypeError('Publication material must be a semantic view')
        selected = target(view.get('target'))
        identity = (selected['definitionId'], selected['instanceKey'])
        if view['id'] in identities or identity in targets:
            raise TypeError('Publication view IDs and targets must be unique')
        identities.add(view['id'])
        targets.add(identity)
        if view.get('landing'):
            if landing:
                raise TypeError('Only one bundle view may nominate a landing hint')
            landing = True
        if 'expectedRevision' not in entry:
            raise TypeError('Expected revision is required')
        if entry.get('completeness') not in ('complete', 'partial'):
            raise TypeError('Publication completeness must be complete or partial')
        view['target'] = selected
        accepted: DisplayPublicationView = {
            'view': view,
            'expectedRevision': None if entry['expectedRevision'] is None else display_identity(entry['expectedRevision'], 128),
            'completeness': entry['completeness'],
        }
        if 'domainRevision' in entry:
            accepted['domainRevision'] = text(entry['domainRevision'], 128, True)
        views.append(accepted)
    result: DisplayBundle = {
        'kind': 'display-bundle',
        'requestId': display_identity(value.get('requestId'), 128),
        'generation': display_identity(value.get('generation'), 128),
        'edition': text(value.get('edition'), 128, True),
        'views': views,
    }
    if 'requiredEvidence' in value:
        result['requiredEvidence'] = [reference(item) for item in array(value['requiredEvidence'], 256)]
    if len(_canonical(result)) > 4 * 1024 * 1024:
        raise TypeError('Encoded display bundle exceeds its byte limit')
    return result


def create_display_bundle(context: DisplayPublicationContext, options: dict[str, Any]) -> DisplayBundle:
    """Derive target revision conditions from the host's opaque publication context."""
    context_value = record(context, {'generation', 'heads'})
    options = record(options, {'requestId', 'edition', 'views', 'requiredEvidence'})
    heads: dict[tuple[str, str], str] = {}
    for item in array(context_value.get('heads'), 4096):
        head = record(item, {'definitionId', 'instanceKey', 'revision', 'retained'})
        selected = target({'definitionId': head.get('definitionId'), 'instanceKey': head.get('instanceKey')})
        identity = (selected['definitionId'], selected['instanceKey'])
        if identity in heads or type(head.get('retained')) is not bool:
            raise TypeError('Publication context requires unique heads with retained state')
        heads[identity] = display_identity(head.get('revision'), 128)
    views = []
    for item in array(options.get('views'), 32, 1):
        entry = record(item, {'view', 'completeness', 'domainRevision'})
        supplied = record(entry.get('view'))
        selected = target(supplied.get('target'))
        views.append({
            **entry,
            'expectedRevision': heads.get((selected['definitionId'], selected['instanceKey'])),
        })
    return validate_display_bundle({
        'kind': 'display-bundle',
        'generation': display_identity(context_value.get('generation'), 128),
        'requestId': options.get('requestId'),
        'edition': options.get('edition'),
        'views': views,
        **({'requiredEvidence': options['requiredEvidence']} if 'requiredEvidence' in options else {}),
    })


def encode_display_bundle(value: DisplayBundle) -> str:
    """Return canonical JSON and one framing LF for an ordinary declared output."""
    from . import _canonical
    return _canonical(validate_display_bundle(value)).decode('utf-8') + '\n'


def decode_display_bundle(value: bytes) -> DisplayBundle:
    """Decode captured bytes without authenticating their producer or provenance."""
    if type(value) is not bytes or len(value) > 4 * 1024 * 1024 + 1:
        raise TypeError('Captured display bundle exceeds its byte limit')
    try:
        decoded = json.loads(value.decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as error:
        raise TypeError('Captured display bundle is not a UTF-8 JSON document') from error
    return validate_display_bundle(decoded)
