# Workbench host extension architecture plan

English | [中文](workbench-architecture-plan.zh.md)

This document is for engineers implementing the workbench framework, SDK, developer tools, and expert integration. It defines the next architecture, delivery stages, and acceptance criteria; workbench authors can use it to understand planned capabilities. Status: proposed, not a statement that these APIs are available. Current development, packaging, and installation remain governed by the [workbench development guide](workbench-development.md); existing local capabilities are described in the [workbench runtime implementation plan](workbench-runtime-plan.md).

## 1. Product model and responsibilities

A workbench remains the product unit users install, open, and manage, implemented as a host-managed plugin bundle. One bundle can contain business UI, Host services, host UI extensions, and optional expert resources, with installation, enablement, updates, and removal handled by the existing Plugin Manager. Users do not need separate workbench and companion-plugin installations; developers do not need to build another AI client.

The host provides a stable runtime, native AI and conversations, public identity and controlled platform requests, resource and data directories, and explicit UI extension APIs. Workbench authors choose their business UI, navigation, data formats, object organization, and AI interaction mechanisms, including expert instructions, Skills, MCP, CLI, or business tools. AI is optional.

Using the plugin mechanism does not make arbitrary host modification a supported product API. Supported extensions use registries and managed lifecycles; manipulating private host DOM, replacing internal components, or modifying the Agent loop is outside the workbench SDK. Native Host/Client plugin code has the permissions of its runtime process. Cordis scopes release resources; they are not a security sandbox for untrusted code.

## 2. Current baseline and main gaps

The following baseline comes from the current implementation and existing documentation, not from runtime acceptance checks repeated for this proposal.

| Area | Existing foundation | Next-stage change |
| --- | --- | --- |
| Package management | Local validation and Plugin Manager installation, enablement, and removal | Manage bundled contributions, dependencies, and compatibility through one lifecycle |
| Business runtime | Host providers, Client registration, independent directories, and an optional JSON adapter | Define the scopes of workbenches, business objects, views, and conversations |
| AI | Native conversations, session bindings, expert instructions, and Skill/MCP/CLI loading paths | Provide authors with one entry point and recoverable preparation states |
| Layout | Full-page workbenches, AI floating panels, workbench previews, and display preferences | Add header extensions while preserving consistent host controls |
| Input and settings | Native DSH reference serialization, input extensions, and settings slots | Adapt these native capabilities into the workbench SDK instead of rebuilding the composer |
| Developer delivery | plain/ai templates, development and frontend Skills, validation, and packaging | Add extension declarations, loading checks, and cross-session acceptance |

Key current implementations are the [Host provider](../packages/actvero/capability-ui/src/workbench-provider.ts), [runtime](../packages/actvero/capability-ui/src/workbench-runtime.ts), [Client registration](../packages/actvero/capability-ui/src/client/workbenches/register.ts), and [package management](../packages/actvero/capability-ui/src/client/workbenches/management.ts). Native input capabilities are defined by the [reference interfaces](../packages/client/ui-conversation/src/client/contract/input.ts) and [reference service](../packages/client/ui-reference/src/client/index.ts). The next stage should reuse these foundations and progressively replace workbench-specific temporary wiring.

## 3. Runtime layers

| Layer | Responsibilities | Outside its responsibility |
| --- | --- | --- |
| Bundle protocol and SDK | Types, capability declarations, version requirements, Host/Client entries, and extension registration | Specific business pages and database structures |
| Host runtime | Environment preparation, session bindings, expert and tool scopes, directories, and controlled services | Frontend layout and business workflows |
| Client host | Workbench views, headers, floating panels, native conversations, input references, and settings entries | Direct access to author-managed business databases |
| Package management | Validation, installation records, enablement, upgrades, rollback, and removal state | Business data migrations and platform publication review |
| Expert adapter | Instruction and dependency resolution, session activation, and tool execution context | Requiring one particular AI interaction mechanism |
| Workbench implementation | Business UI, objects and storage, operations, and optional experts and dependencies | Duplicating the host account, chat, and installation systems |

These are responsibility divisions first, not a requirement to create six new packages immediately. Each shared capability must define its service interface, provider, and consumer; split packages only when publishing, dependencies, or lifecycles need independent evolution. Continue using Cordis registration and disposal, and launch runtimes through supported `dsh` profiles rather than adding workbench-specific host launch paths.

