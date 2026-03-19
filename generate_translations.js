/**
 * generate_translations.js
 *
 * Run this script ONCE whenever site content changes.
 * It calls Claude (Haiku) to translate all page content
 * into every supported language and saves static JSON files
 * that the website loads instantly — no live API calls needed.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your_key node generate_translations.js
 *
 * Output:
 *   translations/en.json  (English baseline — copied from source)
 *   translations/es.json  (Spanish)
 *   translations/hi.json  (Hindi)
 *   translations/te.json  (Telugu)
 *   translations/de.json  (German)
 *   translations/fr.json  (French)
 *
 * Deploy: commit the translations/ folder to your GitHub repo.
 * The website will fetch these files directly — zero API cost per visitor.
 */

const fs   = require('fs');
const path = require('path');

// ── CONFIG ────────────────────────────────────────────────────
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable not set.');
  console.error('Usage: ANTHROPIC_API_KEY=your_key node generate_translations.js');
  process.exit(1);
}

const LANGUAGES = [
  { code: 'es', name: 'Spanish'  },
  { code: 'hi', name: 'Hindi'    },
  { code: 'te', name: 'Telugu'   },
  { code: 'de', name: 'German'   },
  { code: 'fr', name: 'French'   },
  // Add more here as needed:
  // { code: 'pt', name: 'Portuguese' },
  // { code: 'it', name: 'Italian'    },
  // { code: 'ja', name: 'Japanese'   },
];

// Non-Latin scripts need a higher token budget
const NON_LATIN = ['te', 'hi', 'ar', 'zh', 'ja', 'ko'];

const OUTPUT_DIR = path.join(__dirname, 'translations');
const ENGLISH_FILE = path.join(__dirname, 'translations_en.json');

// ── HELPERS ───────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateBatch(batchContent, languageName) {
  const isNonLatin = NON_LATIN.includes(
    LANGUAGES.find(l => l.name === languageName)?.code || ''
  );
  const maxTokens = isNonLatin ? 8192 : 4096;

  const prompt = `You are a professional translator. Translate the following JSON object's string values into ${languageName}.

Rules:
- Translate ONLY the string values — never the keys
- Keep these unchanged: proper names (Ravi Chengalvala), company names (Ford Motor Company, FCA, Stellantis, Cummins, Comerica, General Motors, IBM, Compuware, Softura, DocuTell), institution names (MIT, Stanford, BITS Pilani, JNTU, University of Michigan), certification abbreviations (TOGAF, PMP, AWS, SOA, BIAN, ARB, UBI, TaaS, CDO), technical terms (API, OTA, AI, ML, IoT, EV), country names, city names, numbers and statistics, URLs, email addresses
- Preserve any HTML entities (&amp; &lt; etc.) exactly as-is
- Return ONLY valid compact JSON — no markdown, no code fences, no explanation

Input JSON:
${JSON.stringify(batchContent)}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const raw   = data.content?.[0]?.text || '{}';
  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(clean);
  } catch (err) {
    console.warn(`  Warning: JSON parse failed for a batch, returning original`);
    return batchContent;
  }
}

async function translateLanguage(english, langCode, langName) {
  const entries  = Object.entries(english);
  const midpoint = Math.ceil(entries.length / 2);
  const batch1   = Object.fromEntries(entries.slice(0, midpoint));
  const batch2   = Object.fromEntries(entries.slice(midpoint));

  console.log(`  Running 2 parallel batches (${Object.keys(batch1).length} + ${Object.keys(batch2).length} keys)...`);

  // Run both batches in parallel
  const [result1, result2] = await Promise.all([
    translateBatch(batch1, langName),
    translateBatch(batch2, langName)
  ]);

  return { ...result1, ...result2 };
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  // Load English baseline
  if (!fs.existsSync(ENGLISH_FILE)) {
    console.error(`English baseline not found: ${ENGLISH_FILE}`);
    console.error('Run the extraction step first.');
    process.exit(1);
  }

  const english = JSON.parse(fs.readFileSync(ENGLISH_FILE, 'utf-8'));
  console.log(`Loaded ${Object.keys(english).length} English keys\n`);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Save English file as-is
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'en.json'),
    JSON.stringify(english, null, 2),
    'utf-8'
  );
  console.log('✓ en.json saved (English baseline)\n');

  // Translate each language sequentially to avoid rate limits
  for (const lang of LANGUAGES) {
    console.log(`Translating → ${lang.name} (${lang.code})...`);
    const start = Date.now();

    try {
      const translated = await translateLanguage(english, lang.code, lang.name);
      const outPath    = path.join(OUTPUT_DIR, `${lang.code}.json`);
      fs.writeFileSync(outPath, JSON.stringify(translated, null, 2), 'utf-8');
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`✓ ${lang.code}.json saved (${Object.keys(translated).length} keys, ${secs}s)\n`);
    } catch (err) {
      console.error(`✗ Failed to translate ${lang.name}: ${err.message}\n`);
    }

    // Brief pause between languages to respect rate limits
    if (LANGUAGES.indexOf(lang) < LANGUAGES.length - 1) {
      await sleep(1000);
    }
  }

  console.log('All done! Deploy the translations/ folder to your GitHub repository.');
  console.log('Update index.html to fetch from /translations/{code}.json instead of calling the worker.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
