import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  console.log("Navigating to Plena...");
  await page.goto('https://plena-1b2dd469-6.netlify.app/');
  
  // Wait a few seconds for load and start
  console.log("Waiting for game to load...");
  await page.waitForTimeout(5000);
  
  // click anywhere to start
  await page.mouse.click(500, 500);

  console.log("Walking into the trenches to die...");
  
  // Wait for the game over screen. We'll wait up to 30s for we will inevitably hit something.
  await page.waitForSelector('text="RUN AGAIN"', { timeout: 30000 });
  console.log("Game over screen detected. Commencing DOM edit...");
  
  await page.waitForTimeout(1000); // Wait for animations to settle

  await page.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    let textNodes = [];
    while(node = walk.nextNode()) {
        textNodes.push(node);
    }
    
    for (let i = 0; i < textNodes.length; i++) {
        const text = textNodes[i].nodeValue.trim();
        
        if (text === 'FINAL SCORE') {
            for(let j=i+1; j<i+6; j++) {
               if(textNodes[j] && /^[0-9,]+$/.test(textNodes[j].nodeValue.trim())) {
                   textNodes[j].nodeValue = '71,743';
                   break;
               }
            }
        }
        
        if (text === 'Distance') {
            for(let j=i+1; j<i+6; j++) {
               if(textNodes[j] && /^[0-9]+m$/.test(textNodes[j].nodeValue.trim())) {
                   textNodes[j].nodeValue = '48223m';
                   break;
               }
            }
        }
        
        if (text === 'Items') {
            for(let j=i+1; j<i+6; j++) {
               if(textNodes[j] && /^[0-9]+$/.test(textNodes[j].nodeValue.trim())) {
                   textNodes[j].nodeValue = '421';
                   break;
               }
            }
        }
        
        if (text === 'Best Streak') {
            for(let j=i+1; j<i+6; j++) {
               if(textNodes[j] && /^[0-9]+$/.test(textNodes[j].nodeValue.trim())) {
                   textNodes[j].nodeValue = '302';
                   break;
               }
            }
        }
        
        if (text === 'Multiplier') {
            for(let j=i+1; j<i+6; j++) {
               if(textNodes[j] && /^x[0-9.]+$/.test(textNodes[j].nodeValue.trim())) {
                   textNodes[j].nodeValue = 'x1.0';
                   break;
               }
            }
        }
        
        if (text.includes('ALL-TIME BEST:')) {
           textNodes[i].nodeValue = 'ALL-TIME BEST: 71,743';
        }
    }
  });

  const screenshotPath = 'fake-score.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved forged screenshot to ${screenshotPath}`);

  await browser.close();
})();
