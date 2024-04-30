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
    const [ip, port, name, pwd] = proxyInfo.split(':');
    const proxyUrl = `http://${ip}:${port}`;
    const logStream = fs.createWriteStream('logs.txt', { flags: 'a' }); // Open log file for appending

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
        await delay(1000);

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

        console.log(`1.) Successfully logged in for email: ${email} on proxy: ${proxyUrl}`);
        await delay(500);

        // Navigate to Junk Settings
        await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail');
        await delay(4000);

        // Activating page
        const result = await page.evaluate(() => {
            const x = window.innerWidth / 2;
            const y = window.innerHeight / 2;
            const element = document.elementFromPoint(x, y);
            if (element) {
                element.click(); // Directly click the element
                return element.outerHTML; // Return the outer HTML for debugging
            } else {
                return 'No element found at the center of the screen.';
            }
        });
        await page.waitForSelector('span[id="options-full-safeSendersDomainsV2"]', {visible: true}); // Ensure the heading is loaded and visible.

        const addButtonXPath = "//span[@id='options-full-safeSendersDomainsV2']/following::button[contains(@class, 'ms-Button--command')][1]";
        await page.waitForXPath(addButtonXPath, {visible: true, timeout: 30000}); // Wait for the 'Add' button to be visible

        const [addButton] = await page.$x(addButtonXPath);
        if (addButton) {
            await addButton.click();
            //console.log("Add button clicked successfully.");
        } else {
            console.error("Add button not found.");
        }


        await delay(1000);
        await page.waitForSelector('input[placeholder="Example: abc123@fourthcoffee.com for sender, fourthcoffee.com for domain."]', {visible: true});
        await page.type('input[placeholder="Example: abc123@fourthcoffee.com for sender, fourthcoffee.com for domain."]', 'customer_support@email.ticketmaster.com');

        await page.keyboard.press('Enter');
        await delay(500);



        try {
            // Wait for the save button to be visible, implying it's interactable
            await page.waitForSelector(".Xut6I button", { visible: true, timeout: 5000 });

            // Execute the click via JavaScript in the browser context
            let result = await page.evaluate(() => {
                const saveButton = document.querySelector(".Xut6I button");
                if (saveButton) {
                    saveButton.click();  // Use click() if dispatchEvent is not necessary
                    return 'Clicked';
                }
                return 'Button found but failed to click'; // In case something else prevents clicking
            });

            if (result === 'Clicked') {
                await delay(1000);
                console.log('2.) Successfully added TM to non junk list.');
            } else {
                console.log(result); // Handle other outcomes, e.g., button found but not clicked
            }
        } catch (error) {
            console.log('2.) TM email already added to safe sender list, all set!'); // Handle the timeout case or other errors
        }

        await delay(1000);
        await browser.close();
        return true;
    } catch (error) {

        console.log(error);
        await browser.close();
        return false
    }
    //browser.close();
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
//************************************
redirectConsoleToFile('/Users/Path/to/Files/OutlookScript/logs.txt');

async function rewriteCsv(csvPath, credentials, successfulEmails) {
    const timestamp = format(new Date(), 'yyyyMMddHHmmss'); // Formats date as YYYYMMDDHHMMSS
    const newPath = csvPath.replace(/(\.csv)$/, `_${timestamp}$1`); // Appends timestamp before the file extension

    const csvWriter = createCsvWriter({
        path: newPath,
        header: [
            {id: 'email', title: 'email'},
            {id: 'password', title: 'password'},
            {id: 'proxy_str', title: 'proxy_str'},
            {id: 'twofa', title: 'twofa'}
        ]
    });

    const remainingCredentials = credentials.filter(({ email }) => !successfulEmails.includes(email));
    console.log(remainingCredentials);
    await csvWriter.writeRecords(remainingCredentials)
        .then(() => console.log(`CSV file has been created at ${newPath} without successfully processed emails.`));
}

function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                //console.log(`Read data: ${JSON.stringify(data)}`);  // Log each row as it's read
                const cleanedData = {};
                for (const key in data) {
                    cleanedData[key.trim()] = data[key].trim();  // Trim keys and values to remove unexpected whitespace
                }
                results.push(cleanedData);
            })
            .on('end', () => {
                //console.log(`Final parsed results: ${JSON.stringify(results)}`);
                resolve(results);
            })
            .on('error', (error) => {
                //console.error('Error reading CSV:', error);
                reject(error);
            });
    });


}


(async () => {
    try {
        //****************************************************************
        //Change to the path on your device that contains the CSV for input
        const csvPath = '/Users/Path/To/File/OutlookScript/outlookScript.csv';
        await main(csvPath);
    } catch (error) {
        console.error(`Error reading CSV file: ${error}`);
    }
})();
