# Misc Product Widget

A minimal 3DEXPERIENCE UWA dashboard widget. Click **Load products** to find the exact `Misc` bookmark and show its Physical Products.

## Run in 3DEXPERIENCE

1. Host this folder at a URL reachable by your 3DEXPERIENCE dashboard. Use HTTPS on a cloud platform.
2. Add the hosted `index.html` URL as a custom widget in a trusted dashboard on the same platform that contains the bookmark.
3. In the widget menu, set **Security Context** to the required `Role.Organization.CollabSpace` value (for example, `VPLMProjectLeader.MyCompany.Default`).
4. Open the widget and click **Load products**. Once products are loaded, click **Export PDF** to download a separately formatted product register.

The widget resolves the current platform's 3DSpace URL through `i3DXCompassServices` and makes authenticated requests with `WAFData`. It is not intended to run standalone in a browser because those dashboard APIs are not available there.

## API Calls

The widget uses the documented `/resources/v1/modeler/dsbks/dsbks:Bookmark/search` endpoint to find `Misc`, then `GET /resources/v1/modeler/dsbks/dsbks:Bookmark/{ID}` with `$mask=dsbks:BksMask.Items2` to read its items. Bookmark items are paginated 50 at a time; bookmark search is paginated 1000 at a time. Both calls send the required `SecurityContext` header. The platform-specific 3DSpace URL supplies the tenant context, so no `tenant` query parameter is sent.

The `Items2` response nests each item under `referencedObject`; the widget recognizes `VPMReference` as a Physical Product and uses its `relativePath` to fetch the Engineering Item with the `dsmveng:EngItemMask.Details` mask. It displays the returned name, title, revision, and description, with the identifier retained and used as a fallback if a detail lookup fails.

The widget needs an authenticated, trusted dashboard session and permission to read the `Misc` bookmark and its contents.

## PDF Export

PDF export is generated in the browser from the loaded product data using locally bundled jsPDF 4.2.1 and jsPDF-AutoTable 5.0.8. The PDF uses a landscape table with product metadata, wrapped descriptions, a repeated report heading, and page numbers. No third-party CDN or server-side PDF service is required. The RequireJS loader points to the published GitHub Pages asset base (`https://bertolius-me.github.io/3dx-widget/`) so 3DEXPERIENCE's `/api/widget/` proxy path is not used for the vendor files. Update that base URL in `index.html` if the widget is hosted elsewhere. The corresponding MIT license texts are included in `scripts/vendor`.