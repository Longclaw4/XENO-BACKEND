const axios = require('axios');
const db = require('./db');

// Probability matrices for channel optimization advice
const CHANNEL_PERFORMANCE_FACTS = {
  whatsapp: "WhatsApp has a 85% open rate and works best for instant engagement and younger demographics.",
  sms: "SMS has 90% read rates but suffers from very low click-through rates. Best for simple urgent alerts.",
  email: "Email has low open rates (20%) but supports longer content and has the highest conversion per click for high-value purchases.",
  rcs: "RCS has 70% read rates and rich card capability, performing well for visual retail products."
};

/**
 * Local Rule-based NLP parser. Used when no Gemini API key is provided.
 */
function parsePromptLocally(promptText) {
  const text = promptText.toLowerCase();
  
  // Extract channel preference
  let channel = 'whatsapp'; // default
  if (text.includes('sms') || text.includes('text')) channel = 'sms';
  else if (text.includes('email') || text.includes('mail')) channel = 'email';
  else if (text.includes('rcs')) channel = 'rcs';

  // Build conditions
  const conditions = [];
  const explanationParts = [];
  let categoryMatch = null;
  let minSpend = 0;
  let dormantDays = 0;

  // 1. Detect Category
  if (text.includes('coffee') || text.includes('drink') || text.includes('beverage')) {
    categoryMatch = 'Coffee';
    explanationParts.push("favorite category is 'Coffee'");
  } else if (text.includes('fashion') || text.includes('clothes') || text.includes('apparel')) {
    categoryMatch = 'Fashion';
    explanationParts.push("favorite category is 'Fashion'");
  } else if (text.includes('beauty') || text.includes('makeup') || text.includes('skin')) {
    categoryMatch = 'Beauty';
    explanationParts.push("favorite category is 'Beauty'");
  } else if (text.includes('home') || text.includes('decor')) {
    categoryMatch = 'Home';
    explanationParts.push("favorite category is 'Home'");
  }

  // 2. Detect Spend
  const spendRegex = /(?:spent|spend|amount|bought|buy)\s*(?:more than|over|greater than|>)\s*(?:\$|₹|rs|inr)?\s*(\d+)/i;
  const spendMatch = text.match(spendRegex);
  if (spendMatch) {
    minSpend = parseFloat(spendMatch[1]);
    explanationParts.push(`total spend is greater than ₹${minSpend}`);
  }

  // 3. Detect Recency / Dormancy
  const recencyRegex = /(?:last purchase|haven't bought|no order|inactive|dormant)\s*(?:for|in|more than|over)?\s*(\d+)\s*days/i;
  const recencyMatch = text.match(recencyRegex);
  if (recencyMatch) {
    dormantDays = parseInt(recencyMatch[1]);
    explanationParts.push(`haven't placed an order in the last ${dormantDays} days`);
  } else if (text.includes('dormant') || text.includes('inactive')) {
    dormantDays = 30; // default dormant threshold
    explanationParts.push("haven't placed an order in the last 30 days");
  }

  // Assemble dynamic SQLite query
  let sqlQuery = '';
  const queryParams = [];

  if (minSpend > 0 || dormantDays > 0) {
    // Requires joining with orders
    let whereClauses = [];
    let havingClauses = [];

    if (categoryMatch) {
      whereClauses.push("customers.metadata LIKE ?");
      queryParams.push(`%favorite_category":"${categoryMatch}%`);
    }

    let selectParts = 'customers.id, customers.name, customers.email, customers.phone, customers.metadata';
    let sql = `
      SELECT ${selectParts}, SUM(orders.amount) as total_spend, MAX(orders.created_at) as last_order_date
      FROM customers
      LEFT JOIN orders ON customers.id = orders.customer_id AND orders.status = 'COMPLETED'
    `;

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ` GROUP BY customers.id`;

    if (minSpend > 0) {
      havingClauses.push(`SUM(orders.amount) >= ?`);
      queryParams.push(minSpend);
    }
    if (dormantDays > 0) {
      havingClauses.push(`MAX(orders.created_at) <= datetime('now', '-${dormantDays} days')`);
    }

    if (havingClauses.length > 0) {
      sql += ` HAVING ${havingClauses.join(' AND ')}`;
    }

    sqlQuery = sql;
  } else {
    // Simple customer filter
    sqlQuery = `SELECT * FROM customers`;
    if (categoryMatch) {
      sqlQuery += ` WHERE metadata LIKE ?`;
      queryParams.push(`%favorite_category":"${categoryMatch}%`);
    }
  }

  let offerText = '15% discount'; // default
  let code = 'HELLO15';
  let altCode = 'NEXT15';

  const patternUpto = /(\d+%\s*off\s*(?:up\s*to|upto)?\s*(?:(?:\$|₹|rs|inr)?\s*\d+(?:\s*(?:dollars?|rupees?))?))/i;
  const patternPercent = /(\d+%\s*(?:off|discount))/i;
  const patternValueOff = /((?:\$|₹|rs|inr)?\s*\d+\s*(?:off|dollars?|rupees?\s*off))/i;
  const patternBogo = /(buy\s*\d+\s*get\s*\d+|bogo)/i;

  const matchUpto = promptText.match(patternUpto);
  const matchPercent = promptText.match(patternPercent);
  const matchValueOff = promptText.match(patternValueOff);
  const matchBogo = promptText.match(patternBogo);

  if (matchUpto) {
    offerText = matchUpto[1];
    code = 'SUPEROFF';
    altCode = 'MEGAOFF';
  } else if (matchPercent) {
    offerText = matchPercent[1];
    const digits = offerText.match(/\d+/);
    const num = digits ? digits[0] : '15';
    code = `SAVE${num}`;
    altCode = `GET${num}`;
  } else if (matchValueOff) {
    offerText = matchValueOff[1];
    const digits = offerText.match(/\d+/);
    const num = digits ? digits[0] : '10';
    code = `CASH${num}`;
    altCode = `FREE${num}`;
  } else if (matchBogo) {
    offerText = 'Buy 1 Get 1 Free deal';
    code = 'BOGO';
    altCode = 'FREEBOGO';
  } else {
    if (text.includes('free shipping')) {
      offerText = 'Free Shipping';
      code = 'FREESHIP';
      altCode = 'SHIPFREE';
    } else if (text.includes('free gift')) {
      offerText = 'Free Gift with purchase';
      code = 'FREEGIFT';
      altCode = 'GIFTPR';
    }
  }

  const customCodeMatch = promptText.match(/(?:code|coupon|use)\s*(?:is|as|:)?\s*([a-z0-9_-]+)/i);
  if (customCodeMatch) {
    code = customCodeMatch[1].toUpperCase();
    altCode = code + 'PLUS';
  }

  const categoryLabel = categoryMatch ? categoryMatch.toLowerCase() : 'our collection';

  let variantA = '';
  let variantB = '';
  
  if (categoryMatch) {
    variantA = `Hi {{name}}, we noticed you love our ${categoryLabel} products! Here is a special ${offerText} code: ${code}. Claim it here: {{link}}`;
    variantB = `Hey {{name}}! Ready for a refresh? Get ${offerText} on our ${categoryLabel} items using code ${altCode}: {{link}}`;
  } else {
    variantA = `Hi {{name}}! We have a special ${offerText} code just for you: ${code}. Check out our store: {{link}}`;
    variantB = `Hey {{name}}! Don't miss out on this exclusive ${offerText} offer. Use code ${altCode} at checkout: {{link}}`;
  }

  const explanation = explanationParts.length > 0 
    ? `Targeting shoppers who match the following criteria: ${explanationParts.join(' AND ')}.`
    : "Targeting all shoppers in the database.";

  return {
    segmentName: `${categoryMatch || 'All'} Shoppers Campaign`,
    channel,
    explanation,
    sqlQuery,
    queryParams,
    variants: [
      { id: 'A', text: variantA },
      { id: 'B', text: variantB }
    ]
  };
}

/**
 * Live LLM campaign planner using Gemini API
 */
async function parsePromptWithGemini(promptText, apiKey) {
  const systemPrompt = `
You are the AI engine for Xeno, an intelligent shopper CRM. Your job is to parse a marketer's campaign intent and output a JSON configuration for the campaign.
The SQLite tables are:
- customers (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, metadata TEXT) -- metadata contains JSON like {"favorite_category": "Coffee", "preferred_channel": "whatsapp", "city": "Seattle", "age": 28}
- orders (id TEXT PRIMARY KEY, customer_id TEXT, amount REAL, status TEXT, items TEXT, created_at DATETIME) -- items contains JSON array of item names
 
Respond ONLY with a JSON object. No markdown, no triple backticks. The JSON must have this structure:
{
  "segmentName": "Short descriptive name for the audience",
  "channel": "whatsapp" | "sms" | "email" | "rcs",
  "explanation": "Human friendly explanation of what this filters",
  "sqlQuery": "A clean SELECT SQLite query. It MUST return customer columns: 'customers.id, customers.name, customers.email, customers.phone, customers.metadata'. You can join orders as needed. Keep it simple and performant.",
  "queryParams": [], // any parameters to replace '?' in the query. If none, keep empty array
  "variants": [
    { "id": "A", "text": "Personalized message template for variant A. Use {{name}}, {{favorite_category}}, etc. for placeholders. Always include the shortlink placeholder: {{link}}" },
    { "id": "B", "text": "Alternative A/B variant B. Use different messaging style." }
  ]
}
`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'user', parts: [{ text: `Marketer Prompt: "${promptText}"` }] }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      },
      { timeout: 8000 }
    );

    const resultText = response.data.candidates[0].content.parts[0].text.trim();
    const jsonString = resultText.replace(/^```json/, '').replace(/```$/, '').trim();
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('[AI Engine] Gemini API error, falling back to local engine:', error.message);
    return parsePromptLocally(promptText);
  }
}

