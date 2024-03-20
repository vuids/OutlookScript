import puppeteer from 'puppeteer';
import csv from 'csv-parser';
import fs from 'fs';
import clipboard from 'clipboardy';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';


async function main(csvPath) {
    const credentials = await readCsv(csvPath);
    let successfulEmails = [];

    for (const { email, password, proxy_str, twofa } of credentials) {
        const isSuccess = await mainWithCredentials(email, password, proxy_str, twofa);
        if (isSuccess) {
            successfulEmails.push(email);
        }
    }
    // Rewrite the CSV, excluding successful emails
    console.log('Starting to rewrite CSV...');
    await rewriteCsv(csvPath, credentials, successfulEmails);
    console.log('Finished rewriting CSV.');
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
        await delay(750);

        const twofaCode = await page2.evaluate((email) => {
            const inputElement = document.querySelector('#output');
            if (inputElement) {
                const inputValue = inputElement.value;
                // Split the value by '|' and return the second part
                const parts = inputValue.split('|');
                if (parts.length > 1) {
                    return parts[1].trim();
                } else {
                    throw new Error(`2FA code format not recognized on account: ${email}`);
                }
            } else {
                throw new Error('Input element for 2FA code not found');
            }
        }, email);

        // Copy 2FA code to clipboard
        clipboard.writeSync(twofaCode);

        // Enter the 2FA code into the login form
        await page.bringToFront();
        await page.waitForSelector('#idTxtBx_SAOTCC_OTC');
        const twoFACodeFromClipboard = clipboard.readSync();
        await page.type('#idTxtBx_SAOTCC_OTC', twoFACodeFromClipboard);

        // Submit the 2FA code and wait for navigation
        await page.click('#idSubmit_SAOTCC_Continue');
        await page.waitForNavigation();
        await page.waitForSelector('#acceptButton');
        await page.click('#acceptButton');
        await delay(3000);

        console.log(`Successfully logged in for email: ${email}`);
        console.log(`On Proxy: ${proxyUrl}`);
        await delay(500);
        await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail');
        await page.waitForSelector('#ModalFocusTrapZone2235 > div.ms-Modal-scrollableContent.scrollableContent-547 > div > div.pA2AO.css-419 > div.OjwNa > div.aHxfM', {visible: true, timeout: 3000}).catch(e => console.log('Successfully added TM email to non junk list.'));
        await page.evaluate(() => {
            const addButtonLabels = [...document.querySelectorAll('.ms-Button-label')].filter(el => el.textContent.includes('Add'));
            if (addButtonLabels.length > 1) {
                console.log('Second Add button found, attempting to click...');
                addButtonLabels[1].click(); // Indexes are zero-based; 1 refers to the second element
            } else {
                console.log('The expected second Add button was not found.');
            }
        });
        await page.waitForSelector('input[placeholder="Example: abc123@fourthcoffee.com for sender, fourthcoffee.com for domain."]', {visible: true});
        await page.type('input[placeholder="Example: abc123@fourthcoffee.com for sender, fourthcoffee.com for domain."]', 'customer_support@email.ticketmaster.com');

        await page.keyboard.press('Enter');
        await delay(3000);

        //await page.waitForNavigation({ waitUntil: 'networkidle0' });
        await page.evaluate(() => {
            const evt = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window
            });
            const saveButton = document.querySelector(".Xut6I button"); // Adjust selector as needed
            saveButton.dispatchEvent(evt);
            console.log('Successfully added TM email to non junk list.');
        });
        await delay(1000);

        await browser.close();
        return true;
    } catch (error) {
        console.error(`TM address already added on: ${email}`);
        return false
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

//Input the path to your logs.txt file
redirectConsoleToFile('/Users/path/to/logs.txt');

async function rewriteCsv(csvPath, credentials, successfulEmails) {
    const csvWriter = createCsvWriter({
        path: csvPath,
        header: Object.keys(credentials[0]).map(key => ({id: key, title: key}))
    });

    const remainingCredentials = credentials.filter(({ email }) => !successfulEmails.includes(email));
    console.log(remainingCredentials);
    await csvWriter.writeRecords(remainingCredentials)
        .then(() => console.log('CSV file has been rewritten without successfully processed emails.'));

}

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
        const csvPath = '/Users/path/to/outlookScript.csv';
        await main(csvPath);
    } catch (error) {
        console.error(`Error reading CSV file: ${error}`);
    }
})();
