const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbConnections = {};

const BRAND_CONFIGS = {
  starbucks: {
    industry: 'Coffee & Beverages',
    categories: ['Coffee', 'Tea', 'Bakery', 'Merchandise'],
    items: ['Ethiopian Roast', 'Caramel Macchiato', 'Double Chocolate Brownie', 'Matcha Latte', 'Ceramic Mug'],
    names: ['Aarav Patel', 'Diya Sharma', 'Ishaan Iyer', 'Ananya Sen', 'Kabir Verma', 'Meera Nair', 'Rohan Gupta', 'Sai Krishnan', 'Aditi Rao', 'Dev Mukherjee'],
    customerSeedCount: 45,
    orderSeedCount: 130
  },
  zara: {
    industry: 'Fashion & Apparel',
    categories: ['Apparel', 'Accessories', 'Shoes', 'Outerwear'],
    items: ['Slim Fit Denim', 'Organic Cotton Tee', 'Oversized Linen Shirt', 'Leather Sneakers', 'Wool Coat'],
    names: ['Vihaan Singh', 'Aanya Joshi', 'Arjun Mehta', 'Kavya Bhat', 'Rudra Pandey', 'Sanya Kapoor', 'Atharv Saxena', 'Riya Malhotra', 'Vivaan Reddy', 'Kiara Khanna'],
    customerSeedCount: 65,
    orderSeedCount: 190
  },
  sephora: {
    industry: 'Beauty & Cosmetics',
    categories: ['Skincare', 'Makeup', 'Haircare', 'Fragrance'],
    items: ['Hydrating Face Mask', 'Vitamin C Serum', 'Matte Lipstick', 'Volumizing Shampoo', 'Floral Perfume'],
    names: ['Pooja Choudhury', 'Nisha Trivedi', 'Aditya Mishra', 'Sneha Deshmukh', 'Vikram Kulkarni', 'Neha Gokhale', 'Suresh Pillai', 'Priya Menon', 'Rahul Bose', 'Shreya Banerjee'],
    customerSeedCount: 35,
    orderSeedCount: 95
  },
  nike: {
    industry: 'Sports & Footwear',
    categories: ['Running', 'Training', 'Jordan', 'Sportswear'],
    items: ['Air Max Sneakers', 'Dri-FIT Shorts', 'Running Shoes', 'Fleece Hoodie', 'Cushioned Socks'],
    names: ['Pranav Hegde', 'Shruti Shenoy', 'Karan Johar', 'Tanvi Shah', 'Yash Singhal', 'Divya Bajaj', 'Manish Goel', 'Renu Aggarwal', 'Deepak Bansal', 'Ritu Jindal'],
    customerSeedCount: 50,
    orderSeedCount: 140
  },
  apple: {
    industry: 'Electronics & Technology',
    categories: ['iPhone', 'Mac', 'iPad', 'Accessories'],
    items: ['iPhone Pro Case', 'MacBook Air Charger', 'iPad Smart Folio', 'AirPods Pro', 'Apple Watch Strap'],
    names: ['Sameer Varma', 'Jyoti Prasad', 'Amitabh Bachchan', 'Madhuri Dixit', 'Hrithik Roshan', 'Kriti Sanon', 'Ranbir Kapoor', 'Alia Bhatt', 'Varun Dhawan', 'Siddharth Malhotra'],
    customerSeedCount: 28,
    orderSeedCount: 75
  },
  tesla: {
    industry: 'Automotive & Lifestyle',
    categories: ['Charging', 'Apparel', 'Accessories', 'Lifestyle'],
    items: ['Wall Connector', 'Tesla Cap', 'Cyberbackpack', 'Model Y Mud Flaps', 'Key Fob'],
    names: ['Mohit Chawla', 'Sunita Khurana', 'Gaurav Gill', 'Poonam Sodhi', 'Jaspreet Singh', 'Harpreet Kaur', 'Rajesh Koothrappali', 'Priyanka Chopra', 'Dev Patel', 'Mindy Kaling'],
    customerSeedCount: 18,
    orderSeedCount: 45
  },
  ikea: {
    industry: 'Furniture & Home Goods',
    categories: ['Living Room', 'Bedroom', 'Kitchen', 'Office'],
    items: ['Wool Cushion Cover', 'LED Desk Lamp', 'Ceramic Plates', 'Storage Box', 'Wooden Picture Frame'],
    names: ['Anil Ambani', 'Kiran Mazumdar', 'Azim Premji', 'Indra Nooyi', 'Satya Nadella', 'Sundar Pichai', 'Shantanu Narayen', 'Arvind Krishna', 'Nikesh Arora', 'Nandan Nilekani'],
    customerSeedCount: 40,
    orderSeedCount: 110
  },
  amazon: {
    industry: 'Retail & E-commerce',
    categories: ['Electronics', 'Books', 'Home', 'Kitchen'],
    items: ['Wireless Earbuds', 'Hardcover Novel', 'Desk Humidifier', 'Cast Iron Skillet', 'USB-C Cable'],
    names: ['Sachin Tendulkar', 'Virat Kohli', 'Rohit Sharma', 'MS Dhoni', 'Kapil Dev', 'Sunil Gavaskar', 'Abhinav Bindra', 'Pusarla Sindhu', 'Sania Mirza', 'Mary Kom'],
    customerSeedCount: 90,
    orderSeedCount: 260
  }
};

