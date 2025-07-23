import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { delay, saveCookies, loadCookies } from './helperFunctions.js';
import { markOtherTab } from './postLoginTasks.js'; 
import fs from 'fs';
import path from 'path';

// Enhanced stealth configuration
puppeteer.use(StealthPlugin());

// Anti-detection user agents rotation
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Random delays to simulate human behavior
const humanDelay = () => delay(500 + Math.random() * 1500);
const shortDelay = () => delay(100 + Math.random() * 300);

// Robust 2FA code generation with fallback
async function getTwoFACode(secret) {
    const twofaBrowser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor'
      ],
    });
    
    try {
      const twofaPage = await twofaBrowser.newPage();
      await twofaPage.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
      
      await twofaPage.goto('https://2fa.live', { 
        waitUntil: 'domcontentloaded', 
        timeout: 15000 
      });
      
      await twofaPage.waitForSelector('#listToken', { visible: true, timeout: 8000 });
      await shortDelay();
      
      await twofaPage.click('#listToken', { clickCount: 3 });
      await shortDelay();
      
      await twofaPage.type('#listToken', secret, { delay: 50 + Math.random() * 100 });
      await shortDelay();
      
      await twofaPage.click('#submit');
      
      await twofaPage.waitForSelector('#output', { visible: true, timeout: 12000 });
      
      // Wait for code with polling
      let code = null;
      for (let i = 0; i < 15; i++) {
        await delay(1000);
        try {
          const raw = await twofaPage.$eval('#output', el => el.value);
          if (raw && raw.includes('|')) {
            const parsedCode = raw.split('|')[1]?.trim();
            if (parsedCode && parsedCode.length === 6 && /^\d{6}$/.test(parsedCode)) {
              code = parsedCode;
              break;
            }
          }
        } catch (err) {
          continue;
        }
      }
      
      if (!code) {
        throw new Error('Failed to generate valid 2FA code');
      }
      
      return code;
      
    } finally {
      await twofaBrowser.close();
    }
}

