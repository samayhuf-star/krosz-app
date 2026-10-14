const isNode = typeof window === 'undefined';
const memoryValues = new Map();
const memoryStorage = {
	getItem(key) { return memoryValues.get(key) ?? null; },
	setItem(key, value) { memoryValues.set(key, String(value)); },
	removeItem(key) { memoryValues.delete(key); },
};
// Reading window.localStorage throws when the browser blocks site storage
// (e.g. "Block all cookies"). This module loads before React mounts, so an
// unguarded access white-screens the whole app; fall back to memory instead.
const resolveStorage = () => {
	if (isNode) return memoryStorage;
	try {
		const ls = window.localStorage;
		ls.getItem('base44_storage_probe');
		return {
			getItem(key) { try { return ls.getItem(key); } catch { return memoryStorage.getItem(key); } },
			setItem(key, value) { try { ls.setItem(key, value); } catch { memoryStorage.setItem(key, value); } },
			removeItem(key) { try { ls.removeItem(key); } catch { memoryStorage.removeItem(key); } },
		};
	} catch {
		return memoryStorage;
	}
};
const storage = resolveStorage();
const viteEnv = /** @type {Record<string, string | undefined>} */ (Reflect.get(import.meta, 'env') || {});
const DEFAULT_APP_ID = '6a7a236310d39c4c5cb1f566';
const previewAppId = isNode ? undefined : window.location.hostname.match(/^preview(?:-sandbox)?--[^.]*?([a-f0-9]{24})\.(?:base44-preview|base44)\.app$/i)?.[1];

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(storageKey);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	if (getAppParamValue("clear_access_token") === 'true') {
		storage.removeItem('base44_access_token');
		storage.removeItem('token');
	}
	return {
		appId: getAppParamValue("app_id", { defaultValue: viteEnv.VITE_BASE44_APP_ID || previewAppId || DEFAULT_APP_ID }),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
		functionsVersion: getAppParamValue("functions_version", { defaultValue: viteEnv.VITE_BASE44_FUNCTIONS_VERSION }),
		appBaseUrl: getAppParamValue("app_base_url", { defaultValue: viteEnv.VITE_BASE44_APP_BASE_URL }),
	}
}


export const appParams = {
	...getAppParams()
}
