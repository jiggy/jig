# contact-import-map-code

Recognize exactly the three headings `Customer`, `Email address`, and `Company`,
in any order. Return their zero-based indices as `mapping.name`, `mapping.email`,
and `mapping.organization`. Otherwise return `mapping: null`. No Agent is called.
The caller can replace this method while retaining the same input/result contract.
