import {DownloadableInfo, DownloadHtmlData, onMessage, sendMessage} from "@/public/messaging";
import trackEvent from "@/public/statistic";
import JSZip from "jszip";
import DownloadOptions = chrome.downloads.DownloadOptions;
import new_sentry_scope from "@/public/sentry";

// TODO:
//  - The page with links was not properly downloaded

const sentry_scope = new_sentry_scope();

/**
 * Creates a URL object and throws a detailed exception if construction fails
 * @param url - The URL string or relative URL
 * @param base - Optional base URL for relative URLs
 * @param context - Context information for debugging (e.g., function name)
 * @throws Error with detailed information about the failed URL construction
 */
function createUrlWithDetails(url: any, base?: any, context?: string): URL {
    try {
        if (base) {
            return new URL(url, base);
        } else {
            return new URL(url);
        }
    } catch (originalError) {
        const detailedMessage = `Failed to construct URL in ${context || 'unknown context'}:\n` +
            `  URL: "${String(url)}" (type: ${typeof url})\n` +
            `  Base: "${base ? String(base) : 'undefined'}" (type: ${typeof base})\n` +
            `  Original error: ${originalError instanceof Error ? originalError.message : String(originalError)}`;
        
        // Throw a new error with detailed information
        const detailedError = new Error(detailedMessage);
        detailedError.name = 'URLConstructionError';
        throw detailedError;
    }
}

function getDefaultMaxValue(type: any) {
    var pos = type.indexOf("_max");
    if (pos != -1) type = type.substring(0, pos);

    switch (type) {
        case "image":
            return 10000;
        case "font":
            return 1000;
        case "js":
            return 260;
        case "css":
            return 260;
        default:
            return 0;
    }
}

const extTypes = [
    "image", "font", "js", "css", "others"
];
const mimeTypes = [
    "image", "font", "script", "css", "stream"
];

function getDefaultSettings() {
    var ds: any = {};
    for (var i = 0, l = extTypes.length; i < l; i++) {
        ds[extTypes[i] + "_max"] = getDefaultMaxValue(extTypes[i]);
    }
    ds.emdate = false;
    ds.emsrc = false;
    ds.showsave = false;
    ds.dltype = DlType.All;
    ds.timeout = 60;
    ds.noscript = false;
    ds.loadlazy = true;
    return ds;
}

const DlType = {
    All: 0,
    KeepStyle: 1,
    Minimal: 2
};

let settings = getDefaultSettings();

let currentTasks: Map<number, DownloadTask> = new Map();
let download_tasks: DownloadTask[] = [];

type DownloadTaskParam = {
    id: number;
    url: string;
    title: string | undefined;
    dltype: number;
    html: string;
    currentDepth: number;
    isMultiPage: boolean;
    maxDepth: number;
}

type SharedData = {
    chain: DownloadTask[];
    processedLinks: Map<string, void>;
    cancelled: boolean;
    linksCollected: number;
    someLinksNotDownloaded: boolean;
}

export class DownloadTask {
    id: number;
    url: string;
    title: string;
    dltype: number;
    doc: Document;
    elemcount: number;
    xhrs: any[];
    now: Date;
    cancelled: boolean = false;
    currentDepth: number;
    isMultiPage: boolean;
    maxDepth: number;

    // Shared chain of tasks. Child tasks may add new tasks here
    sharedData!: SharedData;

    static disposeExistingAndCreate(param: DownloadTaskParam) {
        DownloadTask.dispose(param.id);
        return new DownloadTask(param);
    }

    static create(param: DownloadTaskParam) {
        return new DownloadTask(param);
    }

    static async runChain(task: DownloadTask) {
        task.sharedData = {
            chain: [task],
            processedLinks: new Map(),
            cancelled: false,
            linksCollected: 0,
            someLinksNotDownloaded: false,
        };

        console.log("Start chain")
        const data: DownloadHtmlData[] = [];
        while (task.sharedData.chain.length > 0) {
            if (task.sharedData.cancelled) {
                break;
            }
            const currentTask = task.sharedData.chain.shift();
            if (currentTask) {
                currentTasks.set(currentTask.id, currentTask);
                if (currentTask.currentDepth <= currentTask.maxDepth) {
                    console.log("New task")
                    const downloadableInfo: DownloadHtmlData | undefined = await currentTask.convert()
                    if (downloadableInfo) {
                        data.push(downloadableInfo)
                    } else {
                        await trackEvent("NoDownloadableInfo")
                    }
                }
            } else {
                await trackEvent("MissingCurrentTask")
            }
        }
        currentTasks.delete(task.id);
        if (!task.cancelled && !task.sharedData.cancelled) {
            const downloadableInfo = await createDownloadableObject(data, task.url, task.now, task.sharedData.processedLinks, task.isMultiPage, task.maxDepth, task.sharedData.someLinksNotDownloaded);
            await sendMessage('dataPrepared', {downloadableInfo, url: task.url});
        }
        DownloadTask.dispose(task.id);
    }

