import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import clipboard from 'clipboardy';
import { delay, saveCookies, loadCookies, safeClickAndNavigate, robustClick } from './helperFunctions.js';
import { markOtherTab } from './postLoginTasks.js'; 
import fs from 'fs';
import path from 'path';
import { FrameManager } from 'puppeteer/lib/cjs/puppeteer/common/FrameManager.js';


async function resolveSelector(page, selectors) {
    for (const selector of selectors) {
        if (await page.$(selector)) return selector;
    }
    throw new Error(`None of the selectors found: ${selectors.join(', ')}`);
}
const _origOnFrame = FrameManager.prototype._onFrameNavigated;
FrameManager.prototype._onFrameNavigated = function(event) {
  try {
    return _origOnFrame.call(this, event);
  } catch (err) {
    if (err.message.includes('We either navigate top level')) {
      console.warn('🐛 Swallowed FrameManager assertion:', err.message);
      return;
    }
    throw err;
  }
};
async function resolveElement(page, selectors) {
    for (const selector of selectors) {
        const el = await page.$(selector);
        if (el) return el;
    }
    return null;
}

puppeteer.use(StealthPlugin());

// Streamlined endpoint actions - simplified to avoid getting stuck
const endpointActions = [
    {
        urls: ['https://privacynotice.account.microsoft.com/notice'],
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
                await page.keyboard.press('Enter');
                await delay(2000);
            }
        },
    },
    {
        urls: ['https://account.live.com/tou/accrue'],
        action: async (page) => {
            console.log("Attempting to click 'Next' on Terms of Use Accrual.");
            const success = await robustClick(page, '#iNext', 3);
            if (!success) {
                console.warn("Clicking 'Next' failed after retries. Trying 'Enter' key as a fallback...");
                await page.keyboard.press('Enter');
                await delay(2000);
            }
        },
    },
    {
        urls: ['https://login.live.com/ppsecure/post.srf', 'https://login.live.com/login.srf'],
        action: async (page) => {
            console.log("🔍 On post.srf - checking page type...");
            
            // Check if this is a 2FA page - if so, don't interfere
            const is2FAPage = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return bodyText.includes("Enter code") || 
                       bodyText.includes("verification code") ||
                       bodyText.includes("Enter the code") ||
                       !!document.querySelector('#idTxtBx_SAOTCC_OTC') ||
                       !!document.querySelector('input[name="otc"]') ||
                       !!document.querySelector('input[placeholder*="code"]');
            });
            
            if (is2FAPage) {
                console.log("🔐 This is a 2FA page - skipping endpoint action");
                return; // Don't do anything for 2FA pages
            }
            
            // Only handle "Stay Signed In" if it's actually that page
            const isStaySignedIn = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                return bodyText.includes("Stay signed in") || 
                       bodyText.includes("Stay signed in?") ||
                       !!document.querySelector('button[data-testid="primaryButton"]');
            });
            
            if (isStaySignedIn) {
                console.log("Handling 'Stay Signed In' prompt...");
                try {
                    await page.waitForSelector('button[data-testid="primaryButton"]', { visible: true, timeout: 8000 });
                
                    const staySignedInBtn = await page.$('button[data-testid="primaryButton"]');
                    if (staySignedInBtn) {
                        await page.evaluate(btn => btn.scrollIntoView(), staySignedInBtn);
                        await staySignedInBtn.click();
                        console.log("✅ Clicked 'Yes' on Stay Signed In from endpoint action.");
                        await delay(2000);
                    } else {
                        throw new Error("Stay signed in button not found");
                    }
                } catch (error) {
                    console.warn(`⚠️ Stay signed in handling failed: ${error.message}`);
                }
            } else {
                console.log("🤷 Page doesn't appear to be 2FA or Stay Signed In - no action needed");
            }
        },
        failCondition: async (page) => {
            const blockedMessage = await page.evaluate(() =>
                document.body.innerText.includes("Sign-in is blocked")
            );
            return blockedMessage;
        },
        failLog: "Sign-in is blocked. You've tried to sign in too many times with an incorrect account or password."
    },
    {
        urls: [
            'https://account.live.com/interrupt/passkey',
            'https://account.live.com/interrupt/passkey/enroll'
        ],
        action: async (page) => {
            console.log("🔹 Handling Passkey prompt…");
            for (let i = 0; i < 5; i++) {
                const clickTarget = await resolveElement(page, [
                    'button[aria-label="Skip for now"]',
                    'button[data-testid="skipButton"]',
                    '#iCancel'
                ]);
                if (clickTarget) {
                    await clickTarget.click();
                    console.log("✅ Clicked 'Skip for now'");
                    return;
                }
                await delay(500);
            }
            console.warn("⚠️ Could not dismiss the Passkey prompt; continuing anyway.");
        }
    },
    {
        urls: ['https://account.microsoft.com/?lang=en-US&refd=account.live.com&refp=landing&mkt=EN-US'],
        action: async (page) => {
            console.log("Stuck on account landing page. Redirecting to Junk Email Settings...");
            await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', {
                waitUntil: 'networkidle2',
                timeout: 30000,
            });
        },
    },
    {
        urls: ['https://account.microsoft.com/account-checkup'],
        action: async (page) => {
            console.log("Reached Account Checkup. Waiting for 2 seconds to check for redirection...");
            await delay(2000);
            const currentUrl = page.url();
            if (currentUrl.includes('account-checkup')) {
                console.log("Still on Account Checkup. Attempting to click the 'X' button.");
                const xButtonSelector = 'i[data-icon-name="Cancel"]';
                try {
                    const xButton = await page.$(xButtonSelector);
                    if (xButton) {
                        await xButton.click();
                        console.log("Clicked the 'X' button to dismiss Account Checkup.");
                        await delay(1000);
                    } else {
                        console.warn("The 'X' button was not found. Skipping action.");
                    }
                } catch (error) {
                    console.error(`Error clicking 'X' button on Account Checkup: ${error.message}`);
                }
                console.log("Attempting navigation to Junk Email Settings...");
                await page.goto('https://outlook.live.com/mail/0/options/mail/junkEmail', {
                    waitUntil: 'networkidle2',
                    timeout: 30000,
                });
            }
        },
    },
];

