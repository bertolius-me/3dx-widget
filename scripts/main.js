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

    window.initializeLidsTestButton = function (root) {
        var button = root.querySelector(".test-number-button");
        var output = root.querySelector(".test-number-output");

        button.addEventListener("click", function () {
            var number = String(Math.floor(Math.random() * 9000000000) + 1000000000);
            output.textContent = number;
            setStatus(root, "Test button clicked. Generated a 10-digit number.");
        });
    };

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
            name: referencedObject.name || item.name || "",
            title: referencedObject.title || item.title || "",
            description: referencedObject.description || item.description || "",
            type: referencedObject.type || item.type || "Physical Product",
            revision: referencedObject.revision || item.revision || "",
            relativePath: referencedObject.relativePath || item.relativePath || ""
        };
    }

    function getEngineeringItemPath(serviceUrl, product) {
        if (product.relativePath && product.relativePath.charAt(0) === "/") {
            return product.relativePath;
        }

        if (product.relativePath) {
            var relativeUrl;
            var platformUrl;
            try {
                relativeUrl = new URL(product.relativePath);
                platformUrl = new URL(serviceUrl);
            } catch (error) {
                relativeUrl = null;
            }
            if (relativeUrl && platformUrl && relativeUrl.origin === platformUrl.origin) {
                return relativeUrl.pathname;
            }
        }

        return "/resources/v1/modeler/dseng/dseng:EngItem/" + encodeURIComponent(product.id);
    }

    async function loadProductDetails(WAFData, serviceUrl, securityContext, products, root) {
        var loadedDetails = 0;
        var failedDetails = 0;

        for (var index = 0; index < products.length; index += 1) {
            var product = products[index];
            var path = getEngineeringItemPath(serviceUrl, product);
            var params = { "$mask": "dsmveng:EngItemMask.Details" };

            setStatus(root, "Loading details for product " + (index + 1) + " of " + products.length + ".");
            try {
                var response = await requestJson(
                    WAFData,
                    makeUrl(serviceUrl, path, params),
                    securityContext,
                    root,
                    "Product details " + (index + 1) + " of " + products.length
                );
                var item = getMembers(response)[0];

                if (item) {
                    product.name = item.name || product.name;
                    product.title = item.title || product.title;
                    product.description = item.description || product.description;
                    product.revision = item.revision || product.revision;
                }

                if (item && (product.name || product.title || product.revision || product.description)) {
                    loadedDetails += 1;
                } else {
                    failedDetails += 1;
                    setStatus(root, "Product " + product.id + " details did not include display fields; showing its ID instead.", "error");
                }
            } catch (error) {
                failedDetails += 1;
                setStatus(root, "Could not load details for product " + product.id + "; showing its ID instead. " + describeError(error), "error");
            }
        }

        return { loadedDetails: loadedDetails, failedDetails: failedDetails };
    }

    function renderProducts(root, products) {
        var list = root.querySelector(".products");
        list.replaceChildren();

        products.forEach(function (product) {
            var row = document.createElement("li");
            var name = document.createElement("span");
            var detail = document.createElement("span");
            var description = document.createElement("p");
            var details = [
                "Title: " + (product.title || "Not provided"),
                "Revision: " + (product.revision || "Not provided"),
                "ID: " + (product.id || "Not provided")
            ];

            row.className = "product";
            name.className = "product-name";
            detail.className = "product-detail";
            description.className = "product-description";
            name.textContent = "Name: " + (product.name || product.id || "Not provided");
            detail.textContent = details.join(" | ");
            description.textContent = "Description: " + (product.description || "Not provided");
            row.append(name, detail, description);
            list.appendChild(row);
        });
    }

    function exportProductsPdf(products) {
        var jsPdfLibrary = window.jspdf;
        var autoTable = window.autoTable;
        if (!jsPdfLibrary || !jsPdfLibrary.jsPDF || !autoTable) {
            throw new Error("The bundled PDF libraries are unavailable.");
        }

        var doc = new jsPdfLibrary.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        var pageWidth = doc.internal.pageSize.getWidth();
        var pageHeight = doc.internal.pageSize.getHeight();
        var exportDate = new Date();
        var dateLabel = exportDate.toLocaleDateString();
        var filenameDate = exportDate.toISOString().slice(0, 10);

        doc.setProperties({
            title: "Lids Physical Product Register",
            subject: "Physical Product metadata",
            creator: "Lids Product Widget"
        });

        autoTable(doc, {
            columns: [
                { header: "#", dataKey: "number" },
                { header: "Physical Product", dataKey: "name" },
                { header: "Title", dataKey: "title" },
                { header: "Revision", dataKey: "revision" },
                { header: "ID", dataKey: "id" },
                { header: "Description", dataKey: "description" }
            ],
            body: products.map(function (product, index) {
                return {
                    number: String(index + 1),
                    name: product.name || "Not provided",
                    title: product.title || "Not provided",
                    revision: product.revision || "Not provided",
                    id: product.id || "Not provided",
                    description: product.description || "Not provided"
                };
            }),
            theme: "grid",
            margin: { top: 30, right: 12, bottom: 16, left: 12 },
            styles: { font: "helvetica", fontSize: 8, cellPadding: 2.5, overflow: "linebreak", valign: "top" },
            headStyles: { fillColor: [23, 107, 83], textColor: [255, 255, 255], fontStyle: "bold" },
            alternateRowStyles: { fillColor: [242, 246, 244] },
            columnStyles: {
                number: { cellWidth: 9, halign: "right" },
                name: { cellWidth: 42, fontStyle: "bold" },
                title: { cellWidth: 42 },
                revision: { cellWidth: 20 },
                id: { cellWidth: 48 },
                description: { cellWidth: "auto" }
            },
            rowPageBreak: "avoid",
            willDrawPage: function () {
                doc.setTextColor(32, 42, 49);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(15);
                doc.text("Lids | Physical Product Register", 12, 13);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.setTextColor(93, 105, 101);
                doc.text("Exported " + dateLabel + "  |  " + products.length + " Physical Product(s)", 12, 20);
            },
            didDrawPage: function (data) {
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.setTextColor(93, 105, 101);
                doc.text("Page " + data.pageNumber, pageWidth - 12, pageHeight - 7, { align: "right" });
            }
        });

        doc.save("lids-physical-products-" + filenameDate + ".pdf");
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
        setStatus(root, "Found " + products.length + " Physical Product(s). Loading product details...");
        var detailResults = await loadProductDetails(WAFData, serviceUrl, securityContext, products, root);
        var detailStatus = "Loaded details for " + detailResults.loadedDetails + " of " + products.length + " products.";
        if (detailResults.failedDetails > 0) {
            detailStatus += " Showing IDs for " + detailResults.failedDetails + " product(s).";
        }
        setStatus(root, detailStatus + " Rendering results...");
        return { products: products, detailResults: detailResults };
    }

    window.initializeLidsWidget = function (WAFData, compassServices, platformId, securityContext, root) {
        var button = root.querySelector(".load-products");
        var exportButton = root.querySelector(".export-pdf");
        var loadedProducts = [];

        setStatus(root, "Widget initialized. Ready to load products.");

        exportButton.addEventListener("click", function () {
            if (loadedProducts.length === 0) {
                return;
            }
            try {
                exportProductsPdf(loadedProducts);
                setStatus(root, "PDF export started for " + loadedProducts.length + " Physical Product(s).");
            } catch (error) {
                setStatus(root, "PDF export failed: " + describeError(error), "error");
            }
        });

        button.addEventListener("click", function () {
            button.disabled = true;
            exportButton.disabled = true;
            loadedProducts = [];
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
                        loadProducts(WAFData, serviceUrl, securityContext.trim(), root).then(function (result) {
                            loadedProducts = result.products;
                            exportButton.disabled = loadedProducts.length === 0;
                            renderProducts(root, result.products);
                            var finalStatus = result.products.length + (result.products.length === 1 ? " Physical Product" : " Physical Products") + " found in Lids.";
                            if (result.detailResults.failedDetails > 0) {
                                finalStatus += " Details unavailable for " + result.detailResults.failedDetails + "; their IDs are shown.";
                            }
                            setStatus(root, finalStatus);
                        }).catch(function (error) {
                            loadedProducts = [];
                            exportButton.disabled = true;
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