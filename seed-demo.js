const CITIES = [
  "Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad",
  "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow",
  "Surat", "Indore", "Bhopal", "Nagpur", "Visakhapatnam",
  "Coimbatore", "Kochi", "Vadodara", "Chandigarh", "Guwahati",
];

const CATEGORIES = [
  "Restaurant", "Bakery", "Salon", "Plumber", "Electrician",
  "Dentist", "Gym", "Pharmacy", "Bookstore", "Clothing Store",
  "Cafe", "Tiffin Service", "Hair Salon", "AC Repair", "Painter",
  "Yoga Studio", "Diagnostic Center", "Stationery Shop", "Jewelry Store", "Mobile Repair",
  "Catering", "Event Planner", "Photography Studio", "Home Tutor", "Tutor",
  "Interior Designer", "Architect", "Real Estate Agent", "Travel Agency", "Pest Control",
  "Laundry Service", "Tailor", "Shoe Store", "Electronics Shop", "Furniture Store",
  "Auto Repair", "Car Wash", "Bike Service", "Doctor", "Physiotherapist",
  "Dermatologist", "Eye Hospital", "Veterinary Clinic", "Pet Store", "Grocery Store",
  "Organic Store", "Sweet Shop", "Ice Cream Parlor", "Juice Center", "Fast Food",
];

const STREETS = [
  "MG Road", "Main Road", "Station Road", "Market Road", "Temple Road",
  "Lake View Road", "Park Street", "Church Street", "College Road", "Hospital Road",
  "Ring Road", "Bypass Road", "Kumaraswamy Layout", "JP Nagar", "Indiranagar",
  "Koramangala", "Whitefield", "HSR Layout", "BTM Layout", "Jayanagar",
  "Rajajinagar", "Malleshwaram", "Basavanagudi", "Sadashivanagar", "Vijayanagar",
];

const AREA_SUFFIXES = ["Layout", "Nagar", "Extension", "Colony", "Society", "Vihar", "Pura", "Ganj", "Bagh", "Chowk"];

const WEBSITE_STATUS_WEIGHTS = [35, 20, 5, 15, 25]; // no_website, broken, blocked, working, unchecked

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick() {
  const r = Math.random() * 100;
  let cum = 0;
  const statuses = ["no_website", "broken", "blocked", "working", "unchecked"];
  for (let i = 0; i < statuses.length; i++) {
    cum += WEBSITE_STATUS_WEIGHTS[i];
    if (r < cum) return statuses[i];
  }
  return "no_website";
}

function randomPhone() {
  const prefixes = ["98", "99", "97", "96", "95", "94", "93", "92", "91", "90", "88", "87", "86", "85", "84", "83", "82", "81", "80", "70", "74", "76", "77", "78", "79"];
  const prefix = pick(prefixes);
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += Math.floor(Math.random() * 10);
  return `+91${prefix}${suffix}`;
}

