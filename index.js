const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const resemble = require('resemblejs');
const fs = require('fs');
const app = express();
const port = 3200; // Port number for the server

const domains = ['https://google.com', 'https://spazioschiatti.it']; // Your list of domains

app.get('/status', async (req, res) => {
    const statuses = await Promise.all(domains.map(async (domain) => {
        try {
            const response = await axios.get(domain);
            if (response.status >= 200 && response.status < 300) return null;
            return { domain, status: response.status };
        } catch (error) {
            return { domain, status: 'Error', errorMessage: error.message };
        }
    }));
    res.json(statuses.filter(Boolean)); // Filter out the null values (status 200 range)
});

const screenshotsDir = 'screenshots';
const oldScreenshotsDir = `${screenshotsDir}/old`;

// Ensure screenshots directory exists
if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
}

if (!fs.existsSync(oldScreenshotsDir)) {
    fs.mkdirSync(oldScreenshotsDir, { recursive: true });
}
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            var totalHeight = 0;
            var distance = 100; // Distance to scroll each step, can be adjusted
            var timer = setInterval(() => {
                var scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100); // Interval time between scrolls, can be adjusted
        });
    });
}

async function hideFixedElements(page) {
    await page.evaluate(() => {
        const allElements = document.querySelectorAll('*');
        allElements.forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.position === 'fixed' || style.position === 'sticky') {
                console.log(style.position)
                el.style.position = 'static';

            }
        });
    });
}

app.get('/changed', async (req, res) => {
    const browser = await puppeteer.launch();
    const results = [];

    for (const domain of domains) {
        const filename = domain.replace(/https?:\/\//, '').replace(/\/$/, '') + '.png';
        const screenshotPath = `${screenshotsDir}/${filename}`;
        const oldScreenshotPath = `${oldScreenshotsDir}/${filename}`;

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 })
        await page.goto(domain);
        await autoScroll(page);
        await new Promise(resolve => setTimeout(resolve, 300)); // Use setTimeout to wait for 1 second
        await hideFixedElements(page);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await page.close();

        // Check if it's the first time taking a screenshot (i.e., no old screenshot exists)
        if (!fs.existsSync(oldScreenshotPath)) {
            // Move the current screenshot to the 'old' directory for future comparisons
            fs.copyFileSync(screenshotPath, oldScreenshotPath);
            results.push({ domain, message: 'First time screenshot taken.' });
            continue;
        }

        // Proceed with comparison
        const comparisonResult = await new Promise((resolve) => {
            resemble(screenshotPath)
                .compareTo(oldScreenshotPath)
                .ignoreColors()
                .onComplete((result) => {
                    resolve(result);
                });
        });

        // Update the old screenshot with the current one for future comparisons
        fs.copyFileSync(screenshotPath, oldScreenshotPath);

        if (comparisonResult.misMatchPercentage > 0) { // Adjust threshold as needed
            results.push({ domain, message: 'Website appearance has changed.', misMatchPercentage: comparisonResult.misMatchPercentage });
        } else {
            results.push({ domain, message: 'No significant changes detected.', misMatchPercentage: comparisonResult.misMatchPercentage });
        }
    }

    await browser.close();
    res.json(results);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
