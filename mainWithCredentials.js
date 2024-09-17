import { delay } from './helperFunctions.js';
import puppeteer from 'puppeteer';
import clipboard from "clipboardy";

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



// Navigate to the junk email settings page
        await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail');
        await delay(4000);

// Ensure the Junk Email section is loaded by checking for a visible, stable element like the heading
        await page.waitForSelector('div[role="heading"]', { visible: true });

// Scroll to the Add Safe Sender button (use XPath or a stable selector)
        const addButtonXPath = "//button[contains(., 'Add safe sender')]";
        const [addSafeSenderButton] = await page.$x(addButtonXPath);

        if (addSafeSenderButton) {
            // Scroll into view if needed (sometimes buttons are outside the view and can't be clicked directly)
            await page.evaluate((button) => {
                button.scrollIntoView();
            }, addSafeSenderButton);

            // Click the Add Safe Sender button
            await addSafeSenderButton.click();
            console.log("Clicked Add Safe Sender button.");

            // Wait for the dynamic input field to appear after clicking "Add Safe Sender"
            const dynamicInputSelector = 'input[placeholder="Example: abc123@fourthcoffee.com for sender, fourthcoffee.com for domain."]';
            await page.waitForSelector(dynamicInputSelector, { visible: true });

            // Type the email you want to add
            await page.type(dynamicInputSelector, 'customer_support@email.ticketmaster.com');

            // Click the "OK" button to confirm the safe sender entry
            const okButtonXPath = "//button[contains(text(), 'OK')]";  // XPath for the "OK" button
            const [okButton] = await page.$x(okButtonXPath);

            if (okButton) {
                await page.evaluate((button) => button.scrollIntoView(), okButton);  // Scroll into view if necessary
                await okButton.click();
                console.log("Clicked OK button.");
            } else {
                console.error("OK button not found.");
            }

            // Wait for a short delay to ensure the email is confirmed
            await delay(1000);

            // Now click the "Save" button to finalize
            const saveButtonXPath = "//button[contains(text(), 'Save')]";  // XPath for the "Save" button
            const [saveButton] = await page.$x(saveButtonXPath);

            if (saveButton) {
                await page.evaluate((button) => button.scrollIntoView(), saveButton);  // Scroll into view if necessary
                await saveButton.click();
                console.log("Clicked Save button.");
            } else {
                console.error("Save button not found.");
            }

            // Optionally wait to ensure everything is processed
            await delay(1000);
        } else {
            console.error("Add Safe Sender button not found.");
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
