import {defineExtensionMessaging} from '@webext-core/messaging';
import DownloadOptions = chrome.downloads.DownloadOptions;

interface ProtocolMap {
    collectHtml(info: DownloadRequestInfo): void;

    dataPrepared(message: { downloadableInfo: DownloadableInfo | undefined, url: string }): void;

    cancel(tabId: number): void;

    reloadCurrentTab(): void;

    infoMessage(message: string): void;

    cancelLoadingLink(tabId: number): void;
}

export type DownloadRequestInfo = {
    tabId: number,
    isMultiPage: boolean,
}

export const {sendMessage, onMessage} = defineExtensionMessaging<ProtocolMap>();

export type DownloadHtmlData = {
    url: string,
    filename: string,
    doc: Document | string, // Document or string with html
}

export type DownloadableInfo = {
    options: DownloadOptions,
    isMultiPage: boolean,
    maxDepth: number,
    someLinksNotDownloaded: boolean,
}
