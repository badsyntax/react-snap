#!/usr/bin/env node
const puppeteer = require("puppeteer");
const http = require("http");
const https = require("https");
const express = require("express");
const serveStatic = require("serve-static");
const fallback = require("express-history-api-fallback");
const path = require("path");
const Url = require("url");
const _ = require("highland");
const fs = require("fs");
const mkdirp = require("mkdirp");
const minify = require("html-minifier").minify;

const crawl = options => {
  let shuttingDown = false;
  process.on("SIGINT", () => {
    if (shuttingDown) {
      process.exit();
    } else {
      shuttingDown = true;
      console.log(
        "Gracefully shutting down. To exit immediately, press ^C again"
      );
    }
  });

  const buildDir = path.normalize(`${process.cwd()}/${options.build}`);
  const startServer = options => {
    const app = express()
      .use(serveStatic(buildDir))
      .use(fallback("index.html", { root: buildDir }));
    const server = http.createServer(app);
    server.listen(options.port);
    return server;
  };

  const basePath = `http://localhost:${options.port}/`;
  const basedomain = "localhost";
  const queue = _();
  let enqued = 0;
  let processed = 0;
  const uniqueUrls = {};
  const addToQueue = (url, referer) => {
    if (Url.parse(url).hostname === basedomain && !uniqueUrls[url]) {
      uniqueUrls[url] = true;
      enqued++;
      queue.write(url);
    }
  };

  let indexPage;
  const fetchPage = async url => {
    if (shuttingDown) return;
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.evaluateOnNewDocument(() => {
      window.REACT_SNAP = true;
    });
    await page.goto(url, { waitUntil: "networkidle" });
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a")).map(link => link.href)
    );
    links.map(addToQueue);
    const content = await page.content();
    console.log('GET CONTENT');
    const route = url.replace(basePath, "");
    let filePath = path.join(buildDir, route);
    mkdirp.sync(filePath);
    const minifiedContent = minify(content, options.minifyOptions);
    if (route === "") {
      indexPage = minifiedContent;
    } else {
      fs.writeFileSync(path.join(filePath, "index.html"), minifiedContent);
    }

    return browser.close().then(() => {
      console.log(`Crawled ${processed + 1} out of ${enqued} (/${route})`);
      processed++;
      if (enqued === processed) queue.end();
    });
  };

  const server = startServer(options);
  addToQueue(basePath);
  queue
    .map(x => _(fetchPage(x)))
    .parallel(options.concurrency)
    .collect()
    .done(function() {
      fs.writeFileSync(path.join(buildDir, "index.html"), indexPage);
      server.close();
    });
};

const { reactSnap } = require(`${process.cwd()}/package.json`);

const options = {
  port: 45678,
  build: "build",
  concurrency: 3,
  minifyOptions: {
    minifyCSS: true,
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    collapseInlineTagWhitespace: true,
    decodeEntities: true,
    keepClosingSlash: true,
    sortAttributes: true,
    sortClassName: true
  },
  ...reactSnap
};

crawl(options);
