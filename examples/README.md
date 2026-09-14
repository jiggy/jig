# Build software with code and Agents

Start with the shared method boundary, then use it to delegate useful work
inside an application. Each example introduces one primary idea; adapt it
without treating it as a complete production solution. These examples use the ordinary public FLOW SDK and Jig
interfaces. Choose an Agent on your host; the applications do not choose a
provider or carry credentials.

| Start here | What you get | What you learn |
| --- | --- | --- |
| [Request triage](request-triage/) | A suggested support queue | One caller composes with code, an Agent, or both through the same contract. |
| [Support case](support-case/) | A disputed-charge decision and reply | Code checks an Agent's proposal against account facts and application policy. |
| [Contact import](contact-import/) | A contact preview from an unfamiliar CSV | Compose code and Agent mapping through one boundary, then validate rows in code. |
| [Tested patch](tested-patch/) | A patch with executed checks and evidence | A reusable repair method combines Agent proposals with independent acceptance. |

Complete [workspace setup](../docs/jig/guide/dependencies.md#local-workspace-packages)
and follow the selected example's README on a
[supported host](../docs/jig/guide/index.md#supported-host).
The [documentation](../docs/jig/guide/overview.md) explains installation,
Agent configuration, results, and integration.

Fixtures are synthetic. The examples teach authored procedures and their
boundaries; successful runs do not establish general model accuracy.