const REVIEW_TEMPLATES = {
  starbucks: {
    app_store: [
      { rating: 5, user_name: "Aarav P.", comment: "Love the mobile order and pay feature at Starbucks. Super fast!" },
      { rating: 5, user_name: "Diya S.", comment: "Great rewards system. I get a free coffee every few weeks." },
      { rating: 1, user_name: "Ishaan I.", comment: "App crashed during checkout and charged my card twice. Terrible customer support." },
      { rating: 2, user_name: "Ananya S.", comment: "Pickup queues are too long even when pre-ordering on the app." }
    ],
    play_store: [
      { rating: 5, user_name: "Kabir V.", comment: "Ordering my espresso before I arrive saves me 10 minutes every morning." },
      { rating: 4, user_name: "Meera N.", comment: "Very fluid UI, but sometimes the store locator is inaccurate." },
      { rating: 2, user_name: "Rohan G.", comment: "Keeps logging me out of my account after the recent Android update." }
    ],
    google_maps: [
      { rating: 5, user_name: "Sai K.", comment: "Always friendly staff and clean stores. My daily go-to spot." },
      { rating: 2, user_name: "Rohan Gupta", comment: "Very slow drive thru at this location. Ordered items were cold." }
    ],
    zomato: [
      { rating: 5, user_name: "Amit M.", comment: "Delivered hot and in spill-proof packaging! Perfect morning beverage." },
      { rating: 1, user_name: "Karan S.", comment: "Coffee arrived cold and took over 50 minutes. Zomato support was unhelpful." }
    ],
    swiggy: [
      { rating: 4, user_name: "Tanvi S.", comment: "Consistent taste and fast delivery via Swiggy." },
      { rating: 2, user_name: "Divya B.", comment: "Received the wrong drink. Ordered Cappuccino but got Black Coffee." }
    ],
    mouthshut: [
      { rating: 4, user_name: "Renu A.", comment: "Nice ambience and great place to work, though prices are high in India." },
      { rating: 1, user_name: "Deepak B.", comment: "They got my order wrong twice. Bad experience at the outlet." }
    ]
  },
  zara: {
    app_store: [
      { rating: 5, user_name: "Vihaan S.", comment: "Sleek apparel browser. The sizing recommendation tool is accurate!" },
      { rating: 5, user_name: "Aanya J.", comment: "Fast checkout and very clean animations in the catalog." },
      { rating: 2, user_name: "Arjun M.", comment: "Returns processing is incredibly slow through the app. Support is useless." }
    ],
    play_store: [
      { rating: 5, user_name: "Kavya B.", comment: "Love Zara's collection. The app makes tracking shipments super simple." },
      { rating: 4, user_name: "Rudra P.", comment: "Great app overall, but high-res images take a long time to load." },
      { rating: 1, user_name: "Sanya K.", comment: "The app drains my battery and gets stuck on the payment gateway." }
    ],
    google_maps: [
      { rating: 5, user_name: "Atharv S.", comment: "Huge collection at the Delhi store. Great checkout speed and support." },
      { rating: 2, user_name: "Riya M.", comment: "Trial rooms have massive waiting lines during sale season." }
    ],
    myntra: [
      { rating: 5, user_name: "Pranav H.", comment: "Fast delivery of Zara jackets on Myntra. Authentic product." },
      { rating: 2, user_name: "Tanvi S.", comment: "Myntra sizing was slightly off compared to original Zara fit." }
    ],
    ajio: [
      { rating: 5, user_name: "Sameer V.", comment: "Great discounts on Ajio during fashion sales. Prompt delivery." },
      { rating: 1, user_name: "Jyoti P.", comment: "AJIO customer care refused to exchange the size. Frustrating." }
    ],
    trustpilot: [
      { rating: 4, user_name: "Rahul B.", comment: "Excellent quality and packaging." },
      { rating: 2, user_name: "Suresh P.", comment: "Shipping package was torn and delivery agent was rude." }
    ]
  },
  sephora: {
    app_store: [
      { rating: 5, user_name: "Pooja C.", comment: "The virtual try-on makeup feature is amazing. Best beauty app." },
      { rating: 5, user_name: "Nisha T.", comment: "Fast delivery and lots of free samples included in orders." },
      { rating: 2, user_name: "Aditya M.", comment: "App frequently logs me out and clears my shopping cart. Frustrating." }
    ],
    play_store: [
      { rating: 5, user_name: "Sneha D.", comment: "My Beauty Insider points are tracked perfectly. Easy shopping!" },
      { rating: 4, user_name: "Vikram K.", comment: "User interface is nice, but beauty tips video player is laggy." },
      { rating: 1, user_name: "Neha G.", comment: "Terrible checkout loop. Cannot add my promo codes." }
    ],
    google_maps: [
      { rating: 5, user_name: "Suresh P.", comment: "Staff at Sephora Mumbai helped me find the perfect lipstick shade." },
      { rating: 2, user_name: "Priya M.", comment: "Store was overcrowded and staff ignored me." }
    ],
    nykaa: [
      { rating: 5, user_name: "Vikram G.", comment: "Genuine Sephora products on Nykaa. Super fast 2-day delivery." },
      { rating: 2, user_name: "Rahul B.", comment: "Nykaa delivered near-expiry sunscreen. Check dates before buying." }
    ],
    purplle: [
      { rating: 4, user_name: "Shreya B.", comment: "Got a free Sephora makeup bag with my order. Great packaging." },
      { rating: 1, user_name: "Sanjay M.", comment: "Delivery took 10 days and box arrived squashed." }
    ],
    trustpilot: [
      { rating: 5, user_name: "Sameer V.", comment: "Huge selection of cosmetics. Excellent packaging for shipping." },
      { rating: 2, user_name: "Jyoti P.", comment: "Customer support refused to refund damaged eye shadow palette." }
    ]
  },
  nike: {
    app_store: [
      { rating: 5, user_name: "Pranav H.", comment: "Easy access to exclusive Jordan releases. Nike App is great!" },
      { rating: 5, user_name: "Shruti S.", comment: "Fast shipping and very easy returns process. Highly recommend." },
      { rating: 2, user_name: "Karan J.", comment: "SNKRS app drawings are impossible to win. Always sold out." }
    ],
    play_store: [
      { rating: 5, user_name: "Tanvi S.", comment: "Sizing recommendations are spot on. Very comfortable sneakers." },
      { rating: 4, user_name: "Yash S.", comment: "Clean UI. Wish they kept shoe stock details more updated." },
      { rating: 1, user_name: "Divya B.", comment: "The app crashed during the checkout of limited edition sneakers. Missed out." }
    ],
    google_maps: [
      { rating: 5, user_name: "Manish G.", comment: "Nike Store BKC has an amazing collection and helpful staff." },
      { rating: 2, user_name: "Renu A.", comment: "No stock of running shoes in standard sizes." }
    ],
    myntra: [
      { rating: 5, user_name: "Deepak B.", comment: "Myntra has best discounts on Pegasus running shoes. Verified original." },
      { rating: 2, user_name: "Ritu J.", comment: "Shoe box arrived damaged, shoes are fine though." }
    ],
    amazon: [
      { rating: 5, user_name: "Aarav P.", comment: "Got standard Nike socks at a great price on Amazon. Prime delivery." },
      { rating: 1, user_name: "Ishaan I.", comment: "Suspicious seller, felt like duplicate product. Returned." }
    ],
    trustpilot: [
      { rating: 4, user_name: "Sai K.", comment: "Consistent product quality. Easy returns on Nike store online." },
      { rating: 2, user_name: "Aditi R.", comment: "Delivery took twice as long as promised with no tracking updates." }
    ]
  },
  apple: {
    app_store: [
      { rating: 5, user_name: "Sameer V.", comment: "Buying my iPhone Pro was a breeze. Seamless Apple Store experience." },
      { rating: 5, user_name: "Jyoti P.", comment: "Easy to book Genius Bar appointments. Very helpful app." },
      { rating: 2, user_name: "Amitabh B.", comment: "Apple Store app is good, but tracking shipping updates is laggy." }
    ],
    play_store: [
      { rating: 5, user_name: "Madhuri D.", comment: "Very clean layout. Shows local store inventory accurately." },
      { rating: 4, user_name: "Hrithik R.", comment: "Good shopping experience but it lacks detailed accessory specs." },
      { rating: 1, user_name: "Kriti S.", comment: "App doesn't load at all on my device. Displays an API connection error." }
    ],
    google_maps: [
      { rating: 5, user_name: "Ranbir K.", comment: "The Apple BKC store is stunning. Incredibly helpful staff." },
      { rating: 2, user_name: "Alia B.", comment: "Genius bar appointments are always booked out." }
    ],
    amazon: [
      { rating: 5, user_name: "Varun D.", comment: "Super fast delivery of iPad on Amazon. Safe packaging." },
      { rating: 2, user_name: "Siddharth M.", comment: "Card discount was not applied correctly during checkout." }
    ],
    flipkart: [
      { rating: 5, user_name: "Sameer V.", comment: "Got a great deal on MacBook Air during Big Billion Days. Brand new." },
      { rating: 1, user_name: "Jyoti P.", comment: "Open box delivery was stressful, and agent refused to wait." }
    ],
    mouthshut: [
      { rating: 5, user_name: "Mohit C.", comment: "Outstanding device longevity and brand reliability." },
      { rating: 2, user_name: "Sunita K.", comment: "Apple out-of-warranty screen repair costs are unreasonably high." }
    ]
  },
  tesla: {
    app_store: [
      { rating: 5, user_name: "Mohit C.", comment: "Controlling my Model 3 remotely is absolute magic. Pre-heating works great." },
      { rating: 5, user_name: "Sunita K.", comment: "Keyless driving via phone works 100% of the time. Fluid and modern UI." },
      { rating: 2, user_name: "Gaurav G.", comment: "Bluetooth key connection randomly drops. I get locked out of the car." }
    ],
    play_store: [
      { rating: 5, user_name: "Poonam S.", comment: "Instant charging notifications and maps showing supercharger stalls are super helpful." },
      { rating: 4, user_name: "Jaspreet S.", comment: "Great app. Only complaint is high battery consumption in background." },
      { rating: 1, user_name: "Harpreet Kaur", comment: "The app locks up on the splash screen since the latest Android OS update." }
    ],
    google_maps: [
      { rating: 5, user_name: "Rajesh K.", comment: "Clean service station and helpful engineers. Highly professional showroom." },
      { rating: 2, user_name: "Priyanka C.", comment: "No service center in my city, had to tow the car 100km." }
    ],
    carwale: [
      { rating: 5, user_name: "Dev P.", comment: "Incredible acceleration and torque. The tech is lightyears ahead." },
      { rating: 2, user_name: "Mindy K.", comment: "High initial import duties make it expensive in India." }
    ],
    zigwheels: [
      { rating: 4, user_name: "Gaurav G.", comment: "Amazing autopilot features on highways. Feels like future." },
      { rating: 1, user_name: "Sunita K.", comment: "Suspension is a bit stiff for local potholes." }
    ],
    teambhp: [
      { rating: 5, user_name: "Rajesh K.", comment: "Detailed owner reviews. Best electric drivetrain available." },
      { rating: 2, user_name: "Priyanka C.", comment: "Panel gaps are inconsistent for a premium vehicle." }
    ]
  },
  ikea: {
    app_store: [
      { rating: 5, user_name: "Anil A.", comment: "The AR feature to place furniture in my room works surprisingly well!" },
      { rating: 5, user_name: "Kiran M.", comment: "Makes listing items and checkout at the store very fast." },
      { rating: 2, user_name: "Azim P.", comment: "Stock availability status is wrong. I went to the store and item was out of stock." }
    ],
    play_store: [
      { rating: 5, user_name: "Indra N.", comment: "Creating shopping lists for my office setup was quick and easy." },
      { rating: 4, user_name: "Satya N.", comment: "Good UI. Navigating the large catalog works smoothly." },
      { rating: 1, user_name: "Sundar P.", comment: "App crashes when attempting to calculate delivery fees for large furniture." }
    ],
    google_maps: [
      { rating: 5, user_name: "Shantanu N.", comment: "Huge showroom! The food court meatballs are delicious too." },
      { rating: 2, user_name: "Arvind K.", comment: "Navigation map inside store is confusing. Got lost for hours." }
    ],
    trustpilot: [
      { rating: 5, user_name: "Nikesh A.", comment: "Fast flatpack delivery and clear assembly guides." },
      { rating: 2, user_name: "Nandan N.", comment: "Delivered box was missing assembly screws. Had to visit store." }
    ],
    mouthshut: [
      { rating: 4, user_name: "Kiran M.", comment: "Great quality budget furniture for home office setups." },
      { rating: 2, user_name: "Azim P.", comment: "Assembly service charges are too high compared to local options." }
    ],
    pepperfry: [
      { rating: 4, user_name: "Indra N.", comment: "Good pricing comparison vs Pepperfry ready-made furniture." },
      { rating: 2, user_name: "Satya N.", comment: "Pepperfry delivery is pre-assembled, IKEA takes hours to build." }
    ]
  },
  amazon: {
    app_store: [
      { rating: 5, user_name: "Sachin T.", comment: "One-click ordering and same-day delivery are life-changing. Flawless." },
      { rating: 5, user_name: "Virat K.", comment: "Everything I need in one app. Easy returns and instant refunds." },
      { rating: 2, user_name: "Rohit S.", comment: "Search results are filled with sponsored ads. Hard to find real products." }
    ],
    play_store: [
      { rating: 5, user_name: "MS Dhoni", comment: "Tracking package deliveries on the map is very helpful. Always on time." },
      { rating: 4, user_name: "Kapil D.", comment: "Fast browsing experience, but sometimes customer reviews section won't load." },
      { rating: 1, user_name: "Sunil G.", comment: "Too many fake sellers and customer support chat is just a loop of automated replies." }
    ],
    trustpilot: [
      { rating: 5, user_name: "Abhinav B.", comment: "Amazon Prime membership is completely worth it for streaming and delivery." },
      { rating: 2, user_name: "Pusarla S.", comment: "Delivery driver left my expensive package out in the rain without notifying me." }
    ],
    mouthshut: [
      { rating: 4, user_name: "Sania M.", comment: "Easy customer refunds for returned products." },
      { rating: 2, user_name: "Mary K.", comment: "Seller sent duplicate item and refused refund support." }
    ],
    google_maps: [
      { rating: 5, user_name: "Sachin T.", comment: "Delivery pickup locker location is very convenient." },
      { rating: 2, user_name: "Virat K.", comment: "Pickup counter closed early without warning." }
    ],
    customercare: [
      { rating: 4, user_name: "MS Dhoni", comment: "Resolved my shipping issue within 2 hours." },
      { rating: 1, user_name: "Kapil D.", comment: "Spent 40 minutes on call trying to reach a human support agent." }
    ]
  }
};

