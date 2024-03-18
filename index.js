const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const sharp = require('sharp');
const FormData = require('form-data');
require('dotenv').config();
const fs = require('fs');
const app = express();
const port = 3200; // Port number for the server

let pLimit;
import('p-limit').then((module) => {
    pLimit = module.default;
}).catch(console.error);

const baseurl = "https://www.wrike.com/api/v4/";

const taskID = process.env.TASK_ID;

async function createAttachment(task, attachment, buffer) {
    const formData = new FormData();
    formData.append('file', buffer, { filename: attachment.filename });

    const headers = {
        ...formData.getHeaders(),
        "Authorization": `Bearer ${process.env.WRIKETOKEN}`,
    };

    return axios.post(`${baseurl}tasks/${task}/attachments`, formData, { headers })
        .then((res) => {
            console.log(res.data);
            // Ensure you access the ID correctly based on the API response
            return res.data.data[0].id;
        })
        .catch((error) => {
            console.error(error);
            throw new Error('Failed to create attachment');
        });
}



async function createComment(task, message, attchIDS) {
    var html = JSON.stringify({
        text: message,
        //attachmentId: attchIDS[0]
    });
    axios
        .post(baseurl + "tasks/" + task + "/comments", html, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": "bearer " + process.env.WRIKETOKEN
            },
        })
        .then((res) => {
            console.log(`statusCode: ${res.status}`);
        })
        .catch((error) => {
            console.error(error);
        });
}

async function ensureSameSize(screenshotPath, oldScreenshotPath) {
    // Read images using sharp
    const img1 = sharp(screenshotPath);
    const img2 = sharp(oldScreenshotPath);

    // Get metadata to compare dimensions
    const metadata1 = await img1.metadata();
    const metadata2 = await img2.metadata();

    const width = Math.min(metadata1.width, metadata2.width);
    const height = Math.min(metadata1.height, metadata2.height);

    // Resize images to the smallest dimensions found
    const buffer1 = await img1.resize(width, height).toBuffer();
    const buffer2 = await img2.resize(width, height).toBuffer();

    // Return the resized images as PNG buffers
    return { buffer1, buffer2, width, height };
}

async function readImg(path) {
    const img = sharp(path);
    const buffer = await img.toBuffer();
    return buffer
}


async function getDomains() {
    try {
        const response = await axios.get(process.env.DOMAINS_API_URL);
        console.log(response.data.data)
        if (response.status === 200 && Array.isArray(response.data.data)) {
            // Assuming the API directly returns an array of domains.
            // If the structure is different, adjust the path to the data accordingly.
            return response.data.data;
        } else {
            console.error('Failed to fetch domains, status code:', response.status);
            return []; // Return an empty array as a fallback
        }
    } catch (error) {
        console.error('Error fetching domains:', error.message);
        return []; // Return an empty array as a fallback in case of error
    }
}



app.get('/status', async (req, res) => {
    const domains = await getDomains()

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



async function autoScroll(page) {

    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            var totalHeight = 0;
            var distance = 1000; // Distance to scroll each step, can be adjusted
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

const screenshotsDir = 'screenshots';
const oldScreenshotsDir = `${screenshotsDir}/old`;
const diffDir = `${screenshotsDir}/diff`;

// Ensure necessary directories exist
['screenshots', 'screenshots/old', 'screenshots/diff'].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// async function getDomains() {
//     try {
//         const response = await axios.get(process.env.DOMAINS_API_URL);
//         return response.status === 200 && Array.isArray(response.data.data) ? response.data.data : [];
//     } catch (error) {
//         console.error('Error fetching domains:', error.message);
//         return [];
//     }
// }

async function processDomain(browser, domain) {
    const page = await browser.newPage();
    const filename = domain.replace(/https?:\/\//, '').replace(/\/$/, '') + '.png';
    const screenshotPath = `${screenshotsDir}/${filename}`;
    const oldScreenshotPath = `${oldScreenshotsDir}/${filename}`;
    const diffFilePath = `${diffDir}/${filename}`;

    await page.setViewport({ width: 1920, height: 1920 });
    await page.goto(domain);
    await page.evaluate(() => {
        const style = document.createElement('style');
        style.innerHTML = `*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; animation-delay: 0s !important; transition-delay: 0s !important; }`;
        document.head.appendChild(style);
    });
    await new Promise(resolve => setTimeout(resolve, 700));
    await page.screenshot({ path: screenshotPath });
    await page.close();

    if (!fs.existsSync(oldScreenshotPath)) {
        fs.copyFileSync(screenshotPath, oldScreenshotPath);
        return { domain, message: 'First time screenshot taken.' };
    }

    const { buffer1, buffer2, width, height } = await ensureSameSize(screenshotPath, oldScreenshotPath);
    const img1 = PNG.sync.read(buffer1);
    const img2 = PNG.sync.read(buffer2);
    const diff = new PNG({ width, height });
    const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });

    fs.writeFileSync(diffFilePath, PNG.sync.write(diff));

    fs.copyFileSync(screenshotPath, oldScreenshotPath); // Update for future comparisons

    // Ensure you await the buffer results from readImg
    const currentScreenshotBuffer = await readImg(screenshotPath);
    const oldScreenshotBuffer = await readImg(oldScreenshotPath);
    const diffFileBuffer = await readImg(diffFilePath);

    // Upload current screenshot
    const currentScreenshotAttachmentId = await createAttachment(taskID, {
        filename: `current-${filename}`
    }, currentScreenshotBuffer);

    // Upload old screenshot
    const oldScreenshotAttachmentId = await createAttachment(taskID, {
        filename: `old-${filename}`
    }, oldScreenshotBuffer);

    // Upload diff screenshot
    const diffScreenshotAttachmentId = await createAttachment(taskID, {
        filename: `diff-${filename}`
    }, diffFileBuffer);

    return numDiffPixels > 0 ? { domain, message: 'Website appearance has changed.', diffPixels: numDiffPixels, currentScreenshotAttachmentId: currentScreenshotAttachmentId, oldScreenshotAttachmentId: oldScreenshotAttachmentId, diffScreenshotAttachmentId: diffScreenshotAttachmentId } : { domain, message: 'No significant changes detected.', diffPixels: numDiffPixels, currentScreenshotAttachmentId: currentScreenshotAttachmentId, oldScreenshotAttachmentId: oldScreenshotAttachmentId, diffScreenshotAttachmentId: diffScreenshotAttachmentId };
}

app.get('/changed', async (req, res) => {
    if (!pLimit) {
        return res.status(500).json({ message: 'Module not loaded' });
    }
    const limit = pLimit(5);

    const domains = await getDomains();
    const browser = await puppeteer.launch();

    const results = await Promise.all(domains.map(domain => limit(() => processDomain(browser, domain))));



    await browser.close();
    console.log(results)
    results.map((result) => {

        createComment(taskID, `<a class="stream-user-id avatar" rel="@followers">@follower</a> il doiminio ${result.domain} è cambiato rispetto alla scansione precedente, ha ${result.diffPixels} pixel di differenza`, [result.currentScreenshotAttachmentId, result.oldScreenshotAttachmentId, result.diffScreenshotAttachmentId]);

    })
    res.json(results);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