    static dispose(id: number) {
        const currentTask = currentTasks.get(id);
        if (currentTask) {
            currentTask.close();
            currentTask.sharedData.chain = [];
            currentTask.sharedData.cancelled = true;
            currentTasks.delete(id);
        }
    }

    putNewTask(task: DownloadTask) {
        this.sharedData.chain.push(task);
        task.sharedData = this.sharedData;
    }

    constructor(param: DownloadTaskParam) {
        this.id = param.id;
        this.url = param.url;
        this.dltype = param.dltype;

        this.elemcount = 0;
        this.xhrs = [];

        this.now = new Date();
        this.currentDepth = param.currentDepth;
        this.isMultiPage = param.isMultiPage;
        this.maxDepth = param.maxDepth;

        var parser = new DOMParser();
        this.doc = parser.parseFromString(param.html, "text/html");
        this.title = param.title || this.doc.title || "PAGE";
        
        this.setupBaseTag(this.doc, this.url);
    }

    /**
     * Sets up the base tag for the document. If a base tag already exists:
     * - If it has a full URL, keeps it as is
     * - If it has a relative path, resolves it against the root domain
     * - If it has no href, sets it to the current URL
     * If no base tag exists, creates a new one with the current URL.
     */
    private setupBaseTag(doc: Document, currentUrl: string): void {
        // Check if there's already a base tag
        const existingBase = doc.querySelector("base");
        if (existingBase) {
            const existingHref = existingBase.getAttribute("href");
            if (existingHref) {
                try {
                    // Try to create URL from existing href to see if it's absolute
                    new URL(existingHref);
                    // If we get here, it's already a full URL, so keep it as is
                } catch (e) {
                    // It's a relative URL, resolve it against the root domain
                    const rootDomain = getRootDomain(currentUrl);
                    if (rootDomain) {
                        const resolvedUrl = createUrlWithDetails(existingHref, rootDomain, 'setupBaseTag-resolveRelative').href;
                        existingBase.href = resolvedUrl;
                    } else {
                        // Fallback to current URL if getRootDomain fails
                        existingBase.href = currentUrl;
                    }
                }
            } else {
                // Base tag exists but has no href, set it to our URL
                existingBase.href = currentUrl;
            }
        } else {
            // No existing base tag, create new one (original logic)
            const base = doc.createElement("base");
            base.href = currentUrl;
            doc.head.appendChild(base);
        }
    }

    close() {
        const t = this;
        for (var i = 0, l = t.xhrs.length; i < l; i++) {
            var x: any = t.xhrs[i];
            if (x && x.readyState !== XMLHttpRequest.DONE) x.abort();
        }
        t.cancelled = true;
        t.xhrs = [];
    }

    removeMeta() {
        const t = this;
        var metas = t.doc.getElementsByTagName("meta");
        for (var i = 0, l = metas.length; i < l; i++) {
            var me = metas[i];
            var csattr = me.getAttribute("charset");
            if (csattr) {
                me.parentNode?.removeChild(me);
                break;
            } else {
                csattr = me.getAttribute("content");
                if (csattr) {
                    if (csattr.toLowerCase().indexOf("charset") != -1) {
                        me.parentNode?.removeChild(me);
                        break;
                    }
                }
            }
        }
    }

