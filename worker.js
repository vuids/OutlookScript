import { mainWithCredentials } from './mainWithCredentials.js';
import fs from 'fs';
import csv from 'csv-parser';
import { delay } from './helperFunctions.js';

async function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                const cleanedData = {};
                for (const key in data) {
                    cleanedData[key.trim()] = data[key].trim();
                }
                results.push(cleanedData);
            })
            .on('end', () => {
                console.log(`Successfully read ${results.length} credentials.`);
                resolve(results);
            })
            .on('error', (error) => reject(error));
    });
}

function parseProxyString(proxy_str) {
    if (!proxy_str || typeof proxy_str !== 'string') {
        throw new Error(`Invalid proxy string: ${proxy_str}`);
    }

    const proxyParts = proxy_str.split(':');
    if (proxyParts.length !== 4) {
        throw new Error(`Proxy string is not in the correct format (ip:port:username:password): ${proxy_str}`);
    }

    return proxyParts;
}

async function processCredentialsConcurrently(credentials, maxConcurrent = 10) {
    const queue = [...credentials];
    const successStream = fs.createWriteStream('./success.csv', { flags: 'a' });
    const failedStream = fs.createWriteStream('./failed.csv', { flags: 'a' });

    // Write headers if the files are empty
    if (successStream.bytesWritten === 0) {
        successStream.write('email,success\n');
    }
    if (failedStream.bytesWritten === 0) {
        failedStream.write('email,error\n');
    }

    async function worker(workerId) {
        while (queue.length > 0) {
            const credential = queue.shift();
            const { email, password, proxy_str, twofa } = credential;

            console.log(`[Worker ${workerId}] Starting task for ${email}...`);

            try {
                const proxyInfo = parseProxyString(proxy_str);
                const result = await mainWithCredentials(email, password, proxyInfo.join(':'), twofa);

                if (result.success) {
                    console.log(`[Worker ${workerId}] Task succeeded for ${email}.`);
                    successStream.write(`${email},true\n`);
                } else {
                    console.error(`[Worker ${workerId}] Task failed for ${email}: ${result.error}`);
                    failedStream.write(`${email},"${result.error}"\n`);
                }
            } catch (error) {
                console.error(`[Worker ${workerId}] Error processing ${email}: ${error.message}`);
                failedStream.write(`${email},"${error.message}"\n`);
            }

            await delay(1000);
        }
    }

    const workers = Array.from({ length: maxConcurrent }, (_, index) => worker(index + 1));
    await Promise.all(workers);

    successStream.end();
    failedStream.end();

    console.log('Processing completed. Results written to success.csv and failed.csv.');
}

async function main() {
    try {
        const credentials = await readCsv('./input.csv');
        const maxConcurrent = 2;
        console.log(`Processing ${credentials.length} credentials with ${maxConcurrent} concurrent workers.`);

        await processCredentialsConcurrently(credentials, maxConcurrent);
    } catch (error) {
        console.error(`Error in main process: ${error.message}`);
    }
}

main();