## 4. Declarations within one bundle

Keep the existing local installation entry point and `.tgz` delivery format. Future remote distribution should download the same bundle and use the same installation flow. This stage adds neither a separate ZIP runtime format nor a GitHub repository requirement for local workbenches.

Bundle declarations fall into the following groups. Exact fields will be decided during protocol implementation; the names below are not callable APIs.

| Declaration | Requirement |
| --- | --- |
| Identity and compatibility | Stable workbench identifier, name, icon, version, bundle protocol version, and host API requirements |
| Entries and resources | Host/Client entries, business view, static resources, previews, and localization resources |
| Host extensions | Header, commands, settings, input references, message or tool-result presentation, and their scopes |
| AI | Native AI enablement, bundled expert location, and explicitly declared Skill/MCP/CLI and business-tool dependencies |
| Platform capabilities | Controlled platform services and permissions used, without account credentials |
| Configuration and data | Configuration documentation, resource directory needs, and data compatibility and migration notes |

A workbench without AI declarations can use its business UI directly; an AI dependency failure should not remove unrelated business UI. Missing mandatory business dependencies must report specific causes and stop affected functions instead of pretending loading succeeded. Installation validation covers entries, resources, declaration consistency, and version compatibility. Runtime acceptance must also load the actual modules; a valid archive does not establish successful loading.

## 5. Host extension capabilities

### Header and business view

The host preserves return-to-management, sidebar, window, and unified AI controls. To the right of the divider it exposes areas for workbench identity, breadcrumbs, status, and actions: for example, “Collaborative Whiteboard / My Drawings / Product Flow,” with save status, import, and export on the right. Plugins can update this content for the current page, avoiding another duplicate title row inside the business view.

The Client manages header layout, window drag regions, focus, narrow-window overflow, and shared host controls; workbenches provide content and commands. Standard buttons, menus, and breadcrumbs should use native components. Complex requirements may register custom components in designated regions, without covering window controls or removing the exit from the workbench.

Authors retain freedom over the main business view, including canvases, tables, reports, and ordinary pages. Full-page and preview modes share business objects and data; switching presentation does not create another data instance. Plugins can provide an appropriate preview presentation; the default should not turn a large UI into unusable nested scrolling.

### Native composer and context references

The SDK adapts native DSH reference sources, serialization, history rendering, and reference opening. A whiteboard selection, video segment, or document passage can appear as a composer reference that users inspect, remove, and send. Workbenches do not need to replace the composer or ask users to copy internal identifiers.

References bind to a workbench, business object, and version information. Authors provide serializable descriptions, necessary content snapshots, and optional reopening behavior; the host handles drafts, attachments, sending, and logs. Automatically including a selection must be explicitly enabled by the workbench and visible in the composer. Removing it must not cause rendering to add it back immediately. A reference supplies context, not file, model, or business-write authorization.

Extensions that supplement send context must use a controlled submission-preparation stage, record the source, and produce a final message snapshot. They must not silently rewrite user input after sending or change the target business object in the background.

### Settings, commands, and message presentation

A workbench can register its own host settings panel and open that panel from its business UI. Installation and enablement settings are workbench-scoped; settings for a drawing or project are business-object-scoped and stored by the author. Namespacing, permissions, and cleanup rules must distinguish those scopes.

Commands can appear in the header or supported command surfaces. Custom message and tool-result renderers reuse native extension points and provide default read-only rendering so history remains readable after disablement or removal. Ordinary conversations can also use host tools to list, open, and inspect workbenches. Opening a view does not automatically send a message or perform a business operation.

### AI entry point

With AI enabled, the host provides a native floating panel, a collapsed brand icon, full-page conversation mode, and associated-conversation switching. A workbench can request AI through the SDK with its current business context, without duplicating a generic “Use AI” button. Specific business actions such as “Explain selection” may remain, but must distinguish preparing a draft from immediately performing a user-requested operation.

## 6. Workbenches, business objects, and conversations

A bundle, runtime environment, business object, and conversation are separate concepts. The default host runtime instance provides directories and services; it does not restrict a workbench to one drawing or project. Authors manage these objects in their own storage. The host persists only stable object identifiers, display information, and restoration information needed for associations, without creating a universal business-project database.

