import { delay } from './helperFunctions.js';
import puppeteer from 'puppeteer';
import clipboard from "clipboardy";

export async function mainWithCredentials(email, password, proxyInfo, twofa) {
    const [ip, port, name, pwd] = proxyInfo.split(':');
    const proxyUrl = `http://${ip}:${port}`;

    const browser = await puppeteer.launch({
        headless: true,
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

        console.log(`Successfully logged in for email: ${email} on proxy: ${proxyUrl}`);
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
                console.log('Successfully added TM to non junk list.');
            } else {
                console.log(result); // Handle other outcomes, e.g., button found but not clicked
            }
        } catch (error) {
            console.log('TM email already added to safe sender list, all set!'); // Handle the timeout case or other errors
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