    removeTags() {
        if (this.dltype == DlType.All) return;

        const doc = this.doc;

        var tagnames, tags, tag;
        if (settings.noscript == true) {
            tags = doc.getElementsByTagName("noscript");

            while (tags.length > 0) {
                var t = tags[0], p = t.parentNode;
                var ih = t.innerHTML.replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
                t.insertAdjacentHTML("afterend", ih);
                p?.removeChild(t);
            }
        }

        tagnames = ["meta", "script", "iframe", "link", "style"];
        for (var i = 0, il = tagnames.length; i < il; i++) {
            if (i == 4 && this.dltype == DlType.KeepStyle) continue;
            var ks = (i == 3 && this.dltype == DlType.KeepStyle) ? true : false;

            tags = doc.getElementsByTagName(tagnames[i]);
            for (j = tags.length - 1; j >= 0; j--) {
                tag = tags[j];
                if (ks == true && tag.getAttribute("rel") == "stylesheet") continue;
                tag.parentNode?.removeChild(tag);
            }
        }

        tags = doc.getElementsByTagName("a");
        for (var i = tags.length - 1; i >= 0; i--) {
            tag = tags[i];
            var cns = tag.children;
            if (cns.length == 1) {
                var cn = cns[0];
                var tagname = cn.tagName;
                if (!tagname || tagname.toLowerCase() != "img") continue;
                var p = tag.parentNode;
                cn.removeAttribute("width");
                cn.removeAttribute("height");
                p?.insertBefore(cn, tag);
                p?.removeChild(tag);
            }
        }

        var found;
        tagnames = ["div", "span", "p"];
        do {
            found = false;
            for (var n = 0, nl = tagnames.length; n < nl; n++) {
                tags = doc.getElementsByTagName(tagnames[n]);
                for (var i = tags.length - 1; i >= 0; i--) {
                    tag = tags[i];
                    if (!tag.innerHTML) {
                        tag.parentNode?.removeChild(tag);
                        found = true;
                    }
                }
            }
        } while (found == true);

        var removeComments = function (elem: any) {
            for (var i = elem.childNodes.length - 1; i >= 0; i--) {
                tag = elem.childNodes[i];
                if (tag.nodeType === Node.COMMENT_NODE) {
                    tag.parentNode.removeChild(tag);
                } else {
                    removeComments(tag);
                }
            }
        };
        removeComments(doc);

        tags = doc.getElementsByTagName("*");
        for (var i = 0, l = tags.length; i < l; i++) {
            tag = tags[i];
            for (var j = tag.attributes.length - 1; j >= 0; j--) {
                var attr = tag.attributes[j].name.toLowerCase();
                if ((this.dltype != DlType.KeepStyle && (attr == "class" || attr == "style"))
                    || (this.dltype == DlType.Minimal && attr == "id") || attr.substr(0, 2) == "on") {
                    tag.removeAttribute(attr);
                }
            }
        }
    }

    convertPre() {
        const doc = this.doc;
        var tags, tag;
        tags = doc.getElementsByTagName("pre");
        for (var i = 0, l = tags.length; i < l; i++) {
            tag = tags[i];

            var brs = tag.getElementsByTagName("br");
            for (var j = brs.length - 1; j >= 0; j--) {
                var tn = doc.createTextNode("\x0A");
                brs[j].parentNode?.replaceChild(tn, brs[j]);
            }
        }
    }

    appendProp() {
        if (!settings.emsrc && !settings.emdate) return;

        const doc = this.doc;
        var div = doc.createElement("div");
        div.setAttribute("style",
            "position:fixed;z-index:999999;text-align:center;width:100%;bottom:0;");
        var idv = doc.createElement("div");
        idv.setAttribute("style",
            "display:inline;padding:0.5em;background-color:rgba(255,255,255,0.9);color:black;");
        if (settings.emdate) {
            var ddv = doc.createElement("span");
            ddv.textContent = this.now.toLocaleString();
            idv.appendChild(ddv);
        }
        if (settings.emsrc) {
            var ema = doc.createElement("a");
            ema.href = this.url;
            ema.textContent = localize("showsrc");
            if (settings.emdate) {
                ema.setAttribute("style", "margin-left:1em;");
            }
            idv.appendChild(ema);
        }
        div.appendChild(idv);
        doc.body.appendChild(doc.createComment("Single HTML Downloader info"));
        doc.body.appendChild(div);
    }

    checkFinish(): DownloadHtmlData | undefined {
        const t = this;
        if (this.cancelled) return;
        if (this.sharedData.cancelled) return;

        console.log("Create downloadable file")
        return createDownloadableFile(t.title, t.url, t.doc);
    }

    getScheme(url: any) {
        var sp = url.indexOf("://");
        if (sp != -1) {
            return url.substring(0, sp);
        } else {
            return "";
        }
    }

