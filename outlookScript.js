ximport puppeteer from 'puppeteer';
import csv from 'csv-parser';
import fs from 'fs';
import clipboardy from 'clipboardy';

async function main(csvPath) {
    const credentials = await readCsv(csvPath);

    for (const { email, password, proxy_str, twofa } of credentials) {
        await mainWithCredentials(email, password, proxy_str, twofa);
    }
}

async function mainWithCredentials(email, password, proxyInfo, twofa) {
    try {
        const [ip, port, name, pwd] = proxyInfo.split(':');
        const proxyUrl = `http://${ip}:${port}`;
        const logStream = fs.createWriteStream('logs.txt', { flags: 'a' }); // Open log file for appending
        const browser = await puppeteer.launch({
            headless: true,
            args: [`--proxy-server=${proxyUrl}`],
        });
        const page = await browser.newPage();
        page.on('dialog', async dialog => {
            if (dialog.type() === 'alert' && dialog.message().includes('proxy')) {
                await dialog.dismiss();
            }
        });

        await page.authenticate({
            username: name,
            password: pwd,
        });

        await page.goto('https://login.microsoftonline.com/common/oauth2/authorize?client_id=00000002-0000-0ff1-ce00-000000000000&redirect_uri=https%3a%2f%2foutlook.office365.com%2fowa%2f&resource=00000002-0000-0ff1-ce00-000000000000&response_mode=form_post&response_type=code+id_token&scope=openid&msafed=1&msaredir=1&client-request-id=a10c2f98-47dd-1fcd-d3c8-0577fbe56597&protectedtoken=true&claims=%7b%22id_token%22%3a%7b%22xms_cc%22%3a%7b%22values%22%3a%5b%22CP1%22%5d%7d%7d%7d&nonce=638445885124429392.815dbea9-9410-4a64-ac9e-3bc68fac7ee4&state=DYuxDoIwFEVB_8Wt0pYW-gbiYKIMoImSaNj62ppAJBAgqHy9Hc49w80JgyDYejaekPoJ0iRWQkilJONCcIiB7xWTFp0GAoJRInQiiDbgSIwmUS9tUudE6FuM-o-ODnjN2G6a9ey8R2eb0Zm56jOd36jJy6T4wWKftwk5jEUHXd2927oq-eUuW-R0wcdpwCP43w7YyN6e2VSs0FQr_f4B');
        await page.waitForSelector('#i0116');
        await page.type('#i0116', email);
        await page.click('#idSIButton9');
        await page.waitForNavigation();

        await page.waitForSelector('#i0118');
        await page.type('#i0118', password);
        await page.click('#idSIButton9');
        await page.waitForNavigation();

        const page2 = await browser.newPage();
        await page2.goto('https://2fa.live');
        await delay(500);
        await page2.waitForSelector('#listToken');
        await page2.type('#listToken', twofa);
        await page2.click('#submit');
        await delay(500);

        const twofaCode = await page2.evaluate(() => {
            const inputElement = document.querySelector('#output');
            if (inputElement) {
                const inputValue = inputElement.value;
                // Split the value by '|' and return the second part
                const parts = inputValue.split('|');
                if (parts.length > 1) {
                    return parts[1].trim();
                } else {
                    throw new Error('2FA code format not recognized');
                }
            } else {
                throw new Error('Input element for 2FA code not found');
            }
        });

        // Copy 2FA code to clipboard
        clipboardy.writeSync(twofaCode);

        // Enter the 2FA code into the login form
        await page.bringToFront();
        await page.waitForSelector('#idTxtBx_SAOTCC_OTC');
        const twoFACodeFromClipboard = clipboardy.readSync();
        await page.type('#idTxtBx_SAOTCC_OTC', twoFACodeFromClipboard);

        // Submit the 2FA code and wait for navigation
        await page.click('#idSubmit_SAOTCC_Continue');
        await page.waitForNavigation();
        await page.waitForSelector('#acceptButton');
        await page.click('#acceptButton');
        await delay(3000);

        await browser.close();

        console.log(`Successfully logged in for email: ${email}`);
        console.log(`On Proxy: ${proxyUrl}`);
    } catch (error) {
        console.error(`Error with proxy ${proxyInfo}: ${error}`);
    }
}

function delay(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

function redirectConsoleToFile(fileName) {
    const logStream = fs.createWriteStream(fileName, { flags: 'a' }); // 'a' flag to append to the file
    const logStdout = process.stdout;

    console.log = function(message) {
        logStream.write(new Date().toISOString() + ' ' + message + '\n');
        logStdout.write(new Date().toISOString() + ' ' + message + '\n');
    };
}
redirectConsoleToFile('/Users/connorfarrell/Documents/OutlookScript/logs.txt');

function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                const emailField = data.hasOwnProperty('﻿email') ? '﻿email' : 'email';
                data['email'] = data[emailField];
                delete data[emailField];
                results.push(data);
            })
            .on('end', () => {
                resolve(results);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}


(async () => {
    try {
        //Input Path to CSV
        const csvPath = '/Users/example/Downloads/input.csv';
        await main(csvPath);
    } catch (error) {
        console.error(`Error reading CSV file: ${error}`);
    }
})();
