import fs from 'fs';
import csv from 'csv-parser';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import { format } from 'date-fns';
import puppeteer from 'puppeteer';
import clipboard from "clipboardy";

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

// Load cookies if they exist
export async function loadCookies(page, email) {
    const cookiesFilePath = `./cookies/${email}.json`;
    if (fs.existsSync(cookiesFilePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesFilePath, 'utf-8'));
        await page.setCookie(...cookies);
        console.log(`Cookies loaded for ${email}.`);
        return true;
    }
    return false;
}

// Save cookies after successful login
export async function saveCookies(page, email) {
    const cookies = await page.cookies();
    const cookiesFilePath = `./cookies/${email}.json`;  // Store cookies in a file named after the email
    fs.writeFileSync(cookiesFilePath, JSON.stringify(cookies, null, 2));
    console.log(`Cookies saved for ${email}.`);
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

// Main function to log in with credentials and perform actions
export async function mainWithCredentials(email, password, proxyInfo, twofa) {
    const [ip, port, name, pwd] = proxyInfo.split(':');
    const proxyUrl = `http://${ip}:${port}`;

    const browser = await puppeteer.launch({
        headless: false,
        args: [`--proxy-server=${proxyUrl}`],
    });

    try {
        const page = await browser.newPage();
        page.on('dialog', async dialog => {
            if (dialog.type() === 'alert' && dialog.message().includes('proxy')) {
                await dialog.dismiss();
            }
        });

        // Authenticate proxy if needed
        await page.authenticate({ username: name, password: pwd });

        // Try loading cookies first
        const cookiesLoaded = await loadCookies(page, email);
        if (cookiesLoaded) {
            console.log(`Navigating with saved cookies for ${email}`);
            await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', { waitUntil: 'networkidle0' });

            const isLoggedIn = await page.evaluate(() => {
                return !!document.querySelector('div[role="heading"]');  // Check if the user is logged in
            });

            if (isLoggedIn) {
                console.log(`Successfully reused session for ${email}`);
                await browser.close();
                return { email, success: true };
            } else {
                console.log(`Session expired for ${email}, re-logging in...`);
            }
        }

        // Login flow if no valid session exists
        console.log("Logging in to Microsoft...");
        await page.goto('https://login.microsoftonline.com/');
        await page.waitForSelector('#i0116');
        await page.type('#i0116', email);
        await page.click('#idSIButton9');
        await page.waitForNavigation();

        await page.waitForSelector('#i0118');
        await page.type('#i0118', password);
        await page.click('#idSIButton9');
        await page.waitForNavigation();

        console.log(`Handling 2FA for ${email}`);
        const twofaCode = await handleTwoFactorAuth(page, email, twofa);  // Assuming 2FA code logic is implemented here

        // After successful login, save cookies for future use
        await saveCookies(page, email);
        console.log(`Successfully logged in as ${email}.`);

        // Perform the account modification (e.g., adding safe sender)
        await performAccountActions(page, email);  // Replace with your existing account action logic

        await browser.close();
        return { email, success: true };

    } catch (error) {
        console.error(`Error occurred: ${error.message}`);
        await browser.close();
        return { email, success: false };
    }
}
