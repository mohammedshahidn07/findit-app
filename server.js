/**
 * FindIt — Local backend
 * -----------------------------------------------------------------------
 * This server simulates the exact pipeline FindIt will use on AWS:
 *
 *   Photo upload        -> S3            (here: local /uploads folder)
 *   Item record storage -> DynamoDB      (here: data.json file)
 *   Image analysis      -> Rekognition   (here: perceptual hash via `sharp`)
 *   Matching logic       -> Lambda        (here: matchScore() below)
 *   Notification        -> SNS / SES     (here: console.log, see notify())
 *
 * Swapping any one of these for its real AWS service later does not
 * require changing the matching logic or the frontend — only the
 * function body of the piece being swapped.
 * -----------------------------------------------------------------------
 */

const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// ---------- tiny JSON "database" helpers (stand-in for DynamoDB) ----------
function readItems() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}
function writeItems(items) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}

// ---------- auto-tagging (stand-in for Rekognition DetectLabels) ----------
const CATEGORY_KEYWORDS = {
  earbuds: ["earbud", "earbuds", "airpod", "airpods", "earphone", "earphones"],
  "id card": ["id card", "id-card", "identity card", "college id", "campus card"],
  bottle: ["bottle", "flask", "water bottle"],
  bag: ["bag", "backpack", "pouch", "rucksack"],
  wallet: ["wallet", "purse"],
  phone: ["phone", "mobile", "iphone", "smartphone"],
  "laptop charger": ["charger", "adapter", "cable"],
  umbrella: ["umbrella"],
  "key / keychain": ["key", "keys", "keychain"],
};
function autoTag(description) {
  const text = description.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => text.includes(k))) return category;
  }
  return "other";
}

// ---------- image similarity (stand-in for Rekognition feature compare) ----------
// Computes an 8x8 grayscale average-hash. Two visually similar photos
// (same item, similar angle/lighting) produce hashes with a small
// Hamming distance. This is the same *role* Rekognition will play —
// only the implementation changes when we move to AWS.
async function imageHash(filePath) {
  const { data } = await sharp(filePath)
    .resize(8, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  let hash = "";
  for (const px of data) hash += px >= avg ? "1" : "0";
  return hash;
}
function hammingSimilarity(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 0;
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) if (hashA[i] !== hashB[i]) diff++;
  return 1 - diff / hashA.length; // 1 = identical, 0 = completely different
}

// ---------- text similarity (word overlap / Jaccard) ----------
function textSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

// ---------- location / time proximity ----------
function locationSimilarity(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
}
function timeSimilarity(timeA, timeB) {
  const diffHours = Math.abs(new Date(timeA) - new Date(timeB)) / 36e5;
  if (diffHours <= 2) return 1;
  if (diffHours <= 12) return 0.6;
  if (diffHours <= 48) return 0.3;
  return 0;
}

// ---------- multi-modal match score (stand-in for the matching Lambda) ----------
// Weighted combination: image is the strongest signal, text and
// location/time break ties between visually similar items.
const WEIGHTS = { image: 0.5, text: 0.25, location: 0.15, time: 0.1 };

async function matchScore(itemA, itemB) {
  const imgSim = hammingSimilarity(itemA.imageHash, itemB.imageHash);
  const txtSim = textSimilarity(itemA.description, itemB.description);
  const locSim = locationSimilarity(itemA.location, itemB.location);
  const timeSim = timeSimilarity(itemA.datetime, itemB.datetime);

  const score =
    imgSim * WEIGHTS.image +
    txtSim * WEIGHTS.text +
    locSim * WEIGHTS.location +
    timeSim * WEIGHTS.time;

  return { score, breakdown: { imgSim, txtSim, locSim, timeSim } };
}

const AUTO_NOTIFY_THRESHOLD = 0.75; // confidence-based auto-resolution
const POSSIBLE_MATCH_THRESHOLD = 0.45;

// ---------- notification (stand-in for SNS / SES) ----------
function notify(ownerItem, matchedItem, score) {
  console.log(
    `\n[NOTIFY] Owner of "${ownerItem.description}" (reported ${ownerItem.type}) ` +
      `has a ${(score * 100).toFixed(0)}% match with item #${matchedItem.id} ` +
      `found at "${matchedItem.location}".\n`
  );
  // Real version: AWS SNS publish() or SES sendEmail() call goes here.
}

// ===================== ROUTES =====================

// Report a lost or found item
app.post("/api/items", upload.single("photo"), async (req, res) => {
  try {
    const { type, description, location, datetime } = req.body;
    if (!type || !description || !location || !datetime || !req.file) {
      return res.status(400).json({ error: "Missing required fields or photo." });
    }

    const items = readItems();
    const photoPath = req.file.path;
    const hash = await imageHash(photoPath);

    const newItem = {
      id: Date.now().toString(),
      type, // "lost" | "found"
      description,
      location,
      datetime,
      category: autoTag(description),
      photoUrl: "/uploads/" + req.file.filename,
      imageHash: hash,
      status: "unmatched",
      createdAt: new Date().toISOString(),
    };

    // Try to match against the opposite list
    const opposite = items.filter((i) => i.type !== type && i.status !== "matched");
    let matches = [];
    for (const candidate of opposite) {
      const { score, breakdown } = await matchScore(newItem, candidate);
      if (score >= POSSIBLE_MATCH_THRESHOLD) {
        matches.push({ item: candidate, score, breakdown });
      }
    }
    matches.sort((a, b) => b.score - a.score);

    if (matches.length > 0 && matches[0].score >= AUTO_NOTIFY_THRESHOLD) {
      newItem.status = "matched";
      matches[0].item.status = "matched";
      notify(newItem, matches[0].item, matches[0].score);
    }

    items.push(newItem);
    writeItems(items);

    res.json({
      item: newItem,
      matches: matches.map((m) => ({
        id: m.item.id,
        description: m.item.description,
        location: m.item.location,
        photoUrl: m.item.photoUrl,
        score: Math.round(m.score * 100),
        autoNotified: m.score >= AUTO_NOTIFY_THRESHOLD,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// List all items (optionally filter by type)
app.get("/api/items", (req, res) => {
  const items = readItems();
  const { type } = req.query;
  res.json(type ? items.filter((i) => i.type === type) : items);
});

// Simple stats, used by the dashboard strip in the UI
app.get("/api/stats", (req, res) => {
  const items = readItems();
  res.json({
    total: items.length,
    lost: items.filter((i) => i.type === "lost").length,
    found: items.filter((i) => i.type === "found").length,
    matched: items.filter((i) => i.status === "matched").length,
  });
});

app.listen(PORT, () => {
  console.log(`\nFindIt backend running → http://localhost:${PORT}\n`);
});