function businessName(category) {
  const prefixes = {
    "Restaurant": ["Taj", "Royal", "Spice", "Punjab", "Southern", "Kerala", "Delhi", "Mumbai"],
    "Bakery": ["Fresh", "Golden", "Sweet", "Brown", "Cake", "Bread", "Cookie", "Donut"],
    "Salon": ["Style", "Cut", "Glow", "Trendy", "Royal", "Modern", "Classic", "Fashion"],
    "Plumber": ["Quick", "Rapid", "Expert", "Pro", "24/7", "Speedy", "Reliable", "Prime"],
    "Electrician": ["Power", "Volt", "Spark", "Current", "Bright", "Electro", "Light", "Safe"],
    "Dentist": ["Smile", "Dental", "Tooth", "Bright", "Perfect", "Care", "Dent", "Oral"],
    "Gym": ["Fit", "Power", "Muscle", "Iron", "Strong", "Titan", "Shred", "Pro"],
    "Pharmacy": ["Medi", "Health", "Care", "Life", "MedPlus", "Wellness", "Pharma", "Doc"],
    "Bookstore": ["Read", "Page", "Book", "Knowledge", "Paper", "Word", "Library", "Story"],
    "Clothing Store": ["Fashion", "Trendy", "Style", "Classic", "Modern", "Royal", "Urban", "Vogue"],
    "Cafe": ["Brew", "Cup", "Bean", "Mug", "Roast", "Cafe", "Java", "Bistro"],
    "Tiffin Service": ["Home", "Tasty", "Fresh", "Mom", "Kitchen", "Bhojan", "Swad", "Ghar"],
    "Hair Salon": ["Hair", "Style", "Cut", "Curl", "Strand", "Shear", "Chrome", "Scissors"],
    "AC Repair": ["Cool", "Chill", "Frost", "Arctic", "Winter", "Climate", "AC", "Cold"],
    "Painter": ["Color", "Paint", "Brush", "Hue", "Shade", "Art", "Rainbow", "Prime"],
    "Yoga Studio": ["Zen", "Peace", "Yoga", "Soul", "Body", "Mind", "Harmony", "Flex"],
    "Diagnostic Center": ["Health", "Patho", "Diagno", "Care", "Medi", "Lab", "Test", "Scan"],
    "Stationery Shop": ["Paper", "Pen", "Write", "Ink", "Copy", "Note", "Office", "School"],
    "Jewelry Store": ["Gold", "Silver", "Diamond", "Gem", "Ornament", "Jewel", "Karát", "Ring"],
    "Mobile Repair": ["Phone", "Mobile", "Gadget", "Tech", "Fix", "Repair", "Cell", "Smart"],
    "Catering": ["Royal", "Grand", "Elegant", "Tasty", "Feast", "Party", "Event", "Cater"],
    "Event Planner": ["Event", "Celebrate", "Party", "Grand", "Dream", "Perfect", "Occasion", "Fiesta"],
    "Photography Studio": ["Click", "Snap", "Frame", "Photo", "Picture", "Lens", "Flash", "Focus"],
    "Home Tutor": ["Learn", "Study", "Edu", "Smart", "Home", "Tutor", "Guide", "Scholar"],
    "Interior Designer": ["Design", "Decor", "Interior", "Space", "Style", "Creative", "Art", "Dream"],
    "Architect": ["Design", "Build", "Plan", "Arch", "Create", "Structure", "Blue", "Square"],
    "Real Estate Agent": ["Home", "Property", "Estate", "House", "Land", "Reality", "Rent", "Sell"],
    "Travel Agency": ["Travel", "Tour", "Voyage", "Trip", "Explore", "Journey", "Go", "Fly"],
    "Pest Control": ["Pest", "Bug", "Termite", "Shield", "Safe", "Clean", "Guard", "Protect"],
    "Laundry Service": ["Clean", "Wash", "Fresh", "Dry", "Laundry", "Press", "Iron", "Crisp"],
    "Tailor": ["Stitch", "Fashion", "Tailor", "Fit", "Seam", "Cut", "Style", "Custom"],
    "Shoe Store": ["Step", "Walk", "Foot", "Shoe", "Sneaker", "Comfort", "Street", "Sole"],
    "Electronics Shop": ["Electro", "Digital", "Tech", "Gadget", "Smart", "Power", "Electronic", "Net"],
    "Furniture Store": ["Wood", "Craft", "Furniture", "Home", "Decor", "Royal", "Classic", "Oak"],
    "Auto Repair": ["Auto", "Car", "Mech", "Drive", "Gear", "Service", "Garage", "Motor"],
    "Car Wash": ["Shine", "Clean", "Wash", "Sparkle", "Car", "Auto", "Gloss", "Fresh"],
    "Bike Service": ["Bike", "Moto", "Rider", "Speed", "Gear", "Service", "Wheel", "Chain"],
    "Doctor": ["Doc", "Care", "Health", "Life", "Med", "Clinic", "Heal", "Well"],
    "Physiotherapist": ["Physio", "Move", "Flex", "Back", "Health", "Joint", "Rehab", "Motion"],
    "Dermatologist": ["Skin", "Glow", "Derma", "Clear", "Radiant", "Care", "Beauty", "Youth"],
    "Eye Hospital": ["Eye", "Vision", "Sight", "Optics", "Clear", "Focus", "View", "Look"],
    "Veterinary Clinic": ["Pet", "Vet", "Animal", "Paw", "Dog", "Cat", "Care", "Wild"],
    "Pet Store": ["Pet", "Paw", "Tail", "Whisker", "Animal", "Pet", "Buddy", "Furry"],
    "Grocery Store": ["Fresh", "Green", "Daily", "Super", "Local", "Kirana", "Mart", "Basket"],
    "Organic Store": ["Organic", "Green", "Pure", "Natural", "Earth", "Fresh", "Whole", "Bio"],
    "Sweet Shop": ["Sweet", "Mithai", "Sugar", "Candy", "Honey", "Delight", "Treat", "Desert"],
    "Ice Cream Parlor": ["Ice", "Cream", "Frosty", "Chill", "Cool", "Scoop", "Melt", "Swirl"],
    "Juice Center": ["Juice", "Fresh", "Cool", "Sip", "Blend", "Fruit", "Squeeze", "Nectar"],
    "Fast Food": ["Quick", "Bite", "Crunch", "Snack", "Fast", "Tasty", "Spicy", "Grill"],
  };
  const cats = prefixes[category] || ["Best", "New", "City", "Star", "Top", "Premier", "Elite", "Prime"];
  return pick(cats) + " " + pick(cats !== prefixes[category] ? ["Enterprises", "Services", "Solutions", "Corner", "Point", "Hub", "Center"] : []) + " " + category;
}