/**
 * AI Campaign Performance Analyzer
 */
async function generateAIInsights(campaignStats, apiKey) {
  const activeApiKey = apiKey || process.env.GEMINI_API_KEY;
  const prompt = `
Explain performance for this campaign:
${JSON.stringify(campaignStats, null, 2)}

Provide three highly actionable bullet points explaining what worked and how to improve. Focus on channels, A/B variants, and customer behavior.
Keep it extremely concise and direct.
`;

  if (!activeApiKey) {
    const { sent, read, clicked, converted, channel, variantStats } = campaignStats;
    const clickRate = sent > 0 ? ((clicked / sent) * 100).toFixed(1) : 0;
    const conversionRate = clicked > 0 ? ((converted / clicked) * 100).toFixed(1) : 0;

    let insights = [];
    insights.push(`**Channel Effectiveness:** ${CHANNEL_PERFORMANCE_FACTS[channel] || 'Channel is active.'} Current click-through rate is ${clickRate}%.`);
    
    if (variantStats && variantStats.A && variantStats.B) {
      const rateA = variantStats.A.clicked / Math.max(1, variantStats.A.sent);
      const rateB = variantStats.B.clicked / Math.max(1, variantStats.B.sent);
      if (rateA > rateB) {
        insights.push(`**A/B Test Winner:** Variant A outperformed Variant B by ${((rateA - rateB)*100).toFixed(1)}% in engagement. Suggest scaling up Variant A's layout.`);
      } else {
        insights.push(`**A/B Test Winner:** Variant B was more successful. The style used in Variant B drives better emotional responses for this segment.`);
      }
    }

    insights.push(`**Next Action:** Target users who opened but did not click yet. Retarget them via a secondary channel like RCS or Email with an additional incentive.`);

    return insights;
  }

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeApiKey}`,
      {
        contents: [
          { role: 'user', parts: [{ text: "You are Xeno's AI marketing optimization agent. Summarize this campaign performance report into 3 clear, concise, actionable suggestions." }] },
          { role: 'user', parts: [{ text: prompt }] }
        ]
      }
    );
    const text = response.data.candidates[0].content.parts[0].text.trim();
    return text.split('\n').filter(line => line.trim().length > 0).slice(0, 3);
  } catch (error) {
    console.error('[AI Engine] Insight generation failed:', error.message);
    return ["Review the click-to-conversion funnel to identify why shoppers dropped off.", "Check channel configurations.", "Run a retargeting campaign next week."];
  }
}

/**
 * Checks whether a user's question is relevant to the CRM database context.
 * Only rejects CLEARLY off-topic questions — everything else passes through.
 */
function isDbRelevant(text) {
  const t = text.toLowerCase().trim();
  if (t.length < 2) return false;

  // Hard off-topic — only reject if clearly about these unrelated topics
  const offTopicPatterns = [
    /\b(weather|rain|temperature|forecast|climate)\b/,
    /\b(cricket|football|soccer|ipl|match score|player score|chess tournament)\b/,
    /\b(netflix|bollywood|hollywood|movie ticket|film review|actor|actress)\b/,
    /\b(cook recipe|recipe for|how to cook|dinner recipe)\b/,
    /\b(tell me a joke|funny joke|make me laugh|stand.?up comedy)\b/,
    /\b(election result|political party|prime minister of|president of)\b/,
    /\b(bitcoin price|crypto price|stock price|share price|nifty|sensex)\b/,
    /\b(write a poem|write an essay|write a story|write code|debug my code)\b/,
    /\b(what is your name|who made you|are you an ai|are you human)\b/
  ];

  for (const pattern of offTopicPatterns) {
    if (pattern.test(t)) return false;
  }

  // Everything else is allowed — offline handler produces helpful fallback if needed
  return true;
}

/**
 * Normalise user text — expand common typos/abbreviations to standard words
 * so the keyword matchers work even for shorthand input.
 */
function normalise(raw) {
  return raw
    .toLowerCase()
    .replace(/\bordrs?\b/g, 'orders')
    .replace(/\bordr\b/g, 'order')
    .replace(/\bpurchse\b/g, 'purchase')
    .replace(/\bgratr thn\b/g, 'greater than')
    .replace(/\bgratr\b/g, 'greater than')
    .replace(/\bgrtr\b/g, 'greater than')
    .replace(/\bmore thn\b/g, 'more than')
    .replace(/\bless thn\b/g, 'less than')
    .replace(/\babve\b/g, 'above')
    .replace(/\bblw\b/g, 'below')
    .replace(/\bcustmr?\b/g, 'customer')
    .replace(/\bshppr?\b/g, 'shopper')
    .replace(/\brevnu\b/g, 'revenue')
    .replace(/\brevn\b/g, 'revenue')
    .replace(/\bincom\b/g, 'revenue')
    .replace(/\bbrk?dwn\b/g, 'breakdown')
    .replace(/\bcmpgn?\b/g, 'campaign')
    .replace(/\bcatgry\b/g, 'category')
    .replace(/\bavg\b/g, 'average')
    .replace(/\bthn\b/g, 'than')
    .replace(/\bthan than\b/g, 'than'); // deduplicate accidental 'greater than than'
}

/**
 * Local Rule-based Database Helper
 */
async function askAIAboutDatabaseOffline(question, brand) {
  const brandKey = (brand || 'starbucks').toLowerCase();
  const raw = question.toLowerCase();
  const text = normalise(raw); // normalised for pattern matching
  let sqlQuery = null;
  let answer = "";
  let results = [];


  try {
    if (text.includes('hello') || text.includes('hi') || text.includes('hey') || text.includes('hlo') || text.includes('help') || text.includes('what can you')) {
      answer = `Hello! I'm your **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)} Database Assistant**. I can answer questions about this brand's live database.\n\nTry asking me:\n• *How many customers do we have?*\n• *What is our total revenue?*\n• *Who is the top spender?*\n• *Show me category breakdown*\n• *What are the active campaigns?*`;
    }
    else if (text.includes('how many customer') || text.includes('customer count') || text.includes('number of shopper') || text.includes('total customer') || text.includes('total shopper') || text.includes('how many shopper')) {
      sqlQuery = "SELECT COUNT(*) as count FROM customers";
      const res = await db.getQuery(brandKey, sqlQuery);
      answer = `There are currently **${res.count}** registered customer profiles stored in the **${brandKey}** database.`;
    }
    else if (text.includes('revenue') || text.includes('total sales') || text.includes('money earned') || text.includes('income')) {
      sqlQuery = "SELECT SUM(amount) as total FROM orders WHERE status = 'COMPLETED'";
      const res = await db.getQuery(brandKey, sqlQuery);
      const total = res.total ? parseFloat(res.total.toFixed(2)) : 0;
      answer = `The total sales revenue completed for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}** is **₹${total}**.`;
    }
    // ── Orders above/below a threshold ───────────
    else if (/orders?.*?(greater than|more than|above|over|>).*?(\d[\d,]*)/.test(text) || /orders?.*?(less than|below|under|<).*?(\d[\d,]*)/.test(text)) {
      const amountMatch = text.match(/(\d[\d,]*)/);
      const amount = amountMatch ? parseInt(amountMatch[0].replace(/,/g, '')) : 1000;
      const isAbove = /(greater than|more than|above|over|>)/.test(text);
      const op = isAbove ? '>' : '<';
      const label = isAbove ? `greater than ₹${amount}` : `less than ₹${amount}`;
      sqlQuery = `SELECT c.name, o.amount, o.status, o.created_at FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.amount ${op} ${amount} ORDER BY o.amount DESC LIMIT 20`;
      results = await db.allQuery(brandKey, sqlQuery);
      answer = `Found **${results.length}** orders ${label} in the **${brandKey}** database${results.length === 20 ? ' (showing first 20)' : ''}. See the table below for details.`;
    }
    else if (text.includes('how many order') || text.includes('total order') || text.includes('number of order') || text.includes('order count')) {
      sqlQuery = "SELECT COUNT(*) as count FROM orders";
      const res = await db.getQuery(brandKey, sqlQuery);
      answer = `The **${brandKey}** database contains a total of **${res.count}** order transaction records.`;
    }

    // ── Top N customers by spend ──────────────────────────────────────────────
    else if (/top\s*(\d+)?\s*(customer|shopper|spender|buyer)/.test(text)) {
      const match = text.match(/top\s*(\d+)/);
      const limit = match ? parseInt(match[1]) : 5;
      sqlQuery = `SELECT c.name, COALESCE(SUM(o.amount),0) as total_spent FROM customers c LEFT JOIN orders o ON c.id=o.customer_id AND o.status='COMPLETED' GROUP BY c.id ORDER BY total_spent DESC LIMIT ${limit}`;
      results = await db.allQuery(brandKey, sqlQuery);
      const lines = results.map((r, i) => `**${i + 1}.** ${r.name} — ₹${parseFloat(r.total_spent.toFixed(2))}`).join('\n');
      answer = `Here are the top **${limit}** customers by spend at **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}**:\n\n${lines}`;
    }

    // ── Single top spender ────────────────────────────────────────────────────
    else if (/spent the most|best customer|highest spender|top spender|most valuable/.test(text)) {
      sqlQuery = `SELECT c.name, SUM(o.amount) as total_spent FROM customers c JOIN orders o ON c.id=o.customer_id WHERE o.status='COMPLETED' GROUP BY c.id ORDER BY total_spent DESC LIMIT 1`;
      const res = await db.getQuery(brandKey, sqlQuery);
      if (res) {
        answer = `Our highest spender at **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}** is **${res.name}**, with completed purchases totalling **₹${parseFloat(res.total_spent.toFixed(2))}**.`;
      } else {
        answer = "No spender records found in the database yet.";
      }
    }

    // ── Revenue / sales ───────────────────────────────────────────────────────
    else if (/revenue|total sales|money earned|total spend|income|how much.*made|earnings/.test(text)) {
      sqlQuery = "SELECT SUM(amount) as total FROM orders WHERE status='COMPLETED'";
      const res = await db.getQuery(brandKey, sqlQuery);
      const total = res.total ? parseFloat(res.total.toFixed(2)) : 0;
      answer = `The total completed sales revenue for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}** is **₹${total}**.`;
    }

    // ── Orders above/below a threshold ───────────────────────────────────────
    else if (/orders?.*(greater than|more than|above|over|>)\s*[\d,]+/.test(text) || /orders?.*(less than|below|under|<)\s*[\d,]+/.test(text)) {
      const amountMatch = text.match(/[\d,]+/);
      const amount = amountMatch ? parseInt(amountMatch[0].replace(/,/g, '')) : 1000;
      const isAbove = /(greater than|more than|above|over|>)/.test(text);
      const op = isAbove ? '>' : '<';
      const label = isAbove ? `greater than ₹${amount}` : `less than ₹${amount}`;
      sqlQuery = `SELECT c.name, o.amount, o.status, o.created_at FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.amount ${op} ${amount} ORDER BY o.amount DESC LIMIT 20`;
      results = await db.allQuery(brandKey, sqlQuery);
      answer = `Found **${results.length}** orders ${label} in the **${brandKey}** database${results.length === 20 ? ' (showing first 20)' : ''}. See the table below for details.`;
    }

    // ── Order count ───────────────────────────────────────────────────────────
    else if (/how many orders?|total orders?|number of orders?|order count/.test(text)) {
      sqlQuery = "SELECT COUNT(*) as count FROM orders";
      const res = await db.getQuery(brandKey, sqlQuery);
      answer = `The **${brandKey}** database contains **${res.count}** order transaction records in total.`;
    }

    // ── Average order value ───────────────────────────────────────────────────
    else if (/average order|avg order|average purchase|aov|average spend/.test(text)) {
      sqlQuery = "SELECT AVG(amount) as avg_order FROM orders WHERE status='COMPLETED'";
      const res = await db.getQuery(brandKey, sqlQuery);
      const avg = res.avg_order ? parseFloat(res.avg_order.toFixed(2)) : 0;
      answer = `The Average Order Value (AOV) for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}** is **₹${avg}**.`;
    }

    // ── Category / shopper breakdown ──────────────────────────────────────────
    else if (/category|favourite|favorite|shopper breakdown|category breakdown|segment breakdown/.test(text)) {
      sqlQuery = `SELECT COALESCE(json_extract(metadata,'$.favorite_category'),'General') as category, COUNT(*) as count FROM customers GROUP BY category ORDER BY count DESC`;
      results = await db.allQuery(brandKey, sqlQuery);
      const lines = results.map(r => `• **${r.category}**: ${r.count} shoppers`).join('\n');
      answer = `Here is the shopper breakdown by category for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}**:\n\n${lines}`;
    }

    // ── Channel preferences ───────────────────────────────────────────────────
    else if (/preferred channel|communication channel|channel breakdown|channel preference|whatsapp|sms|email.*channel/.test(text)) {
      sqlQuery = `SELECT COALESCE(json_extract(metadata,'$.preferred_channel'),'Unknown') as channel, COUNT(*) as count FROM customers GROUP BY channel ORDER BY count DESC`;
      results = await db.allQuery(brandKey, sqlQuery);
      const lines = results.map(r => `• **${r.channel.toUpperCase()}**: ${r.count} shoppers`).join('\n');
      answer = `Here is the preferred communication channel breakdown for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}**:\n\n${lines}`;
    }

    // ── Order status breakdown ────────────────────────────────────────────────
    else if (/order.*status|status.*order|completed order|pending order|refunded order/.test(text)) {
      sqlQuery = `SELECT status, COUNT(*) as count FROM orders GROUP BY status ORDER BY count DESC`;
      results = await db.allQuery(brandKey, sqlQuery);
      const lines = results.map(r => `• **${r.status}**: ${r.count} orders`).join('\n');
      answer = `Here is the order status breakdown for **${brandKey}**:\n\n${lines}`;
    }

    // ── Campaign count ────────────────────────────────────────────────────────
    else if (/campaign.*(how many|count|total)|how many.*campaign/.test(text)) {
      sqlQuery = "SELECT COUNT(*) as count FROM campaigns";
      const res = await db.getQuery(brandKey, sqlQuery);
      answer = `A total of **${res.count}** marketing campaigns have been launched for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}**.`;
    }

    // ── Active campaigns ──────────────────────────────────────────────────────
    else if (/active campaign|list campaign|show campaign|running campaign/.test(text)) {
      sqlQuery = `SELECT name, channel, status, created_at FROM campaigns WHERE status='ACTIVE' ORDER BY created_at DESC`;
      results = await db.allQuery(brandKey, sqlQuery);
      if (results.length > 0) {
        const lines = results.map(r => `• **${r.name}** via ${r.channel.toUpperCase()} (${new Date(r.created_at).toLocaleDateString()})`).join('\n');
        answer = `Active campaigns for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}**:\n\n${lines}`;
      } else {
        const recentSql = `SELECT name, channel, status, created_at FROM campaigns ORDER BY created_at DESC LIMIT 10`;
        const recentCamps = await db.allQuery(brandKey, recentSql);
        if (recentCamps.length > 0) {
          const lines = recentCamps.map(r => `• **${r.name}** via ${r.channel.toUpperCase()} (${r.status})`).join('\n');
          answer = `There are no currently running active dispatch streams. However, here are the recent campaigns recorded for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}**:\n\n${lines}`;
          results = recentCamps;
          sqlQuery = recentSql;
        } else {
          answer = `There are currently no campaigns recorded in the **${brandKey}** database.`;
        }
      }
    }

    // ── Campaign status breakdown ─────────────────────────────────────────────
    else if (/campaign.*status|status.*campaign/.test(text)) {
      sqlQuery = `SELECT status, COUNT(*) as count FROM campaigns GROUP BY status ORDER BY count DESC`;
      results = await db.allQuery(brandKey, sqlQuery);
      const lines = results.map(r => `• **${r.status}**: ${r.count} campaigns`).join('\n');
      answer = `Campaign status breakdown for **${brandKey}**:\n\n${lines}`;
    }

    // ── City / location ───────────────────────────────────────────────────────
    else if (/city|location|region|where are|cities/.test(text)) {
      sqlQuery = `SELECT COALESCE(json_extract(metadata,'$.city'),'Unknown') as city, COUNT(*) as count FROM customers GROUP BY city ORDER BY count DESC`;
      results = await db.allQuery(brandKey, sqlQuery);
      const lines = results.map(r => `• **${r.city}**: ${r.count} shoppers`).join('\n');
      answer = `Shopper city distribution for **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}**:\n\n${lines}`;
    }

    // ── Age distribution ──────────────────────────────────────────────────────
    else if (/age|how old|age group|age range/.test(text)) {
      sqlQuery = `SELECT json_extract(metadata,'$.age') as age, COUNT(*) as count FROM customers WHERE age IS NOT NULL GROUP BY age ORDER BY age`;
      results = await db.allQuery(brandKey, sqlQuery);
      if (results.length > 0) {
        const ages = results.map(r => parseInt(r.age));
        const avg = Math.round(ages.reduce((a, b) => a + b, 0) / ages.length);
        answer = `The average customer age at **${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}** is **${avg} years**. Ages range from ${Math.min(...ages)} to ${Math.max(...ages)}.`;
      } else {
        answer = "No age data found in the customer database.";
      }
    }

    // ── Fallback ──────────────────────────────────────────────────────────────
    else {
      answer = `I am your AI CRM Assistant. In offline mode, I can query the brand databases for queries containing keywords like **revenue**, **shoppers**, **orders**, **active campaigns**, **category breakdown**, **spenders**, and **city distribution**.\n\n*Note: To ask general questions about the app, write code, or query with full natural language understanding, please enter a Gemini API Key in the Settings tab.*`;
    }
  } catch (err) {
    answer = `Failed to process offline query. Error: ${err.message}`;
  }

  return { answer, sqlQuery, results };
}

/**
 * Live LLM Database Copilot scoped by brand
 */
async function askAIAboutDatabase(question, apiKey, brand) {
  const brandKey = (brand || 'starbucks').toLowerCase();
  const activeApiKey = apiKey || process.env.GEMINI_API_KEY;

  if (!activeApiKey) {
    return askAIAboutDatabaseOffline(question, brandKey);
  }

  const schemaDescription = `
