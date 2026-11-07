---
kind: upgrade-guide
description: "Client plugins constructing LayoutController or implementing ILayout must supply responsive sidebar expansion."
---

# Supply sidebar expansion in custom layouts

English | [中文](guide.zh.md)

## Change

`LayoutController` requires a fourth constructor argument, `sidebarExpanded: HostObservable<boolean>`; `ILayout` adds that observable and `setSidebarExpanded(expanded)`. Plugins constructing controllers, providing their own `ctx.layout`, or maintaining complete interface fakes must update. Workbench authors consuming the host layout service need no changes.

## Migration

1. Update the layout provider to pass an observable from the same root layout as the fourth constructor argument. It must reflect actual expansion in the current viewport, including the narrow expansion override; do not replace real state with a fixed boolean.
2. Custom `ILayout` implementations supply both `sidebarExpanded` and `setSidebarExpanded(expanded)`; matching states do not toggle, and existing width and narrow-window rules remain intact. Test fakes supply state appropriate to their scenario.
3. Verify repeated matching requests do not toggle, reported state matches wide and narrow layouts, and leaving a workbench restores the preceding navigation expansion. See the [layout API](../../../../packages/client/ui-layout/README.md#understand-the-implementation).
