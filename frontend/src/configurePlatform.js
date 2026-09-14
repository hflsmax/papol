import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http';
import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import { configureNetworkFetch } from '../../shared/connectivity.js';
import { configureNativeBridge } from '../../shared/nativeData.js';

configureNetworkFetch(IS_DESKTOP ? tauriHttpFetch : (...args) => window.fetch(...args));
configureNativeBridge({ invoke, listen });