We have an SQLite database for the multi-tenant brand "${brandKey}" with the following tables:
1. customers (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, metadata TEXT) 
   -- Note: metadata contains JSON string like {"favorite_category": "Coffee", "preferred_channel": "whatsapp", "city": "Seattle", "age": 28}
   -- To query metadata fields, use: json_extract(metadata, '$.favorite_category'), json_extract(metadata, '$.preferred_channel'), json_extract(metadata, '$.city'), json_extract(metadata, '$.age')

2. orders (id TEXT PRIMARY KEY, customer_id TEXT, amount REAL, status TEXT, items TEXT, created_at DATETIME)
   -- Note: items contains JSON array string of item names, e.g. ["Espresso", "Mug"]. status is either 'COMPLETED', 'PENDING', or 'REFUNDED'.

3. campaigns (id TEXT PRIMARY KEY, name TEXT, channel TEXT, status TEXT, created_at DATETIME, message_template TEXT, segment_rules TEXT)
   -- Note: status is either 'ACTIVE' or 'COMPLETED'. Since dispatch finishes quickly, most campaigns in the database will have status='COMPLETED'. If the user asks for active/running/recent campaigns, select recent campaigns from here regardless of status.

4. communications (id TEXT PRIMARY KEY, campaign_id TEXT, customer_id TEXT, channel TEXT, status TEXT, message_body TEXT, created_at DATETIME, updated_at DATETIME)
   -- Note: status is SENT, DELIVERED, READ, CLICKED, CONVERTED, or FAILED.

