# Build software with code and Agents

Start with the shared method boundary, then use it to delegate useful work
inside an application. Each example introduces one primary idea; adapt it
without treating it as a complete production solution. These examples use the ordinary public FLOW SDK and Jig
interfaces. Choose an Agent on your host; the applications do not choose a
provider or carry credentials.

Foundational examples keep the demonstrated methods inside the project.
Composition examples may use independently maintained FLOW packages through
ordinary versioned dependencies, while keeping application wiring, checks and
operator grants visible locally. Each example must be understandable and usable
on its own, without another example or sibling checkout.

| Start here | What you get | What you learn |
| --- | --- | --- |
| [Request triage](request-triage/) | A suggested support queue | One caller composes with code, an Agent, or both through the same contract. |
| [Support case](support-case/) | A disputed-charge decision and reply | Code checks an Agent's proposal against account facts and application policy. |
| [Contact import](contact-import/) | A contact preview from an unfamiliar CSV | Compose code and Agent mapping through one boundary, then validate rows in code. |
| [Tested patch](tested-patch/) | A patch with executed checks and evidence | A reusable repair method combines Agent proposals with independent acceptance. |
| [Small software factory](software-factory/) | Separate patch packets for a fixed issue set | Select bounded repair methods explicitly or with optional semantic judgment, retain evidence, and keep a human merge gate. |
| [Incident brief](incident-brief/) | A draft incorporating preliminary review, plus separate questions | A channel update triggers one settled drafting handoff while the reviewer continues. |

Complete [workspace setup](../docs/jig/guide/dependencies.md#local-workspace-packages)
and follow the selected example's README on a
[supported host](../docs/jig/guide/index.md#supported-host).
The [documentation](../docs/jig/guide/overview.md) explains installation,
Agent configuration, results, and integration.

Each application publishes optional, display-neutral dashboards through the standard
[user-updates contract](../docs/jig/contracts/user-updates.md). Add `--display
tui` for terminal inspection or `--display web` for a private local browser
display, using the invocation arguments in its README. The host supplies actual calls
and blocking causes; application views explain the requested work and its evidence.

| Application | Domain views |
| --- | --- |
| Request triage | Request and suggested queue |
| Support case | Case decision and supplied Charges |
| Contact import | Mapping, Contacts and Rejected rows |
| Tested patch | Repair, Checks and Evidence |
| Software factory | Jobs, Checks and Patches; standalone repair and Selection |
| Incident brief | Work, Brief and Review questions |

Select delivered file references to read content. Completed inspection remains open
until explicit exit. Reopen a saved packet with `jig inspect --result DIRECTORY
--display web` or `--display tui`; saved packets contain recorded results, files
and diagnostics, rather than retained live views. Dashboards are observations, never
authority to issue a credit, import records, publish a brief or apply a patch.

Fixtures are synthetic. The examples teach authored procedures and their
boundaries; successful runs do not establish general model accuracy.
