import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import clipboard from 'clipboardy';
import { delay, saveCookies, loadCookies, robustClick } from './helperFunctions.js';

puppeteer.use(StealthPlugin());

const endpointActions = [
    {
        urls: ['https://privacynotice.account.microsoft.com/notice'],
        selectors: ['#id__0', 'button.ms-Button--primary'], // Add multiple selectors
        action: async (page) => {
            console.log("Attempting to click 'OK' on Privacy Notice.");

            let success = false;

            for (const selector of ['#id__0', 'button.ms-Button--primary']) {
                success = await robustClick(page, selector, 3);
                if (success) {
                    console.log(`Successfully clicked button with selector "${selector}" on Privacy Notice.`);
                    break;
                }
            }

            if (!success) {
                console.warn("Clicking 'OK' failed after retries. Trying 'Enter' key as a fallback...");
                await page.keyboard.press('Enter'); // Simulate pressing Enter as a fallback
                await delay(2000); // Allow time for potential navigation
            }
        },
    },
    {
        urls: ['https://account.live.com/tou/accrue'],
        selector: '#iNext',
        action: async (page) => {
            console.log("Attempting to click 'Next' on Terms of Use Accrual.");
            const success = await robustClick(page, '#iNext', 3);
            if (!success) {
                console.warn("Clicking 'Next' failed after retries. Trying 'Enter' key as a fallback...");
                await page.keyboard.press('Enter'); // Simulate pressing Enter as a fallback
                await delay(2000); // Allow time for potential navigation
            }
        },
    },
    // Other endpoint actions remain unchanged...
    {
        urls: ['https://login.live.com/ppsecure/post.srf', 'https://login.live.com/login.srf'],
        selector: '#acceptButton',
        action: async (page) => {
            console.log("Clicked 'Yes' on Stay Signed In.");
            await robustClick(page, '#acceptButton', 3);
        },
        failCondition: async (page) => {
            const blockedMessage = await page.evaluate(() => {
                return document.body.innerText.includes("Sign-in is blocked");
            });
            return blockedMessage;
        },
        failLog: "Sign-in is blocked. You've tried to sign in too many times with an incorrect account or password."
    },
    {
        urls: ['https://account.live.com/proofs/remind'],
        selector: '#iLooksGood',
        action: async (page) => {
            console.log("Clicked 'Looks Good' on Security Info Reminder.");
            await robustClick(page, '#iLooksGood', 3);
        },
    },
    {
        urls: ['https://account.live.com/interrupt/passkey'],
        selector: 'button[aria-label="Skip for now"]',
        action: async (page) => {
            console.log("Clicked 'Skip for now' on Passkey Setup.");
            await robustClick(page, 'button[aria-label="Skip for now"]', 3);
        },
    },
    {
        urls: ['https://account.microsoft.com/account-checkup'],
        action: async (page) => {
            console.log("Reached Account Checkup. Waiting for 2 seconds to check for redirection...");

            await delay(2000); // Wait to see if the page redirects naturally

            const currentUrl = page.url();
            if (currentUrl.includes('account-checkup')) {
                console.log("Still on Account Checkup. Attempting to click the 'X' button.");

                // Define the selector for the "X" button
                const xButtonSelector = 'i[data-icon-name="Cancel"]';

                try {
                    const xButton = await page.$(xButtonSelector);

                    if (xButton) {
                        await xButton.click();
                        console.log("Clicked the 'X' button to dismiss Account Checkup.");
                        await delay(1000); // Allow time for any resulting actions
                    } else {
                        console.warn("The 'X' button was not found. Skipping action.");
                    }
                } catch (error) {
                    console.error(`Error clicking 'X' button on Account Checkup: ${error.message}`);
                }

                // Attempt to navigate directly to the Junk Email settings after clicking "X"
                console.log("Attempting navigation to Junk Email Settings...");
                await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', {
                    waitUntil: 'networkidle2',
                    timeout: 30000,
                });
            }
        },
    },

];

async function handleDynamicLoginFlow(page) {
    let currentUrl = page.url();

    while (!currentUrl.includes('outlook.live.com/mail/0/options/mail/junkEmail')) {
        console.log(`Current URL: ${currentUrl}`);

        const baseUrl = currentUrl.split('?')[0];
        const actionConfig = endpointActions.find((config) =>
            config.urls.some((url) => baseUrl.startsWith(url))
        );

        if (actionConfig) {
            try {
                await actionConfig.action(page);
                console.log(`Handled endpoint: ${baseUrl}`);
            } catch (error) {
                console.error(`Error handling endpoint ${baseUrl}: ${error.message}`);
                if (actionConfig.failCondition && (await actionConfig.failCondition(page))) {
                    console.error(actionConfig.failLog);
                    return false;
                }
            }
        } else {
            console.warn(`Unhandled URL: ${currentUrl}. Retrying navigation in 2 seconds...`);
            await delay(2000);
        }

        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        } catch {
            console.log("No navigation detected, continuing loop...");
        }

        currentUrl = page.url();
    }

    console.log(`Final URL: ${currentUrl}`);
    return currentUrl.includes('outlook.live.com/mail/0/options/mail/junkEmail');
}

