// Updated worker.js
import { mainWithCredentials } from './mainWithCredentials.js';

const workerData = async (email, password, proxy_str, twofa) => {
    try {
        console.log(`Worker started for ${email}`);
        const proxyInfo = proxy_str ? proxy_str : '';
        const result = await mainWithCredentials(email, password, proxyInfo, twofa);

        if (result.success) {
            console.log(`Worker successfully completed login for ${email}`);
            return { email, success: true };
        } else {
            console.error(`Worker failed login for ${email}: ${result.error}`);
            return { email, success: false, error: result.error };
        }
    } catch (error) {
        console.error(`Unexpected error in worker for ${email}: ${error.message}`);
        return { email, success: false, error: error.message };
    }
};

export default workerData;
