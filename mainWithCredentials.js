import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import clipboard from 'clipboardy';
import { delay, saveCookies, loadCookies } from './helperFunctions.js';

puppeteer.use(StealthPlugin());

async function clickWithRedundancy(page, primarySelector, fallbackText, maxRetries = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Attempt to click the element using the primary selector
            const element = await page.$(primarySelector);
            if (element) {
                console.log(`Found element with selector "${primarySelector}" on attempt ${attempt}. Clicking...`);
                await element.click();
                return true;
            } else {
                console.log(`Element with selector "${primarySelector}" not found. Checking fallback...`);
            }

            // Fallback: Search for the element based on its text content
            const elements = await page.$$('body *');
            for (const el of elements) {
                const textContent = await page.evaluate(el => el.textContent, el);
                if (textContent && textContent.includes(fallbackText)) {
                    console.log(`Found element with text "${fallbackText}" on attempt ${attempt}. Clicking...`);
                    await el.click();
                    return true;
                }
            }

            console.log(`Fallback element with text "${fallbackText}" not found. Retrying (${attempt}/${maxRetries})...`);
        } catch (error) {
            console.error(`Error clicking element with selector "${primarySelector}" or text "${fallbackText}" on attempt ${attempt}: ${error.message}`);
        }
        await delay(delayMs); // Wait before retrying
    }
    console.error(`Failed to click element with selector "${primarySelector}" or text "${fallbackText}" after ${maxRetries} attempts.`);
    return false;
}

export async function handleDynamicLoginFlow(page, browser) {
    const endpointActions = {
        'https://privacynotice.account.microsoft.com/notice': {
            selector: 'button.ms-Button--primary',
            fallbackText: 'OK',
            action: 'click',
            log: "Clicked 'OK' on Privacy Notice",
        },
        'https://login.live.com/login.srf': {
            selector: '#acceptButton',
            fallbackText: 'Yes',
            action: 'click',
            log: "Clicked 'Yes' on Stay Signed In",
        },
        'https://account.microsoft.com/account-checkup': {
            action: 'reload',
            log: "Reached Account Checkup, reloading to Outlook",
        },
        'https://account.live.com/interrupt/passkey': {
            selector: 'button[aria-label="Skip for now"]',
            fallbackText: 'Skip for now',
            action: 'click',
            log: "Clicked 'Skip for now' on Passkey Interrupt",
        },
    };

    let currentUrl = page.url();

    while (!currentUrl.includes('outlook.live.com/mail/0/?bO=1')) {
        console.log(`Current URL: ${currentUrl}`);

        const baseUrl = currentUrl.split('?')[0];
        const endpoint = Object.keys(endpointActions).find(key => baseUrl.startsWith(key));

        if (endpoint) {
            const { selector, fallbackText, action, log } = endpointActions[endpoint];
            if (log) console.log(log);

            if (action === 'click' && (selector || fallbackText)) {
                const clicked = await clickWithRedundancy(page, selector, fallbackText, 3, 2000);
                if (clicked) {
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
                } else {
                    console.error(`Failed to handle endpoint: ${endpoint}`);
                    break;
                }
            } else if (action === 'reload') {
                console.log('Reloading page to Outlook...');
                await page.goto('https://outlook.live.com/mail/0/?bO=1', { waitUntil: 'networkidle2' });
                break;
            }
        } else {
            console.log(`Unhandled URL: ${currentUrl}, retrying in 2 seconds...`);
            await delay(2000);
        }

        currentUrl = page.url();
    }

    console.log(`Final URL: ${currentUrl}`);
    if (currentUrl.includes('outlook.live.com/mail/0/?bO=1')) {
        console.log("Login flow completed successfully.");
        return true;
    } else {
        console.error("Failed to complete the login flow. Ending process.");
        return false;
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
            await page.goto('https://www.office.com/?auth=1');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            if (page.url().includes('office.com')) {
                console.log(`Access successful for ${email} using cookies.`);
                await browser.close();
                return { email, success: true };
            }
            console.log("Cookies failed; proceeding with login.");
        }

        await page.authenticate({ username: name, password: pwd });
        await page.goto('https://login.live.com', { waitUntil: 'networkidle2' });

        console.log("Email input loaded. Pasting email.");
        await page.waitForSelector('#i0116', { visible: true });
        await page.click('#i0116');
        await page.keyboard.type(email);
        await page.click('#idSIButton9');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        console.log("Password input loaded. Pasting password.");
        await page.waitForSelector('#i0118', { visible: true });
        await page.click('#i0118');
        await page.keyboard.type(password);
        await page.click('#idSIButton9');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        console.log("Handling 2FA.");
        const page2 = await browser.newPage();
        await page2.goto('https://2fa.live');
        await delay(500);

        // Retrieve and copy 2FA code with redundancy
        let twofaCode = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await page2.waitForSelector('#listToken');
                await page2.type('#listToken', twofa);
                await page2.click('#submit');
                await delay(1000);

                twofaCode = await page2.evaluate(() => {
                    const inputElement = document.querySelector('#output');
                    return inputElement ? inputElement.value.split('|')[1].trim() : null;
                });

                if (twofaCode) {
                    clipboard.writeSync(twofaCode);
                    console.log(`2FA code retrieved successfully on attempt ${attempt}.`);
                    break;
                } else {
                    console.log(`Failed to retrieve 2FA code on attempt ${attempt}. Retrying...`);
                }
            } catch (error) {
                console.error(`Error retrieving 2FA code on attempt ${attempt}: ${error.message}`);
            }
            await delay(2000);
        }

        if (!twofaCode) {
            throw new Error("Failed to retrieve 2FA code after 3 attempts.");
        }

        // Pasting and submitting the 2FA code with redundancy
        await page.bringToFront();
        await page.waitForSelector('#idTxtBx_SAOTCC_OTC', { visible: true });

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`Attempting to paste and submit 2FA code (Attempt ${attempt})...`);
                await page.focus('#idTxtBx_SAOTCC_OTC');
                await page.keyboard.type(clipboard.readSync(), { delay: 100 });
                await page.click('#idSubmit_SAOTCC_Continue');
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });

                console.log("2FA code submitted successfully.");
                break;
            } catch (error) {
                console.error(`Error submitting 2FA code on attempt ${attempt}: ${error.message}`);
                if (attempt === 3) {
                    throw new Error("Failed to submit 2FA code after 3 attempts.");
                }
                await delay(2000);
            }
        }

        console.log("Handling dynamic login flow...");
        const result = await handleDynamicLoginFlow(page, browser);
        if (!result) {
            console.error(`Login flow failed for ${email}.`);
            await browser.close();
            return { email, success: false, error: "Dynamic login flow failed." };
        }

        console.log(`Successfully logged in for ${email}.`);
        await saveCookies(page, email);
        await browser.close();
        return { email, success: true };
    } catch (error) {
        console.error(`Error during login process: ${error.message}`);
        await browser.close();
        return { email, success: false, error: error.message };
    }
}
