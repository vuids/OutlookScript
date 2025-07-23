import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';

/**
 * Delay execution for a specified amount of time
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise} Promise that resolves after the delay
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clicks a selector and waits for navigation, retrying on a known
 * Puppeteer "frame navigated" race up to 3 times before giving up.
 */
export async function safeClickAndNavigate(
    page,
    selector,
    navOptions = { waitUntil: 'networkidle2', timeout: 30000 }
  ) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await Promise.all([
          page.click(selector, { delay: 100 }),
          page.waitForNavigation(navOptions),
        ]);
        return; // success
      } catch (err) {
        // ignore the Puppeteer frame‑assertion race and retry
        if (err.message.includes('We either navigate top level')) {
          console.warn(
            `safeClickAndNavigate: ignored frame‐navigation race on ${selector} (attempt ${attempt})`
          );
          continue;
        }
        // rethrow any other error
        throw err;
      }
    }
    throw new Error(
      `safeClickAndNavigate: failed to navigate after 3 attempts on ${selector}`
    );
  }
  
/**
 * Save cookies from a browser session to a file
 * @param {Object} page - Puppeteer page object
 * @param {string} email - Email identifier for the cookie file
 * @returns {Promise<boolean>} Success status
 */
export async function saveCookies(page, email) {
    try {
        const cookiesDir = path.resolve('./cookies');
        if (!fs.existsSync(cookiesDir)) {
            fs.mkdirSync(cookiesDir, { recursive: true });
        }
        
        const cookies = await page.cookies();
        const cookiePath = path.join(cookiesDir, `${email.replace(/[@.]/g, '_')}.json`);
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
        return true;
    } catch (error) {
        console.error(`Error saving cookies for ${email}: ${error.message}`);
        return false;
    }
}

/**
 * Load cookies from a file into a browser session
 * @param {Object} page - Puppeteer page object
 * @param {string} email - Email identifier for the cookie file
 * @returns {Promise<boolean>} Success status
 */
export async function loadCookies(page, email) {
    try {
        const cookiesDir = path.resolve('./cookies');
        const cookiePath = path.join(cookiesDir, `${email.replace(/[@.]/g, '_')}.json`);
        
        if (!fs.existsSync(cookiePath)) {
            console.log(`No cookie file found for ${email}`);
            return false;
        }
        
        const cookiesString = fs.readFileSync(cookiePath, 'utf8');
        const cookies = JSON.parse(cookiesString);
        
        if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
            console.log(`Cookie file for ${email} is empty or invalid`);
            return false;
        }
        
        await page.setCookie(...cookies);
        return true;
    } catch (error) {
        console.error(`Error loading cookies for ${email}: ${error.message}`);
        return false;
    }
}

/**
 * Attempt to click an element with retries
 * @param {Object} page - Puppeteer page object
 * @param {string} selector - CSS selector for the element
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<boolean>} Whether the click was successful
 */
export async function robustClick(page, selector, maxRetries = 3) {
    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            
            // First try the standard click
            const element = await page.$(selector);
            if (element) {
                await element.click();
                await delay(500); // Short delay after click
                return true;
            }
        } catch (error) {
            console.warn(`Click attempt ${retries + 1} failed for ${selector}: ${error.message}`);
            
            // Try alternative click methods on subsequent attempts
            if (retries === 1) {
                try {
                    // Try clicking with JavaScript
                    await page.evaluate((sel) => {
                        const element = document.querySelector(sel);
                        if (element) element.click();
                    }, selector);
                    await delay(500);
                    return true;
                } catch (jsError) {
                    console.warn(`JavaScript click failed: ${jsError.message}`);
                }
            } else if (retries === 2) {
                try {
                    // Try moveToElement and then click
                    const element = await page.$(selector);
                    if (element) {
                        const box = await element.boundingBox();
                        if (box) {
                            await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
                            await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
                            await delay(500);
                            return true;
                        }
                    }
                } catch (mouseError) {
                    console.warn(`Mouse movement click failed: ${mouseError.message}`);
                }
            }
        }
        
        retries++;
        await delay(1000); // Wait before next attempt
    }
    
    return false;
}

/**
 * Read data from a CSV file
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<Array>} Array of objects representing each row
 */
export function readCsv(filePath) {
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
                console.log(`Successfully read ${results.length} rows from ${filePath}`);
                resolve(results);
            })
            .on('error', (error) => {
                console.error(`Error reading CSV file ${filePath}: ${error.message}`);
                reject(error);
            });
    });
}

/**
 * Write data to a CSV file
 * @param {Array} data - Array of objects to write to CSV
 * @param {string} outputPath - Path for the output CSV file
 * @returns {Promise} Promise that resolves when writing is complete
 */
export async function writeToCSV(data, outputPath) {
    if (!data || data.length === 0) {
        console.warn(`No data to write to ${outputPath}`);
        return;
    }
    
    try {
        // Ensure output directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Get headers from the first object
        const headers = Object.keys(data[0]).map(key => ({
            id: key,
            title: key
        }));
        
        const csvWriter = createObjectCsvWriter({
            path: outputPath,
            header: headers
        });
        
        await csvWriter.writeRecords(data);
        return true;
    } catch (error) {
        console.error(`Error writing to CSV ${outputPath}: ${error.message}`);
        throw error;
    }
}

/**
 * Wait for a condition to be true, with timeout
 * @param {Function} conditionFn - Function that returns a boolean
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 * @returns {Promise<boolean>} Whether the condition was met before timeout
 */
export async function waitForCondition(conditionFn, timeout = 30000, interval = 500) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        if (await conditionFn()) {
            return true;
        }
        await delay(interval);
    }
    
    return false;
}

/**
 * Parse a proxy string in the format ip:port:username:password
 * @param {string} proxyStr - Proxy string
 * @returns {Array} Array with proxy components [ip, port, username, password]
 */
export function parseProxyString(proxyStr) {
    if (!proxyStr || typeof proxyStr !== 'string') {
        throw new Error(`Invalid proxy string: ${proxyStr}`);
    }

    const proxyParts = proxyStr.split(':');
    if (proxyParts.length !== 4) {
        throw new Error(`Proxy string is not in the correct format (ip:port:username:password): ${proxyStr}`);
    }

    return proxyParts;
}