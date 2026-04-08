import * as amplitude from '@amplitude/analytics-browser';
import { isDevelopmentMode } from "@/public/tools";

export default async function trackEvent(name: string, properties?: any) {
    await initAmplitude();
    if (name === "DownloadStarted") {
        amplitude.setSessionId(Date.now());
    }
    amplitude.track(name, properties);
}

let amplitude_started = false;

let TEST_API_KEY = "2de8118f045cb41badb567c29cf28129"
let PRODUCTION_API_KEY = "7bdd84339e3b903b85daf6ac016e1f6f"

async function initAmplitude() {
    const apiKey = isDevelopmentMode() ? TEST_API_KEY : PRODUCTION_API_KEY;
    if (!amplitude_started) {
        amplitude_started = true;
        const client_id = await getOrCreateClientId();
        const device_id = await getOrCreateDeviceId();
        amplitude.init(apiKey, client_id, {
            autocapture: false,
            identityStorage: 'localStorage',
            deviceId: device_id,
            appVersion: getVersion(),
        });
        // Note: Without this delay the event after init is missed
        await delay(200);
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

async function delay(ms: number) {
    // noinspection TypeScriptUMDGlobal
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getOrCreateClientId() {
    const result = await chrome.storage.sync.get('clientId');
    let clientId = result.clientId;
    if (!clientId) {
        // Generate a unique client ID
        clientId = self.crypto.randomUUID();
        await chrome.storage.sync.set({clientId});
    }
    return clientId;
}

async function getOrCreateDeviceId() {
    const result = await chrome.storage.local.get('deviceId');
    let deviceId = result.deviceId;
    if (!deviceId) {
        // Generate a unique device ID
        deviceId = self.crypto.randomUUID();
        await chrome.storage.local.set({deviceId});
    }
    return deviceId;
}
