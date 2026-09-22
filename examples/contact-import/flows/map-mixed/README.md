# contact-import-map-mixed

Recognize exactly `Customer`, `Email address`, and `Company`, in any order, and
return their indices without an Agent call. Otherwise use one ordinary Agent
call to propose three distinct indices or a null mapping. Send headings only.

This leaf combines ordinary code with Agent work internally. Keep its public mapping contract identical to the code and
Agent variants. Preserve blocked and limited outcomes and propagate errors
without retry. Structural validity does not establish correct interpretation.
