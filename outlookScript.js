import { Worker } from 'worker_threads';
import { readCsv, rewriteCsv } from './helperFunctions.js';

async function main(csvPath) {
    const credentials = await readCsv(csvPath);
    let successfulEmails = [];
    const maxConcurrency = 5;
    let activeWorkers = [];

    for (const credential of credentials) {
        const worker = new Worker('./worker.js', { workerData: credential });
        worker.on('message', (message) => {
            console.log(message);
            if (message.success) {
                successfulEmails.push(message.email);
            }
        });
        worker.on('error', error => console.error(error));
        worker.on('exit', (code) => {
            if (code !== 0)
                console.error(`Worker stopped with exit code ${code}`);
        });

        activeWorkers.push(worker);
        if (activeWorkers.length >= maxConcurrency) {
            await Promise.all(activeWorkers.map(w => new Promise(resolve => w.on('exit', resolve))));
            activeWorkers = [];
        }
    }

    // Wait for any remaining workers to finish
    await Promise.all(activeWorkers.map(worker => new Promise(resolve => worker.on('exit', resolve))));

    // Rewrite the CSV, excluding successful emails
    await rewriteCsv(csvPath, credentials, successfulEmails);
}


// Change to your actual CSV path
main('/Users/connorfarrell/OutlookScript/input.csv').catch(console.error);