5. events (id TEXT PRIMARY KEY, communication_id TEXT, event_type TEXT, timestamp DATETIME, metadata TEXT)
`;

  const translatePrompt = `
You are Xeno's AI Assistant for the brand "${brandKey}". Xeno is an enterprise multi-tenant campaign management CRM.

Overview of Xeno App features:
- Multi-tenant database isolation: every brand tenant (Starbucks, Zara, Nike, Sephora, Apple, Tesla, IKEA, Amazon) has its own isolated SQLite database.
- Database Explorer: Browse shopper profiles, transaction records, and add shoppers/transactions manually or via CSV file uploads.
- Campaign Wizard: Build campaign segments using AI prompts or visual rule builders. Select target audience, filter by channel preference (WhatsApp, SMS, Email, RCS), spend history, recency, etc.
- Live Webhook Stream: Simulates message transmission, delivery events (SENT, DELIVERED, READ, CLICKED, CONVERTED, FAILED) and logs them in real-time.
- App Ratings: Dashboard pulling app reviews, ratings, and AI analysis for the active brand.
- AI Assistant: Typeable database chatbot (this interface) to query and understand tenant databases or get general CRM help.

SQLite Schema:
${schemaDescription}

User Question: "${question}"

Instructions:
1. If the user is asking a database query (e.g., querying shoppers, transactions, revenue, orders, campaigns, communications, or raw data), translate it into a single read-only SQLite SELECT query. Respond with:
{
  "sqlQuery": "SELECT ...",
  "interpretation": "Brief description of what is being queried",
  "directAnswer": null,
  "isOffTopic": false
}
2. If the user is asking a general question, a question about Xeno, or any other query (e.g., weather, sports, general knowledge, explanation of the app, greetings, coding), set "sqlQuery" to null and provide a detailed, friendly, and helpful direct answer in "directAnswer":
{
  "sqlQuery": null,
  "interpretation": null,
  "directAnswer": "Your detailed, complete, and helpful answer here...",
  "isOffTopic": false
}