async function addSafeSender(page) {
    console.log("Navigating to Safe Sender Settings...");
    await page.waitForSelector('div[role="heading"]', { visible: true });

    const addButtonXPath = "//button[contains(., 'Add safe sender')]";
    const [addSafeSenderButton] = await page.$x(addButtonXPath);

    if (addSafeSenderButton) {
        await page.evaluate((button) => button.scrollIntoView(), addSafeSenderButton);
        await addSafeSenderButton.click();
        console.log("Clicked Add Safe Sender button.");

        const dynamicInputSelector = 'input[placeholder="Example: abc123@fourthcoffee.com for sender, fourthcoffee.com for domain."]';
        await page.waitForSelector(dynamicInputSelector, { visible: true });
        await page.type(dynamicInputSelector, 'customer_support@email.ticketmaster.com');

        const okButtonXPath = "//button[contains(text(), 'OK')]";
        const [okButton] = await page.$x(okButtonXPath);
        if (okButton) {
            await page.evaluate((button) => button.scrollIntoView(), okButton);
            await okButton.click();
            console.log("Clicked OK button.");
        } else {
            console.error("OK button not found.");
        }

        const saveButtonXPath = "//button[contains(text(), 'Save')]";
        const [saveButton] = await page.$x(saveButtonXPath);
        if (saveButton) {
            await page.evaluate((button) => button.scrollIntoView(), saveButton);
            await saveButton.click();
            console.log("Clicked Save button.");
        } else {
            console.error("Save button not found.");
        }

        await delay(1000);
    } else {
        console.error("Add Safe Sender button not found.");
    }
}

export async function mainWithCredentials(email, password, proxyInfo, twofa) {
    const [ip, port, name, pwd] = proxyInfo.split(':');
    const proxyUrl = `http://${ip}:${port}`;

    const browser = await puppeteer.launch({
        headless: false,
        args: [`--proxy-server=${proxyUrl}`],
    });

    try {
        const page = await browser.newPage();

        if (await loadCookies(page, email)) {
            console.log("Cookies loaded successfully, checking for access...");
            await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail');
            if (page.url().includes('outlook.live.com/mail/0/options/mail/junkEmail')) {
                console.log(`Access successful for ${email} using cookies.`);
                await addSafeSender(page);
                await browser.close();
                return { email, success: true };
            }
            console.log("Cookies failed; proceeding with login.");
        }

        await page.authenticate({ username: name, password: pwd });
        await page.goto('https://login.live.com', { waitUntil: 'networkidle2' });

        console.log("Email input loaded. Pasting email.");
        await page.waitForSelector('#i0116', { visible: true });
        await page.type('#i0116', email);
        await page.click('#idSIButton9');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        console.log("Password input loaded. Pasting password.");
        await page.waitForSelector('#i0118', { visible: true });
        await page.type('#i0118', password);
        await page.click('#idSIButton9');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        console.log("Handling 2FA.");

        let twofaRetries = 3;
        let twofaCode;

        while (twofaRetries > 0) {
            try {
                const page2 = await browser.newPage();
                await page2.goto('https://2fa.live');
                await delay(500);

                await page2.waitForSelector('#listToken', { timeout: 5000 });
                await page2.type('#listToken', twofa);
                await page2.click('#submit');

                await delay(1000);

                // Retrieve 2FA code
                twofaCode = await page2.evaluate(() => {
                    const inputElement = document.querySelector('#output');
                    return inputElement ? inputElement.value.split('|')[1].trim() : null;
                });

                if (!twofaCode) {
                    throw new Error('Failed to retrieve 2FA code from 2fa.live.');
                }

                clipboard.writeSync(twofaCode);
                console.log(`Retrieved 2FA code: ${twofaCode}`);
                await page2.close();

                // Attempt to enter the 2FA code
                console.log("Attempting to enter 2FA code.");
                await page.bringToFront();
                await page.waitForSelector('#idTxtBx_SAOTCC_OTC', { timeout: 5000 });
                await page.type('#idTxtBx_SAOTCC_OTC', twofaCode);
                await delay(500);

                // Check if the page remains on "Enter code"
                const stillOnEnterCode = await page.evaluate(() => {
                    const heading = document.querySelector('#idDiv_SAOTCC_Title');
                    return heading && heading.innerText.includes('Enter code');
                });

                if (stillOnEnterCode) {
                    console.warn("Initial 2FA code entry failed. Attempting CMD + V paste as a failsafe.");
                    await page.focus('#idTxtBx_SAOTCC_OTC');
                    await page.keyboard.down('Meta');
                    await page.keyboard.press('V');
                    await page.keyboard.up('Meta');
                    await delay(500);
                }

                console.log("Clicking Submit after entering 2FA code.");
                await page.click('#idSubmit_SAOTCC_Continue');

                // Wait for navigation
                try {
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
                    console.log("Navigation successful after entering 2FA code.");
                    break; // Exit loop on success
                } catch (navError) {
                    console.error("Navigation did not complete after entering 2FA code.");
                }
            } catch (error) {
                console.error(`2FA submission failed: ${error.message}. Retries left: ${twofaRetries - 1}`);
            }

            twofaRetries--;
        }

        if (twofaRetries === 0) {
            console.error("Failed to complete 2FA submission after retries.");
            throw new Error("Failed to complete 2FA submission after retries.");
        }

        console.log("Handling dynamic login flow...");
        const success = await handleDynamicLoginFlow(page);

        if (success) {
            console.log("Successfully navigated to Junk Email Settings.");
            await saveCookies(page, email);
            await addSafeSender(page);
            await browser.close();
            return { email, success: true };
        } else {
            console.error("Failed to navigate to Junk Email Settings.");
        }

        await saveCookies(page, email);
        console.log(`Successfully saved cookies for ${email}`);
        await browser.close();

        return { email, success: true };

    } catch (error) {
        console.error(`Error during login process for ${email}: ${error.message}`);
        await browser.close(); // Ensure the browser closes on error
        return { email, success: false, error: error.message };
    }
}
