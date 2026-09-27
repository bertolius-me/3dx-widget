(function () {
    "use strict";

    var BOOKMARK_NAME = "Lids";
    var SEARCH_PAGE_SIZE = 1000;
    var ITEMS_PAGE_SIZE = 50;
    var BOOKMARK_SEARCH_PATH = "/resources/v1/modeler/dsbks/dsbks:Bookmark/search";
    var BOOKMARK_PATH = "/resources/v1/modeler/dsbks/dsbks:Bookmark";

    function requestJson(WAFData, url, securityContext) {
        return new Promise(function (resolve, reject) {
            WAFData.authenticatedRequest(url, {
                method: "GET",
                type: "json",
                headers: {
                    Accept: "application/json",
                    SecurityContext: securityContext
                },
                onComplete: resolve,
                onFailure: reject,
                onPassportError: reject,
                onTimeout: function () {
                    reject(new Error("The request timed out."));
                }
            });
        });
    }

    function getMembers(response) {
        if (Array.isArray(response)) {
            return response;
        }
        if (!response || typeof response !== "object") {
            return [];
        }
        if (Array.isArray(response.member)) {
            return response.member;
        }
        if (Array.isArray(response.items)) {
            return response.items;
        }
        if (Array.isArray(response.results)) {
            return response.results;
        }
        return getMembers(response.data);
    }

    function getTotal(response) {
        if (!response || typeof response !== "object") {
            return null;
        }
        if (typeof response.totalItems === "number") {
            return response.totalItems;
        }
        return response.data ? getTotal(response.data) : null;
    }

    function makeUrl(serviceUrl, path, params) {
        var query = new URLSearchParams(params);
        return serviceUrl.replace(/\/$/, "") + path + "?" + query.toString();
    }

    async function getAllPages(WAFData, serviceUrl, path, securityContext, pageSize, extraParams) {
        var allMembers = [];
        var skip = 0;

        while (true) {
            var params = Object.assign({}, extraParams, {
                "$skip": String(skip),
                "$top": String(pageSize)
            });
            var response = await requestJson(WAFData, makeUrl(serviceUrl, path, params), securityContext);
            var members = getMembers(response);

            allMembers = allMembers.concat(members);
            skip += members.length;

            var total = getTotal(response);
            if (members.length < pageSize || (total !== null && skip >= total)) {
                return allMembers;
            }
        }
    }

    function getBookmarkItemPage(response, bookmarkId) {
        var bookmarks = getMembers(response);
        var bookmark = bookmarks.find(function (candidate) {
            return candidate.id === bookmarkId;
        }) || bookmarks[0];
        var items = bookmark && bookmark.items;

        if (Array.isArray(items)) {
            items = items[0];
        }

        return {
            members: getMembers(items),
            total: getTotal(items)
        };
    }

    async function getBookmarkItems(WAFData, serviceUrl, bookmarkId, securityContext) {
        var path = BOOKMARK_PATH + "/" + encodeURIComponent(bookmarkId);
        var allItems = [];
        var skip = 0;

        while (true) {
            var params = {
                "$mask": "dsbks:BksMask.Items2",
                "$skip": String(skip),
                "$top": String(ITEMS_PAGE_SIZE)
            };
            var response = await requestJson(WAFData, makeUrl(serviceUrl, path, params), securityContext);
            var page = getBookmarkItemPage(response, bookmarkId);

            allItems = allItems.concat(page.members);
            skip += page.members.length;

            if (page.members.length < ITEMS_PAGE_SIZE || (page.total !== null && skip >= page.total)) {
                return allItems;
            }
        }
    }

    function isPhysicalProduct(item) {
        var referencedObject = item && item.referencedObject ? item.referencedObject : item;
        var typeNames = [referencedObject && referencedObject.type, item && item.type];
        return typeNames.some(function (typeName) {
            var normalized = String(typeName || "").toLowerCase().replace(/[_-]/g, " ").trim();
            return normalized === "physical product" || normalized === "vpmreference";
        });
    }

    function normalizeProduct(item) {
        var referencedObject = item.referencedObject || item;
        return {
            id: referencedObject.identifier || referencedObject.id || item.identifier || item.id || "",
            name: referencedObject.title || referencedObject.name || item.title || item.name || "",
            type: referencedObject.type || item.type || "Physical Product",
            revision: referencedObject.revision || item.revision || ""
        };
    }

    function getDisplayName(item) {
        return item.name || item.title || item.label || item.physicalid || item.id || "Unnamed Physical Product";
    }

    function renderProducts(products) {
        var list = document.getElementById("products");
        list.replaceChildren();

        products.forEach(function (product) {
            var row = document.createElement("li");
            var name = document.createElement("span");
            var detail = document.createElement("span");
            var details = [product.type, product.revision, product.id].filter(Boolean);

            row.className = "product";
            name.className = "product-name";
            detail.className = "product-detail";
            name.textContent = getDisplayName(product);
            detail.textContent = details.join(" | ");
            row.append(name, detail);
            list.appendChild(row);
        });
    }

    function setStatus(message, state) {
        var status = document.getElementById("status");
        status.textContent = message;
        status.dataset.state = state || "";
    }

    function describeError(error) {
        if (error && error.message) {
            return error.message;
        }
        if (error && error.statusText) {
            return error.statusText;
        }
        if (typeof error === "string") {
            return error;
        }
        return "The 3DSpace request failed. Check the widget is running in a trusted dashboard and that the API routes match your platform release.";
    }

    async function loadProducts(WAFData, serviceUrl, securityContext) {
        var bookmarkParams = {
            "$searchStr": BOOKMARK_NAME,
            "$mask": "dsbks:BksMask.Details"
        };
        var bookmarks = await getAllPages(WAFData, serviceUrl, BOOKMARK_SEARCH_PATH, securityContext, SEARCH_PAGE_SIZE, bookmarkParams);
        var bookmark = bookmarks.find(function (candidate) {
            var title = candidate.title || candidate.name || "";
            return String(title).toLowerCase() === BOOKMARK_NAME.toLowerCase();
        });

        if (!bookmark) {
            throw new Error('Could not find a bookmark named "' + BOOKMARK_NAME + '" that is visible to the current user.');
        }
        if (!bookmark.id) {
            throw new Error("The bookmark search response did not include an id for Lids.");
        }

        var contents = await getBookmarkItems(WAFData, serviceUrl, bookmark.id, securityContext);
        return contents.filter(isPhysicalProduct).map(normalizeProduct);
    }

    window.initializeLidsWidget = function (WAFData, compassServices, platformId, securityContext) {
        var button = document.getElementById("load-products");

        button.addEventListener("click", function () {
            button.disabled = true;
            renderProducts([]);

            if (!securityContext || !securityContext.trim()) {
                setStatus("Set the Security Context preference before loading products.", "error");
                button.disabled = false;
                return;
            }

            setStatus("Connecting to 3DSpace...");

            compassServices.getServiceUrl({
                serviceName: "3DSpace",
                platformId: platformId,
                onComplete: function (serviceUrl) {
                    if (!serviceUrl || serviceUrl === "undefined") {
                        button.disabled = false;
                        setStatus("Could not resolve the 3DSpace service for this platform.", "error");
                        return;
                    }

                    setStatus("Loading Physical Products from Lids...");
                    loadProducts(WAFData, serviceUrl, securityContext.trim()).then(function (products) {
                        renderProducts(products);
                        setStatus(products.length + (products.length === 1 ? " Physical Product" : " Physical Products") + " found in Lids.");
                    }).catch(function (error) {
                        renderProducts([]);
                        setStatus(describeError(error), "error");
                    }).finally(function () {
                        button.disabled = false;
                    });
                }
            });
        });
    };
}());