IMPORTANT: Respond ONLY with raw JSON. No markdown, no triple backticks.
`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeApiKey}`,
      {
        contents: [
          { role: 'user', parts: [{ text: translatePrompt }] }
        ],
        generationConfig: { responseMimeType: "application/json" }
      },
      { timeout: 7000 }
    );

    const resultText = response.data.candidates[0].content.parts[0].text.trim();
    const jsonString = resultText.replace(/^```json/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonString);

    if (!parsed.sqlQuery) {
      return {
        answer: parsed.directAnswer || `Hello! I am your AI Database Assistant for ${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}. How can I help you query the shopper profiles or campaigns database today?`,
        sqlQuery: null
      };
    }

    let queryResults;
    try {
      queryResults = await db.allQuery(brandKey, parsed.sqlQuery);
    } catch (dbErr) {
      console.error('[AI Chat] SQL execution failed:', dbErr.message);
      return {
        answer: `I generated the SQLite query \`${parsed.sqlQuery}\` but it failed to run with error: *${dbErr.message}*. Try asking your question in a different way.`,
        sqlQuery: parsed.sqlQuery
      };
    }

    const answerPrompt = `
You are Xeno's AI database assistant for ${brandKey.charAt(0).toUpperCase() + brandKey.slice(1)}.
The user asked: "${question}"
We translated it into this SQLite query:
\`\`\`sql
${parsed.sqlQuery}
\`\`\`
The query successfully returned the following raw data from ${brandKey}'s database:
\`\`\`json
${JSON.stringify(queryResults.slice(0, 30), null, 2)}
\`\`\`
${queryResults.length > 30 ? `(Showing first 30 of ${queryResults.length} rows)` : ''}

Please write a friendly, helpful, and natural language summary answer for the user. Highlight key insights, lists, or metrics if applicable. Keep it concise.
`;

    const answerResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeApiKey}`,
      {
        contents: [
          { role: 'user', parts: [{ text: answerPrompt }] }
        ]
      },
      { timeout: 8000 }
    );

    const finalAnswer = answerResponse.data.candidates[0].content.parts[0].text.trim();
    return {
      answer: finalAnswer,
      sqlQuery: parsed.sqlQuery,
      results: queryResults.slice(0, 10)
    };

  } catch (error) {
    console.error('[AI Chat] Gemini chat error, falling back offline:', error.message);
    return askAIAboutDatabaseOffline(question, brandKey);
  }
}

async function generateRatingsInsights(reviewsList, apiKey, brand) {
  const brandKey = (brand || 'starbucks').toLowerCase();
  const activeApiKey = apiKey || process.env.GEMINI_API_KEY;

  if (!activeApiKey) {
    const offlineInsightsMap = {
      starbucks: [
        "**Key Strengths**: Customers love the speed of mobile order-and-pay and value the benefits of the reward loyalty system.",
        "**Core Weaknesses**: Noted complaints about checkout crashes on older app versions and longer queuing waits during peak morning rushes.",
        "**Strategic Advice**: Scale up peak hour baristas and roll out hotfixes targeting Android transaction checkout loops."
      ],
      zara: [
        "**Key Strengths**: Positive comments highlight the sleek visual design of the apparel catalog and accuracy of sizing recommendations.",
        "**Core Weaknesses**: High volume of complaints regarding returns processing delays and performance latency loading high-res images.",
        "**Strategic Advice**: Optimize media compression pathways for fast mobile browsing and optimize return routing pipelines."
      ],
      sephora: [
        "**Key Strengths**: Shoppers are highly engaged by the virtual makeup try-on tools and praise the generous distribution of free samples.",
        "**Core Weaknesses**: Users report session timeout errors clearing shopping carts, and packaging safety issues during shipment.",
        "**Strategic Advice**: Extend cart cache lifetimes in local storage and add secure bubblewrap packing for fragile makeup items."
      ],
      nike: [
        "**Key Strengths**: Strong user affinity for exclusive Jordan launches, fast standard shipping times, and accurate sizing scales.",
        "**Core Weaknesses**: Frustrations center around low success rates during SNKRS drawings and checkout crashes on limited footwear drops.",
        "**Strategic Advice**: Improve bot detection filtering on limited drawings and scale server bandwidth during high-traffic sneaker launches."
      ],
      apple: [
        "**Key Strengths**: Very high scores for seamless device purchases, trade-in setups, and easy scheduling of Genius Bar appointments.",
        "**Core Weaknesses**: Repetitive complaints about repair pricing for out-of-warranty hardware and shipment delivery tracking sync lags.",
        "**Strategic Advice**: Review component repair pricing structures and improve webhook push alerts for carrier delivery milestones."
      ],
      tesla: [
        "**Key Strengths**: Magic user feedback regarding remote pre-heating, charging notifications, and keyless entry driving controls.",
        "**Core Weaknesses**: Incidents of bluetooth key pairing drops causing lockouts and long service center waiting lists.",
        "**Strategic Advice**: Improve local Bluetooth background connectivity on mobile and expand local service center footprints."
      ],
      ikea: [
        "**Key Strengths**: Users enjoy the Augmented Reality (AR) furniture placement feature and fast self-checkout listing tools.",
        "**Core Weaknesses**: Incorrect store inventory sync causing customer disappointment and missing hardware components in packages.",
        "**Strategic Advice**: Improve real-time local store stock counts and add quality checks for hardware weight packaging."
      ],
      amazon: [
        "**Key Strengths**: Prime delivery speeds, one-click checkouts, and easy self-service return dropoffs are highly praised.",
        "**Core Weaknesses**: Flooded sponsored results, fake merchant reviews, and difficulty reaching human support operators.",
        "**Strategic Advice**: Refine search relevance filters to separate organic results and prioritize human chat agent escalations."
      ]
    };
    return offlineInsightsMap[brandKey] || [
      "Review platform feedback to pinpoint app stability issue areas.",
      "Customer reviews indicate general product quality satisfaction.",
      "Resolve payment gateway checkout drops to improve ratings."
    ];
  }

  const prompt = `