// Helper function for 2FA code generation
async function getTwoFACode(browser, secret) {
    const twofaPage = await browser.newPage();
    try {
      console.log("🔑 Opening 2FA.live to generate code...");
      await twofaPage.goto('https://2fa.live', { waitUntil: 'domcontentloaded', timeout: 10000 });
      
      // Wait for the token input field
      await twofaPage.waitForSelector('#listToken', { visible: true, timeout: 5000 });
      
      // Clear any existing content and type the secret
      await twofaPage.click('#listToken', { clickCount: 3 });
      await twofaPage.type('#listToken', secret, { delay: 20 });
      
      // Submit the form
      await twofaPage.click('#submit');
      
      // Wait for the output
      await twofaPage.waitForSelector('#output', { visible: true, timeout: 10000 });
      
      // Get the code
      const raw = await twofaPage.$eval('#output', el => el.value);
      const code = raw.split('|')[1]?.trim();
      
      if (!code || code.length !== 6) {
        throw new Error(`Invalid 2FA code format: ${raw}`);
      }
      
      console.log(`✅ Generated 2FA code: ${code}`);
      return code;
      
    } catch (error) {
      console.error(`❌ Failed to generate 2FA code: ${error.message}`);
      throw error;
    } finally {
      await twofaPage.close();
    }
  }
  
  // 2FA handling function
  async function handle2FA(page, browser, twofa) {
    console.log("🔐 Detecting 2FA requirement...");
    
    // Wait for 2FA prompt to appear
    try {
      await page.waitForSelector([
        '#idTxtBx_SAOTCC_OTC',
        '#otc-confirmation-input', 
        'input[name="otc"]',
        'input[placeholder*="code"]'
      ].join(','), { visible: true, timeout: 15000 });
      
      console.log("✅ 2FA prompt detected");
    } catch (error) {
      console.error("❌ 2FA prompt not found:", error.message);
      throw new Error("2FA prompt not detected within timeout");
    }
    
    // Try up to 3 times to enter 2FA code
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🔑 2FA attempt ${attempt}/3...`);
        
        // Generate fresh 2FA code
        const code = await getTwoFACode(browser, twofa);
        
        // Find the input field
        const inputSel = await resolveSelector(page, [
          '#idTxtBx_SAOTCC_OTC',
          '#otc-confirmation-input',
          'input[name="otc"]',
          'input[placeholder*="code"]'
        ]);
        
        // Clear and enter the code
        await page.click(inputSel, { clickCount: 3 });
        await page.type(inputSel, code, { delay: 50 });
        
        // Find and click submit button
        const submitBtn = await resolveElement(page, [
          '#idSubmit_SAOTCC_Continue',
          '#oneTimeCodePrimaryButton',
          'button[type="submit"]',
          'input[type="submit"]'
        ]);
        
        if (!submitBtn) {
          throw new Error("2FA submit button not found");
        }
        
        await safeClickAndNavigate(page, submitBtn);
        
        // Wait for either success (inbox) or error
        await Promise.race([
          page.waitForSelector('div[aria-label="Message list"], span.ms-Pivot-text', { timeout: 15000 }),
          page.waitForSelector('#idTxtBx_SAOTCC_OTC', { timeout: 5000 }) // Still on 2FA page = failed
        ]);
        
        // Check if we're still on 2FA page (code was wrong)
        const stillOn2FA = await page.$('#idTxtBx_SAOTCC_OTC');
        if (stillOn2FA) {
          console.warn(`⚠️ 2FA code rejected on attempt ${attempt}`);
          if (attempt === 3) throw new Error("2FA failed after 3 attempts");
          await delay(2000); // Wait before retry
          continue;
        }
        
        // Success!
        console.log("✅ 2FA completed successfully");
        return;
        
      } catch (error) {
        console.error(`❌ 2FA attempt ${attempt} failed: ${error.message}`);
        if (attempt === 3) {
          throw new Error(`2FA failed after 3 attempts: ${error.message}`);
        }
        await delay(2000);
      }
    }
  }

  // Helper function to process endpoint actions
  async function processEndpointActions(page) {
    const currentUrl = page.url();
    console.log(`🔍 Checking endpoint actions for: ${currentUrl}`);
    
    for (const action of endpointActions) {
      const matchingUrl = action.urls.find(url => currentUrl.includes(url));
      if (matchingUrl) {
        console.log(`✅ Found matching endpoint action for: ${matchingUrl}`);
        
        // Check fail condition if it exists
        if (action.failCondition) {
          const shouldFail = await action.failCondition(page);
          if (shouldFail) {
            console.error(`❌ Fail condition met: ${action.failLog || 'Unknown failure'}`);
            throw new Error(action.failLog || 'Endpoint action failed');
          }
        }
        
        // Execute the action
        await action.action(page);
        await delay(1000); // Give time for action to complete
        return true; // Action was processed
      }
    }
    return false; // No matching action found
  }

  export async function mainWithCredentials(email, password, proxyInfo, twofa) {
    const [ip, port, username, pwd] = proxyInfo.split(':');
    const proxyUrl = `http://${ip}:${port}`;
  
    const browser = await puppeteer.launch({
      headless: false,
      args: [`--proxy-server=${proxyUrl}`],
    });
    let page = await browser.newPage();
  
    // Helper to swallow the known Puppeteer frame‐navigation race on goto
    async function safeGoto(url, options) {
      try {
        await page.goto(url, options);
      } catch (err) {
        if (err.message.includes('We either navigate top level')) {
          console.warn(`safeGoto: ignored frame‐navigation race for ${url}`);
        } else {
          throw err;
        }
      }
    }
  
    // === COOKIE RESTORATION PATH ===
    try {
      if (await loadCookies(page, email)) {
        console.log("🔄 Cookies loaded, reinitializing tab…");
        const cookies = await page.cookies();
        await page.close();
        page = await browser.newPage();
        await page.setCookie(...cookies);
        await page.authenticate({ username, password: pwd });
  
        // use safeGoto here
        await safeGoto('https://outlook.live.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
        await delay(1500);
        await safeGoto('https://outlook.live.com/mail/0/', { waitUntil: 'networkidle2', timeout: 20000 });
        await delay(1500);
  
        const isOnInbox = page.url().includes('/mail/0');
        const inboxReady = await page.evaluate(() =>
          document.body.innerText.includes("Inbox") ||
          !!document.querySelector('div[aria-label="Message list"], span.ms-Pivot-text')
        );
  
        if (isOnInbox && inboxReady) {
          console.log("✅ Cookie session restored — inbox ready.");
          await markOtherTab(page);
          await saveCookies(page, email);
          await browser.close();
          return { email, success: true };
        }
  
        throw new Error("Inbox markers not found after cookie navigation.");
      }
    } catch (err) {
      console.warn(`⚠️ Cookie restoration error: ${err.message}`);
    }
  
    // === FULL LOGIN FLOW ===
    try {
      await page.authenticate({ username, password: pwd });
      await safeGoto('https://login.live.com', { waitUntil: 'networkidle2' });
  
      // Detect if already on 2FA prompt
      const is2FAPrompt = await page.evaluate(() =>
        document.body.innerText.includes("Enter code") ||
        !!document.querySelector('label[for="otc"]') ||
        !!document.querySelector('#idTxtBx_SAOTCC_OTC')
      );
  
      if (!is2FAPrompt) {
        // Enter email
        await page.waitForSelector('#usernameEntry, #i0116', { visible: true, timeout: 20000 });
        const emailSel = await resolveSelector(page, ['#usernameEntry', '#i0116']);
        await page.type(emailSel, email, { delay: 50 });
  
        // Click "Next" and wait for password field
        const nextBtn = await resolveSelector(page, [
          'button[data-tid="signin-button"]',
          'button[type="submit"]',
          '#idSIButton9'
        ]);
  
        await Promise.all([
          page.click(nextBtn, { delay: 50 }),
          page.waitForSelector('#passwordEntry, #i0118', { visible: true, timeout: 30000 })
        ]);
  
        // Enter password
        const passSel = await resolveSelector(page, ['#passwordEntry', '#i0118']);
        await page.type(passSel, password, { delay: 50 });
  
        const signInBtn = await resolveSelector(page, [
          'button[data-tid="signin-submit-button"]',
          'button[type="submit"]',
          '#idSIButton9'
        ]);
        await safeClickAndNavigate(page, signInBtn);
  
        // Wait for navigation and check what page we land on
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        
        const currentUrl = page.url();
        console.log(`📍 After password, current URL: ${currentUrl}`);
        
        // === PROCESS ENDPOINT ACTIONS ===
        console.log("🔄 Processing endpoint actions...");
        const endpointActionProcessed = await processEndpointActions(page);
        
        if (endpointActionProcessed) {
          console.log("✅ Endpoint action completed");
          // Wait a bit for any navigation to complete
          await delay(2000);
        }
        
        // Check for various possible next steps AFTER endpoint actions
        const is2FARequired = await page.evaluate(() => {
          return document.body.innerText.includes("Enter code") ||
                 !!document.querySelector('#idTxtBx_SAOTCC_OTC') ||
                 !!document.querySelector('input[name="otc"]') ||
                 !!document.querySelector('input[placeholder*="code"]');
        });
        
        const badCreds = await page.evaluate(() => {
          const errEl = document.querySelector('#passwordError, #i0118Error');
          return errEl && /incorrect/.test(errEl.innerText);
        });
        
        if (badCreds) {
          throw new Error("Incorrect credentials.");
        }
        
        if (is2FARequired) {
          console.log("🔐 2FA required after endpoint actions, handling...");
          await handle2FA(page, browser, twofa);
        } else {
          console.log("✅ No 2FA required after endpoint actions, proceeding...");
        }
        
      } else {
        // Already on 2FA prompt
        console.log("🔐 Already on 2FA prompt, handling...");
        await handle2FA(page, browser, twofa);
      }
  
      // === PROCESS ENDPOINT ACTIONS AGAIN (in case new pages appeared) ===
      console.log("🔄 Final endpoint actions check...");
      await processEndpointActions(page);
  
      // === STAY SIGNED IN ===
      try {
        // Wait for the Stay Signed In prompt
        await page.waitForSelector('button[data-testid="primaryButton"], #idSIButton9', { timeout: 8000 });
        const stayBtn = await page.$('button[data-testid="primaryButton"], #idSIButton9');
        if (stayBtn) {
          await safeClickAndNavigate(page, stayBtn);
        } else {
          await page.keyboard.press('Enter');
          await delay(1000);
        }
      } catch (err) {
        console.warn("⚠️ Skipped 'Stay signed in' flow:", err.message);
      }
  
      // === FINAL NAVIGATION CHECK ===
      // Make sure we end up at the inbox
      const maxWaitTime = 15000;
      const startTime = Date.now();
      let inboxReached = false;
      
      while ((Date.now() - startTime) < maxWaitTime && !inboxReached) {
        const currentUrl = page.url();
        console.log(`📍 Current URL: ${currentUrl}`);
        
        // Process any remaining endpoint actions
        await processEndpointActions(page);
        
        // Check if we're at the inbox
        const isInbox = currentUrl.includes('/mail/0') || currentUrl.includes('outlook.live.com/mail');
        const hasInboxElements = await page.evaluate(() => 
          document.body.innerText.includes("Inbox") ||
          !!document.querySelector('div[aria-label="Message list"], span.ms-Pivot-text')
        );
        
        if (isInbox && hasInboxElements) {
          inboxReached = true;
          console.log("✅ Inbox reached successfully");
          break;
        }
        
        await delay(1000);
      }
      
      if (!inboxReached) {
        // Try to navigate to inbox manually
        console.log("⚠️ Inbox not reached, trying manual navigation...");
        await safeGoto('https://outlook.live.com/mail/0/', { waitUntil: 'networkidle2', timeout: 20000 });
      }
  
      // === POST‑LOGIN ===
      try {
        console.log("🎉 Logged in — running post‑login tasks…");
        await markOtherTab(page);
        await saveCookies(page, email);
        await browser.close();
        return { email, success: true };
  
      } catch (err) {
        console.error(`❌ Post‑login tasks failed for ${email}: ${err.message}`);
        try {
          await captureLoginScreenshot(page, email, 'post_login_error');
        } catch {/* ignore screenshot errors */}
        if (browser && browser.isConnected()) await browser.close();
        return { email, success: false, error: err.message };
      }
  
    } catch (err) {
      console.error(`❌ Full login flow error for ${email}: ${err.message}`);
      try {
        await captureLoginScreenshot(page, email, 'login_error');
      } catch {/* ignore screenshot errors */}
      if (browser && browser.isConnected()) await browser.close();
      return { email, success: false, error: err.message };
    }
  }
  
  async function captureLoginScreenshot(page, email, label) {
    try {
      const screenshotDir = path.resolve('./results/screenshots');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const filename = `${email.replace(/[@.]/g, '_')}_${label}.png`;
      const screenshotPath = path.join(screenshotDir, filename);
      await page.screenshot({ path: screenshotPath });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
    } catch (err) {
      console.warn(`⚠️ Could not capture screenshot: ${err.message}`);
    }
  }