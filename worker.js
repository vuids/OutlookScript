import { parentPort, workerData } from 'worker_threads';
import { mainWithCredentials } from './mainWithCredentials.js';

async function processCredential() {
    const { email, password, proxy_str, twofa } = workerData;
    try {
        const isSuccess = await mainWithCredentials(email, password, proxy_str, twofa);
        parentPort.postMessage({ email, success: isSuccess });
    } catch (error) {
        parentPort.postMessage({ email, success: false, error: error.message });
    }
}

processCredential();