You are the AI Brand Performance Auditor for Xeno. Analyze the following user ratings and reviews for the brand "${brandKey}":
${JSON.stringify(reviewsList, null, 2)}

Provide three highly actionable bullet points summarizing the overall ratings insights. 
- Highlight what customers love (Key Strengths)
- Highlight core problems / pain points (Core Weaknesses)
- Provide a strategic recommendation to improve performance.

Keep each bullet point extremely concise (1-2 sentences), direct, and return them in a JSON array:
["**Key Strengths**: ...", "**Core Weaknesses**: ...", "**Strategic Advice**: ..."]
Respond ONLY with raw JSON. No markdown, no triple backticks.
`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeApiKey}`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      },
      { timeout: 7000 }
    );
    const resultText = response.data.candidates[0].content.parts[0].text.trim();
    const jsonString = resultText.replace(/^```json/, '').replace(/```$/, '').trim();
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('[AI Ratings] Insights generation failed, using local backup:', error.message);
    // fallback
    const offlineInsightsMap = {
      starbucks: [
        "**Key Strengths**: Customers love the speed of mobile order-and-pay and value the benefits of the reward loyalty system.",
        "**Core Weaknesses**: Noted complaints about checkout crashes on older app versions and longer queuing waits during peak morning rushes.",
        "**Strategic Advice**: Scale up peak hour baristas and roll out hotfixes targeting Android transaction checkout loops."
      ],
      zara: [
        "**Key Strengths**: Positive comments highlight the sleek visual design of the apparel catalog and accuracy of sizing recommendations.",
        "**Core Weaknesses**: High volume of complaints regarding returns processing delays and performance latency loading high-res images.",
        "**Strategic Advice**: Optimize media compression pathways for fast mobile browsing and optimize return routing pipelines."
      ]
    };
    return offlineInsightsMap[brandKey] || [
      "Key Strengths: Users appreciate brand catalog designs and delivery speeds.",
      "Core Weaknesses: Negative reviews point to occasional payment processing errors and support delays.",
      "Strategic Advice: Roll out stability updates for the mobile app checkout flow."
    ];
  }
}

module.exports = {
  parsePromptLocally,
  parsePromptWithGemini,
  generateAIInsights,
  askAIAboutDatabase,
  generateRatingsInsights
};
