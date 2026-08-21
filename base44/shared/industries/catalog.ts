// Industry catalog — the closed set of industries Launch OS understands.
// Stable keys; labels/categories are display metadata. The Industry Intelligence
// Engine detects from this catalog (closed set → reliable classification), then
// loads the matching IndustryBlueprint.

export interface IndustryEntry {
  key: string;
  label: string;
  category: string;
}

export const INDUSTRIES: IndustryEntry[] = [
  { key: "gym", label: "Gym / Fitness Center", category: "fitness" },
  { key: "fitness_studio", label: "Fitness Studio", category: "fitness" },
  { key: "yoga_studio", label: "Yoga Studio", category: "wellness" },
  { key: "restaurant", label: "Restaurant", category: "food" },
  { key: "cafe", label: "Cafe / Coffee Shop", category: "food" },
  { key: "bakery", label: "Bakery", category: "food" },
  { key: "catering", label: "Catering", category: "food" },
  { key: "food_truck", label: "Food Truck", category: "food" },
  { key: "juice_bar", label: "Juice / Smoothie Bar", category: "food" },
  { key: "microbrewery", label: "Microbrewery", category: "food" },
  { key: "dentist", label: "Dentist", category: "healthcare" },
  { key: "clinic", label: "Medical Clinic", category: "healthcare" },
  { key: "hospital", label: "Hospital", category: "healthcare" },
  { key: "chiropractor", label: "Chiropractor", category: "healthcare" },
  { key: "optometrist", label: "Optometrist", category: "healthcare" },
  { key: "physiotherapy", label: "Physiotherapy", category: "healthcare" },
  { key: "veterinary", label: "Veterinary Clinic", category: "healthcare" },
  { key: "pharmacy", label: "Pharmacy", category: "healthcare" },
  { key: "spa", label: "Spa", category: "beauty" },
  { key: "medical_spa", label: "Medical Spa", category: "beauty" },
  { key: "salon", label: "Salon", category: "beauty" },
  { key: "cosmetics", label: "Cosmetics Brand", category: "beauty" },
  { key: "law_firm", label: "Law Firm", category: "professional_services" },
  { key: "consultant", label: "Consultant", category: "professional_services" },
  { key: "digital_marketing", label: "Digital Marketing Agency", category: "professional_services" },
  { key: "accounting", label: "Accounting / CA Firm", category: "financial" },
  { key: "insurance", label: "Insurance Broker", category: "financial" },
  { key: "real_estate", label: "Real Estate Brokerage", category: "real_estate" },
  { key: "property_management", label: "Property Management", category: "real_estate" },
  { key: "architecture", label: "Architecture Firm", category: "creative" },
  { key: "interior_designer", label: "Interior Designer", category: "creative" },
  { key: "construction", label: "Construction / Contractor", category: "real_estate" },
  { key: "hotel", label: "Hotel", category: "hospitality" },
  { key: "hostel", label: "Hostel", category: "hospitality" },
  { key: "travel_agency", label: "Travel Agency", category: "hospitality" },
  { key: "tour_operator", label: "Tour Operator", category: "hospitality" },
  { key: "ecommerce", label: "E-commerce Store", category: "ecommerce" },
  { key: "retail", label: "Retail Store", category: "retail" },
  { key: "grocery", label: "Grocery / Convenience", category: "retail" },
  { key: "fashion", label: "Fashion Brand", category: "fashion" },
  { key: "jewelry", label: "Jewelry", category: "fashion" },
  { key: "manufacturer", label: "Manufacturer", category: "manufacturing" },
  { key: "importer", label: "Importer", category: "trade" },
  { key: "exporter", label: "Exporter", category: "trade" },
  { key: "wholesale", label: "Wholesale / Distribution", category: "trade" },
  { key: "warehouse", label: "Warehouse", category: "logistics" },
  { key: "logistics", label: "Logistics / Freight", category: "logistics" },
  { key: "courier", label: "Courier / Delivery", category: "logistics" },
  { key: "education", label: "Education / Coaching Institute", category: "education" },
  { key: "tutoring", label: "Tutoring", category: "education" },
  { key: "daycare", label: "Daycare / Childcare", category: "education" },
  { key: "driving_school", label: "Driving School", category: "education" },
  { key: "startup", label: "Startup", category: "tech" },
  { key: "saas", label: "SaaS Company", category: "tech" },
  { key: "web_agency", label: "Web Development Agency", category: "tech" },
  { key: "ngo", label: "NGO / Nonprofit", category: "public_sector" },
  { key: "automobile", label: "Automobile / Car Dealership", category: "automotive" },
  { key: "auto_repair", label: "Auto Repair / Garage", category: "automotive" },
  { key: "photography", label: "Photography", category: "creative" },
  { key: "event_planner", label: "Event Planner", category: "events" },
  { key: "wedding_planner", label: "Wedding Planner", category: "events" },
  { key: "cleaning_service", label: "Cleaning Service", category: "personal_services" },
  { key: "pest_control", label: "Pest Control", category: "personal_services" },
  { key: "plumbing", label: "Plumbing", category: "personal_services" },
  { key: "electrician", label: "Electrician", category: "personal_services" },
  { key: "landscaping", label: "Landscaping / Gardening", category: "personal_services" },
  { key: "pet_services", label: "Pet Services", category: "personal_services" },
  { key: "agriculture", label: "Agriculture / Farm", category: "agriculture" },
  { key: "renewable_energy", label: "Renewable Energy", category: "manufacturing" },
];

export const INDUSTRY_KEYS = INDUSTRIES.map((i) => i.key);

export function findIndustry(key: string): IndustryEntry | undefined {
  return INDUSTRIES.find((i) => i.key === key);
}

export function listCatalog(): IndustryEntry[] {
  return INDUSTRIES;
}

export function categoryLabel(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}