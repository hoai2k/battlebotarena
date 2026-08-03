import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--disable-gpu-sandbox","--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
for (const job of process.argv.slice(2)) {
  const [url, out] = job.split("|");
  await page.goto(url); await page.waitForTimeout(5500);
  await page.screenshot({ path: out });
}
await browser.close(); console.log("ok");
