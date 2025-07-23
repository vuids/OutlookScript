import { delay } from './helperFunctions.js';

/**
 * Mark the "Other" tab for some post-login functionality
 * @param {Object} page - Puppeteer page object
 */
export async function markOtherTab(page) {
    try {
        console.log("📧 Navigating to junk email settings...");
        
        // Navigate to junk email settings
        await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });
        
        // Wait for page to load
        await delay(2000);
        
        // Handle any popups that might appear
        try {
            // Accept All button for privacy popup
            const acceptAllSelector = 'button.ms-Button--primary';
            const acceptAllPopup = await page.$(acceptAllSelector);
            if (acceptAllPopup) {
                console.log("Detected 'Accept All' popup. Clicking the button...");
                await acceptAllPopup.click();
                await delay(1000);
            }

            // Choose layout popup
            const chooseLayoutSelector = 'div.lgJQK';
            const layoutPopup = await page.$(chooseLayoutSelector);
            if (layoutPopup) {
                console.log("Detected 'Choose Your Outlook Layout' popup. Clicking anywhere...");
                await page.click('body');
                await delay(1000);
            }
        } catch (popupError) {
            console.warn(`Popup handling warning: ${popupError.message}`);
        }

        // Add safe sender
        try {
            console.log("Adding safe sender...");
            await addSafeSender(page);
        } catch (safeError) {
            console.warn(`Safe sender error: ${safeError.message}`);
        }
        
        console.log("✅ Post-login tasks completed");
        
    } catch (error) {
        console.error(`Error in markOtherTab: ${error.message}`);
        // Don't throw - this is a non-critical operation
    }
}

/**
 * Add a safe sender to the junk email settings
 * @param {Object} page - Puppeteer page object
 */
async function addSafeSender(page) {
    try {
        console.log("Adding safe sender to junk email settings...");
        
        // Wait for the page to be ready
        await page.waitForSelector('div[role="heading"]', { visible: true, timeout: 10000 });

        // Look for the "Add safe sender" button
        const addButtonXPath = "//button[contains(., 'Add safe sender')]";
        const [addSafeSenderButton] = await page.$x(addButtonXPath);

        if (addSafeSenderButton) {
            await page.evaluate((button) => button.scrollIntoView(), addSafeSenderButton);
            await addSafeSenderButton.click();
            console.log("Clicked Add Safe Sender button.");

            // Wait for the input field
            const dynamicInputSelector = 'input[placeholder="Example: abc123@fourthcoffee.com for sender, fourthcoffee.com for domain."]';
            await page.waitForSelector(dynamicInputSelector, { visible: true, timeout: 5000 });
            
            // Type the safe sender email
            await page.type(dynamicInputSelector, 'customer_support@email.ticketmaster.com');

            // Click OK
            const okButtonXPath = "//button[contains(text(), 'OK')]";
            const [okButton] = await page.$x(okButtonXPath);
            if (okButton) {
                await page.evaluate((button) => button.scrollIntoView(), okButton);
                await okButton.click();
                console.log("Clicked OK button.");
            } else {
                console.warn("OK button not found.");
            }

            // Click Save
            const saveButtonXPath = "//button[contains(text(), 'Save')]";
            const [saveButton] = await page.$x(saveButtonXPath);
            if (saveButton) {
                await page.evaluate((button) => button.scrollIntoView(), saveButton);
                await saveButton.click();
                console.log("Clicked Save button.");
            } else {
                console.warn("Save button not found.");
            }

            await delay(1000);
            console.log("✅ Safe sender added successfully");
        } else {
            console.warn("Add Safe Sender button not found.");
        }
    } catch (error) {
        console.error(`Error during the Safe Sender process: ${error.message}`);
        throw error;
    }
}