| Scenario | Expected behavior |
| --- | --- |
| Ordinary new conversation | Does not inherit the previous workbench or its expert environment by default |
| New conversation within a workbench | Explicitly binds to the current workbench and business object and prepares the declared expert environment |
| Opening an associated conversation | Restores its saved business object rather than using another window's current selection |
| Multiple conversations for one object | May share business data while retaining independent history and execution context |
| Switching drawings or projects | Updates the view; running conversations and tools continue targeting their original object |
| Collapsing AI or the workbench preview | Changes presentation only, without unbinding or cancelling active work |

Layout preferences and business bindings are persisted separately. The host remembers floating-panel positions, expansion state, and sidebar preferences; author defaults apply only when no user preference exists. Deleting a business object leaves associated history readable with an unavailable-object indication, rather than silently creating a replacement with the same name.

## 7. Expert environment and one submission

When opening AI, the runtime prepares directories and the current business object, creates or restores an explicitly associated conversation, and resolves the bundled expert and dependencies. A hidden expert means users need not select it separately, not that permissions, runtime state, or the sources of model-visible content are hidden. Users can still inspect the capabilities enabled by that workbench.

A submission follows this sequence:

1. Read the workbench binding, business object, and retained reference items from the current draft.
2. Freeze object identifiers, versions, and selection, then serialize references with cancellation support; later navigation does not change this submission's target.
3. Check that the session's expert and tools are prepared and validate access against current permissions.
4. Persist the final user message, references, and model-visible context through native persistence before starting the model request.
5. Tools obtain the business object and runtime directories from this execution context and use author-provided MCP, CLI, or business services to operate on data.
6. Business data notifications update views; results distinguish success, failure, and unknown outcomes rather than treating navigation as execution confirmation.

Failed or cancelled asynchronous preparation preserves input and references and reports a specific, retryable cause. Authors define conflict detection and recovery when object versions affect writes. The host supplies fixed targets and error propagation, not database merge policy. Historical model input must be reconstructable from session records rather than reconstructed from a live UI or changed in-memory selection.

Expert environments activate per session, and tool bindings must not depend on a global “currently open workbench.” Bundled dependencies are explicit; arbitrary directories are not scanned for automatic loading. Preparation must be observable, cancellable, and avoid redundant loading of the same version. When updated environments apply to existing sessions must be explicit, with no implementation switch during a running turn.

## 8. Lifecycle and failure handling

| Scope | Typical contributions | Disposal point |
| --- | --- | --- |
| Installation record | Bundle identity, version, resource location, and enablement state | Bundle removal, with separate business-data retention rules |
| Enabled workbench | Settings, declared global commands, and Host services | Disablement, upgrade replacement, or removal |
| Active view | Main view, header, selection state, and UI subscriptions | View closure or rebinding |
| Associated session | Expert environment, tools, and session services | Unbinding, session disposal, or dependency replacement |
| Current turn | Fixed target, reference snapshot, requests, and cancellation signal | Turn completion, failure, or cancellation |

Every registration returns a disposer and participates in Cordis effects. Duplicate contribution identifiers fail explicitly. Partial activation failures undo already registered contributions instead of leaving half a menu or tool set. View errors are contained by the workbench view with recovery controls; service errors are reported by their owning services. Component error containment does not guarantee recovery from crashes of the plugin's process.

Disablement, removal, and upgrades first identify active calls, then apply an explicit wait or cancellation flow and confirm disposal before switching versions. An unconfirmed execution outcome must be reported as unknown; completed installation is not the same as applied runtime state. The initial implementation should use one understandable rule rather than mixing two versions inside a turn for hot updates.

View state is independent across windows; authors handle concurrency on shared business data. Late asynchronous results may update only their own view, session, and object, not a subsequently opened workbench. Removal preserves readable conversations and reference snapshots, with unavailable business navigation indicated explicitly.

## 9. Storage, identity, and permissions

The host continues to provide stable business-data directories, read-only bundle resources, and disposable cache directories. Business data must not live in version-replaced package directories. Authors can use JSON, SQLite, ordinary files, or remote services and own migrations, backups, locks, and conflicts. The existing JSON adapter remains available for lightweight storage.

