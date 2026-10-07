# FindIt — Local Build (Step 1)

This is the fully working local version of FindIt. It uses the exact same
pipeline shape FindIt will use on AWS — only the implementation of each
piece changes later:

| In this build | On AWS |
|---|---|
| `uploads/` folder | S3 bucket |
| `data.json` file | DynamoDB table |
| `sharp` perceptual hash (in server.js) | Rekognition image analysis |
| `matchScore()` function | Lambda matching function |
| `console.log` in `notify()` | SNS / SES |

Everything else (frontend, matching weights, thresholds, auto-tagging
keyword list) carries over unchanged.

## How to run it

1. Install Node.js if you don't have it: https://nodejs.org (LTS version)
2. Open a terminal in this folder
3. Run:
   ```
   npm install
   node server.js
   ```
4. Open **http://localhost:3000** in your browser
5. Try it:
   - Report a "found" item with a photo
   - Report a "lost" item with a similar description/location — you should
     see it appear as a match, with the console (terminal) printing a
     `[NOTIFY]` line

## What to check/tune before presenting

- `AUTO_NOTIFY_THRESHOLD` and `POSSIBLE_MATCH_THRESHOLD` in `server.js` —
  raise/lower these if matches feel too eager or too strict
- `CATEGORY_KEYWORDS` in `server.js` — add more item types your campus
  commonly has (umbrellas, calculators, etc.)
- `WEIGHTS` in `server.js` — this is your "novelty" multi-modal scoring;
  worth explaining in viva exactly why image is weighted highest (0.5)
  and location/time lowest (0.15/0.1) — they're tie-breakers, not primary
  signals

## Next step (Step 3 from the plan)

Once this is working and you're happy with it, we move the storage piece
(`uploads/` → S3) and the matching trigger (`matchScore()` → Lambda) onto
real AWS — this file's structure makes that swap isolated and easy.
