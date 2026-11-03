import type { Activity, Lead, LeadPage, LeadStatus } from "@/types";
export const DEMO_DATE = "2026-11-03";
export const initialPages: LeadPage[] = [
  {
    id: "pakistan",
    name: "Pakistan",
    description: "Local businesses. New possibilities.",
    flag: "PK",
    color: "green",
    created: "2026-10-24",
  },
  {
    id: "usa",
    name: "United States",
    description: "Building connections across the US.",
    flag: "US",
    color: "blue",
    created: "2026-10-26",
  },
  {
    id: "canada",
    name: "Canada",
    description: "Your next conversation starts here.",
    flag: "CA",
    color: "orange",
    created: "2026-10-28",
  },
];
const businesses: [string, string, string, string, LeadStatus, string][] = [
  [
    "The Coffee Collective",
    "Café & coffee shop",
    "Lahore",
    "+92 300 555 0101",
    "New",
    "Independent café with two locations. Ask for the owner, Hamza.",
  ],
  [
    "Oak & Stone Interiors",
    "Interior design",
    "Islamabad",
    "+92 301 555 0142",
    "Interested",
    "Interested in a new website. Send examples before our next conversation.",
  ],
  [
    "Bright Smile Dental",
    "Dental clinic",
    "Karachi",
    "+92 321 555 0183",
    "No Answer",
    "Reception is usually available after 11 am.",
  ],
  [
    "Urban Roots Nursery",
    "Garden & landscaping",
    "Lahore",
    "+92 333 555 0124",
    "Follow-up",
    "Owner requested a callback on Tuesday. Discuss online bookings.",
  ],
  [
    "Atlas Fitness Studio",
    "Health & fitness",
    "Islamabad",
    "+92 302 555 0165",
    "Voicemail",
    "Left a short introduction. Try again in the afternoon.",
  ],
  [
    "Copper Kettle Kitchen",
    "Restaurant",
    "Karachi",
    "+92 300 555 0106",
    "New",
    "Family-owned restaurant. Their current website is outdated.",
  ],
  [
    "Northstar Auto Care",
    "Automotive",
    "Rawalpindi",
    "+92 345 555 0177",
    "Meeting Booked",
    "Discovery meeting booked. Bring a proposal for local search.",
  ],
  [
    "Bloom & Co. Florists",
    "Florist",
    "Lahore",
    "",
    "New",
    "No phone listed. Visit their website for contact details.",
  ],
  [
    "Evergreen Properties",
    "Real estate",
    "Islamabad",
    "+92 310 555 0118",
    "No Answer",
    "Two unanswered attempts. One more attempt before review.",
  ],
  [
    "The Little Bookshop",
    "Retail & books",
    "Karachi",
    "+92 322 555 0199",
    "Not Interested",
    "Happy with their current provider. Do not contact again.",
  ],
  [
    "Willow Wellness",
    "Wellness studio",
    "Lahore",
    "+92 334 555 0110",
    "Follow-up",
    "Would like to revisit a booking system this week.",
  ],
  [
    "Mason & Thread",
    "Fashion & retail",
    "Faisalabad",
    "+92 303 555 0111",
    "New",
    "Small clothing brand expanding online.",
  ],
  [
    "Cedar Family Clinic",
    "Medical clinic",
    "Islamabad",
    "+92 311 555 0112",
    "Voicemail",
    "Left a message with the office manager.",
  ],
  [
    "Green Fork Market",
    "Grocery & specialty",
    "Lahore",
    "+92 312 555 0113",
    "Interested",
    "Looking for a simple product catalog and delivery inquiries.",
  ],
  [
    "Summit Travel Co.",
    "Travel agency",
    "Karachi",
    "+92 313 555 0114",
    "New",
    "Focus on custom travel packages.",
  ],
  [
    "Bluebird Bakery",
    "Bakery",
    "Lahore",
    "+92 314 555 0115",
    "No Answer",
    "Try before the lunch rush.",
  ],
  [
    "Harbor Creative",
    "Design studio",
    "Islamabad",
    "",
    "New",
    "Contact form available on their site.",
  ],
  [
    "Olive Tree Bistro",
    "Restaurant",
    "Karachi",
    "+92 315 555 0116",
    "New",
    "New branch opening next month.",
  ],
];
export const initialLeads: Lead[] = initialPages.flatMap((page, p) =>
  businesses.slice(0, p === 0 ? 18 : p === 1 ? 12 : 8).map((b, i) => ({
    id: `${page.id}-${i + 1}`,
    pageId: page.id,
    name: b[0],
    category: b[1],
    city:
      p === 0
        ? b[2]
        : p === 1
          ? ["Austin", "Portland", "Denver"][i % 3]
          : ["Toronto", "Vancouver", "Calgary"][i % 3],
    phone: !b[3]
      ? ""
      : p === 0
        ? b[3]
        : `+1 ${p === 1 ? "512" : "416"} 555 ${String(100 + i).padStart(4, "0")}`,
    website: `https://${b[0].toLowerCase().replace(/[^a-z]/g, "")}.example.com`,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b[0] + " " + (p === 0 ? b[2] : p === 1 ? "Austin" : "Toronto"))}`,
    status: b[4],
    attempts: b[4] === "New" ? 0 : i === 8 ? 2 : 1,
    failedAttempts: ["No Answer", "Voicemail"].includes(b[4])
      ? i === 8
        ? 2
        : 1
      : 0,
    notes: b[5],
    created: `2026-10-${24 + (i % 7)}`,
    contacted: b[4] === "New" ? null : "2026-11-03",
    archived: i === 9,
    ...(i === 9 ? { archivedAt: "2026-11-02" } : {}),
    ...(["Follow-up", "Meeting Booked"].includes(b[4])
      ? {
          followup: i === 3 ? "2026-11-03" : "2026-11-04",
          followupTime: i === 3 ? "15:00" : "11:30",
        }
      : {}),
  })),
);
export const initialActivity: Activity[] = initialLeads
  .filter((l) => l.contacted && !l.archived)
  .slice(0, 9)
  .map((l, i) => ({
    id: `activity-${i}`,
    leadId: l.id,
    name: l.name,
    outcome: l.status,
    date: i < 7 ? DEMO_DATE : "2026-11-02",
    time: `${11 - Math.floor(i / 3)}:${String(52 - (i % 3) * 17).padStart(2, "0")}`,
    notes: l.notes,
  }));