    getExactlyUrl(target: any, baseurl?: any) {
        const t = this;
        if (!baseurl) baseurl = t.url;
        var url = createUrlWithDetails(target, baseurl, 'getExactlyUrl');
        return url.href;
    }

    checkDownloadSize(xhr: any, size: any) {
        var ctype = xhr.getResponseHeader("content-type");
        if (typeof ctype == "string") {
            var cltype = ctype.toLowerCase();
            for (var i = 0, l = mimeTypes.length; i < l; i++) {
                if (cltype.indexOf(mimeTypes[i]) != -1) {
                    var name = extTypes[i] + "_max";
                    if (size <= settings[name] * 1024) {
                        return true;
                    } else {
                        return false;
                    }
                }
            }
        }

        if (size <= settings["others_max"] * 1024) {
            return true;
        } else {
            return false;
        }
    }

    private async downloadContent(is_text: boolean, src: string, pm: any) {
        // noinspection TypeScriptUMDGlobal
        return new Promise<any>((resolve, reject) => {
            let xhr = new XMLHttpRequest();
            var check_length = false;

            this.xhrs.push(xhr);

            if (is_text) {
                xhr.responseType = "text";
                xhr.overrideMimeType("text/css; charset=utf-8");
            } else {
                xhr.responseType = "arraybuffer";
            }

            if (settings["timeout"] > 0) {
                xhr.timeout = settings["timeout"] * 1000;
            }

            xhr.open("GET", src, true);
            xhr.ontimeout = (ev) => {
                resolve({
                    success: false,
                    param: pm,
                    errmsg: "Timeout. skipped."
                });
            };
            xhr.onprogress = (ev) => {
                if (check_length == false && ev.total > 0) {
                    if (this.checkDownloadSize(xhr, ev.total) == false) {
                        resolve({
                            success: false,
                            param: pm,
                            errmsg: "file size exceeds the value. Skipped."
                        });
                        xhr.abort();
                    } else {
                        check_length = true;
                    }
                }
            };
            xhr.onload = function () {
                var resp = this.response;
                if (is_text == false) {
                    var ctype = xhr.getResponseHeader("content-type");
                    var buffer = new Uint8Array(resp), buflen = buffer.length, str = "";
                    for (var i = 0; i < buflen; i++) str += String.fromCharCode(buffer[i]);
                    resp = "data:" + ctype + ";base64," + btoa(str);
                }
                resolve({
                    success: true,
                    data: resp,
                    param: pm,
                });
            };
            xhr.onerror = function (e: any) {
                resolve({
                    success: false,
                    errmsg: e.message,
                    param: pm,
                });
            };
            try {
                xhr.send();
            } catch (ex: any) {
                resolve({
                    success: false,
                    errmsg: ex.message,
                    param: pm,
                });
            }
        })
    }

    async downloadText(url: any, param: any) {
        return await this.downloadContent(true, url, param)
    }

    async downloadImage(url: any, param: any) {
        return await this.downloadContent(false, url, param);
    }