function getDbConnection(brand) {
  const brandKey = (brand || 'starbucks').toLowerCase();
  if (!dbConnections[brandKey]) {
    const dbPath = path.join(__dirname, `crm_${brandKey}.db`);
    const db = new sqlite3.Database(dbPath);
    db.run("PRAGMA busy_timeout = 5000");
    dbConnections[brandKey] = db;
  }
  return dbConnections[brandKey];
}

// Promised-based SQLite helpers scoped by brand
function runQuery(brand, sql, params = []) {
  const db = getDbConnection(brand);
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(brand, sql, params = []) {
  const db = getDbConnection(brand);
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(brand, sql, params = []) {
  const db = getDbConnection(brand);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Initialize tables for specific brand
async function initDatabase(brand) {
  const brandKey = (brand || 'starbucks').toLowerCase();
  console.log(`[Database] Initializing tables for brand: ${brandKey}...`);

  // 1. Customers
  await runQuery(brandKey, `
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      metadata TEXT, -- JSON structure
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Orders
  await runQuery(brandKey, `
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL, -- COMPLETED, PENDING, REFUNDED
      items TEXT, -- JSON structure of purchased items
      created_at DATETIME NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
  `);

  // 3. Campaigns
  await runQuery(brandKey, `
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      segment_rules TEXT, -- JSON rules
      message_template TEXT NOT NULL,
      channel TEXT NOT NULL, -- whatsapp, sms, email, rcs
      status TEXT DEFAULT 'DRAFT', -- DRAFT, ACTIVE, COMPLETED
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Communications
  await runQuery(brandKey, `
    CREATE TABLE IF NOT EXISTS communications (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL, -- PENDING, SENT, DELIVERED, FAILED, READ, CLICKED, CONVERTED
      message_body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
  `);

  // 5. Events (Callback Audit Trail)
  await runQuery(brandKey, `
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      communication_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT, -- JSON structure
      FOREIGN KEY(communication_id) REFERENCES communications(id)
    )
  `);

  // 6. Platform Reviews
  await runQuery(brandKey, `
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL, -- app_store, play_store, trustpilot
      rating INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log(`[Database] Tables ready for brand: ${brandKey}.`);
  
  // Seed only if empty
  const customerCount = await getQuery(brandKey, 'SELECT COUNT(*) as count FROM customers');
  if (customerCount.count === 0) {
    await seedDatabase(brandKey);
  }
}

// Seed brand-specific mock data
async function seedDatabase(brand) {
  const brandKey = brand.toLowerCase();
  console.log(`[Database] Seeding mock data for ${brandKey}...`);
  
  const config = BRAND_CONFIGS[brandKey] || BRAND_CONFIGS.starbucks;
  const targetCustomers = config.customerSeedCount || 30;
  const targetOrders = config.orderSeedCount || 80;
  
  // Seed Shoppers
  for (let i = 0; i < targetCustomers; i++) {
    const baseName = config.names[i % config.names.length];
    const name = i >= 10 ? (i >= 20 ? `${baseName} II` : `${baseName} Jr.`) : baseName;
    const email = name.toLowerCase().replace(/[^a-z.]/g, '') + `.${i}@${brandKey}mail.com`;
    const phone = `+1555${(i + 1000 + Object.keys(BRAND_CONFIGS).indexOf(brandKey) * 100).toString().padStart(4, '0')}`;
    const id = `CUST-${brandKey.substring(0,3).toUpperCase()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    
    const meta = {
      favorite_category: config.categories[i % config.categories.length],
      preferred_channel: ['whatsapp', 'sms', 'email', 'rcs'][i % 4],
      city: ['New York', 'Los Angeles', 'San Francisco', 'Chicago', 'Seattle'][i % 5],
      age: Math.floor(Math.random() * 25) + 20 // 20 to 45
    };

    await runQuery(brandKey,
      'INSERT INTO customers (id, name, email, phone, metadata) VALUES (?, ?, ?, ?, ?)',
      [id, name, email, phone, JSON.stringify(meta)]
    );
  }

  // Fetch customer IDs
  const customers = await allQuery(brandKey, 'SELECT id, metadata FROM customers');
  
  // Seed Orders
  for (let i = 0; i < targetOrders; i++) {
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const id = `ORD-${brandKey.substring(0,3).toUpperCase()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const metadata = JSON.parse(customer.metadata);
    
    // Choose item based on favorite category mostly
    const category = Math.random() < 0.7 ? metadata.favorite_category : config.categories[Math.floor(Math.random() * config.categories.length)];
    const itemsBought = [config.items[Math.floor(Math.random() * config.items.length)]];
    if (Math.random() < 0.4) {
      itemsBought.push(config.items[Math.floor(Math.random() * config.items.length)]);
    }

    const amount = parseFloat((Math.random() * 7000 + 1000).toFixed(2)); // ₹1000 to ₹8000
    const status = Math.random() < 0.9 ? 'COMPLETED' : (Math.random() < 0.5 ? 'PENDING' : 'REFUNDED');
    
    // Generate dates over past 90 days
    const dateOffsetDays = Math.floor(Math.random() * 90);
    const date = new Date();
    date.setDate(date.getDate() - dateOffsetDays);

    await runQuery(brandKey,
      'INSERT INTO orders (id, customer_id, amount, status, items, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, customer.id, amount, status, JSON.stringify(itemsBought), date.toISOString()]
    );
  }
  
  console.log(`[Database] Seeded ${targetCustomers} customers and ${targetOrders} orders for brand: ${brandKey}.`);

  // Seed Reviews
  const reviews = REVIEW_TEMPLATES[brandKey] || REVIEW_TEMPLATES.starbucks;
  for (const [platform, platformReviews] of Object.entries(reviews)) {
    for (const r of platformReviews) {
      const id = `REV-${brandKey.substring(0,3).toUpperCase()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      await runQuery(brandKey,
        'INSERT INTO reviews (id, platform, rating, user_name, comment) VALUES (?, ?, ?, ?, ?)',
        [id, platform, r.rating, r.user_name, r.comment]
      );
    }
  }
  console.log(`[Database] Seeded customer reviews for brand: ${brandKey}.`);
}

module.exports = {
  getDbConnection,
  initDatabase,
  runQuery,
  getQuery,
  allQuery,
  BRAND_CONFIGS
};