function generateBusiness(i) {
  const category = pick(CATEGORIES);
  const city = pick(CITIES);
  const area = pick(STREETS);
  const phone = randomPhone();
  const rating = Math.random() < 0.15 ? "" : (3 + Math.random() * 2).toFixed(1);
  const reviews = rating ? Math.floor(Math.random() * 500 + 10).toString() : "";
  const websiteStatus = weightedPick();
  const hasWebsite = websiteStatus !== "no_website";
  const website_url = hasWebsite ? `https://www.${category.toLowerCase().replace(/ /g, "")}${city.toLowerCase()}${i}.example.com` : "";

  const id = `demo-${String(i + 1).padStart(4, "0")}`;
  const name = businessName(category);
  const address = `${Math.floor(Math.random() * 999) + 1}, ${area}`;
  const pipeline_status = pick(["not_contacted", "contacted", "interested", "will_talk_later", "not_interested", "completed"]);
  const scraped_on = new Date(Date.now() - Math.floor(Math.random() * 90) * 86400000).toISOString().slice(0, 10);

  return {
    id, name, category, address, city, phone,
    rating, reviews, website_url, website_status: websiteStatus,
    website_checked_at: hasWebsite ? new Date().toISOString() : "",
    location_query: `${category} in ${city}`,
    source: "Google Maps",
    scraped_on,
    pipeline_status,
    pipeline_updated_at: new Date(Date.now() - Math.floor(Math.random() * 30) * 86400000).toISOString(),
    notes: "",
    message_sent: "",
    message_sent_at: "",
  };
}

export async function seedDemoData(pool) {
  const { rows: existing } = await pool.query("SELECT COUNT(*)::int as n FROM businesses");
  if (existing[0].n > 0) {
    return { seeded: false, count: existing[0].n };
  }

  const businesses = [];
  for (let i = 0; i < 500; i++) {
    businesses.push(generateBusiness(i));
  }

  let inserted = 0;
  for (const b of businesses) {
    try {
      await pool.query(
        `INSERT INTO businesses (id, name, category, address, city, phone, rating, reviews, website_url, website_status, website_checked_at, location_query, source, scraped_on, pipeline_status, pipeline_updated_at, notes, message_sent, message_sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [b.id, b.name, b.category, b.address, b.city, b.phone, b.rating, b.reviews, b.website_url, b.website_status, b.website_checked_at, b.location_query, b.source, b.scraped_on, b.pipeline_status, b.pipeline_updated_at, b.notes, b.message_sent, b.message_sent_at]
      );
      inserted++;
    } catch (err) {
      // Skip duplicates
      if (err.code !== "23505") throw err;
    }
  }

  return { seeded: true, count: inserted };
}