The host manages only runtime information: installation and version records, configuration, capability grants, session-to-object associations, layout preferences, and native session logs. Updates and removal preserve business data by default; deleting business data is a separate, explicitly scoped and confirmed operation. Code rollback cannot automatically promise data rollback.

Identity APIs expose public information such as the current user, organization, and login state. Platform requests use controlled host capabilities. Existing model-catalog support can be reused; generation, billing, and other platform APIs require separate definitions. Long-lived tokens must not enter workbench frontends, expert prompts, or tool output. Expired remote login affects the relevant platform functions while local business functionality and offline data remain usable.

Capability declarations support installation explanations, runtime checks, and service authorization; they must not be marketed as strong isolation of arbitrary plugin code. Full Host/Client extensions are trusted plugins. Supporting untrusted code later requires a separate process or sandbox design and communication protocol, not a claim that permission fields alone provide isolation.

## 10. Compatibility and migration

Existing workbench registration, native conversation integration, and JSON providers can continue through adapters while migrating to the unified SDK. New protocols resolve requirements in one explicit version-resolution step instead of silently guessing legacy fields at each call site. Existing data directories and workbench identities remain stable so conversations continue targeting the same data after migration.

Implement host extension APIs first, migrate reference workbenches and developer templates next, and remove superseded special-purpose implementations last. Authors must not be required to manipulate private DOM to fill SDK gaps. Unsupported capabilities should produce clear validation or activation errors.

New durable associations or model-visible context follow repository persistence-type acknowledgements and Session format rules; externally perceptible breaking changes receive upgrade guides. Archive validity, successful builds, installation, loading, and real business acceptance are recorded separately and cannot stand in for one another.

## 11. Delivery stages and acceptance

| Stage | Deliverables | Requirement for the next stage |
| --- | --- | --- |
| One: protocol and lifecycle | Bundle declarations, service responsibilities, scopes, version resolution, and existing implementation adapters | One existing workbench runs through unified registration, with correct duplicate rejection and partial-failure disposal |
| Two: host UI extensions | Header, breadcrumbs, commands, settings, native input references, and history rendering adapters | Workbenches extend these areas without host source edits and leave no contributions after disposal |
| Three: business objects and AI | Object restoration, associated sessions, submission preparation, expert dependencies, and tool context | Ordinary conversations do not inherit bindings; multiple objects, windows, and asynchronous sends do not mix targets |
| Four: installation and version lifecycle | Validation, enablement, upgrades, rollback, removal, and active-call handling | Failed updates recover, runtime status is accurate, and business data and history survive |
| Five: developer delivery | SDK, scaffolding, examples, development Skill, optional visual guidance, and checking commands | A new directory supports initialization, development, validation, packaging, installation, and loading acceptance |
| Six: generality acceptance | Independent development validation with the collaborative whiteboard and another non-canvas workbench | Both workbench types use no private patches and complete their agreed business flows |

Stages two and three share input-reference design, which should be reviewed together at the protocol stage. Implementation can follow dependencies, but completing one component does not complete the architecture. Each stage covers normal operation, disablement/removal, cancellation, failure, and recovery; model-input changes add replayable session snapshots. macOS, Windows, real-account, and offline evidence and unverified items are recorded separately.

Keep the existing create, doctor, typecheck, build, check, pack, and bind toolchain, adding host compatibility, dependency, resource, actual loading, and disposal checks. The development Skill documents entry-point selection, directories, extension registration, data ownership, AI lifecycles, and acceptance. A separate frontend Skill supplies optional visual standards, defaults to native DSH semantics and components, and allows personalized business views.

Use the reference whiteboard to validate drawing management, editor headers, selection references, associated conversations, and data restoration. Use a non-canvas scenario to validate settings, commands, and custom storage so the framework is not tailored only to whiteboards. Generated designs and static screenshots are visual references, not evidence of a running plugin.

## 12. Scope of this stage

This stage completes standardized local workbench execution and host extensions, not platform submission review, remote-market operation, cross-device synchronization, or a unified business database. Preserve a future remote catalog's ability to download the same workbench bundles without making those later capabilities prerequisites for local development, installation, and use.
