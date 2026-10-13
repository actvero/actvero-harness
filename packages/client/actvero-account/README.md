---
description: "ACTVERO desktop account settings, platform branding and member quota presentation through the native preload bridge."
kind: "package-reference"
---

# @actvero/dsh-client-account

English | [中文](README.zh.md)

## Summary

Use the ACTVERO platform account from the official desktop settings and sidebar. View each member quota window independently and change the platform address without editing the identity issuer. Local work remains available when signed out. This package displays Main-owned state and never receives login credentials.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The official Web bundle activates this private workspace plugin only when `ACTVERO_DESKTOP=1`. Its browser entry requires `window.actveroAccount` from an owned native preload. It has no configuration fields and supplies no standalone browser login. Start the supported [account development flow](../../../actvero/README.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

Cordis registrations own the account settings section, sidebar launcher and platform brand slots. The renderer binds a single native observable; components contain no Cordis context. Initial snapshots cannot replace newer pushed state, and disposal releases the bridge subscription. The account menu matches its sidebar trigger width and contains Settings, Personal center and Sign out. Settings keeps the identity card compact, combines the platform address and selected organization in one card, and owns point-window bars. Organization changes query the new scope automatically; remaining values already include platform reservations. Login and sign-out actions stay in the sidebar menu. ACTVERO supplies the blank-session welcome heading and running-status copy through native slots. Native components own typography, theme, timing and animation; unloading this package restores native copy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Account recovery](../../../actvero/account-recovery.md)
- [Official client slots](../../../docs/subsystems/slots.md)
- [Desktop shell](../../../apps/desktop/README.md)

-----

<a id="dev-note"></a>
## Dev Note

None.

-----

<a id="model-experience"></a>
## Model Experience

None, as the native account renderer displays identity, platform branding and quota windows without adding model prompts, Session events or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Account login does not grant model, MCP, Skill or expert access. Platform model execution, resource-token installation and release packaging are separate integrations.
- An offline cold start retains encrypted login but does not manufacture cached identity or quota. Failed usage queries retain only the last result from the same live account and organization.
- Missing, unsupported or broken platform logos use the shipped Actvero mark. Uploaded same-origin raster images are supported.