// Anti-detection 2FA handling
async function handle2FA(page, twofa) {
    console.log("🔐 Starting stealth 2FA handling...");
    
    // Generate code first
    const code = await getTwoFACode(twofa);
    console.log(`🔑 2FA code ready: ${code}`);
    
    // Wait a bit to let page stabilize
    await humanDelay();
    
    // Multiple attempts to find field (Microsoft keeps changing them)
    const possibleSelectors = [
      '#floatingLabelInput5',
      '#otc-confirmation-input', 
      '#idTxtBx_SAOTCC_OTC',
      'input[data-testid="otc-confirmation-input"]',
      'input[name="otc"]',
      'input[type="tel"]',
      'input[type="text"]:not([type="hidden"]):not([type="search"])',
      'input[inputmode="numeric"]',
      'input[maxlength="6"]',
      'input[maxlength="8"]'
    ];
    
    let inputSelector = null;
    let fieldFound = false;
    
    // Try multiple times with increasing waits
    for (let attempt = 1; attempt <= 5; attempt++) {
      console.log(`🔍 Field search attempt ${attempt}/5...`);
      
      for (const selector of possibleSelectors) {
        try {
          // Check if field exists and is visible
          const fieldInfo = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            
            const rect = el.getBoundingClientRect();
            return {
              exists: true,
              visible: el.offsetParent !== null,
              inViewport: rect.top >= 0 && rect.left >= 0,
              width: rect.width,
              height: rect.height,
              type: el.type,
              placeholder: el.placeholder,
              maxLength: el.maxLength
            };
          }, selector);
          
          if (fieldInfo && fieldInfo.visible && fieldInfo.width > 0) {
            inputSelector = selector;
            fieldFound = true;
            console.log(`✅ Found 2FA field: ${selector} (${fieldInfo.type})`);
            break;
          }
        } catch (err) {
          continue;
        }
      }
      
      if (fieldFound) break;
      
      // Wait longer between attempts
      await delay(2000 * attempt);
      
      // Check if page changed
      const currentUrl = page.url();
      if (!currentUrl.includes('login.live.com') && !currentUrl.includes('account.live.com')) {
        throw new Error(`Page navigated away: ${currentUrl}`);
      }
    }
    
    if (!inputSelector) {
      // Last resort: try to find ANY input field that might be for 2FA
      const anyInputField = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const visibleInputs = inputs.filter(input => 
          input.offsetParent !== null && 
          input.type !== 'hidden' && 
          input.type !== 'submit' && 
          input.type !== 'button' &&
          input.type !== 'search'
        );
        
        // Look for numeric/tel inputs or inputs with OTC-related attributes
        const likelyOtcInputs = visibleInputs.filter(input => 
          input.type === 'tel' || 
          input.type === 'number' ||
          input.inputMode === 'numeric' ||
          input.maxLength <= 8 ||
          input.name.toLowerCase().includes('otc') ||
          input.id.toLowerCase().includes('code') ||
          input.placeholder.toLowerCase().includes('code')
        );
        
        if (likelyOtcInputs.length > 0) {
          const input = likelyOtcInputs[0];
          return input.id ? `#${input.id}` : 
                 input.name ? `input[name="${input.name}"]` : 
                 `input[type="${input.type}"]`;
        }
        
        return null;
      });
      
      if (anyInputField) {
        inputSelector = anyInputField;
        console.log(`⚠️ Using fallback field: ${inputSelector}`);
      } else {
        throw new Error("All 2FA input fields disappeared");
      }
    }
    
    // Enter the code with human-like behavior
    try {
      console.log(`📝 Entering code in ${inputSelector}...`);
      
      // Focus the field
      await page.focus(inputSelector);
      await shortDelay();
      
      // Clear any existing content
      await page.evaluate((selector) => {
        const field = document.querySelector(selector);
        if (field) {
          field.value = '';
          field.focus();
        }
      }, inputSelector);
      
      await shortDelay();
      
      // Type the code with human-like delays
      await page.type(inputSelector, code, { 
        delay: 150 + Math.random() * 100 
      });
      
      await shortDelay();
      
      // Verify code was entered
      const enteredValue = await page.evaluate((selector) => {
        const field = document.querySelector(selector);
        return field ? field.value : '';
      }, inputSelector);
      
      if (enteredValue !== code) {
        console.warn(`⚠️ Code mismatch. Expected: ${code}, Got: ${enteredValue}`);
        // Try again
        await page.evaluate((selector, code) => {
          const field = document.querySelector(selector);
          if (field) {
            field.value = code;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, inputSelector, code);
      }
      
      await humanDelay();
      
      // Find and click submit button
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        '#idSubmit_SAOTCC_Continue',
        '#oneTimeCodePrimaryButton',
        'button[data-testid="submitButton"]',
        'button:contains("Next")',
        'button:contains("Submit")',
        'button:contains("Continue")'
      ];
      
      let submitted = false;
      for (const selector of submitSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            const isVisible = await page.evaluate(el => {
              const rect = el.getBoundingClientRect();
              return el.offsetParent !== null && rect.width > 0 && rect.height > 0;
            }, btn);
            
            if (isVisible) {
              console.log(`👆 Clicking submit: ${selector}`);
              await btn.click();
              submitted = true;
              break;
            }
          }
        } catch (err) {
          continue;
        }
      }
      
      if (!submitted) {
        console.log("⌨️ Using Enter key as fallback");
        await page.focus(inputSelector);
        await shortDelay();
        await page.keyboard.press('Enter');
      }
      
      // Wait for submission result
      await delay(5000);
      
      // Check if still on 2FA page
      const pageCheck = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        return {
          url: window.location.href,
          stillHas2FA: bodyText.includes("enter the code") || 
                      bodyText.includes("verification code") ||
                      bodyText.includes("authenticator app"),
          hasError: bodyText.includes("incorrect") || 
                   bodyText.includes("invalid") ||
                   bodyText.includes("expired"),
          has2FAField: !!document.querySelector('#floatingLabelInput5') ||
                      !!document.querySelector('#otc-confirmation-input') ||
                      !!document.querySelector('#idTxtBx_SAOTCC_OTC')
        };
      });
      
      console.log(`🔍 2FA result: URL=${pageCheck.url.substring(0, 50)}..., Has2FA=${pageCheck.stillHas2FA}, HasError=${pageCheck.hasError}`);
      
      if (!pageCheck.stillHas2FA && !pageCheck.has2FAField) {
        console.log("✅ 2FA completed successfully");
        return;
      }
      
      if (pageCheck.hasError) {
        throw new Error("2FA code was rejected by Microsoft");
      }
      
      throw new Error("2FA failed - still on 2FA page");
      
    } catch (error) {
      throw new Error(`2FA entry failed: ${error.message}`);
    }
}

