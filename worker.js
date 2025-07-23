import { mainWithCredentials } from './mainWithCredentials.js';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { delay } from './helperFunctions.js';

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

async function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                const cleaned = {};
                for (const key in data) {
                    cleaned[key.trim()] = data[key].trim();
                }
                results.push(cleaned);
            })
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

async function processCredentialsConcurrently(credentials, maxConcurrent = 20) {
    const outputDir = path.resolve('./results');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const successPath = path.join(outputDir, 'success.csv');
    const failedPath = path.join(outputDir, 'failed.csv');

    // Ensure headers exist
    if (!fs.existsSync(successPath) || fs.statSync(successPath).size === 0) {
        fs.writeFileSync(successPath, 'email,success\n');
    }
    if (!fs.existsSync(failedPath) || fs.statSync(failedPath).size === 0) {
        fs.writeFileSync(failedPath, 'email,error\n');
    }

    const successStream = fs.createWriteStream(successPath, { flags: 'a' });
    const failedStream = fs.createWriteStream(failedPath, { flags: 'a' });

    const queue = [...credentials];
    let activeWorkers = 0;
    let completed = 0;
    const total = queue.length;

    async function worker(workerId) {
        while (queue.length > 0) {
            const credential = queue.shift();
            if (!credential) break;

            activeWorkers++;
            const { email, password, proxy_str, twofa } = credential;

            console.log(`[Worker ${workerId}] Starting task for ${email}... (Active: ${activeWorkers}/${maxConcurrent}, Completed: ${completed}/${total})`);

            try {
                const proxyInfo = parseProxyString(proxy_str);
                const result = await mainWithCredentials(email, password, proxyInfo.join(':'), twofa);

                if (result.success) {
                    console.log(`[Worker ${workerId}] ✅ Task succeeded for ${email}`);
                    successStream.write(`${email},true\n`, err => {
                        if (err) console.error(`Failed to write success for ${email}: ${err.message}`);
                    });
                } else {
                    console.error(`[Worker ${workerId}] ❌ Task failed for ${email}: ${result.error}`);
                    failedStream.write(`${email},"${(result.error || 'Unknown error').replace(/"/g, '""')}"\n`, err => {
                        if (err) console.error(`Failed to write failure for ${email}: ${err.message}`);
                    });
                }

            } catch (fatalError) {
                const errorMessage = (fatalError.message || '').replace(/"/g, '""');
                console.error(`[Worker ${workerId}] ❌ CRASHED on ${email}: ${errorMessage}`);
                failedStream.write(`${email},"${errorMessage}"\n`, err => {
                    if (err) console.error(`Failed to write crash error for ${email}: ${err.message}`);
                });
            } finally {
                activeWorkers--;
                completed++;
                console.log(`[Worker ${workerId}] Completed task (Active: ${activeWorkers}/${maxConcurrent}, Completed: ${completed}/${total})`);
            }

            await delay(Math.random() * 500 + 250);
        }
    }

    console.log(`🚀 Starting ${maxConcurrent} workers to process ${total} credentials...`);
    const workers = Array.from({ length: maxConcurrent }, (_, index) => worker(index + 1));
    await Promise.all(workers);

    successStream.end();
    failedStream.end();

    console.log(`✅ All tasks completed. Results written to ${successPath} and ${failedPath}`);
}

async function main() {
    try {
        const credentials = await readCsv('./input.csv');
        await processCredentialsConcurrently(credentials, 1); // Adjust concurrency as needed
    } catch (err) {
        console.error("❌ Top-level script error:", err.message);
        process.exit(1);
    }
}

main();