    async convertCssUrl(cssurl: any, css: any): Promise<string[]> {
        var res: any[] = [], regres;
        var regex = /url\((['"]?)(.+?)\1\)/ig;
        while ((regres = regex.exec(css)) !== null) {
            res.push({start: regres.index, fulllen: regres[0].length, url: regres[regres.length - 1], data: ""});
        }

        var rest = res.length;
        var checkFinish = async function () {
            rest--;
            if (rest <= 0) {
                var str = "", pos = 0;
                for (var i = 0, l = res.length; i < l; i++) {
                    str += css.substring(pos, res[i].start);
                    str += "url(\"" + res[i].data + "\")";
                    pos = res[i].start + res[i].fulllen;
                }
                str += css.substr(pos);
                return str
            }
        };

        if (rest == 0) {
            const css = await checkFinish();
            if (css) {
                return [css];
            } else {
                return [];
            }
        }

        const result: Promise<string | undefined>[] = []
        for (let i = 0, l = res.length; i < l; i++) {
            let target = res[i].url;
            if (target.substr(0, 4) == "data") {
                res[i].data = target;
                const r = checkFinish();
                result.push(r);
            } else {
                target = this.getExactlyUrl(target, cssurl);

                const r = await this.downloadImage(target, i );
                res[r.param].data = r.data;
                const re= checkFinish();
                result.push(re);
            }
        }
        let resultList: Awaited<string | undefined>[] = await Promise.all(result);
        return resultList.filter(r => r !== undefined);
    }

    async getSubFiles(): Promise<DownloadHtmlData | undefined> {
        const t = this;

        var tagnames, tags, tag;
        var elems: any[] = [], add, src
        tagnames = ["img", "script", "link"];
        for (var i = 0, il = tagnames.length; i < il; i++) {
            tags = t.doc.getElementsByTagName(tagnames[i]);
            for (var j = 0, jl = tags.length; j < jl; j++) {
                tag = tags[j];
                add = false;
                switch (i) {
                    case 0:
                        const imageTag = tag as HTMLImageElement;
                        src = (imageTag.currentSrc != "") ? imageTag.currentSrc : imageTag.src;
                        add = (src.substring(0, 4) == "http");
                        break;
                    case 1:
                        const scriptTag = tag as HTMLScriptElement;
                        add = (scriptTag.src !== undefined && scriptTag.src != "");
                        break;
                    case 2:
                        const linkTag = tag as HTMLLinkElement;
                        if (linkTag.href) {
                            var rel = linkTag.rel.toLowerCase();
                            add = (rel == "stylesheet" || rel == "shortcut icon" || rel == "preload");
                        }
                        break;
                }
                if (add == true) elems.push(tag);
            }
        }

        t.elemcount = elems.length;
        if (t.elemcount == 0) {
            return t.checkFinish();
        }

        const infos: Promise<void>[] = [];
        for (var i = 0, el = t.elemcount; i < el; i++) {
            var tagName = elems[i].tagName.toLowerCase();
            if (tagName == "img" || (tagName == "link" && elems[i].rel.toLowerCase() != "stylesheet")) {
                var src;
                // TODO: There also might be srcset & data-srcset
                if (settings.loadlazy == true && tagName == "img" && elems[i].hasAttribute("data-src")) {
                    src = elems[i].getAttribute("data-src");
                } else {
                    src = (tagName == "img") ? elems[i].src : elems[i].href;
                }
                const promise = t.downloadImage(src, i).then(res => {
                    if (res.success) {
                        let index = res.param;
                        if (elems[index].src) { // XXX: Does this logic properly loads data-src?
                            elems[index].src = res.data;
                        } else {
                            elems[index].href = res.data;
                        }
                        // We remove all remaining tags because they refer to the online resource.
                        elems[index].removeAttribute("srcset");
                        elems[index].removeAttribute("data-srcset");
                        elems[index].removeAttribute("data-src");
                    }
                })
                infos.push(promise);
            } else if (tagName == "script") {
                const promise = t.downloadText(elems[i].src, i).then(res => {
                    if (res.success == true) {
                        let index = res.param;
                        let em = elems[index];
                        em.removeAttribute("src");
                        // Escaping script tags in the string
                        em.textContent = res.data.replace(/<(\/*)script>/gi, "\\x3c$1script\\x3e");
                    }
                })
                infos.push(promise);
            } else {	// style
                const promise: Promise<void> = t.downloadText(elems[i].href, i).then(async res => {
                    if (res.success) {
                        let index = res.param;
                        let em = elems[index];
                        let p = em.parentNode;

                        const strArray = await t.convertCssUrl(em.href, res.data);
                        strArray.forEach((str: any) => {
                            if (str !== null) {
                                var css = t.doc.createElement("style");
                                var media = em.getAttribute("media");
                                if (media) css.setAttribute("media", media);
                                css.textContent = str;
                                p.insertBefore(css, em);
                                p.removeChild(em);
                            }
                        })
                    }
                })
                infos.push(promise);
            }
        }
        await Promise.all(infos)
        return t.checkFinish();
    }

    // On Images:
    //  Currently, we only process src tag. However, there are also data-src, srcset, and data-srcset.
    //  If the same image has both src & srcset, the srcset is processed first, and the removed <base> tag will break it
    async processLinks() {
        const t = this;
        if (t.currentDepth >= t.maxDepth) return;
        if (t.cancelled) return;
        if (t.sharedData.cancelled) return;

        const currentRootDomain = getRootDomain(t.url)
        let links: HTMLCollectionOf<HTMLAnchorElement> = t.doc.getElementsByTagName("a");
        const aLinks = Array.from(links)
            .map(a => a.href)
            .filter(a => getRootDomain(a) === currentRootDomain)
            .map(a => cleanUrl(a))
            .filter(a => !this.sharedData.processedLinks.has(a))

        this.sharedData.linksCollected += aLinks.length;
        for (let i = 0, l = aLinks.length; i < l; i++) {
            if (this.cancelled) return;
            if (this.sharedData.cancelled) return;
            await sendInfo(this.sharedData.linksCollected, aLinks[i]);
            await this.fetchNewTask(aLinks[i]);
        }
    }

    async fetchNewTask(url: string) {
        console.log("Loading new task:" + url, "depth: " + this.currentDepth)
        try {
            const response = await fetch(url)
            if (!response.ok) {
                this.sharedData.someLinksNotDownloaded = true;
                return
            }
            const text = await response.text()
            const task = DownloadTask.create({
                dltype: 0,
                html: text,
                title: undefined, // Title will be filled later
                url: url,
                id: this.id,
                currentDepth: this.currentDepth + 1,
                isMultiPage: this.isMultiPage,
                maxDepth: this.maxDepth,
            })
            this.putNewTask(task)
        } catch (error) {
            if (error instanceof TypeError && error.message === 'Failed to fetch') {
                this.sharedData.someLinksNotDownloaded = true;
            } else {
                throw error;
            }
        }
    }

    async convert(): Promise<DownloadHtmlData | undefined> {
        if (this.sharedData.processedLinks.has(this.url)){
            await trackEvent("LinkAlreadyProcessed", this.url)
            return
        }

        this.sharedData.processedLinks.set(this.url, undefined);

        const t = this;
        if (t.url === "https://extensiontechnologies-332ae.web.app/website_downloader") {
            console.log("Download welcome page")
            const myUrl = chrome.runtime.getURL("data/Extension-Technologies.html")
            // Fetch the file
            const data = await fetch(myUrl);
            const text = await data.text()
            return {
                url: t.url,
                filename: "Extension-Technologies.html",
                doc: text
            }
        } else {
            t.removeMeta();
            t.removeTags();
            t.convertPre();
            t.appendProp();
            if (this.isMultiPage) {
                await t.processLinks();
            }
            return await t.getSubFiles();
        }
    }
}

function localize(name: any){
    var str = chrome.i18n.getMessage(name);
    if(!str) return "(\"" + name + "\" is not defined)";
    return str;
}

function createDownloadableFile(title: any, url: string, doc: Document): DownloadHtmlData {
    let ttl = title.replace(/[\r\n]/g, "").replace(/[\\/:*?"<>|~.]/g, "_").trim();
    if (ttl.length > 45) ttl = ttl.substring(0, 50);
    if (!ttl) ttl = "webpage";
    const filename = ttl + ".html";

    return { url, filename, doc }
}

function cleanString(str: string): string {
    // If the string ends with .html, handle it separately
    if (str.endsWith('.html')) {
        // Clean everything except the .html extension
        const nameWithoutExt = str.slice(0, -5);
        const cleanedName = nameWithoutExt.replace(/[\r\n]/g, "").replace(/[\\/:*?"<>|~.]/g, "_").trim();
        return cleanedName + '.html';
    }
    // Otherwise clean the entire string as before
    return str.replace(/[\r\n]/g, "").replace(/[\\/:*?"<>|~.]/g, "_").trim();
}

function getRootDomain(url: any) {
    try {
        // Use the URL object to parse the URL
        const parsedUrl = createUrlWithDetails(url, undefined, 'getRootDomain');
        return `${parsedUrl.protocol}//${parsedUrl.host}`; // Combine protocol and host
    } catch (e) {
        console.error("Invalid URL:", url); // Handle invalid URLs
        return null;
    }
}

function getHost(url: any) {
    try {
        // Use the URL object to parse the URL
        const parsedUrl = createUrlWithDetails(url, undefined, 'getHost');
        return `${parsedUrl.host}`; // Combine protocol and host
    } catch (e) {
        console.error("Invalid URL:", url); // Handle invalid URLs
        return null;
    }
}

function cleanUrl(url: string): string {
    try {
        const urlObj = createUrlWithDetails(url, undefined, 'cleanUrl');
        return `${urlObj.origin}${urlObj.pathname}`;
    } catch (e) {
        return url;
    }
}

async function createDownloadableObject(data: DownloadHtmlData[], myUrl: string, downloadDate: Date, processedLinks: Map<string, void>, isMultiPage: boolean, maxDepth: number, someLinksNotDownloaded: boolean): Promise<DownloadableInfo | undefined> {
    console.log("Amount of data received: " + data.length + "")
    if (data.length === 1) {
        let singleData = data[0];
        const html = getHtml(singleData.doc, downloadDate);
        const blob = new Blob([html], {type: "text/html"});
        const url = URL.createObjectURL(blob);

        return {
            options: {filename: singleData.filename, url, saveAs: false},
            isMultiPage,
            maxDepth,
            someLinksNotDownloaded,
        }
    } else if (data.length > 1) {
        const host = getHost(myUrl) || "website"
        const zip = new JSZip();
        const rootFolder = zip.folder(replaceLastAppExtension(host)) || zip;
        inlineBaseTags(data, processedLinks);
        data.forEach(function (item) {
            const folder = urlToFolderPath(item.url)
            const filename = urlToFilename(item.url)
            const html = getHtml(item.doc, downloadDate);
            if (folder.length > 0) {
                const inFolder = rootFolder.folder(folder) || rootFolder;
                inFolder.file(filename, html);
            } else {
                rootFolder.file(filename, html);
            }
        })
        const blob = await zip.generateAsync({type: "blob"})
        const url = URL.createObjectURL(blob);
        return {
            options: {filename: `${host}.zip`, url, saveAs: false},
            isMultiPage,
            maxDepth,
            someLinksNotDownloaded,
        }
    }
}

/**
 * Replaces the '.app' extension in a folder path with '_app' to avoid macOS treating 
 * the folder as an application bundle. This prevents issues where folders ending in '.app' 
 * are interpreted as applications on macOS systems.
 * 
 * @param str - The folder path string to process
 * @returns The processed string with '.app' replaced with '_app' if present
 */
function replaceLastAppExtension(str: string): string {
    if (str.endsWith('.app')) {
        return str.slice(0, -4) + '_app';
    }
    return str;
}

function urlToFolderPath(url: string): string {
    try {
        const urlObj = createUrlWithDetails(url, undefined, 'urlToFolderPath');
        const segments = urlObj.pathname.split('/').filter(Boolean);
        
        // If URL ends with /, the last segment is also a folder
        if (urlObj.pathname.endsWith('/')) {
            return segments.map(replaceLastAppExtension).join('/');
        }
        
        // Otherwise remove the last segment (page name)
        segments.pop();
        return segments.map(replaceLastAppExtension).join('/');
    } catch (e) {
        return '';
    }
}

function urlToFilename(url: string): string {
    try {
        const parsedUrl = createUrlWithDetails(url, undefined, 'urlToFilename');
        const path = parsedUrl.pathname;

        // If path ends with / or is empty, return index.html
        if (path.endsWith('/') || !path || path === "/") {
            return "index.html";
        }

        // Get the last segment of the path
        const lastSegment = path.split("/").pop() || "";
        
        // If it already ends with .html, return it cleaned but preserve the .html
        if (lastSegment.endsWith('.html')) {
            return cleanString(lastSegment);
        }
        
        // Otherwise add .html extension
        return `${cleanString(lastSegment)}.html`;
    } catch (error) {
        console.error("Invalid URL:", error);
        return "index.html";
    }
}

function getHtml(doc: Document | string, downloadDate: Date): string {
    if (doc instanceof Document) {
        return getHtmlFromDoc(doc, downloadDate);
    } else {
        return doc;
    }
}

function getHtmlFromDoc(doc: Document, downloadDate: Date): string {
    let dhtml = "<!DOCTYPE html><html><head>" +
        "<meta charset=\"utf-8\">" +
        "<meta name=\"download_date\" content=\"" + downloadDate.toISOString() + "\"/>";

    dhtml += doc.documentElement.innerHTML.substring(doc.documentElement.innerHTML.indexOf(">") + 1);
    return dhtml;
}

function inlineBaseTags(data: DownloadHtmlData[], processedLinks: Map<string, void>) {
    data.forEach(function (item) {
        if (item.doc instanceof Document) {
            inlineRelativeLinks(item.doc, processedLinks);
        }
    })
}

function inlineRelativeLinks(doc: Document, urlExclusions: Map<string, void>): void {
    const baseTags = doc.querySelectorAll("base");
    if (baseTags.length === 0) return;

    // Find the first base tag with an href attribute to use as the base URL
    let baseUrl: string | null = null;
    for (const baseTag of baseTags) {
        const href = baseTag.getAttribute("href");
        if (href) {
            baseUrl = href;
            break;
        }
    }
    
    if (!baseUrl) return;

    // Remove all <base> tags
    baseTags.forEach(baseTag => baseTag.remove());

    const resolveUrl = (relativeUrl: string | null): string | null => {
        if (!relativeUrl) return null;
        if (relativeUrl.startsWith("data:")) return relativeUrl;

        try {
            // Convert to absolute URL regardless of input format
            let absoluteUrl = relativeUrl.startsWith("http") 
                ? relativeUrl 
                : createUrlWithDetails(relativeUrl, baseUrl, 'inlineRelativeLinks-resolveUrl').href;

            // Clean the URL by removing query parameters and hash
            absoluteUrl = cleanUrl(absoluteUrl);

            // Check if this is a link to the current page
            if (absoluteUrl === cleanUrl(baseUrl)) {
                return ".";  // Replace self-reference with a dot
            }

            // Check for both slash and /index.html variants
            const hasUrl = urlExclusions.has(absoluteUrl) || 
                (absoluteUrl.endsWith('/') && urlExclusions.has(absoluteUrl + 'index.html')) ||
                (absoluteUrl.endsWith('/index.html') && urlExclusions.has(absoluteUrl.slice(0, -10)));

            if (hasUrl) {
                // Convert excluded URLs to relative but don't append .html if it already ends with .html
                const relativePath = makeRelativePath(absoluteUrl, baseUrl);
                return relativePath.endsWith('.html') ? relativePath : relativePath + ".html";
            }

            return absoluteUrl; // Keep other URLs as absolute
        } catch(e) {
            console.error("Error resolving URL:", e);
            sentry_scope.captureException(e, {
                data: {
                    context: 'inlineRelativeLinks-resolveUrl',
                    relativeUrl: relativeUrl,
                    baseUrl: baseUrl
                }
            });
            return null;
        }
    };

    const makeRelativePath = (absoluteUrl: string, baseUrl: string): string => {
        const absolutePath = createUrlWithDetails(absoluteUrl, undefined, 'makeRelativePath-absolute').pathname;
        const basePath = createUrlWithDetails(baseUrl, undefined, 'makeRelativePath-base').pathname;

        const absoluteParts = absolutePath.split("/").filter(part => part !== "");
        const baseParts = basePath.split("/").filter(part => part !== "");

        let commonIndex = 0;
        while (commonIndex < absoluteParts.length && commonIndex < baseParts.length && absoluteParts[commonIndex] === baseParts[commonIndex]) {
            commonIndex++;
        }

        const upLevels = baseParts.length - commonIndex - 1; // Number of levels to go up
        const relativeParts = absoluteParts.slice(commonIndex);
        
        // Clean all parts except the last one if it ends with .html
        const cleanedParts = relativeParts.map((part, index) => {
            if (index === relativeParts.length - 1 && part.endsWith('.html')) {
                return cleanString(part);
            }
            return cleanString(part);
        });

        return ((upLevels >= 0) ? "../".repeat(upLevels) : "") + cleanedParts.join("/");
    };

    const updateAttribute = (element: Element, attr: string) => {
        const url = element.getAttribute(attr);
        const newUrl = resolveUrl(url);
        console.log("Updating attribute", attr, "from", url, "to", newUrl);
        if (newUrl) {
            element.setAttribute(attr, newUrl);
        }
    };

    // List of elements and attributes to update
    const selectors: [string, string][] = [
        ["a", "href"],
        ["link", "href"],
        ["script", "src"],
        ["img", "src"],
        ["iframe", "src"],
        ["source", "src"],
        ["video", "src"],
        ["audio", "src"],
        ["form", "action"]
    ];

    for (const [tag, attr] of selectors) {
        doc.querySelectorAll(tag).forEach(el => {
            updateAttribute(el, attr);
        });
    }
}

function strip(str: string): string {
    return str.length > 30
        ? `${str.slice(0, 10)}...${str.slice(-20)}`
        : str;
}

async function sendInfo(linksCollected: number, url: string) {
    let linksInfo = ""
    if (linksCollected > 0) {
        linksInfo = "Collected " + linksCollected + " links. "
    }
    await sendMessage('infoMessage', "<strong>Do not close the page.</strong><br>" + linksInfo + "Loading " + strip(url) + "")
}