export async function mainWithCredentials(email, password, proxyInfo, twofa) {
    const [ip, port, username, pwd] = proxyInfo.split(':');
    const proxyUrl = `http://${ip}:${port}`;
    
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        `--proxy-server=${proxyUrl}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
    });
    
    let page = await browser.newPage();
    
    try {
      // Anti-detection setup
      await page.setViewport({ 
        width: 1366 + Math.floor(Math.random() * 100), 
        height: 768 + Math.floor(Math.random() * 100) 
      });
      
      const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
      await page.setUserAgent(userAgent);
      
      // Remove automation indicators
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // Mock languages and plugins to look more human
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        
        // Mock screen properties
        Object.defineProperty(screen, 'availHeight', {
          get: () => 1040,
        });
        Object.defineProperty(screen, 'availWidth', {
          get: () => 1920,
        });
      });
      
      await page.authenticate({ username, password: pwd });
      
      // Human-like navigation delay
      await humanDelay();
      
      console.log("🌐 Navigating to login page...");
      try {
        await page.goto('https://login.live.com', { 
          waitUntil: 'domcontentloaded', 
          timeout: 20000 
        });
      } catch (navError) {
        if (navError.message.includes('ERR_ABORTED') || navError.message.includes('net::')) {
          throw new Error("Network/Proxy error");
        }
        throw navError;
      }
      
      await shortDelay();
      
      // Verify we're on the right page
      const currentUrl = page.url();
      if (!currentUrl.includes('login.live.com')) {
        throw new Error(`Unexpected redirect: ${currentUrl}`);
      }
      
      // Check if already on 2FA
      const is2FAPrompt = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        return bodyText.includes("enter the code") ||
               bodyText.includes("authenticator app") ||
               !!document.querySelector('#floatingLabelInput5') ||
               !!document.querySelector('#otc-confirmation-input');
      });
      
      if (is2FAPrompt) {
        console.log("🔐 Already on 2FA page");
        await handle2FA(page, twofa);
      } else {
        console.log("📧 Starting login flow...");
        
        // Find and enter email
        const emailSelectors = ['#i0116', '#usernameEntry', 'input[name="loginfmt"]', 'input[type="email"]'];
        let emailField = null;
        
        for (const selector of emailSelectors) {
          try {
            await page.waitForSelector(selector, { visible: true, timeout: 8000 });
            emailField = selector;
            break;
          } catch (err) {
            continue;
          }
        }
        
        if (!emailField) {
          throw new Error("Email field not found");
        }
        
        await page.focus(emailField);
        await shortDelay();
        await page.type(emailField, email, { delay: 80 + Math.random() * 40 });
        await humanDelay();
        
        // Click Next
        const nextBtn = await page.$('button[type="submit"]') || await page.$('#idSIButton9');
        if (nextBtn) {
          await nextBtn.click();
        } else {
          await page.keyboard.press('Enter');
        }
        
        await humanDelay();
        
        // Find and enter password
        const passwordSelectors = ['#i0118', '#passwordEntry', 'input[name="passwd"]', 'input[type="password"]'];
        let passwordField = null;
        
        for (const selector of passwordSelectors) {
          try {
            await page.waitForSelector(selector, { visible: true, timeout: 10000 });
            passwordField = selector;
            break;
          } catch (err) {
            continue;
          }
        }
        
        if (!passwordField) {
          throw new Error("Password field not found");
        }
        
        await page.focus(passwordField);
        await shortDelay();
        await page.type(passwordField, password, { delay: 80 + Math.random() * 40 });
        await humanDelay();
        
        // Click Sign In
        const signInBtn = await page.$('button[type="submit"]') || await page.$('#idSIButton9');
        if (signInBtn) {
          await signInBtn.click();
        } else {
          await page.keyboard.press('Enter');
        }
        
        // Wait for navigation
        await delay(4000);
        
        // Check for errors
        const loginResult = await page.evaluate(() => {
          const bodyText = document.body.innerText.toLowerCase();
          return {
            hasError: bodyText.includes("incorrect") || 
                     bodyText.includes("blocked") ||
                     bodyText.includes("sign-in is blocked"),
            needs2FA: bodyText.includes("enter the code") ||
                     bodyText.includes("authenticator app") ||
                     !!document.querySelector('#floatingLabelInput5') ||
                     !!document.querySelector('#otc-confirmation-input'),
            currentUrl: window.location.href
          };
        });
        
        if (loginResult.hasError) {
          throw new Error("Login credentials rejected");
        }
        
        if (loginResult.needs2FA) {
          console.log("🔐 2FA required");
          await handle2FA(page, twofa);
        }
      }
      
      // Handle Stay Signed In
      await humanDelay();
      try {
        const stayBtn = await page.$('button[data-testid="primaryButton"]');
        if (stayBtn) {
          await stayBtn.click();
          await humanDelay();
        }
      } catch (err) {
        // Ignore
      }
      
      // Complete login
      console.log("🎉 Login successful, completing tasks...");
      await markOtherTab(page);
      await saveCookies(page, email);
      await browser.close();
      return { email, success: true };
      
    } catch (err) {
      const errorMsg = err.message;
      
      try {
        await browser.close();
      } catch (closeErr) {
        // Ignore
      }
      
      // Return categorized errors
      if (errorMsg.includes('Network/Proxy') || errorMsg.includes('ERR_ABORTED')) {
        return { email, success: false, error: "Network/Proxy error" };
      } else if (errorMsg.includes('All 2FA input fields disappeared')) {
        return { email, success: false, error: "Microsoft blocked 2FA automation" };
      } else if (errorMsg.includes('2FA')) {
        return { email, success: false, error: "2FA handling failed" };
      } else {
        return { email, success: false, error: errorMsg };
      }
    }
}