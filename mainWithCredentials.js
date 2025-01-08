import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import clipboard from 'clipboardy';
import { delay, saveCookies, loadCookies, robustClick } from './helperFunctions.js';

puppeteer.use(StealthPlugin());

// Handles dynamic login flow and navigation to Junk Email Settings
async function handleDynamicLoginFlow(page) {
    const endpointActions = [
        {
            urls: [
                'https://login.live.com/ppsecure/post.srf',
                'https://login.live.com/login.srf',
            ],
            selector: '#acceptButton',
            action: async () => {
                console.log("Clicked 'Yes' on Stay Signed In");
                await robustClick(page, '#acceptButton', 3);
                console.log("Clicked Stay Signed In. Waiting for navigation...");
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
            },
        },
        {
            urls: [
                'https://privacynotice.account.microsoft.com/notice',
            ],
            selector: 'button.ms-Button--primary',
            action: async () => {
                console.log("Clicked 'OK' on Privacy Notice");
                await robustClick(page, 'button.ms-Button--primary', 3);
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            },
        },
        {
            urls: [
                'https://account.microsoft.com/account-checkup',
            ],
            action: async () => {
                console.log("Reached Account Checkup, reloading to Junk Email Settings...");
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', {
                            waitUntil: 'networkidle2',
                            timeout: 30000,
                        });
                        console.log("Successfully navigated to Junk Email Settings.");
                        return true;
                    } catch (error) {
                        console.error(`Attempt ${attempt} failed to navigate to Junk Email Settings: ${error.message}`);
                        await delay(2000);
                    }
                }
                throw new Error("Failed to navigate to Junk Email Settings after Account Checkup.");
            },
        },
        {
            urls: [
                'https://account.live.com/interrupt/passkey',
            ],
            selector: 'button[aria-label="Next"]',
            action: async () => {
                console.log("Clicked 'Next' on Passkey Interrupt");
                await robustClick(page, 'button[aria-label="Next"]', 3);
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            },
        },
        {
            urls: [
                'https://account.live.com/proofs/remind',
            ],
            selector: '#iLooksGood',
            action: async () => {
                console.log("Clicked 'Looks Good' on Is your security info still accurate?");
                await robustClick(page, '#iLooksGood', 3);
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            },
        },
        {
            urls: [
                'https://account.live.com/tou/accrue',
            ],
            selector: '#iNext',
            action: async () => {
                console.log("Clicked 'Next' on We're updating our terms");
                await robustClick(page, '#iNext', 3);
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            },
        },
    ];

    let currentUrl = page.url();

    while (!currentUrl.includes('outlook.live.com/mail/0/options/mail/junkEmail')) {
        console.log(`Current URL: ${currentUrl}`);

        const baseUrl = currentUrl.split('?')[0];
        const actionConfig = endpointActions.find((config) =>
            config.urls.some((url) => baseUrl.startsWith(url))
        );

        if (actionConfig) {
            const { action } = actionConfig;

            try {
                await action(); // Perform the action (click or navigation)
            } catch (error) {
                console.error(`Error handling URL: ${baseUrl} - ${error.message}`);
                break;
            }
        } else {
            console.log(`Unhandled URL: ${currentUrl}, retrying in 2 seconds...`);
            await delay(2000);

            // Fallback: Attempt navigation to Junk Email Settings if stuck on unhandled URLs
            try {
                await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', {
                    waitUntil: 'networkidle2',
                    timeout: 20000,
                });
                currentUrl = page.url();
                continue;
            } catch (error) {
                console.error(`Fallback navigation to Junk Email Settings failed: ${error.message}`);
            }
        }

        currentUrl = page.url();
    }

    console.log(`Final URL: ${currentUrl}`);
    if (currentUrl.includes('outlook.live.com/mail/0/options/mail/junkEmail')) {
        console.log("Successfully navigated to Junk Email Settings.");
        return true;
    } else {
        console.error("Failed to navigate to Junk Email Settings.");
        return false;
    }
}

// Main function to handle login and save cookies
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
            await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', {
                waitUntil: 'networkidle2',
                timeout: 15000,
            });
            if (page.url().includes('outlook.live.com/mail/0/options/mail/junkEmail')) {
                console.log(`Access successful for ${email} using cookies.`);
                await browser.close();
                return { email, success: true };
            }
            console.log("Cookies failed; proceeding with login.");
        }

        await page.authenticate({ username: name, password: pwd });
        await page.goto('https://login.live.com', { waitUntil: 'networkidle2' });

        console.log("Email input loaded. Pasting email.");
        await robustClick(page, '#i0116');
        await page.keyboard.type(email);
        await robustClick(page, '#idSIButton9');

        console.log("Password input loaded. Pasting password.");
        await robustClick(page, '#i0118');
        await page.keyboard.type(password);
        await robustClick(page, '#idSIButton9');

        console.log("Handling 2FA.");
        const page2 = await browser.newPage();
        await page2.goto('https://2fa.live');
        await delay(500);
        await page2.type('#listToken', twofa);
        await page2.click('#submit');
        await delay(1000);

        const twofaCode = await page2.evaluate(() => {
            const inputElement = document.querySelector('#output');
            return inputElement ? inputElement.value.split('|')[1].trim() : null;
        });

        await page.bringToFront();
        await page.keyboard.type(twofaCode);
        await robustClick(page, '#idSubmit_SAOTCC_Continue');

        console.log("Handling dynamic login flow...");
        const loginSuccess = await handleDynamicLoginFlow(page);
        if (loginSuccess) {
            console.log(`Successfully logged in for ${email}.`);
            await saveCookies(page, email);
            console.log(`Cookies saved for ${email}.`);
            await browser.close();
            return { email, success: true };
        } else {
            throw new Error("Dynamic login flow failed.");
        }
    } catch (error) {
        console.error(`Error during login process: ${error.message}`);
        await browser.close();
        return { email, success: false, error: error.message };
    }
}
