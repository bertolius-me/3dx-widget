(function () {
    "use strict";

    var BOOKMARK_NAME = "Lids";
    var SEARCH_PAGE_SIZE = 1000;
    var ITEMS_PAGE_SIZE = 50;
    var REQUEST_TIMEOUT_MS = 30000;
    var MAX_LOG_ENTRIES = 30;
    var BOOKMARK_SEARCH_PATH = "/resources/v1/modeler/dsbks/dsbks:Bookmark/search";
    var BOOKMARK_PATH = "/resources/v1/modeler/dsbks/dsbks:Bookmark";

    function describeError(error) {
        if (error && error.message) {
            return error.message;
        }
        if (error && error.responseText) {
            try {
                var response = JSON.parse(error.responseText);
                return response.message || error.responseText;
            } catch (parseError) {
                return error.responseText;
            }
        }
        if (error && error.statusText) {
            return error.statusText;
        }
        if (typeof error === "string") {
            return error;
        }
        return "Unknown error";
    }

    function setStatus(root, message, state) {
        var status = root.querySelector(".status");
        var log = root.querySelector(".debug-log");
        var entry = document.createElement("li");

        status.textContent = message;
        status.dataset.state = state || "";
        entry.className = "debug-entry";
        entry.dataset.state = state || "";
        entry.textContent = new Date().toLocaleTimeString() + "  " + message;
        log.appendChild(entry);

        while (log.children.length > MAX_LOG_ENTRIES) {
            log.removeChild(log.firstElementChild);
        }
        log.scrollTop = log.scrollHeight;
    }

    window.reportLidsWidgetStatus = setStatus;

    function requestJson(WAFData, url, securityContext, root, step) {
        return new Promise(function (resolve, reject) {
            var finished = false;
            var timer = window.setTimeout(function () {
                fail(new Error("No response after 30 seconds."));
            }, REQUEST_TIMEOUT_MS);

            function succeed(response) {
                if (finished) {
                    return;
                }
                finished = true;
                window.clearTimeout(timer);
                setStatus(root, step + " response received.");
                resolve(response);
            }

            function fail(error) {
                if (finished) {
                    return;
                }
                finished = true;
                window.clearTimeout(timer);
                var message = step + " failed: " + describeError(error);
                setStatus(root, message, "error");
                reject(new Error(message));
            }

            setStatus(root, step + " request sent.");
            try {
                WAFData.authenticatedRequest(url, {
                    method: "GET",
                    type: "json",
                    headers: {
                        Accept: "application/json",
                        SecurityContext: securityContext
                    },
                    onComplete: succeed,
                    onFailure: fail,
                    onPassportError: fail,
                    onTimeout: function () {
                        fail(new Error("The 3DEXPERIENCE request timed out."));
                    }
                });
            } catch (error) {
                fail(error);
            }
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

    async function getAllPages(WAFData, serviceUrl, path, securityContext, pageSize, extraParams, root, stepName) {
        var allMembers = [];
        var skip = 0;
        var pageNumber = 1;

        while (true) {
            var params = Object.assign({}, extraParams, {
                "$skip": String(skip),
                "$top": String(pageSize)
            });
            setStatus(root, stepName + " page " + pageNumber + " (skip " + skip + ").");
            var response = await requestJson(WAFData, makeUrl(serviceUrl, path, params), securityContext, root, stepName + " page " + pageNumber);
            var members = getMembers(response);

            allMembers = allMembers.concat(members);
            skip += members.length;
            setStatus(root, stepName + " page " + pageNumber + " returned " + members.length + " record(s).");

            var total = getTotal(response);
            if (members.length < pageSize || (total !== null && skip >= total)) {
                return allMembers;
            }
            pageNumber += 1;
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

    async function getBookmarkItems(WAFData, serviceUrl, bookmarkId, securityContext, root) {
        var path = BOOKMARK_PATH + "/" + encodeURIComponent(bookmarkId);
        var allItems = [];
        var skip = 0;
        var pageNumber = 1;

        while (true) {
            var params = {
                "$mask": "dsbks:BksMask.Items2",
                "$skip": String(skip),
                "$top": String(ITEMS_PAGE_SIZE)
            };
            setStatus(root, "Loading bookmark items page " + pageNumber + " (skip " + skip + ").");
            var response = await requestJson(WAFData, makeUrl(serviceUrl, path, params), securityContext, root, "Bookmark items page " + pageNumber);
            var page = getBookmarkItemPage(response, bookmarkId);

            allItems = allItems.concat(page.members);
            skip += page.members.length;
            setStatus(root, "Bookmark items page " + pageNumber + " returned " + page.members.length + " item(s).");

            if (page.members.length < ITEMS_PAGE_SIZE || (page.total !== null && skip >= page.total)) {
                return allItems;
            }
            pageNumber += 1;
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

    function renderProducts(root, products) {
        var list = root.querySelector(".products");
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

    async function loadProducts(WAFData, serviceUrl, securityContext, root) {
        var bookmarkParams = {
            "$searchStr": BOOKMARK_NAME,
            "$mask": "dsbks:BksMask.Details"
        };
        setStatus(root, "Searching for the exact bookmark named " + BOOKMARK_NAME + ".");
        var bookmarks = await getAllPages(WAFData, serviceUrl, BOOKMARK_SEARCH_PATH, securityContext, SEARCH_PAGE_SIZE, bookmarkParams, root, "Bookmark search");
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

        setStatus(root, "Found Lids. Loading its bookmark items...");
        var contents = await getBookmarkItems(WAFData, serviceUrl, bookmark.id, securityContext, root);
        setStatus(root, "Checking " + contents.length + " bookmark item(s) for Physical Products.");
        var products = contents.filter(isPhysicalProduct).map(normalizeProduct);
        setStatus(root, "Found " + products.length + " Physical Product(s). Rendering results...");
        return products;
    }

    window.initializeLidsWidget = function (WAFData, compassServices, platformId, securityContext, root) {
        var button = root.querySelector(".load-products");

        setStatus(root, "Widget initialized. Ready to load products.");

        button.addEventListener("click", function () {
            button.disabled = true;
            renderProducts(root, []);
            setStatus(root, "Load products clicked.");

            if (!securityContext || !securityContext.trim()) {
                setStatus(root, "Set the Security Context preference before loading products.", "error");
                button.disabled = false;
                return;
            }

            setStatus(root, "Resolving the 3DSpace service URL...");
            var serviceUrlRequestFinished = false;
            var serviceUrlTimer = window.setTimeout(function () {
                if (!serviceUrlRequestFinished) {
                    serviceUrlRequestFinished = true;
                    setStatus(root, "Timed out waiting for the 3DSpace service URL.", "error");
                    button.disabled = false;
                }
            }, REQUEST_TIMEOUT_MS);

            try {
                compassServices.getServiceUrl({
                    serviceName: "3DSpace",
                    platformId: platformId,
                    onComplete: function (serviceUrl) {
                        if (serviceUrlRequestFinished) {
                            return;
                        }
                        serviceUrlRequestFinished = true;
                        window.clearTimeout(serviceUrlTimer);

                    if (!serviceUrl || serviceUrl === "undefined") {
                        button.disabled = false;
                        setStatus(root, "Could not resolve the 3DSpace service for this platform.", "error");
                        return;
                    }

                        setStatus(root, "3DSpace URL resolved. Starting bookmark lookup...");
                        loadProducts(WAFData, serviceUrl, securityContext.trim(), root).then(function (products) {
                        renderProducts(root, products);
                        setStatus(root, products.length + (products.length === 1 ? " Physical Product" : " Physical Products") + " found in Lids.");
                    }).catch(function (error) {
                        renderProducts(root, []);
                            setStatus(root, "Product loading stopped: " + describeError(error), "error");
                    }).finally(function () {
                        button.disabled = false;
                    });
                    }
                });
            } catch (error) {
                if (!serviceUrlRequestFinished) {
                    serviceUrlRequestFinished = true;
                    window.clearTimeout(serviceUrlTimer);
                    setStatus(root, "3DSpace service lookup failed: " + describeError(error), "error");
                    button.disabled = false;
                }
            }
        });
    };
}());