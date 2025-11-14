import { createEvent } from "ics";
import * as XLSX from "xlsx";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import Tesseract from "tesseract.js";
import Busboy from "busboy";

export const config = {
  api: {
    bodyParser: false,          // IMPORTANT for file uploads
  },
};

export default async function handler(req, res) {
  
  // ---------------------------
  // CORS FIX
  // ---------------------------
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  // ---------------------------
  // PARSE FORM-DATA (FILES + FIELDS)
  // ---------------------------
  let fileBuffer = null;
  let fileMime = "";
  let text = "";
  let url = "";

  const busboy = Busboy({ headers: req.headers });

  const filePromise = new Promise((resolve) => {
    busboy.on("file", (fieldname, file, info) => {
      fileMime = info.mimeType;

      const chunks = [];
      file.on("data", (data) => chunks.push(data));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on("field", (fieldname, value) => {
      if (fieldname === "text") text = value;
      if (fieldname === "url") url = value;
    });

    busboy.on("finish", resolve);
    req.pipe(busboy);
  });

  await filePromise;

  let extractedText = "";

  // ---------------------------
  // 1️⃣ IMAGE → OCR
  // ---------------------------
  if (fileBuffer && fileMime.startsWith("image/")) {
    const result = await Tesseract.recognize(fileBuffer, "eng", {
      tessedit_pageseg_mode: 6,
    });
    extractedText = result.data.text;
  }

  // ---------------------------
  // 2️⃣ CSV/XLSX
  // ---------------------------
  else if (fileBuffer && (fileMime.includes("csv") || fileMime.includes("sheet"))) {
    const workbook = XLSX.read(fileBuffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);
    extractedText = JSON.stringify(json, null, 2);
  }

  // ---------------------------
  // 3️⃣ URL SCRAPING
  // ---------------------------
  else if (url) {
    const html = await (await fetch(url)).text();
    const $ = cheerio.load(html);
    extractedText = $("body").text().trim();
  }

  // ---------------------------
  // 4️⃣ TEXT INPUT
  // ---------------------------
  else if (text) {
    extractedText = text;
  }

  // ---------------------------
  // GENERATE ICS
  // ---------------------------
  const eventObj = {
    title: extractedText.split("\n")[0] || "New Event",
    start: [2025, 1, 1, 10, 0],
    duration: { hours: 1 },
    description: extractedText,
  };

  createEvent(eventObj, (error, value) => {
    res.setHeader("Content-Type", "text/calendar");
    res.send(value);
  });
}
