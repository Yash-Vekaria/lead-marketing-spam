import {BrowserClient, defaultStackParser, getDefaultIntegrations, makeFetchTransport, Scope} from "@sentry/browser";

export default function new_sentry_scope(): Scope {
    const integrations = getDefaultIntegrations({}).filter(
        (defaultIntegration) => {
            return !["BrowserApiErrors", "Breadcrumbs", "GlobalHandlers"].includes(
                defaultIntegration.name,
            );
        },
    );

    let client = new BrowserClient({
        dsn: "https://c8ca62d354c7cc59706b05ad112030aa@o4508493399916544.ingest.de.sentry.io/4508493406732368",
        transport: makeFetchTransport,
        stackParser: defaultStackParser,
        integrations: integrations,
        beforeSend: (event, hint) => {
            if (hint.data) {
                console.log("hint.data", hint.data);
                // Add the hint data to the event as tags
                event.tags = {...event.tags, ...hint.data};
                // Or add it as extra data
                event.extra = {...event.extra, hintData: hint.data};
            }
            return event;
        },
    })

    const scope = new Scope();
    scope.setClient(client);

    client.init(); // initializing has to be done after setting the client on the scope

    return scope
}

export async function capturing(scope: Scope, url: string | undefined, action: () => Promise<void>, onFail?: () => Promise<void>) {
    try {
        await action();
    } catch (e) {
        console.error(e);
        url = url || (await getTabUrl());
        const versionx = getVersion();
        scope.captureException(e, {data: {urlx: url, versionx: versionx}});
        if (onFail) {
            await onFail()
        }
    }
}

async function getTabUrl(): Promise<string> {
    if (chrome) {
        if (chrome.tabs) {
            const tabs = await chrome.tabs.query({active: true, currentWindow: true});
            if (tabs.length > 0) {
                let url = tabs[0].url;
                if (url) {
                    return url;
                } else {
                    return "NO_URL_URL";
                }
            } else {
                return "NO_URL_LENGTH";
            }
        } else {
            return "NO_URL_TABS";
        }
    } else {
        return "NO_URL_CHROME";
    }
}

function getVersion(): string {
    if (chrome) {
        if (chrome.runtime) {
            return chrome.runtime.getManifest().version;
        } else {
            return "NO_VER_RUNTIME";
        }
    } else {
        return "NO_VER_CHROME";
    }
}

