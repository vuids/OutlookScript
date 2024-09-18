import { delay } from './helperFunctions.js';
import puppeteer from 'puppeteer';
import clipboard from "clipboardy";

export async function mainWithCredentials(email, password, proxyInfo, twofa) {
    const [ip, port, name, pwd] = proxyInfo.split(':');
    const proxyUrl = `http://${ip}:${port}`;
    const safeSenderEmail = 'customer_support@email.ticketmaster.com'; // The email you want to add as a safe sender

    const browser = await puppeteer.launch({
        headless: false, // Set to true for production or false for debugging
        args: [`--proxy-server=${proxyUrl}`],
    });

    try {
        const page = await browser.newPage();
        page.on('dialog', async dialog => {
            if (dialog.type() === 'alert' && dialog.message().includes('proxy')) {
                await dialog.dismiss();
            }
        });

        // Authenticate with the proxy
        await page.authenticate({
            username: name,
            password: pwd,
        });

        // Navigate to Microsoft login page
        console.log("Logging in to Microsoft...");
        await page.goto('https://login.microsoftonline.com/', { waitUntil: 'networkidle2' });

        // Enter email and proceed
        await page.waitForSelector('#i0116');
        await page.type('#i0116', email);
        await page.click('#idSIButton9');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

        // Enter password and proceed
        await page.waitForSelector('#i0118');
        await page.type('#i0118', password);
        await page.click('#idSIButton9');

        // Immediately navigate to the 2FA page
        const page2 = await browser.newPage();
        await page2.goto('https://2fa.live');
        await page2.waitForSelector('#listToken');
        await page2.type('#listToken', twofa);
        await page2.click('#submit');
        await delay(1000);

        const twofaCode = await page2.evaluate(() => {
            const inputElement = document.querySelector('#output');
            if (inputElement) {
                const inputValue = inputElement.value;
                const parts = inputValue.split('|');
                if (parts.length > 1) {
                    return parts[1].trim();
                } else {
                    throw new Error(`2FA code format not recognized.`);
                }
            } else {
                throw new Error('Input element for 2FA code not found.');
            }
        });

        clipboard.writeSync(twofaCode);

        // Switch back to the login page and enter the 2FA code
        await page.bringToFront();
        await page.waitForSelector('#idTxtBx_SAOTCC_OTC');
        await page.type('#idTxtBx_SAOTCC_OTC', clipboard.readSync());
        await page.click('#idSubmit_SAOTCC_Continue');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        console.log("Two-Factor Authentication completed.");

        // Handle the "Stay signed in?" prompt
        try {
            await page.waitForSelector('#acceptButton', { visible: true, timeout: 10000 }); // Wait for the "Yes" button
            await page.click('#acceptButton'); // Click "Yes" to stay signed in
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
            console.log("Clicked 'Yes' to stay signed in.");
        } catch (err) {
            console.log("'Stay signed in' prompt not found. Proceeding...");
        }

        // Add delay to ensure the page is stable before proceeding to Junk Email settings
        console.log("Waiting for the page to stabilize...");
        await delay(2000);

        // Navigate to the Junk Email Settings page
        console.log("Navigating to Junk Email Settings...");
        await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Ensure the Junk Email section is loaded by checking for a visible heading
        await page.waitForSelector('div[role="heading"]', { visible: true, timeout: 30000 });
        console.log("Junk Email page loaded.");

        // Check if the email is already in the safe sender list
        console.log(`Checking if ${safeSenderEmail} is already in the Safe Sender list...`);
        const isEmailInSafeSenderList = await page.evaluate((safeSenderEmail) => {
            const safeSenderElements = Array.from(document.querySelectorAll('div.amE0I span'));
            return safeSenderElements.some((element) => element.textContent.trim() === safeSenderEmail);
        }, safeSenderEmail);

        if (isEmailInSafeSenderList) {
            console.log(`${safeSenderEmail} is already in the Safe Sender list. Exiting...`);
            await browser.close();
            return { email, success: true };
        }

        // Add safe sender functionality (existing code)
        const addButtonXPath = "//button[contains(., 'Add safe sender')]";
        const [addSafeSenderButton] = await page.$x(addButtonXPath);

        if (addSafeSenderButton) {
            await page.evaluate((button) => button.scrollIntoView(), addSafeSenderButton);
            await addSafeSenderButton.click();
            console.log("Clicked Add Safe Sender button.");

            // Wait for the dynamic input field
            const dynamicInputSelector = 'input[placeholder="Example: abc123@fourthcoffee.com for sender, fourthcoffee.com for domain."]';
            await page.waitForSelector(dynamicInputSelector, { visible: true, timeout: 10000 });

            // Type the email you want to add
            await page.type(dynamicInputSelector, safeSenderEmail);

            // Confirm by clicking OK
            const okButtonXPath = "//button[contains(text(), 'OK')]";
            const [okButton] = await page.$x(okButtonXPath);
            if (okButton) {
                await page.evaluate((button) => button.scrollIntoView(), okButton);
                await okButton.click();
                console.log("Clicked OK button.");
            } else {
                console.error("OK button not found.");
            }

            // Save the changes by clicking Save
            const saveButtonXPath = "//button[contains(text(), 'Save')]";
            const [saveButton] = await page.$x(saveButtonXPath);
            if (saveButton) {
                await page.evaluate((button) => button.scrollIntoView(), saveButton);
                await saveButton.click();
                console.log("Clicked Save button.");
            } else {
                console.error("Save button not found.");
            }

            await delay(1000); // Wait to ensure everything is processed
        } else {
            console.error("Add Safe Sender button not found.");
        }

        await delay(1000);
        await browser.close();
        return { email, success: true };

    } catch (error) {
        console.error(`Error occurred: ${error.message}`);
        await browser.close();
        return { email, success: false };
    }
}
