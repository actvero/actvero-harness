# Installed and platform skills

English | [中文](README.zh.md)

## Runtime

Manages platform catalog access, exact-version installation, update checks, enablement and local ZIP/folder/Markdown import. Download digest and package paths are verified before adoption. Active installations and immutable version records are scoped to platform, account and organization; existing expert locks load their recorded version.

Enable through the ACTVERO desktop composition (`ACTVERO_DESKTOP=1`). The owning Electron Main runtime provides the resource authority; client scripts do not discover sibling repositories or store bearer tokens.

Expert ZIP import stages each embedded single skill through the same package validator; exact installed content is reused. Export verifies the original file digests and never embeds a platform skill copy. Archive helpers remain Main-only and do not execute imported content.

The Local skills tab also reads the native Session catalog from project `.agents/skills` and `.dsh/skills`, global `~/.agents/skills`, `$DSH_HOME/skills`, configured roots and embedded providers. It shows directory paths and opens the original `SKILL.md` in the native file preview. These entries need no import and are not copied, uploaded or uninstalled by this manager. Installation controls still apply only to managed packages. Exact expert pins take precedence over a same-name discovered skill; unrelated directory skills remain available. Root discovery and precedence belong to [skill-filesystem](../../skill/skill-filesystem/README.md).

## Model Experience

### Exact skill loading

#### What the model sees

The native skill service publishes authorized enabled skill summaries and returns the verified `SKILL.md` instructions and resource directory for the selected version. The client manager does not add its search, category or installation UI to model context.

#### Token effect

The native skill consumer owns catalog and loaded-instruction token costs; downloading or installing a package does not create a model request. Exact expert versions supply their own verified content rather than the current installation.

#### KV Cache effect

Catalog or instruction changes can change the native consumer request content. A pinned expert keeps its recorded version while authorization is rechecked; manager refresh alone changes no prefix.

## Known Limitations and Deferred Work

- Platform content loading checks current grants, including archived versions; offline installed-state visibility does not authorize execution. Disabling or uninstalling blocks that installation, and server revocation does not delete its files. Archived packages may remain for prior locks. Local imports are device-local.
