import fs from 'fs';
import csv from 'csv-parser';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import { format } from 'date-fns';

// Reads CSV and trims spaces from keys and values
export function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                const cleanedData = {};
                for (const key in data) {
                    cleanedData[key.trim()] = data[key].trim(); // Trim keys and values
                }
                results.push(cleanedData);
            })
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

// Delay function for asynchronous operations
export function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

// Redirects console output to a file and also outputs to the standard console
export function redirectConsoleToFile(fileName) {
    const logStream = fs.createWriteStream(fileName, { flags: 'a' });
    const oldConsoleLog = console.log;
    console.log = function(message) {
        logStream.write(`${new Date().toISOString()} ${message}\n`);
        oldConsoleLog.apply(console, arguments);
    };
}

// Helper function to generate a dynamic filename for output files
function getNextFileName(baseName, extension = 'csv') {
    let counter = 1;
    let fileName = `${baseName}${counter}.${extension}`;

    while (fs.existsSync(fileName)) {
        counter++;
        fileName = `${baseName}${counter}.${extension}`;
    }

    return fileName;
}

// Function to write data to CSV with headers and dynamic file naming
export function writeToCSV(data) {
    return new Promise((resolve, reject) => {
        // Generate dynamic filename
        const fileName = getNextFileName('output', 'csv');

        // Create the CSV writer with headers
        const csvWriter = createCsvWriter({
            path: fileName,
            header: [
                { id: 'email', title: 'email' },
                { id: 'password', title: 'password' },
                { id: 'proxy_str', title: 'proxy_str' },
                { id: 'twofa', title: 'twofa' }
            ]
        });

        // Write data to CSV
        csvWriter.writeRecords(data)
            .then(() => {
                console.log(`Successfully written to file: ${fileName}`);
                resolve();
            })
            .catch(err => {
                console.error('Error writing to CSV:', err);
                reject(err);
            });
    });
}

// Function to rewrite the CSV, excluding successfully processed emails
export function rewriteCsv(csvPath, credentials, successfulEmails) {
    const timestamp = format(new Date(), 'yyyyMMddHHmmss');
    const newPath = csvPath.replace(/\.csv$/, `_${timestamp}.csv`);

    const csvWriter = createCsvWriter({
        path: newPath,
        header: [
            { id: 'email', title: 'Email' },
            { id: 'password', title: 'Password' },
            { id: 'proxy_str', title: 'Proxy String' },
            { id: 'twofa', title: 'Two-Factor Auth' }
        ]
    });

    const remainingCredentials = credentials.filter(({ email }) => !successfulEmails.includes(email));
    return csvWriter.writeRecords(remainingCredentials)
        .then(() => console.log(`CSV file has been rewritten at ${newPath} without successfully processed emails.`));
}
