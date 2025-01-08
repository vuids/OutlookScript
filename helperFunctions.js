// Updated helperFunctions.js
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';
import fs from 'fs';
import csv from 'csv-parser';

// Function to read CSV and return an array of objects
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

// Function to write data to a CSV file
export function writeToCsv(data, baseName = 'output', extension = 'csv') {
    return new Promise((resolve, reject) => {
        let counter = 1;
        let fileName = `${baseName}${counter}.${extension}`;

        // Generate a unique filename if one already exists
        while (fs.existsSync(fileName)) {
            counter++;
            fileName = `${baseName}${counter}.${extension}`;
        }

        // Create CSV writer with headers
        const csvWriter = createCsvWriter({
            path: fileName,
            header: Object.keys(data[0]).map((key) => ({ id: key, title: key })),
        });

        csvWriter
            .writeRecords(data)
            .then(() => {
                console.log(`Successfully written to file: ${fileName}`);
                resolve();
            })
            .catch((err) => {
                console.error('Error writing to CSV:', err);
                reject(err);
            });
    });
}


// Delay function
export async function delay(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

// Save cookies for successful sessions
export async function saveCookies(page, email) {
    const cookies = await page.cookies();
    const filePath = `./cookies/${email}.json`;
    fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
    console.log(`Cookies saved for ${email} at ${filePath}`);
}

// Load cookies for existing sessions
export async function loadCookies(page, email) {
    const filePath = `./cookies/${email}.json`;
    if (fs.existsSync(filePath)) {
        const cookies = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        await page.setCookie(...cookies);
        console.log(`Cookies loaded for ${email}`);
        return true;
    }
    return false;
}

export async function robustClick(page, selector, maxRetries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const element = await page.$(selector);
            if (element) {
                await element.click();
                console.log(`Clicked element with selector "${selector}" on attempt ${attempt}.`);
                return true;
            } else {
                console.log(`Element with selector "${selector}" not found. Retrying (${attempt}/${maxRetries})...`);
            }
        } catch (error) {
            console.error(`Error clicking element with selector "${selector}" on attempt ${attempt}: ${error.message}`);
        }
        await delay(delayMs); // Wait before retrying
    }
    console.error(`Failed to click element with selector "${selector}" after ${maxRetries} attempts.`);
    return false;
}



// Click with retries and fallback to text search
export async function clickWithRetries(page, selector, maxRetries = 3, delayMs = 2000, fallbackText = null) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let element = await page.$(selector);
            if (!element && fallbackText) {
                console.log(`Retrying with fallback text: ${fallbackText}`);
                element = await page.evaluateHandle((text) =>
                        Array.from(document.querySelectorAll('button, input'))
                            .find((el) => el.textContent.includes(text) || el.getAttribute('aria-label') === text),
                    fallbackText
                );
            }

            if (element) {
                await element.click();
                console.log(`Clicked element (${selector || fallbackText}) on attempt ${attempt}.`);
                return true;
            }
        } catch (error) {
            console.error(`Error clicking element (${selector || fallbackText}) on attempt ${attempt}: ${error.message}`);
        }
        await delay(delayMs);
    }
    console.error(`Failed to click element (${selector || fallbackText}) after ${maxRetries} attempts.`);
    return false;
}

// robustType function: Ensures typing into an element with retries and logging
export async function robustType(page, selector, text, maxRetries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const element = await page.$(selector);
            if (element) {
                await page.focus(selector); // Ensure the element is focused before typing
                await page.evaluate((selector) => {
                    const input = document.querySelector(selector);
                    if (input) input.value = ''; // Clear any pre-existing text
                }, selector);
                await page.type(selector, text);
                console.log(`Typed "${text}" into element with selector "${selector}" on attempt ${attempt}.`);
                return true;
            } else {
                console.log(`Element with selector "${selector}" not found. Retrying (${attempt}/${maxRetries})...`);
            }
        } catch (error) {
            console.error(`Error typing into element with selector "${selector}" on attempt ${attempt}: ${error.message}`);
        }
        await delay(delayMs); // Wait before retrying
    }
    console.error(`Failed to type into element with selector "${selector}" after ${maxRetries} attempts.`);
    return false;
}


export async function logAndSavePage(page, description) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `error_${description}_${timestamp}.png`;

    try {
        await page.screenshot({ path: fileName });
        console.log(`Saved screenshot: ${fileName}`);
    } catch (err) {
        console.error(`Failed to save screenshot: ${err.message}`);
    }

    const htmlFileName = `error_${description}_${timestamp}.html`;
    try {
        const htmlContent = await page.content();
        fs.writeFileSync(htmlFileName, htmlContent);
        console.log(`Saved page HTML: ${htmlFileName}`);
    } catch (err) {
        console.error(`Failed to save page HTML: ${err.message}`);
    }
}

