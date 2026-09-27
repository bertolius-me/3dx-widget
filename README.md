# Lids Product Widget

A minimal 3DEXPERIENCE UWA dashboard widget. Click **Load products** to find the exact `Lids` bookmark and show its Physical Products.

## Run in 3DEXPERIENCE

1. Host this folder at a URL reachable by your 3DEXPERIENCE dashboard. Use HTTPS on a cloud platform.
2. Add the hosted `index.html` URL as a custom widget in a trusted dashboard on the same platform that contains the bookmark.
3. In the widget menu, set **Security Context** to the required `Role.Organization.CollabSpace` value (for example, `VPLMProjectLeader.MyCompany.Default`).
4. Open the widget and click **Load products**.

The widget resolves the current platform's 3DSpace URL through `i3DXCompassServices` and makes authenticated requests with `WAFData`. It is not intended to run standalone in a browser because those dashboard APIs are not available there.

## API Calls

The widget uses the documented `/resources/v1/modeler/dsbks/dsbks:Bookmark/search` endpoint to find `Lids`, then `GET /resources/v1/modeler/dsbks/dsbks:Bookmark/{ID}` with `$mask=dsbks:BksMask.Items2` to read its items. Bookmark items are paginated 50 at a time; bookmark search is paginated 1000 at a time. Both calls send the required `SecurityContext` header. The platform-specific 3DSpace URL supplies the tenant context, so no `tenant` query parameter is sent.

The `Items2` response nests each item under `referencedObject`; the widget recognizes `VPMReference` as a Physical Product and uses its `relativePath` to fetch the Engineering Item with the `dsmveng:EngItemMask.Details` mask. It displays the returned name, title, revision, and description, with the identifier retained and used as a fallback if a detail lookup fails.

The widget needs an authenticated, trusted dashboard session and permission to read the `Lids` bookmark and its contents.